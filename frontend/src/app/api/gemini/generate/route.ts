// src/app/api/gemini/generate/route.ts
// Proxy servidor de Next.js para Google Gemini IA
// Respeta estrictamente el modelo seleccionado por el usuario en la configuración
import { NextRequest, NextResponse } from 'next/server';
import { loadAppConfig } from '@/lib/services/appConfigService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ModelInfo {
  version: 'v1' | 'v1beta';
  name: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let apiKey = (body.apiKey || '').trim();
    const contents = body.contents;
    const systemInstruction = body.systemInstruction;
    const generationConfig = body.generationConfig || {
      temperature: 0.7,
      maxOutputTokens: 750,
    };

    // 1. Cargar configuración fresca de Supabase
    const cfg = await loadAppConfig();
    if (!apiKey) {
      apiKey = (cfg.gemini_api_key || '').trim();
    }

    // El modelo elegido por el usuario en Settings tiene prioridad absoluta
    const selectedModel = (body.model || cfg.gemini_model || 'gemini-2.0-flash')
      .replace(/^models\//, '')
      .trim();

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'No se encontró la Gemini API Key. Configúrala en Settings → Integraciones.',
        },
        { status: 400 }
      );
    }

    if (!contents || !Array.isArray(contents)) {
      return NextResponse.json(
        { success: false, error: 'Falta el contenido (contents) de la petición.' },
        { status: 400 }
      );
    }

    const requestPayload: any = {
      contents,
      generationConfig,
    };
    if (systemInstruction) {
      requestPayload.systemInstruction = systemInstruction;
    }

    // 2. Probar PRIMERO el modelo seleccionado por el usuario (en v1beta y v1)
    // Los modelos modernos como gemini-2.0-flash y gemini-2.5-flash residen en v1beta
    const primaryAttempts: ModelInfo[] = [
      { version: 'v1beta', name: selectedModel },
      { version: 'v1', name: selectedModel },
    ];

    let lastError = '';

    for (const target of primaryAttempts) {
      const endpoint = `https://generativelanguage.googleapis.com/${target.version}/models/${target.name}:generateContent?key=${apiKey}`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        });

        const data = await response.json();

        if (response.ok) {
          const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            return NextResponse.json({
              success: true,
              text: candidateText.trim(),
              usedEndpoint: `${target.version}/${target.name}`,
              usedModel: target.name,
            });
          }
        }

        const msg = data?.error?.message || '';
        if (response.status === 403 || msg.toLowerCase().includes('api key not valid')) {
          return NextResponse.json({
            success: false,
            error: `Error Gemini API: ${msg}`,
          });
        }
        lastError = msg;
      } catch (err: any) {
        lastError = err?.message || 'Error de conexión';
      }
    }

    // 3. Si el modelo seleccionado falló con 404, consultar la lista de modelos disponibles en Google
    const availableModels: ModelInfo[] = [];
    for (const ver of ['v1beta', 'v1'] as const) {
      try {
        const listRes = await fetch(`https://generativelanguage.googleapis.com/${ver}/models?key=${apiKey}`);
        const listData = await listRes.json();
        if (listRes.ok && Array.isArray(listData.models)) {
          for (const m of listData.models) {
            if (Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent')) {
              const cleanName = m.name.replace(/^models\//, '');
              availableModels.push({ version: ver, name: cleanName });
            }
          }
        }
      } catch {}
    }

    for (const target of availableModels) {
      if (primaryAttempts.some((p) => p.version === target.version && p.name === target.name)) continue;

      const endpoint = `https://generativelanguage.googleapis.com/${target.version}/models/${target.name}:generateContent?key=${apiKey}`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        });

        const data = await response.json();

        if (response.ok) {
          const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            return NextResponse.json({
              success: true,
              text: candidateText.trim(),
              usedEndpoint: `${target.version}/${target.name}`,
              usedModel: target.name,
            });
          }
        }
      } catch {}
    }

    return NextResponse.json({
      success: false,
      error: `Error Gemini API con el modelo seleccionado "${selectedModel}": ${lastError || 'Modelo no disponible en tu cuenta de Google.'}`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: `Error interno del servidor: ${error?.message || 'Fallo general'}` },
      { status: 500 }
    );
  }
}
