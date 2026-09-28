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
    model: 'gemini-2.0-flash-latest',
    systemPrompt: 'Actua como un experto en copywriting para redes sociales. Genera descripciones dinamicas, juveniles y llamativas con hashtags de tendencia.',
    temperature: 0.7,
  };
}

export function saveStoredGeminiConfig(config: GeminiConfig): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}

// Mapa de modelos retirados -> sucesor activo oficial
const RETIRED_MODEL_MAP: Record<string, string> = {
  'gemini-2.0-flash':                    'gemini-2.0-flash-latest',
  'gemini-2.0-flash-lite':               'gemini-2.0-flash-latest',
  'gemini-2.5-flash':                    'gemini-2.0-flash-latest',
  'gemini-2.5-flash-lite-preview-06-17': 'gemini-2.0-flash-latest',
  'gemini-1.5-flash':                    'gemini-2.0-flash-latest',
  'gemini-1.5-flash-latest':             'gemini-2.0-flash-latest',
  'gemini-1.5-pro':                      'gemini-2.0-flash-latest',
  'gemini-3.8-flash':                    'gemini-2.0-flash-latest',
  'gemini-3.5-flash':                    'gemini-2.0-flash-latest',
  'gemini-3.5-flash-lite':               'gemini-2.0-flash-latest',
};

/**
 * Limpia el texto devuelto por Gemini de JSON, bloques de codigo o encabezados.
 */
function cleanCopyText(raw: string): string {
  return raw
    .replace(/```json[\s\S]*?```/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*\{[\s\S]*?\}\s*\n?/gm, '')
    .replace(/^---COPY---\s*/gm, '')
    .replace(/^\s*"?(gancho_inicial|subtitulos_detectados|tema_principal|llamado_a_la_accion)"?\s*[:\[{].*/gim, '')
    .replace(/^\s*(Descripci[oo]n|Copy|Resultado|Respuesta)\s*:\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Obtiene la lista de modelos disponibles para esta API key.
 */
async function listAvailableModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=50`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const models: string[] = (json.models ?? [])
      .filter((m: any) =>
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m: any) => (m.name as string).replace('models/', ''));
    return models;
  } catch {
    return [];
  }
}

/**
 * Ejecuta una peticion directa a Google Gemini API.
 * Prueba el modelo configurado, luego descubre dinamicamente los disponibles.
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
      error: 'La API Key de Gemini es obligatoria. Ingresala en Settings -> Integraciones.',
    };
  }

  const rawModel = (modelName || 'gemini-2.0-flash-latest').replace(/^models\//, '').trim();
  const resolvedModel = RETIRED_MODEL_MAP[rawModel] ?? rawModel;

  const KNOWN_MODELS = [
    resolvedModel,
    'gemini-2.0-flash-latest',
    'gemini-2.0-flash',
    'gemini-2.5-flash-preview-05-20',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-1.5-pro-latest',
  ];

  const modelsToTry: string[] = [];
  for (const m of KNOWN_MODELS) {
    if (m && !modelsToTry.includes(m)) modelsToTry.push(m);
  }

  const apiVersions = ['v1beta', 'v1'];
  let lastErrorMessage = '';
  let allModelsNotFound = true;

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
          lastErrorMessage = `Respuesta no valida de la API (${response.status})`;
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

        if (response.status === 403 || (response.status === 400 && errMsg.toLowerCase().includes('api key not valid'))) {
          return {
            success: false,
            text: '',
            error: 'Clave API de Gemini invalida. Genera una nueva en aistudio.google.com/app/apikey.',
          };
        }

        const isNotFound = response.status === 404 || errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('no longer available');
        if (!isNotFound) allModelsNotFound = false;

        lastErrorMessage = errMsg;
        console.warn(`[Gemini] ${currentModel} (${apiVersion}): ${errMsg.slice(0, 120)}`);
      } catch (err: any) {
        lastErrorMessage = err?.message || 'Error de conexion';
        console.warn(`[Gemini] ${currentModel} (${apiVersion}) excepcion: ${lastErrorMessage}`);
      }
    }
  }

  if (allModelsNotFound) {
    console.warn('[Gemini] Todos los modelos conocidos fallaron. Consultando lista dinamica...');
    const availableModels = await listAvailableModels(cleanKey);
    const flashModels = availableModels.filter(m => m.includes('flash'));
    const dynamicList = flashModels.length > 0 ? flashModels : availableModels.slice(0, 3);

    for (const currentModel of dynamicList) {
      if (modelsToTry.includes(currentModel)) continue;
      for (const apiVersion of ['v1beta', 'v1']) {
        const endpoint = `https://generativelanguage.googleapis.com/${apiVersion}/models/${currentModel}:generateContent?key=${cleanKey}`;
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          let responseJson: any = null;
          try { responseJson = JSON.parse(await response.text()); } catch { continue; }
          if (response.ok) {
            const candidateText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (candidateText) {
              return { success: true, text: cleanCopyText(candidateText), usedModel: currentModel };
            }
          }
          const errMsg = responseJson?.error?.message || `Error HTTP ${response.status}`;
          lastErrorMessage = errMsg;
        } catch (err: any) {
          lastErrorMessage = err?.message || 'Error de conexion';
        }
      }
    }

    if (dynamicList.length === 0) {
      lastErrorMessage = 'No se encontraron modelos disponibles para tu API Key. Verifica los permisos en aistudio.google.com.';
    }
  }

  return {
    success: false,
    text: '',
    error: `Error Gemini (${resolvedModel}): ${lastErrorMessage || 'Ningun modelo respondio. Verifica tu API Key en aistudio.google.com.'}`,
  };
}

/**
 * Genera copy textual estandar (sin video) con Gemini.
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
    generationConfig: { temperature, maxOutputTokens: 500 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  return callGoogleGeminiDirect(apiKey, model, body);
}

/**
 * NUEVO (rapido): Envia el audio del video a Gemini.
 * Gemini transcribe el habla y genera la descripcion con las reglas de campana
 * en UNA SOLA llamada API. Sin fotogramas. Tiempo estimado: 1.5-4 segundos.
 */
export async function generateDescriptionFromAudio(
  apiKey: string,
  model: string,
  audioBase64: string,
  audioMimeType: string,
  videoTitle: string,
  campaignRules: string,
  platform: string,
  hashtags: string,
  systemInstruction?: string,
  temperature: number = 0.7
): Promise<GeminiAnalysisResult> {
  const userPrompt = `Escucha el audio de este video titulado "${videoTitle}".

1. Identifica el dialogo o subtitulos hablados (maximo 3 lineas de contexto).
2. Usando esa transcripcion como contexto, redacta la descripcion final para publicar en ${platform.toUpperCase()}.

REGLAS OBLIGATORIAS DE CAMPANA:
${campaignRules}

Hashtags OBLIGATORIOS: ${hashtags}

FORMATO DE RESPUESTA:
Devuelve UNICAMENTE el texto de la descripcion lista para publicar.
Usa emojis apropiados para ${platform.toUpperCase()}.
Incluye los hashtags al final.
NO pongas "Transcripcion:", "Descripcion:", JSON, ni bloques de codigo.
NO pongas comillas al inicio o al final.`.trim();

  const body: any = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: audioMimeType, data: audioBase64 } },
        { text: userPrompt },
      ],
    }],
    generationConfig: { temperature, maxOutputTokens: 500 },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  return callGoogleGeminiDirect(apiKey, model, body);
}

/**
 * LEGACY: Analiza fotogramas del video con Gemini Vision.
 * Fallback si el audio no esta disponible.
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

  const userPrompt = `Analiza los fotogramas del video titulado "${videoTitle}".
Escribe la descripcion para publicar en ${platform.toUpperCase()} siguiendo ESTAS REGLAS:
${campaignRules}
Hashtags OBLIGATORIOS: ${hashtags}
Devuelve UNICAMENTE el texto listo para publicar, sin encabezados, sin comillas, sin JSON.`.trim();

  imageParts.push({ text: userPrompt });

  const body: any = {
    contents: [{ role: 'user', parts: imageParts }],
    generationConfig: { temperature, maxOutputTokens: 500 },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  return callGoogleGeminiDirect(apiKey, model, body);
}
