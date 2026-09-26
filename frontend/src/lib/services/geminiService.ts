// src/lib/services/geminiService.ts
import { VideoAnalysisPayload } from './videoCompressorService';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
}

export interface ExtractedSubtitlesJson {
  gancho_inicial?: string;
  subtitulos_detectados?: string[];
  tema_principal?: string;
  llamado_a_la_accion?: string;
  [key: string]: any;
}

export interface GeminiAnalysisResult {
  success: boolean;
  text: string;
  subtitlesJson?: ExtractedSubtitlesJson | null;
  usedModel?: string;
  error?: string;
}

const STORAGE_KEY = 'autopublish_gemini_config';

export function getStoredGeminiConfig(): GeminiConfig {
  if (typeof window !== 'undefined') {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { return JSON.parse(raw); } catch {}
    }
  }
  return {
    apiKey: '',
    model: 'gemini-3.8-flash',
    systemPrompt: 'Actúa como un experto en copywriting para redes sociales. Genera descripciones dinámicas, juveniles y llamativas con hashtags de tendencia.',
    temperature: 0.7,
  };
}

export function saveStoredGeminiConfig(config: GeminiConfig): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}

// Mapa de modelos retirados → sucesor activo oficial (basado en mensajes de error de Google 2025)
const RETIRED_MODEL_MAP: Record<string, string> = {
  'gemini-2.0-flash-lite':               'gemini-3.5-flash-lite',
  'gemini-2.5-flash':                    'gemini-3.8-flash',
  'gemini-2.5-flash-lite-preview-06-17': 'gemini-3.5-flash-lite',
  'gemini-1.5-flash':                    'gemini-3.5-flash',
  'gemini-1.5-flash-latest':             'gemini-3.5-flash',
  'gemini-1.5-pro':                      'gemini-3.8-flash',
};

/**
 * Limpia el texto devuelto por Gemini de cualquier JSON, bloques de código o encabezados.
 * Garantiza que el campo descripción siempre muestre texto publicable.
 */
function cleanCopyText(raw: string): string {
  return raw
    .replace(/```json[\s\S]*?```/gi, '')           // eliminar bloques ```json ... ```
    .replace(/```[\s\S]*?```/g, '')                 // eliminar otros bloques de código
    .replace(/^\s*\{[\s\S]*?\}\s*\n?/gm, '')        // eliminar objetos JSON inline
    .replace(/^---COPY---\s*/gm, '')                // eliminar separador ---COPY---
    .replace(/^\s*"?(gancho_inicial|subtitulos_detectados|tema_principal|llamado_a_la_accion)"?\s*[:\[{].*/gim, '')
    .replace(/^\s*(Descripci[oó]n|Copy|Resultado|Respuesta)\s*:\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')                     // máximo 2 saltos de línea consecutivos
    .trim();
}

/**
 * Ejecuta una petición directa a Google Gemini API.
 * Prueba el modelo configurado + fallbacks, en ambos endpoints v1 y v1beta.
 */
async function callGoogleGeminiDirect(
  apiKey: string,
  modelName: string,
  body: any
): Promise<GeminiAnalysisResult> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return {
      success: false,
      text: '',
      error: 'La API Key de Gemini es obligatoria. Ingrésala en Settings → Integraciones.',
    };
  }

  const rawModel = (modelName || 'gemini-3.8-flash').replace(/^models\//, '').trim();
  const resolvedModel = RETIRED_MODEL_MAP[rawModel] || rawModel;

  // Modelos en orden de preferencia (sin duplicados)
  const modelsToTry: string[] = [];
  for (const m of [
    resolvedModel,
    'gemini-3.8-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.0-flash',
  ]) {
    if (!modelsToTry.includes(m)) modelsToTry.push(m);
  }

  // Probar cada modelo en v1 y v1beta
  const apiVersions = ['v1', 'v1beta'];
  let lastErrorMessage = '';

  for (const currentModel of modelsToTry) {
    for (const apiVersion of apiVersions) {
      const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${currentModel}:generateContent?key=${cleanKey}`;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        let responseJson: any = null;
        try { responseJson = JSON.parse(await response.text()); } catch (e: any) {
          lastErrorMessage = `Respuesta no válida de la API (${response.status})`;
          continue;
        }

        if (response.ok) {
          const candidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            return {
              success: true,
              text: cleanCopyText(candidateText),
              usedModel: currentModel,
            };
          }
        }

        const errMsg = responseJson?.error?.message || `Error HTTP ${response.status}`;

        // API Key inválida → parar
        if (response.status === 403 || (response.status === 400 && errMsg.toLowerCase().includes('api key not valid'))) {
          return {
            success: false,
            text: '',
            error: 'Clave API de Gemini inválida. Genera una nueva en aistudio.google.com/app/apikey.',
          };
        }

        lastErrorMessage = errMsg;
        console.warn(`[Gemini] ${currentModel} (${apiVersion}): ${errMsg.slice(0, 120)}`);
      } catch (err: any) {
        lastErrorMessage = err?.message || 'Error de conexión';
        console.warn(`[Gemini] ${currentModel} (${apiVersion}) excepción: ${lastErrorMessage}`);
      }
    }
  }

  return {
    success: false,
    text: '',
    error: `Error Gemini (${resolvedModel}): ${lastErrorMessage || 'Ningún modelo respondió. Verifica tu API Key en aistudio.google.com.'}`,
  };
}

/**
 * Genera copy textual estándar (sin video) con Gemini.
 */
export async function generateWithGemini(
  apiKey: string,
  model: string,
  userPrompt: string,
  systemInstruction?: string,
  temperature: number = 0.7
): Promise<GeminiAnalysisResult> {
  const body: any = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature, maxOutputTokens: 1500 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  return callGoogleGeminiDirect(apiKey, model, body);
}

/**
 * Analiza fotogramas del video con Gemini Vision y genera el copy LIMPIO
 * listo para publicar según las reglas de campaña y plataforma.
 * Solo devuelve texto — sin JSON, sin separadores, sin encabezados.
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
): Promise<GeminiAnalysisResult> {
  const imageParts: any[] = videoPayload.frames.map((frameBase64) => ({
    inline_data: { mime_type: 'image/jpeg', data: frameBase64 },
  }));

  const userPrompt = `Analiza los fotogramas de este video (duración: ${videoPayload.durationSeconds}s, formato: ${videoPayload.aspectRatio}, título: "${videoTitle}").

Observa el contenido visual, los textos en pantalla, el estilo y el mensaje del video.

Escribe la descripción final para publicar en ${platform.toUpperCase()} siguiendo ESTRICTAMENTE estas reglas de campaña:
${campaignRules}

Hashtags OBLIGATORIOS a incluir: ${hashtags}

INSTRUCCIONES DE FORMATO — SEGUIR AL PIE DE LA LETRA:
✅ Devuelve ÚNICAMENTE el texto de la descripción, listo para copiar y pegar
✅ Usa emojis apropiados para ${platform.toUpperCase()}
✅ Incluye los hashtags al final
✅ Adapta el tono y estilo a ${platform.toUpperCase()}
❌ NO incluyas JSON, llaves, corchetes ni bloques de código
❌ NO incluyas encabezados como "Descripción:", "Copy:", "Aquí está:" ni similares
❌ NO incluyas comillas al inicio o al final del texto`.trim();

  imageParts.push({ text: userPrompt });

  const body: any = {
    contents: [{ role: 'user', parts: imageParts }],
    generationConfig: { temperature, maxOutputTokens: 1500 },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  return callGoogleGeminiDirect(apiKey, model, body);
}
