/**
 * What IREAMS changed on a schedule SAP already has — and whether SAP knows.
 *
 * The Migration Cockpit creates and never updates, so a schedule that came
 * from SAP and was then changed by a study cannot go back through the load.
 * It goes to the planner instead, and the planner needs four things: which
 * SAP object, what SAP currently has, what IREAMS now says, and why. All four
 * are already on the schedule:
 *
 *   - origin.plan / item / task_list      the SAP keys, stamped on import
 *   - origin.interval_revisions[]         every cadence change the Specialist
 *                                         applied: from → to, basis, when, who
 *   - origin.study_id / study_title       the study that produced the schedule
 *   - origin.sap_sync                     when it was last sent to SAP, and
 *                                         when a planner confirmed it there
 *
 * Nothing is computed that is not on the row. "What SAP has" is the cadence
 * before the first revision IREAMS applied; if there are no revisions, SAP
 * and IREAMS agree and the schedule is in sync.
 */

import type { SrcSchedule } from '../sapLoad/build';
import { cadenceLabel, sapCycleUnit, type Cadence } from '../../eam/lib/sapCycles';

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

export interface IntervalRevision {
    proposalId: string;
    type: string;
    from: Cadence | null;
    /** The Specialist writes the target in days. */
    toDays: number | null;
    basis: string;
    appliedAt: string;
    appliedBy: string;
}

export interface SapSync {
    sentAt: string | null;
    sentIn: string | null;
    confirmedAt: string | null;
    confirmedBy: string | null;
}

export interface ScheduleChange {
    id: string;
    code: string;
    title: string;
    sap: { plan: string; item: string; taskList: string };
    study: { id: string; title: string } | null;
    /** Cadence SAP holds — before the first revision — or the current one when nothing changed. */
    sapCadence: Cadence | null;
    /** Cadence IREAMS holds now. */
    cadence: Cadence | null;
    revisions: IntervalRevision[];
    sync: SapSync;
    /** true when SAP has been told of every change (confirmed after the last revision), or nothing changed. */
    inSync: boolean;
    /** 'unchanged' | 'changed' | 'sent' | 'confirmed' — the planner-facing state. */
    state: 'unchanged' | 'changed' | 'sent' | 'confirmed';
}

/** A revision as the writeback stored it, read defensively. */
function revisionOf(r: Record<string, unknown>): IntervalRevision {
    const unit = sapCycleUnit(s(r.from_unit));
    const from = Number(r.from_interval);
    return {
        proposalId: s(r.proposal_id),
        type: s(r.recommendation_type),
        from: unit && from > 0 ? { interval: from, unit } : null,
        toDays: Number.isFinite(Number(r.to_days)) && Number(r.to_days) > 0 ? Number(r.to_days) : null,
        basis: s(r.basis),
        appliedAt: s(r.applied_at),
        appliedBy: s(r.applied_by),
    };
}

export function scheduleChange(pm: SrcSchedule): ScheduleChange {
    const o = (pm.origin ?? {}) as Record<string, unknown>;
    const revs = (Array.isArray(o.interval_revisions) ? o.interval_revisions : [])
        .map(r => revisionOf((r ?? {}) as Record<string, unknown>))
        .sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
    const unit = sapCycleUnit(pm.frequency_unit ?? '');
    const n = Number(pm.frequency_interval ?? 0);
    const cadence: Cadence | null = unit && n > 0 ? { interval: n, unit } : null;
    const sapCadence = revs.length ? revs[0].from : cadence;
    const sync = (o.sap_sync ?? {}) as Record<string, unknown>;
    const sy: SapSync = {
        sentAt: s(sync.sent_at) || null, sentIn: s(sync.sent_in) || null,
        confirmedAt: s(sync.confirmed_at) || null, confirmedBy: s(sync.confirmed_by) || null,
    };
    const lastChange = revs.length ? revs[revs.length - 1].appliedAt : '';
    const confirmedSince = !!sy.confirmedAt && sy.confirmedAt >= lastChange;
    const sentSince = !!sy.sentAt && sy.sentAt >= lastChange;
    const inSync = revs.length === 0 || confirmedSince;
    const state: ScheduleChange['state'] = revs.length === 0 ? 'unchanged' : confirmedSince ? 'confirmed' : sentSince ? 'sent' : 'changed';
    return {
        id: pm.id,
        code: s(pm.code) || pm.id,
        title: s(pm.title) || s(pm.description) || s(pm.code) || pm.id,
        sap: { plan: s(o.plan), item: s(o.item), taskList: s(o.task_list) },
        study: s(o.study_id) ? { id: s(o.study_id), title: s(o.study_title) } : null,
        sapCadence, cadence, revisions: revs, sync: sy, inSync, state,
    };
}

export const cadenceText = (c: Cadence | null): string => (c ? cadenceLabel(c) : '');

/** "1 Months → 90 days (extend_interval, Weibull B10) on 2026-09-20" — one line per revision. */
export function revisionText(r: IntervalRevision): string {
    const from = r.from ? cadenceLabel(r.from) : '?';
    const to = r.toDays ? `${r.toDays} days` : '?';
    const why = [r.type.replace(/_/g, ' '), r.basis].filter(Boolean).join(', ');
    return `${from} → ${to}${why ? ` (${why})` : ''}${r.appliedAt ? ` on ${r.appliedAt.slice(0, 10)}` : ''}`;
}
