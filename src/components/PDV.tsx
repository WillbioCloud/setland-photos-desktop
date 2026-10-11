import React, { useState, useEffect } from 'react';
import { Camera, QrCode, CreditCard, Banknote, ShoppingCart, Trash2, ArrowRight, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import PrintOrderModal from './PrintOrderModal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from "sonner";
import { supabase } from '@/lib/supabaseClient';
import { calculatePricing, type PackageDef } from '@/lib/pricingEngine';

export default function PDV() {
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [packages, setPackages] = useState<PackageDef[]>([]);
  const [activeOrder, setActiveOrder] = useState<any | null>(null);
  const [selectedTerminal, setSelectedTerminal] = useState("Smart POS Stone");
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printModalData, setPrintModalData] = useState<{ clientName: string; photos: any[] }>({ clientName: '', photos: [] });

  const loadData = async () => {
    // 1. Busca os pedidos pendentes
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
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (ordersData) setPendingOrders(ordersData);

    // 2. Busca os pacotes para o Motor de Precificação reconstruir o extrato
    const { data: pkgsData } = await supabase.from('packages').select('*').eq('active', true);
    if (pkgsData) setPackages(pkgsData as PackageDef[]);
  };

  useEffect(() => {
    loadData();
    const handleAddToCart = () => loadData();
    window.addEventListener('add-to-cart', handleAddToCart);
    return () => window.removeEventListener('add-to-cart', handleAddToCart);
  }, []);

  // Extrai o extrato financeiro inteligente do pedido ativo
  const pricingDetail = activeOrder ? calculatePricing(activeOrder.printed_count, activeOrder.digital_count, packages) : null;

  const handleCheckout = async (method: string) => {
    if (!activeOrder) {
      toast.error("Selecione um pedido pendente.");
      return;
    }

    const toastId = toast.loading("Processando venda no balcão...");

    const mappedMethod = method === 'cartao' ? 'credit_card' : method;

    // 1. Confirmação do pagamento
    const { error } = await supabase.from('orders').update({
      payment_method: mappedMethod,
      status: 'paid'
    }).eq('id', activeOrder.id);

    if (error) {
      toast.error("Erro ao processar venda no banco de dados.", { id: toastId });
      return;
    }

    await supabase.from('photo_sessions').update({ status: 'Convertido/Pago' }).eq('id', activeOrder.session_id);
    toast.success("Pagamento confirmado! O upload para o Drive iniciará em background.", { id: toastId });

    // Preserva os dados do pedido em escopo imutável antes de limpar a interface
    const currentSessionId = activeOrder.session_id;
    const currentClientName = activeOrder.photo_sessions?.clients?.name || 'Cliente';
    const currentClientCpf = activeOrder.photo_sessions?.clients?.cpf || '';
    const currentClientPhone = activeOrder.photo_sessions?.clients?.phone || '';
    const currentOrderId = activeOrder.id;
    const currentTotal = activeOrder.total_amount;
    const currentPricingItems = pricingDetail?.items || [];

    // 1.1 Se o pedido tiver fotos impressas, abre o modal de impressão imediatamente
    if (activeOrder.printed_count > 0) {
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

    setActiveOrder(null);
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
            return (
              <Card
                key={order.id}
                className={`border transition-lux overflow-hidden flex items-center p-4 gap-4 cursor-pointer bg-card dark:bg-white/[0.03] dark:backdrop-blur-xl hover:shadow-md hover:-translate-y-px ${isSelected ? 'border-primary shadow-md gold-glow ring-1 ring-primary dark:border-brand-accent/60' : 'border-border dark:border-white/10 hover:border-primary/40'}`}
                onClick={() => !isSelected && setActiveOrder(order)}
              >
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-muted shrink-0 ring-1 ring-black/5 dark:ring-white/15 shadow-sm">
                  {order.photo_sessions?.cover_photo_url ? (
                    <img src={order.photo_sessions.cover_photo_url.replace(/\\/g, '/')} alt="Cover" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Camera className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <h3 className="text-base font-bold text-foreground">
                    {order.photo_sessions?.clients?.name || 'Cliente Desconhecido'}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Itens do Pedido</p>
                  <p className="text-sm font-medium mt-1 font-mono tabular-figures">
                    {order.printed_count} Impressas • {order.digital_count} Digitais
                  </p>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <span className="text-lg font-bold text-foreground font-mono tabular-figures">
                    R$ {Number(order.total_amount).toFixed(2).replace('.', ',')}
                  </span>

                  <button
                    disabled={isSelected}
                    className={`px-4 py-2 rounded-xl font-bold transition-lux text-xs shadow-sm flex items-center gap-1.5 active:scale-95 ${isSelected ? 'bg-muted text-muted-foreground cursor-not-allowed border border-border' : 'bg-primary text-primary-foreground hover:opacity-90 gold-glow'}`}
                  >
                    {isSelected ? <Check className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                    {isSelected ? 'No Carrinho' : 'Atender Cliente'}
                  </button>
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
                  <SelectItem value="Smart POS Stone" className="text-xs xl:text-sm">Smart POS Stone</SelectItem>
                  <SelectItem value="Mercado Pago Point" className="text-xs xl:text-sm">Mercado Pago Point</SelectItem>
                  <SelectItem value="PagSeguro" className="text-xs xl:text-sm">PagSeguro</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 mt-2 ml-1">
                <div className="w-1.5 h-1.5 xl:w-2 xl:h-2 rounded-full bg-emerald-500"></div>
                <span className="text-[10px] xl:text-xs text-muted-foreground">Cobrança Externa (Maquininha Física)</span>
              </div>
            </div>

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
