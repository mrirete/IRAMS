/**
 * renewal — the fleet repair-vs-replace screening engine (RF-01 item 5).
 *
 * Deterministic, no LLM: ranks assets that are EARNING replacement from the
 * lifecycle-cost view + rates. Every signal names its rule of thumb, every
 * candidate carries its reasons, and the output is explicitly a SCREEN:
 * candidates earn a What-If study; this engine issues no verdicts.
 *
 * Signals (each capped so no single one dominates):
 *  - Maintenance intensity: trailing-12mo maintenance + downtime cost vs
 *    replacement value (fallback: acquisition cost). Rule of thumb: annual
 *    upkeep ≥ 50% of replacement is the classic "stop repairing" line;
 *    scoring starts at 20%.
 *  - Cost trend: 12mo spend vs the 12mo before it (≥ +30% and material).
 *  - Age vs useful life: past asset_financials.useful_life_months.
 *  - Unplanned downtime burden: monetized where a rate exists.
 *  - Criticality amplifies attention (A > B > C/D) — a critical asset earns
 *    its study earlier at the same economics.
 */

export interface LifecycleRow {
    asset_id: string;
    asset_tag: string | null;
    asset_name: string | null;
    criticality: string | null;
    wo_count_lifetime: number;
    maint_cost_lifetime: number;
    maint_cost_12mo: number;
    maint_cost_prior12: number;
    unplanned_downtime_hrs_12mo: number;
    acquisition_cost: number | null;
    acquisition_date: string | null;
    useful_life_months: number | null;
    replacement_value: number | null;
    asset_downtime_rate: number | null;
}

export interface RenewalCandidate {
    assetId: string;
    tag: string;
    name: string;
    criticality: string | null;
    score: number;                 // 0..100 screening score
    reasons: string[];             // every signal that fired, in plain words
    annualCost12mo: number;        // maintenance + monetized downtime (12mo)
    downtimeCost12mo: number | null; // null = no rate configured
    basisValue: number | null;     // replacement_value ?? acquisition_cost
    intensityPct: number | null;   // annualCost / basisValue × 100
    agePctOfLife: number | null;   // age vs useful_life_months × 100
}

const CRIT_FACTOR: Record<string, number> = { A: 1.25, B: 1.1, C: 1.0, D: 0.9 };

export function computeRenewalQueue(
    rows: LifecycleRow[],
    companyDowntimeRate: number | null,
    nowMs: number = Date.now(),
): RenewalCandidate[] {
    const out: RenewalCandidate[] = [];
    for (const r of rows) {
        // No history, nothing to say — the screen works off evidence only.
        if (!r.wo_count_lifetime || r.maint_cost_12mo + r.maint_cost_prior12 <= 0) continue;

        const rate = (r.asset_downtime_rate ?? 0) > 0 ? Number(r.asset_downtime_rate)
            : (companyDowntimeRate ?? 0) > 0 ? Number(companyDowntimeRate) : null;
        const downtimeCost = rate != null ? r.unplanned_downtime_hrs_12mo * rate : null;
        const annualCost = r.maint_cost_12mo + (downtimeCost ?? 0);

        const basis = (Number(r.replacement_value) > 0 ? Number(r.replacement_value) : null)
            ?? (Number(r.acquisition_cost) > 0 ? Number(r.acquisition_cost) : null);

        const reasons: string[] = [];
        let score = 0;

        // 1. Maintenance intensity (0–45 pts, linear 20%→60%+ of basis value).
        let intensityPct: number | null = null;
        if (basis != null && annualCost > 0) {
            intensityPct = (annualCost / basis) * 100;
            if (intensityPct >= 20) {
                score += Math.min(45, ((intensityPct - 20) / 40) * 45);
                reasons.push(`12-month upkeep is ${Math.round(intensityPct)}% of its ${r.replacement_value ? 'replacement value' : 'acquisition cost'} (50%+ is the classic stop-repairing line)`);
            }
        }

        // 2. Cost trend (0–20 pts): ≥+30% year over year, and material money.
        if (r.maint_cost_prior12 > 0 && r.maint_cost_12mo >= r.maint_cost_prior12 * 1.3
            && r.maint_cost_12mo - r.maint_cost_prior12 >= 1000) {
            const growth = r.maint_cost_12mo / r.maint_cost_prior12;
            score += Math.min(20, (growth - 1.3) * 25 + 8);
            reasons.push(`maintenance spend grew ${Math.round((growth - 1) * 100)}% vs the previous 12 months`);
        }

        // 3. Age vs useful life (0–20 pts past 80% of life).
        let agePct: number | null = null;
        if (r.acquisition_date && Number(r.useful_life_months) > 0) {
            const ageMonths = (nowMs - new Date(r.acquisition_date).getTime()) / (30.44 * 86400000);
            agePct = (ageMonths / Number(r.useful_life_months)) * 100;
            if (agePct >= 80) {
                score += Math.min(20, ((agePct - 80) / 40) * 20);
                reasons.push(`${Math.round(agePct)}% through its ${Math.round(Number(r.useful_life_months) / 12)}-year planned life`);
            }
        }

        // 4. Downtime burden (0–15 pts): monetized only when a rate exists.
        if (downtimeCost != null && downtimeCost > 0 && basis != null) {
            const dtPct = (downtimeCost / basis) * 100;
            if (dtPct >= 5) {
                score += Math.min(15, (dtPct / 20) * 15);
                reasons.push(`unplanned downtime cost ≈ ${Math.round(dtPct)}% of asset value this year (rate-based estimate)`);
            }
        } else if (rate == null && r.unplanned_downtime_hrs_12mo >= 24) {
            reasons.push(`${Math.round(r.unplanned_downtime_hrs_12mo)} unplanned downtime hours this year — set a production-loss rate to price this`);
        }

        if (score <= 0) continue;

        score = Math.min(100, score * (CRIT_FACTOR[String(r.criticality ?? '').toUpperCase()] ?? 1));

        out.push({
            assetId: r.asset_id,
            tag: r.asset_tag ?? '—',
            name: r.asset_name ?? r.asset_tag ?? r.asset_id,
            criticality: r.criticality ?? null,
            score: Math.round(score),
            reasons,
            annualCost12mo: Math.round(annualCost),
            downtimeCost12mo: downtimeCost != null ? Math.round(downtimeCost) : null,
            basisValue: basis,
            intensityPct: intensityPct != null ? Math.round(intensityPct) : null,
            agePctOfLife: agePct != null ? Math.round(agePct) : null,
        });
    }
    return out.sort((a, b) => b.score - a.score);
}
