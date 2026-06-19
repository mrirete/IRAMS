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

/** Invoke a named agent. `supabase.functions.invoke` attaches the user's JWT. */
export async function runAgent(agent: string, query: string): Promise<AgentRunResponse> {
    const { data, error } = await supabase.functions.invoke('agent-run', {
        body: { agent, query },
    });
    if (error) throw new Error(error.message || 'agent-run request failed');
    if (data && (data as { error?: string }).error) {
        throw new Error((data as { error: string }).error);
    }
    return data as AgentRunResponse;
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
