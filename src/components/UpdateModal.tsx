import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Download, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowUpCircle, 
  X,
  HardDriveDownload
} from 'lucide-react';
import { toast } from 'sonner';

type UpdateStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';

interface UpdateProgressData {
  percent: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

export default function UpdateModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [newVersion, setNewVersion] = useState<string>('');
  const [releaseNotes, setReleaseNotes] = useState<string>('');
  const [progress, setProgress] = useState<UpdateProgressData>({ percent: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window.electronAPI || window.electron) : null;
    if (!api) return;

    // 1. Escuta quando há atualização disponível
    const cleanupAvailable = api.onUpdateAvailable?.((info) => {
      console.log('[UpdateModal] Atualização disponível:', info);
      setNewVersion(info.version || 'Nova Versão');
      
      let notes = '';
      if (typeof info.releaseNotes === 'string') {
        notes = info.releaseNotes;
      } else if (Array.isArray(info.releaseNotes)) {
        notes = info.releaseNotes.map(n => n.note).filter(Boolean).join('\n');
      }
      setReleaseNotes(notes);
      setStatus('available');
      setIsOpen(true);
      toast.info(`Nova versão ${info.version} disponível para o Setland Fotos!`);
    });

    // 2. Escuta o progresso do download
    const cleanupProgress = api.onUpdateProgress?.((prog) => {
      setProgress(prog);
      setStatus('downloading');
    });

    // 3. Escuta quando o download é concluído
    const cleanupDownloaded = api.onUpdateDownloaded?.((info) => {
      console.log('[UpdateModal] Download da atualização concluído:', info);
      setStatus('downloaded');
      setProgress({ percent: 100 });
      setIsOpen(true);
      toast.success('Atualização baixada com sucesso! Pronto para reiniciar.');
    });

    return () => {
      cleanupAvailable?.();
      cleanupProgress?.();
      cleanupDownloaded?.();
    };
  }, []);

  const handleStartDownload = async () => {
    const api = typeof window !== 'undefined' ? (window.electronAPI || window.electron) : null;
    if (!api?.startUpdateDownload) {
      toast.error('Controlador de atualização não disponível neste ambiente.');
      return;
    }

    try {
      setStatus('downloading');
      setProgress({ percent: 0 });
      await api.startUpdateDownload();
    } catch (err: any) {
      console.error('[UpdateModal] Erro ao iniciar download:', err);
      setStatus('error');
      setErrorMessage(err?.message || 'Falha ao baixar o instalador da atualização.');
      toast.error('Erro ao iniciar o download da atualização.');
    }
  };

  const handleQuitAndInstall = () => {
    const api = typeof window !== 'undefined' ? (window.electronAPI || window.electron) : null;
    if (!api?.quitAndInstall) {
      toast.error('Comando de reinicialização não disponível.');
      return;
    }

    toast.loading('Reiniciando e instalando atualização...');
    api.quitAndInstall();
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 MB';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatSpeed = (bytesPerSec?: number) => {
    if (!bytesPerSec || bytesPerSec === 0) return '';
    const mb = bytesPerSec / (1024 * 1024);
    return `${mb.toFixed(1)} MB/s`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in-0 duration-200">
      <div 
        className="w-full max-w-lg bg-card dark:bg-[#140b17] border border-brand-accent/30 rounded-3xl p-6 sm:p-7 shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Glow decorativo de fundo */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-brand-accent/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        {/* Botão Fechar / Lembrar Depois (apenas se não estiver no momento crítico de reinicialização) */}
        {status !== 'downloaded' && (
          <button 
            onClick={() => setIsOpen(false)}
            aria-label="Lembrar mais tarde"
            className="absolute top-5 right-5 p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Cabeçalho */}
        <div className="flex items-start gap-4 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-brand-accent/15 border border-brand-accent/30 flex items-center justify-center text-brand-accent shrink-0 shadow-sm">
            {status === 'downloaded' ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-500 animate-in zoom-in-50" />
            ) : status === 'downloading' ? (
              <HardDriveDownload className="w-6 h-6 animate-pulse" />
            ) : status === 'error' ? (
              <AlertTriangle className="w-6 h-6 text-red-500" />
            ) : (
              <Sparkles className="w-6 h-6" />
            )}
          </div>

          <div className="pr-6">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-mono tracking-wider font-semibold text-brand-accent">
                {status === 'downloaded' ? 'Pronto para Aplicar' : 'Atualização do Sistema'}
              </span>
              {newVersion && (
                <span className="px-2 py-0.5 rounded-full bg-brand-accent/15 text-brand-accent border border-brand-accent/30 text-[10px] font-mono font-bold">
                  v{newVersion}
                </span>
              )}
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-foreground mt-0.5 tracking-tight">
              {status === 'downloaded'
                ? 'Atualização Baixada com Sucesso!'
                : status === 'downloading'
                ? 'Baixando Nova Versão...'
                : status === 'error'
                ? 'Falha na Atualização'
                : 'Nova Versão do Setland Fotos'}
            </h3>
          </div>
        </div>

        {/* Conteúdo Central dependendo do Estado */}
        {status === 'available' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Uma nova versão do sistema está disponível com melhorias de estabilidade, desempenho e novos recursos.
            </p>

            {releaseNotes ? (
              <div className="bg-secondary/40 border border-border/70 rounded-2xl p-4 max-h-40 overflow-y-auto text-xs text-muted-foreground whitespace-pre-wrap no-scrollbar">
                <span className="font-semibold text-foreground block mb-1">Notas da Versão:</span>
                {releaseNotes}
              </div>
            ) : (
              <div className="bg-secondary/30 rounded-2xl p-3.5 border border-border/50 text-xs text-muted-foreground flex items-center gap-2">
                <ArrowUpCircle className="w-4 h-4 text-brand-accent shrink-0" />
                <span>O download acontecerá em segundo plano sem interromper seus atendimentos.</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all"
              >
                Lembrar Mais Tarde
              </button>
              <button
                type="button"
                onClick={handleStartDownload}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-accent hover:bg-brand-accent/90 text-brand-bg flex items-center gap-2 shadow-md transition-all active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                Baixar Atualização
              </button>
            </div>
          </div>
        )}

        {status === 'downloading' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Aguarde enquanto o novo pacote é transferido com segurança via GitHub Releases.
            </p>

            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {Math.round(progress.percent)}% Concluído
                </span>
                <span>
                  {formatBytes(progress.transferred)} / {formatBytes(progress.total)} {formatSpeed(progress.bytesPerSecond) && `• ${formatSpeed(progress.bytesPerSecond)}`}
                </span>
              </div>

              {/* Barra de Progresso estilizada */}
              <div className="w-full h-3 bg-secondary/80 rounded-full overflow-hidden p-0.5 border border-border">
                <div 
                  className="h-full bg-brand-accent rounded-full transition-all duration-300 relative overflow-hidden"
                  style={{ width: `${Math.min(100, Math.max(3, progress.percent))}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-accent" />
                Download ativo em segundo plano
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="hover:underline text-muted-foreground hover:text-foreground text-xs"
              >
                Minimizar e continuar trabalhando
              </button>
            </div>
          </div>
        )}

        {status === 'downloaded' && (
          <div className="space-y-4">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-xs text-foreground space-y-1">
              <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                O arquivo de instalação já está gravado no terminal.
              </p>
              <p className="text-muted-foreground">
                Clique no botão abaixo para reiniciar agora. O sistema fechará por alguns instantes, aplicará a versão <strong>v{newVersion}</strong> e reabrirá automaticamente.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all"
              >
                Depois
              </button>
              <button
                type="button"
                onClick={handleQuitAndInstall}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-[0.98]"
              >
                <RefreshCw className="w-4 h-4" />
                Reiniciar e Atualizar Agora
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-xs text-red-500">
              <p className="font-semibold mb-1">Não foi possível concluir o download automático.</p>
              <p className="text-red-400/90">{errorMessage || 'Verifique sua conexão com a internet ou as permissões do sistema.'}</p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-all"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleStartDownload}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-brand-accent hover:bg-brand-accent/90 text-brand-bg flex items-center gap-2 transition-all active:scale-[0.98]"
              >
                <RefreshCw className="w-4 h-4" />
                Tentar Novamente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
