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
import { buildWorkOrder } from '../lib/workOrder';
import {
  buildPMFromDecision, normalizeRecommendation, pmCodeFor, strategyProducesPM,
  canonicalStrategyCode, briefJustification, UUID_RE,
  type AIRecommendation, type JobPlanForPM, type SpareMatch,
} from './rcmPlan';
import type { StudyCollaborator } from './AnalyzeService';
import {
  normalizeContext, composeOperatingContext, takeSnapshot,
  type AssetOperatingContext, type ContextSnapshot, type ContextAssetLike,
} from '../../lib/operatingContext';
import { getCategory, getClass, getType } from '../../lib/iso14224Taxonomy';
import { renderBreakdownForPrompt, pinFailureMode, EMPTY_BREAKDOWN, type AssetBreakdown, type BreakdownComponent, type BreakdownPart } from '../../lib/rcmBreakdown';

export type { AIRecommendation } from './rcmPlan';
import { readsBySensor, readsByPerson, decisionTechnology } from './rcmImplementation';
export type { ContextSnapshot, AssetOperatingContext } from '../../lib/operatingContext';
export type { AssetBreakdown, BreakdownComponent, BreakdownPart } from '../../lib/rcmBreakdown';

/** The register asset as the RCM module reads it — classification + operating context. */
/** Written by a connector / collector (sensor-sync, ingest-readings), not by a person. */
const FEED_WRITERS = ['connector:%', 'collector:%', 'sensor:%', 'predict:%'];
const FEED_WINDOW_DAYS = 30;
const isRecent = (iso: string | null | undefined, days = FEED_WINDOW_DAYS): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && Date.now() - t < days * 86400000;
};

/** What condition monitoring the asset really has — the Specialist and the plan read this before assuming a sensor. */
export interface RCMMonitoringReality {
  points: number;
  pointsWithSensorTag: number;
  lastReadingAt: string | null;
  lastFeedAt: string | null;
  /** A connector wrote to one of the asset's points in the last 30 days, or a point carries a sensor tag. */
  hasLiveFeed: boolean;
}

export interface RCMAssetContext extends ContextAssetLike {
  id: string;
  tag: string;
  name: string;
  description: string | null;
  hierarchy_level: string | null;
  criticality: string | null;
  manufacturer: string | null;
  model: string | null;
  asset_category: string | null;
  asset_class: string | null;
  asset_type_code: string | null;
  operating_context: AssetOperatingContext;
  /** The JA1011 narrative composed from the structured data. */
  narrative: string;
}

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
  /** What the study assumed about the asset's operating context (0317, SAE JA1011 §5.1). */
  context_snapshot?: ContextSnapshot | null;
  /** 0319 — bumped by Revise on an approved study; PMs stamp origin.study_revision. */
  revision?: number;
  /** 0335 — the study team: an access list (owner/editor may edit, owner/reviewer may approve). */
  collaborators?: StudyCollaborator[];
  /** 0335 — auth.uid() of the facilitator who created the study (trigger-stamped). */
  created_by?: string | null;
  /** 0335 — auth.uid() of the approver (trigger-stamped); approved_by keeps the display name. */
  approved_by_user_id?: string | null;
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
  /** 0318 — the registered subunit/component (child asset) this mode belongs to */
  component_asset_id?: string | null;
  /** 0318 — the asset_bom line (maintainable item / spare) this mode is about */
  bom_item_id?: string | null;
  /** 0325 — how the pin was made; 'text' = inferred from the wording, not yet confirmed */
  component_link_source?: 'manual' | 'specialist' | 'text' | 'import' | null;
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
  /** 0319 — Task Library job plan the generated PM carries (steps, roles, parts). */
  task_library_item_id?: string | null;
  /** 0324 — the Condition Data measurement point an on-condition / predictive decision monitors. NULL = paper task. */
  reading_definition_id?: string | null;
  /** 0326 — the work order raised to carry out a REDESIGN decision. */
  work_order_id?: string | null;
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
  /** For the "changed since its PM was generated" flag on the plan. */
  decision_updated_at?: string | null;
  pm_created_at?: string | null;
  // ── What the Maintenance Plan implements with, and what already exists ──
  justification?: string | null;
  task_library_item_id?: string | null;
  technology?: string | null;
  reading_definition_id?: string | null;
  work_order_id?: string | null;
  /** the BOM line the failure mode is pinned to (a spare candidate for RTF) */
  bom_item_id?: string | null;
  pm?: { id: string; title: string; next_due_date: string | null; schedule_type: string | null; strategy_package: string | null; frequency_interval: number | null; frequency_unit: string | null; active: boolean } | null;
  point?: { id: string; name: string; unit: string | null; has_bands: boolean; pf_interval_days: number | null; is_active: boolean; sensor_tag: string | null; has_feed: boolean; last_feed_at: string | null } | null;
  wo?: { id: string; wo_number: string | null; status: string | null } | null;
}

/** One row of sem_rcm_coverage (0319). */
export interface RCMCoverageRow {
  study_id: string;
  title: string;
  status: RCMStudy['status'];
  revision: number;
  asset_id: string | null;
  asset_tag: string | null;
  asset_name: string | null;
  criticality: string | null;
  approved_at: string | null;
  updated_at: string;
  function_count: number;
  failure_mode_count: number;
  decided_count: number;
  strategy_count: number;
  proactive_count: number;
  pm_count: number;
  /** 0324 — on-condition / predictive decisions, and how many of them have a linked measurement point. */
  cbm_count?: number;
  reading_point_count?: number;
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

  /** Studies on one register asset, newest first (asset dossier, RCA bridge, coverage). */
  async getStudiesForAsset(assetId: string): Promise<RCMStudy[]> {
    if (!assetId) return [];
    const { data, error } = await supabase
      .from('ers_rcm_studies')
      .select('*')
      .eq('asset_id', assetId)
      .order('updated_at', { ascending: false });
    if (error) { console.error('[RCM] getStudiesForAsset error:', error); return []; }
    return (data || []) as RCMStudy[];
  }

  /**
   * sem_rcm_coverage (0319): one row per study with the asset's criticality and
   * the study's counts. Empty (not an error) before the migration is applied.
   */
  async getCoverage(): Promise<RCMCoverageRow[]> {
    const { data, error } = await supabase.from('sem_rcm_coverage').select('*');
    if (error) {
      if (error.code !== '42P01') console.warn('[RCM] getCoverage:', error.message);
      return [];
    }
    return (data || []) as RCMCoverageRow[];
  }

  /**
   * Reopen an approved study for editing: revision + 1, back to in_progress,
   * approval stamp cleared. The freeze trigger (0319) refuses every other edit
   * while the study is approved.
   */
  async reviseStudy(study: RCMStudy): Promise<RCMStudy | null> {
    const { data, error } = await supabase
      .from('ers_rcm_studies')
      .update({ status: 'in_progress', revision: (study.revision ?? 1) + 1, approved_by: null, approved_at: null, updated_at: new Date().toISOString() })
      .eq('id', study.id)
      .select()
      .single();
    if (error) { console.error('[RCM] reviseStudy error:', error); return null; }
    return data as RCMStudy;
  }

  async createStudy(study: Partial<RCMStudy>): Promise<RCMStudy | null> {
    // Auto-load criticality from asset — and, unless the caller already
    // snapshotted it, the operating context the study is analysed against.
    if (study.asset_id) {
      const ctx = await this.getAssetContext(study.asset_id);
      if (ctx) {
        study.criticality_rank = ctx.criticality;
        if (!study.context_snapshot) study.context_snapshot = takeSnapshot(ctx, ctx.operating_context);
      }
    }

    const { data, error } = await supabase
      .from('ers_rcm_studies')
      .insert(study)
      .select()
      .single();
    if (error) {
      // Before 0317 the column does not exist — keep study creation working.
      if (/context_snapshot/i.test(error.message || '') && study.context_snapshot) {
        const { context_snapshot: _drop, ...rest } = study;
        void _drop;
        const retry = await supabase.from('ers_rcm_studies').insert(rest).select().single();
        if (retry.error) { console.error('[RCM] createStudy error:', retry.error); return null; }
        return retry.data as RCMStudy;
      }
      console.error('[RCM] createStudy error:', error);
      return null;
    }
    return data as RCMStudy;
  }

  /**
   * The register asset with its ISO 14224 classification and operating
   * context (0317), plus the composed JA1011 narrative. select('*') so it
   * still answers before the column exists. Accepts only register UUIDs —
   * a manual tag has no context to read.
   */
  async getAssetContext(assetId: string | null | undefined): Promise<RCMAssetContext | null> {
    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) return null;
    const { data, error } = await supabase.from('assets').select('*').eq('id', assetId).maybeSingle();
    if (error || !data) return null;
    const operating_context = normalizeContext(data.operating_context);
    const base = {
      id: data.id, tag: data.tag, name: data.name,
      // The duty narrative lives in the register's description (properties.description) —
      // there is no separate duty field on the operating context.
      description: data.properties?.description ?? null,
      hierarchy_level: data.hierarchy_level ?? null, criticality: data.criticality ?? null,
      manufacturer: data.manufacturer ?? null, model: data.model ?? null,
      asset_category: data.asset_category ?? null, asset_class: data.asset_class ?? null, asset_type_code: data.asset_type_code ?? null,
      operating_context,
    };
    return { ...base, narrative: composeOperatingContext(base, operating_context) };
  }

  /** Re-read the asset and store a fresh snapshot on the study. */
  async refreshContextSnapshot(studyId: string, assetId: string): Promise<{ study: RCMStudy | null; narrative: string } | null> {
    const ctx = await this.getAssetContext(assetId);
    if (!ctx) return null;
    const study = await this.updateStudy(studyId, { context_snapshot: takeSnapshot(ctx, ctx.operating_context), criticality_rank: ctx.criticality });
    return { study, narrative: ctx.narrative };
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
   * A status change the database may refuse (0335: who may approve or reopen,
   * and whether every mode is classified and decided). The refusal text is the
   * reason the page shows — the trigger's message is written for people.
   */
  async setStudyStatus(id: string, updates: Partial<RCMStudy>): Promise<{ ok: true; study: RCMStudy } | { ok: false; reason: string }> {
    const { data, error } = await supabase.from('ers_rcm_studies').update(updates).eq('id', id).select().single();
    if (error) {
      const msg = String(error.message || '');
      const reason = msg.replace(/^RCM_[A-Z_]+_DENIED:\s*/, '') || 'The database refused the change';
      // PostgREST hides a policy refusal as "0 rows": no row came back.
      return { ok: false, reason: /PGRST116|0 rows|multiple \(or no\) rows/i.test(msg) ? 'You are not allowed to change this study — ask its facilitator, a reviewer on its team, or an administrator' : reason };
    }
    return { ok: true, study: data as RCMStudy };
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
    if (error) {
      // Before 0318 the component/BOM link columns do not exist — keep the
      // worksheet working, just without the pin.
      if (/component_asset_id|bom_item_id|component_link_source/i.test(error.message || '') && (fm.component_asset_id || fm.bom_item_id || fm.component_link_source)) {
        const { component_asset_id: _c, bom_item_id: _b, component_link_source: _s, ...rest } = fm;
        void _c; void _b; void _s;
        const retry = await supabase.from('ers_rcm_failure_modes').insert(rest).select().single();
        if (retry.error) { console.error('[RCM] createFailureMode error:', retry.error); return null; }
        return retry.data as RCMFailureMode;
      }
      console.error('[RCM] createFailureMode error:', error);
      return null;
    }
    return data as RCMFailureMode;
  }

  // ─── Physical breakdown (ISO 14224 L7–L9) ──────────────────────────────

  /**
   * The study asset's registered children (subunits / components, up to
   * three levels down) and its BOM lines. What the Specialist is told the
   * machine is made of, and what a failure mode can be pinned to.
   */
  async getAssetBreakdown(assetId: string | null | undefined): Promise<AssetBreakdown> {
    if (!assetId || !/^[0-9a-f-]{36}$/i.test(assetId)) return EMPTY_BREAKDOWN;
    const components: BreakdownComponent[] = [];
    let frontier = [assetId];
    for (let depth = 1; depth <= 3 && frontier.length; depth++) {
      const { data, error } = await supabase
        .from('assets')
        .select('id, tag, name, hierarchy_level, criticality, asset_class, asset_type_code, parent_id')
        .in('parent_id', frontier)
        .order('tag');
      if (error || !data) break;
      const rows = data.filter(r => {
        const lvl = String(r.hierarchy_level || '').toUpperCase();
        // Equipment-class children only — a location under an equipment row is a data error, not a component.
        return !['SITE', 'AREA', 'UNIT', 'SYSTEM', 'SUBSYSTEM'].includes(lvl);
      });
      for (const r of rows) {
        components.push({
          id: r.id, tag: r.tag, name: r.name, level: r.hierarchy_level ?? null, criticality: r.criticality ?? null,
          assetClass: r.asset_class ?? null, assetType: r.asset_type_code ?? null, parentId: r.parent_id ?? null, depth,
        });
      }
      frontier = rows.map(r => r.id);
    }
    const { data: bom } = await supabase
      .from('asset_bom')
      .select('id, part_number, description, quantity, uom, is_critical, inventory_item_id, replacement_interval_days')
      .eq('asset_id', assetId)
      .order('is_critical', { ascending: false })
      .order('description');
    const parts: BreakdownPart[] = (bom || []).map(b => ({
      id: b.id, partNumber: b.part_number || '', description: b.description, qty: Number(b.quantity) || 1, uom: b.uom || 'EA',
      critical: !!b.is_critical, inventoryItemId: b.inventory_item_id ?? null, replacementIntervalDays: b.replacement_interval_days ?? null,
    }));
    return { components, parts };
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

    // 3. Map FMEA items → RCM failure modes, pinned to the component each names
    const study = await this.getStudy(studyId);
    const breakdown = await this.getAssetBreakdown(study?.asset_id);
    let imported = 0;
    for (const item of fmeaItems) {
      const fm = await this.createFailureMode(pinFailureMode({
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
      }, breakdown));
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

    // Create failure modes from aggregated data, pinned where the code or cause names a component
    const breakdown = await this.getAssetBreakdown(study.asset_id);
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

      const fm = await this.createFailureMode(pinFailureMode({
        function_id: targetFnId,
        failure_mode_code: modeCode,
        failure_mode_description: `Historical: ${modeCode}`,
        failure_cause_code: agg.cause || undefined,
        failure_cause_description: agg.cause || undefined,
        historical_wo_count: agg.count,
        historical_mtbf_days: mtbfDays,
        data_source: 'wo_history',
        sort_order: imported + 1
      }, breakdown));
      if (fm) imported++;
    }

    return imported;
  }

  /**
   * Turn ONE decision into a recurring_work record through the canonical PM
   * builder (same path as the Weibull modal), or say exactly why it can't be.
   * The PM carries a job plan — the task as its first step (with the Task
   * Library plan's instructions when one is attached), the craft as a planned
   * labour line, the named spares as planned parts — and, for calendar
   * cadences, joins the asset's RCM strategy as a package so same-day longer
   * services absorb it (0292).
   */
  async createPMForDecision(studyId: string, failureModeId: string): Promise<{ ok: true; pmCode: string; meterCadence: boolean; packageLabel: string | null } | { ok: false; reason: string }> {
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

  /** The Task Library plan a decision points at, in the shape the PM builder consumes. */
  private async resolveJobPlan(id: string | null | undefined): Promise<JobPlanForPM | null> {
    if (!id) return null;
    const [item, roles, inv] = await Promise.all([
      supabase.from('task_library_items').select('id, code, title, estimated_duration_hours, instructions').eq('id', id).maybeSingle(),
      supabase.from('task_library_roles').select('role_code, quantity, estimated_hours').eq('task_id', id),
      supabase.from('task_library_inventory').select('inventory_item_id, quantity, notes, inventory_items(code, description)').eq('task_id', id),
    ]);
    const it = item.data as { id: string; code: string; title: string; estimated_duration_hours: number | null; instructions: unknown } | null;
    if (!it) return null;
    return {
      id: it.id, code: it.code, title: it.title,
      estimatedHours: Number(it.estimated_duration_hours) || 0,
      instructions: Array.isArray(it.instructions) ? it.instructions : [],
      roles: ((roles.data || []) as { role_code: string; quantity: number | null; estimated_hours: number | null }[])
        .map(r => ({ contactType: r.role_code, headcount: r.quantity ?? 1, hours: Number(r.estimated_hours) || undefined })),
      inventory: ((inv.data || []) as { inventory_item_id: string; quantity: number | null; notes: string | null; inventory_items?: { code?: string; description?: string } | null }[])
        .map(i => ({ inventoryId: i.inventory_item_id, description: [i.inventory_items?.code, i.inventory_items?.description].filter(Boolean).join(' — ') || i.notes || '', qty: Number(i.quantity) || 1 })),
    };
  }

  /** Match the decision's named spares to stock items by part number, then by description. */
  private async matchSpares(spares: SpareRequirement[] | null | undefined): Promise<SpareMatch[]> {
    const list = (spares || []).filter(s => s && (s.part_number || s.description));
    if (list.length === 0) return [];
    const codes = list.map(s => s.part_number).filter(Boolean);
    const byCode = new Map<string, string>();
    if (codes.length) {
      const { data } = await supabase.from('inventory_items').select('id, code').in('code', codes);
      for (const row of (data || []) as { id: string; code: string }[]) byCode.set(row.code, row.id);
    }
    const out: SpareMatch[] = [];
    for (const s of list) {
      let inventoryId = s.part_number ? byCode.get(s.part_number) ?? null : null;
      if (!inventoryId && s.description) {
        const { data } = await supabase.from('inventory_items').select('id').ilike('description', s.description).limit(1);
        inventoryId = (data?.[0] as { id: string } | undefined)?.id ?? null;
      }
      out.push({ part_number: s.part_number, description: s.description, qty: s.qty || 1, inventoryId });
    }
    return out;
  }

  /**
   * Join the PM to the asset's RCM strategy as a package (0292). Strategy
   * writes are governance (admin) under 0186, so for a non-admin this is a
   * quiet skip, never a failed PM.
   */
  private async attachStrategyPackage(study: RCMStudy, pmId: string, label: string, intervalDays: number): Promise<string | null> {
    try {
      const { data: asset } = await supabase.from('assets').select('tag').eq('id', study.asset_id).maybeSingle();
      const name = `RCM — ${(asset as { tag?: string } | null)?.tag || study.title}`;
      let stratId: string | null = null;
      const existing = await supabase.from('maintenance_strategies').select('id').eq('name', name).maybeSingle();
      stratId = (existing.data as { id: string } | null)?.id ?? null;
      if (!stratId) {
        const ins = await supabase.from('maintenance_strategies')
          .insert({ name, description: `Packages generated from RCM study "${study.title}" — same-day longer packages absorb shorter ones.`, active: true })
          .select('id').single();
        if (ins.error) return null;
        stratId = (ins.data as { id: string }).id;
      }
      const pkg = await supabase.from('strategy_packages').select('id').eq('strategy_id', stratId).eq('label', label).maybeSingle();
      if (!pkg.data) {
        const insP = await supabase.from('strategy_packages')
          .insert({ strategy_id: stratId, label, interval_days: intervalDays, task_count: 1, sort_order: intervalDays })
          .select('id').single();
        if (insP.error) return null;
      }
      const { error } = await supabase.from('recurring_work').update({ strategy_id: stratId, strategy_package: label }).eq('id', pmId);
      return error ? null : label;
    } catch {
      return null;
    }
  }

  /**
   * Does a person take this reading? Yes when the technology names a round,
   * when nothing streams it, or when the asset has no live feed for it yet —
   * then the PM must be a calendar schedule so a work order reaches someone.
   */
  private async readByPersonFor(study: RCMStudy, d: RCMDecision): Promise<boolean> {
    if (canonicalStrategyCode(d.recommended_strategy_code) !== 'PM_CONDITION') return false;
    const tech = decisionTechnology(d);
    if (!readsBySensor(tech) || readsByPerson(tech)) return true;
    if (d.reading_definition_id) {
      const feeds = await this.lastFeedByPoint([d.reading_definition_id]);
      if (feeds.has(d.reading_definition_id)) return false;
      const { data } = await supabase.from('reading_definitions').select('sensor_tag').eq('id', d.reading_definition_id).maybeSingle();
      if ((data as { sensor_tag?: string | null } | null)?.sensor_tag) return false;
    }
    const reality = await this.getMonitoringReality(study.asset_id);
    return !reality.hasLiveFeed;
  }

  private async insertPMForDecision(
    study: RCMStudy, d: RCMDecision, failureModeDescription: string,
  ): Promise<{ ok: true; pmCode: string; meterCadence: boolean; packageLabel: string | null } | { ok: false; reason: string }> {
    const [jobPlan, spares] = await Promise.all([
      this.resolveJobPlan(d.task_library_item_id),
      this.matchSpares(d.spares_requirements),
    ]);
    const readByPerson = await this.readByPersonFor(study, d);
    const built = buildPMFromDecision(study, d, failureModeDescription, { jobPlan, spares, readByPerson });
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
    const packageLabel = built.packageLabel && built.intervalDays
      ? await this.attachStrategyPackage(study, pmCode, built.packageLabel, built.intervalDays)
      : null;
    return { ok: true, pmCode, meterCadence: built.meterCadence, packageLabel };
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
  /** Latest connector/collector write per point — the evidence a feed exists. */
  private async lastFeedByPoint(pointIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (pointIds.length === 0) return out;
    const { data } = await supabase.from('reading_logs')
      .select('definition_id, created_at, entered_by')
      .in('definition_id', pointIds)
      .or(FEED_WRITERS.map(w => `entered_by.ilike.${w}`).join(','))
      .order('created_at', { ascending: false })
      .limit(500);
    for (const r of (data || []) as { definition_id: string; created_at: string }[]) {
      if (!out.has(r.definition_id)) out.set(r.definition_id, r.created_at);
    }
    return out;
  }

  /**
   * The asset's condition-monitoring reality: how many points it has, whether
   * any is fed by an instrument, when data last arrived. The K-601 walkthrough
   * approved five "online sensor" decisions on an asset with no points and no
   * feed — a plan nobody could act on.
   */
  async getMonitoringReality(assetId: string | null | undefined): Promise<RCMMonitoringReality> {
    const none: RCMMonitoringReality = { points: 0, pointsWithSensorTag: 0, lastReadingAt: null, lastFeedAt: null, hasLiveFeed: false };
    if (!assetId || !UUID_RE.test(assetId)) return none;
    const { data: defs } = await supabase.from('reading_definitions').select('id, sensor_tag, is_active').eq('asset_id', assetId);
    const points = ((defs || []) as { id: string; sensor_tag: string | null; is_active: boolean | null }[]).filter(d => d.is_active !== false);
    const tagged = points.filter(d => !!d.sensor_tag).length;
    const { data: last } = await supabase.from('reading_logs').select('created_at').eq('asset_id', assetId).order('created_at', { ascending: false }).limit(1);
    const lastReadingAt = (last?.[0] as { created_at?: string } | undefined)?.created_at || null;
    const feeds = await this.lastFeedByPoint(points.map(p => p.id));
    const lastFeedAt = [...feeds.values()].sort().pop() || null;
    return { points: points.length, pointsWithSensorTag: tagged, lastReadingAt, lastFeedAt, hasLiveFeed: tagged > 0 || isRecent(lastFeedAt) };
  }

  /** One prompt paragraph the strategy Specialist reads before naming a technology. */
  private async monitoringRealityFor(assetId: string | null | undefined): Promise<string> {
    const r = await this.getMonitoringReality(assetId);
    if (!assetId) return '';
    const age = (iso: string | null) => iso ? `${Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000))} days ago` : 'never';
    return [
      'Condition monitoring in place on this asset (from the register, not an assumption):',
      `- Monitoring points: ${r.points}${r.points ? ` (${r.pointsWithSensorTag} fed by an instrument)` : ''}`,
      `- Last reading of any kind: ${age(r.lastReadingAt)}; last instrument feed: ${age(r.lastFeedAt)}`,
      `- Live sensor feed: ${r.hasLiveFeed ? 'YES' : 'NO'}`,
    ].join('\n');
  }

  async getTaskSummaries(studyId: string): Promise<RCMTaskSummary[]> {
    const functions = await this.getFunctions(studyId);
    const failureModes = await this.getFailureModesByStudy(studyId);
    const decisions = await this.getDecisions(studyId);

    const decisionMap = new Map(decisions.map(d => [d.failure_mode_id, d]));
    const fnMap = new Map(functions.map(f => [f.id, f]));

    // When each linked PM was generated — a decision edited after that is a
    // plan the CMMS no longer matches.
    const pmIds = decisions.map(d => d.recurring_work_id).filter((v): v is string => !!v);
    const pmCreated = new Map<string, string>();
    if (pmIds.length > 0) {
      const { data: pms } = await supabase.from('recurring_work').select('id, created_at, origin').in('id', pmIds);
      for (const p of (pms || []) as { id: string; created_at: string; origin?: { created_at?: string } | null }[]) {
        pmCreated.set(p.id, p.origin?.created_at || p.created_at);
      }
    }

    // What already exists for each decision — the PM, the monitoring point,
    // the redesign work order — so the plan can show the thing, not a flag.
    const pmRows = new Map<string, NonNullable<RCMTaskSummary['pm']>>();
    if (pmIds.length > 0) {
      const { data } = await supabase.from('recurring_work')
        .select('id, title, next_due_date, schedule_type, strategy_package, frequency_interval, frequency_unit, active')
        .in('id', pmIds);
      for (const r of (data || []) as Record<string, unknown>[]) {
        pmRows.set(String(r.id), {
          id: String(r.id), title: String(r.title || ''), next_due_date: (r.next_due_date as string) || null,
          schedule_type: (r.schedule_type as string) || null, strategy_package: (r.strategy_package as string) || null,
          frequency_interval: r.frequency_interval == null ? null : Number(r.frequency_interval), frequency_unit: (r.frequency_unit as string) || null,
          active: r.active !== false,
        });
      }
    }
    const pointIds = decisions.map(d => d.reading_definition_id).filter((v): v is string => !!v);
    const pointRows = new Map<string, NonNullable<RCMTaskSummary['point']>>();
    if (pointIds.length > 0) {
      const { data } = await supabase.from('reading_definitions')
        .select('id, name, unit, min_warning, max_warning, min_critical, max_critical, pf_interval_days, is_active, sensor_tag')
        .in('id', pointIds);
      // A feed is real when a connector or collector has written to the point
      // recently — a person's manual entry is not a feed.
      const lastFeed = await this.lastFeedByPoint(pointIds);
      for (const r of (data || []) as Record<string, unknown>[]) {
        const feedAt = lastFeed.get(String(r.id)) || null;
        pointRows.set(String(r.id), {
          id: String(r.id), name: String(r.name || ''), unit: (r.unit as string) || null,
          has_bands: [r.min_warning, r.max_warning, r.min_critical, r.max_critical].some(x => x != null),
          pf_interval_days: r.pf_interval_days == null ? null : Number(r.pf_interval_days), is_active: r.is_active !== false,
          sensor_tag: (r.sensor_tag as string) || null,
          has_feed: !!r.sensor_tag || isRecent(feedAt),
          last_feed_at: feedAt,
        });
      }
    }
    const woIds = decisions.map(d => d.work_order_id).filter((v): v is string => !!v);
    const woRows = new Map<string, NonNullable<RCMTaskSummary['wo']>>();
    if (woIds.length > 0) {
      const { data } = await supabase.from('work_orders').select('id, wo_number, status').in('id', woIds);
      for (const r of (data || []) as Record<string, unknown>[]) {
        woRows.set(String(r.id), { id: String(r.id), wo_number: (r.wo_number as string) || null, status: (r.status as string) || null });
      }
    }

    return failureModes.map(fm => {
      const decision = decisionMap.get(fm.id);
      const fn = fnMap.get(fm.function_id);
      const ai = decision?.ai_recommendation as { suggested_technology?: string | null } | null | undefined;
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
        recurring_work_id: decision?.recurring_work_id || null,
        decision_updated_at: decision?.updated_at || null,
        pm_created_at: decision?.recurring_work_id ? pmCreated.get(decision.recurring_work_id) || null : null,
        justification: decision?.justification || null,
        task_library_item_id: decision?.task_library_item_id || null,
        technology: String(decision?.on_condition_technology || ai?.suggested_technology || '').trim() || null,
        reading_definition_id: decision?.reading_definition_id || null,
        work_order_id: decision?.work_order_id || null,
        bom_item_id: fm.bom_item_id || null,
        pm: decision?.recurring_work_id ? pmRows.get(decision.recurring_work_id) || null : null,
        point: decision?.reading_definition_id ? pointRows.get(decision.reading_definition_id) || null : null,
        wo: decision?.work_order_id ? woRows.get(decision.work_order_id) || null : null,
      };
    });
  }

  // ─── Implementing a decision (Maintenance Plan) ─────────────────────────

  /**
   * Rewrite the linked PM from the decision. A decision edited after its PM
   * was generated is a plan the CMMS no longer matches; this brings the PM
   * back in step — title, task, interval, priority, templates — and stamps
   * origin.created_at so the "changed since" check clears. The PM's id, code,
   * package and history stay.
   */
  async syncPMForDecision(studyId: string, failureModeId: string): Promise<{ ok: true; pmCode: string } | { ok: false; reason: string }> {
    const study = await this.getStudy(studyId);
    if (!study) return { ok: false, reason: 'study not found' };
    const decisions = await this.getDecisions(studyId);
    const d = decisions.find(x => x.failure_mode_id === failureModeId);
    if (!d) return { ok: false, reason: 'decision not saved yet' };
    if (!d.recurring_work_id) return { ok: false, reason: 'this decision has no PM to sync — create it first' };
    const fms = await this.getFailureModesByStudy(studyId);
    const name = fms.find(x => x.id === d.failure_mode_id)?.failure_mode_description || 'Failure mode';
    const [jobPlan, spares] = await Promise.all([this.resolveJobPlan(d.task_library_item_id), this.matchSpares(d.spares_requirements)]);
    // The builder refuses an already-generated decision; we are regenerating on purpose.
    const readByPerson = await this.readByPersonFor(study, d);
    const built = buildPMFromDecision(study, { ...d, recurring_work_id: null }, name, { jobPlan, spares, readByPerson });
    if (!built.ok) return built;
    let row: Record<string, unknown>;
    try { row = buildPMStrategy(built.input); } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
    const { data: existing } = await supabase.from('recurring_work').select('origin, next_due_date').eq('id', d.recurring_work_id).maybeSingle();
    const origin = { ...((existing as { origin?: Record<string, unknown> } | null)?.origin || {}), ...((row.origin as Record<string, unknown>) || {}), created_at: new Date().toISOString(), synced_from_decision: d.id };
    const patch: Record<string, unknown> = {
      title: row.title, description: row.description, schedule_type: row.schedule_type,
      frequency_interval: row.frequency_interval, frequency_unit: row.frequency_unit,
      priority_code: row.priority_code, est_duration: row.est_duration, templates: row.templates ?? null,
      origin, updated_at: new Date().toISOString(),
    };
    // Keep a due date the scheduler already set; only fill one in when there is none.
    if (!(existing as { next_due_date?: string } | null)?.next_due_date && row.next_due_date) patch.next_due_date = row.next_due_date;
    const { error } = await supabase.from('recurring_work').update(patch).eq('id', d.recurring_work_id);
    if (error) {
      console.error('[RCM] syncPMForDecision error:', error);
      return { ok: false, reason: error.code === '42501' ? 'you do not have permission to change PMs' : error.message || 'update rejected' };
    }
    return { ok: true, pmCode: d.recurring_work_id };
  }

  /**
   * Redesign is a one-off change: raise the work order that carries it out
   * and remember it on the decision (0326), so the plan can show it.
   */
  async createRedesignWOForDecision(studyId: string, failureModeId: string, actor: string): Promise<{ ok: true; id: string; woNumber: string | null } | { ok: false; reason: string }> {
    const study = await this.getStudy(studyId);
    if (!study) return { ok: false, reason: 'study not found' };
    if (!study.asset_id || !UUID_RE.test(study.asset_id)) return { ok: false, reason: 'the study is not linked to an asset in the register' };
    const decisions = await this.getDecisions(studyId);
    const d = decisions.find(x => x.failure_mode_id === failureModeId);
    if (!d) return { ok: false, reason: 'decision not saved yet' };
    if (d.work_order_id) return { ok: false, reason: 'a redesign work order is already raised for this decision' };
    if (canonicalStrategyCode(d.recommended_strategy_code) !== 'REDESIGN') return { ok: false, reason: 'only a Redesign decision raises a work order here' };
    const fms = await this.getFailureModesByStudy(studyId);
    const name = fms.find(x => x.id === d.failure_mode_id)?.failure_mode_description || 'Failure mode';
    const task = String(d.task_description || '').trim();
    const brief = briefJustification(d.justification);
    const description = [
      task || `Redesign to remove the failure mode "${name}".`,
      '',
      `RCM study "${study.title}"${study.revision ? ` rev ${study.revision}` : ''} · Failure mode: ${name} · Consequence: ${d.consequence_code || 'unclassified'}`,
      brief ? `\n${brief}` : '',
    ].join('\n').trim();
    const row = buildWorkOrder({
      title: `Redesign — ${name}`.slice(0, 120),
      description,
      assetId: study.asset_id,
      type: 'CM',
      priorityCode: /SAFETY/i.test(d.consequence_code || '') ? 'HIGH' : 'MEDIUM',
      status: 'OPEN',
      createdBy: actor || null,
      properties: { origin: { source: 'rcm_redesign', study_id: study.id, decision_id: d.id, failure_mode_id: d.failure_mode_id } },
    });
    const { data, error } = await supabase.from('work_orders').insert(row).select('id, wo_number').single();
    if (error || !data) {
      console.error('[RCM] createRedesignWOForDecision error:', error);
      return { ok: false, reason: error?.code === '42501' ? 'you do not have permission to raise work orders' : error?.message || 'insert rejected' };
    }
    const wo = data as { id: string; wo_number: string | null };
    const linked = await this.updateDecision(d.id, { work_order_id: wo.id });
    if (!linked) console.warn('[RCM] redesign WO raised but decision link failed (0326 applied?)', wo.id);
    return { ok: true, id: wo.id, woNumber: wo.wo_number ?? null };
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
        /** the registered component tag this mode belongs to (echoed from the breakdown), or '' */
        component?: string;
        /** the BOM part number / description the mode is about, or '' */
        part?: string;
      }>;
    }>;
  } | null> {
    if (!isAIAvailable()) return null;

    const assetContext = await this.assetContextFor(study);

    const prompt = `You are performing an RCM study per SAE JA1011.
${assetContext}
Operating Context: ${study.operating_context || 'General industrial service'}
Study Type: ${study.study_type}

Generate a comprehensive list of functions, functional failures, and failure modes for this asset.
Use ISO 14224 failure coding conventions. Where the register lists components and a bill of
materials above, work THROUGH them: every registered component with a plausible failure should
get at least one failure mode, pinned to it by its tag, and a mode about a listed part should
name that part. Do not invent components the register does not have.

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
          "effect_plant": "Plant-level end effect",
          "component": "Tag of the registered component this belongs to, exactly as listed, or empty",
          "part": "Part number of the BOM line this is about, exactly as listed, or empty"
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
    const monitoring = opts.study?.asset_id ? await this.monitoringRealityFor(opts.study.asset_id) : '';
    const prompt = `Recommend the maintenance strategy for this failure mode using the SAE JA1012 decision logic.
${assetCtx ? `\n${assetCtx}\n` : ''}${monitoring ? `\n${monitoring}\n` : ''}${opts.study?.operating_context ? `Operating context: ${opts.study.operating_context}\n` : ''}
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
  "strategy": "PM_CONDITION|PM_TIME|RTF|REDESIGN",
  "task_type": "ON_CONDITION|FAILURE_FINDING (for PM_CONDITION) | SCHEDULED_RESTORATION|SCHEDULED_DISCARD (for PM_TIME) | null",
  "task_description": "ONE imperative task statement for the technician, max 140 characters (e.g. 'Replace ignitor plug and verify spark gap 2.0 mm'). Never the reasoning, never a list.",
  "interval_value": 6,
  "interval_unit": "Hours|Days|Weeks|Months|Years",
  "task_owner_craft": "e.g. Instrument Technician",
  "justification": "2-4 sentences: why this task type and interval (P-F interval, failure pattern, consequence, cost-benefit).",
  "reasoning": "The step-by-step JA1012 walk-through you followed.",
  "confidence": 0.85,
  "suggested_technology": "for PM_CONDITION: how the condition is read - visual/manual inspection, vibration, thermography, oil analysis, ultrasound, online sensor; else empty"
}
Rules: pick exactly ONE strategy (there is no combined option - if two tasks are needed, recommend the one that controls the dominant failure mechanism and mention the other in justification). PM_CONDITION covers every on-condition task, inspected by a person or monitored by a sensor - say which in suggested_technology; there is no separate predictive strategy. suggested_technology must match the monitoring actually in place: when the asset has NO live sensor feed, name the method a person performs on a round (visual inspection, handheld vibration meter, oil sample to the lab, gauge reading, thermography) and only add 'online sensor' as a future step; write the task so a technician can do it with what exists today. interval_value must be a single integer with a unit - never a range or 'per OEM'. For RTF or REDESIGN set interval_value and task_type to null and describe the default action in task_description.`;

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
  /**
   * The asset block every Specialist prompt opens with: identity, ISO 14224
   * classification, criticality, make/model, and the operating context from
   * the register (design vs operating values, derating flags). Before 0317
   * the prompts carried tag/level/criticality/make/model only, so the model
   * drafted a textbook study for an unnamed machine.
   */
  private async assetContextFor(study: RCMStudy): Promise<string> {
    const ctx = await this.getAssetContext(study.asset_id);
    if (!ctx) return '';
    const cat = getCategory(ctx.asset_category)?.label || ctx.asset_category || 'unclassified';
    const cls = getClass(ctx.asset_class)?.label || ctx.asset_class || '';
    const typ = getType(ctx.asset_type_code)?.label || ctx.asset_type_code || '';
    const lines = [
      `Asset: ${ctx.tag} - ${ctx.name}`,
      `Hierarchy level: ${ctx.hierarchy_level || 'EQUIPMENT'} (ISO 14224 equipment unit)`,
      `ISO 14224 classification: ${[cat, cls, typ].filter(Boolean).join(' > ')}`,
      `Criticality: ${ctx.criticality || 'not rated'}`,
      `Manufacturer: ${ctx.manufacturer || 'Unknown'}`,
      `Model: ${ctx.model || 'Unknown'}`,
    ];
    // The narrative already opens with the tag/name line — drop it here.
    const narrative = ctx.narrative.split('\n').slice(1).join('\n').trim();
    if (narrative) lines.push('Operating context from the asset register (design vs operating — treat "ABOVE DESIGN" as accelerated-wear evidence):', narrative);
    // What the machine is made of (0318): components to pin modes to, parts a task consumes.
    const breakdown = renderBreakdownForPrompt(await this.getAssetBreakdown(study.asset_id));
    if (breakdown) lines.push('Physical breakdown from the register (ISO 14224 subunits / maintainable items):', breakdown);
    return lines.join('\n');
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
    component?: string;
    part?: string;
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
coding conventions. 4–8 modes. Severity and occurrence are 1–10 FMEA scales. Where the register
lists components and parts above, pin each mode to the component tag it belongs to and name the
part it is about; do not invent components the register does not have.

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
      "occurrence": 1,
      "component": "Registered component tag exactly as listed, or empty",
      "part": "BOM part number exactly as listed, or empty"
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

