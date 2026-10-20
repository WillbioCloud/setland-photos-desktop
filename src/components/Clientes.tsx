import React, { useState, useRef, useEffect } from 'react';
import { Search, Filter, MessageCircle, ShoppingCart, Cloud, CloudDrizzle, CloudOff, SearchX, Check, Database, ChevronDown, Download, Store, Camera, Send, Sparkles, LayoutList, LayoutGrid, User, Calendar, Phone } from 'lucide-react';
import { toast } from 'sonner';
import DriveSyncModal from './DriveSyncModal';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import ClientProfileModal from './ClientProfileModal';
import { supabase } from '@/lib/supabaseClient';
import {
  SESSION_PHOTO_SELECT,
  SESSION_PHOTO_SELECT_SAFE,
  fetchAllSessionPhotos,
  isMissingColumnError,
  isPhotoPurchased,
  mergeSessionPhotos,
  shapeSessionPhoto,
  type SessionPhoto,
} from '@/lib/sessionPhotos';
import {
  buildDriveDownloadMessage,
  buildOnlineStoreMessage,
  dispatchWhatsAppMessage,
  getOnlineShopUrl,
  normalizeWhatsAppPhone,
} from '@/lib/whatsapp';
import { publishCartPreset, type CartPresetPayload } from '@/lib/cartBridge';

export default function Clientes() {
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('Todos');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [syncModalClient, setSyncModalClient] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  
  const handleAddSession = (newSession: any) => {
    setClientsList(prev => [newSession, ...prev]);
  };

  useEffect(() => {
    const handleNewSession = (e: any) => handleAddSession(e.detail);
    window.addEventListener('session-created', handleNewSession);
    return () => window.removeEventListener('session-created', handleNewSession);
  }, []);

  useEffect(() => {
    loadClients();

    const handleSessionUpdated = () => {
      loadClients();
    };

    window.addEventListener('session-updated', handleSessionUpdated);
    window.addEventListener('drive-photo-synced', handleSessionUpdated);

    return () => {
      window.removeEventListener('session-updated', handleSessionUpdated);
      window.removeEventListener('drive-photo-synced', handleSessionUpdated);
    };
  }, []);

  // O modal de perfil é derivado da listagem (e não de uma cópia do objeto): fotos
  // recém-importadas do cartão SD aparecem sem precisar fechar e reabrir o modal.
  const selectedClient = React.useMemo(
    () => clientsList.find((client: any) => client.id === selectedClientId) || null,
    [clientsList, selectedClientId]
  );

  async function loadClients() {
    /**
     * Monta a consulta de sessões. A lista de fotos traz `expires_at` e `is_purchased`
     * (regras de expiração e de compra) — sem nenhum `limit` imposto pelo front.
     */
    const buildSessionsQuery = (photoColumns: string, includeSessionExpiry: boolean, includeEmployees: boolean = true) => {
      const sessionColumns = [
        'id',
        'created_at',
        'status',
        'drive_status',
        'drive_folder_id',
        'cover_photo_url',
        'local_cache_dir',
        'client_name',
        'client_cpf',
        'client_phone',
        'photographer_name',
      ];
      if (includeSessionExpiry) sessionColumns.push('expires_at');

      const selectClause = `
        ${sessionColumns.join(', ')},
        clients ( id, name, phone, cpf ),
        ${includeEmployees ? 'employees ( id, name, avatar_url ),' : ''}
        session_photos ( ${photoColumns} )
      `;

      return supabase
        .from('photo_sessions')
        .select(selectClause)
        .order('created_at', { ascending: false });
    };

    const [ { data, error }, { data: onlineOrders } ] = await Promise.all([
      // Consulta com fallback automático se a tabela employees tiver restrição de permissão RLS (42501)
      (async () => {
        let fullResult = await buildSessionsQuery(SESSION_PHOTO_SELECT, true, true);
        if (fullResult.error && (fullResult.error.code === '42501' || fullResult.error.message?.includes('employees'))) {
          console.warn('[Clientes] Sem permissão em employees. Executando query sem join de employees.');
          fullResult = await buildSessionsQuery(SESSION_PHOTO_SELECT, true, false);
        }
        if (!fullResult.error || !isMissingColumnError(fullResult.error)) return fullResult;

        console.warn(
          '[Clientes] Colunas opcionais ausentes em session_photos. Recarregando com consulta de compatibilidade.',
          fullResult.error.message
        );
        let safeResult = await buildSessionsQuery(SESSION_PHOTO_SELECT_SAFE, false, true);
        if (safeResult.error && (safeResult.error.code === '42501' || safeResult.error.message?.includes('employees'))) {
          safeResult = await buildSessionsQuery(SESSION_PHOTO_SELECT_SAFE, false, false);
        }
        return safeResult;
      })(),
      supabase.from('online_orders').select('client_id').in('payment_status', ['paid', 'delivered'])
    ]);
      
    if (error) {
      console.error('ERRO SUPABASE AO CARREGAR CLIENTES:', error);
      return;
    }

    if (data) {
      // 2ª camada de garantia: leitura dedicada e paginada de `session_photos`.
      // Garante que NENHUMA foto importada fique de fora por truncamento do embed.
      const sessionIds = data.map((item: any) => item.id).filter(Boolean);
      let allPhotos: SessionPhoto[] = [];
      try {
        allPhotos = await fetchAllSessionPhotos(sessionIds);
      } catch (photoErr) {
        console.warn('[Clientes] Falha ao complementar a listagem de fotos da sessão:', photoErr);
      }

      const photosBySession = new Map<string, SessionPhoto[]>();
      allPhotos.forEach((photo) => {
        const key = String(photo.sessionId || '');
        if (!key) return;
        const bucket = photosBySession.get(key);
        if (bucket) bucket.push(photo);
        else photosBySession.set(key, [photo]);
      });

      const mappedData = data.map((item: any) => {
        let currentStatus = item.status || 'Pendente';
        const hasOnlineOrder = onlineOrders?.some(o => o.client_id === item.clients?.id);
        
        if (hasOnlineOrder) {
           currentStatus = 'Site';
        } else if (currentStatus === 'Convertido/Pago') {
           currentStatus = 'PDV';
        }

        // Une as fotos do embed (SSD local) com as da leitura paginada (Nuvem), sem duplicar.
        const photos = mergeSessionPhotos(
          (item.session_photos || []).map(shapeSessionPhoto),
          photosBySession.get(String(item.id)) || []
        );

        return {
          id: item.id,
          clientId: item.clients?.id,
          name: item.clients?.name || item.client_name || 'Cliente Desconhecido',
          phone: item.clients?.phone || item.client_phone || '',
          cpf: item.clients?.cpf || item.client_cpf || '',
          photographer: item.employees?.name || item.photographer_name || 'Não atribuído',
          date: new Date(item.created_at).toLocaleString('pt-BR'),
          createdAt: item.created_at,
          expiresAt: item.expires_at || null,
          status: currentStatus,
          driveStatus: item.drive_status || 'pending',
          driveFolderId: item.drive_folder_id || null,
          avatar: item.cover_photo_url || item.employees?.avatar_url || null,
          photos,
          pendingPhotosCount: photos.filter((photo) => !isPhotoPurchased(photo)).length,
          purchasedPhotosCount: photos.filter(isPhotoPurchased).length,
        };
      });
      setClientsList(mappedData);
    }
  }
  
  const filterRef = useRef<HTMLDivElement>(null);
  const unconvertedRef = useRef<HTMLDivElement>(null);
  const [isUnconvertedOpen, setIsUnconvertedOpen] = useState(false);

  // Lista e contagem de clientes com status pendente
  const unconvertedClients = React.useMemo(() => {
    return clientsList.filter(
      (c) => c.status === 'Pendente' || c.status?.toLowerCase() === 'pendente' || c.status?.toLowerCase() === 'pending'
    );
  }, [clientsList]);

  const filters = ['Todos', 'Pendentes', 'Convertidos', 'Abandonados'];

  // Fecha os dropdowns e popovers ao clicar fora ou na tecla Esc
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
      if (unconvertedRef.current && !unconvertedRef.current.contains(event.target as Node)) {
        setIsUnconvertedOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsFilterOpen(false);
        setIsUnconvertedOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const getStatusBadge = (status: string) => {
    const base = "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full backdrop-blur-sm whitespace-nowrap shadow-sm transition-lux";
    switch (status) {
      case 'Pendente':
        return <span className={`${base} bg-muted text-muted-foreground border border-border dark:border-white/10`}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />Pendente</span>;
      case 'PDV':
      case 'Convertido/Pago':
        return <span className={`${base} bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25`}><span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />Convertido (PDV)</span>;
      case 'Site':
        return <span className={`${base} bg-brand-info/10 text-brand-info border border-brand-info/25`}><span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />Convertido (Site)</span>;
      case 'Abandonado':
        return <span className={`${base} bg-destructive/10 text-destructive border border-destructive/25`}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />Abandonado</span>;
      default:
        return null;
    }
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  };

  const filteredClients = clientsList.filter(client => {
    const matchesSearch = client.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = 
      activeFilter === 'Todos' ? true :
      activeFilter === 'Pendentes' ? client.status === 'Pendente' :
      activeFilter === 'Convertidos' ? (client.status === 'Convertido/Pago' || client.status === 'PDV' || client.status === 'Site') :
      client.status === 'Abandonado';
    return matchesSearch && matchesFilter;
  });

  /* ───────────────────────── Ações de WhatsApp / PDV ───────────────────────── */

  const [whatsappMenu, setWhatsappMenu] = useState<{ client: any; x: number; y: number } | null>(null);

  // Fecha o menu flutuante ao pressionar Esc, redimensionar a janela ou rolar a tabela.
  useEffect(() => {
    if (!whatsappMenu) return;

    const closeMenu = () => setWhatsappMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    document.addEventListener('scroll', closeMenu, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      document.removeEventListener('scroll', closeMenu, true);
    };
  }, [whatsappMenu]);

  const toggleWhatsAppMenu = (event: React.MouseEvent<HTMLButtonElement>, client: any) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setWhatsappMenu(prev =>
      prev?.client?.id === client.id ? null : { client, x: rect.right, y: rect.bottom + 8 }
    );
  };

  /** Recupera o ID da pasta no Drive: usa o cache da listagem e cai para o banco quando necessário. */
  const resolveDriveFolderId = async (client: any): Promise<string | null> => {
    if (client?.driveFolderId) return client.driveFolderId;
    try {
      const { data } = await supabase
        .from('photo_sessions')
        .select('drive_folder_id')
        .eq('id', client.id)
        .maybeSingle();
      return data?.drive_folder_id || null;
    } catch (err) {
      console.warn('[WhatsApp] Falha ao consultar a pasta do Drive:', err);
      return null;
    }
  };

  /** Ação 1: reenvia o link de download em alta resolução (pasta do Google Drive). */
  const handleResendDownloadLink = async (client: any) => {
    setWhatsappMenu(null);

    if (!normalizeWhatsAppPhone(client.phone)) {
      toast.error('Cliente sem telefone válido cadastrado.');
      return;
    }

    const toastId = toast.loading('Buscando a pasta de alta resolução no Google Drive...');
    const folderId = await resolveDriveFolderId(client);

    if (!folderId) {
      toast.error('Esta sessão ainda não possui pasta sincronizada no Google Drive.', {
        id: toastId,
        description: 'Conclua o upload das fotos compradas (ícone de nuvem na linha do cliente) antes de reenviar o link.'
      });
      return;
    }

    const driveLink = `https://drive.google.com/drive/folders/${folderId}`;
    const result = await dispatchWhatsAppMessage({
      phone: client.phone,
      message: buildDriveDownloadMessage(client.name, driveLink),
      clientName: client.name,
      clientCpf: client.cpf,
      source: 'desktop_reenvio_link_drive',
      extra: { driveLink }
    });

    if (result.channel === 'n8n') {
      toast.success('Link de download reenviado via WhatsApp!', { id: toastId, description: driveLink });
    } else if (result.sent) {
      toast.success('WhatsApp aberto com o link de download pronto para envio.', { id: toastId, description: driveLink });
    } else {
      toast.error('Não foi possível disparar a mensagem.', {
        id: toastId,
        description: 'Confira o telefone do cliente e as configurações de WhatsApp do sistema.'
      });
    }
  };

  /** Ação 2: convida o cliente a comprar pela vitrine online (PIX / Cartão). */
  const handleSendOnlineShopLink = async (client: any) => {
    setWhatsappMenu(null);

    if (!normalizeWhatsAppPhone(client.phone)) {
      toast.error('Cliente sem telefone válido cadastrado.');
      return;
    }

    const shopUrl = getOnlineShopUrl(client.id);
    const toastId = toast.loading('Preparando o link da vitrine online...');
    const result = await dispatchWhatsAppMessage({
      phone: client.phone,
      message: buildOnlineStoreMessage(client.name, shopUrl, client.cpf),
      clientName: client.name,
      clientCpf: client.cpf,
      source: 'desktop_link_compra_online',
      extra: { shopLink: shopUrl, link: shopUrl }
    });

    if (result.channel === 'n8n') {
      toast.success('Link de compra online enviado via WhatsApp!', { id: toastId, description: shopUrl });
    } else if (result.sent) {
      toast.success('WhatsApp aberto com o link da vitrine pronto para envio.', { id: toastId, description: shopUrl });
    } else {
      toast.error('Não foi possível disparar a mensagem.', {
        id: toastId,
        description: 'Confira o telefone do cliente e as configurações de WhatsApp do sistema.'
      });
    }
  };

  /** Botão de carrinho/PDV: abre o caixa já com a sessão deste cliente carregada. */
  const handleOpenCart = (client: any) => {
    const photos: SessionPhoto[] = client?.photos || [];
    const pendingPhotos = photos.filter((photo) => !isPhotoPurchased(photo));

    if (photos.length === 0) {
      toast.error('Nenhuma foto importada nesta sessão ainda.', {
        description: 'Importe as fotos do cartão SD (Novo Cliente) antes de abrir o caixa.'
      });
      return;
    }

    const payload: CartPresetPayload = {
      source: 'clientes',
      sessionId: client.id,
      clientId: client.clientId || null,
      clientName: client.name,
      clientPhone: client.phone,
      clientCpf: client.cpf,
      status: client.status,
      driveFolderId: client.driveFolderId || null,
      photos,
      pendingPhotos: pendingPhotos.length > 0 ? pendingPhotos : photos
    };

    // Publica o payload para o PDV (que é montado sob demanda) e mantém o evento global existente.
    publishCartPreset(payload);
    window.dispatchEvent(new CustomEvent('add-to-cart', { detail: payload }));

    toast.success(`Abrindo o caixa com a sessão de ${client.name}...`, {
      description: pendingPhotos.length > 0 
        ? `${pendingPhotos.length} foto(s) pendente(s) carregada(s).`
        : `${photos.length} foto(s) da sessão carregada(s) para venda/reimpressão.`
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pt-4">
      {/* Header & Busca */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Gestão de Clientes</h2>
          <p className="text-muted-foreground text-sm mt-1">Acompanhe e converta seus visitantes.</p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Botão de Câmera com Feedback Numérico e Balão Suspenso */}
          <div className="relative" ref={unconvertedRef}>
            <button
              onClick={() => setIsUnconvertedOpen(!isUnconvertedOpen)}
              className={`relative flex items-center justify-center p-2.5 rounded-full transition-lux bg-background dark:bg-white/[0.05] border shadow-sm active:scale-95 ${
                isUnconvertedOpen
                  ? 'border-primary ring-2 ring-primary/30 text-primary'
                  : 'border-input dark:border-white/10 text-foreground hover:bg-muted dark:hover:bg-white/[0.10]'
              }`}
              title="Clientes com status pendente"
              aria-label="Clientes com status pendente"
            >
              <Camera className="h-5 w-5"/>
              {unconvertedClients.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 bg-primary text-primary-foreground text-[11px] font-bold rounded-full flex items-center justify-center shadow-md animate-in zoom-in-75 duration-200 tabular-figures">
                  {unconvertedClients.length}
                </span>
              )}
            </button>

            {/* Balão Suspenso (Popover de Recuperação de Vendas) */}
            {isUnconvertedOpen && (
              <div className="absolute left-0 sm:left-auto sm:right-0 mt-3 w-80 sm:w-96 bg-card dark:bg-[#1A0B18]/95 dark:backdrop-blur-2xl border border-border dark:border-white/10 rounded-2xl shadow-2xl dark:shadow-black/70 lux-card z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                {/* Cabeçalho do Balão */}
                <div className="px-4 py-3 bg-muted/40 dark:bg-white/[0.03] border-b border-border-dashed flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary"/>
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Clientes Pendentes
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground font-mono bg-background dark:bg-white/[0.06] px-2 py-0.5 rounded-full border border-border/50">
                    {unconvertedClients.length} lead{unconvertedClients.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Lista de Clientes com Fotos Pendentes */}
                <div className="max-h-80 overflow-y-auto no-scrollbar divide-y divide-border-dashed dark:divide-white/[0.06]">
                  {unconvertedClients.length > 0 ? (
                    unconvertedClients.map((client) => (
                      <div
                        key={client.id}
                        className="p-3.5 flex items-center justify-between gap-3 hover:bg-muted/40 dark:hover:bg-white/[0.04] transition-colors"
                      >
                        <div
                          className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
                          onClick={() => {
                            setSelectedClientId(client.id);
                            setIsUnconvertedOpen(false);
                          }}
                        >
                          <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-primary/20 overflow-hidden">
                            {client.avatar ? (
                              <img src={client.avatar} alt={client.name} className="w-full h-full object-cover" />
                            ) : (
                              getInitials(client.name)
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground truncate leading-tight">
                              {client.name}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-muted-foreground font-mono truncate">
                                {client.phone || 'S/ Telefone'}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 bg-primary/10 text-primary rounded font-medium shrink-0">
                                {client.pendingPhotosCount || client.photos?.length || 0} fotos
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Botão de Disparo do Link de Compra Online */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSendOnlineShopLink(client);
                          }}
                          disabled={!client.phone}
                          className={`p-2 rounded-xl transition-lux flex items-center justify-center shrink-0 border shadow-sm active:scale-95 ${
                            client.phone
                              ? 'bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border-primary/20 hover:border-primary'
                              : 'bg-muted/40 text-muted-foreground/30 border-transparent cursor-not-allowed'
                          }`}
                          title={client.phone ? 'Enviar link de compra online no WhatsApp' : 'Cliente sem telefone'}
                        >
                          <Send className="h-4 w-4"/>
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="py-8 px-4 text-center">
                      <p className="text-xs text-muted-foreground">
                        Nenhum cliente com status pendente! 🎉
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-11 pr-4 py-2.5 bg-background dark:bg-white/[0.05] dark:backdrop-blur-xl shadow-sm dark:shadow-none lux-card rounded-full text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40 transition-lux w-64 border border-input dark:border-white/10"
            />
          </div>
          
          {/* Dropdown de Filtros */}
          <div className="relative" ref={filterRef}>
            <button 
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className="flex items-center gap-2 px-5 py-2.5 bg-background shadow-sm hover:bg-muted text-foreground rounded-full text-sm font-medium transition-colors border border-input"
            >
              <Filter className="h-4 w-4" />
              {activeFilter !== 'Todos' ? activeFilter : 'Filtros'}
            </button>
            
            {isFilterOpen && (
              <div className="absolute right-0 mt-3 w-48 bg-card dark:bg-[#1A0B18]/90 dark:backdrop-blur-xl border border-border dark:border-white/10 rounded-xl shadow-md dark:shadow-black/60 lux-card z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="py-2 flex flex-col">
                  {filters.map(filter => (
                    <button
                      key={filter}
                      onClick={() => {
                        setActiveFilter(filter);
                        setIsFilterOpen(false);
                      }}
                      className="flex items-center justify-between px-4 py-3 text-sm text-left hover:bg-muted transition-colors"
                    >
                      <span className={activeFilter === filter ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
                        {filter}
                      </span>
                      {activeFilter === filter && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Seletor de Modo de Visualização (Tabela clássica vs Grade de Cards moderna) */}
          <div className="flex items-center bg-background dark:bg-white/[0.05] border border-input dark:border-white/10 rounded-full p-1 shadow-sm">
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-full transition-lux ${
                viewMode === 'table'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Visualização em Lista / Tabela (Clássico)"
              aria-label="Visualização em Tabela"
            >
              <LayoutList className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-full transition-lux ${
                viewMode === 'grid'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Visualização em Grade / Cards (Moderno)"
              aria-label="Visualização em Grade"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* DataGrid Container Padronizado */}
      <Card className="shadow-sm overflow-hidden flex flex-col h-[calc(100vh-220px)] min-h-[480px]">
        {filteredClients.length > 0 ? (
          <CardContent className="p-0 flex-1 flex flex-col min-h-0 overflow-hidden">
            {viewMode === 'table' ? (
              <div className="flex-1 overflow-y-auto no-scrollbar [&_[data-slot=table-container]]:overflow-visible">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
                    <TableRow className="bg-muted/50 border-b-border-dashed">
                      <TableHead className="px-8 py-5">Cliente</TableHead>
                      <TableHead className="px-8 py-5">Fotógrafo</TableHead>
                      <TableHead className="px-8 py-5">Data / Nuvem</TableHead>
                      <TableHead className="px-8 py-5">Status</TableHead>
                      <TableHead className="px-8 py-5 text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredClients.map((client) => (
                      <TableRow
                        key={client.id}
                        onClick={() => setSelectedClientId(client.id)}
                        className="border-b-border-dashed dark:border-white/[0.06] cursor-pointer group hover:bg-muted/30 dark:hover:bg-white/[0.05] transition-colors duration-150 ease-out"
                      >
                        <TableCell className="px-8 py-5">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0 border border-primary/20 ring-2 ring-primary/10 group-hover:ring-primary/40 group-hover:bg-primary group-hover:text-primary-foreground shadow-sm transition-all duration-150 ease-out overflow-hidden">
                              {client.avatar ? (
                                <img src={client.avatar} alt={client.name} className="w-full h-full object-cover" />
                              ) : (
                                getInitials(client.name)
                              )}
                            </div>
                            <div>
                              <p className="font-medium text-foreground leading-tight">{client.name}</p>
                              <p className="text-xs text-muted-foreground font-mono mt-0.5">{client.phone || 'S/ Contato'}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="px-8 py-5">{client.photographer}</TableCell>
                        <TableCell className="px-8 py-5">
                          <div className="flex items-center gap-2.5">
                            <span className="font-mono tabular-figures text-xs text-muted-foreground">{client.date}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setSyncModalClient(client); }}
                              className="p-1.5 rounded-full bg-muted/50 dark:bg-white/[0.06] hover:bg-muted dark:hover:bg-white/[0.12] transition-lux flex items-center justify-center border border-border/60 dark:border-white/10 shadow-sm active:scale-95"
                              title={
                                !['PDV', 'Site'].includes(client.status) ? "Miniaturas salvas. Aguardando pagamento." :
                                client.driveStatus === 'synced' ? "Upload para o Drive concluído com sucesso!" :
                                client.driveStatus === 'error' ? "Erro crônico no upload para o Drive." :
                                "Enviando fotos para o Drive em background..."
                              }
                            >
                              {!['PDV', 'Site'].includes(client.status) ? (
                                <Database className="h-4 w-4 text-muted-foreground" />
                              ) : client.driveStatus === 'synced' ? (
                                <Cloud className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              ) : client.driveStatus === 'error' ? (
                                <CloudOff className="h-4 w-4 text-destructive" />
                              ) : (
                                <CloudDrizzle className="h-4 w-4 text-primary animate-pulse" />
                              )}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="px-8 py-5">{getStatusBadge(client.status)}</TableCell>
                        <TableCell className="px-8 py-5">
                          <div className="flex items-center justify-end gap-2">
                            {/* Botão de WhatsApp (dropdown de ações de mensagem) */}
                            <button
                              onClick={(e) => toggleWhatsAppMenu(e, client)}
                              className={`flex items-center gap-1 p-2.5 rounded-full transition-lux bg-card dark:bg-white/[0.06] shadow-sm hover:bg-muted dark:hover:bg-white/[0.12] border active:scale-95
                                ${client.phone
                                  ? `text-primary border-border dark:border-white/10 ${whatsappMenu?.client?.id === client.id ? 'ring-2 ring-primary/40 bg-muted dark:bg-white/[0.12]' : ''}`
                                  : 'text-muted-foreground/30 cursor-not-allowed border-border dark:border-white/10'
                                }
                              `}
                              title={client.phone ? "Ações de WhatsApp" : "Sem telefone cadastrado"}
                              disabled={!client.phone}
                              aria-haspopup="menu"
                              aria-expanded={whatsappMenu?.client?.id === client.id}
                            >
                              <MessageCircle className="h-4 w-4" />
                              <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${whatsappMenu?.client?.id === client.id ? 'rotate-180' : ''}`} />
                            </button>
                            {/* Botão de PDV: abre o caixa já com a sessão deste cliente carregada */}
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleOpenCart(client); }}
                              className="p-2.5 rounded-full text-foreground hover:bg-muted transition-colors bg-card shadow-sm border border-border ml-2 active:scale-95"
                              title={client.pendingPhotosCount > 0
                                ? `Faturar ${client.pendingPhotosCount} foto(s) no PDV`
                                : "Vender (PDV)"}
                            >
                              <ShoppingCart className="h-4 w-4" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              /* Visualização em Grade / Cards (Moderno) */
              <div className="flex-1 overflow-y-auto no-scrollbar p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredClients.map((client) => (
                    <div
                      key={client.id}
                      onClick={() => setSelectedClientId(client.id)}
                      className="group relative bg-card dark:bg-[#1A0B18]/70 border border-border dark:border-white/10 hover:border-primary/40 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col justify-between"
                    >
                      <div>
                        {/* Imagem de Capa da Sessão ou Avatar */}
                        <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-muted mb-3 border border-border/50">
                          {client.avatar ? (
                            <img
                              src={client.avatar}
                              alt={client.name}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-primary/10 text-primary">
                              <span className="text-3xl font-bold">{getInitials(client.name)}</span>
                            </div>
                          )}
                          <div className="absolute top-2 left-2">
                            {getStatusBadge(client.status)}
                          </div>
                          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[11px] font-mono text-white/90">
                            {client.photos?.length || 0} fotos
                          </div>
                        </div>

                        {/* Detalhes do Cliente */}
                        <h4 className="font-semibold text-foreground text-base truncate group-hover:text-primary transition-colors">
                          {client.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground font-mono truncate">
                          <Phone className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                          <span>{client.phone || 'Sem telefone'}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground truncate">
                          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                          <span>{client.photographer}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground font-mono">
                          <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                          <span>{client.date}</span>
                        </div>
                      </div>

                      {/* Rodapé do Card com Ações */}
                      <div className="flex items-center justify-between pt-3 mt-3 border-t border-border-dashed dark:border-white/[0.06]">
                        {/* Status Nuvem */}
                        <button
                          onClick={(e) => { e.stopPropagation(); setSyncModalClient(client); }}
                          className="p-1.5 rounded-full hover:bg-muted transition-colors flex items-center justify-center"
                          title="Sincronização Google Drive"
                        >
                          {!['PDV', 'Site'].includes(client.status) ? (
                            <Database className="h-4 w-4 text-muted-foreground" />
                          ) : client.driveStatus === 'synced' ? (
                            <Cloud className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          ) : client.driveStatus === 'error' ? (
                            <CloudOff className="h-4 w-4 text-destructive" />
                          ) : (
                            <CloudDrizzle className="h-4 w-4 text-primary animate-pulse" />
                          )}
                        </button>

                        <div className="flex items-center gap-1.5">
                          {/* Botão de WhatsApp */}
                          <button
                            onClick={(e) => toggleWhatsAppMenu(e, client)}
                            className={`flex items-center gap-1 p-2 rounded-full transition-lux bg-background dark:bg-white/[0.06] shadow-sm hover:bg-muted border active:scale-95 ${
                              client.phone
                                ? 'text-primary border-border dark:border-white/10'
                                : 'text-muted-foreground/30 cursor-not-allowed border-border dark:border-white/10'
                            }`}
                            title={client.phone ? "Ações de WhatsApp" : "Sem telefone"}
                            disabled={!client.phone}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            <ChevronDown className="h-3 w-3" />
                          </button>

                          {/* Botão de PDV */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleOpenCart(client); }}
                            className="p-2 rounded-full text-foreground hover:bg-muted transition-colors bg-background dark:bg-white/[0.06] shadow-sm border border-border dark:border-white/10 active:scale-95"
                            title="Vender no PDV"
                          >
                            <ShoppingCart className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Rodapé: Paginação Simulada */}
            <div className="px-8 py-4 bg-muted/30 dark:bg-white/[0.02] border-t border-border-dashed dark:border-white/[0.06] text-xs text-muted-foreground flex justify-between items-center shrink-0">
              <p>Exibindo <span className="font-mono tabular-figures font-medium text-foreground">1</span> a <span className="font-mono tabular-figures font-medium text-foreground">{filteredClients.length}</span> de <span className="font-mono tabular-figures font-medium text-foreground">{clientsList.length}</span> leads</p>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-border dark:border-white/10 hover:bg-background dark:hover:bg-white/[0.08] text-foreground font-medium disabled:opacity-50 transition-lux active:scale-95">Anterior</button>
                <button className="px-3 py-1.5 rounded-lg border border-border dark:border-white/10 hover:bg-background dark:hover:bg-white/[0.08] text-foreground font-medium transition-lux active:scale-95">Próxima</button>
              </div>
            </div>
          </CardContent>
        ) : (
          /* Empty State */
          <CardContent className="flex-1 flex flex-col items-center justify-center py-24 px-6 text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6 shadow-sm border border-border">
              <SearchX className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Nenhum lead encontrado</h3>
            <p className="text-muted-foreground text-sm max-w-md">Não encontramos nenhum cliente correspondente à sua busca ou filtro atual. Tente alterar os termos na barra de pesquisa.</p>
          </CardContent>
        )}
      </Card>

      <ClientProfileModal 
        isOpen={!!selectedClientId} 
        onClose={() => setSelectedClientId(null)} 
        client={selectedClient} 
      />
      <DriveSyncModal 
        isOpen={!!syncModalClient}
        onClose={() => setSyncModalClient(null)}
        client={syncModalClient}
      />

      {/* Menu flutuante de ações do WhatsApp (position: fixed para não ser cortado pelo scroll da tabela) */}
      {whatsappMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setWhatsappMenu(null)} />
          <div
            role="menu"
            className="fixed z-[61] w-80 bg-card dark:bg-[#1A0B18]/95 dark:backdrop-blur-xl border border-border dark:border-white/10 rounded-2xl shadow-xl dark:shadow-black/60 lux-card overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
            style={{
              top: whatsappMenu.y + 190 > window.innerHeight ? Math.max(12, whatsappMenu.y - 198) : whatsappMenu.y,
              left: Math.max(12, Math.min(whatsappMenu.x - 320, window.innerWidth - 332)),
            }}
          >
            <div className="px-4 pt-3 pb-2 border-b border-border-dashed">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">
                WhatsApp · {whatsappMenu.client.name}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                {whatsappMenu.client.phone || 'Sem telefone'}
              </p>
            </div>

            <button
              role="menuitem"
              onClick={() => handleResendDownloadLink(whatsappMenu.client)}
              className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted dark:hover:bg-white/[0.06] transition-colors"
            >
              <Download className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-semibold text-foreground">Reenviar Link de Download</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">Alta resolução (Google Drive) — use em caso de erro no envio anterior.</span>
              </span>
            </button>

            <button
              role="menuitem"
              onClick={() => handleSendOnlineShopLink(whatsappMenu.client)}
              className="w-full flex items-start gap-3 px-4 py-3 text-left border-t border-border-dashed hover:bg-muted dark:hover:bg-white/[0.06] transition-colors"
            >
              <Store className="h-4 w-4 text-brand-info mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-semibold text-foreground">Enviar Link de Compra Online</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">Vitrine do site para escolher e pagar via PIX ou Cartão.</span>
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
