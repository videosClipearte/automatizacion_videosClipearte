// src/lib/services/videoCompressorService.ts
// Compresor y extractor de fotogramas clave en el navegador para análisis visual con Google Gemini IA.
// Mantiene el archivo original en máxima calidad para Google Drive y genera un proxy ultraligero
// de fotogramas secuenciales optimizados (~150-350 KB) que Gemini analiza en 2-4 segundos.

export interface VideoAnalysisPayload {
  frames: string[]; // Array de strings base64 limpios (formato JPEG)
  durationSeconds: number;
  width: number;
  height: number;
  aspectRatio: string;
  totalPayloadBytes: number;
  originalFileSizeBytes: number;
}

/**
 * Extrae una secuencia cronológica de fotogramas optimizados desde cualquier archivo de video (MP4/WebM/MOV)
 * de forma 100% silenciosa en segundo plano usando Canvas y Video element del navegador.
 */
export async function extractVideoStoryboard(
  file: File,
  maxFrames: number = 4,
  maxDimension: number = 256
): Promise<VideoAnalysisPayload> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      return reject(new Error('La extracción de video solo está disponible en el navegador.'));
    }

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const fileUrl = URL.createObjectURL(file);
    video.src = fileUrl;

    const timeoutId = setTimeout(() => {
      URL.revokeObjectURL(fileUrl);
      video.pause();
      video.removeAttribute('src');
      reject(new Error('Tiempo de espera agotado al cargar el video para compresión.'));
    }, 15000);

    video.onloadedmetadata = async () => {
      try {
        const duration = video.duration || 10;
        const origWidth = video.videoWidth || 640;
        const origHeight = video.videoHeight || 360;

        // Calcular dimensiones escaladas respetando la relación de aspecto
        let targetWidth = origWidth;
        let targetHeight = origHeight;

        if (origWidth > maxDimension || origHeight > maxDimension) {
          if (origWidth >= origHeight) {
            targetWidth = maxDimension;
            targetHeight = Math.round((origHeight / origWidth) * maxDimension);
          } else {
            targetHeight = maxDimension;
            targetWidth = Math.round((origWidth / origHeight) * maxDimension);
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          URL.revokeObjectURL(fileUrl);
          video.pause();
          video.removeAttribute('src');
          clearTimeout(timeoutId);
          return reject(new Error('No se pudo inicializar el contexto Canvas 2D.'));
        }

        // Determinar marcas de tiempo clave (distribuidas a lo largo del video)
        const timestamps: number[] = [];
        for (let i = 0; i < maxFrames; i++) {
          const ratio = (i + 0.5) / maxFrames;
          timestamps.push(Math.max(0.5, Math.min(duration - 0.5, duration * ratio)));
        }

        const framesBase64: string[] = [];
        let totalBytes = 0;

        // Función secuencial para buscar y capturar cada fotograma
        for (const time of timestamps) {
          await seekToTime(video, time);
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          // Calidad 0.65 JPEG para un peso ultraligero (~15-20 KB por frame)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          const cleanBase64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
          framesBase64.push(cleanBase64);
          totalBytes += cleanBase64.length;
        }

        clearTimeout(timeoutId);
        URL.revokeObjectURL(fileUrl);
        video.pause();
        video.removeAttribute('src');
        video.load();
        canvas.width = 0;
        canvas.height = 0;

        const aspectRatio = origWidth > origHeight ? '16:9' : origWidth < origHeight ? '9:16' : '1:1';

        resolve({
          frames: framesBase64,
          durationSeconds: Math.round(duration),
          width: targetWidth,
          height: targetHeight,
          aspectRatio,
          totalPayloadBytes: Math.round(totalBytes * 0.75), // Tamaño binario aproximado
          originalFileSizeBytes: file.size,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(fileUrl);
        video.pause();
        video.removeAttribute('src');
        video.load();
        reject(err);
      }
    };

    video.onerror = () => {
      clearTimeout(timeoutId);
      URL.revokeObjectURL(fileUrl);
      reject(new Error('No se pudo leer el archivo de video en el navegador.'));
    };
  });
}

function seekToTime(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const handleSeeked = () => {
      video.removeEventListener('seeked', handleSeeked);
      resolve();
    };
    video.addEventListener('seeked', handleSeeked);
    video.currentTime = time;
  });
}

export interface VideoCompressionResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  savedBytes: number;
  savedPercent: number;
  method: 'api-ffmpeg-crf18' | 'wasm-ffmpeg-crf18' | 'mp4-trim' | 'original';
}

/**
 * Elimina de forma 100% lossless (bit-exact) bloques de relleno ('free', 'skip', 'wide', 'uuid')
 * ubicados DESPUÉS de 'mdat' y 'moov', sin alterar jamás los offsets de 'stco'/'co64'.
 */
export function stripTrailingMp4Padding(buffer: Uint8Array): Uint8Array {
  try {
    if (buffer.byteLength < 32) return buffer;
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    let offset = 0;
    let lastEssentialEnd = buffer.byteLength;
    let sawMoov = false;
    let sawMdat = false;
    const droppableAfterMedia = new Set(['free', 'skip', 'wide', 'uuid']);

    const boxes: { type: string; start: number; end: number }[] = [];
    while (offset + 8 <= buffer.byteLength) {
      let size = view.getUint32(offset, false);
      const type = String.fromCharCode(
        buffer[offset + 4],
        buffer[offset + 5],
        buffer[offset + 6],
        buffer[offset + 7]
      );
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > buffer.byteLength) break;
        const high = view.getUint32(offset + 8, false);
        const low = view.getUint32(offset + 12, false);
        size = high * 4294967296 + low;
        headerSize = 16;
      } else if (size === 0) {
        size = buffer.byteLength - offset;
      }
      if (size < headerSize || offset + size > buffer.byteLength) break;
      boxes.push({ type, start: offset, end: offset + size });
      offset += size;
    }

    if (boxes.length === 0 || offset !== buffer.byteLength) return buffer;

    for (const b of boxes) {
      if (b.type === 'moov') sawMoov = true;
      if (b.type === 'mdat') sawMdat = true;
    }
    if (!sawMoov || !sawMdat) return buffer;

    // Recortar únicamente cajas de relleno al final del archivo (después de moov y mdat)
    let trimEnd = buffer.byteLength;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (droppableAfterMedia.has(b.type)) {
        trimEnd = b.start;
      } else {
        break;
      }
    }
    lastEssentialEnd = trimEnd;

    if (lastEssentialEnd > 0 && lastEssentialEnd < buffer.byteLength) {
      return buffer.subarray(0, lastEssentialEnd);
    }
    return buffer;
  } catch {
    return buffer;
  }
}

/**
 * Comprime un archivo de video en segundo plano y en cuestión de segundos ANTES de subirlo a Google Drive,
 * sin perder calidad visual:
 * 1. Envía el video a la API `/api/video/compress` (FFmpeg `-preset ultrafast -crf 18 -c:a copy`, límite 15 s).
 * 2. Si el entorno no dispone de binario FFmpeg o excede el tiempo rápido, aplica optimización lossless
 *    instantánea de contenedor MP4/MOV (`stripTrailingMp4Padding`).
 * 3. Si el resultado no es más liviano que el original, devuelve el archivo original intacto.
 */
export async function compressVideoForStorage(
  file: File
): Promise<VideoCompressionResult> {
  const originalBytes = file.size;

  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|avi)$/i.test(file.name)) {
    return {
      file,
      originalBytes,
      compressedBytes: originalBytes,
      savedBytes: 0,
      savedPercent: 0,
      method: 'original',
    };
  }

  if (originalBytes < 512 * 1024) {
    return {
      file,
      originalBytes,
      compressedBytes: originalBytes,
      savedBytes: 0,
      savedPercent: 0,
      method: 'original',
    };
  }

  // 1. Compresión rápida en segundo plano vía API `/api/video/compress` (máx. 15 segundos)
  if (typeof window !== 'undefined') {
    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    const maxApiBytes = isLocalhost ? 500 * 1024 * 1024 : 4.2 * 1024 * 1024;

    if (originalBytes <= maxApiBytes) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const form = new FormData();
        form.append('file', file);

        const res = await fetch('/api/video/compress', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const methodHeader = res.headers.get('X-Compression-Method') || 'original';
          const blob = await res.blob();

          if (blob.size > 1024 && blob.size < originalBytes) {
            const compressedFile = new File([blob], file.name, {
              type: blob.type || file.type || 'video/mp4',
              lastModified: Date.now(),
            });
            const savedBytes = originalBytes - compressedFile.size;
            const savedPercent = Math.round((savedBytes / originalBytes) * 100);
            console.log(
              `[videoCompressor] ✅ Video comprimido en segundo plano (${methodHeader}): ${(originalBytes / 1048576).toFixed(2)} MB → ${(compressedFile.size / 1048576).toFixed(2)} MB (-${savedPercent}%)`
            );
            return {
              file: compressedFile,
              originalBytes,
              compressedBytes: compressedFile.size,
              savedBytes,
              savedPercent,
              method: methodHeader === 'ffmpeg-crf18' ? 'api-ffmpeg-crf18' : 'mp4-trim',
            };
          }
        }
      } catch (apiErr) {
        clearTimeout(timeoutId);
        console.warn('[videoCompressor] Compresión API omitida o excedió tiempo rápido, usando optimización instantánea:', apiErr);
      }
    }
  }

  // 2. Respaldo lossless instantáneo (< 5 ms) de recorte de relleno MP4
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    const trimmed = stripTrailingMp4Padding(raw);
    if (trimmed.byteLength < originalBytes && trimmed.byteLength > 1024) {
      const trimmedFile = new File([trimmed.slice()], file.name, {
        type: file.type || 'video/mp4',
        lastModified: Date.now(),
      });
      const savedBytes = originalBytes - trimmedFile.size;
      const savedPercent = Math.round((savedBytes / originalBytes) * 100);
      return {
        file: trimmedFile,
        originalBytes,
        compressedBytes: trimmedFile.size,
        savedBytes,
        savedPercent,
        method: 'mp4-trim',
      };
    }
  } catch {}

  return {
    file,
    originalBytes,
    compressedBytes: originalBytes,
    savedBytes: 0,
    savedPercent: 0,
    method: 'original',
  };
}
