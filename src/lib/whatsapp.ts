import { supabase } from '@/lib/supabaseClient';

/**
 * Integração de WhatsApp do Desktop (Setland Fotos).
 *
 * Estratégia em duas camadas, para o quiosque nunca ficar sem resposta:
 *  1. Webhook do n8n configurado em `system_settings.whatsapp_api_url` (envio automático
 *     pela instância de WhatsApp do terminal — mesmo caminho usado pelo PDV);
 *  2. Fallback: abre o WhatsApp (app/Web) com a mensagem já escrita via `wa.me`.
 */

/** Vitrine online onde o cliente escolhe e compra as fotos (PIX / Cartão). */
export const ONLINE_SHOP_BASE_URL = 'https://setland.com.br/fotos/selecao';

export interface WhatsAppDispatchParams {
  phone?: string | null;
  message: string;
  clientName?: string;
  clientCpf?: string;
  /** Identifica a origem da mensagem nos logs do workflow n8n. */
  source: string;
  /**
   * Campos extras anexados ao payload do webhook, para reaproveitar as variáveis
   * já usadas pelos workflows do n8n (ex.: `driveLink`, `shopLink`).
   */
  extra?: Record<string, unknown>;
}

export interface WhatsAppDispatchResult {
  sent: boolean;
  channel: 'n8n' | 'deep-link' | 'none';
}

/** Mantém apenas dígitos e garante o DDI 55 (Brasil) para o link `wa.me`. */
export function normalizeWhatsAppPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/** Link direto do WhatsApp com a mensagem pré-carregada. */
export function buildWhatsAppDeepLink(phone: string | null | undefined, message: string): string {
  const normalized = normalizeWhatsAppPhone(phone) || '';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/** Link da vitrine online vinculado à sessão do cliente (compra por PIX/Cartão). */
export function getOnlineShopUrl(sessionId: string | number): string {
  return `${ONLINE_SHOP_BASE_URL}?sessao=${encodeURIComponent(String(sessionId))}`;
}

export function getFirstName(fullName?: string | null): string {
  const name = (fullName || '').trim();
  if (!name) return 'cliente';
  return name.split(/\s+/)[0];
}

/** Mensagem de reenvio do link de alta resolução no Google Drive. */
export function buildDriveDownloadMessage(clientName: string | undefined, driveLink: string): string {
  return [
    `Olá, ${getFirstName(clientName)}! Tudo bem? 😊`,
    '',
    'Segue novamente o link da sua pasta com as fotos em ALTA RESOLUÇÃO da Setland Fotos:',
    driveLink,
    '',
    `O link fica disponível por ${30} dias. Qualquer dificuldade para baixar, é só responder por aqui! 📸`,
  ].join('\n');
}

/** Mensagem convidando o cliente a escolher e comprar as fotos pela vitrine online. */
export function buildOnlineStoreMessage(clientName: string | undefined, shopUrl: string): string {
  return [
    `Olá, ${getFirstName(clientName)}! ✨`,
    '',
    'Suas fotos da Setland já estão disponíveis na vitrine online!',
    'Acesse o link abaixo para escolher suas favoritas e finalizar a compra com PIX ou Cartão de Crédito:',
    shopUrl,
    '',
    'É rápido: seleciona as fotos, escolhe o formato (impressa e/ou digital) e paga pelo site. 📷',
  ].join('\n');
}

/** Abre o link no navegador/app padrão do Windows (Electron) com fallback para o navegador web. */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    // @ts-ignore - ponte exposta pelo preload do Electron
    const api = typeof window !== 'undefined' ? window.electronAPI : null;
    if (api?.openExternal) {
      const result = await api.openExternal(url);
      if (result?.success !== false) return true;
    }
  } catch (err) {
    console.warn('[WhatsApp] Falha ao abrir link externo via Electron:', err);
  }

  try {
    const opened = typeof window !== 'undefined' ? window.open(url, '_blank', 'noopener,noreferrer') : null;
    return Boolean(opened);
  } catch (err) {
    console.warn('[WhatsApp] Falha ao abrir link externo no navegador:', err);
    return false;
  }
}

/**
 * Dispara a mensagem pelo webhook do n8n quando configurado; caso contrário (ou em erro)
 * abre o WhatsApp com o texto pronto. Nunca lança exceção.
 */
export async function dispatchWhatsAppMessage(
  params: WhatsAppDispatchParams
): Promise<WhatsAppDispatchResult> {
  const { phone, message, clientName, clientCpf, source, extra } = params;

  try {
    const { data: settings } = await supabase
      .from('system_settings')
      .select('whatsapp_api_url, whatsapp_instance')
      .single();

    if (settings?.whatsapp_api_url) {
      const response = await fetch(settings.whatsapp_api_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: clientName || 'Cliente',
          clientPhone: phone || '',
          clientCpf: clientCpf || '',
          message,
          text: message,
          ...(extra || {}),
          instance: settings.whatsapp_instance,
          source,
          timestamp: new Date().toISOString(),
        }),
      });

      if (response.ok) return { sent: true, channel: 'n8n' };
      console.warn(`[WhatsApp] Webhook respondeu HTTP ${response.status}. Usando fallback wa.me.`);
    }
  } catch (err) {
    console.warn('[WhatsApp] Webhook indisponível. Usando fallback wa.me:', err);
  }

  const opened = await openExternalUrl(buildWhatsAppDeepLink(phone, message));
  return { sent: opened, channel: opened ? 'deep-link' : 'none' };
}
