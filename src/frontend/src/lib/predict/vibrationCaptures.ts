/**
 * Saved vibration captures (0206 ers_waveforms) as condition evidence.
 *
 *   captureAlertDraft — a capture whose screening diagnosis says "investigate"
 *     (impulsive AND an envelope tone) opens an alert on its measurement point,
 *     so a route capture reaches the triage queue on its own. "Watch" findings
 *     (a tone without impacting, 1×/2× patterns with no amplitude context) are
 *     trended, not alerted — ISO 13373-1 treats one capture as a data point,
 *     and a trend as the evidence.
 *   captureTrend — kurtosis, RMS and the bearing-tone amplitude across a
 *     point's captures: growing / steady / falling against the earlier median.
 *   repairCheck — the capture that raised an alert vs the first one after the
 *     work was done: did the impacting and the tone go away?
 *
 * Every number is the panel's own, recomputable by hand.
 */
import type { BearingToneMatch } from './bearingFaults';

export interface CaptureFeatures {
    time?: { rms?: number; peak?: number; crest?: number; kurtosis?: number };
    envPeaks?: { freqHz: number; amplitude: number; order?: number }[];
    diagnosis?: { severity?: 'ok' | 'watch' | 'investigate'; findings?: { label: string; detail: string; tone: string }[] };
    bearingMatches?: BearingToneMatch[];
}

export interface CaptureLike {
    tag: string;
    captured_at: string;
    features: CaptureFeatures | Record<string, any> | null;
}

/** Alerts raised from a capture carry this alert_id prefix (the scan uses alt-). */
export const CAPTURE_ALERT_PREFIX = 'vib-';

export const isImpulsive = (t?: CaptureFeatures['time']) => (t?.kurtosis ?? 0) > 4 || (t?.crest ?? 0) > 5;

const namedMatches = (f: CaptureFeatures) => (f.bearingMatches ?? []).filter(m => m.basis !== 'approximate');

/**
 * The measurement point an alert is about. Every Predict alert title ends in
 * ": <point>" — the scan's dedupe has always read it that way.
 */
export const alertPointOf = (title: string) => (title.split(': ').pop() || '').trim();
export const samePoint = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Points that already have an open alert (0391: open = not closed; before 0391, not acknowledged). */
export function openAlertPoints(alerts: { title: string; status?: string | null; acknowledged?: boolean | null }[]): Set<string> {
    return new Set(
        alerts.filter(a => (a.status ? a.status !== 'closed' : !a.acknowledged))
            .map(a => alertPointOf(a.title).toLowerCase())
            .filter(Boolean),
    );
}

export interface CaptureAlertDraft {
    severity: 'high' | 'medium';
    title: string;
    description: string;
    confidence: number;
}

/** null = nothing to alert on (ok or watch). */
export function captureAlertDraft(features: CaptureFeatures | null | undefined, tag: string): CaptureAlertDraft | null {
    const f = features ?? {};
    if (f.diagnosis?.severity !== 'investigate' || !tag.trim()) return null;
    const t = f.time ?? {};
    const named = namedMatches(f);
    const m = named[0];
    const levels = `kurtosis ${t.kurtosis ?? '—'}, crest ${t.crest ?? '—'}, RMS ${t.rms ?? '—'}`;
    if (m) {
        const where = [m.designation, m.position].filter(Boolean).join(' ');
        return {
            severity: 'high',
            title: `Bearing ${m.raceLabel} defect${where ? ` — ${where}` : ''}: ${tag.trim()}`,
            description:
                `Vibration capture on ${tag.trim()}: ${levels}. Envelope tone ${m.peakHz} Hz matches the ${m.raceLabel} ` +
                `frequency (expected ${m.expectedHz} Hz, ${(m.deviationFrac * 100).toFixed(1)}% off${m.harmonic > 1 ? `, ${m.harmonic}× harmonic` : ''}). ` +
                'Screening finding — have a vibration analyst confirm before condemning the bearing (ISO 13373).',
            confidence: 0.85,
        };
    }
    const tone = (f.envPeaks ?? [])[0];
    return {
        severity: 'medium',
        title: `Bearing defect candidate: ${tag.trim()}`,
        description:
            `Vibration capture on ${tag.trim()}: ${levels} — impacting` +
            `${tone ? `, with an envelope tone at ${tone.freqHz} Hz${tone.order != null ? ` (${tone.order}× shaft)` : ''}` : ''}. ` +
            'No bearing on this asset names the tone — add its bearings in Monitoring setup, then compare against BPFO/BPFI. ' +
            'Screening finding — have a vibration analyst confirm (ISO 13373).',
        confidence: 0.7,
    };
}

// ─── Trend across a point's captures ────────────────────────────────────────

export type TrendVerdict = 'growing' | 'steady' | 'falling';
export const MIN_TREND_CAPTURES = 3;
/** Latest ≥ 1.25 × the earlier median = growing; ≤ 0.8 × = falling. */
const GROW = 1.25, FALL = 0.8;

export interface TrendPoint { at: string; rms: number | null; kurtosis: number | null; toneAmp: number | null }
export interface CaptureTrend {
    tag: string;
    points: TrendPoint[];
    /** Only with ≥ MIN_TREND_CAPTURES captures that carry the metric. */
    verdicts: Partial<Record<'rms' | 'kurtosis' | 'toneAmp', TrendVerdict>>;
}

/** Strength of the bearing story in a capture: the named tone if one matched, else the strongest envelope tone. */
export function toneAmplitude(f: CaptureFeatures): number | null {
    const named = namedMatches(f);
    if (named.length > 0) return Math.max(...named.map(m => m.peakAmplitude));
    const top = (f.envPeaks ?? [])[0];
    return top ? top.amplitude : null;
}

const median = (vs: number[]) => {
    const s = [...vs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function trendVerdict(values: (number | null)[]): TrendVerdict | null {
    const vs = values.filter((v): v is number => v != null && Number.isFinite(v));
    if (vs.length < MIN_TREND_CAPTURES) return null;
    const latest = vs[vs.length - 1];
    const base = median(vs.slice(0, -1));
    if (!(base > 0)) return latest > 0 ? 'growing' : 'steady';
    const r = latest / base;
    return r >= GROW ? 'growing' : r <= FALL ? 'falling' : 'steady';
}

export function captureTrend(captures: CaptureLike[], tag: string): CaptureTrend {
    const points = captures
        .filter(c => samePoint(c.tag, tag))
        .sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime())
        .map(c => {
            const f = (c.features ?? {}) as CaptureFeatures;
            const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
            return { at: c.captured_at, rms: num(f.time?.rms), kurtosis: num(f.time?.kurtosis), toneAmp: toneAmplitude(f) };
        });
    const verdicts: CaptureTrend['verdicts'] = {};
    for (const k of ['rms', 'kurtosis', 'toneAmp'] as const) {
        const v = trendVerdict(points.map(p => p[k]));
        if (v) verdicts[k] = v;
    }
    return { tag, points, verdicts };
}

// ─── Did the repair clear it? ────────────────────────────────────────────────

export interface RepairCaptures<C extends CaptureLike> { before: C | null; after: C | null }

/**
 * before = the newest capture on the point up to the alert (the one that
 * raised it is saved seconds earlier); after = the newest capture on the point
 * once the work was done.
 */
export function pickRepairCaptures<C extends CaptureLike>(captures: C[], tag: string, alertCreatedAt: string, workDoneAt: string): RepairCaptures<C> {
    const onPoint = captures.filter(c => samePoint(c.tag, tag))
        .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
    const alertAt = new Date(alertCreatedAt).getTime() + 5 * 60_000;
    const doneAt = new Date(workDoneAt).getTime();
    return {
        before: onPoint.find(c => new Date(c.captured_at).getTime() <= alertAt) ?? null,
        after: onPoint.find(c => new Date(c.captured_at).getTime() > doneAt) ?? null,
    };
}

export interface RepairVerdict {
    verdict: 'no_after' | 'cleared' | 'not_cleared';
    summary: string;
}

export function repairCheck(before: CaptureFeatures | null, after: CaptureFeatures | null): RepairVerdict {
    if (!after) {
        return { verdict: 'no_after', summary: 'No capture on this point since the work was done. Take one to confirm the repair.' };
    }
    const a = after.time ?? {};
    const b = before?.time ?? null;
    const was = (k: 'kurtosis' | 'crest') => (b?.[k] != null ? ` (was ${b[k]})` : '');
    const impulsive = isImpulsive(a);
    const tone = namedMatches(after)[0];
    if (!impulsive && !tone && after.diagnosis?.severity !== 'investigate') {
        return {
            verdict: 'cleared',
            summary: `Looks repaired: kurtosis ${a.kurtosis ?? '—'}${was('kurtosis')}, crest ${a.crest ?? '—'}${was('crest')}, no bearing tone.`,
        };
    }
    const still = [
        impulsive ? `still impulsive — kurtosis ${a.kurtosis ?? '—'}${was('kurtosis')}, crest ${a.crest ?? '—'}${was('crest')}` : null,
        tone ? `envelope tone ${tone.peakHz} Hz still matches the ${tone.raceLabel}` : null,
    ].filter(Boolean).join('; ');
    return { verdict: 'not_cleared', summary: `Not cleared: ${still || 'the capture still screens as "investigate"'}.` };
}
