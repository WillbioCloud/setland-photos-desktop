import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Função para processar uma única imagem
export async function processSingleImage(
  inputPath: string, 
  outputDir: string, 
  watermarkPath: string,
  localCacheDir: string,
  sessionId: string | null
): Promise<{ originalName: string, previewPath: string, localOriginalPath: string, imageBuffer: Buffer }> {
  
  const fileName = path.basename(inputPath);
  const previewPath = path.join(outputDir, 'preview_' + fileName.replace(/\.[^/.]+$/, "") + '.webp');
  
  const originalDestPath = path.join(localCacheDir, fileName);
  fs.copyFileSync(inputPath, originalDestPath);

  // 1. Redimensiona a miniatura para padrão vitrine web leve (máx 1280px)
  const { data: baseBuffer, info } = await sharp(inputPath)
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const width = info.width;

  // 2. Prepara o selo da marca d'água proporcional (~25% da largura da imagem)
  const watermarkWidth = Math.max(160, Math.min(260, Math.floor(width * 0.25)));
  
  // Aplica transparência visível de ~55% (canal alpha 140) com borda preservada
  const singleWatermark = await sharp(watermarkPath)
    .resize(watermarkWidth, null, { fit: 'inside' })
    .ensureAlpha()
    .composite([
      {
        input: Buffer.from([255, 255, 255, 140]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in'
      }
    ])
    .png()
    .toBuffer();

  // 3. Ladrilha o mosaico de marca d'água diretamente sobre a foto inteira
  const imageBuffer = await sharp(baseBuffer)
    .composite([
      {
        input: singleWatermark,
        tile: true,
        blend: 'over'
      }
    ])
    .webp({ quality: 72, effort: 4 })
    .toBuffer();

  // Salva no cache local temporario
  fs.writeFileSync(previewPath, imageBuffer);

  return { originalName: fileName, previewPath, localOriginalPath: originalDestPath, imageBuffer };
}