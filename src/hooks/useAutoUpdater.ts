import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateProgressData {
  percent: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
}

interface AutoUpdaterStore {
  status: UpdateStatus;
  progress: UpdateProgressData;
  newVersion: string;
  errorMessage: string | null;
}

let store: AutoUpdaterStore = {
  status: 'idle',
  progress: { percent: 0 },
  newVersion: '',
  errorMessage: null,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function setStore(partial: Partial<AutoUpdaterStore>) {
  store = { ...store, ...partial };
  notify();
}

// Inicializa listeners do Electron uma única vez no ciclo global da aplicação
let initialized = false;

function initUpdaterListeners() {
  if (initialized || typeof window === 'undefined') return;
  const api = window.electronAPI || window.electron;
  if (!api) return;
  initialized = true;

  // 1. Quando uma nova versão é encontrada (com autoDownload = true, já inicia o download)
  api.onUpdateAvailable?.((info) => {
    console.log('[useAutoUpdater] Atualização disponível:', info);
    setStore({
      status: 'downloading',
      newVersion: info.version || '',
    });
    toast.info(`Nova versão ${info.version || ''} detectada. Baixando silenciosamente...`);
  });

  // 2. Progresso do download
  api.onUpdateProgress?.((prog) => {
    setStore({
      status: 'downloading',
      progress: {
        percent: prog.percent || 0,
        transferred: prog.transferred,
        total: prog.total,
        bytesPerSecond: prog.bytesPerSecond,
      },
    });
  });

  // 3. Download concluído
  api.onUpdateDownloaded?.((info) => {
    console.log('[useAutoUpdater] Atualização baixada:', info);
    setStore({
      status: 'downloaded',
      newVersion: info.version || store.newVersion,
      progress: { percent: 100 },
    });
    toast.success(`Versão ${info.version || store.newVersion} pronta! Clique na versão para reiniciar.`);
  });

  // 4. Nenhuma atualização disponível
  api.onUpdateNotAvailable?.(() => {
    if (store.status === 'checking') {
      setStore({ status: 'idle' });
      toast.info('Você já está utilizando a versão mais recente.');
    }
  });

  // 5. Erro no updater
  api.onUpdateError?.((err) => {
    console.warn('[useAutoUpdater] Erro no updater:', err);
    if (store.status === 'checking' || store.status === 'downloading') {
      setStore({
        status: 'error',
        errorMessage: typeof err === 'string' ? err : err?.message || 'Falha na atualização',
      });
    }
  });
}

// Inicia imediatamente
if (typeof window !== 'undefined') {
  initUpdaterListeners();
}

export function useAutoUpdater() {
  const currentStore = useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => store
  );

  const checkForUpdates = async () => {
    const api = window.electronAPI || window.electron;
    if (!api?.checkForUpdates) {
      toast.info('Ambiente de desenvolvimento: checagem de atualizações indisponível.');
      return;
    }

    try {
      setStore({ status: 'checking', errorMessage: null });
      const result = await api.checkForUpdates();
      if (!result) {
        // App em dev ou sem pacote de update
        setTimeout(() => {
          setStore({ status: 'idle' });
          toast.info('Você já está na versão mais recente.');
        }, 1000);
      }
    } catch (err: any) {
      console.warn('[useAutoUpdater] Falha ao checar atualizações:', err);
      setStore({ status: 'error', errorMessage: err?.message || 'Erro ao conectar ao GitHub' });
      toast.error('Erro ao buscar atualizações.');
    }
  };

  const installUpdate = () => {
    const api = window.electronAPI || window.electron;
    if (!api?.quitAndInstall) {
      toast.error('Comando de reinicialização não disponível.');
      return;
    }
    toast.loading('Reiniciando e aplicando atualização silenciosa...');
    api.quitAndInstall();
  };

  return {
    updateStatus: currentStore.status,
    progress: currentStore.progress,
    newVersion: currentStore.newVersion,
    errorMessage: currentStore.errorMessage,
    checkForUpdates,
    installUpdate,
  };
}
