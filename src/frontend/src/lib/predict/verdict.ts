/**
 * The one-line verdict at the top of an asset's Predict page: what we know,
 * what the history says, and what to do. Built only from numbers the tabs
 * already show, so it can never disagree with them. Every branch says what
 * the evidence is, and the "do" clause is the honest next step — a reading
 * when condition is unknown, work when it is known and bad.
 */
import { STALE_DAYS } from '../../config/predict';

export interface VerdictInput {
    /** Twin health, 0–100; null before the first snapshot. */
    health: number | null;
    /** Days since the newest reading; null when there are none. */
    readingAgeDays: number | null;
    /** Fitted life model, or null when the failure history cannot support one. */
    fitted: { rulDays: number; band50?: { lower: number; upper: number } | null; nFailures: number } | null;
    /** Points breaching a band, and open alerts, on this asset. */
    breaches: number;
    openAlerts: number;
    /** Remaining-life alert window for this criticality (config/predict). */
    windowDays: number;
    now?: Date;
}

export interface Verdict {
    tone: 'ok' | 'watch' | 'act';
    /** The sentence. */
    text: string;
    /** The recommended next step, as a short label for a button. */
    action: 'take_reading' | 'plan_work' | 'set_up' | 'none';
}

export function buildVerdict(i: VerdictInput): Verdict {
    const now = i.now ?? new Date();
    const stale = i.readingAgeDays == null || i.readingAgeDays > STALE_DAYS;
    const condition = i.health == null
        ? 'No health snapshot yet'
        : i.readingAgeDays == null
            ? `Health ${Math.round(i.health)} with no readings behind it`
            : stale
                ? `Condition unknown (last reading ${Math.floor(i.readingAgeDays)} days ago)`
                : i.breaches > 0
                    ? `${i.breaches} point${i.breaches > 1 ? 's' : ''} breaching a band, health ${Math.round(i.health)}`
                    : `Condition fine today, health ${Math.round(i.health)}`;

    const f = i.fitted;
    const soon = !!f && f.rulDays <= i.windowDays;
    const on = f ? new Date(now.getTime() + f.rulDays * 86_400_000).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
    const history = f
        ? soon
            ? `History says it is due: expected failure in ~${Math.round(f.rulDays)} days (${on}${f.band50 ? `, half the odds within ${Math.round(f.band50.lower)}–${Math.round(f.band50.upper)} days` : ''}).`
            : `History gives ~${Math.round(f.rulDays)} days of expected life (${f.nFailures} recorded failures).`
        : 'No fitted life model yet (needs 2 recorded failures).';

    if (i.health == null && i.readingAgeDays == null) {
        return { tone: 'watch', text: `${condition}. ${history} Set up monitoring so Predict has something to judge.`, action: 'set_up' };
    }
    if (soon && stale) {
        return { tone: 'act', text: `${condition}. ${history} Take a reading this week, then plan the work before ${on}.`, action: 'take_reading' };
    }
    if (soon) {
        return { tone: 'act', text: `${condition}. ${history} Plan the work before ${on}.`, action: 'plan_work' };
    }
    if (i.breaches > 0 || i.openAlerts > 0) {
        const what = [i.breaches > 0 ? `${i.breaches} breach${i.breaches > 1 ? 'es' : ''}` : null, i.openAlerts > 0 ? `${i.openAlerts} open alert${i.openAlerts > 1 ? 's' : ''}` : null].filter(Boolean).join(' and ');
        return { tone: 'watch', text: `${condition}. ${history} Work the ${what} in Forecast.`, action: 'plan_work' };
    }
    if (stale) {
        return { tone: 'watch', text: `${condition}. ${history} Take a reading to bring the picture up to date.`, action: 'take_reading' };
    }
    return { tone: 'ok', text: `${condition}. ${history} Nothing to do now.`, action: 'none' };
}
