import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";
import { RELANTERN_SYSTEM_INSTRUCTION } from '../constants';
import { PSM_SYSTEM_SUPPLEMENT } from '../../components/psm/PSMAdvisorPrompts';

// ── Backend AI Proxy Configuration ──────────────────────────
// When set, AI calls route through the server-side proxy (API key stays server-side).
// Falls back to direct Gemini client when proxy is unavailable.
const AI_PROXY_URL = import.meta.env.VITE_AI_PROXY_URL || '';
const USE_PROXY = !!AI_PROXY_URL;

// ── Direct Gemini Client (DEV-ONLY fallback) ────────────────
// SECURITY: When VITE_AI_PROXY_URL is set, the direct client is NEVER created.
// This ensures the Gemini API key is not bundled into the production build.
const _devApiKey = import.meta.env.VITE_GEMINI_API_KEY || '';

let _ai: GoogleGenAI | null = null;
const getAI = (): GoogleGenAI => {
  if (!_ai) {
    if (USE_PROXY) {
      // In production mode: never use the direct client
      console.info('[geminiService] Using backend AI proxy. Direct Gemini client disabled.');
      _ai = new GoogleGenAI({ apiKey: 'proxy-mode-no-key-needed' });
    } else if (!_devApiKey) {
      console.warn('[geminiService] ⚠️ Neither VITE_AI_PROXY_URL nor VITE_GEMINI_API_KEY is set. AI features will be unavailable.');
      _ai = new GoogleGenAI({ apiKey: 'not-configured' });
    } else {
      console.warn('[geminiService] ⚠️ Using DIRECT Gemini client (dev mode). Set VITE_AI_PROXY_URL for production.');
      _ai = new GoogleGenAI({ apiKey: _devApiKey });
    }
  }
  return _ai;
};

/**
 * Send a chat message through the backend AI proxy.
 * Returns the AI response text, or throws on error.
 */
export const proxyAIChat = async (
  prompt: string,
  module: string = 'general',
  context?: string,
  contextType?: string,
  temperature: number = 0.3,
): Promise<string> => {
  if (!AI_PROXY_URL) {
    throw new Error('AI proxy not configured');
  }

  const token = localStorage.getItem('ers_access_token') || '';
  const response = await fetch(`${AI_PROXY_URL}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt, module, context, context_type: contextType, temperature }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'AI proxy error' }));
    throw new Error(error.detail || `AI proxy error: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
};

/**
 * Send a structured analysis request through the backend AI proxy.
 * Returns raw JSON text for parseJSON<T> consumption.
 */
export const proxyAIAnalyze = async (
  prompt: string,
  module: string = 'general',
  actionType: string = 'analyze',
  contextType?: string,
  contextSummary?: string,
  temperature: number = 0.3,
): Promise<string> => {
  if (!AI_PROXY_URL) {
    throw new Error('AI proxy not configured');
  }

  const token = localStorage.getItem('ers_access_token') || '';
  const response = await fetch(`${AI_PROXY_URL}/ai/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      prompt,
      module,
      action_type: actionType,
      context_type: contextType,
      context_summary: contextSummary,
      temperature,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'AI proxy error' }));
    throw new Error(error.detail || `AI proxy error: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
};

/**
 * Send a multi-modal vision analysis request through the backend AI proxy.
 * Accepts base64-encoded image + text prompt for equipment defect detection.
 * Returns raw JSON text for parseJSON<T> consumption.
 */
export const proxyAIVision = async (
  imageBase64: string,
  mimeType: string,
  prompt: string,
  module: string = 'vision',
  temperature: number = 0.2,
): Promise<string> => {
  if (!AI_PROXY_URL) {
    throw new Error('AI proxy not configured');
  }

  const token = localStorage.getItem('ers_access_token') || '';
  const response = await fetch(`${AI_PROXY_URL}/ai/vision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      image_base64: imageBase64,
      mime_type: mimeType,
      prompt,
      module,
      temperature,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'AI vision proxy error' }));
    throw new Error(error.detail || `AI vision proxy error: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
};

/**
 * Send a RAG query through the backend AI proxy.
 * Routes questions through the document retrieval pipeline for OEM manual search.
 * Returns structured answer with source citations.
 */
export const proxyAIRAGQuery = async (
  query: string,
  equipmentClass?: string,
  assetTag?: string,
  topK: number = 5,
): Promise<{ answer: string; sources: { document: string; page?: number; excerpt: string; score: number }[] }> => {
  if (!AI_PROXY_URL) {
    throw new Error('AI proxy not configured');
  }

  const token = localStorage.getItem('ers_access_token') || '';
  const response = await fetch(`${AI_PROXY_URL}/ai/oem/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      equipment_class: equipmentClass,
      asset_tag: assetTag,
      top_k: topK,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'RAG query error' }));
    throw new Error(error.detail || `RAG query error: ${response.status}`);
  }

  return await response.json();
};

/** Whether the AI proxy is configured and available. */
export const isAIProxyEnabled = (): boolean => USE_PROXY;


export const createRelanternChat = (): Chat => {
  return getAI().chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: RELANTERN_SYSTEM_INSTRUCTION,
      temperature: 0.2, // Low temperature for factual, engineering responses
      topK: 40,
      thinkingConfig: { thinkingBudget: 4096 } // Expert reasoning enabled for data-first analysis
    },
  });
};

/**
 * Creates a PSM-specific chat session with process safety domain knowledge.
 * Combines the base Reliability Specialist instruction with the PSM supplement
 * covering OSHA 1910.119, IEC 61882/61511/61508, ISO 31000, CCPS, and SIL tables.
 * Optionally layers on a per-study-type persona supplement for specialized behavior.
 */
export const createPSMAdvisorChat = (studyContext?: string, personaSupplement?: string): Chat => {
  const psmInstruction = RELANTERN_SYSTEM_INSTRUCTION + '\n\n' + PSM_SYSTEM_SUPPLEMENT +
    (personaSupplement ? '\n\n' + personaSupplement : '') +
    (studyContext ? `\n\n═══ ACTIVE STUDY CONTEXT ═══\n${studyContext}` : '');

  return getAI().chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: psmInstruction,
      temperature: 0.2,
      topK: 40,
      thinkingConfig: { thinkingBudget: 4096 }
    },
  });
};

export const analyzeAssetData = async (assetContext: string): Promise<string> => {
  try {
    const response: GenerateContentResponse = await getAI().models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Analyze the following asset context and provide a reliability strategy summary (RCM based). Context: ${assetContext}`,
      config: {
        systemInstruction: RELANTERN_SYSTEM_INSTRUCTION,
      }
    });
    return response.text || "Unable to generate analysis.";
  } catch (error) {
    console.error("Analysis failed", error);
    return "Error generating analysis. Please check system logs.";
  }
};
