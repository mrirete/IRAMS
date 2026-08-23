/**
 * assessmentEngine — the deterministic assessment computation, extracted from
 * AssessmentReportPage so it can run at two scopes (Phase B2,
 * docs/Specialist-150k-Replacement-Plan.md):
 *
 *   - whole-tenant (the printable report + snapshots), and
 *   - a hierarchy subtree ("assess this system/area"), persisted as a
 *     reliability study.
 *
 * Same engine, one filter — Pareto on frozen WO costs, censored Weibull,
 * PM effectiveness, warranty windows, register quality, coverage. The LLM
 * narrates over this output; it never computes any of it.
 */
import { supabase } from '../lib/supabase';
import { fitWeibull, weibullBLife } from '../utils/weibull';
import { isFailure, eventDate, FAILURE_QUERY_COLUMNS } from './reliabilityMetrics';
import { computeRegisterQuality, type RegisterQuality } from '../../lib/registerQuality';
import { collectSubtree } from '../../lib/assetSubtree';
import { selectStrategies, type StrategyReview } from '../../lib/strategySelect';
import { computePSC, isBanded, PSC_TARGETS, type GoldenSpotParam, type ParamReading, type PSCZone } from '../../lib/psc';
import { assessDisg } from '../../lib/predict/disg';
import { computeSkillsGap, type SkillsGapReview, type QualificationRow } from '../../lib/skillsGap';
import { computeSparesExposure, type SparesReview, type PartUseRow, type StockRow } from '../../lib/sparesExposure';

// ── row shapes (only the columns we query) ────────────────────────────────
interface WoRow {
    id: string; asset_id: string; type: string | null; status: string | null;
    created_at: string; closed_at: string | null;
    frozen_labor_cost: number | null; frozen_material_cost: number | null;
    total_actual_cost: number | null; actual_downtime_hrs: number | null;
    // Canonical failure-engine columns (FAILURE_QUERY_COLUMNS)
    breakdown?: boolean | null; malfunction_start?: string | null;
    actual_duration_hrs?: number | null;
    wo_failure_data?: unknown;
}
interface AssetRow {
    id: string; tag: string; name: string; criticality: string | null;
    parent_id: string | null; manufacturer: string | null; model: string | null;
}

const woCost = (w: WoRow): number => {
    const frozen = (Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0);
    return frozen || Number(w.total_actual_cost) || 0;
};
// Canonical predicate (0295: breakdown-aware, collateral-excluding) — the
// local `type === 'CM'` test this replaced under-counted EM/coded failures
// and ignored recorded breakdown indicators.
const isCorrective = (w: WoRow) => isFailure(w);
const DAY_MS = 86400_000;

// ── computed section shapes ───────────────────────────────────────────────
export interface BadActor {
    tag: string; name: string; criticality: string | null;
    cost12mo: number; woCount12mo: number; cmCount12mo: number;
    downtime12mo: number; cumulativePct: number;
}
export interface WeibullFinding {
    assetId: string; tag: string; name: string; nFailures: number; nSuspensions: number;
    beta: number; eta: number; b10Days: number; r2: number; interpretation: string;
}
export interface WarrantyFind { woNumber: string; tag: string; date: string; recoverable: number; }

/** Fleet success layer (PSC, Olorunfemi 2026) over assets with banded points. */
export interface SuccessAssetRow {
    assetId: string; tag: string; name: string;
    zoneNow: PSCZone;
    successRate: number | null;
    percentTimeInSpot: number | null;
    mtopHours: number | null;
    mttrgHours: number | null;
    currentDepartureHours: number | null;
}
/** E5 — an asset early in observed life, judged on the S-phase of D-I-S-G. */
export interface FrontOfLifeRow {
    assetId: string;
    tag: string;
    /** Days since the first reading was observed. */
    observedDays: number;
    /** Hours from first observation to first Golden-Spot entry; null = never entered. */
    timeToSuccessHours: number | null;
    reachedSpot: boolean;
}

export interface SuccessReview {
    assetsWithBands: number;
    assetsMeasured: number;
    /** Mean SR across measured assets (Eq.3); null when nothing measured. */
    fleetSuccessRate: number | null;
    meanTimeInSpotPct: number | null;
    zoneCounts: { inSpot: number; drift: number; critical: number; unknown: number };
    /** Worst residency first — the defend-the-optimum work list. */
    worst: SuccessAssetRow[];
    targets: { srTarget: number; srWorldClass: number };
}
export interface PmWasteFind { code: string; title: string; tag: string; category: string; annualEvents: number | null; failures12mo: number; }

export interface Assessment {
    windowMonths: number;
    totalSpend12mo: number;
    woCount12mo: number;
    assetCount: number;
    badActors: BadActor[];
    paretoShare: { topN: number; pct: number } | null;
    weibull: WeibullFinding[];
    warranty: { total: number; items: WarrantyFind[] };
    pmWaste: PmWasteFind[];
    coverage: { cost_pct: number; failure_code_pct: number; downtime_pct: number };
    register: RegisterQuality;
    /** Per-asset strategy selection + A/B coverage (Phase D1/D2). */
    strategy: StrategyReview;
    /** Success layer (Phase E1) — Golden-Spot residency per the PSC framework. */
    success: SuccessReview;
    /** Workforce readiness vs the deployed strategies (Phase F5). */
    skills: SkillsGapReview;
    /** Critical-asset spares risk from real consumption (Phase B4). */
    spares: SparesReview;
    /** D-I-S-G front of life: recently-observed banded assets (Phase E5). */
    frontOfLife: FrontOfLifeRow[];
    /** Banded measurement points per asset — feeds the care-route planner (F1). */
    pointCountByAsset: Record<string, number>;
    /** Hierarchy parent per asset — route grouping (F1). */
    parentByAsset: Record<string, string | null>;
    /** id/tag/name/criticality for entity-linking the narrative's asset tags. */
    assetIndex: { id: string; tag: string; name: string; criticality: string | null }[];
    dataFrom: string | null;
    dataTo: string | null;
    /** Present when the assessment was scoped to a hierarchy subtree. */
    scope?: { rootId: string; rootTag: string; rootName: string } | null;
}

/**
 * Compute the assessment. With `scopeRootId`, everything is filtered to that
 * asset plus its descendants (the register hierarchy) before any math runs.
 */
export async function computeAssessment(scopeRootId?: string): Promise<Assessment> {
    const cutoff12 = new Date(Date.now() - 365 * DAY_MS).toISOString();

    const [woQ, assetQ, pmQ, warrQ, failQ, readQ, logQ, smeaWsQ, smeaItemQ, qualQ, partsQ, stockQ] = await Promise.all([
        supabase.from('work_orders')
            .select(`asset_id, frozen_labor_cost, frozen_material_cost, total_actual_cost, ${FAILURE_QUERY_COLUMNS}`)
            .order('created_at', { ascending: false }).limit(20000),
        supabase.from('assets').select('id, tag, name, criticality, parent_id, manufacturer, model').limit(10000),
        supabase.from('recurring_work')
            .select('id, code, title, asset_id, frequency_interval, frequency_unit, job_type, active')
            .eq('active', true).limit(3000),
        supabase.from('warranties')
            .select('id, asset_id, warranty_type, start_date, end_date, deductible, status')
            .eq('status', 'ACTIVE').limit(5000),
        supabase.from('wo_failure_data').select('wo_id').limit(20000),
        supabase.from('reading_definitions')
            .select('id, asset_id, name, min_warning, max_warning, min_critical, max_critical')
            .eq('is_active', true).limit(20000),
        supabase.from('reading_logs')
            .select('definition_id, asset_id, reading_date, reading_time, reading_value')
            .order('reading_date', { ascending: false }).limit(20000),
        supabase.from('ers_smea_worksheets').select('id, asset_id, status').neq('status', 'closed').limit(2000),
        supabase.from('ers_smea_items').select('worksheet_id, success_mode, spn, status').neq('status', 'dropped').limit(5000),
        supabase.from('qualifications').select('contact_id, name, type, status, date_expires').limit(5000),
        supabase.from('work_order_parts').select('wo_id, item_id, notes, quantity, date_used').limit(20000),
        supabase.from('inventory_stock').select('item_id, quantity, min_level').limit(20000),
    ]);

    let wos: WoRow[] = (woQ.data ?? []) as WoRow[];
    let assets: AssetRow[] = (assetQ.data ?? []) as AssetRow[];
    let pms = (pmQ.data ?? []) as Record<string, unknown>[];
    let warranties = (warrQ.data ?? []) as Record<string, unknown>[];

    // ── the B2 filter: one subtree, then the identical math ──
    let scope: Assessment['scope'] = null;
    if (scopeRootId) {
        const subtree = collectSubtree(assets, scopeRootId);
        const root = assets.find((a) => a.id === scopeRootId);
        scope = { rootId: scopeRootId, rootTag: root?.tag ?? '(unknown)', rootName: root?.name ?? '' };
        assets = assets.filter((a) => subtree.has(a.id));
        wos = wos.filter((w) => w.asset_id && subtree.has(w.asset_id));
        pms = pms.filter((p) => subtree.has(String(p.asset_id)));
        warranties = warranties.filter((w) => subtree.has(String(w.asset_id)));
    }

    const assetById = new Map(assets.map((a) => [a.id, a]));
    const codedWoIds = new Set((failQ.data ?? []).map((f: { wo_id: string }) => f.wo_id));

    const wos12 = wos.filter((w) => w.created_at >= cutoff12);
    const totalSpend12mo = wos12.reduce((s, w) => s + woCost(w), 0);

    // Bad actors (12-month window, cost-ranked, Pareto)
    const agg = new Map<string, { cost: number; count: number; cm: number; down: number }>();
    for (const w of wos12) {
        if (!w.asset_id) continue;
        const cur = agg.get(w.asset_id) ?? { cost: 0, count: 0, cm: 0, down: 0 };
        cur.cost += woCost(w); cur.count += 1;
        if (isCorrective(w)) cur.cm += 1;
        cur.down += Number(w.actual_downtime_hrs) || 0;
        agg.set(w.asset_id, cur);
    }
    const grand = [...agg.values()].reduce((s, v) => s + v.cost, 0) || 1;
    let cum = 0;
    const badActors: BadActor[] = [...agg.entries()]
        .sort((a, b) => b[1].cost - a[1].cost)
        .slice(0, 10)
        .map(([id, v]) => {
            cum += v.cost;
            const a = assetById.get(id);
            return {
                tag: a?.tag ?? '(unknown)', name: a?.name ?? '(unknown asset)',
                criticality: a?.criticality ?? null,
                cost12mo: Math.round(v.cost), woCount12mo: v.count, cmCount12mo: v.cm,
                downtime12mo: Math.round(v.down), cumulativePct: Math.round((cum / grand) * 1000) / 10,
            };
        });
    const topAt80 = badActors.findIndex((b) => b.cumulativePct >= 80);
    const paretoShare = badActors.length >= 3
        ? { topN: topAt80 >= 0 ? topAt80 + 1 : badActors.length, pct: topAt80 >= 0 ? badActors[topAt80].cumulativePct : badActors[badActors.length - 1].cumulativePct }
        : null;

    // Weibull on the worst corrective-failure assets (full history, censored)
    const failureDatesByAsset = new Map<string, number[]>();
    for (const w of wos) {
        if (!w.asset_id || !isCorrective(w)) continue;
        const arr = failureDatesByAsset.get(w.asset_id) ?? [];
        // Event basis, not paperwork date: malfunction_start > closed > created.
        arr.push(new Date(eventDate(w) as string).getTime());
        failureDatesByAsset.set(w.asset_id, arr);
    }
    const weibull: WeibullFinding[] = [];
    const candidates = [...failureDatesByAsset.entries()]
        .filter(([, d]) => d.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5);
    for (const [assetId, timesMs] of candidates) {
        const sorted = [...timesMs].sort((a, b) => a - b);
        const intervals: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
            const days = (sorted[i] - sorted[i - 1]) / DAY_MS;
            if (days > 0.25) intervals.push(days); // ignore same-day duplicates
        }
        const sinceLast = (Date.now() - sorted[sorted.length - 1]) / DAY_MS;
        const suspensions = sinceLast > 1 ? [sinceLast] : [];
        const fit = fitWeibull(intervals, suspensions);
        if (!fit) continue;
        const a = assetById.get(assetId);
        const b10 = weibullBLife(fit.beta, fit.eta, 10);
        weibull.push({
            assetId, tag: a?.tag ?? '(unknown)', name: a?.name ?? '(unknown asset)',
            nFailures: fit.nFailures, nSuspensions: fit.nSuspensions,
            beta: Math.round(fit.beta * 100) / 100, eta: Math.round(fit.eta),
            b10Days: Math.round(b10), r2: Math.round(fit.r2 * 100) / 100,
            interpretation: fit.beta > 1.5 ? 'wear-out — age-based PM is justified'
                : fit.beta > 0.95 ? 'random failures — condition monitoring beats fixed-interval PM'
                    : 'infant mortality — look at installation/maintenance quality, not more PM',
        });
    }

    // Warranty recovery (mirrors the scan_warranty_recovery tool)
    const today = new Date().toISOString().slice(0, 10);
    const warrantiesByAsset = new Map<string, Record<string, unknown>[]>();
    for (const w of warranties) {
        if (w.end_date && String(w.end_date) < today) continue;
        const arr = warrantiesByAsset.get(String(w.asset_id)) ?? [];
        arr.push(w); warrantiesByAsset.set(String(w.asset_id), arr);
    }
    const warrantyItems: WarrantyFind[] = [];
    for (const w of wos) {
        if (!['CLOSED', 'TECO'].includes(String(w.status ?? '').toUpperCase())) continue;
        const cost = woCost(w);
        if (cost <= 0) continue;
        const day = w.created_at.slice(0, 10);
        const cover = (warrantiesByAsset.get(w.asset_id) ?? []).find(
            (c) => day >= String(c.start_date) && (!c.end_date || day <= String(c.end_date)),
        );
        if (!cover) continue;
        const net = Math.max(0, cost - (Number(cover.deductible) || 0));
        if (net <= 0) continue;
        warrantyItems.push({
            woNumber: w.id, tag: assetById.get(w.asset_id)?.tag ?? '(unknown)',
            date: day, recoverable: Math.round(net),
        });
    }
    warrantyItems.sort((a, b) => b.recoverable - a.recoverable);
    const warrantyTotal = warrantyItems.reduce((s, i) => s + i.recoverable, 0);

    // PM waste (mirrors analyze_pm_effectiveness, asset-level)
    const annualEvents = (interval: number, unit: string): number | null => {
        if (!interval || interval <= 0) return null;
        const u = (unit || '').toLowerCase();
        if (u.startsWith('day')) return 365 / interval;
        if (u.startsWith('week')) return 52 / interval;
        if (u.startsWith('month')) return 12 / interval;
        if (u.startsWith('year')) return 1 / interval;
        return null;
    };
    const cmByAsset = new Map<string, number>();
    for (const w of wos12) if (w.asset_id && isCorrective(w)) cmByAsset.set(w.asset_id, (cmByAsset.get(w.asset_id) ?? 0) + 1);
    const pmsByAssetType = new Map<string, number>();
    for (const p of pms) {
        const k = `${p.asset_id}|${p.job_type}`;
        pmsByAssetType.set(k, (pmsByAssetType.get(k) ?? 0) + 1);
    }
    const pmWaste: PmWasteFind[] = pms.map((p) => {
        const annual = annualEvents(Number(p.frequency_interval), String(p.frequency_unit ?? ''));
        const failures = cmByAsset.get(String(p.asset_id)) ?? 0;
        const redundant = (pmsByAssetType.get(`${p.asset_id}|${p.job_type}`) ?? 1) > 1;
        let category = 'ok';
        if (redundant) category = 'redundant';
        else if (failures >= 3) category = 'ineffective';
        else if (annual !== null && annual >= 6 && failures === 0) category = 'over-maintenance';
        const asset = assetById.get(String(p.asset_id));
        return {
            code: String(p.code ?? ''), title: String(p.title ?? ''),
            tag: asset?.tag ?? String(p.asset_id ?? ''), category,
            annualEvents: annual === null ? null : Math.round(annual * 10) / 10,
            failures12mo: failures,
        };
    }).filter((o) => o.category !== 'ok').slice(0, 10);

    // Maintenance-strategy selection (Phase D1/D2) — each asset's recommended
    // regime + A/B coverage, from data already in hand.
    const monitoredAssets = new Set(
        ((readQ.data ?? []) as { asset_id: string | null }[])
            .map((r) => r.asset_id)
            .filter((id): id is string => Boolean(id && assetById.has(id))),
    );
    const cmCost12ByAsset = new Map<string, number>();
    for (const w of wos12) {
        if (w.asset_id && isCorrective(w)) cmCost12ByAsset.set(w.asset_id, (cmCost12ByAsset.get(w.asset_id) ?? 0) + woCost(w));
    }
    // E3: the top-SPN success mode per asset rides into the strategy basis —
    // what a SMEA says to SUSTAIN shapes how the asset is maintained.
    const wsAsset = new Map(((smeaWsQ.data ?? []) as { id: string; asset_id: string | null }[])
        .filter((w) => w.asset_id && assetById.has(w.asset_id))
        .map((w) => [w.id, w.asset_id as string]));
    const smeaTopByAsset = new Map<string, { mode: string; spn: number }>();
    for (const it of (smeaItemQ.data ?? []) as { worksheet_id: string; success_mode: string; spn: number | null }[]) {
        const assetId = wsAsset.get(it.worksheet_id);
        if (!assetId || it.spn == null) continue;
        const cur = smeaTopByAsset.get(assetId);
        if (!cur || it.spn > cur.spn) smeaTopByAsset.set(assetId, { mode: it.success_mode, spn: it.spn });
    }
    const strategy = selectStrategies({
        assets,
        cmTimesByAsset: failureDatesByAsset,
        cmCost12ByAsset,
        activePmAssets: new Set(pms.map((p) => String(p.asset_id)).filter((id) => assetById.has(id))),
        monitoredAssets,
        smeaTopByAsset,
    }, Date.now());

    // Success layer (Phase E1, PSC framework) — Golden-Spot residency per
    // asset with banded reading points; every figure from lib/psc's tested
    // replay, aggregated to a fleet position vs the SR 90/95 targets.
    type DefRow = { id: string; asset_id: string | null; name: string; min_warning: number | null; max_warning: number | null; min_critical: number | null; max_critical: number | null };
    type LogRow = { definition_id: string | null; asset_id: string | null; reading_date: string | null; reading_time: string | null; reading_value: number | null };
    const defsByAsset = new Map<string, GoldenSpotParam[]>();
    for (const d of (readQ.data ?? []) as DefRow[]) {
        if (!d.asset_id || !assetById.has(d.asset_id)) continue;
        const p: GoldenSpotParam = {
            id: d.id, name: d.name,
            minWarning: d.min_warning, maxWarning: d.max_warning,
            minCritical: d.min_critical, maxCritical: d.max_critical,
        };
        if (!isBanded(p)) continue;
        (defsByAsset.get(d.asset_id) ?? defsByAsset.set(d.asset_id, []).get(d.asset_id)!).push(p);
    }
    const logsByAsset = new Map<string, ParamReading[]>();
    for (const l of (logQ.data ?? []) as LogRow[]) {
        if (!l.asset_id || !l.definition_id || l.reading_value == null || !defsByAsset.has(l.asset_id)) continue;
        (logsByAsset.get(l.asset_id) ?? logsByAsset.set(l.asset_id, []).get(l.asset_id)!).push({
            paramId: l.definition_id,
            at: `${l.reading_date}T${(l.reading_time ?? '12:00').slice(0, 5)}`,
            value: Number(l.reading_value),
        });
    }
    const successRows: SuccessAssetRow[] = [];
    const zoneCounts = { inSpot: 0, drift: 0, critical: 0, unknown: 0 };
    for (const [assetId, params] of defsByAsset) {
        const res = computePSC(params, logsByAsset.get(assetId) ?? [], Date.now(), 90);
        const a = assetById.get(assetId);
        if (res.zoneNow === 'GOLDEN_SPOT') zoneCounts.inSpot += 1;
        else if (res.zoneNow === 'SUB_OPTIMAL_DRIFT') zoneCounts.drift += 1;
        else if (res.zoneNow === 'CRITICAL_DEPARTURE') zoneCounts.critical += 1;
        else zoneCounts.unknown += 1;
        successRows.push({
            assetId, tag: a?.tag ?? '(unknown)', name: a?.name ?? '',
            zoneNow: res.zoneNow,
            successRate: res.successRate == null ? null : Math.round(res.successRate * 10) / 10,
            percentTimeInSpot: res.percentTimeInSpot == null ? null : Math.round(res.percentTimeInSpot * 10) / 10,
            mtopHours: res.mtopHours == null ? null : Math.round(res.mtopHours),
            mttrgHours: res.mttrgHours == null ? null : Math.round(res.mttrgHours * 10) / 10,
            currentDepartureHours: res.currentDepartureHours == null ? null : Math.round(res.currentDepartureHours),
        });
    }
    // E5 — front of life: banded assets whose first observation is recent get
    // the D-I-S-G S-phase judgement (time to first Golden-Spot entry).
    const frontOfLife: FrontOfLifeRow[] = [];
    for (const [assetId, params] of defsByAsset) {
        const logs = logsByAsset.get(assetId) ?? [];
        if (!logs.length) continue;
        const firstMs = Math.min(...logs.map((l) => new Date(l.at).getTime()).filter(Number.isFinite));
        const observedDays = Math.round((Date.now() - firstMs) / DAY_MS);
        if (observedDays > 180) continue; // established life — not front-of-life
        const disg = assessDisg(params, logs, { now: Date.now() });
        const a = assetById.get(assetId);
        frontOfLife.push({
            assetId, tag: a?.tag ?? '(unknown)',
            observedDays,
            timeToSuccessHours: disg.timeToSuccessHours ?? null,
            reachedSpot: disg.timeToSuccessHours != null,
        });
    }
    frontOfLife.sort((a, b) => Number(a.reachedSpot) - Number(b.reachedSpot) || a.observedDays - b.observedDays);

    const measured = successRows.filter((r) => r.percentTimeInSpot != null);
    const withSr = measured.filter((r) => r.successRate != null);
    const zoneRank: Record<PSCZone, number> = { CRITICAL_DEPARTURE: 0, SUB_OPTIMAL_DRIFT: 1, GOLDEN_SPOT: 2, UNKNOWN: 3 };
    const success: SuccessReview = {
        assetsWithBands: defsByAsset.size,
        assetsMeasured: measured.length,
        fleetSuccessRate: withSr.length
            ? Math.round((withSr.reduce((s, r) => s + (r.successRate ?? 0), 0) / withSr.length) * 10) / 10
            : null,
        meanTimeInSpotPct: measured.length
            ? Math.round((measured.reduce((s, r) => s + (r.percentTimeInSpot ?? 0), 0) / measured.length) * 10) / 10
            : null,
        zoneCounts,
        worst: [...measured]
            .sort((a, b) => zoneRank[a.zoneNow] - zoneRank[b.zoneNow] || (a.percentTimeInSpot ?? 100) - (b.percentTimeInSpot ?? 100))
            .slice(0, 5),
        targets: { srTarget: PSC_TARGETS.srTarget, srWorldClass: PSC_TARGETS.srWorldClass },
    };

    // F5 — workforce readiness vs the strategies just selected.
    const skills = computeSkillsGap(
        strategy.verdicts,
        (qualQ.data ?? []) as QualificationRow[],
        Date.now(),
    );

    // B4 — spares exposure from real consumption on critical assets.
    const woAssetMap = new Map<string, string>();
    for (const w of wos) if (w.asset_id) woAssetMap.set(w.id, w.asset_id);
    const spares = computeSparesExposure({
        woAsset: woAssetMap,
        assets: new Map(assets.map((a) => [a.id, { tag: a.tag, criticality: a.criticality }])),
        parts: (partsQ.data ?? []) as PartUseRow[],
        stock: (stockQ.data ?? []) as StockRow[],
        nowMs: Date.now(),
    });

    // F1 feed — banded point counts per asset for the care-route planner.
    const pointCountByAsset: Record<string, number> = {};
    for (const [assetId, params] of defsByAsset) pointCountByAsset[assetId] = params.length;

    // Asset-register quality (Phase A2) — the foundation layer a human RE
    // audits first; computed from rows already fetched above.
    const register = computeRegisterQuality(
        assets,
        wos12.map((w) => ({ asset_id: w.asset_id })),
        new Set(assetById.keys()),
    );

    // Coverage + data window
    const n12 = wos12.length || 1;
    let from: string | null = null, to: string | null = null;
    for (const w of wos) {
        if (!from || w.created_at < from) from = w.created_at;
        if (!to || w.created_at > to) to = w.created_at;
    }
    const windowMonths = from && to ? Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / (30.44 * DAY_MS))) : 0;

    return {
        windowMonths,
        totalSpend12mo: Math.round(totalSpend12mo),
        woCount12mo: wos12.length,
        assetCount: assets.length,
        badActors,
        paretoShare,
        weibull,
        warranty: { total: warrantyTotal, items: warrantyItems.slice(0, 8) },
        pmWaste,
        coverage: {
            cost_pct: Math.round((wos12.filter((w) => woCost(w) > 0).length / n12) * 100),
            failure_code_pct: Math.round((wos12.filter((w) => codedWoIds.has(w.id)).length / n12) * 100),
            downtime_pct: Math.round((wos12.filter((w) => Number(w.actual_downtime_hrs) > 0).length / n12) * 100),
        },
        register,
        strategy,
        success,
        skills,
        spares,
        frontOfLife,
        pointCountByAsset,
        parentByAsset: Object.fromEntries(assets.map((x) => [x.id, x.parent_id])),
        assetIndex: assets.map((x) => ({ id: x.id, tag: x.tag, name: x.name, criticality: x.criticality })),
        dataFrom: from ? from.slice(0, 10) : null,
        dataTo: to ? to.slice(0, 10) : null,
        scope,
    };
}
