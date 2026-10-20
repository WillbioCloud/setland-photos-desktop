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

export async function createClientFolder(clientName: string, cpf: string, parentFolderId: string): Promise<string> {
  const drive = getDriveClient();
  const folderName = `${clientName} - ${cpf || 'S/Cpf'}`;
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id',
  });

  if (!response.data.id) throw new Error('Falha ao obter o ID da pasta após a criação.');
  return response.data.id;
}

export async function uploadPhoto(filePath: string, folderId: string, fileName: string): Promise<string> {
  const drive = getDriveClient();
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: fs.createReadStream(filePath) },
    fields: 'id',
  });

  if (!response.data.id) throw new Error('Falha ao obter o ID do arquivo após o upload.');
  return response.data.id;
}
