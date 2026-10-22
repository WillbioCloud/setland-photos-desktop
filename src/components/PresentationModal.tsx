import React, { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle2, Move, Sparkles, Copy } from 'lucide-react';
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

type WatermarkPreset = 'br' | 'bl' | 'tr' | 'tl' | 'center' | 'custom';

export interface PhotoWatermarkConfig {
  enabled: boolean;
  preset: WatermarkPreset;
  customPos: { xPercent: number; yPercent: number };
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
  const [showUI, setShowUI] = useState(true);

  // Mapa de configurações individuais de marca d'água indexado pelo ID da foto
  const [watermarksByPhoto, setWatermarksByPhoto] = useState<Record<string | number, PhotoWatermarkConfig>>({});

  // Helper para recuperar ou inicializar a configuração da foto atual
  const getActiveWatermark = useCallback((photoId: string | number): PhotoWatermarkConfig => {
    return watermarksByPhoto[photoId] || {
      enabled: true, // Padrão inicial: ativa com proteção
      preset: 'br',
      customPos: { xPercent: 78, yPercent: 82 }
    };
  }, [watermarksByPhoto]);

  // Orientação e dimensões da foto atual
  const [isPortrait, setIsPortrait] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const watermarkRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseMove = useCallback(() => {
    setShowUI(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setShowUI(false);
    }, 3500);
  }, []);

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('mousemove', handleMouseMove);
      handleMouseMove();
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, [isOpen, handleMouseMove]);

  // Detecta proporção real da imagem ao carregar
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setIsPortrait(naturalHeight > naturalWidth);
  };

  const currentPhoto = photos[currentIndex];

  // Alterna marca d'água APENAS na foto atual
  const toggleCurrentWatermark = useCallback(() => {
    if (!currentPhoto) return;
    const current = getActiveWatermark(currentPhoto.id);
    const nextState = !current.enabled;
    setWatermarksByPhoto(prev => ({
      ...prev,
      [currentPhoto.id]: {
        ...current,
        enabled: nextState
      }
    }));
    toast.info(nextState ? "Marca d'água ativada nesta foto" : "Marca d'água removida desta foto");
  }, [currentPhoto, getActiveWatermark]);

  // Rotaciona os presets de canto APENAS na foto atual
  const rotateCurrentPreset = useCallback(() => {
    if (!currentPhoto) return;
    const current = getActiveWatermark(currentPhoto.id);
    const nextMap: Record<WatermarkPreset, WatermarkPreset> = {
      br: 'bl',
      bl: 'tl',
      tl: 'tr',
      tr: 'center',
      center: 'br',
      custom: 'br'
    };
    const nextPreset = nextMap[current.preset];
    setWatermarksByPhoto(prev => ({
      ...prev,
      [currentPhoto.id]: {
        ...current,
        preset: nextPreset
      }
    }));
  }, [currentPhoto, getActiveWatermark]);

  // Aplica a posição/preset atual a todas as fotos da sessão em lote
  const applyCurrentPositionToAll = useCallback(() => {
    if (!currentPhoto) return;
    const current = getActiveWatermark(currentPhoto.id);
    setWatermarksByPhoto(prev => {
      const nextMap = { ...prev };
      for (const p of photos) {
        const existing = nextMap[p.id] || {
          enabled: true,
          preset: 'br',
          customPos: { xPercent: 78, yPercent: 82 }
        };
        nextMap[p.id] = {
          ...existing,
          preset: current.preset,
          customPos: { ...current.customPos }
        };
      }
      return nextMap;
    });
    toast.success("Posição da marca d'água aplicada a todas as fotos!");
  }, [currentPhoto, getActiveWatermark, photos]);

  // Ciclo de navegação e atalhos de teclado
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();

      switch (e.key) {
        case 'ArrowRight':
          setCurrentIndex(prev => Math.min(prev + 1, photos.length - 1));
          break;
        case 'ArrowLeft':
          setCurrentIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          if (photos[currentIndex]) {
            togglePhoto(photos[currentIndex].id);
          }
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
          toggleCurrentWatermark();
          break;
        case 'p':
        case 'P':
          rotateCurrentPreset();
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
  }, [isOpen, currentIndex, photos, togglePhoto, onClose, selectedPhotos, onConfirmSelection, toggleCurrentWatermark, rotateCurrentPreset]);

  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(0);
    }
  }, [isOpen]);

  // Lógica de Drag & Drop da Marca d'Água estritamente dentro da foto atual
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!containerRef.current || !watermarkRef.current || !currentPhoto) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const watermarkRect = watermarkRef.current.getBoundingClientRect();
    const photoId = currentPhoto.id;

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: watermarkRect.left - containerRect.left,
      startY: watermarkRect.top - containerRect.top
    };

    setIsDragging(true);

    const handleWindowMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current || !containerRef.current || !watermarkRef.current) return;

      const cRect = containerRef.current.getBoundingClientRect();
      const wRect = watermarkRef.current.getBoundingClientRect();

      const deltaX = moveEvent.clientX - dragStartRef.current.mouseX;
      const deltaY = moveEvent.clientY - dragStartRef.current.mouseY;

      const rawX = dragStartRef.current.startX + deltaX;
      const rawY = dragStartRef.current.startY + deltaY;

      // Trava para NUNCA sair do frame da foto
      const maxX = cRect.width - wRect.width;
      const maxY = cRect.height - wRect.height;

      const clampedX = Math.max(0, Math.min(rawX, maxX));
      const clampedY = Math.max(0, Math.min(rawY, maxY));

      const newPos = {
        xPercent: (clampedX / cRect.width) * 100,
        yPercent: (clampedY / cRect.height) * 100
      };

      setWatermarksByPhoto(prev => {
        const existing = prev[photoId] || {
          enabled: true,
          preset: 'br',
          customPos: { xPercent: 78, yPercent: 82 }
        };
        return {
          ...prev,
          [photoId]: {
            ...existing,
            preset: 'custom',
            customPos: newPos
          }
        };
      });
    };

    const handleWindowMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  if (!isOpen || photos.length === 0 || !currentPhoto) return null;

  const isSelected = selectedPhotos.includes(currentPhoto.id);
  const activeWatermark = getActiveWatermark(currentPhoto.id);

  // Calcula classe de posicionamento caso seja preset ou estilo inline caso seja custom
  const getWatermarkPositionStyle = (): { className: string; style?: React.CSSProperties } => {
    if (activeWatermark.preset === 'custom') {
      return {
        className: 'absolute',
        style: {
          left: `${activeWatermark.customPos.xPercent}%`,
          top: `${activeWatermark.customPos.yPercent}%`
        }
      };
    }

    const presetClasses: Record<Exclude<WatermarkPreset, 'custom'>, string> = {
      br: 'bottom-4 right-4 sm:bottom-6 sm:right-6',
      bl: 'bottom-4 left-4 sm:bottom-6 sm:left-6',
      tr: 'top-4 right-4 sm:top-6 sm:right-6',
      tl: 'top-4 left-4 sm:top-6 sm:left-6',
      center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
    };

    return { className: `absolute ${presetClasses[activeWatermark.preset]}` };
  };

  const { className: watermarkPosClass, style: watermarkPosStyle } = getWatermarkPositionStyle();

  return (
    <div 
      id="presentation-modal" 
      className="fixed inset-0 z-[60] bg-black flex items-center justify-center select-none overflow-hidden"
    >
      {/* 
        Container Relativo Físico da Foto:
        Usa inline-block e auto para ter EXATAMENTE as dimensões da imagem renderizada.
        A parte preta do monitor fica do lado de fora deste elemento.
      */}
      <div 
        ref={containerRef}
        className="relative inline-block max-w-full max-h-screen select-none overflow-hidden"
      >
        <img 
          src={currentPhoto.url} 
          alt="Foto da Sessão" 
          onLoad={handleImageLoad}
          className="max-h-screen max-w-full w-auto h-auto block select-none pointer-events-none object-contain"
        />

        {/* Selo verde de seleção dentro do enquadramento da foto */}
        {isSelected && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-emerald-600/90 text-white text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-md shadow-lg border border-white/20 animate-in zoom-in-75 duration-150">
            <CheckCircle2 className="h-4 w-4" />
            <span>Selecionada</span>
          </div>
        )}

        {/* Marca d'Água Interativa Presa Dentro da Foto Atual */}
        {activeWatermark.enabled && (
          <div
            ref={watermarkRef}
            onMouseDown={handleMouseDown}
            style={watermarkPosStyle}
            title="Arraste para mover pela foto"
            className={`group ${watermarkPosClass} z-20 cursor-grab active:cursor-grabbing transition-opacity select-none ${
              isDragging ? 'opacity-100 scale-105' : 'opacity-85 hover:opacity-100'
            }`}
          >
            <div className="relative flex items-center justify-center p-1 rounded-xl group-hover:ring-2 group-hover:ring-primary/60 group-hover:bg-black/30 backdrop-blur-[2px] transition-all">
              <img 
                src={watermarkLogo} 
                alt="Watermark Setland" 
                className={`object-contain pointer-events-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] ${
                  isPortrait ? 'w-24 sm:w-36 md:w-44' : 'w-32 sm:w-48 md:w-56'
                }`} 
              />
              <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 bg-black/80 text-white rounded-full p-1 shadow transition-opacity">
                <Move className="w-3 h-3 text-primary" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Barra de Controles Inferior */}
      <div className={`absolute bottom-6 transition-opacity duration-500 z-30 ${showUI ? 'opacity-100' : 'opacity-0'}`}>
        <div className="bg-black/85 backdrop-blur-md border border-white/10 rounded-full px-5 py-2.5 flex flex-wrap gap-3.5 text-white text-xs items-center shadow-2xl">
          
          {/* Badge de Orientação Detectada */}
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 font-mono text-[10px] uppercase font-bold tracking-wider text-primary border border-white/10">
            <Sparkles className="w-3 h-3" />
            {isPortrait ? 'Retrato (Vertical)' : 'Paisagem (Horizontal)'}
          </div>

          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white/20 rounded font-mono text-[10px]">←</kbd>
            <kbd className="px-1.5 py-0.5 bg-white/20 rounded font-mono text-[10px]">→</kbd> Navegar ({currentIndex + 1}/{photos.length})
          </div>

          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white/20 rounded font-mono text-[10px]">Enter</kbd> {isSelected ? 'Desmarcar' : 'Selecionar'}
          </div>

          {/* Status e Botão Interativo para Ligar/Desligar nesta foto */}
          <button
            type="button"
            onClick={toggleCurrentWatermark}
            className={`px-2.5 py-1 rounded-full font-medium transition-all flex items-center gap-1.5 cursor-pointer text-xs border active:scale-95 ${
              activeWatermark.enabled
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                : 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
            }`}
            title="Ligar ou desligar marca d'água nesta foto (Atalho: M)"
          >
            <kbd className="px-1.5 py-0.5 bg-black/40 rounded font-mono text-[10px]">M</kbd>
            <span>
              Marca d&apos;água: <strong>{activeWatermark.enabled ? 'Ligada' : 'Desligada'}</strong>
            </span>
          </button>

          {/* Posição rápida */}
          <button
            type="button"
            onClick={rotateCurrentPreset}
            className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 transition-all flex items-center gap-1.5 cursor-pointer text-xs border border-white/10 active:scale-95"
            title="Rotacionar posição da marca d'água nesta foto (Atalho: P)"
          >
            <kbd className="px-1.5 py-0.5 bg-black/40 rounded font-mono text-[10px]">P</kbd>
            <span>Posição: <strong className="uppercase font-mono text-primary">{activeWatermark.preset}</strong></span>
          </button>

          {/* Botão Rápido: Aplicar esta posição a todas */}
          <button
            type="button"
            onClick={applyCurrentPositionToAll}
            className="px-2.5 py-1 rounded-full bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 transition-all flex items-center gap-1.5 cursor-pointer text-xs active:scale-95"
            title="Replicar esta mesma posição para todas as fotos da sessão"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Aplicar esta posição a todas</span>
          </button>

          <div className="hidden lg:inline text-white/50 text-[11px]">
            🖱️ Arraste a logo livremente
          </div>

          <div className="w-px h-4 bg-white/20"></div>

          {selectedPhotos.length > 0 ? (
            <button 
              onClick={onConfirmSelection}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-bold transition-all flex items-center gap-1.5 shadow-lg active:scale-95 text-xs cursor-pointer"
            >
              <kbd className="px-1.5 py-0.2 bg-black/30 rounded font-mono text-[10px]">C</kbd> 
              Confirmar ({selectedPhotos.length})
            </button>
          ) : (
            <div className="px-3 py-1 opacity-40 flex items-center gap-1.5 cursor-not-allowed text-xs">
              <kbd className="px-1.5 py-0.2 bg-white/20 rounded font-mono text-[10px]">C</kbd> 
              Confirmar
            </div>
          )}

          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-white/20 rounded font-mono text-[10px]">Esc</kbd> Sair
          </div>
        </div>
      </div>
    </div>
  );
}