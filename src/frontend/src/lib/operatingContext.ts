// ─────────────────────────────────────────────────────────────────────────────
// Asset operating context — ISO 14224 §7 / Table 5 operating data plus the
// Annex A class-specific design & operating parameters, stored on
// assets.operating_context (JSONB, 0317) and consumed by RCM (SAE JA1011
// §5.1: the operating context must be defined and recorded before the seven
// questions are answered).
//
// Pure functions — no I/O, no React (tests: operatingContext.test.ts). The Details-tab card edits the shape,
// RCM composes the narrative and snapshots it onto the study, the Specialist
// prompts render it, and the readiness gate reads its completeness.
// ─────────────────────────────────────────────────────────────────────────────
import { parameterTemplateFor, type ParameterTemplate } from './iso14224Parameters';
import { getCategory, getClass, getType } from './iso14224Taxonomy';

export type OperatingMode = 'continuous' | 'intermittent' | 'standby' | 'seasonal' | 'batch';
export type Redundancy = 'none' | '2x100' | '3x50' | 'n_plus_1' | 'other';

export const OPERATING_MODES: Array<{ code: OperatingMode; label: string; hint: string }> = [
  { code: 'continuous',   label: 'Continuous',   hint: 'Runs whenever the plant runs (24/7 duty)' },
  { code: 'intermittent', label: 'Intermittent', hint: 'Runs on demand or by schedule, regularly' },
  { code: 'standby',      label: 'Standby',      hint: 'Installed spare — runs only when the duty unit trips or on test' },
  { code: 'seasonal',     label: 'Seasonal',     hint: 'Long idle periods (winterised, campaign duty)' },
  { code: 'batch',        label: 'Batch',        hint: 'Start/stop cycles per batch' },
];

export const REDUNDANCY_OPTIONS: Array<{ code: Redundancy; label: string }> = [
  { code: 'none',     label: 'None — single unit' },
  { code: '2x100',    label: '2 × 100 % (duty / standby)' },
  { code: '3x50',     label: '3 × 50 %' },
  { code: 'n_plus_1', label: 'N + 1' },
  { code: 'other',    label: 'Other' },
];

export const ENVIRONMENT_OPTIONS: string[] = [
  'Indoor', 'Outdoor', 'Onshore', 'Offshore', 'Subsea', 'Hazardous area (Ex)',
  'Corrosive / marine atmosphere', 'Dusty / abrasive', 'High ambient temperature', 'Arctic / low temperature',
  'High humidity', 'Vibration-prone', 'Sour service (H₂S)', 'Cryogenic',
];

export interface OperatingParameter {
  key: string;
  label: string;
  unit: string;
  /** design / rated / nameplate value */
  design?: number | string | null;
  /** normal operating value */
  operating?: number | string | null;
  /** maximum operating value seen or allowed */
  max?: number | string | null;
  /** nameplate-only parameter (no operating column) */
  kind?: 'both' | 'design';
  text?: boolean;
  /** user-added row, not from the class template */
  custom?: boolean;
  note?: string;
}

export interface AssetOperatingContext {
  mode?: OperatingMode | null;
  /** % of calendar time in operation */
  utilisation_pct?: number | null;
  hours_per_year?: number | null;
  starts_per_year?: number | null;
  redundancy?: Redundancy | null;
  environment?: string[];
  service_medium?: string | null;
  parameters?: OperatingParameter[];
  updated_at?: string | null;
  updated_by?: string | null;
}

export interface ContextAssetLike {
  tag?: string | null; name?: string | null;
  /** The register's Description field — carries the duty narrative (no separate duty field). */
  description?: string | null;
  criticality?: string | null;
  manufacturer?: string | null; model?: string | null;
  assetCategory?: string | null; assetClass?: string | null; assetType?: string | null;
  asset_category?: string | null; asset_class?: string | null; asset_type_code?: string | null;
  hierarchyLevel?: string | null; hierarchy_level?: string | null;
}

export const EMPTY_CONTEXT: AssetOperatingContext = { parameters: [] };

export function normalizeContext(raw: unknown): AssetOperatingContext {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CONTEXT, parameters: [] };
  const r = raw as Record<string, unknown>;
  return {
    mode: (r.mode as OperatingMode) || null,
    utilisation_pct: numOrNull(r.utilisation_pct),
    hours_per_year: numOrNull(r.hours_per_year),
    starts_per_year: numOrNull(r.starts_per_year),
    redundancy: (r.redundancy as Redundancy) || null,
    environment: Array.isArray(r.environment) ? r.environment.map(String) : [],
    service_medium: (r.service_medium as string) || null,
    parameters: Array.isArray(r.parameters) ? (r.parameters as OperatingParameter[]).filter(p => p && p.key) : [],
    updated_at: (r.updated_at as string) || null,
    updated_by: (r.updated_by as string) || null,
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A template row as an (empty) parameter row. */
function fromTemplate(t: ParameterTemplate): OperatingParameter {
  return { key: t.key, label: t.label, unit: t.unit, kind: t.kind, ...(t.text ? { text: true } : {}), design: null, operating: null, max: null };
}

/**
 * Merge the class template into the stored rows: keep every stored row (its
 * values are the user's), add template rows that are missing, and order the
 * template rows first, custom rows last. Changing class never loses a value.
 */
export function mergeTemplate(ctx: AssetOperatingContext, classCode?: string | null, categoryCode?: string | null): AssetOperatingContext {
  const template = parameterTemplateFor(classCode, categoryCode);
  const existing = new Map((ctx.parameters || []).map(p => [p.key, p]));
  const merged: OperatingParameter[] = template.map(t => {
    const have = existing.get(t.key);
    if (!have) return fromTemplate(t);
    existing.delete(t.key);
    // keep the user's values, refresh label/unit/kind from the template
    return { ...have, label: t.label, unit: t.unit, kind: t.kind, text: t.text, custom: false };
  });
  for (const rest of existing.values()) {
    // rows from a previous class that hold no value are dropped; rows with a value survive as custom
    if (hasAnyValue(rest)) merged.push({ ...rest, custom: true });
  }
  return { ...ctx, parameters: merged };
}

export function hasAnyValue(p: OperatingParameter): boolean {
  return [p.design, p.operating, p.max].some(v => v !== null && v !== undefined && String(v).trim() !== '');
}

/** operating ÷ design as a percentage, when both are numbers. */
export function utilisationOf(p: OperatingParameter): number | null {
  const d = numOrNull(p.design); const o = numOrNull(p.operating);
  if (d === null || o === null || d === 0) return null;
  return Math.round((o / d) * 1000) / 10;
}

export type DeviationFlag = 'above_design' | 'far_below_design' | null;

/** Operating above design, or so far below that the duty point is off-design (pumps off-BEP, motors under-loaded…). */
export function deviationFlag(p: OperatingParameter): DeviationFlag {
  const u = utilisationOf(p);
  if (u === null) return null;
  if (u > 100) return 'above_design';
  if (u < 50) return 'far_below_design';
  return null;
}

export interface ContextCompleteness {
  complete: boolean;
  /** 0–100 */
  score: number;
  missing: string[];
  filledParameters: number;
  totalParameters: number;
}

/**
 * What RCM needs from the register before a study is worth an AI call:
 * a mode, what the asset handles or where it sits, and at least one
 * parameter with both a design and an operating value. The duty narrative
 * comes from the asset's own Description field, not a second free-text box.
 */
export function contextCompleteness(ctx: AssetOperatingContext | null | undefined): ContextCompleteness {
  const c = ctx || EMPTY_CONTEXT;
  const params = c.parameters || [];
  const filled = params.filter(p => (p.kind === 'design' ? p.design != null && String(p.design).trim() !== '' : hasBoth(p))).length;
  const anyBoth = params.some(hasBoth);
  const hasSetting = !!c.service_medium || (c.environment || []).length > 0;
  const missing: string[] = [];
  if (!c.mode) missing.push('Operating mode');
  if (!hasSetting) missing.push('Service medium or environment');
  if (!anyBoth) missing.push('At least one parameter with design and operating values');
  const checks = [!!c.mode, hasSetting, anyBoth, !!c.redundancy, c.utilisation_pct != null || c.hours_per_year != null];
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  return { complete: missing.length === 0, score, missing, filledParameters: filled, totalParameters: params.length };
}

function hasBoth(p: OperatingParameter): boolean {
  return p.design != null && String(p.design).trim() !== '' && p.operating != null && String(p.operating).trim() !== '';
}

const fmt = (v: number | string | null | undefined, unit: string): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '—';
  const n = Number(v);
  const s = Number.isFinite(n) && String(v).trim() !== '' && !isNaN(n) ? n.toLocaleString() : String(v);
  return unit ? `${s} ${unit}` : s;
};

function classificationLine(a: ContextAssetLike): string {
  const cat = getCategory(a.assetCategory || a.asset_category);
  const cls = getClass(a.assetClass || a.asset_class);
  const typ = getType(a.assetType || a.asset_type_code);
  const parts = [cat?.label, cls?.label, typ?.label].filter(Boolean);
  return parts.length ? parts.join(' › ') : '';
}

/**
 * The JA1011 operating-context narrative, composed from the structured data.
 * This is what a new RCM study starts with when a register asset is linked,
 * and what the Specialist prompts read. Deterministic — same data, same text.
 */
export function composeOperatingContext(asset: ContextAssetLike, ctx: AssetOperatingContext | null | undefined): string {
  const c = ctx || EMPTY_CONTEXT;
  const lines: string[] = [];
  const cls = classificationLine(asset);
  const head = [asset.tag, asset.name].filter(Boolean).join(' — ');
  if (head || cls) lines.push(`${head}${cls ? ` (${cls})` : ''}${asset.criticality ? `, criticality ${asset.criticality}` : ''}.`);
  if (asset.manufacturer || asset.model) lines.push(`Make/model: ${[asset.manufacturer, asset.model].filter(Boolean).join(' ')}.`);
  // The duty narrative is the register's Description — there is no second box.
  const desc = String(asset.description || '').trim();
  if (desc && desc !== String(asset.name || '').trim()) lines.push(desc.replace(/\.?$/, '.'));

  const duty: string[] = [];
  if (c.mode) duty.push(`${OPERATING_MODES.find(m => m.code === c.mode)?.label || c.mode} duty`);
  if (c.utilisation_pct != null) duty.push(`~${c.utilisation_pct}% utilisation`);
  if (c.hours_per_year != null) duty.push(`${c.hours_per_year.toLocaleString()} h/year`);
  if (c.starts_per_year != null) duty.push(`${c.starts_per_year} starts/year`);
  if (c.redundancy) duty.push(`redundancy ${REDUNDANCY_OPTIONS.find(r => r.code === c.redundancy)?.label || c.redundancy}`);
  if (duty.length) lines.push(`Operation: ${duty.join(', ')}.`);
  if (c.service_medium) lines.push(`Service medium: ${c.service_medium}.`);
  if (c.environment && c.environment.length) lines.push(`Environment: ${c.environment.join(', ')}.`);

  const params = (c.parameters || []).filter(hasAnyValue);
  if (params.length) {
    lines.push('Design vs operating:');
    for (const p of params) {
      const u = utilisationOf(p);
      const flag = deviationFlag(p);
      const tail = p.kind === 'design' || p.text
        ? `${fmt(p.design, p.unit)}`
        : `design ${fmt(p.design, p.unit)}, operating ${fmt(p.operating, p.unit)}${p.max != null && String(p.max) !== '' ? `, max ${fmt(p.max, p.unit)}` : ''}${u !== null ? ` (${u}% of design${flag === 'above_design' ? ' — ABOVE DESIGN' : flag === 'far_below_design' ? ' — far below design' : ''})` : ''}`;
      lines.push(`- ${p.label}: ${tail}`);
    }
  }
  return lines.join('\n');
}

/** Snapshot kept on the RCM study: what the analysis assumed. */
export interface ContextSnapshot {
  taken_at: string;
  asset_updated_at: string | null;
  context: AssetOperatingContext;
  classification: { category?: string | null; cls?: string | null; type?: string | null };
}

export function takeSnapshot(asset: ContextAssetLike, ctx: AssetOperatingContext | null | undefined, now = new Date()): ContextSnapshot {
  const c = normalizeContext(ctx);
  return {
    taken_at: now.toISOString(),
    asset_updated_at: c.updated_at || null,
    context: c,
    classification: {
      category: asset.assetCategory || asset.asset_category || null,
      cls: asset.assetClass || asset.asset_class || null,
      type: asset.assetType || asset.asset_type_code || null,
    },
  };
}

/** Has the asset's context been edited since the study snapshotted it? */
export function contextChangedSince(snapshot: ContextSnapshot | null | undefined, current: AssetOperatingContext | null | undefined): boolean {
  if (!snapshot) return false;
  const cur = current?.updated_at || null;
  if (!cur) return false;
  if (!snapshot.asset_updated_at) return true;
  return new Date(cur).getTime() > new Date(snapshot.asset_updated_at).getTime();
}
