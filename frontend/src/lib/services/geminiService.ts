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
  dialogo_completo?: string;
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

// ─── Mapa de modelos retirados → sucesor activo (fuente: mensajes de error de Google) ───
const RETIRED_MODEL_MAP: Record<string, string> = {
  'gemini-2.0-flash-lite':              'gemini-3.5-flash-lite',
  'gemini-2.5-flash':                   'gemini-3.8-flash',
  'gemini-2.5-flash-lite-preview-06-17':'gemini-3.5-flash-lite',
  'gemini-1.5-flash':                   'gemini-3.5-flash',
  'gemini-1.5-flash-latest':            'gemini-3.5-flash',
  'gemini-1.5-pro':                     'gemini-3.8-flash',
};

/**
 * Ejecuta una petición directa a Google Gemini API desde el navegador.
 * Prueba el modelo configurado + fallbacks en orden, en ambos endpoints (v1 y v1beta).
 */
async function callGoogleGeminiDirect(
  apiKey: string,
  modelName: string,
  body: any,
  isSubtitleAnalysis: boolean = false
): Promise<GeminiAnalysisResult> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    return {
      success: false,
      text: '',
      error: 'La API Key de Gemini es obligatoria. Ingrésala en Settings → Integraciones.',
    };
  }

  // Resolver el modelo configurado (reemplazar si está retirado)
  const rawModel = (modelName || 'gemini-3.8-flash').replace(/^models\//, '').trim();
  const resolvedModel = RETIRED_MODEL_MAP[rawModel] || rawModel;

  // Lista de modelos en orden de preferencia (sin duplicados)
  // Basada en los modelos que Google recomienda en sus propios mensajes de error 2025
  const modelsToTry: string[] = [];
  for (const m of [
    resolvedModel,
    'gemini-3.8-flash',        // sucesor oficial de gemini-2.5-flash
    'gemini-3.5-flash',        // versión flash estable 2025
    'gemini-3.5-flash-lite',   // sucesor oficial de gemini-2.0-flash-lite
    'gemini-2.0-flash',        // último recurso (puede seguir activo en algunas cuentas)
  ]) {
    if (!modelsToTry.includes(m)) modelsToTry.push(m);
  }

  // Probar cada modelo en ambas versiones de API (algunos modelos solo existen en una)
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

        const responseText = await response.text();
        let responseJson: any = null;

        try {
          responseJson = JSON.parse(responseText);
        } catch {
          lastErrorMessage = responseText.slice(0, 200) || `Error HTTP ${response.status}`;
          continue;
        }

        // ✅ Éxito
        if (response.ok) {
          const candidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText) {
            let parsedSubtitles: ExtractedSubtitlesJson | null = null;
            let finalText = candidateText.trim();

            if (isSubtitleAnalysis) {
              if (candidateText.includes('---COPY---')) {
                const parts = candidateText.split('---COPY---');
                const rawJson = parts[0].replace(/```json/gi, '').replace(/```/gi, '').trim();
                try {
                  parsedSubtitles = JSON.parse(rawJson);
                } catch {
                  parsedSubtitles = { dialogo_detectado: rawJson };
                }
                finalText = parts[1].trim();
              } else if (candidateText.includes('```json')) {
                const jsonMatch = candidateText.match(/```json([\s\S]*?)```/i);
                if (jsonMatch) {
                  try {
                    parsedSubtitles = JSON.parse(jsonMatch[1].trim());
                    finalText = candidateText.replace(jsonMatch[0], '').trim();
                  } catch {}
                }
              }
            }

            return {
              success: true,
              text: finalText,
              subtitlesJson: parsedSubtitles,
              usedModel: `${currentModel}`,
            };
          }
        }

        const errMsg = responseJson?.error?.message || `Error HTTP ${response.status}`;

        // API Key inválida → parar inmediatamente
        if (
          response.status === 403 ||
          (response.status === 400 && errMsg.toLowerCase().includes('api key not valid'))
        ) {
          return {
            success: false,
            text: '',
            error: `Clave API de Gemini inválida o sin permisos. Genera una clave gratuita en aistudio.google.com/app/apikey.`,
          };
        }

        lastErrorMessage = errMsg;
        console.warn(`[Gemini] ${currentModel} (${apiVersion}): ${errMsg.slice(0, 120)}`);
      } catch (err: any) {
        lastErrorMessage = err?.message || 'Error de conexión con Google Gemini';
        console.warn(`[Gemini] ${currentModel} (${apiVersion}) excepción: ${lastErrorMessage}`);
      }
    }
  }

  return {
    success: false,
    text: '',
    error: `Error Gemini (${resolvedModel}): ${lastErrorMessage || 'Ningún modelo disponible respondió. Verifica tu API Key en aistudio.google.com.'}`,
  };
}

/**
 * Llama a la API oficial de Google Gemini para redactar copy textual estándar
 */
export async function generateWithGemini(
  apiKey: string,
  model: string,
  userPrompt: string,
  systemInstruction?: string,
  temperature: number = 0.7
): Promise<GeminiAnalysisResult> {
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

  return callGoogleGeminiDirect(apiKey, model, body, false);
}

/**
 * Flujo integrado de Extracción de Subtítulos a JSON + Análisis de Video + Redacción:
 * 1. Extrae todos los subtítulos, diálogos y textos del video en un bloque JSON estructurado.
 * 2. Analiza el JSON y redacta la descripción perfecta para la red social respetando las reglas de campaña.
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
  const parts: any[] = videoPayload.frames.map((frameBase64) => ({
    inline_data: {
      mime_type: 'image/jpeg',
      data: frameBase64,
    },
  }));

  const userPrompt = `
Analiza detenidamente la secuencia cronológica de fotogramas del video adjunto (duración aproximada: ${videoPayload.durationSeconds}s, aspecto: ${videoPayload.aspectRatio}, título propuesto: "${videoTitle}").

REALIZA ESTE FLUJO DE TRABAJO OBLIGATORIO:

PASO 1: EXTRACCIÓN DE SUBTÍTULOS Y DIÁLOGO A JSON
- Lee y transcribe todos los textos, subtítulos en pantalla y diálogos que aparecen a lo largo del video.
- Sintetiza la información en un objeto JSON estructurado con:
  • "gancho_inicial": La primera frase o gancho impactante con el que abre el video.
  • "subtitulos_detectados": Array con las frases o líneas de subtítulos en orden cronológico.
  • "tema_principal": El tema central y el valor o mensaje que transmite el video.
  • "llamado_a_la_accion": La acción que se le pide a la audiencia (comentar, compartir, seguir, etc.).

PASO 2: REDACCIÓN DE DESCRIPCIÓN CON BASE EN LOS SUBTÍTULOS EXTRAÍDOS
- Con base ESTRICTAMENTE en el diálogo y subtítulos identificados en el JSON anterior:
- Redacta el COPY/DESCRIPCIÓN perfecto para publicar en la red social ${platform.toUpperCase()}.
- Cumple OBLIGATORIAMENTE las siguientes reglas y directrices de la campaña:
${campaignRules}
- Incluye de forma natural o al final estos hashtags obligatorios: ${hashtags}

FORMATO DE RESPUESTA OBLIGATORIO:
Devuelve tu respuesta EXACTAMENTE con este formato separado por la etiqueta '---COPY---':

\`\`\`json
{
  "gancho_inicial": "Texto del gancho inicial aquí",
  "subtitulos_detectados": ["Línea 1...", "Línea 2...", "Línea 3..."],
  "tema_principal": "Tema principal aquí",
  "llamado_a_la_accion": "Llamado a la acción aquí"
}
\`\`\`
---COPY---
[Aquí escribe SOLAMENTE el texto final de la descripción listo para publicar, con emojis adecuados y los hashtags obligatorios, sin títulos como "Descripción:" ni comillas]
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
      maxOutputTokens: 900,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  return callGoogleGeminiDirect(apiKey, model, body, true);
}
