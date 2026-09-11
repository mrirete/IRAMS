/**
 * rbdEngine — ONE topology engine for the Reliability Block Diagram.
 *
 * Audit M-12 (docs/Process-Test-Reliability-Modelling.md): the RBD carried
 * three partial copies of this maths — R(t) in ReliabilityBlockDiagram
 * (k-of-n on an *average* R, standby on an *average* λ), availability in
 * ReliabilityModelingTab.systemMetrics (no k-of-n branch at all → series
 * product, standby treated as active parallel) and a second copy in
 * studyAo, plus "system MTBF" that was the plain average of the block MTBFs
 * and was what the RBD→RAM bridge sent. Every consumer now calls this file.
 *
 * Model: constant-rate blocks (R_i(t) = e^{-t/MTBF_i}, A_i = MTBF/(MTBF+MTTR)),
 * independent, groups in series with the ungrouped blocks.
 *   series    R = Π R_i                     A = Π A_i
 *   parallel  R = 1 − Π(1 − R_i)            A = 1 − Π(1 − A_i)
 *   k-of-n    exact heterogeneous binomial via a "count up" DP (no averaging)
 *   standby   cold standby, perfect switching: R = e^{-λ̄t} Σ_{i<n} (λ̄t)^i / i!
 *             (λ̄ = mean rate — the classical closed form needs equal rates);
 *             A: no closed form for repairable cold standby — the active-
 *             parallel value is used as the CONSERVATIVE bound and flagged.
 * System MTBF = ∫₀^∞ R_sys(t) dt, integrated adaptively (step from the shortest
 * block life, horizon where R_sys < 1e-6) — not the average of the blocks.
 */

export interface EngineBlock {
    id: string;
    mtbf: number;   // hours
    mttr: number;   // hours
    groupId?: string;
}

export interface EngineGroup {
    id: string;
    type: 'series' | 'parallel' | 'standby' | 'k-of-n';
    blocks: string[];
    k?: number;
}

/** P(at least k of n independent items are up/alive), each with its own p. Exact, O(n²). */
export function kOfNProbability(ps: number[], k: number): number {
    let dist = [1];
    for (const p of ps) {
        const next = new Array(dist.length + 1).fill(0);
        for (let j = 0; j < dist.length; j++) {
            next[j] += dist[j] * (1 - p);
            next[j + 1] += dist[j] * p;
        }
        dist = next;
    }
    let out = 0;
    for (let j = Math.max(0, k); j < dist.length; j++) out += dist[j];
    return Math.min(1, Math.max(0, out));
}

export const blockR = (b: EngineBlock, t: number): number => (b.mtbf > 0 ? Math.exp(-t / b.mtbf) : 0);
export const blockA = (b: EngineBlock): number => (b.mtbf > 0 ? b.mtbf / (b.mtbf + Math.max(0, b.mttr || 0)) : 0);

function membersOf(g: EngineGroup, blocks: EngineBlock[]): EngineBlock[] {
    const set = new Set(g.blocks);
    return blocks.filter(b => set.has(b.id));
}

function factorial(n: number): number { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }

/** Reliability of one group at time t. */
export function groupR(g: EngineGroup, blocks: EngineBlock[], t: number): number {
    const m = membersOf(g, blocks);
    if (m.length === 0) return 1;
    const rs = m.map(b => blockR(b, t));
    switch (g.type) {
        case 'parallel': return 1 - rs.reduce((p, r) => p * (1 - r), 1);
        case 'k-of-n': return kOfNProbability(rs, Math.min(Math.max(1, g.k || 1), m.length));
        case 'standby': {
            const lambdaBar = m.reduce((s, b) => s + (b.mtbf > 0 ? 1 / b.mtbf : 0), 0) / m.length;
            const lt = lambdaBar * t;
            let sum = 0;
            for (let i = 0; i < m.length; i++) sum += Math.pow(lt, i) / factorial(i);
            return Math.exp(-lt) * sum;
        }
        default: return rs.reduce((p, r) => p * r, 1);
    }
}

/** Steady-state availability of one group. `approximate` = the standby bound was used. */
export function groupA(g: EngineGroup, blocks: EngineBlock[]): { a: number; approximate: boolean } {
    const m = membersOf(g, blocks);
    if (m.length === 0) return { a: 1, approximate: false };
    const as = m.map(blockA);
    switch (g.type) {
        case 'parallel': return { a: 1 - as.reduce((p, a) => p * (1 - a), 1), approximate: false };
        case 'k-of-n': return { a: kOfNProbability(as, Math.min(Math.max(1, g.k || 1), m.length)), approximate: false };
        case 'standby': return { a: 1 - as.reduce((p, a) => p * (1 - a), 1), approximate: true };
        default: return { a: as.reduce((p, a) => p * a, 1), approximate: false };
    }
}

function ungrouped(blocks: EngineBlock[], groups: EngineGroup[]): EngineBlock[] {
    const assigned = new Set(groups.flatMap(g => g.blocks));
    return blocks.filter(b => !assigned.has(b.id));
}

/** System reliability at t: ungrouped blocks and every group in series. */
export function systemR(blocks: EngineBlock[], groups: EngineGroup[], t: number): number {
    if (blocks.length === 0) return 0;
    let r = ungrouped(blocks, groups).reduce((p, b) => p * blockR(b, t), 1);
    for (const g of groups) {
        if (membersOf(g, blocks).length === 0) continue;
        r *= groupR(g, blocks, t);
    }
    return r;
}

/**
 * System MTBF = ∫₀^∞ R_sys(t) dt (trapezoidal). Step size follows the shortest
 * block life so a 100 h block is not sampled every 400 h; the horizon stops
 * where R_sys is negligible.
 */
export function systemMTBF(blocks: EngineBlock[], groups: EngineGroup[]): number {
    const live = blocks.filter(b => b.mtbf > 0);
    if (live.length === 0) return 0;
    const minLife = Math.min(...live.map(b => b.mtbf));
    const maxLife = Math.max(...live.map(b => b.mtbf));
    const dt = Math.max(minLife / 40, 1e-3);
    // Redundant groups can outlive the longest single block by a wide margin;
    // integrate until R_sys < 1e-6 or 60× the longest life, whichever first.
    const horizon = maxLife * 60 * Math.max(1, blocks.length);
    let integral = 0;
    let prev = systemR(blocks, groups, 0);
    let steps = 0;
    for (let t = dt; t <= horizon && steps < 400000; t += dt, steps++) {
        const cur = systemR(blocks, groups, t);
        integral += (prev + cur) * dt / 2;
        prev = cur;
        if (cur < 1e-6) break;
    }
    return integral;
}

export interface SystemMetrics {
    ao: number;
    mtbf: number;     // ∫R(t)dt — topology-aware
    mttr: number;     // implied: MTBF·(1−A)/A
    approximate: boolean; // a standby group's availability used the active-parallel bound
}

/** Steady-state system availability and the topology-aware MTBF/MTTR pair. */
export function systemMetrics(blocks: EngineBlock[], groups: EngineGroup[]): SystemMetrics {
    if (blocks.length === 0) return { ao: 0, mtbf: 0, mttr: 0, approximate: false };
    let ao = ungrouped(blocks, groups).reduce((p, b) => p * blockA(b), 1);
    let approximate = false;
    for (const g of groups) {
        if (membersOf(g, blocks).length === 0) continue;
        const { a, approximate: approx } = groupA(g, blocks);
        ao *= a;
        approximate = approximate || approx;
    }
    const mtbf = systemMTBF(blocks, groups);
    const mttr = ao > 0 && ao < 1 ? mtbf * (1 - ao) / ao : 0;
    return { ao, mtbf, mttr, approximate };
}

/** Availability only (used by study cards / sorting). */
export function systemAo(blocks: EngineBlock[], groups: EngineGroup[]): number {
    return systemMetrics(blocks, groups).ao;
}
