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
}

export interface AssetBreakdown {
  components: BreakdownComponent[];
  parts: BreakdownPart[];
}

export const EMPTY_BREAKDOWN: AssetBreakdown = { components: [], parts: [] };

export function isEmptyBreakdown(b: AssetBreakdown | null | undefined): boolean {
  return !b || (b.components.length === 0 && b.parts.length === 0);
}

/** A failure mode's link to the breakdown (columns added by 0318). */
export interface ComponentLinkLike {
  component_asset_id?: string | null;
  bom_item_id?: string | null;
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
  const counts = new Map<string, number>();
  const partIds = new Set<string>();
  let unpinned = 0;
  for (const fm of failureModes) {
    if (fm.component_asset_id) counts.set(fm.component_asset_id, (counts.get(fm.component_asset_id) || 0) + 1);
    else if (!fm.bom_item_id) unpinned++;
    if (fm.bom_item_id) partIds.add(fm.bom_item_id);
  }
  const covered: ComponentCoverage[] = [];
  const uncovered: BreakdownComponent[] = [];
  for (const c of comps) {
    const n = counts.get(c.id) || 0;
    if (n > 0) covered.push({ component: c, modeCount: n }); else uncovered.push(c);
  }
  const pct = comps.length === 0 ? 0 : Math.round((covered.length / comps.length) * 100);
  return { covered, uncovered, unpinned, pct, partsReferenced: partIds.size };
}

// ── Mapping the Specialist's answer back onto the register ──────────────────

const norm = (s: string | null | undefined) => String(s || '').trim().toLowerCase();

/**
 * Find the component the model meant. It is asked to echo a tag, but models
 * paraphrase — so match tag exactly, then tag inside the text, then name.
 */
export function matchComponent(text: string | null | undefined, b: AssetBreakdown | null | undefined): BreakdownComponent | null {
  const t = norm(text);
  if (!t || !b) return null;
  const exact = b.components.find(c => norm(c.tag) === t || norm(c.name) === t);
  if (exact) return exact;
  const byTag = b.components.find(c => norm(c.tag) && t.includes(norm(c.tag)));
  if (byTag) return byTag;
  const byName = b.components.find(c => norm(c.name) && (t.includes(norm(c.name)) || norm(c.name).includes(t)));
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
  if (fm.component_asset_id) {
    const c = b.components.find(x => x.id === fm.component_asset_id);
    if (c) return `${c.tag} — ${c.name}`;
  }
  if (fm.bom_item_id) {
    const p = b.parts.find(x => x.id === fm.bom_item_id);
    if (p) return `${p.partNumber ? p.partNumber + ' — ' : ''}${p.description}`;
  }
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
): { component_asset_id: string | null; bom_item_id: string | null } {
  const none = { component_asset_id: null, bom_item_id: null };
  if (isEmptyBreakdown(b)) return none;
  const hay = texts.map(t => norm(t)).filter(Boolean).join(' \n ');
  if (!hay) return none;

  let best: { id: string; len: number } | null = null;
  for (const c of b!.components) {
    for (const key of [norm(c.name), norm(c.tag)]) {
      if (key.length < 4 || (best && key.length <= best.len)) continue;
      if (mentions(hay, key)) best = { id: c.id, len: key.length };
    }
  }
  if (best) return { component_asset_id: best.id, bom_item_id: null };

  best = null;
  for (const p of b!.parts) {
    for (const key of [norm(p.description), norm(p.partNumber)]) {
      if (key.length < 4 || (best && key.length <= best.len)) continue;
      if (mentions(hay, key)) best = { id: p.id, len: key.length };
    }
  }
  return best ? { component_asset_id: null, bom_item_id: best.id } : none;
}

/**
 * Pin a NEW failure mode: keep whatever the caller resolved explicitly, and
 * only infer from the text when nothing was pinned.
 */
export function pinFailureMode<T extends ComponentLinkLike & { failure_mode_description?: string | null; failure_cause_description?: string | null }>(
  fm: T,
  b: AssetBreakdown | null | undefined,
): T & ComponentLinkLike {
  if (fm.component_asset_id || fm.bom_item_id) return fm;
  const link = inferComponentLink([fm.failure_mode_description, fm.failure_cause_description], b);
  if (!link.component_asset_id && !link.bom_item_id) return fm;
  return { ...fm, ...link };
}
