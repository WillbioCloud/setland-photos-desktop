import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Store, 
  Search, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  User, 
  Phone, 
  Printer, 
  Smartphone, 
  CreditCard, 
  QrCode, 
  Banknote, 
  RefreshCw, 
  Camera, 
  Check, 
  Sparkles,
  PackageCheck
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { calculatePricing, type PackageDef } from '@/lib/pricingEngine';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function LojinhaView() {
  const [orders, setOrders] = useState<any[]>([]);
  const [packages, setPackages] = useState<PackageDef[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'awaiting' | 'paid'>('awaiting');
  const [isLoading, setIsLoading] = useState(true);
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);

  // Controle de alertas e pop-ups nativos do Windows para novos pedidos
  const knownAwaitingIdsRef = useRef<Set<string>>(new Set());
  const notifiedOrderIdsRef = useRef<Set<string>>(new Set());
  const isFirstLoadRef = useRef(true);

  // Dispara a Notificação Nativa do Windows (Pop-up do Sistema + Som) e o Toast Sonner
  const notifyNewStoreOrder = useCallback((orderData: any) => {
    if (!orderData?.id) return;

    // Trava de deduplicação estrita: se este pedido já foi notificado, ignora sumariamente!
    if (notifiedOrderIdsRef.current.has(orderData.id)) {
      return;
    }
    notifiedOrderIdsRef.current.add(orderData.id);
    knownAwaitingIdsRef.current.add(orderData.id);

    const clientName = orderData.photo_sessions?.clients?.name || orderData.photo_sessions?.client_name || 'Cliente';
    const totalStr = Number(orderData.total_amount || 0).toFixed(2).replace('.', ',');
    const printedCount = orderData.printed_count || 0;
    const digitalCount = orderData.digital_count || 0;
    const itemsDesc = `${printedCount} impressa(s) • ${digitalCount} digital(is)`;

    // 1. Notificação Nativa do Windows (Toast Pop-up mesmo com o app minimizado)
    const api = typeof window !== 'undefined' ? (window.electronAPI || window.electron) : null;
    if (api?.showNotification) {
      void api.showNotification({
        title: '🛍️ Novo Pedido Recebido no Caixa!',
        body: `Cliente: ${clientName}\nTotal a Cobrar: R$ ${totalStr} (${itemsDesc})`,
        silent: false,
      });
    }

    // 2. Alerta visual interno na interface
    toast.info(`🛍️ Novo Pedido: ${clientName} — R$ ${totalStr}`, {
      description: `Aguardando cobrança no balcão. ${itemsDesc}`,
      duration: 6000,
    });
  }, []);

  // Carrega pacotes ativos para o motor de precificação
  useEffect(() => {
    async function loadPackages() {
      const { data } = await supabase.from('packages').select('*').eq('active', true);
      if (data) setPackages(data as PackageDef[]);
    }
    loadPackages();
  }, []);

  // Busca os pedidos do dia (aguardando pagamento na lojinha e pagos)
  const loadOrders = useCallback(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          photo_sessions (
            cover_photo_url,
            client_name,
            client_phone,
            photographer_name,
            clients (
              name,
              phone
            )
          )
        `)
        .gte('created_at', today.toISOString())
        .in('status', ['awaiting_store', 'paid'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) {
        setOrders(data);

        if (isFirstLoadRef.current) {
          // Na inicialização, memoriza os pedidos existentes sem disparar alerta
          data.filter(o => o.status === 'awaiting_store').forEach(o => {
            knownAwaitingIdsRef.current.add(o.id);
            notifiedOrderIdsRef.current.add(o.id);
          });
          isFirstLoadRef.current = false;
        } else {
          // Nas checagens seguintes (polling ou recarga), notifica qualquer um novo
          for (const order of data) {
            if (order.status === 'awaiting_store' && !notifiedOrderIdsRef.current.has(order.id)) {
              notifyNewStoreOrder(order);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[LojinhaView] Erro ao buscar pedidos:', err);
    } finally {
      setIsLoading(false);
    }
  }, [notifyNewStoreOrder]);

  // Mantém referência estável para loadOrders sem recriar o canal de Realtime a cada render
  const loadOrdersRef = useRef(loadOrders);
  useEffect(() => {
    loadOrdersRef.current = loadOrders;
  });

  // Assinatura Realtime no Supabase + Polling a cada 5s
  useEffect(() => {
    loadOrdersRef.current();

    const channel = supabase.channel('lojinha-orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload: any) => {
        // Alerta imediato via WebSocket no momento exato em que a Fotografia despacha o pedido
        if (payload.new && payload.new.status === 'awaiting_store') {
          const orderId = payload.new.id;
          if (orderId && !notifiedOrderIdsRef.current.has(orderId)) {
            // Trava imediatamente de forma síncrona antes de qualquer await assíncrono!
            notifiedOrderIdsRef.current.add(orderId);
            knownAwaitingIdsRef.current.add(orderId);

            const { data: newOrderData } = await supabase
              .from('orders')
              .select(`
                *,
                photo_sessions (
                  client_name,
                  clients ( name )
                )
              `)
              .eq('id', orderId)
              .maybeSingle();

            if (newOrderData) {
              notifyNewStoreOrder(newOrderData);
            } else {
              notifyNewStoreOrder(payload.new);
            }
          }
        }
        loadOrdersRef.current();
      })
      .subscribe();

    const interval = setInterval(() => {
      loadOrdersRef.current();
    }, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [notifyNewStoreOrder]);

  // Ação de confirmação de pagamento
  const handleConfirmPayment = async (order: any, method: string = 'lojinha') => {
    if (processingOrderId) return;
    setProcessingOrderId(order.id);

    const clientName = order.photo_sessions?.clients?.name || order.photo_sessions?.client_name || 'Cliente';
    const toastId = toast.loading(`Confirmando pagamento de ${clientName}...`);

    try {
      // 1. Atualiza pedido para pago
      const { error: orderErr } = await supabase
        .from('orders')
        .update({
          status: 'paid',
          payment_method: method
        })
        .eq('id', order.id);

      if (orderErr) throw orderErr;

      // 2. Atualiza sessão para Convertido/Pago
      if (order.session_id) {
        await supabase
          .from('photo_sessions')
          .update({ status: 'Convertido/Pago' })
          .eq('id', order.session_id);
      }

      toast.success(`Pagamento de ${clientName} confirmado! A equipe de fotografia já foi notificada.`, {
        id: toastId,
        duration: 4000
      });

      // Recarrega localmente
      loadOrders();
    } catch (err: any) {
      console.error('[Lojinha] Erro ao confirmar pagamento:', err);
      toast.error(`Falha ao registrar pagamento: ${err?.message || 'Erro no banco de dados'}`, { id: toastId });
    } finally {
      setProcessingOrderId(null);
    }
  };

  // Separação de status
  const awaitingOrders = orders.filter(o => o.status === 'awaiting_store');
  const paidOrders = orders.filter(o => o.status === 'paid');

  const totalPaidToday = paidOrders.reduce((acc, curr) => acc + Number(curr.total_amount || 0), 0);

  // Filtro de busca por nome ou telefone
  const filterList = (list: any[]) => {
    if (!searchTerm.trim()) return list;
    const term = searchTerm.toLowerCase().trim();
    const cleanTermDigits = term.replace(/\D/g, '');

    return list.filter(o => {
      const name = (o.photo_sessions?.clients?.name || o.photo_sessions?.client_name || '').toLowerCase();
      const phone = String(o.photo_sessions?.clients?.phone || o.photo_sessions?.client_phone || '');
      const phoneDigits = phone.replace(/\D/g, '');

      return name.includes(term) || 
             (cleanTermDigits && phoneDigits.includes(cleanTermDigits)) ||
             phone.toLowerCase().includes(term);
    });
  };

  const filteredAwaiting = filterList(awaitingOrders);
  const filteredPaid = filterList(paidOrders);

  return (
    <div className="flex-1 flex flex-col h-full space-y-6 select-none animate-in fade-in duration-300">
      
      {/* 1. Header & Resumo Operacional da Lojinha */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-5 rounded-2xl bg-card border border-border shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20 shadow-sm">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Caixa da Lojinha · Recebimento de Fotos</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-muted-foreground font-medium">Sincronizado em Tempo Real com a Fotografia</span>
              </div>
            </div>
          </div>
        </div>

        {/* Métricas Rápidas */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
            <Clock className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
            <div>
              <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Aguardando Pagamento</div>
              <div className="text-lg font-bold font-mono text-amber-700 dark:text-amber-300 tabular-figures">
                {awaitingOrders.length} pedido(s)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <div>
              <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Recebidos Hoje</div>
              <div className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-300 tabular-figures">
                {paidOrders.length} pedido(s)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border">
            <DollarSign className="w-4 h-4 text-primary shrink-0" />
            <div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Recebido Hoje</div>
              <div className="text-lg font-bold font-mono text-foreground tabular-figures">
                R$ {totalPaidToday.toFixed(2).replace('.', ',')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Barra de Busca e Alternância de Abas */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Abas */}
        <div className="flex bg-muted/60 p-1 rounded-xl w-fit border border-border">
          <button
            onClick={() => setActiveTab('awaiting')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'awaiting'
                ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Aguardando Pagamento ({awaitingOrders.length})
          </button>
          
          <button
            onClick={() => setActiveTab('paid')}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'paid'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            Últimos Recebidos ({paidOrders.length})
          </button>
        </div>

        {/* Campo de Busca Rápida */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input 
            type="text"
            placeholder="Buscar por cliente ou telefone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-10 rounded-xl bg-card border-border font-medium text-xs"
          />
        </div>
      </div>

      {/* 3. Conteúdo Principal: Aba 1 (Aguardando Pagamento) */}
      {activeTab === 'awaiting' && (
        <div className="flex-1 overflow-y-auto pr-1 no-scrollbar space-y-4">
          {filteredAwaiting.length === 0 ? (
            <div className="py-20 text-center flex flex-col items-center justify-center border-2 border-dashed border-border rounded-3xl bg-card/30">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-4 border border-emerald-500/20">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-foreground">Tudo em dia!</h3>
              <p className="text-muted-foreground text-sm mt-1 max-w-md">
                Nenhum pedido aguardando cobrança no momento. Assim que a Fotografia enviar um cliente para a Lojinha, ele aparecerá aqui instantaneamente.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {filteredAwaiting.map((order) => {
                const clientName = order.photo_sessions?.clients?.name || order.photo_sessions?.client_name || 'Cliente';
                const clientPhone = order.photo_sessions?.clients?.phone || order.photo_sessions?.client_phone || 'Sem telefone';
                const photographer = order.photo_sessions?.photographer_name || 'Equipe Geral';
                const coverUrl = order.photo_sessions?.cover_photo_url 
                  ? order.photo_sessions.cover_photo_url.replace(/\\/g, '/')
                  : null;

                const pricing = calculatePricing(order.printed_count || 0, order.digital_count || 0, packages);
                const isProcessing = processingOrderId === order.id;

                return (
                  <Card 
                    key={order.id}
                    className="border-2 border-amber-500/40 bg-card shadow-lg shadow-amber-500/5 rounded-2xl overflow-hidden p-5 flex flex-col justify-between hover:border-amber-500/70 transition-all duration-200"
                  >
                    <div>
                      {/* Topo do Card: Capa + Dados do Cliente */}
                      <div className="flex items-start gap-4">
                        <div className="w-20 h-20 rounded-xl overflow-hidden bg-muted shrink-0 border border-amber-500/30 shadow-sm relative">
                          {coverUrl ? (
                            <img src={coverUrl} alt={clientName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                              <Camera className="w-8 h-8 opacity-40" />
                            </div>
                          )}
                          <div className="absolute top-1 left-1 bg-amber-500 text-slate-950 font-black text-[9px] px-1.5 py-0.5 rounded shadow-sm">
                            COBRAR
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-xl font-bold text-foreground truncate">{clientName}</h3>
                            <span className="text-2xl font-black font-mono text-amber-500 dark:text-amber-400 shrink-0">
                              R$ {Number(order.total_amount).toFixed(2).replace('.', ',')}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5 font-mono">
                              <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                              {clientPhone}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <User className="w-3.5 h-3.5 text-muted-foreground" />
                              {photographer}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Divisor */}
                      <hr className="my-4 border-border/60" />

                      {/* Detalhamento dos Itens do Pacote */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                            Itens Selecionados na Vitrine:
                          </span>
                          <div className="flex items-center gap-2">
                            {order.printed_count > 0 && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/20 text-xs">
                                <Printer className="w-3 h-3" /> {order.printed_count} Impressa(s)
                              </span>
                            )}
                            {order.digital_count > 0 && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold border border-blue-500/20 text-xs">
                                <Smartphone className="w-3 h-3" /> {order.digital_count} Digital(is)
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Extrato do Pacote Calculado */}
                        {pricing?.items && pricing.items.length > 0 && (
                          <div className="p-2.5 rounded-xl bg-muted/40 border border-border/40 text-xs space-y-1">
                            {pricing.items.map((item, idx) => (
                              <div key={idx} className="flex justify-between items-center text-muted-foreground">
                                <span>{item.quantity}x {item.name}</span>
                                <span className="font-mono font-medium text-foreground">
                                  R$ {item.subtotal.toFixed(2).replace('.', ',')}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Botões de Ação de Pagamento */}
                    <div className="mt-5 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirmPayment(order, 'pix')}
                          disabled={isProcessing}
                          className="py-2.5 px-3 rounded-xl border border-border bg-card hover:bg-muted font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                          <QrCode className="w-3.5 h-3.5 text-primary" />
                          PIX
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmPayment(order, 'credit_card')}
                          disabled={isProcessing}
                          className="py-2.5 px-3 rounded-xl border border-border bg-card hover:bg-muted font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                          <CreditCard className="w-3.5 h-3.5 text-blue-500" />
                          Cartão
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmPayment(order, 'cash')}
                          disabled={isProcessing}
                          className="py-2.5 px-3 rounded-xl border border-border bg-card hover:bg-muted font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                          <Banknote className="w-3.5 h-3.5 text-emerald-500" />
                          Dinheiro
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleConfirmPayment(order, 'lojinha')}
                        disabled={isProcessing}
                        className="w-full py-3 px-4 rounded-xl font-black text-sm bg-emerald-600 hover:bg-emerald-500 text-white shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                        {isProcessing ? 'Confirmando...' : 'Confirmar Pagamento Recebido'}
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. Conteúdo Principal: Aba 2 (Últimos Recebidos Hoje) */}
      {activeTab === 'paid' && (
        <div className="flex-1 overflow-y-auto pr-1 no-scrollbar space-y-3">
          {filteredPaid.length === 0 ? (
            <div className="py-20 text-center flex flex-col items-center justify-center border-2 border-dashed border-border rounded-3xl bg-card/30">
              <PackageCheck className="w-12 h-12 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">Nenhum pagamento registrado hoje ainda.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredPaid.map((order) => {
                const clientName = order.photo_sessions?.clients?.name || order.photo_sessions?.client_name || 'Cliente';
                const clientPhone = order.photo_sessions?.clients?.phone || order.photo_sessions?.client_phone || 'Sem telefone';
                const photographer = order.photo_sessions?.photographer_name || 'Equipe Geral';
                const timeString = new Date(order.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                
                const methodLabel = 
                  order.payment_method === 'pix' ? 'PIX' :
                  order.payment_method === 'credit_card' || order.payment_method === 'cartao' ? 'Cartão' :
                  order.payment_method === 'cash' || order.payment_method === 'dinheiro' ? 'Dinheiro' :
                  'Balcão Lojinha';

                return (
                  <div 
                    key={order.id}
                    className="p-4 rounded-xl bg-card border border-border/80 flex items-center justify-between gap-4 shadow-sm"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0 border border-emerald-500/20">
                        <Check className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-foreground truncate">{clientName}</h4>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{clientPhone}</span>
                          <span>•</span>
                          <span>{photographer}</span>
                          <span>•</span>
                          <span className="font-mono">{timeString}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground font-medium">
                          {order.printed_count || 0} Impressas • {order.digital_count || 0} Digitais
                        </div>
                        <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground mt-0.5">
                          {methodLabel}
                        </span>
                      </div>

                      <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400">
                        R$ {Number(order.total_amount).toFixed(2).replace('.', ',')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
