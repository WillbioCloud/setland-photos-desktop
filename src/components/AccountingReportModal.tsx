import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import { buildAccountingExcel, buildExcelFileName, downloadExcel } from '@/lib/excelExport';
import watermarkLogo from '../assets/watermark_setland.png';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import {
  buildCsvContent,
  buildPhotographerPerformance,
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
        method: order.payment_method || 'online',
        methodLabel: order.payment_method
          ? `${paymentMethodLabel(order.payment_method)} (Site)`
          : paymentMethodLabel('online'),
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

  const pushRow = (row: (string | number)[]) => {
    // Preenche com colunas vazias até 9 colunas para garantir um grid perfeito no Excel
    const padded = [...row];
    while (padded.length < 9) {
      padded.push('');
    }
    rows.push(padded);
  };

  const addDivider = () => pushRow(['--------------------------------------------------------------------------------']);
  const addDoubleDivider = () => pushRow(['================================================================================']);

  // Cabeçalho de identificação do fechamento.
  addDoubleDivider();
  pushRow(['RELATÓRIO EXECUTIVO E FECHAMENTO CONTÁBIL']);
  addDoubleDivider();
  pushRow(['Empresa', 'Setland Fotografia']);
  pushRow(['Sistema', 'Setland Photos Desktop - Terminal 01']);
  pushRow(['Período de Referência', summary.rangeLabel]);
  pushRow(['Data de Geração', formatDateTimeBR(generatedAt)]);
  pushRow(['Moeda', 'BRL (R$)']);
  pushRow(['Formato', 'Valores numéricos formatados em PT-BR (vírgula decimal)']);
  pushRow([]);

  // Resumo para conferência do contador.
  addDivider();
  pushRow(['RESUMO GERAL DO PERÍODO']);
  addDivider();
  pushRow(['Indicador', 'Valor']);
  pushRow(['Faturamento Total (R$)', formatNumberBR(summary.totalRevenue)]);
  pushRow(['Faturamento PDV (R$)', formatNumberBR(summary.pdvRevenue)]);
  pushRow(['Faturamento Site (R$)', formatNumberBR(summary.onlineRevenue)]);
  pushRow([]);
  pushRow(['Transações Concluídas', summary.salesCount]);
  pushRow(['Transações PDV', summary.pdvSalesCount]);
  pushRow(['Transações Site', summary.onlineSalesCount]);
  pushRow(['Ticket Médio (R$)', formatNumberBR(summary.ticketAverage)]);
  pushRow([]);
  pushRow(['Sessões Realizadas', summary.totalSessions]);
  pushRow(['Sessões Convertidas', summary.convertedSessions]);
  pushRow(['Sessões Pendentes', summary.pendingSessions]);
  pushRow(['Taxa de Conversão (%)', formatNumberBR(summary.conversionRate, 1)]);
  pushRow([]);

  // Faturamento por forma de pagamento (conciliação com a maquininha/banco).
  addDivider();
  pushRow(['CONCILIAÇÃO POR FORMA DE PAGAMENTO']);
  addDivider();
  pushRow(['Forma de Pagamento', 'Transações', 'Total Faturado (R$)', 'Participação (%)']);
  if (summary.paymentBreakdown.length > 0) {
    for (const method of summary.paymentBreakdown) {
      pushRow([
        method.label,
        method.count,
        formatNumberBR(method.total),
        formatNumberBR(method.share, 1),
      ]);
    }
  } else {
    pushRow(['Nenhum lançamento no período', 0, formatNumberBR(0), formatNumberBR(0, 1)]);
  }
  pushRow([]);

  // Performance da equipe (rateio de comissionamento).
  addDivider();
  pushRow(['DESEMPENHO DA EQUIPE (FOTÓGRAFOS)']);
  addDivider();
  pushRow([
    'Fotógrafo',
    'Sessões',
    'Convertidas',
    'Taxa de Conversão (%)',
    'Faturamento Gerado (R$)',
    'Fotos Impressas',
    'Fotos Digitais',
  ]);
  if (photographers.length > 0) {
    for (const photographer of photographers) {
      pushRow([
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
    pushRow(['Nenhuma atividade no período', 0, 0, formatNumberBR(0, 1), formatNumberBR(0), 0, 0]);
  }
  pushRow([]);

  // Lançamentos analíticos: uma linha por pedido pago.
  addDoubleDivider();
  pushRow(['LIVRO-CAIXA / LANÇAMENTOS DETALHADOS']);
  addDoubleDivider();
  pushRow([
    'Data/Hora',
    'Origem',
    'ID Pedido',
    'Cliente',
    'CPF',
    'Telefone',
    'Pacote / Descrição',
    'Forma de Pagamento',
    'Valor Recebido (R$)',
  ]);
  for (const entry of entries) {
    pushRow([
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
  addDivider();
  pushRow([
    'TOTAL GERAL NO PERÍODO',
    '',
    '',
    '',
    '',
    '',
    `${entries.length} lançamento(s)`,
    '->',
    formatNumberBR(summary.totalRevenue),
  ]);
  addDoubleDivider();
  pushRow([]);
  pushRow(['Relatório gerado automaticamente pelo Setland Photos Desktop.']);
  pushRow(['Período de Referência', summary.rangeLabel, 'Intervalo', range.start ? 'Definido' : 'Aberto']);

  return buildCsvContent(rows);
}

/** Escapa qualquer texto vindo do banco antes de inseri-lo no HTML exportado. */
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

/** Converte o asset importado em uma URI de dados para manter o HTML autônomo. */
async function embedImageAsDataUrl(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;

  const response = await fetch(source);
  if (!response.ok) throw new Error('Não foi possível carregar o logo do relatório.');

  const image = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao incorporar o logo.'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Formato de logo inválido.'));
    };
    reader.readAsDataURL(image);
  });
}

/** Usa um fallback inline para o Electron, onde fetch(file://...) não é permitido. */
async function loadStandaloneReportLogo(): Promise<string> {
  try {
    return await embedImageAsDataUrl(watermarkLogo);
  } catch {
    const { default: inlineLogo } = await import('../assets/watermark_setland.png?inline');
    if (!inlineLogo.startsWith('data:')) throw new Error('Não foi possível incorporar o logo do relatório.');
    return inlineLogo;
  }
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

  const handleExportExcel = useCallback(async () => {
    if (entries.length === 0) {
      toast.error('Nenhum lançamento no período selecionado.', {
        description: 'Ajuste o período do fechamento antes de exportar.',
      });
      return;
    }

    try {
      const generatedAt = new Date();
      const blob = await buildAccountingExcel({ summary, photographers, entries, range, generatedAt });
      downloadExcel(buildExcelFileName('fechamento-contabil', range, generatedAt), blob);

      toast.success(`Fechamento exportado: ${entries.length} lançamento(s).`, {
        description: 'Planilha com os relatórios pronta para uso.',
      });
    } catch (err) {
      console.error('[Fechamento Contábil] Erro ao exportar Excel:', err);
      toast.error('Não foi possível gerar o arquivo Excel.');
    }
  }, [entries, photographers, range, summary]);

  /** Gera um demonstrativo executivo HTML autônomo, com identidade visual Setland. */
  const handleExportHtmlReport = useCallback(async () => {
    if (entries.length === 0) {
      toast.error('Nenhum lançamento no período selecionado.');
      return;
    }

    try {
      const generatedAt = new Date();
      const logoDataUrl = await loadStandaloneReportLogo();
      const safe = escapeHtml;
      const paymentRows = summary.paymentBreakdown
        .map(
          (payment) => `
            <tr>
              <td>${safe(payment.label)}</td>
              <td class="number">${safe(payment.count)}</td>
              <td class="number">${safe(formatCurrencyBRL(payment.total))}</td>
              <td class="number">${safe(formatPercentBR(payment.share, 1))}</td>
            </tr>`,
        )
        .join('');
      const entryRows = entries
        .map((entry) => {
          const clientCpf = entry.clientCpf
            ? `<span class="meta">CPF ${safe(entry.clientCpf)}</span>`
            : '';

          return `
            <tr>
              <td class="nowrap">${safe(formatDateTimeBR(entry.createdAt))}</td>
              <td>
                <span class="source-tag ${entry.source === 'Site' ? 'site' : 'pdv'}">${safe(entry.source)}</span>
                <span class="meta order-id">Pedido ${safe(entry.orderId)}</span>
              </td>
              <td><strong>${safe(entry.clientName)}</strong>${clientCpf}</td>
              <td>${safe(entry.description)}</td>
              <td>${safe(entry.methodLabel)}</td>
              <td class="number nowrap">${safe(formatCurrencyBRL(entry.total))}</td>
            </tr>`;
        })
        .join('');
      const rangeFileName = summary.rangeLabel
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const generatedAtLabel = generatedAt.toLocaleString('pt-BR');

      const reportHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fechamento Contábil - Setland (${safe(summary.rangeLabel)})</title>
  <style>
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; padding: 24px 0 40px; background: #ece9e4; color: #292321; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.45; }
    .toolbar { width: min(210mm, calc(100% - 32px)); margin: 0 auto 12px; display: flex; justify-content: flex-end; }
    .print-button { border: 0; border-radius: 7px; padding: 10px 15px; background: #aa8036; color: #fff; font: 600 12px Arial, sans-serif; cursor: pointer; box-shadow: 0 3px 10px rgba(42, 24, 24, .16); }
    .sheet { position: relative; width: min(210mm, calc(100% - 32px)); min-height: 297mm; margin: 0 auto; padding: 14mm; overflow: hidden; background: #fff; box-shadow: 0 14px 45px rgba(45, 31, 26, .14); }
    .masthead { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 42mm; margin-bottom: 18px; padding: 22px 24px; overflow: hidden; border-bottom: 4px solid #c5a04c; border-radius: 8px 8px 2px 2px; background: #4a1728; color: #fff; }
    .masthead-copy, .brand-seal { position: relative; z-index: 1; }
    .masthead-copy { min-width: 0; }
    .brand-kicker, .section-kicker { margin: 0 0 5px; color: #d8bd7c; font-size: 8px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; }
    h1 { max-width: 590px; margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 25px; font-weight: 600; line-height: 1.14; letter-spacing: -.02em; }
    .masthead-subtitle { margin: 8px 0 0; color: #f0e9e0; font-size: 10px; }
    .brand-seal { display: grid; width: 62px; height: 62px; flex: 0 0 62px; place-items: center; padding: 7px; border: 1px solid rgba(219, 190, 122, .7); border-radius: 50%; background: rgba(255, 255, 255, .96); }
    .brand-seal img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .masthead-watermark { position: absolute; top: -42px; right: 44px; width: 190px; height: 190px; object-fit: contain; opacity: .075; filter: grayscale(1); }
    .report-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 18px; margin: -7px 1px 16px; color: #756b62; font-size: 9px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 20px; }
    .metric { min-height: 72px; padding: 12px 13px; border: 1px solid #e7e0d8; border-radius: 7px; background: #fbfaf8; }
    .metric.primary { border-color: #d5bd83; background: #fbf7ed; }
    .metric-label { display: block; color: #776b60; font-size: 8px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
    .metric-value { display: block; margin-top: 5px; color: #4a1728; font-family: Georgia, 'Times New Roman', serif; font-size: 17px; font-weight: 700; letter-spacing: -.02em; }
    .metric-note { display: block; margin-top: 3px; color: #81776e; font-size: 8px; }
    .report-section { margin-top: 18px; }
    .section-heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 8px; padding-bottom: 7px; border-bottom: 1px solid #e9e3dc; }
    .section-heading h2 { margin: 0; color: #4a1728; font-family: Georgia, 'Times New Roman', serif; font-size: 15px; }
    .section-heading .section-kicker { margin-bottom: 3px; color: #9a793d; font-size: 7px; }
    .section-note { max-width: 230px; margin: 0; color: #82786e; font-size: 8px; text-align: right; }
    .channel-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 10px 0 12px; }
    .channel-card { padding: 10px 12px; border-left: 3px solid #c5a04c; border-radius: 3px 6px 6px 3px; background: #f8f6f2; }
    .channel-label { display: block; color: #776b60; font-size: 8px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .channel-value { display: block; margin-top: 4px; color: #302623; font-size: 13px; font-weight: 700; }
    .channel-note { display: block; margin-top: 2px; color: #81776e; font-size: 8px; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; }
    th { padding: 7px 6px; background: #4a1728; color: #fff; font-size: 7px; font-weight: 700; letter-spacing: .045em; text-align: left; text-transform: uppercase; }
    td { padding: 7px 6px; border-bottom: 1px solid #eee9e3; color: #453c37; font-size: 8px; vertical-align: top; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) td { background: #fcfbf9; }
    .number { text-align: right; white-space: nowrap; }
    .nowrap { white-space: nowrap; }
    .source-tag { display: inline-block; padding: 2px 5px; border: 1px solid #d9c68f; border-radius: 10px; color: #72551e; background: #faf4e5; font-size: 7px; font-weight: 700; }
    .source-tag.site { border-color: #c6d8eb; color: #285987; background: #eff6fc; }
    .meta { display: block; margin-top: 2px; color: #82786e; font-size: 7px; }
    .order-id { white-space: nowrap; }
    tfoot td { padding-top: 9px; border-top: 2px solid #bda05f; border-bottom: 0; background: #fbf8f1; color: #4a1728; font-size: 8px; font-weight: 700; }
    .report-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 16px; padding-top: 8px; border-top: 1px solid #e9e3dc; color: #82786e; font-size: 7px; }
    @media (max-width: 650px) {
      body { padding-top: 12px; }
      .sheet { width: calc(100% - 16px); padding: 12px; }
      .toolbar { width: calc(100% - 16px); }
      .masthead { padding: 17px; }
      h1 { font-size: 20px; }
      .brand-seal { width: 48px; height: 48px; flex-basis: 48px; }
      .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .channel-grid { grid-template-columns: 1fr; }
      .section-heading { align-items: start; flex-direction: column; }
      .section-note { max-width: none; text-align: left; }
      .table-wrap { overflow-x: auto; }
      .launch-table { min-width: 660px; }
    }
    @media print {
      @page { size: A4 portrait; margin: 12mm; }
      body { padding: 0; background: #fff; font-size: 9px; }
      .toolbar { display: none !important; }
      .sheet { width: auto; min-height: initial; margin: 0; padding: 0; overflow: visible; box-shadow: none; }
      .masthead { break-inside: avoid; page-break-inside: avoid; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .metric, .channel-card, .section-heading { break-inside: avoid; page-break-inside: avoid; }
      thead { display: table-header-group; }
      tfoot { display: table-row-group; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="toolbar"><button class="print-button" type="button" onclick="window.print()">Imprimir / Salvar em PDF</button></div>
  <main class="sheet">
    <header class="masthead">
      <img class="masthead-watermark" src="${logoDataUrl}" alt="" aria-hidden="true" />
      <div class="masthead-copy">
        <p class="brand-kicker">Setland Fotografia · Terminal 01</p>
        <h1>Demonstrativo de Fechamento Contábil</h1>
        <p class="masthead-subtitle">Gestão executiva de receitas · período ${safe(summary.rangeLabel)}</p>
      </div>
      <div class="brand-seal"><img src="${logoDataUrl}" alt="Castelo Setland" /></div>
    </header>

    <div class="report-meta">
      <span><strong>Período:</strong> ${safe(summary.rangeLabel)}</span>
      <span><strong>Emitido em:</strong> ${safe(generatedAtLabel)}</span>
    </div>

    <section class="summary-grid" aria-label="Resumo de faturamento">
      <article class="metric primary">
        <span class="metric-label">Faturamento total</span>
        <strong class="metric-value">${safe(formatCurrencyBRL(summary.totalRevenue))}</strong>
        <span class="metric-note">Consolidado do período</span>
      </article>
      <article class="metric">
        <span class="metric-label">Volume de vendas</span>
        <strong class="metric-value">${safe(summary.salesCount)} pedidos</strong>
        <span class="metric-note">PDV ${safe(summary.pdvSalesCount)} · Site ${safe(summary.onlineSalesCount)}</span>
      </article>
      <article class="metric">
        <span class="metric-label">Ticket médio</span>
        <strong class="metric-value">${safe(formatCurrencyBRL(summary.ticketAverage))}</strong>
        <span class="metric-note">Por venda concluída</span>
      </article>
      <article class="metric">
        <span class="metric-label">Taxa de conversão</span>
        <strong class="metric-value">${safe(formatPercentBR(summary.conversionRate, 1))}</strong>
        <span class="metric-note">${safe(summary.convertedSessions)} de ${safe(summary.totalSessions)} sessões</span>
      </article>
    </section>

    <section class="report-section">
      <div class="section-heading">
        <div><p class="section-kicker">Conferência financeira</p><h2>Conciliação de maquininha, Pix e vendas digitais</h2></div>
        <p class="section-note">Totais calculados com os mesmos critérios do fechamento ERP.</p>
      </div>
      <div class="channel-grid">
        <article class="channel-card">
          <span class="channel-label">PDV / Maquininha</span>
          <strong class="channel-value">${safe(formatCurrencyBRL(summary.pdvRevenue))}</strong>
          <span class="channel-note">${safe(summary.pdvSalesCount)} transação(ões) no caixa</span>
        </article>
        <article class="channel-card">
          <span class="channel-label">Site / Vendas online</span>
          <strong class="channel-value">${safe(formatCurrencyBRL(summary.onlineRevenue))}</strong>
          <span class="channel-note">${safe(summary.onlineSalesCount)} transação(ões) online</span>
        </article>
        <article class="channel-card">
          <span class="channel-label">Total consolidado</span>
          <strong class="channel-value">${safe(formatCurrencyBRL(summary.totalRevenue))}</strong>
          <span class="channel-note">${safe(summary.salesCount)} transação(ões) confirmadas</span>
        </article>
      </div>
      <table aria-label="Conciliação por forma de pagamento">
        <thead><tr><th>Forma de pagamento</th><th class="number">Transações</th><th class="number">Total</th><th class="number">Participação</th></tr></thead>
        <tbody>${paymentRows || '<tr><td colspan="4">Nenhum pagamento confirmado neste período.</td></tr>'}</tbody>
      </table>
    </section>

    <section class="report-section">
      <div class="section-heading">
        <div><p class="section-kicker">Livro-caixa</p><h2>Lançamentos detalhados</h2></div>
        <p class="section-note">${safe(entries.length)} registro(s) · valores em reais (BRL)</p>
      </div>
      <div class="table-wrap">
        <table class="launch-table" aria-label="Lançamentos detalhados do período">
          <thead><tr><th>Data / Hora</th><th>Canal / Pedido</th><th>Cliente / CPF</th><th>Descrição</th><th>Pagamento</th><th class="number">Valor</th></tr></thead>
          <tbody>${entryRows}</tbody>
          <tfoot><tr><td colspan="5">TOTAL · ${safe(entries.length)} lançamento(s)</td><td class="number">${safe(formatCurrencyBRL(summary.totalRevenue))}</td></tr></tfoot>
        </table>
      </div>
    </section>

    <footer class="report-footer">
      <span>Documento gerado automaticamente pelo Setland Photos Desktop.</span>
      <span>Setland Fotografia · Terminal 01</span>
    </footer>
  </main>
</body>
</html>`;

      const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Relatorio_Executivo_Setland_${rangeFileName || 'periodo'}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success('Relatório Executivo gerado com sucesso!', {
        description: 'Arquivo gerado e pronto para visualizar ou imprimir.',
      });
    } catch (err) {
      console.error('[Fechamento Contábil] Erro ao gerar relatório visual:', err);
      toast.error('Não foi possível gerar o Relatório Visual.');
    }
  }, [entries, summary]);

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
      <DialogContent
        showCloseButton={false}
        className="bg-brand-surface border-border sm:max-w-5xl sm:rounded-[2rem] h-[90vh] max-h-[90vh] min-h-0 flex flex-col gap-0 overflow-hidden p-0"
      >
        {/* Cabeçalho fixo: título e ações permanecem visíveis durante a rolagem. */}
        <DialogHeader className="shrink-0 border-b border-border bg-brand-surface px-4 py-3 md:px-6 md:py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-accent/20 bg-brand-accent/10 text-brand-accent">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold tracking-tight text-foreground md:text-xl">
                  Fechamento Contábil (ERP)
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-muted-foreground">
                  Demonstrativo fiscal de receitas · {summary.rangeLabel}
                </DialogDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void handleExportHtmlReport()}
                disabled={isLoading || entries.length === 0}
                title="Baixar relatório HTML independente para visualizar ou salvar como PDF"
                aria-label="Gerar Relatório Visual (PDF / Castelo)"
                className="h-8 rounded-xl bg-brand-accent px-3 font-semibold text-brand-accent-fg shadow-sm hover:opacity-90"
              >
                <FileText className="h-4 w-4" />
                <span>Relatório Visual</span>
                <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-medium leading-none">PDF / Castelo</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void handleExportExcel()}
                disabled={isLoading || entries.length === 0}
                title="Exportar planilha Excel (.xlsx) com identidade visual Setland"
                className="h-8 rounded-xl border-border bg-background/60 px-3 text-foreground backdrop-blur-sm hover:bg-muted"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Exportar Excel</span>
                <span className="hidden text-[10px] text-muted-foreground sm:inline">(.xlsx)</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onClose}
                className="h-8 rounded-xl px-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
                <span>Fechar</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Única área rolável do modal; scrollbar ocultada em todos os navegadores. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 no-scrollbar md:px-6 md:py-5">
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

        </div>
      </DialogContent>
    </Dialog>
  );
}

