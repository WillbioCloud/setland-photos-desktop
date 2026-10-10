/**
 * Fila de reentrega (outbox) para o webhook de WhatsApp/n8n.
 *
 * Problema que resolve: o pedido já está PAGO no banco. Se o webhook do n8n
 * caísse (500, timeout, workflow pausado), o disparo antigo só escrevia um
 * console.error e era perdido para sempre — o cliente nunca recebia o link do
 * Drive e ninguém no balcão ficava sabendo.
 *
 * Aqui o payload é persistido em localStorage e reprocessado com backoff,
 * inclusive depois de o aplicativo ser fechado e reaberto.
 */

export interface WebhookPayload {
  orderId: string;
  clientName: string;
  clientPhone: string;
  clientCpf: string;
  total: number;
  driveLink: string;
  items: unknown[];
  instance?: string | null;
  source?: string;
  timestamp: string;
}

interface OutboxEntry {
  id: string;
  url: string;
  payload: WebhookPayload;
  attempts: number;
  lastError?: string;
  createdAt: string;
}

const STORAGE_KEY = 'setland.webhookOutbox.v1';
const MAX_ATTEMPTS = 8;
const REQUEST_TIMEOUT_MS = 20_000;

function readOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    console.error('[WebhookOutbox] Falha ao persistir a fila:', err);
  }
}

/**
 * Envia uma única requisição com timeout real.
 * O fetch nativo não tem timeout: sem AbortController uma rede caída pendura
 * a promise indefinidamente.
 */
async function sendOnce(url: string, payload: WebhookPayload): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Backoff exponencial com jitter: 3s, 6s, 12s, 24s... limitado a 5min. */
function backoffDelayMs(attempt: number): number {
  const base = Math.min(3_000 * Math.pow(2, attempt - 1), 300_000);
  return Math.round(base + base * 0.2 * Math.random());
}

export type OutboxEventDetail = {
  orderId: string;
  clientName: string;
  status: 'sent' | 'retrying' | 'dead';
  attempts: number;
  error?: string;
};

function emit(detail: OutboxEventDetail) {
  window.dispatchEvent(new CustomEvent('webhook-outbox', { detail }));
}

/**
 * Dispara o webhook agora, com retry em memória. Se todas as tentativas
 * falharem, o item fica guardado na fila persistente para novas rodadas.
 *
 * Retorna `true` apenas se o n8n confirmou o recebimento (2xx).
 */
export async function sendWebhookWithRetry(
  url: string,
  payload: WebhookPayload,
  maxAttempts = 4
): Promise<boolean> {
  let lastError = 'desconhecido';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendOnce(url, payload);
      emit({ orderId: payload.orderId, clientName: payload.clientName, status: 'sent', attempts: attempt });
      return true;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[WebhookOutbox] Tentativa ${attempt}/${maxAttempts} falhou para o pedido ${payload.orderId}: ${lastError}`
      );

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
      }
    }
  }

  // Esgotou as tentativas em memória -> guarda para tentar depois
  const entries = readOutbox();
  const existing = entries.find((e) => e.payload.orderId === payload.orderId);

  if (existing) {
    existing.attempts += maxAttempts;
    existing.lastError = lastError;
  } else {
    entries.push({
      id: `${payload.orderId}-${Date.now()}`,
      url,
      payload,
      attempts: maxAttempts,
      lastError,
      createdAt: new Date().toISOString(),
    });
  }

  writeOutbox(entries.filter((e) => e.attempts < MAX_ATTEMPTS));

  emit({
    orderId: payload.orderId,
    clientName: payload.clientName,
    status: 'dead',
    attempts: maxAttempts,
    error: lastError,
  });

  return false;
}

/** Quantidade de entregas de WhatsApp pendentes de reenvio. */
export function getPendingWebhookCount(): number {
  return readOutbox().length;
}

/**
 * Reprocessa a fila persistente. Deve ser chamado no boot do app e
 * periodicamente (a rede do parque é instável).
 */
export async function processWebhookOutbox(): Promise<{ sent: number; remaining: number }> {
  const entries = readOutbox();
  if (entries.length === 0) return { sent: 0, remaining: 0 };

  const survivors: OutboxEntry[] = [];
  let sent = 0;

  for (const entry of entries) {
    try {
      await sendOnce(entry.url, entry.payload);
      sent++;
      emit({
        orderId: entry.payload.orderId,
        clientName: entry.payload.clientName,
        status: 'sent',
        attempts: entry.attempts + 1,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entry.attempts += 1;
      entry.lastError = message;

      if (entry.attempts < MAX_ATTEMPTS) {
        survivors.push(entry);
      } else {
        console.error(
          `[WebhookOutbox] Desistindo do pedido ${entry.payload.orderId} após ${entry.attempts} tentativas: ${message}`
        );
        emit({
          orderId: entry.payload.orderId,
          clientName: entry.payload.clientName,
          status: 'dead',
          attempts: entry.attempts,
          error: message,
        });
      }
    }
  }

  writeOutbox(survivors);
  return { sent, remaining: survivors.length };
}
