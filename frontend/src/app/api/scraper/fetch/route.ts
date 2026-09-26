// src/app/api/scraper/fetch/route.ts
// Proxy HTTP silencioso del servidor para que el ScraperService pueda
// descargar HTML de redes sociales sin restricciones CORS del navegador.

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Dominios permitidos para el proxy (evitar uso como proxy genérico)
const ALLOWED_DOMAINS = [
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'youtube.com',
  'www.youtube.com',
  'twitter.com',
  'x.com',
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json({ error: 'Parámetro url requerido' }, { status: 400 });
  }

  // Validar URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: 'URL inválida' }, { status: 400 });
  }

  if (parsedUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'Solo se permiten URLs HTTPS' }, { status: 400 });
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isAllowed = ALLOWED_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  if (!isAllowed) {
    return NextResponse.json(
      { error: `Dominio no permitido: ${hostname}. Solo se permiten redes sociales conocidas.` },
      { status: 403 }
    );
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      // Timeout de 12 segundos
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `La red social respondió HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const html = await response.text();

    // Retornar como texto plano para que el cliente analice las keywords
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || err?.message?.includes('timeout');
    return NextResponse.json(
      { error: isTimeout ? 'Timeout al descargar la página de la red social' : err?.message || 'Error de red' },
      { status: 502 }
    );
  }
}
