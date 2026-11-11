// src/app/api/video/compress/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, access, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { stripTrailingMp4Padding } from '@/lib/services/videoCompressorService';

const execFileAsync = promisify(execFile);

let resolvedFfmpegBin: string | null = null;
let resolvedVideoEncoder: { encoder: string; args: string[] } | null = null;

async function findFfmpegBinary(): Promise<string> {
  if (resolvedFfmpegBin) return resolvedFfmpegBin;

  // 1. Variable de entorno explícita
  if (process.env.FFMPEG_PATH) {
    try {
      await access(process.env.FFMPEG_PATH);
      resolvedFfmpegBin = process.env.FFMPEG_PATH;
      return resolvedFfmpegBin;
    } catch {}
  }

  // 2. WinGet Packages (Gyan.FFmpeg o similar instalado en el sistema)
  const localAppData = process.env.LOCALAPPDATA || '';
  if (localAppData) {
    const wingetDir = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
    try {
      const entries = await readdir(wingetDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase().includes('ffmpeg')) {
          const candidateBase = join(wingetDir, entry.name);
          const subEntries = await readdir(candidateBase, { withFileTypes: true });
          for (const sub of subEntries) {
            if (sub.isDirectory() && sub.name.toLowerCase().includes('ffmpeg')) {
              const fullFfmpeg = join(candidateBase, sub.name, 'bin', 'ffmpeg.exe');
              try {
                await access(fullFfmpeg);
                resolvedFfmpegBin = fullFfmpeg;
                return resolvedFfmpegBin;
              } catch {}
            }
          }
        }
      }
    } catch {}
  }

  // 3. Rutas estándar conocidas en Windows
  const candidates = [
    'C:\\Users\\USUARIO\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
    'C:\\Program Files\\Krita (x64)\\bin\\ffmpeg.exe',
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      resolvedFfmpegBin = candidate;
      return candidate;
    } catch {}
  }

  return 'ffmpeg';
}

async function getBestVideoEncoder(ffmpegBin: string): Promise<{ encoder: string; args: string[] }> {
  if (resolvedVideoEncoder) return resolvedVideoEncoder;

  try {
    const { stdout } = await execFileAsync(ffmpegBin, ['-encoders']);
    if (stdout.includes('libx264')) {
      resolvedVideoEncoder = {
        encoder: 'libx264',
        args: ['-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
      };
      return resolvedVideoEncoder;
    }
    if (stdout.includes('h264_nvenc')) {
      resolvedVideoEncoder = {
        encoder: 'h264_nvenc',
        args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '22', '-pix_fmt', 'yuv420p'],
      };
      return resolvedVideoEncoder;
    }
    if (stdout.includes('h264_qsv')) {
      resolvedVideoEncoder = {
        encoder: 'h264_qsv',
        args: ['-c:v', 'h264_qsv', '-global_quality', '23', '-pix_fmt', 'yuv420p'],
      };
      return resolvedVideoEncoder;
    }
    if (stdout.includes('libopenh264')) {
      resolvedVideoEncoder = {
        encoder: 'libopenh264',
        args: ['-c:v', 'libopenh264', '-b:v', '3.5M', '-pix_fmt', 'yuv420p'],
      };
      return resolvedVideoEncoder;
    }
  } catch (err) {
    console.warn('[api/video/compress] No se pudieron listar codificadores de FFmpeg:', err);
  }

  resolvedVideoEncoder = {
    encoder: 'libx264',
    args: ['-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'],
  };
  return resolvedVideoEncoder;
}

export async function POST(req: NextRequest) {
  let tempInputPath: string | null = null;
  let tempOutputPath: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'No se recibió un archivo de video válido.' },
        { status: 400 }
      );
    }

    const inputBuffer = new Uint8Array(await file.arrayBuffer());
    const originalSize = inputBuffer.byteLength;
    const contentType = file.type || 'video/mp4';

    // 1. Compresión ultrarrápida en segundo plano sin pérdida visual
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ext = file.name.includes('.')
        ? file.name.substring(file.name.lastIndexOf('.'))
        : '.mp4';
      tempInputPath = join(tmpdir(), `autopub_in_${id}${ext}`);
      tempOutputPath = join(tmpdir(), `autopub_out_${id}.mp4`);

      await writeFile(tempInputPath, inputBuffer);

      const ffmpegBin = await findFfmpegBinary();
      const encoderInfo = await getBestVideoEncoder(ffmpegBin);

      try {
        await execFileAsync(
          ffmpegBin,
          [
            '-y',
            '-threads',
            '0',
            '-i',
            tempInputPath,
            ...encoderInfo.args,
            '-c:a',
            'copy',
            '-movflags',
            '+faststart',
            tempOutputPath,
          ],
          { timeout: 60000 }
        );
      } catch (copyAudioErr: any) {
        // Si el stream de audio no se puede copiar directamente, recodificar audio a AAC
        console.warn('[api/video/compress] Falló audio copy, recodificando audio a AAC:', copyAudioErr?.message);
        await execFileAsync(
          ffmpegBin,
          [
            '-y',
            '-threads',
            '0',
            '-i',
            tempInputPath,
            ...encoderInfo.args,
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            tempOutputPath,
          ],
          { timeout: 60000 }
        );
      }

      const compressedBuffer = await readFile(tempOutputPath);
      if (
        compressedBuffer.byteLength > 1024 &&
        compressedBuffer.byteLength < originalSize
      ) {
        return new NextResponse(new Uint8Array(compressedBuffer), {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'X-Original-Size': String(originalSize),
            'X-Compressed-Size': String(compressedBuffer.byteLength),
            'X-Saved-Bytes': String(originalSize - compressedBuffer.byteLength),
            'X-Compression-Method': `ffmpeg-${encoderInfo.encoder}`,
          },
        });
      }
    } catch (ffmpegErr: any) {
      console.warn('[api/video/compress] FFmpeg no completó compresión rápida:', ffmpegErr?.message);
    }

    // 2. Optimización lossless instantánea de contenedor MP4/MOV
    const trimmed = stripTrailingMp4Padding(inputBuffer);
    const finalBuffer =
      trimmed.byteLength > 1024 && trimmed.byteLength < originalSize
        ? trimmed
        : inputBuffer;
    const method =
      finalBuffer.byteLength < originalSize ? 'mp4-trim' : 'passthrough';

    return new NextResponse(new Uint8Array(finalBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'X-Original-Size': String(originalSize),
        'X-Compressed-Size': String(finalBuffer.byteLength),
        'X-Saved-Bytes': String(originalSize - finalBuffer.byteLength),
        'X-Compression-Method': method,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error al procesar compresión de video.' },
      { status: 500 }
    );
  } finally {
    if (tempInputPath) {
      await unlink(tempInputPath).catch(() => {});
    }
    if (tempOutputPath) {
      await unlink(tempOutputPath).catch(() => {});
    }
  }
}
