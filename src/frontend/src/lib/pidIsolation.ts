/**
 * pidIsolation — propose a permit's isolation points from the P&ID graph.
 *
 * WHY THIS EXISTS
 * pidGraph.findIsolationPoints already answers "which valves isolate X" for
 * the agent (query_pid). The permit's LOTO plan is typed by hand. This module
 * is the bridge: given the drawings the site has stored and the asset a work
 * order is on, it returns the valves the graph says bound that asset — as
 * PROPOSALS, in the shape ptw_isolation_points takes, for a supervisor to
 * accept or discard one by one.
 *
 * WHAT IT IS NOT
 * Not a safety authority. A drawing can be out of date, a graph can be
 * incomplete (an unisolated branch is reported, never hidden), and a valve
 * that isolates on paper may be passing. Everything here is a starting list
 * that a person verifies at the equipment; nothing is ever written as
 * ISOLATED or VERIFIED.
 *
 * Pure: drawings in, proposals out. The graph engine is the same file the
 * Edge Function uses (supabase/functions/agent-run/pidGraph.ts) — one
 * traversal, not two that can disagree.
 */
import {
    buildPidGraph,
    findIsolationPoints,
    type PidEdgeInput,
    type PidNodeInput,
} from '../../supabase/functions/agent-run/pidGraph.ts';

/** The subset of ers_pid_configurations a proposal needs. */
export interface PidDrawing {
    id: string;
    title: string;
    asset_id?: string | null;
    equipment: unknown[];
    connections: unknown[];
}

export interface IsolationProposal {
    /** Valve label as drawn — becomes ptw_isolation_points.tag_number. */
    tagNumber: string;
    /** ISOLATION_TYPE dictionary code. */
    isolationType: 'PROCESS' | 'ELECTRICAL' | 'INSTRUMENT' | 'MECHANICAL' | 'OTHER';
    method: 'LOCK';
    normalPosition: 'OPEN';
    isolatedPosition: 'CLOSED';
    /** Where it came from, so the permit can cite the drawing. */
    pidConfigId: string;
    pidNodeId: string;
    nodeType: string;
}

export interface DrawingProposal {
    drawing: { id: string; title: string };
    /** The component on the drawing that matched the asset. */
    node: { id: string; label: string; type: string };
    proposals: IsolationProposal[];
    /** Upstream branches that leave the sheet without passing a valve. */
    unisolatedBranches: { id: string; label: string }[];
}

const norm = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Does this drawn component stand for the asset? Register link first
 * (assetId), then the drawn asset tag, then the label — normalised so
 * 'P-101A' and 'P101A' agree.
 */
export function nodeMatchesAsset(node: PidNodeInput, assetId: string | null | undefined, assetTag: string | null | undefined): boolean {
    if (assetId && node.assetId && node.assetId === assetId) return true;
    const t = norm(assetTag);
    if (!t) return false;
    return norm(node.assetTag) === t || norm(node.label) === t;
}

function asNodes(v: unknown[]): PidNodeInput[] {
    return (Array.isArray(v) ? v : []).filter((n): n is PidNodeInput => !!n && typeof n === 'object' && typeof (n as PidNodeInput).id === 'string');
}
function asEdges(v: unknown[]): PidEdgeInput[] {
    return (Array.isArray(v) ? v : []).filter((e): e is PidEdgeInput => !!e && typeof e === 'object' && typeof (e as PidEdgeInput).fromId === 'string');
}

/** Which of the site's drawings show this asset at all. */
export function drawingsContainingAsset(drawings: PidDrawing[], assetId: string | null | undefined, assetTag: string | null | undefined): { drawing: PidDrawing; node: PidNodeInput }[] {
    const out: { drawing: PidDrawing; node: PidNodeInput }[] = [];
    for (const d of drawings ?? []) {
        const node = asNodes(d.equipment).find((n) => nodeMatchesAsset(n, assetId, assetTag));
        if (node) out.push({ drawing: d, node });
    }
    return out;
}

/** Map a drawn component type to the permit's isolation vocabulary. */
export function isolationTypeFor(nodeType: string): IsolationProposal['isolationType'] {
    const t = (nodeType || '').toLowerCase();
    if (/breaker|switch|mcc|electrical|disconnect/.test(t)) return 'ELECTRICAL';
    if (/valve|blind|spade|spectacle/.test(t)) return 'PROCESS';
    if (/instrument|transmitter/.test(t)) return 'INSTRUMENT';
    if (/coupling|guard|brake/.test(t)) return 'MECHANICAL';
    return 'OTHER';
}

/**
 * Propose isolation points for one asset from every drawing that shows it.
 * Returns one entry per matching drawing (a site may draw the same pump on a
 * unit sheet and a utilities sheet — the supervisor sees both lists).
 */
export function proposeIsolationFromDrawings(
    drawings: PidDrawing[],
    assetId: string | null | undefined,
    assetTag: string | null | undefined,
): DrawingProposal[] {
    const out: DrawingProposal[] = [];
    for (const { drawing, node } of drawingsContainingAsset(drawings, assetId, assetTag)) {
        const graph = buildPidGraph(asNodes(drawing.equipment), asEdges(drawing.connections));
        const { valves, unisolatedBranches } = findIsolationPoints(graph, node.id);
        const seen = new Set<string>();
        const proposals: IsolationProposal[] = [];
        for (const v of valves) {
            const key = norm(v.label);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            proposals.push({
                tagNumber: v.label,
                isolationType: isolationTypeFor(v.type),
                method: 'LOCK',
                normalPosition: 'OPEN',
                isolatedPosition: 'CLOSED',
                pidConfigId: drawing.id,
                pidNodeId: v.id,
                nodeType: v.type,
            });
        }
        out.push({
            drawing: { id: drawing.id, title: drawing.title },
            node: { id: node.id, label: node.label, type: node.type },
            proposals,
            unisolatedBranches,
        });
    }
    return out;
}
