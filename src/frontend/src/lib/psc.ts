/**
 * psc.ts — Potential Success Curve engine.
 *
 * Implements the success-centric metrics from Olorunfemi (2026), "A Success-
 * Centric Evolution of Reliability-Centered Maintenance in Modern Asset
 * Management" (Science, Technology & Public Policy):
 *
 *   Golden Spot — the asset's optimal performance envelope, defined here by the
 *     warning bands of its reading points (min_warning..max_warning per
 *     parameter; critical bands mark Critical Departure).
 *   MTOP   = Σ(time in Golden Spot) / N in-spot periods          (Eq. 1)
 *   MTTRg  = Σ(restoration duration) / N completed restorations  (Eq. 2)
 *   SR     = MTOP / (MTOP + MTTRg) × 100%                        (Eq. 3)
 *   OPE    = SR × PQ × EE                                        (Eq. 4)
 *
 * Pure and deterministic: parameter bands + time-stamped readings in, segments
 * and metrics out. State model: a parameter holds its last observed state until
 * the next reading (step function); the ASSET state at any instant is the worst
 * of its parameters' states (CRITICAL > DRIFT > OPTIMAL). Parameters with no
 * reading yet simply don't constrain the state (coverage is reported so the UI
 * can be honest about it).
 */

export interface GoldenSpotParam {
    id: string;
    name: string;
    minWarning?: number | null;
    maxWarning?: number | null;
    minCritical?: number | null;
    maxCritical?: number | null;
}

export interface ParamReading {
    paramId: string;
    /** epoch ms or ISO string */
    at: number | string;
    value: number;
}

export type ParamState = 'OPTIMAL' | 'DRIFT' | 'CRITICAL';
export type PSCZone = 'GOLDEN_SPOT' | 'SUB_OPTIMAL_DRIFT' | 'CRITICAL_DEPARTURE' | 'UNKNOWN';

export interface PSCSegment {
    start: number;
    end: number;
    state: ParamState;
    /** true when the segment is still running at `now` */
    open: boolean;
}

export interface PSCResult {
    zoneNow: PSCZone;
    /** hours; null when no in-spot period was observed */
    mtopHours: number | null;
    /** hours; null when no completed restoration was observed */
    mttrgHours: number | null;
    /** % per Eq. 3; null when MTOP or MTTRg is unavailable */
    successRate: number | null;
    /** share of observed time spent in the Golden Spot (always available with data) */
    percentTimeInSpot: number | null;
    inSpotPeriods: number;
    completedRestorations: number;
    /** hours the current departure has lasted (null when in spot / unknown) */
    currentDepartureHours: number | null;
    lastRestoredAt: number | null;
    segments: PSCSegment[];
    /** banded params vs those that produced at least one reading in the window */
    coverage: { params: number; paramsWithData: number };
}

/** A parameter is Golden-Spot-relevant only if it has at least one band edge. */
export function isBanded(p: GoldenSpotParam): boolean {
    return [p.minWarning, p.maxWarning, p.minCritical, p.maxCritical]
        .some(v => v !== null && v !== undefined && Number.isFinite(v as number));
}

/** Classify one value against one parameter's bands (NULL bands are not evaluated). */
export function classifyValue(p: GoldenSpotParam, value: number): ParamState {
    const gte = (band: number | null | undefined) => band !== null && band !== undefined && value >= band;
    const lte = (band: number | null | undefined) => band !== null && band !== undefined && value <= band;
    if (gte(p.maxCritical) || lte(p.minCritical)) return 'CRITICAL';
    if (gte(p.maxWarning) || lte(p.minWarning)) return 'DRIFT';
    return 'OPTIMAL';
}

const RANK: Record<ParamState, number> = { OPTIMAL: 0, DRIFT: 1, CRITICAL: 2 };
const worst = (states: Iterable<ParamState>): ParamState => {
    let w: ParamState = 'OPTIMAL';
    for (const s of states) if (RANK[s] > RANK[w]) w = s;
    return w;
};

const toMs = (t: number | string): number => (typeof t === 'number' ? t : new Date(t).getTime());
const HOUR = 3_600_000;

/**
 * Compute the PSC segments + metrics for one asset.
 * @param params    the asset's Golden Spot parameters (unbanded ones are ignored)
 * @param readings  time-stamped values (any order; unknown paramIds ignored)
 * @param now       evaluation instant (epoch ms)
 * @param windowDays lookback horizon; readings before it still seed initial state
 */
export function computePSC(
    params: GoldenSpotParam[],
    readings: ParamReading[],
    now: number,
    windowDays = 90,
): PSCResult {
    const banded = params.filter(isBanded);
    const byId = new Map(banded.map(p => [p.id, p]));
    const windowStart = now - windowDays * 24 * HOUR;

    // Chronological events for known params only.
    const events = readings
        .filter(r => byId.has(r.paramId) && Number.isFinite(r.value))
        .map(r => ({ at: toMs(r.at), paramId: r.paramId, value: r.value }))
        .filter(e => Number.isFinite(e.at) && e.at <= now)
        .sort((a, b) => a.at - b.at);

    const empty: PSCResult = {
        zoneNow: 'UNKNOWN', mtopHours: null, mttrgHours: null, successRate: null,
        percentTimeInSpot: null, inSpotPeriods: 0, completedRestorations: 0,
        currentDepartureHours: null, lastRestoredAt: null, segments: [],
        coverage: { params: banded.length, paramsWithData: 0 },
    };
    if (banded.length === 0 || events.length === 0) return empty;

    // Replay events, building asset-state change points.
    const paramState = new Map<string, ParamState>();
    const changes: { at: number; state: ParamState }[] = [];
    for (const e of events) {
        paramState.set(e.paramId, classifyValue(byId.get(e.paramId)!, e.value));
        const s = worst(paramState.values());
        const last = changes[changes.length - 1];
        if (!last) changes.push({ at: e.at, state: s });
        else if (last.state !== s) changes.push({ at: e.at, state: s });
    }
    const paramsWithData = paramState.size;

    // Observation begins at the first event (no invented history), clipped to window.
    const obsStart = Math.max(changes[0].at, windowStart);
    if (obsStart >= now) return { ...empty, coverage: { params: banded.length, paramsWithData } };

    // Build segments across [obsStart, now].
    const segments: PSCSegment[] = [];
    for (let i = 0; i < changes.length; i++) {
        const segStart = Math.max(changes[i].at, obsStart);
        const segEnd = i + 1 < changes.length ? Math.min(changes[i + 1].at, now) : now;
        if (segEnd <= segStart) continue;
        const prev = segments[segments.length - 1];
        if (prev && prev.state === changes[i].state) { prev.end = segEnd; prev.open = i === changes.length - 1; }
        else segments.push({ start: segStart, end: segEnd, state: changes[i].state, open: i === changes.length - 1 });
    }
    if (segments.length === 0) return { ...empty, coverage: { params: banded.length, paramsWithData } };

    // Collapse to in-spot vs departed intervals.
    type Interval = { start: number; end: number; inSpot: boolean; open: boolean };
    const intervals: Interval[] = [];
    for (const s of segments) {
        const inSpot = s.state === 'OPTIMAL';
        const prev = intervals[intervals.length - 1];
        if (prev && prev.inSpot === inSpot) { prev.end = s.end; prev.open = s.open; }
        else intervals.push({ start: s.start, end: s.end, inSpot, open: s.open });
    }

    const inSpot = intervals.filter(i => i.inSpot);
    // Per the paper, MTOP averages COMPLETED Golden Spot periods (each ended by a
    // departure). If none has completed yet but the asset is currently in spot,
    // the running streak is reported as a provisional MTOP.
    const inSpotClosed = inSpot.filter(i => !i.open);
    const inSpotOpen = inSpot.find(i => i.open) ?? null;
    const departedClosed = intervals.filter(i => !i.inSpot && !i.open);   // completed restorations
    const departedOpen = intervals.find(i => !i.inSpot && i.open) ?? null;

    const hours = (i: Interval) => (i.end - i.start) / HOUR;
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

    const mtop = inSpotClosed.length
        ? sum(inSpotClosed.map(hours)) / inSpotClosed.length
        : inSpotOpen ? hours(inSpotOpen) : null;
    const mttrg = departedClosed.length ? sum(departedClosed.map(hours)) / departedClosed.length : null;
    const successRate = mtop !== null && mttrg !== null ? (mtop / (mtop + mttrg)) * 100 : null;

    const totalObs = sum(intervals.map(hours));
    const percentTimeInSpot = totalObs > 0 ? (sum(inSpot.map(hours)) / totalObs) * 100 : null;

    const last = intervals[intervals.length - 1];
    const zoneNow: PSCZone = last.inSpot
        ? 'GOLDEN_SPOT'
        : segments[segments.length - 1].state === 'CRITICAL' ? 'CRITICAL_DEPARTURE' : 'SUB_OPTIMAL_DRIFT';

    // Last restoration = start of the latest in-spot interval that FOLLOWS a departure.
    let lastRestoredAt: number | null = null;
    for (let i = 1; i < intervals.length; i++) {
        if (intervals[i].inSpot && !intervals[i - 1].inSpot) lastRestoredAt = intervals[i].start;
    }

    return {
        zoneNow,
        mtopHours: mtop,
        mttrgHours: mttrg,
        successRate,
        percentTimeInSpot,
        inSpotPeriods: inSpotClosed.length || (inSpotOpen ? 1 : 0),
        completedRestorations: departedClosed.length,
        currentDepartureHours: departedOpen ? hours(departedOpen) : null,
        lastRestoredAt,
        segments,
        coverage: { params: banded.length, paramsWithData },
    };
}

/**
 * Overall Performance Excellence (Eq. 4): OPE = SR × PQ × EE.
 * PQ/EE are fractions (0..1). Returns null unless BOTH are provided — IREAMS has
 * no production-quality or energy feed yet and we do not fabricate inputs.
 */
export function computeOPE(successRatePct: number | null, pq?: number | null, ee?: number | null): number | null {
    if (successRatePct === null || pq === null || pq === undefined || ee === null || ee === undefined) return null;
    if (!(pq >= 0 && pq <= 1) || !(ee >= 0 && ee <= 1)) return null;
    return (successRatePct / 100) * pq * ee * 100;
}

/** Paper targets: SR ≥90% target, ≥95% world-class; OPE ≥85% target. */
export const PSC_TARGETS = { srTarget: 90, srWorldClass: 95, opeTarget: 85 } as const;
