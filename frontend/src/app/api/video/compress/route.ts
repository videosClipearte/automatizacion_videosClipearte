// src/app/api/video/compress/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { stripTrailingMp4Padding } from '@/lib/services/videoCompressorService';

const execFileAsync = promisify(execFile);

const CANDIDATE_FFMPEG_PATHS = [
  process.env.FFMPEG_PATH,
  'ffmpeg',
  'C:\\Program Files\\Krita (x64)\\bin\\ffmpeg.exe',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
].filter(Boolean) as string[];

let resolvedFfmpegBin: string | null = null;

async function findFfmpegBinary(): Promise<string> {
  if (resolvedFfmpegBin) return resolvedFfmpegBin;
  for (const candidate of CANDIDATE_FFMPEG_PATHS) {
    if (candidate === 'ffmpeg') continue;
    try {
      await access(candidate);
      resolvedFfmpegBin = candidate;
      return candidate;
    } catch {}
  }
  return process.env.FFMPEG_PATH || 'ffmpeg';
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

    // 1. Compresión ultrarrápida en segundo plano sin pérdida visual (CRF 18 + preset ultrafast + audio copy)
    try {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ext = file.name.includes('.')
        ? file.name.substring(file.name.lastIndexOf('.'))
        : '.mp4';
      tempInputPath = join(tmpdir(), `autopub_in_${id}${ext}`);
      tempOutputPath = join(tmpdir(), `autopub_out_${id}.mp4`);

      await writeFile(tempInputPath, inputBuffer);

      const ffmpegBin = await findFfmpegBinary();
      await execFileAsync(
        ffmpegBin,
        [
          '-y',
          '-threads',
          '0',
          '-i',
          tempInputPath,
          '-c:v',
          'libx264',
          '-crf',
          '18',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'copy',
          '-movflags',
          '+faststart',
          tempOutputPath,
        ],
        { timeout: 15000 }
      );

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
            'X-Compression-Method': 'ffmpeg-crf18',
          },
        });
      }
    } catch {
      // Si FFmpeg no está disponible o excede el tiempo rápido, aplicar optimización lossless de contenedor
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
