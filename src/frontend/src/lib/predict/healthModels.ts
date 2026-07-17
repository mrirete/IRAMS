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

/** Classify a sensor/measurement-point tag into a kind (keyword-based, like the engine). */
export function sensorKind(tag: string): SensorKind {
    const k = (tag || '').toLowerCase();
    if (k.includes('vib')) return 'vibration';
    if (k.includes('thick') || k.includes('wall') || k.includes('cml')) return 'thickness';
    if (k.includes('temp') || k.includes('thermal')) return 'temperature';
    if (k.includes('press') || k.includes('δp') || k.includes('dp ')) return 'pressure';
    if (k.includes('flow')) return 'flow';
    if (k.includes('current') || k.includes('amp')) return 'current';
    if (k.includes('level')) return 'level';
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
