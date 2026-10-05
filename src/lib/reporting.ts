/**
 * reporting.ts
 * ---------------------------------------------------------------------------
 * Utilidades compartilhadas de período, métricas e exportação usadas pelo
 * Dashboard (Visão Executiva / Operador) e pelo Fechamento Contábil (ERP).
 *
 * Centralizar as regras aqui garante que o filtro de período do Dashboard e o
 * relatório exportado em CSV falem exatamente a mesma "língua": mesma janela de
 * datas, mesma definição de sessão convertida e mesmo arredondamento.
 */

/* ========================================================================== */
/* Períodos                                                                    */
/* ========================================================================== */

export type PeriodKey = 'hoje' | 'ontem' | 'semana' | 'mes' | '30dias' | 'todos';

export interface PeriodOption {
  value: PeriodKey;
  label: string;
}

/** Opções de período exibidas nos filtros (Dashboard e Fechamento Contábil). */
export const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: 'semana', label: 'Últimos 7 dias' },
  { value: 'mes', label: 'Este Mês' },
  { value: '30dias', label: 'Últimos 30 dias' },
  { value: 'todos', label: 'Todo o período' },
];

export interface DateRange {
  /** Início inclusivo do intervalo (null = sem limite inferior). */
  start: Date | null;
  /** Fim inclusivo do intervalo (null = sem limite superior). */
  end: Date | null;
}

export const UNBOUNDED_RANGE: DateRange = { start: null, end: null };

export function startOfDay(reference: Date): Date {
  const date = new Date(reference);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(reference: Date): Date {
  const date = new Date(reference);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function addDays(reference: Date, days: number): Date {
  const date = new Date(reference);
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Converte uma `PeriodKey` em um intervalo de datas concreto.
 * O cálculo é sempre relativo ao momento em que a função é chamada, o que
 * torna o filtro reativo também na virada do dia.
 */
export function resolvePeriodRange(period: PeriodKey, reference: Date = new Date()): DateRange {
  const today = startOfDay(reference);

  switch (period) {
    case 'hoje':
      return { start: today, end: endOfDay(reference) };
    case 'ontem': {
      const yesterday = addDays(today, -1);
      return { start: yesterday, end: endOfDay(yesterday) };
    }
    case 'semana':
      // Hoje + os 6 dias anteriores.
      return { start: addDays(today, -6), end: endOfDay(reference) };
    case 'mes':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: endOfDay(reference) };
    case '30dias':
      // Hoje + os 29 dias anteriores.
      return { start: addDays(today, -29), end: endOfDay(reference) };
    case 'todos':
    default:
      return { ...UNBOUNDED_RANGE };
  }
}

/** Verifica se a data informada pertence ao intervalo (inclusivo nas bordas). */
export function isWithinRange(
  value: string | number | Date | null | undefined,
  range: DateRange,
): boolean {
  const date = toDate(value);
  if (!date) return false;
  if (range.start && date.getTime() < range.start.getTime()) return false;
  if (range.end && date.getTime() > range.end.getTime()) return false;
  return true;
}

/** `yyyy-MM-dd` para inputs nativos `type="date"` (sempre no fuso local). */
export function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Lê um `yyyy-MM-dd` vindo de um input de data e devolve o Date já posicionado
 * no início ou no fim do dia (evitando que lançamentos do último dia do
 * período fiquem de fora do fechamento).
 * Retorna `null` para valores vazios ou inválidos.
 */
export function parseDateInput(value: string, boundary: 'start' | 'end'): Date | null {
  if (!value) return null;

  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;

  const date = boundary === 'start'
    ? new Date(year, month - 1, day, 0, 0, 0, 0)
    : new Date(year, month - 1, day, 23, 59, 59, 999);

  // Rejeita datas "roladas" pelo JavaScript (ex: 2026-02-31).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

/** Primeiro dia do mês de referência (usado no período personalizado). */
export function startOfMonth(reference: Date): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), 1);
}

/* ========================================================================== */
/* Formatação (pt-BR)                                                          */
/* ========================================================================== */

export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Converte valores vindos do Supabase (numeric pode chegar como string) em
 * número seguro, aceitando inclusive o formato pt-BR "1.234,56".
 */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const normalized = trimmed.includes(',')
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function formatNumberBR(value: unknown, digits = 2): string {
  return toNumber(value).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrencyBRL(value: unknown): string {
  return `R$ ${formatNumberBR(value)}`;
}

export function formatPercentBR(value: number, digits = 0): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/** Limita percentuais ao intervalo 0–100 (protege contra dados inconsistentes). */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function formatDateBR(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString('pt-BR') : '--';
}

export function formatTimeBR(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';
}

export function formatDateTimeBR(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date
    ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : '--';
}

/** Texto humano do intervalo, usado nos cabeçalhos do Dashboard e do CSV. */
export function describeRange(range: DateRange): string {
  if (!range.start && !range.end) return 'Todo o período';

  if (range.start && range.end) {
    const sameDay = range.start.toDateString() === range.end.toDateString();
    return sameDay
      ? formatDateBR(range.start)
      : `${formatDateBR(range.start)} a ${formatDateBR(range.end)}`;
  }

  if (range.start) return `A partir de ${formatDateBR(range.start)}`;
  return `Até ${formatDateBR(range.end)}`;
}

/* ========================================================================== */
/* Regras de negócio (status e formas de pagamento)                            */
/* ========================================================================== */

export const PAID_ORDER_STATUS = 'paid';
export const PAID_ONLINE_ORDER_STATUSES = ['paid', 'delivered'];
/** Status de `photo_sessions` que representam sessão efetivamente vendida. */
export const CONVERTED_SESSION_STATUSES = ['convertido/pago', 'convertido', 'pago', 'pdv', 'site'];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de Crédito',
  card: 'Cartão',
  cartao: 'Cartão',
  credito: 'Cartão de Crédito',
  debit_card: 'Cartão de Débito',
  debito: 'Cartão de Débito',
  cash: 'Dinheiro',
  dinheiro: 'Dinheiro',
  money: 'Dinheiro',
  online: 'Online (Site)',
  indefinido: 'Não informado',
};

export function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

export function isPaidPdvOrder(order: { status?: string | null }): boolean {
  return normalizeStatus(order.status) === PAID_ORDER_STATUS;
}

export function isPaidOnlineOrder(order: { payment_status?: string | null }): boolean {
  return PAID_ONLINE_ORDER_STATUSES.includes(normalizeStatus(order.payment_status));
}

export function isConvertedSessionStatus(status: string | null | undefined): boolean {
  return CONVERTED_SESSION_STATUSES.includes(normalizeStatus(status));
}

export const PENDING_SESSION_STATUSES = ['pendente', 'aguardando', 'aguardando decisão', 'aguardando decisao'];

export function isPendingSessionStatus(status: string | null | undefined): boolean {
  return PENDING_SESSION_STATUSES.includes(normalizeStatus(status));
}

/** Rótulo legível da forma de pagamento (também usado no CSV do ERP). */
export function paymentMethodLabel(method: string | null | undefined): string {
  const key = normalizeStatus(method);
  if (!key) return 'Não informado';
  if (PAYMENT_METHOD_LABELS[key]) return PAYMENT_METHOD_LABELS[key];
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Chave de agrupamento das formas de pagamento (faturamento por método). */
export function paymentMethodKey(method: string | null | undefined): string {
  const key = normalizeStatus(method);
  if (!key) return 'indefinido';
  if (key === 'cartao' || key === 'card') return 'credit_card';
  if (key === 'credito') return 'credit_card';
  if (key === 'debito') return 'debit_card';
  if (key === 'dinheiro' || key === 'money') return 'cash';
  return key;
}

/* ========================================================================== */
/* Tipos das tabelas (visão mínima usada pelos relatórios)                     */
/* ========================================================================== */

export interface EmployeeRow {
  id: string;
  name?: string | null;
  role?: string | null;
  status?: string | null;
  avatar_url?: string | null;
}

export interface SessionRow {
  id: string;
  created_at?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  client_cpf?: string | null;
  client_phone?: string | null;
  photographer_id?: string | null;
  photographer_name?: string | null;
  status?: string | null;
}

export interface OrderRow {
  id: string;
  created_at?: string | null;
  session_id?: string | null;
  total_amount?: number | string | null;
  payment_method?: string | null;
  status?: string | null;
  photographer_name?: string | null;
  printed_count?: number | string | null;
  digital_count?: number | string | null;
}

export interface OnlineOrderRow {
  id: string;
  created_at?: string | null;
  client_id?: string | null;
  /** Vínculo direto com a sessão (quando o portal grava a referência). */
  session_id?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  total_amount?: number | string | null;
  package_name?: string | null;
  payment_status?: string | null;
}

export interface AnalyticsDataset {
  employees: EmployeeRow[];
  sessions: SessionRow[];
  orders: OrderRow[];
  onlineOrders: OnlineOrderRow[];
}

export const EMPTY_DATASET: AnalyticsDataset = {
  employees: [],
  sessions: [],
  orders: [],
  onlineOrders: [],
};

/* ========================================================================== */
/* Índices e conversão                                                         */
/* ========================================================================== */

function normalizeName(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase();
}

/** Sessões agrupadas por cliente, da mais recente para a mais antiga. */
export function indexSessionsByClient(sessions: SessionRow[]): Map<string, SessionRow[]> {
  const index = new Map<string, SessionRow[]>();

  for (const session of sessions) {
    if (!session.client_id) continue;
    const bucket = index.get(session.client_id);
    if (bucket) bucket.push(session);
    else index.set(session.client_id, [session]);
  }

  for (const bucket of index.values()) {
    bucket.sort((a, b) => toNumber(toDate(b.created_at)?.getTime()) - toNumber(toDate(a.created_at)?.getTime()));
  }

  return index;
}

/**
 * Descobre a sessão de origem de um pedido online.
 * 1) Usa `session_id` quando o portal gravou o vínculo direto;
 * 2) Caso contrário cai para o `client_id` (convenção usada em Clientes.tsx e
 *    ClientProfileModal), escolhendo a sessão mais recente criada até a data do
 *    pedido — ou a mais recente disponível, se todas forem posteriores.
 */
export function findOnlineOrderSession(
  order: OnlineOrderRow,
  sessionsByClient: Map<string, SessionRow[]>,
  sessionById?: Map<string, SessionRow>,
): SessionRow | null {
  if (order.session_id && sessionById?.has(order.session_id)) {
    return sessionById.get(order.session_id) ?? null;
  }

  if (!order.client_id) return null;

  const candidates = sessionsByClient.get(order.client_id);
  if (!candidates || candidates.length === 0) return null;

  const orderTime = toDate(order.created_at)?.getTime();
  if (orderTime === undefined) return candidates[0];

  // `candidates` está ordenado do mais recente para o mais antigo.
  const previous = candidates.find((session) => {
    const sessionTime = toDate(session.created_at)?.getTime();
    return sessionTime !== undefined && sessionTime <= orderTime;
  });

  return previous ?? candidates[0];
}

/**
 * Índice das sessões convertidas.
 *
 * Correção em relação ao cálculo anterior: a conversão passa a ser contada por
 * SESSÃO (não por pedido). Antes, um cliente com 3 pedidos em 1 sessão gerava
 * "300% de conversão" e pedidos online sem sessão vinculada inflavam a taxa.
 */
export function buildConvertedSessionIndex(dataset: AnalyticsDataset): Set<string> {
  const converted = new Set<string>();
  const sessionById = new Map(dataset.sessions.map((session) => [session.id, session]));
  const sessionsByClient = indexSessionsByClient(dataset.sessions);

  // 1. Status da própria sessão já registra a venda.
  for (const session of dataset.sessions) {
    if (isConvertedSessionStatus(session.status)) converted.add(session.id);
  }

  // 2. Pedido de PDV pago marca a sessão correspondente como convertida.
  for (const order of dataset.orders) {
    if (!isPaidPdvOrder(order)) continue;
    if (order.session_id && sessionById.has(order.session_id)) converted.add(order.session_id);
  }

  // 3. Pedido online pago marca a sessão de origem (vínculo direto ou por cliente).
  for (const order of dataset.onlineOrders) {
    if (!isPaidOnlineOrder(order)) continue;
    const session = findOnlineOrderSession(order, sessionsByClient, sessionById);
    if (session) converted.add(session.id);
  }

  return converted;
}

/* ========================================================================== */
/* Resumo do período (KPIs, faturamento e formas de pagamento)                 */
/* ========================================================================== */

export interface PaymentMethodSummary {
  method: string;
  label: string;
  count: number;
  total: number;
  /** Participação no faturamento total (0–100). */
  share: number;
}

export interface ReportSummary {
  range: DateRange;
  /** Período rotulado para exibição/CSV. */
  rangeLabel: string;
  totalRevenue: number;
  pdvRevenue: number;
  onlineRevenue: number;
  salesCount: number;
  pdvSalesCount: number;
  onlineSalesCount: number;
  ticketAverage: number;
  totalSessions: number;
  convertedSessions: number;
  pendingSessions: number;
  /** Percentual exato de conversão (sessões convertidas / sessões do período). */
  conversionRate: number;
  paymentBreakdown: PaymentMethodSummary[];
}

/** Recorta sessões, pedidos e vendas online pelo intervalo informado. */
export function filterDatasetByRange(dataset: AnalyticsDataset, range: DateRange): AnalyticsDataset {
  return {
    employees: dataset.employees,
    sessions: dataset.sessions.filter((session) => isWithinRange(session.created_at, range)),
    orders: dataset.orders.filter((order) => isPaidPdvOrder(order) && isWithinRange(order.created_at, range)),
    onlineOrders: dataset.onlineOrders.filter(
      (order) => isPaidOnlineOrder(order) && isWithinRange(order.created_at, range),
    ),
  };
}

export function summarizeDataset(dataset: AnalyticsDataset, range: DateRange): ReportSummary {
  const scoped = filterDatasetByRange(dataset, range);
  // O índice de conversão usa o histórico COMPLETO: uma venda fechada no período
  // pode pertencer a uma sessão criada antes dele (ex: cliente volta dias depois).
  const convertedIndex = buildConvertedSessionIndex(dataset);

  const pdvRevenue = scoped.orders.reduce((acc, order) => acc + toNumber(order.total_amount), 0);
  const onlineRevenue = scoped.onlineOrders.reduce((acc, order) => acc + toNumber(order.total_amount), 0);
  const totalRevenue = pdvRevenue + onlineRevenue;

  const salesCount = scoped.orders.length + scoped.onlineOrders.length;
  const convertedSessions = scoped.sessions.filter((session) => convertedIndex.has(session.id)).length;
  const pendingSessions = scoped.sessions.filter((session) => isPendingSessionStatus(session.status)).length;

  const buckets = new Map<string, PaymentMethodSummary>();

  const accumulate = (method: string | null | undefined, amount: number) => {
    const key = paymentMethodKey(method);
    const bucket = buckets.get(key) ?? {
      method: key,
      label: paymentMethodLabel(method),
      count: 0,
      total: 0,
      share: 0,
    };
    bucket.count += 1;
    bucket.total += amount;
    buckets.set(key, bucket);
  };

  for (const order of scoped.orders) accumulate(order.payment_method, toNumber(order.total_amount));
  for (const order of scoped.onlineOrders) accumulate('online', toNumber(order.total_amount));

  const paymentBreakdown = Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      share: totalRevenue > 0 ? (bucket.total / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    range,
    rangeLabel: describeRange(range),
    totalRevenue,
    pdvRevenue,
    onlineRevenue,
    salesCount,
    pdvSalesCount: scoped.orders.length,
    onlineSalesCount: scoped.onlineOrders.length,
    ticketAverage: salesCount > 0 ? totalRevenue / salesCount : 0,
    totalSessions: scoped.sessions.length,
    convertedSessions,
    pendingSessions,
    conversionRate: scoped.sessions.length > 0 ? (convertedSessions / scoped.sessions.length) * 100 : 0,
    paymentBreakdown,
  };
}

/* ========================================================================== */
/* Desempenho por fotógrafo                                                    */
/* ========================================================================== */

export interface PhotographerPerformance {
  id: string;
  name: string;
  avatar: string;
  sessions: number;
  converted: number;
  /** Percentual exato de conversão (sessões convertidas / sessões do período). */
  rate: number;
  revenue: number;
  printed: number;
  digital: number;
  lastSaleAt: string | null;
}

export function photographerAvatar(employee: EmployeeRow): string {
  if (employee.avatar_url) return employee.avatar_url;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(employee.name ?? 'Fotógrafo')}&background=D9A45C&color=fff`;
}

/**
 * Atribui cada venda ao fotógrafo responsável pela sessão.
 * Uma venda nunca é contada duas vezes: pedidos de PDV entram pela sessão do
 * pedido e as vendas online pelo vínculo direto ou pelo cliente da sessão.
 */
export function buildPhotographerPerformance(
  dataset: AnalyticsDataset,
  range: DateRange,
): PhotographerPerformance[] {
  const scoped = filterDatasetByRange(dataset, range);
  const convertedIndex = buildConvertedSessionIndex(dataset);

  // A atribuição da venda usa o histórico completo (a receita pertence ao
  // período em que foi fechada, mesmo que a sessão seja de outro dia); já as
  // contagens de sessão/conversão respeitam apenas o período selecionado.
  const sessionById = new Map(dataset.sessions.map((session) => [session.id, session]));
  const sessionsByClient = indexSessionsByClient(dataset.sessions);

  const employeeById = new Map(scoped.employees.map((employee) => [employee.id, employee]));
  const employeeByName = new Map<string, EmployeeRow>();
  for (const employee of scoped.employees) {
    const key = normalizeName(employee.name);
    if (key && !employeeByName.has(key)) employeeByName.set(key, employee);
  }

  const resolveEmployeeId = (photographerId?: string | null, photographerName?: string | null): string | null => {
    if (photographerId && employeeById.has(photographerId)) return photographerId;
    if (photographerName) {
      const byName = employeeByName.get(normalizeName(photographerName));
      if (byName) return byName.id;
    }
    return null;
  };

  interface Accumulator {
    revenue: number;
    count: number;
    printed: number;
    digital: number;
    lastSaleAt: string | null;
  }

  const accumulators = new Map<string, Accumulator>();
  const register = (employeeId: string, order: OrderRow | OnlineOrderRow, amount: number) => {
    const bucket = accumulators.get(employeeId) ?? {
      revenue: 0,
      count: 0,
      printed: 0,
      digital: 0,
      lastSaleAt: null,
    };

    bucket.revenue += amount;
    bucket.count += 1;

    // Contagens de fotos existem apenas nos pedidos de PDV.
    const asOrder = order as OrderRow;
    bucket.printed += toNumber(asOrder.printed_count);
    bucket.digital += toNumber(asOrder.digital_count);

    const createdAt = toDate(order.created_at)?.toISOString() ?? null;
    if (createdAt && (!bucket.lastSaleAt || createdAt > bucket.lastSaleAt)) {
      bucket.lastSaleAt = createdAt;
    }

    accumulators.set(employeeId, bucket);
  };

  for (const order of scoped.orders) {
    const session = order.session_id ? sessionById.get(order.session_id) : undefined;
    const employeeId = resolveEmployeeId(session?.photographer_id, session?.photographer_name ?? order.photographer_name);
    if (employeeId) register(employeeId, order, toNumber(order.total_amount));
  }

  for (const order of scoped.onlineOrders) {
    const session = findOnlineOrderSession(order, sessionsByClient, sessionById);
    const employeeId = resolveEmployeeId(session?.photographer_id, session?.photographer_name);
    if (employeeId) register(employeeId, order, toNumber(order.total_amount));
  }

  return scoped.employees
    .map((employee) => {
      const ownSessions = scoped.sessions.filter(
        (session) =>
          session.photographer_id === employee.id ||
          normalizeName(session.photographer_name) === normalizeName(employee.name),
      );
      const converted = ownSessions.filter((session) => convertedIndex.has(session.id)).length;
      const accumulator = accumulators.get(employee.id);

      return {
        id: employee.id,
        name: employee.name ?? 'Sem nome',
        avatar: photographerAvatar(employee),
        sessions: ownSessions.length,
        converted,
        rate: ownSessions.length > 0 ? clampPercent((converted / ownSessions.length) * 100) : 0,
        revenue: accumulator?.revenue ?? 0,
        printed: accumulator?.printed ?? 0,
        digital: accumulator?.digital ?? 0,
        lastSaleAt: accumulator?.lastSaleAt ?? null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, 'pt-BR'));
}

/* ========================================================================== */
/* CSV (separador ";" + UTF-8 com BOM, compatível com Excel/ERPs brasileiros)  */
/* ========================================================================== */

export const CSV_SEPARATOR = ';';
/** BOM UTF-8: garante acentuação correta ao abrir o arquivo no Excel. */
export const CSV_UTF8_BOM = '\uFEFF';

export type CsvValue = string | number | boolean | null | undefined;
export type CsvRow = readonly CsvValue[];

/**
 * Escapa um campo do CSV. Campos com o separador, quebras de linha, aspas ou
 * espaços nas pontas são envolvidos em aspas duplas (padrão RFC 4180).
 */
export function escapeCsvField(value: CsvValue, separator: string = CSV_SEPARATOR): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const needsQuotes =
    raw.includes(separator) ||
    raw.includes('"') ||
    /[\r\n]/.test(raw) ||
    raw !== raw.trim();

  if (!needsQuotes) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

/** Serializa as linhas em CSV usando `;` e prefixa o BOM UTF-8 por padrão. */
export function buildCsvContent(
  rows: readonly CsvRow[],
  options: { separator?: string; includeBom?: boolean } = {},
): string {
  const separator = options.separator ?? CSV_SEPARATOR;
  const includeBom = options.includeBom ?? true;
  const body = rows.map((row) => row.map((value) => escapeCsvField(value, separator)).join(separator)).join('\r\n');
  return includeBom ? `${CSV_UTF8_BOM}${body}` : body;
}

/** Nome de arquivo seguro: prefixo + intervalo (`fechamento-contabil-2026-10-01_a_2026-10-05.csv`). */
export function buildCsvFileName(prefix: string, range: DateRange, reference: Date = new Date()): string {
  const safePrefix = prefix
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'relatorio';

  const start = range.start ? formatDateInput(range.start) : 'inicio';
  const end = range.end ? formatDateInput(range.end) : formatDateInput(reference);

  return `${safePrefix}-${start}_a_${end}.csv`;
}

/** Dispara o download do CSV no renderer (Electron/Chromium). */
export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([content], { type: `text/csv;charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  link.rel = 'noopener';
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Libera o blob depois que o download foi iniciado.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
