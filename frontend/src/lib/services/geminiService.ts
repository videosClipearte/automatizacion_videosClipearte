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

  // Modelos a probar en orden: primero el modelo elegido por el usuario, luego alternativas modernas
  const requestedModel = (modelName || 'gemini-2.0-flash').replace(/^models\//, '').trim();
  const modelsToTry: string[] = [requestedModel];

  // Alternativas si el modelo elegido no existe en la cuenta de Google del usuario
  // SOLO se usan modelos activos en v1beta (gemini-1.5-pro y gemini-1.5-flash fueron retirados)
  for (const alt of ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash-lite-preview-06-17', 'gemini-2.5-flash']) {
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
        lastErrorMessage = responseText.slice(0, 160) || `Error HTTP ${response.status}`;
        continue;
      }

      if (response.ok) {
        const candidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          let parsedSubtitles: ExtractedSubtitlesJson | null = null;
          let finalText = candidateText.trim();

          // Si es análisis de subtítulos, separar el bloque JSON y el copy final
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
            usedModel: currentModel,
          };
        }
      }

      const errMsg = responseJson?.error?.message || `Error HTTP ${response.status}`;

      if (
        response.status === 403 ||
        (response.status === 400 && errMsg.toLowerCase().includes('api key not valid'))
      ) {
        return {
          success: false,
          text: '',
          error: `Error Gemini: Clave API inválida o sin permisos. Genera una clave gratuita en Google AI Studio (aistudio.google.com/app/apikey).`,
        };
      }

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
