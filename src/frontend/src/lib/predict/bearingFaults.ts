/**
 * Rolling-element bearing fault frequencies (BPFO / BPFI / BSF / FTF) —
 * closes the "compare against BPFO/BPFI manually" gap in spectral.ts.
 *
 * Pure math, no I/O. A bearing can be specified three ways, in order of
 * fidelity:
 *   1. geometry  — ball count, ball Ø, pitch Ø, contact angle (kinematic formulas)
 *   2. orders    — fault multipliers straight from the manufacturer datasheet
 *   3. ballCount — approximate screening orders (BPFO ≈ 0.4·n, BPFI ≈ 0.6·n)
 * Every result carries its `basis` so downstream findings stay honest about
 * which one produced it.
 */

// ─── Specs ───────────────────────────────────────────────────

export interface BearingGeometry {
    ballCount: number;
    ballDiameterMm: number;
    pitchDiameterMm: number;
    /** degrees; 0 for deep-groove */
    contactAngleDeg?: number;
}

/** Fault multipliers in shaft orders (× running speed), as datasheets publish them. */
export interface BearingOrders {
    bpfo: number;
    bpfi: number;
    bsf?: number;
    ftf?: number;
}

/** Stored per asset under assets.properties.predict.bearings[]. */
export interface BearingSpec {
    /** e.g. "DE", "NDE", "gearbox input" */
    position?: string;
    /** e.g. "6205" */
    designation?: string;
    geometry?: BearingGeometry;
    orders?: BearingOrders;
    /** geometry/orders absent — screening approximation from ball count only */
    ballCount?: number;
    /** provenance of the numbers, shown in the UI */
    source?: 'datasheet' | 'catalog-typical' | 'approximate';
}

// ─── Fault frequencies ───────────────────────────────────────

export type BearingRace = 'BPFO' | 'BPFI' | 'BSF' | 'FTF';

export const RACE_LABELS: Record<BearingRace, string> = {
    BPFO: 'outer race (BPFO)',
    BPFI: 'inner race (BPFI)',
    BSF: 'rolling element (BSF)',
    FTF: 'cage (FTF)',
};

export interface BearingFaultFrequencies {
    designation?: string;
    position?: string;
    basis: 'geometry' | 'orders' | 'approximate';
    /** shaft orders (× running speed) */
    orders: { bpfo: number; bpfi: number; bsf: number | null; ftf: number | null };
    /** Hz at the given shaft speed */
    hz: { bpfo: number; bpfi: number; bsf: number | null; ftf: number | null };
}

/** Screening approximation when only the ball count is known (classic rule of thumb). */
export function approxOrders(ballCount: number): BearingOrders {
    return { bpfo: 0.4 * ballCount, bpfi: 0.6 * ballCount };
}

/** Kinematic fault orders from geometry. */
export function geometryOrders(g: BearingGeometry): BearingOrders {
    const n = g.ballCount;
    const ratio = (g.ballDiameterMm / g.pitchDiameterMm) * Math.cos(((g.contactAngleDeg ?? 0) * Math.PI) / 180);
    return {
        ftf: 0.5 * (1 - ratio),
        bpfo: (n / 2) * (1 - ratio),
        bpfi: (n / 2) * (1 + ratio),
        bsf: (g.pitchDiameterMm / (2 * g.ballDiameterMm)) * (1 - ratio * ratio),
    };
}

/**
 * Resolve a spec to fault frequencies at a shaft speed. Returns null when the
 * spec has nothing usable or the shaft speed is unknown/invalid.
 */
export function faultFrequencies(spec: BearingSpec, shaftHz: number | null): BearingFaultFrequencies | null {
    if (!shaftHz || !(shaftHz > 0)) return null;

    let orders: BearingOrders | null = null;
    let basis: BearingFaultFrequencies['basis'];
    if (spec.geometry && spec.geometry.ballCount > 0 && spec.geometry.ballDiameterMm > 0 && spec.geometry.pitchDiameterMm > spec.geometry.ballDiameterMm) {
        orders = geometryOrders(spec.geometry);
        basis = 'geometry';
    } else if (spec.orders && spec.orders.bpfo > 0 && spec.orders.bpfi > 0) {
        orders = spec.orders;
        basis = 'orders';
    } else if (spec.ballCount && spec.ballCount >= 5) {
        orders = approxOrders(spec.ballCount);
        basis = 'approximate';
    } else {
        return null;
    }

    const r2 = (v: number) => Math.round(v * 100) / 100;
    const hz = (o: number | undefined | null) => (o != null ? r2(o * shaftHz) : null);
    return {
        designation: spec.designation,
        position: spec.position,
        basis,
        orders: {
            bpfo: r2(orders.bpfo), bpfi: r2(orders.bpfi),
            bsf: orders.bsf != null ? r2(orders.bsf) : null,
            ftf: orders.ftf != null ? r2(orders.ftf) : null,
        },
        hz: { bpfo: hz(orders.bpfo)!, bpfi: hz(orders.bpfi)!, bsf: hz(orders.bsf), ftf: hz(orders.ftf) },
    };
}

// ─── Envelope-tone matching ──────────────────────────────────

export interface BearingToneMatch {
    race: BearingRace;
    raceLabel: string;
    designation?: string;
    position?: string;
    basis: BearingFaultFrequencies['basis'];
    /** 1 = fundamental, 2/3 = harmonic */
    harmonic: number;
    expectedHz: number;
    /** the envelope tone that matched */
    peakHz: number;
    peakAmplitude: number;
    /** |peak − expected| / expected */
    deviationFrac: number;
    /** BPFI matches: 1×-shaft sidebands found around the tone (inner-race modulation) */
    sidebands?: boolean;
}

interface TonePeak { freqHz: number; amplitude: number }

/**
 * Match envelope-spectrum tones against bearing fault frequencies —
 * fundamentals and 2×/3× harmonics. BSF impacts often show at 2×BSF (both
 * races struck per spin), so BSF is matched at 1×/2×/3× of BSF too.
 * Geometry/datasheet bases use a tight tolerance; the ball-count
 * approximation gets a wider one and its matches should read as hints.
 */
export function matchEnvelopeTones(
    envPeaks: TonePeak[],
    faults: BearingFaultFrequencies[],
    shaftHz: number | null,
    opts: { tolFrac?: number; approxTolFrac?: number; maxHarmonic?: number } = {},
): BearingToneMatch[] {
    const { tolFrac = 0.04, approxTolFrac = 0.1, maxHarmonic = 3 } = opts;
    const matches: BearingToneMatch[] = [];

    for (const f of faults) {
        const tol = f.basis === 'approximate' ? approxTolFrac : tolFrac;
        const races: [BearingRace, number | null][] = [
            ['BPFO', f.hz.bpfo], ['BPFI', f.hz.bpfi], ['BSF', f.hz.bsf], ['FTF', f.hz.ftf],
        ];
        for (const [race, fundHz] of races) {
            if (fundHz == null || fundHz <= 0) continue;
            for (let h = 1; h <= maxHarmonic; h++) {
                const target = fundHz * h;
                let best: TonePeak | null = null;
                let bestDev = Infinity;
                for (const p of envPeaks) {
                    const dev = Math.abs(p.freqHz - target) / target;
                    if (Math.abs(p.freqHz - target) <= Math.max(target * tol, 0.5) && dev < bestDev) {
                        best = p; bestDev = dev;
                    }
                }
                if (!best) continue;
                const m: BearingToneMatch = {
                    race,
                    raceLabel: RACE_LABELS[race],
                    designation: f.designation,
                    position: f.position,
                    basis: f.basis,
                    harmonic: h,
                    expectedHz: Math.round(target * 100) / 100,
                    peakHz: best.freqHz,
                    peakAmplitude: best.amplitude,
                    deviationFrac: Math.round(bestDev * 1000) / 1000,
                };
                if (race === 'BPFI' && shaftHz && shaftHz > 0) {
                    const sb = (side: number) => envPeaks.some(p =>
                        Math.abs(p.freqHz - (target + side * shaftHz)) <= Math.max(target * tol, 0.5));
                    m.sidebands = sb(1) || sb(-1);
                }
                matches.push(m);
            }
        }
    }
    // strongest evidence first: fundamentals before harmonics, then amplitude
    return matches.sort((a, b) => a.harmonic - b.harmonic || b.peakAmplitude - a.peakAmplitude);
}
