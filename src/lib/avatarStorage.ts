import { supabase } from '@/lib/supabaseClient';

/**
 * Redimensiona a imagem para um corte quadrado centralizado (maxSize x maxSize)
 * e comprime para o formato WebP leve (~10KB a 20KB).
 */
export async function compressImageToWebP(
  file: File,
  maxSize = 256,
  quality = 0.78
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Erro ao ler arquivo de imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Erro ao carregar elemento de imagem.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Não foi possível obter contexto 2D do canvas.'));
          return;
        }

        // Crop central quadrado mantendo a proporção
        const minSide = Math.min(img.width, img.height);
        const startX = (img.width - minSide) / 2;
        const startY = (img.height - minSide) / 2;

        ctx.drawImage(img, startX, startY, minSide, minSide, 0, 0, maxSize, maxSize);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Falha ao exportar blob WebP do canvas.'));
            }
          },
          'image/webp',
          quality
        );
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Comprime a foto de perfil para WebP e envia para o bucket 'photos' do Supabase Storage.
 * Retorna a URL pública pronta para salvar em employees.avatar_url.
 */
export async function uploadEmployeeAvatar(
  file: File,
  employeeIdOrTemp: string
): Promise<string> {
  const blob = await compressImageToWebP(file);
  const cleanId = String(employeeIdOrTemp).replace(/[^a-zA-Z0-9_-]/g, '') || 'temp';
  const filePath = `avatars/emp_${cleanId}_${Date.now()}.webp`;

  const { error: uploadError } = await supabase.storage
    .from('photos')
    .upload(filePath, blob, {
      contentType: 'image/webp',
      upsert: true,
    });

  if (uploadError) {
    console.error('[avatarStorage] Erro no upload:', uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from('photos').getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Exclui fisicamente o arquivo de avatar do Supabase Storage caso pertença ao bucket 'photos'.
 * Ignora URLs de serviços externos como ui-avatars.com ou blobs data:URL.
 */
export async function deleteEmployeeAvatarFromStorage(
  avatarUrl?: string | null
): Promise<void> {
  if (!avatarUrl) return;

  // Ignora geradores de avatar ou dados locais
  if (avatarUrl.includes('ui-avatars.com') || avatarUrl.startsWith('data:')) {
    return;
  }

  try {
    let relativePath = '';
    const marker = '/storage/v1/object/public/photos/';

    if (avatarUrl.includes(marker)) {
      relativePath = avatarUrl.split(marker)[1]?.split('?')[0] || '';
    } else if (avatarUrl.startsWith('avatars/')) {
      relativePath = avatarUrl.split('?')[0];
    }

    if (relativePath) {
      const decodedPath = decodeURIComponent(relativePath);
      const { error } = await supabase.storage.from('photos').remove([decodedPath]);
      if (error) {
        console.warn('[avatarStorage] Falha ao excluir arquivo no storage:', error);
      }
    }
  } catch (err) {
    console.warn('[avatarStorage] Erro ao tentar excluir avatar antigo:', err);
  }
}
