// src/lib/services/driveService.ts
import { useAppStore } from '@/store/useAppStore';
import { createNotification } from './notificationService';

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  folderId: string;
  autoDownload: boolean;
  autoDeleteAfterVerify: boolean; // Eliminar video en Drive tras verificación y aviso
  retentionHours: number; // 0 = Inmediato, 6, 24, 72, 168 (7 días), -1 = Nunca
}

const STORAGE_KEY = 'autopublish_drive_config';
const TOKEN_KEY = 'google_drive_access_token';
const TOKEN_EXP_KEY = 'google_drive_token_expires_at';

export function getStoredDriveConfig(): DriveConfig {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return {
          clientId: parsed.clientId || '',
          clientSecret: parsed.clientSecret || '',
          folderId: parsed.folderId || '',
          autoDownload: parsed.autoDownload ?? true,
          autoDeleteAfterVerify: parsed.autoDeleteAfterVerify ?? false,
          retentionHours: parsed.retentionHours ?? 24,
        };
      } catch (e) {
        console.error('Error parsing drive config', e);
      }
    }
  }
  return {
    clientId: '',
    clientSecret: '',
    folderId: '',
    autoDownload: true,
    autoDeleteAfterVerify: false,
    retentionHours: 24,
  };
}

export function saveStoredDriveConfig(config: DriveConfig): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}

/**
 * Obtiene el token de acceso OAuth 2.0 guardado si aún no ha expirado
 */
export function getGoogleDriveToken(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(TOKEN_KEY);
  const exp = localStorage.getItem(TOKEN_EXP_KEY);
  if (!token) return null;
  if (exp && Date.now() > Number(exp)) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
    return null;
  }
  return token;
}

/**
 * Guarda el token de acceso OAuth 2.0 con tiempo de expiración
 */
export function saveGoogleDriveToken(token: string, expiresInSeconds: number = 3600): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + (expiresInSeconds - 60) * 1000));
}

/**
 * Carga el script de Google Identity Services (GIS) si no está presente
 */
export function loadGoogleGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve();
    if ((window as any).google?.accounts?.oauth2) {
      return resolve();
    }
    const existing = document.getElementById('google-gsi-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) => reject(e));
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(new Error('No se pudo cargar la librería de autenticación de Google.'));
    document.body.appendChild(script);
  });
}

/**
 * Solicita autorización del usuario para Google Drive mediante OAuth 2.0 GIS
 */
export async function requestGoogleDriveOAuthToken(
  clientId: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const cleanClientId = clientId.trim();
    if (!cleanClientId) {
      return { success: false, error: 'Debes configurar el Client ID de Google en Settings → Integraciones.' };
    }

    await loadGoogleGsiScript();

    return new Promise((resolve) => {
      try {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: cleanClientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          include_granted_scopes: false,
          prompt: 'consent',
          callback: (response: any) => {
            if (response.error) {
              resolve({
                success: false,
                error: `Error de Google OAuth: ${response.error_description || response.error}`,
              });
            } else if (response.access_token) {
              const expiresIn = response.expires_in ? Number(response.expires_in) : 3600;
              saveGoogleDriveToken(response.access_token, expiresIn);
              resolve({ success: true, token: response.access_token });
            } else {
              resolve({ success: false, error: 'Respuesta sin token de acceso de Google.' });
            }
          },
          error_callback: (err: any) => {
            resolve({ success: false, error: `Error en ventana de Google: ${err?.message || err}` });
          },
        });

        // Solicita el token abriendo el popup de consentimiento
        client.requestAccessToken({ prompt: 'consent' });
      } catch (err: any) {
        resolve({ success: false, error: `Error inicializando cliente OAuth: ${err?.message || err}` });
      }
    });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Error al conectar con Google Drive' };
  }
}

export interface PendingDriveUploadItem {
  videoId: string;
  file: File;
  folderId: string;
  thumbFile?: File | null;
  videoTitle: string;
  attempts: number;
}

// Almacenamiento en memoria de archivos pendientes/fallidos para reintento automático
const pendingDriveUploadsMap = new Map<string, PendingDriveUploadItem>();

export function registerPendingDriveUpload(videoId: string, item: Omit<PendingDriveUploadItem, 'attempts'>): void {
  pendingDriveUploadsMap.set(videoId, { ...item, attempts: 0 });
}

export function unregisterPendingDriveUpload(videoId: string): void {
  pendingDriveUploadsMap.delete(videoId);
}

export function getPendingDriveUpload(videoId: string): PendingDriveUploadItem | undefined {
  return pendingDriveUploadsMap.get(videoId);
}

/**
 * Función interna de subida en un solo intento vía REST API v3
 */
function uploadSingleAttempt(
  file: File,
  folderId: string,
  accessToken: string,
  onProgress?: (progressPercent: number) => void,
  customFileName?: string
): Promise<{ success: boolean; fileId?: string; fileUrl?: string; error?: string }> {
  const cleanFolderId = folderId.trim();
  const extension = file.name.includes('.') ? file.name.substring(file.name.lastIndexOf('.')) : '.mp4';
  const resolvedName = customFileName && customFileName.trim()
    ? (customFileName.trim().endsWith(extension) ? customFileName.trim() : `${customFileName.trim()}${extension}`)
    : file.name;

  const metadata: Record<string, any> = {
    name: resolvedName,
    mimeType: file.type || 'video/mp4',
  };

  if (cleanFolderId && cleanFolderId !== '#' && cleanFolderId.length > 5) {
    metadata.parents = [cleanFolderId];
  }

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink'
    );
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken.trim()}`);

    if (xhr.upload && onProgress) {
      let lastPct = -1;
      let lastTime = 0;

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const pct = Math.round((evt.loaded / evt.total) * 100);
          const now = Date.now();
          // Throttling: emitir al 100% o si pasaron al menos 300ms y el porcentaje varió
          if (pct === 100 || (pct !== lastPct && now - lastTime >= 1000)) {
            lastPct = pct;
            lastTime = now;
            onProgress(pct);
          }
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          const fileUrl = resp.webViewLink || `https://drive.google.com/file/d/${resp.id}/view`;
          resolve({ success: true, fileId: resp.id, fileUrl });
        } catch {
          resolve({ success: true, fileId: 'uploaded', fileUrl: 'https://drive.google.com' });
        }
      } else {
        try {
          const errJson = JSON.parse(xhr.responseText);
          resolve({
            success: false,
            error: errJson.error?.message || `Error HTTP ${xhr.status} de Google Drive`,
          });
        } catch {
          resolve({
            success: false,
            error: `Error HTTP ${xhr.status} al subir a Google Drive: ${xhr.statusText}`,
          });
        }
      }
    };

    xhr.onerror = () => {
      resolve({ success: false, error: 'Error de red o conexión al subir el video a Google Drive.' });
    };

    xhr.send(form);
  });
}

/**
 * Sube un archivo de video a Google Drive con REINTENTO AUTOMÁTICO (hasta 3 intentos)
 */
export async function uploadVideoToGoogleDrive(
  file: File,
  folderId: string,
  accessToken: string,
  onProgress?: (progressPercent: number) => void,
  maxAttempts = 3,
  customFileName?: string
): Promise<{ success: boolean; fileId?: string; fileUrl?: string; error?: string }> {
  let lastError = 'Fallo desconocido al subir a Drive';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[DriveService] Reintentando subida de "${file.name}" a Google Drive (intento ${attempt}/${maxAttempts})...`);
        // Pausa exponencial entre reintentos (2s, 4s)
        await new Promise((r) => setTimeout(r, attempt * 2000));
      }

      const res = await uploadSingleAttempt(file, folderId, accessToken, onProgress, customFileName);
      if (res.success) {
        return res;
      }
      lastError = res.error || lastError;
      console.warn(`[DriveService] Intento ${attempt}/${maxAttempts} falló para "${file.name}": ${lastError}`);
    } catch (err: any) {
      lastError = err?.message || lastError;
      console.warn(`[DriveService] Excepción en intento ${attempt}/${maxAttempts}: ${lastError}`);
    }
  }

  return {
    success: false,
    error: `No se pudo subir a Google Drive tras ${maxAttempts} intentos: ${lastError}`,
  };
}

/**
 * Verifica el acceso a la carpeta de Google Drive
 */
export async function verifyDriveFolderAccess(
  folderId: string,
  clientId?: string,
  accessToken?: string
): Promise<{ success: boolean; message: string }> {
  const cleanFolderId = (folderId || '').trim();
  if (!cleanFolderId || cleanFolderId.length < 5) {
    return { success: false, message: 'El ID de la carpeta de Google Drive es inválido o está vacío.' };
  }

  const token = accessToken || getGoogleDriveToken();
  if (!token) {
    return {
      success: true,
      message: `ID de carpeta "${cleanFolderId}" configurado. Haz clic en "Conectar Google Drive" para autorizar la subida de videos.`,
    };
  }

  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${cleanFolderId}?fields=id,name,mimeType`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();
      return {
        success: true,
        message: `✅ Carpeta "${data.name || cleanFolderId}" verificada con éxito en Google Drive. Subidas habilitadas.`,
      };
    } else {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        message: `Google Drive respondió: ${err?.error?.message || `HTTP ${res.status}`}. Verifica el ID de la carpeta o re-conecta tu cuenta.`,
      };
    }
  } catch (e: any) {
    return {
      success: false,
      message: `No se pudo conectar con la API de Drive: ${e?.message || 'Error de red'}`,
    };
  }
}

export interface StartBackgroundUploadParams {
  videoId: string;
  videoTitle: string;
  customFileName?: string;
  file: File;
  thumbFile?: File | null;
  folderId: string;
  token: string;
  cuentaId?: string;
  oldDriveUrl?: string;
}

/**
 * Extrae el identificador único (File ID) de un archivo en Google Drive
 * a partir de su URL (/file/d/..., ?id=...) o directamente el ID.
 */
export function extractDriveFileId(urlOrId: string): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();
  if (trimmed === '#' || trimmed.length < 5) return null;

  // Formato /file/d/ID/view o /file/d/ID
  const matchView = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchView && matchView[1]) {
    return matchView[1];
  }

  // Formato /open?id=ID o ?id=ID o &id=ID
  const matchId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId && matchId[1]) {
    return matchId[1];
  }

  // Si ya es un ID alfanumérico directo
  if (!trimmed.includes('/') && !trimmed.includes('?') && /^[a-zA-Z0-9_-]{15,60}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Elimina un archivo de Google Drive dado su URL o File ID.
 * Se apoya primero en /api/drive/delete para evitar problemas de CORS del navegador,
 * con fallback a llamada REST directa a Google Drive API v3.
 */
export async function deleteGoogleDriveFile(
  fileUrlOrId: string,
  accessToken?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const fileId = extractDriveFileId(fileUrlOrId);
    if (!fileId) {
      return { success: false, error: 'URL o ID de Google Drive inválido' };
    }

    const token = accessToken || getGoogleDriveToken();
    if (!token) {
      return { success: false, error: 'No hay token de autenticación de Google Drive para eliminar el archivo' };
    }

    console.log(`[driveService] Eliminando archivo anterior en Google Drive (ID: ${fileId})...`);

    // 1. Intentar a través del endpoint API interno (seguro sin CORS)
    try {
      const apiRes = await fetch('/api/drive/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, accessToken: token }),
      });
      const data = await apiRes.json().catch(() => ({}));
      if (apiRes.ok && data.success) {
        console.log(`[driveService] ✅ Archivo anterior en Google Drive (${fileId}) eliminado con éxito vía API.`);
        return { success: true };
      }
      if (apiRes.status === 404) {
        console.log(`[driveService] Archivo en Google Drive (${fileId}) no encontrado o ya eliminado.`);
        return { success: true };
      }
    } catch (apiErr) {
      console.warn('[driveService] Error llamando a /api/drive/delete, intentando llamada directa:', apiErr);
    }

    // 2. Fallback: Llamada directa a REST API v3
    const directRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token.trim()}`,
      },
    });

    if (directRes.status === 204 || directRes.status === 200 || directRes.ok || directRes.status === 404) {
      console.log(`[driveService] ✅ Archivo anterior (${fileId}) eliminado directamente en Google Drive.`);
      return { success: true };
    }

    const errJson = await directRes.json().catch(() => ({}));
    const errMsg = errJson.error?.message || `HTTP ${directRes.status} al eliminar en Google Drive`;
    console.warn(`[driveService] No se pudo eliminar archivo (${fileId}) en Drive:`, errMsg);
    return { success: false, error: errMsg };
  } catch (err: any) {
    console.error('[driveService] Excepción al eliminar archivo en Google Drive:', err);
    return { success: false, error: err?.message || 'Error al eliminar archivo en Google Drive' };
  }
}

/**
 * Ejecuta la subida de un video (y miniatura) a Google Drive en segundo plano,
 * totalmente fuera de los componentes React para liberar memoria y evitar retención por closures.
 * Si se especifica `oldDriveUrl`, tras la subida exitosa elimina el archivo anterior en Drive.
 */
export async function startBackgroundDriveUpload(params: StartBackgroundUploadParams): Promise<void> {
  const { videoId, videoTitle, customFileName, file, thumbFile, folderId, token, cuentaId, oldDriveUrl } = params;

  // Registrar para posibles reintentos en PublicationScheduler
  registerPendingDriveUpload(videoId, {
    videoId,
    file,
    folderId,
    thumbFile,
    videoTitle,
  });

  useAppStore.getState().setDriveUploadProgress(videoId, 0);

  try {
    const uploadRes = await uploadVideoToGoogleDrive(
      file,
      folderId,
      token,
      (pct) => {
        useAppStore.getState().setDriveUploadProgress(videoId, pct);
      },
      3,
      customFileName
    );

    let finalThumbnailUrl: string | undefined = undefined;
    if (thumbFile) {
      try {
        const thumbUploadRes = await uploadVideoToGoogleDrive(
          thumbFile,
          folderId,
          token
        );
        if (thumbUploadRes.success && thumbUploadRes.fileUrl) {
          finalThumbnailUrl = thumbUploadRes.fileUrl;
        }
      } catch (tUpErr) {
        console.warn('[driveService] No se pudo subir miniatura a Drive:', tUpErr);
      }
    }

    if (uploadRes.success && uploadRes.fileUrl) {
      unregisterPendingDriveUpload(videoId);
      await useAppStore.getState().updateVideo(videoId, {
        drive_file_url: uploadRes.fileUrl,
        ...(finalThumbnailUrl ? { thumbnail_url: finalThumbnailUrl } : {}),
      });
      useAppStore.getState().setDriveUploadComplete(videoId);

      // Si había un video previo en Drive y es diferente al nuevo, eliminar el anterior
      if (oldDriveUrl && oldDriveUrl !== '#' && oldDriveUrl !== uploadRes.fileUrl) {
        try {
          await deleteGoogleDriveFile(oldDriveUrl, token);
        } catch (delErr) {
          console.warn('[driveService] No se pudo eliminar video anterior tras subida en background:', delErr);
        }
      }

      createNotification({
        tipo: 'success',
        titulo: 'Video subido a Google Drive',
        mensaje: `"${videoTitle}" se subió a Google Drive exitosamente.`,
        cuenta_id: cuentaId,
        origen: 'drive',
      });
    } else {
      useAppStore.getState().setDriveUploadError(videoId, uploadRes.error || 'Error desconocido al subir a Drive');
      createNotification({
        tipo: 'error',
        titulo: 'Fallo al subir video a Google Drive',
        mensaje: `El video "${videoTitle}" no se pudo subir a Drive: ${uploadRes.error || 'Error desconocido'}. Puedes reintentar la subida desde el detalle del video.`,
        cuenta_id: cuentaId,
        origen: 'drive',
      });
    }
  } catch (bgErr: any) {
    console.error('[driveService] Error en subida en segundo plano:', bgErr);
    useAppStore.getState().setDriveUploadError(videoId, bgErr?.message || 'Error de red al subir a Drive');
    createNotification({
      tipo: 'error',
      titulo: 'Error subiendo a Google Drive',
      mensaje: `Error al subir "${videoTitle}" a Drive: ${bgErr?.message || 'Fallo inesperado'}. Puedes reintentar desde el calendario.`,
      cuenta_id: cuentaId,
      origen: 'drive',
    });
  }
}


