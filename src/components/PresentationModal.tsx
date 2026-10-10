import { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle2 } from 'lucide-react';
import { toast } from "sonner";
import watermarkLogo from '../assets/watermark_setland.png';

interface PresentationModalProps {
  isOpen: boolean;
  onClose: () => void;
  photos: { id: number | string; url: string; status?: string }[];
  selectedPhotos: (number | string)[];
  togglePhoto: (id: number | string) => void;
  onConfirmSelection?: () => void;
}

export default function PresentationModal({
  isOpen,
  onClose,
  photos,
  selectedPhotos,
  togglePhoto,
  onConfirmSelection
}: PresentationModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showWatermark, setShowWatermark] = useState(true);
  const [watermarkPos, setWatermarkPos] = useState<'br' | 'bl' | 'tr' | 'tl' | 'center'>('br');
  const [showUI, setShowUI] = useState(true);

  // ReturnType<typeof setTimeout> funciona no browser e no Node sem depender
// do namespace NodeJS (que exige @types/node no escopo do renderer).
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseMove = useCallback(() => {
    setShowUI(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setShowUI(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('mousemove', handleMouseMove);
      handleMouseMove(); // trigger initial state
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, [isOpen, handleMouseMove]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation(); // Evita que atalhos vazem (ex: Enter abrindo Novo Cliente)
      setShowUI(false); // hide immediately

      switch (e.key) {
        case 'ArrowRight':
          setCurrentIndex(prev => Math.min(prev + 1, photos.length - 1));
          break;
        case 'ArrowLeft':
          setCurrentIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          togglePhoto(photos[currentIndex].id);
          break;
        case 'c':
        case 'C':
          if (selectedPhotos.length > 0 && onConfirmSelection) {
            onConfirmSelection();
          } else if (selectedPhotos.length === 0) {
            toast.error("Selecione pelo menos uma foto para confirmar.");
          }
          break;
        case 'm':
        case 'M':
          setShowWatermark(prev => !prev);
          break;
        case 'p':
        case 'P':
          setWatermarkPos(prev => {
            const nextMap: Record<string, 'br' | 'bl' | 'tr' | 'tl' | 'center'> = {
              br: 'bl',
              bl: 'tl',
              tl: 'tr',
              tr: 'center',
              center: 'br'
            };
            return nextMap[prev];
          });
          break;
        case 'Escape':
          onClose();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, photos, togglePhoto, onClose]);

  // Reseta o index ao abrir
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
    }
  }, [isOpen]);

  if (!isOpen || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex];
  const isSelected = selectedPhotos.includes(currentPhoto.id);

  const watermarkClasses = {
    br: 'bottom-8 right-8',
    bl: 'bottom-8 left-8',
    tr: 'top-8 right-8',
    tl: 'top-8 left-8',
    center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
  };

  return (
    <div id="presentation-modal" className="fixed inset-0 z-[60] bg-black flex items-center justify-center select-none overflow-hidden">
      
      <img 
        src={currentPhoto.url} 
        alt="Foto da Sessão" 
        className="max-h-screen max-w-full object-contain transition-transform duration-300"
      />

      {isSelected && (
        <CheckCircle2 className="absolute top-8 left-8 text-emerald-500 h-16 w-16 bg-black/50 rounded-full" />
      )}

      {showWatermark && (
        <img 
          src={watermarkLogo} 
          alt="Watermark" 
          className={`absolute w-32 md:w-48 opacity-80 pointer-events-none transition-all duration-300 ${watermarkClasses[watermarkPos]}`} 
        />
      )}

      <div className={`absolute bottom-8 transition-opacity duration-500 ${showUI ? 'opacity-100' : 'opacity-0'}`}>
        <div className="bg-black/80 backdrop-blur border border-white/10 rounded-full px-6 py-3 flex gap-6 text-white text-sm items-center">
          <div><kbd className="px-2 py-1 bg-white/20 rounded-md font-mono text-xs text-white mx-1">←</kbd><kbd className="px-2 py-1 bg-white/20 rounded-md font-mono text-xs text-white mx-1">→</kbd> Navegar</div>
          <div><kbd className="px-2 py-1 bg-white/20 rounded-md font-mono text-xs text-white mx-1">Enter</kbd> Selecionar</div>
          <div><kbd className="px-2 py-1 bg-white/20 rounded-md font-mono text-xs text-white mx-1">M</kbd> Marca d'água</div>
          <div><kbd className="px-2 py-1 bg-white/20 rounded-md font-mono text-xs text-white mx-1">P</kbd> Posição</div>
          <div><kbd className="px-2 py-1 bg-white/20 rounded-md font-mono text-xs text-white mx-1">Esc</kbd> Sair</div>
          
          <div className="w-px h-6 bg-white/20 mx-2"></div>
          
          {selectedPhotos.length > 0 ? (
            <button 
              onClick={onConfirmSelection}
              className="px-4 py-1.5 bg-emerald-500 text-white rounded-full font-medium hover:bg-emerald-600 transition-colors flex items-center gap-2 shadow-lg"
            >
              <kbd className="px-2 py-0.5 bg-black/20 rounded-md font-mono text-xs">C</kbd> 
              Confirmar ({selectedPhotos.length})
            </button>
          ) : (
            <div className="px-4 py-1.5 opacity-50 flex items-center gap-2 cursor-not-allowed">
              <kbd className="px-2 py-0.5 bg-white/20 rounded-md font-mono text-xs">C</kbd> 
              Confirmar
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
