/**
 * RCMService — Supabase CRUD + AI for Reliability Centered Maintenance
 *
 * Tables: ers_rcm_studies, ers_rcm_functions, ers_rcm_failure_modes, ers_rcm_decisions
 * Integration: assets, dictionaries, ers_fmea_items, recurring_work, work_orders, wo_failure_data
 * AI: Gemini-powered FMEA auto-populate, decision advisor, strategy optimizer
 *       Routes through backend AI proxy (API key server-side) with direct fallback.
 *
 * Standards: SAE JA1011/JA1012, IEC 60300-3-11
 */
import { supabase } from '../lib/supabase';
import { RELANTERN_SYSTEM_INSTRUCTION } from '../constants';
import { proxyAIAnalyze, isAIProxyEnabled } from './geminiService';
import { buildPMStrategy } from '../lib/pmStrategy';
import {
  buildPMFromDecision, normalizeRecommendation, pmCodeFor, strategyProducesPM,
  type AIRecommendation,
} from './rcmPlan';

export type { AIRecommendation } from './rcmPlan';

// ─── Types ───────────────────────────────────────────────────

export interface RCMStudy {
  id: string;
  asset_id: string | null;
  title: string;
  operating_context: string | null;
  status: 'draft' | 'in_progress' | 'review' | 'approved' | 'closed';
  study_type: 'classical' | 'streamlined' | 'back_to_basics';
  facilitator: string | null;
  approved_by: string | null;
  approved_at: string | null;
  criticality_rank: string | null;
  rcm_source: 'new' | 'imported_fmea' | 'ai_generated';
  ai_confidence: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields (not in DB)
  asset_name?: string;
  asset_tag?: string;
  functions_count?: number;
  failure_modes_count?: number;
  decisions_count?: number;
  completion_pct?: number;
}

export interface RCMFunction {
  id: string;
  study_id: string;
  function_number: string;
  function_description: string;
  performance_standard: string | null;
  function_type: 'primary' | 'secondary' | 'protective';
  functional_failure: string | null;
  failure_code: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Nested
  failure_modes?: RCMFailureMode[];
}

export interface RCMFailureMode {
  id: string;
  function_id: string;
  fmea_item_id: string | null;
  failure_mode_code: string | null;
  failure_mode_description: string;
  failure_cause_code: string | null;
  failure_cause_description: string | null;
  failure_effect_local: string | null;
  failure_effect_system: string | null;
  failure_effect_plant: string | null;
  end_effect: string | null;
  severity: number | null;
  occurrence: number | null;
  detection: number | null;
  rpn: number | null;
  historical_wo_count: number;
  historical_mtbf_days: number | null;
  data_source: 'manual' | 'fmea_import' | 'wo_history' | 'ai_generated';
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Nested
  decision?: RCMDecision;
}

export interface RCMDecision {
  id: string;
  failure_mode_id: string;
  is_hidden_failure: boolean;
  consequence_code: string | null;
  consequence_description: string | null;
  on_condition_task: string | null;
  on_condition_interval: string | null;
  on_condition_applicable: boolean | null;
  on_condition_technology: string | null;
  scheduled_restoration_task: string | null;
  restoration_interval: string | null;
  restoration_applicable: boolean | null;
  scheduled_discard_task: string | null;
  discard_interval: string | null;
  discard_applicable: boolean | null;
  failure_finding_task: string | null;
  failure_finding_interval: string | null;
  failure_finding_applicable: boolean | null;
  recommended_strategy_code: string | null;
  task_description: string | null;
  task_interval: string | null;
  task_type_code: string | null;
  task_owner_craft: string | null;
  justification: string | null;
  ai_recommendation: AIRecommendation | null;
  recurring_work_id: string | null;
  spares_requirements: SpareRequirement[];
  created_at: string;
  updated_at: string;
}

export interface SpareRequirement {
  part_number: string;
  description?: string;
  qty: number;
  lead_time?: string;
}

export interface RCMTaskSummary {
  failure_mode_id: string;
  failure_mode_description: string;
  function_description: string;
  consequence_code: string | null;
  recommended_strategy_code: string | null;
  task_description: string | null;
  task_interval: string | null;
  task_type_code: string | null;
  task_owner_craft: string | null;
  spares_requirements: SpareRequirement[];
  recurring_work_id: string | null;
}

// ─── AI Setup ────────────────────────────────────────────────
// SECURITY: In production, AI calls route through the backend proxy.
// The direct Gemini client is a DEV-ONLY fallback.
// @google/genai is loaded lazily via dynamic import() — zero cost if proxy is used.

// DEV-gated like AIAnalysisEngine / AuditAssessor / geminiService: never let a
// prod env var inline the raw key into the shipped bundle (launch review).
const _devApiKey = import.meta.env.DEV ? (import.meta.env.VITE_GEMINI_API_KEY || '') : '';
const _proxyConfigured = !!import.meta.env.VITE_AI_PROXY_URL;

let _genaiModule: typeof import('@google/genai') | null = null;
let _ai: InstanceType<typeof import('@google/genai').GoogleGenAI> | null = null;

const getAI = async () => {
  if (!_ai) {
    if (!_genaiModule) {
      _genaiModule = await import('@google/genai');
    }
    const { GoogleGenAI } = _genaiModule;
    const keyToUse = (!_proxyConfigured && _devApiKey) ? _devApiKey : 'not-configured';
    _ai = new GoogleGenAI({ apiKey: keyToUse });
  }
  return _ai;
};

/** Whether we have any AI capability (proxy or dev key). */
const isAIAvailable = (): boolean => isAIProxyEnabled() || (!_proxyConfigured && !!_devApiKey);

const RCM_SYSTEM_INSTRUCTION = RELANTERN_SYSTEM_INSTRUCTION + `

═══ RCM SPECIALIST SUPPLEMENT ═══
You are an expert in Reliability Centered Maintenance per SAE JA1011/JA1012.
You must:
1. Follow the 7 RCM questions framework strictly.
2. Use ISO 14224 failure coding for failure modes and causes.
3. Consider all 4 task types: On-Condition, Scheduled Restoration, Scheduled Discard, Failure-Finding.
4. Apply consequence categories: Safety/Environmental, Operational, Non-Operational, Hidden.
5. Justify every strategy recommendation with cost-benefit reasoning.
6. When suggesting intervals, reference P-F interval theory and industry data (OREDA 6th Ed).
7. Always output structured JSON when requested.
`;

/**
 * RCM-specific Gemini call — proxy-first with direct fallback.
 * For structured JSON responses (all RCM AI methods).
 */
async function callRCMGemini(prompt: string, temperature: number = 0.3): Promise<string> {
  // Path 1: Backend proxy (production)
  if (isAIProxyEnabled()) {
    try {
      return await proxyAIAnalyze(
        prompt, 'rcm', 'analyze', undefined,
        undefined, temperature
      );
    } catch (proxyError: unknown) {
      const msg = proxyError instanceof Error ? proxyError.message : String(proxyError);
      console.warn('[RCMService] Proxy call failed, falling back to direct:', msg);
      if (!_devApiKey || _proxyConfigured) {
        return JSON.stringify({ error: msg });
      }
    }
  }

  // Path 2: Direct Gemini (development/fallback — never used when proxy is configured)
  if (!_devApiKey || _proxyConfigured) return JSON.stringify({ error: 'AI not configured. Set VITE_AI_PROXY_URL or VITE_GEMINI_API_KEY.' });
  try {
    const ai = await getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: RCM_SYSTEM_INSTRUCTION,
        temperature,
      },
    });
    let text: string | undefined;
    try { text = response?.text; } catch { text = undefined; }
    if (!text) {
      try {
        const part = response?.candidates?.[0]?.content?.parts?.[0];
        text = (part as { text?: string })?.text;
      } catch { /* ignore */ }
    }
    return text || '{}';
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    console.error('[RCMService] Gemini call failed:', raw);
    let friendly = 'AI analysis temporarily unavailable.';
    if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('quota')) {
      friendly = '⚠️ Gemini API quota exceeded. Please wait a few minutes.';
    } else if (raw.includes('API_KEY') || raw.includes('401') || raw.includes('403')) {
      friendly = '⚠️ Invalid or missing API key. Check configuration.';
    }
    return JSON.stringify({ error: friendly });
  }
}

// ─── Completion ──────────────────────────────────────────────

/**
 * Study completion %: 20% functions defined, 20% failure modes captured,
 * 30% consequences classified (Q5), 30% strategies selected (Q6–Q7).
 */
export function computeCompletionPct(
  fnCount: number, fmCount: number, decidedCount: number, strategyCount: number,
): number {
  if (fnCount === 0) return 0;
  const decidedRatio = fmCount > 0 ? decidedCount / fmCount : 0;
  const strategyRatio = fmCount > 0 ? strategyCount / fmCount : 0;
  return Math.round(20 + (fmCount > 0 ? 20 : 0) + 30 * decidedRatio + 30 * strategyRatio);
}

// ─── Service ─────────────────────────────────────────────────

class RCMServiceImpl {

  // ─── Studies CRUD ────────────────────────────────────────

  async getStudies(): Promise<RCMStudy[]> {
    const { data, error } = await supabase
      .from('ers_rcm_studies')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) { console.error('[RCM] getStudies error:', error); return []; }
    const studies = (data || []) as RCMStudy[];
    if (studies.length === 0) return studies;

    // Enrich with real completion % (three batched selects, aggregated client-side)
    try {
      const { data: fns } = await supabase
        .from('ers_rcm_functions')
        .select('id, study_id')
        .in('study_id', studies.map(s => s.id));
      const fnList = fns || [];
      const fnToStudy = new Map(fnList.map(f => [f.id, f.study_id]));

      let fmList: { id: string; function_id: string }[] = [];
      if (fnList.length > 0) {
        const { data: fms } = await supabase
          .from('ers_rcm_failure_modes')
          .select('id, function_id')
          .in('function_id', fnList.map(f => f.id));
        fmList = fms || [];
      }
      const fmToStudy = new Map(fmList.map(fm => [fm.id, fnToStudy.get(fm.function_id)]));

      let decList: { failure_mode_id: string; consequence_code: string | null; recommended_strategy_code: string | null }[] = [];
      if (fmList.length > 0) {
        const { data: decs } = await supabase
          .from('ers_rcm_decisions')
          .select('failure_mode_id, consequence_code, recommended_strategy_code')
          .in('failure_mode_id', fmList.map(fm => fm.id));
        decList = decs || [];
      }

      const counts = new Map<string, { fn: number; fm: number; decided: number; strategy: number }>();
      const bump = (studyId: string | undefined, key: 'fn' | 'fm' | 'decided' | 'strategy') => {
        if (!studyId) return;
        const c = counts.get(studyId) || { fn: 0, fm: 0, decided: 0, strategy: 0 };
        c[key]++;
        counts.set(studyId, c);
      };
      fnList.forEach(f => bump(f.study_id, 'fn'));
      fmList.forEach(fm => bump(fmToStudy.get(fm.id), 'fm'));
      decList.forEach(d => {
        if (d.consequence_code) bump(fmToStudy.get(d.failure_mode_id), 'decided');
        if (d.recommended_strategy_code) bump(fmToStudy.get(d.failure_mode_id), 'strategy');
      });

      studies.forEach(s => {
        const c = counts.get(s.id) || { fn: 0, fm: 0, decided: 0, strategy: 0 };
        s.completion_pct = computeCompletionPct(c.fn, c.fm, c.decided, c.strategy);
      });
    } catch (e) {
      console.warn('[RCM] completion enrichment failed:', e);
    }
    return studies;
  }

  async getStudy(id: string): Promise<RCMStudy | null> {
    const { data, error } = await supabase
      .from('ers_rcm_studies')
      .select('*')
      .eq('id', id)
      .single();
    if (error) { console.error('[RCM] getStudy error:', error); return null; }
    return data as RCMStudy;
  }

  async createStudy(study: Partial<RCMStudy>): Promise<RCMStudy | null> {
    // Auto-load criticality from asset
    if (study.asset_id) {
      const { data: asset } = await supabase
        .from('assets')
        .select('criticality, name, tag')
        .eq('id', study.asset_id)
        .single();
      if (asset) {
        study.criticality_rank = asset.criticality;
      }
    }

    const { data, error } = await supabase
      .from('ers_rcm_studies')
      .insert(study)
      .select()
      .single();
    if (error) { console.error('[RCM] createStudy error:', error); return null; }
    return data as RCMStudy;
  }

  async updateStudy(id: string, updates: Partial<RCMStudy>): Promise<RCMStudy | null> {
    const { data, error } = await supabase
      .from('ers_rcm_studies')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('[RCM] updateStudy error:', error); return null; }
    return data as RCMStudy;
  }

  /**
   * Duplicate a study — worksheet, decisions and all — as a fresh draft.
   * Streamlined RCM re-uses a proven study across identical assets; the copy
   * carries the analysis but NOT the outputs (no PM links) or the approval
   * (a template is not an approved study for a different serial number).
   */
  async duplicateStudy(id: string): Promise<RCMStudy | null> {
    const src = await this.getStudy(id);
    if (!src) return null;
    const copy = await this.createStudy({
      title: `${src.title} (copy)`,
      asset_id: src.asset_id,
      operating_context: src.operating_context,
      study_type: src.study_type,
      criticality_rank: src.criticality_rank,
      facilitator: src.facilitator,
      notes: src.notes,
      rcm_source: src.rcm_source,
    });
    if (!copy) return null;

    // Bulk copies — one insert per table per function, not one per row: a
    // 16-mode study clones in a couple of round-trips instead of forty.
    const [fns, fms, decs] = await Promise.all([
      this.getFunctions(id),
      this.getFailureModesByStudy(id),
      this.getDecisions(id),
    ]);
    const decByFm = new Map(decs.map(d => [d.failure_mode_id, d]));

    for (const fn of fns) {
      const newFn = await this.createFunction({
        study_id: copy.id,
        function_number: fn.function_number,
        function_description: fn.function_description,
        performance_standard: fn.performance_standard,
        function_type: fn.function_type,
        functional_failure: fn.functional_failure,
        failure_code: fn.failure_code,
        sort_order: fn.sort_order,
      });
      if (!newFn) continue;

      const srcFms = fms.filter(fm => fm.function_id === fn.id);
      if (srcFms.length === 0) continue;
      const { data: newFms, error: fmErr } = await supabase
        .from('ers_rcm_failure_modes')
        .insert(srcFms.map(fm => ({
          function_id: newFn.id,
          failure_mode_code: fm.failure_mode_code,
          failure_mode_description: fm.failure_mode_description,
          failure_cause_code: fm.failure_cause_code,
          failure_cause_description: fm.failure_cause_description,
          failure_effect_local: fm.failure_effect_local,
          failure_effect_system: fm.failure_effect_system,
          failure_effect_plant: fm.failure_effect_plant,
          end_effect: fm.end_effect,
          severity: fm.severity,
          occurrence: fm.occurrence,
          detection: fm.detection,
          data_source: fm.data_source,
          sort_order: fm.sort_order,
        })))
        .select();
      if (fmErr || !newFms) { console.error('[RCM] duplicateStudy modes error:', fmErr); continue; }

      // Rows come back in payload order — map source decisions across by index.
      const decPayload = newFms.flatMap((nf: RCMFailureMode, i: number) => {
        const d = decByFm.get(srcFms[i].id);
        if (!d) return [];
        return [{
          failure_mode_id: nf.id,
          is_hidden_failure: d.is_hidden_failure,
          consequence_code: d.consequence_code,
          consequence_description: d.consequence_description,
          on_condition_task: d.on_condition_task,
          on_condition_interval: d.on_condition_interval,
          on_condition_applicable: d.on_condition_applicable,
          on_condition_technology: d.on_condition_technology,
          scheduled_restoration_task: d.scheduled_restoration_task,
          restoration_interval: d.restoration_interval,
          restoration_applicable: d.restoration_applicable,
          scheduled_discard_task: d.scheduled_discard_task,
          discard_interval: d.discard_interval,
          discard_applicable: d.discard_applicable,
          failure_finding_task: d.failure_finding_task,
          failure_finding_interval: d.failure_finding_interval,
          failure_finding_applicable: d.failure_finding_applicable,
          recommended_strategy_code: d.recommended_strategy_code,
          task_description: d.task_description,
          task_interval: d.task_interval,
          task_type_code: d.task_type_code,
          task_owner_craft: d.task_owner_craft,
          justification: d.justification,
          spares_requirements: d.spares_requirements,
          // deliberately NOT copied: ai_recommendation history, recurring_work_id
        }];
      });
      if (decPayload.length > 0) {
        const { error: decErr } = await supabase
          .from('ers_rcm_decisions')
          .upsert(decPayload, { onConflict: 'failure_mode_id' });
        if (decErr) console.error('[RCM] duplicateStudy decisions error:', decErr);
      }
    }
    return copy;
  }

  async deleteStudy(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('ers_rcm_studies')
      .delete()
      .eq('id', id);
    if (error) { console.error('[RCM] deleteStudy error:', error); return false; }
    return true;
  }

  // ─── Functions CRUD ──────────────────────────────────────

  async getFunctions(studyId: string): Promise<RCMFunction[]> {
    const { data, error } = await supabase
      .from('ers_rcm_functions')
      .select('*')
      .eq('study_id', studyId)
      .order('sort_order', { ascending: true });
    if (error) { console.error('[RCM] getFunctions error:', error); return []; }
    return (data || []) as RCMFunction[];
  }

  async createFunction(fn: Partial<RCMFunction>): Promise<RCMFunction | null> {
    const { data, error } = await supabase
      .from('ers_rcm_functions')
      .insert(fn)
      .select()
      .single();
    if (error) { console.error('[RCM] createFunction error:', error); return null; }
    return data as RCMFunction;
  }

  async updateFunction(id: string, updates: Partial<RCMFunction>): Promise<RCMFunction | null> {
    const { data, error } = await supabase
      .from('ers_rcm_functions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('[RCM] updateFunction error:', error); return null; }
    return data as RCMFunction;
  }

  async deleteFunction(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('ers_rcm_functions')
      .delete()
      .eq('id', id);
    if (error) { console.error('[RCM] deleteFunction error:', error); return false; }
    return true;
  }

  // ─── Failure Modes CRUD ──────────────────────────────────

  async getFailureModes(functionId: string): Promise<RCMFailureMode[]> {
    const { data, error } = await supabase
      .from('ers_rcm_failure_modes')
      .select('*')
      .eq('function_id', functionId)
      .order('sort_order', { ascending: true });
    if (error) { console.error('[RCM] getFailureModes error:', error); return []; }
    return (data || []) as RCMFailureMode[];
  }

  async getFailureModesByStudy(studyId: string): Promise<RCMFailureMode[]> {
    // Get all functions for the study, then all failure modes
    const fns = await this.getFunctions(studyId);
    if (fns.length === 0) return [];
    const fnIds = fns.map(f => f.id);

    const { data, error } = await supabase
      .from('ers_rcm_failure_modes')
      .select('*')
      .in('function_id', fnIds)
      .order('sort_order', { ascending: true });
    if (error) { console.error('[RCM] getFailureModesByStudy error:', error); return []; }
    return (data || []) as RCMFailureMode[];
  }

  async createFailureMode(fm: Partial<RCMFailureMode>): Promise<RCMFailureMode | null> {
    const { data, error } = await supabase
      .from('ers_rcm_failure_modes')
      .insert(fm)
      .select()
      .single();
    if (error) { console.error('[RCM] createFailureMode error:', error); return null; }
    return data as RCMFailureMode;
  }

  async updateFailureMode(id: string, updates: Partial<RCMFailureMode>): Promise<RCMFailureMode | null> {
    const { data, error } = await supabase
      .from('ers_rcm_failure_modes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('[RCM] updateFailureMode error:', error); return null; }
    return data as RCMFailureMode;
  }

  async deleteFailureMode(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('ers_rcm_failure_modes')
      .delete()
      .eq('id', id);
    if (error) { console.error('[RCM] deleteFailureMode error:', error); return false; }
    return true;
  }

  // ─── Decisions CRUD ──────────────────────────────────────

  async getDecisions(studyId: string): Promise<RCMDecision[]> {
    const failureModes = await this.getFailureModesByStudy(studyId);
    if (failureModes.length === 0) return [];
    const fmIds = failureModes.map(fm => fm.id);

    // Ascending by updated_at so, if legacy duplicate rows survive anywhere
    // (pre-0234 data), the page's by-failure-mode Map keeps the newest one
    // rather than a random winner.
    const { data, error } = await supabase
      .from('ers_rcm_decisions')
      .select('*')
      .in('failure_mode_id', fmIds)
      .order('updated_at', { ascending: true });
    if (error) { console.error('[RCM] getDecisions error:', error); return []; }
    return (data || []) as RCMDecision[];
  }

  async getDecision(failureModeId: string): Promise<RCMDecision | null> {
    const { data, error } = await supabase
      .from('ers_rcm_decisions')
      .select('*')
      .eq('failure_mode_id', failureModeId)
      .single();
    if (error && error.code !== 'PGRST116') {
      console.error('[RCM] getDecision error:', error);
    }
    return data as RCMDecision | null;
  }

  async upsertDecision(decision: Partial<RCMDecision>): Promise<RCMDecision | null> {
    const { data, error } = await supabase
      .from('ers_rcm_decisions')
      .upsert(decision, { onConflict: 'failure_mode_id' })
      .select()
      .single();
    if (error) { console.error('[RCM] upsertDecision error:', error.message, error.details, error.hint); return null; }
    return data as RCMDecision;
  }

  async createDecision(decision: Partial<RCMDecision>): Promise<RCMDecision | null> {
    const { data, error } = await supabase
      .from('ers_rcm_decisions')
      .insert(decision)
      .select()
      .single();
    if (error) { console.error('[RCM] createDecision error:', error.message, error.details, error.hint); return null; }
    return data as RCMDecision;
  }

  async updateDecision(id: string, updates: Partial<RCMDecision>): Promise<RCMDecision | null> {
    const { data, error } = await supabase
      .from('ers_rcm_decisions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('[RCM] updateDecision error:', error); return null; }
    return data as RCMDecision;
  }

  // ─── EAM Integrations ───────────────────────────────────

  /** Import failure modes from an FMEA worksheet */
  async importFromFMEA(studyId: string, worksheetId: string): Promise<number> {
    // 1. Get FMEA items
    const { data: fmeaItems, error: fErr } = await supabase
      .from('ers_fmea_items')
      .select('*')
      .eq('worksheet_id', worksheetId);
    if (fErr || !fmeaItems?.length) {
      console.error('[RCM] importFromFMEA: no items found', fErr);
      return 0;
    }

    // 2. Get or create a default function for import
    const functions = await this.getFunctions(studyId);
    let targetFnId: string;
    if (functions.length === 0) {
      const fn = await this.createFunction({
        study_id: studyId,
        function_number: 'F1',
        function_description: 'Imported from FMEA — review and assign functions',
        function_type: 'primary',
        sort_order: 1
      });
      targetFnId = fn?.id || '';
    } else {
      targetFnId = functions[0].id;
    }

    // 3. Map FMEA items → RCM failure modes
    let imported = 0;
    for (const item of fmeaItems) {
      const fm = await this.createFailureMode({
        function_id: targetFnId,
        fmea_item_id: item.id,
        failure_mode_description: item.failure_mode || 'Unknown',
        failure_cause_description: item.failure_cause,
        failure_effect_local: item.failure_effect,
        severity: item.severity,
        occurrence: item.occurrence,
        detection: item.detection,
        data_source: 'fmea_import',
        sort_order: imported + 1
      });
      if (fm) imported++;
    }

    return imported;
  }

  /** Populate failure history from closed work orders */
  async importFromWOHistory(studyId: string): Promise<number> {
    const study = await this.getStudy(studyId);
    if (!study?.asset_id) return 0;

    // Query closed WOs with failure data for this asset
    const { data: woData, error } = await supabase
      .from('work_orders')
      .select(`
        id, closed_at,
        wo_failure_data (failure_mode_code, failure_cause_code)
      `)
      .eq('asset_id', study.asset_id)
      .in('status', ['TECO', 'CLOSED'])
      .not('closed_at', 'is', null);

    if (error || !woData?.length) {
      console.error('[RCM] importFromWOHistory: no WO data', error);
      return 0;
    }

    // Aggregate by failure_mode_code
    const modeMap = new Map<string, { count: number; cause: string; dates: string[] }>();
    for (const wo of woData) {
      const fd = (wo as any).wo_failure_data;
      if (!fd?.failure_mode_code) continue;
      const key = fd.failure_mode_code;
      const existing = modeMap.get(key) || { count: 0, cause: fd.failure_cause_code || '', dates: [] as string[] };
      existing.count++;
      if (wo.closed_at) existing.dates.push(wo.closed_at as string);
      modeMap.set(key, existing);
    }

    // Get or create function
    const functions = await this.getFunctions(studyId);
    let targetFnId: string;
    if (functions.length === 0) {
      const fn = await this.createFunction({
        study_id: studyId,
        function_number: 'F1',
        function_description: 'Populated from work order history — review and assign functions',
        function_type: 'primary',
        sort_order: 1
      });
      targetFnId = fn?.id || '';
    } else {
      targetFnId = functions[0].id;
    }

    // Create failure modes from aggregated data
    let imported = 0;
    for (const [modeCode, agg] of modeMap) {
      // Calculate MTBF from dates
      let mtbfDays: number | null = null;
      if (agg.dates.length >= 2) {
        const sorted = agg.dates.sort();
        const intervals: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          const diff = (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / (1000 * 60 * 60 * 24);
          intervals.push(diff);
        }
        mtbfDays = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      }

      const fm = await this.createFailureMode({
        function_id: targetFnId,
        failure_mode_code: modeCode,
        failure_mode_description: `Historical: ${modeCode}`,
        failure_cause_code: agg.cause || undefined,
        failure_cause_description: agg.cause || undefined,
        historical_wo_count: agg.count,
        historical_mtbf_days: mtbfDays,
        data_source: 'wo_history',
        sort_order: imported + 1
      });
      if (fm) imported++;
    }

    return imported;
  }

  /**
   * Turn ONE decision into a recurring_work record through the canonical PM
   * builder (same path as the Weibull modal), or say exactly why it can't be.
   * The old generator hand-rolled the insert: no next_due_date (so the PM was
   * never due and the Autopilot never took it), a '1'/'2'/'3' priority no
   * Work Management surface recognises, a 30-day fallback for any interval it
   * couldn't parse, and every DB error swallowed into "no new PM tasks".
   */
  async createPMForDecision(studyId: string, failureModeId: string): Promise<{ ok: true; pmCode: string; meterCadence: boolean } | { ok: false; reason: string }> {
    const study = await this.getStudy(studyId);
    if (!study) return { ok: false, reason: 'study not found' };
    // Keyed on the failure mode (UNIQUE since 0234) — the page may still hold
    // a pending- placeholder id while the autosave lands.
    const decisions = await this.getDecisions(studyId);
    const d = decisions.find(x => x.failure_mode_id === failureModeId);
    if (!d) return { ok: false, reason: 'decision not saved yet - wait for autosave and retry' };
    const fms = await this.getFailureModesByStudy(studyId);
    const fm = fms.find(x => x.id === d.failure_mode_id);
    return this.insertPMForDecision(study, d, fm?.failure_mode_description || 'Failure mode');
  }

  private async insertPMForDecision(
    study: RCMStudy, d: RCMDecision, failureModeDescription: string,
  ): Promise<{ ok: true; pmCode: string; meterCadence: boolean } | { ok: false; reason: string }> {
    const built = buildPMFromDecision(study, d, failureModeDescription);
    if (!built.ok) return built;
    let row: Record<string, unknown>;
    try {
      row = buildPMStrategy(built.input);
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
    // Decision-scoped id = code: deterministic and idempotent, so a re-run can
    // only collide (and report it), never mint a duplicate schedule.
    const pmCode = pmCodeFor(study.id, d.id);
    row.id = pmCode;

    const { error } = await supabase.from('recurring_work').insert(row);
    if (error) {
      console.error('[RCM] createPMForDecision insert error:', error);
      const reason = error.code === '23505'
        ? `${pmCode} already exists in Work Management`
        : error.code === '42501'
          ? 'you do not have permission to create PMs'
          : error.message || 'insert rejected';
      return { ok: false, reason };
    }
    const linked = await this.updateDecision(d.id, { recurring_work_id: pmCode });
    if (!linked) console.warn('[RCM] PM created but decision link failed', pmCode);
    return { ok: true, pmCode, meterCadence: built.meterCadence };
  }

  /**
   * Generate the whole maintenance plan into Work Management. Every decision
   * that can't become a PM is reported with its reason - nothing is skipped
   * silently. Already-generated decisions are left alone.
   */
  async generatePMSchedule(studyId: string): Promise<{
    created: { pmCode: string; failureMode: string; meterCadence: boolean }[];
    failed: { failureMode: string; reason: string }[];
  }> {
    const out = {
      created: [] as { pmCode: string; failureMode: string; meterCadence: boolean }[],
      failed: [] as { failureMode: string; reason: string }[],
    };
    const study = await this.getStudy(studyId);
    if (!study) return out;
    const [decisions, fms] = await Promise.all([this.getDecisions(studyId), this.getFailureModesByStudy(studyId)]);
    const fmName = new Map(fms.map(f => [f.id, f.failure_mode_description || 'Failure mode']));

    for (const d of decisions) {
      // Only decisions that are meant to become a PM and haven't yet.
      if (!strategyProducesPM(d.recommended_strategy_code) || d.recurring_work_id) continue;
      const name = fmName.get(d.failure_mode_id) || 'Failure mode';
      const res = await this.insertPMForDecision(study, d, name);
      if (res.ok) out.created.push({ pmCode: res.pmCode, failureMode: name, meterCadence: res.meterCadence });
      else out.failed.push({ failureMode: name, reason: res.reason });
    }
    return out;
  }

  /** Get task recommendation summary for output tab */
  async getTaskSummaries(studyId: string): Promise<RCMTaskSummary[]> {
    const functions = await this.getFunctions(studyId);
    const failureModes = await this.getFailureModesByStudy(studyId);
    const decisions = await this.getDecisions(studyId);

    const decisionMap = new Map(decisions.map(d => [d.failure_mode_id, d]));
    const fnMap = new Map(functions.map(f => [f.id, f]));

    return failureModes.map(fm => {
      const decision = decisionMap.get(fm.id);
      const fn = fnMap.get(fm.function_id);
      return {
        failure_mode_id: fm.id,
        failure_mode_description: fm.failure_mode_description,
        function_description: fn?.function_description || '',
        consequence_code: decision?.consequence_code || null,
        recommended_strategy_code: decision?.recommended_strategy_code || null,
        task_description: decision?.task_description || null,
        task_interval: decision?.task_interval || null,
        task_type_code: decision?.task_type_code || null,
        task_owner_craft: decision?.task_owner_craft || null,
        spares_requirements: decision?.spares_requirements || [],
        recurring_work_id: decision?.recurring_work_id || null
      };
    });
  }

  /** Get dictionary codes for a given type */
  async getDictionaryCodes(type: string): Promise<{ code: string; description: string; properties: any }[]> {
    const { data, error } = await supabase
      .from('dictionaries_effective')
      .select('code, description, properties')
      .eq('type', type)
      .eq('active', true)
      .order('code');
    if (error) { console.error('[RCM] getDictionaryCodes error:', error); return []; }
    return data || [];
  }

  /** Compute study completion percentage */
  async getStudyProgress(studyId: string): Promise<number> {
    const fns = await this.getFunctions(studyId);
    if (fns.length === 0) return 0;

    const fms = await this.getFailureModesByStudy(studyId);
    if (fms.length === 0) return fns.length > 0 ? 10 : 0;

    const decisions = await this.getDecisions(studyId);
    const decidedCount = decisions.filter(d => d.recommended_strategy_code).length;

    // Weight: functions=20%, failure modes=40%, decisions=40%
    const fnScore = 20;
    const fmScore = 40;
    const decScore = fms.length > 0 ? Math.round((decidedCount / fms.length) * 40) : 0;
    return Math.min(fnScore + fmScore + decScore, 100);
  }

  // ─── AI Features ─────────────────────────────────────────

  /** AI Feature 1: Suggest functions and failure modes for an asset */
  async aiSuggestFunctions(study: RCMStudy): Promise<{
    functions: Array<{
      number: string;
      description: string;
      type: string;
      performance_standard: string;
      functional_failure: string;
      failure_modes: Array<{
        description: string;
        cause: string;
        effect_local: string;
        effect_system: string;
        effect_plant: string;
      }>;
    }>;
  } | null> {
    if (!isAIAvailable()) return null;

    // Get asset details for context
    let assetContext = '';
    if (study.asset_id) {
      const { data: asset } = await supabase
        .from('assets')
        .select('tag, name, hierarchy_level, criticality, manufacturer, model')
        .eq('id', study.asset_id)
        .single();
      if (asset) {
        assetContext = `Asset: ${asset.tag} - ${asset.name}
Type: ${asset.hierarchy_level}
Criticality: ${asset.criticality}
Manufacturer: ${asset.manufacturer || 'Unknown'}
Model: ${asset.model || 'Unknown'}`;
      }
    }

    const prompt = `You are performing an RCM study per SAE JA1011.
${assetContext}
Operating Context: ${study.operating_context || 'General industrial service'}
Study Type: ${study.study_type}

Generate a comprehensive list of functions, functional failures, and failure modes for this asset.
Use ISO 14224 failure coding conventions.

Return ONLY valid JSON with this structure:
{
  "functions": [
    {
      "number": "F1",
      "description": "Primary function description with performance standard",
      "type": "primary|secondary|protective",
      "performance_standard": "Quantified standard",
      "functional_failure": "How it fails this function",
      "failure_modes": [
        {
          "description": "Failure mode per ISO 14224",
          "cause": "Root cause",
          "effect_local": "Component-level effect",
          "effect_system": "System-level effect",
          "effect_plant": "Plant-level end effect"
        }
      ]
    }
  ]
}`;

    try {
      const raw = await callRCMGemini(prompt, 0.3);
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (error) {
      console.error('[RCM] aiSuggestFunctions error:', error);
      return null;
    }
  }

  /**
   * Specialist: recommend the Q6-Q7 strategy for ONE failure mode and draft
   * the executable task with it - a task statement, a structured interval, the
   * craft and a justification, kept separate from the decision-tree reasoning.
   * The old prompt returned only prose, and the page copied the first 200
   * characters of that prose into the task field.
   */
  async aiRecommendStrategy(
    failureMode: RCMFailureMode,
    opts: { study?: RCMStudy; consequenceCode?: string; isHidden?: boolean; functionDescription?: string } = {},
  ): Promise<AIRecommendation | null> {
    if (!isAIAvailable()) return null;

    const assetCtx = opts.study ? await this.assetContextFor(opts.study) : '';
    const prompt = `Recommend the maintenance strategy for this failure mode using the SAE JA1012 decision logic.
${assetCtx ? `\n${assetCtx}\n` : ''}${opts.study?.operating_context ? `Operating context: ${opts.study.operating_context}\n` : ''}
Function: ${opts.functionDescription || 'Not specified'}
Failure Mode: ${failureMode.failure_mode_description}
Cause: ${failureMode.failure_cause_description || 'Not specified'}
Local Effect: ${failureMode.failure_effect_local || 'Not specified'}
System Effect: ${failureMode.failure_effect_system || 'Not specified'}
Plant Effect: ${failureMode.end_effect || failureMode.failure_effect_plant || 'Not specified'}
Consequence class (Q5): ${opts.consequenceCode || 'Not yet classified'}${opts.isHidden ? ' - HIDDEN failure (a failure-finding task is the first candidate)' : ''}
Historical MTBF: ${failureMode.historical_mtbf_days ? failureMode.historical_mtbf_days + ' days' : 'No data'}
Historical WO Count: ${failureMode.historical_wo_count}
Severity: ${failureMode.severity || 'Not rated'}/10 - Occurrence: ${failureMode.occurrence || 'Not rated'}/10 - Detection: ${failureMode.detection || 'Not rated'}/10

Walk the decision logic (technically feasible? worth doing? on-condition -> scheduled restoration -> scheduled discard -> failure-finding -> default action) and return ONLY valid JSON with these keys:
{
  "strategy": "PM_TIME|PM_CONDITION|PM_PREDICTIVE|RTF|REDESIGN|COMBINATION",
  "task_description": "ONE imperative task statement for the technician, max 140 characters (e.g. 'Replace ignitor plug and verify spark gap 2.0 mm'). Never the reasoning.",
  "interval_value": 6,
  "interval_unit": "Hours|Days|Weeks|Months|Years",
  "task_owner_craft": "e.g. Instrument Technician",
  "justification": "2-4 sentences: why this task type and interval (P-F interval, failure pattern, consequence, cost-benefit).",
  "reasoning": "The step-by-step JA1012 walk-through you followed.",
  "confidence": 0.85,
  "suggested_technology": "PdM technology if on-condition, else empty"
}
Rules: interval_value must be a single integer with a unit - never a range or 'per OEM'. For RTF or REDESIGN set interval_value to null and describe the default action in task_description.`;

    try {
      const raw = await callRCMGemini(prompt, 0.2);
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object' && 'error' in parsed && !('strategy' in parsed)) return null;
      return normalizeRecommendation(parsed);
    } catch (error) {
      console.error('[RCM] aiRecommendStrategy error:', error);
      return null;
    }
  }

  /**
   * Asset header used to ground every Specialist call. Without it the model
   * answers about a generic machine, which is exactly what the readiness gate
   * in rcmReadiness.ts exists to prevent.
   */
  private async assetContextFor(study: RCMStudy): Promise<string> {
    if (!study.asset_id) return '';
    const { data: asset } = await supabase
      .from('assets')
      .select('tag, name, hierarchy_level, criticality, manufacturer, model')
      .eq('id', study.asset_id)
      .single();
    if (!asset) return '';
    return `Asset: ${asset.tag} - ${asset.name}
Type: ${asset.hierarchy_level}
Criticality: ${asset.criticality}
Manufacturer: ${asset.manufacturer || 'Unknown'}
Model: ${asset.model || 'Unknown'}`;
  }

  /**
   * Specialist: propose the failure modes for ONE function. Narrower and far
   * cheaper than a full draft — used when the team has written the function and
   * its functional failure and wants the mode list filled underneath it.
   */
  async aiSuggestFailureModes(study: RCMStudy, fn: RCMFunction): Promise<Array<{
    description: string;
    cause: string;
    effect_local: string;
    effect_system: string;
    effect_plant: string;
    severity?: number;
    occurrence?: number;
  }> | null> {
    if (!isAIAvailable()) return null;

    const assetContext = await this.assetContextFor(study);
    const existing = await this.getFailureModes(fn.id);

    const prompt = `RCM study per SAE JA1011 — expand ONE function into its failure modes.
${assetContext}
Operating Context: ${study.operating_context || 'General industrial service'}

Function (${fn.function_number}, ${fn.function_type}): ${fn.function_description}
Performance Standard: ${fn.performance_standard || 'Not stated'}
Functional Failure: ${fn.functional_failure || 'Not stated'}
${existing.length > 0 ? `\nAlready listed (do NOT repeat these):\n${existing.map(fm => `- ${fm.failure_mode_description}`).join('\n')}` : ''}

List the reasonably likely failure modes for THIS functional failure only, using ISO 14224
coding conventions. 4–8 modes. Severity and occurrence are 1–10 FMEA scales.

Return ONLY valid JSON:
{
  "failure_modes": [
    {
      "description": "Failure mode per ISO 14224",
      "cause": "Mechanism / root cause",
      "effect_local": "Component-level effect",
      "effect_system": "System-level effect",
      "effect_plant": "Plant / production end effect",
      "severity": 1,
      "occurrence": 1
    }
  ]
}`;

    try {
      const raw = await callRCMGemini(prompt, 0.3);
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error) {
        console.error('[RCM] aiSuggestFailureModes AI error:', parsed.error);
        return null;
      }
      return Array.isArray(parsed.failure_modes) ? parsed.failure_modes : null;
    } catch (error) {
      console.error('[RCM] aiSuggestFailureModes error:', error);
      return null;
    }
  }

  /**
   * Specialist: complete ONE worksheet row. Fills the columns the row is missing
   * — cause, the three effect levels, severity/occurrence and the JA1012
   * consequence class — leaving anything the team already wrote untouched.
   */
  async aiCompleteFailureMode(study: RCMStudy, fn: RCMFunction, fm: RCMFailureMode): Promise<{
    failure_cause_description?: string;
    failure_effect_local?: string;
    failure_effect_system?: string;
    end_effect?: string;
    severity?: number;
    occurrence?: number;
    is_hidden_failure?: boolean;
    consequence_codes?: string[];
    rationale?: string;
  } | null> {
    if (!isAIAvailable()) return null;

    const assetContext = await this.assetContextFor(study);

    const prompt = `RCM / FMEA worksheet row completion per SAE JA1011 & JA1012.
${assetContext}
Operating Context: ${study.operating_context || 'General industrial service'}

Function (${fn.function_number}): ${fn.function_description}
Functional Failure: ${fn.functional_failure || 'Not stated'}
Failure Mode: ${fm.failure_mode_description}
Already recorded by the team (KEEP these values, do not contradict them):
- Cause: ${fm.failure_cause_description || '(blank)'}
- Local effect: ${fm.failure_effect_local || '(blank)'}
- System effect: ${fm.failure_effect_system || '(blank)'}
- End effect: ${fm.end_effect || fm.failure_effect_plant || '(blank)'}
- Severity: ${fm.severity ?? '(blank)'} / Occurrence: ${fm.occurrence ?? '(blank)'}

Complete the blank fields only. Severity and occurrence are 1–10 FMEA scales
(severity = worst credible end effect; occurrence = likelihood in this context).
is_hidden_failure is true when the failure is NOT evident to operating crew under
normal circumstances (JA1012 Q5).

consequence_codes must be chosen from:
  evident failures  → SAFETY_ENV, OPERATIONAL, NON_OPERATIONAL, REPAIR_COST, REPUTATION
  hidden failures   → HIDDEN_SAFETY (multiple failure could hurt people/environment), HIDDEN_NON_SAFETY

Return ONLY valid JSON:
{
  "failure_cause_description": "",
  "failure_effect_local": "",
  "failure_effect_system": "",
  "end_effect": "",
  "severity": 1,
  "occurrence": 1,
  "is_hidden_failure": false,
  "consequence_codes": ["OPERATIONAL"],
  "rationale": "One sentence on why this consequence class"
}`;

    try {
      const raw = await callRCMGemini(prompt, 0.3);
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error) {
        console.error('[RCM] aiCompleteFailureMode AI error:', parsed.error);
        return null;
      }
      return parsed;
    } catch (error) {
      console.error('[RCM] aiCompleteFailureMode error:', error);
      return null;
    }
  }

  /** AI Feature 3: Strategy optimization — review full study */
  async aiOptimizeStudy(studyId: string): Promise<string | null> {
    if (!isAIAvailable()) return null;

    const study = await this.getStudy(studyId);
    if (!study) return null;

    const summaries = await this.getTaskSummaries(studyId);

    const prompt = `Review this RCM study for optimization per SAE JA1012:

Study: ${study.title}
Asset: ${study.asset_id}
Operating Context: ${study.operating_context}

Task Recommendations:
${summaries.map((s, i) => `${i + 1}. ${s.failure_mode_description} → ${s.recommended_strategy_code || 'UNRESOLVED'} | ${s.task_description || 'No task'} | ${s.task_interval || 'No interval'}`).join('\n')}

Analyze and provide:
1. **Gaps**: Failure modes with no assigned strategy
2. **Conflicts**: Contradictory or redundant strategies
3. **Consolidation**: Tasks that could be combined into single PM windows
4. **Cost-Benefit**: Qualitative assessment of the overall strategy mix
5. **Interval Optimization**: Intervals that seem too frequent or too infrequent
6. **Missing Considerations**: Failure modes that may have been overlooked

Format as a structured report in markdown.`;

    try {
      const raw = await callRCMGemini(prompt, 0.3);
      // Optimization reports are markdown (not JSON), return as-is
      const parsed = (() => { try { return JSON.parse(raw); } catch { return null; } })();
      if (parsed?.error) {
        console.error('[RCM] aiOptimizeStudy AI error:', parsed.error);
        return null;
      }
      return raw || null;
    } catch (error) {
      console.error('[RCM] aiOptimizeStudy error:', error);
      return null;
    }
  }

  /** AI Feature 4: Generate executive summary */
  async aiGenerateSummary(studyId: string): Promise<string | null> {
    if (!isAIAvailable()) return null;

    const study = await this.getStudy(studyId);
    if (!study) return null;

    const functions = await this.getFunctions(studyId);
    const summaries = await this.getTaskSummaries(studyId);

    const strategyDist = summaries.reduce((acc, s) => {
      const key = s.recommended_strategy_code || 'UNRESOLVED';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const prompt = `Generate an executive summary for this completed RCM study:

Title: ${study.title}
Asset: ${study.asset_id}
Operating Context: ${study.operating_context}
Criticality: ${study.criticality_rank}
Study Type: ${study.study_type}
Functions Analyzed: ${functions.length}
Failure Modes Analyzed: ${summaries.length}
Strategy Distribution: ${JSON.stringify(strategyDist)}

Write a professional 2-3 paragraph executive summary suitable for management review.
Include: scope, key findings, strategy mix, expected maintenance improvement impact.
Format in markdown.`;

    try {
      const raw = await callRCMGemini(prompt, 0.4);
      // Summary reports are markdown (not JSON), return as-is
      const parsed = (() => { try { return JSON.parse(raw); } catch { return null; } })();
      if (parsed?.error) {
        console.error('[RCM] aiGenerateSummary AI error:', parsed.error);
        return null;
      }
      return raw || null;
    } catch (error) {
      console.error('[RCM] aiGenerateSummary error:', error);
      return null;
    }
  }
}

// ─── Utility Helpers ─────────────────────────────────────────

// ── Phase 5: Full RCM Worksheet Interface ────────────────────

export interface FullRCMWorksheet {
  functions: {
    number: string;
    description: string;
    type: 'primary' | 'secondary' | 'protective';
    performance_standard: string;
    functional_failures: {
      description: string;
      failure_modes: {
        description: string;
        cause: string;
        effect_local: string;
        effect_system: string;
        effect_plant: string;
        is_hidden: boolean;
        consequence_category: 'safety_environmental' | 'operational' | 'non_operational' | 'hidden';
        ja1011_decision: {
          on_condition: { applicable: boolean; task?: string; interval?: string; technology?: string };
          scheduled_restoration: { applicable: boolean; task?: string; interval?: string };
          scheduled_discard: { applicable: boolean; task?: string; interval?: string };
          failure_finding: { applicable: boolean; task?: string; interval?: string };
          recommended_strategy: string;
          justification: string;
        };
        severity: number;
        occurrence: number;
        detection: number;
        rpn: number;
      }[];
    }[];
  }[];
  summary: {
    total_functions: number;
    total_failure_modes: number;
    strategy_distribution: Record<string, number>;
  };
  ai_confidence: number;
}

/**
 * Generate a full SAE JA1011 RCM Worksheet via AI.
 * Produces functions, failure modes, consequence analysis, and task recommendations.
 * HITL: Returns a preview — engineer reviews before batch import into the study.
 */
async function aiGenerateFullRCMWorksheet(
  study: RCMStudy,
  assetContext?: { assetName?: string; assetTag?: string; equipmentClass?: string },
): Promise<FullRCMWorksheet | null> {
  if (!isAIAvailable()) return null;

  const prompt = `You are an expert RCM facilitator conducting a FULL SAE JA1011 analysis.

Study: "${study.title}"
Type: ${study.study_type}
Asset: ${assetContext?.assetName || 'Not specified'} (Tag: ${assetContext?.assetTag || 'N/A'})
Equipment Class: ${assetContext?.equipmentClass || 'Not specified'}
Criticality: ${study.criticality_rank || 'B'}
Operating Context: ${study.operating_context || 'Standard industrial operation'}

Generate a COMPLETE RCM Worksheet following the JA1011 decision logic:

For each FUNCTION:
1. Define the function and performance standard
2. Identify functional failures (loss of function, degraded function)
3. For each functional failure, identify failure modes with causes and effects

For each FAILURE MODE, walk the JA1011 decision tree:
a) Determine consequence category (Safety/Env → Operational → Non-Operational → Hidden)
b) For applicable consequence: evaluate On-Condition → Scheduled Restoration → Scheduled Discard → Failure-Finding → Run-to-Failure
c) Select the recommended task strategy with interval justification
d) Score S × O × D for RPN

Generate 3-5 functions with 2-4 failure modes each (realistic for the equipment class).

Respond as JSON:
{
  "functions": [{
    "number": "F1",
    "description": "...",
    "type": "primary|secondary|protective",
    "performance_standard": "...",
    "functional_failures": [{
      "description": "...",
      "failure_modes": [{
        "description": "...",
        "cause": "...",
        "effect_local": "...",
        "effect_system": "...",
        "effect_plant": "...",
        "is_hidden": false,
        "consequence_category": "safety_environmental|operational|non_operational|hidden",
        "ja1011_decision": {
          "on_condition": { "applicable": true, "task": "...", "interval": "...", "technology": "..." },
          "scheduled_restoration": { "applicable": false },
          "scheduled_discard": { "applicable": false },
          "failure_finding": { "applicable": false },
          "recommended_strategy": "on_condition|restoration|discard|failure_finding|run_to_failure|redesign",
          "justification": "..."
        },
        "severity": 1-10,
        "occurrence": 1-10,
        "detection": 1-10,
        "rpn": <S×O×D>
      }]
    }]
  }],
  "summary": {
    "total_functions": <number>,
    "total_failure_modes": <number>,
    "strategy_distribution": { "on_condition": <count>, "restoration": <count>, "discard": <count>, "failure_finding": <count>, "run_to_failure": <count> }
  },
  "ai_confidence": <0-1>
}`;

  try {
    const raw = await callRCMGemini(prompt, 0.3);
    // Parse — strip markdown fences if present
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed: FullRCMWorksheet = JSON.parse(cleaned);
    return parsed;
  } catch (error) {
    console.error('[RCM] Full worksheet generation failed:', error);
    return null;
  }
}

// Export the standalone function for use in RCMPage
export { aiGenerateFullRCMWorksheet };

// ─── Singleton Export ────────────────────────────────────────
export const rcmService = new RCMServiceImpl();

