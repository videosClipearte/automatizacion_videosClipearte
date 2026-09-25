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
 * Llama a la API de Gemini a través del proxy del servidor Next.js (/api/gemini/generate)
 * para evitar restricciones de CORS del navegador, resolver modelos automáticamente y asegurar compatibilidad.
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
      apiKey,
      model,
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

    const res = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.success && data.text) {
      return { success: true, text: data.text, usedModel: data.usedEndpoint };
    }

    return {
      success: false,
      text: '',
      error: data.error || 'Error al generar descripción con Gemini.',
    };
  } catch (error: any) {
    return { success: false, text: '', error: `Fallo de conexión con el servidor: ${error?.message || 'Error de red'}` };
  }
}

/**
 * Llama a Gemini pasando la secuencia multimodal de fotogramas del video comprimido
 * a través del proxy del servidor Next.js para análisis visual sin problemas de CORS ni rechazos de preflight.
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
      apiKey,
      model,
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

    const res = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (data.success && data.text) {
      return { success: true, text: data.text, usedModel: data.usedEndpoint };
    }

    return {
      success: false,
      text: '',
      error: data.error || 'Error al analizar el video con Gemini.',
    };
  } catch (error: any) {
    return { success: false, text: '', error: `Fallo de conexión con el servidor: ${error?.message || 'Error de red'}` };
  }
}
