/**
 * Ready for a reliability study? — what is in the register, judged by what
 * the analysis tools actually read.
 *
 * The Migration Center used to tick a phase green when anything landed. That
 * answers "did something import", not "can a study run". Each tool reads
 * specific tables (traced, not assumed): Weibull, MTBF, Monte Carlo and PM
 * optimisation read WORK ORDERS; Predict, RCM's monitoring reality and the
 * assessment read READING points and logs; the money-ranked findings read the
 * COST columns on work orders; failure codes are what turn "coded" history
 * into named failure modes. So readiness is per ingredient, each with what it
 * unlocks and where to get it — and the verdict says which studies can run
 * today, not a percentage.
 *
 * Pure: counts in, judgement out. Nothing here reads the database.
 */

export interface ReadinessCounts {
    assets: number;
    workOrders: number;
    /** Work orders carrying any actual or frozen cost. */
    workOrdersWithCost: number;
    /** Work orders flagged as breakdowns (the failure indicator the predicate prefers). */
    breakdowns: number;
    readings: number;
    readingPoints: number;
    pms: number;
    codes: number;
}

export type IngredientKey = 'register' | 'failures' | 'cost' | 'condition' | 'schedules' | 'codes';
export type IngredientStatus = 'ready' | 'partial' | 'missing';

export interface Ingredient {
    key: IngredientKey;
    label: string;
    /** What is there, in words a planner uses. */
    have: string;
    status: IngredientStatus;
    /** What this ingredient makes possible — the reason to bother. */
    unlocks: string;
    /** Why the status is what it is, when it is not simply ready. */
    because?: string;
    /** Where to get it. */
    action: { label: string; to: string };
}

export interface StudyReadiness {
    ingredients: Ingredient[];
    /** Analyses that can run on what is here today. */
    canRun: string[];
    /** Analyses that cannot, and the ingredient each is waiting on. */
    blocked: { study: string; needs: string }[];
    /** One line for the top of the checklist. */
    verdict: string;
}

/** Below this many failure events a Weibull fit is a guess with a decimal point. */
const MIN_FAILURES_FOR_FIT = 10;
/**
 * A trend needs a few points to draw a line through: below this many readings
 * per point on average, the points exist but nothing can be trended yet.
 * (Predict's alarm baselines want more — MIN_BASELINE_READINGS per point.)
 */
const MIN_READINGS_PER_POINT = 3;
/** Below this share of costed orders, money-ranked findings mislead more than they inform. */
const MIN_COST_COVERAGE = 0.5;

const n = (v: number) => v.toLocaleString();

export function studyReadiness(c: ReadinessCounts, routes: Partial<Record<IngredientKey, string>> = {}): StudyReadiness {
    const to = (k: IngredientKey, fallback: string) => routes[k] ?? fallback;
    const costShare = c.workOrders > 0 ? c.workOrdersWithCost / c.workOrders : 0;

    const ingredients: Ingredient[] = [
        {
            key: 'register', label: 'Asset register',
            have: c.assets > 0 ? `${n(c.assets)} assets` : 'nothing yet',
            status: c.assets > 0 ? 'ready' : 'missing',
            unlocks: 'Everything else attaches to it — history, readings and schedules all name an asset.',
            because: c.assets > 0 ? undefined : 'Import this first: history loaded before the register creates flat assets the hierarchy can never absorb.',
            action: { label: 'Import the register', to: to('register', '/admin/migration#register') },
        },
        {
            key: 'failures', label: 'Failure history',
            have: c.workOrders > 0 ? `${n(c.workOrders)} work orders${c.breakdowns > 0 ? `, ${n(c.breakdowns)} flagged as breakdowns` : ''}` : 'no work orders',
            status: c.workOrders === 0 ? 'missing' : c.workOrders < MIN_FAILURES_FOR_FIT ? 'partial' : 'ready',
            unlocks: 'Weibull fits, MTBF and MTTR, Monte Carlo, PM optimisation, bad-actor ranking.',
            because: c.workOrders === 0 ? 'The failure-analysis tools read work orders — with none loaded they have nothing to fit.'
                : c.workOrders < MIN_FAILURES_FOR_FIT ? `Fewer than ${MIN_FAILURES_FOR_FIT} events: a fit will run but its confidence bounds will be wide.`
                : c.breakdowns === 0 ? 'No order carries a breakdown flag, so failures are inferred from the work type. Export the breakdown indicator with the history (SAP PM: MSAUS; Maximo: failure class) and MTBF becomes exact.' : undefined,
            action: { label: 'Import work-order history', to: to('failures', '/specialist/import') },
        },
        {
            key: 'cost', label: 'Cost on work orders',
            have: c.workOrders > 0 ? `${n(c.workOrdersWithCost)} of ${n(c.workOrders)} orders carry cost` : 'no work orders',
            status: c.workOrders === 0 ? 'missing' : costShare >= MIN_COST_COVERAGE ? 'ready' : c.workOrdersWithCost > 0 ? 'partial' : 'missing',
            unlocks: 'Money-ranked findings, cost of unreliability, the value case for each recommendation.',
            because: c.workOrders > 0 && costShare < MIN_COST_COVERAGE
                ? 'Export the cost columns with the history (the actual labour and material cost on each order) — findings are ranked by money, and orders without cost rank as free.'
                : undefined,
            action: { label: 'Re-import history with cost columns', to: to('cost', '/specialist/import') },
        },
        {
            key: 'condition', label: 'Condition history',
            have: c.readingPoints > 0 || c.readings > 0 ? `${n(c.readingPoints)} reading point${c.readingPoints === 1 ? '' : 's'}, ${n(c.readings)} reading${c.readings === 1 ? '' : 's'}` : 'no readings',
            status: c.readings === 0 ? (c.readingPoints > 0 ? 'partial' : 'missing')
                : c.readings >= MIN_READINGS_PER_POINT * Math.max(c.readingPoints, 1) ? 'ready' : 'partial',
            unlocks: 'Predict trends and alarms, condition-based RCM decisions, P–F interval evidence.',
            because: c.readings === 0 && c.readingPoints > 0 ? 'Points exist but carry no readings yet — trends need history.'
                : c.readings === 0 ? 'Predict and RCM read reading points and their logs.'
                : c.readings < MIN_READINGS_PER_POINT * Math.max(c.readingPoints, 1)
                    ? `Too few readings to trend — a point needs at least ${MIN_READINGS_PER_POINT} before a line can be drawn through it. Load the measurement history, or connect a feed.`
                    : undefined,
            action: { label: 'Import measuring points and readings', to: to('condition', '/admin/migration/cockpit') },
        },
        {
            key: 'schedules', label: 'Current PM programme',
            have: c.pms > 0 ? `${n(c.pms)} schedules` : 'no schedules',
            status: c.pms > 0 ? 'ready' : 'missing',
            unlocks: 'What the plant does today — the baseline every study compares against, and what a sent-back strategy changes.',
            because: c.pms > 0 ? undefined : 'Without it a study can say what to do, but not what to stop doing.',
            action: { label: 'Import plans and task lists', to: to('schedules', '/admin/migration/cockpit') },
        },
        {
            key: 'codes', label: 'Failure-code catalogue',
            have: c.codes > 0 ? `${n(c.codes)} codes` : 'no catalogue',
            status: c.codes > 0 ? 'ready' : c.workOrders > 0 ? 'partial' : 'missing',
            unlocks: 'Failure modes by name — Pareto by mode and cause instead of by code.',
            because: c.codes > 0 ? undefined : 'Imported history keeps codes as written; without the catalogue they count as coded but decode to nothing.',
            action: { label: 'Import the catalogue', to: to('codes', '/admin/migration#codes') },
        },
    ];

    const status = (k: IngredientKey) => ingredients.find(i => i.key === k)!.status;
    const canRun: string[] = [];
    const blocked: { study: string; needs: string }[] = [];
    const judge = (study: string, ok: boolean, needs: string) => (ok ? canRun.push(study) : blocked.push({ study, needs }));

    judge('Weibull and MTBF', status('register') === 'ready' && status('failures') !== 'missing', 'failure history');
    judge('PM optimisation', status('register') === 'ready' && status('failures') !== 'missing' && status('schedules') === 'ready', status('schedules') === 'ready' ? 'failure history' : 'the current PM programme');
    judge('Predict and condition-based RCM', status('register') === 'ready' && status('condition') === 'ready', 'condition history');
    judge('Money-ranked findings', status('failures') !== 'missing' && status('cost') === 'ready', status('failures') === 'missing' ? 'failure history' : 'cost on work orders');
    judge('Failure-mode Pareto', status('failures') !== 'missing' && status('codes') === 'ready', status('failures') === 'missing' ? 'failure history' : 'the failure-code catalogue');

    const verdict = status('register') !== 'ready'
        ? 'Start with the asset register — nothing can run without it.'
        : canRun.length === 0
            ? 'The register is in. Failure history is the next thing every analysis is waiting on.'
            : blocked.length === 0
                ? 'Everything a study needs is here.'
                : `${canRun.length} of ${canRun.length + blocked.length} analyses can run today — ${blocked[0].study.charAt(0).toLowerCase()}${blocked[0].study.slice(1)} is waiting on ${blocked[0].needs}.`;

    return { ingredients, canRun, blocked, verdict };
}
