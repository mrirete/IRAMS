// Organisational context for the agents (migration 0308).
//
// Before this module the Specialist was "employed by this organisation"
// without knowing which one: no agent read industry, objectives, risks,
// governance status or maturity. Now every run (agent-run, the Monday
// briefing) prepends a short context block to the system prompt, and the
// get_org_context tool returns the full record on demand.
//
// Two sources, kept distinct in the prompt:
//   • org_context (self-reported — the onboarding audit's intake + 6M checklist)
//   • live facts (measured — register size, criticality mix, downtime rate)
//
// The block is deliberately short (≈ 300 tokens): it frames advice, it does
// not replace the tools. Under the service role (scheduled runs) there is no
// JWT, so the newest row is used — the same fleet-wide posture the briefing
// already takes for every other table.
import type { AgentTool, ToolContext, ToolResult } from "./types.ts";

export interface OrgContextRow {
  company_id: string;
  industry_sector: string | null;
  asset_class: string | null;
  site_name: string | null;
  vision: string | null;
  mission: string | null;
  strategic_objectives: string | null;
  assessment_objective: string | null;
  key_risks: string[] | null;
  key_opportunities: string[] | null;
  am_policy_status: string | null;
  samp_status: string | null;
  roles_status: string | null;
  risk_framework_status: string | null;
  budget_alignment_status: string | null;
  intake_overall: number | null;
  intake_level: string | null;
  intake_by_dimension: Record<string, number | null> | null;
  weakest_dimension: string | null;
  quick_wins: Array<{ label?: string; action?: string; isoRef?: string }> | null;
  sixm_overall: number | null;
  sixm_level: string | null;
  sixm_by_dimension: Record<string, number | null> | null;
  sixm_gap_count: number | null;
  source_assessment_number: string | null;
  assessed_at: string | null;
}

export interface LiveFacts {
  asset_count: number;
  criticality_mix: Record<string, number>;
  downtime_cost_per_hour: number | null;
  currency: string | null;
  company_name: string | null;
  tier: string | null;
}

export interface OrgContext {
  profile: OrgContextRow | null;
  facts: LiveFacts;
}

// deno-lint-ignore no-explicit-any
export async function loadOrgContext(db: any): Promise<OrgContext> {
  const [profileQ, companyQ, assetsQ] = await Promise.all([
    db.from("org_context").select("*").order("updated_at", { ascending: false }).limit(1),
    db.from("companies").select("name, currency, tier, downtime_cost_per_hour").limit(1),
    db.from("assets").select("criticality").limit(20000),
  ]);

  const profile = (profileQ?.data?.[0] as OrgContextRow | undefined) ?? null;
  const company = companyQ?.data?.[0] ?? null;
  const assets: Array<{ criticality: string | null }> = assetsQ?.data ?? [];
  const mix: Record<string, number> = {};
  for (const a of assets) {
    const k = (a.criticality ?? "unrated").toString().toUpperCase();
    mix[k] = (mix[k] ?? 0) + 1;
  }
  return {
    profile,
    facts: {
      asset_count: assets.length,
      criticality_mix: mix,
      downtime_cost_per_hour: company?.downtime_cost_per_hour ?? null,
      currency: company?.currency ?? null,
      company_name: company?.name ?? null,
      tier: company?.tier ?? null,
    },
  };
}

const fmtDims = (d: Record<string, number | null> | null | undefined, scale: string): string => {
  if (!d) return "not assessed";
  const parts = Object.entries(d)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${(v as number).toFixed(1)}`);
  return parts.length ? `${parts.join(", ")} (${scale})` : "not assessed";
};

/** The prompt block. Empty string when nothing is known, so prompts stay unchanged for fresh tenants. */
export function formatOrgContextBlock(ctx: OrgContext): string {
  const p = ctx.profile;
  const f = ctx.facts;
  const lines: string[] = [];

  if (f.company_name || f.asset_count) {
    lines.push(
      `Register: ${f.asset_count} assets` +
        (Object.keys(f.criticality_mix).length
          ? ` (criticality ${Object.entries(f.criticality_mix).map(([k, v]) => `${k}:${v}`).join(" ")})`
          : "") +
        (f.downtime_cost_per_hour ? `; downtime valued at ${f.currency ?? ""} ${f.downtime_cost_per_hour}/h` : "; no downtime cost rate configured — cost-of-downtime claims must say so"),
    );
  }
  if (p) {
    if (p.industry_sector || p.asset_class || p.site_name) {
      lines.push(`Industry: ${p.industry_sector ?? "unknown"}${p.asset_class ? ` · asset class ${p.asset_class}` : ""}${p.site_name ? ` · site ${p.site_name}` : ""}`);
    }
    if (p.strategic_objectives) lines.push(`Stated objectives: ${p.strategic_objectives.slice(0, 300)}`);
    if (p.assessment_objective) lines.push(`Assessment objective: ${p.assessment_objective.slice(0, 200)}`);
    if (p.key_risks?.length) lines.push(`Key risks they named: ${p.key_risks.slice(0, 6).join("; ")}`);
    const gov: string[] = [];
    if (p.am_policy_status) gov.push(`AM policy — ${p.am_policy_status}`);
    if (p.samp_status) gov.push(`SAMP — ${p.samp_status}`);
    if (p.risk_framework_status) gov.push(`risk framework — ${p.risk_framework_status}`);
    if (p.budget_alignment_status) gov.push(`budget alignment — ${p.budget_alignment_status}`);
    if (gov.length) lines.push(`Governance (ISO 55001 §5–6, self-reported): ${gov.join("; ")}`);
    if (p.intake_overall != null || p.sixm_overall != null) {
      lines.push(
        `Self-reported maturity: intake ${p.intake_overall != null ? `${p.intake_overall}/5 ${p.intake_level ?? ""}` : "n/a"} — ${fmtDims(p.intake_by_dimension, "0–5")}; ` +
          `6M ${p.sixm_overall != null ? `${p.sixm_overall}/5 ${p.sixm_level ?? ""}` : "n/a"} — ${fmtDims(p.sixm_by_dimension, "1–5")}` +
          (p.weakest_dimension ? `. Weakest: ${p.weakest_dimension}` : "") +
          (p.source_assessment_number ? ` [${p.source_assessment_number}${p.assessed_at ? `, ${p.assessed_at.slice(0, 10)}` : ""}]` : ""),
      );
    }
  }
  if (lines.length === 0) return "";

  return (
    `\n\n═══ ORGANISATIONAL CONTEXT (ISO 55001 §4) ═══\n` +
    lines.map((l) => `- ${l}`).join("\n") +
    `\n- Rules: maturity and governance lines are SELF-REPORTED by the organisation and directional; say "self-reported" when you lean on them, and prefer measured tool data when the two disagree. Shape recommendations to the stated objectives and weakest dimension. Call get_org_context for the full record.`
  );
}

export const getOrgContext: AgentTool = {
  name: "get_org_context",
  description:
    "Read the organisation's context record (ISO 55001 §4): industry, asset class, stated objectives, key risks and opportunities, asset-management governance status (policy, SAMP, roles, risk framework, budget alignment), self-reported maturity by dimension from the onboarding audit (intake and 6M checklist) with the weakest dimension and quick wins, plus measured register facts (asset count, criticality mix, downtime cost rate). Use it to tailor advice to what this organisation is trying to achieve and where it is weakest.",
  parameters: { type: "object", properties: {}, required: [] },
  tier: 1,
  async run(_args, ctx: ToolContext): Promise<ToolResult> {
    const c = await loadOrgContext(ctx.db);
    const sources = [{ kind: "org_context", ref: c.profile?.source_assessment_number ?? "none", label: c.profile ? `Onboarding audit ${c.profile.source_assessment_number ?? ""}`.trim() : "No audit on record" }];
    ctx.sources.push(...sources);
    return {
      data: {
        profile: c.profile,
        measured: c.facts,
        note: c.profile
          ? "profile fields are self-reported by the organisation (directional); 'measured' comes from the register."
          : "No onboarding audit has been saved for this organisation yet — advise from measured data and say the context is unknown.",
      },
      sources,
      warnings: c.profile ? undefined : ["org_context is empty: run the maturity intake under Audits to give the Specialist its context."],
    };
  },
};
