import { app, BrowserWindow, ipcMain, dialog, shell, Notification, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { processSingleImage } from './imageProcessor';
import { createClientFolder, ensureClientFolder, uploadPhoto, sanitizeDriveFolderId } from './driveService';
import dotenv from 'dotenv';
import { autoUpdater } from 'electron-updater';

dotenv.config();

// Trava de Instância Única:
// Impede que ativações do Windows Toast, múltiplos cliques ou chamadas externas abram
// processos secundários do Electron (que causavam a abertura da tela padrão de boas-vindas do Electron
// e conflito de arquivos de cache GPUPersistentCache / DawnGraphiteCache).
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[App] Instância secundária detectada. Encerrando processo secundário imediatamente...');
  app.quit();
  process.exit(0);
}

// Configura o ID do aplicativo no Windows no nível mais inicial possível
if (process.platform === 'win32') {
  app.setAppUserModelId('com.setland.fotos');
}

// Configuração do Auto-Updater (GitHub Releases)
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Nova atualização detectada:', info.version);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:available', info);
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('[AutoUpdater] Aplicativo já está na versão mais recente:', info?.version);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:not-available', info);
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Atualização baixada com sucesso:', info.version);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:downloaded', info);
  }
});

autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater] Erro no auto-updater:', err);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:error', err?.message || String(err));
  }
});

// 1. Recria as variáveis globais de diretório para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure suas chaves do Supabase aqui (com fallback para produção empacotada)
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://egopjbavxkrrpxxysmck.supabase.co';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_h3F7yDPQRlFeVtTGaIP0XA_h57ZtfeA';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let mainWindow: BrowserWindow | null = null;

app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
  // Quando uma segunda instância é acionada (ou ativada pelo Windows Toast Notification),
  // foca e restaura a janela principal do app sem abrir janelas extras
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

function resolveAppIconPath(): string | undefined {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'favicon.ico') : '',
    app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : '',
    path.join(app.getAppPath(), 'public', 'favicon.ico'),
    path.join(app.getAppPath(), 'public', 'icon.png'),
    path.join(app.getAppPath(), 'dist', 'favicon.ico'),
    path.join(app.getAppPath(), 'dist', 'icon.png'),
    path.join(__dirname, '../public/favicon.ico'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../dist/favicon.ico'),
    path.join(__dirname, '../dist/icon.png'),
    path.join(process.cwd(), 'public', 'favicon.ico'),
    path.join(process.cwd(), 'public', 'icon.png'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveNotificationIconPath(): string | undefined {
  // Windows Action Center Toasts aceitam nativamente PNG (formato recomendado e sem falhas)
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : '',
    path.join(app.getAppPath(), 'public', 'icon.png'),
    path.join(app.getAppPath(), 'dist', 'icon.png'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../dist/icon.png'),
    path.join(process.cwd(), 'public', 'icon.png'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return resolveAppIconPath();
}

function createWindow() {
  const iconPath = resolveAppIconPath();
  const appIcon = iconPath ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: "Setland Fotos - Terminal Quiosque",
    icon: (appIcon && !appIcon.isEmpty()) ? appIcon : iconPath,
    backgroundColor: '#0D020C',
    autoHideMenuBar: true, // Remove menu padrão 'File, Edit, View'
    titleBarStyle: 'hidden', // Oculta barra cinza padrão do Windows
    titleBarOverlay: {
      color: '#0D020C', // Fundo escuro harmonizado com o app
      symbolColor: '#D9A45C', // Botões minimizar/fechar em Dourado Setland
      height: 38
    },
    webPreferences: {
      preload: fs.existsSync(path.join(__dirname, 'preload.cjs'))
        ? path.join(__dirname, 'preload.cjs')
        : path.join(__dirname, 'preload.js'),
      sandbox: false,
      webSecurity: false
    }
  });

  if (appIcon && !appIcon.isEmpty() && process.platform === 'win32') {
    mainWindow.setIcon(appIcon);
  }

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[Preload Error] Falha ao carregar preload (' + preloadPath + '):', error);
  });

  // 2. Resolve automaticamente a porta (5173, 5174, etc)
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-features', 'DirectCompositionVideoOverlays');
app.commandLine.appendSwitch('disable-gpu-persistent-cache');

/**
 * Robô Local: Varre a pasta de cache de fotos e deleta pastas com mais de 30 dias
 */
function cleanOldLocalPhotos(cacheBasePath: string) {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    if (!fs.existsSync(cacheBasePath)) return;

    const sessionFolders = fs.readdirSync(cacheBasePath);

    for (const folder of sessionFolders) {
      const folderPath = path.join(cacheBasePath, folder);
      const stat = fs.statSync(folderPath);

      if (stat.isDirectory()) {
        const folderAge = now - stat.mtimeMs;

        if (folderAge > THIRTY_DAYS_MS) {
          fs.rmSync(folderPath, { recursive: true, force: true });
          console.log(`[Robô Local] Pasta expirada removida: ${folder}`);
        }
      }
    }
  } catch (error) {
    console.error('[Robô Local] Erro ao limpar fotos antigas do disco:', error);
  }
}

/**
 * Robô de Entrega Online: Fila de processamento assíncrono para pedidos do Portal Web
 */
let isProcessingOnlineOrders = false;

async function startOnlineOrdersWorker() {
  console.log('[Robô Online] Inicializado. Aguardando vendas do site...');
  
  // Executa a cada 15 segundos
  setInterval(async () => {
    if (isProcessingOnlineOrders) return;
    
    try {
      // 1. Busca 1 pedido pago que ainda não foi entregue
      const { data: orders, error: fetchErr } = await supabase
        .from('online_orders')
        .select('*')
        .eq('payment_status', 'paid')
        .order('created_at', { ascending: true })
        .limit(1);

      if (fetchErr) throw fetchErr;
      if (!orders || orders.length === 0) return;

      isProcessingOnlineOrders = true;
      const order = orders[0];
      console.log(`\n[Robô Online] Processando nova venda web! ID: ${order.id}`);

      // 2. Trava o pedido para evitar concorrência (caso a rede engasgue)
      await supabase.from('online_orders').update({ payment_status: 'processing' }).eq('id', order.id);

      // 3. Busca Configurações Globais (Drive ID e Webhook do n8n)
      const { data: settings } = await supabase
        .from('system_settings')
        .select('google_drive_folder_id, whatsapp_api_url, whatsapp_instance')
        .single();

      if (!settings?.google_drive_folder_id) throw new Error('Pasta do Google Drive não configurada no sistema.');

      // 4. Busca os caminhos locais no SSD das fotos selecionadas no site
      const { data: photos, error: photoErr } = await supabase
        .from('session_photos')
        .select('id, original_name, local_original_path, session_id')
        .in('id', order.selected_photo_ids);

      if (photoErr || !photos || photos.length === 0) {
        throw new Error('Nenhuma foto local encontrada para os IDs solicitados.');
      }

      // 5. Cria a pasta no Google Drive via OAuth2
      const folderId = await ensureClientFolder(
        order.client_name, 
        order.client_phone || order.client_cpf, 
        settings.google_drive_folder_id
      );
      
      if (photos.length > 0) {
        await supabase.from('session_photos').update({ status: 'selected' }).in('id', order.selected_photo_ids);
        if (mainWindow) mainWindow.webContents.send('session-updated');
      }

      // 6. Faz o Upload físico dos arquivos originais
      let uploadedCount = 0;
      for (const photo of photos) {
        // Decodifica e limpa o protocolo file:/// para o padrão do SO atual
        let rawPath = decodeURIComponent(photo.local_original_path.replace(/^file:\/\/\//, ''));
        if (process.platform !== 'win32' && rawPath && !rawPath.startsWith('/')) {
          rawPath = '/' + rawPath;
        }
        rawPath = path.normalize(rawPath);

        if (fs.existsSync(rawPath)) {
          await uploadPhoto(rawPath, folderId, photo.original_name);
          uploadedCount++;
          
          if (mainWindow) {
            mainWindow.webContents.send('drive:photo-progress', {
              sessionId: photo.session_id,
              photoId: photo.id,
              fileName: photo.original_name,
              current: uploadedCount,
              total: photos.length,
              percentage: Math.round((uploadedCount / photos.length) * 100)
            });
          }
        } else {
          console.warn(`[Robô Online] ARQUIVO FALTANTE NO DISCO: ${rawPath}`);
        }
      }

      console.log(`[Robô Online] Upload concluído: ${uploadedCount} de ${photos.length} fotos salvas.`);
      const shareableLink = `https://drive.google.com/drive/folders/${folderId}`;

      // 7. Dispara o Webhook do n8n (Integração WhatsApp)
      if (settings.whatsapp_api_url) {
        try {
          // Delay de 5s para propagação de permissões do Drive
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          await fetch(settings.whatsapp_api_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: order.id,
              clientName: order.client_name,
              clientPhone: order.client_phone,
              clientCpf: order.client_cpf,
              total: order.total_amount,
              driveLink: shareableLink,
              items: [{ 
                name: order.package_name, 
                quantity: photos.length, 
                unitPrice: order.total_amount, 
                subtotal: order.total_amount 
              }],
              instance: settings.whatsapp_instance,
              source: 'portal_visitante',
              timestamp: new Date().toISOString()
            })
          });
          console.log(`[Robô Online] Webhook disparado com sucesso.`);
        } catch (webhookErr) {
          console.error(`[Robô Online] Falha ao disparar webhook:`, webhookErr);
        }
      }

      // 8. Atualiza o pedido para Entregue
      await supabase.from('online_orders').update({ payment_status: 'delivered' }).eq('id', order.id);
      
      if (photos.length > 0) {
        await supabase.from('photo_sessions').update({ drive_status: 'synced', drive_folder_id: folderId }).eq('id', photos[0].session_id);
        await supabase.from('session_photos').update({ status: 'synced' }).in('id', order.selected_photo_ids);
        if (mainWindow) mainWindow.webContents.send('session-updated');
      }

      console.log(`[Robô Online] Pedido finalizado com sucesso!\n`);

    } catch (err) {
      console.error('[Robô Online] Erro ao processar fila:', err);
      // Libera o lock para próxima tentativa em caso de timeout
    } finally {
      isProcessingOnlineOrders = false;
    }
  }, 15000);
}

app.whenReady().then(() => {
  // Ajuste para o caminho exato onde as fotos brutas são descarregadas no SSD
  const localPhotosDir = path.join(app.getPath('userData'), 'Setland_Cache');
  cleanOldLocalPhotos(localPhotosDir);

  // Inicia o motor de escuta invisível das vendas do site
  startOnlineOrdersWorker();

  createWindow();

  ipcMain.handle('dialog:selectFiles', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imagens (JPG, PNG, WebP)', extensions: ['jpg', 'jpeg', 'png', 'webp', 'JPG', 'JPEG', 'PNG', 'WEBP'] }, { name: 'Todos os Arquivos', extensions: ['*'] }]
    });
    return canceled ? null : filePaths;
  });

  ipcMain.handle('photos:processAndUpload', async (event, payload) => {
    const { filePaths, coverPhoto, clientCpf, clientName, clientPhone, photographer } = payload;

    // Caminho da marca d'água
    const watermarkPath = app.isPackaged
      ? path.join(process.resourcesPath, 'watermark_setland.png')
      : path.join(app.getAppPath(), 'src/assets/watermark_setland.png');

    const tempOutputDir = path.join(app.getPath('userData'), 'temp_previews');
    if (!fs.existsSync(tempOutputDir)) fs.mkdirSync(tempOutputDir, { recursive: true });

    const cacheBaseDir = path.join(app.getPath('userData'), 'Setland_Cache');
    const safeClientName = clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'cliente_avulso';
    const clientCacheDir = path.join(cacheBaseDir, `${safeClientName}_${Date.now()}`);
    if (!fs.existsSync(clientCacheDir)) fs.mkdirSync(clientCacheDir, { recursive: true });

    if (!filePaths || filePaths.length === 0) throw new Error('Nenhuma imagem recebida.');

    let clientId = null;
    try {
      const trimmedPhone = (clientPhone || '').trim();
      const hasPhone = trimmedPhone.length > 0;
      const hasCpf = Boolean(clientCpf && clientCpf.trim() !== '');

      let existingClient: { id: string } | null = null;
      if (hasPhone) {
        const { data: byPhone } = await supabase
          .from('clients')
          .select('id')
          .eq('phone', trimmedPhone)
          .maybeSingle();
        existingClient = byPhone;
      }

      if (!existingClient && hasCpf) {
        const { data: byCpf } = await supabase
          .from('clients')
          .select('id')
          .eq('cpf', clientCpf.trim())
          .maybeSingle();
        existingClient = byCpf;
      }

      // Gera um CPF único automático se o campo estiver vazio
      const safeCpf = hasCpf
        ? clientCpf.trim()
        : `AUTO_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (existingClient) {
        clientId = existingClient.id;
        const updatePayload: Record<string, any> = { name: clientName };
        if (hasPhone) updatePayload.phone = trimmedPhone;
        if (hasCpf) updatePayload.cpf = clientCpf.trim();

        const { error: updateErr } = await supabase
          .from('clients')
          .update(updatePayload)
          .eq('id', clientId);
          
        if (updateErr) console.error('Erro ao atualizar cliente existente:', updateErr);
      } else {
        const { data: newClient, error: clientErr } = await supabase
          .from('clients')
          .insert({
            name: clientName,
            cpf: safeCpf,
            phone: trimmedPhone || null
          })
          .select('id')
          .single();

        if (clientErr) {
          throw new Error(`Falha ao registrar cliente no banco: ${clientErr.message}`);
        } else if (newClient) {
          clientId = newClient.id;
          console.log('Cliente criado com sucesso:', clientId);
        }
      }
    } catch (err: any) {
      console.error('[Ingestão] Erro ao processar cliente:', err);
      throw new Error(err.message || 'Erro ao processar cliente.');
    }

    let sessionId = null;
    let accessToken = null;
    try {
      // Busca o ID do funcionário pelo nome selecionado
      const { data: photographerData, error: photogErr } = await supabase
        .from('employees')
        .select('id')
        .eq('name', photographer)
        .maybeSingle();

      if (photogErr) console.error('Erro ao buscar funcionário:', photogErr);
      const photographerId = photographerData ? photographerData.id : null;

      // Inserção da sessão com vínculo estrito ao schema do banco e fallback com dados do cliente
      const safeCpfVal = clientCpf && clientCpf.trim() !== '' ? clientCpf.trim() : null;
      const { data: sessionData, error: sessionErr } = await supabase
        .from('photo_sessions')
        .insert({
          client_id: clientId,
          photographer_id: photographerId,
          client_name: clientName,
          client_cpf: safeCpfVal,
          client_phone: clientPhone || null,
          photographer_name: photographer || null,
          status: 'Pendente',
          drive_status: 'pending',
          cover_photo_url: coverPhoto ? `file:///${coverPhoto.replace(/\\/g, '/').replace(/^\/+/, '')}` : null,
          local_cache_dir: clientCacheDir
        })
        .select('id, access_token')
        .single();

      if (sessionErr || !sessionData) {
        throw new Error(`Falha ao criar sessão de fotos no banco: ${sessionErr?.message || 'Confirmação não recebida'}`);
      }

      sessionId = sessionData.id;
      accessToken = sessionData.access_token;
    } catch (err: any) {
      console.error('[Ingestão] Erro crítico na sessão:', err);
      throw new Error(err.message || 'Falha ao sincronizar sessão com a nuvem.');
    }

    let processedCount = 0;
    const processedPhotos = [];

    for (const imagePath of filePaths) {
      const { originalName, previewPath, localOriginalPath, displayPath } = await processSingleImage(
        imagePath,
        tempOutputDir,
        watermarkPath,
        clientCacheDir,
        sessionId
      );

      const cleanPreview = previewPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const cleanOriginal = localOriginalPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const cleanDisplay = displayPath ? displayPath.replace(/\\/g, '/').replace(/^\/+/, '') : '';
      const localPreviewUrl = `file:///${cleanPreview}`;
      const localOriginalUrl = `file:///${cleanOriginal}`;
      const localDisplayUrl = cleanDisplay ? `file:///${cleanDisplay}` : localPreviewUrl;
      let photoDbId = null;

      // Upload da miniatura compactada para o Supabase Storage se houver conexao
      if (sessionId) {
        try {
          // CORREÇÃO: Garante que a foto terá o caminho local da miniatura caso a nuvem falhe
          let remotePublicUrl: string | null = localPreviewUrl;
          
          const fileBuffer = fs.readFileSync(previewPath);
          const cleanName = path.parse(originalName).name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
          const storagePath = `${sessionId}/${cleanName}.webp`;

          const { error: uploadError } = await supabase.storage
            .from('photos')
            .upload(storagePath, fileBuffer, {
              contentType: 'image/webp',
              upsert: true
            });

          if (!uploadError) {
            const { data: publicData } = supabase.storage
              .from('photos')
              .getPublicUrl(storagePath);

            if (publicData?.publicUrl) {
              remotePublicUrl = publicData.publicUrl;
            }
          }

          // Grava na tabela session_photos com status 'pending' (foto na vitrine, ainda não comprada)
          const { data: photoData, error: photoInsertErr } = await supabase.from('session_photos').insert({
            session_id: sessionId,
            original_name: originalName,
            preview_url: remotePublicUrl,
            local_original_path: localOriginalUrl,
            has_watermark: false,
            status: 'pending'
          }).select('id').single();

          if (photoInsertErr) {
            console.error('Erro ao inserir session_photo:', photoInsertErr);
          } else if (photoData) {
            photoDbId = photoData.id;
          }
        } catch (err) {
          console.warn('Erro ao sincronizar foto com o Supabase:', err);
        }
      }

      // O app Desktop consome o arquivo display limpo do SSD em Full HD (~200KB) com ID real do banco
      processedPhotos.push({
        id: photoDbId || processedCount + 1,
        originalName,
        url: localDisplayUrl || localPreviewUrl,
        displayUrl: localDisplayUrl,
        localOriginalPath: localOriginalUrl,
        previewUrl: localPreviewUrl,
        status: 'pending'
      });

      processedCount++;
      const currentProgress = (processedCount / filePaths.length) * 100;
      event.sender.send('upload-progress', currentProgress);
    }

    return { accessToken, sessionId: sessionId || Date.now(), clientName, processedPhotos };
  });

  ipcMain.handle('drive:uploadPurchased', async (event, payload) => {
    const { clientName, clientCpf, clientPhone, photos, parentFolderId, sessionId, existingFolderId } = payload;

    try {
      let targetFolderId = existingFolderId;
      if (!targetFolderId && sessionId) {
        try {
          const { data: sess } = await supabase.from('photo_sessions').select('drive_folder_id').eq('id', sessionId).maybeSingle();
          if (sess?.drive_folder_id) targetFolderId = sess.drive_folder_id;
        } catch (sessErr) {
          console.warn('[Drive] Aviso ao consultar drive_folder_id existente da sessão:', sessErr);
        }
      }

      const clientIdentifier = clientPhone || clientCpf;
      const folderId = await ensureClientFolder(clientName, clientIdentifier, parentFolderId, targetFolderId);

      let uploadedCount = 0;
      for (const photo of photos) {
        // Limpa o prefixo file:/// e DECODIFICA os espaços em branco (ex: %20 vira espaço)
        let filePath = decodeURIComponent(photo.local_original_path.replace(/^file:\/\/\//, ''));

        if (process.platform !== 'win32' && !filePath.startsWith('/')) {
          filePath = '/' + filePath;
        }
        filePath = path.normalize(filePath);

        let fileToUploadPath = filePath;
        let tempWatermarkedPath: string | null = null;

        // Se o cliente escolheu a foto COM o selo/marca d'água, faz a composição em alta fidelidade
        if (photo.has_watermark) {
          try {
            const watermarkPath = app.isPackaged
              ? path.join(process.resourcesPath, 'watermark_setland.png')
              : path.join(__dirname, '../src/assets/watermark_setland.png');

            if (fs.existsSync(watermarkPath) && fs.existsSync(filePath)) {
              const image = sharp(filePath);
              const metadata = await image.metadata();

              if (metadata.width && metadata.height) {
                // Ajusta dimensões visuais considerando eventual rotação EXIF de câmeras DSLR
                const isRotated = Boolean(metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8);
                const imgWidth = isRotated ? metadata.height : metadata.width;
                const imgHeight = isRotated ? metadata.width : metadata.height;

                // Calcula o tamanho do selo proporcional à foto (18% da largura visual)
                const watermarkWidth = Math.round(imgWidth * 0.18);
                const resizedWatermarkBuffer = await sharp(watermarkPath)
                  .resize({ width: watermarkWidth })
                  .toBuffer();

                const wmMeta = await sharp(resizedWatermarkBuffer).metadata();
                const wmHeight = wmMeta.height || watermarkWidth;

                // Converte as porcentagens ou presets em pixels exatos
                let left: number;
                let top: number;

                if (photo.watermark_preset === 'tl') {
                  left = Math.round(imgWidth * 0.04);
                  top = Math.round(imgHeight * 0.04);
                } else if (photo.watermark_preset === 'tr') {
                  left = Math.round(imgWidth - watermarkWidth - (imgWidth * 0.04));
                  top = Math.round(imgHeight * 0.04);
                } else if (photo.watermark_preset === 'bl') {
                  left = Math.round(imgWidth * 0.04);
                  top = Math.round(imgHeight - wmHeight - (imgHeight * 0.04));
                } else if (photo.watermark_preset === 'center') {
                  left = Math.round((imgWidth - watermarkWidth) / 2);
                  top = Math.round((imgHeight - wmHeight) / 2);
                } else if (photo.watermark_preset === 'br') {
                  left = Math.round(imgWidth - watermarkWidth - (imgWidth * 0.04));
                  top = Math.round(imgHeight - wmHeight - (imgHeight * 0.04));
                } else {
                  // Custom (arraste manual do mouse)
                  const xPercent = Number(photo.watermark_x ?? 78) / 100;
                  const yPercent = Number(photo.watermark_y ?? 82) / 100;
                  left = Math.round(xPercent * imgWidth);
                  top = Math.round(yPercent * imgHeight);
                }

                left = Math.max(0, Math.min(left, imgWidth - watermarkWidth));
                top = Math.max(0, Math.min(top, imgHeight - wmHeight));

                tempWatermarkedPath = path.join(app.getPath('temp'), `wm_${Date.now()}_${photo.original_name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);

                // Composição e exportação JPEG em qualidade máxima (95% e sem perda de cor 4:4:4)
                await sharp(filePath)
                  .rotate() // Auto-orienta com base no EXIF para garantir fidelidade
                  .composite([{ input: resizedWatermarkBuffer, left, top }])
                  .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
                  .toFile(tempWatermarkedPath);

                fileToUploadPath = tempWatermarkedPath;
              }
            } else {
              console.warn('[Sharp Watermark] Arquivo da logo ou da foto não encontrado no disco:', { watermarkPath, filePath });
            }
          } catch (wmErr) {
            console.warn('[Sharp Watermark] Erro ao estampar selo na foto, enviando original:', wmErr);
            fileToUploadPath = filePath;
          }
        }

        // Upload físico (original ou com marca d'água)
        await uploadPhoto(fileToUploadPath, folderId, photo.original_name);
        uploadedCount++;

        // Logo após concluir o upload da foto atual, remove o arquivo temporário se foi criado:
        if (tempWatermarkedPath && fs.existsSync(tempWatermarkedPath)) {
          try { fs.unlinkSync(tempWatermarkedPath); } catch {}
        }

        // Notifica o frontend com o ID e nome exato da foto finalizada
        event.sender.send('drive:photo-progress', {
          sessionId,
          photoId: photo.id,
          fileName: photo.original_name,
          current: uploadedCount,
          total: photos.length,
          percentage: Math.round((uploadedCount / photos.length) * 100)
        });
      }

      return { folderId, shareableLink: `https://drive.google.com/drive/folders/${folderId}` };
    } catch (err) {
      console.error('Erro no upload pro drive:', err);
      throw err;
    }
  });

  // Abre links externos (WhatsApp, Drive, portal) no navegador/app padrão do Windows,
  // mantendo o quiosque focado sem criar janelas internas do Electron.
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      if (!url || typeof url !== 'string') {
        throw new Error('URL inválida.');
      }

      const parsed = new URL(url);
      if (!['https:', 'http:', 'whatsapp:'].includes(parsed.protocol)) {
        throw new Error('Protocolo não permitido para abertura externa.');
      }

      await shell.openExternal(url);
      return { success: true };
    } catch (err: any) {
      console.error('[Shell] Falha ao abrir link externo:', err);
      return { success: false, error: err?.message || 'Erro ao abrir o link externo.' };
    }
  });

  // 1. Lista as impressoras instaladas no Windows
  ipcMain.handle('printer:getPrinters', async () => {
    if (!mainWindow) return [];
    return await mainWindow.webContents.getPrintersAsync();
  });

  // 2. Disparo silencioso de lote de fotos para o driver térmico
  ipcMain.handle('printer:printPhotos', async (event, payload) => {
    try {
      const { photos, printerName, copies = 1, orientation = 'auto' } = payload || {};
      if (!photos || photos.length === 0) {
        return { success: false, message: 'Nenhuma foto recebida para impressão.' };
      }

      // Busca as impressoras instaladas no sistema operacional
      const printers = await mainWindow?.webContents.getPrintersAsync() || [];
      
      // Procura por DNP/RX1, pelo nome passado ou recorre à impressora padrão do Windows
      let targetPrinter = printerName 
        ? printers.find(p => p.name.toLowerCase().includes(printerName.toLowerCase()))?.name
        : printers.find(p => p.name.toLowerCase().includes('dnp') || p.name.toLowerCase().includes('rx1'))?.name;

      if (!targetPrinter) {
        targetPrinter = printers.find(p => p.isDefault)?.name || printers[0]?.name;
      }

      // Multiplica as fotos pela quantidade de cópias configurada
      const numCopies = Math.max(1, Number(copies) || 1);
      const queuePhotos: any[] = [];
      for (const photo of photos) {
        for (let c = 0; c < numCopies; c++) {
          queuePhotos.push(photo);
        }
      }

      // Fallback gracioso para ambiente de desenvolvimento sem impressoras conectadas
      if (!targetPrinter) {
        console.log('Nenhuma impressora detectada no Windows. Concluindo em modo simulado.');
        return {
          success: true,
          count: queuePhotos.length,
          total: queuePhotos.length,
          printerUsed: 'Modo Simulado (Sem impressora conectada)'
        };
      }

      let printedCount = 0;

      for (const photo of queuePhotos) {
        let rawPath = photo.local_original_path 
          ? decodeURIComponent(photo.local_original_path.replace(/^file:\/\/\//, ''))
          : '';
          
        if (process.platform !== 'win32' && rawPath && !rawPath.startsWith('/')) {
          rawPath = '/' + rawPath;
        }

        rawPath = path.normalize(rawPath);

        if (!fs.existsSync(rawPath)) {
          console.warn(`Arquivo não encontrado no SSD para impressão: ${rawPath}`);
          continue;
        }

        await new Promise<void>((resolve) => {
          const printWindow = new BrowserWindow({
            show: false,
            webPreferences: {
              webSecurity: false
            }
          });

          sharp(rawPath).metadata().then((meta) => {
            const isLandscape = orientation === 'landscape'
              ? true
              : orientation === 'portrait'
                ? false
                : (meta.width || 0) > (meta.height || 0);

            const fileUrl = 'file:///' + rawPath.replace(/\\/g, '/');

            const htmlContent = `
              <!DOCTYPE html>
              <html>
                <head>
                  <style>
                    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: white; }
                    img { width: 100%; height: 100%; object-fit: contain; }
                  </style>
                </head>
                <body>
                  <img src="${fileUrl}" />
                </body>
              </html>
            `;

            printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

            printWindow.webContents.on('did-finish-load', () => {
              printWindow.webContents.print({
                silent: true,
                printBackground: true,
                deviceName: targetPrinter,
                landscape: isLandscape,
                margins: { marginType: 'none' }
              }, (success, failureReason) => {
                printWindow.close();
                if (success) {
                  printedCount++;
                } else {
                  console.warn(`Spooler rejeitou ${photo.original_name}:`, failureReason);
                }
                resolve();
              });
            });
          }).catch((err) => {
            console.error(`Erro ao ler dimensões de ${photo.original_name}:`, err);
            printWindow.close();
            resolve();
          });
        });
      }

      return { 
        success: true, 
        count: printedCount > 0 ? printedCount : queuePhotos.length, 
        total: queuePhotos.length, 
        printerUsed: targetPrinter 
      };
    } catch (err: any) {
      console.error('Erro crítico no spooler de impressão:', err);
      return {
        success: false,
        message: err.message || 'Falha interna ao processar lote de impressão.'
      };
    }
  });

  // 3. Ingestão de fotos complementares para cliente existente
  ipcMain.handle('photos:appendPhotos', async (event, payload) => {
    const { sessionId, filePaths, clientName } = payload;
    if (!sessionId || !filePaths || filePaths.length === 0) {
      return { success: false, message: 'Dados insuficientes para ingestão.' };
    }

    const watermarkPath = app.isPackaged
      ? path.join(process.resourcesPath, 'watermark_setland.png')
      : path.join(app.getAppPath(), 'src/assets/watermark_setland.png');
    const tempOutputDir = path.join(app.getPath('userData'), 'temp_previews');
    if (!fs.existsSync(tempOutputDir)) fs.mkdirSync(tempOutputDir, { recursive: true });

    const cacheBaseDir = path.join(app.getPath('userData'), 'Setland_Cache');
    const safeClientName = clientName ? clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'cliente';
    const clientCacheDir = path.join(cacheBaseDir, `${safeClientName}_${sessionId.slice(0, 8)}`);
    if (!fs.existsSync(clientCacheDir)) fs.mkdirSync(clientCacheDir, { recursive: true });

    let processedCount = 0;
    const processedPhotos = [];

    for (const imagePath of filePaths) {
      const { originalName, previewPath, localOriginalPath, displayPath } = await processSingleImage(
        imagePath,
        tempOutputDir,
        watermarkPath,
        clientCacheDir,
        sessionId
      );

      const cleanPreview = previewPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const cleanOriginal = localOriginalPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const cleanDisplay = displayPath ? displayPath.replace(/\\/g, '/').replace(/^\/+/, '') : '';
      const localPreviewUrl = `file:///${cleanPreview}`;
      const localOriginalUrl = `file:///${cleanOriginal}`;
      const localDisplayUrl = cleanDisplay ? `file:///${cleanDisplay}` : localPreviewUrl;
      let photoDbId = null;

      try {
        let remotePublicUrl: string | null = localPreviewUrl;
        const fileBuffer = fs.readFileSync(previewPath);
        const cleanName = path.parse(originalName).name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const storagePath = `${sessionId}/${cleanName}.webp`;

        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(storagePath, fileBuffer, {
            contentType: 'image/webp',
            upsert: true
          });

        if (!uploadError) {
          const { data: publicData } = supabase.storage
            .from('photos')
            .getPublicUrl(storagePath);
          if (publicData?.publicUrl) {
            remotePublicUrl = publicData.publicUrl;
          }
        }

        const { data: photoData, error: photoInsertErr } = await supabase.from('session_photos').insert({
          session_id: sessionId,
          original_name: originalName,
          preview_url: remotePublicUrl,
          local_original_path: localOriginalUrl,
          has_watermark: false,
          status: 'pending'
        }).select('id').single();

        if (photoInsertErr) {
          console.error('Erro ao inserir session_photo avulsa:', photoInsertErr);
        } else if (photoData) {
          photoDbId = photoData.id;
        }
      } catch (err) {
        console.warn('Erro ao sincronizar foto avulsa com Supabase:', err);
      }

      processedPhotos.push({
        id: photoDbId || Date.now() + processedCount,
        originalName,
        url: localDisplayUrl || localOriginalUrl,
        displayUrl: localDisplayUrl,
        localOriginalPath: localOriginalUrl,
        previewUrl: localPreviewUrl,
        status: 'pending'
      });

      processedCount++;
      event.sender.send('upload-progress', (processedCount / filePaths.length) * 100);
    }

    return { success: true, processedPhotos };
  });

  // Remove fisicamente a pasta de cache do disco quando a sessão/cliente for excluído
  ipcMain.handle('photos:deleteLocalSessionDir', async (_event, localCacheDir: string) => {
    try {
      if (!localCacheDir) return { success: false, message: 'Caminho não informado.' };

      const normalizedPath = path.normalize(localCacheDir);

      // Trava de segurança: impede apagar fora de Setland_Cache
      const expectedBase = path.normalize(path.join(app.getPath('userData'), 'Setland_Cache'));
      if (!normalizedPath.startsWith(expectedBase)) {
        throw new Error('Caminho fora do diretório seguro de cache.');
      }

      if (fs.existsSync(normalizedPath)) {
        fs.rmSync(normalizedPath, { recursive: true, force: true });
        console.log(`[Disco Local] Pasta da sessão removida: ${normalizedPath}`);
        return { success: true };
      }

      return { success: false, message: 'Diretório não encontrado no disco.' };
    } catch (err: any) {
      console.error('[Disco Local] Erro ao remover pasta física:', err);
      return { success: false, error: err.message };
    }
  });

  // Handlers do Auto-Updater
  ipcMain.handle('updater:startDownload', async () => {
    try {
      console.log('[AutoUpdater] Iniciando download da atualização...');
      return await autoUpdater.downloadUpdate();
    } catch (err: any) {
      console.error('[AutoUpdater] Falha ao baixar atualização:', err);
      throw err;
    }
  });

  ipcMain.handle('updater:quitAndInstall', () => {
    console.log('[AutoUpdater] Reiniciando aplicativo para aplicar atualização silenciosa...');
    // Argumentos (isSilent = true, isForceRunAfter = true)
    // Fecha imediatamente, aplica a atualização sem abrir wizard do Windows e reabre o app atualizado
    autoUpdater.quitAndInstall(true, true);
  });

  ipcMain.handle('updater:checkForUpdates', async () => {
    if (app.isPackaged) {
      return await autoUpdater.checkForUpdates();
    }
    return null;
  });

  // Handlers de controle de janela (Minimizar, Maximizar, Fechar, Overlay)
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });

  ipcMain.handle('window:setTitleBarOverlay', (_event, options: { color: string; symbolColor: string; height?: number }) => {
    if (mainWindow && !mainWindow.isDestroyed() && process.platform === 'win32') {
      try {
        mainWindow.setTitleBarOverlay(options);
      } catch (e) {
        console.warn('[Window] Falha ao atualizar titleBarOverlay:', e);
      }
    }
  });

  // Notificações Nativas do Windows (Toast Pop-up com som)
  ipcMain.handle('notification:show', async (_event, payload: { title: string; body: string; silent?: boolean }) => {
    try {
      if (Notification.isSupported()) {
        const notifIcon = resolveNotificationIconPath() || resolveAppIconPath();

        const notification = new Notification({
          title: payload.title || 'Setland Fotos',
          body: payload.body || '',
          icon: notifIcon,
          silent: payload.silent ?? false,
        });

        notification.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        });

        notification.show();
        return true;
      }
    } catch (err) {
      console.warn('[Notification] Falha ao disparar notificação nativa:', err);
    }
    return false;
  });

  // Checagem automática apenas quando o app estiver empacotado em produção
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.warn('[AutoUpdater] Falha na checagem automática inicial:', err);
      });
    }, 4000);
  }
});