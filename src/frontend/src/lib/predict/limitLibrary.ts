/**
 * Standards-based acceptable-limit library (Phase 1.5.1 — threshold intelligence).
 *
 * "The system proposes, the human approves": every suggested alarm band cites
 * an auditable source, so no user is left inventing a number. Vibration bands
 * come from ISO 20816-3 broadband-velocity zone boundaries — warning at B/C
 * (not suitable for unrestricted long-term operation), critical at C/D (risk
 * of damage). One blanket number is WRONG: the boundaries depend on machine
 * size and mounting, which is why the old universal 7.1 mm/s default let a
 * medium machine sit deep in zone C while showing green.
 */

/** ISO 20816-3 machine classification: size (power) × support stiffness. */
export type MachineClass = 'large-rigid' | 'medium-rigid' | 'large-flexible' | 'medium-flexible';

export interface BandSuggestion {
    minWarning: number | null;
    minCritical: number | null;
    maxWarning: number | null;
    maxCritical: number | null;
    /** machine-readable provenance persisted as reading_definitions.limit_source */
    source: string;
    /** human-readable citation shown next to the suggestion */
    label: string;
}

/** ISO 20816-3 zone boundaries, mm/s RMS velocity on bearing housings. */
export const ISO20816_ZONES: Record<MachineClass, { ab: number; bc: number; cd: number; describe: string }> = {
    'large-rigid': { ab: 2.3, bc: 4.5, cd: 7.1, describe: 'ISO 20816-3 Group 1 — large machines (>300 kW), rigid mounting' },
    'medium-rigid': { ab: 1.4, bc: 2.8, cd: 4.5, describe: 'ISO 20816-3 Group 2 — medium machines (15–300 kW), rigid mounting' },
    'large-flexible': { ab: 3.5, bc: 7.1, cd: 11.2, describe: 'ISO 20816-3 Group 1 — large machines (>300 kW), flexible mounting' },
    'medium-flexible': { ab: 2.3, bc: 4.5, cd: 7.1, describe: 'ISO 20816-3 Group 2 — medium machines (15–300 kW), flexible mounting' },
};

export function resolveMachineClass(over300kW: boolean, flexibleMount: boolean): MachineClass {
    return `${over300kW ? 'large' : 'medium'}-${flexibleMount ? 'flexible' : 'rigid'}` as MachineClass;
}

/** Vibration alarm bands per ISO 20816-3: warning = B/C boundary, critical = C/D. */
export function vibrationBands(cls: MachineClass): BandSuggestion {
    const z = ISO20816_ZONES[cls];
    return {
        minWarning: null,
        minCritical: null,
        maxWarning: z.bc,
        maxCritical: z.cd,
        source: `iso20816-${cls}`,
        label: z.describe,
    };
}

/** Typical temperature limits by measurement kind — cited defaults, editable. */
export const TEMPERATURE_BANDS: Record<'bearing' | 'winding' | 'discharge' | 'engine-oil' | 'coolant', BandSuggestion> = {
    bearing: { minWarning: null, minCritical: null, maxWarning: 80, maxCritical: 95, source: 'template', label: 'Typical rolling-element bearing housing limits' },
    winding: { minWarning: null, minCritical: null, maxWarning: 95, maxCritical: 120, source: 'template', label: 'Class-F motor winding with thermal margin' },
    discharge: { minWarning: null, minCritical: null, maxWarning: 120, maxCritical: 135, source: 'template', label: 'Typical compressor discharge-temperature limit' },
    'engine-oil': { minWarning: null, minCritical: null, maxWarning: 105, maxCritical: 115, source: 'template', label: 'Typical engine oil temperature limits' },
    coolant: { minWarning: null, minCritical: null, maxWarning: 100, maxCritical: 108, source: 'template', label: 'Typical engine coolant temperature limits' },
};

const VIBRATION_UNITS = new Set(['mm/s', 'in/s']);

/** True when the unit denotes broadband vibration velocity (ISO 20816 applies). */
export function isVibrationUnit(unit: string | null | undefined): boolean {
    return VIBRATION_UNITS.has((unit || '').trim().toLowerCase());
}

/** Short display label for a persisted limit_source value. */
export function limitSourceLabel(source: string | null | undefined): { text: string; tone: 'standard' | 'learned' | 'template' | 'manual' | 'unverified' } {
    if (!source) return { text: 'Unverified — review', tone: 'unverified' };
    if (source.startsWith('iso20816')) {
        const cls = source.replace('iso20816-', '') as MachineClass;
        const z = ISO20816_ZONES[cls];
        return { text: z ? `ISO 20816-3 · ${cls.replace('-', ' ')}` : 'ISO 20816-3', tone: 'standard' };
    }
    if (source === 'learned') return { text: 'Learned baseline', tone: 'learned' };
    if (source === 'template') return { text: 'Class template', tone: 'template' };
    if (source === 'oem') return { text: 'OEM datasheet', tone: 'standard' };
    return { text: 'Manual entry', tone: 'manual' };
}
