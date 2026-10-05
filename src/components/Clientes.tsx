import React, { useState, useRef, useEffect } from 'react';
import { Search, Filter, MessageCircle, ShoppingCart, Cloud, CloudDrizzle, CloudOff, SearchX, Check, Database } from 'lucide-react';
import DriveSyncModal from './DriveSyncModal';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import ClientProfileModal from './ClientProfileModal';
import { supabase } from '@/lib/supabaseClient';

export default function Clientes() {
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('Todos');
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [syncModalClient, setSyncModalClient] = useState<any>(null);
  
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

  async function loadClients() {
    const [ { data, error }, { data: onlineOrders } ] = await Promise.all([
      supabase
        .from('photo_sessions')
        .select(`
          id,
          created_at,
          status,
          drive_status,
          cover_photo_url,
          local_cache_dir,
          clients ( id, name, phone, cpf ),
          employees ( id, name, avatar_url ),
          session_photos ( id, original_name, preview_url, local_original_path, status )
        `)
        .order('created_at', { ascending: false }),
      supabase.from('online_orders').select('client_id').in('payment_status', ['paid', 'delivered'])
    ]);
      
    if (error) {
      console.error('ERRO SUPABASE AO CARREGAR CLIENTES:', error);
      return;
    }

    if (data) {
      const mappedData = data.map((item: any) => {
        let currentStatus = item.status || 'Pendente';
        const hasOnlineOrder = onlineOrders?.some(o => o.client_id === item.clients?.id);
        
        if (hasOnlineOrder) {
           currentStatus = 'Site';
        } else if (currentStatus === 'Convertido/Pago') {
           currentStatus = 'PDV';
        }

        return {
          id: item.id,
          clientId: item.clients?.id,
          name: item.clients?.name || 'Cliente Desconhecido',
          phone: item.clients?.phone || '',
          cpf: item.clients?.cpf || '',
          photographer: item.employees?.name || 'Não atribuído',
          date: new Date(item.created_at).toLocaleString('pt-BR'),
          status: currentStatus,
        driveStatus: item.drive_status || 'pending',
        avatar: item.cover_photo_url || item.employees?.avatar_url || null,
        photos: (item.session_photos || []).map((sp: any) => ({
          id: sp.id,
          url: sp.local_original_path || sp.preview_url,
          localOriginalPath: sp.local_original_path,
          previewUrl: sp.preview_url,
          originalName: sp.original_name,
          status: sp.status
        }))
        };
      });
      setClientsList(mappedData);
    }
  }
  
  const filterRef = useRef<HTMLDivElement>(null);

  const filters = ['Todos', 'Pendentes', 'Convertidos', 'Abandonados'];

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Pendente':
        return <span className="px-3 py-1 text-xs font-semibold rounded-full bg-muted text-muted-foreground">Pendente</span>;
      case 'PDV':
      case 'Convertido/Pago':
        return <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Convertido (PDV)</span>;
      case 'Site':
        return <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20">Convertido (Site)</span>;
      case 'Abandonado':
        return <span className="px-3 py-1 text-xs font-semibold rounded-full bg-destructive/10 text-destructive">Abandonado</span>;
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pt-4">
      {/* Header & Busca */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Gestão de Clientes</h2>
          <p className="text-muted-foreground text-sm mt-1">Acompanhe e converta seus visitantes.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Buscar cliente..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-11 pr-4 py-2.5 bg-background shadow-sm rounded-full text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all w-64 border border-input"
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
              <div className="absolute right-0 mt-3 w-48 bg-card border border-border rounded-xl shadow-md z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
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
        </div>
      </div>

      {/* DataGrid Container */}
      <Card className="shadow-sm overflow-hidden flex flex-col">
        {filteredClients.length > 0 ? (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
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
                      onClick={() => setSelectedClient(client)}
                      className="border-b-border-dashed cursor-pointer group hover:bg-muted/30"
                    >
                      <TableCell className="px-8 py-5">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0 border border-primary/20 group-hover:bg-primary group-hover:text-primary-foreground transition-colors overflow-hidden">
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
                          <span className="font-mono text-xs text-muted-foreground">{client.date}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSyncModalClient(client); }}
                            className="p-1.5 rounded-md hover:bg-muted transition-colors flex items-center justify-center border border-transparent hover:border-border"
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
                          {/* Botão de WhatsApp */}
                          <button 
                            onClick={(e) => { e.stopPropagation(); }}
                            className={`p-2.5 rounded-full transition-colors bg-card shadow-sm hover:bg-muted border border-border
                              ${client.phone ? 'text-primary' : 'text-muted-foreground/30 cursor-not-allowed'}
                            `}
                            title={client.phone ? "WhatsApp" : "Sem telefone"}
                            disabled={!client.phone}
                          >
                            <MessageCircle className="h-4 w-4" />
                          </button>
                          {/* Botão de PDV */}
                          <button 
                            onClick={(e) => { e.stopPropagation(); }}
                            className="p-2.5 rounded-full text-foreground hover:bg-muted transition-colors bg-card shadow-sm border border-border ml-2"
                            title="Vender (PDV)"
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
            
            {/* Rodapé: Paginação Simulada */}
            <div className="px-8 py-4 bg-muted/30 border-t border-border-dashed text-xs text-muted-foreground flex justify-between items-center shrink-0">
              <p>Exibindo <span className="font-mono font-medium text-foreground">1</span> a <span className="font-mono font-medium text-foreground">{filteredClients.length}</span> de <span className="font-mono font-medium text-foreground">{clientsList.length}</span> leads</p>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 rounded-lg border border-border hover:bg-background text-foreground font-medium disabled:opacity-50 transition-colors">Anterior</button>
                <button className="px-3 py-1.5 rounded-lg border border-border hover:bg-background text-foreground font-medium transition-colors">Próxima</button>
              </div>
            </div>
          </CardContent>
        ) : (
          /* Empty State */
          <CardContent className="flex flex-col items-center justify-center py-24 px-6 text-center">
            <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6 shadow-sm border border-border">
              <SearchX className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Nenhum lead encontrado</h3>
            <p className="text-muted-foreground text-sm max-w-md">Não encontramos nenhum cliente correspondente à sua busca ou filtro atual. Tente alterar os termos na barra de pesquisa.</p>
          </CardContent>
        )}
      </Card>

      <ClientProfileModal 
        isOpen={!!selectedClient} 
        onClose={() => setSelectedClient(null)} 
        client={selectedClient} 
      />
      <DriveSyncModal 
        isOpen={!!syncModalClient}
        onClose={() => setSyncModalClient(null)}
        client={syncModalClient}
      />
    </div>
  );
}
