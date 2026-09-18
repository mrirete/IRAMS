// ─────────────────────────────────────────────────────────────────────────────
// PM (schedule) readiness — the Work Order planning gate, asked of the template
// BEFORE an order exists.
//
// Same engine as the order's Work Readiness strip (assessReadiness), so a
// schedule that reads 100% here raises an order that lands as PLAN, and the
// two screens can never disagree about what "planned" means. Two extra
// recommended items cover what decides how the generated order lands: a named
// person on the lead labour line (the order is assigned to them) and a rate on
// every labour line (the order gets a planned cost).
// ─────────────────────────────────────────────────────────────────────────────
import { assessReadiness, ReadinessItem, ReadinessResult } from './workReadiness';
import { Asset, RecurringJob, WorkOrder } from '../types';

export type PmFixTab = 'details' | 'assets' | 'tasks' | 'jsa' | 'labor' | 'inventory';

export interface PmReadiness extends ReadinessResult {
    /** Which PM tab fixes each item — the badge turns unmet items into links. */
    fixTab: Record<string, PmFixTab>;
    /** Highest criticality across the linked assets (drives the JSA requirement). */
    criticality: string | null;
}

const FIX_TAB: Record<string, PmFixTab> = {
    asset: 'assets',
    scope: 'details',
    steps: 'tasks',
    estimate: 'details',
    labour: 'labor',
    parts: 'inventory',
    safety: 'jsa',
    person: 'labor',
    rate: 'labor',
};

const CRIT_RANK: Record<string, number> = { A: 3, B: 2, C: 1, D: 0 };

/** Highest criticality among the schedule's linked assets, or null when unknown. */
export function pmCriticality(job: RecurringJob, assets: Asset[]): string | null {
    let best: string | null = null;
    for (const ra of job.assignedAssets || []) {
        const c = String(assets.find(a => a.id === ra.assetId)?.criticality || '').toUpperCase();
        if (!c) continue;
        if (best === null || (CRIT_RANK[c] ?? -1) > (CRIT_RANK[best] ?? -1)) best = c;
    }
    return best;
}

export function assessPmReadiness(job: RecurringJob, assets: Asset[] = []): PmReadiness {
    const criticality = pmCriticality(job, assets);
    // Only a hazard with a description is a hazard — the sweep copies nothing
    // else, and the SQL gate (pm_mark_planned) counts nothing else.
    const hazards = (job.jsa?.hazards || []).filter(h => String((h as any)?.hazard || '').trim().length > 0);
    const asOrder = {
        assetId: job.assignedAssets?.[0]?.assetId || '',
        description: job.jobDescription || job.description || '',
        tasks: job.tasks || [],
        estDuration: job.estDuration || 0,
        labor: job.labor || [],
        inventory: job.inventory || [],
        jsa: job.jsa ? { ...job.jsa, hazards } : undefined,
        type: job.jobType || 'PM',
        status: 'OPEN',
    } as unknown as WorkOrder;
    const base = assessReadiness(asOrder, { criticality });

    const labour = job.labor || [];
    const extra: ReadinessItem[] = [
        {
            id: 'person', label: 'Technician named', severity: 'recommended',
            met: labour.some(l => !!l.contactId),
            hint: 'Name a person on the lead labour line — the generated order is assigned to them.',
        },
        {
            id: 'rate', label: 'Labour rates', severity: 'recommended',
            met: labour.length > 0 && labour.every(l => (Number(l.estRate) || 0) > 0),
            hint: 'A rate on each labour line gives the order a planned cost.',
        },
    ];
    const items = [...base.items, ...extra];
    const weight = (it: ReadinessItem) => (it.severity === 'required' ? 2 : 1);
    const totalW = items.reduce((s, it) => s + weight(it), 0);
    const metW = items.reduce((s, it) => s + (it.met ? weight(it) : 0), 0);
    const score = totalW === 0 ? 0 : Math.round((metW / totalW) * 100);

    return { ...base, items, score, fixTab: FIX_TAB, criticality };
}

export type ReadinessTone = 'green' | 'amber' | 'red';
/** Green = the order will land as Planned with nothing missing; amber = only recommended gaps; red = a required item is missing. */
export const readinessTone = (r: Pick<PmReadiness, 'requiredMet' | 'items'>): ReadinessTone =>
    !r.requiredMet ? 'red' : r.items.every(it => it.met) ? 'green' : 'amber';
