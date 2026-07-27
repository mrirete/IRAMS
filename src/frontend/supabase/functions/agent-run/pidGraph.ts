// pidGraph — turn a stored P&ID into something a language model can reason over.
//
// WHY THIS EXISTS
// ERS already holds P&IDs in the shape the research calls a "conceptual-level
// graph": ers_pid_configurations stores typed equipment nodes and typed edges
// as JSONB (see 0081). What was missing is the retrieval half — a way to hand
// that graph to an agent without handing it the drawing.
//
// The finding worth acting on (Alimin & Schweidtmann, 2026, arXiv:2603.22528):
// a conceptual graph answered P&ID questions at 0.94 accuracy for ~7K tokens,
// where the same drawing as a smart-file cost ~150K tokens for 0.89, and as a
// raw image managed 0.76. Their best method — "ContextRAG" — needs no vector
// database and no embeddings at all. It is just: serialise the graph, strip the
// noise, pass it in. That is what this module does.
//
// WHERE WE DELIBERATELY DIVERGE FROM THE PAPER
// Their PathRAG walks the graph using vector search plus an LLM call at every
// hop, because they assume a graph too large to hold in context. A plant P&ID
// in this system is tens of nodes, not thousands. At that size a breadth-first
// walk is exact, instant and free, and it cannot hallucinate a connection that
// isn't there. So path questions — trace, upstream, downstream, isolation — are
// answered by plain graph traversal below, and the model only narrates the
// result. Determinism matters more than cleverness here: "which valves isolate
// V-101" has to return the same answer twice and survive an incident review.
//
// No I/O and no imports: graph in, text out. The database read and the asset
// health join live in the query_pid tool (tools.ts), so this file stays pure
// and testable, and runs identically under Deno and vitest.

// ── Shapes ───────────────────────────────────────────────────────────────
// Structurally compatible with PIDEquipment / PIDConnection in
// components/analyze/PIDViewer.tsx, but declared independently: that file is a
// React component and cannot be imported into an Edge Function. Fields beyond
// these are ignored, so the editor can grow without breaking retrieval.

export interface PidNodeInput {
    id: string;
    type: string;
    label: string;
    assetId?: string | null;
    assetTag?: string | null;
    criticality?: string | null;
    healthIndex?: number | null;
    woCount?: number | null;
}

export interface PidEdgeInput {
    id: string;
    fromId: string;
    toId: string;
    type: string;
}

/** Health facts joined from sem_asset_health — the part the paper cannot do. */
export interface AssetFacts {
    asset_tag: string;
    criticality?: string | null;
    mtbf_days?: number | null;
    open_wo_count?: number | null;
    failure_events_12mo?: number | null;
    overdue_pm_count?: number | null;
}

export interface PidNode extends PidNodeInput {
    /** Process-flow edges arriving at this node. */
    inbound: string[];
    /** Process-flow edges leaving this node. */
    outbound: string[];
    /** Instrument / signal / electrical attachments — context, not flow. */
    attached: string[];
}

export interface PidGraph {
    nodes: Map<string, PidNode>;
    edges: Map<string, PidEdgeInput>;
    /** Nodes dropped because an edge referenced an id that does not exist. */
    danglingEdgeIds: string[];
}

export type SerializeMode = 'graph' | 'topology';

// Only process lines carry fluid. Instrument, signal and electrical edges tell
// you what watches or drives a component — they are never a flow path, and
// treating them as one is how a model invents a route that no fluid can take.
const FLOW_EDGE = 'process';

// Equipment that can stop flow. Isolation answers are built from these.
const ISOLATING_TYPES = new Set(['valve']);

// ── Build ────────────────────────────────────────────────────────────────

/**
 * Index a stored configuration into an adjacency structure.
 *
 * Tolerant by design: the editor lets a user delete a node while its
 * connections survive in JSONB, so an edge pointing at nothing is a normal
 * state of real data, not corruption. Such edges are recorded in
 * danglingEdgeIds and excluded, so the serialisation never references a node
 * the model cannot look up.
 */
export function buildPidGraph(
    equipment: PidNodeInput[],
    connections: PidEdgeInput[],
): PidGraph {
    const nodes = new Map<string, PidNode>();
    for (const eq of equipment ?? []) {
        if (!eq?.id) continue;
        nodes.set(eq.id, { ...eq, inbound: [], outbound: [], attached: [] });
    }

    const edges = new Map<string, PidEdgeInput>();
    const danglingEdgeIds: string[] = [];

    for (const conn of connections ?? []) {
        if (!conn?.id) continue;
        const from = nodes.get(conn.fromId);
        const to = nodes.get(conn.toId);
        if (!from || !to) {
            danglingEdgeIds.push(conn.id);
            continue;
        }
        edges.set(conn.id, conn);
        if (conn.type === FLOW_EDGE) {
            from.outbound.push(conn.id);
            to.inbound.push(conn.id);
        } else {
            from.attached.push(conn.id);
            to.attached.push(conn.id);
        }
    }

    return { nodes, edges, danglingEdgeIds };
}

// ── Serialise ────────────────────────────────────────────────────────────

function describeNode(n: PidNode, facts?: AssetFacts): string {
    const bits: string[] = [`${n.label} (${n.type})`];
    if (n.assetTag) bits.push(`asset ${n.assetTag}`);

    // Prefer the live health row over the value cached on the drawing: the
    // drawing is a snapshot from whenever someone last opened the editor.
    const crit = facts?.criticality ?? n.criticality;
    if (crit) bits.push(`criticality ${crit}`);

    if (facts) {
        if (facts.mtbf_days != null) bits.push(`MTBF ${facts.mtbf_days}d`);
        if (facts.failure_events_12mo != null) bits.push(`${facts.failure_events_12mo} failures/12mo`);
        if (facts.open_wo_count != null) bits.push(`${facts.open_wo_count} open WO`);
        if (facts.overdue_pm_count) bits.push(`${facts.overdue_pm_count} overdue PM`);
    } else if (n.healthIndex != null) {
        bits.push(`health ${n.healthIndex}%`);
    }

    return bits.join(', ');
}

/**
 * Render the graph as compact text for an LLM prompt.
 *
 * `graph` mode keeps node attributes and edge types — use it for questions
 * about specifications, condition or criticality. `topology` mode keeps labels
 * and connectivity only, which is what the paper found sufficient for flow and
 * routing questions at a fraction of the tokens.
 *
 * The format is deliberately line-oriented rather than XML or JSON: the study's
 * own failure analysis found machine-oriented artefacts (URIs, ids, structural
 * metadata) act as semantic noise, and smaller models in particular lose
 * accuracy filtering it. Nothing here is emitted that an engineer reading the
 * drawing would not say out loud.
 */
export function serializePidGraph(
    graph: PidGraph,
    opts: {
        mode?: SerializeMode;
        title?: string;
        facts?: Map<string, AssetFacts>;
    } = {},
): string {
    const mode = opts.mode ?? 'graph';
    const lines: string[] = [];

    lines.push(`P&ID: ${opts.title ?? 'untitled'}`);
    lines.push(`${graph.nodes.size} components, ${graph.edges.size} connections`);
    lines.push('');

    lines.push('COMPONENTS');
    for (const n of graph.nodes.values()) {
        const facts = n.assetTag ? opts.facts?.get(n.assetTag) : undefined;
        lines.push(
            mode === 'topology'
                ? `- ${n.label} (${n.type})`
                : `- ${describeNode(n, facts)}`,
        );
    }

    lines.push('');
    lines.push('PROCESS FLOW');
    const flow = [...graph.edges.values()].filter((e) => e.type === FLOW_EDGE);
    if (flow.length === 0) {
        lines.push('- (no process connections drawn)');
    }
    for (const e of flow) {
        const from = graph.nodes.get(e.fromId)!;
        const to = graph.nodes.get(e.toId)!;
        lines.push(`- ${from.label} -> ${to.label}`);
    }

    if (mode === 'graph') {
        const other = [...graph.edges.values()].filter((e) => e.type !== FLOW_EDGE);
        if (other.length) {
            lines.push('');
            lines.push('INSTRUMENT / SIGNAL / ELECTRICAL');
            for (const e of other) {
                const from = graph.nodes.get(e.fromId)!;
                const to = graph.nodes.get(e.toId)!;
                lines.push(`- ${from.label} -${e.type}- ${to.label}`);
            }
        }
    }

    if (graph.danglingEdgeIds.length) {
        lines.push('');
        lines.push(
            `NOTE: ${graph.danglingEdgeIds.length} connection(s) reference deleted components and were omitted.`,
        );
    }

    return lines.join('\n');
}

/**
 * Rough token count for the serialised graph (~4 characters per token).
 * Used to report retrieval cost honestly in the tool result rather than
 * asserting the paper's numbers, which were measured on a different drawing.
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

// ── Traversal ────────────────────────────────────────────────────────────
// Exact answers to the question types the study called "path exploration" —
// the category where reading the image degraded worst (0.92 graph vs 0.67
// image, even for the strongest model tested).

function neighbours(graph: PidGraph, nodeId: string, dir: 'up' | 'down'): string[] {
    const n = graph.nodes.get(nodeId);
    if (!n) return [];
    const edgeIds = dir === 'up' ? n.inbound : n.outbound;
    return edgeIds
        .map((id) => graph.edges.get(id))
        .filter((e): e is PidEdgeInput => !!e)
        .map((e) => (dir === 'up' ? e.fromId : e.toId));
}

/**
 * Every component upstream (or downstream) of a node, nearest first.
 * Cycles are normal on a P&ID — recirculation loops are a design, not a bug —
 * so the walk tracks visited nodes and terminates.
 */
export function walk(
    graph: PidGraph,
    startId: string,
    dir: 'up' | 'down',
    maxDepth = 12,
): { id: string; label: string; depth: number }[] {
    if (!graph.nodes.has(startId)) return [];
    const seen = new Set([startId]);
    const out: { id: string; label: string; depth: number }[] = [];
    let frontier = [startId];

    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
        const next: string[] = [];
        for (const id of frontier) {
            for (const nb of neighbours(graph, id, dir)) {
                if (seen.has(nb)) continue;
                seen.add(nb);
                next.push(nb);
                out.push({ id: nb, label: graph.nodes.get(nb)!.label, depth });
            }
        }
        frontier = next;
    }
    return out;
}

/**
 * Shortest process-flow route between two components, following flow direction.
 * Returns null when no route exists — which is itself an answer worth giving,
 * and one a model reading an image will rarely give correctly.
 */
export function tracePath(
    graph: PidGraph,
    fromId: string,
    toId: string,
): { id: string; label: string; type: string }[] | null {
    if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) return null;
    if (fromId === toId) {
        const n = graph.nodes.get(fromId)!;
        return [{ id: n.id, label: n.label, type: n.type }];
    }

    const prev = new Map<string, string>();
    const seen = new Set([fromId]);
    let frontier = [fromId];

    while (frontier.length) {
        const next: string[] = [];
        for (const id of frontier) {
            for (const nb of neighbours(graph, id, 'down')) {
                if (seen.has(nb)) continue;
                seen.add(nb);
                prev.set(nb, id);
                if (nb === toId) {
                    const path: string[] = [toId];
                    let cur = toId;
                    while (prev.has(cur)) {
                        cur = prev.get(cur)!;
                        path.unshift(cur);
                    }
                    return path.map((pid) => {
                        const n = graph.nodes.get(pid)!;
                        return { id: n.id, label: n.label, type: n.type };
                    });
                }
                next.push(nb);
            }
        }
        frontier = next;
    }
    return null;
}

/**
 * The valves to close to isolate a component from everything feeding it.
 *
 * Walks upstream and takes the FIRST isolating device on each branch — closing
 * a valve further upstream than that would strand equipment between it and the
 * target, which is how an over-broad isolation list becomes an outage. Branches
 * that reach a source with no valve on them are reported separately: an
 * un-isolatable inlet is a finding, not an omission, and silently returning a
 * shorter list would be the dangerous failure mode here.
 */
export function findIsolationPoints(
    graph: PidGraph,
    targetId: string,
    maxDepth = 12,
): {
    valves: { id: string; label: string; type: string }[];
    unisolatedBranches: { id: string; label: string }[];
} {
    const valves: { id: string; label: string; type: string }[] = [];
    const unisolated: { id: string; label: string }[] = [];
    if (!graph.nodes.has(targetId)) return { valves, unisolatedBranches: unisolated };

    const seen = new Set([targetId]);
    let frontier = [targetId];

    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
        const next: string[] = [];
        for (const id of frontier) {
            const ups = neighbours(graph, id, 'up');
            // A branch that runs out of upstream components without passing a
            // valve cannot be isolated from inside this drawing.
            if (ups.length === 0 && id !== targetId) {
                unisolated.push({ id, label: graph.nodes.get(id)!.label });
            }
            for (const up of ups) {
                if (seen.has(up)) continue;
                seen.add(up);
                const n = graph.nodes.get(up)!;
                if (ISOLATING_TYPES.has(n.type)) {
                    // Found the boundary on this branch — stop, do not walk past it.
                    valves.push({ id: n.id, label: n.label, type: n.type });
                } else {
                    next.push(up);
                }
            }
        }
        frontier = next;
    }

    return { valves, unisolatedBranches: unisolated };
}
