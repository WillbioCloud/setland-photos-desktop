import { supabase } from '@/lib/supabaseClient';

/**
 * Utilitários compartilhados de fotos de sessão (Setland Fotos · Desktop).
 *
 * Centraliza:
 *  - a hidratação das linhas de `session_photos` vindas do Supabase (snake_case) para o
 *    formato consumido pela interface (camelCase), tolerando os dois formatos;
 *  - a leitura paginada de TODAS as fotos da sessão (sem limits truncados);
 *  - a regra de expiração de 30 dias (sincronizada com a rotina de limpeza do `electron/main.ts`);
 *  - a regra de "foto comprada" usada nos selos verdes de entrega.
 */

/** Mesma janela de retenção usada pelo robô local que limpa `Setland_Cache` no SSD. */
export const PHOTO_RETENTION_DAYS = 30;
export const PHOTO_RETENTION_MS = PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Dias restantes a partir dos quais a expiração vira alerta visual (vermelho pulsante). */
export const PHOTO_EXPIRY_ALERT_DAYS = 3;

/** Tamanho de cada página da leitura incremental (protege contra o max-rows do PostgREST). */
const PHOTO_PAGE_SIZE = 100;
/** Trava de segurança para nunca entrar em loop infinito na paginação. */
const PHOTO_MAX_PAGES = 200;
/** Quantidade de sessões por consulta `in(...)` (evita URLs gigantes). */
const SESSION_ID_CHUNK = 50;

/**
 * Colunas completas — inclui as flags de compra/expiração quando o banco já as possui.
 * São exatamente as colunas pedidas pela regra de negócio do quiosque.
 */
export const SESSION_PHOTO_SELECT = [
  'id',
  'session_id',
  'original_name',
  'preview_url',
  'local_original_path',
  'status',
  'expires_at',
  'is_purchased',
  'is_printed',
  'created_at',
].join(', ');

/** Colunas mínimas garantidas pelo schema base (fallback quando o banco ainda não tem as extras). */
export const SESSION_PHOTO_SELECT_SAFE = [
  'id',
  'session_id',
  'original_name',
  'preview_url',
  'local_original_path',
  'status',
  'created_at',
].join(', ');

export interface SessionPhoto {
  id: string;
  sessionId?: string | null;
  originalName: string;
  /** Fonte preferencial para exibição (SSD local >> Nuvem). */
  url: string;
  /** Caminho físico no SSD do quiosque (file:///...). */
  localOriginalPath: string | null;
  /** Miniatura pública do Supabase Storage (Nuvem / Vitrine). */
  previewUrl: string | null;
  status: string;
  isPurchased: boolean;
  isPrinted: boolean;
  expiresAt: string | null;
  createdAt: string | null;
}

export interface PhotoExpiryInfo {
  expiresAt: Date | null;
  /** Dias (arredondados para cima) até a exclusão física. `null` quando não é possível calcular. */
  daysRemaining: number | null;
  /** 3 dias ou menos (ou já expirada). */
  isUrgent: boolean;
  isExpired: boolean;
  /** Texto pronto para o selo da miniatura. */
  label: string;
}

export interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
}

/**
 * Detecta o erro de coluna inexistente do Postgres/PostgREST (42703) para permitir
 * a degradação graciosa das consultas em bancos ainda não migrados.
 */
export function isMissingColumnError(error: SupabaseLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /column .* does not exist|could not find the '.*' column/i.test(error.message || '');
}

/** Converte `1990-01-01`, `12/10/2026, 14:33:10`, `Date` ou timestamp em `Date`, sem quebrar. */
export function parseDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // Formato brasileiro (ex.: saída de `toLocaleString('pt-BR')`): dd/mm/yyyy[, hh:mm:ss]
  const brMatch = trimmed.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (brMatch) {
    const [, day, month, year, hour, minute, second] = brMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour || 0),
      Number(minute || 0),
      Number(second || 0)
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Normaliza a linha de `session_photos` (Supabase) ou um objeto já hidratado.
 * É idempotente: pode ser aplicada várias vezes sem perder informação.
 */
export function shapeSessionPhoto(row: any): SessionPhoto {
  const localOriginalPath = row?.localOriginalPath ?? row?.local_original_path ?? null;
  const previewUrl = row?.previewUrl ?? row?.preview_url ?? null;
  const status = row?.status || (row?.isPurchased === true || row?.is_purchased === true ? 'synced' : 'pending');

  return {
    id: String(row?.id ?? ''),
    sessionId: row?.sessionId ?? row?.session_id ?? null,
    originalName: row?.originalName ?? row?.original_name ?? 'Foto',
    url: localOriginalPath || previewUrl || row?.url || '',
    localOriginalPath: localOriginalPath || null,
    previewUrl: previewUrl || null,
    status,
    isPurchased: row?.isPurchased === true || row?.is_purchased === true,
    isPrinted: row?.isPrinted === true || row?.is_printed === true,
    expiresAt: row?.expiresAt ?? row?.expires_at ?? null,
    createdAt: row?.createdAt ?? row?.created_at ?? null,
  };
}

/** Quanto mais fontes distintas a foto tiver, mais completa ela é (usado no merge). */
function photoRichness(photo: SessionPhoto): number {
  return (photo.localOriginalPath ? 2 : 0) + (photo.previewUrl ? 1 : 0) + (photo.originalName ? 1 : 0);
}

/**
 * Une listas de fotos (props do componente, SSD local e Nuvem) sem duplicar registros.
 * Nenhuma foto importada é descartada — o registro mais completo prevalece.
 */
export function mergeSessionPhotos(...lists: (any[] | undefined)[]): SessionPhoto[] {
  const byId = new Map<string, SessionPhoto>();

  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const photo = shapeSessionPhoto(item);
      if (!photo.id) continue;
      const current = byId.get(photo.id);
      if (!current) {
        byId.set(photo.id, photo);
        continue;
      }
      if (photoRichness(photo) > photoRichness(current)) {
        byId.set(photo.id, { ...current, ...photo });
      } else {
        byId.set(photo.id, { ...photo, ...current });
      }
    }
  }

  return Array.from(byId.values());
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Busca TODAS as fotos das sessões informadas, paginando até o fim do resultado.
 * Não impõe limite próprio: percorre o dataset completo, mesmo muito acima do `max-rows` do PostgREST.
 */
export async function fetchAllSessionPhotos(sessionIds: (string | number)[]): Promise<SessionPhoto[]> {
  const uniqueIds = Array.from(new Set((sessionIds || []).filter(Boolean).map(id => String(id))));
  if (uniqueIds.length === 0) return [];

  const collected: any[] = [];
  let columns = SESSION_PHOTO_SELECT;
  let useSafeColumns = false;

  for (const chunk of chunkArray(uniqueIds, SESSION_ID_CHUNK)) {
    let offset = 0;
    let previousLastId: string | null = null;

    for (let page = 0; page < PHOTO_MAX_PAGES; page++) {
      const buildQuery = (cols: string) =>
        supabase
          .from('session_photos')
          .select(cols)
          .in('session_id', chunk)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + PHOTO_PAGE_SIZE - 1);

      let { data, error } = await buildQuery(columns);

      // Banco ainda sem `expires_at` / `is_purchased`: refaz a leitura com as colunas base.
      if (error && isMissingColumnError(error) && !useSafeColumns) {
        console.warn(
          '[Sessões] Colunas opcionais ausentes em session_photos; usando colunas base.',
          error.message
        );
        useSafeColumns = true;
        columns = SESSION_PHOTO_SELECT_SAFE;
        ({ data, error } = await buildQuery(columns));
      }

      if (error) {
        console.error('[Sessões] Erro ao carregar fotos da sessão:', error);
        break;
      }

      if (!data || data.length === 0) break;

      const rows = data as any[];
      collected.push(...rows);

      // Avança exatamente pelo tamanho devolvido pelo servidor (imune a max-rows mais baixo).
      offset += rows.length;
      const lastId = String(rows[rows.length - 1]?.id ?? '');
      if (lastId && lastId === previousLastId) break; // servidor ignorou o range: evita loop infinito
      previousLastId = lastId;
    }
  }

  return collected.map(shapeSessionPhoto);
}

/**
 * Regra de negócio: a foto é considerada adquirida quando possui a flag `is_purchased`
 * ou quando já está marcada/selecionada para venda na vitrine (`selected`) ou entregue (`synced`).
 */
export function isPhotoPurchased(photo: any): boolean {
  if (!photo) return false;
  if (photo.isPurchased === true || photo.is_purchased === true) return true;
  return photo.status === 'selected' || photo.status === 'synced';
}

/**
 * Data-limite de exclusão física da foto:
 * usa `expires_at` quando existir e, na ausência dele, projeta 30 dias a partir de `created_at`
 * (ou da data de criação da sessão/cliente como último recurso).
 */
export function resolvePhotoExpiryDate(photo: any, fallbackDate?: unknown): Date | null {
  const explicit = parseDateValue(photo?.expiresAt ?? photo?.expires_at);
  if (explicit) return explicit;

  const createdAt = parseDateValue(photo?.createdAt ?? photo?.created_at) ?? parseDateValue(fallbackDate);
  if (!createdAt) return null;

  return new Date(createdAt.getTime() + PHOTO_RETENTION_MS);
}

/** Calcula o selo de expiração exibido no canto inferior de cada miniatura. */
export function getPhotoExpiryInfo(photo: any, fallbackDate?: unknown): PhotoExpiryInfo {
  const expiresAt = resolvePhotoExpiryDate(photo, fallbackDate);

  if (!expiresAt) {
    return { expiresAt: null, daysRemaining: null, isUrgent: false, isExpired: false, label: '' };
  }

  const msRemaining = expiresAt.getTime() - Date.now();
  const isExpired = msRemaining <= 0;
  const expiresToday = !isExpired && msRemaining <= 24 * 60 * 60 * 1000;
  const daysRemaining = isExpired ? 0 : Math.ceil(msRemaining / (24 * 60 * 60 * 1000));

  const label = isExpired
    ? 'Expirada para exclusão'
    : expiresToday
      ? 'Expira hoje'
      : `${daysRemaining} dias restantes`;

  return {
    expiresAt,
    daysRemaining,
    isUrgent: daysRemaining <= PHOTO_EXPIRY_ALERT_DAYS,
    isExpired,
    label,
  };
}
