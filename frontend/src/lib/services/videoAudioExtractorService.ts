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
 * Garantiza la liberación total de recursos (MediaStreamTracks, decodificadores y AudioContext).
 */
export async function extractAudioFromVideo(
  file: File,
  maxDurationSeconds: number = 5
): Promise<VideoAudioPayload | null> {
  if (typeof window === 'undefined') return null;
  if (!window.AudioContext && !(window as any).webkitAudioContext) return null;
  if (typeof MediaRecorder === 'undefined') return null;

  return new Promise((resolve) => {
    const videoEl = document.createElement('video');
    videoEl.preload = 'metadata';
    videoEl.style.display = 'none';
    const objectUrl = URL.createObjectURL(file);
    videoEl.src = objectUrl;

    let audioCtx: AudioContext | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    let destination: MediaStreamAudioDestinationNode | null = null;
    let recorder: MediaRecorder | null = null;
    let stopTimer: any = null;
    let timeoutId: any = null;
    let isCleanedUp = false;

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;

      clearTimeout(timeoutId);
      clearTimeout(stopTimer);

      // 1. Detener MediaRecorder
      try {
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
      } catch {}

      // 2. DETENER TODAS LAS PISTAS del MediaStream (CRÍTICO: Libera hilos nativos de audio en el navegador)
      try {
        if (destination?.stream) {
          destination.stream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch {}
          });
        }
      } catch {}

      // 3. Desconectar nodos Web Audio
      try {
        source?.disconnect();
      } catch {}
      try {
        destination?.disconnect();
      } catch {}

      // 4. Cerrar AudioContext
      try {
        if (audioCtx && audioCtx.state !== 'closed') {
          audioCtx.close().catch(() => {});
        }
      } catch {}

      // 5. Destruir elemento de video y liberar decodificadores de hardware
      try {
        videoEl.pause();
        videoEl.removeAttribute('src');
        videoEl.srcObject = null;
        videoEl.src = '';
        videoEl.load();
        URL.revokeObjectURL(objectUrl);
      } catch {}
    };

    timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 15_000);

    videoEl.onloadedmetadata = async () => {
      const rawDuration = isFinite(videoEl.duration) ? videoEl.duration : 20;
      const captureDuration = Math.min(rawDuration, maxDurationSeconds);

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioCtx();

        source = audioCtx.createMediaElementSource(videoEl);
        destination = audioCtx.createMediaStreamDestination();
        // Conexión exclusiva al MediaStream de captura (NO a los altavoces de audioCtx.destination)
        source.connect(destination);

        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
          .find((m) => MediaRecorder.isTypeSupported(m)) || 'audio/webm';

        recorder = new MediaRecorder(destination.stream, { mimeType });
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          // Liberar inmediatamente decodificadores y pistas de audio
          cleanup();

          if (chunks.length === 0) {
            resolve(null);
            return;
          }

          try {
            const blob = new Blob(chunks, { type: mimeType });
            const reader = new FileReader();
            reader.onloadend = () => {
              const resultStr = (reader.result as string) || '';
              const audioBase64 = resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;
              resolve({
                audioBase64,
                mimeType: 'audio/webm',
                durationSeconds: Math.round(captureDuration),
                originalFileSizeBytes: file.size,
              });
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          } catch {
            resolve(null);
          }
        };

        recorder.onerror = () => {
          cleanup();
          resolve(null);
        };

        recorder.start(250);
        videoEl.play().catch(() => {});

        stopTimer = setTimeout(() => {
          if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
          } else {
            cleanup();
            resolve(null);
          }
        }, captureDuration * 1000 + 400);

        videoEl.onended = () => {
          clearTimeout(stopTimer);
          if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
          }
        };

      } catch (err) {
        cleanup();
        console.warn('[AudioExtractor] Error al capturar audio:', err);
        resolve(null);
      }
    };

    videoEl.onerror = () => {
      cleanup();
      resolve(null);
    };
  });
}
