/**
 * Remaining-life alert (alert_type 'rul_warning' — in the schema since 0074,
 * never raised until now).
 *
 * Raised only from a FITTED life model (censored Weibull on the asset's own
 * failure history). The heuristic estimate exists for every asset, so alerting
 * on it would page the whole plant. The window scales with criticality
 * (config/predict RUL_ALERT_WINDOW_DAYS); severity tightens as the life runs
 * out. One open alert per asset — the caller dedupes.
 */
import { RUL_ALERT_WINDOW_DAYS, STALE_DAYS } from '../../config/predict';

export interface RulAlertInput {
    assetTag: string;
    criticality?: string | null;
    rulDays: number;
    /** 50 % band of the conditional remaining life, days. */
    band50?: { lower: number; upper: number } | null;
    beta: number;
    etaHours: number;
    nFailures: number;
    ageDays: number;
    /** Days since the newest reading — null when there are no readings. */
    readingAgeDays?: number | null;
    now?: Date;
}

export interface RulAlertDraft {
    severity: 'high' | 'medium';
    title: string;
    description: string;
    windowDays: number;
}

export function rulAlertWindowDays(criticality?: string | null): number {
    const c = String(criticality ?? '').trim().toUpperCase();
    return RUL_ALERT_WINDOW_DAYS[c] ?? RUL_ALERT_WINDOW_DAYS.default;
}

/** null = remaining life is outside the window for this criticality. */
export function rulAlertDraft(i: RulAlertInput): RulAlertDraft | null {
    const windowDays = rulAlertWindowDays(i.criticality);
    if (!(i.rulDays <= windowDays)) return null;
    const now = i.now ?? new Date();
    const on = new Date(now.getTime() + i.rulDays * 86_400_000).toLocaleDateString([], { day: 'numeric', month: 'short' });
    const band = i.band50 ? ` Half of such pumps fail between ${Math.round(i.band50.lower)} and ${Math.round(i.band50.upper)} days from now.` : '';
    const wear = i.beta >= 4 ? 'a regular wear-out pattern' : i.beta > 1 ? 'a wear-out pattern' : 'an early-life failure pattern';
    const stale = i.readingAgeDays == null
        ? ' There are no condition readings to confirm or contradict this.'
        : i.readingAgeDays > STALE_DAYS
            ? ` The newest condition reading is ${Math.floor(i.readingAgeDays)} days old, so its condition today is unknown — take a reading before planning.`
            : '';
    return {
        severity: i.rulDays <= 7 ? 'high' : 'medium',
        windowDays,
        title: `Remaining life ${Math.round(i.rulDays)} days (fitted life model): ${i.assetTag}`,
        description:
            `Expected to fail around ${on}: ${i.ageDays} days since the last failure, against ${wear} fitted to ${i.nFailures} recorded failures ` +
            `(β ${i.beta}, η ${Math.round(i.etaHours / 24)} days).${band}${stale}`,
    };
}
