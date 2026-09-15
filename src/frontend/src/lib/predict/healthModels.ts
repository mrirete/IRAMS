/**
 * Class-aware health models (Phase 2.2/2.3) — the Health Assessment layer
 * branches on equipment class instead of judging everything like a pump.
 *
 *  - rotating:   vibration-led (ISO 20816 severity is FOR rotating machines)
 *  - static:     integrity-led — wall thickness / corrosion, thermal
 *                performance, pressure; vibration is near-irrelevant
 *  - electrical: thermal-led (hotspots) + load current
 *  - instrument: generic equal weighting (drift/calibration comes later)
 *  - other:      the legacy generic blend, zoning on (harmless when no vib)
 */
import type { PredictEquipmentClass } from './equipmentClass';

export type SensorKind = 'vibration' | 'temperature' | 'pressure' | 'flow' | 'thickness' | 'current' | 'level' | 'other';

/**
 * Classify a sensor/measurement-point into a kind.
 *
 * Three tells, in order of trust:
 *   1. a word in the tag ("Vib Radial", "Bearing Temp") — how points are named
 *      when a person types them into Condition Data;
 *   2. the unit ("A", "°C", "mm/s", "Pa", "t/h") — what a DCS export carries
 *      when the tag is a code (YFJ3_AI, TE_8332A) and says nothing in words;
 *   3. the ISA loop prefix (TE/TT → temperature, PT/PDT → pressure, FT → flow,
 *      LT → level, VT/XT/ZD → vibration, IT → current).
 * Before 2026-09-15 only (1) existed, so every real DCS tag was 'other' and
 * no diagnosis rule could see it.
 */
export function sensorKind(tag: string, unit?: string | null): SensorKind {
    const k = (tag || '').toLowerCase();
    if (k.includes('vib')) return 'vibration';
    if (k.includes('thick') || k.includes('wall') || k.includes('cml')) return 'thickness';
    if (k.includes('temp') || k.includes('thermal')) return 'temperature';
    if (k.includes('press') || k.includes('δp') || k.includes('dp ')) return 'pressure';
    if (k.includes('flow')) return 'flow';
    if (k.includes('current') || k.includes('amp')) return 'current';
    if (k.includes('level')) return 'level';

    const u = (unit || '').trim().toLowerCase().replace(/\s+/g, '');
    if (u) {
        if (/^(a|amp|amps|ka|ma)$/.test(u)) return 'current';
        if (/^(°c|°f|c|f|k|degc|degf|℃)$/.test(u)) return 'temperature';
        if (/^(mm\/s|in\/s|ips|g|grms|mm\/sec)$/.test(u)) return 'vibration';
        if (/^(pa|kpa|mpa|bar|barg|bara|mbar|psi|psig|psia|inh2o|mmh2o|mmwc|kgf\/cm2|kg\/cm²)$/.test(u)) return 'pressure';
        if (/^(n?m³\/h|n?m3\/h|t\/h|kg\/h|kg\/s|l\/min|l\/s|l\/h|gpm|m³\/min|m3\/min|scfm|nm3\/hr|m3\/hr)$/.test(u)) return 'flow';
        if (/^(mm|mils|thou)$/.test(u)) return 'thickness';
    }

    // ISA loop prefix: the letters before the first digit of a loop tag.
    const m = /^([a-z]{1,4})[\s_\-]?\d/i.exec((tag || '').trim());
    if (m) {
        const p = m[1].toUpperCase();
        if (/^T[ETICR]?[A-Z]?$/.test(p)) return 'temperature';
        if (/^PD?[TIC]?[A-Z]?$/.test(p) && !/^PV/.test(p)) return 'pressure';
        if (/^F[TIQC]?[A-Z]?$/.test(p) && !/^FV/.test(p)) return 'flow';
        if (/^L[TICS]?[A-Z]?$/.test(p) && !/^LV/.test(p)) return 'level';
        if (/^(VT|VE|VI|XT|XE|ZD|ZT|ZS)$/.test(p)) return 'vibration';
        if (/^(IT|II|IE)$/.test(p)) return 'current';
    }
    return 'other';
}

export interface ClassHealthModel {
    cls: PredictEquipmentClass;
    label: string;
    /** weight per sensor kind; kinds not listed fall back to `defaultWeight` */
    weights: Partial<Record<SensorKind, number>>;
    defaultWeight: number;
    /** render ISO 10816/20816 vibration zone chips (rotating machinery only) */
    vibrationZoning: boolean;
    /** one-line "what drives health here" shown on the card */
    drivenBy: string;
    /** sub-index groups for the health decomposition, in display order */
    subIndices: { label: string; kinds: SensorKind[] }[];
}

const MODELS: Record<PredictEquipmentClass, ClassHealthModel> = {
    rotating: {
        cls: 'rotating', label: 'Rotating',
        weights: { vibration: 0.35, temperature: 0.30, pressure: 0.20, flow: 0.15 },
        defaultWeight: 0.25,
        vibrationZoning: true,
        drivenBy: 'vibration (ISO 20816) · bearing/winding temperature · process',
        subIndices: [
            { label: 'Mechanical', kinds: ['vibration'] },
            { label: 'Thermal', kinds: ['temperature'] },
            { label: 'Performance', kinds: ['pressure', 'flow'] },
        ],
    },
    static: {
        cls: 'static', label: 'Static',
        // Vibration ≈ ignored: ISO 20816 zones do not apply to a cooler shell.
        weights: { thickness: 0.40, temperature: 0.25, pressure: 0.25, flow: 0.10, vibration: 0.05 },
        defaultWeight: 0.20,
        vibrationZoning: false,
        drivenBy: 'wall thickness / corrosion · thermal performance · pressure',
        subIndices: [
            { label: 'Integrity', kinds: ['thickness'] },
            { label: 'Thermal', kinds: ['temperature'] },
            { label: 'Process', kinds: ['pressure', 'flow', 'level'] },
        ],
    },
    electrical: {
        cls: 'electrical', label: 'Electrical',
        weights: { temperature: 0.45, current: 0.35, vibration: 0.10 },
        defaultWeight: 0.20,
        vibrationZoning: false,
        drivenBy: 'hotspot temperature · load current',
        subIndices: [
            { label: 'Thermal', kinds: ['temperature'] },
            { label: 'Load', kinds: ['current'] },
        ],
    },
    instrument: {
        cls: 'instrument', label: 'Instrument',
        weights: {},
        defaultWeight: 0.25,
        vibrationZoning: false,
        drivenBy: 'reading stability vs alarm bands',
        subIndices: [
            { label: 'Signal', kinds: ['other', 'pressure', 'flow', 'temperature', 'level'] },
        ],
    },
    other: {
        cls: 'other', label: 'General',
        weights: { vibration: 0.35, temperature: 0.30, pressure: 0.20, flow: 0.15 },
        defaultWeight: 0.25,
        vibrationZoning: true,
        drivenBy: 'condition readings vs alarm bands (generic — set Asset Class for class-specific scoring)',
        subIndices: [
            { label: 'Mechanical', kinds: ['vibration'] },
            { label: 'Thermal', kinds: ['temperature'] },
            { label: 'Performance', kinds: ['pressure', 'flow'] },
        ],
    },
};

export function healthModelFor(cls: PredictEquipmentClass): ClassHealthModel {
    return MODELS[cls] ?? MODELS.other;
}
