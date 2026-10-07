// src/app/api/youtube/authorize/route.ts
// Invoca el script Python backend/youtube/authorize.py para iniciar el flujo OAuth2
// El backend abre el navegador para que el usuario inicie sesión en Google y guarda el token.
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const { canal_id } = await req.json();

    if (!canal_id || typeof canal_id !== 'string') {
      return NextResponse.json({ success: false, error: 'canal_id es requerido' }, { status: 400 });
    }

    // Ruta al directorio backend (relativa a la raíz del proyecto)
    const backendDir = path.join(process.cwd(), '..', 'backend');

    // Ejecutar el script de autorización
    // Usa el Python del entorno virtual si existe, si no, python / python3
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const cmd = `${pythonCmd} youtube/authorize.py --channel=${canal_id}`;

    console.log(`[YouTube Authorize] Ejecutando: ${cmd} en ${backendDir}`);

    const { stdout, stderr } = await execAsync(cmd, {
      cwd: backendDir,
      timeout: 120_000, // 2 minutos para completar el OAuth
      env: { ...process.env },
    });

    const output = stdout + (stderr ? `\n[stderr] ${stderr}` : '');
    console.log(`[YouTube Authorize] Output:`, output);

    // El script termina exitosamente cuando el token fue guardado
    const success = output.toLowerCase().includes('autorizado exitosamente') ||
                    output.toLowerCase().includes('ya esta autorizado') ||
                    output.toLowerCase().includes('token guardado');

    return NextResponse.json({
      success,
      canal_id,
      message: success
        ? `Canal @${canal_id} autorizado en YouTube correctamente.`
        : 'El proceso de autorización terminó pero no se pudo confirmar el éxito.',
      output: output.trim(),
    });

  } catch (err: any) {
    console.error('[YouTube Authorize] Error:', err);

    // Error de timeout (el usuario no completó el login a tiempo)
    if (err.code === 'ERR_CHILD_PROCESS_TIMED_OUT' || err.killed) {
      return NextResponse.json({
        success: false,
        error: 'Tiempo de espera agotado. El usuario no completó el inicio de sesión en 2 minutos.',
      }, { status: 408 });
    }

    return NextResponse.json({
      success: false,
      error: err.message ?? 'Error desconocido al ejecutar la autorización.',
    }, { status: 500 });
  }
}
