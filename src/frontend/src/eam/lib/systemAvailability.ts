/**
 * systemAvailability — series/parallel (k-of-n) availability composition and
 * importance ranking over the system_functions dependency model (0291).
 *
 * HONESTY CONTRACT: member availabilities come from sem_asset_reliability,
 * whose MTBF rests on calendar-hour approximations. RANKINGS (weakest link,
 * importance) are trustworthy; ABSOLUTE percentages are estimates and every
 * surface showing them must say so. A member with no failure history gets
 * availability 1.0 and is flagged noData — absence of evidence, stated.
 */

export interface MemberInput {
    assetId: string;
    tag?: string;
    name?: string;
    groupNo: number;
    kRequired: number;
    /** 0..1 from sem_asset_reliability.availability_pct; null = no history */
    availability: number | null;
    /** live status: an open corrective WO exists against this member */
    down: boolean;
}

export interface GroupResult {
    groupNo: number;
    k: number;
    n: number;
    availability: number;
    upCount: number;
    /** covered = margin left · exposed = running with zero margin · lost = below k */
    coverage: 'covered' | 'exposed' | 'lost' | 'no-redundancy';
    members: MemberInput[];
}

export interface SystemResult {
    availability: number;          // 0..1, product of group availabilities
    groups: GroupResult[];
    /** members ranked by Birnbaum-style gain: ΔA(system) if this member were perfect */
    importance: { assetId: string; tag?: string; name?: string; gain: number }[];
    weakestLink?: { assetId: string; tag?: string; name?: string; gain: number };
    anyNoData: boolean;
    status: 'ok' | 'exposed' | 'lost';  // traffic light from live coverage
}

const availOf = (m: MemberInput): number => (m.availability == null ? 1 : Math.min(1, Math.max(0, m.availability)));

/** P(at least k of the members are up), members independent with given availabilities. */
export function kOfNAvailability(avails: number[], k: number): number {
    // DP over "count of members up": O(n²), exact for heterogeneous members.
    let dist = [1]; // dist[j] = P(j up) so far
    for (const a of avails) {
        const next = new Array(dist.length + 1).fill(0);
        for (let j = 0; j < dist.length; j++) {
            next[j] += dist[j] * (1 - a);
            next[j + 1] += dist[j] * a;
        }
        dist = next;
    }
    let p = 0;
    for (let j = Math.max(0, k); j < dist.length; j++) p += dist[j];
    return Math.min(1, p);
}

function composeGroups(members: MemberInput[]): { avail: number; groups: GroupResult[] } {
    const byGroup = new Map<number, MemberInput[]>();
    for (const m of members) {
        if (!byGroup.has(m.groupNo)) byGroup.set(m.groupNo, []);
        byGroup.get(m.groupNo)!.push(m);
    }
    const groups: GroupResult[] = [];
    let systemAvail = 1;
    for (const [groupNo, ms] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
        // k applies per group; rows carry it redundantly — take the max (0291 note).
        const k = Math.max(1, ...ms.map(m => m.kRequired || 1));
        const n = ms.length;
        const a = kOfNAvailability(ms.map(availOf), Math.min(k, n));
        const upCount = ms.filter(m => !m.down).length;
        const coverage: GroupResult['coverage'] =
            upCount < Math.min(k, n) ? 'lost'
                : n <= k ? 'no-redundancy'
                : upCount === k ? 'exposed'
                : 'covered';
        groups.push({ groupNo, k: Math.min(k, n), n, availability: a, upCount, coverage, members: ms });
        systemAvail *= a;
    }
    return { avail: systemAvail, groups };
}

/** Full composition + importance ranking for one system function. */
export function computeSystem(members: MemberInput[]): SystemResult {
    const { avail, groups } = composeGroups(members);

    // Birnbaum-style importance: raise each member to perfect, measure the gain.
    // Which member's improvement buys the most system availability?
    const importance = members
        .map(m => {
            const perfected = members.map(x => (x.assetId === m.assetId ? { ...x, availability: 1 } : x));
            const gain = composeGroups(perfected).avail - avail;
            return { assetId: m.assetId, tag: m.tag, name: m.name, gain };
        })
        .sort((a, b) => b.gain - a.gain);

    const weakestLink = importance.length && importance[0].gain > 1e-9 ? importance[0] : undefined;
    const status: SystemResult['status'] =
        groups.some(g => g.coverage === 'lost') ? 'lost'
            : groups.some(g => g.coverage === 'exposed') ? 'exposed'
            : 'ok';

    return {
        availability: avail,
        groups,
        importance,
        weakestLink,
        anyNoData: members.some(m => m.availability == null),
        status,
    };
}
