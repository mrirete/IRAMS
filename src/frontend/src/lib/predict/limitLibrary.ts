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

// ── Class-aware suggestions from the asset's own operating context (0317) ──
//
// The register now carries rated power, full-load current, insulation class,
// design pressure and so on per ISO 14224 class. Those are exactly the inputs
// the limit standards key on, so the reading-point editor can propose whole
// points — name, unit, bands, citation — instead of asking a technician to
// remember that a 355 kW motor is an ISO 20816-3 Group 1 machine. Pure.

export interface SuggestedPoint {
    name: string;
    category: 'CONDITION' | 'METER';
    unit: string;
    bands: BandSuggestion;
    /** which register value the bands were derived from, for the citation */
    derivedFrom: string;
}

interface ContextLike {
    parameters?: Array<{ key: string; design?: number | string | null; operating?: number | string | null }> | null;
}
interface AssetLike {
    assetClass?: string | null;
    assetCategory?: string | null;
    operatingContext?: ContextLike | null;
}

const num = (v: unknown): number | null => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/** IEC 60085 thermal classes → hotspot limit °C; bands leave margin below it. */
const INSULATION_HOTSPOT: Record<string, number> = { A: 105, E: 120, B: 130, F: 155, H: 180 };

/** Rated power in kW from the context, whichever key the class template used. */
export function ratedPowerKw(ctx: ContextLike | null | undefined): number | null {
    const p = ctx?.parameters || [];
    const byKey = (k: string) => num(p.find(x => x.key === k)?.design);
    const kw = byKey('rated_power');
    if (kw !== null) return kw;
    const mw = byKey('power');
    // GAS_TURBINE / STEAM_TURBINE templates carry power in MW; generators in MVA (≈ kW × 1000 at pf 1)
    if (mw !== null) return mw * 1000;
    const mva = byKey('rating');
    return mva !== null ? mva * 1000 : null;
}

const ROTATING_CLASSES = new Set(['PUMP', 'COMPRESSOR', 'GAS_TURBINE', 'STEAM_TURBINE', 'TURBOEXPANDER', 'COMBUSTION_ENGINE', 'ELECTRIC_MOTOR', 'ELECTRIC_GENERATOR', 'FAN_BLOWER', 'GEARBOX', 'AGITATOR_MIXER', 'ROTATING_OTHER']);

/**
 * Reading points the register can justify for this asset. Every band cites
 * the value it came from; mounting stiffness is not in the register, so
 * vibration assumes rigid mounting and says so — the editor lets the user
 * flip it.
 */
export function suggestPointsForAsset(asset: AssetLike | null | undefined): SuggestedPoint[] {
    if (!asset) return [];
    const cls = String(asset.assetClass || '').toUpperCase();
    const cat = String(asset.assetCategory || '').toUpperCase();
    const params = asset.operatingContext?.parameters || [];
    const design = (k: string) => num(params.find(p => p.key === k)?.design);
    const text = (k: string) => { const v = params.find(p => p.key === k)?.design; return v == null ? '' : String(v).trim(); };
    const out: SuggestedPoint[] = [];
    const isRotating = ROTATING_CLASSES.has(cls) || (!cls && cat === 'ROTATING');

    if (isRotating) {
        const kw = ratedPowerKw(asset.operatingContext);
        const mc = resolveMachineClass((kw ?? 0) > 300, false);
        const v = vibrationBands(mc);
        out.push({
            name: 'Bearing vibration (DE)', category: 'CONDITION', unit: 'mm/s',
            bands: { ...v, label: `${v.label} — ${kw !== null ? `${kw} kW rated (register)` : 'power unknown, medium assumed'}; rigid mounting assumed` },
            derivedFrom: kw !== null ? `rated_power = ${kw} kW` : 'class (rotating)',
        });
        out.push({ name: 'Bearing temperature (DE)', category: 'CONDITION', unit: '°C', bands: TEMPERATURE_BANDS.bearing, derivedFrom: 'class (rotating)' });
    }

    if (cls === 'ELECTRIC_MOTOR' || cls === 'ELECTRIC_GENERATOR') {
        const fla = design('current');
        if (fla !== null && fla > 0) {
            out.push({
                name: 'Stator current', category: 'CONDITION', unit: 'A',
                bands: { minWarning: null, minCritical: null, maxWarning: r1(fla), maxCritical: r1(fla * 1.1), source: 'template', label: `Rated current ${fla} A from the register; 110 % = typical 1.15 service-factor limit (NEMA MG-1) less margin` },
                derivedFrom: `current = ${fla} A`,
            });
        }
        const ic = text('insulation_class').toUpperCase().replace(/[^A-H]/g, '').slice(0, 1);
        const hot = INSULATION_HOTSPOT[ic];
        out.push({
            name: 'Winding temperature', category: 'CONDITION', unit: '°C',
            bands: hot
                ? { minWarning: null, minCritical: null, maxWarning: hot - 35, maxCritical: hot - 15, source: 'template', label: `Insulation class ${ic} (IEC 60085 hotspot ${hot} °C) from the register — warning 35 °C and critical 15 °C below the hotspot limit` }
                : TEMPERATURE_BANDS.winding,
            derivedFrom: hot ? `insulation_class = ${ic}` : 'class (motor)',
        });
    }

    if (cls === 'PUMP' || cls === 'COMPRESSOR' || cls === 'FAN_BLOWER') {
        const dp = design('design_pressure') ?? design('discharge_pressure');
        if (dp !== null && dp > 0) {
            out.push({
                name: 'Discharge pressure', category: 'CONDITION', unit: 'barg',
                bands: { minWarning: null, minCritical: null, maxWarning: r1(dp * 0.9), maxCritical: r1(dp), source: 'template', label: `Design pressure ${dp} barg from the register — warning at 90 %, critical at the design limit` },
                derivedFrom: `design_pressure = ${dp} barg`,
            });
        }
        if (cls === 'COMPRESSOR') {
            out.push({ name: 'Discharge temperature', category: 'CONDITION', unit: '°C', bands: TEMPERATURE_BANDS.discharge, derivedFrom: 'class (compressor)' });
        }
    }

    if (cls === 'COMBUSTION_ENGINE') {
        out.push({ name: 'Lube oil temperature', category: 'CONDITION', unit: '°C', bands: TEMPERATURE_BANDS['engine-oil'], derivedFrom: 'class (engine)' });
        out.push({ name: 'Coolant temperature', category: 'CONDITION', unit: '°C', bands: TEMPERATURE_BANDS.coolant, derivedFrom: 'class (engine)' });
    }

    if (cls === 'TRANSFORMER') {
        out.push({
            name: 'Top-oil temperature', category: 'CONDITION', unit: '°C',
            bands: { minWarning: null, minCritical: null, maxWarning: 85, maxCritical: 105, source: 'template', label: 'IEC 60076-7 loading guide — top-oil 105 °C at rated load; warning 20 °C below' },
            derivedFrom: 'class (transformer)',
        });
        const mva = design('rating');
        if (mva !== null && mva > 0) {
            out.push({
                name: 'Load', category: 'CONDITION', unit: '%',
                bands: { minWarning: null, minCritical: null, maxWarning: 100, maxCritical: 120, source: 'template', label: `Rated ${mva} MVA from the register — 100 % rated, 120 % short-time emergency (IEC 60076-7)` },
                derivedFrom: `rating = ${mva} MVA`,
            });
        }
    }

    if (isRotating || cls === 'TRANSFORMER' || cls === 'HEAT_EXCHANGER' || cls === 'PRESSURE_VESSEL') {
        out.push({ name: 'Running hours', category: 'METER', unit: 'hours', bands: { minWarning: null, minCritical: null, maxWarning: null, maxCritical: null, source: 'template', label: 'Meter — no alarm bands' }, derivedFrom: 'class' });
    }
    return out;
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
