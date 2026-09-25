// src/lib/services/geminiService.ts
import { VideoAnalysisPayload } from './videoCompressorService';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
}

const STORAGE_KEY = 'autopublish_gemini_config';

interface ModelDiscovery {
  version: 'v1' | 'v1beta';
  model: string;
}

let cachedDiscovery: ModelDiscovery | null = null;

export function getStoredGeminiConfig(): GeminiConfig {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return parsed;
      } catch (e) {
        console.error('Error parsing gemini config', e);
      }
    }
  }
  return {
    apiKey: '',
    model: 'gemini-1.5-flash',
    systemPrompt: 'Actúa como un experto en copywriting para redes sociales. Genera descripciones dinámicas, juveniles y llamativas con hashtags de tendencia.',
    temperature: 0.7,
  };
}

export function saveStoredGeminiConfig(config: GeminiConfig): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}

/**
 * Consulta la lista oficial de modelos habilitados para la clave API del usuario,
 * probando tanto la versión estable (v1) como la versión beta (v1beta).
 */
export async function discoverAvailableGeminiModels(
  apiKey: string
): Promise<{ version: 'v1' | 'v1beta'; models: string[]; rawError?: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) return { version: 'v1', models: [] };

  let lastErr = '';
  // Probar v1 primero (estable para Google Cloud/AI Studio) y luego v1beta
  const versions: ('v1' | 'v1beta')[] = ['v1', 'v1beta'];

  for (const ver of versions) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${ver}/models?key=${cleanKey}`);
      const data = await res.json();

      if (res.ok && Array.isArray(data.models)) {
        const validModels = data.models
          .filter((m: any) =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent')
          )
          .map((m: any) => m.name.replace(/^models\//, ''));

        if (validModels.length > 0) {
          return { version: ver, models: validModels };
        }
      } else if (data?.error?.message) {
        lastErr = data.error.message;
      }
    } catch (e: any) {
      lastErr = e?.message || 'Error de red';
    }
  }

  return { version: 'v1', models: [], rawError: lastErr };
}

/**
 * Ejecuta una llamada a Gemini intentando resolver dinámicamente la versión de API (v1 vs v1beta)
 * y el modelo activo disponible para la clave del usuario.
 */
async function executeGeminiWithDynamicResolution(
  apiKey: string,
  preferredModel: string,
  body: any
): Promise<{ ok: boolean; data: any; usedEndpoint?: string; error?: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return { ok: false, data: null, error: 'La API Key de Gemini es obligatoria.' };
  }

  // 1. Si ya descubrimos un endpoint y modelo funcional previamente en esta sesión, probarlo primero
  if (cachedDiscovery) {
    const endpoint = `https://generativelanguage.googleapis.com/${cachedDiscovery.version}/models/${cachedDiscovery.model}:generateContent?key=${cleanKey}`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (response.ok) {
        return { ok: true, data, usedEndpoint: `${cachedDiscovery.version}/${cachedDiscovery.model}` };
      }
    } catch {
      // Fallback
    }
    cachedDiscovery = null;
  }

  // 2. Consultar la lista real de modelos disponibles para esta clave API mediante ListModels
  const discoveryResult = await discoverAvailableGeminiModels(cleanKey);
  if (discoveryResult.models.length > 0) {
    const ver = discoveryResult.version;
    const cleanPref = (preferredModel || '').replace(/^models\//, '').trim();

    // Prioridades de selección
    const targetModel =
      (cleanPref && discoveryResult.models.includes(cleanPref) ? cleanPref : null) ||
      (discoveryResult.models.find((m) => m === 'gemini-1.5-flash') ? 'gemini-1.5-flash' : null) ||
      (discoveryResult.models.find((m) => m === 'gemini-2.0-flash') ? 'gemini-2.0-flash' : null) ||
      (discoveryResult.models.find((m) => m.includes('flash')) ? discoveryResult.models.find((m) => m.includes('flash')) : null) ||
      discoveryResult.models[0];

    if (targetModel) {
      const endpoint = `https://generativelanguage.googleapis.com/${ver}/models/${targetModel}:generateContent?key=${cleanKey}`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (response.ok) {
          cachedDiscovery = { version: ver, model: targetModel };
          return { ok: true, data, usedEndpoint: `${ver}/${targetModel}` };
        }
      } catch (e) {
        console.warn(`Error invocando modelo descubierto ${targetModel}:`, e);
      }
    }
  }

  // 3. Cascada exhaustiva de combinaciones [versión, modelo]
  const cleanPref = (preferredModel || '').replace(/^models\//, '').trim();
  const combinations: { ver: 'v1' | 'v1beta'; model: string }[] = [];

  if (cleanPref) {
    combinations.push({ ver: 'v1', model: cleanPref });
    combinations.push({ ver: 'v1beta', model: cleanPref });
  }

  const standardPairs: { ver: 'v1' | 'v1beta'; model: string }[] = [
    { ver: 'v1', model: 'gemini-1.5-flash' },
    { ver: 'v1', model: 'gemini-2.0-flash' },
    { ver: 'v1beta', model: 'gemini-2.0-flash' },
    { ver: 'v1', model: 'gemini-1.5-pro' },
    { ver: 'v1beta', model: 'gemini-1.5-flash-latest' },
    { ver: 'v1beta', model: 'gemini-1.5-flash' },
    { ver: 'v1beta', model: 'gemini-1.5-pro' },
    { ver: 'v1', model: 'gemini-pro' },
  ];

  for (const pair of standardPairs) {
    if (!combinations.some((c) => c.ver === pair.ver && c.model === pair.model)) {
      combinations.push(pair);
    }
  }

  let lastApiError: string | null = null;

  for (const pair of combinations) {
    const endpoint = `https://generativelanguage.googleapis.com/${pair.ver}/models/${pair.model}:generateContent?key=${cleanKey}`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        cachedDiscovery = { version: pair.ver, model: pair.model };
        return { ok: true, data, usedEndpoint: `${pair.ver}/${pair.model}` };
      }

      const errMsg = data?.error?.message || '';
      // Si la API arroja un error definitivo de credenciales o permisos (403), guardarlo y salir
      if (response.status === 403 || errMsg.toLowerCase().includes('api key not valid') || errMsg.toLowerCase().includes('disabled')) {
        return { ok: false, data, error: `Error Gemini API: ${errMsg}` };
      }

      lastApiError = errMsg;
    } catch (err: any) {
      lastApiError = err?.message || 'Error de red';
    }
  }

  // 4. Si todo falló, construir mensaje de diagnóstico claro
  const diagnosticMsg = discoveryResult.rawError
    ? `Error Gemini API: ${discoveryResult.rawError}`
    : (lastApiError || 'No se encontró un modelo activo de Gemini en tu proyecto. Verifica que tu API Key tenga habilitada la "Generative Language API" en Google Cloud Console o genera una en Google AI Studio (aistudio.google.com).');

  return { ok: false, data: null, error: diagnosticMsg };
}

/**
 * Llama a la API oficial de Google Gemini para generar contenido de redes
 */
export async function generateWithGemini(
  apiKey: string,
  model: string,
  userPrompt: string,
  systemInstruction?: string,
  temperature: number = 0.7
): Promise<{ success: boolean; text: string; error?: string; usedModel?: string }> {
  try {
    const body: any = {
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: 600,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const result = await executeGeminiWithDynamicResolution(apiKey, model, body);

    if (!result.ok) {
      return { success: false, text: '', error: result.error || 'Fallo al invocar Gemini API.' };
    }

    const candidateText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText) {
      return { success: true, text: candidateText.trim(), usedModel: result.usedEndpoint };
    } else {
      return { success: false, text: '', error: 'Respuesta vacía recibida del modelo Gemini.' };
    }
  } catch (error: any) {
    return { success: false, text: '', error: `Fallo de conexión con Gemini: ${error?.message || 'Error de red'}` };
  }
}

/**
 * Llama a Gemini pasando la secuencia multimodal de fotogramas del video comprimido
 * para que la IA comprenda el tema, el gancho visual y redacte el copy cumpliendo las reglas de campaña.
 */
export async function generateDescriptionFromVideo(
  apiKey: string,
  model: string,
  videoPayload: VideoAnalysisPayload,
  videoTitle: string,
  campaignRules: string,
  platform: string,
  hashtags: string,
  systemInstruction?: string,
  temperature: number = 0.7
): Promise<{ success: boolean; text: string; error?: string; usedModel?: string }> {
  try {
    // Construir partes multimodales: fotogramas del video en orden cronológico
    const parts: any[] = videoPayload.frames.map((frameBase64) => ({
      inline_data: {
        mime_type: 'image/jpeg',
        data: frameBase64,
      },
    }));

    // Instrucción contextual para que Gemini analice el contenido visual y aplique reglas
    const userPrompt = `
Mira detenidamente la secuencia cronológica de fotogramas del video adjunto (duración aproximada: ${videoPayload.durationSeconds}s, aspecto: ${videoPayload.aspectRatio}, título propuesto: "${videoTitle}").

TAREA:
1. Analiza de qué trata el video (tema principal, acciones que se observan, ganchos visuales y tono general).
2. Redacta el COPY/DESCRIPCIÓN PERFECTO para publicar en la red social ${platform.toUpperCase()}, asegurando que enganche a la audiencia en los primeros segundos acorde a lo que pasa en el video.
3. Cumple OBLIGATORIAMENTE las siguientes directrices y reglas de la campaña:
${campaignRules}

4. Incluye de forma natural o al final estos hashtags obligatorios: ${hashtags}

IMPORTANTE: Devuelve SOLAMENTE el texto final de la publicación (listo para copiar y pegar), con emojis adecuados y sin títulos como "Descripción:" ni comillas.
`.trim();

    parts.push({ text: userPrompt });

    const body: any = {
      contents: [
        {
          role: 'user',
          parts,
        },
      ],
      generationConfig: {
        temperature: temperature,
        maxOutputTokens: 750,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const result = await executeGeminiWithDynamicResolution(apiKey, model, body);

    if (!result.ok) {
      return { success: false, text: '', error: result.error || 'Fallo al invocar Gemini API.' };
    }

    const candidateText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText) {
      return { success: true, text: candidateText.trim(), usedModel: result.usedEndpoint };
    } else {
      return { success: false, text: '', error: 'Respuesta vacía recibida del modelo Gemini tras analizar el video.' };
    }
  } catch (error: any) {
    return { success: false, text: '', error: `Fallo al analizar video con Gemini: ${error?.message || 'Error de red'}` };
  }
}
