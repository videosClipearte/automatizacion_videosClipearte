import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const CLIPEARTE_BASE_URL = 'https://clipearte.com';
const CLIPEARTE_LOGIN_URL = 'https://clipearte.com/login?next=%2Fclipper%2Fsubir-clip';
const CLIPEARTE_SUBMIT_URL = 'https://clipearte.com/clipper/subir-clip';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;
  return createClient(url, key);
}

function normalizeText(str: string): string {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHandle(handle: string): string {
  return (handle || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

/**
 * Combina cookies de múltiples respuestas HTTP en un jar clave=valor
 */
function mergeSetCookies(cookieJar: Record<string, string>, res: Response) {
  const setCookies: string[] =
    typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];

  for (const raw of setCookies) {
    const firstPart = raw.split(';')[0];
    if (!firstPart) continue;
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx === -1) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    const val = firstPart.slice(eqIdx + 1).trim();
    if (val === '' || val === 'deleted') {
      delete cookieJar[name];
    } else {
      cookieJar[name] = val;
    }
  }
}

function serializeCookieJar(cookieJar: Record<string, string>): string {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Extrae todos los inputs hidden de un formulario HTML
 */
function extractHiddenInputs(html: string): Record<string, string> {
  const hidden: Record<string, string> = {};
  const inputRegex = /<input\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = inputRegex.exec(html)) !== null) {
    const tag = match[0];
    const typeMatch = tag.match(/\btype=["']([^"']+)["']/i);
    if (!typeMatch || typeMatch[1].toLowerCase() !== 'hidden') continue;
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    const valueMatch = tag.match(/\bvalue=["']([^"']*)["']/i);
    if (nameMatch) {
      const decodedVal = (valueMatch ? valueMatch[1] : '')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
      hidden[nameMatch[1]] = decodedVal;
    }
  }
  return hidden;
}

/**
 * Extrae campañas y cuentas disponibles desde el HTML y el payload RSC de /clipper/subir-clip
 */
function parseClipearteSubirClipPage(html: string) {
  const campaigns: Array<{ id: string; name: string }> = [];
  const accounts: Array<{ id: string; username: string; platform: string }> = [];
  const hiddenInputs = extractHiddenInputs(html);

  // 1. Extraer opciones de <select> en el HTML
  const selectRegex = /<select\b[^>]*>([\s\S]*?)<\/select>/gi;
  let selectMatch: RegExpExecArray | null;
  while ((selectMatch = selectRegex.exec(html)) !== null) {
    const optionsHtml = selectMatch[1];
    const optionRegex = /<option\b[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
    let optMatch: RegExpExecArray | null;
    while ((optMatch = optionRegex.exec(optionsHtml)) !== null) {
      const val = optMatch[1].trim();
      const label = optMatch[2].replace(/<[^>]+>/g, '').trim();
      if (val && label && !label.toLowerCase().includes('selecciona')) {
        if (!campaigns.some((c) => c.id === val || c.name === label)) {
          campaigns.push({ id: val, name: label });
        }
      }
    }
  }

  // 2. Desescapar fragmentos RSC (self.__next_f.push) para buscar objetos JSON de campañas y cuentas
  const unescaped = html
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');

  // Buscar objetos con id (UUID) y nombre/titulo de campaña o username de cuenta
  const jsonObjRegex = /\{[^{}]*"id"\s*:\s*"([^"]+)"[^{}]*\}/g;
  let objMatch: RegExpExecArray | null;
  while ((objMatch = jsonObjRegex.exec(unescaped)) !== null) {
    try {
      const raw = objMatch[0];
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.id !== 'string') continue;

      // ¿Es cuenta social?
      const handle =
        parsed.username ||
        parsed.handle ||
        parsed.account_name ||
        parsed.account_username ||
        parsed.nombre_usuario;
      const platform =
        parsed.platform ||
        parsed.social_network ||
        parsed.network ||
        parsed.red_social ||
        parsed.provider;

      if (handle && typeof handle === 'string') {
        const cleanPlat = String(platform || '').toLowerCase();
        if (!accounts.some((a) => a.id === parsed.id)) {
          accounts.push({
            id: parsed.id,
            username: handle,
            platform: cleanPlat,
          });
        }
        continue;
      }

      // ¿Es campaña?
      const campName =
        parsed.title ||
        parsed.name ||
        parsed.nombre ||
        parsed.campaign_name;
      if (
        campName &&
        typeof campName === 'string' &&
        campName.length > 2 &&
        !['TikTok', 'Instagram', 'YouTube'].includes(campName)
      ) {
        if (!campaigns.some((c) => c.id === parsed.id)) {
          campaigns.push({
            id: parsed.id,
            name: campName,
          });
        }
      }
    } catch {
      // Ignorar fragmentos que no sean JSON completo
    }
  }

  // 3. También buscar handles @username visibles en el HTML o RSC si no tenían estructura estándar
  const handleMentionRegex = /@([a-zA-Z0-9._-]{2,40})/g;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = handleMentionRegex.exec(html)) !== null) {
    const h = hMatch[1];
    if (h === 'tucuenta' || h.includes('.')) continue;
    if (!accounts.some((a) => normalizeHandle(a.username) === normalizeHandle(h))) {
      accounts.push({ id: h, username: `@${h}`, platform: 'any' });
    }
  }

  // 4. Extraer nombres de campos del formulario (<select name="...">, <input name="...">)
  const fieldNames: {
    selectNames: string[];
    radioNames: string[];
    textNames: string[];
  } = {
    selectNames: [],
    radioNames: [],
    textNames: [],
  };

  const selectNameRegex = /<select\b[^>]*\bname=["']([^"']+)["']/gi;
  let snMatch: RegExpExecArray | null;
  while ((snMatch = selectNameRegex.exec(html)) !== null) {
    fieldNames.selectNames.push(snMatch[1]);
  }

  const inputTagRegex = /<input\b[^>]*>/gi;
  let inMatch: RegExpExecArray | null;
  while ((inMatch = inputTagRegex.exec(html)) !== null) {
    const tag = inMatch[0];
    const nameM = tag.match(/\bname=["']([^"']+)["']/i);
    const typeM = tag.match(/\btype=["']([^"']+)["']/i);
    if (!nameM) continue;
    const iName = nameM[1];
    const iType = (typeM ? typeM[1] : 'text').toLowerCase();
    if (iType === 'hidden') continue;
    if (iType === 'radio') {
      if (!fieldNames.radioNames.includes(iName)) fieldNames.radioNames.push(iName);
    } else if (iType === 'url' || iType === 'text') {
      if (!fieldNames.textNames.includes(iName)) fieldNames.textNames.push(iName);
    }
  }

  // 5. Extraer URL del chunk JS de subir-clip por si define Server Actions adicionales
  const chunkMatch = html.match(/\/_next\/static\/chunks\/app\/[^"']*subir-clip\/page-[^"']+\.js/);
  const subirClipChunkUrl = chunkMatch ? `${CLIPEARTE_BASE_URL}${chunkMatch[0]}` : null;

  return {
    campaigns,
    accounts,
    hiddenInputs,
    fieldNames,
    subirClipChunkUrl,
  };
}

/**
 * Inicia sesión en Clipearte.com y devuelve las cookies autenticadas + el HTML de /clipper/subir-clip
 */
async function loginAndLoadSubirClip(email: string, password: string) {
  const cookieJar: Record<string, string> = {};

  // Paso 1: GET /login
  const loginGetRes = await fetch(CLIPEARTE_LOGIN_URL, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'manual',
  });
  mergeSetCookies(cookieJar, loginGetRes);
  const loginHtml = await loginGetRes.text();
  const loginHidden = extractHiddenInputs(loginHtml);

  // Construir FormData del Server Action de login en Clipearte
  const loginForm = new FormData();
  if (Object.keys(loginHidden).length > 0) {
    for (const [k, v] of Object.entries(loginHidden)) {
      loginForm.append(k, v);
    }
  } else {
    loginForm.append('$ACTION_REF_1', '');
    loginForm.append(
      '$ACTION_1:0',
      '{"id":"60ccbcb26da19061f1432da7fa34b07aa91b779193","bound":"$@1"}'
    );
    loginForm.append('$ACTION_1:1', '[null]');
    loginForm.append('$ACTION_KEY', 'k2022989214');
    loginForm.append('next', '/clipper/subir-clip');
  }
  loginForm.set('next', '/clipper/subir-clip');
  loginForm.set('email', email.trim());
  loginForm.set('password', password);

  // Paso 2: POST /login
  const loginPostRes = await fetch(CLIPEARTE_LOGIN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Origin: CLIPEARTE_BASE_URL,
      Referer: CLIPEARTE_LOGIN_URL,
      Cookie: serializeCookieJar(cookieJar),
    },
    body: loginForm,
    redirect: 'manual',
  });
  mergeSetCookies(cookieJar, loginPostRes);

  // Si devuelve texto con error explícito de credenciales
  const loginPostText = await loginPostRes.text().catch(() => '');
  if (
    loginPostText.includes('Email o password incorrectos') ||
    loginPostText.includes('Invalid login credentials')
  ) {
    return {
      ok: false as const,
      error: 'Credenciales de Clipearte incorrectas (Email o password incorrectos). Verifica tu configuración.',
    };
  }

  // Paso 3: GET /clipper/subir-clip con las cookies de sesión
  const subirGetRes = await fetch(CLIPEARTE_SUBMIT_URL, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: CLIPEARTE_LOGIN_URL,
      Cookie: serializeCookieJar(cookieJar),
    },
    redirect: 'manual',
  });
  mergeSetCookies(cookieJar, subirGetRes);

  const location = subirGetRes.headers.get('location') || '';
  if (subirGetRes.status >= 300 && subirGetRes.status < 400 && location.includes('/login')) {
    return {
      ok: false as const,
      error: 'No se pudo iniciar sesión en Clipearte (redirigido a /login). Revisa tu correo y contraseña de Clipearte.',
    };
  }

  const subirHtml = await subirGetRes.text();
  if (subirHtml.includes('Inicia sesion en tu cuenta') && !subirHtml.includes('Subir nuevo clip')) {
    return {
      ok: false as const,
      error: 'Sesión no iniciada en Clipearte. Verifica tu correo y contraseña en Configuración.',
    };
  }

  const parsed = parseClipearteSubirClipPage(subirHtml);

  return {
    ok: true as const,
    cookieJar,
    subirHtml,
    parsed,
  };
}

/**
 * Ejecuta el envío de un clip a https://clipearte.com/clipper/subir-clip
 */
async function submitClipToClipearte(params: {
  email: string;
  password: string;
  campaignName: string;
  platform: string;
  accountUsername: string;
  clipUrl: string;
  videoId?: string;
}): Promise<{
  ok: boolean;
  error?: string;
  message?: string;
  matchedCampaign?: { id: string; name: string };
  matchedAccount?: { id: string; username: string };
}> {
  const { email, password, campaignName, platform, accountUsername, clipUrl, videoId } = params;

  if (!email || !password) {
    return {
      ok: false,
      error: 'Faltan las credenciales de Clipearte (correo y contraseña). Configúralas en Configuración -> Integraciones.',
    };
  }

  if (!campaignName || !platform || !accountUsername || !clipUrl) {
    return {
      ok: false,
      error: 'Todos los campos son obligatorios: Campaña, Red Social, Cuenta y Link del video.',
    };
  }

  // 1. Iniciar sesión y cargar /clipper/subir-clip
  const session = await loginAndLoadSubirClip(email, password);
  if (!session.ok) {
    return { ok: false, error: session.error };
  }

  const { cookieJar, parsed } = session;

  // 2. Emparejar Campaña por nombre
  const targetCampNorm = normalizeText(campaignName);
  let matchedCampaign = parsed.campaigns.find(
    (c) =>
      normalizeText(c.name) === targetCampNorm ||
      normalizeText(c.name).includes(targetCampNorm) ||
      targetCampNorm.includes(normalizeText(c.name))
  );

  // Si no se detectaron opciones en el DOM estático, usar el nombre/id provisto
  if (!matchedCampaign) {
    if (parsed.campaigns.length > 0) {
      return {
        ok: false,
        error: `La campaña "${campaignName}" no coincide con ninguna campaña activa en tu cuenta de Clipearte (${parsed.campaigns.map((c) => `"${c.name}"`).join(', ')}).`,
      };
    }
    matchedCampaign = { id: campaignName, name: campaignName };
  }

  // 3. Normalizar plataforma ('tiktok' | 'instagram' | 'youtube')
  const normPlatform = platform.toLowerCase().trim();

  // 4. Emparejar Cuenta por @username
  const targetHandle = normalizeHandle(accountUsername);
  let matchedAccount = parsed.accounts.find(
    (a) =>
      normalizeHandle(a.username) === targetHandle &&
      (a.platform === 'any' || !a.platform || a.platform.includes(normPlatform))
  );
  if (!matchedAccount) {
    matchedAccount = parsed.accounts.find((a) => normalizeHandle(a.username) === targetHandle);
  }
  if (!matchedAccount) {
    if (parsed.accounts.length > 0) {
      return {
        ok: false,
        error: `La cuenta "@${targetHandle}" no coincide con las cuentas conectadas en Clipearte (${parsed.accounts.map((a) => a.username).join(', ')}).`,
      };
    }
    matchedAccount = { id: `@${targetHandle}`, username: `@${targetHandle}`, platform: normPlatform };
  }

  // 5. Inspeccionar el chunk JS de subir-clip si está disponible para descubrir nombres exactos de campos o Server Action ID
  let actionIdFromChunk: string | null = null;
  let extraFieldNames: string[] = [];
  if (parsed.subirClipChunkUrl) {
    try {
      const chunkRes = await fetch(parsed.subirClipChunkUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (chunkRes.ok) {
        const chunkJs = await chunkRes.text();
        // Buscar IDs hexadecimales de 40-42 chars de Next Server Actions
        const actionMatches = chunkJs.match(/["']([0-9a-f]{40,42})["']/g);
        if (actionMatches && actionMatches.length > 0) {
          actionIdFromChunk = actionMatches[0].replace(/["']/g, '');
        }
        // Buscar posibles nombres de campos en formData.get("...")
        const getRegex = /\.get\(["']([a-zA-Z0-9_]+)["']\)/g;
        let gm: RegExpExecArray | null;
        while ((gm = getRegex.exec(chunkJs)) !== null) {
          if (!extraFieldNames.includes(gm[1])) extraFieldNames.push(gm[1]);
        }
      }
    } catch {
      // continuar con los campos extraídos del HTML
    }
  }

  // 6. Construir FormData para enviar el formulario de /clipper/subir-clip
  const submitForm = new FormData();

  // Incluir hidden inputs ($ACTION_REF_1, $ACTION_1:0, etc.) si existen en el HTML
  for (const [k, v] of Object.entries(parsed.hiddenInputs)) {
    submitForm.append(k, v);
  }

  // Si no había hidden inputs pero encontramos un actionId en el chunk JS, agregamos cabecera o campos de acción
  if (Object.keys(parsed.hiddenInputs).length === 0 && actionIdFromChunk) {
    submitForm.append('$ACTION_REF_1', '');
    submitForm.append('$ACTION_1:0', JSON.stringify({ id: actionIdFromChunk, bound: '$@1' }));
    submitForm.append('$ACTION_1:1', '[null]');
  }

  // Poblar los nombres de campo detectados en el DOM + alias estándar usados en Clipearte
  const campaignFieldCandidates = new Set([
    ...parsed.fieldNames.selectNames,
    'campaign_id',
    'campaignId',
    'campaign',
    'campana_id',
  ]);
  for (const field of campaignFieldCandidates) {
    submitForm.set(field, matchedCampaign.id);
  }

  const platformFieldCandidates = new Set([
    'platform',
    'social_network',
    'network',
    'plataforma',
  ]);
  for (const field of platformFieldCandidates) {
    submitForm.set(field, normPlatform);
  }

  const accountFieldCandidates = new Set([
    ...parsed.fieldNames.radioNames,
    'account_id',
    'social_account_id',
    'clipper_account_id',
    'accountId',
    'socialAccountId',
    'account',
    'cuenta_id',
  ]);
  for (const field of accountFieldCandidates) {
    submitForm.set(field, matchedAccount.id);
  }
  submitForm.set('account_username', matchedAccount.username);
  submitForm.set('username', matchedAccount.username);

  const urlFieldCandidates = new Set([
    ...parsed.fieldNames.textNames,
    ...extraFieldNames.filter((n) => n.toLowerCase().includes('url') || n.toLowerCase().includes('link')),
    'url',
    'clip_url',
    'video_url',
    'post_url',
    'link',
    'clipUrl',
  ]);
  for (const field of urlFieldCandidates) {
    submitForm.set(field, clipUrl.trim());
  }

  // 7. Hacer POST a https://clipearte.com/clipper/subir-clip
  const postHeaders: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/x-component,*/*;q=0.8',
    Origin: CLIPEARTE_BASE_URL,
    Referer: CLIPEARTE_SUBMIT_URL,
    Cookie: serializeCookieJar(cookieJar),
  };

  const submitRes = await fetch(CLIPEARTE_SUBMIT_URL, {
    method: 'POST',
    headers: postHeaders,
    body: submitForm,
    redirect: 'manual',
  });

  const submitText = await submitRes.text().catch(() => '');

  // Verificar si hubo alerta de error explícita en la respuesta de Clipearte
  const alertMatch = submitText.match(/<p[^>]*role=["']alert["'][^>]*>([\s\S]*?)<\/p>/i);
  if (alertMatch) {
    const alertMsg = alertMatch[1].replace(/<[^>]+>/g, '').trim();
    if (
      alertMsg &&
      !alertMsg.toLowerCase().includes('exito') &&
      !alertMsg.toLowerCase().includes('éxito') &&
      !alertMsg.toLowerCase().includes('enviado') &&
      !alertMsg.toLowerCase().includes('revisión') &&
      !alertMsg.toLowerCase().includes('revision')
    ) {
      return {
        ok: false,
        error: `Clipearte respondió: ${alertMsg}`,
      };
    }
  }

  if (submitRes.status >= 400) {
    return {
      ok: false,
      error: `Error HTTP ${submitRes.status} al enviar el clip a Clipearte.`,
    };
  }

  // 8. Registrar en Supabase (tabla notificaciones) que este video ya fue monetizado en Clipearte
  const monetizadoEn = new Date().toISOString();
  if (videoId) {
    const db = getServerSupabase();
    if (db) {
      await db.from('notificaciones').upsert(
        {
          id: `clipearte_monetizado_${videoId}`,
          video_id: videoId,
          fecha_envio: monetizadoEn,
          origen: 'clipearte',
          confirmado: true,
        },
        { onConflict: 'id' }
      );
    }
  }

  return {
    ok: true,
    message: `Clip enviado para revisión en Clipearte (${matchedCampaign.name} · ${normPlatform.toUpperCase()} · ${matchedAccount.username}).`,
    matchedCampaign,
    matchedAccount,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || 'submit_clip';

    // Cargar credenciales desde body o desde Supabase ('clipearte_config')
    let email = (body.email || '').trim();
    let password = body.password || '';

    if (!email || !password) {
      const db = getServerSupabase();
      if (db) {
        const { data: row } = await db
          .from('configuracion_app')
          .select('alerta_plantilla_mensaje')
          .eq('id', 'clipearte_config')
          .maybeSingle();
        if (row?.alerta_plantilla_mensaje) {
          try {
            const parsedCfg = JSON.parse(row.alerta_plantilla_mensaje);
            if (!email && parsedCfg.clipearte_email) email = parsedCfg.clipearte_email.trim();
            if (!password && parsedCfg.clipearte_password) password = parsedCfg.clipearte_password;
          } catch {}
        }
      }
    }

    if (action === 'test_connection') {
      if (!email || !password) {
        return NextResponse.json(
          { ok: false, error: 'Ingresa tu correo y contraseña de Clipearte para probar la conexión.' },
          { status: 400 }
        );
      }
      const session = await loginAndLoadSubirClip(email, password);
      if (!session.ok) {
        return NextResponse.json({ ok: false, error: session.error }, { status: 401 });
      }
      return NextResponse.json({
        ok: true,
        message: 'Conexión exitosa con Clipearte.',
        campaigns: session.parsed.campaigns,
        accounts: session.parsed.accounts,
      });
    }

    // action === 'submit_clip'
    const result = await submitClipToClipearte({
      email,
      password,
      campaignName: body.campaignName || '',
      platform: body.platform || '',
      accountUsername: body.accountUsername || '',
      clipUrl: body.clipUrl || '',
      videoId: body.videoId,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[Clipearte API] Error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error interno al conectar con Clipearte.' },
      { status: 500 }
    );
  }
}

