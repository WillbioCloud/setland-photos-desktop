import React, { useState } from 'react';
import { X, Cloud, CloudOff, CheckCircle2, AlertCircle, Image as ImageIcon, Clock, Database, RefreshCw, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

interface DriveSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: any;
}

export default function DriveSyncModal({ isOpen, onClose, client }: DriveSyncModalProps) {
  if (!isOpen || !client) return null;

  const isPaid = ['PDV', 'Site'].includes(client.status);

  // Separação Estrita: Apenas fotos marcadas para compra entram na Entrega Digital
  const purchasedPhotos = client.photos?.filter((p: any) => ['selected', 'synced', 'error'].includes(p.status)) || [];
  const systemPhotos = client.photos?.filter((p: any) => !['selected', 'synced', 'error'].includes(p.status) || p.status === 'pending') || [];

  const [isRetrying, setIsRetrying] = useState(false);
  const [realtimeSyncedIds, setRealtimeSyncedIds] = useState<(string | number)[]>([]);

  // Escuta os uploads acontecendo em tempo real para animar este modal
  React.useEffect(() => {
    const handleProgress = (e: any) => {
      const { sessionId, photoId } = e.detail || {};
      if (sessionId === client.id) {
        setRealtimeSyncedIds(prev => [...prev, photoId]);
      }
    };

    window.addEventListener('drive-photo-synced', handleProgress);
    return () => window.removeEventListener('drive-photo-synced', handleProgress);
  }, [client.id]);

  const handleRetry = async () => {
    setIsRetrying(true);
    const toastId = toast.loading("Tentando enviar para o Drive novamente...");
    try {
      const { data: settings } = await supabase.from('system_settings').select('google_drive_folder_id').single();
      if (!settings?.google_drive_folder_id) throw new Error("ID do Drive não configurado.");

      const photosToUpload = purchasedPhotos.map((p: any) => ({
        id: p.id,
        original_name: p.originalName,
        local_original_path: p.localOriginalPath
      }));

      // @ts-ignore
      const uploadRes = await window.electronAPI.uploadToDrive({
        sessionId: client.id,
        clientName: client.name || 'Cliente',
        clientCpf: client.cpf || '', 
        photos: photosToUpload,
        parentFolderId: settings.google_drive_folder_id
      });

      await supabase.from('photo_sessions').update({ 
        drive_status: 'synced', 
        drive_folder_id: uploadRes.folderId 
      }).eq('id', client.id);

      const photoIds = photosToUpload.map((p: any) => p.id);
      await supabase.from('session_photos').update({ status: 'synced', is_printed: false }).in('id', photoIds);

      toast.success("Upload concluído com sucesso!", { id: toastId });
      onClose();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "A nova tentativa também falhou.", { id: toastId });
    } finally {
      setIsRetrying(false);
    }
  };

  // Checa se todas as fotos compradas já estão salvas (no banco ou via evento em tempo real)
  const allSynced = purchasedPhotos.length > 0 && purchasedPhotos.every(
    (p: any) => p.status === 'synced' || realtimeSyncedIds.includes(p.id)
  );

  // Define a aparência do Header do Modal
  let headerConfig = {
    icon: <Database className="h-6 w-6 text-muted-foreground" />,
    label: 'Miniaturas em Nuvem',
    desc: 'As fotos originais estão no SSD. Aguardando pagamento para acionar o Google Drive.',
    badgeClass: 'bg-muted text-muted-foreground border-border'
  };

  if (isPaid) {
    if (client.driveStatus === 'synced' || allSynced) {
      headerConfig = {
        icon: <Cloud className="h-6 w-6 text-emerald-500" />,
        label: 'Entrega Concluída',
        desc: 'Upload em alta resolução para o Google Drive finalizado.',
        badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
      };
    } else if (client.driveStatus === 'error' && !allSynced) {
      headerConfig = {
        icon: <CloudOff className="h-6 w-6 text-destructive" />,
        label: 'Falha na Sincronização',
        desc: 'Ocorreu um erro ao tentar enviar os arquivos para o Drive.',
        badgeClass: 'bg-destructive/10 text-destructive border-destructive/20'
      };
    } else {
      headerConfig = {
        icon: <Clock className="h-6 w-6 text-primary animate-pulse" />,
        label: 'Enviando para o Drive...',
        desc: 'Processando o upload das fotos escolhidas em background.',
        badgeClass: 'bg-primary/10 text-primary border-primary/20'
      };
    }
  }

  // Renderizador dinâmico de status por foto comprada
  const renderPurchasedStatus = (photo: any) => {
    const isPhotoSynced = photo.status === 'synced' || realtimeSyncedIds.includes(photo.id);

    if (!isPaid) return <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-sm">AGUARDANDO PAGAMENTO</span>;
    if (isPhotoSynced) return <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-sm flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> NO DRIVE</span>;
    if (client.driveStatus === 'error') return <span className="text-[10px] font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-sm flex items-center gap-1"><AlertCircle className="w-3 h-3" /> ERRO NO ENVIO</span>;
    return <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-sm flex items-center gap-1"><Clock className="w-3 h-3 animate-pulse" /> ENVIANDO...</span>;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl bg-popover rounded-2xl border border-border p-6 shadow-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Botão Fechar */}
        <button 
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors z-10"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header Dinâmico */}
        <div className="flex items-start gap-4 mb-4 pr-8">
          <div className="p-3 bg-muted/50 rounded-xl border border-border shrink-0">
            {headerConfig.icon}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground leading-tight">{headerConfig.label}</h2>
            <p className="text-sm text-muted-foreground mt-1 leading-snug">{headerConfig.desc}</p>
          </div>
        </div>

        {/* Alerta de Erro Crítico */}
        {client.driveStatus === 'error' && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3.5 flex items-start gap-3 mb-4 shrink-0">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-destructive">O upload para o Drive falhou.</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Verifique se o ID da pasta raiz nas Configurações está correto e se há conexão com a internet. Os arquivos originais continuam seguros no SSD local (C:).
              </p>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-6 no-scrollbar pr-1">
          {/* Sessão 1: Fotos Compradas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                Entrega Digital (Google Drive)
              </h4>
              <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{purchasedPhotos.length} Itens</span>
            </div>

            {purchasedPhotos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center border-2 border-dashed border-border rounded-xl">
                <ImageIcon className="h-6 w-6 text-muted-foreground/40 mb-2" />
                <p className="text-xs text-muted-foreground">O cliente ainda não selecionou as fotos para entrega.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {purchasedPhotos.map((photo: any) => (
                  <div key={photo.id} className="flex items-center gap-3 px-3 py-2.5 bg-muted/30 rounded-lg border border-border/50">
                    <ImageIcon className="h-4 w-4 text-primary/70 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{photo.originalName}</p>
                    </div>
                    <div className="shrink-0">
                      {renderPurchasedStatus(photo)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sessão 2: Restante das Fotos (Thumbnails) */}
          {systemPhotos.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Backup do Sistema (Supabase)
                </h4>
                <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{systemPhotos.length} Itens</span>
              </div>
              <div className="space-y-1.5 opacity-70">
                {systemPhotos.map((photo: any) => (
                  <div key={photo.id} className="flex items-center gap-3 px-3 py-2 bg-muted/20 rounded-lg border border-transparent">
                    <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground truncate">{photo.originalName}</p>
                    </div>
                    <span className="text-[9px] font-semibold text-muted-foreground px-1.5 py-0.5 bg-muted rounded-sm shrink-0">MINIATURA SALVA</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-border shrink-0">
          {client.driveStatus === 'error' && (
            <button
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} />
              {isRetrying ? 'Enviando...' : 'Tentar Novamente'}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-full text-sm font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors border border-border"
          >
            Fechar Janela
          </button>
        </div>
      </div>
    </div>
  );
}
