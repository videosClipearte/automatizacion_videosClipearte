// src/app/api/youtube/status/route.ts
// Verifica si un canal de YouTube ya tiene token autorizado (archivo token_<canal_id>.json existe)
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const canal_id = searchParams.get('canal_id');

    if (!canal_id) {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }

    const backendDir = path.join(process.cwd(), '..', 'backend');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const cmd = `${pythonCmd} youtube/authorize.py --list`;

    const { stdout } = await execAsync(cmd, {
      cwd: backendDir,
      timeout: 15_000,
      env: { ...process.env },
    });

    const safeId = canal_id.replace('@', '').replace(/ /g, '_').toLowerCase();
    // El script --list imprime el nombre del canal y el archivo de token
    const authorized = stdout.toLowerCase().includes(safeId);

    return NextResponse.json({
      success: true,
      canal_id,
      authorized,
      message: authorized
        ? `Canal @${canal_id} tiene sesión activa en YouTube.`
        : `Canal @${canal_id} no está autorizado en YouTube.`,
    });

  } catch (err: any) {
    console.error('[YouTube Status] Error:', err);
    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error desconocido al verificar el estado.',
    }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const canal_id = searchParams.get('canal_id');

    if (!canal_id) {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }

    const backendDir = path.join(process.cwd(), '..', 'backend');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const cmd = `${pythonCmd} youtube/authorize.py --revoke --channel=${canal_id}`;

    const { stdout } = await execAsync(cmd, {
      cwd: backendDir,
      timeout: 15_000,
      env: { ...process.env },
    });

    const success = stdout.toLowerCase().includes('eliminado exitosamente');
    return NextResponse.json({
      success,
      canal_id,
      message: success
        ? `Sesión de @${canal_id} en YouTube desvinculada.`
        : 'No se encontró token para revocar.',
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error al revocar el token.',
    }, { status: 500 });
  }
}
