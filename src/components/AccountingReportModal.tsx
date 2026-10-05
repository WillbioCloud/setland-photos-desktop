import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import {
  buildCsvContent,
  buildCsvFileName,
  buildPhotographerPerformance,
  CSV_SEPARATOR,
  downloadCsv,
  filterDatasetByRange,
  formatCurrencyBRL,
  formatDateTimeBR,
  formatDateInput,
  formatNumberBR,
  formatPercentBR,
  isPaidOnlineOrder,
  isPaidPdvOrder,
  isWithinRange,
  parseDateInput,
  paymentMethodLabel,
  resolvePeriodRange,
  startOfMonth,
  summarizeDataset,
  toNumber,
  type AnalyticsDataset,
  type DateRange,
  type EmployeeRow,
  type OnlineOrderRow,
  type OrderRow,
  type PeriodKey,
  type PhotographerPerformance,
  type ReportSummary,
  type SessionRow,
} from '@/lib/reporting';

/* ========================================================================== */
/* Tipos do fechamento                                                         */
/* ========================================================================== */

/** Pedido de PDV com os relacionamentos usados para identificar o cliente. */
export interface OrderWithRelations extends OrderRow {
  photo_sessions?: {
    photographer_name?: string | null;
    clients?: {
      name?: string | null;
      cpf?: string | null;
      phone?: string | null;
    } | null;
  } | null;
}

/** Uma linha do livro-caixa exportado para o ERP. */
export interface AccountingEntry {
  id: string;
  createdAt: string | null;
  source: 'PDV' | 'Site';
  orderId: string;
  clientName: string;
  clientCpf: string;
  clientPhone: string;
  description: string;
  method: string;
  methodLabel: string;
  total: number;
}

/** Período do fechamento: as chaves do Dashboard + intervalo personalizado. */
type PeriodSelection = PeriodKey | 'personalizado';

interface AccountingReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Período herdado do filtro do Dashboard ao abrir o fechamento. */
  initialPeriod?: PeriodKey;
}

/* ========================================================================== */
/* Helpers puros (exportados para reuso e teste)                               */
/* ========================================================================== */

/** Encurta o UUID para o mesmo padrão exibido no Histórico (ex: `A1B2C3D4`). */
export function shortOrderId(id: string | null | undefined): string {
  if (!id) return '--';
  return id.split('-')[0]?.toUpperCase() ?? '--';
}

/** Descrição do item vendido no PDV a partir das contagens do pedido. */
export function describePdvOrder(order: OrderRow): string {
  const printed = toNumber(order.printed_count);
  const digital = toNumber(order.digital_count);
  const parts: string[] = [];

  if (printed > 0) parts.push(`${printed} foto${printed > 1 ? 's' : ''} impressa${printed > 1 ? 's' : ''}`);
  if (digital > 0) parts.push(`${digital} foto${digital > 1 ? 's' : ''} digital${digital > 1 ? 'is' : ''}`);

  return parts.length > 0 ? parts.join(' + ') : 'Pacote de Fotos';
}

/**
 * Monta o livro-caixa unificado (PDV + Site) do período, já recortado pelo
 * intervalo selecionado e ordenado do lançamento mais recente para o mais antigo.
 */
export function buildAccountingEntries(
  orders: OrderWithRelations[],
  onlineOrders: OnlineOrderRow[],
  sessions: SessionRow[],
  range: DateRange,
): AccountingEntry[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  const pdvEntries: AccountingEntry[] = orders
    .filter((order) => isPaidPdvOrder(order) && isWithinRange(order.created_at, range))
    .map((order) => {
      const session = order.session_id ? sessionById.get(order.session_id) : undefined;
      const client = order.photo_sessions?.clients;

      return {
        id: `pdv-${order.id}`,
        createdAt: order.created_at ?? null,
        source: 'PDV' as const,
        orderId: shortOrderId(order.id),
        clientName: client?.name || session?.client_name || 'Cliente Desconhecido',
        clientCpf: client?.cpf || session?.client_cpf || '',
        clientPhone: client?.phone || session?.client_phone || '',
        description: describePdvOrder(order),
        method: order.payment_method || 'indefinido',
        methodLabel: paymentMethodLabel(order.payment_method),
        total: toNumber(order.total_amount),
      };
    });

  const onlineEntries: AccountingEntry[] = onlineOrders
    .filter((order) => isPaidOnlineOrder(order) && isWithinRange(order.created_at, range))
    .map((order) => {
      const session = order.session_id ? sessionById.get(order.session_id) : undefined;

      return {
        id: `site-${order.id}`,
        createdAt: order.created_at ?? null,
        source: 'Site' as const,
        orderId: shortOrderId(order.id),
        clientName: order.client_name || session?.client_name || 'Cliente Desconhecido',
        clientCpf: session?.client_cpf || '',
        clientPhone: order.client_phone || session?.client_phone || '',
        description: order.package_name || 'Venda Online',
        method: 'online',
        methodLabel: paymentMethodLabel('online'),
        total: toNumber(order.total_amount),
      };
    });

  return [...pdvEntries, ...onlineEntries].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });
}

interface BuildCsvParams {
  summary: ReportSummary;
  photographers: PhotographerPerformance[];
  entries: AccountingEntry[];
  range: DateRange;
  generatedAt: Date;
}

/**
 * Gera o arquivo de fechamento para o ERP.
 * Formato: CSV com separador `;`, decimais com vírgula e UTF-8 com BOM — o
 * padrão aceito por ERPs brasileiros (Domínio, Contific, SAP B1, etc.).
 */
export function buildAccountingCsv({
  summary,
  photographers,
  entries,
  range,
  generatedAt,
}: BuildCsvParams): string {
  const rows: (string | number)[][] = [];

  // Cabeçalho de identificação do fechamento.
  rows.push(['FECHAMENTO CONTÁBIL - SETLAND FOTOGRAFIA']);
  rows.push(['Período', summary.rangeLabel]);
  rows.push(['Gerado em', formatDateTimeBR(generatedAt)]);
  rows.push(['Sistema', 'Setland Photos Desktop - Terminal 01']);
  rows.push(['Moeda', 'BRL (R$)']);
  rows.push(['Codificação', 'UTF-8 com BOM']);
  rows.push(['Separador de campos', 'ponto e vírgula']);
  rows.push([]);

  // Resumo para conferência do contador.
  rows.push(['RESUMO DO PERÍODO']);
  rows.push(['Indicador', 'Valor']);
  rows.push(['Faturamento total (R$)', formatNumberBR(summary.totalRevenue)]);
  rows.push(['Faturamento PDV (R$)', formatNumberBR(summary.pdvRevenue)]);
  rows.push(['Faturamento Site (R$)', formatNumberBR(summary.onlineRevenue)]);
  rows.push(['Transações concluídas', summary.salesCount]);
  rows.push(['Transações PDV', summary.pdvSalesCount]);
  rows.push(['Transações Site', summary.onlineSalesCount]);
  rows.push(['Ticket médio (R$)', formatNumberBR(summary.ticketAverage)]);
  rows.push(['Sessões realizadas', summary.totalSessions]);
  rows.push(['Sessões convertidas', summary.convertedSessions]);
  rows.push(['Sessões aguardando decisão', summary.pendingSessions]);
  rows.push(['Taxa de conversão (%)', formatNumberBR(summary.conversionRate, 1)]);
  rows.push([]);

  // Faturamento por forma de pagamento (conciliação com a maquininha/banco).
  rows.push(['FATURAMENTO POR FORMA DE PAGAMENTO']);
  rows.push(['Forma de pagamento', 'Transações', 'Total (R$)', 'Participação (%)']);
  if (summary.paymentBreakdown.length > 0) {
    for (const method of summary.paymentBreakdown) {
      rows.push([
        method.label,
        method.count,
        formatNumberBR(method.total),
        formatNumberBR(method.share, 1),
      ]);
    }
  } else {
    rows.push(['Nenhum lançamento no período', 0, formatNumberBR(0), formatNumberBR(0, 1)]);
  }
  rows.push([]);

  // Performance da equipe (rateio de comissionamento).
  rows.push(['DESEMPENHO DA EQUIPE']);
  rows.push([
    'Fotógrafo',
    'Sessões',
    'Convertidas',
    'Taxa de conversão (%)',
    'Faturamento (R$)',
    'Fotos impressas',
    'Fotos digitais',
  ]);
  if (photographers.length > 0) {
    for (const photographer of photographers) {
      rows.push([
        photographer.name,
        photographer.sessions,
        photographer.converted,
        formatNumberBR(photographer.rate, 1),
        formatNumberBR(photographer.revenue),
        photographer.printed,
        photographer.digital,
      ]);
    }
  } else {
    rows.push(['Nenhum fotógrafo com sessões no período', 0, 0, formatNumberBR(0, 1), formatNumberBR(0), 0, 0]);
  }
  rows.push([]);

  // Lançamentos analíticos: uma linha por pedido pago.
  rows.push(['LANÇAMENTOS']);
  rows.push([
    'Data/Hora',
    'Origem',
    'Pedido',
    'Cliente',
    'CPF',
    'Telefone',
    'Descrição',
    'Forma de pagamento',
    'Valor (R$)',
  ]);
  for (const entry of entries) {
    rows.push([
      formatDateTimeBR(entry.createdAt),
      entry.source,
      entry.orderId,
      entry.clientName,
      entry.clientCpf,
      entry.clientPhone,
      entry.description,
      entry.methodLabel,
      formatNumberBR(entry.total),
    ]);
  }
  rows.push(['TOTAL', '', '', '', '', '', '', `${entries.length} lançamento(s)`, formatNumberBR(summary.totalRevenue)]);
  rows.push([]);
  rows.push(['Relatório gerado automaticamente pelo Setland Photos Desktop.']);
  rows.push(['Período de referência', summary.rangeLabel, 'Intervalo', range.start ? 'definido' : 'aberto']);

  return buildCsvContent(rows);
}

/* ========================================================================== */
/* Componente                                                                  */
/* ========================================================================== */

export default function AccountingReportModal({
  isOpen,
  onClose,
  initialPeriod = 'mes',
}: AccountingReportModalProps) {
  const [period, setPeriod] = useState<PeriodSelection>(initialPeriod);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);
  const [onlineOrders, setOnlineOrders] = useState<OnlineOrderRow[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Carrega o export completo do ERP (pedidos pagos + vendas do site). */
  const loadReportData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const [employeesResult, sessionsResult, ordersResult, onlineOrdersResult] = await Promise.all([
        supabase.from('employees').select('*').eq('status', 'Ativo').order('name', { ascending: true }),
        supabase.from('photo_sessions').select('*').order('created_at', { ascending: false }),
        supabase
          .from('orders')
          .select('*, photo_sessions ( photographer_name, clients ( name, cpf, phone ) )')
          .eq('status', 'paid')
          .order('created_at', { ascending: false }),
        supabase
          .from('online_orders')
          .select('*')
          .in('payment_status', ['paid', 'delivered'])
          .order('created_at', { ascending: false }),
      ]);

      const failure =
        employeesResult.error || sessionsResult.error || ordersResult.error || onlineOrdersResult.error;
      if (failure) throw new Error(failure.message);

      setEmployees((employeesResult.data as EmployeeRow[] | null) ?? []);
      setSessions((sessionsResult.data as SessionRow[] | null) ?? []);
      setOrders((ordersResult.data as OrderWithRelations[] | null) ?? []);
      setOnlineOrders((onlineOrdersResult.data as OnlineOrderRow[] | null) ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar os dados do fechamento.';
      setLoadError(message);
      console.error('[Fechamento Contábil] Erro ao carregar dados:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Ao abrir, herda o período do Dashboard e recarrega os dados do ERP.
  useEffect(() => {
    if (!isOpen) return;

    const now = new Date();
    setPeriod(initialPeriod);
    setCustomStart(formatDateInput(startOfMonth(now)));
    setCustomEnd(formatDateInput(now));
    void loadReportData();
  }, [isOpen, initialPeriod, loadReportData]);

  /** Intervalo efetivo: reage à troca de período e às datas personalizadas. */
  const range = useMemo<DateRange>(() => {
    if (period !== 'personalizado') return resolvePeriodRange(period);

    const start = parseDateInput(customStart, 'start');
    const end = parseDateInput(customEnd, 'end');

    // Se o usuário inverter as datas, normalizamos em vez de devolver vazio.
    if (start && end && start.getTime() > end.getTime()) return { start: end, end: start };
    return { start, end };
  }, [period, customStart, customEnd]);

  const dataset = useMemo<AnalyticsDataset>(
    () => ({ employees, sessions, orders, onlineOrders }),
    [employees, sessions, orders, onlineOrders],
  );

  const summary = useMemo(() => summarizeDataset(dataset, range), [dataset, range]);

  /** Apenas fotógrafos (Operador) aparecem no rateio de comissão. */
  const photographers = useMemo(() => {
    const operators = employees.filter((employee) => {
      const role = (employee.role ?? '').trim().toLowerCase();
      return role === '' || role === 'operador' || role === 'fotógrafo' || role === 'fotografo';
    });

    return buildPhotographerPerformance({ ...dataset, employees: operators }, range);
  }, [dataset, employees, range]);

  const entries = useMemo(
    () => buildAccountingEntries(orders, onlineOrders, sessions, range),
    [orders, onlineOrders, sessions, range],
  );

  const scoped = useMemo(() => filterDatasetByRange(dataset, range), [dataset, range]);

  const handleExportCsv = useCallback(() => {
    if (entries.length === 0) {
      toast.error('Nenhum lançamento no período selecionado.', {
        description: 'Ajuste o período do fechamento antes de exportar.',
      });
      return;
    }

    try {
      const generatedAt = new Date();
      const content = buildAccountingCsv({ summary, photographers, entries, range, generatedAt });
      downloadCsv(buildCsvFileName('fechamento-contabil', range, generatedAt), content);

      toast.success(`Fechamento exportado: ${entries.length} lançamento(s).`, {
        description: `CSV com separador "${CSV_SEPARATOR}" e UTF-8 (BOM) pronto para o ERP.`,
      });
    } catch (err) {
      console.error('[Fechamento Contábil] Erro ao exportar CSV:', err);
      toast.error('Não foi possível gerar o arquivo CSV.');
    }
  }, [entries, photographers, range, summary]);

  const summaryCards = [
    {
      label: 'Faturamento total',
      value: formatCurrencyBRL(summary.totalRevenue),
      hint: `${summary.salesCount} transação(ões)`,
    },
    {
      label: 'Ticket médio',
      value: formatCurrencyBRL(summary.ticketAverage),
      hint: `PDV ${formatCurrencyBRL(summary.pdvRevenue)} · Site ${formatCurrencyBRL(summary.onlineRevenue)}`,
    },
    {
      label: 'Taxa de conversão',
      value: formatPercentBR(summary.conversionRate, 1),
      hint: `${summary.convertedSessions} de ${summary.totalSessions} sessão(ões)`,
    },
    {
      label: 'Sessões aguardando',
      value: summary.pendingSessions.toString(),
      hint: `${scoped.sessions.length} sessão(ões) no período`,
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-brand-surface border-border sm:max-w-5xl sm:rounded-[2rem] p-6 md:p-8 max-h-[92vh] overflow-y-auto">
        <DialogHeader className="flex flex-col items-center text-center mt-2 mb-2">
          <div className="w-16 h-16 rounded-full bg-brand-accent/10 text-brand-accent flex items-center justify-center mb-5 border border-brand-accent/20">
            <FileSpreadsheet className="h-8 w-8" />
          </div>
          <DialogTitle className="text-2xl font-bold text-foreground tracking-tight">
            Fechamento Contábil (ERP)
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-sm mt-2">
            Confira os lançamentos do período e exporte em CSV com separador &quot;;&quot; e UTF-8 (BOM).
          </DialogDescription>
        </DialogHeader>

        {/* Filtros do fechamento */}
        <div className="flex flex-col lg:flex-row lg:items-end gap-3 rounded-2xl border border-border bg-background/60 p-4">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <CalendarRange className="h-3.5 w-3.5" />
              Período do fechamento
            </label>
            <Select value={period} onValueChange={(value) => setPeriod(value as PeriodSelection)}>
              <SelectTrigger className="w-full h-11 bg-card border border-border rounded-xl text-foreground focus:ring-brand-accent">
                <SelectValue placeholder="Selecione o período" />
              </SelectTrigger>
              <SelectContent className="bg-card">
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="ontem">Ontem</SelectItem>
                <SelectItem value="semana">Últimos 7 dias</SelectItem>
                <SelectItem value="mes">Este Mês</SelectItem>
                <SelectItem value="30dias">Últimos 30 dias</SelectItem>
                <SelectItem value="todos">Todo o período</SelectItem>
                <SelectItem value="personalizado">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {period === 'personalizado' && (
            <>
              <div className="w-full lg:w-40">
                <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5 block">
                  De
                </label>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(event) => setCustomStart(event.target.value)}
                  className="h-11 rounded-xl bg-card border-border font-mono"
                />
              </div>
              <div className="w-full lg:w-40">
                <label className="text-xs font-semibold text-brand-muted uppercase tracking-wider mb-1.5 block">
                  Até
                </label>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(event) => setCustomEnd(event.target.value)}
                  className="h-11 rounded-xl bg-card border-border font-mono"
                />
              </div>
            </>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() => void loadReportData()}
            disabled={isLoading}
            className="h-11 rounded-xl px-4"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>

        {loadError && (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold">Falha ao carregar os dados do fechamento.</p>
              <p className="mt-0.5 opacity-90">{loadError}</p>
            </div>
          </div>
        )}

        {/* KPIs do fechamento */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium text-muted-foreground">{card.label}</p>
              <p className="mt-1 text-xl font-bold font-mono tabular-figures text-foreground tracking-tight">
                {card.value}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{card.hint}</p>
            </div>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          Período selecionado: <strong className="text-foreground font-medium">{summary.rangeLabel}</strong> ·{' '}
          <strong className="text-foreground font-medium">{entries.length}</strong> lançamento(s) exportável(is).
        </p>

        {/* Formas de pagamento */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-border-dashed">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Faturamento por forma de pagamento</h3>
          </div>
          {summary.paymentBreakdown.length > 0 ? (
            <div className="divide-y divide-border">
              {summary.paymentBreakdown.map((method) => (
                <div key={method.method} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{method.label}</p>
                    <p className="text-[11px] text-muted-foreground font-mono tabular-figures">
                      {method.count} transação(ões) · {formatPercentBR(method.share, 1)} do faturamento
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold font-mono tabular-figures text-foreground">
                      {formatCurrencyBRL(method.total)}
                    </p>
                    <div className="mt-1 h-1 w-28 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-brand-accent rounded-full" style={{ width: `${Math.min(100, method.share)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-5 py-6 text-sm text-muted-foreground text-center">
              Nenhum pagamento confirmado neste período.
            </p>
          )}
        </div>

        {/* Prévia dos lançamentos */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border-dashed">
            <h3 className="text-sm font-semibold text-foreground">Prévia dos lançamentos</h3>
            <span className="text-xs text-muted-foreground font-mono tabular-figures">
              {entries.length} linha(s) no CSV
            </span>
          </div>

          <div className="max-h-[38vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="px-5 py-3 text-xs font-semibold uppercase tracking-wider">Data</TableHead>
                  <TableHead className="px-5 py-3 text-xs font-semibold uppercase tracking-wider">Origem</TableHead>
                  <TableHead className="px-5 py-3 text-xs font-semibold uppercase tracking-wider">Cliente</TableHead>
                  <TableHead className="px-5 py-3 text-xs font-semibold uppercase tracking-wider">Descrição</TableHead>
                  <TableHead className="px-5 py-3 text-xs font-semibold uppercase tracking-wider">Pagamento</TableHead>
                  <TableHead className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando lançamentos do ERP...
                      </span>
                    </TableCell>
                  </TableRow>
                ) : entries.length > 0 ? (
                  entries.map((entry) => (
                    <TableRow key={entry.id} className="hover:bg-muted/30 border-b-border-dashed">
                      <TableCell className="px-5 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTimeBR(entry.createdAt)}
                      </TableCell>
                      <TableCell className="px-5 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            entry.source === 'Site'
                              ? 'bg-blue-500/10 text-blue-500 border-blue-500/20'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                          }`}
                        >
                          {entry.source}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3">
                        <p className="text-sm font-medium text-foreground">{entry.clientName}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {entry.orderId}
                          {entry.clientCpf ? ` · ${entry.clientCpf}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="px-5 py-3 text-sm text-muted-foreground max-w-[220px] truncate">
                        {entry.description}
                      </TableCell>
                      <TableCell className="px-5 py-3 text-sm text-muted-foreground">{entry.methodLabel}</TableCell>
                      <TableCell className="px-5 py-3 text-right font-mono font-bold text-sm tabular-figures">
                        {formatCurrencyBRL(entry.total)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                      Nenhum lançamento encontrado para o período selecionado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-4 bg-muted/30 border-t border-border-dashed">
            <span className="text-sm text-muted-foreground">
              Total conferido:{' '}
              <strong className="text-foreground font-mono tabular-figures">
                {formatCurrencyBRL(summary.totalRevenue)}
              </strong>
            </span>
            <span className="text-xs text-muted-foreground">Separador &quot;;&quot; · UTF-8 com BOM</span>
          </div>
        </div>

        <div className="pt-2 flex flex-col-reverse sm:flex-row gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl font-medium text-brand-muted hover:bg-brand-bg hover:text-brand-ink transition-colors text-sm border border-transparent"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={isLoading || entries.length === 0}
            className="flex-1 py-3 px-4 bg-brand-accent text-brand-accent-fg rounded-xl font-semibold hover:opacity-90 transition-opacity text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <Download className="h-4 w-4" />
            Exportar CSV para o ERP
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

