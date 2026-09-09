// ─────────────────────────────────────────────────────────────────────────────
// The asset's physical breakdown as an RCM study sees it.
//
// ISO 14224 subdivides an equipment unit (L6) into subunits (L7), maintainable
// items (L8) and parts (L9). In this register that is: the asset's CHILD
// ASSETS at equipment-class levels (SUBUNIT / COMPONENT rows in the tree) and
// its BOM lines (asset_bom — the maintainable items and spares). SAE JA1011
// asks that every reasonably likely failure mode be identified; the honest
// way to answer "did we?" is per component — so failure modes can be pinned
// to a component or a BOM line, the Specialist is told what the machine is
// made of, and the study shows which components still have no failure mode.
//
// Pure functions — no I/O. RCMService loads the breakdown; the page and the
// prompts render it through here.
// ─────────────────────────────────────────────────────────────────────────────

export interface BreakdownComponent {
  id: string;
  tag: string;
  name: string;
  /** hierarchy level code (SUBUNIT / COMPONENT / …) */
  level: string | null;
  criticality?: string | null;
  assetClass?: string | null;
  assetType?: string | null;
  parentId?: string | null;
  /** depth under the study asset: 1 = direct child */
  depth: number;
  /** 0351 — the study item this row is (when the breakdown is the study's own list) */
  itemId?: string | null;
  /** 0351 — the register asset behind it, if any (a manual item has none) */
  assetId?: string | null;
}

export interface BreakdownPart {
  id: string;
  partNumber: string;
  description: string;
  qty: number;
  uom: string;
  critical: boolean;
  /** linked material master, when the BOM line is a stocked item */
  inventoryItemId?: string | null;
  replacementIntervalDays?: number | null;
  /** 0351 — the study item this row is */
  itemId?: string | null;
  /** 0351 — the asset_bom line behind it, if any */
  bomItemId?: string | null;
}

export interface AssetBreakdown {
  components: BreakdownComponent[];
  parts: BreakdownPart[];
}

export const EMPTY_BREAKDOWN: AssetBreakdown = { components: [], parts: [] };

// ── 0351: the study's own item list as a breakdown ──────────────────────────

/** The row shape of ers_rcm_study_items, as much of it as the breakdown needs. */
export interface StudyItemLike {
  id: string;
  parent_item_id?: string | null;
  kind: 'subunit' | 'component' | 'part';
  tag?: string | null;
  name: string;
  critical?: boolean | null;
  qty?: number | string | null;
  uom?: string | null;
  replacement_interval_days?: number | null;
  asset_id?: string | null;
  bom_item_id?: string | null;
  inventory_item_id?: string | null;
  sort_order?: number | null;
}

/**
 * Items → breakdown. A component row's `id` is the study item id (what the
 * pin stores in study_item_id); `assetId` carries the register link when the
 * item came from there. Depth follows parent_item_id. Parts likewise.
 */
export function breakdownFromItems(items: StudyItemLike[] | null | undefined): AssetBreakdown {
  const list = [...(items || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.tag || a.name).localeCompare(String(b.tag || b.name)));
  const byId = new Map(list.map(i => [i.id, i]));
  const depthOf = (i: StudyItemLike): number => {
    let d = 1; let p = i.parent_item_id ? byId.get(i.parent_item_id) : undefined; const seen = new Set<string>([i.id]);
    while (p && !seen.has(p.id) && d < 6) { d++; seen.add(p.id); p = p.parent_item_id ? byId.get(p.parent_item_id) : undefined; }
    return d;
  };
  const components: BreakdownComponent[] = list.filter(i => i.kind !== 'part').map(i => ({
    id: i.id, itemId: i.id, assetId: i.asset_id ?? null,
    tag: i.tag || '', name: i.name, level: i.kind === 'subunit' ? 'SUBUNIT' : 'COMPONENT',
    criticality: i.critical ? 'A' : null, parentId: i.parent_item_id ?? null, depth: depthOf(i),
  }));
  const parts: BreakdownPart[] = list.filter(i => i.kind === 'part').map(i => ({
    id: i.id, itemId: i.id, bomItemId: i.bom_item_id ?? null,
    partNumber: i.tag || '', description: i.name, qty: Number(i.qty) || 1, uom: i.uom || 'EA',
    critical: !!i.critical, inventoryItemId: i.inventory_item_id ?? null, replacementIntervalDays: i.replacement_interval_days ?? null,
  }));
  return { components, parts };
}

/** The three link columns a failure mode stores for a component / part it is pinned to. */
export function linkFor(c: BreakdownComponent | null | undefined, p: BreakdownPart | null | undefined): { component_asset_id: string | null; bom_item_id: string | null; study_item_id: string | null } {
  if (c) return { component_asset_id: c.itemId ? (c.assetId ?? null) : c.id, bom_item_id: null, study_item_id: c.itemId ?? null };
  if (p) return { component_asset_id: null, bom_item_id: p.itemId ? (p.bomItemId ?? null) : p.id, study_item_id: p.itemId ?? null };
  return { component_asset_id: null, bom_item_id: null, study_item_id: null };
}

/** Does this failure mode point at this component (by study item, or by the register link)? */
export function modeOnComponent(fm: ComponentLinkLike, c: BreakdownComponent): boolean {
  if (c.itemId && fm.study_item_id) return fm.study_item_id === c.itemId;
  const target = c.itemId ? c.assetId : c.id;
  return !!target && fm.component_asset_id === target;
}
export function modeOnPart(fm: ComponentLinkLike, p: BreakdownPart): boolean {
  if (p.itemId && fm.study_item_id) return fm.study_item_id === p.itemId;
  const target = p.itemId ? p.bomItemId : p.id;
  return !!target && fm.bom_item_id === target;
}

export function isEmptyBreakdown(b: AssetBreakdown | null | undefined): boolean {
  return !b || (b.components.length === 0 && b.parts.length === 0);
}

/**
 * How a failure mode came to be pinned (0325). 'text' means the pin was
 * inferred from the mode's own words and has not been confirmed by a person —
 * the worksheet marks those and offers them for review as a set.
 */
export type ComponentLinkSource = 'manual' | 'specialist' | 'text' | 'import';

/** A failure mode's link to the breakdown (columns added by 0318 / 0325). */
export interface ComponentLinkLike {
  component_asset_id?: string | null;
  bom_item_id?: string | null;
  /** 0351 — the study item (subunit / component / part) the mode belongs to */
  study_item_id?: string | null;
  component_link_source?: ComponentLinkSource | null;
}

// ── Rendering for the Specialist prompts ────────────────────────────────────

/**
 * The breakdown as prompt text. Components are indented by depth so the
 * model sees the tree; parts list part number, description, quantity and
 * whether the register marks them critical. Capped so a 400-line BOM does
 * not swamp the prompt.
 */
export function renderBreakdownForPrompt(b: AssetBreakdown | null | undefined, opts: { maxParts?: number } = {}): string {
  if (isEmptyBreakdown(b)) return '';
  const maxParts = opts.maxParts ?? 60;
  const lines: string[] = [];
  if (b!.components.length) {
    lines.push(`Registered components (${b!.components.length}) — pin each failure mode to one of these where it belongs:`);
    for (const c of b!.components) {
      const cls = [c.assetClass, c.assetType].filter(Boolean).join('/');
      lines.push(`${'  '.repeat(Math.max(0, c.depth - 1))}- ${c.tag} — ${c.name}${cls ? ` [${cls}]` : ''}${c.criticality ? ` (crit ${c.criticality})` : ''}`);
    }
  }
  if (b!.parts.length) {
    const shown = b!.parts.slice(0, maxParts);
    lines.push(`Bill of materials (${b!.parts.length} line${b!.parts.length === 1 ? '' : 's'}${b!.parts.length > maxParts ? `, first ${maxParts} shown` : ''}) — name the part a task replaces or inspects:`);
    for (const p of shown) {
      lines.push(`- ${p.partNumber || '(no part no.)'} — ${p.description} × ${p.qty} ${p.uom}${p.critical ? ' [CRITICAL SPARE]' : ''}${p.replacementIntervalDays ? ` (replace every ${p.replacementIntervalDays} d)` : ''}`);
    }
  }
  return lines.join('\n');
}

// ── Coverage: which components have a failure mode, which do not ────────────

export interface ComponentCoverage {
  component: BreakdownComponent;
  modeCount: number;
}

export interface BreakdownCoverage {
  covered: ComponentCoverage[];
  uncovered: BreakdownComponent[];
  /** failure modes pinned to nothing */
  unpinned: number;
  /** 0–100 — share of components with at least one failure mode */
  pct: number;
  partsReferenced: number;
}

export function breakdownCoverage(b: AssetBreakdown | null | undefined, failureModes: ComponentLinkLike[]): BreakdownCoverage {
  const comps = b?.components || [];
  const parts = b?.parts || [];
  const partIds = new Set<string>();
  let unpinned = 0;
  for (const fm of failureModes) {
    const onComp = comps.some(c => modeOnComponent(fm, c));
    const part = parts.find(p => modeOnPart(fm, p));
    if (part) partIds.add(part.id);
    else if (!onComp && !fm.component_asset_id && !fm.bom_item_id && !fm.study_item_id) unpinned++;
  }
  const covered: ComponentCoverage[] = [];
  const uncovered: BreakdownComponent[] = [];
  for (const c of comps) {
    const n = failureModes.filter(fm => modeOnComponent(fm, c)).length;
    if (n > 0) covered.push({ component: c, modeCount: n }); else uncovered.push(c);
  }
  const pct = comps.length === 0 ? 0 : Math.round((covered.length / comps.length) * 100);
  return { covered, uncovered, unpinned, pct, partsReferenced: partIds.size };
}

// ── Mapping the Specialist's answer back onto the register ──────────────────

const norm = (s: string | null | undefined) => String(s || '').trim().toLowerCase();
/**
 * A register name as a person would say it: "Dry Gas Seal (K-601)" → "dry gas
 * seal". Child assets carry the parent tag in parentheses (import convention),
 * and a failure mode never repeats it — so the whole-name match must ignore it.
 */
const normName = (s: string | null | undefined) => norm(String(s || '').replace(/\s*\([^)]*\)\s*$/, ''));
/**
 * The ways a failure mode names a register component: the name itself, the
 * name without a trailing collective word ("Combustion Liner Set" → "combustion
 * liner"), and its singular ("HP Turbine Blades" → "hp turbine blade"). Longest
 * first, so the fullest match wins and short fragments never pin alone.
 */
const nameKeys = (name: string | null | undefined): string[] => {
  const base = normName(name);
  if (!base) return [];
  const out = new Set<string>([base]);
  const noCollective = base.replace(/\s+(set|assembly|assy|unit|kit|pack|group|system|train|skid)$/, '');
  if (noCollective !== base) out.add(noCollective);
  for (const k of [...out]) {
    if (/ies$/.test(k)) out.add(k.replace(/ies$/, 'y'));
    else if (/[^s]s$/.test(k) && !/ss$/.test(k)) out.add(k.replace(/s$/, ''));
  }
  return [...out].sort((a, b) => b.length - a.length);
};

/**
 * Find the component the model meant. It is asked to echo a tag, but models
 * paraphrase — so match tag exactly, then tag inside the text, then name.
 */
export function matchComponent(text: string | null | undefined, b: AssetBreakdown | null | undefined): BreakdownComponent | null {
  const t = norm(text);
  if (!t || !b) return null;
  const exact = b.components.find(c => norm(c.tag) === t || norm(c.name) === t || normName(c.name) === normName(t));
  if (exact) return exact;
  const byTag = b.components.find(c => norm(c.tag) && t.includes(norm(c.tag)));
  if (byTag) return byTag;
  const byName = b.components.find(c => normName(c.name) && (t.includes(normName(c.name)) || normName(c.name).includes(normName(t))));
  return byName || null;
}

/** Same for a BOM line: part number first, then description. */
export function matchPart(text: string | null | undefined, b: AssetBreakdown | null | undefined): BreakdownPart | null {
  const t = norm(text);
  if (!t || !b) return null;
  const byPn = b.parts.find(p => norm(p.partNumber) && (norm(p.partNumber) === t || t.includes(norm(p.partNumber))));
  if (byPn) return byPn;
  const byDesc = b.parts.find(p => norm(p.description) && (norm(p.description) === t || t.includes(norm(p.description)) || norm(p.description).includes(t)));
  return byDesc || null;
}

/** Display label for a pinned failure mode. */
export function componentLabel(fm: ComponentLinkLike, b: AssetBreakdown | null | undefined): string {
  if (!b) return '';
  const c = b.components.find(x => modeOnComponent(fm, x));
  if (c) return `${c.tag ? c.tag + ' — ' : ''}${c.name}`;
  const p = b.parts.find(x => modeOnPart(fm, x));
  if (p) return `${p.partNumber ? p.partNumber + ' — ' : ''}${p.description}`;
  return '';
}

// ── Inferring the pin from the failure mode's own words ─────────────────────

/** Escape for use inside a RegExp. */
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does `needle` occur in `hay` as whole words (not inside a longer token)? */
function mentions(hay: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(^|[^a-z0-9])${rx(needle)}([^a-z0-9]|$)`, 'i').test(hay);
}

/**
 * A failure mode written by a person, an import or the Specialist usually
 * names its component in the mode text itself — "Fuel control valve stuck
 * closed", "Ignitor plug failure". When nothing pinned it explicitly, read
 * the text and pin it to the component (or BOM line) it names.
 *
 * Deliberately stricter than matchComponent(): that one maps a short answer
 * the model was ASKED to give ("the thrust bearing") and can afford loose
 * containment. Here the input is a sentence, so a component called "Valve"
 * must not swallow every mode that mentions a valve — matches are whole-word,
 * names shorter than 4 characters are ignored, and the LONGEST match wins so
 * "fuel control valve" beats "control valve" beats "valve". Components win
 * over parts (a maintainable item is what RCM pins to; a part is a spare).
 */
export function inferComponentLink(
  texts: Array<string | null | undefined>,
  b: AssetBreakdown | null | undefined,
): { component_asset_id: string | null; bom_item_id: string | null; study_item_id: string | null } {
  const none = linkFor(null, null);
  if (isEmptyBreakdown(b)) return none;
  const hay = texts.map(t => norm(t)).filter(Boolean).join(' \n ');
  if (!hay) return none;

  let bestC: { c: BreakdownComponent; len: number } | null = null;
  for (const c of b!.components) {
    for (const key of [...nameKeys(c.name), norm(c.tag)]) {
      if (key.length < 4 || (bestC && key.length <= bestC.len)) continue;
      if (mentions(hay, key)) bestC = { c, len: key.length };
    }
  }
  if (bestC) return linkFor(bestC.c, null);

  let bestP: { p: BreakdownPart; len: number } | null = null;
  for (const p of b!.parts) {
    for (const key of [norm(p.description), norm(p.partNumber)]) {
      if (key.length < 4 || (bestP && key.length <= bestP.len)) continue;
      if (mentions(hay, key)) bestP = { p, len: key.length };
    }
  }
  return bestP ? linkFor(null, bestP.p) : none;
}

/**
 * Pin a NEW failure mode: keep whatever the caller resolved explicitly, and
 * only infer from the text when nothing was pinned.
 */
export function pinFailureMode<T extends ComponentLinkLike & { failure_mode_description?: string | null; failure_cause_description?: string | null }>(
  fm: T,
  b: AssetBreakdown | null | undefined,
  explicitSource: ComponentLinkSource = 'specialist',
): T & ComponentLinkLike {
  if (fm.component_asset_id || fm.bom_item_id || fm.study_item_id) {
    return fm.component_link_source ? fm : { ...fm, component_link_source: explicitSource };
  }
  const link = inferComponentLink([fm.failure_mode_description, fm.failure_cause_description], b);
  if (!link.component_asset_id && !link.bom_item_id && !link.study_item_id) return fm;
  // Inferred from the wording, not chosen — marked so the worksheet can offer it for review.
  return { ...fm, ...link, component_link_source: 'text' };
}
