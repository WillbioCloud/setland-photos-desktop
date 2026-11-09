import React, { useState, useEffect } from 'react';
import { X, Smartphone, Printer, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from "sonner";
import { supabase } from '@/lib/supabaseClient';
import { calculatePricing, type PackageDef } from '@/lib/pricingEngine';

interface SelectionFormatModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: any[];
  selectedPhotoIds: (string | number)[];
  clientName: string;
  sessionId: string;
}

type PhotoFormat = 'print_and_digital' | 'digital_only';

export default function SelectionFormatModal({
  isOpen,
  onClose,
  photos,
  selectedPhotoIds,
  clientName,
  sessionId
}: SelectionFormatModalProps) {
  const [formats, setFormats] = useState<Record<string | number, PhotoFormat>>({});

  // Inicializa o estado quando o modal abre com as fotos selecionadas
  useEffect(() => {
    if (isOpen) {
      const initialFormats: Record<string | number, PhotoFormat> = {};
      selectedPhotoIds.forEach(id => {
        // NOTA: O Castelo Setland descontinuou a venda de fotos impressas.
        // Todas as fotos agora entram como 'digital_only'.
        // Para reativar a foto impressa no futuro, basta alterar o valor inicial para 'print_and_digital'.
        initialFormats[id] = 'digital_only';
      });
      setFormats(initialFormats);
    }
  }, [isOpen, selectedPhotoIds]);

  if (!isOpen) return null;

  const selectedPhotos = photos.filter(p => selectedPhotoIds.includes(p.id));

  const toggleFormat = (id: string | number, type: PhotoFormat) => {
    setFormats(prev => ({
      ...prev,
      [id]: type
    }));
  };

  const handleSendToCart = async () => {
    // Ignora fotos que já foram pagas/sincronizadas anteriormente para NUNCA cobrar duas vezes
    const validSelectedPhotos = selectedPhotos.filter(
      (p: any) => p.status !== 'synced' && !p.isPurchased && !p.is_purchased
    );

    if (validSelectedPhotos.length === 0) {
      toast.error("As fotos selecionadas já foram compradas anteriormente.");
      return;
    }

    const toastId = toast.loading("Enviando para o Frente de Caixa...");

    try {
      const { data: pkgs } = await supabase.from('packages').select('*').eq('active', true);
      const activePackages = (pkgs || []) as PackageDef[];

      // 1. Verifica se existe um pedido ABERTO (ainda NÃO pago: 'pending' ou 'awaiting_store') para esta sessão
      const { data: openOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('session_id', sessionId)
        .in('status', ['pending', 'awaiting_store'])
        .order('created_at', { ascending: false });

      const existingOpenOrder = openOrders && openOrders.length > 0 ? openOrders[0] : null;

      // IMPORTANTE: Se NÃO existe nenhum pedido aberto (ex: pedidos anteriores já foram 'paid' ou 'canceled'),
      // limpamos qualquer foto que tenha ficado com status 'selected' órfã de testes anteriores (e que não está na seleção atual)
      if (!existingOpenOrder) {
        await supabase
          .from('session_photos')
          .update({ status: 'pending', is_printed: false, is_purchased: false })
          .eq('session_id', sessionId)
          .eq('status', 'selected');
      }

      // 2. Separa as fotos da seleção atual entre Impressas e Digitais
      const printedIds = validSelectedPhotos
        .filter((p) => (formats[p.id] || 'print_and_digital') === 'print_and_digital')
        .map((p) => p.id);

      const digitalOnlyIds = validSelectedPhotos
        .filter((p) => formats[p.id] === 'digital_only')
        .map((p) => p.id);

      // ATENÇÃO: is_purchased DEVE ser FALSE aqui! Só vira TRUE quando pagar no PDV!
      if (printedIds.length > 0) {
        const { error: printedErr } = await supabase
          .from('session_photos')
          .update({ status: 'selected', is_printed: true, is_purchased: false })
          .in('id', printedIds);
        if (printedErr) throw new Error("Falha ao registrar seleção das fotos impressas.");
      }

      if (digitalOnlyIds.length > 0) {
        const { error: digitalErr } = await supabase
          .from('session_photos')
          .update({ status: 'selected', is_printed: false, is_purchased: false })
          .in('id', digitalOnlyIds);
        if (digitalErr) throw new Error("Falha ao registrar seleção das fotos digitais.");
      }

      // 3. Consulta APENAS as fotos que estão no carrinho atual (`status = 'selected'`)
      // Fotos de compras passadas que já foram pagas estão como `status = 'synced'` e NÃO entram nesta conta!
      const { data: currentCartPhotos, error: cartErr } = await supabase
        .from('session_photos')
        .select('id, is_printed')
        .eq('session_id', sessionId)
        .eq('status', 'selected');

      if (cartErr) throw cartErr;

      const cartPrintedCount = (currentCartPhotos || []).filter((p: any) => p.is_printed === true).length;
      const cartDigitalCount = (currentCartPhotos || []).length - cartPrintedCount;

      const pricing = calculatePricing(cartPrintedCount, cartDigitalCount, activePackages);

      // 4. Se havia um pedido ABERTO (ainda não pago), atualiza ele somando as fotos do carrinho.
      // Se o pedido anterior já estava PAGO ('paid'), existingOpenOrder é null, então cria um NOVO pedido só com a foto nova!
      if (existingOpenOrder) {
        const { error: updateOrderErr } = await supabase
          .from('orders')
          .update({
            total_amount: pricing.totalAmount,
            printed_count: cartPrintedCount,
            digital_count: cartDigitalCount,
          })
          .eq('id', existingOpenOrder.id);

        if (updateOrderErr) throw updateOrderErr;

        // Se havia pedidos duplicados pendentes antigos na mesma sessão, remove as duplicatas
        if (openOrders && openOrders.length > 1) {
          const duplicateIds = openOrders.slice(1).map((o: any) => o.id);
          await supabase.from('orders').delete().in('id', duplicateIds);
        }

        toast.success(`Pedido atualizado no caixa: ${cartPrintedCount} Impressa(s) e ${cartDigitalCount} Digital(is)!`, { id: toastId });
      } else {
        const { error: insertOrderErr } = await supabase
          .from('orders')
          .insert({
            session_id: sessionId,
            total_amount: pricing.totalAmount,
            status: 'pending',
            printed_count: cartPrintedCount,
            digital_count: cartDigitalCount,
          });

        if (insertOrderErr) throw insertOrderErr;

        toast.success(`Novo pedido enviado ao caixa: ${cartPrintedCount} Impressa(s) e ${cartDigitalCount} Digital(is)!`, { id: toastId });
      }

      window.dispatchEvent(new CustomEvent('session-updated', { detail: { sessionId } }));
      window.dispatchEvent(new CustomEvent('add-to-cart', { detail: { sessionId, clientName } }));
      onClose();
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Erro ao gerar pedido no banco de dados.", { id: toastId });
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-5xl bg-brand-surface rounded-[2rem] border border-brand-border p-8 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between mb-8 pr-8">
          <div>
            <h2 className="text-2xl font-bold text-brand-ink">Confirmar Seleção Digital</h2>
            <p className="text-brand-muted mt-1">
              Confirme as fotos selecionadas para envio digital de {clientName}.
            </p>
          </div>
          <button 
            onClick={onClose}
            className="absolute right-6 top-6 p-2 rounded-full text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Grid de Fotos */}
        <div className="flex-1 overflow-y-auto pr-2 no-scrollbar mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {selectedPhotos.map(photo => {
              const photoFormat = formats[photo.id] || 'digital_only';
              const isPrinted = photoFormat === 'print_and_digital';

              return (
                <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-brand-bg border border-brand-border shadow-sm group">
                  <img 
                    src={photo.url} 
                    alt="Foto Selecionada" 
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Badges permanentes (Visíveis sem hover) */}
                  <div className="absolute top-2 left-2 flex flex-col gap-1.5 transition-opacity duration-300 pointer-events-none">
                    {/* NOTA: Caso o Castelo volte a vender fotos impressas, descomente o bloco abaixo:
                    {isPrinted ? (
                      <div className="bg-emerald-500/95 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm font-medium border border-emerald-400/20">
                        <Printer className="w-3.5 h-3.5" /> Impressa + Digital
                      </div>
                    ) : (
                      <div className="bg-blue-500/95 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm font-medium border border-blue-400/20">
                        <Smartphone className="w-3.5 h-3.5" /> Somente Digital
                      </div>
                    )}
                    */}
                    <div className="bg-blue-500/95 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm font-medium border border-blue-400/20">
                      <Smartphone className="w-3.5 h-3.5" /> Entrega Digital
                    </div>
                  </div>

                  {/* Overlay interativo no Hover */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-3 p-4">
                    {/* 
                      OPÇÃO IMPRESSA DESATIVADA TEMPORARIAMENTE:
                      O Castelo Setland descontinuou a venda de fotos impressas. 
                      Para reativar a opção impressa no futuro, basta descomentar o botão abaixo:
                      
                      <button
                        onClick={() => toggleFormat(photo.id, 'print_and_digital')}
                        className={`w-full py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all duration-200 ${
                          isPrinted 
                            ? 'bg-emerald-500 text-white shadow-lg scale-105' 
                            : 'bg-white/20 text-white hover:bg-white/30'
                        }`}
                      >
                        <Printer className="w-4 h-4" /> Impressa (+Digital)
                      </button>
                    */}
                    
                    <div className="w-full py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium bg-blue-500 text-white shadow-lg">
                      <Smartphone className="w-4 h-4" /> Somente Digital
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-6 border-t border-brand-border flex items-center justify-between">
          <div className="text-sm text-brand-muted flex flex-col gap-1">
            <span>
              Total selecionado: <span className="font-semibold text-brand-ink">{selectedPhotos.length} fotos</span>
            </span>
            <span className="text-xs">
              {/* Para reativar texto com impressas no futuro:
                  {Object.values(formats).filter(f => f === 'print_and_digital').length} Impressas (+Digital) | 
              */}
              {Object.values(formats).filter(f => f === 'digital_only').length} Foto(s) Digital(is)
            </span>
          </div>
          
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="rounded-full">
              Cancelar
            </Button>
            <Button 
              onClick={handleSendToCart}
              className="rounded-full shadow-sm bg-brand-ink text-brand-surface hover:bg-brand-ink/90 border-transparent"
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              Enviar para Caixa
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
