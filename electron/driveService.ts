import { google, drive_v3 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

let driveClient: drive_v3.Drive | null = null;

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const isDev = !app.isPackaged;
  const CREDENTIALS_PATH = isDev 
    ? path.join(process.cwd(), 'electron', 'credentials.json') 
    : path.join(process.resourcesPath, 'credentials.json');

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Arquivo credentials.json não encontrado em: ${CREDENTIALS_PATH}. Configure as credenciais do Google Drive.`);
  }

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({ refresh_token: creds.refresh_token });
  driveClient = google.drive({ version: 'v3', auth: oauth2Client });
  return driveClient;
}

export function sanitizeDriveFolderId(rawIdOrUrl: string): string {
  if (!rawIdOrUrl) return '';
  const trimmed = rawIdOrUrl.trim();
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch && folderMatch[1]) return folderMatch[1];
  const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) return idMatch[1];
  const cleaned = trimmed.split('?')[0].split('#')[0].replace(/\/+$/, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || trimmed;
}

export async function ensureClientFolder(
  clientName: string, 
  cpf: string, 
  rawParentFolderId: string, 
  existingFolderId?: string | null
): Promise<string> {
  const drive = getDriveClient();
  const parentFolderId = sanitizeDriveFolderId(rawParentFolderId);
  const folderName = `${clientName} - ${cpf || 'S/Cpf'}`;

  // 1. Se existingFolderId for informado, valida se a pasta ainda existe no Google Drive
  if (existingFolderId) {
    try {
      const cleanExistingId = sanitizeDriveFolderId(existingFolderId);
      const res = await drive.files.get({
        fileId: cleanExistingId,
        fields: 'id, trashed'
      });
      if (res.data?.id && !res.data.trashed) {
        console.log(`[Drive] Pasta existente reaproveitada via ID: ${cleanExistingId}`);
        return res.data.id;
      }
    } catch (err: any) {
      console.warn(`[Drive] Pasta com ID ${existingFolderId} não pôde ser recuperada:`, err?.message || err);
    }
  }

  // 2. Busca se já existe uma pasta com o mesmo nome dentro da pasta pai
  try {
    const escapedName = folderName.replace(/'/g, "\\'");
    const q = `'${parentFolderId}' in parents and name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchRes = await drive.files.list({
      q,
      fields: 'files(id, name)',
      spaces: 'drive',
      pageSize: 1
    });

    if (searchRes.data.files && searchRes.data.files.length > 0) {
      const foundId = searchRes.data.files[0].id;
      if (foundId) {
        console.log(`[Drive] Pasta existente reaproveitada via busca por nome: ${folderName} (${foundId})`);
        return foundId;
      }
    }
  } catch (searchErr: any) {
    console.warn('[Drive] Aviso ao pesquisar pasta por nome no Drive:', searchErr?.message || searchErr);
  }

  // 3. Cria a pasta somente se não encontrada
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id',
  });

  if (!response.data.id) throw new Error('Falha ao obter o ID da pasta após a criação no Drive.');
  console.log(`[Drive] Nova pasta criada para o cliente: ${folderName} (${response.data.id})`);
  return response.data.id;
}

export async function createClientFolder(clientName: string, cpf: string, parentFolderId: string): Promise<string> {
  return ensureClientFolder(clientName, cpf, parentFolderId);
}

export async function uploadPhoto(filePath: string, folderId: string, fileName: string): Promise<string> {
  const drive = getDriveClient();
  const cleanFolderId = sanitizeDriveFolderId(folderId);

  // Evita re-upload caso o arquivo com o mesmo nome já exista na pasta do cliente
  try {
    const escapedName = fileName.replace(/'/g, "\\'");
    const q = `'${cleanFolderId}' in parents and name = '${escapedName}' and trashed = false`;
    const checkRes = await drive.files.list({
      q,
      fields: 'files(id, name)',
      pageSize: 1
    });

    if (checkRes.data.files && checkRes.data.files.length > 0 && checkRes.data.files[0].id) {
      console.log(`[Drive] Foto ${fileName} já presente no Drive (${checkRes.data.files[0].id}), pulando duplicata.`);
      return checkRes.data.files[0].id;
    }
  } catch (chkErr: any) {
    console.warn(`[Drive] Aviso ao verificar existência de ${fileName}:`, chkErr?.message || chkErr);
  }

  const ext = path.extname(filePath).toLowerCase();
  let mimeType = 'image/jpeg';
  if (ext === '.png') mimeType = 'image/png';
  else if (ext === '.webp') mimeType = 'image/webp';

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [cleanFolderId] },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id',
  });

  if (!response.data.id) throw new Error('Falha ao obter o ID do arquivo após o upload.');
  return response.data.id;
}
