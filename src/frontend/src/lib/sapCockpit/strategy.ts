/**
 * Cockpit strategy objects -> IREAMS schedules and job plans.
 *
 * Slice 2, the other half of the loop. Where slice 1 brought the condition
 * history in, this brings in what the plant currently DOES about it:
 *
 *     task list (+ operations, packages, components)  -> job plan
 *     maintenance item (+ its plan)                   -> schedule
 *
 * Rows come out in IREAMS's canonical `jobplan` and `recurring` shapes — the
 * same ones the Recurring Work import already consumes — so nothing here
 * writes to the database. The import order matters and is not negotiable: a
 * job plan's operations attach to schedules that already exist, by PM code or
 * by the task list stamped on a schedule's origin. Schedules first.
 *
 * THE CADENCE PROBLEM, stated once. A maintenance plan tells you how often it
 * runs in one of two ways:
 *
 *   - a single-cycle plan carries ZYKL1 + ZEIEH, an exact cadence; or
 *   - a strategy plan names STRAT, and the cycles belong to the strategy's
 *     packages — which live in MMPT, and MMPT is in NONE of the five PM
 *     migration objects. S_MPACK gives the package NUMBER and the strategy
 *     NAME and stops there; it has no cycle and no package text.
 *
 * So for a strategy plan the cadence is genuinely not in the download. SAP's
 * documentation for the object says as much: cycle information for strategy
 * plans is out of scope, "taken from the Maintenance Strategy object" — and
 * strategies have no migration object at all; they are configuration (IP11).
 * The cycles therefore come from a file of the SOURCE system's strategy
 * packages placed alongside the downloads (an IP11 or T351P export;
 * inbound.ts recognises it by its columns). With that file, a strategy plan
 * gets the shortest package on its task list as its base cadence — the same
 * rule the Recurring Work import applies when it splits a list by package —
 * and every step gets its own package's cycle. Without it, the row is skipped
 * with that said plainly, because a schedule with a guessed frequency is
 * worse than no schedule: it generates work orders on a rhythm nobody chose.
 */

import { type CockpitIssue, type CockpitSet, type StrategyPackage, assetTagOf } from './inbound';
import { type CockpitObjectKey } from './structures';
import {
    parseSapCycle, isMeterUnit, addCadence, cadenceLabel, shortest, type Cadence,
} from '../../eam/lib/sapCycles';
import {
    SAP_ILART_MAP, SAP_PRIOK_MAP, SAP_CONTROL_KEYS, SAP_ORDER_TYPES,
} from '../../eam/services/assetTemplates';

class Issues {
    private map = new Map<string, CockpitIssue>();
    add(level: CockpitIssue['level'], message: string, countable = true) {
        const k = `${level}|${message}`;
        const cur = this.map.get(k);
        if (cur) { if (countable) cur.count = (cur.count ?? 1) + 1; return; }
        this.map.set(k, { level, message, ...(countable ? { count: 1 } : {}) });
    }
    list(): CockpitIssue[] {
        const order = { error: 0, warn: 1, info: 2 };
        return [...this.map.values()].sort((a, b) => order[a.level] - order[b.level]);
    }
}

export interface StrategyImport {
    /** Canonical `recurring` rows — import these FIRST. */
    recurring: Record<string, string>[];
    /** Canonical `jobplan` rows — operations attach to the schedules above. */
    jobplan: Record<string, string>[];
    issues: CockpitIssue[];
    skipped: number;
}

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** A task list is named by group and counter, the pair a plan item points at. */
export const taskListRef = (group: string, counter: string): string =>
    `${s(group)}/${(s(counter) || '01').padStart(2, '0')}`;

/** Operation key, so packages and components find their operation. */
const opKey = (group: string, counter: string, op: string): string =>
    `${taskListRef(group, counter)}/${s(op).padStart(4, '0')}`;

/**
 * SAP work into hours. ARBEH is the unit: MIN minutes, STD/H hours, TAG days
 * (a day being eight hours, the same assumption the load-file importer makes).
 */
export function workHours(arbei: string, arbeh: string): string {
    const raw = s(arbei).replace(',', '.');
    if (!raw) return '';
    const n = Number(raw);
    if (isNaN(n)) return '';
    const u = s(arbeh).toUpperCase();
    if (u === 'MIN') return String(n / 60);
    if (u === 'TAG' || u === 'DAY') return String(n * 8);
    return String(n);
}

const sheetOf = (set: CockpitSet, object: CockpitObjectKey, structure: string) =>
    set.sheets.find(x => x.object === object && x.structure === structure);

export function toStrategyRows(set: CockpitSet): StrategyImport {
    const issues = new Issues();
    const recurring: Record<string, string>[] = [];
    const jobplan: Record<string, string>[] = [];
    let skipped = 0;

    // ── Job plans ───────────────────────────────────────────────────────────
    const hdrSheet = sheetOf(set, 'generalTaskList', 'S_TASKLIST_HDR');
    const opSheet = sheetOf(set, 'generalTaskList', 'S_OPERATIONS');
    const packSheet = sheetOf(set, 'generalTaskList', 'S_MPACK');
    const compSheet = sheetOf(set, 'generalTaskList', 'S_COMPONENTS');

    const headers = new Map<string, Record<string, string>>();
    for (const r of hdrSheet?.rows ?? []) {
        const ref = taskListRef(r.PLNNR, r.PLNAL);
        if (ref !== '/01' || s(r.PLNNR)) headers.set(ref, r);
    }

    const packages = new Map<string, Record<string, string>>();
    for (const r of packSheet?.rows ?? []) {
        packages.set(opKey(r.PLNNR, r.PLNAL, r.VORNR), r);
    }

    const components = new Map<string, { code: string; qty: string; uom: string }[]>();
    for (const r of compSheet?.rows ?? []) {
        const code = s(r.IDNRK);
        if (!code) continue;
        const k = opKey(r.PLNNR, r.PLNAL, r.VORNR);
        (components.get(k) ?? components.set(k, []).get(k)!).push({
            code, qty: s(r.MENGE) || '1', uom: s(r.MEINS),
        });
    }

    // Strategy packages from the sidecar, by strategy and by strategy+package.
    const pkgByKey = new Map<string, StrategyPackage>();
    const pkgsByStrat = new Map<string, StrategyPackage[]>();
    for (const p of set.strategyPackages) {
        const k = p.strat.toUpperCase();
        pkgByKey.set(`${k}|${p.paket}`, p);
        (pkgsByStrat.get(k) ?? pkgsByStrat.set(k, []).get(k)!).push(p);
    }
    const packageCadence = (strat: string, paket: string): Cadence | null =>
        pkgByKey.get(`${s(strat).toUpperCase()}|${s(paket).replace(/^0+(?=\d)/, '')}`)?.cadence ?? null;
    /** Cadences of a task list's steps, by task-list ref — a strategy plan's base cadence is the shortest. */
    const listPackages = new Map<string, Cadence[]>();

    if (opSheet && !hdrSheet) {
        issues.add('warn', 'Task-list operations are in this set but the task-list header is not — the operations import, but without the list’s description, plant or strategy.', false);
    }

    for (const r of opSheet?.rows ?? []) {
        const ref = taskListRef(r.PLNNR, r.PLNAL);
        const description = s(r.LTXA1);
        if (!s(r.PLNNR) || !s(r.VORNR)) {
            issues.add('error', 'task-list operation(s) have no task list or no operation number (PLNNR / VORNR are key fields); skipped');
            skipped += 1;
            continue;
        }
        if (!description) {
            issues.add('error', `operation(s) have no short text (LTXA1) — IREAMS needs a description to show a step; skipped`);
            skipped += 1;
            continue;
        }
        const hdr = headers.get(ref);
        const row: Record<string, string> = {
            pmcode: ref,
            operationno: s(r.VORNR),
            description,
            tasklistgroup: s(r.PLNNR),
            tasklistcounter: s(r.PLNAL) || '01',
        };
        const longtext = s(r.TDLINE);
        if (longtext) row.longtext = longtext;
        const centre = s(r.ARBPL) || s(hdr?.ARBPL);
        if (centre) row.workcentre = centre;
        const ck = s(r.STEUS).toUpperCase();
        if (ck) row.controlkey = SAP_CONTROL_KEYS[ck] ?? ck;
        const hours = workHours(r.ARBEI, r.ARBEH);
        if (hours) { row.esthours = hours; row.workunit = 'H'; }
        if (s(r.ANZZL)) row.numpersons = s(r.ANZZL);
        if (s(r.DAUNO)) { row.duration = s(r.DAUNO); row.durationunit = s(r.DAUNE); }

        const pack = packages.get(opKey(r.PLNNR, r.PLNAL, r.VORNR));
        if (pack) {
            if (s(pack.PAKET)) row.package = s(pack.PAKET);
            if (s(pack.STRAT)) row.strategy = s(pack.STRAT);
            const cad = packageCadence(pack.STRAT, pack.PAKET);
            if (cad) {
                row.frequencyinterval = String(cad.interval);
                row.frequencyunit = cad.unit;
                (listPackages.get(ref) ?? listPackages.set(ref, []).get(ref)!).push(cad);
            } else if (s(pack.PAKET) && set.strategyPackages.length) {
                issues.add('warn', `step(s) belong to package ${s(pack.PAKET)} of strategy ${s(pack.STRAT)}, which the strategy file does not carry — no cadence for them`);
            }
        }
        const mats = components.get(opKey(r.PLNNR, r.PLNAL, r.VORNR));
        if (mats) row.materials = JSON.stringify(mats);

        // An operation targeting a different object from the list's own.
        if (s(r.EQUNR_OP) || s(r.TPLNR_OP)) {
            issues.add('info', 'operation(s) name their own equipment or functional location (EQUNR_OP / TPLNR_OP) — IREAMS job-plan steps carry no asset of their own, so the step belongs to whatever the schedule covers');
        }
        jobplan.push(row);
    }

    if (packSheet?.rows.length && jobplan.length && set.strategyPackages.length === 0) {
        issues.add('warn', 'Strategy packages say WHICH package each step belongs to, but a package’s cycle lives in the strategy, which has no migration object (SAP: "taken from the Maintenance Strategy object"). Add an export of the strategy packages (IP11, or table T351P: STRAT, PAKET/ZAEHL, ZYKL1/ZYKZT, ZEIEH) to this set and every step gets its cycle.', false);
    }

    // ── Schedules ───────────────────────────────────────────────────────────
    const plans = new Map<string, Record<string, string>>();
    for (const r of sheetOf(set, 'maintenancePlan', 'S_MPLA')?.rows ?? []) {
        if (s(r.WARPL)) plans.set(s(r.WARPL), r);
    }

    const objectLists = new Map<string, number>();
    for (const r of sheetOf(set, 'maintenancePlan', 'S_OBJ_LIST')?.rows ?? []) {
        const k = `${s(r.WARPL)}/${s(r.WPPOS)}`;
        objectLists.set(k, (objectLists.get(k) ?? 0) + 1);
    }
    for (const r of sheetOf(set, 'maintenanceItem', 'S_OBJ_LIST')?.rows ?? []) {
        const k = s(r.WAPOS);
        objectLists.set(k, (objectLists.get(k) ?? 0) + 1);
    }

    /** One maintenance item — from a plan (WPPOS) or standalone (WAPOS). */
    const item = (r: Record<string, string>, planBound: boolean) => {
        const plan = planBound ? plans.get(s(r.WARPL)) : undefined;
        const itemNo = planBound ? s(r.WPPOS) : s(r.WAPOS);
        // Plan-bound item numbers repeat across plans ("0010" everywhere), so
        // the plan number goes into the code to keep it unique and traceable.
        const code = planBound ? `${s(r.WARPL)}/${itemNo}` : itemNo;
        const description = s(r.PSTXT);
        const assetTag = assetTagOf(s(r.EQUNR) || s(r.TPLNR));

        if (!code || !description) {
            issues.add('error', 'maintenance item(s) have no number or no short text (PSTXT); skipped');
            skipped += 1;
            return;
        }
        if (!assetTag) {
            issues.add('error', `maintenance item(s) name no object — EQUNR and TPLNR are both blank, so there is nothing to schedule against; skipped`);
            skipped += 1;
            return;
        }

        // Cadence: exact from a single-cycle plan; for a strategy plan, the
        // shortest package on its task list (or of the strategy, when the list
        // is not in the set) from the strategy file; otherwise not knowable.
        let cadence: Cadence | null = null;
        let cadenceFrom = '';
        if (planBound && plan) cadence = parseSapCycle(plan.ZYKL1, plan.ZEIEH);
        const strategy = planBound ? s(plan?.STRAT) : s(r.WSTRA);
        if (!cadence && strategy && (plan || !planBound)) {
            const listRef = s(r.PLNNR) ? taskListRef(r.PLNNR, r.PLNAL) : '';
            const onList = listRef ? listPackages.get(listRef) : undefined;
            const ofStrategy = (pkgsByStrat.get(strategy.toUpperCase()) ?? [])
                .map(p => p.cadence).filter((c): c is Cadence => !!c);
            const pool = onList?.length ? onList : ofStrategy;
            if (pool.length) {
                cadence = shortest(pool);
                cadenceFrom = onList?.length ? `shortest package on task list ${listRef}` : `shortest package of strategy ${strategy}`;
            }
        }
        if (!cadence) {
            if (planBound && !plan) {
                issues.add('error', `maintenance item(s) name a plan (WARPL) that is not in this set, so the cycle is unknown; skipped`);
            } else if (strategy && set.strategyPackages.length) {
                issues.add('error', `maintenance item(s) follow strategy ${strategy}, and the strategy file carries no readable package for it; skipped`);
            } else if (strategy) {
                issues.add('error', `maintenance item(s) follow strategy ${strategy}, whose package cycles are in no PM migration object (SAP: "taken from the Maintenance Strategy object"). Add an export of the strategy packages (IP11, or table T351P) to this set; skipped`);
            } else {
                issues.add('error', 'maintenance item(s) have no cycle: the plan carries neither ZYKL1/ZEIEH nor a strategy; skipped');
            }
            skipped += 1;
            return;
        }
        if (cadenceFrom) {
            issues.add('info', `strategy-plan item(s) take their base cadence from the ${cadenceFrom} — longer packages become sibling schedules when the task list’s steps are imported`);
        }

        const row: Record<string, string> = {
            code,
            description,
            assettag: assetTag,
            frequencyinterval: String(cadence.interval),
            frequencyunit: cadence.unit,
            scheduletype: isMeterUnit(cadence.unit) || s(plan?.POINT) ? 'READING' : 'TIME',
        };
        const ilart = s(r.ILART);
        row.jobtype = SAP_ILART_MAP[ilart] || 'PM';
        const priok = s(r.PRIOK);
        if (SAP_PRIOK_MAP[priok]) row.priority = SAP_PRIOK_MAP[priok];
        if (s(r.GEWRK)) row.workcentre = s(r.GEWRK);
        if (s(r.WPGRP)) row.plannergroup = s(r.WPGRP);
        if (s(r.AUART)) row.ordertype = s(r.AUART);
        if (s(r.PLNNR)) row.tasklist = taskListRef(r.PLNNR, r.PLNAL);
        if (planBound) { row.plan = s(r.WARPL); if (s(plan?.WPTXT)) row.plantext = s(plan?.WPTXT); }
        if (strategy) row.strategy = strategy;

        const start = s(plan?.STADT);
        if (start) {
            const iso = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(start);
            const startIso = iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : start;
            const next = addCadence(startIso, cadence);
            if (next) row.nextduedate = next;
        }

        const extra = objectLists.get(planBound ? `${s(r.WARPL)}/${itemNo}` : itemNo);
        if (extra) {
            issues.add('warn', `maintenance item(s) cover further objects through an object list — IREAMS imports the item's own equipment and one schedule; add the rest on the schedule's Assets tab (${extra} object(s) on this item)`);
        }
        if (s(r.AUART) && !SAP_ORDER_TYPES.has(s(r.AUART).toUpperCase())) {
            issues.add('info', `order type ${s(r.AUART)} is client configuration — check it means preventive work`);
        }
        if (!isMeterUnit(cadence.unit) && s(plan?.POINT)) {
            issues.add('info', `plan(s) are driven by measuring point ${s(plan?.POINT)} — imported as a reading-based schedule; check the point exists on the asset`);
        }
        recurring.push(row);
        if (row.tasklist && !headers.has(row.tasklist) && !jobplan.some(j => j.pmcode === row.tasklist)) {
            issues.add('info', `schedule(s) reference task list ${row.tasklist}, which is not in this set — import the general task list too, or the schedule arrives with no steps`);
        }
    };

    for (const r of sheetOf(set, 'maintenancePlan', 'S_MPOS')?.rows ?? []) item(r, true);
    for (const r of sheetOf(set, 'maintenanceItem', 'S_ITEM')?.rows ?? []) item(r, false);

    if (jobplan.length && !recurring.length) {
        issues.add('warn', 'Job-plan steps have no schedules to attach to. Operations join a schedule that already exists, by PM code or by its task list — import the maintenance items first, or these steps will all be rejected.', false);
    }
    if (recurring.length) {
        issues.add('info', `${recurring.length} schedule(s) import first, then ${jobplan.length} step(s) attach to them by task list.`, false);
    }

    return { recurring, jobplan, issues: issues.list(), skipped };
}

/** Cadence in words, for the preview. */
export const describeCadence = (interval: string, unit: string): string =>
    cadenceLabel({ interval: Number(interval), unit: unit as Cadence['unit'] });
