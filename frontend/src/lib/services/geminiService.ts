// src/lib/services/geminiService.ts
import { VideoAnalysisPayload } from './videoCompressorService';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
}

const STORAGE_KEY = 'autopublish_gemini_config';

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
 * Ejecuta una petición directa y segura a Google Gemini API desde el navegador
 * sin límites de tiempo de servidores intermedios (como Vercel 504 Gateway Timeout).
 */
async function callGoogleGeminiDirect(
  apiKey: string,
  modelName: string,
  body: any
): Promise<{ success: boolean; text: string; error?: string; usedModel?: string }> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return {
      success: false,
      text: '',
      error: 'La API Key de Gemini es obligatoria. Ingrésala en Settings → Integraciones.',
    };
  }

  // Modelos a probar en orden: primero el modelo elegido por el usuario, luego alternativas modernas
  const requestedModel = (modelName || 'gemini-2.0-flash').replace(/^models\//, '').trim();
  const modelsToTry: string[] = [requestedModel];

  // Alternativas si el modelo elegido no existe en la cuenta de Google del usuario
  for (const alt of ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-pro']) {
    if (!modelsToTry.includes(alt)) {
      modelsToTry.push(alt);
    }
  }

  let lastErrorMessage = '';

  for (const currentModel of modelsToTry) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${cleanKey}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      let responseJson: any = null;

      try {
        responseJson = JSON.parse(responseText);
      } catch {
        // Respuesta no es JSON (ej. error 502/504 de red)
        lastErrorMessage = responseText.slice(0, 160) || `Error HTTP ${response.status}`;
        continue;
      }

      if (response.ok) {
        const candidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          return {
            success: true,
            text: candidateText.trim(),
            usedModel: currentModel,
          };
        }
      }

      const errMsg = responseJson?.error?.message || `Error HTTP ${response.status}`;

      // Si la API key es inválida o está deshabilitada (error 400/403 de autenticación), salir de inmediato
      if (
        response.status === 403 ||
        response.status === 400 && errMsg.toLowerCase().includes('api key not valid')
      ) {
        return {
          success: false,
          text: '',
          error: `Error Gemini: Clave API inválida o sin permisos. Genera una clave gratuita en Google AI Studio (aistudio.google.com/app/apikey).`,
        };
      }

      // Si es 404 (modelo no encontrado en esta cuenta), probar el siguiente modelo
      lastErrorMessage = errMsg;
    } catch (err: any) {
      lastErrorMessage = err?.message || 'Error de conexión con Google Gemini';
    }
  }

  return {
    success: false,
    text: '',
    error: `Error Gemini API (${requestedModel}): ${lastErrorMessage || 'No se pudo conectar con el servicio de IA.'}`,
  };
}

/**
 * Llama a la API oficial de Google Gemini para redactar copy textual
 */
export async function generateWithGemini(
  apiKey: string,
  model: string,
  userPrompt: string,
  systemInstruction?: string,
  temperature: number = 0.7
): Promise<{ success: boolean; text: string; error?: string; usedModel?: string }> {
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

  return callGoogleGeminiDirect(apiKey, model, body);
}

/**
 * Llama a Gemini pasando la secuencia multimodal de fotogramas del video comprimido
 * directamente desde el navegador a Google para análisis visual ultrarrápido y sin timeouts.
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
  // Construir partes multimodales cronológicas
  const parts: any[] = videoPayload.frames.map((frameBase64) => ({
    inline_data: {
      mime_type: 'image/jpeg',
      data: frameBase64,
    },
  }));

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

  return callGoogleGeminiDirect(apiKey, model, body);
}
