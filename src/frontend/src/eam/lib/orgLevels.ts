/**
 * Organisation hierarchy levels (ORG_LEVEL reference codes) and the small
 * helpers every org-chart surface shares.
 *
 * The level config — order, colour, which level sits under which — lives in
 * the reference_codes.metadata column (0095). getDictionaries() spreads only
 * `properties`, so a caller that read `d.metadata` off a dictionary entry got
 * undefined: every level sorted 99 in raw row order (Department, Division,
 * Section, Site, Team), every level grey, no child level. That is why the
 * chart offered "New Department" at the root and labelled a site's divisions
 * "Teams". Read levels through DatabaseService.getOrgLevels() instead.
 */

export interface OrgLevel {
    id?: string;
    code: string;
    description: string;
    sortOrder: number;
    color: string;
    childType: string | null;
    childLabel: string | null;
}

export function mapOrgLevelRow(r: any): OrgLevel {
    const m = (r?.metadata && typeof r.metadata === 'object') ? r.metadata : {};
    return {
        id: r.id,
        code: r.code,
        description: r.description,
        sortOrder: Number(m.sort_order ?? r.sort_order ?? 99),
        color: m.color ?? r.color_code ?? 'gray',
        childType: m.child_type ?? null,
        childLabel: m.child_label ?? null,
    };
}

/** "Site / Plant" → "Sites / Plants", "Facility" → "Facilities", "Team" → "Teams". */
export function pluralLevel(label: string, n = 2): string {
    if (n === 1) return label;
    const one = (w: string) => {
        if (!w) return w;
        if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
        if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
        return w + 's';
    };
    return label.split(' / ').map(part => {
        const words = part.split(' ');
        words[words.length - 1] = one(words[words.length - 1]);
        return words.join(' ');
    }).join(' / ');
}

export interface LevelStyle { dot: string; badge: string; soft: string; border: string; text: string }

/** Tailwind classes per seeded colour; unknown custom colours fall back to slate + an inline dot. */
const STYLES: Record<string, LevelStyle> = {
    '#3b82f6': { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200', soft: 'bg-blue-50/60', border: 'border-l-blue-500', text: 'text-blue-700' },
    '#8b5cf6': { dot: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700 border-violet-200', soft: 'bg-violet-50/60', border: 'border-l-violet-500', text: 'text-violet-700' },
    '#f59e0b': { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-800 border-amber-200', soft: 'bg-amber-50/60', border: 'border-l-amber-500', text: 'text-amber-800' },
    '#10b981': { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', soft: 'bg-emerald-50/60', border: 'border-l-emerald-500', text: 'text-emerald-700' },
    '#6366f1': { dot: 'bg-indigo-500', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200', soft: 'bg-indigo-50/60', border: 'border-l-indigo-500', text: 'text-indigo-700' },
    '#ef4444': { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200', soft: 'bg-red-50/60', border: 'border-l-red-500', text: 'text-red-700' },
    '#ec4899': { dot: 'bg-pink-500', badge: 'bg-pink-50 text-pink-700 border-pink-200', soft: 'bg-pink-50/60', border: 'border-l-pink-500', text: 'text-pink-700' },
    '#14b8a6': { dot: 'bg-teal-500', badge: 'bg-teal-50 text-teal-700 border-teal-200', soft: 'bg-teal-50/60', border: 'border-l-teal-500', text: 'text-teal-700' },
    '#06b6d4': { dot: 'bg-cyan-500', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200', soft: 'bg-cyan-50/60', border: 'border-l-cyan-500', text: 'text-cyan-700' },
    '#84cc16': { dot: 'bg-lime-500', badge: 'bg-lime-50 text-lime-800 border-lime-200', soft: 'bg-lime-50/60', border: 'border-l-lime-500', text: 'text-lime-800' },
    '#f97316': { dot: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700 border-orange-200', soft: 'bg-orange-50/60', border: 'border-l-orange-500', text: 'text-orange-700' },
};
const FALLBACK: LevelStyle = { dot: 'bg-slate-400', badge: 'bg-slate-50 text-slate-600 border-slate-200', soft: 'bg-slate-50/60', border: 'border-l-slate-400', text: 'text-slate-600' };

export const levelStyle = (color?: string | null): LevelStyle => STYLES[(color || '').toLowerCase()] ?? FALLBACK;

/** A person as the org chart needs them (DatabaseService.getOrgPeople). */
export interface OrgPerson {
    id: string;
    name: string;
    initials: string;
    title: string | null;
    role: string | null;
    active: boolean;
    /** contacts.organization_unit_id */
    primaryUnitId: string | null;
    /** primary first, then secondary memberships */
    unitIds: string[];
}

/**
 * The unit list after taking a person out of one unit, primary first — the
 * input set_contact_org_units expects. If the unit left was their primary,
 * the next membership becomes primary; an empty list takes them out entirely.
 */
export function unitsWithout(p: Pick<OrgPerson, 'primaryUnitId' | 'unitIds'>, unitId: string): string[] {
    const rest = p.unitIds.filter(u => u !== unitId);
    const primary = p.primaryUnitId && p.primaryUnitId !== unitId ? p.primaryUnitId : rest[0];
    return primary ? [primary, ...rest.filter(u => u !== primary)] : [];
}

/** Move a person from one unit to another, keeping whether it was their primary. */
export function unitsMoved(p: Pick<OrgPerson, 'primaryUnitId' | 'unitIds'>, fromId: string, toId: string): string[] {
    const swapped = Array.from(new Set(p.unitIds.map(u => (u === fromId ? toId : u))));
    const primary = p.primaryUnitId === fromId ? toId : (p.primaryUnitId ?? swapped[0]);
    return primary ? [primary, ...swapped.filter(u => u !== primary)] : swapped;
}
