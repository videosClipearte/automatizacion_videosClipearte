// src/app/api/cron/scraper/route.ts
// Cron Job de Vercel: Verifica publicaciones en estado ENVIADO mediante scraper silencioso.
// Disparado automáticamente por Vercel cada 5 minutos, SIN necesidad de que el navegador esté abierto.
// Marca videos como PUBLICADO si el scraper confirma la publicación,
// o envía alertas a Telegram si el margen de tolerancia fue superado.

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { loadAppConfig } from '@/lib/services/appConfigService';
import { sendTelegramMessage } from '@/lib/services/telegramService';
import { format, differenceInMinutes, parseISO } from 'date-fns';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro permite hasta 60s para cron jobs

// ── Extracción de keywords (espejo del ScraperService) ──────────────────────
function extractKeywords(text: string): string[] {
  if (!text) return [];
  const stopwords = new Set([
    'para', 'este', 'esta', 'esto', 'como', 'que', 'los', 'las', 'del',
    'con', 'una', 'uno', 'por', 'son', 'sus', 'pero', 'todo', 'cada',
    'the', 'and', 'for', 'are', 'with', 'this', 'from', 'your',
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s#áéíóúüñ]/gi, ' ')
    .split(/\s+/)
    .filter((w) => (w.length > 4 || w.startsWith('#')) && !stopwords.has(w));
  return Array.from(new Set(tokens));
}

// ── Fetch silencioso desde el servidor (sin restricciones CORS) ─────────────
async function fetchHtml(url: string, timeout = 12000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ── Verificación silenciosa del scraper ─────────────────────────────────────
async function verifyPostLive(
  postUrl: string | null,
  profileUrl: string,
  keywords: string[],
  minMatchThreshold = 2
): Promise<{ isLive: boolean; matchCount: number; totalKeywords: number }> {
  const targets = [postUrl, profileUrl].filter(Boolean) as string[];

  for (const url of targets) {
    const html = await fetchHtml(url);
    if (!html) continue;

    const htmlLower = html.toLowerCase();
    const matched = keywords.filter((kw) => htmlLower.includes(kw));

    if (matched.length >= minMatchThreshold) {
      return { isLive: true, matchCount: matched.length, totalKeywords: keywords.length };
    }
  }

  return { isLive: false, matchCount: 0, totalKeywords: keywords.length };
}

export async function GET(request: Request) {
  // Verificar que la llamada viene de Vercel Cron (o es interna autorizada)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const db = getSupabase();
    const cfg = await loadAppConfig();

    const botToken = cfg.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '';
    const groupChatId = (cfg.telegram_group_id || process.env.TELEGRAM_GROUP_ID || '').trim();
    const adminChatId = (cfg.telegram_admin_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID || groupChatId).trim();

    const toleranciaMinutos = cfg.alerta_tolerancia_minutos ?? 60;
    const maxReintentos = cfg.alerta_max_reintentos ?? 3;

    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Obtener videos en estado ENVIADO o VERIFICACION_PENDIENTE
    const { data: sentVideos, error: fetchErr } = await db
      .from('publicaciones')
      .select('*')
      .in('estado', ['ENVIADO', 'VERIFICACION_PENDIENTE']);

    if (fetchErr) {
      return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 });
    }

    if (!sentVideos || sentVideos.length === 0) {
      return NextResponse.json({ success: true, verified: 0, message: 'No hay videos para verificar.' });
    }

    // 2. Cargar cuentas para obtener URLs de perfil
    const { data: cuentas } = await db.from('cuentas').select('*');

    const results: any[] = [];

    for (const video of sentVideos) {
      const account = cuentas?.find((c: any) => c.id === video.cuenta_id);
      const platform = (account?.plataforma || 'instagram').toLowerCase();
      const username = (account?.username || '').replace(/^@/, '');

      const programadoPara = video.programado_para ? parseISO(video.programado_para) : null;
      if (!programadoPara) continue;

      const delayMinutes = differenceInMinutes(now, programadoPara);

      // Solo actuar si ya superó el margen de tolerancia
      if (delayMinutes < toleranciaMinutos) {
        results.push({ id: video.id, titulo: video.titulo, action: 'waiting', delayMinutes });
        continue;
      }

      // Extraer keywords para verificación
      const keywords = extractKeywords(video.descripcion_aprobada_ia || video.titulo || '');

      if (keywords.length === 0) {
        results.push({ id: video.id, titulo: video.titulo, action: 'skip_no_keywords' });
        continue;
      }

      const postUrl = video.post_url_publica && video.post_url_publica !== '#'
        ? video.post_url_publica
        : null;
      const profileUrl = account?.profile_url || `https://${platform}.com/@${username}`;

      // 3. Ejecutar verificación silenciosa
      const { isLive, matchCount, totalKeywords } = await verifyPostLive(
        postUrl,
        profileUrl,
        keywords,
        2
      );

      if (isLive) {
        // ✅ PUBLICADO confirmado por scraper
        const confirmedPostUrl = postUrl || `${profileUrl}/post/${video.id}`;
        await db
          .from('publicaciones')
          .update({
            estado: 'PUBLICADO',
            publicado_en: nowIso,
            post_url_publica: confirmedPostUrl,
          })
          .eq('id', video.id);

        // Notificación de éxito a Telegram
        if (botToken && groupChatId) {
          const msg = `
✅ <b>PUBLICACIÓN CONFIRMADA POR SCRAPER</b>
━━━━━━━━━━━━━━━━━━━━
🎬 <b>Video:</b> ${video.titulo}
👤 <b>Cuenta:</b> @${username} (<b>${platform.toUpperCase()}</b>)
🔍 <b>Tokens verificados:</b> ${matchCount}/${totalKeywords}
🕒 <b>Verificado a las:</b> ${format(now, 'HH:mm')} UTC
`.trim();
          await sendTelegramMessage(botToken, groupChatId, msg);
        }

        results.push({ id: video.id, titulo: video.titulo, action: 'confirmed_published', matchCount });
      } else {
        // ⚠️ No confirmado: incrementar reintentos y enviar alerta
        const reintentos = (video.reintentos_alerta || 0) + 1;
        const newEstado = reintentos >= maxReintentos ? 'ERROR_DE_RED' : 'VERIFICACION_PENDIENTE';

        await db
          .from('publicaciones')
          .update({ estado: newEstado, reintentos_alerta: reintentos })
          .eq('id', video.id);

        if (botToken && (groupChatId || adminChatId)) {
          const targetChat = reintentos >= maxReintentos ? adminChatId : groupChatId;
          const msg = reintentos >= maxReintentos
            ? `
🚨 <b>ALERTA CRÍTICA DE PUBLICACIÓN</b>
━━━━━━━━━━━━━━━━━━━━
⚠️ El video <b>'${video.titulo}'</b> agotó ${maxReintentos} intentos de verificación.
⏱️ Retraso acumulado: <b>${delayMinutes} minutos</b>
👤 Cuenta: @${username} (${platform.toUpperCase()})
❗ <i>Por favor revise manualmente la cuenta o el log de publicación.</i>
`.trim()
            : `
⚠️ <b>AVISO DE RETRASO EN PUBLICACIÓN</b>
━━━━━━━━━━━━━━━━━━━━
🎬 <b>Video:</b> ${video.titulo}
👤 <b>Cuenta:</b> @${username} (${platform.toUpperCase()})
🕒 <b>Retraso:</b> ${delayMinutes} minutos
📢 <i>Aviso #${reintentos} de ${maxReintentos} enviado al grupo de monitoreo.</i>
`.trim();

          await sendTelegramMessage(botToken, targetChat, msg);
        }

        results.push({ id: video.id, titulo: video.titulo, action: newEstado.toLowerCase(), reintentos });
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      timestamp: nowIso,
      results,
    });
  } catch (error: any) {
    console.error('[cron/scraper] Error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Error inesperado en cron scraper' },
      { status: 500 }
    );
  }
}
