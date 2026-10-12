import React, { useState } from 'react';
import { X, Cloud, CloudUpload, Camera, CheckCircle2, User, Phone, DollarSign, Printer, Trash2, Globe, Monitor, Loader2, Plus, Store, Clock, Check, ImageOff } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from "sonner";
import PresentationModal from './PresentationModal';
import SelectionFormatModal from './SelectionFormatModal';
import { supabase } from '@/lib/supabaseClient';
import { calculatePricing, type PackageDef } from '@/lib/pricingEngine';
import {
  fetchAllSessionPhotos,
  getPhotoExpiryInfo,
  isPhotoPurchased,
  mergeSessionPhotos,
  shapeSessionPhoto,
  type SessionPhoto,
} from '@/lib/sessionPhotos';

interface ClientProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  client: any; // O objeto do cliente selecionado
}

const mockPhotos = [
  { id: 1, url: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?q=80&w=300&auto=format&fit=crop', status: 'synced' },
  { id: 2, url: 'https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=300&auto=format&fit=crop', status: 'synced' },
  { id: 3, url: 'https://images.unsplash.com/photo-1520854221256-17451cc331bf?q=80&w=300&auto=format&fit=crop', status: 'pending' },
  { id: 4, url: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?q=80&w=300&auto=format&fit=crop', status: 'pending' },
];

/**
 * Selo de expiração (contagem regressiva de 30 dias da retenção das fotos).
 * Em alerta (vermelho pulsante) quando faltam 3 dias ou menos para a exclusão física.
 */
function PhotoExpiryBadge({ photo, fallbackDate }: { photo: any; fallbackDate?: unknown }) {
  const { daysRemaining, isUrgent, label } = getPhotoExpiryInfo(photo, fallbackDate);

  if (daysRemaining === null) return null;

  return (
    <div
      className={`absolute bottom-2 right-2 flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border pointer-events-none backdrop-blur-sm
        ${isUrgent
          ? 'bg-rose-500/80 text-white border-rose-400 animate-pulse'
          : 'bg-black/60 text-white/80 border-white/10'
        }`}
      title="Exclusão física programada pelo robô de limpeza de 30 dias"
    >
      <Clock className="h-3 w-3" />
      {label}
    </div>
  );
}

export default function ClientProfileModal({ isOpen, onClose, client }: ClientProfileModalProps) {
  const [selectedPhotos, setSelectedPhotos] = useState<(string | number)[]>([]);
  const [printer, setPrinter] = useState("");
  const [printFormat, setPrintFormat] = useState("Apenas Imprimir (Avulsa)");
  const [isPresenting, setIsPresenting] = useState(false);
  const [isFormatModalOpen, setIsFormatModalOpen] = useState(false);

  const [activePhotoTab, setActivePhotoTab] = useState<'apresentacao' | 'site'>('apresentacao');
  const [photosList, setPhotosList] = useState<SessionPhoto[]>(() => (client?.photos || []).map(shapeSessionPhoto));
  const [orderInfo, setOrderInfo] = useState<{ total: number; source: string | null }>({ total: 0, source: null });

  const sessionId = client?.id;

  /**
   * Hidrata a listagem com TODAS as fotos da sessão gravadas em `session_photos`.
   * O array recebido por props pode estar desatualizado (foto recém-importada) ou truncado,
   * então a leitura é paginada e sem limit, unindo SSD local (`local_original_path`) e Nuvem
   * (`preview_url`) — nenhuma foto importada fica oculta da listagem.
   */
  const syncSessionPhotos = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      const fromDatabase = await fetchAllSessionPhotos([sessionId]);
      if (fromDatabase.length === 0) return;
      setPhotosList(prev => mergeSessionPhotos(prev.map(shapeSessionPhoto), fromDatabase));
    } catch (err) {
      console.warn('[Modal Cliente] Falha ao carregar todas as fotos da sessão:', err);
    }
  }, [sessionId]);

  React.useEffect(() => {
    if (client?.photos) setPhotosList((client.photos || []).map(shapeSessionPhoto));
    void syncSessionPhotos();

    async function fetchOrderDetails() {
      if (!client) return;
      // 1. Tenta achar venda no balcão (PDV)
      const { data: pdvOrder } = await supabase.from('orders').select('total_amount').eq('session_id', client.id).eq('status', 'paid').maybeSingle();
      if (pdvOrder) {
        return setOrderInfo({ total: Number(pdvOrder.total_amount), source: 'PDV' });
      }
      
      // 2. Tenta achar venda no site
      if (client.clientId) {
        const { data: webOrder } = await supabase.from('online_orders').select('total_amount').eq('client_id', client.clientId).in('payment_status', ['paid', 'delivered']).maybeSingle();
        if (webOrder) {
          return setOrderInfo({ total: Number(webOrder.total_amount), source: 'Site' });
        }
      }
      setOrderInfo({ total: 0, source: null });
    }
    fetchOrderDetails();
  }, [client, syncSessionPhotos]);

  // Espelha em tempo real novas importações e uploads enquanto o modal está aberto.
  React.useEffect(() => {
    if (!isOpen || !sessionId) return;

    const handleRefresh = () => { void syncSessionPhotos(); };

    window.addEventListener('session-updated', handleRefresh);
    window.addEventListener('drive-photo-synced', handleRefresh);

    return () => {
      window.removeEventListener('session-updated', handleRefresh);
      window.removeEventListener('drive-photo-synced', handleRefresh);
    };
  }, [isOpen, sessionId, syncSessionPhotos]);

  const sessionPhotos = photosList;
  // Fotos exibíveis em tela cheia precisam de uma fonte real (SSD local ou Nuvem).
  const presentablePhotos = sessionPhotos.filter(photo => Boolean(photo.url));
  // Data de referência para projetar 30 dias de retenção quando a foto não tem `expires_at`.
  const sessionReferenceDate = client?.createdAt || client?.date;
  // Fonte da imagem: prioriza o original do SSD e cai para a miniatura da Nuvem.
  const getPhotoSource = (photo: any) => photo?.localOriginalPath || photo?.previewUrl || photo?.url || '';
  const getCloudSource = (photo: any) => photo?.previewUrl || photo?.localOriginalPath || photo?.url || '';

  const handleDeletePhoto = async (photoId: string | number) => {
    const toastId = toast.loading("Removendo foto do banco de dados...");
    try {
      const { error } = await supabase.from('session_photos').delete().eq('id', photoId);
      if (error) throw error;
      setPhotosList((prev: any[]) => prev.filter(p => p.id !== photoId));
      window.dispatchEvent(new CustomEvent('session-updated'));
      toast.success("Foto removida do site com sucesso!", { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao excluir foto: " + (err.message || 'Erro inesperado'), { id: toastId });
    }
  };

  const [isAddingPhotos, setIsAddingPhotos] = useState(false);

  const handleAddMorePhotos = async () => {
    if (isAddingPhotos) return;
    try {
      // @ts-ignore
      if (!window.electronAPI || !window.electronAPI.selectFiles) {
        toast.error("Seleção de arquivos indisponível no ambiente web.");
        return;
      }

      // @ts-ignore
      const selectedFiles = await window.electronAPI.selectFiles();
      if (!selectedFiles || selectedFiles.length === 0) return;

      setIsAddingPhotos(true);
      const toastId = toast.loading(`Importando ${selectedFiles.length} foto(s)...`);

      // @ts-ignore
      const result = await window.electronAPI.appendPhotos({
        sessionId: client.id,
        filePaths: selectedFiles,
        clientName: client.name
      });

      if (result && result.success && result.processedPhotos) {
        setPhotosList((prev: any[]) => [...prev, ...result.processedPhotos]);
        window.dispatchEvent(new CustomEvent('session-updated'));
        toast.success(`${result.processedPhotos.length} nova(s) foto(s) adicionada(s) à sessão!`, { id: toastId });
      } else {
        throw new Error(result?.message || "Falha ao processar novas fotos.");
      }
    } catch (err: any) {
      console.error("Erro ao adicionar fotos:", err);
      toast.error(err.message || "Erro ao adicionar fotos à sessão.");
    } finally {
      setIsAddingPhotos(false);
    }
  };

  if (!isOpen || !client) return null;

  // Extrair Iniciais
  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  };

  const togglePhoto = (id: string | number) => {
    setSelectedPhotos(prev => 
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const handlePrint = async () => {
    if (!printer) {
      toast.error("Selecione uma impressora de destino primeiro!");
      return;
    }
    
    const toastId = toast.loading("Enviando para " + printer + "...");
    await new Promise(resolve => setTimeout(resolve, 1500));
    toast.success(selectedPhotos.length + " fotos enviadas no formato: " + printFormat, { id: toastId });
    setSelectedPhotos([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/40 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-4xl bg-brand-surface rounded-[2rem] border border-brand-border p-8 shadow-sm max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Ações do Topo Direito: Adicionar Fotos + Botão Fechar */}
        <div className="absolute right-6 top-6 flex items-center gap-3">
          <Button 
            variant="outline" 
            size="sm" 
            className="rounded-full border-brand-accent/20 text-brand-accent hover:bg-brand-accent/10 transition-colors"
            onClick={handleAddMorePhotos}
            disabled={isAddingPhotos}
          >
            {isAddingPhotos ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importando...</>
            ) : (
              <><Plus className="w-4 h-4 mr-2" /> Adicionar Fotos</>
            )}
          </Button>
          <button 
            onClick={onClose}
            className="p-2 rounded-full text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Header */}
        <div className="flex items-start gap-6 mb-8 pr-48 shrink-0">
          <div className="w-20 h-20 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center text-2xl font-bold border border-brand-accent/20 shadow-sm shrink-0 overflow-hidden">
            {client.avatar ? (
              <img src={client.avatar} alt={client.name} className="w-full h-full object-cover" />
            ) : (
              getInitials(client.name)
            )}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3 mb-1">
              <h2 className="text-2xl font-bold text-brand-ink">{client.name}</h2>
              <div className="flex items-center gap-1.5 px-3 py-1 bg-brand-accent/10 text-brand-accent rounded-full text-xs font-medium border border-brand-accent/20">
                <Cloud className="h-3.5 w-3.5" />
                {photosList.length} foto(s) na sessão
              </div>
              {sessionPhotos.some(isPhotoPurchased) && (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600/10 text-emerald-600 rounded-full text-xs font-medium border border-emerald-600/25">
                  <Check className="h-3.5 w-3.5" />
                  {sessionPhotos.filter(isPhotoPurchased).length} comprada(s)
                </div>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-6 mt-3">
              <div className="flex items-center gap-2 text-brand-muted text-sm">
                <Phone className="h-4 w-4" />
                <span className="font-mono">{client.phone || 'Sem telefone cadastrado'}</span>
              </div>
              <div className="flex items-center gap-2 text-brand-muted text-sm">
                <User className="h-4 w-4" />
                <span>{client.photographer}</span>
              </div>
              <div className="flex items-center gap-2 text-brand-muted text-sm">
                <DollarSign className="h-4 w-4" />
                <span className="font-mono font-medium text-brand-ink flex items-center gap-2">
                  {orderInfo.source ? (
                    <>
                      R$ {orderInfo.total.toFixed(2).replace('.', ',')}
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${orderInfo.source === 'Site' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'}`}>
                        {orderInfo.source === 'Site' ? <Globe className="w-3 h-3" /> : <Store className="w-3 h-3" />}
                        {orderInfo.source}
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-brand-muted font-normal">Aguardando Pagamento</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-8 no-scrollbar relative">
          


          {/* Galeria com Abas de Apresentação e Site */}
          <div>
            {/* Botões das Abas */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex bg-brand-bg p-1 rounded-xl w-fit border border-brand-border shadow-sm">
                <button
                  onClick={() => setActivePhotoTab('apresentacao')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${ activePhotoTab === 'apresentacao' ? 'bg-brand-surface text-brand-ink shadow-sm' : 'text-brand-muted hover:text-brand-ink' }`}
                >
                  <Monitor className="h-4 w-4" />
                  Apresentação (Original SSD)
                </button>
                <button
                  onClick={() => setActivePhotoTab('site')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${ activePhotoTab === 'site' ? 'bg-brand-surface text-brand-ink shadow-sm' : 'text-brand-muted hover:text-brand-ink' }`}
                >
                  <Globe className="h-4 w-4" />
                  Fotos do Site (Nuvem)
                </button>
              </div>

              {/* Botão de Modo Apresentação */}
              {activePhotoTab === 'apresentacao' && (
                <Button variant="outline" onClick={() => setIsPresenting(true)} className="rounded-xl shadow-sm text-xs h-9">
                  Modo Apresentação
                </Button>
              )}
            </div>

            {/* Estado vazio: sessão sem fotos importadas */}
            {sessionPhotos.length === 0 && (
              <div className="py-16 text-center flex flex-col items-center border border-dashed border-brand-border rounded-2xl">
                <ImageOff className="h-8 w-8 text-brand-muted mb-3" />
                <p className="text-brand-ink text-sm font-medium">Nenhuma foto importada nesta sessão</p>
                <p className="text-brand-muted text-xs mt-1 max-w-sm">
                  Use “Adicionar Fotos” para importar do cartão SD / SSD e vincular à sessão deste cliente.
                </p>
              </div>
            )}

            {/* Grid da Aba Apresentação (Fotos Originais do SSD em Alta Resolução) */}
            {activePhotoTab === 'apresentacao' && sessionPhotos.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {sessionPhotos.map((photo: any) => {
                  const isSelected = selectedPhotos.includes(photo.id);
                  const source = getPhotoSource(photo);
                  return (
                    <div
                      key={photo.id}
                      onClick={() => togglePhoto(photo.id)}
                      className={`relative aspect-square rounded-xl overflow-hidden bg-brand-bg border shadow-sm group cursor-pointer transition-all ${isSelected ? 'ring-4 ring-primary border-transparent' : 'border-brand-border'}`}
                    >
                      {source ? (
                        <img
                          src={source}
                          alt={photo.originalName || "Foto da sessão"}
                          onError={(e) => {
                            const fallback = getCloudSource(photo);
                            if (fallback && e.currentTarget.src !== fallback) {
                              e.currentTarget.src = fallback;
                            }
                          }}
                          className={`w-full h-full object-cover transition-transform duration-500 ${isSelected ? 'scale-105' : 'group-hover:scale-105'}`}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-brand-muted">
                          <ImageOff className="h-6 w-6" />
                          <span className="text-[10px]">Sem arquivo</span>
                        </div>
                      )}

                      {/* Selo verde: foto já adquirida pelo cliente */}
                      {isPhotoPurchased(photo) && (
                        <div className="absolute top-2 left-2 bg-emerald-600/90 text-white rounded-md px-2 py-0.5 text-[10px] font-bold shadow flex items-center gap-1 pointer-events-none">
                          <Check className="h-3 w-3" />
                          Comprada
                        </div>
                      )}

                      {/* Contagem regressiva para a exclusão física da foto */}
                      <PhotoExpiryBadge photo={photo} fallbackDate={sessionReferenceDate} />

                      {isSelected && (
                        <div className="absolute top-2 right-2 p-1.5 rounded-full shadow-sm backdrop-blur-md bg-brand-surface/90 border border-brand-border">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Grid da Aba Fotos do Site (Miniaturas WebP com Nuvem + Ação de Excluir) */}
            {activePhotoTab === 'site' && sessionPhotos.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {sessionPhotos.map((photo: any) => {
                  const cloudSource = getCloudSource(photo);
                  return (
                    <div
                      key={photo.id}
                      className="relative aspect-square rounded-xl overflow-hidden bg-brand-bg border border-brand-border shadow-sm group"
                    >
                      {cloudSource ? (
                        <img
                          src={cloudSource}
                          alt={photo.originalName || "Miniatura WebP da Nuvem"}
                          onError={(e) => {
                            const fallback = getPhotoSource(photo);
                            if (fallback && e.currentTarget.src !== fallback) {
                              e.currentTarget.src = fallback;
                            }
                          }}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-brand-muted">
                          <ImageOff className="h-6 w-6" />
                          <span className="text-[10px]">Sem miniatura</span>
                        </div>
                      )}

                      {/* Selo verde: foto já adquirida pelo cliente */}
                      {isPhotoPurchased(photo) && (
                        <div className="absolute top-2 left-2 bg-emerald-600/90 text-white rounded-md px-2 py-0.5 text-[10px] font-bold shadow flex items-center gap-1 pointer-events-none">
                          <Check className="h-3 w-3" />
                          Comprada
                        </div>
                      )}

                      {/* Botão de Excluir Foto do Banco */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePhoto(photo.id);
                        }}
                        className="absolute top-2 right-2 p-2 rounded-lg bg-black/60 text-white hover:bg-destructive transition-colors backdrop-blur-sm shadow-md"
                        title="Excluir do banco de dados"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      
                      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-1 bg-black/60 backdrop-blur-sm text-white/90 rounded-md text-[10px] font-medium border border-white/10">
                        <Cloud className="w-3 h-3" /> Nuvem / Site
                      </div>

                      {/* Contagem regressiva para a exclusão física da foto */}
                      <PhotoExpiryBadge photo={photo} fallbackDate={sessionReferenceDate} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <PresentationModal 
        isOpen={isPresenting}
        onClose={() => setIsPresenting(false)}
        photos={presentablePhotos}
        selectedPhotos={selectedPhotos}
        togglePhoto={togglePhoto}
        onConfirmSelection={() => {
          setIsPresenting(false);
          setIsFormatModalOpen(true);
        }}
      />
      <SelectionFormatModal 
        isOpen={isFormatModalOpen}
        onClose={() => setIsFormatModalOpen(false)}
        photos={sessionPhotos}
        selectedPhotoIds={selectedPhotos}
        clientName={client?.name || "Cliente"}
        sessionId={client?.id}
      />
    </div>
  );
}
