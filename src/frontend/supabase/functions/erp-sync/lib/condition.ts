/**
 * Condition over the live link: measuring points and measurement documents.
 *
 * A reading point in IREAMS is a measuring point in SAP, hung on the same
 * technical object (the asset's equipment or functional location). A logged
 * reading is a measurement document: written once, never changed, so the
 * guarantee is at-least-once with natural idempotency (point + instant), and
 * an inbound document keeps SAP's number as its source identity (0381) so a
 * re-import can never double a history.
 *
 * Only LOGGED readings travel (plan §4): rows a person entered, or a
 * connector's import that a person owns. High-frequency telemetry from the
 * Connector Hub stays out — its rows are marked by the entered_by prefixes
 * below.
 *
 * Pure. The worker (erp-sync) carries a byte-identical copy; see odata.ts.
 */
import type { Owner } from './masterData.ts';
import type { ParentRef } from './masterData.ts';

// ── Points ───────────────────────────────────────────────────────────────────

export interface LinkPoint {
    id: string;
    asset_id: string;
    reading_type_code: string;
    name: string;
    unit: string | null;
    category: string | null;
    min_critical: number | null;
    min_warning: number | null;
    max_warning: number | null;
    max_critical: number | null;
    is_active: boolean;
    source_system: string | null;
    source_ref: string | null;
    updated_at: string;
}

export interface MeasuringPointDoc {
    MeasuringPoint?: string;
    MeasuringPointDescription: string;
    /** The technical object the point hangs on: an equipment or functional location key. */
    MeasuringPointObject?: string;
    MeasuringPointObjectType?: 'EQUI' | 'IFLOT';
    MeasurementRangeUnit?: string;
    MeasuringPointIsCounter: boolean;
    MeasuringPointUpperLimit?: number;
    MeasuringPointLowerLimit?: number;
    MeasuringPointIsInactive?: boolean;
    /** Free text SAP keeps with the point; IREAMS puts the reading-type code there so it survives the round trip. */
    MeasuringPointText?: string;
    LastChangeDateTime?: string;
}

/** SAP describes a point in 40 characters. */
export const POINT_DESCRIPTION_MAX = 40;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export function toMeasuringPointDoc(p: LinkPoint, externalKey: string | null, object: ParentRef | null): MeasuringPointDoc {
    const doc: MeasuringPointDoc = {
        MeasuringPointDescription: (p.name || p.reading_type_code).slice(0, POINT_DESCRIPTION_MAX),
        MeasuringPointIsCounter: false,
        MeasuringPointIsInactive: !p.is_active,
        MeasuringPointText: p.reading_type_code,
    };
    if (externalKey) doc.MeasuringPoint = externalKey;
    if (object) { doc.MeasuringPointObject = object.key; doc.MeasuringPointObjectType = object.type; }
    if (p.unit) doc.MeasurementRangeUnit = p.unit;
    // SAP's range is the outermost pair — the critical limits.
    if (p.max_critical !== null) doc.MeasuringPointUpperLimit = p.max_critical;
    if (p.min_critical !== null) doc.MeasuringPointLowerLimit = p.min_critical;
    return doc;
}

export type PointPatch = Partial<Pick<LinkPoint, 'name' | 'unit' | 'min_critical' | 'max_critical' | 'is_active'>>;

export function fromMeasuringPoint(e: Partial<MeasuringPointDoc>): PointPatch {
    const p: PointPatch = {};
    if (typeof e.MeasuringPointDescription === 'string') p.name = e.MeasuringPointDescription;
    if ('MeasurementRangeUnit' in e) p.unit = (e.MeasurementRangeUnit ?? '').trim() || null;
    if ('MeasuringPointUpperLimit' in e) p.max_critical = num(e.MeasuringPointUpperLimit);
    if ('MeasuringPointLowerLimit' in e) p.min_critical = num(e.MeasuringPointLowerLimit);
    if ('MeasuringPointIsInactive' in e) p.is_active = !e.MeasuringPointIsInactive;
    return p;
}

export const POINT_SYNCED_FIELDS: (keyof PointPatch)[] = ['name', 'unit', 'min_critical', 'max_critical', 'is_active'];

/** Only what differs, so an echo touches nothing. */
export function pointDiff(current: Pick<LinkPoint, keyof PointPatch>, patch: PointPatch): PointPatch {
    const out: PointPatch = {};
    for (const k of Object.keys(patch) as (keyof PointPatch)[]) {
        if ((current[k] ?? null) !== (patch[k] ?? null)) (out as Record<string, unknown>)[k] = patch[k] ?? null;
    }
    return out;
}

export interface NewPoint {
    asset_id: string;
    reading_type_code: string;
    name: string;
    unit: string | null;
    min_critical: number | null;
    max_critical: number | null;
    is_active: boolean;
    source_system: 'sap_pm';
    source_ref: string;
}

/** A point first seen in SAP: its number is its identity, its text (if IREAMS wrote it) is its type code. */
export function newPointFromMeasuringPoint(e: Partial<MeasuringPointDoc> & { MeasuringPoint: string }, assetId: string): NewPoint {
    const patch = fromMeasuringPoint(e);
    const code = (e.MeasuringPointText ?? '').trim() || `MP_${e.MeasuringPoint}`;
    return {
        asset_id: assetId,
        reading_type_code: code.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').slice(0, 60),
        name: patch.name?.trim() || e.MeasuringPoint,
        unit: patch.unit ?? null,
        min_critical: patch.min_critical ?? null,
        max_critical: patch.max_critical ?? null,
        is_active: patch.is_active ?? true,
        source_system: 'sap_pm',
        source_ref: e.MeasuringPoint,
    };
}

// ── Documents ────────────────────────────────────────────────────────────────

/** Rows written by machines, not people. They never become measurement documents (plan §4). */
export const MACHINE_PREFIXES = ['connector:', 'collector:', 'sensor:', 'predict:'];

export const isLoggedReading = (enteredBy: string | null | undefined): boolean => {
    const s = (enteredBy ?? '').trim().toLowerCase();
    return !MACHINE_PREFIXES.some((p) => s.startsWith(p));
};

export interface LinkReading {
    id: string;
    definition_id: string;
    asset_id: string;
    reading_type_code: string;
    reading_date: string;          // YYYY-MM-DD
    reading_time: string | null;   // HH:MM:SS
    reading_value: number;
    entered_by: string | null;
    comments: string | null;
    valuation_code: string | null;
    source_system: string | null;
    source_ref: string | null;
    created_at: string;
}

export interface MeasurementDocumentDoc {
    MeasurementDocument?: string;
    MeasuringPoint: string;
    MsmtRdngDate: string;   // YYYY-MM-DD
    MsmtRdngTime: string;   // HH:MM:SS
    MeasurementReadingInEntryUoM: number;
    MsmtRdngEntryUoM?: string;
    MeasurementDocumentText?: string;
    MsmtValuationCode?: string;
    MeasurementReadingByUser?: string;
    LastChangeDateTime?: string;
}

/** SAP keeps 40 characters of text with a document. */
export const DOCUMENT_TEXT_MAX = 40;

const hhmmss = (t: string | null | undefined): string => {
    const m = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(t ?? '');
    return m ? `${m[1]}:${m[2]}:${m[3] ?? '00'}` : '00:00:00';
};

export function toMeasurementDocumentDoc(r: LinkReading, pointKey: string, unit: string | null): MeasurementDocumentDoc {
    const doc: MeasurementDocumentDoc = {
        MeasuringPoint: pointKey,
        MsmtRdngDate: r.reading_date,
        MsmtRdngTime: hhmmss(r.reading_time),
        MeasurementReadingInEntryUoM: r.reading_value,
    };
    if (unit) doc.MsmtRdngEntryUoM = unit;
    const text = (r.comments ?? '').trim();
    if (text) doc.MeasurementDocumentText = text.slice(0, DOCUMENT_TEXT_MAX);
    if (r.valuation_code) doc.MsmtValuationCode = r.valuation_code;
    const by = (r.entered_by ?? '').trim();
    if (by) doc.MeasurementReadingByUser = by.slice(0, 12);
    return doc;
}

export interface NewReading {
    definition_id: string;
    asset_id: string;
    reading_type_code: string;
    reading_date: string;
    reading_time: string;
    reading_value: number;
    entered_by: string;
    comments: string | null;
    valuation_code: string | null;
    source_system: 'sap_pm';
    source_ref: string;
}

/**
 * A document created in SAP becomes a reading with SAP's number as its
 * identity, so importing the same document twice inserts nothing (0381).
 * Returns null when the document has no value or no date — nothing to log.
 */
export function fromMeasurementDocument(e: Partial<MeasurementDocumentDoc> & { MeasurementDocument: string }, point: { id: string; asset_id: string; reading_type_code: string }): NewReading | null {
    const value = num(e.MeasurementReadingInEntryUoM);
    const date = /^\d{4}-\d{2}-\d{2}/.exec(e.MsmtRdngDate ?? '')?.[0];
    if (value === null || !date) return null;
    return {
        definition_id: point.id,
        asset_id: point.asset_id,
        reading_type_code: point.reading_type_code,
        reading_date: date,
        reading_time: hhmmss(e.MsmtRdngTime),
        reading_value: value,
        entered_by: `sap:${(e.MeasurementReadingByUser ?? '').trim() || e.MeasurementDocument}`,
        comments: (e.MeasurementDocumentText ?? '').trim() || null,
        valuation_code: (e.MsmtValuationCode ?? '').trim() || null,
        source_system: 'sap_pm',
        source_ref: e.MeasurementDocument,
    };
}

/** Which side a reading came from decides whether it goes out: SAP's own documents never go back. */
export const readingGoesOut = (r: Pick<LinkReading, 'entered_by' | 'source_system'>): boolean =>
    isLoggedReading(r.entered_by) && !(r.source_system ?? '').toLowerCase().startsWith('sap');

/** The condition family's owner decides point conflicts; documents have none (immutable). */
export const pointOwner = (owner: Owner | undefined): Owner => owner ?? 'ireams';
