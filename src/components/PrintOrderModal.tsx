import React, { useState, useEffect } from 'react';
import { X, Printer, CheckCircle2, RotateCw, CheckSquare, Square, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface PrintPhotoItem {
  id: string | number;
  original_name: string;
  local_original_path?: string;
  preview_url?: string;
}

interface PrintOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  photos: PrintPhotoItem[];
}

export default function PrintOrderModal({ isOpen, onClose, clientName, photos }: PrintOrderModalProps) {
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<(string | number)[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);

  // Inicializa com todas as fotos impressas marcadas por padrão
  useEffect(() => {
    if (isOpen && photos) {
      setSelectedPhotoIds(photos.map(p => p.id));
      setIsPrinting(false);
    }
  }, [isOpen, photos]);

  if (!isOpen) return null;

  const toggleSelectPhoto = (id: string | number) => {
    if (isPrinting) return;
    setSelectedPhotoIds(prev => 
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (isPrinting) return;
    if (selectedPhotoIds.length === photos.length) {
      setSelectedPhotoIds([]);
    } else {
      setSelectedPhotoIds(photos.map(p => p.id));
    }
  };

  const handlePrintQueue = async () => {
    if (selectedPhotoIds.length === 0) {
      toast.error("Nenhuma foto selecionada para impressão.");
      return;
    }

    const photosToPrint = photos.filter(p => selectedPhotoIds.includes(p.id));
    setIsPrinting(true);
    const toastId = toast.loading(`Enviando ${photosToPrint.length} foto(s) para o driver térmico...`);

    try {
      // @ts-ignore
      if (window.electronAPI && window.electronAPI.printPhotos) {
        // @ts-ignore
        const result = await window.electronAPI.printPhotos({
          photos: photosToPrint
        });

        if (result.success) {
          toast.success(`${result.count} de ${result.total} foto(s) enviada(s) para [${result.printerUsed}]!`, { 
            id: toastId,
            description: "Trabalho despachado para a fila de impressão do Windows."
          });
        } else {
          toast.warning(result.message || "Aviso no spooler de impressão.", { id: toastId });
        }
      } else {
        // Fallback simulado caso rode em ambiente de navegador puro
        await new Promise(resolve => setTimeout(resolve, 1500));
        toast.success(`${photosToPrint.length} foto(s) impressa(s) em modo simulado!`, { id: toastId });
      }
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error("Falha ao comunicar com o driver da impressora.", { id: toastId });
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isPrinting && onClose()}>
      <DialogContent className="bg-brand-surface border-border sm:max-w-4xl sm:rounded-[2rem] p-6 max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-brand-border-dashed shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-accent/10 text-brand-accent flex items-center justify-center border border-brand-accent/20">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold text-foreground">Impressão Térmica de Fotos</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Cliente: <strong className="text-foreground">{clientName}</strong> • {photos.length} {photos.length === 1 ? 'foto para imprimir' : 'fotos para imprimir'} (Tamanho 10x15cm)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Barra de Ações Rápidas */}
        <div className="flex items-center justify-between py-3 shrink-0">
          <button 
            onClick={toggleSelectAll}
            disabled={isPrinting}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {selectedPhotoIds.length === photos.length ? (
              <CheckSquare className="w-5 h-5 text-primary" />
            ) : (
              <Square className="w-5 h-5" />
            )}
            Marcar / Desmarcar Todas
          </button>
          
          <div className="text-sm font-medium text-foreground bg-muted px-3 py-1 rounded-full">
            {selectedPhotoIds.length} de {photos.length} prontas
          </div>
        </div>

        {/* Galeria de Fotos com Seleção */}
        <div className="flex-1 overflow-y-auto no-scrollbar pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {photos.map((photo) => {
              const isSelected = selectedPhotoIds.includes(photo.id);
              return (
                <div 
                  key={photo.id}
                  onClick={() => toggleSelectPhoto(photo.id)}
                  className={`relative aspect-[3/2] rounded-xl overflow-hidden bg-brand-bg border cursor-pointer transition-all duration-200 select-none ${ isSelected ? 'border-primary ring-2 ring-primary/40 shadow-sm' : 'border-brand-border opacity-50 grayscale hover:opacity-75' }`}
                >
                  <img 
                    src={photo.local_original_path || photo.preview_url} 
                    alt={photo.original_name}
                    className="w-full h-full object-cover" 
                  />
                  
                  {/* Badge de Seleção */}
                  <div className="absolute top-2 left-2 z-10">
                    {isSelected ? (
                      <div className="bg-primary text-primary-foreground rounded-full p-1 shadow-sm">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                    ) : (
                      <div className="bg-black/40 backdrop-blur-sm text-white rounded-full p-1 border border-white/20">
                        <div className="w-4 h-4 rounded-full border border-white/60"></div>
                      </div>
                    )}
                  </div>

                  {/* Orientação e Formato */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-medium text-white/90 border border-white/10">
                    <RotateCw className="w-2.5 h-2.5" /> Auto
                  </div>

                  {/* Rodapé do Card */}
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent pt-6">
                    <div className="flex items-center justify-between text-[10px] text-white/90 font-medium">
                      <span className="truncate max-w-[100px]">{photo.original_name}</span>
                      <span className="font-mono text-emerald-400 shrink-0">10x15</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer com Informação de Spool e Botão de Disparo */}
        <div className="pt-4 border-t border-brand-border-dashed flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>Driver configurado: Impressão direta sem janela de diálogo.</span>
          </div>
          <div className="flex gap-2.5">
            <Button variant="outline" onClick={onClose} disabled={isPrinting} className="rounded-xl h-10 text-xs px-4">
              Dispensar
            </Button>
            <Button 
              onClick={handlePrintQueue} 
              disabled={isPrinting || selectedPhotoIds.length === 0}
              className="bg-brand-accent text-brand-accent-fg hover:opacity-90 rounded-xl h-10 text-xs font-bold px-5 shadow-sm min-w-[180px]"
            >
              {isPrinting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Transmitindo...
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4 mr-2" />
                  Imprimir Selecionadas ({selectedPhotoIds.length})
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
