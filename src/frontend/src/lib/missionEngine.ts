/**
 * missionEngine — missions the DATA can verify, not the honor system.
 *
 * The briefing's mission list stops being parsed prose the user ticks off:
 * each mission here is derived from live rows and carries a completion
 * predicate, so when the underlying work actually happens (PM rescheduled,
 * WO closed, proposal decided) the mission completes ITSELF on the next
 * load. The same definitions the digest agent's tools use are mirrored here
 * (overdue PM = recurring_work.active AND next_due_date < now).
 *
 * Baseline logic: the first computation for a briefing snapshots the counts
 * (persisted by the caller, keyed per briefing). A mission exists if its
 * baseline count was > 0 — so "0 overdue PMs" on a later load renders as a
 * VERIFIED win, not as nothing-ever-happened. Pure and tested.
 */

export interface MissionInputs {
    overduePmCount: number;
    /** A few asset tags carrying overdue PMs, for the mission text/handoff. */
    overduePmTags: string[];
    /** Open work on the top cost drivers (Pareto order). */
    topOpenAssets: { tag: string; open: number }[];
    pendingProposals: number;
}

export interface DetMission {
    /** Stable id — also the baseline key. */
    id: string;
    text: string;
    path: string | null;
    label: string | null;
    tags: string[];
    /** Items remaining now; 0 = the data says it's handled. */
    current: number;
    /** Items at the briefing's baseline. */
    initial: number;
    done: boolean;
}

export interface MissionComputation {
    missions: DetMission[];
    /** Persist and feed back on the next compute for the same briefing. */
    baseline: Record<string, number>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function computeMissions(
    inp: MissionInputs,
    prevBaseline: Record<string, number> | null,
): MissionComputation {
    interface Candidate {
        id: string;
        current: number;
        tags: string[];
        path: string | null;
        label: string | null;
        openText: (current: number) => string;
        doneText: (initial: number) => string;
    }

    const candidates: Candidate[] = [
        {
            id: 'overdue-pm',
            current: inp.overduePmCount,
            tags: inp.overduePmTags,
            path: '/recurring-work',
            label: 'PM schedules',
            openText: (c) => `Clear ${plural(c, 'overdue PM programme')}${inp.overduePmTags.length ? ` (${inp.overduePmTags.join(', ')})` : ''}`,
            doneText: (i) => `Overdue PM programmes cleared — ${i} at the start of this briefing, none now`,
        },
        ...inp.topOpenAssets.slice(0, 3).map((a): Candidate => ({
            id: `open-wo:${a.tag}`,
            current: a.open,
            tags: [a.tag],
            path: '/work-orders',
            label: 'Work orders',
            openText: (c) => `Close the ${plural(c, 'open work order')} on ${a.tag} — a top cost driver`,
            doneText: () => `Open work on ${a.tag} cleared`,
        })),
        {
            id: 'proposals',
            current: inp.pendingProposals,
            tags: [],
            path: null,
            label: null,
            openText: (c) => `Decide the ${plural(c, 'Specialist proposal')} awaiting your review (in the queue below)`,
            doneText: (i) => `Proposal queue cleared — ${plural(i, 'decision')} made`,
        },
    ];

    const baseline: Record<string, number> = {};
    const missions: DetMission[] = [];
    for (const c of candidates) {
        const initial = prevBaseline?.[c.id] ?? c.current;
        baseline[c.id] = initial;
        if (initial <= 0) continue; // never work to do → never a mission
        const done = c.current <= 0;
        missions.push({
            id: c.id,
            text: done ? c.doneText(initial) : c.openText(c.current),
            path: c.path,
            label: c.label,
            tags: c.tags,
            current: Math.max(0, c.current),
            initial,
            done,
        });
    }
    return { missions, baseline };
}
