// Deterministic tools for the reliability agents. The LLM decides WHICH tool
// to call; the math/data lives here. Every tool returns cited sources.
import type { AgentTool, ToolContext, ToolResult } from "./types.ts";

// ── rank_bad_actors ──────────────────────────────────────────────────────
// Folds "query WO cost/frequency" + "Pareto" into one deterministic tool
// (more reliable than asking the LLM to chain three calls). Mirrors the
// methodology in layer2-modules/ers-analyze/bad_actor/analyzer.py.
const rankBadActors: AgentTool = {
  name: "rank_bad_actors",
  description:
    "Rank assets as maintenance 'bad actors' over a period, by total work-order cost or work-order frequency, with Pareto cumulative percentages. Returns the worst N assets with their costs, WO counts and asset tags. Use this before drafting any defect-elimination task.",
  parameters: {
    type: "object",
    properties: {
      criteria: {
        type: "string",
        enum: ["cost", "wo_frequency"],
        description: "Ranking criterion: total maintenance cost, or number of work orders.",
      },
      period_days: {
        type: "integer",
        description: "Look-back window in days (default 365).",
      },
      top_n: {
        type: "integer",
        description: "How many worst assets to return (default 5).",
      },
    },
    required: ["criteria"],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const criteria: string = args?.criteria === "wo_frequency" ? "wo_frequency" : "cost";
    const periodDays: number = Number.isFinite(args?.period_days) ? Math.max(1, args.period_days) : 365;
    const topN: number = Number.isFinite(args?.top_n) ? Math.max(1, Math.min(20, args.top_n)) : 5;

    const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: wos, error } = await ctx.db
      .from("work_orders")
      .select("asset_id, frozen_labor_cost, frozen_material_cost, created_at, status")
      .gte("created_at", cutoff)
      .limit(20000);
    if (error) throw new Error(`work_orders query failed: ${error.message}`);

    const agg = new Map<string, { cost: number; count: number }>();
    for (const wo of wos ?? []) {
      if (!wo.asset_id) continue;
      const cost = (Number(wo.frozen_labor_cost) || 0) + (Number(wo.frozen_material_cost) || 0);
      const cur = agg.get(wo.asset_id) ?? { cost: 0, count: 0 };
      cur.cost += cost;
      cur.count += 1;
      agg.set(wo.asset_id, cur);
    }

    const metric = (v: { cost: number; count: number }) => (criteria === "cost" ? v.cost : v.count);
    const grandTotal = [...agg.values()].reduce((s, v) => s + metric(v), 0) || 1;

    const sorted = [...agg.entries()].sort((a, b) => metric(b[1]) - metric(a[1])).slice(0, topN);

    // Resolve asset tags/names for the ranked subset.
    const ids = sorted.map(([id]) => id);
    const tagById = new Map<string, { tag: string; name: string; criticality: string }>();
    if (ids.length) {
      const { data: assets } = await ctx.db
        .from("assets")
        .select("id, tag, name, criticality")
        .in("id", ids);
      for (const a of assets ?? []) tagById.set(a.id, { tag: a.tag, name: a.name, criticality: a.criticality });
    }

    let cumulative = 0;
    const ranked = sorted.map(([assetId, v], i) => {
      cumulative += metric(v);
      const meta = tagById.get(assetId);
      ctx.sources.push({ kind: "work_orders", ref: assetId, label: `${v.count} WOs for ${meta?.tag ?? assetId}` });
      return {
        rank: i + 1,
        asset_id: assetId,
        asset_tag: meta?.tag ?? "(unknown)",
        asset_name: meta?.name ?? "(unknown asset)",
        criticality: meta?.criticality ?? null,
        total_cost: Math.round(v.cost),
        wo_count: v.count,
        cumulative_pct: Math.round((cumulative / grandTotal) * 1000) / 10,
      };
    });

    return {
      data: {
        criteria,
        period_days: periodDays,
        assets_analysed: agg.size,
        ranked,
        methodology: "Aggregated frozen labor+material cost and WO count per asset over the window; sorted by criterion; cumulative % = Pareto share of grand total.",
      },
      sources: [{ kind: "work_orders", ref: `created_at>=${cutoff}`, label: `${(wos ?? []).length} work orders in window` }],
      warnings: (wos ?? []).length === 0 ? ["No work orders found in the period — results are empty."] : undefined,
    };
  },
};

// ── draft_de_task ─────────────────────────────────────────────────────────
// Produces a Defect-Elimination task PROPOSAL (never writes). Recorded to
// ers_agent_actions (pending_review) for a human to approve.
const draftDeTask: AgentTool = {
  name: "draft_de_task",
  description:
    "Draft a Defect-Elimination task for a bad-actor asset. This does NOT create anything — it queues a proposal for human approval. Only call after rank_bad_actors. Provide a concrete root cause and proposed solution grounded in the data.",
  parameters: {
    type: "object",
    properties: {
      asset_id: { type: "string", description: "Asset UUID from rank_bad_actors." },
      asset_name: { type: "string" },
      title: { type: "string", description: "Short task title." },
      priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
      root_cause_summary: { type: "string" },
      proposed_solution: { type: "string" },
      annual_cost: { type: "number", description: "Current annual cost of this defect (from the ranking)." },
      estimated_savings: { type: "number" },
      implementation_cost: { type: "number" },
    },
    required: ["asset_name", "title", "root_cause_summary", "proposed_solution"],
  },
  tier: 2,
  // deno-lint-ignore require-await
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const annual = Number(args?.annual_cost) || 0;
    const savings = Number(args?.estimated_savings) || 0;
    const impl = Number(args?.implementation_cost) || 0;
    const payback = savings > 0 ? Math.round((impl / savings) * 12 * 10) / 10 : 0;

    const payload = {
      asset_id: args?.asset_id ?? null,
      asset_name: String(args?.asset_name),
      title: String(args?.title ?? "Defect elimination"),
      status: "identified",
      priority: ["critical", "high", "medium", "low"].includes(args?.priority) ? args.priority : "medium",
      annual_cost: annual,
      estimated_savings: savings,
      implementation_cost: impl,
      payback_months: payback,
      root_cause_summary: String(args?.root_cause_summary ?? ""),
      proposed_solution: String(args?.proposed_solution ?? ""),
      created_by: "bad_actor_hunter",
    };

    ctx.proposals.push({
      agent_type: "bad_actor_hunter",
      action_type: "draft_de_task",
      asset_id: args?.asset_id ?? null,
      draft_payload: payload,
    });

    return {
      data: { drafted: true, title: payload.title, asset: payload.asset_name },
      sources: [{ kind: "proposal", ref: payload.title, label: "DE task draft (pending review)" }],
    };
  },
};

// ── query_failure_history ─────────────────────────────────────────────────
// Evidence lookup for the RCA Challenger: recent failures for an asset
// (work_orders joined to wo_failure_data). Read-only, cited.
const queryFailureHistory: AgentTool = {
  name: "query_failure_history",
  description:
    "Look up an asset's recent failure history (work orders + failure mode/cause/remedy codes) to check a proposed root cause against the evidence. Provide asset_tag or asset_id.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: { type: "string", description: "Asset tag (e.g. P-101)." },
      asset_id: { type: "string", description: "Asset UUID (if known)." },
      limit: { type: "integer", description: "Max work orders to return (default 25)." },
    },
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(100, args.limit)) : 25;

    let assetId: string | null = args?.asset_id ?? null;
    let assetTag: string | null = args?.asset_tag ?? null;
    if (!assetId && assetTag) {
      const { data: a } = await ctx.db.from("assets").select("id, tag").ilike("tag", assetTag).limit(1);
      if (a && a[0]) { assetId = a[0].id; assetTag = a[0].tag; }
    }
    if (!assetId) {
      return { data: { error: "No matching asset found", asset_tag: assetTag }, sources: [], warnings: ["Provide a valid asset_tag or asset_id."] };
    }

    const { data: wos, error } = await ctx.db
      .from("work_orders")
      .select("wo_number, title, type, created_at, wo_failure_data(failure_mode_code, failure_cause_code, remedy_code, comments)")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`failure history query failed: ${error.message}`);

    const history = (wos ?? []).map((w: Record<string, any>) => ({
      wo_number: w.wo_number,
      title: w.title,
      type: w.type,
      date: w.created_at,
      failure: w.wo_failure_data
        ? {
            mode: w.wo_failure_data.failure_mode_code,
            cause: w.wo_failure_data.failure_cause_code,
            remedy: w.wo_failure_data.remedy_code,
            comments: w.wo_failure_data.comments,
          }
        : null,
    }));

    ctx.sources.push({ kind: "work_orders", ref: assetId, label: `${history.length} WOs for ${assetTag ?? assetId}` });
    return {
      data: { asset_id: assetId, asset_tag: assetTag, work_order_count: history.length, history },
      sources: [{ kind: "work_orders", ref: assetId, label: `failure history (${history.length} WOs)` }],
      warnings: history.length === 0 ? ["No work-order history for this asset — critique the reasoning on its own merits."] : undefined,
    };
  },
};

// ── scan_corrosion_risk ────────────────────────────────────────────────────
// API-510/570/653 corrosion assessment from thickness readings. Faithfully
// replicates src/eam/utils/integrityCalcs.ts assessCML() server-side.
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
const RL_CAP = 99;
function codeMaxIntervalYears(component: string): number {
  if (component?.startsWith("piping") || component === "weld") return 5; // API 570
  if (component?.startsWith("tank")) return 10;                          // API 653
  return 10;                                                             // API 510 vessels
}

const scanCorrosionRisk: AgentTool = {
  name: "scan_corrosion_risk",
  description:
    "Assess mechanical-integrity corrosion risk from thickness readings: per CML it computes short/long-term corrosion rates, remaining life and the next inspection date (API 510/570/653), and flags CMLs below t-min, near end-of-life, or accelerating. Provide an asset_tag/asset_id to scope to one asset, else it scans the fleet.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: { type: "string", description: "Limit to one asset by tag." },
      asset_id: { type: "string", description: "Limit to one asset by UUID." },
      max_remaining_life_years: { type: "number", description: "Flag CMLs with remaining life below this (default 10)." },
      limit: { type: "integer", description: "Max at-risk CMLs to return (default 15)." },
    },
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const threshold = Number.isFinite(args?.max_remaining_life_years) ? args.max_remaining_life_years : 10;
    const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(50, args.limit)) : 15;

    let assetId: string | null = args?.asset_id ?? null;
    if (!assetId && args?.asset_tag) {
      const { data: a } = await ctx.db.from("assets").select("id").ilike("tag", args.asset_tag).limit(1);
      if (a && a[0]) assetId = a[0].id;
    }

    let cmlQuery = ctx.db.from("ers_cmls").select("id, asset_id, cml_number, component_type, nominal_thickness_mm, tmin_mm");
    if (assetId) cmlQuery = cmlQuery.eq("asset_id", assetId);
    const { data: cmls, error: cmlErr } = await cmlQuery.limit(2000);
    if (cmlErr) throw new Error(`ers_cmls query failed: ${cmlErr.message}`);
    if (!cmls || cmls.length === 0) {
      return { data: { assessed: 0, at_risk: [] }, sources: [], warnings: ["No CMLs found for the requested scope."] };
    }

    const cmlIds = cmls.map((c: Record<string, any>) => c.id);
    const { data: readings, error: rErr } = await ctx.db
      .from("ers_thickness_readings")
      .select("cml_id, reading_date, measured_thickness_mm")
      .in("cml_id", cmlIds)
      .limit(20000);
    if (rErr) throw new Error(`thickness readings query failed: ${rErr.message}`);

    const byCml = new Map<string, { date: string; t: number }[]>();
    for (const r of readings ?? []) {
      if (!Number.isFinite(Number(r.measured_thickness_mm))) continue;
      const arr = byCml.get(r.cml_id) ?? [];
      arr.push({ date: r.reading_date, t: Number(r.measured_thickness_mm) });
      byCml.set(r.cml_id, arr);
    }

    const yrs = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_YEAR;

    const assessed: Record<string, any>[] = [];
    for (const c of cmls as Record<string, any>[]) {
      const series = (byCml.get(c.id) ?? []).sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime());
      if (series.length < 2) continue;
      const first = series[0], prev = series[series.length - 2], last = series[series.length - 1];
      const ltY = yrs(first.date, last.date), stY = yrs(prev.date, last.date);
      const longTerm = ltY > 0 ? (first.t - last.t) / ltY : 0;
      const shortTerm = stY > 0 ? (prev.t - last.t) / stY : 0;
      const controlling = Math.max(shortTerm, longTerm, 0);
      const belowTmin = last.t <= Number(c.tmin_mm);
      const remainingLife = belowTmin ? 0 : controlling <= 0 ? RL_CAP : Math.min((last.t - Number(c.tmin_mm)) / controlling, RL_CAP);
      const interval = Math.max(0, Math.min(remainingLife / 2, codeMaxIntervalYears(c.component_type)));
      const due = new Date(new Date(last.date).getTime() + interval * MS_PER_YEAR);
      const accelerating = longTerm > 0 && shortTerm > 2 * longTerm;

      assessed.push({
        cml_id: c.id, cml_number: c.cml_number, asset_id: c.asset_id, component_type: c.component_type,
        t_actual_mm: Math.round(last.t * 1000) / 1000, tmin_mm: Number(c.tmin_mm),
        controlling_rate_mmpy: Math.round(controlling * 1e4) / 1e4,
        remaining_life_years: Math.round(remainingLife * 10) / 10,
        below_tmin: belowTmin, is_accelerating: accelerating,
        next_inspection_due: due.toISOString().slice(0, 10),
        severity: belowTmin ? "BELOW T-MIN" : remainingLife < 2 ? "critical" : remainingLife < 5 ? "high" : "watch",
      });
    }

    const atRisk = assessed
      .filter((a) => a.below_tmin || a.is_accelerating || a.remaining_life_years < threshold)
      .sort((a, b) => a.remaining_life_years - b.remaining_life_years)
      .slice(0, limit);

    // Resolve asset tags for the at-risk subset.
    const aIds = [...new Set(atRisk.map((a) => a.asset_id))];
    if (aIds.length) {
      const { data: assets } = await ctx.db.from("assets").select("id, tag, name").in("id", aIds);
      const tagById = new Map((assets ?? []).map((a: Record<string, any>) => [a.id, a]));
      for (const a of atRisk) {
        const meta = tagById.get(a.asset_id);
        a.asset_tag = meta?.tag ?? "(unknown)";
        a.asset_name = meta?.name ?? "(unknown asset)";
        ctx.sources.push({ kind: "ers_cmls", ref: a.cml_id, label: `CML ${a.cml_number} on ${a.asset_tag}` });
      }
    }

    return {
      data: {
        cmls_assessed: assessed.length,
        at_risk_count: atRisk.length,
        threshold_years: threshold,
        at_risk: atRisk,
        methodology: "Per CML: LT rate=(t_first−t_last)/yrs, ST rate=(t_prev−t_last)/yrs, controlling=max(ST,LT,0); remaining life=(t_actual−t_min)/controlling; next inspection=half remaining life capped to code max (API 510/570/653).",
      },
      sources: [{ kind: "ers_cmls", ref: assetId ?? "fleet", label: `${cmls.length} CMLs, ${(readings ?? []).length} readings` }],
      warnings: assessed.length === 0 ? ["No CML has ≥2 thickness readings — cannot derive corrosion rates yet."] : undefined,
    };
  },
};

export const TOOLS: Record<string, AgentTool> = {
  [rankBadActors.name]: rankBadActors,
  [draftDeTask.name]: draftDeTask,
  [queryFailureHistory.name]: queryFailureHistory,
  [scanCorrosionRisk.name]: scanCorrosionRisk,
};
