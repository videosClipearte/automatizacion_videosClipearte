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
  maxFrames: number = 7,
  maxDimension: number = 512
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
      reject(new Error('Tiempo de espera agotado al cargar el video para compresión.'));
    }, 20000);

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
          clearTimeout(timeoutId);
          return reject(new Error('No se pudo inicializar el contexto Canvas 2D.'));
        }

        // Determinar marcas de tiempo clave (distribuidas a lo largo del video)
        // Ejemplo: 5%, 20%, 35%, 50%, 65%, 80%, 95%
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
          // Calidad 0.70 JPEG para mantener nitidez de texto y detalles visuales con peso mínimo
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          const cleanBase64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
          framesBase64.push(cleanBase64);
          totalBytes += cleanBase64.length;
        }

        clearTimeout(timeoutId);
        URL.revokeObjectURL(fileUrl);

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
