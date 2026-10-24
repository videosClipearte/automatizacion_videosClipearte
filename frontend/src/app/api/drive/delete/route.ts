import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { fileId, fileUrl, accessToken } = body;

    let targetFileId = fileId ? String(fileId).trim() : '';

    if (!targetFileId && fileUrl) {
      const trimmedUrl = String(fileUrl).trim();
      const matchView = trimmedUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (matchView && matchView[1]) {
        targetFileId = matchView[1];
      } else {
        const matchId = trimmedUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (matchId && matchId[1]) {
          targetFileId = matchId[1];
        } else if (!trimmedUrl.includes('/') && !trimmedUrl.includes('?') && /^[a-zA-Z0-9_-]{15,60}$/.test(trimmedUrl)) {
          targetFileId = trimmedUrl;
        }
      }
    }

    if (!targetFileId || targetFileId === '#' || targetFileId.length < 5) {
      return NextResponse.json(
        { success: false, error: 'Identificador de archivo en Google Drive inválido o no proporcionado.' },
        { status: 400 }
      );
    }

    if (!accessToken || typeof accessToken !== 'string' || !accessToken.trim()) {
      return NextResponse.json(
        { success: false, error: 'Token de acceso OAuth de Google Drive no proporcionado.' },
        { status: 401 }
      );
    }

    console.log(`[API /api/drive/delete] Eliminando archivo con ID: ${targetFileId}`);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(targetFileId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`,
      },
    });

    // 204 No Content, 200 OK, o 404 (el archivo ya no existe) se consideran éxito
    if (res.status === 204 || res.status === 200 || res.ok || res.status === 404) {
      console.log(`[API /api/drive/delete] ✅ Archivo ${targetFileId} eliminado con éxito de Google Drive (status ${res.status}).`);
      return NextResponse.json({ success: true, fileId: targetFileId });
    }

    const errData = await res.json().catch(() => ({}));
    const errMsg = errData.error?.message || `HTTP ${res.status} al eliminar archivo en Google Drive`;
    console.warn(`[API /api/drive/delete] Fallo al eliminar archivo ${targetFileId}:`, errMsg);

    return NextResponse.json(
      { success: false, error: errMsg },
      { status: res.status }
    );
  } catch (error: any) {
    console.error('[API /api/drive/delete] Excepción inesperada:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error interno del servidor al conectar con Google Drive.' },
      { status: 500 }
    );
  }
}
