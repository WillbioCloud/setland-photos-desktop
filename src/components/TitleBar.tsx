import React, { useState } from 'react';
import watermarkLogo from '../assets/watermark_setland.png';
import VersionPopover from './VersionPopover';
import { useAutoUpdater } from '@/hooks/useAutoUpdater';

export default function TitleBar() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const {
    updateStatus,
    progress,
    newVersion,
    checkForUpdates,
    installUpdate
  } = useAutoUpdater();

  // Detecta se está rodando no Electron
  const isElectron = typeof window !== 'undefined' && Boolean(window.electron || window.electronAPI);

  const handleMinimize = () => {
    const electron = window.electron || window.electronAPI;
    electron?.minimizeWindow?.();
  };

  const handleMaximize = () => {
    const electron = window.electron || window.electronAPI;
    electron?.maximizeWindow?.();
  };

  const handleClose = () => {
    const electron = window.electron || window.electronAPI;
    electron?.closeWindow?.();
  };

  return (
    <div className="app-drag-region h-[38px] w-full shrink-0 flex items-center justify-between bg-brand-surface dark:bg-[#0D020C] text-brand-ink border-b border-border dark:border-white/10 select-none z-50 relative transition-colors duration-200">
      
      {/* ── LADO ESQUERDO: Logo + Nome do App + Versão ── */}
      <div className="app-no-drag flex items-center gap-2.5 px-3.5 h-full">
        {/* Logo da Setland */}
        <img
          src={watermarkLogo}
          alt="Setland"
          className="h-5 w-auto object-contain dark:drop-shadow-[0_0_8px_rgba(217,164,92,0.45)] shrink-0"
        />

        {/* Nome do Aplicativo */}
        <div className="flex items-center gap-1.5 font-bold tracking-tight text-xs">
          <span className="text-brand-accent dark:text-[#D9A45C] font-extrabold text-[13px]">
            Setland
          </span>
          <span className="text-foreground dark:text-[#F5EFE6] font-semibold text-[13px]">
            Fotos
          </span>
        </div>

        {/* Divisor sutil */}
        <div className="h-3.5 w-px bg-border dark:bg-white/15" />

        {/* Badge Interativo de Versão / Auto-Updater */}
        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => setIsPopoverOpen(prev => !prev)}
            className="relative text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-brand-accent/10 hover:bg-brand-accent/20 text-brand-accent border border-brand-accent/20 tracking-tight select-none transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
            title="Detalhes da versão e atualizações do sistema"
          >
            <span>v{__APP_VERSION__}</span>
            {updateStatus === 'downloading' && (
              <span className="relative flex h-2 w-2" title="Baixando atualização em segundo plano...">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
            )}
            {updateStatus === 'downloaded' && (
              <span className="relative flex h-2 w-2" title="Nova versão pronta para reiniciar!">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
              </span>
            )}
          </button>

          {/* Popover flutuante com informações de atualização */}
          <VersionPopover
            isOpen={isPopoverOpen}
            onClose={() => setIsPopoverOpen(false)}
            updateStatus={updateStatus}
            progress={progress}
            newVersion={newVersion}
            onCheckUpdates={checkForUpdates}
            onInstall={installUpdate}
            className="left-0 top-[38px]"
          />
        </div>

        
      </div>

      {/* ── CENTRO: Área de Arraste da Janela (Permite mover e dar duplo-clique para maximizar) ── */}
      <div className="flex-1 h-full pointer-events-none" />

      {/* ── LADO DIREITO: Controles de Janela ── */}
      {/* 
        No Windows via Electron, o 'titleBarOverlay' nativo ocupa exatamente ~140px no canto superior direito
        renderizando os botões de Minimizar, Maximizar e Fechar com as cores configuradas no electron/main.ts.
        Em ambiente web/preview (onde não há Electron), exibimos botões simulados elegantes.
      */}
      <div className="w-[140px] h-full shrink-0 flex items-center justify-end">
        {!isElectron && (
          <div className="app-no-drag flex items-center h-full">
            <button
              onClick={handleMinimize}
              className="h-full px-3 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-xs flex items-center justify-center"
              title="Minimizar"
            >
              ─
            </button>
            <button
              onClick={handleMaximize}
              className="h-full px-3 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-xs flex items-center justify-center"
              title="Maximizar"
            >
              □
            </button>
            <button
              onClick={handleClose}
              className="h-full px-3.5 text-muted-foreground hover:text-white hover:bg-rose-500 transition-colors text-xs flex items-center justify-center"
              title="Fechar"
            >
              ✕
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
