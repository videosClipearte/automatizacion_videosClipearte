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
        return JSON.parse(raw);
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
 * Llama a la API oficial de Google Gemini para generar contenido de redes
 */
export async function generateWithGemini(
  apiKey: string,
  model: string,
  userPrompt: string,
  systemInstruction?: string,
  temperature: number = 0.7
): Promise<{ success: boolean; text: string; error?: string }> {
  try {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      return { success: false, text: '', error: 'La API Key de Gemini es obligatoria.' };
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;

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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || `Error HTTP ${response.status}`;
      return { success: false, text: '', error: `Error Gemini API: ${errMsg}` };
    }

    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText) {
      return { success: true, text: candidateText.trim() };
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
): Promise<{ success: boolean; text: string; error?: string }> {
  try {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      return { success: false, text: '', error: 'La API Key de Gemini es obligatoria.' };
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;

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

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || `Error HTTP ${response.status}`;
      return { success: false, text: '', error: `Error Gemini API: ${errMsg}` };
    }

    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidateText) {
      return { success: true, text: candidateText.trim() };
    } else {
      return { success: false, text: '', error: 'Respuesta vacía recibida del modelo Gemini tras analizar el video.' };
    }
  } catch (error: any) {
    return { success: false, text: '', error: `Fallo al analizar video con Gemini: ${error?.message || 'Error de red'}` };
  }
}
