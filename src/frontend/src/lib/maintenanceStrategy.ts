/**
 * Maintenance strategy packages (SAP strategy plans) — nested cycle absorption.
 *
 * A strategy is a set of packages, each a cycle interval (e.g. 1M / 3M / 6M /
 * 12M) carrying its own task scope. When several packages fall due on the same
 * date, the LONGER cycle absorbs the shorter ones whose interval divides it —
 * you perform the 12-month service (whose scope includes the lower packages)
 * instead of stacking four separate jobs. This is the fix for PM over- and
 * under-maintenance: no duplicate visits, no missed scope.
 */
export interface StrategyPackage {
    id: string;
    label: string;        // "1M", "Quarterly", "Annual"…
    intervalDays: number; // cycle length in days (30, 90, 180, 365…)
    taskCount?: number;   // informational: tasks in this package's scope
}

export interface MaintenanceStrategy {
    id: string;
    name: string;
    packages: StrategyPackage[];
}

export interface ScheduledService {
    /** days from cycle start */
    offsetDays: number;
    date: string;                    // ISO date
    executed: StrategyPackage[];     // packages actually performed (maximal)
    absorbed: StrategyPackage[];     // packages folded into a longer one
}

const addDays = (iso: string, days: number): string => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

/**
 * A package is ABSORBED on a due date when a longer package is also due whose
 * interval is an exact multiple of it (its scope is contained in the longer
 * service). The executed set is the packages not absorbed by any larger one.
 */
export function resolveDue(due: StrategyPackage[]): { executed: StrategyPackage[]; absorbed: StrategyPackage[] } {
    const executed: StrategyPackage[] = [];
    const absorbed: StrategyPackage[] = [];
    for (const p of due) {
        const swallowed = due.some(q => q.intervalDays > p.intervalDays && q.intervalDays % p.intervalDays === 0);
        (swallowed ? absorbed : executed).push(p);
    }
    return { executed, absorbed };
}

/**
 * Generate the absorbed service schedule over a horizon. Each entry is a date
 * on which at least one package is due, with executed vs absorbed resolved.
 */
export function generateSchedule(strategy: MaintenanceStrategy, startISO: string, horizonDays: number): ScheduledService[] {
    const valid = (strategy.packages || []).filter(p => p.intervalDays > 0);
    if (valid.length === 0) return [];
    // Collect every due offset within the horizon.
    const offsets = new Set<number>();
    for (const p of valid) {
        for (let k = 1; p.intervalDays * k <= horizonDays; k++) offsets.add(p.intervalDays * k);
    }
    return [...offsets].sort((a, b) => a - b).map(offsetDays => {
        const due = valid.filter(p => offsetDays % p.intervalDays === 0);
        const { executed, absorbed } = resolveDue(due);
        return { offsetDays, date: addDays(startISO, offsetDays), executed, absorbed };
    });
}

/**
 * Naive count = every package fires on every due date (no absorption).
 * Absorbed count = executed services only. The delta is avoided over-maintenance.
 */
export function absorptionSavings(schedule: ScheduledService[]): { naiveVisits: number; actualVisits: number; absorbedVisits: number } {
    let naive = 0, absorbed = 0;
    for (const s of schedule) { naive += s.executed.length + s.absorbed.length; absorbed += s.absorbed.length; }
    return { naiveVisits: naive, actualVisits: naive - absorbed, absorbedVisits: absorbed };
}

/** Suggested strategy interval set by asset criticality (R-3 → R-5 link). */
export function defaultPackagesForCriticality(criticality?: string): { label: string; intervalDays: number }[] {
    switch ((criticality || '').toUpperCase()) {
        case 'A': return [{ label: '1M', intervalDays: 30 }, { label: '3M', intervalDays: 90 }, { label: '6M', intervalDays: 180 }, { label: '12M', intervalDays: 360 }];
        case 'B': return [{ label: '3M', intervalDays: 90 }, { label: '6M', intervalDays: 180 }, { label: '12M', intervalDays: 360 }];
        case 'C': return [{ label: '6M', intervalDays: 180 }, { label: '12M', intervalDays: 360 }];
        default: return [{ label: '12M', intervalDays: 360 }];
    }
}
