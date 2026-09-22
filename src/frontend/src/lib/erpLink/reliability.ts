/**
 * Reliability over the live link: PM cycle revisions to SAP maintenance plans.
 *
 * A study changes a schedule's cadence in IREAMS (the Specialist's writeback
 * keeps the trail in origin.interval_revisions); a planner changes it by
 * hand. Either way, when the schedule came from SAP (origin.plan) the change
 * belongs on SAP's maintenance plan — and an interval change to a live plan
 * is not a background job (plan §2.7): the document is queued, a person
 * approves it, then it is sent. The outbox constraint refuses a reliability
 * row as 'sent' without approved_at; this module only decides what to queue.
 *
 * Supersession, not exactly-once (plan §2.1): a second change before the
 * first is approved replaces the waiting document rather than joining it.
 *
 * What is NOT carried, and says so on the row: strategy plans (the cycle
 * lives on the maintenance strategy, IP11 — change the package there) and
 * meter-based cycles (counter plans; a later phase).
 *
 * Criticality reaches SAP's ABC indicator through the master-data record
 * (toEquipmentDoc), owned by the master-data rule; it is not a second
 * document here.
 *
 * Pure. The worker (erp-sync) carries a byte-identical copy; see odata.ts.
 */

export type SapCycleUnit = 'TAG' | 'WCH' | 'MON' | 'JHR';

export interface SapCycle { MaintPlanCycle: number; MaintPlanCycleUnit: SapCycleUnit }

/** IREAMS cadence units → SAP cycle units. Meter units have no time unit and return null. */
export function sapCycleOf(interval: number | null | undefined, unit: string | null | undefined): SapCycle | null {
    const n = Number(interval);
    if (!Number.isFinite(n) || n <= 0) return null;
    const u = String(unit ?? '').trim().toUpperCase();
    const map: Record<string, SapCycleUnit> = {
        DAY: 'TAG', DAYS: 'TAG', TAG: 'TAG', D: 'TAG',
        WEEK: 'WCH', WEEKS: 'WCH', WCH: 'WCH', W: 'WCH',
        MONTH: 'MON', MONTHS: 'MON', MON: 'MON', M: 'MON',
        YEAR: 'JHR', YEARS: 'JHR', JHR: 'JHR', Y: 'JHR',
    };
    const su = map[u];
    return su ? { MaintPlanCycle: Math.round(n), MaintPlanCycleUnit: su } : null;
}

export const cycleEquals = (a: SapCycle | null | undefined, b: SapCycle | null | undefined): boolean =>
    !!a && !!b && a.MaintPlanCycle === b.MaintPlanCycle && a.MaintPlanCycleUnit === b.MaintPlanCycleUnit;

export const cycleText = (c: SapCycle | null | undefined): string =>
    c ? `${c.MaintPlanCycle} ${({ TAG: 'days', WCH: 'weeks', MON: 'months', JHR: 'years' } as const)[c.MaintPlanCycleUnit]}` : '—';

export interface LinkSchedule {
    id: string;
    code: string | null;
    title: string | null;
    description: string | null;
    frequency_interval: number | null;
    frequency_unit: string | null;
    schedule_type: string | null;
    active: boolean | null;
    origin: Record<string, unknown> | null;
    updated_at: string;
}

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** The SAP keys a schedule carries from its import, if any. */
export function sapKeysOf(sch: LinkSchedule): { plan: string; item: string; strategy: string } {
    const o = sch.origin ?? {};
    return { plan: s(o.plan), item: s(o.item), strategy: s(o.strategy) };
}

/** The cycle SAP was last told, as the link stamped it on origin.sap_sync.sent_cycle. */
export function sentCycleOf(sch: LinkSchedule): SapCycle | null {
    const sync = ((sch.origin ?? {}).sap_sync ?? {}) as Record<string, unknown>;
    const c = sync.sent_cycle as Partial<SapCycle> | undefined;
    return c && typeof c.MaintPlanCycle === 'number' && typeof c.MaintPlanCycleUnit === 'string'
        ? { MaintPlanCycle: c.MaintPlanCycle, MaintPlanCycleUnit: c.MaintPlanCycleUnit as SapCycleUnit } : null;
}

export type Decision =
    | { kind: 'send'; cycle: SapCycle; plan: string; reason: string }
    | { kind: 'in_sync' }
    | { kind: 'skip'; reason: string; stat: 'out_not_from_sap' | 'out_strategy_plan_skipped' | 'out_meter_cycle_skipped' | 'out_inactive' };

/** The latest interval revision's words, for the approval card: "extend interval, Weibull B10 on 2026-09-20". */
export function latestRevisionText(sch: LinkSchedule): string {
    const revs = Array.isArray(sch.origin?.interval_revisions) ? (sch.origin!.interval_revisions as Record<string, unknown>[]) : [];
    if (revs.length === 0) return '';
    const r = [...revs].sort((a, b) => s(a.applied_at).localeCompare(s(b.applied_at)))[revs.length - 1];
    const why = [s(r.recommendation_type).replace(/_/g, ' '), s(r.basis)].filter(Boolean).join(', ');
    const when = s(r.applied_at).slice(0, 10);
    return [why, when ? `on ${when}` : ''].filter(Boolean).join(' ');
}

/** Whether, and what, to queue for a schedule that changed. */
export function decide(sch: LinkSchedule): Decision {
    const { plan, strategy } = sapKeysOf(sch);
    if (!plan) return { kind: 'skip', reason: 'This schedule did not come from a SAP maintenance plan; nothing in SAP to update.', stat: 'out_not_from_sap' };
    if (sch.active === false) return { kind: 'skip', reason: `Schedule ${s(sch.code) || sch.id} is inactive in IREAMS; SAP plan ${plan} is left as it is.`, stat: 'out_inactive' };
    if (strategy) return { kind: 'skip', reason: `SAP plan ${plan} is a strategy plan: its cycle lives on maintenance strategy ${strategy} (IP11). Change the package there; IREAMS cannot set it on the plan.`, stat: 'out_strategy_plan_skipped' };
    const cycle = sapCycleOf(sch.frequency_interval, sch.frequency_unit);
    if (!cycle) return { kind: 'skip', reason: `Schedule ${s(sch.code) || sch.id} runs on ${s(sch.frequency_unit) || 'a meter'}: a counter-based plan, not carried yet.`, stat: 'out_meter_cycle_skipped' };
    const sent = sentCycleOf(sch);
    if (cycleEquals(sent, cycle)) return { kind: 'in_sync' };
    const why = latestRevisionText(sch);
    const reason = `Cycle ${sent ? cycleText(sent) : '(as imported)'} → ${cycleText(cycle)} on SAP plan ${plan}${why ? ` — ${why}` : ''}. Needs a person's approval before it is sent.`;
    return { kind: 'send', cycle, plan, reason };
}

export interface MaintenancePlanDoc {
    MaintenancePlan?: string;
    MaintenancePlanText?: string;    // 40 characters
    MaintPlanCycle: number;
    MaintPlanCycleUnit: SapCycleUnit;
    MaintenancePlanCategory?: string;
    LastChangeDateTime?: string;
}

export const PLAN_TEXT_MAX = 40;

export function toMaintenancePlanDoc(sch: LinkSchedule, plan: string, cycle: SapCycle): MaintenancePlanDoc {
    const text = (s(sch.title) || s(sch.description) || s(sch.code)).slice(0, PLAN_TEXT_MAX);
    const doc: MaintenancePlanDoc = { MaintenancePlan: plan, MaintPlanCycle: cycle.MaintPlanCycle, MaintPlanCycleUnit: cycle.MaintPlanCycleUnit };
    if (text) doc.MaintenancePlanText = text;
    return doc;
}

/** The stamp the link leaves on origin.sap_sync after a successful send — read-modify-write, merging only this key. */
export function sentStamp(origin: Record<string, unknown> | null, cycle: SapCycle, sentIn: string, now: string): Record<string, unknown> {
    const o = origin ?? {};
    const prior = (o.sap_sync ?? {}) as Record<string, unknown>;
    return { ...o, sap_sync: { ...prior, sent_at: now, sent_in: sentIn, sent_cycle: cycle } };
}
