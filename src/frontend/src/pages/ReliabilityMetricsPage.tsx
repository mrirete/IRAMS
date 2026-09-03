/**
 * ReliabilityMetricsPage — the SMRP measurement layer for the Reliability Tier.
 *
 * Surfaces the vital-few reliability KPIs computed from the single reliabilityMetrics
 * spine (so people and the AI read the same numbers), each with its SMRP definition,
 * a bad-actor list, and one-click "Ask Specialist" advice grounded in the KPI results.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gauge, Loader2, Sparkles, AlertTriangle, TrendingUp, Repeat, ArrowRight, Layers, CalendarClock, Wrench, Lock, ClipboardCheck, BookOpen } from 'lucide-react';
import { ReliabilityAdvisorModal } from '../components/analyze/ReliabilityAdvisorModal';
import { PSCPanel } from '../components/metrics/PSCPanel';
import { SmrpScorecard, smrpRoleForAppRole } from '../components/metrics/SmrpScorecard';
import { supabase } from '../eam/lib/supabase';
import { DatabaseService } from '../eam/services/DatabaseService';
import { useAuth } from '../eam/contexts/AuthContext';
import { useRelantern } from '../eam/contexts/RelanternContext';
import { useToast } from '../eam/contexts/ToastContext';
import analyzeService from '../eam/services/AnalyzeService';
import { classifyWork } from '../eam/services/workReadiness';
import {
    computePMEffectiveness, pmEffectivenessKpi, computeAssetReliability,
    computeScheduleCompliance, computePMCompliance, computeScheduleBacklog,
    backlogWeeksKpi, complianceKpi,
    kpisToAIContext, type ReliabilityKpi, type AssetReliability,
} from '../eam/services/reliabilityMetrics';
import { Tabs } from '../eam/components/ui';

interface AssetRow { id: string; tag: string; name: string; criticality?: string; hierarchy_level?: string; asset_class?: string; manufacturer_id?: string; equipment_number?: string }
interface BadActor { id: string; rel: AssetReliability }

// Selectable analysis window (M4). Data is fetched once at the widest window and
// filtered client-side, so switching windows is instant (no refetch).
const WINDOW_OPTIONS: { days: number; label: string }[] = [
    { days: 90, label: '90 days' },
    { days: 182, label: '6 months' },
    { days: 365, label: '12 months' },
    { days: 730, label: '24 months' },
];
const MAX_WINDOW_DAYS = 730;

// Fleet-level reliability scalars for a WO set — used for the current window AND
// the prior equal window (M5 trend), so the two are computed identically.
function fleetScalars(rows: any[], windowDays: number) {
    const mapClassify = (r: any) => ({
        type: r.type, status: r.status, estDuration: r.est_duration,
        tasks: (r.job_tasks || []).map((t: any) => ({ description: t.description, instructions: t.instructions || [], estHours: 0 })),
        labor: r.work_order_labor || [],
    });
    const mapPM = (r: any) => ({
        id: r.id, type: r.type, status: r.status, parentWoId: r.parent_wo_id, recurringWorkId: r.recurring_work_id,
        failureData: { failureMode: (Array.isArray(r.wo_failure_data) ? r.wo_failure_data[0] : r.wo_failure_data)?.failure_mode_code },
    });
    let pro = 0, rea = 0;
    for (const r of rows) { const c = classifyWork(mapClassify(r) as any); if (c === 'PROACTIVE') pro++; else if (c === 'REACTIVE') rea++; }
    const proPct = pro + rea ? Math.round((pro / (pro + rea)) * 100) : null;
    const pmEffKpi = pmEffectivenessKpi(computePMEffectiveness(rows.map(mapPM)));
    const byAsset: Record<string, any[]> = {};
    for (const r of rows) { if (r.asset_id) (byAsset[r.asset_id] = byAsset[r.asset_id] || []).push(r); }
    const assetRel = Object.entries(byAsset).map(([id, recs]) => ({ id, rel: computeAssetReliability(recs, { windowDays }) }));
    const totalFailures = assetRel.reduce((s, a) => s + a.rel.failures12mo, 0);
    // Fleet means of the per-asset SMRP 7th-ed mean metrics (G4.0). Assets with
    // no failures contribute no MTBF/MTTR/MDT — a quiet asset is not "infinite".
    const mean = (xs: number[], dp = 1) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10 ** dp) / 10 ** dp : null);
    const pick = (f: (r: AssetReliability) => number | undefined) => assetRel.map(a => f(a.rel)).filter((v): v is number => v != null);
    const fleetMtbf = mean(pick(r => r.mtbfDays), 0);
    const fleetMttr = mean(pick(r => r.mttrHours));
    const fleetMdt = mean(pick(r => r.mdtHours));
    const fleetMtbm = mean(pick(r => r.mtbmDays), 0);
    // 3.5.5 — only assets with a replacement-closed failure carry an MTTF.
    const fleetMttf = mean(pick(r => r.mttfDays), 0);
    const replacements = assetRel.reduce((s, a) => s + a.rel.replacements12mo, 0);
    const availOf = (upDays: number | null, downHours: number | null) =>
        upDays != null && downHours != null && (upDays + downHours / 24) > 0
            ? Math.round((upDays / (upDays + downHours / 24)) * 1000) / 10 : null;
    const fleetAi = availOf(fleetMtbf, fleetMttr);
    const fleetAo = availOf(fleetMtbm, fleetMdt);
    // How many assets' MTTR rests on repair hours vs the outage-window proxy.
    const mttrRepairBasis = assetRel.filter(a => a.rel.mttrBasis === 'repair').length;
    const mttrProxyBasis = assetRel.filter(a => a.rel.mttrBasis === 'downtime-proxy').length;
    // SMRP 3.2/3.3/3.4 — downtime against Total Available Time across the fleet.
    const schedDt = assetRel.reduce((s, a) => s + a.rel.scheduledDowntimeHrs12mo, 0);
    const unschedDt = assetRel.reduce((s, a) => s + a.rel.unscheduledDowntimeHrs12mo, 0);
    const tat = windowDays * 24 * (assetRel.length || 0);
    const pctTat = (h: number) => (tat > 0 ? Math.round((h / tat) * 1000) / 10 : null);
    return {
        proPct, pmEffKpi, fleetMtbf, fleetMttr, fleetMdt, fleetMtbm, fleetMttf, replacements, fleetAi, fleetAo, totalFailures, assetRel,
        mttrRepairBasis, mttrProxyBasis,
        downtime: { sched: Math.round(schedDt), unsched: Math.round(unschedDt), schedPct: pctTat(schedDt), unschedPct: pctTat(unschedDt), totalPct: pctTat(schedDt + unschedDt) },
    };
}

export const ReliabilityMetricsPage: React.FC = () => {
    const { openRelantern } = useRelantern();
    const { showToast } = useToast();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [wos, setWos] = useState<any[]>([]);
    const [assets, setAssets] = useState<AssetRow[]>([]);
    const [schedJobs, setSchedJobs] = useState<any[]>([]); // full WO set for execution metrics
    const [resources, setResources] = useState<any[]>([]); // crew roster for backlog capacity
    const [finRows, setFinRows] = useState<any[]>([]); // asset_financials.replacement_value for RAV

    // M4 — interactive controls: analysis window + asset filters.
    const [windowDays, setWindowDays] = useState(365);
    const [critFilter, setCritFilter] = useState('ALL');   // ALL | A | B | C
    const [classFilter, setClassFilter] = useState('ALL'); // ALL | <asset_class>
    const windowLabel = WINDOW_OPTIONS.find(w => w.days === windowDays)?.label || `${windowDays} days`;

    // Calm-screens: the vital-few KPI band stays on screen; the deep sections live
    // behind tabs so the page fits one viewport and everything is a click away.
    const [tab, setTab] = useState<'smrp' | 'execution' | 'cost' | 'health' | 'badActors' | 'psc'>('smrp');

    // M5 — reliability studies + created PMs per asset, to surface on the bad-actor list.
    const [studyByAsset, setStudyByAsset] = useState<Record<string, { count: number; pm?: string }>>({});
    useEffect(() => {
        analyzeService.getReliabilityAnalyses().then(analyses => {
            const acc: Record<string, { lineages: Set<string>; pm?: string }> = {};
            for (const a of analyses) {
                if (!a.asset_id) continue;
                const m = acc[a.asset_id] || (acc[a.asset_id] = { lineages: new Set() });
                m.lineages.add(a.root_id || a.id);
                if (a.linked_pm_id && !m.pm) m.pm = a.linked_pm_title || 'PM';
            }
            const out: Record<string, { count: number; pm?: string }> = {};
            for (const [id, m] of Object.entries(acc)) out[id] = { count: m.lineages.size, pm: m.pm };
            setStudyByAsset(out);
        }).catch(() => { /* studies are advisory; ignore load errors */ });
    }, []);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const since = new Date(Date.now() - MAX_WINDOW_DAYS * 86400000).toISOString();
                const db = DatabaseService.getInstance();
                // Current week range for crew-capacity lookup.
                const ws = new Date(); ws.setDate(ws.getDate() - ws.getDay() + 1);
                const we = new Date(ws); we.setDate(we.getDate() + 6);
                const range = { start: ws.toISOString().split('T')[0], end: we.toISOString().split('T')[0] };

                const [woRes, aRes, allWOs, labor, finRes] = await Promise.all([
                    supabase.from('work_orders')
                        // 0283/0289/0295 columns the shared engine classifies on: without
                        // breakdown / malfunction_start / secondary_failure this page used to
                        // run the engine degraded (type heuristic only, paperwork dates).
                        .select('id, type, status, est_duration, actual_downtime_hrs, actual_duration_hrs, est_downtime_hrs, malfunction_start, breakdown, total_actual_cost, asset_id, created_at, closed_at, parent_wo_id, recurring_work_id, job_tasks(description, instructions), work_order_labor(id), wo_failure_data!wo_id(failure_mode_code, remedy_code, object_part, secondary_failure)')
                        .gte('created_at', since),
                    supabase.from('assets').select('id, tag, name, criticality, hierarchy_level, asset_class, manufacturer_id, equipment_number'),
                    db.getWorkOrders().catch(() => []),
                    db.getLaborAvailability(range).catch(() => ({ resources: [] })),
                    supabase.from('asset_financials').select('asset_id, replacement_value'),
                ]);
                if (!active) return;
                if (woRes.error) throw woRes.error;
                setWos(woRes.data || []);
                setAssets((aRes.data as AssetRow[]) || []);
                setSchedJobs(Array.isArray(allWOs) ? allWOs : []);
                setResources((labor as any)?.resources || []);
                setFinRows(((finRes as any)?.data as any[]) || []);
            } catch (e: any) {
                if (active) setError(e?.message || 'Failed to load reliability data.');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    const assetName = (id: string) => {
        const a = assets.find(x => x.id === id);
        return a ? `${a.tag || ''}${a.name ? ` — ${a.name}` : ''}`.trim() || id.slice(0, 8) : id.slice(0, 8);
    };

    // ── M4: apply the window + filters, then everything downstream recomputes ──
    const assetClasses = useMemo(
        () => Array.from(new Set(assets.map(a => (a.asset_class || '').trim()).filter(Boolean))).sort(),
        [assets],
    );
    const filteredAssets = useMemo(() => assets.filter(a =>
        (critFilter === 'ALL' || (a.criticality || '') === critFilter) &&
        (classFilter === 'ALL' || (a.asset_class || '') === classFilter)
    ), [assets, critFilter, classFilter]);
    const filteredAssetIds = useMemo(() => new Set(filteredAssets.map(a => a.id)), [filteredAssets]);
    const assetFilterActive = critFilter !== 'ALL' || classFilter !== 'ALL';
    const filteredWos = useMemo(() => {
        const cutoff = Date.now() - windowDays * 86400000;
        return wos.filter(w =>
            new Date(w.created_at).getTime() >= cutoff &&
            (!assetFilterActive || (w.asset_id && filteredAssetIds.has(w.asset_id)))
        );
    }, [wos, windowDays, assetFilterActive, filteredAssetIds]);

    const { kpis, badActors, deltas } = useMemo(() => {
        const cur = fleetScalars(filteredWos, windowDays);

        // M5 trend: same fleet scalars over the PRIOR equal-length window (same filters).
        const now = Date.now();
        const priorStart = now - 2 * windowDays * 86400000;
        const priorEnd = now - windowDays * 86400000;
        const priorWos = wos.filter(w => {
            const t = new Date(w.created_at).getTime();
            return t >= priorStart && t < priorEnd && (!assetFilterActive || (w.asset_id && filteredAssetIds.has(w.asset_id)));
        });
        const prev = fleetScalars(priorWos, windowDays);

        const bad = cur.assetRel.filter(a => a.rel.failures12mo > 0).sort((a, b) => b.rel.failures12mo - a.rel.failures12mo).slice(0, 8);

        // Metric numbers and targets are the SMRP Best Practices 7th Edition's
        // (lib/smrpCatalog). The vital-few band shows the first six; the rest
        // sit on the SMRP Scorecard tab, still one list for the Specialist.
        const mttrBasisNote = cur.mttrRepairBasis > 0 && cur.mttrProxyBasis > 0
            ? ` Basis: repair hours on ${cur.mttrRepairBasis} assets, outage window standing in on ${cur.mttrProxyBasis}.`
            : cur.mttrProxyBasis > 0 ? ' Basis: no repair hours captured yet — the outage window (MDT) stands in.' : ' Basis: order-level repair hours.';
        const dt = cur.downtime;
        const list: ReliabilityKpi[] = [
            { key: 'pct_proactive', label: '% Proactive', smrpRef: 'SMRP 5.4.2', value: cur.proPct, display: cur.proPct == null ? 'N/A' : `${cur.proPct}%`, unit: '%', direction: 'higher-better', benchmark: '> 80%', definition: `Proactive Work — preventive, predictive and corrective-from-PM/PdM work vs reactive (${windowLabel}). Best-in-class > 80%.` },
            cur.pmEffKpi,
            { key: 'ai', label: 'Inherent Avail. (Ai)', smrpRef: 'SMRP G6.0 Ai', value: cur.fleetAi, display: cur.fleetAi == null ? 'N/A' : `${cur.fleetAi}%`, unit: '%', direction: 'higher-better', benchmark: '> 90%', definition: 'Guideline 6.0 inherent availability Ai = MTBF ÷ (MTBF + MTTR): design-driven, corrective repair time only.' },
            { key: 'ao', label: 'Operational Avail. (Ao)', smrpRef: 'SMRP G6.0 Ao', value: cur.fleetAo, display: cur.fleetAo == null ? 'N/A' : `${cur.fleetAo}%`, unit: '%', direction: 'higher-better', benchmark: '≤ Ai; trend upward', definition: 'Guideline 6.0 operational availability Ao = MTBM ÷ (MTBM + MDT): PM/PdM interruptions and repair delays included — what the plant lived.' },
            { key: 'fleet_mtbf', label: 'Fleet MTBF', smrpRef: 'SMRP 3.5.1', value: cur.fleetMtbf, display: cur.fleetMtbf == null ? 'N/A' : `${cur.fleetMtbf}d`, unit: 'days', direction: 'higher-better', benchmark: 'trend upward', definition: 'Mean Time Between Failures = operating time ÷ failures, per asset then averaged. Operating time = window less recorded downtime (calendar-hour basis).' },
            { key: 'fleet_mttr', label: 'Fleet MTTR', smrpRef: 'SMRP 3.5.2', value: cur.fleetMttr, display: cur.fleetMttr == null ? 'N/A' : `${cur.fleetMttr}h`, unit: 'hours', direction: 'lower-better', benchmark: 'trend downward', definition: `Mean Time to Repair or Replace = repair start → repair complete, averaged across assets.${mttrBasisNote}` },
            { key: 'fleet_mdt', label: 'Mean Downtime (MDT)', smrpRef: 'SMRP 3.5.4', value: cur.fleetMdt, display: cur.fleetMdt == null ? 'N/A' : `${cur.fleetMdt}h`, unit: 'hours', direction: 'lower-better', benchmark: 'trend downward', definition: 'Mean Downtime = failure → back in service, waits and delays included (malfunction window). MTTR plus the delays before and after the repair.' },
            { key: 'fleet_mtbm', label: 'MTBM', smrpRef: 'SMRP 3.5.3', value: cur.fleetMtbm, display: cur.fleetMtbm == null ? 'N/A' : `${cur.fleetMtbm}d`, unit: 'days', direction: 'higher-better', benchmark: 'trend upward', definition: 'Mean Time Between Maintenance = operating time ÷ maintenance actions that interrupted the function (failures + PM/PdM with downtime).' },
            { key: 'fleet_mttf', label: 'MTTF', smrpRef: 'SMRP 3.5.5', value: cur.fleetMttf, display: cur.fleetMttf == null ? 'N/A' : `${cur.fleetMttf}d`, unit: 'days', direction: 'higher-better', benchmark: 'trend upward', definition: cur.replacements > 0
                ? `Mean Time To Failure = operating time ÷ items run to failure, for NON-repairable items only. IREAMS counts the ${cur.replacements} failure${cur.replacements === 1 ? '' : 's'} closed with the REPLACED remedy (${windowLabel}); failures closed by repair belong to MTBF.`
                : `Mean Time To Failure applies to non-repairable items: failures closed with the REPLACED remedy code. None in the ${windowLabel} window — code the remedy at close-out and this fills in.` },
            { key: 'downtime_total', label: 'Total Downtime', smrpRef: 'SMRP 3.2', value: dt.totalPct, display: dt.totalPct == null ? 'N/A' : `${dt.totalPct}%`, unit: '%', direction: 'lower-better', benchmark: '< 0.5–2% of Total Available Time', definition: `Scheduled + unscheduled maintenance downtime as % of Total Available Time (${windowLabel} × 24 h × assets in scope): ${dt.sched}h scheduled + ${dt.unsched}h unscheduled.` },
            { key: 'downtime_sched', label: 'Scheduled Downtime', smrpRef: 'SMRP 3.3', value: dt.schedPct, display: dt.schedPct == null ? 'N/A' : `${dt.schedPct}%`, unit: '%', direction: 'lower-better', definition: `Downtime on preventive/scheduled work (actual, else planned) as % of Total Available Time — ${dt.sched}h.` },
            { key: 'downtime_unsched', label: 'Unscheduled Downtime', smrpRef: 'SMRP 3.4', value: dt.unschedPct, display: dt.unschedPct == null ? 'N/A' : `${dt.unschedPct}%`, unit: '%', direction: 'lower-better', benchmark: 'every effort to avoid', definition: `Downtime on failures as % of Total Available Time — ${dt.unsched}h.` },
            { key: 'failures_win', label: `Failures (${windowLabel})`, value: cur.totalFailures, display: String(cur.totalFailures), direction: 'lower-better', definition: `Total primary failures across the fleet in the ${windowLabel} window (ISO 14224 event count — not itself an SMRP metric).` },
        ];

        const d = (c: number | null, p: number | null) => (c != null && p != null ? Math.round((c - p) * 10) / 10 : null);
        const deltas: Record<string, number | null> = {
            pct_proactive: d(cur.proPct, prev.proPct),
            pm_pdm_effectiveness: d(cur.pmEffKpi.value, prev.pmEffKpi.value),
            ai: d(cur.fleetAi, prev.fleetAi),
            ao: d(cur.fleetAo, prev.fleetAo),
            fleet_mtbf: d(cur.fleetMtbf, prev.fleetMtbf),
            fleet_mttr: d(cur.fleetMttr, prev.fleetMttr),
            fleet_mdt: d(cur.fleetMdt, prev.fleetMdt),
            fleet_mtbm: d(cur.fleetMtbm, prev.fleetMtbm),
            fleet_mttf: d(cur.fleetMttf, prev.fleetMttf),
            downtime_total: d(cur.downtime.totalPct, prev.downtime.totalPct),
            downtime_sched: d(cur.downtime.schedPct, prev.downtime.schedPct),
            downtime_unsched: d(cur.downtime.unschedPct, prev.downtime.unschedPct),
            failures_win: d(cur.totalFailures, prev.totalFailures),
        };
        return { kpis: list, badActors: bad as BadActor[], deltas };
    }, [filteredWos, wos, windowDays, windowLabel, assetFilterActive, filteredAssetIds]);

    // Work-execution metrics (shared spine, full WO set) — mirrored from the
    // Schedule cockpit so the numbers match exactly.
    const exec = useMemo(() => {
        const sc = computeScheduleCompliance(schedJobs);
        const pmc = computePMCompliance(schedJobs);
        const backlog = computeScheduleBacklog(schedJobs, resources);
        return {
            sc, pmc, backlog,
            kpis: [
                backlogWeeksKpi(backlog),
                complianceKpi('schedule_compliance', 'Schedule Compliance', sc, '> 90%', 'SMRP 5.4.4'),
                complianceKpi('pm_compliance', 'PM & PdM Compliance', pmc, '> 90%', 'SMRP 5.4.14'),
            ] as ReliabilityKpi[],
        };
    }, [schedJobs, resources]);

    // Register data-quality health (ISO 14224 is fundamentally about data quality).
    const health = useMemo(() => {
        const EQUIP = new Set(['EQUIPMENT', 'COMPONENT']);
        const total = filteredAssets.length;
        const equip = filteredAssets.filter(a => EQUIP.has(String(a.hierarchy_level || '').toUpperCase()));
        const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);
        return {
            total,
            critPct: pct(filteredAssets.filter(a => a.criticality).length, total),
            mfrPct: pct(equip.filter(a => a.manufacturer_id).length, equip.length),
            classPct: pct(equip.filter(a => a.asset_class).length, equip.length),
            eqNumPct: pct(equip.filter(a => a.equipment_number).length, equip.length),
            equipCount: equip.length,
        };
    }, [filteredAssets]);

    // FI-2: RAV-based maintenance cost health (SAP FI-CO / SMRP financial metrics).
    const cost = useMemo(() => {
        const rav = finRows
            .filter(r => !assetFilterActive || (r.asset_id && filteredAssetIds.has(r.asset_id)))
            .reduce((s, r) => s + (Number(r.replacement_value) || 0), 0);
        const maintWin = filteredWos.reduce((s, w) => s + (Number(w.total_actual_cost) || 0), 0);
        const pctRav = rav > 0 ? Math.round((maintWin / rav) * 1000) / 10 : null;
        // SMRP 1.5 is an ANNUAL metric — a shorter window is annualised so the
        // published top-quartile band (0.7–3.6%) applies; longer windows too.
        const pctRavAnnual = pctRav == null ? null : Math.round(pctRav * (365 / windowDays) * 10) / 10;
        const kpi: ReliabilityKpi = {
            key: 'maint_cost_pct_rav', label: 'Maint. cost % of RAV', smrpRef: 'SMRP 1.5', value: pctRavAnnual,
            display: pctRavAnnual == null ? 'N/A' : `${pctRavAnnual}%`, unit: '%', direction: 'lower-better',
            benchmark: '< 3% (top quartile 0.7–3.6%)',
            definition: `Total maintenance cost × 100 ÷ Replacement Asset Value, annualised from the ${windowLabel} window.`,
        };
        return { rav, maint12: maintWin, pctRav, pctRavAnnual, kpi };
    }, [finRows, filteredWos, assetFilterActive, filteredAssetIds, windowDays, windowLabel]);

    const { role } = useAuth();
    const smrpRole = useMemo(() => smrpRoleForAppRole(role), [role]);
    // The vital-few band: the first six. Everything else is still computed and
    // lands on the SMRP Scorecard tab (Guideline 8.0) and in the AI context.
    const bandKpis = kpis.slice(0, 6);
    const allKpis = useMemo(() => [...kpis, ...exec.kpis, cost.kpi], [kpis, exec.kpis, cost.kpi]);

    const ragColor = (k: ReliabilityKpi): string => {
        if (k.value == null) return 'text-slate-400';
        if (k.key === 'pct_proactive') return k.value >= 80 ? 'text-emerald-600' : k.value >= 60 ? 'text-amber-500' : 'text-red-500';
        if (k.key === 'pm_pdm_effectiveness') return k.value >= 70 ? 'text-emerald-600' : k.value >= 40 ? 'text-amber-500' : 'text-red-500';
        if (k.key === 'ai' || k.key === 'ao') return k.value >= 90 ? 'text-emerald-600' : k.value >= 75 ? 'text-amber-500' : 'text-red-500';
        return 'text-slate-800';
    };

    // Drill-through: seed the Modelling lab's Weibull tab with this bad actor's
    // asset — it auto-pulls the WO failure history, fits, and offers Create-PM.
    const fitWeibull = (assetId: string) => {
        const a = assets.find(x => x.id === assetId);
        navigate('/reliability-modelling', {
            state: { seed: { asset: a ? { id: a.id, name: a.name, tag: a.tag, criticality: a.criticality || '' } : null, tab: 'weibull' } },
        });
    };

    // Drill-through: open the Analyze RCA workflow scoped to this asset.
    const startRCA = (assetId: string) => {
        navigate(`/analyze?asset=${encodeURIComponent(assetId)}&tab=rca&from=reliability-metrics`);
    };

    // Drill-through: start an RCM study seeded with this asset (New Study pre-filled).
    const startRCM = (assetId: string) => {
        const a = assets.find(x => x.id === assetId);
        navigate('/rcm', { state: { seed: { asset: a ? { id: a.id, name: a.name, tag: a.tag } : { id: assetId } } } });
    };

    // R-6: flagship agent — one-click cited PM proposal for this bad actor.
    const [advisorAsset, setAdvisorAsset] = useState<{ id: string; tag: string; name: string } | null>(null);
    const openAdvisor = (assetId: string) => {
        const a = assets.find(x => x.id === assetId);
        setAdvisorAsset({ id: assetId, tag: a?.tag || '', name: a?.name || assetName(assetId) });
    };

    // The review is a paid AI call. With nothing in scope, or with every KPI still
    // N/A, the model would be reasoning about blanks — the page already says so.
    const askBlocked = filteredAssets.length === 0
        ? 'No assets in this scope — widen the filters before asking the Specialist.'
        : allKpis.every(k => k.value == null)
            ? 'Every KPI in this window is still N/A — there is no reliability history for the Specialist to read yet.'
            : '';

    const askSpecialist = () => {
        if (askBlocked) { showToast(askBlocked, 'info'); return; }
        const ctx = [
            'RELIABILITY METRICS (SMRP Best Practices, 7th Edition numbering; MTBF = operating time ÷ failures on a calendar-hour basis; MTTR = repair hours, MDT = outage window; Ai = MTBF/(MTBF+MTTR), Ao = MTBM/(MTBM+MDT))',
            `Scope: ${windowLabel} window${critFilter !== 'ALL' ? `, Criticality ${critFilter}` : ''}${classFilter !== 'ALL' ? `, Class ${classFilter}` : ''} (${filteredAssets.length} assets).`,
            kpisToAIContext(allKpis),
            badActors.length ? `Top bad actors: ${badActors.slice(0, 6).map(a => `${assetName(a.id)} (${a.rel.failures12mo} failures/12mo${a.rel.mtbfDays != null ? `, MTBF ${a.rel.mtbfDays}d` : ''}${a.rel.recurringModes.length ? `, recurring: ${a.rel.recurringModes[0].mode}×${a.rel.recurringModes[0].count}` : ''})`).join('; ')}.` : '',
        ].filter(Boolean).join('\n');
        const prompt = `As a reliability engineer, review these fleet reliability KPIs against the SMRP Best Practices 7th Edition targets cited with each metric. Be specific and cite metric numbers:\n1. The 3 biggest risks or opportunities in these numbers.\n2. A prioritised action plan — which bad actors to take to RCA, which PMs to optimise, and how to lift Proactive Work (5.4.2) and Operational Availability (Ao).\n3. Any KPI that looks unreliable due to thin data (note the MTTR basis), and what to capture to fix it.`;
        openRelantern(ctx, 'reliability', prompt);
    };

    return (
        // Viewport-locked shell (Admin's dvh formula): header, filters and the KPI
        // band stay fixed; only the active tab's body scrolls.
        <div className="ers-page-wide flex flex-col gap-3 md:gap-4 h-[calc(100dvh-11rem)] md:h-[calc(100vh-7rem)] min-h-0">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <Gauge size={20} className="text-primary-600" /> Reliability Metrics
                    </h1>
                    <p className="text-xs text-slate-500">Reliability-aligned KPIs — one source of truth for people and the Specialist AI.</p>
                </div>
                <button
                    onClick={askSpecialist}
                    disabled={loading}
                    aria-disabled={!!askBlocked}
                    title={askBlocked || 'Ask the Reliability Specialist to review these KPIs'}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold shadow-sm disabled:opacity-50 ${askBlocked ? 'text-slate-500 bg-slate-100 border border-slate-200 hover:bg-slate-200' : 'text-white bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'}`}
                >
                    {askBlocked ? <Lock size={15} /> : <Sparkles size={15} />} Ask Specialist
                </button>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20 text-slate-400"><Loader2 size={24} className="animate-spin" /></div>
            ) : error ? (
                <div className="flex items-start gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
                </div>
            ) : (
                <>
                    {/* M4 — analysis window + asset filters; everything below recomputes live */}
                    <div className="flex flex-wrap items-center gap-2 text-xs bg-white rounded-xl border border-slate-200 shadow-sm px-3 py-2.5 flex-none">
                        <span className="font-semibold text-slate-500">Window</span>
                        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                            {WINDOW_OPTIONS.map(w => (
                                <button key={w.days} onClick={() => setWindowDays(w.days)}
                                    className={`px-2.5 py-1.5 font-semibold transition-colors ${windowDays === w.days ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                                    {w.label}
                                </button>
                            ))}
                        </div>
                        <span className="font-semibold text-slate-500 ml-1">Criticality</span>
                        <select value={critFilter} onChange={e => setCritFilter(e.target.value)}
                            className="px-2 py-1.5 border border-slate-200 rounded-lg bg-white text-slate-600 focus:ring-2 focus:ring-primary-200 outline-none">
                            <option value="ALL">All</option>
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                        </select>
                        {assetClasses.length > 0 && (
                            <>
                                <span className="font-semibold text-slate-500 ml-1">Class</span>
                                <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
                                    className="px-2 py-1.5 border border-slate-200 rounded-lg bg-white text-slate-600 max-w-[160px] focus:ring-2 focus:ring-primary-200 outline-none">
                                    <option value="ALL">All</option>
                                    {assetClasses.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </>
                        )}
                        {assetFilterActive && (
                            <button onClick={() => { setCritFilter('ALL'); setClassFilter('ALL'); }}
                                className="text-primary-600 font-semibold hover:underline ml-1">Clear</button>
                        )}
                        <span className="text-slate-400 ml-auto">{filteredAssets.length} assets · {filteredWos.length} WOs</span>
                    </div>

                    {/* KPI cards — calm rule: only KPIs with real data get a tile;
                        the rest wait in ONE quiet line instead of six shouting N/As. */}
                    {(() => {
                        const withData = bandKpis.filter(k => k.value != null);
                        const awaiting = bandKpis.filter(k => k.value == null);
                        return (<>
                            {withData.length > 0 && (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                    {withData.map(k => (
                                        <div key={k.key} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 md:p-4" title={`${k.smrpRef ? k.smrpRef + ' — ' : ''}${k.definition}`}>
                                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1">
                                                {k.label}{k.smrpRef && <span className="text-slate-300">·{k.smrpRef.replace('SMRP ', '')}</span>}
                                            </div>
                                            <div className={`text-2xl md:text-3xl font-extrabold mt-1 ${ragColor(k)}`}>{k.display}</div>
                                            {(() => {
                                                const dv = deltas[k.key];
                                                if (dv == null || dv === 0) return null;
                                                const better = k.direction === 'higher-better' ? dv > 0 : dv < 0;
                                                const suffix = k.unit === '%' ? 'pp' : '';
                                                return (
                                                    <div className={`text-[10px] font-semibold mt-0.5 ${better ? 'text-emerald-600' : 'text-red-500'}`} title={`vs previous ${windowLabel}`}>
                                                        {dv > 0 ? '▲' : '▼'} {Math.abs(dv)}{suffix} vs prev
                                                    </div>
                                                );
                                            })()}
                                            {k.benchmark && <div className="text-[10px] text-slate-400 mt-0.5">benchmark {k.benchmark}</div>}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {awaiting.length > 0 && (
                                <div className="bg-slate-50/70 border border-slate-200 rounded-xl px-4 py-2.5 text-[11px] text-slate-400 font-medium">
                                    <span className="font-bold text-slate-500">Awaiting data:</span>{' '}
                                    {awaiting.map(k => k.label).join(' · ')} — these compute automatically as work orders complete and failure history accumulates.
                                </div>
                            )}
                        </>);
                    })()}

                    {/* Deep sections behind tabs — one viewport, everything a click away */}
                    <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <Tabs
                            tabs={[
                                { id: 'smrp', label: 'SMRP Scorecard', icon: BookOpen },
                                { id: 'execution', label: 'Work Execution', icon: CalendarClock },
                                { id: 'cost', label: 'Cost vs RAV', icon: Gauge },
                                { id: 'health', label: 'Register Health', icon: Layers },
                                { id: 'badActors', label: 'Bad Actors', icon: TrendingUp, badge: badActors.length },
                                { id: 'review', label: 'Failure Review', icon: ClipboardCheck },
                                { id: 'psc', label: 'Success Curve', icon: Sparkles },
                            ]}
                            activeTab={tab}
                            // Failure Review is a full working page, not a tab body —
                            // the tab is its doorway.
                            onTabChange={(id) => id === 'review' ? navigate('/failure-review') : setTab(id as typeof tab)}
                        />
                        <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4 space-y-4 bg-slate-50/50">

                    {/* Guideline 8.0 — every computed metric on the 7th-edition map,
                        by role, with the cultural self-assessment. */}
                    {tab === 'smrp' && (
                        <SmrpScorecard kpis={allKpis} deltas={deltas} defaultRole={smrpRole} windowLabel={windowLabel} />
                    )}

                    {tab === 'execution' && (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                            <CalendarClock size={15} className="text-primary-600" />
                            <h3 className="text-sm font-bold text-slate-800">Work Execution</h3>
                            <span className="text-[11px] text-slate-400">backlog &amp; compliance</span>
                            <button
                                onClick={() => navigate('/scheduling')}
                                className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
                                title="Open the Schedule cockpit to act on backlog and compliance"
                            >
                                View in Schedule <ArrowRight size={12} />
                            </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
                            {exec.kpis.map(k => {
                                const isBacklog = k.key === 'ready_backlog_weeks';
                                const color = k.value == null ? 'text-slate-400'
                                    : isBacklog ? (k.value > 6 ? 'text-amber-600' : 'text-slate-900')
                                    : (k.value >= 90 ? 'text-emerald-600' : k.value >= 70 ? 'text-amber-500' : 'text-red-500');
                                return (
                                    <div key={k.key} className="p-4" title={k.definition}>
                                        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                            {isBacklog ? <Layers size={11} /> : <CalendarClock size={11} />}{k.label}
                                        </div>
                                        <div className={`text-2xl md:text-3xl font-extrabold mt-1 ${color}`}>{k.display}</div>
                                        <div className="text-[10px] text-slate-400 mt-0.5">
                                            {isBacklog
                                                ? (exec.backlog.weeklyCapacityHours > 0 ? `${exec.backlog.readyHours}h ÷ ${exec.backlog.weeklyCapacityHours}h/wk crew · benchmark 2–4 wks` : 'No crew capacity set')
                                                : `${k.definition.replace(/\.$/, '')}`}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    )}

                    {/* Maintenance Cost vs RAV — SAP FI-CO / SMRP financial metrics (FI-2).
                        Calm rule: when there's no cost data at all, one quiet line, not
                        three N/A monoliths. */}
                    {tab === 'cost' && (cost.pctRav == null && cost.maint12 <= 0 && cost.rav <= 0 ? (
                        <div className="bg-slate-50/70 border border-slate-200 rounded-xl px-4 py-2.5 text-[11px] text-slate-400 font-medium">
                            <span className="font-bold text-slate-500">Cost KPIs awaiting data:</span>{' '}
                            Maint. cost % of RAV · Maintenance cost · Replacement Asset Value — appear once WO costs and asset RAV are captured.
                        </div>
                    ) : (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                            <Gauge size={15} className="text-emerald-600" />
                            <h3 className="text-sm font-bold text-slate-800">Maintenance Cost vs Asset Value</h3>
                            <span className="text-[11px] text-slate-400">reliability-aligned cost KPIs</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 divide-x divide-y sm:divide-y-0 divide-slate-100">
                            {(() => {
                                const fmt = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${Math.round(n)}`;
                                const pct = cost.pctRav;
                                const pctColor = pct == null ? 'text-slate-400' : pct <= 3 ? 'text-emerald-600' : pct <= 5 ? 'text-amber-500' : 'text-red-500';
                                return (
                                    <>
                                        <div className="p-4" title={cost.kpi.definition}>
                                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Maint. cost % of RAV <span className="text-slate-300">·1.5</span></div>
                                            <div className={`text-2xl font-extrabold mt-1 ${pctColor}`}>{pct == null ? 'N/A' : `${pct}%`}</div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">{windowLabel}{cost.pctRavAnnual != null && cost.pctRavAnnual !== pct ? ` · ${cost.pctRavAnnual}% annualised` : ''} · SMRP 1.5 &lt; 3% (top quartile 0.7–3.6%)</div>
                                        </div>
                                        <div className="p-4">
                                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Maintenance cost ({windowLabel})</div>
                                            <div className="text-2xl font-extrabold mt-1 text-slate-800">{cost.maint12 > 0 ? fmt(cost.maint12) : 'N/A'}</div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">actual WO cost</div>
                                        </div>
                                        <div className="p-4">
                                            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Replacement Asset Value</div>
                                            <div className="text-2xl font-extrabold mt-1 text-slate-800">{cost.rav > 0 ? fmt(cost.rav) : 'N/A'}</div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">RAV — insured/replacement</div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                    ))}

                    {/* Register Health — data quality (ISO 14224) */}
                    {tab === 'health' && (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                            <Gauge size={15} className="text-primary-600" />
                            <h3 className="text-sm font-bold text-slate-800">Register Health</h3>
                            <span className="text-[11px] text-slate-400">data quality · {health.total} assets ({health.equipCount} equipment)</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100">
                            {[
                                { label: 'Criticality set', v: health.critPct, hint: 'all assets' },
                                { label: 'Mfr linked', v: health.mfrPct, hint: 'equipment' },
                                { label: 'Class coded', v: health.classPct, hint: 'equipment · ISO 14224' },
                                { label: 'Equip # set', v: health.eqNumPct, hint: 'equipment' },
                            ].map(m => {
                                // Calm rule: data-quality gaps are chores, not emergencies —
                                // amber worst case; red is reserved for true operational alarms.
                                const color = m.v == null ? 'text-slate-400' : m.v >= 90 ? 'text-emerald-600' : m.v >= 70 ? 'text-amber-500' : 'text-amber-600';
                                return (
                                    <div key={m.label} className="p-4">
                                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{m.label}</div>
                                        <div className={`text-2xl font-extrabold mt-1 ${color}`}>{m.v == null ? 'N/A' : `${m.v}%`}</div>
                                        <div className="text-[10px] text-slate-400 mt-0.5">{m.hint}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    )}

                    {/* Bad actors */}
                    {tab === 'badActors' && (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                            <TrendingUp size={15} className="text-red-500" />
                            <h3 className="text-sm font-bold text-slate-800">Bad Actors</h3>
                            <span className="text-[11px] text-slate-400">by failure count · {windowLabel}</span>
                            <button
                                onClick={() => navigate('/analyze')}
                                className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
                                title="Open the Analyze bad-actor Pareto for the cost & downtime lens and to start an RCA"
                            >
                                Cost &amp; downtime drill <ArrowRight size={12} />
                            </button>
                        </div>
                        {badActors.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 text-sm">No corrective failures recorded in the {windowLabel} window{assetFilterActive ? ' for this filter' : ''}.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                                        <tr>
                                            <th className="text-left font-bold px-4 py-2">Asset</th>
                                            <th className="text-right font-bold px-4 py-2">Failures</th>
                                            <th className="text-right font-bold px-4 py-2">MTBF</th>
                                            <th className="text-right font-bold px-4 py-2">MTTR</th>
                                            <th className="text-left font-bold px-4 py-2">Recurring mode</th>
                                            <th className="text-left font-bold px-4 py-2">Studies</th>
                                            <th className="text-right font-bold px-4 py-2">Analyze</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {badActors.map(a => (
                                            <tr key={a.id} className="hover:bg-slate-50">
                                                <td className="px-4 py-2.5 font-semibold text-slate-800 truncate max-w-[280px]">{assetName(a.id)}</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-red-600">{a.rel.failures12mo}</td>
                                                <td className="px-4 py-2.5 text-right text-slate-600">{a.rel.mtbfDays != null ? `${a.rel.mtbfDays}d` : '—'}</td>
                                                <td className="px-4 py-2.5 text-right text-slate-600">{a.rel.mttrHours != null ? `${a.rel.mttrHours}h` : '—'}</td>
                                                <td className="px-4 py-2.5">
                                                    {a.rel.recurringModes.length > 0
                                                        ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"><Repeat size={10} /> {a.rel.recurringModes[0].mode} ×{a.rel.recurringModes[0].count}</span>
                                                        : <span className="text-slate-300">—</span>}
                                                </td>
                                                <td className="px-4 py-2.5 whitespace-nowrap">
                                                    {(() => {
                                                        const s = studyByAsset[a.id];
                                                        if (!s) return <span className="text-[11px] text-slate-300">No study yet</span>;
                                                        return (
                                                            <span className="inline-flex items-center gap-1.5">
                                                                <span className="text-[11px] text-slate-600">{s.count} stud{s.count === 1 ? 'y' : 'ies'}</span>
                                                                {s.pm && (
                                                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200" title={`PM created: ${s.pm}`}>
                                                                        ✓ PM
                                                                    </span>
                                                                )}
                                                            </span>
                                                        );
                                                    })()}
                                                </td>
                                                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                                    <div className="inline-flex items-center gap-1.5">
                                                        <button
                                                            onClick={() => openAdvisor(a.id)}
                                                            title="Reliability Advisor — auto-propose a cost-justified PM from this asset's failure history"
                                                            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg bg-primary-600 text-white hover:bg-primary-500 transition-colors"
                                                        >
                                                            <Sparkles size={12} /> Advisor
                                                        </button>
                                                        <button
                                                            onClick={() => fitWeibull(a.id)}
                                                            title="Fit a Weibull model from this asset's failure history, then create a PM"
                                                            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50 transition-colors"
                                                        >
                                                            <TrendingUp size={12} /> Fit Weibull
                                                        </button>
                                                        <button
                                                            onClick={() => startRCA(a.id)}
                                                            title={a.rel.rcaReason || 'Investigate in RCA'}
                                                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors ${a.rel.recommendRCA ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                                        >
                                                            <AlertTriangle size={12} /> RCA
                                                        </button>
                                                        <button
                                                            onClick={() => startRCM(a.id)}
                                                            title="Start an RCM study for this asset (define functions, failures & maintenance strategy)"
                                                            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                                                        >
                                                            <Wrench size={12} /> RCM
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    )}

                    {/* RF-01: FRACAS — confirm failure coding, queue that empties */}

                    {/* Success-centric layer: Potential Success Curve (Golden Spot / MTOP /
                        MTTRg / SR) — the complement to the failure-centric KPIs above. */}
                    {tab === 'psc' && <PSCPanel />}

                    <p className="text-[11px] text-slate-400">
                        Metrics computed over the {windowLabel} window via the shared reliability engine, numbered and
                        targeted per SMRP Best Practices, 7th Edition. Operating time is calendar hours less recorded downtime
                        (no run-hour meters). Adjust the window or filters above to re-analyze. Hover a KPI for its definition.
                    </p>
                        </div>
                    </div>
                </>
            )}

            {advisorAsset && (
                <ReliabilityAdvisorModal
                    asset={advisorAsset}
                    onClose={() => setAdvisorAsset(null)}
                />
            )}
        </div>
    );
};

export default ReliabilityMetricsPage;
