/**
 * smrpCatalog — the SMRP Best Practices, 7th Edition metric registry.
 *
 * One place that knows, for every SMRP metric IREAMS computes or references:
 * its number, pillar, formula, best-in-class target, whether it leads or lags,
 * and which roles the standard recommends it to (Guideline 8.0 "Getting Started
 * with Metrics"). KPI tiles, tooltips,
 * the by-role view and the Specialist AI context all label from here, so the
 * product cites the same metric numbers the standard does.
 *
 * Reference: SMRP Best Practices, 7th Edition (© Society for Maintenance &
 * Reliability Professionals). Metric numbers, formulas and best-in-class values
 * are cited as facts about the standard, in this file's own wording; the
 * document itself is not reproduced here. "No target" means the committee
 * declined to set one and asks plants to trend instead. IREAMS is not
 * affiliated with, certified by, or endorsed by SMRP.
 */

export type SmrpRole =
    | 'leadership' | 'maintenance-manager' | 'crew-leader'
    | 'reliability-engineer' | 'planner' | 'scheduler' | 'materials';

export const SMRP_ROLE_LABELS: Record<SmrpRole, string> = {
    'leadership': 'Leadership',
    'maintenance-manager': 'Maintenance Manager',
    'crew-leader': 'Crew Leader / Supervisor',
    'reliability-engineer': 'Reliability Engineer',
    'planner': 'Planner',
    'scheduler': 'Scheduler',
    'materials': 'Materials Management',
};

/** Guideline 8.0 culture stages: Reactive → Mix → Proactive → Reliability Excellence. */
export type CultureStage = 'R' | 'M' | 'P' | 'E';
export const CULTURE_LABELS: Record<CultureStage, string> = {
    R: 'Reactive workload', M: 'Reactive / proactive mix', P: 'Mostly proactive', E: 'Reliability excellence',
};

export interface SmrpMetricDef {
    id: string;                      // '3.5.1'  (Guideline entries: 'G6.0-Ai')
    name: string;
    pillar: 1 | 2 | 3 | 4 | 5;
    indicator: 'leading' | 'lagging' | 'both';
    roles: SmrpRole[];
    formula: string;
    /** Best-in-class / target text as published; undefined = committee set none. */
    target?: string;
    /** Guideline 8.0 recommended starter set for organisations new to metrics. */
    starter?: boolean;
}

const M = (d: SmrpMetricDef) => d;

export const SMRP_METRICS: Record<string, SmrpMetricDef> = Object.fromEntries(([
    // ── Pillar 1 — Business & Management ─────────────────────────────────
    M({ id: '1.1', name: 'Ratio of RAV to Craft-Wage Headcount', pillar: 1, indicator: 'lagging', roles: ['maintenance-manager'], formula: 'RAV ($) ÷ craft-wage headcount (FTE)' }),
    M({ id: '1.3', name: 'Maintenance Unit Cost', pillar: 1, indicator: 'lagging', roles: ['leadership', 'maintenance-manager'], formula: 'Total maintenance cost ÷ standard units produced', starter: true }),
    M({ id: '1.4', name: 'Stocked MRO Inventory Value as % of RAV', pillar: 1, indicator: 'lagging', roles: ['leadership', 'materials'], formula: 'Stocked MRO value × 100 ÷ RAV', target: '< 1.5% (top quartile 0.3–1.5%)' }),
    M({ id: '1.5', name: 'Total Maintenance Cost as % of RAV', pillar: 1, indicator: 'lagging', roles: ['leadership', 'maintenance-manager'], formula: 'Total maintenance cost × 100 ÷ RAV (annual)', target: '< 3% (top quartile 0.7–3.6%)' }),

    // ── Pillar 2 — Manufacturing Process Reliability ─────────────────────
    M({ id: '2.1.1', name: 'Overall Equipment Effectiveness (OEE)', pillar: 2, indicator: 'lagging', roles: ['leadership', 'reliability-engineer'], formula: 'Availability × Performance Efficiency × Quality Rate', target: '85–100% batch · 90–100% discrete · 95–100% continuous (A > 90%, P > 95%, Q > 99%)', starter: true }),
    M({ id: '2.1.2', name: 'Total Effective Equipment Performance (TEEP)', pillar: 2, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Utilization Time × Availability × Performance × Quality' }),
    M({ id: '2.2', name: 'Availability', pillar: 2, indicator: 'lagging', roles: ['leadership', 'reliability-engineer'], formula: 'Uptime ÷ (Total Available Time − Idle Time) × 100' }),
    M({ id: '2.3', name: 'Uptime', pillar: 2, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Total Available Time − (Idle Time + Total Downtime)', target: '> 98% continuous · > 95% batch' }),
    M({ id: '2.4', name: 'Idle Time', pillar: 2, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Administrative idle + no demand + no feedstock + no raw material', target: 'less is better — paid-for capacity not used' }),
    M({ id: '2.5', name: 'Utilization Time', pillar: 2, indicator: 'lagging', roles: ['leadership', 'reliability-engineer'], formula: '(Total Available Time − Idle Time) ÷ Total Available Time × 100' }),

    // ── Pillar 3 — Equipment Reliability ─────────────────────────────────
    M({ id: '3.1', name: 'Systems Covered by Criticality Analysis', pillar: 3, indicator: 'both', roles: ['reliability-engineer'], formula: 'Systems with a criticality analysis × 100 ÷ all systems', starter: true }),
    M({ id: '3.2', name: 'Total Downtime', pillar: 3, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Scheduled + unscheduled downtime (÷ Total Available Time for %)', target: '< 0.5–2% maintenance-caused downtime (top quartile)' }),
    M({ id: '3.3', name: 'Scheduled Downtime', pillar: 3, indicator: 'lagging', roles: ['maintenance-manager'], formula: 'Downtime on the finalized weekly schedule ÷ Total Available Time' }),
    M({ id: '3.4', name: 'Unscheduled Downtime', pillar: 3, indicator: 'lagging', roles: ['maintenance-manager', 'materials'], formula: 'Downtime not on the weekly schedule ÷ Total Available Time' }),
    M({ id: '3.5.1', name: 'Mean Time Between Failures (MTBF)', pillar: 3, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Operating time ÷ number of failures (repairable assets)', target: 'trend upward — no universal value', starter: true }),
    M({ id: '3.5.2', name: 'Mean Time to Repair or Replace (MTTR)', pillar: 3, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Total repair/replace time ÷ repair events (repair start → repair complete)', target: 'trend downward — no universal value' }),
    M({ id: '3.5.3', name: 'Mean Time Between Maintenance (MTBM)', pillar: 3, indicator: 'lagging', roles: ['maintenance-manager', 'reliability-engineer'], formula: 'Operating time ÷ maintenance actions that interrupted the function', target: 'trend upward — no universal value' }),
    M({ id: '3.5.4', name: 'Mean Downtime (MDT)', pillar: 3, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Total downtime ÷ downtime events (failure → back in service, delays included)', target: 'trend downward — no universal value' }),
    M({ id: '3.5.5', name: 'Mean Time to Failures (MTTF)', pillar: 3, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Operating time ÷ non-repairable items run to failure (IREAMS: failures closed with the REPLACED remedy)', target: 'trend upward — no universal value' }),

    // ── Pillar 4 — Organization & Leadership ─────────────────────────────
    M({ id: '4.1', name: 'Rework', pillar: 4, indicator: 'both', roles: ['crew-leader'], formula: 'Corrective hours identified as rework × 100 ÷ total maintenance labor hours', target: 'very low — trend downward' }),
    M({ id: '4.2.2', name: 'Maintenance Training Hours', pillar: 4, indicator: 'both', roles: ['maintenance-manager'], formula: 'Formal training hours ÷ maintenance employees', target: '80 hours per employee per year' }),

    // ── Pillar 5 — Work Management ───────────────────────────────────────
    M({ id: '5.1.1', name: 'Corrective Maintenance Cost', pillar: 5, indicator: 'both', roles: ['maintenance-manager'], formula: 'Corrective maintenance cost × 100 ÷ total maintenance cost' }),
    M({ id: '5.1.2', name: 'Corrective Maintenance Hours', pillar: 5, indicator: 'both', roles: ['crew-leader'], formula: 'Corrective hours × 100 ÷ total maintenance labor hours', target: '55% (15% from PM finds · 35% from PdM finds · < 5% after failure)' }),
    M({ id: '5.1.4', name: 'Preventive Maintenance (PM) Hours', pillar: 5, indicator: 'both', roles: ['maintenance-manager'], formula: 'PM hours × 100 ÷ total maintenance labor hours', target: '15% of all maintenance hours' }),
    M({ id: '5.1.6', name: 'Condition Based Maintenance Hours', pillar: 5, indicator: 'both', roles: ['crew-leader'], formula: 'CBM hours × 100 ÷ total maintenance labor hours', target: '15% of all maintenance hours' }),
    M({ id: '5.3.1', name: 'Planned Work', pillar: 5, indicator: 'both', roles: ['crew-leader', 'planner'], formula: 'Planned work hours executed × 100 ÷ total maintenance labor hours', target: '> 90%', starter: true }),
    M({ id: '5.3.2', name: 'Unplanned Work', pillar: 5, indicator: 'leading', roles: ['crew-leader'], formula: 'Unplanned work hours × 100 ÷ total maintenance labor hours', target: '< 10%' }),
    M({ id: '5.3.3', name: 'Actual Cost to Planning Estimate', pillar: 5, indicator: 'lagging', roles: ['planner'], formula: 'Actual cost ÷ planned cost × 100', target: '1st quartile ±10% (90–110% of estimate)', starter: true }),
    M({ id: '5.3.4', name: 'Actual Hours to Planning Estimate', pillar: 5, indicator: 'lagging', roles: ['planner'], formula: 'Actual labor hours ÷ planned labor hours × 100', target: '±10% (90–110% of estimate)' }),
    M({ id: '5.3.5', name: 'Planning Variance Index', pillar: 5, indicator: 'lagging', roles: ['maintenance-manager'], formula: 'Planned WOs closed within ±10% of planned cost × 100 ÷ planned WOs closed', target: 'trend toward 100% within ±10%' }),
    M({ id: '5.4.1', name: 'Reactive Work', pillar: 5, indicator: 'both', roles: ['crew-leader'], formula: 'Hours that broke into the weekly schedule × 100 ÷ total maintenance labor hours', target: '< 10%', starter: true }),
    M({ id: '5.4.2', name: 'Proactive Work', pillar: 5, indicator: 'both', roles: ['crew-leader'], formula: '(PM + PdM + corrective-from-structured-program hours) × 100 ÷ total maintenance labor hours', target: '> 80%', starter: true }),
    M({ id: '5.4.3', name: 'Schedule Compliance – Hours', pillar: 5, indicator: 'leading', roles: ['scheduler'], formula: 'Scheduled hours performed × 100 ÷ total hours available to schedule', target: '> 90%' }),
    M({ id: '5.4.4', name: 'Schedule Compliance – Work Orders', pillar: 5, indicator: 'leading', roles: ['crew-leader', 'scheduler'], formula: 'WOs performed as scheduled × 100 ÷ WOs on the weekly schedule', target: '> 90%' }),
    M({ id: '5.4.5', name: 'Standing Work Orders', pillar: 5, indicator: 'leading', roles: ['planner'], formula: 'Hours on standing WOs × 100 ÷ total maintenance labor hours', target: '< 5% (1–3.5% good · 3.6–5.5% caution · 5.6–10% warning)' }),
    M({ id: '5.4.6', name: 'Work Order Aging', pillar: 5, indicator: 'both', roles: ['crew-leader', 'planner'], formula: "Today's date − WO creation date, bucketed by age", target: 'safety ≤ 1 day · high 1 wk · medium 2–3 wks · low 3–4 wks to schedule' }),
    M({ id: '5.4.7', name: 'Work Order Cycle Time', pillar: 5, indicator: 'lagging', roles: ['planner'], formula: 'WO completion date − WO creation date (days)' }),
    M({ id: '5.4.8', name: 'Planned Backlog', pillar: 5, indicator: 'both', roles: ['maintenance-manager', 'crew-leader', 'planner'], formula: '(Planned work + ready work hours) ÷ crew capacity per week', target: '4–6 weeks total (2–4 ready)' }),
    M({ id: '5.4.9', name: 'Ready Backlog', pillar: 5, indicator: 'both', roles: ['maintenance-manager', 'crew-leader', 'planner', 'scheduler'], formula: 'Ready work hours ÷ crew capacity per week', target: '2–4 weeks' }),
    M({ id: '5.4.10', name: 'PM & PdM Work Order Compliance', pillar: 5, indicator: 'leading', roles: ['maintenance-manager', 'crew-leader'], formula: '([actual ÷ planned frequency] × 100) − 100, grouped by variance band and criticality', target: '≥ 90% within the 10% rule', starter: true }),
    M({ id: '5.4.11', name: 'PM & PdM Work Orders Overdue', pillar: 5, indicator: 'both', roles: ['crew-leader', 'planner'], formula: 'Overdue PM/PdM WOs × 100 ÷ active PM/PdM WOs, by days or hours past due', target: '< 5%' }),
    M({ id: '5.4.12', name: 'PM & PdM Yield', pillar: 5, indicator: 'both', roles: ['reliability-engineer', 'crew-leader'], formula: 'Corrective hours identified from PM/PdM ÷ PM/PdM hours', target: 'mid-range — very low or very high warrants review' }),
    M({ id: '5.4.13', name: 'PM & PdM Effectiveness', pillar: 5, indicator: 'both', roles: ['reliability-engineer', 'crew-leader'], formula: 'Necessary PM/PdM corrective WOs ÷ PM/PdM corrective WOs written', target: 'trend upward — varies by plant', starter: true }),
    M({ id: '5.4.14', name: 'PM & PdM Compliance', pillar: 5, indicator: 'both', roles: ['reliability-engineer'], formula: 'PM/PdM WOs completed by due date ÷ PM/PdM WOs due', target: '> 90%' }),
    M({ id: '5.5.2', name: 'Craft Worker to Planner Ratio', pillar: 5, indicator: 'leading', roles: ['maintenance-manager'], formula: 'Maintenance craft workers ÷ planners', target: '20:1' }),
    M({ id: '5.5.7', name: 'Overtime Maintenance Cost', pillar: 5, indicator: 'lagging', roles: ['maintenance-manager'], formula: 'Overtime labor cost × 100 ÷ total maintenance labor cost', target: '< 5%' }),
    M({ id: '5.5.31', name: 'Stores Inventory Turns', pillar: 5, indicator: 'lagging', roles: ['materials'], formula: 'Value of stock purchased ÷ value of stock on hand', target: '> 1.0 total · > 3.0 without critical spares', starter: true }),
    M({ id: '5.5.33', name: 'Stock Outs', pillar: 5, indicator: 'leading', roles: ['materials'], formula: 'Inventory requests with stock out × 100 ÷ inventory requests', target: '< 2%' }),
    M({ id: '5.5.34', name: 'Inactive Stock', pillar: 5, indicator: 'lagging', roles: ['materials'], formula: 'Inactive non-critical stock records × 100 ÷ non-critical stock records', target: '< 1%' }),
    M({ id: '5.5.38', name: 'Maintenance Material Cost', pillar: 5, indicator: 'both', roles: ['maintenance-manager'], formula: 'Maintenance material cost × 100 ÷ total maintenance cost', target: '50%' }),
    M({ id: '5.6.1', name: 'Wrench Time', pillar: 5, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'Wrench-time observations ÷ total observations (work sampling)', target: '50–55%' }),

    // ── Guideline 6.0 — the two availabilities IREAMS derives from WO history ──
    M({ id: 'G6.0-Ai', name: 'Inherent Availability (Ai)', pillar: 3, indicator: 'lagging', roles: ['reliability-engineer'], formula: 'MTBF ÷ (MTBF + MTTR) × 100 — design-driven, corrective repair time only' }),
    M({ id: 'G6.0-Ao', name: 'Operational Availability (Ao)', pillar: 3, indicator: 'lagging', roles: ['leadership', 'reliability-engineer'], formula: 'MTBM ÷ (MTBM + MDT) × 100 — preventive interruptions and delays included' }),
] as SmrpMetricDef[]).map(d => [d.id, d]));

/** 'SMRP 3.5.1' — the label the KPI tiles and AI context carry. */
export const smrpRef = (id: string): string => (id.startsWith('G') ? `SMRP ${id.replace('-', ' ')}` : `SMRP ${id}`);

/** Guideline 8.0 — recommended starter set, in the committee's order. */
export const SMRP_STARTER_SET = ['1.3', '2.1.1', '3.1', '3.5.1', '5.3.1', '5.3.3', '5.4.1', '5.4.2', '5.4.10', '5.4.13', '5.5.31'];

/** Guideline 8.0 — "Recommended Metrics by Role" (order as published). */
export const SMRP_ROLE_METRICS: Record<SmrpRole, string[]> = {
    'leadership': ['1.3', '1.5', '2.1.1', '2.2'],
    'maintenance-manager': ['1.1', '3.4', '5.1.1', '5.1.4', '5.4.10', '5.5.7', '5.5.38'],
    'crew-leader': ['4.1', '5.4.1', '5.4.2', '5.4.4', '5.4.6', '5.4.9', '5.4.11'],
    'reliability-engineer': ['2.2', '3.1', '3.5.1', '3.5.2', '5.4.13'],
    'materials': ['5.5.31', '5.5.33'],
    'planner': ['5.3.1', '5.3.3', '5.3.5', '5.4.8', '5.4.11'],
    'scheduler': ['5.4.3', '5.4.9'],
};

/** Metric 2.1.1 best-in-class OEE by process type (7th Edition). */
export type ProcessType = 'batch' | 'discrete' | 'continuous';
export const OEE_TARGETS: Record<ProcessType, { oee: number; label: string }> = {
    batch: { oee: 85, label: 'Batch manufacturing' },
    discrete: { oee: 90, label: 'Continuous discrete manufacturing' },
    continuous: { oee: 95, label: 'Continuous process' },
};
export const OEE_LEG_TARGETS = { availability: 90, performance: 95, quality: 99 };

// ── Culture check — IREAMS' own questionnaire, guided by Guideline 8.0 ───────
// Guideline 8.0 says metric selection should match the organisation's culture
// (reactive → mix → proactive → excellence) and points at four evidence areas:
// how much work is reactive, whether the CMMS is the system of record, whether
// planning and scheduling are disciplined, and whether the PM programme is
// measured and acted on. The questions below are IREAMS' own reading of those
// areas; they are not SMRP's questionnaire.
export interface CultureQuestion {
    id: string;
    group: string;
    text: string;
    /** Options in display order; each scores one stage. */
    options: { label: string; stage: 'R' | 'M' | 'P' }[];
}

const YES_NO = (yes = 'Yes', no = 'No'): CultureQuestion['options'] => [{ label: no, stage: 'R' }, { label: yes, stage: 'P' }];
const COVERAGE: CultureQuestion['options'] = [{ label: 'Few', stage: 'R' }, { label: 'Most', stage: 'M' }, { label: 'Nearly all', stage: 'P' }];

export const SMRP_CULTURE_QUESTIONS: CultureQuestion[] = [
    { id: 'reactive_share', group: 'Workload', text: 'How much of the crew\'s time goes to breakdowns and urgent repairs?', options: [{ label: 'Most of it', stage: 'R' }, { label: 'About half', stage: 'M' }, { label: 'A minority', stage: 'P' }] },
    { id: 'schedule_breakins', group: 'Workload', text: 'How often does emergency work push scheduled jobs out of the week?', options: [{ label: 'Every week', stage: 'R' }, { label: 'Some weeks', stage: 'M' }, { label: 'Rarely', stage: 'P' }] },
    { id: 'cmms_record', group: 'Data foundation', text: 'Is every maintenance job, including quick fixes, recorded as a work order in IREAMS?', options: YES_NO() },
    { id: 'register_detail', group: 'Data foundation', text: 'How many assets carry make, model and serial number in the register?', options: COVERAGE },
    { id: 'criticality', group: 'Data foundation', text: 'How many assets have a criticality ranking?', options: COVERAGE },
    { id: 'bom', group: 'Data foundation', text: 'How many assets have a usable bill of materials?', options: COVERAGE },
    { id: 'cost_capture', group: 'Data foundation', text: 'Are labour hours and parts booked to the work order, so costs land on the asset?', options: YES_NO() },
    { id: 'failure_coding', group: 'Data foundation', text: 'Are failures coded (mode, cause, downtime) when the job closes?', options: [{ label: 'Rarely', stage: 'R' }, { label: 'Sometimes', stage: 'M' }, { label: 'Routinely', stage: 'P' }] },
    { id: 'planner_role', group: 'Planning & scheduling', text: 'Is there a dedicated planner and a dedicated scheduler, or does the supervisor do both?', options: [{ label: 'Supervisor does both', stage: 'R' }, { label: 'One dedicated role', stage: 'M' }, { label: 'Both dedicated', stage: 'P' }] },
    { id: 'planned_share', group: 'Planning & scheduling', text: 'How much craft work goes through a job plan before it starts?', options: COVERAGE },
    { id: 'schedule_review', group: 'Planning & scheduling', text: 'Is schedule compliance reviewed each week and the misses acted on?', options: [{ label: 'Not measured', stage: 'R' }, { label: 'Measured, rarely acted on', stage: 'M' }, { label: 'Measured and acted on', stage: 'P' }] },
    { id: 'ops_at_scheduling', group: 'Planning & scheduling', text: 'Do operations and site leadership attend the weekly scheduling meeting?', options: YES_NO() },
    { id: 'pm_compliance', group: 'PM programme', text: 'Is PM completion against due date tracked?', options: YES_NO() },
    { id: 'pm_findings', group: 'PM programme', text: 'Do PM findings turn into corrective work orders?', options: [{ label: 'Rarely', stage: 'R' }, { label: 'Sometimes', stage: 'M' }, { label: 'Routinely', stage: 'P' }] },
    { id: 'pm_review', group: 'PM programme', text: 'Are PM tasks and intervals reviewed against failure history?', options: YES_NO() },
    { id: 'kpi_definitions', group: 'PM programme', text: 'Do the site\'s KPI definitions follow a published standard (SMRP / EN 15341)?', options: YES_NO() },
];

export interface CultureScore {
    counts: Record<'R' | 'M' | 'P', number>;
    answered: number;
    stage: CultureStage;
    narrative: string;
}

/**
 * Score the self-assessment the way the guideline does: count each stage,
 * the plurality wins; a Proactive plurality with no Reactive answers reads as
 * Reliability Excellence. Ties fall to the more reactive stage — the honest
 * reading when the evidence is split.
 */
export function scoreCulture(answers: Record<string, number | undefined>): CultureScore {
    const counts = { R: 0, M: 0, P: 0 };
    let answered = 0;
    for (const q of SMRP_CULTURE_QUESTIONS) {
        const i = answers[q.id];
        if (i == null || !q.options[i]) continue;
        counts[q.options[i].stage]++;
        answered++;
    }
    let stage: CultureStage = 'R';
    if (answered > 0) {
        if (counts.P > counts.M && counts.P > counts.R) stage = counts.R === 0 ? 'E' : 'P';
        else if (counts.M > counts.R && counts.M >= counts.P) stage = 'M';
        else stage = 'R';
    }
    const narrative = answered === 0
        ? 'Answer the questions to place the organisation on the SMRP culture scale.'
        : stage === 'R'
            ? 'A reactive culture is still in place. Start with the lagging baseline metrics (cost, OEE, MTBF, reactive work) and one or two improvement areas.'
            : stage === 'M'
                ? 'A reactive culture remains but the transition toward proactive work is under way. Track performance and attach corrective action plans to the metrics you already use.'
                : stage === 'P'
                    ? 'Mostly proactive. Use leading metrics with corrective activities and verify each improvement.'
                    : 'Reliability excellence. Metrics now drive strategic continuous improvement — design for reliability.';
    return { counts, answered, stage, narrative };
}

/**
 * Which computed metrics to focus on at a given culture stage. Guideline 8.0's
 * principle: start with the lagging baseline (the starter set), add leading
 * metrics as the organisation turns proactive. Our rule, not the standard's table.
 */
export function metricsForStage(stage: CultureStage): SmrpMetricDef[] {
    const all = Object.values(SMRP_METRICS);
    if (stage === 'R') return all.filter(m => m.starter);
    if (stage === 'M') return all.filter(m => m.starter || m.indicator === 'both');
    return all.filter(m => m.indicator !== 'lagging');
}
