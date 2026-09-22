/**
 * Master data over the live link: functional locations and equipment.
 *
 * The rules a person would have to know, written once and tested:
 *   - what an IREAMS asset is in SAP terms (an equipment or a functional
 *     location, decided by its hierarchy level);
 *   - how an asset becomes an S/4 entity and back, field by field;
 *   - who wins when both sides changed the same object — the family's owner,
 *     and the loser is queued with the reason (plan §2.3);
 *   - the order things must be sent in (parents before children), and how
 *     retries back off.
 *
 * Pure. The worker (erp-sync) carries a byte-identical copy; see odata.ts.
 */

export type Owner = 'sap' | 'ireams';
export type Direction = 'in' | 'out' | 'both' | 'off';
export type Family = 'master_data' | 'condition' | 'work' | 'reliability' | 'finance';
export interface FamilyRule { direction: Direction; owner: Owner }
export type Families = Partial<Record<Family, FamilyRule>>;

export const FAMILIES: Family[] = ['master_data', 'condition', 'work', 'reliability', 'finance'];

export const FAMILY_LABELS: Record<Family, string> = {
    master_data: 'Master data — functional locations, equipment',
    condition: 'Condition — measuring points, readings',
    work: 'Work — notifications, orders, status',
    reliability: 'Reliability — interval changes, criticality',
    finance: 'Finance — postings, movements, receipts, invoices',
};

/** Which phase of the plan makes a family flow. Phase 1 is master data. */
export const FAMILY_PHASE: Record<Family, 1 | 2 | 3> = {
    master_data: 1, condition: 2, work: 2, reliability: 3, finance: 3,
};

/**
 * The default ownership rule (plan §2.3): SAP owns master data and orders;
 * IREAMS owns readings, reliability results and PM cycle proposals. A tenant
 * replacing SAP PM flips the master-data owner in the target.
 */
export const DEFAULT_FAMILIES: Required<Families> = {
    master_data: { direction: 'both', owner: 'sap' },
    condition: { direction: 'out', owner: 'ireams' },
    work: { direction: 'both', owner: 'sap' },
    reliability: { direction: 'out', owner: 'ireams' },
    finance: { direction: 'out', owner: 'ireams' },
};

export const flows = (rule: FamilyRule | undefined, dir: 'in' | 'out'): boolean =>
    !!rule && (rule.direction === dir || rule.direction === 'both');

// ── What an asset is in SAP terms ────────────────────────────────────────────

export type SapObjectType = 'EQUI' | 'IFLOT';

/** The register's levels, top down. Equipment (ISO 14224 L6) and its components are equipment in SAP. */
export const FL_LEVELS = ['SITE', 'AREA', 'UNIT', 'SYSTEM', 'SUBSYSTEM'] as const;
export const EQUIPMENT_LEVELS = ['EQUIPMENT', 'COMPONENT'] as const;

export interface LinkAsset {
    id: string;
    tag: string;
    name: string;
    hierarchy_level: string;
    parent_id: string | null;
    equipment_number: string | null;
    manufacturer: string | null;
    model: string | null;
    serial_number: string | null;
    criticality: 'A' | 'B' | 'C' | 'D' | null;
    status_code: string;
    updated_at: string;
}

export const objectTypeOf = (level: string): SapObjectType =>
    (EQUIPMENT_LEVELS as readonly string[]).includes(String(level).toUpperCase()) ? 'EQUI' : 'IFLOT';

export const entitySetOf = (t: SapObjectType): 'A_Equipment' | 'A_FunctionalLocation' =>
    t === 'EQUI' ? 'A_Equipment' : 'A_FunctionalLocation';

const LEVEL_ORDER: readonly string[] = [...FL_LEVELS, ...EQUIPMENT_LEVELS];

/** Parents before children: SITE 0 … COMPONENT 6; anything unknown last. */
export const levelRank = (level: string): number => {
    const i = LEVEL_ORDER.indexOf(String(level).toUpperCase());
    return i < 0 ? LEVEL_ORDER.length : i;
};

/** The level a functional location created from SAP gets under a parent of `parentLevel`; SITE at the top. */
export function childLevelOf(parentLevel: string | null | undefined): string {
    if (!parentLevel) return 'SITE';
    const i = (FL_LEVELS as readonly string[]).indexOf(String(parentLevel).toUpperCase());
    if (i < 0) return 'SUBSYSTEM';
    return FL_LEVELS[Math.min(i + 1, FL_LEVELS.length - 1)];
}

/** Sort for sending: level first (parents before children), then oldest change first. */
export const sendOrder = <T extends { hierarchy_level: string; updated_at: string }>(rows: T[]): T[] =>
    [...rows].sort((a, b) =>
        levelRank(a.hierarchy_level) - levelRank(b.hierarchy_level) || a.updated_at.localeCompare(b.updated_at));

// ── Field mapping ────────────────────────────────────────────────────────────

export interface ParentRef { type: SapObjectType; key: string }

export interface EquipmentDoc {
    Equipment?: string;
    EquipmentName: string;
    EquipmentCategory: 'M';
    ManufacturerName?: string;
    ManufacturerPartNmbr?: string;
    ManufacturerSerialNumber?: string;
    FunctionalLocation?: string;
    SuperordinateEquipment?: string;
    ABCIndicator?: string;
    LastChangeDateTime?: string;
}

export interface FunctionalLocationDoc {
    FunctionalLocation: string;
    FunctionalLocationName: string;
    FunctionalLocationCategory: 'M';
    SuperiorFunctionalLocation?: string;
    ABCIndicator?: string;
    LastChangeDateTime?: string;
}

/** SAP's ABC indicator is A/B/C; IREAMS's D (lowest) has no SAP letter and is sent blank. */
export const criticalityToAbc = (c: LinkAsset['criticality']): string => (c && c !== 'D' ? c : '');
export const abcToCriticality = (abc: unknown): LinkAsset['criticality'] =>
    abc === 'A' || abc === 'B' || abc === 'C' ? abc : null;

const clean = (s: string | null | undefined): string | undefined => {
    const t = (s ?? '').trim();
    return t ? t : undefined;
};

/** SAP equipment names are 40 characters; functional-location labels 30 (the cockpit's LENGTHS agree). */
export const NAME_MAX = 40;
export const FL_LABEL_MAX = 30;

export function toEquipmentDoc(a: LinkAsset, externalKey: string | null, parent: ParentRef | null): EquipmentDoc {
    const doc: EquipmentDoc = {
        EquipmentName: (a.name || a.tag).slice(0, NAME_MAX),
        EquipmentCategory: 'M',
        ABCIndicator: criticalityToAbc(a.criticality),
    };
    if (externalKey) doc.Equipment = externalKey;
    const mf = clean(a.manufacturer); if (mf) doc.ManufacturerName = mf;
    const md = clean(a.model); if (md) doc.ManufacturerPartNmbr = md;
    const sn = clean(a.serial_number); if (sn) doc.ManufacturerSerialNumber = sn;
    if (parent?.type === 'IFLOT') doc.FunctionalLocation = parent.key;
    if (parent?.type === 'EQUI') doc.SuperordinateEquipment = parent.key;
    return doc;
}

export function toFunctionalLocationDoc(a: LinkAsset, externalKey: string | null, parent: ParentRef | null): FunctionalLocationDoc {
    const doc: FunctionalLocationDoc = {
        // A functional location's key is its label, and the register's tag is
        // that label. Once mapped, the mapped key wins (a rename in IREAMS
        // does not rename the SAP object; it changes its description).
        FunctionalLocation: (externalKey ?? a.tag).slice(0, FL_LABEL_MAX),
        FunctionalLocationName: (a.name || a.tag).slice(0, NAME_MAX),
        FunctionalLocationCategory: 'M',
        ABCIndicator: criticalityToAbc(a.criticality),
    };
    if (parent?.type === 'IFLOT') doc.SuperiorFunctionalLocation = parent.key;
    return doc;
}

/** The fields the link keeps in step, in the words a person sees on the asset. */
export const SYNCED_FIELDS: (keyof LinkAsset)[] = ['name', 'manufacturer', 'model', 'serial_number', 'criticality'];

export type AssetPatch = Partial<Pick<LinkAsset, 'name' | 'manufacturer' | 'model' | 'serial_number' | 'criticality'>>;

export function fromEquipment(e: Partial<EquipmentDoc>): AssetPatch {
    const p: AssetPatch = {};
    if (typeof e.EquipmentName === 'string') p.name = e.EquipmentName;
    if ('ManufacturerName' in e) p.manufacturer = clean(e.ManufacturerName) ?? null;
    if ('ManufacturerPartNmbr' in e) p.model = clean(e.ManufacturerPartNmbr) ?? null;
    if ('ManufacturerSerialNumber' in e) p.serial_number = clean(e.ManufacturerSerialNumber) ?? null;
    if ('ABCIndicator' in e) p.criticality = abcToCriticality(e.ABCIndicator);
    return p;
}

export function fromFunctionalLocation(e: Partial<FunctionalLocationDoc>): AssetPatch {
    const p: AssetPatch = {};
    if (typeof e.FunctionalLocationName === 'string') p.name = e.FunctionalLocationName;
    if ('ABCIndicator' in e) p.criticality = abcToCriticality(e.ABCIndicator);
    return p;
}

/** Only what differs, so an inbound change that echoes our own send touches nothing. */
export function patchDiff(current: Pick<LinkAsset, keyof AssetPatch>, patch: AssetPatch): AssetPatch {
    const out: AssetPatch = {};
    for (const k of Object.keys(patch) as (keyof AssetPatch)[]) {
        const a = current[k] ?? null;
        const b = patch[k] ?? null;
        if (a !== b) (out as Record<string, unknown>)[k] = b;
    }
    return out;
}

export interface NewAsset {
    tag: string;
    name: string;
    hierarchy_level: string;
    parent_id: string | null;
    status_code: string;
    manufacturer?: string | null;
    model?: string | null;
    serial_number?: string | null;
    criticality?: LinkAsset['criticality'];
}

/** An equipment first seen in SAP: its number is its tag until a person renames it. */
export function newAssetFromEquipment(e: Partial<EquipmentDoc> & { Equipment: string }, parent: { id: string; level: string } | null): NewAsset {
    return {
        tag: e.Equipment,
        name: clean(e.EquipmentName) ?? e.Equipment,
        hierarchy_level: e.SuperordinateEquipment ? 'COMPONENT' : 'EQUIPMENT',
        parent_id: parent?.id ?? null,
        status_code: 'ACTIVE',
        ...fromEquipment(e),
    };
}

export function newAssetFromFunctionalLocation(e: Partial<FunctionalLocationDoc> & { FunctionalLocation: string }, parent: { id: string; level: string } | null): NewAsset {
    return {
        tag: e.FunctionalLocation,
        name: clean(e.FunctionalLocationName) ?? e.FunctionalLocation,
        hierarchy_level: childLevelOf(parent?.level ?? null),
        parent_id: parent?.id ?? null,
        status_code: 'ACTIVE',
        ...fromFunctionalLocation(e),
    };
}

// ── The conflict rule ────────────────────────────────────────────────────────

export interface InboundDecision {
    /** What to write into IREAMS. */
    apply: 'remote' | 'none';
    /** What to put in the exception queue, if anything. */
    queue: 'local_overridden' | 'remote_overridden' | null;
    /** Re-send IREAMS's version to SAP (the owner re-asserting itself). */
    resend: boolean;
    reason: string | null;
}

const list = (fields: string[]) => (fields.length ? fields.join(', ') : 'the record');

/**
 * SAP changed an object. If IREAMS did not touch it since the last sync, the
 * change simply applies. If both sides changed it, the family's owner wins
 * and the loser is queued with the reason — a person sees it, nothing is
 * silently lost. `localFields` is what IREAMS changed, for the reason text.
 */
export function resolveInbound(owner: Owner, localChanged: boolean, localFields: string[] = []): InboundDecision {
    if (!localChanged) return { apply: 'remote', queue: null, resend: false, reason: null };
    if (owner === 'sap') {
        return {
            apply: 'remote', queue: 'local_overridden', resend: false,
            reason: `SAP owns master data. SAP's change was applied and IREAMS's change to ${list(localFields)} was overridden.`,
        };
    }
    return {
        apply: 'none', queue: 'remote_overridden', resend: true,
        reason: `IREAMS owns master data. SAP's change was not applied; IREAMS's version of ${list(localFields)} is being sent back to SAP.`,
    };
}

/**
 * A send came back 412 (SAP's ETag moved since we last read it). The owner
 * forces through with a fresh ETag; the non-owner stops and queues.
 */
export const resolveStaleSend = (owner: Owner): 'force' | 'conflict' => (owner === 'ireams' ? 'force' : 'conflict');

/** The synced fields that differ between what IREAMS has and what was last synced. */
export function changedFields(a: Partial<LinkAsset>, b: Partial<LinkAsset>): string[] {
    return SYNCED_FIELDS.filter((k) => (a[k] ?? null) !== (b[k] ?? null)).map(String);
}

// ── Watermarks and retries ───────────────────────────────────────────────────

/** The later of the current watermark and every processed timestamp; never moves backwards. */
export function advanceWatermark(current: string | null | undefined, processed: (string | null | undefined)[]): string | null {
    let best = current ? new Date(current).getTime() : Number.NEGATIVE_INFINITY;
    for (const p of processed) {
        if (!p) continue;
        const t = new Date(p).getTime();
        if (Number.isFinite(t) && t > best) best = t;
    }
    return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

/** 1, 5, 15, 60 minutes, then every 4 hours. A dead endpoint is not hammered; a blip is retried soon. */
export function backoffMinutes(attempts: number): number {
    const steps = [1, 5, 15, 60, 240];
    return steps[Math.min(Math.max(attempts, 0), steps.length - 1)];
}

export interface FamilyState { in?: string | null; out?: string | null }
export type Watermarks = Partial<Record<Family, FamilyState>>;

export const watermarkOf = (w: Watermarks | null | undefined, family: Family, dir: 'in' | 'out'): string | null =>
    w?.[family]?.[dir] ?? null;

export function withWatermark(w: Watermarks | null | undefined, family: Family, dir: 'in' | 'out', value: string | null): Watermarks {
    const next: Watermarks = { ...(w ?? {}) };
    next[family] = { ...(next[family] ?? {}), [dir]: value };
    return next;
}
