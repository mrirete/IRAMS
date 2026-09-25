/**
 * Bearings the Asset Register already knows about, turned into suggestions
 * for Monitoring setup — so nobody retypes "SKF 6205-2RS" that is already on
 * the component record.
 *
 * Three outcomes per register bearing:
 *   catalog    — the model's base designation is in BEARING_CATALOG: one-click add.
 *   datasheet  — a model is known but not in the catalog: pre-fill the datasheet
 *                row; the user adds BPFO/BPFI from the maker's datasheet.
 *   fluid-film — tilting-pad / journal / sleeve bearings. Rolling-element defect
 *                frequencies (BPFO/BPFI/BSF/FTF) do not exist for them; shaft
 *                orbit (proximity probes, ISO 20816-2/-3) is the method instead.
 *   unknown    — the register names a bearing but has no model.
 */
import { BEARING_CATALOG } from './bearingCatalog';

export interface RegisterBearingRow {
    id: string;
    tag: string | null;
    name: string | null;
    manufacturer: string | null;
    model: string | null;
}

export type BearingSuggestionKind = 'catalog' | 'datasheet' | 'fluid-film' | 'unknown';

export interface BearingSuggestion {
    id: string;
    tag: string;
    name: string;
    maker: string | null;
    model: string | null;
    /** DE / NDE / Thrust / Radial, read from the name or tag */
    position?: string;
    kind: BearingSuggestionKind;
    /** base designation read from the model ("6309" from "6309-2RS") */
    designation?: string;
}

const BEARING = /bearing|\bbrg\b|-brg\b|-brg-/i;
// "LEG" = leading-edge-groove tilting pad. "thrust" alone is NOT fluid-film (51210 is a rolling thrust bearing).
const FLUID_FILM = /tilting|tilt[- ]?pad|\bpad\b|journal|sleeve|babbitt|fluid[- ]?film|hydrodynamic|\bleg\b|plain bearing/i;

export const isBearingRow = (r: RegisterBearingRow) => BEARING.test(`${r.name ?? ''} ${r.tag ?? ''}`);

export function bearingPosition(r: RegisterBearingRow): string | undefined {
    const text = `${r.name ?? ''}`.toLowerCase();
    const tag = (r.tag ?? '').toUpperCase();
    if (text.includes('non-drive end') || text.includes('non drive end') || /(^|[-_ ])NDE([-_ ]|$)/.test(tag)) return 'NDE';
    if (text.includes('drive end') || /(^|[-_ ])DE([-_ ]|$)/.test(tag)) return 'DE';
    if (text.includes('thrust') || /AXBRG|THRUST/.test(tag)) return 'Thrust';
    if (text.includes('radial') || /RADBRG/.test(tag)) return 'Radial';
    return undefined;
}

export function classifyBearing(r: RegisterBearingRow): BearingSuggestion {
    const model = (r.model ?? '').trim() || null;
    const base = { id: r.id, tag: r.tag ?? '', name: r.name ?? r.tag ?? 'Bearing', maker: (r.manufacturer ?? '').trim() || null, model, position: bearingPosition(r) };
    if (FLUID_FILM.test(`${model ?? ''} ${r.name ?? ''}`)) return { ...base, kind: 'fluid-film' };
    const designation = model?.match(/\b(\d{4,5})\b/)?.[1] ?? model?.match(/^(\d{4,5})/)?.[1];
    if (designation && BEARING_CATALOG.some(e => e.designation === designation)) return { ...base, kind: 'catalog', designation };
    if (model) return { ...base, kind: 'datasheet', designation: designation ?? model };
    return { ...base, kind: 'unknown' };
}

export function registerBearingSuggestions(rows: RegisterBearingRow[]): BearingSuggestion[] {
    return rows.filter(isBearingRow).map(classifyBearing)
        .sort((a, b) => (a.position ?? '~').localeCompare(b.position ?? '~') || a.name.localeCompare(b.name));
}
