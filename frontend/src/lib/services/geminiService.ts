// src/lib/services/geminiService.ts
import { VideoAnalysisPayload } from './videoCompressorService';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
}

const STORAGE_KEY = 'autopublish_gemini_config';
let cachedWorkingModel: string | null = null;

export function getStoredGeminiConfig(): GeminiConfig {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.model === 'gemini-1.5-flash') {
          parsed.model = 'gemini-2.0-flash';
        }
        return parsed;
      } catch (e) {
        console.error('Error parsing gemini config', e);
      }
    }
  }
  return {
    apiKey: '',
    model: 'gemini-2.0-flash',
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
 * Consulta la lista oficial de modelos habilitados para la clave API del usuario
 */
export async function getAvailableGeminiModels(apiKey: string): Promise<string[]> {
  try {
    const cleanKey = apiKey.trim();
    if (!cleanKey) return [];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data.models || [])
      .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m: any) => m.name.replace(/^models\//, ''));
    return models;
  } catch {
    return [];
  }
}

/**
 * Normaliza el modelo y ejecuta la petición con fallback automático si el modelo fue retirado
 */
async function fetchGeminiWithFallback(
  apiKey: string,
  preferredModel: string,
  body: any
): Promise<{ ok: boolean; data: any; usedModel: string }> {
  const cleanKey = apiKey.trim();

  let initial = (preferredModel || '').replace(/^models\//, '').trim();
  // gemini-1.5-flash fue retirado por Google; migrar automáticamente a gemini-2.0-flash
  if (!initial || initial === 'gemini-1.5-flash') {
    initial = cachedWorkingModel || 'gemini-2.0-flash';
  }

  // Lista ordenada de candidatos en caso de 404 o modelo no encontrado
  const candidates = [
    cachedWorkingModel,
    initial,
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash-001',
    'gemini-1.5-pro',
  ].filter((m, idx, self): m is string => Boolean(m) && self.indexOf(m) === idx);

  let lastErrorData: any = null;

  for (const candidate of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:generateContent?key=${cleanKey}`;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.ok) {
        cachedWorkingModel = candidate;
        return { ok: true, data, usedModel: candidate };
      }

      const errMsg = (data?.error?.message || '').toLowerCase();
      // Si el modelo está retirado o no se encuentra en v1beta, probar con el siguiente candidato
      if (response.status === 404 || errMsg.includes('not found') || errMsg.includes('not supported for generatecontent')) {
        lastErrorData = data;
        continue;
      }

      // Si es otro tipo de error (ej: API key inválida), retornar inmediatamente
      return { ok: false, data, usedModel: candidate };
    } catch (err: any) {
      lastErrorData = { error: { message: err?.message || 'Error de red' } };
    }
  }

  // Si ninguno de los candidatos estándar funcionó, consultar dinámicamente la lista de modelos de la API Key
  try {
    const liveModels = await getAvailableGeminiModels(cleanKey);
    const candidateLive = liveModels.find((m) => m.includes('flash')) || liveModels[0];
    if (candidateLive && !candidates.includes(candidateLive)) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${candidateLive}:generateContent?key=${cleanKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (response.ok) {
        cachedWorkingModel = candidateLive;
        return { ok: true, data, usedModel: candidateLive };
      }
      lastErrorData = data;
    }
  } catch {
    // ignorar
  }

  return { ok: false, data: lastErrorData, usedModel: initial };
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
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      return { success: false, text: '', error: 'La API Key de Gemini es obligatoria.' };
    }

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

    const result = await fetchGeminiWithFallback(cleanKey, model, body);

    if (!result.ok) {
      const errMsg = result.data?.error?.message || 'Error desconocido al invocar Gemini API';
      return { success: false, text: '', error: `Error Gemini API: ${errMsg}` };
    }

    const candidateText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText) {
      return { success: true, text: candidateText.trim(), usedModel: result.usedModel };
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
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      return { success: false, text: '', error: 'La API Key de Gemini es obligatoria.' };
    }

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

    const result = await fetchGeminiWithFallback(cleanKey, model, body);

    if (!result.ok) {
      const errMsg = result.data?.error?.message || 'Error desconocido al invocar Gemini API';
      return { success: false, text: '', error: `Error Gemini API: ${errMsg}` };
    }

    const candidateText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText) {
      return { success: true, text: candidateText.trim(), usedModel: result.usedModel };
    } else {
      return { success: false, text: '', error: 'Respuesta vacía recibida del modelo Gemini tras analizar el video.' };
    }
  } catch (error: any) {
    return { success: false, text: '', error: `Fallo al analizar video con Gemini: ${error?.message || 'Error de red'}` };
  }
}
