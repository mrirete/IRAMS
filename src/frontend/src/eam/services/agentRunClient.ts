/**
 * agentRunClient — frontend client for the `agent-run` Supabase Edge Function
 * (Phase 0 of the reliability AI agent system; see
 * docs/reliability-ai-agents-design.md).
 *
 * The Edge Function runs the Gemini tool-calling loop server-side (key stays a
 * Supabase secret), enforces the Tier-2 governance cap, writes the audit trail,
 * and returns a cited answer plus any drafts queued for human approval.
 */
import { supabase } from '../lib/supabase';

export interface AgentSource {
    kind: string;
    ref: string;
    label?: string;
}

export interface AgentProposal {
    agent_type: string;
    action_type: string;
    asset_id?: string | null;
    draft_payload: Record<string, unknown>;
}

export interface AgentRunResponse {
    agent: string;
    query: string;
    answer: string;
    confidence: number;
    tier_used: number;
    requires_human_approval: boolean;
    sources: AgentSource[];
    proposals: AgentProposal[];
    safety_flags: string[];
    tokens_used: number;
    duration_ms: number;
}

/** One prior conversational turn (prose only) for multi-turn agents. */
export interface AgentTurn {
    role: 'user' | 'model';
    text: string;
}

/** Invoke a named agent. `supabase.functions.invoke` attaches the user's JWT. */
export async function runAgent(agent: string, query: string, history: AgentTurn[] = []): Promise<AgentRunResponse> {
    const { data, error } = await supabase.functions.invoke('agent-run', {
        body: { agent, query, history },
    });
    if (error) throw new Error(error.message || 'agent-run request failed');
    if (data && (data as { error?: string }).error) {
        throw new Error((data as { error: string }).error);
    }
    return data as AgentRunResponse;
}

/**
 * RCA Copilot — multi-turn facilitator embedded in an investigation.
 * The first turn carries the investigation id; the agent grounds itself via
 * get_investigation / asset health / failure history and co-drives the RCA.
 */
export function runRcaCopilot(
    investigationId: string,
    message: string,
    history: AgentTurn[] = [],
): Promise<AgentRunResponse> {
    const query = history.length === 0
        ? `investigation_id: ${investigationId}\n\n${message}`
        : `(investigation_id: ${investigationId})\n${message}`;
    return runAgent('rca_copilot', query, history);
}

const DEFAULT_BAD_ACTOR_QUERY =
    'Find the top maintenance bad actors over the last 12 months by total cost, ' +
    'explain the Pareto split, and draft defect-elimination tasks for the worst offenders.';

/** Bad Actor Hunter (the Phase-0 flagship). */
export function runBadActorHunter(query: string = DEFAULT_BAD_ACTOR_QUERY): Promise<AgentRunResponse> {
    return runAgent('bad_actor_hunter', query);
}

/**
 * RCA Challenger — adversarially critiques a proposed root cause.
 * Pass the proposed root cause / 5-Why text; include the asset tag for
 * evidence-grounded critique (the agent checks failure history).
 */
export function runRcaChallenger(rcaText: string, assetTag?: string): Promise<AgentRunResponse> {
    const query = assetTag
        ? `Asset: ${assetTag}\n\nProposed root cause / analysis to challenge:\n${rcaText}`
        : `Proposed root cause / analysis to challenge:\n${rcaText}`;
    return runAgent('rca_challenger', query);
}

/**
 * Corrosion Sentinel — API 510/570/653 corrosion-risk assessment from thickness
 * readings. Pass an asset tag to scope to one asset, else it scans the fleet.
 */
export function runCorrosionSentinel(assetTag?: string): Promise<AgentRunResponse> {
    const query = assetTag
        ? `Assess corrosion risk for asset ${assetTag}: flag CMLs near end-of-life or below t-min and recommend inspections.`
        : 'Scan the fleet for corrosion risk: flag the CMLs nearest end-of-life or below t-min and recommend inspections.';
    return runAgent('corrosion_sentinel', query);
}

/** PM Optimizer — finds over-frequent, ineffective or redundant PM programs. */
export function runPmOptimizer(assetTag?: string): Promise<AgentRunResponse> {
    const query = assetTag
        ? `Review the PM program for asset ${assetTag} and recommend cost-saving changes.`
        : 'Review the PM program across the fleet and recommend the highest-value cost-saving changes.';
    return runAgent('pm_optimizer', query);
}

/** Reliability & Integrity Digest — cited weekly briefing across the fleet. */
export function runReliabilityDigest(): Promise<AgentRunResponse> {
    return runAgent('reliability_digest', 'Produce this week\'s reliability & integrity digest for the fleet.');
}

/** Warranty Recovery — completed WOs done under active warranty (recoverable spend). */
export function runWarrantyRecovery(assetTag?: string): Promise<AgentRunResponse> {
    const query = assetTag
        ? `Find recoverable warranty spend for asset ${assetTag} and recommend claims.`
        : 'Scan the fleet for recoverable warranty spend and recommend the highest-value claims.';
    return runAgent('warranty_recovery', query);
}

/**
 * CMMS Analyst — proposes a column mapping for a foreign CMMS export
 * (Specialist Phase 1). The payload carries headers + sample rows; the answer
 * contains a ```import-mapping``` fenced block parsed by
 * lib/importPipeline.parseMappingProposal. Advisory: a human confirms the
 * mapping in the wizard before anything is staged.
 */
export function runCmmsAnalyst(payload: {
    file_name: string;
    source_hint?: string;
    headers: string[];
    sample_rows: unknown[][];
}): Promise<AgentRunResponse> {
    const query =
        `Propose an import mapping for this CMMS export.\n` +
        `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
    return runAgent('cmms_analyst', query);
}

/**
 * Assessment Narrator — writes the executive summary over findings computed
 * deterministically by the app (bad actors, Weibull, PM waste, warranty,
 * integrity, data quality). Numbers in, prose out — never the reverse.
 */
export function runAssessmentNarrator(findings: Record<string, unknown>): Promise<AgentRunResponse> {
    const query =
        `Write the executive summary for this reliability assessment.\n` +
        `\`\`\`json\n${JSON.stringify(findings)}\n\`\`\``;
    return runAgent('assessment_narrator', query);
}

/**
 * Root Success Analyst (RSA, PSC framework) — positive deviance: why does the
 * best asset in a class succeed, and how do we propagate it? Advisory only.
 */
export function runRsaAnalyst(scope?: string): Promise<AgentRunResponse> {
    const query = scope?.trim()
        ? `Run a Root Success Analysis focused on: ${scope.trim()}`
        : 'Run a fleet Root Success Analysis: find the positive deviants and explain how to propagate their success.';
    return runAgent('rsa_analyst', query);
}

/**
 * Weibull Analyst — censored Weibull fit + PM-interval recommendation for one
 * asset (Tier 2: may queue a draft_pm_interval proposal for human review).
 */
export function runWeibullAnalyst(assetTag: string): Promise<AgentRunResponse> {
    return runAgent(
        'weibull_analyst',
        `Characterise the failure behaviour of asset ${assetTag} and recommend a statistically defensible PM basis.`,
    );
}

/**
 * The Specialist (supervisor) — the workspace conversation partner. Full read
 * toolkit; chains tools for end-to-end asset workups. Advisory only.
 */
export function runSpecialist(query: string, history: AgentTurn[] = []): Promise<AgentRunResponse> {
    return runAgent('specialist_supervisor', query, history);
}

/**
 * Ask the Specialist about a P&ID. The supervisor reaches the drawing through
 * the query_pid tool, which walks the stored graph deterministically — so the
 * flow paths and valve lists in the answer come from the drawing, not from the
 * model's recollection of what a process unit usually looks like.
 *
 * The title is pinned into the query because a site may hold several drawings
 * and the tool will otherwise stop and ask which one.
 */
export function runPidQuestion(question: string, pidTitle: string): Promise<AgentRunResponse> {
    return runAgent(
        'specialist_supervisor',
        `P&ID: "${pidTitle}"\n\n${question}\n\n` +
        `(Use query_pid with pid_title exactly as given above. Report its paths and ` +
        `valve lists as returned — do not add, reorder or infer components.)`,
    );
}

/**
 * Manual Reader — answers equipment questions from the organisation's own
 * indexed OEM manuals and SOPs, citing document and page. Advisory only.
 */
export function runManualReader(question: string, assetTag?: string): Promise<AgentRunResponse> {
    const query = assetTag
        ? `${question}\n\n(The asset in question is ${assetTag}.)`
        : question;
    return runAgent('manual_reader', query);
}
