// ─────────────────────────────────────────────────────────────────────────────
// hierarchyModel — SINGLE SOURCE OF TRUTH for the asset/FLOC hierarchy.
//
// Closes UAT F-010 (root cause): previously, level-dependent behaviour was
// scattered and ignored `hierarchy_level` (e.g. isLocation() hardcoded a string
// list incl. 'AREA' which isn't even in the enum, and the EQ-number trigger fired
// at every level). Every level-aware decision — object class (FLOC vs Equipment),
// numbering scheme, criticality rule, field visibility, allowed children, and
// parent/child integrity — now derives from this one model.
//
// SAP parity: FLOC = TPLNR (the position), Equipment = EQUNR (the maintainable
// item installed at a position). ISO 14224:2016 Table 2/3 taxonomy levels.
//
// The DEFAULT_LEVELS seed below is the code-level default; it is structured so an
// Admin "Hierarchy Configuration" screen can later override labels/levels from the
// DB without any caller changing (Phase 3).
// ─────────────────────────────────────────────────────────────────────────────

export type ObjectClass = 'FLOC' | 'EQUIPMENT';
export type NumberingScheme = 'FL' | 'EQ' | 'NONE';
export type CriticalityRule = 'optional' | 'mandatory';

export interface LevelConfig {
  code: string;                 // stored in assets.hierarchy_level (UPPERCASE)
  isoLevel: number;             // ISO 14224:2016 Table 3 taxonomy level (1..9)
  label: string;                // UI label (Admin-overridable)
  objectClass: ObjectClass;     // FLOC = position, EQUIPMENT = maintainable item
  numbering: NumberingScheme;   // which number range issues the identifier
  criticality: CriticalityRule; // is criticality mandatory at this level?
  showEquipmentFields: boolean; // Manufacturer/Model/Serial + Category/Class
  allowedChildCodes: string[];  // valid child level codes (integrity)
}

// ── ISO 14224:2016 Table 3 — the nine taxonomy levels ──
// Levels 1–2 (Industry, Business category) sit above any one register and are
// not modelled as assets; a CMMS tree starts at the Installation (L3).
export const ISO_LEVEL_NAMES: Record<number, string> = {
  1: 'Industry',
  2: 'Business category',
  3: 'Installation',
  4: 'Plant / Unit',
  5: 'Section / System',
  6: 'Equipment unit',
  7: 'Subunit',
  8: 'Component / Maintainable item',
  9: 'Part',
};
export function isoLevelName(n: number | null | undefined): string {
  return (n != null && ISO_LEVEL_NAMES[n]) || '';
}

// ── Default seed — ISO 14224:2016 Table 3 numbering ──
// Before 0317 this seed (and the global hierarchy_config row) had Equipment at
// L5 and Component at L6, one level shy of the standard — while the failure
// taxonomy (0285/0288) was already built on Equipment = L6 and Subunit = L7.
// The numbers below are the standard's. AREA and UNIT are both L4 (Plant/Unit);
// SUBSYSTEM is a sub-section of L5 (ISO has no level between System and
// Equipment unit). SUBUNIT (L7) is optional: most registers record subunits on
// the failure report, not as asset rows, but the level exists for those that do.
export const DEFAULT_LEVELS: LevelConfig[] = [
  { code: 'SITE',      isoLevel: 3, label: 'Site',             objectClass: 'FLOC',      numbering: 'FL', criticality: 'optional',  showEquipmentFields: false, allowedChildCodes: ['AREA', 'UNIT'] },
  { code: 'AREA',      isoLevel: 4, label: 'Area / Plant',     objectClass: 'FLOC',      numbering: 'FL', criticality: 'optional',  showEquipmentFields: false, allowedChildCodes: ['UNIT', 'SYSTEM'] },
  { code: 'UNIT',      isoLevel: 4, label: 'Plant / Unit',     objectClass: 'FLOC',      numbering: 'FL', criticality: 'optional',  showEquipmentFields: false, allowedChildCodes: ['SYSTEM'] },
  { code: 'SYSTEM',    isoLevel: 5, label: 'System / Process', objectClass: 'FLOC',      numbering: 'FL', criticality: 'optional',  showEquipmentFields: false, allowedChildCodes: ['SUBSYSTEM', 'EQUIPMENT'] },
  { code: 'SUBSYSTEM', isoLevel: 5, label: 'Sub-system',       objectClass: 'FLOC',      numbering: 'FL', criticality: 'mandatory', showEquipmentFields: false, allowedChildCodes: ['SUBSYSTEM', 'EQUIPMENT'] },
  { code: 'EQUIPMENT', isoLevel: 6, label: 'Equipment',        objectClass: 'EQUIPMENT', numbering: 'EQ', criticality: 'mandatory', showEquipmentFields: true,  allowedChildCodes: ['SUBUNIT', 'COMPONENT'] },
  { code: 'SUBUNIT',   isoLevel: 7, label: 'Subunit',          objectClass: 'EQUIPMENT', numbering: 'EQ', criticality: 'optional',  showEquipmentFields: true,  allowedChildCodes: ['COMPONENT'] },
  { code: 'COMPONENT', isoLevel: 8, label: 'Component',        objectClass: 'EQUIPMENT', numbering: 'EQ', criticality: 'mandatory', showEquipmentFields: true,  allowedChildCodes: [] },
];

/** ISO Table 3 level numbers keyed by our level codes — what 0317 patches saved configs with. */
export const ISO_LEVEL_BY_CODE: Record<string, number> = Object.fromEntries(DEFAULT_LEVELS.map(l => [l.code, l.isoLevel]));

// Active level set. Swap this (or hydrate from DB) to apply an Admin override.
let ACTIVE_LEVELS: LevelConfig[] = DEFAULT_LEVELS;
let byCode: Map<string, LevelConfig> = new Map(ACTIVE_LEVELS.map(l => [l.code, l]));

/** Apply an Admin-configured level set (Phase 3). Falls back to defaults if empty. */
export function setLevelModel(levels: LevelConfig[] | null | undefined): void {
  ACTIVE_LEVELS = levels && levels.length ? levels : DEFAULT_LEVELS;
  byCode = new Map(ACTIVE_LEVELS.map(l => [l.code, l]));
}

export function getLevels(): LevelConfig[] { return ACTIVE_LEVELS; }

/** The level code at which equipment numbering (EQ-) begins (lowest isoLevel that is Equipment). */
export function equipmentStartLevel(): LevelConfig | undefined {
  return [...ACTIVE_LEVELS].sort((a, b) => a.isoLevel - b.isoLevel).find(l => l.objectClass === 'EQUIPMENT');
}

// ── Asset shape tolerance — accept UI (camelCase) or raw DB (snake_case) rows ──
export interface AssetLike {
  hierarchy_level?: string | null;
  hierarchyLevel?: string | null;
  asset_type_code?: string | null;
  assetType?: string | null;
  category?: string | null;
}

export function getLevelConfig(code?: string | null): LevelConfig | undefined {
  return code ? byCode.get(String(code).toUpperCase()) : undefined;
}

/** Resolve the stored level code for an asset (authoritative: hierarchy_level). */
export function resolveLevelCode(a: AssetLike): string | undefined {
  const raw = a.hierarchy_level ?? a.hierarchyLevel ?? a.asset_type_code ?? a.assetType ?? a.category;
  if (!raw) return undefined;
  const up = String(raw).toUpperCase();
  return byCode.has(up) ? up : undefined;
}

export function resolveLevel(a: AssetLike): LevelConfig | undefined {
  return getLevelConfig(resolveLevelCode(a));
}

// ── Derived predicates (the API callers use instead of ad-hoc string checks) ──
export function objectClassOf(a: AssetLike): ObjectClass | undefined { return resolveLevel(a)?.objectClass; }
export function isFunctionalLocation(a: AssetLike): boolean { return objectClassOf(a) === 'FLOC'; }
export function isEquipmentObject(a: AssetLike): boolean { return objectClassOf(a) === 'EQUIPMENT'; }
export function showsEquipmentFields(a: AssetLike): boolean { return resolveLevel(a)?.showEquipmentFields ?? false; }
export function criticalityRequired(a: AssetLike): boolean { return resolveLevel(a)?.criticality === 'mandatory'; }
export function numberingSchemeFor(a: AssetLike): NumberingScheme { return resolveLevel(a)?.numbering ?? 'NONE'; }

/** Valid child level configs for a parent (drives the F-005 Add-Child split). */
export function allowedChildren(parent: AssetLike): LevelConfig[] {
  const cfg = resolveLevel(parent);
  if (!cfg) return [];
  return cfg.allowedChildCodes.map(c => byCode.get(c)).filter((l): l is LevelConfig => !!l);
}
export function canHaveChildLocation(parent: AssetLike): boolean { return allowedChildren(parent).some(c => c.objectClass === 'FLOC'); }
export function canHaveChildEquipment(parent: AssetLike): boolean { return allowedChildren(parent).some(c => c.objectClass === 'EQUIPMENT'); }

/** Integrity: may `childCode` be created/moved under `parent`? Unknown parent ⇒ allow (don't block legacy). */
export function isValidChild(parent: AssetLike, childCode: string): boolean {
  const p = resolveLevel(parent);
  if (!p) return true;
  return p.allowedChildCodes.includes(String(childCode).toUpperCase());
}
