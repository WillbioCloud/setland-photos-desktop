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

  // A pasta temp_previews é COMPARTILHADA entre todas as sessões. Sem isolar por
  // sessão, duas fotos com o mesmo nome de câmera (DSC_0001.jpg é o caso clássico,
  // pois as câmeras reiniciam a numeração) sobrescreviam a miniatura uma da outra:
  // o cliente A passava a ver/receber a foto do cliente B.
  const previewDir = sessionId
    ? path.join(outputDir, String(sessionId))
    : outputDir;

  if (!fs.existsSync(previewDir)) {
    fs.mkdirSync(previewDir, { recursive: true });
  }

  const previewPath = path.join(previewDir, 'preview_' + fileName.replace(/\.[^/.]+$/, "") + '.webp');
  
  const originalDestPath = path.join(localCacheDir, fileName);
  fs.copyFileSync(inputPath, originalDestPath);

  // 1. Redimensiona a foto primeiro e extrai as dimensoes reais resultantes
  const { data: baseBuffer, info } = await sharp(inputPath)
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;

  // 2. Garante que o bloco da marca d'agua seja menor que a largura e altura da imagem
  const maxWatermarkDim = Math.min(180, Math.floor(width * 0.25), Math.floor(height * 0.25));
  const singleWatermark = await sharp(watermarkPath)
    .resize(maxWatermarkDim, maxWatermarkDim, { fit: 'inside' })
    .composite([
      {
        input: Buffer.from([255, 255, 255, 77]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in'
      }
    ])
    .toBuffer();

  // 3. Cria o canvas do tamanho exato da foto reduzida e repete o mosaico
  const tiledWatermark = await sharp({
    create: {
      width: width,
      height: height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
  .composite([
    {
      input: singleWatermark,
      tile: true,
      blend: 'over'
    }
  ])
  .png()
  .toBuffer();

  // 4. Sobrepoe o mosaico de dimensoes identicas e gera o WebP final
  const imageBuffer = await sharp(baseBuffer)
    .composite([
      {
        input: tiledWatermark,
        blend: 'over'
      }
    ])
    .webp({ quality: 75, effort: 4 })
    .toBuffer();

  // Salva no cache local temporario
  fs.writeFileSync(previewPath, imageBuffer);

  return { originalName: fileName, previewPath, localOriginalPath: originalDestPath, imageBuffer };
}