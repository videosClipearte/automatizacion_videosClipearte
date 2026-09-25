// src/app/api/gemini/generate/route.ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ status: 'ok', info: 'Gemini direct client-side analysis active' });
}

export async function POST() {
  return NextResponse.json({
    status: 'ok',
    info: 'Gemini direct client-side analysis active',
  });
}
