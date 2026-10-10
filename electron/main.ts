import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import type { PrinterInfo } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import { processSingleImage } from './imageProcessor';
import { createClientFolder, uploadPhoto } from './driveService';
import dotenv from 'dotenv';

dotenv.config();

// 1. Recria as variáveis globais de diretório para ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure suas chaves do Supabase aqui
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    autoHideMenuBar: true,
    webPreferences: {
      // O Vite gera o preload com a extensão .mjs
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Libera carregamento de arquivos locais do SSD (file:///)
    },
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

function getCacheBasePath(): string {
  return path.join(app.getPath('userData'), 'Setland_Cache');
}

/** Soma recursivamente o tamanho em bytes de um diretório. */
function getDirectorySizeBytes(dirPath: string): number {
  let total = 0;
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        total += getDirectorySizeBytes(fullPath);
      } else {
        total += fs.statSync(fullPath).size;
      }
    } catch {
      // arquivo removido/sem permissão durante a varredura: ignora
    }
  }

  return total;
}

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
 * Varredura do cache: classifica cada pasta de sessão em "já entregue no Drive"
 * (pode apagar) x "ainda pendente" (NUNCA apagar, senão o cliente perde as fotos
 * compradas e nunca recebe a entrega).
 */
async function scanLocalCache() {
  const cacheBasePath = getCacheBasePath();
  const sessions: Array<{ dir: string; bytes: number; ageDays: number; driveStatus: string; sessionId: string | null }> = [];

  if (!fs.existsSync(cacheBasePath)) {
    return { sessions, totalBytes: 0, syncedBytes: 0, pendingBytes: 0 };
  }

  // Indexa as sessões do banco pelo caminho de cache registrado
  const { data: dbSessions } = await supabase
    .from('photo_sessions')
    .select('id, local_cache_dir, drive_status');

  const byDir = new Map<string, { id: string; drive_status: string | null }>();
  for (const s of dbSessions ?? []) {
    if (s.local_cache_dir) {
      byDir.set(path.normalize(s.local_cache_dir), { id: s.id, drive_status: s.drive_status });
    }
  }

  const now = Date.now();
  for (const folder of fs.readdirSync(cacheBasePath)) {
    const folderPath = path.join(cacheBasePath, folder);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(folderPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const info = byDir.get(path.normalize(folderPath));
    const bytes = getDirectorySizeBytes(folderPath);

    sessions.push({
      dir: folderPath,
      bytes,
      ageDays: Math.floor((now - stat.mtimeMs) / 86_400_000),
      driveStatus: info?.drive_status ?? 'unknown',
      sessionId: info?.id ?? null,
    });
  }

  const totalBytes = sessions.reduce((acc, s) => acc + s.bytes, 0);
  const syncedBytes = sessions.filter(s => s.driveStatus === 'synced').reduce((acc, s) => acc + s.bytes, 0);

  return { sessions, totalBytes, syncedBytes, pendingBytes: totalBytes - syncedBytes };
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
      const folderId = await createClientFolder(order.client_name, order.client_cpf, settings.google_drive_folder_id);
      
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
  const localPhotosDir = getCacheBasePath();
  cleanOldLocalPhotos(localPhotosDir);

  // Antes a limpeza rodava UMA vez no boot. Num terminal que fica ligado 24/7 no
  // parque, ela nunca mais disparava e o SSD enchia. Agora roda a cada 6h.
  setInterval(() => cleanOldLocalPhotos(getCacheBasePath()), 6 * 60 * 60 * 1000);

  // Inicia o motor de escuta invisível das vendas do site
  startOnlineOrdersWorker();

  createWindow();

  ipcMain.handle('dialog:selectFiles', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg'] }]
    });
    return canceled ? null : filePaths;
  });

  ipcMain.handle('photos:processAndUpload', async (event, payload) => {
    const { filePaths, coverPhoto, clientCpf, clientName, clientPhone, photographer } = payload;

    // Caminho da marca d'água
    const watermarkPath = path.join(app.getAppPath(), 'src/assets/watermark_setland.png');

    const tempOutputDir = path.join(app.getPath('userData'), 'temp_previews');
    if (!fs.existsSync(tempOutputDir)) fs.mkdirSync(tempOutputDir, { recursive: true });

    const cacheBaseDir = path.join(app.getPath('userData'), 'Setland_Cache');
    const safeClientName = clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'cliente_avulso';
    const clientCacheDir = path.join(cacheBaseDir, `${safeClientName}_${Date.now()}`);
    if (!fs.existsSync(clientCacheDir)) fs.mkdirSync(clientCacheDir, { recursive: true });

    if (!filePaths || filePaths.length === 0) throw new Error('Nenhuma imagem recebida.');

    let clientId = null;
    try {
      // Gera um CPF único automático se o campo estiver vazio
      const safeCpf = clientCpf && clientCpf.trim() !== ''
        ? clientCpf.trim()
        : `AUTO_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('cpf', safeCpf)
        .maybeSingle();

      if (existingClient) {
        clientId = existingClient.id;
        // Atualiza os dados do cliente existente com as novas informações da ingestão
        const { error: updateErr } = await supabase
          .from('clients')
          .update({ name: clientName, phone: clientPhone })
          .eq('id', clientId);
          
        if (updateErr) console.error('Erro ao atualizar cliente existente:', updateErr);
      } else {
        const { data: newClient, error: clientErr } = await supabase
          .from('clients')
          .insert({
            name: clientName,
            cpf: safeCpf,
            phone: clientPhone
          })
          .select('id')
          .single();

        if (clientErr) {
          console.error('Erro ao criar cliente:', clientErr);
        } else if (newClient) {
          clientId = newClient.id;
          console.log('Cliente criado com sucesso:', clientId);
        }
      }
    } catch (err) {
      console.warn('Erro ao processar cliente (Modo Offline)', err);
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

      // Inserção da sessão com vínculo de cliente e funcionário
      const { data: sessionData, error: sessionErr } = await supabase
        .from('photo_sessions')
        .insert({
          client_id: clientId,
          photographer_id: photographerId,
          status: 'Pendente',
          drive_status: 'pending',
          cover_photo_url: coverPhoto ? `file:///${coverPhoto.replace(/\\/g, '/').replace(/^\/+/, '')}` : null,
          local_cache_dir: clientCacheDir
        })
        .select('id, access_token')
        .single();

      if (sessionErr) {
        console.error('ERRO CRÍTICO AO CRIAR SESSÃO NO SUPABASE:', sessionErr);
      } else if (sessionData) {
        sessionId = sessionData.id;
        accessToken = sessionData.access_token;
      }
    } catch (err) {
      console.error('Falha geral no processo de sessão:', err);
    }

    let processedCount = 0;
    const processedPhotos = [];

    for (const imagePath of filePaths) {
      const { originalName, previewPath, localOriginalPath } = await processSingleImage(
        imagePath,
        tempOutputDir,
        watermarkPath,
        clientCacheDir,
        sessionId
      );

      const cleanPreview = previewPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const cleanOriginal = localOriginalPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const localPreviewUrl = `file:///${cleanPreview}`;
      const localOriginalUrl = `file:///${cleanOriginal}`;
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

      // O app Desktop SEMPRE consome o arquivo local do SSD (file://) com o ID real do banco
      processedPhotos.push({
        id: photoDbId || processedCount + 1,
        originalName,
        url: localPreviewUrl,
        localOriginalPath: localOriginalUrl,
        status: 'pending'
      });

      processedCount++;
      const currentProgress = (processedCount / filePaths.length) * 100;
      event.sender.send('upload-progress', currentProgress);
    }

    return { accessToken, sessionId: sessionId || Date.now(), clientName, processedPhotos };
  });

  ipcMain.handle('drive:uploadPurchased', async (event, payload) => {
    const { clientName, clientCpf, photos, parentFolderId, sessionId } = payload;

    try {
      const folderId = await createClientFolder(clientName, clientCpf, parentFolderId);

      let uploadedCount = 0;
      for (const photo of photos) {
        // Limpa o prefixo file:/// e DECODIFICA os espaços em branco (ex: %20 vira espaço)
        let filePath = decodeURIComponent(photo.local_original_path.replace(/^file:\/\/\//, ''));

        if (process.platform !== 'win32' && !filePath.startsWith('/')) {
          filePath = '/' + filePath;
        }

        // Upload físico da imagem 100% original sem nenhuma compressão
        await uploadPhoto(filePath, folderId, photo.original_name);
        uploadedCount++;

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

  // 1. Lista as impressoras instaladas no Windows
  ipcMain.handle('printer:getPrinters', async () => {
    if (!mainWindow) return [];
    return await mainWindow.webContents.getPrintersAsync();
  });

  // 2. Disparo silencioso de lote de fotos para o driver térmico
  ipcMain.handle('printer:printPhotos', async (_event, payload) => {
    const { photos, printerName } = payload;

    try {
      if (!photos || photos.length === 0) {
        return { success: false, count: 0, total: 0, printerUsed: null, message: 'Nenhuma foto recebida para impressão.' };
      }

      // Busca as impressoras instaladas no sistema operacional
      const printers = await mainWindow?.webContents.getPrintersAsync() || [];

      // No Electron 44 o tipo PrinterInfo NÃO tem `isDefault` (só name, displayName,
      // description, options). A impressora padrão do Windows vem dentro de `options`.
      const isOsDefaultPrinter = (p: PrinterInfo): boolean => {
        const opts = (p.options || {}) as Record<string, unknown>;
        const raw = opts.printerIsDefault ?? opts.default ?? opts['printer-is-default'];
        // O spooler do Windows devolve 'true' (string) em alguns drivers
        return raw === true || raw === 'true' || raw === 1 || raw === '1';
      };

      // Procura por DNP/RX1, pelo nome passado ou recorre à impressora padrão do Windows
      let targetPrinter = printerName
        ? printers.find(p => p.name.toLowerCase().includes(printerName.toLowerCase()))?.name
        : printers.find(p => p.name.toLowerCase().includes('dnp') || p.name.toLowerCase().includes('rx1'))?.name;

      if (!targetPrinter) {
        targetPrinter = printers.find(isOsDefaultPrinter)?.name;
      }

      // Sem impressora térmica identificada: falha de forma EXPLÍCITA.
      // Retornar success:true aqui fazia o PDV dizer "impresso" sem sair papel.
      if (!targetPrinter) {
        const available = printers.map(p => p.name).join(', ') || 'nenhuma';
        console.error(`[Impressão] Nenhuma impressora térmica (DNP/RX1) nem padrão encontrada. Disponíveis: ${available}`);
        return {
          success: false,
          count: 0,
          total: photos.length,
          printerUsed: null,
          message: `Nenhuma impressora térmica (DNP/RX1) encontrada no Windows. Impressoras detectadas: ${available}. Verifique o cabo USB e o driver.`
        };
      }

      let printedCount = 0;
      const failedPhotos: string[] = [];

      for (const photo of photos) {
        let rawPath = photo.local_original_path 
          ? decodeURIComponent(photo.local_original_path.replace(/^file:\/\/\//, ''))
          : '';
          
        if (process.platform !== 'win32' && rawPath && !rawPath.startsWith('/')) {
          rawPath = '/' + rawPath;
        }

        rawPath = path.normalize(rawPath);

        if (!fs.existsSync(rawPath)) {
          console.warn(`Arquivo não encontrado no SSD para impressão: ${rawPath}`);
          failedPhotos.push(photo.original_name);
          continue;
        }

        await new Promise<void>((resolve) => {
          let settled = false;
          const printWindow = new BrowserWindow({
            show: false,
            webPreferences: {
              webSecurity: false
            }
          });

          // Rede/disco travados não podem pendurar o lote inteiro no PDV.
          const watchdog = setTimeout(() => {
            if (settled) return;
            settled = true;
            console.error(`[Impressão] Timeout ao preparar ${photo.original_name}`);
            failedPhotos.push(photo.original_name);
            if (!printWindow.isDestroyed()) printWindow.close();
            resolve();
          }, 30_000);

          const finish = (ok: boolean, reason?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(watchdog);
            if (ok) {
              printedCount++;
            } else {
              console.warn(`Spooler rejeitou ${photo.original_name}:`, reason);
              failedPhotos.push(photo.original_name);
            }
            if (!printWindow.isDestroyed()) printWindow.close();
            resolve();
          };

          sharp(rawPath).metadata().then((meta) => {
            const isLandscape = (meta.width || 0) > (meta.height || 0);
            const fileUrl = 'file:///' + rawPath.replace(/\\/g, '/');

            // @page trava o papel em 10x15cm (4x6in), que é a mídia da DNP RX1.
            // Sem isso o Chromium usa Letter/A4 e o driver sublima a foto fora de escala.
            const htmlContent = `
              <!DOCTYPE html>
              <html>
                <head>
                  <style>
                    @page { size: 100mm 150mm; margin: 0; }
                    body, html { margin: 0; padding: 0; width: 100mm; height: 150mm; overflow: hidden; background: white; }
                    img { width: 100%; height: 100%; object-fit: contain; }
                  </style>
                </head>
                <body>
                  <img src="${fileUrl}" />
                </body>
              </html>
            `;

            printWindow.webContents.once('did-finish-load', () => {
              printWindow.webContents.print({
                silent: true,
                printBackground: true,
                deviceName: targetPrinter,
                landscape: isLandscape,
                margins: { marginType: 'none' }
              }, (success, failureReason) => {
                finish(success, failureReason);
              });
            });

            printWindow.webContents.once('did-fail-load', (_e, code, desc) => {
              finish(false, `Falha ao carregar a imagem (código ${code}): ${desc}`);
            });

            printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
          }).catch((err) => {
            finish(false, `Erro ao ler dimensões: ${(err as Error).message}`);
          });
        });
      }

      const allFailed = printedCount === 0;

      return {
        // Só reporta sucesso se pelo menos uma foto realmente entrou no spooler.
        success: !allFailed,
        count: printedCount,
        total: photos.length,
        printerUsed: targetPrinter,
        failedPhotos,
        message: allFailed
          ? `Nenhuma das ${photos.length} foto(s) foi aceita pelo spooler de [${targetPrinter}].`
          : (failedPhotos.length > 0
            ? `${printedCount} de ${photos.length} foto(s) enviada(s). Falharam: ${failedPhotos.join(', ')}.`
            : undefined)
      };
    } catch (err: any) {
      console.error('Erro crítico no spooler de impressão:', err);
      return {
        success: false,
        count: 0,
        total: photos?.length ?? 0,
        printerUsed: null,
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

    const watermarkPath = path.join(app.getAppPath(), 'src/assets/watermark_setland.png');
    const tempOutputDir = path.join(app.getPath('userData'), 'temp_previews');
    if (!fs.existsSync(tempOutputDir)) fs.mkdirSync(tempOutputDir, { recursive: true });

    const cacheBaseDir = path.join(app.getPath('userData'), 'Setland_Cache');
    const safeClientName = clientName ? clientName.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'cliente';
    const clientCacheDir = path.join(cacheBaseDir, `${safeClientName}_${sessionId.slice(0, 8)}`);
    if (!fs.existsSync(clientCacheDir)) fs.mkdirSync(clientCacheDir, { recursive: true });

    let processedCount = 0;
    const processedPhotos = [];

    for (const imagePath of filePaths) {
      const { originalName, previewPath, localOriginalPath } = await processSingleImage(
        imagePath,
        tempOutputDir,
        watermarkPath,
        clientCacheDir,
        sessionId
      );

      const cleanPreview = previewPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const cleanOriginal = localOriginalPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const localPreviewUrl = `file:///${cleanPreview}`;
      const localOriginalUrl = `file:///${cleanOriginal}`;
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
        url: localOriginalUrl,
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
      if (!localCacheDir) return { success: false, message: 'Caminho não informado.' }

      const normalizedPath = path.normalize(localCacheDir);

      // Trava de segurança: impede apagar fora de Setland_Cache.
      // path.relative (e não startsWith) para não aceitar "Setland_Cache_MALICIOSO".
      const expectedBase = path.normalize(getCacheBasePath());
      const relative = path.relative(expectedBase, normalizedPath);
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
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

  // Painel administrativo: quanto o cache local está ocupando e quanto já está seguro no Drive
  ipcMain.handle('storage:getCacheUsage', async () => {
    try {
      const { totalBytes, syncedBytes, pendingBytes, sessions } = await scanLocalCache();
      return {
        success: true,
        cachePath: getCacheBasePath(),
        totalBytes,
        syncedBytes,
        pendingBytes,
        sessionCount: sessions.length,
        syncedSessionCount: sessions.filter(s => s.driveStatus === 'synced').length
      };
    } catch (err: any) {
      console.error('[Disco Local] Erro ao medir o cache:', err);
      return { success: false, error: err.message };
    }
  });

  /**
   * Libera espaço no SSD apagando SOMENTE o que já foi entregue no Google Drive.
   * Sessões 'pending'/'error' são preservadas: apagar isso seria prejuízo real
   * (o cliente pagou e as fotos originais deixariam de existir).
   */
  ipcMain.handle('storage:cleanSyncedCache', async () => {
    try {
      const { sessions } = await scanLocalCache();
      const candidates = sessions.filter(s => s.driveStatus === 'synced');

      let removedCount = 0;
      let freedBytes = 0;
      const failures: string[] = [];

      for (const session of candidates) {
        try {
          fs.rmSync(session.dir, { recursive: true, force: true });
          removedCount++;
          freedBytes += session.bytes;
        } catch (err: any) {
          console.error(`[Disco Local] Falha ao remover ${session.dir}:`, err);
          failures.push(session.dir);
        }
      }

      console.log(`[Disco Local] Limpeza concluída: ${removedCount} pasta(s), ${(freedBytes / 1024 / 1024).toFixed(1)} MB liberados.`);
      return {
        success: true,
        removedCount,
        freedBytes,
        preservedCount: sessions.length - candidates.length,
        failures
      };
    } catch (err: any) {
      console.error('[Disco Local] Erro na limpeza do cache:', err);
      return { success: false, error: err.message };
    }
  });
});
