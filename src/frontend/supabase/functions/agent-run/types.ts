// Shared types for the agent-run Edge Function (Phase 0 of the reliability
// AI agent system — see docs/reliability-ai-agents-design.md).

export type GovernanceTier = 1 | 2 | 3;

/** A citation attached to a tool result, so every claim is traceable. */
export interface ToolSource {
  kind: string;        // e.g. "work_orders", "asset"
  ref: string;         // id / query that produced the data
  label?: string;      // human-readable
}

export interface ToolResult {
  data: unknown;
  sources: ToolSource[];
  warnings?: string[];
}

/**
 * A draft the agent proposes but does NOT write. Persisted to
 * ers_agent_actions with status 'pending_review' for human approval.
 */
export interface AgentProposal {
  agent_type: string;
  action_type: string;
  asset_id?: string | null;
  draft_payload: Record<string, unknown>;
}

export interface AgentResponse {
  agent: string;
  query: string;
  answer: string;
  confidence: number;
  tier_used: GovernanceTier;
  requires_human_approval: boolean;
  sources: ToolSource[];
  proposals: AgentProposal[];
  safety_flags: string[];
  tokens_used: number;
  duration_ms: number;
}

/** Context handed to every tool handler. */
export interface ToolContext {
  // deno-lint-ignore no-explicit-any
  db: any;                    // user-scoped Supabase client (respects RLS)
  proposals: AgentProposal[]; // tools push drafts here; never written directly
  sources: ToolSource[];      // tools push citations here
}

/** A deterministic tool the LLM may call. The LLM orchestrates; tools compute. */
export interface AgentTool {
  name: string;
  description: string;
  // Gemini functionDeclaration JSON schema for the parameters.
  parameters: Record<string, unknown>;
  tier: GovernanceTier;
  // deno-lint-ignore no-explicit-any
  run: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

export interface AgentDefinition {
  name: string;
  systemPrompt: string;
  tools: AgentTool[];
  maxTier: GovernanceTier;
  module: string; // for the audit log
}
