/**
 * OData V4 helpers shared by the live-link worker (erp-sync), the SAP PM
 * simulator (sap-sim) and the Integrations screen.
 *
 * Pure: no fetch, no Deno, no browser. The worker and the simulator carry a
 * byte-identical copy under supabase/functions/erp-sync/lib and
 * supabase/functions/sap-sim/lib (Deno wants `.ts` on relative imports; the
 * app's bundler forbids them) — functionCopy.test.ts fails the build if the
 * copies drift.
 *
 * Which S/4 services exist per release varies (API_EQUIPMENT and
 * API_FUNCTIONALLOCATION are OData V2 on many releases; the plan targets V4
 * where a release has it). The emitter speaks one dialect — V4 shapes,
 * `value` arrays, `@odata.etag` — and the phase-4 adapter for a client's
 * release translates. Nothing here knows about a real SAP.
 */

export type EntitySet =
    | 'A_Equipment'
    | 'A_FunctionalLocation'
    | 'A_MeasuringPoint'
    | 'A_MeasurementDocument'
    | 'A_MaintenanceNotification'
    | 'A_MaintenanceOrder';

export const ENTITY_SETS: EntitySet[] = [
    'A_Equipment', 'A_FunctionalLocation', 'A_MeasuringPoint',
    'A_MeasurementDocument', 'A_MaintenanceNotification', 'A_MaintenanceOrder',
];

/** The key property of each entity set — what goes inside the parentheses. */
export const KEY_PROPERTY: Record<EntitySet, string> = {
    A_Equipment: 'Equipment',
    A_FunctionalLocation: 'FunctionalLocation',
    A_MeasuringPoint: 'MeasuringPoint',
    A_MeasurementDocument: 'MeasurementDocument',
    A_MaintenanceNotification: 'MaintenanceNotification',
    A_MaintenanceOrder: 'MaintenanceOrder',
};

export const isEntitySet = (s: string): s is EntitySet => (ENTITY_SETS as string[]).includes(s);

/** An OData timestamp literal: plain ISO 8601 in V4. */
export const odataTimestamp = (d: Date | string): string => new Date(d).toISOString();

/** `LastChangeDateTime gt 2026-09-22T10:00:00.000Z`, or nothing when there is no watermark yet. */
export function sinceFilter(field: string, since: string | null | undefined): string | undefined {
    return since ? `${field} gt ${odataTimestamp(since)}` : undefined;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Collection URL with `$…` query options; undefined options are left out. */
export function setUrl(base: string, set: EntitySet, query: Record<string, string | number | undefined> = {}): string {
    const qs = Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
    return `${trimSlash(base)}/${set}${qs ? `?${qs}` : ''}`;
}

/** Single-entity URL: `…/A_Equipment('10000001')`. A quote inside a key doubles. */
export function keyUrl(base: string, set: EntitySet, key: string): string {
    return `${trimSlash(base)}/${set}('${encodeURIComponent(key.replace(/'/g, "''"))}')`;
}

export interface KeyPath { set: EntitySet; key: string | null }

/**
 * The reverse: `A_Equipment('10000001')` → { set, key }; `A_Equipment` → key null.
 * Returns null for anything that is not an entity set this link knows.
 */
export function parseKeyPath(segment: string): KeyPath | null {
    const m = /^([A-Za-z_]+)(?:\('((?:[^']|'')*)'\))?$/.exec(decodeURIComponent(segment));
    if (!m || !isEntitySet(m[1])) return null;
    return { set: m[1], key: m[2] === undefined ? null : m[2].replace(/''/g, "'") };
}

export interface FilterClause { field: string; op: 'gt' | 'ge' | 'lt' | 'le' | 'eq' | 'ne'; value: string }

/**
 * The subset of `$filter` the link uses: `A op literal [and B op literal]…`
 * with string literals in single quotes and timestamps bare. Anything else
 * returns null, and the simulator answers 400 rather than pretending.
 */
export function parseFilter(filter: string | null | undefined): FilterClause[] | null {
    if (!filter || !filter.trim()) return [];
    const out: FilterClause[] = [];
    for (const part of filter.split(/\s+and\s+/i)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+(gt|ge|lt|le|eq|ne)\s+(?:'((?:[^']|'')*)'|(\S+))\s*$/i.exec(part);
        if (!m) return null;
        out.push({ field: m[1], op: m[2].toLowerCase() as FilterClause['op'], value: m[3] !== undefined ? m[3].replace(/''/g, "'") : m[4] });
    }
    return out;
}

const looksLikeTimestamp = (s: string) => /^\d{4}-\d{2}-\d{2}T/.test(s);

/** Apply parsed clauses to one entity. Timestamps compare as instants, everything else as strings. */
export function matchesFilter(entity: Record<string, unknown>, clauses: FilterClause[]): boolean {
    return clauses.every(({ field, op, value }) => {
        const raw = entity[field];
        if (raw === undefined || raw === null) return op === 'ne';
        const [a, b] = looksLikeTimestamp(value)
            ? [new Date(String(raw)).getTime(), new Date(value).getTime()]
            : [String(raw), value];
        switch (op) {
            case 'gt': return a > b;
            case 'ge': return a >= b;
            case 'lt': return a < b;
            case 'le': return a <= b;
            case 'eq': return a === b;
            case 'ne': return a !== b;
        }
    });
}

/** Weak ETags, the way S/4 issues them: `W/"3"`. */
export const etagOf = (version: number): string => `W/"${version}"`;

const bareEtag = (s: string) => s.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');

/** `If-Match: *` matches anything; otherwise the versions must agree, weak marker or not. */
export function etagMatches(ifMatch: string | null | undefined, current: string): boolean {
    if (!ifMatch) return false;
    if (ifMatch.trim() === '*') return true;
    return ifMatch.split(',').some((c) => bareEtag(c) === bareEtag(current));
}

/** The ETag an entity body carries in V4 (`@odata.etag`), if any. */
export const bodyEtag = (body: unknown): string | null => {
    const v = body && typeof body === 'object' ? (body as Record<string, unknown>)['@odata.etag'] : undefined;
    return typeof v === 'string' && v ? v : null;
};
