import { useState, useEffect } from "react";
import { Search, Link as LinkIcon, Receipt, QrCode, CreditCard, Banknote, ChevronLeft, ChevronRight, Globe, Store } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { toast } from "sonner";
import { supabase } from '@/lib/supabaseClient';

const filters = ['Todos', 'Hoje', 'Ontem', 'Últimos 7 dias'];

export default function Historico() {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState('Todos');
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    async function loadHistory() {
      try {
        const [ { data: ordersData }, { data: onlineOrdersData } ] = await Promise.all([
          supabase
            .from('orders')
            .select(`
              *,
              photo_sessions (
                clients (
                  name,
                  phone
                )
              )
            `)
            .neq('status', 'pending'),
          supabase
            .from('online_orders')
            .select('*')
            .neq('payment_status', 'pending')
        ]);

        const pdvFormatted = (ordersData || []).map(order => ({
          id: order.id,
          displayId: order.id.split('-')[0].toUpperCase(),
          clientName: order.photo_sessions?.clients?.name || 'Cliente Desconhecido',
          phone: order.photo_sessions?.clients?.phone || '--',
          items: 'Pacote de Fotos',
          total: Number(order.total_amount) || 0,
          method: order.payment_method || 'indefinido',
          date: new Date(order.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
          rawDate: new Date(order.created_at),
          source: 'PDV'
        }));

        const onlineFormatted = (onlineOrdersData || []).map(order => ({
          id: order.id,
          displayId: order.id.split('-')[0].toUpperCase(),
          clientName: order.client_name || 'Cliente Desconhecido',
          phone: order.client_phone || '--',
          items: order.package_name || 'Venda Online',
          total: Number(order.total_amount) || 0,
          method: 'Online',
          date: new Date(order.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
          rawDate: new Date(order.created_at),
          source: 'Site'
        }));

        const combined = [...pdvFormatted, ...onlineFormatted].sort((a, b) => b.rawDate.getTime() - a.rawDate.getTime());
        setHistory(combined);
      } catch (err) {
        console.error("Erro ao carregar histórico:", err);
      }
    }
    loadHistory();
  }, []);

  const getFilteredHistory = () => {
    let filtered = history;

    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      filtered = filtered.filter(order => 
        order.id.toLowerCase().includes(lowerSearch) || 
        order.clientName.toLowerCase().includes(lowerSearch)
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);

    if (activeFilter === 'Hoje') {
      filtered = filtered.filter(o => o.rawDate >= today);
    } else if (activeFilter === 'Ontem') {
      filtered = filtered.filter(o => o.rawDate >= yesterday && o.rawDate < today);
    } else if (activeFilter === 'Últimos 7 dias') {
      filtered = filtered.filter(o => o.rawDate >= last7Days);
    }

    return filtered;
  };

  const filteredHistory = getFilteredHistory();

  const getInitials = (name: string) => {
    return name.substring(0, 2).toUpperCase();
  };

  const renderMethodIcon = (method: string) => {
    const m = method.toLowerCase();
    if (m.includes('pix')) return <QrCode className="h-4 w-4 text-primary" />;
    if (m.includes('cart') || m.includes('credito') || m.includes('debito')) return <CreditCard className="h-4 w-4 text-muted-foreground" />;
    if (m.includes('dinheiro')) return <Banknote className="h-4 w-4 text-muted-foreground" />;
    if (m.includes('online')) return <Globe className="h-4 w-4 text-blue-500" />;
    return <Receipt className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pt-4">
      {/* Header & Filtros */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Histórico de Vendas</h2>
          <p className="text-muted-foreground text-sm mt-1">Acompanhe os pedidos e reenvie acessos.</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input 
              type="text" 
              placeholder="Buscar por cliente ou ID..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-11 pr-4 py-2.5 bg-card shadow-sm rounded-full text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all w-full sm:w-64 border border-transparent"
            />
          </div>
          
          <div className="flex bg-card p-1.5 rounded-full shadow-sm w-full sm:w-auto overflow-x-auto border border-transparent">
            {filters.map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap
                  ${activeFilter === f 
                    ? 'bg-foreground text-background' 
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                  }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabela Container Padronizado */}
      <Card className="border-border shadow-sm overflow-hidden flex flex-col h-[calc(100vh-220px)] min-h-[480px]">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto no-scrollbar [&_[data-slot=table-container]]:overflow-visible">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
                <TableRow className="bg-muted/50 border-b-border-dashed">
                  <TableHead className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ID</TableHead>
                  <TableHead className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cliente</TableHead>
                  <TableHead className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resumo do Pedido</TableHead>
                  <TableHead className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pagamento/Valor</TableHead>
                  <TableHead className="px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredHistory.map((order) => (
                  <TableRow key={order.id} className="hover:bg-muted/30 border-b-border-dashed transition-colors group">
                    <TableCell className="px-6 py-5 align-middle">
                      <span className="font-mono text-xs text-muted-foreground tracking-wide">{order.displayId}</span>
                      <div className="mt-2">
                        {order.source === 'Site' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-500 border border-blue-500/20">
                            <Globe className="w-3 h-3" />
                            Site
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            <Store className="w-3 h-3" />
                            PDV
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-5 align-middle">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm border border-primary/20">
                          {getInitials(order.clientName)}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground text-sm">{order.clientName}</p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">{order.phone}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-5 align-middle">
                      <p className="text-sm text-muted-foreground max-w-[220px] truncate">{order.items}</p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{order.date}</p>
                    </TableCell>
                    <TableCell className="px-6 py-5 align-middle">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-background rounded-lg border border-border shadow-sm">
                          {renderMethodIcon(order.method)}
                        </div>
                        <span className="font-mono font-bold text-foreground text-sm">
                          R$ {order.total.toFixed(2).replace('.', ',')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-5 align-middle text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => toast.success("Link do Google Drive reenviado para o WhatsApp do cliente.")}
                          title="Reenviar Link Drive"
                          className="p-2.5 rounded-xl bg-background hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors shadow-sm border border-border"
                        >
                          <LinkIcon className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => toast.info("Gerando segunda via do recibo térmico...")}
                          title="Ver Recibo"
                          className="p-2.5 rounded-xl bg-background hover:bg-foreground/10 hover:text-foreground text-muted-foreground transition-colors shadow-sm border border-border"
                        >
                          <Receipt className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                
                {filteredHistory.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                      Nenhum pedido encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
  
          {/* Rodapé Tabela */}
          <div className="px-6 py-4 bg-muted/30 border-t border-border-dashed flex items-center justify-between shrink-0">
            <span className="text-sm text-muted-foreground">
              Exibindo <strong className="text-foreground font-medium">{filteredHistory.length}</strong> de <strong className="text-foreground font-medium">{history.length}</strong> pedidos
            </span>
            <div className="flex gap-2">
              <button className="p-2 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground transition-colors shadow-sm disabled:opacity-50" disabled>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-xl bg-card border border-border text-muted-foreground hover:text-foreground transition-colors shadow-sm disabled:opacity-50" disabled>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
