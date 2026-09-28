// src/lib/services/videoAudioExtractorService.ts
// Extrae el audio del video en el navegador usando AudioContext + MediaRecorder.
// Sin reproduccion por altavoces. Captura los primeros N segundos de audio
// para enviarlo a Gemini como texto + reglas de campana.

export interface VideoAudioPayload {
  audioBase64: string;
  mimeType: string;
  durationSeconds: number;
  originalFileSizeBytes: number;
}

/**
 * Extrae el audio de un archivo de video de forma silenciosa en el navegador.
 * Captura los primeros `maxDurationSeconds` segundos del audio.
 * Devuelve null si el navegador no soporta la API o no hay pista de audio.
 */
export async function extractAudioFromVideo(
  file: File,
  maxDurationSeconds: number = 25
): Promise<VideoAudioPayload | null> {
  if (typeof window === 'undefined') return null;
  if (!window.AudioContext && !(window as any).webkitAudioContext) return null;
  if (typeof MediaRecorder === 'undefined') return null;

  return new Promise((resolve) => {
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);
    videoEl.src = objectUrl;

    const cleanup = (audioCtx?: AudioContext) => {
      URL.revokeObjectURL(objectUrl);
      videoEl.pause();
      videoEl.src = '';
      audioCtx?.close().catch(() => {});
    };

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 60_000);

    videoEl.onloadedmetadata = async () => {
      const rawDuration = isFinite(videoEl.duration) ? videoEl.duration : 30;
      const captureDuration = Math.min(rawDuration, maxDurationSeconds);

      let audioCtx: AudioContext | undefined;
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioCtx();

        const source = audioCtx.createMediaElementSource(videoEl);
        const destination = audioCtx.createMediaStreamDestination();
        // Solo al destino MediaStream, NO a los altavoces
        source.connect(destination);

        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
          .find((m) => MediaRecorder.isTypeSupported(m)) || 'audio/webm';

        const recorder = new MediaRecorder(destination.stream, { mimeType });
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = async () => {
          clearTimeout(timeoutId);
          cleanup(audioCtx);

          if (chunks.length === 0) { resolve(null); return; }

          try {
            const blob = new Blob(chunks, { type: mimeType });
            const arrayBuffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            let binary = '';
            const CHUNK = 8192;
            for (let i = 0; i < bytes.length; i += CHUNK) {
              binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
            }
            const audioBase64 = btoa(binary);

            resolve({
              audioBase64,
              mimeType: 'audio/webm',
              durationSeconds: Math.round(captureDuration),
              originalFileSizeBytes: file.size,
            });
          } catch {
            resolve(null);
          }
        };

        recorder.onerror = () => {
          clearTimeout(timeoutId);
          cleanup(audioCtx);
          resolve(null);
        };

        recorder.start(250);
        videoEl.play().catch(() => {});

        const stopTimer = setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
          videoEl.pause();
        }, captureDuration * 1000 + 500);

        videoEl.onended = () => {
          clearTimeout(stopTimer);
          if (recorder.state !== 'inactive') recorder.stop();
        };

      } catch (err) {
        clearTimeout(timeoutId);
        cleanup(audioCtx);
        console.warn('[AudioExtractor] Error al capturar audio:', err);
        resolve(null);
      }
    };

    videoEl.onerror = () => {
      clearTimeout(timeoutId);
      cleanup();
      resolve(null);
    };
  });
}
