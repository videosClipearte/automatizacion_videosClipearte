// src/lib/services/driveService.ts

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
          scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive',
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
        client.requestAccessToken();
      } catch (err: any) {
        resolve({ success: false, error: `Error inicializando cliente OAuth: ${err?.message || err}` });
      }
    });
  } catch (error: any) {
    return { success: false, error: error?.message || 'Error al conectar con Google Drive' };
  }
}

/**
 * Sube un archivo de video a la carpeta seleccionada en Google Drive vía REST API v3
 */
export async function uploadVideoToGoogleDrive(
  file: File,
  folderId: string,
  accessToken: string,
  onProgress?: (progressPercent: number) => void
): Promise<{ success: boolean; fileId?: string; fileUrl?: string; error?: string }> {
  try {
    const cleanFolderId = folderId.trim();
    const metadata: Record<string, any> = {
      name: file.name,
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
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.round((evt.loaded / evt.total) * 100);
            onProgress(pct);
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
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error inesperado al subir archivo a Drive.' };
  }
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
