import React, { useEffect, useState } from 'react';
import { Camera, Clock, DollarSign, ArrowUpRight, Percent, Cloud, History, CheckCircle2, ShoppingCart } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { BarChart, Bar, XAxis, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabaseClient';

export type UserRole = 'operador' | 'gerente' | 'dono';

interface DashboardProps {
  userRole?: UserRole;
}

const chartConfig = {
  vendas: {
    label: "Vendas (R$)",
    color: "var(--theme-accent)",
  },
};

function OperatorDashboard() {
  const [metrics, setMetrics] = useState({ faturamento: 'R$ 0,00', sessoes: 0, pendentes: 0, taxa: '0%' });
  const [photographers, setPhotographers] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      const { data: emps } = await supabase.from('employees').select('*').eq('role', 'Operador').eq('status', 'Ativo');
      const { data: sessions } = await supabase.from('photo_sessions').select('*').order('created_at', { ascending: false });
      const { data: orders } = await supabase.from('orders').select('*').eq('status', 'paid').order('created_at', { ascending: false });
      const { data: onlineOrders } = await supabase.from('online_orders').select('*').in('payment_status', ['paid', 'delivered']).order('created_at', { ascending: false });

      if (emps && sessions && orders) {
        const webOrders = onlineOrders || [];
        
        // Combina todas as vendas (Físicas + Web)
        const totalFatPdv = orders.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0);
        const totalFatWeb = webOrders.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0);
        const totalFat = totalFatPdv + totalFatWeb;
        const totalSalesCount = orders.length + webOrders.length;
        
        const totalSessoes = sessions.length;
        const pendentes = sessions.filter(s => s.status === 'Pendente').length;
        const taxa = totalSessoes > 0 ? Math.round((totalSalesCount / totalSessoes) * 100) : 0;

        setMetrics({
          faturamento: `R$ ${totalFat.toFixed(2).replace('.', ',')}`,
          sessoes: totalSessoes,
          pendentes: pendentes,
          taxa: `${taxa}%`
        });

        // Fotógrafos
        const mappedPh = emps.map(emp => {
          // O schema antigo tem photographer_id e o novo pode usar text no backend
          const empSessions = sessions.filter(s => s.photographer_name === emp.name || s.photographer_id === emp.id); 
          const sessCount = empSessions.length;
          const empOrders = orders.filter(o => empSessions.some(s => s.id === o.session_id));
          const empWebOrders = webOrders.filter(wo => empSessions.some(s => s.client_id === wo.client_id));
          const converted = empOrders.length + empWebOrders.length;
          const rate = sessCount > 0 ? Math.round((converted / sessCount) * 100) : 0;
          
          return {
            id: emp.id,
            name: emp.name,
            avatar: emp.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.name)}&background=D9A45C&color=fff`,
            sessions: sessCount,
            converted: converted,
            rate: rate
          };
        });
        setPhotographers(mappedPh);

        // Atividades Unificadas (Misturando PDV e Site cronologicamente)
        const combinedOrders = [
          ...orders.map(o => ({ ...o, sourceName: 'Venda no PDV (Balcão)' })),
          ...webOrders.map(o => ({ ...o, sourceName: `Venda Online (Site)` }))
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        if (combinedOrders.length > 0) {
          const mappedAct = combinedOrders.slice(0, 4).map((o, i) => ({
            id: o.id || i,
            text: o.sourceName,
            time: new Date(o.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          }));
          setActivities(mappedAct);
        } else {
          const actSess = sessions.slice(0, 4).map((s, i) => ({
            id: s.id || i,
            text: `Sessão iniciada`,
            time: new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          }));
          setActivities(actSess);
        }
      }
    }
    loadDashboard();
  }, []);

  const metricsData = [
    { title: 'Faturamento', value: metrics.faturamento, trend: '', icon: DollarSign },
    { title: 'Total de Sessões', value: metrics.sessoes.toString(), trend: '', icon: Camera },
    { title: 'Aguardando Decisão', value: metrics.pendentes.toString(), trend: '', icon: Clock },
    { title: 'Taxa de Conversão', value: metrics.taxa, trend: '', icon: Percent }
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pt-4">
      {/* 1. Grid de Métricas Topo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {metricsData.map((metric, i) => {
          const Icon = metric.icon;
          return (
            <Card key={i} className="shadow-sm lux-card dark:bg-white/[0.03] dark:backdrop-blur-xl dark:border-white/10 dark:lux-top-highlight hover:-translate-y-0.5 hover:shadow-md transition-lux">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2.5 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20 shadow-sm dark:shadow-[0_0_16px_rgba(217,164,92,0.25)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  {metric.trend && (
                    <div className="flex items-center gap-1 text-primary text-xs font-medium bg-primary/10 px-3 py-1 rounded-full font-mono tabular-figures border border-primary/20">
                      <ArrowUpRight className="h-3 w-3" />
                      {metric.trend}
                    </div>
                  )}
                </div>

                <h3 className="text-muted-foreground text-sm font-medium mb-1">{metric.title}</h3>
                <p className="text-2xl font-bold text-foreground tracking-tight font-mono tabular-figures">{metric.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 2. Layout Inferior */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* COLUNA ESQUERDA (Maior) - Desempenho da Equipe */}
        <Card className="lg:col-span-7 shadow-sm lux-card dark:bg-white/[0.03] dark:backdrop-blur-xl dark:border-white/10 flex flex-col transition-lux">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-semibold text-foreground">Desempenho da Equipe</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Sessões e taxa de conversão diária.</p>
          </CardHeader>

          <CardContent className="flex-1">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fotógrafo</TableHead>
                    <TableHead className="text-center">Sessões</TableHead>
                    <TableHead className="text-center">Convertidas</TableHead>
                    <TableHead className="text-right">Taxa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {photographers.length > 0 ? (
                    photographers.map(photographer => (
                      <TableRow key={photographer.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full overflow-hidden border border-border">
                              <img src={photographer.avatar} alt={photographer.name} className="w-full h-full object-cover" />
                            </div>
                            <span className="font-medium text-foreground text-sm">{photographer.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-mono text-sm">{photographer.sessions}</TableCell>
                        <TableCell className="text-center font-mono text-sm">{photographer.converted}</TableCell>
                        <TableCell className={`text-right font-mono font-bold text-sm ${photographer.rate >= 60 ? 'text-primary' : 'text-muted-foreground'}`}>
                          {photographer.rate}%
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        Nenhum dado encontrado
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* COLUNA DIREITA (Menor) */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <Cloud className="h-4 w-4 text-muted-foreground" />
                Sincronização
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 bg-secondary/50 rounded-xl p-3 border border-dashed">
                <div className="mt-0.5 shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Uploads em dia</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Todos arquivos seguros no banco em nuvem.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm lux-card dark:bg-white/[0.03] dark:backdrop-blur-xl dark:border-white/10 flex-1 transition-lux">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                Atividade Recente
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activities.length > 0 ? (
                <div className="relative pl-5 space-y-4 before:absolute before:inset-y-0 before:left-[9px] before:w-[2px] before:bg-border before:border-dashed">
                  {activities.map((item) => (
                    <div key={item.id} className="relative">
                      <div className="absolute -left-[25px] top-[4px] h-2.5 w-2.5 bg-card border-2 border-primary rounded-full shadow-sm dark:shadow-[0_0_8px_rgba(217,164,92,0.7)] z-10"></div>
                      <p className="text-xs font-medium text-foreground leading-tight">{item.text}</p>
                      <p className="text-[10px] text-muted-foreground mt-1 font-mono tabular-figures">{item.time}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Sem atividades recentes.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MasterDashboard() {
  const [photographers, setPhotographers] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [chartDataState, setChartDataState] = useState<any[]>([]);
  const [kpis, setKpis] = useState({ faturamento: 0, ticketMedio: 0, conversao: 0 });

  useEffect(() => {
    async function loadAnalytics() {
      const { data: emps } = await supabase.from('employees').select('*').eq('role', 'Operador').eq('status', 'Ativo');
      const { data: sessions } = await supabase.from('photo_sessions').select('*').order('created_at', { ascending: false });
      const { data: orders } = await supabase.from('orders').select('*').eq('status', 'paid').order('created_at', { ascending: false });
      const { data: onlineOrders } = await supabase.from('online_orders').select('*').in('payment_status', ['paid', 'delivered']).order('created_at', { ascending: false });

      if (emps && sessions && orders) {
        const webOrders = onlineOrders || [];
        const mapped = emps.map(emp => {
          const empSessions = sessions.filter(s => s.photographer_name === emp.name || s.photographer_id === emp.id);
          const totalSessions = empSessions.length;
          const empOrders = orders.filter(o => empSessions.some(s => s.id === o.session_id));
          const empWebOrders = webOrders.filter(wo => empSessions.some(s => s.client_id === wo.client_id));
          
          let digital = 0;
          let printed = 0;
          let soldTotal = 0;

          empOrders.forEach(o => {
            soldTotal += Number(o.total_amount) || 0;
          });
          empWebOrders.forEach(o => {
            soldTotal += Number(o.total_amount) || 0;
          });
          
          const converted = empOrders.length + empWebOrders.length;
          const allEmpOrders = [...empOrders, ...empWebOrders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

          return {
            id: emp.id,
            name: emp.name,
            avatar: emp.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.name)}&background=D9A45C&color=fff`,
            sessions: totalSessions,
            converted: converted,
            rate: totalSessions > 0 ? Math.round((converted / totalSessions) * 100) : 0,
            soldTotal: `R$ ${soldTotal.toFixed(2).replace('.', ',')}`,
            digital: digital,
            printed: printed,
            lastSale: allEmpOrders.length > 0 ? new Date(allEmpOrders[0].created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-'
          };
        });
        setPhotographers(mapped);

        const totalFatPdv = orders.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0);
        const totalFatWeb = webOrders.reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0);
        const totalFat = totalFatPdv + totalFatWeb;
        const totalSalesCount = orders.length + webOrders.length;
        
        const ticketMedio = totalSalesCount > 0 ? totalFat / totalSalesCount : 0;
        const conversao = sessions.length > 0 ? Math.round((totalSalesCount / sessions.length) * 100) : 0;
        
        setKpis({ faturamento: totalFat, ticketMedio, conversao });

        setChartDataState([
          { category: "PDV (Parque)", vendas: totalFatPdv, fill: "var(--theme-accent)" },
          { category: "Site (Online)", vendas: totalFatWeb, fill: "var(--theme-info)" } // Token analítico: royal no claro, ciano no escuro
        ]);
      }
    }
    loadAnalytics();
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pt-4">
      {/* HEADER DA TELA */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Visão Executiva</h2>
          <p className="text-muted-foreground text-sm mt-1">Acompanhamento de vendas e conversão global.</p>
        </div>
        <div className="w-48">
          <Select defaultValue="hoje">
            <SelectTrigger className="bg-card h-11 shadow-sm">
              <SelectValue placeholder="Selecione o período" />
            </SelectTrigger>
            <SelectContent className="bg-card">
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="semana">Última Semana</SelectItem>
              <SelectItem value="mes">Este Mês</SelectItem>
              <SelectItem value="30dias">Últimos 30 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* GRID DE KPIs (3 Colunas) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-sm lux-card dark:bg-white/[0.03] dark:backdrop-blur-xl dark:border-white/10 dark:lux-top-highlight hover:-translate-y-0.5 hover:shadow-md transition-lux">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Faturamento Global</CardTitle>
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20 shadow-sm dark:shadow-[0_0_16px_rgba(217,164,92,0.25)]">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono tabular-figures text-foreground tracking-tight">R$ {kpis.faturamento.toFixed(2).replace('.', ',')}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm lux-card dark:bg-white/[0.03] dark:backdrop-blur-xl dark:border-white/10 dark:lux-top-highlight hover:-translate-y-0.5 hover:shadow-md transition-lux">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Taxa de Conversão</CardTitle>
            <div className="p-2.5 rounded-xl bg-brand-info/10 text-brand-info ring-1 ring-brand-info/20 shadow-sm">
              <Percent className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono tabular-figures text-foreground tracking-tight">{kpis.conversao}%</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm lux-card dark:bg-white/[0.03] dark:backdrop-blur-xl dark:border-white/10 dark:lux-top-highlight hover:-translate-y-0.5 hover:shadow-md transition-lux">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ticket Médio</CardTitle>
            <div className="p-2.5 rounded-xl bg-brand-imperial/10 text-brand-imperial ring-1 ring-brand-imperial/20 shadow-sm">
              <ShoppingCart className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono tabular-figures text-foreground tracking-tight">R$ {kpis.ticketMedio.toFixed(2).replace('.', ',')}</div>
          </CardContent>
        </Card>
      </div>

      {/* SESSÃO CENTRAL: GRÁFICO E PERFORMANCE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* BLOCO DE GRÁFICO */}
        <Card className="lg:col-span-5 shadow-sm lux-card dark:bg-white/[0.03] dark:backdrop-blur-xl dark:border-white/10 flex flex-col transition-lux">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-foreground">Faturamento por Categoria</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 pb-4">
            <ChartContainer config={chartConfig} className="min-h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartDataState.length > 0 ? (
                  <BarChart data={chartDataState} margin={{ top: 10, left: -20, right: 10, bottom: 0 }}>
                    <XAxis 
                      dataKey="category" 
                      tickLine={false}
                      axisLine={false}
                      tickMargin={12}
                      tick={{ fill: 'var(--theme-muted)' }}
                      fontSize={12}
                    />
                    <ChartTooltip 
                      cursor={{ fill: 'var(--theme-bg)', opacity: 0.5 }} 
                      content={<ChartTooltipContent hideLabel />} 
                    />
                    <Bar dataKey="vendas" radius={[6, 6, 0, 0]} />
                  </BarChart>
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Sem dados para exibir</div>
                )}
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* BLOCO DE PERFORMANCE */}
        <Card className="lg:col-span-7 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-foreground">Performance da Equipe</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fotógrafo</TableHead>
                    <TableHead className="text-center">Digitais</TableHead>
                    <TableHead className="text-center">Impressas</TableHead>
                    <TableHead className="text-right">Total (R$)</TableHead>
                    <TableHead className="text-right">Última Venda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {photographers.length > 0 ? (
                    photographers.map((photographer) => (
                      <TableRow key={photographer.id} className="hover:bg-muted/30 dark:hover:bg-white/[0.05] transition-colors duration-150 ease-out">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full overflow-hidden border border-border dark:border-white/15 ring-1 ring-black/5 dark:ring-white/10 shadow-sm">
                              <img src={photographer.avatar} alt={photographer.name} className="w-full h-full object-cover" />
                            </div>
                            <span className="font-medium text-foreground">{photographer.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-mono tabular-figures">{photographer.digital}</TableCell>
                        <TableCell className="text-center font-mono tabular-figures">{photographer.printed}</TableCell>
                        <TableCell className="text-right font-mono tabular-figures font-bold text-foreground">{photographer.soldTotal}</TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm font-mono tabular-figures">{photographer.lastSale}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                        Nenhum dado encontrado
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

export default function Dashboard({ userRole = 'operador' }: DashboardProps) {
  if (userRole === 'operador') {
    return <OperatorDashboard />;
  }

  return <MasterDashboard />;
}
