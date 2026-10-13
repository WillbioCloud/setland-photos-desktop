/**
 * Ponte de navegação/estado entre a aba Clientes e o PDV.
 *
 * O App monta o PDV apenas quando a aba é aberta, então o payload do evento `add-to-cart`
 * precisa sobreviver até o componente existir na árvore. O evento continua sendo disparado
 * (mantendo todos os listeners já existentes), e este módulo guarda o "último pedido"
 * para o PDV consumir ao montar.
 */

export interface CartPresetPayload {
  /** Origem do disparo (ex.: 'clientes'). */
  source?: string;
  sessionId?: string;
  clientId?: string | null;
  clientName?: string;
  clientPhone?: string;
  clientCpf?: string;
  status?: string;
  driveFolderId?: string | null;
  photos?: any[];
  pendingPhotos?: any[];
}

let pendingCartPreset: CartPresetPayload | null = null;

/** Publica o payload que o PDV deve carregar assim que entrar em cena. */
export function publishCartPreset(payload: CartPresetPayload): void {
  pendingCartPreset = payload;
}

/** Lê e limpa o payload pendente (consumo único). */
export function consumeCartPreset(): CartPresetPayload | null {
  const payload = pendingCartPreset;
  pendingCartPreset = null;
  return payload;
}
