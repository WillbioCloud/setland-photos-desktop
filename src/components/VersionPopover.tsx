import React from 'react';
import { RefreshCw, CheckCircle2, HardDriveDownload, AlertTriangle } from 'lucide-react';

export interface VersionPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  updateStatus: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  progress: { percent: number; transferred?: number; total?: number; bytesPerSecond?: number };
  newVersion: string;
  onCheckUpdates: () => void;
  onInstall: () => void;
}

export default function VersionPopover({
  isOpen,
  onClose,
  updateStatus,
  progress,
  newVersion,
  onCheckUpdates,
  onInstall
}: VersionPopoverProps) {
  if (!isOpen) return null;

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatSpeed = (bytesPerSec?: number) => {
    if (!bytesPerSec || bytesPerSec === 0) return '';
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute left-4 top-16 z-50 w-80 bg-brand-surface dark:bg-[#140b17] border border-border dark:border-white/10 rounded-2xl shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-150 select-none">
        
        {/* Cabeçalho do Balão */}
        <div className="flex items-start justify-between border-b border-border dark:border-white/10 pb-3 mb-3">
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-bold text-foreground">Setland Fotos</h3>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-brand-accent/10 text-brand-accent font-bold border border-brand-accent/20">
                v{__APP_VERSION__}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Terminal Quiosque • Terminal 01</p>
          </div>
          <span className="text-[9px] font-mono text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full">
            Produção
          </span>
        </div>

        {/* Status da Atualização */}
        <div className="space-y-3">
          {updateStatus === 'downloaded' ? (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-2">
              <div className="flex items-center gap-2 text-emerald-500 text-xs font-bold">
                <CheckCircle2 className="w-4 h-4 shrink-0"/>
                <span>Versão v{newVersion || '1.0.2'} pronta!</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                A atualização já foi baixada silenciosamente. Ao reiniciar, o sistema aplica em 2 segundos e abre sozinho.
              </p>
              <button
                type="button"
                onClick={onInstall}
                className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5"/>
                Reiniciar e Aplicar Agora
              </button>
            </div>
          ) : updateStatus === 'downloading' ? (
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-primary flex items-center gap-1.5">
                  <HardDriveDownload className="w-3.5 h-3.5 animate-pulse"/>
                  Baixando v{newVersion || 'nova versão'}...
                </span>
                <span className="font-mono font-bold text-primary">{Math.round(progress.percent)}%</span>
              </div>
              <div className="w-full bg-secondary/80 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-brand-accent h-full rounded-full transition-all duration-300" 
                  style={{ width: `${Math.min(100, Math.max(5, progress.percent))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                <span>{formatSpeed(progress.bytesPerSecond)}</span>
                <span>
                  {formatBytes(progress.transferred)} de {formatBytes(progress.total)}
                </span>
              </div>
            </div>
          ) : updateStatus === 'checking' ? (
            <div className="p-3 rounded-xl bg-secondary/30 border border-border flex items-center gap-2.5 text-xs text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin text-primary"/>
              <span>Consultando GitHub Releases...</span>
            </div>
          ) : updateStatus === 'error' ? (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 space-y-2">
              <div className="flex items-center gap-1.5 text-red-500 text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Falha ao consultar atualizações</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Verifique a conexão de internet do terminal.
              </p>
              <button
                type="button"
                onClick={onCheckUpdates}
                className="w-full py-1.5 px-3 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
              >
                <RefreshCw className="w-3 h-3 text-primary"/>
                Tentar novamente
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-secondary/20 border border-border/60 flex items-center justify-between gap-2">
              <div className="text-xs">
                <span className="font-medium text-foreground block">Sistema Atualizado</span>
                <span className="text-[10px] text-muted-foreground">Você está na versão mais recente.</span>
              </div>
              <button
                type="button"
                onClick={onCheckUpdates}
                className="px-2.5 py-1.5 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-semibold text-foreground transition-all flex items-center gap-1 shrink-0 active:scale-95 cursor-pointer"
                title="Checar se há novas versões"
              >
                <RefreshCw className="w-3 h-3 text-primary"/>
                Buscar
              </button>
            </div>
          )}

          {/* Informações de Direitos e Repositório */}
          <div className="pt-2 border-t border-border/50 dark:border-white/5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>© 2026 Setland Fotografia</span>
            <span className="font-mono">WillbioCloud</span>
          </div>
        </div>

      </div>
    </>
  );
}
