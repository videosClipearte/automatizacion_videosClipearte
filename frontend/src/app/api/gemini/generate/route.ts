// src/app/api/gemini/generate/route.ts
// Proxy servidor de Next.js para Google Gemini IA
// Evita restricciones de CORS del navegador, preflights OPTIONS y resuelve modelos dinámicamente
import { NextRequest, NextResponse } from 'next/server';
import { loadAppConfig } from '@/lib/services/appConfigService';

export const dynamic = 'force-dynamic';
// Permitir payloads de hasta 10MB para fotogramas de video
export const maxDuration = 60;

interface ModelInfo {
  version: 'v1' | 'v1beta';
  name: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let apiKey = (body.apiKey || '').trim();
    const preferredModel = (body.model || 'gemini-1.5-flash').replace(/^models\//, '').trim();
    const contents = body.contents;
    const systemInstruction = body.systemInstruction;
    const generationConfig = body.generationConfig || {
      temperature: 0.7,
      maxOutputTokens: 750,
    };

    // Si no se pasó apiKey desde el cliente, cargar de Supabase
    if (!apiKey) {
      const cfg = await loadAppConfig();
      apiKey = (cfg.gemini_api_key || '').trim();
    }

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

    // 1. Consultar en el servidor la lista de modelos disponibles para esta clave API
    const availableModels: ModelInfo[] = [];
    let listModelsError: string | null = null;

    for (const ver of ['v1', 'v1beta'] as const) {
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
        } else if (listData?.error?.message) {
          listModelsError = listData.error.message;
        }
      } catch (err: any) {
        listModelsError = err?.message;
      }
    }

    // 2. Determinar orden de modelos a intentar
    const attempts: ModelInfo[] = [];

    // Si el usuario especificó un modelo y está en los disponibles:
    if (preferredModel) {
      const exactFound = availableModels.find((m) => m.name === preferredModel);
      if (exactFound) {
        attempts.push(exactFound);
      } else {
        attempts.push({ version: 'v1', name: preferredModel });
        attempts.push({ version: 'v1beta', name: preferredModel });
      }
    }

    // Agregar todos los disponibles descubiertos en el servidor
    for (const av of availableModels) {
      if (!attempts.some((a) => a.version === av.version && a.name === av.name)) {
        attempts.push(av);
      }
    }

    // Fallbacks estándar si la lista vino vacía
    const fallbackList: ModelInfo[] = [
      { version: 'v1', name: 'gemini-1.5-flash' },
      { version: 'v1', name: 'gemini-2.0-flash' },
      { version: 'v1beta', name: 'gemini-2.0-flash' },
      { version: 'v1', name: 'gemini-1.5-pro' },
      { version: 'v1beta', name: 'gemini-1.5-flash-latest' },
      { version: 'v1beta', name: 'gemini-1.5-flash' },
      { version: 'v1beta', name: 'gemini-1.5-pro' },
    ];
    for (const fb of fallbackList) {
      if (!attempts.some((a) => a.version === fb.version && a.name === fb.name)) {
        attempts.push(fb);
      }
    }

    // 3. Ejecutar generateContent en el servidor
    let lastError = '';
    const requestPayload: any = {
      contents,
      generationConfig,
    };
    if (systemInstruction) {
      requestPayload.systemInstruction = systemInstruction;
    }

    for (const target of attempts) {
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
              availableModelsCount: availableModels.length,
            });
          }
        }

        const msg = data?.error?.message || '';
        // Si hay error de cuota o clave inválida (403), retornar directamente
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

    // 4. Si fallaron todos los intentos, devolver explicación y guía
    let helpfulError = lastError;
    if (availableModels.length === 0) {
      helpfulError = listModelsError
        ? `Error Gemini API: ${listModelsError}`
        : 'Tu API Key no tiene modelos de Gemini habilitados. Asegúrate de generar la API Key desde Google AI Studio (aistudio.google.com/app/apikey) o habilitar la "Generative Language API" en Google Cloud Console.';
    }

    return NextResponse.json({
      success: false,
      error: helpfulError,
      availableModels: availableModels.map((m) => `${m.version}/${m.name}`),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: `Error interno del servidor: ${error?.message || 'Fallo general'}` },
      { status: 500 }
    );
  }
}
