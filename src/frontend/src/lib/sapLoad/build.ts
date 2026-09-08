/**
 * SAP load builder — IREAMS master data → Migration Cockpit sheets.
 *
 * Pure: takes already-fetched records plus the target-system parameters and
 * returns rows per object and a readiness list. Nothing here touches the
 * database or the browser, so the whole mapping is unit-testable and the
 * same rows can be rendered to a workbook or shown on screen.
 *
 * Mapping rules that are not obvious from the field names:
 *  - Functional locations are the FLOC-class hierarchy levels (site → system);
 *    equipment is the EQUIPMENT class (equipment, subunit, component). The
 *    class comes from hierarchyModel, never from string-matching the level.
 *  - Equipment keeps BOTH identities: EQUNR ← equipment number (or blank for
 *    internal numbering), TIDNR ← tag. Dependent sheets (BOM, measuring
 *    points, documents) reference equipment by the same key EQUNR carries,
 *    so a single choice of numbering keeps the workbook self-consistent.
 *  - Text BOM lines (no material link) become POSTP = T with the description
 *    in POTX1 — SAP has no material to point at, and inventing one is worse.
 *  - Measuring points: IREAMS METER = SAP counter (INDCT = X); the warning
 *    band becomes the alarm limits; the critical band has no SAP home and is
 *    reported, not silently dropped. Measurement range (MRMIN/MRMAX) is left
 *    blank on purpose: a range rejects readings, an alarm flags them.
 *  - Opening stock is one 561 line per store that actually holds quantity.
 */
import * as XLSX from 'xlsx';
import { objectClassOf } from '../../eam/services/hierarchyModel';
import {
    SAP_OBJECTS, SAP_OBJECT_BY_KEY, ROW3_INSTRUCTION, fieldDescription,
    type SapObjectKey, type SapObjectSpec,
} from './spec';

// ── Source records (raw rows, snake_case as the tables hold them) ────────────

export interface SrcAsset {
    id: string;
    tag: string;
    name: string;
    parent_id?: string | null;
    hierarchy_level?: string | null;
    criticality?: string | null;
    equipment_number?: string | null;
    company_id?: string | null;
    cost_center_id?: string | null;
    responsible_work_center_id?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    serial_number?: string | null;
    asset_class?: string | null;
    asset_type_code?: string | null;
    status_code?: string | null;
    properties?: Record<string, unknown> | null;
}

export interface SrcAssetFinancial {
    asset_id: string;
    acquisition_cost?: number | string | null;
    acquisition_date?: string | null;
}

export interface SrcInventoryItem {
    id: string;
    part_number: string;
    material_number?: string | null;
    description: string;
    type?: string | null;
    uom?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    min_level?: number | string | null;
    max_level?: number | string | null;
    is_critical?: boolean | null;
    is_active?: boolean | null;
    unit_cost?: number | string | null;
    preferred_vendor_id?: string | null;
}

export interface SrcStock {
    item_id: string;
    location_id: string;
    quantity: number | string | null;
    bin_location?: string | null;
}

export interface SrcStore { id: string; name: string; code?: string | null }

export interface SrcBomLine {
    id: string;
    asset_id: string;
    inventory_item_id?: string | null;
    part_number?: string | null;
    description: string;
    quantity?: number | string | null;
    uom?: string | null;
    is_critical?: boolean | null;
    notes?: string | null;
    created_at?: string | null;
}

export interface SrcReadingDefinition {
    id: string;
    asset_id: string;
    reading_type_code: string;
    name: string;
    unit?: string | null;
    category?: string | null;           // METER | CONDITION
    min_warning?: number | string | null;
    max_warning?: number | string | null;
    min_critical?: number | string | null;
    max_critical?: number | string | null;
    is_active?: boolean | null;
}

export interface SrcReadingLog {
    id: string;
    definition_id: string;
    asset_id: string;
    reading_type_code?: string | null;
    reading_date: string;               // YYYY-MM-DD
    reading_time?: string | null;       // HH:MM[:SS]
    reading_value: number | string | null;
    delta?: number | string | null;
    entered_by?: string | null;
    comments?: string | null;
    is_active?: boolean | null;
}

export interface SrcVendor { id: string; code?: string | null; name: string }
export interface SrcCostCenter { id: string; code: string; company_code?: string | null; controlling_area?: string | null }
export interface SrcCompany { id: string; code: string; name: string }
export interface SrcWorkCenter { id: string; code: string }

export interface SapLoadSource {
    assets: SrcAsset[];
    assetFinancials: SrcAssetFinancial[];
    inventoryItems: SrcInventoryItem[];
    stock: SrcStock[];
    stores: SrcStore[];
    bomLines: SrcBomLine[];
    readingDefinitions: SrcReadingDefinition[];
    readingLogs: SrcReadingLog[];
    vendors: SrcVendor[];
    costCenters: SrcCostCenter[];
    companies: SrcCompany[];
    workCenters: SrcWorkCenter[];
    /** For the "not loadable" note only — orders never become load rows. */
    workOrderCount: number;
}

// ── Target-system parameters ────────────────────────────────────────────────

export type MaterialBucket = 'SPARE' | 'CONSUMABLE' | 'TOOL' | 'MATERIAL';

export interface SapTargetParams {
    /** Free label for the Read-me title, e.g. "E82 / Client 250". */
    systemLabel: string;
    companyCode: string;
    controllingArea: string;
    maintenancePlant: string;
    planningPlant: string;
    plannerGroup: string;
    flCategory: string;
    structureIndicator: string;
    equipmentCategory: string;
    /** legacy = EQUNR carries the IREAMS equipment number; internal = blank, SAP assigns. */
    numbering: 'legacy' | 'internal';
    materialGroup: Record<MaterialBucket, string>;
    valuationClass: Record<MaterialBucket, string>;
    mrpType: string;
    mrpController: string;
    purchasingGroup: string;
    purchasingOrg: string;
    priceControl: 'S' | 'V';
    priceUnit: number;
    /** IREAMS store id → SAP storage location (LGORT, 4 chars). */
    storageLocations: Record<string, string>;
    characteristicPrefix: string;
    bomUsage: string;
    bomAlternative: string;
    /** DD.MM.YYYY */
    postingDate: string;
    /** DD.MM.YYYY */
    sourceListValidFrom: string;
}

export function todaySapDate(d = new Date()): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getFullYear()}`;
}

export function defaultParams(): SapTargetParams {
    return {
        systemLabel: '',
        companyCode: '1030',
        controllingArea: 'A000',
        maintenancePlant: '102A',
        planningPlant: '102A',
        plannerGroup: '',
        flCategory: 'M',
        structureIndicator: 'YB01',
        equipmentCategory: 'M',
        numbering: 'legacy',
        materialGroup: { SPARE: 'YBSPARE', CONSUMABLE: 'YBCONS', TOOL: 'YBTOOL', MATERIAL: 'YBRAW' },
        valuationClass: { SPARE: '3040', CONSUMABLE: '3030', TOOL: '3030', MATERIAL: '3000' },
        mrpType: 'VB',
        mrpController: '001',
        purchasingGroup: '001',
        purchasingOrg: '1030',
        priceControl: 'V',
        priceUnit: 1,
        storageLocations: {},
        characteristicPrefix: 'YB_',
        bomUsage: '4',
        bomAlternative: '01',
        postingDate: todaySapDate(),
        sourceListValidFrom: todaySapDate(),
    };
}

/** Suggest LGORT codes for stores that have none: the store's own code if it is ≤4 chars, else 0001, 0002 … */
export function suggestStorageLocations(stores: SrcStore[], existing: Record<string, string> = {}): Record<string, string> {
    const out: Record<string, string> = { ...existing };
    const used = new Set(Object.values(out).filter(Boolean));
    let n = 1;
    for (const s of [...stores].sort((a, b) => a.name.localeCompare(b.name))) {
        if (out[s.id]) continue;
        const own = (s.code || '').trim().toUpperCase();
        if (own && own.length <= 4 && !used.has(own)) { out[s.id] = own; used.add(own); continue; }
        let code = String(n).padStart(4, '0');
        while (used.has(code)) { n += 1; code = String(n).padStart(4, '0'); }
        out[s.id] = code; used.add(code); n += 1;
    }
    return out;
}

// ── Result shape ────────────────────────────────────────────────────────────

export type Cell = string | number;

export interface SapIssue {
    object: SapObjectKey | 'general';
    level: 'error' | 'warn' | 'info';
    message: string;
    /** How many rows it touches, when it is a per-row condition. */
    count?: number;
}

export interface SapObjectRows {
    key: SapObjectKey;
    rows: Cell[][];
}

export interface SapLoadResult {
    objects: Record<SapObjectKey, Cell[][]>;
    issues: SapIssue[];
    /** Rows that could not be produced at all (missing key), per object. */
    skipped: Record<SapObjectKey, number>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

class IssueBook {
    private map = new Map<string, SapIssue>();
    add(object: SapIssue['object'], level: SapIssue['level'], message: string, countable = true) {
        const k = `${object}|${level}|${message}`;
        const cur = this.map.get(k);
        if (cur) { if (countable) cur.count = (cur.count ?? 1) + 1; return; }
        this.map.set(k, { object, level, message, ...(countable ? { count: 1 } : {}) });
    }
    list(): SapIssue[] {
        const order = { error: 0, warn: 1, info: 2 };
        return [...this.map.values()].sort((a, b) => order[a.level] - order[b.level]);
    }
}

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();
/** A unit that is only punctuation ("—", "-", "n/a") is a placeholder, not a unit. */
const unitOf = (v: unknown): string => {
    const u = s(v);
    return /[A-Za-z0-9°%µ]/.test(u) && !/^n\/?a$/i.test(u) ? u : '';
};
const num = (v: unknown): number | '' => {
    if (v == null || v === '') return '';
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : '';
};

/** Clip to the SAP field length and record the clip once per field. */
function clipper(issues: IssueBook, object: SapObjectKey) {
    return (value: string, fieldName: string, max?: number): string => {
        if (!max || value.length <= max) return value;
        issues.add(object, 'warn', `${fieldName} longer than SAP's ${max} characters — clipped; check the clipped values read sensibly`);
        return value.slice(0, max);
    };
}

/** ISO date (YYYY-MM-DD or full timestamp) → DD.MM.YYYY. Anything else passes through unchanged. */
export function toSapDate(iso: string | null | undefined): string {
    const v = s(iso);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
}

/** HH:MM or HH:MM:SS → HH:MM:SS. */
export function toSapTime(t: string | null | undefined): string {
    const v = s(t);
    if (!v) return '';
    const parts = v.split(':');
    while (parts.length < 3) parts.push('00');
    return parts.slice(0, 3).map(p => p.padStart(2, '0')).join(':');
}

function yearOf(iso: string | null | undefined): string {
    const m = /^(\d{4})/.exec(s(iso));
    return m ? m[1] : '';
}

const MTART: Record<MaterialBucket, string> = { SPARE: 'ERSA', CONSUMABLE: 'VERB', TOOL: 'HIBE', MATERIAL: 'ROH' };

/** IREAMS INVENTORY_TYPE codes collapse onto the four buckets the workbook names. */
export function materialBucket(type: string | null | undefined): MaterialBucket | null {
    const t = s(type).toUpperCase();
    if (!t) return null;
    if (['SPARE', 'PART', 'SPARES', 'ERSA'].includes(t)) return 'SPARE';
    if (['CONSUMABLE', 'CONSUMABLES', 'VERB', 'HIBE', 'LUBRICANT', 'CHEMICAL'].includes(t)) return 'CONSUMABLE';
    if (['TOOL', 'TOOLS', 'FHMI'].includes(t)) return 'TOOL';
    if (['MATERIAL', 'RAW', 'ROH', 'NLAG', 'UNBW', 'STOCK'].includes(t)) return 'MATERIAL';
    return null;
}

function decimalsOf(values: (number | '')[]): number {
    let d = 0;
    for (const v of values) {
        if (v === '') continue;
        const str = String(v);
        const i = str.indexOf('.');
        if (i >= 0) d = Math.max(d, str.length - i - 1);
    }
    return Math.min(d, 3);
}

// ── The build ───────────────────────────────────────────────────────────────

export function buildSapLoad(src: SapLoadSource, p: SapTargetParams): SapLoadResult {
    const issues = new IssueBook();
    const objects = {} as Record<SapObjectKey, Cell[][]>;
    const skipped = {} as Record<SapObjectKey, number>;
    for (const o of SAP_OBJECTS) { objects[o.key] = []; skipped[o.key] = 0; }

    // Lookups
    const assetById = new Map(src.assets.map(a => [a.id, a]));
    const companyCodeById = new Map(src.companies.map(c => [c.id, c.code]));
    const costCenterById = new Map(src.costCenters.map(c => [c.id, c]));
    const workCenterCodeById = new Map(src.workCenters.map(w => [w.id, w.code]));
    const vendorById = new Map(src.vendors.map(v => [v.id, v]));
    const storeById = new Map(src.stores.map(st => [st.id, st]));
    const financialByAsset = new Map<string, SrcAssetFinancial>();
    for (const f of src.assetFinancials) if (!financialByAsset.has(f.asset_id)) financialByAsset.set(f.asset_id, f);

    const isFloc = (a: SrcAsset): boolean => objectClassOf(a) === 'FLOC';
    // Plain booleans, not type predicates: a predicate on an already-typed
    // SrcAsset narrows the false branch to `never` under tsc -b.
    const isEq = (a: SrcAsset): boolean => objectClassOf(a) === 'EQUIPMENT';

    const parentOf = (a: SrcAsset): SrcAsset | undefined => (a.parent_id ? assetById.get(a.parent_id) : undefined);
    const depthOf = (a: SrcAsset): number => {
        let d = 0; let cur: SrcAsset | undefined = a; const seen = new Set<string>();
        while (cur && cur.parent_id && !seen.has(cur.id)) { seen.add(cur.id); cur = assetById.get(cur.parent_id); d += 1; }
        return d;
    };
    /** Nearest functional location above an asset (walks through superior equipment). */
    const flocAbove = (a: SrcAsset): SrcAsset | undefined => {
        let cur = parentOf(a); const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) { if (isFloc(cur)) return cur; seen.add(cur.id); cur = parentOf(cur); }
        return undefined;
    };
    /** The key dependent sheets use for an equipment row — the same value EQUNR carries. */
    const eqRef = (a: SrcAsset): string => (p.numbering === 'legacy' ? (s(a.equipment_number) || s(a.tag)) : s(a.tag));
    const companyCodeFor = (a: SrcAsset): string => (a.company_id && companyCodeById.get(a.company_id)) || p.companyCode;
    const costCenterCode = (id: string | null | undefined): string => (id ? s(costCenterById.get(id)?.code) : '');
    const workCenterCode = (id: string | null | undefined): string => (id ? s(workCenterCodeById.get(id)) : '');
    const locationOf = (a: SrcAsset): string => s((a.properties as Record<string, unknown> | null)?.location);

    const unknownLevel = src.assets.filter(a => !isFloc(a) && !isEq(a));
    if (unknownLevel.length) {
        issues.add('general', 'warn', `${unknownLevel.length} asset(s) have a hierarchy level that is neither a functional location nor equipment — not exported. Fix the level in the Asset Register.`, false);
    }

    // ── 1. Functional locations ────────────────────────────────────────────
    {
        const spec = SAP_OBJECT_BY_KEY.functionalLocation;
        const clip = clipper(issues, spec.key);
        const flocs = src.assets.filter(isFloc).sort((a, b) => depthOf(a) - depthOf(b) || a.tag.localeCompare(b.tag));
        for (const a of flocs) {
            const tag = s(a.tag);
            if (!tag) { skipped[spec.key] += 1; continue; }
            const parent = parentOf(a);
            if (parent && !isFloc(parent)) {
                issues.add(spec.key, 'warn', 'functional location sits under equipment — SAP allows only functional locations above a functional location; TPLMA left blank');
            }
            const cc = costCenterById.get(a.cost_center_id ?? '');
            objects[spec.key].push([
                clip(tag, 'TPLNR', 30),
                clip(s(a.name), 'PLTXT', 40),
                p.flCategory,
                p.structureIndicator,
                parent && isFloc(parent) ? clip(s(parent.tag), 'TPLMA', 30) : '',
                clip(s(a.hierarchy_level).toUpperCase(), 'EQART', 10),
                p.maintenancePlant,
                p.planningPlant,
                p.plannerGroup,
                costCenterCode(a.cost_center_id),
                companyCodeFor(a),
                s(cc?.controlling_area) || p.controllingArea,
                s(a.criticality).toUpperCase().slice(0, 1),
                '',
                clip(locationOf(a), 'STORT', 10),
                workCenterCode(a.responsible_work_center_id),
                '',
            ]);
        }
        if (flocs.length === 0 && src.assets.length > 0) {
            issues.add(spec.key, 'error', 'no functional locations — every equipment row will load without a position (TPLNR blank). Give the register a site/unit/system tree first.', false);
        }
    }

    // ── 2. Equipment ───────────────────────────────────────────────────────
    {
        const spec = SAP_OBJECT_BY_KEY.equipment;
        const clip = clipper(issues, spec.key);
        const eq = src.assets.filter(isEq).sort((a, b) => depthOf(a) - depthOf(b) || a.tag.localeCompare(b.tag));
        let noPosition = 0, noCriticality = 0, legacyMissing = 0;
        for (const a of eq) {
            if (!s(a.name) && !s(a.tag)) { skipped[spec.key] += 1; continue; }
            const parent = parentOf(a);
            const floc = flocAbove(a);
            if (!floc) noPosition += 1;
            if (!s(a.criticality)) noCriticality += 1;
            if (p.numbering === 'legacy' && !s(a.equipment_number)) legacyMissing += 1;
            const fin = financialByAsset.get(a.id);
            const props = (a.properties ?? {}) as Record<string, unknown>;
            const equnr = p.numbering === 'legacy' ? clip(s(a.equipment_number) || s(a.tag), 'EQUNR', 18) : '';
            objects[spec.key].push([
                equnr,
                clip(s(a.tag), 'TIDNR', 25),
                clip(s(a.name) || s(a.tag), 'EQKTX', 40),
                p.equipmentCategory,
                clip(s(a.asset_class || a.asset_type_code).toUpperCase(), 'EQART', 10),
                floc ? clip(s(floc.tag), 'TPLNR', 30) : '',
                parent && isEq(parent) ? clip(eqRef(parent), 'HEQUI', 18) : '',
                clip(s(a.manufacturer), 'HERST', 30),
                clip(s(a.model), 'TYPBZ', 20),
                clip(s(a.serial_number), 'SERGE', 30),
                s(props.constructionYear ?? props.construction_year ?? props.yearBuilt) || yearOf(fin?.acquisition_date),
                clip(s(props.inventoryNumber ?? props.inventory_number), 'INVNR', 25),
                p.maintenancePlant,
                p.planningPlant,
                p.plannerGroup,
                costCenterCode(a.cost_center_id),
                companyCodeFor(a),
                s(a.criticality).toUpperCase().slice(0, 1),
                '',
                clip(locationOf(a), 'STORT', 10),
                workCenterCode(a.responsible_work_center_id),
                toSapDate(fin?.acquisition_date),
                num(fin?.acquisition_cost),
            ]);
        }
        if (noPosition) issues.add(spec.key, 'warn', `${noPosition} equipment row(s) have no functional location above them — TPLNR blank; SAP will accept them but they will not appear in the location structure`, false);
        if (noCriticality) issues.add(spec.key, 'info', `${noCriticality} equipment row(s) have no criticality — ABCKZ blank`, false);
        if (legacyMissing) issues.add(spec.key, 'warn', `${legacyMissing} equipment row(s) have no equipment number — their tag is used as EQUNR; switch to internal numbering if the tags are not valid SAP equipment numbers`, false);
        if (p.numbering === 'internal' && eq.length) {
            issues.add(spec.key, 'info', 'internal numbering: EQUNR is blank and SAP assigns numbers on load. Dependent sheets (BOM, measuring points, documents) reference equipment by tag — map those to the assigned numbers after the equipment load, or key them on TIDNR.', false);
        }
    }

    // ── 3. Material ────────────────────────────────────────────────────────
    const materialCodes = new Set<string>();
    const itemById = new Map(src.inventoryItems.map(i => [i.id, i]));
    const stockByItem = new Map<string, SrcStock[]>();
    for (const st of src.stock) { const arr = stockByItem.get(st.item_id) ?? []; arr.push(st); stockByItem.set(st.item_id, arr); }
    const lgortFor = (storeId: string): string => s(p.storageLocations[storeId]);
    {
        const spec = SAP_OBJECT_BY_KEY.material;
        const clip = clipper(issues, spec.key);
        let unmappedType = 0, zeroPrice = 0, badUom = 0, noStoreCode = 0;
        for (const it of src.inventoryItems) {
            if (it.is_active === false) continue;
            const code = s(it.part_number);
            if (!code) { skipped[spec.key] += 1; continue; }
            materialCodes.add(code);
            const bucket = materialBucket(it.type) ?? 'SPARE';
            if (!materialBucket(it.type)) unmappedType += 1;
            const uom = s(it.uom).toUpperCase() || 'EA';
            if (uom.length > 3) badUom += 1;
            const price = num(it.unit_cost);
            if (price === '' || price === 0) zeroPrice += 1;
            const firstStock = (stockByItem.get(it.id) ?? []).sort((a, b) => Number(b.quantity ?? 0) - Number(a.quantity ?? 0))[0];
            const lgort = firstStock ? lgortFor(firstStock.location_id) : '';
            if (firstStock && !lgort) noStoreCode += 1;
            const minLevel = num(it.min_level);
            objects[spec.key].push([
                clip(code, 'MATNR', 40),
                clip(s(it.description) || code, 'MAKTX', 40),
                MTART[bucket],
                clip(s(p.materialGroup[bucket]), 'MATKL', 9),
                clip(uom, 'MEINS', 3),
                clip(s(it.material_number), 'BISMT', 40),
                clip(s(it.manufacturer), 'MFRNR', 10),
                clip(s(it.model), 'MFRPN', 40),
                p.maintenancePlant,
                minLevel !== '' && minLevel > 0 ? p.mrpType : 'ND',
                p.mrpController,
                minLevel,
                num(it.max_level),
                p.purchasingGroup,
                it.is_critical ? 'A' : '',
                lgort,
                clip(s(firstStock?.bin_location), 'LGPBE', 10),
                p.maintenancePlant,
                s(p.valuationClass[bucket]),
                p.priceControl,
                p.priceControl === 'S' ? price : '',
                p.priceControl === 'V' ? price : '',
                p.priceUnit,
            ]);
        }
        if (unmappedType) issues.add(spec.key, 'warn', `${unmappedType} material(s) have an inventory type that maps to none of SPARE / CONSUMABLE / TOOL / MATERIAL — exported as ERSA (spare); check MTART`, false);
        if (zeroPrice) issues.add(spec.key, 'warn', `${zeroPrice} material(s) have no unit cost — price blank or zero; SAP valuates opening stock at this price`, false);
        if (badUom) issues.add(spec.key, 'warn', `${badUom} material(s) have a unit longer than SAP's 3 characters — clipped; map units to SAP ISO codes (EA, L, KG, M)`, false);
        if (noStoreCode) issues.add(spec.key, 'error', `${noStoreCode} material(s) sit in a store with no SAP storage location code — set the LGORT for every store in the target parameters`, false);
    }

    // ── 4. Equipment BOM ───────────────────────────────────────────────────
    {
        const spec = SAP_OBJECT_BY_KEY.equipmentBom;
        const clip = clipper(issues, spec.key);
        const byAsset = new Map<string, SrcBomLine[]>();
        for (const l of src.bomLines) { const arr = byAsset.get(l.asset_id) ?? []; arr.push(l); byAsset.set(l.asset_id, arr); }
        let onFloc = 0, textLines = 0, unknownComponent = 0;
        const assetsWithBom = [...byAsset.keys()].map(id => assetById.get(id)).filter((a): a is SrcAsset => !!a)
            .sort((a, b) => a.tag.localeCompare(b.tag));
        for (const a of assetsWithBom) {
            if (!isEq(a)) { onFloc += byAsset.get(a.id)!.length; continue; }
            const lines = [...byAsset.get(a.id)!].sort((x, y) => s(x.created_at).localeCompare(s(y.created_at)) || x.id.localeCompare(y.id));
            let pos = 0;
            lines.forEach((l, idx) => {
                pos += 10;
                const item = l.inventory_item_id ? itemById.get(l.inventory_item_id) : undefined;
                const componentCode = s(item?.part_number) || s(l.part_number);
                const isStock = !!item && materialCodes.has(s(item.part_number));
                if (!isStock && componentCode && !materialCodes.has(componentCode)) unknownComponent += 1;
                const category = isStock || (componentCode && materialCodes.has(componentCode)) ? 'L' : 'T';
                if (category === 'T') textLines += 1;
                objects[spec.key].push([
                    clip(eqRef(a), 'EQUNR', 18),
                    p.bomUsage,
                    p.bomAlternative,
                    1,
                    'EA',
                    idx === 0 ? clip(`${s(a.tag)} maintenance BOM`, 'STKTX', 40) : '',
                    String(pos).padStart(4, '0'),
                    category,
                    category === 'L' ? clip(componentCode, 'IDNRK', 40) : '',
                    num(l.quantity) === '' ? 1 : num(l.quantity),
                    clip(s(l.uom || item?.uom).toUpperCase() || 'EA', 'MEINS', 3),
                    clip(category === 'T' ? (s(l.description) || componentCode) : s(l.notes) || (l.is_critical ? 'Critical spare' : ''), 'POTX1', 40),
                    '',
                    '',
                ]);
            });
        }
        if (onFloc) issues.add(spec.key, 'warn', `${onFloc} BOM line(s) belong to functional locations — the Equipment BOM object cannot carry them; load those as functional-location BOMs (usage 4, object FL) separately`, false);
        if (textLines) issues.add(spec.key, 'info', `${textLines} BOM line(s) have no material in the material list — exported as text items (POSTP = T) with the description in POTX1`, false);
        if (unknownComponent) issues.add(spec.key, 'info', `${unknownComponent} BOM line(s) name a part number that is not an active material — exported as text items rather than dangling component references`, false);
    }

    // ── 5. Measuring points ────────────────────────────────────────────────
    const defById = new Map(src.readingDefinitions.map(d => [d.id, d]));
    const psortOf = (d: SrcReadingDefinition): string => s(d.reading_type_code).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || s(d.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    {
        const spec = SAP_OBJECT_BY_KEY.measuringPoint;
        const clip = clipper(issues, spec.key);
        const logsByDef = new Map<string, (number | '')[]>();
        for (const l of src.readingLogs) { const arr = logsByDef.get(l.definition_id) ?? []; arr.push(num(l.reading_value)); logsByDef.set(l.definition_id, arr); }
        let noUnit = 0, criticalDropped = 0, orphan = 0;
        // One PSORT per object: two points with the same code on one asset would collide in SAP.
        const seen = new Set<string>();
        for (const d of src.readingDefinitions) {
            if (d.is_active === false) continue;
            const a = assetById.get(d.asset_id);
            if (!a) { orphan += 1; skipped[spec.key] += 1; continue; }
            const ref = isEq(a) ? eqRef(a) : s(a.tag);
            let psort = psortOf(d);
            let n = 2;
            while (seen.has(`${ref}|${psort}`)) { psort = `${psortOf(d).slice(0, 17)}-${n}`; n += 1; }
            seen.add(`${ref}|${psort}`);
            const unit = unitOf(d.unit);
            if (!unit) noUnit += 1;
            if (num(d.min_critical) !== '' || num(d.max_critical) !== '') criticalDropped += 1;
            const isCounter = s(d.category).toUpperCase() === 'METER';
            const lo = num(d.min_warning) !== '' ? num(d.min_warning) : num(d.min_critical);
            const hi = num(d.max_warning) !== '' ? num(d.max_warning) : num(d.max_critical);
            objects[spec.key].push([
                clip(ref, 'MPOBJ', 30),
                '',
                psort,
                clip(s(d.name) || psort, 'PTTXT', 40),
                clip(`${p.characteristicPrefix}${s(d.reading_type_code).toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`, 'ATNAM', 30),
                clip(unit, 'MRNGU', 3),
                isCounter ? 'X' : '',
                isCounter ? 0 : decimalsOf([...(logsByDef.get(d.id) ?? []), lo, hi]),
                '',
                '',
                isCounter ? '' : lo,
                isCounter ? '' : hi,
                '',
            ]);
        }
        if (noUnit) issues.add(spec.key, 'error', `${noUnit} measuring point(s) have no unit — MRNGU is required; set the unit on the reading point`, false);
        if (criticalDropped) issues.add(spec.key, 'info', `${criticalDropped} measuring point(s) carry a critical band as well as a warning band — SAP has one alarm pair; the warning band is exported (critical where no warning exists)`, false);
        if (orphan) issues.add(spec.key, 'warn', `${orphan} measuring point(s) reference an asset that is not in the register — skipped`, false);
    }

    // ── 6. Measurement documents ───────────────────────────────────────────
    {
        const spec = SAP_OBJECT_BY_KEY.measurementDoc;
        const clip = clipper(issues, spec.key);
        let inactive = 0, orphan = 0;
        const logs = [...src.readingLogs].sort((x, y) => `${x.reading_date} ${s(x.reading_time)}`.localeCompare(`${y.reading_date} ${s(y.reading_time)}`));
        for (const l of logs) {
            if (l.is_active === false) { inactive += 1; continue; }
            const d = defById.get(l.definition_id);
            const a = assetById.get(l.asset_id);
            if (!d || !a) { orphan += 1; skipped[spec.key] += 1; continue; }
            const isCounter = s(d.category).toUpperCase() === 'METER';
            const value = num(l.reading_value);
            objects[spec.key].push([
                '',
                isEq(a) ? eqRef(a) : s(a.tag),
                psortOf(d),
                toSapDate(l.reading_date),
                toSapTime(l.reading_time),
                isCounter ? '' : value,
                isCounter ? num(l.delta) : '',
                isCounter ? value : '',
                clip(unitOf(d.unit), 'MRNGU', 3),
                clip(s(l.comments), 'MDTXT', 40),
                clip(s(l.entered_by), 'ABLES', 12),
            ]);
        }
        if (inactive) issues.add(spec.key, 'info', `${inactive} reading(s) are inactive (superseded by a meter change) — not exported`, false);
        if (orphan) issues.add(spec.key, 'warn', `${orphan} reading(s) reference a point or asset that no longer exists — skipped`, false);
        if (objects[spec.key].length) issues.add(spec.key, 'info', 'measurement documents have no standard migration object on every release — see the sheet hint for the load routes', false);
    }

    // ── 7. Source list ─────────────────────────────────────────────────────
    {
        const spec = SAP_OBJECT_BY_KEY.sourceList;
        const clip = clipper(issues, spec.key);
        let noVendorCode = 0;
        for (const it of src.inventoryItems) {
            if (it.is_active === false || !it.preferred_vendor_id) continue;
            const code = s(it.part_number);
            if (!code) continue;
            const v = vendorById.get(it.preferred_vendor_id);
            const lifnr = s(v?.code);
            if (!lifnr) { noVendorCode += 1; skipped[spec.key] += 1; continue; }
            objects[spec.key].push([
                clip(code, 'MATNR', 40),
                p.maintenancePlant,
                p.sourceListValidFrom,
                '31.12.9999',
                clip(lifnr, 'LIFNR', 10),
                p.purchasingOrg,
                'X',
                '1',
            ]);
        }
        if (noVendorCode) issues.add(spec.key, 'error', `${noVendorCode} preferred supplier(s) have no vendor code — LIFNR is required; give every vendor its SAP business-partner number in Vendors`, false);
    }

    // ── 8. Inventory balance ───────────────────────────────────────────────
    {
        const spec = SAP_OBJECT_BY_KEY.inventoryBalance;
        const clip = clipper(issues, spec.key);
        let noStoreCode = 0, negative = 0;
        const rows = src.stock
            .map(st => ({ st, item: itemById.get(st.item_id) }))
            .filter(x => x.item && x.item.is_active !== false && Number(x.st.quantity ?? 0) !== 0)
            .sort((x, y) => s(x.item!.part_number).localeCompare(s(y.item!.part_number)));
        for (const { st, item } of rows) {
            const qty = Number(st.quantity ?? 0);
            if (qty < 0) { negative += 1; skipped[spec.key] += 1; continue; }
            const lgort = lgortFor(st.location_id);
            if (!lgort) noStoreCode += 1;
            objects[spec.key].push([
                clip(s(item!.part_number), 'MATNR', 40),
                p.maintenancePlant,
                lgort,
                '',
                '',
                qty,
                clip(s(item!.uom).toUpperCase() || 'EA', 'MEINS', 3),
                p.postingDate,
                '561',
            ]);
        }
        if (noStoreCode) issues.add(spec.key, 'error', `${noStoreCode} stock line(s) sit in a store with no SAP storage location code — LGORT is required`, false);
        if (negative) issues.add(spec.key, 'warn', `${negative} stock line(s) are negative — an opening balance cannot be negative; skipped, correct the count first`, false);
        const unknownStores = new Set(src.stock.map(st => st.location_id).filter(id => !storeById.has(id)));
        if (unknownStores.size) issues.add(spec.key, 'warn', `${unknownStores.size} store(s) referenced by stock are not in the store list — their LGORT cannot be set`, false);
    }

    // ── General ────────────────────────────────────────────────────────────
    if (src.workOrderCount > 0) {
        issues.add('general', 'info', `${src.workOrderCount.toLocaleString()} work order(s) are not in this workbook — historical maintenance orders have no standard migration object, and creating them retrospectively distorts cost and status reporting. Keep the history in IREAMS or hand it over as a report.`, false);
    }

    return { objects, issues: issues.list(), skipped };
}

// ── Workbook rendering ──────────────────────────────────────────────────────

export interface RenderOptions {
    /** 'template' ships the description row + examples; 'filled' ships data from row 5 (load-ready). */
    mode: 'template' | 'filled';
    /** Which objects to include. Default: all eight in load order. */
    objects?: SapObjectKey[];
    /** Extra Read-me rows (e.g. tenant name, export timestamp, counts). */
    readmeExtra?: string[][];
}

function objectSheet(spec: SapObjectSpec, rows: Cell[][], mode: RenderOptions['mode']): XLSX.WorkSheet {
    const aoa: Cell[][] = [
        [spec.title],
        [spec.hint],
        [mode === 'template' ? ROW3_INSTRUCTION : 'Row 4 = SAP field name (keep). Data starts at row 5 — this sheet was filled from IREAMS and is load-ready; the description row has been removed.'],
        spec.fields.map(f => f.name),
    ];
    if (mode === 'template') {
        aoa.push(spec.fields.map(fieldDescription));
        aoa.push(...spec.examples);
    } else {
        aoa.push(...rows);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = spec.fields.map(f => ({ wch: f.width ?? 14 }));
    ws['!rows'] = [{ hpt: 18 }, { hpt: 15 }, { hpt: 15 }, { hpt: 16 }];
    return ws;
}

export function readmeRows(p: SapTargetParams, mode: RenderOptions['mode'], extra: string[][] = []): string[][] {
    const title = p.systemLabel ? `SAP Load Templates — ${p.systemLabel}` : 'SAP Load Templates';
    const rows: string[][] = [
        [title],
        [''],
        ['Purpose', mode === 'template'
            ? 'Blank templates shaped to SAP field names, ready to fill from the IREAMS / ERS export files. One sheet per Migration Cockpit object.'
            : 'Load files shaped to SAP field names, filled from the IREAMS / ERS register. One sheet per Migration Cockpit object.'],
        ['How to use', mode === 'template'
            ? 'Row 4 holds the SAP field name — keep it. Row 5 describes the field. Row 6 onward is example data. Delete rows 5 and 6, then paste your data starting at row 5.'
            : 'Row 4 holds the SAP field name — keep it. Data starts at row 5. Check the "9 Readiness" sheet before loading anything.'],
        ['Required fields', 'A row-5 description that starts with REQUIRED marks a mandatory field. The rest are optional.'],
        ['Load order', 'Functional Location, Equipment, Material, Equipment BOM, Measuring Point, Measurement Document, Source List, Inventory Balance. Each depends on those above it.'],
        ['Where to load', "Fiori app 'Migrate Your Data', or transaction LTMC. Simulate before posting. Run ten rows end to end before the full file."],
        ['Target values', `Company code ${p.companyCode}, maintenance plant ${p.maintenancePlant}, planning plant ${p.planningPlant}, controlling area ${p.controllingArea}, valuation classes ${p.valuationClass.SPARE} spares and ${p.valuationClass.CONSUMABLE} operating supplies, price control ${p.priceControl}, purchasing organisation ${p.purchasingOrg}. Confirm the controlling area before loading.`],
        ['Equipment numbering', p.numbering === 'legacy'
            ? 'EQUNR carries the IREAMS equipment number (external numbering). Dependent sheets reference equipment by the same value. TIDNR carries the field tag.'
            : 'EQUNR is blank — SAP assigns numbers on load (internal numbering). Dependent sheets reference equipment by tag; map them to the assigned numbers after the equipment load, or key on TIDNR.'],
        ['Not loadable', 'Historical maintenance orders. There is no standard migration object and creating them retrospectively distorts cost and status reporting.'],
        ['Before you start', 'Check the target system has transport routes configured, so configuration can be preserved if a load goes wrong. Raise that with the technical team first.'],
    ];
    if (extra.length) rows.push([''], ...extra);
    return rows;
}

export function buildSapWorkbook(result: SapLoadResult | null, p: SapTargetParams, opts: RenderOptions): XLSX.WorkBook {
    const wb = XLSX.utils.book_new();
    const keys = opts.objects ?? SAP_OBJECTS.map(o => o.key);
    const readme = XLSX.utils.aoa_to_sheet(readmeRows(p, opts.mode, opts.readmeExtra));
    readme['!cols'] = [{ wch: 22 }, { wch: 120 }];
    XLSX.utils.book_append_sheet(wb, readme, '0 Read me');
    for (const spec of SAP_OBJECTS) {
        if (!keys.includes(spec.key)) continue;
        XLSX.utils.book_append_sheet(wb, objectSheet(spec, result?.objects[spec.key] ?? [], opts.mode), spec.sheet);
    }
    if (opts.mode === 'filled' && result) {
        const aoa: Cell[][] = [
            ['Readiness — what to fix or accept before loading'],
            ['Generated with the data; errors block a clean load, warnings need a look, info is context.'],
            [''],
            ['Object', 'Level', 'Rows affected', 'Finding'],
            ...result.issues.map(i => [
                i.object === 'general' ? 'General' : SAP_OBJECT_BY_KEY[i.object].label,
                i.level.toUpperCase(),
                i.count ?? '',
                i.message,
            ]),
            [''],
            ['Object', 'Rows exported', 'Rows skipped'],
            ...SAP_OBJECTS.filter(o => keys.includes(o.key)).map(o => [o.label, result.objects[o.key].length, result.skipped[o.key]]),
        ];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 120 }];
        XLSX.utils.book_append_sheet(wb, ws, '9 Readiness');
    }
    return wb;
}
