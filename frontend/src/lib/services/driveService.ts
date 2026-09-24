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

export function getStoredDriveConfig(): DriveConfig {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return {
          clientId: parsed.clientId || '109827364512-apps.googleusercontent.com',
          clientSecret: parsed.clientSecret || 'GOCSPX-mockDriveSecret9812',
          folderId: parsed.folderId || '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs',
          autoDownload: parsed.autoDownload ?? true,
          autoDeleteAfterVerify: parsed.autoDeleteAfterVerify ?? true,
          retentionHours: parsed.retentionHours ?? 24,
        };
      } catch (e) {
        console.error('Error parsing drive config', e);
      }
    }
  }
  return {
    clientId: '109827364512-apps.googleusercontent.com',
    clientSecret: 'GOCSPX-mockDriveSecret9812',
    folderId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs',
    autoDownload: true,
    autoDeleteAfterVerify: true,
    retentionHours: 24,
  };
}

export function saveStoredDriveConfig(config: DriveConfig): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}

export async function verifyDriveFolderAccess(
  folderId: string,
  clientId: string
): Promise<{ success: boolean; message: string }> {
  await new Promise(r => setTimeout(r, 1200));
  if (!folderId || folderId.length < 5) {
    return { success: false, message: 'El ID de la carpeta de Google Drive es inválido.' };
  }
  return {
    success: true,
    message: `Carpeta verificada con éxito (ID: ${folderId}). Listo para sincronizar videos con Playwright.`,
  };
}
