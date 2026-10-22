import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  Clock,
  Cloud,
  DollarSign,
  FileSpreadsheet,
  History,
  Loader2,
  Percent,
  ShoppingCart,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { BarChart, Bar, XAxis, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabaseClient';
import AccountingReportModal from './AccountingReportModal';
import {
  EMPTY_DATASET,
  PERIOD_OPTIONS,
  buildPhotographerPerformance,
  describeRange,
  findOnlineOrderSession,
  formatCurrencyBRL,
  formatNumberBR,
  formatPercentBR,
  formatTimeBR,
  indexSessionsByClient,
  isPaidOnlineOrder,
  isPaidPdvOrder,
  isWithinRange,
  resolvePeriodRange,
  summarizeDataset,
  type AnalyticsDataset,
  type DateRange,
  type EmployeeRow,
  type OnlineOrderRow,
  type OrderRow,
  type PeriodKey,
  type SessionRow,
} from '@/lib/reporting';

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

interface ActivityItem {
  id: string;
  text: string;
  time: string;
  paymentMethod?: string;
  photographerName?: string;
}

/* ========================================================================== */
/* Carregamento dos dados                                                      */
/* ========================================================================== */

/**
 * Busca o conjunto bruto de dados (equipe, sessões, PDV e Site) uma única vez.
 * O recorte por período é feito em memória, o que torna o filtro instantâneo
 * e reativo — sem novas idas ao Supabase a cada troca de período.
 */
function useAnalyticsDataset(scope: string) {
  const [dataset, setDataset] = useState<AnalyticsDataset>(EMPTY_DATASET);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [employees, sessions, orders, onlineOrders] = await Promise.all([
        supabase.from('employees').select('*').eq('role', 'Operador').eq('status', 'Ativo'),
        supabase.from('photo_sessions').select('*').order('created_at', { ascending: false }),
        supabase.from('orders').select('*').eq('status', 'paid').order('created_at', { ascending: false }),
        supabase
          .from('online_orders')
          .select('*')
          .in('payment_status', ['paid', 'delivered'])
          .order('created_at', { ascending: false }),
      ]);

      const failure = employees.error || sessions.error || orders.error || onlineOrders.error;
      if (failure) throw new Error(failure.message);

      setDataset({
        employees: (employees.data as EmployeeRow[] | null) ?? [],
        sessions: (sessions.data as SessionRow[] | null) ?? [],
        orders: (orders.data as OrderRow[] | null) ?? [],
        onlineOrders: (onlineOrders.data as OnlineOrderRow[] | null) ?? [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível carregar os indicadores.';
      setLoadError(message);
      console.error(`[Dashboard:${scope}] Falha ao carregar dados:`, err);
    } finally {
      setIsLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { dataset, isLoading, loadError, reload };
}

function buildRecentActivities(dataset: AnalyticsDataset, range: DateRange, limit = 6): ActivityItem[] {
  const sessionById = new Map(dataset.sessions.map((s) => [s.id, s]));
  const sessionsByClient = indexSessionsByClient(dataset.sessions);
  const employeeById = new Map(dataset.employees.map((e) => [e.id, e]));

  const resolvePhotog = (session?: SessionRow | null, fallback?: string | null) => {
    if (session?.photographer_name) return session.photographer_name;
    if (session?.photographer_id && employeeById.has(session.photographer_id)) {
      return employeeById.get(session.photographer_id)?.name || 'Fotógrafo';
    }
    return fallback || 'Equipe';
  };

  const formatPay = (m?: string | null, isOnline = false) => {
    const raw = String(m || '').toLowerCase();
    if (raw.includes('pix')) return isOnline ? 'PIX (Site)' : 'PIX';
    if (raw.includes('card') || raw.includes('cart') || raw.includes('credit')) return isOnline ? 'Cartão (Site)' : 'Cartão';
    if (raw.includes('dinheiro') || raw.includes('cash')) return 'Dinheiro';
    if (raw.includes('lojinha')) return 'Via Lojinha';
    return isOnline ? 'Online (Site)' : 'PDV';
  };

  const sales = [
    ...dataset.orders
      .filter((order) => isPaidPdvOrder(order) && isWithinRange(order.created_at, range))
      .map((order) => {
        const sess = order.session_id ? sessionById.get(order.session_id) : null;
        return {
          id: `pdv-${order.id}`,
          at: order.created_at ?? '',
          text: `Venda PDV · ${formatCurrencyBRL(order.total_amount)}`,
          paymentMethod: formatPay(order.payment_method, false),
          photographerName: resolvePhotog(sess, order.photographer_name),
        };
      }),
    ...dataset.onlineOrders
      .filter((order) => isPaidOnlineOrder(order) && isWithinRange(order.created_at, range))
      .map((order) => {
        const sess =
          findOnlineOrderSession(order, sessionsByClient, sessionById) ||
          dataset.sessions.find(
            (s) =>
              s.client_name &&
              order.client_name &&
              s.client_name.trim().toLowerCase() === order.client_name.trim().toLowerCase()
          ) ||
          null;
        return {
          id: `site-${order.id}`,
          at: order.created_at ?? '',
          text: `Venda Site · ${formatCurrencyBRL(order.total_amount)}`,
          paymentMethod: formatPay((order as any).payment_method, true),
          photographerName: resolvePhotog(sess, null),
        };
      }),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      text: item.text,
      time: formatTimeBR(item.at),
      paymentMethod: item.paymentMethod,
      photographerName: item.photographerName,
    }));

  if (sales.length > 0) return sales;

  return dataset.sessions
    .filter((session) => isWithinRange(session.created_at, range))
    .slice(0, limit)
    .map((session) => ({
      id: session.id,
      text: `Sessão iniciada (${session.client_name || 'Visitante'})`,
      time: formatTimeBR(session.created_at),
      paymentMethod: 'Aguardando',
      photographerName: resolvePhotog(session, null),
    }));
}

function DashboardErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold">Não foi possível carregar os indicadores.</p>
          <p className="mt-0.5 opacity-90">{message}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-semibold hover:bg-destructive/20 transition-colors"
      >
        Tentar novamente
      </button>
    </div>
  );
}

/* ========================================================================== */
/* Dashboard do Operador                                                       */
/* ========================================================================== */

function OperatorDashboard() {
  const { dataset, isLoading, loadError, reload } = useAnalyticsDataset('operador');
  const [period, setPeriod] = useState<PeriodKey>('hoje');

  const range = useMemo<DateRange>(() => resolvePeriodRange(period), [period]);
  const summary = useMemo(() => summarizeDataset(dataset, range), [dataset, range]);
  const photographers = useMemo(() => buildPhotographerPerformance(dataset, range), [dataset, range]);
  const activities = useMemo(() => buildRecentActivities(dataset, range), [dataset, range]);

  const metricsData = [
    {
      title: 'Faturamento',
      value: formatCurrencyBRL(summary.totalRevenue),
      trend: '',
      icon: DollarSign,
    },
    {
      title: 'Total de Sessões',
      value: summary.totalSessions.toString(),
      trend: '',
      icon: Camera,
    },
    {
      title: 'Aguardando Decisão',
      value: summary.pendingSessions.toString(),
      trend: '',
      icon: Clock,
    },
    {
      title: 'Taxa de Conversão',
      value: formatPercentBR(summary.conversionRate, 0),
      trend: '',
      icon: Percent,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pt-4">
      {loadError && <DashboardErrorBanner message={loadError} onRetry={() => void reload()} />}

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
                {metric.title === 'Taxa de Conversão' && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {summary.convertedSessions} de {summary.totalSessions} sessão(ões)
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 2. Layout Inferior */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* COLUNA ESQUERDA (Maior) - Desempenho da Equipe */}
        <Card className="lg:col-span-7 shadow-sm lux-card dark:bg-white/[0.03] dark:backdrop-blur-xl dark:border-white/10 flex flex-col transition-lux">
          <CardHeader className="pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-semibold text-foreground">Desempenho da Equipe</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Sessões e taxa de conversão por sessão.</p>
            </div>
            <div className="flex items-center gap-1 bg-secondary/60 p-1 rounded-xl border border-border/50 self-start sm:self-auto">
              {(
                [
                  { key: 'hoje', label: 'Hoje' },
                  { key: 'semana', label: 'Semana' },
                  { key: 'mes', label: 'Mês' },
                  { key: 'todos', label: 'Todos' },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    period === key
                      ? 'bg-brand-accent text-brand-accent-fg shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
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
                          {formatPercentBR(photographer.rate, 0)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        {isLoading ? 'Carregando dados...' : 'Nenhum dado encontrado'}
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
              {dataset.sessions.length > 0 ? (
                <div className="max-h-40 overflow-y-auto no-scrollbar space-y-2 pr-1">
                  {dataset.sessions.slice(0, 15).map((session) => {
                    const isSynced = session.drive_status === 'synced';
                    const isError = session.drive_status === 'error';

                    return (
                      <div
                        key={session.id}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-secondary/40 border border-border/50 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground truncate">
                            {session.client_name || 'Sessão'}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono truncate">
                            {formatTimeBR(session.created_at)}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 border ${
                            isSynced
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                              : isError
                              ? 'bg-red-500/10 text-red-500 border-red-500/20'
                              : 'bg-secondary text-muted-foreground border-border'
                          }`}
                        >
                          {isSynced ? 'No Drive' : isError ? 'Erro' : 'Miniaturas na Nuvem'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-start gap-3 bg-secondary/50 rounded-xl p-3 border border-dashed">
                  <div className="mt-0.5 shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Nenhuma sessão registrada</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Os uploads aparecerão aqui automaticamente.</p>
                  </div>
                </div>
              )}
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
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-foreground leading-tight">{item.text}</p>
                        <span className="text-[10px] text-muted-foreground font-mono tabular-figures shrink-0">{item.time}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {item.paymentMethod && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-primary/10 text-primary border border-primary/20">
                            {item.paymentMethod}
                          </span>
                        )}
                        {item.photographerName && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground border border-border">
                            📷 {item.photographerName}
                          </span>
                        )}
                      </div>
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

/* ========================================================================== */
/* Visão Executiva (Gerente / Dono)                                            */
/* ========================================================================== */

function MasterDashboard() {
  const { dataset, isLoading, loadError, reload } = useAnalyticsDataset('executivo');

  const [period, setPeriod] = useState<PeriodKey>('hoje');
  const [isReportOpen, setIsReportOpen] = useState(false);

  // Filtro reativo: trocar o período recalcula tudo em memória, sem refetch.
  const range = useMemo<DateRange>(() => resolvePeriodRange(period), [period]);

  const summary = useMemo(() => summarizeDataset(dataset, range), [dataset, range]);
  const photographers = useMemo(() => buildPhotographerPerformance(dataset, range), [dataset, range]);
  const activities = useMemo(() => buildRecentActivities(dataset, range), [dataset, range]);

  const chartData = useMemo(
    () => [
      { category: 'PDV (Parque)', vendas: summary.pdvRevenue, fill: 'var(--theme-accent)' },
      // Token analítico: royal no claro, ciano no escuro
      { category: 'Site (Online)', vendas: summary.onlineRevenue, fill: 'var(--theme-info)' },
    ],
    [summary.pdvRevenue, summary.onlineRevenue],
  );

  const rangeLabel = describeRange(range);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out pt-4">
      {/* HEADER DA TELA */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Visão Executiva</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Acompanhamento de vendas e conversão global · <span className="font-medium text-foreground">{rangeLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsReportOpen(true)}
            className="flex items-center gap-2 h-11 px-4 rounded-xl border border-border bg-card text-sm font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
          >
            <FileSpreadsheet className="h-4 w-4 text-primary" />
            Fechamento ERP
          </button>
          <div className="w-48">
            <Select value={period} onValueChange={(value) => setPeriod(value as PeriodKey)}>
              <SelectTrigger className="bg-card h-11 shadow-sm">
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent className="bg-card">
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {loadError && <DashboardErrorBanner message={loadError} onRetry={() => void reload()} />}

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
            <div className="text-3xl font-bold font-mono tabular-figures text-foreground tracking-tight">
              {formatCurrencyBRL(summary.totalRevenue)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {summary.salesCount} transação(ões) · PDV {formatCurrencyBRL(summary.pdvRevenue)} · Site{' '}
              {formatCurrencyBRL(summary.onlineRevenue)}
            </p>
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
            <div className="text-3xl font-bold font-mono tabular-figures text-foreground tracking-tight">
              {formatPercentBR(summary.conversionRate, 1)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {summary.convertedSessions} de {summary.totalSessions} sessão(ões) convertida(s)
            </p>
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
            <div className="text-3xl font-bold font-mono tabular-figures text-foreground tracking-tight">
              {formatCurrencyBRL(summary.ticketAverage)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{summary.pendingSessions} sessão(ões) aguardando decisão</p>
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
                <BarChart data={chartData} margin={{ top: 10, left: -20, right: 10, bottom: 0 }}>
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
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* BLOCO DE PERFORMANCE */}
        <Card className="lg:col-span-7 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-foreground">Performance da Equipe</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Faturamento atribuído à sessão · {rangeLabel}
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fotógrafo</TableHead>
                    <TableHead className="text-center">Sessões</TableHead>
                    <TableHead className="text-center">Convertidas</TableHead>
                    <TableHead className="text-center">Impressas</TableHead>
                    <TableHead className="text-center">Digitais</TableHead>
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
                            <div>
                              <span className="font-medium text-foreground block">{photographer.name}</span>
                              <span className="text-[11px] text-muted-foreground font-mono tabular-figures">
                                {photographer.converted}/{photographer.sessions} sessões ·{' '}
                                {formatPercentBR(photographer.rate, 0)}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center font-mono tabular-figures">{photographer.sessions}</TableCell>
                        <TableCell className="text-center font-mono tabular-figures">{photographer.converted}</TableCell>
                        <TableCell className="text-center font-mono tabular-figures">{photographer.printed}</TableCell>
                        <TableCell className="text-center font-mono tabular-figures">{photographer.digital}</TableCell>
                        <TableCell className="text-right font-mono tabular-figures font-bold text-foreground">
                          {formatCurrencyBRL(photographer.revenue)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm font-mono tabular-figures">
                          {photographer.lastSaleAt ? formatTimeBR(photographer.lastSaleAt) : '-'}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                        {isLoading ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Carregando dados...
                          </span>
                        ) : (
                          'Nenhum dado encontrado'
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* ATIVIDADE RECENTE DO PERÍODO */}
      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            Atividade Recente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {activities.map((item) => (
                <div key={item.id} className="rounded-xl border border-border-dashed bg-background/60 p-3 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[10px] text-muted-foreground font-mono tabular-figures">{item.time}</span>
                      {item.paymentMethod && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-primary/10 text-primary border border-primary/20">
                          {item.paymentMethod}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-foreground leading-snug">{item.text}</p>
                  </div>
                  {item.photographerName && (
                    <div className="mt-2.5 pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground truncate">
                      📷 {item.photographerName}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Sem atividades no período selecionado.</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-4">
            Total do período: <span className="font-medium text-foreground">{formatNumberBR(summary.salesCount, 0)}</span>{' '}
            venda(s) registrada(s).
          </p>
        </CardContent>
      </Card>

      <AccountingReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        initialPeriod={period}
      />
    </div>
  );
}

export default function Dashboard({ userRole = 'operador' }: DashboardProps) {
  if (userRole === 'operador') {
    return <OperatorDashboard />;
  }

  return <MasterDashboard />;
}
