import { google, drive_v3 } from 'googleapis';
import type { GaxiosError } from 'gaxios';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ---------------------------------------------------------------------------
// Carregamento de credenciais resiliente (lazy).
// Antes: readFileSync no topo do módulo -> se o arquivo não existisse, o
// processo principal do Electron morria no boot e NADA funcionava (nem o PDV).
// Agora: carrega sob demanda e lança um erro claro e recuperável.
// ---------------------------------------------------------------------------
const isDev = !app.isPackaged;
const CREDENTIALS_PATH = isDev
  ? path.join(process.cwd(), 'electron', 'credentials.json')
  : path.join(process.resourcesPath, 'credentials.json');

let cachedDrive: drive_v3.Drive | null = null;

export class DriveCredentialsError extends Error {
  constructor(public readonly credentialPath: string) {
    super(
      `Arquivo de credenciais do Google Drive não encontrado em "${credentialPath}". ` +
      `Coloque o credentials.json neste caminho e tente novamente.`
    );
    this.name = 'DriveCredentialsError';
  }
}

function getDrive(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive;

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new DriveCredentialsError(CREDENTIALS_PATH);
  }

  let creds: { client_id?: string; client_secret?: string; refresh_token?: string };
  try {
    creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  } catch (err) {
    throw new Error(
      `credentials.json inválido (JSON malformado) em "${CREDENTIALS_PATH}": ${(err as Error).message}`,
      { cause: err }
    );
  }

  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    throw new Error(
      `credentials.json incompleto: são obrigatórios client_id, client_secret e refresh_token.`
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({ refresh_token: creds.refresh_token });

  cachedDrive = google.drive({
    version: 'v3',
    auth: oauth2Client,
    // Timeout por requisição: sem isso uma rede meia-boca pendura o lote inteiro
    // para sempre dentro do IPC, congelando o progresso na tela do operador.
    timeout: 120_000,
  });

  return cachedDrive;
}

/**
 * Testa se um erro é candidato a nova tentativa.
 * Rede instável, timeout e rate limit do Google (429/500/502/503/504) entram.
 * Erro de permissão (401/403) e arquivo inexistente (404) NÃO entram: repetir
 * só queimaria tempo do operador no balcão.
 */
function isRetryableError(err: unknown): boolean {
  const gErr = err as GaxiosError & { code?: string | number };
  const status = gErr?.response?.status ?? gErr?.code;

  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }

  const retryableCodes = [
    'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN',
    'ENOTFOUND', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH',
    'ERR_NETWORK', 'E_SOCKET_CONNECTION_TIMEOUT',
  ];
  return retryableCodes.includes(String(status));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wrapper de retry com backoff exponencial + jitter.
 * Base 1.5s: tenta em ~1.5s, ~3s, ~6s, ~12s (4 tentativas no total).
 */
async function withRetry<T>(
  label: string,
  operation: () => Promise<T>,
  maxAttempts = 4
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt || !isRetryableError(err)) {
        throw err;
      }

      const backoffMs = Math.min(1500 * Math.pow(2, attempt - 1), 15_000);
      // Jitter de até 25% para não sincronizar as tentativas de um lote inteiro
      const jitter = backoffMs * 0.25 * Math.random();
      const delayMs = Math.round(backoffMs + jitter);

      const reason = (err as GaxiosError)?.response?.status
        ?? (err as GaxiosError)?.code
        ?? (err as Error)?.message;

      console.warn(
        `[Drive] ${label} falhou (tentativa ${attempt}/${maxAttempts}) por "${reason}". ` +
        `Nova tentativa em ${Math.round(delayMs / 1000)}s...`
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

export async function createClientFolder(clientName: string, cpf: string, parentFolderId: string): Promise<string> {
  const folderName = `${clientName} - ${cpf || 'S/Cpf'}`;
  const drive = getDrive();

  const folderId = await withRetry(`criar pasta "${folderName}"`, async () => {
    const response = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      },
      fields: 'id',
    });

    if (!response.data.id) {
      throw new Error('Falha ao obter o ID da pasta após a criação.');
    }

    return response.data.id;
  });

  return folderId;
}

/**
 * Upload de um arquivo original com retry.
 * O stream é recriado a cada tentativa: um ReadStream já consumido/abortado
 * não pode ser reenviado (o corpo sairia vazio na 2ª tentativa).
 */
export async function uploadPhoto(filePath: string, folderId: string, fileName: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const drive = getDrive();

  return withRetry(`upload de "${fileName}"`, async () => {
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: fs.createReadStream(filePath),
      },
      fields: 'id',
    });

    if (!response.data.id) {
      throw new Error('Falha ao obter o ID do arquivo após o upload.');
    }

    console.log(`[Drive] Upload concluído: ${fileName} (ID: ${response.data.id})`);
    return response.data.id;
  });
}
