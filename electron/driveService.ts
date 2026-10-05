import { google, drive_v3 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Lê o arquivo JSON com o Client ID, Secret e Refresh Token
const isDev = !app.isPackaged;
const CREDENTIALS_PATH = isDev 
  ? path.join(process.cwd(), 'electron', 'credentials.json') 
  : path.join(process.resourcesPath, 'credentials.json');

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));

// Inicializa o cliente OAuth2 com as credenciais do App
const oauth2Client = new google.auth.OAuth2(
  creds.client_id,
  creds.client_secret,
  'https://developers.google.com/oauthplayground'
);

// Injeta o Refresh Token permanente
oauth2Client.setCredentials({
  refresh_token: creds.refresh_token
});

const drive: drive_v3.Drive = google.drive({ version: 'v3', auth: oauth2Client });

export async function createClientFolder(clientName: string, cpf: string, parentFolderId: string): Promise<string> {
  const folderName = `${clientName} - ${cpf || 'S/Cpf'}`;
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId]
  };

  try {
    const response = await drive.files.create({
      requestBody: fileMetadata,
      fields: 'id',
    });

    if (!response.data.id) {
      throw new Error('Falha ao obter o ID da pasta após a criação.');
    }

    return response.data.id;
  } catch (error) {
    console.error('Erro ao criar a pasta no Google Drive:', error);
    throw error;
  }
}

export async function uploadPhoto(filePath: string, folderId: string, fileName: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };

  const media = {
    mimeType: mimeType,
    body: fs.createReadStream(filePath),
  };

  try {
    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id',
    });

    if (!response.data.id) {
      throw new Error('Falha ao obter o ID do arquivo após o upload.');
    }

    console.log(`Upload concluído: ${fileName} (ID: ${response.data.id})`);
    return response.data.id;
  } catch (error) {
    console.error(`Erro ao fazer o upload da foto ${fileName}:`, error);
    throw error;
  }
}
