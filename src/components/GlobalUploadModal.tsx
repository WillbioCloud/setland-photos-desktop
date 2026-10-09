import React, { useState, useEffect } from 'react';
import { UploadCloud, UserPlus, Image as ImageIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from "sonner";
import { supabase } from '@/lib/supabaseClient';

declare global {
  interface Window {
    electronAPI: any;
  }
}

interface GlobalUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSessionCreated?: (newSession: any) => void;
}

export default function GlobalUploadModal({ isOpen, onClose, onSessionCreated }: GlobalUploadModalProps) {
  const [clientName, setClientName] = useState('');
  const [clientCpf, setClientCpf] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [photographer, setPhotographer] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [photographersList, setPhotographersList] = useState<any[]>([]);
  
  const [step, setStep] = useState(1);

  useEffect(() => {
    async function loadPhotographers() {
      if (isOpen) {
        const { data } = await supabase.from('employees').select('id, name, role').eq('status', 'Ativo');
        if (data) setPhotographersList(data);
      }
    }
    loadPhotographers();
  }, [isOpen]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    // Registra o listener de progresso, se a API Electron estiver injetada
    if (window.electronAPI && window.electronAPI.onProgress) {
      window.electronAPI.onProgress((progress: number) => {
        setUploadProgress(progress);
      });
    }
  }, []);

  // Limpa estados ao reabrir
  useEffect(() => {
    if (isOpen && !isUploading) {
      setClientName('');
      setClientCpf('');
      setClientPhone('');
      setPhotographer('');
      setSelectedFiles([]);
      setUploadProgress(0);
      setIsUploading(false);
      setStep(1);
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isUploading) return;
    onClose();
  };

  const handleSelectFiles = async () => {
    if (isUploading) return;
    try {
      if (window.electronAPI && window.electronAPI.selectFiles) {
        const paths = await window.electronAPI.selectFiles();
        if (paths && paths.length > 0) {
          setSelectedFiles(paths);
        }
      } else {
        // Fallback web temporário
        setSelectedFiles(['foto1.jpg', 'foto2.jpg', 'foto3.png']);
      }
    } catch (error) {
      console.error("Erro ao selecionar arquivos:", error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!photographer) {
      toast.error("Selecione o fotógrafo antes de continuar.");
      return;
    }
    if (selectedFiles.length === 0) {
      toast.error("Por favor, selecione as fotos do Cartão SD.");
      return;
    }

    setStep(2);
  };

  const confirmAndUpload = async () => {
    setIsUploading(true);
    setUploadProgress(0);

    const randomCover = selectedFiles[Math.floor(Math.random() * selectedFiles.length)];

    try {
      let result = null;
      if (window.electronAPI && window.electronAPI.processAndUpload) {
        result = await window.electronAPI.processAndUpload({
          filePaths: selectedFiles,
          coverPhoto: randomCover,
          clientCpf,
          clientName,
          clientPhone,
          photographer
        });
      } else {
        // Simulador de progresso fluido caso o App não esteja no electron para testar UI
        for (let i = 0; i <= 100; i += 5) {
          setUploadProgress(i);
          await new Promise(r => setTimeout(r, 150));
        }
      }

      const newSession = {
        id: (result && result.sessionId) ? result.sessionId : Date.now(),
        name: clientName,
        phone: clientPhone,
        photographer: photographer,
        date: new Date().toLocaleString('pt-BR'),
        status: 'Pendente',
        driveStatus: result && result.accessToken ? 'synced' : 'pending',
        avatar: randomCover ? 'file:///' + randomCover.replace(/\\/g, '/') : null,
        photos: result && result.processedPhotos ? result.processedPhotos : []
      };

      if (onSessionCreated) {
        onSessionCreated(newSession);
      }
      window.dispatchEvent(new CustomEvent('session-created', { detail: newSession }));

    } catch (error) {
      console.error("Erro no processamento:", error);
      toast.error("Ocorreu um erro durante o upload.");
    } finally {
      setIsUploading(false);
      onClose();
    }
  };

  return (
    <Dialog
      open={isOpen}
      // Base UI não tem onInteractOutside/onEscapeKeyDown no Popup: o bloqueio
      // de fechamento durante o upload é interceptado aqui, no onOpenChange.
      onOpenChange={(open) => {
        if (isUploading) return;
        if (!open) handleClose();
      }}
    >
      <DialogContent
        className={`bg-brand-surface border-border sm:max-w-2xl sm:rounded-[2rem] p-8 ${isUploading ? '[&>button]:hidden' : ''}`}
      >
        <DialogHeader className="flex flex-row items-center gap-4 mb-2">
          <div className="w-14 h-14 shrink-0 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center border border-brand-accent/20 shadow-sm">
            <UserPlus className="h-6 w-6" />
          </div>
          <div>
            <DialogTitle className="text-2xl font-bold text-foreground tracking-tight text-left">Nova Ingestão de Cliente</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm mt-1 text-left">
              Cadastre o visitante e carregue as fotos do Cartão SD.
            </DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
          
          {step === 1 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-brand-ink ml-1 block">Nome Completo</label>
                  <Input 
                    type="text" 
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Ex: João da Silva"
                    required
                    autoFocus
                    disabled={isUploading}
                    className="h-11 rounded-xl bg-background border-border"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-brand-ink ml-1 block">CPF</label>
                  <Input 
                    type="text" 
                    value={clientCpf}
                    onChange={(e) => setClientCpf(e.target.value)}
                    placeholder="000.000.000-00"
                    disabled={isUploading}
                    autoComplete="new-password"
                    className="h-11 rounded-xl bg-background border-border font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-brand-ink ml-1 block">Telefone / WhatsApp</label>
                  <Input 
                    type="text" 
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                    disabled={isUploading}
                    className="h-11 rounded-xl bg-background border-border font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-brand-ink ml-1 block">Fotógrafo</label>
                  <Select value={photographer} onValueChange={(value) => setPhotographer(value ?? '')} disabled={isUploading}>
                    <SelectTrigger className="h-11 rounded-xl bg-background border-border text-foreground">
                      <SelectValue placeholder="Selecione o fotógrafo" />
                    </SelectTrigger>
                    <SelectContent>
                      {photographersList.length > 0 ? (
                        photographersList.map(emp => (
                          <SelectItem key={emp.id} value={emp.name}>
                            {emp.name} ({emp.role})
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="none" disabled>Nenhum operador cadastrado</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <hr className="border-t border-brand-border-dashed" />

              <div className="space-y-2">
                <label className="text-sm font-medium text-brand-ink ml-1 block">Seleção de Fotos (Cartão SD)</label>
                <div className="flex gap-3">
                  <Input 
                    type="text" 
                    value={selectedFiles.length > 0 ? selectedFiles.length + " foto(s) selecionada(s)" : ""}
                    readOnly
                    placeholder="Nenhuma foto selecionada"
                    className="flex-1 bg-brand-surface border-border border-dashed font-mono text-xs cursor-default h-11"
                  />
                  <button 
                    type="button"
                    onClick={handleSelectFiles}
                    disabled={isUploading}
                    className="flex items-center gap-2 bg-brand-bg hover:bg-brand-surface border border-brand-border text-brand-ink px-5 py-3 rounded-xl font-medium transition-colors text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ImageIcon className="h-4 w-4 shrink-0" />
                    Selecionar
                  </button>
                </div>
              </div>

              <div className="pt-2 flex gap-3 justify-end mt-2">
                <button 
                  type="button"
                  onClick={handleClose}
                  className="py-3 px-6 rounded-xl font-medium text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors text-sm border border-transparent"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="py-3 px-8 bg-brand-accent text-brand-accent-fg rounded-xl font-bold hover:opacity-90 transition-opacity text-sm shadow-sm"
                >
                  Avançar
                </button>
              </div>
            </>
          )}

          {step === 2 && !isUploading && (
            <div className="flex flex-col items-center justify-center text-center py-6 animate-in zoom-in-95 duration-200">
              <UploadCloud className="h-16 w-16 text-brand-accent mb-4" />
              <h3 className="text-xl font-semibold text-foreground">Confirmar Ingestão</h3>
              <p className="text-muted-foreground mt-2 max-w-[400px]">
                Atribuir o cliente <span className="font-bold text-foreground">{clientName}</span> ao fotógrafo <span className="font-bold text-foreground">{photographer}</span>?
              </p>
              
              <p className="text-xs text-brand-accent/80 font-medium bg-brand-accent/10 px-4 py-2 rounded-lg mt-4 max-w-[380px]">
                {selectedFiles.length} fotos serão importadas. Uma delas será escolhida aleatoriamente como capa do perfil.
              </p>

              <div className="flex gap-3 w-full mt-6">
                <button 
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-3 px-4 rounded-xl font-medium text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors text-sm border border-transparent"
                >
                  Voltar
                </button>
                <button 
                  type="button"
                  onClick={confirmAndUpload}
                  className="flex-1 py-3 px-4 bg-brand-accent text-brand-accent-fg rounded-xl font-bold hover:opacity-90 transition-opacity text-sm shadow-sm"
                >
                  Confirmar Ingestão
                </button>
              </div>
            </div>
          )}

          {isUploading && (
            <div className="w-full bg-brand-surface border border-brand-border p-5 rounded-2xl flex flex-col gap-3 shadow-sm py-8 mt-4 animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-brand-ink flex items-center gap-2">
                  <UploadCloud className="h-5 w-5 text-brand-accent animate-bounce" />
                  Enviando para o Google Drive...
                </span>
                <span className="font-mono font-bold text-brand-accent text-sm tracking-tight">
                  Processando fotos... {uploadProgress}%
                </span>
              </div>
              <div className="h-2.5 w-full bg-brand-bg rounded-full overflow-hidden border border-brand-border">
                <div 
                  className="h-full bg-brand-accent rounded-full transition-all duration-300 ease-out" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

        </form>

      </DialogContent>
    </Dialog>
  );
}
