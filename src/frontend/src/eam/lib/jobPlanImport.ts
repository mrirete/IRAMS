/**
 * Job-plan import: which operations go on which schedule.
 *
 * A SAP strategy plan puts operations of DIFFERENT cadences under one task
 * list — package 1 (monthly) on operations 0010/0020, package 12 (annual) on
 * 0030 — and the strategy schedules each package separately. IREAMS has one
 * cadence per schedule, so the faithful shape is one schedule per package:
 * the imported schedule keeps the shortest cadence, and every longer cadence
 * becomes a sibling schedule ("60099001-12M") carrying its own operations.
 * Operations with no package stay on the base schedule.
 */
import { type Cadence, cadenceEquals, cadenceRank, shortest } from './sapCycles';

export interface PlannedOp<T> { op: T; cadence: Cadence | null }
export interface CadenceGroup<T> { cadence: Cadence | null; ops: T[] }
export interface OperationSplit<T> { base: CadenceGroup<T>; siblings: CadenceGroup<T>[] }

export function splitOperationsByCadence<T>(ops: PlannedOp<T>[]): OperationSplit<T> {
    const cadences: Cadence[] = [];
    for (const { cadence } of ops) {
        if (cadence && !cadences.some(c => cadenceEquals(c, cadence))) cadences.push(cadence);
    }
    if (cadences.length === 0) return { base: { cadence: null, ops: ops.map(o => o.op) }, siblings: [] };

    const baseCadence = shortest(cadences);
    const base: CadenceGroup<T> = { cadence: baseCadence, ops: [] };
    const siblings: CadenceGroup<T>[] = cadences
        .filter(c => !cadenceEquals(c, baseCadence))
        .sort((a, b) => cadenceRank(a) - cadenceRank(b))
        .map(c => ({ cadence: c, ops: [] }));

    for (const { op, cadence } of ops) {
        if (!cadence || cadenceEquals(cadence, baseCadence)) { base.ops.push(op); continue; }
        siblings.find(s => cadenceEquals(s.cadence, cadence))!.ops.push(op);
    }
    return { base, siblings };
}
