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
    let totalPrinted = 0;
    let totalDigitalOnly = 0;

    Object.values(formats).forEach(format => {
      if (format === 'print_and_digital') totalPrinted++;
      if (format === 'digital_only') totalDigitalOnly++;
    });

    if (totalPrinted === 0 && totalDigitalOnly === 0) {
      toast.error("Nenhum formato selecionado para as fotos.");
      return;
    }

    const toastId = toast.loading("Enviando para o Frente de Caixa...");

    try {
      // 1. Atualiza de forma cumulativa APENAS as novas fotos selecionadas no modal
      const printedIds = selectedPhotos
        .filter(p => (formats[p.id] || 'print_and_digital') === 'print_and_digital')
        .map(p => p.id);
      const digitalOnlyIds = selectedPhotos
        .filter(p => formats[p.id] === 'digital_only')
        .map(p => p.id);

      if (printedIds.length > 0) {
        const { error: printedErr } = await supabase.from('session_photos')
          .update({ status: 'selected', is_printed: true, is_purchased: true })
          .in('id', printedIds);
        
        if (printedErr) {
          console.error("Erro ao atualizar fotos impressas:", printedErr);
          throw new Error("Falha ao registrar fotos impressas no banco.");
        }
      }

      if (digitalOnlyIds.length > 0) {
        const { error: digitalErr } = await supabase.from('session_photos')
          .update({ status: 'selected', is_printed: false, is_purchased: true })
          .in('id', digitalOnlyIds);

        if (digitalErr) {
          console.error("Erro ao atualizar fotos digitais:", digitalErr);
          throw new Error("Falha ao registrar fotos digitais no banco.");
        }
      }

      // 2. Consulta TODAS as fotos que já pertencem à compra da sessão (acumuladas)
      const { data: allPurchasedPhotos, error: fetchErr } = await supabase.from('session_photos')
        .select('id, is_printed, status')
        .eq('session_id', sessionId)
        .in('status', ['selected', 'synced']);

      if (fetchErr) throw fetchErr;

      const allPrintedCount = (allPurchasedPhotos || []).filter(p => p.is_printed === true).length;
      const allDigitalCount = (allPurchasedPhotos || []).filter(p => !p.is_printed).length;

      // 3. Recalcula a precificação total acumulada da sessão
      const { data: pkgs } = await supabase.from('packages').select('*').eq('active', true);
      const pricing = calculatePricing(allPrintedCount, allDigitalCount, (pkgs || []) as PackageDef[]);

      // 4. Verifica se já existe um pedido para esta sessão (evita duplicar cards no PDV)
      const { data: existingOrder } = await supabase.from('orders')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingOrder) {
        if (['pending', 'awaiting_store'].includes(existingOrder.status)) {
          // Caso 1: Pedido ainda não pago -> atualiza totais unificados no mesmo pedido
          const { error: updateErr } = await supabase.from('orders').update({
            total_amount: pricing.totalAmount,
            printed_count: allPrintedCount,
            digital_count: allDigitalCount
          }).eq('id', existingOrder.id);

          if (updateErr) throw updateErr;
        } else if (existingOrder.status === 'paid') {
          // Caso 2: Cliente comprou fotos adicionais após o pagamento inicial
          // Reabre o pedido existente para cobrança no caixa mantendo a mesma referência de sessão e Drive
          const { error: updateErr } = await supabase.from('orders').update({
            total_amount: pricing.totalAmount,
            printed_count: allPrintedCount,
            digital_count: allDigitalCount,
            status: 'pending'
          }).eq('id', existingOrder.id);

          if (updateErr) throw updateErr;
        } else {
          // Caso 3: Status cancelado ou outro -> insere novo
          const { error: insertErr } = await supabase.from('orders').insert({
            session_id: sessionId,
            total_amount: pricing.totalAmount,
            status: 'pending',
            printed_count: allPrintedCount,
            digital_count: allDigitalCount
          });

          if (insertErr) throw insertErr;
        }
      } else {
        // Caso 4: Primeiro pedido da sessão
        const { error: insertErr } = await supabase.from('orders').insert({
          session_id: sessionId,
          total_amount: pricing.totalAmount,
          status: 'pending',
          printed_count: allPrintedCount,
          digital_count: allDigitalCount
        });

        if (insertErr) throw insertErr;
      }

      if (totalPrinted > 0) {
        toast.success(`${totalPrinted} Impressa(s) e ${totalDigitalOnly} Digital(is) unificada(s) no caixa!`, { id: toastId });
      } else {
        toast.success(`${totalDigitalOnly} foto(s) digital(is) unificada(s) no caixa!`, { id: toastId });
      }
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
