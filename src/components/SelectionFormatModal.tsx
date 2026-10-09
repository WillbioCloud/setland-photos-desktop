import { useState, useEffect } from "react";
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
        initialFormats[id] = 'print_and_digital'; // Padrão: Impressa + Digital Inclusa
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
      const { data: pkgs } = await supabase.from('packages').select('*').eq('active', true);
      
      const pricing = calculatePricing(totalPrinted, totalDigitalOnly, (pkgs || []) as PackageDef[]);

      // 1. Marca as fotos escolhidas e define quem vai para a impressora
      const printedIds = selectedPhotos
        .filter(p => (formats[p.id] || 'print_and_digital') === 'print_and_digital')
        .map(p => p.id);
      const digitalOnlyIds = selectedPhotos
        .filter(p => formats[p.id] === 'digital_only')
        .map(p => p.id);
      
      // Reseta seleções pendentes anteriores da sessão e flags antigas de impressão
      await supabase.from('session_photos')
        .update({ status: 'pending', is_printed: false })
        .eq('session_id', sessionId)
        .eq('status', 'selected');

      await supabase.from('session_photos')
        .update({ is_printed: false })
        .eq('session_id', sessionId)
        .eq('is_printed', true);

      // Marca fotos impressas
      if (printedIds.length > 0) {
        const { error: printedErr } = await supabase.from('session_photos')
          .update({ status: 'selected', is_printed: true })
          .in('id', printedIds);
        
        if (printedErr) {
          console.error("Erro ao atualizar fotos impressas:", printedErr);
          throw new Error("Falha ao registrar seleção das fotos no banco.");
        }
      }

      // Marca fotos apenas digitais
      if (digitalOnlyIds.length > 0) {
        const { error: digitalErr } = await supabase.from('session_photos')
          .update({ status: 'selected', is_printed: false })
          .in('id', digitalOnlyIds);

        if (digitalErr) {
          console.error("Erro ao atualizar fotos digitais:", digitalErr);
          throw new Error("Falha ao registrar seleção das fotos no banco.");
        }
      }

      // 2. Grava a ordem de compra
      const { error } = await supabase.from('orders').insert({
        session_id: sessionId,
        total_amount: pricing.totalAmount,
        status: 'pending',
        printed_count: totalPrinted,
        digital_count: totalDigitalOnly
      });

      if (error) throw error;

      toast.success(`${totalPrinted} Impressas e ${totalDigitalOnly} Digitais enviadas!`, { id: toastId });
      window.dispatchEvent(new CustomEvent('add-to-cart'));
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
            <h2 className="text-2xl font-bold text-brand-ink">Definir Formatos</h2>
            <p className="text-brand-muted mt-1">
              Selecione quais fotos serão impressas e quais serão apenas digitais para {clientName}.
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
              const photoFormat = formats[photo.id] || 'print_and_digital';
              const isPrinted = photoFormat === 'print_and_digital';

              return (
                <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-brand-bg border border-brand-border shadow-sm group">
                  <img 
                    src={photo.url} 
                    alt="Foto Selecionada" 
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />

                  {/* Badges permanentes (Visíveis sem hover) */}
                  <div className="absolute top-2 left-2 flex flex-col gap-1.5 transition-opacity duration-300 group-hover:opacity-0 pointer-events-none">
                    {isPrinted ? (
                      <div className="bg-emerald-500/95 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm font-medium border border-emerald-400/20">
                        <Printer className="w-3.5 h-3.5" /> Impressa + Digital
                      </div>
                    ) : (
                      <div className="bg-blue-500/95 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm font-medium border border-blue-400/20">
                        <Smartphone className="w-3.5 h-3.5" /> Somente Digital
                      </div>
                    )}
                  </div>

                  {/* Overlay interativo no Hover */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center gap-3 p-4">
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
                    
                    <button
                      onClick={() => toggleFormat(photo.id, 'digital_only')}
                      className={`w-full py-2.5 px-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-all duration-200 ${
                        !isPrinted 
                          ? 'bg-blue-500 text-white shadow-lg scale-105' 
                          : 'bg-white/20 text-white hover:bg-white/30'
                      }`}
                    >
                      <Smartphone className="w-4 h-4" /> Somente Digital
                    </button>
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
              {Object.values(formats).filter(f => f === 'print_and_digital').length} Impressas (+Digital) | {Object.values(formats).filter(f => f === 'digital_only').length} Apenas Digitais
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
