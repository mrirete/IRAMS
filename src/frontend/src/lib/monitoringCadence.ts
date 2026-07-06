/**
 * recommendMonitoringCadence — criticality- and P-F-driven monitoring cadence (#5).
 *
 * Closes the loop from R-3 asset criticality to a concrete inspection/monitoring
 * frequency. Two bases, most-rigorous-wins:
 *   1. If a P-F interval is known (the time from a detectable potential failure
 *      to functional failure), the RCM rule is to inspect at ≤ half that interval
 *      so at least one inspection lands inside the P-F window.
 *   2. Otherwise fall back to a criticality-based default (A weekly, B monthly,
 *      C quarterly). Criticality also caps the P-F-derived interval so a critical
 *      asset is never monitored more slowly than its class allows.
 *
 * Pure and deterministic — no Math.random, no persistence. The UI narrates it.
 */
export type Criticality = 'A' | 'B' | 'C' | 'D';

export interface CadenceInput {
    criticality?: string | null;
    /** Known P-F interval in days, if the asset carries one. */
    pfIntervalDays?: number | null;
}

export interface CadenceResult {
    intervalDays: number;
    /** Human label: "Weekly", "Monthly", "Every 45 days", … */
    label: string;
    /** Where the number came from — cited, not asserted. */
    basis: string;
    /** true when the interval is derived from a real P-F interval (rigorous). */
    pfDriven: boolean;
}

const CRIT_DEFAULT_DAYS: Record<Criticality, number> = { A: 7, B: 30, C: 90, D: 180 };

function normCriticality(c?: string | null): Criticality {
    const u = (c || '').toString().trim().toUpperCase();
    return u === 'A' || u === 'B' || u === 'C' || u === 'D' ? u : 'B';
}

export function cadenceLabel(days: number): string {
    if (days <= 1) return 'Daily';
    if (days <= 3) return `Every ${days} days`;
    if (days === 7) return 'Weekly';
    if (days <= 10) return `Every ${days} days`;
    if (days === 14) return 'Fortnightly';
    if (days >= 28 && days <= 31) return 'Monthly';
    if (days >= 88 && days <= 92) return 'Quarterly';
    if (days >= 175 && days <= 185) return 'Half-yearly';
    if (days >= 360 && days <= 370) return 'Annually';
    return `Every ${days} days`;
}

export function recommendMonitoringCadence({ criticality, pfIntervalDays }: CadenceInput): CadenceResult {
    const crit = normCriticality(criticality);
    const critDefault = CRIT_DEFAULT_DAYS[crit];

    if (pfIntervalDays != null && pfIntervalDays > 0) {
        const half = Math.max(1, Math.floor(pfIntervalDays / 2));
        const intervalDays = Math.min(half, critDefault);
        const basis = intervalDays === half
            ? `Half the P-F interval (${pfIntervalDays}d) — RCM net-P-F rule`
            : `Criticality ${crit} caps the P-F-derived interval (P-F/2 = ${half}d)`;
        return { intervalDays, label: cadenceLabel(intervalDays), basis, pfDriven: true };
    }

    return {
        intervalDays: critDefault,
        label: cadenceLabel(critDefault),
        basis: `Criticality ${crit} default — set a P-F interval for a physics-based cadence`,
        pfDriven: false,
    };
}
