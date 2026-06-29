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
  isoLevel: number;             // ISO 14224 taxonomy level (1..6)
  label: string;                // UI label (Admin-overridable)
  objectClass: ObjectClass;     // FLOC = position, EQUIPMENT = maintainable item
  numbering: NumberingScheme;   // which number range issues the identifier
  criticality: CriticalityRule; // is criticality mandatory at this level?
  showEquipmentFields: boolean; // Manufacturer/Model/Serial + Category/Class
  allowedChildCodes: string[];  // valid child level codes (integrity)
}

// ── Default seed — ISO 14224 Table 2/3 subset (pragmatic, configurable) ──
// NOTE: the full ISO 14224 Table 3 defines up to nine levels; this six-level
// seed is a deliberate, configurable subset (documented in the closeout plan).
export const DEFAULT_LEVELS: LevelConfig[] = [
  { code: 'SITE',      isoLevel: 1, label: 'Site',             objectClass: 'FLOC',      numbering: 'FL', criticality: 'optional',  showEquipmentFields: false, allowedChildCodes: ['AREA', 'UNIT'] },
  { code: 'AREA',      isoLevel: 2, label: 'Area / Plant',     objectClass: 'FLOC',      numbering: 'FL', criticality: 'optional',  showEquipmentFields: false, allowedChildCodes: ['UNIT', 'SYSTEM'] },
  { code: 'UNIT',      isoLevel: 2, label: 'Plant / Unit',     objectClass: 'FLOC',      numbering: 'FL', criticality: 'optional',  showEquipmentFields: false, allowedChildCodes: ['SYSTEM'] },
  { code: 'SYSTEM',    isoLevel: 3, label: 'System / Process', objectClass: 'FLOC',      numbering: 'FL', criticality: 'optional',  showEquipmentFields: false, allowedChildCodes: ['SUBSYSTEM', 'EQUIPMENT'] },
  { code: 'SUBSYSTEM', isoLevel: 4, label: 'Sub-system',       objectClass: 'FLOC',      numbering: 'FL', criticality: 'mandatory', showEquipmentFields: false, allowedChildCodes: ['EQUIPMENT'] },
  { code: 'EQUIPMENT', isoLevel: 5, label: 'Equipment',        objectClass: 'EQUIPMENT', numbering: 'EQ', criticality: 'mandatory', showEquipmentFields: true,  allowedChildCodes: ['COMPONENT'] },
  { code: 'COMPONENT', isoLevel: 6, label: 'Component',        objectClass: 'EQUIPMENT', numbering: 'EQ', criticality: 'mandatory', showEquipmentFields: true,  allowedChildCodes: [] },
];

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
