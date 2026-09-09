/**
 * rcmFailureCodes — ISO 14224 failure-mode codes for drafted failure modes.
 *
 * The Specialist writes modes as sentences; work orders are coded (BRG, SEL,
 * VIB…). Without a code on the mode the living-study check and the evidence
 * reconciliation can only match text. The Specialist is asked to return the
 * code; when it does not, the wording is matched against the code's
 * description here. Pure functions — no I/O.
 */

export interface FailureCodeLike {
  code: string;
  description: string | null;
  /** failure scope (ROTATING, STATIC_PRESSURE, …) or null for the generic set */
  category_ref?: string | null;
}

const STOP = new Set(['failure', 'failures', 'fail', 'fails', 'failed', 'loss', 'of', 'the', 'and', 'or', 'to', 'in', 'a', 'an', 'due', 'with', 'from', 'by', 'on', 'for', 'at', 'is', 'not', 'no', 'other', 'general', 'damage', 'problem', 'problems', 'excessive', 'abnormal', 'high', 'low']);
const words = (s: string | null | undefined): string[] =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ings?|ed|es|s|age|ation)$/i, '');

/**
 * Hand-written synonyms for the vocabulary the register's descriptions use;
 * "Seal Failure / Seal Leakage" should catch "leak", "leaking", "gland".
 */
const SYNONYMS: Record<string, string[]> = {
  seal: ['seal', 'seals', 'gland', 'packing', 'leak', 'leaking', 'leakage'],
  bearing: ['bearing', 'bearings', 'journal', 'thrust', 'radial'],
  vibration: ['vibration', 'vibrating', 'vibrate', 'resonance'],
  imbalance: ['imbalance', 'unbalance', 'balance'],
  misalignment: ['misalignment', 'misaligned', 'alignment', 'deflection'],
  lubrication: ['lubrication', 'lube', 'lubricant', 'oil', 'grease'],
  coupling: ['coupling', 'couplings'],
  cavitation: ['cavitation', 'cavitating', 'npsh'],
  impeller: ['impeller', 'rotor', 'blade', 'blades', 'vane', 'vanes'],
  surge: ['surge', 'surging', 'stall'],
  start: ['start', 'starting', 'startup'],
  stop: ['stop', 'stopping', 'overspeed', 'runaway'],
  overheating: ['overheating', 'overheat', 'temperature', 'hot', 'thermal'],
  corrosion: ['corrosion', 'corroded', 'corrosive', 'pitting', 'rust'],
  erosion: ['erosion', 'eroded', 'wear', 'worn', 'abrasion'],
  crack: ['crack', 'cracked', 'cracking', 'fatigue', 'fracture', 'fractured'],
  blockage: ['blockage', 'blocked', 'plugged', 'plugging', 'fouling', 'fouled', 'choked', 'clogged', 'coking'],
  breakdown: ['breakdown', 'seizure', 'seized', 'seizes', 'catastrophic', 'collapse'],
  external: ['external', 'atmosphere', 'environment'],
  internal: ['internal', 'passing', 'bypass'],
  instrument: ['instrument', 'sensor', 'transmitter', 'signal', 'reading', 'indication'],
  electrical: ['electrical', 'winding', 'insulation', 'short', 'earth', 'ground'],
  control: ['control', 'controller', 'setpoint', 'spurious', 'trip'],
  structural: ['structural', 'support', 'foundation', 'bolt', 'bolting', 'loose'],
};

/** Score a code against a failure-mode text: shared stems + synonym hits, weighted by how specific the code's description is. */
function score(text: string, code: FailureCodeLike): number {
  const t = new Set(words(text).map(stem));
  const tRaw = new Set(words(text));
  const d = words(code.description).map(stem);
  if (d.length === 0) return 0;
  let hits = 0;
  for (const w of d) if (t.has(w)) hits++;
  for (const [key, syns] of Object.entries(SYNONYMS)) {
    const codeHas = d.some(w => stem(key) === w || syns.some(s => stem(s) === w));
    if (!codeHas) continue;
    if (syns.some(s => tRaw.has(s) || t.has(stem(s)))) hits += 1;
  }
  if (hits === 0) return 0;
  return hits / Math.sqrt(d.length);
}

/**
 * The best code for a mode's wording, or null when nothing fits well enough
 * (a wrong code is worse than none — the evidence reconciliation would then
 * claim a match the study never made).
 */
export function matchFailureCode(text: string | null | undefined, codes: FailureCodeLike[]): string | null {
  const s = String(text || '').trim();
  if (!s || codes.length === 0) return null;
  let best: { code: string; v: number } | null = null;
  for (const c of codes) {
    if (!c.code) continue;
    const v = score(s, c);
    if (v > 0 && (!best || v > best.v)) best = { code: c.code.toUpperCase(), v };
  }
  return best && best.v >= 0.5 ? best.code : null;
}

/** One prompt paragraph: the codes the Specialist may return, most specific scope first. */
export function renderFailureCodesForPrompt(codes: FailureCodeLike[]): string {
  if (codes.length === 0) return '';
  const sorted = [...codes].sort((a, b) => (a.category_ref ? 0 : 1) - (b.category_ref ? 0 : 1) || a.code.localeCompare(b.code));
  return `ISO 14224 failure mode codes for this equipment (return the best one per mode as "code"; leave empty if none fits):\n${sorted.map(c => `- ${c.code}: ${c.description || ''}`).join('\n')}`;
}

/** Keep a returned code only if it is one we offered. */
export function acceptFailureCode(code: string | null | undefined, codes: FailureCodeLike[]): string | null {
  const c = String(code || '').trim().toUpperCase();
  return c && codes.some(x => x.code.toUpperCase() === c) ? c : null;
}
