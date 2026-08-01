/**
 * assessmentQuickWins — the "so what do I DO?" line under every chart.
 *
 * The assessment report illustrates ten kinds of finding. A chart tells you the
 * magnitude; it does not tell you what to touch on Monday. This module turns
 * each section's already-computed numbers into at most three concrete actions,
 * each carrying the figure that justifies it and a destination in the modules
 * where the work actually happens.
 *
 * Rules this file keeps:
 *  - Nothing is derived from the narrator's prose. Every figure here comes from
 *    the deterministic engine (eam/services/assessmentEngine), same as the charts.
 *  - No finding, no win. An empty section produces an empty list rather than a
 *    generic "review your data" filler — advice nobody can act on is noise.
 *  - A destination is emitted only when it LANDS somewhere useful and scoped.
 *    Every path here is asserted against the real route table and the
 *    destination's own query handling by lib/handoffContract.test.ts.
 *
 * Money stays numeric (`value`) — currency formatting belongs to the settings
 * context, not to the engine.
 */
import type { Assessment } from '../eam/services/assessmentEngine';
import type { StrategyVerdict } from './strategySelect';

export type WinSection =
    | 'badActors' | 'weibull' | 'warranty' | 'pmWaste' | 'strategy'
    | 'workforce' | 'success' | 'spares' | 'register' | 'dataQuality';

export interface QuickWin {
    /** Stable across recomputes — also the mission-progress key. */
    id: string;
    section: WinSection;
    /** The action, imperative, one line. */
    text: string;
    /** The evidence behind it, in the reader's language. */
    basis: string;
    /** Money at stake where the engine can name one; else null. */
    value: number | null;
    /** Where the work happens. Null = no destination worth sending anyone to. */
    path: string | null;
    /** Button text — the module, named the way the sidebar names it. */
    label: string | null;
    /** Asset tags this win concerns; travels with the mission handoff. */
    tags: string[];
}

/** Only the parts of an assessment the wins are derived from. */
export type QuickWinSource = Pick<Assessment,
    | 'badActors' | 'weibull' | 'warranty' | 'pmWaste' | 'strategy' | 'success'
    | 'spares' | 'skills' | 'register' | 'coverage' | 'assetIndex'>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Open the Create Work Order modal already seeded with the asset and a title. */
const createWo = (assetId: string, title: string) =>
    `/work-orders?action=create&asset=${encodeURIComponent(assetId)}&title=${encodeURIComponent(title)}`;

/** The WO list, pre-searched to one asset. */
const woList = (tag: string) => `/work-orders?asset=${encodeURIComponent(tag)}`;

const REGIME_ACTION: Record<StrategyVerdict['recommended'], { verb: string; label: string; path: (v: StrategyVerdict) => string }> = {
    fixed_interval: {
        verb: 'Put an age-based PM on',
        label: 'PM schedules',
        path: () => '/recurring-work',
    },
    condition_based: {
        verb: 'Put condition monitoring on',
        label: 'Condition data',
        path: () => '/readings',
    },
    defect_elimination: {
        verb: 'Raise a defect-elimination task for',
        label: 'Analyze',
        path: (v) => `/analyze?tab=defect_elimination&asset=${encodeURIComponent(v.assetId)}`,
    },
    rcm_study: {
        verb: 'Open an RCM study on',
        label: 'Analyze',
        path: () => '/analyze',
    },
    run_to_failure: {
        verb: 'Record deliberate run-to-failure for',
        label: 'Asset register',
        path: () => '/assets',
    },
};

/**
 * Every section's quick wins, keyed by section. Sections with nothing to act on
 * are absent from the map (not present with an empty array) so callers can use
 * `wins[section]` directly.
 */
export function computeQuickWins(a: QuickWinSource): Partial<Record<WinSection, QuickWin[]>> {
    const idByTag = new Map(a.assetIndex.map((x) => [x.tag, x.id]));
    const out: Partial<Record<WinSection, QuickWin[]>> = {};
    const put = (section: WinSection, wins: QuickWin[]) => {
        const kept = wins.slice(0, 3);
        if (kept.length) out[section] = kept;
    };

    // ── Bad actors: the vital few, and the repeat offender among them ──────
    // The vital few = up to the 80% cumulative line, capped at two. Below that
    // line the next asset is noise, and a "quick win" on noise is not one.
    const vitalFew = a.badActors.filter((b, i) => i === 0 || b.cumulativePct <= 80).slice(0, 2);
    const badActorWins: QuickWin[] = [];
    for (const b of vitalFew) {
        badActorWins.push({
            id: `bad-actor:${b.tag}`,
            section: 'badActors',
            text: `Work down the open jobs on ${b.tag}`,
            basis: `${plural(b.woCount12mo, 'work order')} and ${plural(b.cmCount12mo, 'failure')} in 12 months · ${b.cumulativePct}% of spend cumulative`,
            value: b.cost12mo,
            path: woList(b.tag),
            label: 'Work orders',
            tags: [b.tag],
        });
    }
    const repeat = vitalFew.find((b) => b.cmCount12mo >= 3);
    if (repeat && idByTag.get(repeat.tag)) {
        badActorWins.push({
            id: `bad-actor-rca:${repeat.tag}`,
            section: 'badActors',
            text: `Open an RCA on ${repeat.tag}'s repeat failures`,
            basis: `${plural(repeat.cmCount12mo, 'corrective event')} on one asset is a cause worth naming, not a run of bad luck`,
            value: null,
            path: `/analyze?tab=rca&asset=${encodeURIComponent(idByTag.get(repeat.tag) as string)}`,
            label: 'Analyze',
            tags: [repeat.tag],
        });
    }
    put('badActors', badActorWins);

    // ── Weibull: the β decides the action, not the cost ────────────────────
    const weibullWins: QuickWin[] = [];
    for (const w of [...a.weibull].sort((x, y) => y.beta - x.beta)) {
        if (w.beta >= 1.5 && w.b10Days > 0) {
            weibullWins.push({
                id: `weibull-pm:${w.tag}`,
                section: 'weibull',
                text: `Set an age-based PM on ${w.tag} near its B10 life (${w.b10Days} days)`,
                basis: `β ${w.beta.toFixed(2)} — failure probability grows with age, so an interval genuinely removes risk (R²=${w.r2})`,
                value: null,
                path: '/recurring-work',
                label: 'PM schedules',
                tags: [w.tag],
            });
        } else if (w.beta < 1) {
            weibullWins.push({
                id: `weibull-de:${w.tag}`,
                section: 'weibull',
                text: `Fix installation and workmanship on ${w.tag} — do not add PM`,
                basis: `β ${w.beta.toFixed(2)} — early-life failures. More frequent PM makes this pattern worse, not better`,
                value: null,
                path: idByTag.get(w.tag)
                    ? `/analyze?tab=defect_elimination&asset=${encodeURIComponent(idByTag.get(w.tag) as string)}`
                    : '/analyze?tab=defect_elimination',
                label: 'Analyze',
                tags: [w.tag],
            });
        } else {
            weibullWins.push({
                id: `weibull-cbm:${w.tag}`,
                section: 'weibull',
                text: `Monitor ${w.tag} on condition rather than on a calendar`,
                basis: `β ${w.beta.toFixed(2)} — failures are effectively random, so a fixed interval buys no risk reduction`,
                value: null,
                path: '/readings',
                label: 'Condition data',
                tags: [w.tag],
            });
        }
    }
    put('weibull', weibullWins);

    // ── Warranty: money already spent that someone else owed ───────────────
    if (a.warranty.total > 0 && a.warranty.items.length) {
        const top = a.warranty.items[0];
        put('warranty', [{
            id: 'warranty-claim',
            section: 'warranty',
            text: `Raise OEM claims on the ${plural(a.warranty.items.length, 'in-warranty job')} below`,
            basis: `Largest single item: ${top.tag} on ${top.date}. Start there — the claim window closes with the warranty`,
            value: a.warranty.total,
            path: woList(top.tag),
            label: 'Work orders',
            tags: [...new Set(a.warranty.items.slice(0, 3).map((i) => i.tag))],
        }]);
    }

    // ── PM programme: the verdict is the instruction ───────────────────────
    const PM_ACTION: Record<string, (p: Assessment['pmWaste'][number]) => { text: string; basis: string }> = {
        ineffective: (p) => ({
            text: `Revise or retire ${p.code} on ${p.tag}`,
            basis: `${plural(p.failures12mo, 'failure')} in 12 months despite the programme running — it is not preventing anything`,
        }),
        redundant: (p) => ({
            text: `Retire ${p.code} on ${p.tag}`,
            basis: 'Duplicated by another active programme on the same asset — pure cost, no extra protection',
        }),
        over_maintenance: (p) => ({
            text: `Extend the interval on ${p.code} (${p.tag})`,
            basis: `${p.annualEvents ?? '—'} services a year against ${plural(p.failures12mo, 'failure')} — the frequency is buying labour, not reliability`,
        }),
        under_maintenance: (p) => ({
            text: `Tighten the interval on ${p.code} (${p.tag})`,
            basis: `${plural(p.failures12mo, 'failure')} between services — the asset is failing inside its own PM cycle`,
        }),
    };
    const pmOrder = ['ineffective', 'redundant', 'over_maintenance', 'under_maintenance'];
    put('pmWaste', [...a.pmWaste]
        .sort((x, y) => pmOrder.indexOf(x.category) - pmOrder.indexOf(y.category))
        .map((p): QuickWin => {
            const copy = (PM_ACTION[p.category] ?? PM_ACTION.ineffective)(p);
            return {
                id: `pm:${p.code}:${p.tag}`,
                section: 'pmWaste',
                ...copy,
                value: null,
                path: '/recurring-work',
                label: 'PM schedules',
                tags: [p.tag],
            };
        }));

    // ── Strategy: close the worst coverage gaps on critical assets ─────────
    put('strategy', a.strategy.gaps.slice(0, 3).map((v): QuickWin => {
        const act = REGIME_ACTION[v.recommended];
        return {
            id: `strategy:${v.assetId}`,
            section: 'strategy',
            text: `${act.verb} ${v.tag}${v.recommendedIntervalDays ? ` — every ${v.recommendedIntervalDays} days` : ''}`,
            basis: `Criticality ${v.criticality ?? '—'} · ${v.hasActivePm ? 'has a PM' : 'no PM'}, ${v.isMonitored ? 'monitored' : 'not monitored'} today. ${v.basis}`,
            value: v.cmCost12mo > 0 ? v.cmCost12mo : null,
            path: act.path(v),
            label: act.label,
            tags: [v.tag],
        };
    }));

    // ── Success layer: assets outside their operating band right now ───────
    const departed = a.success.worst.filter((r) => r.zoneNow === 'CRITICAL_DEPARTURE' || r.zoneNow === 'SUB_OPTIMAL_DRIFT');
    put('success', departed.slice(0, 2).map((r): QuickWin => ({
        id: `success:${r.assetId}`,
        section: 'success',
        text: `Raise a job to bring ${r.tag} back inside its band`,
        basis: r.currentDepartureHours != null
            ? `${r.currentDepartureHours}h outside the optimum now · ${r.percentTimeInSpot ?? '—'}% of the last 90 days in the Golden Spot`
            : `Only ${r.percentTimeInSpot ?? '—'}% of the last 90 days spent in the Golden Spot`,
        value: null,
        path: createWo(r.assetId, `Restore ${r.tag} to its operating band`),
        label: 'Work orders',
        tags: [r.tag],
    })));

    // ── Spares: the part the criticals already needed once ─────────────────
    const bySeverity = (s: string) => (s === 'stockout' ? 0 : s === 'below_min' ? 1 : 2);
    put('spares', [...a.spares.exposures]
        .sort((x, y) => bySeverity(x.severity) - bySeverity(y.severity))
        .slice(0, 2)
        .map((e): QuickWin => ({
            id: `spare:${e.itemId ?? e.label}`,
            section: 'spares',
            text: e.severity === 'unknown_stock'
                ? `Add ${e.label} to the stock records`
                : `Replenish ${e.label}`,
            basis: e.severity === 'unknown_stock'
                ? `Consumed ${e.uses}× on ${e.assets.join(', ')} but traceable to no stock record — nobody can see it run out`
                : `${e.onHand ?? 0} on hand${e.minLevel != null ? ` against a minimum of ${e.minLevel}` : ''} · used ${e.uses}× on ${e.assets.join(', ')}`,
            value: null,
            path: '/inventory',
            label: 'Inventory',
            tags: e.assets,
        })));

    // ── Register: the foundation, in the order an engineer repairs it ──────
    const registerWins: QuickWin[] = [];
    if (a.register.structuredPct < 60) {
        registerWins.push({
            id: 'register-hierarchy',
            section: 'register',
            text: 'Give the register a hierarchy — parent the orphan assets',
            basis: `Only ${a.register.structuredPct}% sit under a parent. A flat list cannot be rolled up, scoped or costed by unit`,
            value: null, path: '/assets', label: 'Asset register', tags: [],
        });
    }
    if (a.register.criticalitySpreadPct < 40) {
        registerWins.push({
            id: 'register-criticality',
            section: 'register',
            text: 'Rank criticality for real',
            basis: a.register.dominantCriticality
                ? `${a.register.dominantCriticality.pct}% of assets sit in class ${a.register.dominantCriticality.value} — that is an imported default, not an assessment`
                : `Criticality varies across only ${a.register.criticalitySpreadPct}% of the register`,
            value: null, path: '/assets', label: 'Asset register', tags: [],
        });
    }
    if (a.register.nameplatePct < 60) {
        registerWins.push({
            id: 'register-nameplate',
            section: 'register',
            text: 'Capture nameplate data — make and model',
            basis: `${a.register.nameplatePct}% complete. No nameplate means no benchmark, no parts interchangeability and no warranty position`,
            value: null, path: '/assets', label: 'Asset register', tags: [],
        });
    }
    if (a.register.tagCollisionCount > 0) {
        registerWins.push({
            id: 'register-collisions',
            section: 'register',
            text: `Merge ${plural(a.register.tagCollisionCount, 'tag collision')}`,
            basis: `One physical asset's history is split across rows${a.register.tagCollisionExamples[0] ? ` (e.g. ${a.register.tagCollisionExamples[0].join(' / ')})` : ''} — every per-asset figure above is diluted by it`,
            value: null, path: '/assets', label: 'Asset register', tags: [],
        });
    }
    put('register', registerWins);

    // ── Workforce: a strategy nobody can execute is a document ─────────────
    put('workforce', a.skills.areas.filter((ar) => ar.gap && ar.demand > 0).map((ar): QuickWin => ({
        id: `skill:${ar.key}`,
        section: 'workforce',
        text: `Staff ${ar.label.toLowerCase()} — train, hire or contract`,
        basis: `${plural(ar.demand, 'asset')} need this capability and nobody on the roster holds a current qualification for it`,
        value: null,
        path: '/contacts',
        label: 'People',
        tags: [],
    })));

    // ── Data quality: the cheapest upgrades, in value order ────────────────
    const dataWins: QuickWin[] = [];
    if (a.coverage.cost_pct < 90) {
        dataWins.push({
            id: 'data-cost',
            section: 'dataQuality',
            text: 'Record a cost on every work order at close-out',
            basis: `${a.coverage.cost_pct}% carry one today. Cost is what money-ranks everything else in this report`,
            value: null, path: '/work-orders', label: 'Work orders', tags: [],
        });
    }
    if (a.coverage.failure_code_pct < 80) {
        dataWins.push({
            id: 'data-failure-code',
            section: 'dataQuality',
            text: 'Code the failure mode on corrective work',
            basis: `${a.coverage.failure_code_pct}% coded. Without codes there is no Pareto by cause and no RCM evidence — only a list of costs`,
            value: null, path: '/work-orders', label: 'Work orders', tags: [],
        });
    }
    if (a.coverage.downtime_pct < 80) {
        dataWins.push({
            id: 'data-downtime',
            section: 'dataQuality',
            text: 'Capture downtime hours on corrective work',
            basis: `${a.coverage.downtime_pct}% carry a figure. MTTR and availability rest on this denominator`,
            value: null, path: '/work-orders', label: 'Work orders', tags: [],
        });
    }
    put('dataQuality', dataWins);

    return out;
}
