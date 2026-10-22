import React, { useState, useEffect, useCallback } from 'react';
import { Camera, QrCode, CreditCard, Banknote, ShoppingCart, Trash2, ArrowRight, Check, Store } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import PrintOrderModal from './PrintOrderModal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from "sonner";
import { supabase } from '@/lib/supabaseClient';
import { calculatePricing, type PackageDef } from '@/lib/pricingEngine';
import { consumeCartPreset, type CartPresetPayload } from '@/lib/cartBridge';

export default function PDV() {
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [packages, setPackages] = useState<PackageDef[]>([]);
  const [activeOrder, setActiveOrder] = useState<any | null>(null);
  const [selectedTerminal, setSelectedTerminal] = useState("Via Lojinha (Balcão)");
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printModalData, setPrintModalData] = useState<{ clientName: string; photos: any[] }>({ clientName: '', photos: [] });

  const loadData = useCallback(async () => {
    // 1. Busca os pedidos pendentes e os que aguardam pagamento na lojinha
    const { data: ordersData } = await supabase.from('orders')
      .select(`
        *,
        photo_sessions (
          cover_photo_url,
          clients (
            name,
            phone,
            cpf
          )
        )
      `)
      .in('status', ['pending', 'awaiting_store'])
      .order('created_at', { ascending: false });

    if (ordersData) setPendingOrders(ordersData);

    // 2. Busca os pacotes para o Motor de Precificação reconstruir o extrato
    const { data: pkgsData } = await supabase.from('packages').select('*').eq('active', true);
    if (pkgsData) setPackages(pkgsData as PackageDef[]);

    // Devolve a fila já atualizada para quem precisa selecionar o pedido recém-carregado
    return ordersData || [];
  }, []);

  /**
   * Abre o caixa já com a sessão despachada pela aba Clientes (evento global `add-to-cart`).
   * Se a sessão ainda não tiver pedido pendente, monta o faturamento imediato a partir das
   * fotos já marcadas para venda no banco (mesma regra do modal de seleção de formatos).
   */
  const focusSessionInCart = useCallback(async (payload?: CartPresetPayload | null) => {
    const orders = await loadData();
    const sessionId = payload?.sessionId;

    if (!sessionId) return;

    const existingOrder = (orders || []).find((order: any) => order.session_id === sessionId);
    if (existingOrder) {
      setActiveOrder(existingOrder);
      toast.success(`Sessão de ${payload?.clientName || 'cliente'} carregada no caixa.`, {
        description: 'Confira os itens ao lado e finalize a cobrança.'
      });
      return;
    }

    // Sem pedido pendente: confere se a sessão já possui fotos marcadas para venda
    const { data: selectedPhotos, error } = await supabase
      .from('session_photos')
      .select('id, is_printed')
      .eq('session_id', sessionId)
      .eq('status', 'selected');

    if (error) {
      console.error('[PDV] Erro ao consultar as fotos selecionadas da sessão:', error);
      toast.error('Não foi possível consultar as fotos selecionadas desta sessão.');
      return;
    }

    if (!selectedPhotos || selectedPhotos.length === 0) {
      toast.warning(`Nenhuma foto marcada para venda na sessão de ${payload?.clientName || 'cliente'}.`, {
        description: 'Use o Modo Apresentação (aba Clientes) para selecionar as fotos antes de faturar no caixa.'
      });
      return;
    }

    // Reconstrói o pedido com o motor de precificação oficial (combos + avulsas)
    const printedCount = selectedPhotos.filter((photo: any) => photo.is_printed === true).length;
    const digitalCount = selectedPhotos.length - printedCount;

    const { data: pkgs } = await supabase.from('packages').select('*').eq('active', true);
    const pricing = calculatePricing(printedCount, digitalCount, (pkgs || []) as PackageDef[]);

    const { data: newOrder, error: insertErr } = await supabase
      .from('orders')
      .insert({
        session_id: sessionId,
        total_amount: pricing.totalAmount,
        status: 'pending',
        printed_count: printedCount,
        digital_count: digitalCount
      })
      .select(`
        *,
        photo_sessions (
          cover_photo_url,
          clients ( name, phone, cpf )
        )
      `)
      .single();

    if (insertErr || !newOrder) {
      console.error('[PDV] Erro ao abrir o pedido para faturamento imediato:', insertErr);
      toast.error('Não foi possível abrir o pedido para faturamento.');
      return;
    }

    setActiveOrder(newOrder);
    toast.success(`Pedido de ${payload?.clientName || 'cliente'} pronto para cobrança.`, {
      description: `${printedCount} impressa(s) • ${digitalCount} digital(is)`
    });

    await loadData();
  }, [loadData]);

  useEffect(() => {
    const handleAddToCart = (event: Event) => {
      const detail = (event as CustomEvent).detail as CartPresetPayload | undefined;
      const payload = consumeCartPreset() || detail || null;
      void focusSessionInCart(payload);
    };

    window.addEventListener('add-to-cart', handleAddToCart);

    // O PDV é montado sob demanda pelo App: recupera o pedido disparado enquanto ele não existia.
    const pendingPreset = consumeCartPreset();
    if (pendingPreset) void focusSessionInCart(pendingPreset);
    else void loadData();

    return () => window.removeEventListener('add-to-cart', handleAddToCart);
  }, [focusSessionInCart, loadData]);

  // Extrai o extrato financeiro inteligente do pedido ativo
  const pricingDetail = activeOrder ? calculatePricing(activeOrder.printed_count, activeOrder.digital_count, packages) : null;

  // 1. Enviar pedido para a Lojinha (Balcão) sem abrir modal bloqueante
  const handleSendToLojinha = async () => {
    if (!activeOrder) {
      toast.error("Selecione um pedido pendente.");
      return;
    }

    const toastId = toast.loading("Enviando pedido para a Lojinha...");

    const { error } = await supabase.from('orders').update({
      payment_method: 'lojinha',
      status: 'awaiting_store'
    }).eq('id', activeOrder.id);

    if (error) {
      console.error("[PDV] Erro ao registrar envio para a Lojinha:", error);
      toast.error(`Erro ao registrar envio para a Lojinha: ${error.message || 'Falha no banco de dados'}`, { id: toastId });
      return;
    }

    const clientName = activeOrder.photo_sessions?.clients?.name || 'Cliente';
    toast.success(`Pedido de ${clientName} enviado para a Lojinha!`, {
      id: toastId,
      description: "O caixa está liberado para o próximo atendimento."
    });

    setActiveOrder(null);
    await loadData();
  };

  // 2. Fluxo completo de conclusão de pagamento e entrega digital / impressão
  const executeCompleteOrder = async (order: any, method: string) => {
    if (!order) {
      toast.error("Nenhum pedido selecionado.");
      return;
    }

    const toastId = toast.loading("Processando confirmação de venda...");

    const mappedMethod = method === 'cartao' ? 'credit_card' : method;

    // 1. Confirmação do pagamento
    const { error } = await supabase.from('orders').update({
      payment_method: mappedMethod,
      status: 'paid'
    }).eq('id', order.id);

    if (error) {
      console.error("[PDV] Erro ao processar venda no banco de dados:", error);
      toast.error(`Erro ao processar venda no banco de dados: ${error.message || ''}`, { id: toastId });
      return;
    }

    await supabase.from('photo_sessions').update({ status: 'Convertido/Pago' }).eq('id', order.session_id);
    toast.success("Pagamento confirmado! O upload para o Drive iniciará em background.", { id: toastId });

    // Preserva os dados do pedido em escopo imutável antes de limpar a interface
    const currentSessionId = order.session_id;
    const currentClientName = order.photo_sessions?.clients?.name || 'Cliente';
    const currentClientCpf = order.photo_sessions?.clients?.cpf || '';
    const currentClientPhone = order.photo_sessions?.clients?.phone || '';
    const currentOrderId = order.id;
    const currentTotal = order.total_amount;
    const orderPricing = calculatePricing(order.printed_count, order.digital_count, packages);
    const currentPricingItems = orderPricing?.items || [];

    // 1.1 Se o pedido tiver fotos impressas, abre o modal de impressão imediatamente
    if (order.printed_count > 0) {
      const { data: photosToPrint } = await supabase.from('session_photos')
        .select('id, original_name, local_original_path, preview_url')
        .eq('session_id', currentSessionId)
        .eq('status', 'selected')
        .eq('is_printed', true);

      if (photosToPrint && photosToPrint.length > 0) {
        setPrintModalData({
          clientName: currentClientName,
          photos: photosToPrint
        });
        setIsPrintModalOpen(true);
      }
    }

    if (activeOrder?.id === order.id) {
      setActiveOrder(null);
    }
    loadData();

    // 2. Rotina de Upload para o Google Drive em background com Realtime Feedback
    const runBackgroundUpload = async () => {
      // Toast persistente do Sonner com spinner ativo visível de qualquer tela
      const toastUploadId = toast.loading(`Iniciando entrega digital para ${currentClientName}...`, {
        description: "Criando pasta no Google Drive...",
      });

      try {
        const { data: settings } = await supabase.from('system_settings').select('google_drive_folder_id, whatsapp_api_url, whatsapp_instance').single();

        const { data: photosToUpload, error: fetchPhotosErr } = await supabase.from('session_photos')
          .select('id, original_name, local_original_path')
          .eq('session_id', currentSessionId)
          .eq('status', 'selected');

        if (fetchPhotosErr) throw fetchPhotosErr;

        if (!photosToUpload || photosToUpload.length === 0) {
          throw new Error("Nenhuma foto selecionada para envio encontrada no banco de dados.");
        }

        if (!settings?.google_drive_folder_id) {
          throw new Error("O ID da pasta do Drive não foi configurado nas Configurações do Sistema.");
        }

        // @ts-ignore
        if (!window.electronAPI || !window.electronAPI.uploadToDrive) {
          throw new Error("A ponte de comunicação com o Electron falhou.");
        }

        // Ouvinte do progresso de cada imagem individualmente (fire-and-forget para evitar race condition)
        // @ts-ignore
        const cleanupListener = window.electronAPI.onDrivePhotoProgress ? window.electronAPI.onDrivePhotoProgress((data: any) => {
          if (data.sessionId === currentSessionId) {
            // Atualiza status da foto no banco sem bloquear o callback IPC
            supabase.from('session_photos').update({ status: 'synced', is_printed: false }).eq('id', data.photoId)
              .then(() => { })
              .catch((err: any) => console.warn('Erro ao atualizar status da foto:', err));

            // Dispara evento global de atualização em tempo real para os modais
            window.dispatchEvent(new CustomEvent('drive-photo-synced', { detail: data }));

            // Atualiza o Sonner Toast com contador e nome da foto
            toast.loading(`Enviando para o Drive (${data.current}/${data.total})`, {
              id: toastUploadId,
              description: `Enviada: ${data.fileName} (${data.percentage}%)`
            });
          }
        }) : null;

        // Dispara o upload das fotos originais em alta fidelidade
        // @ts-ignore
        const uploadRes = await window.electronAPI.uploadToDrive({
          sessionId: currentSessionId,
          clientName: currentClientName,
          clientCpf: currentClientCpf,
          photos: photosToUpload,
          parentFolderId: settings.google_drive_folder_id
        });

        if (cleanupListener) cleanupListener();

        // Sessão 100% sincronizada
        await supabase.from('photo_sessions').update({
          drive_status: 'synced',
          drive_folder_id: uploadRes.folderId
        }).eq('id', currentSessionId);

        toast.dismiss(toastUploadId);

        // Feedback de sucesso no Toast com ícone verde
        toast.success(`Entrega Digital Concluída!`, {
          description: `${photosToUpload.length} fotos salvas em alta qualidade no Google Drive.`,
          duration: 6000
        });

        // Notifica todas as telas que a sessão foi atualizada no banco
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { sessionId: currentSessionId } }));
        loadData();

        // Webhook Dinâmico para o n8n (WhatsApp) com Delay Estratégico
        if (settings?.whatsapp_api_url) {
          // Aguarda 5s para o Google Drive indexar a pasta antes de acionar o webhook
          setTimeout(() => {
            fetch(settings.whatsapp_api_url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: currentOrderId,
                clientName: currentClientName,
                clientPhone: currentClientPhone,
                clientCpf: currentClientCpf,
                total: currentTotal,
                driveLink: uploadRes.shareableLink,
                items: currentPricingItems,
                instance: settings.whatsapp_instance,
                timestamp: new Date().toISOString()
              })
            })
              .then((res) => {
                if (!res.ok) console.error(`Erro HTTP no Webhook do n8n (Status: ${res.status}) - Verifique se a URL está correta e o workflow ativo.`);
              })
              .catch((err) => console.log('Erro de Rede ao disparar Webhook:', err));
          }, 5000);
        }

      } catch (err: any) {
        console.error("Erro Crítico no Drive:", err);
        toast.error(`Falha no upload para o Drive: ${err.message || 'Erro inesperado'}`, {
          id: toastUploadId,
          duration: 8000
        });

        await supabase.from('photo_sessions').update({ drive_status: 'error' }).eq('id', currentSessionId);
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { sessionId: currentSessionId } }));
        loadData();
      }
    };

    runBackgroundUpload();
  };

  const handleCheckout = async (method: string) => {
    if (!activeOrder) {
      toast.error("Selecione um pedido pendente.");
      return;
    }
    await executeCompleteOrder(activeOrder, method);
  };

  const handleDeletePending = async (orderId: string) => {
    await supabase.from('orders').delete().eq('id', orderId);
    if (activeOrder?.id === orderId) setActiveOrder(null);
    loadData();
  };

  return (
    <div className="grid grid-cols-12 gap-4 xl:gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out h-full overflow-hidden pt-2">

      {/* Esquerda: Pedidos Pendentes */}
      <Card className="col-span-7 xl:col-span-8 flex flex-col h-full overflow-hidden shadow-sm border-transparent bg-transparent">
        <CardHeader className="px-0 pt-0 shrink-0">
          <CardTitle className="text-xl xl:text-2xl font-semibold text-foreground">Pedidos Pendentes</CardTitle>
          <p className="text-muted-foreground text-xs xl:text-sm mt-1">Selecione o pedido organizado pela vitrine para realizar a cobrança.</p>
        </CardHeader>

        <CardContent className="flex-1 px-0 pb-6 overflow-y-auto no-scrollbar pr-2 space-y-4">
          {pendingOrders.map(order => {
            const isSelected = activeOrder?.id === order.id;
            const isAwaitingStore = order.status === 'awaiting_store';

            return (
              <Card
                key={order.id}
                className={`border transition-lux overflow-hidden flex items-center p-4 gap-4 cursor-pointer dark:backdrop-blur-xl hover:shadow-md hover:-translate-y-px ${
                  isAwaitingStore
                    ? 'border-amber-500 bg-amber-500/10 text-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.18)] ring-1 ring-amber-500/40 hover:border-amber-400'
                    : isSelected
                      ? 'border-primary shadow-md gold-glow ring-1 ring-primary dark:border-brand-accent/60 bg-card dark:bg-white/[0.03]'
                      : 'border-border dark:border-white/10 hover:border-primary/40 bg-card dark:bg-white/[0.03]'
                }`}
                onClick={() => !isSelected && setActiveOrder(order)}
              >
                <div className={`w-16 h-16 rounded-xl overflow-hidden bg-muted shrink-0 shadow-sm ${
                  isAwaitingStore ? 'ring-2 ring-amber-500/50' : 'ring-1 ring-black/5 dark:ring-white/15'
                }`}>
                  {order.photo_sessions?.cover_photo_url ? (
                    <img src={order.photo_sessions.cover_photo_url.replace(/\\/g, '/')} alt="Cover" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className={`w-6 h-6 ${isAwaitingStore ? 'text-amber-500' : 'text-muted-foreground'}`} />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {isAwaitingStore && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] xl:text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 mb-1.5 animate-pulse">
                      <Store className="w-3 h-3" />
                      Aguardando Pagamento na Lojinha
                    </div>
                  )}
                  <h3 className="text-base font-bold text-foreground truncate">
                    {order.photo_sessions?.clients?.name || 'Cliente Desconhecido'}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Itens do Pedido</p>
                  <p className="text-sm font-medium mt-0.5 font-mono tabular-figures text-foreground/90">
                    {order.printed_count} Impressas • {order.digital_count} Digitais
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2.5 shrink-0">
                  <span className={`text-lg font-bold font-mono tabular-figures ${
                    isAwaitingStore ? 'text-amber-400 font-extrabold' : 'text-foreground'
                  }`}>
                    R$ {Number(order.total_amount).toFixed(2).replace('.', ',')}
                  </span>

                  {isAwaitingStore ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        executeCompleteOrder(order, 'lojinha');
                      }}
                      className="px-3.5 py-2 rounded-xl font-bold transition-lux text-xs shadow-md flex items-center gap-1.5 active:scale-95 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <Check className="w-4 h-4" />
                      Confirmar Pago
                    </button>
                  ) : (
                    <button
                      disabled={isSelected}
                      className={`px-4 py-2 rounded-xl font-bold transition-lux text-xs shadow-sm flex items-center gap-1.5 active:scale-95 ${
                        isSelected
                          ? 'bg-muted text-muted-foreground cursor-not-allowed border border-border'
                          : 'bg-primary text-primary-foreground hover:opacity-90 gold-glow'
                      }`}
                    >
                      {isSelected ? <Check className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                      {isSelected ? 'No Carrinho' : 'Atender Cliente'}
                    </button>
                  )}
                </div>
              </Card>
            );
          })}

          {pendingOrders.length === 0 && (
            <div className="py-12 text-center flex flex-col items-center">
              <ShoppingCart className="w-12 h-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground text-sm font-medium">A fila está vazia</p>
              <p className="text-muted-foreground text-xs mt-1">Os pedidos da vitrine aparecerão automaticamente aqui.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Direita: Carrinho */}
      <div className="col-span-5 xl:col-span-4 h-full pb-4 xl:pb-6">
        <Card className="flex flex-col h-full rounded-[2rem] border-border dark:border-white/10 dark:bg-white/[0.04] dark:backdrop-blur-xl dark:lux-top-highlight shadow-sm lux-card overflow-hidden transition-lux">

          <CardHeader className="p-4 xl:p-6 border-b border-border-dashed shrink-0 space-y-3 xl:space-y-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg xl:text-xl font-semibold text-foreground flex items-center gap-2">
                <ShoppingCart className="h-4 w-4 xl:h-5 xl:w-5" />
                Pedido Atual
              </CardTitle>
            </div>
          </CardHeader>

          <CardContent className="flex-1 p-4 xl:p-6 overflow-y-auto no-scrollbar space-y-4 xl:space-y-5 bg-transparent">
            {!activeOrder ? (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                <ShoppingCart className="h-10 w-10 xl:h-12 xl:w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground text-xs xl:text-sm max-w-[200px]">Selecione um pedido pendente para realizar a cobrança.</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-bold">{activeOrder.photo_sessions?.clients?.name || 'Cliente'}</h2>
                    <p className="text-xs text-muted-foreground mt-1">REQ: {activeOrder.id.split('-')[0].toUpperCase()}</p>
                  </div>
                  <button
                    onClick={() => handleDeletePending(activeOrder.id)}
                    className="p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-full transition-colors"
                    title="Cancelar Pedido"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3 border-b border-border pb-2">Resumo da Compra</h3>

                  <div className="space-y-3">
                    {pricingDetail?.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-secondary/20 dark:bg-white/[0.04] p-3 rounded-xl border border-border dark:border-white/10 transition-lux hover:border-primary/30">
                        <div>
                          <p className="font-medium text-sm text-brand-ink">{item.name}</p>
                          <p className="text-xs text-brand-muted mt-0.5 font-mono tabular-figures">
                            {item.quantity}x de R$ {item.unitPrice.toFixed(2).replace('.', ',')}
                          </p>
                        </div>
                        <span className="font-mono tabular-figures font-bold">R$ {item.subtotal.toFixed(2).replace('.', ',')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>

          <div className="p-4 xl:p-5 bg-secondary/30 dark:bg-white/[0.03] dark:backdrop-blur-xl border-t border-border-dashed dark:border-white/10 shrink-0">
            <div className="space-y-2 mb-3 xl:mb-4">
              <div className="flex justify-between items-end pt-3 border-t border-border-dashed dark:border-white/10 mt-2">
                <span className="text-sm xl:text-base font-semibold text-foreground">Total a Cobrar</span>
                <span className="text-2xl xl:text-3xl font-bold text-primary font-mono tabular-figures tracking-tight dark:drop-shadow-[0_0_14px_rgba(217,164,92,0.45)]">
                  R$ {activeOrder ? Number(activeOrder.total_amount).toFixed(2).replace('.', ',') : '0,00'}
                </span>
              </div>
            </div>

            <div className="mb-3 xl:mb-4">
              <p className="text-[10px] xl:text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 xl:mb-2">Terminal de Pagamento</p>
              <Select value={selectedTerminal} onValueChange={setSelectedTerminal}>
                <SelectTrigger className="w-full bg-background border-border h-9 xl:h-11 text-xs xl:text-sm">
                  <SelectValue placeholder="Selecione a maquininha" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Via Lojinha (Balcão)" className="text-xs xl:text-sm font-semibold text-amber-500">
                    Via Lojinha (Balcão)
                  </SelectItem>
                  <SelectItem value="Smart POS Stone" className="text-xs xl:text-sm">Smart POS Stone</SelectItem>
                  <SelectItem value="Mercado Pago Point" className="text-xs xl:text-sm">Mercado Pago Point</SelectItem>
                  <SelectItem value="PagSeguro" className="text-xs xl:text-sm">PagSeguro</SelectItem>
                </SelectContent>
              </Select>
              {selectedTerminal === "Via Lojinha (Balcão)" ? (
                <div className="flex items-center gap-2 mt-2 ml-1">
                  <div className="w-1.5 h-1.5 xl:w-2 xl:h-2 rounded-full bg-amber-500 animate-pulse"></div>
                  <span className="text-[10px] xl:text-xs text-amber-500 font-medium">Cobrança no caixa da lojinha física</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-2 ml-1">
                  <div className="w-1.5 h-1.5 xl:w-2 xl:h-2 rounded-full bg-emerald-500"></div>
                  <span className="text-[10px] xl:text-xs text-muted-foreground">Cobrança Externa (Maquininha Física)</span>
                </div>
              )}
            </div>

            {selectedTerminal === "Via Lojinha (Balcão)" ? (
              <div>
                {activeOrder?.status === 'awaiting_store' ? (
                  <button
                    onClick={() => executeCompleteOrder(activeOrder, 'lojinha')}
                    disabled={!activeOrder}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-3 rounded-xl font-bold transition-lux active:scale-[0.98] text-xs xl:text-sm shadow-md"
                  >
                    <Check className="h-4 w-4" />
                    Confirmar Pagamento Recebido (Lojinha)
                  </button>
                ) : (
                  <button
                    onClick={handleSendToLojinha}
                    disabled={!activeOrder}
                    className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:opacity-50 text-slate-950 font-bold px-4 py-3 rounded-xl transition-lux active:scale-[0.98] text-xs xl:text-sm shadow-lg shadow-amber-500/20"
                  >
                    <Store className="h-4 w-4 text-slate-950" />
                    Efetuar Pagamento (Enviar p/ Lojinha)
                  </button>
                )}
              </div>
            ) : (
              <div>
                <button
                  onClick={() => handleCheckout('pix')}
                  disabled={!activeOrder}
                  className="w-full mb-1.5 xl:mb-2 flex items-center justify-center gap-2 bg-primary hover:opacity-90 disabled:opacity-50 disabled:shadow-none text-primary-foreground px-4 py-2.5 xl:py-3 rounded-xl font-bold transition-lux active:scale-[0.98] text-xs xl:text-sm shadow-sm gold-glow"
                >
                  <QrCode className="h-3.5 w-3.5 xl:h-4 xl:w-4" />
                  Pagar com Pix
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleCheckout('cartao')}
                    disabled={!activeOrder}
                    className="flex items-center justify-center gap-1.5 xl:gap-2 bg-card dark:bg-white/[0.05] hover:bg-background dark:hover:bg-white/[0.09] disabled:opacity-50 border border-border dark:border-white/10 text-foreground px-3 xl:px-4 py-2 xl:py-2.5 rounded-xl font-medium transition-lux active:scale-[0.98] text-[10px] xl:text-xs shadow-sm"
                  >
                    <CreditCard className="h-3.5 w-3.5 xl:h-4 xl:w-4" />
                    Cartão
                  </button>
                  <button
                    onClick={() => handleCheckout('dinheiro')}
                    disabled={!activeOrder}
                    className="flex items-center justify-center gap-1.5 xl:gap-2 bg-card dark:bg-white/[0.05] hover:bg-background dark:hover:bg-white/[0.09] disabled:opacity-50 border border-border dark:border-white/10 text-foreground px-3 xl:px-4 py-2 xl:py-2.5 rounded-xl font-medium transition-lux active:scale-[0.98] text-[10px] xl:text-xs shadow-sm"
                  >
                    <Banknote className="h-3.5 w-3.5 xl:h-4 xl:w-4" />
                    Dinheiro
                  </button>
                </div>
              </div>
            )}
          </div>

        </Card>
      </div>

      <PrintOrderModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        clientName={printModalData.clientName}
        photos={printModalData.photos}
      />
    </div>
  );
}
