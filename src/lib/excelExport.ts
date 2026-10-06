/**
 * excelExport.ts
 * ---------------------------------------------------------------------------
 * Geração de planilha Excel (.xlsx) com identidade visual Setland.
 *
 * Usa ExcelJS para criar um arquivo XLSX completo com:
 * - Paleta de cores da marca (burgundy #4A1728, dourado #C5A04C, creme #FBF7ED)
 * - Cabeçalhos estilizados com merge de células
 * - Bordas, fontes e alinhamentos profissionais
 * - Larguras de coluna otimizadas para impressão
 * - Abas separadas para cada seção do relatório
 */

import ExcelJS from 'exceljs';
import {
  formatCurrencyBRL,
  formatDateTimeBR,
  formatNumberBR,
  formatPercentBR,
  type DateRange,
  type PhotographerPerformance,
  type ReportSummary,
} from './reporting';
import type { AccountingEntry } from '../components/AccountingReportModal';

/* ========================================================================== */
/* Paleta de cores Setland                                                     */
/* ========================================================================== */

const COLORS = {
  /** Burgundy escuro – cabeçalhos principais */
  burgundy: 'FF4A1728',
  /** Burgundy médio – subcabeçalhos */
  burgundyMid: 'FF6B2E45',
  /** Dourado marca */
  gold: 'FFC5A04C',
  /** Dourado claro – fundo de destaque */
  goldLight: 'FFFBF7ED',
  /** Creme – fundo alternado */
  cream: 'FFFCFBF9',
  /** Branco */
  white: 'FFFFFFFF',
  /** Texto escuro */
  textDark: 'FF292321',
  /** Texto médio */
  textMedium: 'FF453C37',
  /** Texto muted */
  textMuted: 'FF776B60',
  /** Borda suave */
  borderLight: 'FFE7E0D8',
  /** Borda dourada */
  borderGold: 'FFD5BD83',
  /** Verde para valores positivos */
  greenBg: 'FFF0F9F0',
  greenText: 'FF1B7A1B',
  /** Azul para dados online/site */
  blueBg: 'FFEFF6FC',
  blueText: 'FF285987',
  /** Tag PDV */
  pdvBg: 'FFFAF4E5',
  pdvText: 'FF72551E',
} as const;

/* ========================================================================== */
/* Estilos reutilizáveis                                                       */
/* ========================================================================== */

const FONT_TITLE: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 16,
  bold: true,
  color: { argb: COLORS.white },
};

const FONT_SUBTITLE: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 10,
  color: { argb: COLORS.white },
};

const FONT_SECTION: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 12,
  bold: true,
  color: { argb: COLORS.white },
};

const FONT_TABLE_HEADER: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 9,
  bold: true,
  color: { argb: COLORS.white },
};

const FONT_BODY: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 10,
  color: { argb: COLORS.textDark },
};

const FONT_BODY_BOLD: Partial<ExcelJS.Font> = {
  ...FONT_BODY,
  bold: true,
};

const FONT_KPI_VALUE: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 14,
  bold: true,
  color: { argb: COLORS.burgundy },
};

const FONT_KPI_LABEL: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 8,
  bold: true,
  color: { argb: COLORS.textMuted },
};

const FONT_META: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  size: 8,
  italic: true,
  color: { argb: COLORS.textMuted },
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: COLORS.borderLight } },
  left: { style: 'thin', color: { argb: COLORS.borderLight } },
  bottom: { style: 'thin', color: { argb: COLORS.borderLight } },
  right: { style: 'thin', color: { argb: COLORS.borderLight } },
};

const BORDER_GOLD: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: COLORS.borderGold } },
  left: { style: 'thin', color: { argb: COLORS.borderGold } },
  bottom: { style: 'thin', color: { argb: COLORS.borderGold } },
  right: { style: 'thin', color: { argb: COLORS.borderGold } },
};

const FILL_BURGUNDY: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: COLORS.burgundy },
};

const FILL_BURGUNDY_MID: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: COLORS.burgundyMid },
};

const FILL_GOLD_LIGHT: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: COLORS.goldLight },
};

const FILL_CREAM: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: COLORS.cream },
};

const FILL_WHITE: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: COLORS.white },
};

/* ========================================================================== */
/* Helpers                                                                     */
/* ========================================================================== */

/** Adiciona uma barra de seção (faixa burgundy com título em branco, merge total). */
function addSectionHeader(ws: ExcelJS.Worksheet, title: string, colCount: number): ExcelJS.Row {
  const row = ws.addRow([title]);
  ws.mergeCells(row.number, 1, row.number, colCount);
  const cell = row.getCell(1);
  cell.font = FONT_SECTION;
  cell.fill = FILL_BURGUNDY;
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  row.height = 28;
  return row;
}

/** Adiciona cabeçalho de tabela (faixa burgundy médio com colunas em branco). */
function addTableHeader(ws: ExcelJS.Worksheet, headers: string[]): ExcelJS.Row {
  const row = ws.addRow(headers);
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = FONT_TABLE_HEADER;
    cell.fill = FILL_BURGUNDY_MID;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.burgundy } },
      bottom: { style: 'thin', color: { argb: COLORS.burgundy } },
      left: { style: 'hair', color: { argb: COLORS.burgundy } },
      right: { style: 'hair', color: { argb: COLORS.burgundy } },
    };
  });
  return row;
}

/** Adiciona uma linha de dados com estilo alternado (zebra). */
function addDataRow(
  ws: ExcelJS.Worksheet,
  values: (string | number)[],
  index: number,
  options?: {
    alignments?: Record<number, Partial<ExcelJS.Alignment>>;
    boldCols?: number[];
  },
): ExcelJS.Row {
  const row = ws.addRow(values);
  const isEven = index % 2 === 0;
  row.height = 18;

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cell.font = options?.boldCols?.includes(colNumber)
      ? FONT_BODY_BOLD
      : FONT_BODY;
    cell.fill = isEven ? FILL_CREAM : FILL_WHITE;
    cell.border = BORDER_THIN;
    cell.alignment = options?.alignments?.[colNumber] ?? {
      vertical: 'middle',
      horizontal: 'left',
    };
  });

  return row;
}

/** Linha de total/rodapé de tabela. */
function addTotalRow(
  ws: ExcelJS.Worksheet,
  values: (string | number)[],
  mergeRange?: { from: number; to: number },
): ExcelJS.Row {
  const row = ws.addRow(values);
  row.height = 24;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { ...FONT_BODY_BOLD, color: { argb: COLORS.burgundy } };
    cell.fill = FILL_GOLD_LIGHT;
    cell.border = BORDER_GOLD;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  if (mergeRange) {
    ws.mergeCells(row.number, mergeRange.from, row.number, mergeRange.to);
  }
  return row;
}

/* ========================================================================== */
/* Params                                                                      */
/* ========================================================================== */

interface BuildExcelParams {
  summary: ReportSummary;
  photographers: PhotographerPerformance[];
  entries: AccountingEntry[];
  range: DateRange;
  generatedAt: Date;
}

/* ========================================================================== */
/* Construção da planilha                                                      */
/* ========================================================================== */

export async function buildAccountingExcel({
  summary,
  photographers,
  entries,
  range,
  generatedAt,
}: BuildExcelParams): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Setland Photos Desktop';
  wb.created = generatedAt;

  // ── Aba 1: Resumo Executivo ──────────────────────────────────────────────
  const wsResumo = wb.addWorksheet('Resumo Executivo', {
    properties: { tabColor: { argb: COLORS.burgundy } },
    views: [{ showGridLines: false }],
  });

  // Larguras otimizadas
  wsResumo.columns = [
    { width: 28 }, // A – labels
    { width: 22 }, // B – valores
    { width: 4 },  // C – gap
    { width: 28 }, // D – labels
    { width: 22 }, // E – valores
  ];

  // ── Faixa de cabeçalho da empresa ────────────────────────────────────────
  const titleRow = wsResumo.addRow(['SETLAND FOTOGRAFIA']);
  wsResumo.mergeCells(titleRow.number, 1, titleRow.number, 5);
  titleRow.getCell(1).font = FONT_TITLE;
  titleRow.getCell(1).fill = FILL_BURGUNDY;
  titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleRow.height = 36;

  const subtitleRow = wsResumo.addRow([`Fechamento Contábil · ${summary.rangeLabel}`]);
  wsResumo.mergeCells(subtitleRow.number, 1, subtitleRow.number, 5);
  subtitleRow.getCell(1).font = FONT_SUBTITLE;
  subtitleRow.getCell(1).fill = FILL_BURGUNDY;
  subtitleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  subtitleRow.height = 20;

  // Barra dourada decorativa
  const goldBar = wsResumo.addRow([]);
  wsResumo.mergeCells(goldBar.number, 1, goldBar.number, 5);
  goldBar.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gold } };
  goldBar.height = 4;

  // Meta do relatório
  const metaRow = wsResumo.addRow([
    `Gerado em: ${formatDateTimeBR(generatedAt)}`,
    '',
    '',
    'Sistema: Setland Photos Desktop – Terminal 01',
  ]);
  wsResumo.mergeCells(metaRow.number, 1, metaRow.number, 2);
  wsResumo.mergeCells(metaRow.number, 4, metaRow.number, 5);
  metaRow.getCell(1).font = FONT_META;
  metaRow.getCell(4).font = FONT_META;
  metaRow.height = 18;

  wsResumo.addRow([]); // espaçamento

  // ── KPIs principais (2×2 grid) ───────────────────────────────────────────
  const kpiData = [
    ['Faturamento Total', formatCurrencyBRL(summary.totalRevenue), 'Volume de Vendas', `${summary.salesCount} pedido(s)`],
    ['Ticket Médio', formatCurrencyBRL(summary.ticketAverage), 'Taxa de Conversão', formatPercentBR(summary.conversionRate, 1)],
  ];

  for (const kpiLine of kpiData) {
    // Labels
    const labelRow = wsResumo.addRow([kpiLine[0], '', '', kpiLine[2], '']);
    labelRow.getCell(1).font = FONT_KPI_LABEL;
    labelRow.getCell(4).font = FONT_KPI_LABEL;
    labelRow.getCell(1).fill = FILL_GOLD_LIGHT;
    labelRow.getCell(2).fill = FILL_GOLD_LIGHT;
    labelRow.getCell(4).fill = FILL_GOLD_LIGHT;
    labelRow.getCell(5).fill = FILL_GOLD_LIGHT;
    labelRow.getCell(1).border = BORDER_GOLD;
    labelRow.getCell(2).border = BORDER_GOLD;
    labelRow.getCell(4).border = BORDER_GOLD;
    labelRow.getCell(5).border = BORDER_GOLD;
    labelRow.height = 14;

    // Values
    const valRow = wsResumo.addRow([kpiLine[1], '', '', kpiLine[3], '']);
    wsResumo.mergeCells(valRow.number, 1, valRow.number, 2);
    wsResumo.mergeCells(valRow.number, 4, valRow.number, 5);
    valRow.getCell(1).font = FONT_KPI_VALUE;
    valRow.getCell(4).font = FONT_KPI_VALUE;
    valRow.getCell(1).fill = FILL_GOLD_LIGHT;
    valRow.getCell(4).fill = FILL_GOLD_LIGHT;
    valRow.getCell(1).border = BORDER_GOLD;
    valRow.getCell(4).border = BORDER_GOLD;
    valRow.getCell(1).alignment = { vertical: 'middle' };
    valRow.getCell(4).alignment = { vertical: 'middle' };
    valRow.height = 28;
  }

  wsResumo.addRow([]); // espaçamento

  // ── Detalhes de faturamento ──────────────────────────────────────────────
  const detailRows = [
    ['Faturamento PDV (R$)', formatCurrencyBRL(summary.pdvRevenue), '', 'Transações PDV', summary.pdvSalesCount],
    ['Faturamento Site (R$)', formatCurrencyBRL(summary.onlineRevenue), '', 'Transações Site', summary.onlineSalesCount],
    ['Sessões Realizadas', summary.totalSessions, '', 'Sessões Convertidas', summary.convertedSessions],
    ['Sessões Pendentes', summary.pendingSessions, '', '', ''],
  ];

  addSectionHeader(wsResumo, 'DETALHAMENTO DO PERÍODO', 5);

  for (let i = 0; i < detailRows.length; i++) {
    const row = wsResumo.addRow(detailRows[i]);
    row.height = 20;
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      cell.border = BORDER_THIN;
      cell.fill = i % 2 === 0 ? FILL_CREAM : FILL_WHITE;
      if (colNum === 1 || colNum === 4) {
        cell.font = { ...FONT_BODY, bold: true, color: { argb: COLORS.textMuted } };
      } else {
        cell.font = FONT_BODY_BOLD;
      }
      cell.alignment = { vertical: 'middle' };
    });
  }

  wsResumo.addRow([]); // espaçamento

  // ── Conciliação por Forma de Pagamento ───────────────────────────────────
  addSectionHeader(wsResumo, 'CONCILIAÇÃO POR FORMA DE PAGAMENTO', 5);
  const payHeaders = wsResumo.addRow(['Forma de Pagamento', 'Transações', '', 'Total (R$)', 'Participação (%)']);
  wsResumo.mergeCells(payHeaders.number, 2, payHeaders.number, 3);
  payHeaders.height = 22;
  payHeaders.eachCell((cell) => {
    cell.font = FONT_TABLE_HEADER;
    cell.fill = FILL_BURGUNDY_MID;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.burgundy } },
      bottom: { style: 'thin', color: { argb: COLORS.burgundy } },
    };
  });

  if (summary.paymentBreakdown.length > 0) {
    for (let i = 0; i < summary.paymentBreakdown.length; i++) {
      const method = summary.paymentBreakdown[i];
      const row = wsResumo.addRow([
        method.label,
        method.count,
        '',
        formatCurrencyBRL(method.total),
        formatPercentBR(method.share, 1),
      ]);
      wsResumo.mergeCells(row.number, 2, row.number, 3);
      row.height = 20;
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        cell.font = colNum === 1 ? FONT_BODY_BOLD : FONT_BODY;
        cell.fill = i % 2 === 0 ? FILL_CREAM : FILL_WHITE;
        cell.border = BORDER_THIN;
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNum >= 2 ? 'center' : 'left',
        };
      });
    }
  } else {
    const emptyRow = wsResumo.addRow(['Nenhum lançamento no período']);
    wsResumo.mergeCells(emptyRow.number, 1, emptyRow.number, 5);
    emptyRow.getCell(1).font = { ...FONT_BODY, italic: true, color: { argb: COLORS.textMuted } };
    emptyRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    emptyRow.height = 24;
  }

  // Rodapé da aba
  wsResumo.addRow([]);
  const footerRow = wsResumo.addRow(['Relatório gerado automaticamente pelo Setland Photos Desktop.']);
  wsResumo.mergeCells(footerRow.number, 1, footerRow.number, 5);
  footerRow.getCell(1).font = FONT_META;
  footerRow.getCell(1).alignment = { horizontal: 'center' };

  // ── Aba 2: Equipe ───────────────────────────────────────────────────────
  const wsEquipe = wb.addWorksheet('Desempenho da Equipe', {
    properties: { tabColor: { argb: COLORS.gold.replace('FF', '') } },
    views: [{ showGridLines: false }],
  });

  wsEquipe.columns = [
    { width: 24 }, // A – Nome
    { width: 14 }, // B – Sessões
    { width: 14 }, // C – Convertidas
    { width: 18 }, // D – Taxa
    { width: 22 }, // E – Faturamento
    { width: 16 }, // F – Impressas
    { width: 16 }, // G – Digitais
  ];

  const eqTitle = wsEquipe.addRow(['DESEMPENHO DA EQUIPE']);
  wsEquipe.mergeCells(eqTitle.number, 1, eqTitle.number, 7);
  eqTitle.getCell(1).font = FONT_TITLE;
  eqTitle.getCell(1).fill = FILL_BURGUNDY;
  eqTitle.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  eqTitle.height = 36;

  const eqSub = wsEquipe.addRow([`Período: ${summary.rangeLabel} · Gerado em ${formatDateTimeBR(generatedAt)}`]);
  wsEquipe.mergeCells(eqSub.number, 1, eqSub.number, 7);
  eqSub.getCell(1).font = FONT_SUBTITLE;
  eqSub.getCell(1).fill = FILL_BURGUNDY;
  eqSub.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  eqSub.height = 20;

  const eqBar = wsEquipe.addRow([]);
  wsEquipe.mergeCells(eqBar.number, 1, eqBar.number, 7);
  eqBar.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gold } };
  eqBar.height = 4;

  wsEquipe.addRow([]);

  addTableHeader(wsEquipe, [
    'Fotógrafo',
    'Sessões',
    'Convertidas',
    'Taxa de Conversão',
    'Faturamento (R$)',
    'Fotos Impressas',
    'Fotos Digitais',
  ]);

  const numberAlign: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'center' };
  const currencyAlign: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'right' };

  if (photographers.length > 0) {
    for (let i = 0; i < photographers.length; i++) {
      const p = photographers[i];
      addDataRow(
        wsEquipe,
        [
          p.name,
          p.sessions,
          p.converted,
          formatPercentBR(p.rate, 1),
          formatCurrencyBRL(p.revenue),
          p.printed,
          p.digital,
        ],
        i,
        {
          alignments: {
            2: numberAlign,
            3: numberAlign,
            4: numberAlign,
            5: currencyAlign,
            6: numberAlign,
            7: numberAlign,
          },
          boldCols: [1],
        },
      );
    }
  } else {
    const empty = wsEquipe.addRow(['Nenhum fotógrafo com sessões no período']);
    wsEquipe.mergeCells(empty.number, 1, empty.number, 7);
    empty.getCell(1).font = { ...FONT_BODY, italic: true, color: { argb: COLORS.textMuted } };
    empty.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    empty.height = 24;
  }

  // ── Aba 3: Lançamentos (Livro-Caixa) ────────────────────────────────────
  const wsLanc = wb.addWorksheet('Lançamentos', {
    properties: { tabColor: { argb: '1B7A1B' } },
    views: [{ showGridLines: false }],
  });

  wsLanc.columns = [
    { width: 18 }, // A – Data/Hora
    { width: 10 }, // B – Origem
    { width: 12 }, // C – ID Pedido
    { width: 26 }, // D – Cliente
    { width: 16 }, // E – CPF
    { width: 16 }, // F – Telefone
    { width: 28 }, // G – Descrição
    { width: 20 }, // H – Forma Pagamento
    { width: 18 }, // I – Valor
  ];

  const lcTitle = wsLanc.addRow(['LIVRO-CAIXA · LANÇAMENTOS DETALHADOS']);
  wsLanc.mergeCells(lcTitle.number, 1, lcTitle.number, 9);
  lcTitle.getCell(1).font = FONT_TITLE;
  lcTitle.getCell(1).fill = FILL_BURGUNDY;
  lcTitle.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  lcTitle.height = 36;

  const lcSub = wsLanc.addRow([
    `Período: ${summary.rangeLabel} · ${entries.length} lançamento(s) · Gerado em ${formatDateTimeBR(generatedAt)}`,
  ]);
  wsLanc.mergeCells(lcSub.number, 1, lcSub.number, 9);
  lcSub.getCell(1).font = FONT_SUBTITLE;
  lcSub.getCell(1).fill = FILL_BURGUNDY;
  lcSub.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  lcSub.height = 20;

  const lcBar = wsLanc.addRow([]);
  wsLanc.mergeCells(lcBar.number, 1, lcBar.number, 9);
  lcBar.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.gold } };
  lcBar.height = 4;

  wsLanc.addRow([]);

  addTableHeader(wsLanc, [
    'Data / Hora',
    'Origem',
    'ID Pedido',
    'Cliente',
    'CPF',
    'Telefone',
    'Pacote / Descrição',
    'Forma de Pagamento',
    'Valor (R$)',
  ]);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const row = addDataRow(
      wsLanc,
      [
        formatDateTimeBR(entry.createdAt),
        entry.source,
        entry.orderId,
        entry.clientName,
        entry.clientCpf,
        entry.clientPhone,
        entry.description,
        entry.methodLabel,
        formatCurrencyBRL(entry.total),
      ],
      i,
      {
        alignments: {
          1: { vertical: 'middle', horizontal: 'center' },
          2: { vertical: 'middle', horizontal: 'center' },
          3: { vertical: 'middle', horizontal: 'center' },
          9: { vertical: 'middle', horizontal: 'right' },
        },
        boldCols: [4, 9],
      },
    );

    // Cor da tag de origem (PDV vs Site)
    const originCell = row.getCell(2);
    if (entry.source === 'Site') {
      originCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blueBg } };
      originCell.font = { ...FONT_BODY_BOLD, size: 9, color: { argb: COLORS.blueText } };
    } else {
      originCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.pdvBg } };
      originCell.font = { ...FONT_BODY_BOLD, size: 9, color: { argb: COLORS.pdvText } };
    }
  }

  // Linha de total
  const totalRow = addTotalRow(
    wsLanc,
    [
      'TOTAL GERAL',
      '',
      '',
      '',
      '',
      '',
      `${entries.length} lançamento(s)`,
      '',
      formatCurrencyBRL(summary.totalRevenue),
    ],
    { from: 1, to: 6 },
  );
  totalRow.getCell(9).alignment = { vertical: 'middle', horizontal: 'right' };
  totalRow.getCell(9).font = {
    name: 'Calibri',
    size: 12,
    bold: true,
    color: { argb: COLORS.burgundy },
  };

  // Rodapé
  wsLanc.addRow([]);
  const lcFooter = wsLanc.addRow(['Relatório gerado automaticamente pelo Setland Photos Desktop.']);
  wsLanc.mergeCells(lcFooter.number, 1, lcFooter.number, 9);
  lcFooter.getCell(1).font = FONT_META;
  lcFooter.getCell(1).alignment = { horizontal: 'center' };

  // ── Configurações de impressão para todas as abas ────────────────────────
  for (const ws of [wsResumo, wsEquipe, wsLanc]) {
    ws.pageSetup = {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: {
        left: 0.4,
        right: 0.4,
        top: 0.5,
        bottom: 0.5,
        header: 0.3,
        footer: 0.3,
      },
    };
  }

  // ── Gera o buffer ────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Dispara o download do arquivo XLSX no renderer (Electron/Chromium). */
export function downloadExcel(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  link.rel = 'noopener';
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nome de arquivo para o Excel (mesmo padrão do CSV, mas com .xlsx). */
export function buildExcelFileName(prefix: string, range: DateRange, reference: Date = new Date()): string {
  const safePrefix = prefix
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'relatorio';

  const formatDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const start = range.start ? formatDate(range.start) : 'inicio';
  const end = range.end ? formatDate(range.end) : formatDate(reference);

  return `${safePrefix}-${start}_a_${end}.xlsx`;
}
