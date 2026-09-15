// Deterministic tools for the reliability agents. The LLM decides WHICH tool
// to call; the math/data lives here. Every tool returns cited sources.
import type { AgentTool, ToolContext, ToolResult } from "./types.ts";
import {
  buildPidGraph,
  serializePidGraph,
  estimateTokens,
  walk,
  tracePath,
  findIsolationPoints,
  type AssetFacts,
  type PidEdgeInput,
  type PidNodeInput,
} from "./pidGraph.ts";
import {
  bucketsFromManualLogs,
  downsample,
  normalizeBuckets,
  summarizeUntimed,
  summarizeWindow,
  type Bands,
  type SeriesSummary,
  type WindowBucket,
} from "./readingsSummary.ts";

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
/**
 * One embedded wo_failure_data row, whichever shape PostgREST returns.
 *
 * The embed is hinted `!wo_id` because 0289 added `caused_by_wo_id`, a second FK
 * from wo_failure_data to work_orders: without the hint PostgREST refuses the
 * whole query with PGRST201 and the tool dies (audit M-2). With the hint the
 * payload can still arrive as an object or a single-element array.
 */
function failureRow(w: Record<string, any>): Record<string, any> | null {
  const fd = w?.wo_failure_data;
  if (!fd) return null;
  return Array.isArray(fd) ? (fd[0] ?? null) : fd;
}

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
      .select("wo_number, title, type, created_at, wo_failure_data!wo_id(failure_mode_code, failure_cause_code, remedy_code, comments)")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`failure history query failed: ${error.message}`);

    const history = (wos ?? []).map((w: Record<string, any>) => {
      const fd = failureRow(w);
      return {
        wo_number: w.wo_number,
        title: w.title,
        type: w.type,
        date: w.created_at,
        failure: fd
          ? {
              mode: fd.failure_mode_code,
              cause: fd.failure_cause_code,
              remedy: fd.remedy_code,
              comments: fd.comments,
            }
          : null,
      };
    });

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

// ── analyze_pm_effectiveness ───────────────────────────────────────────────
// Heuristic PM optimization: per active PM program, annual frequency vs the
// asset's actual corrective-failure history → over-maintenance / ineffective /
// redundant candidates. (WOs link to a PM only by type, so analysis is at the
// asset level.)
function annualEvents(interval: number, unit: string): number | null {
  if (!interval || interval <= 0) return null;
  const u = (unit || "").toLowerCase();
  if (u.startsWith("day")) return 365 / interval;
  if (u.startsWith("week")) return 52 / interval;
  if (u.startsWith("month")) return 12 / interval;
  if (u.startsWith("year")) return 1 / interval;
  return null; // hours/km = usage-based, not annualizable here
}

const analyzePmEffectiveness: AgentTool = {
  name: "analyze_pm_effectiveness",
  description:
    "Find PM-program optimization opportunities: for each active preventive task it compares the annual PM frequency to the asset's real corrective-failure history over the last year and flags over-maintenance (frequent PMs, no failures), ineffective PMs (failures persist despite PM), and redundant PMs (multiple active PMs on one asset). Scope with asset_tag/asset_id, else fleet.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: { type: "string" },
      asset_id: { type: "string" },
      limit: { type: "integer", description: "Max opportunities to return (default 15)." },
    },
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(50, args.limit)) : 15;
    let assetId: string | null = args?.asset_id ?? null;
    if (!assetId && args?.asset_tag) {
      const { data: a } = await ctx.db.from("assets").select("id").ilike("tag", args.asset_tag).limit(1);
      if (a && a[0]) assetId = a[0].id;
    }

    let pmQuery = ctx.db
      .from("recurring_work")
      .select("id, code, title, asset_id, frequency_interval, frequency_unit, job_type, est_duration")
      .eq("active", true);
    if (assetId) pmQuery = pmQuery.eq("asset_id", String(assetId));
    const { data: pms, error: pmErr } = await pmQuery.limit(3000);
    if (pmErr) throw new Error(`recurring_work query failed: ${pmErr.message}`);
    if (!pms || pms.length === 0) {
      return { data: { active_pms: 0, opportunities: [] }, sources: [], warnings: ["No active PM programs found for the scope."] };
    }

    // Corrective-failure counts per asset over the last 12 months.
    const assetIds = [...new Set(pms.map((p: Record<string, any>) => p.asset_id))];
    const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const failByAsset = new Map<string, number>();
    if (assetIds.length) {
      const { data: wos } = await ctx.db
        .from("work_orders")
        .select("asset_id, type, created_at, wo_failure_data!wo_id(failure_mode_code)")
        .in("asset_id", assetIds.map(String))
        .gte("created_at", cutoff)
        .limit(20000);
      for (const w of wos ?? []) {
        const isFailure = failureRow(w) || String(w.type).toUpperCase() === "CM";
        if (isFailure) failByAsset.set(w.asset_id, (failByAsset.get(w.asset_id) ?? 0) + 1);
      }
    }

    // Count active PMs per asset+job_type for redundancy.
    const pmsByAssetType = new Map<string, number>();
    for (const p of pms as Record<string, any>[]) {
      const k = `${p.asset_id}|${p.job_type}`;
      pmsByAssetType.set(k, (pmsByAssetType.get(k) ?? 0) + 1);
    }

    const opps = (pms as Record<string, any>[]).map((p) => {
      const annual = annualEvents(Number(p.frequency_interval), p.frequency_unit);
      const failures = failByAsset.get(p.asset_id) ?? 0;
      const redundant = (pmsByAssetType.get(`${p.asset_id}|${p.job_type}`) ?? 1) > 1;
      let category = "ok";
      if (redundant) category = "redundant";
      else if (failures >= 3) category = "ineffective";
      else if (annual !== null && annual >= 6 && failures === 0) category = "over_maintenance";
      return {
        pm_code: p.code, pm_title: p.title, asset_id: p.asset_id, job_type: p.job_type,
        annual_pm_events: annual === null ? null : Math.round(annual * 10) / 10,
        est_duration: Number(p.est_duration) || 0,
        corrective_failures_12mo: failures,
        category,
      };
    }).filter((o) => o.category !== "ok")
      .sort((a, b) => (b.annual_pm_events ?? 0) - (a.annual_pm_events ?? 0))
      .slice(0, limit);

    const aIds = [...new Set(opps.map((o) => o.asset_id))];
    if (aIds.length) {
      const { data: assets } = await ctx.db.from("assets").select("id, tag, name").in("id", aIds.map(String));
      const byId = new Map((assets ?? []).map((a: Record<string, any>) => [a.id, a]));
      for (const o of opps as Record<string, any>[]) {
        const m = byId.get(o.asset_id);
        o.asset_tag = m?.tag ?? "(unknown)";
        ctx.sources.push({ kind: "recurring_work", ref: o.pm_code, label: `${o.pm_code} on ${o.asset_tag}` });
      }
    }

    return {
      data: {
        active_pms: pms.length,
        opportunity_count: opps.length,
        opportunities: opps,
        legend: "over_maintenance=frequent PM, zero failures (consider extending interval / condition-based); ineffective=>=3 failures despite PM (redesign task or root-cause); redundant=multiple active PMs of same job_type on one asset (consolidate).",
      },
      sources: [{ kind: "recurring_work", ref: assetId ?? "fleet", label: `${pms.length} active PM programs` }],
    };
  },
};

// ── summarize_work_backlog ─────────────────────────────────────────────────
// Fleet status snapshot for the Reliability Digest: open WO load + overdue PMs.
const summarizeWorkBacklog: AgentTool = {
  name: "summarize_work_backlog",
  description:
    "Summarise current maintenance load: open work orders by status, the assets with the most open work, and how many active PM programs are past due. Use for a status/digest overview.",
  parameters: { type: "object", properties: {} },
  tier: 1,
  async run(_args, ctx: ToolContext): Promise<ToolResult> {
    // Read the semantic view (0233), never raw status: `is_open` is the ONE
    // definition of backlog, shared with the dashboard, reports and the
    // mission engine. An unmapped status classifies as unknown and still
    // counts as open — reported below so the digest can be honest about it.
    const { data: wos } = await ctx.db
      .from("sem_work_orders")
      .select("status, wo_state, is_open, asset_id")
      .limit(50000);
    const byStatus: Record<string, number> = {};
    const openByAsset = new Map<string, number>();
    let openTotal = 0;
    const unmapped = new Set<string>();
    for (const w of wos ?? []) {
      const s = String(w.status || "UNKNOWN").toUpperCase();
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      if (w.wo_state === "unknown") unmapped.add(s);
      if (w.is_open) {
        openTotal += 1;
        if (w.asset_id) openByAsset.set(w.asset_id, (openByAsset.get(w.asset_id) ?? 0) + 1);
      }
    }

    const nowIso = new Date().toISOString();
    const { data: overduePms } = await ctx.db
      .from("recurring_work")
      .select("id")
      .eq("active", true)
      .lt("next_due_date", nowIso)
      .limit(5000);

    const topAssetsRaw = [...openByAsset.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ids = topAssetsRaw.map(([id]) => id);
    const tagById = new Map<string, string>();
    if (ids.length) {
      const { data: assets } = await ctx.db.from("assets").select("id, tag").in("id", ids);
      for (const a of assets ?? []) tagById.set(a.id, a.tag);
    }
    const topAssets = topAssetsRaw.map(([id, n]) => ({ asset_tag: tagById.get(id) ?? "(unknown)", open_wos: n }));

    return {
      data: {
        open_work_orders: openTotal,
        by_status: byStatus,
        overdue_pm_count: (overduePms ?? []).length,
        top_assets_by_open_work: topAssets,
        unmapped_statuses: [...unmapped].sort(),
        definition_note: "open = canonical wo_state open|unknown (sem_work_orders, migration 0233) — the same rule the dashboard, reports and mission list use.",
      },
      sources: [{ kind: "work_orders", ref: "backlog", label: `${(wos ?? []).length} WOs scanned` }],
      warnings: unmapped.size
        ? [`${unmapped.size} work-order status code(s) are not mapped to a lifecycle state (${[...unmapped].sort().slice(0, 5).join(", ")}) — they count as open until mapped.`]
        : undefined,
    };
  },
};

// ── scan_warranty_recovery ─────────────────────────────────────────────────
// Find completed work orders that fall inside an active warranty window — money
// the business may be able to recover from the OEM/vendor (cost minus deductible).
const scanWarrantyRecovery: AgentTool = {
  name: "scan_warranty_recovery",
  description:
    "Find recoverable maintenance spend: completed work orders performed while the asset was under an active warranty. Returns each recoverable WO with its cost, the warranty deductible, and the net recoverable amount. Scope with asset_tag/asset_id, else fleet.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: { type: "string" },
      asset_id: { type: "string" },
      limit: { type: "integer", description: "Max recoverable WOs to return (default 20)." },
    },
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(100, args.limit)) : 20;
    const today = new Date().toISOString().slice(0, 10);

    let assetId: string | null = args?.asset_id ?? null;
    if (!assetId && args?.asset_tag) {
      const { data: a } = await ctx.db.from("assets").select("id").ilike("tag", args.asset_tag).limit(1);
      if (a && a[0]) assetId = a[0].id;
    }

    let wQuery = ctx.db
      .from("warranties")
      .select("id, asset_id, warranty_type, start_date, end_date, deductible, status")
      .eq("status", "ACTIVE");
    if (assetId) wQuery = wQuery.eq("asset_id", String(assetId));
    const { data: warranties, error: wErr } = await wQuery.limit(5000);
    if (wErr) throw new Error(`warranties query failed: ${wErr.message}`);
    const active = (warranties ?? []).filter((w: Record<string, any>) => !w.end_date || w.end_date >= today);
    if (active.length === 0) {
      return { data: { active_warranties: 0, recoverable: [] }, sources: [], warnings: ["No active warranties for the scope."] };
    }

    const byAsset = new Map<string, Record<string, any>[]>();
    for (const w of active) {
      const arr = byAsset.get(w.asset_id) ?? [];
      arr.push(w);
      byAsset.set(w.asset_id, arr);
    }
    const assetIds = [...byAsset.keys()];

    // Completed WOs for those assets (CLOSED/TECO) with any cost.
    const { data: wos, error: woErr } = await ctx.db
      .from("work_orders")
      .select("wo_number, title, asset_id, status, created_at, frozen_labor_cost, frozen_material_cost")
      .in("asset_id", assetIds.map(String))
      .in("status", ["CLOSED", "TECO"])
      .limit(20000);
    if (woErr) throw new Error(`work_orders query failed: ${woErr.message}`);

    const recoverable: Record<string, any>[] = [];
    for (const wo of wos ?? []) {
      const cost = (Number(wo.frozen_labor_cost) || 0) + (Number(wo.frozen_material_cost) || 0);
      if (cost <= 0) continue;
      const day = String(wo.created_at).slice(0, 10);
      // Match a warranty whose window contains the WO date.
      const cover = (byAsset.get(wo.asset_id) ?? []).find(
        (w) => day >= String(w.start_date) && (!w.end_date || day <= String(w.end_date)),
      );
      if (!cover) continue;
      const deductible = Number(cover.deductible) || 0;
      const net = Math.max(0, cost - deductible);
      if (net <= 0) continue;
      recoverable.push({
        wo_number: wo.wo_number, wo_title: wo.title, asset_id: wo.asset_id, wo_date: day,
        wo_cost: Math.round(cost), deductible: Math.round(deductible), recoverable_amount: Math.round(net),
        warranty_type: cover.warranty_type, warranty_end: cover.end_date,
      });
    }

    recoverable.sort((a, b) => b.recoverable_amount - a.recoverable_amount);
    const top = recoverable.slice(0, limit);
    const totalRecoverable = recoverable.reduce((s, r) => s + r.recoverable_amount, 0);

    const aIds = [...new Set(top.map((r) => r.asset_id))];
    if (aIds.length) {
      const { data: assets } = await ctx.db.from("assets").select("id, tag, name").in("id", aIds.map(String));
      const byId = new Map((assets ?? []).map((a: Record<string, any>) => [a.id, a]));
      for (const r of top as Record<string, any>[]) {
        const m = byId.get(r.asset_id);
        r.asset_tag = m?.tag ?? "(unknown)";
        ctx.sources.push({ kind: "work_orders", ref: r.wo_number, label: `${r.wo_number} on ${r.asset_tag}` });
      }
    }

    return {
      data: {
        active_warranties: active.length,
        recoverable_wo_count: recoverable.length,
        total_recoverable_amount: totalRecoverable,
        recoverable: top,
      },
      sources: [{ kind: "warranties", ref: assetId ?? "fleet", label: `${active.length} active warranties` }],
      warnings: recoverable.length === 0 ? ["No completed WOs with cost fall inside an active warranty window."] : undefined,
    };
  },
};

// ── get_asset_health ─────────────────────────────────────────────────────
// Reads the semantic layer (sem_asset_health view, 0183) instead of hand-rolled
// joins: one canonical row per asset with criticality, KPIs and live aggregates.
const getAssetHealth: AgentTool = {
  name: "get_asset_health",
  description:
    "Get the canonical health snapshot for one asset (by tag) or the worst N assets fleet-wide: criticality, MTBF days, MTTR hours, open work orders, failure events and downtime hours over the trailing 12 months, overdue PM count, and last condition-reading time. Use this for asset context before judging any claim about an asset's condition.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: {
        type: "string",
        description: "Asset tag to look up. Omit for a fleet-wide worst-N scan.",
      },
      top_n: {
        type: "integer",
        description: "Fleet scan: how many worst assets to return, ranked by 12-month failure events then open work (default 10).",
      },
    },
    required: [],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const topN: number = Number.isFinite(args?.top_n) ? Math.max(1, Math.min(25, args.top_n)) : 10;

    let query = ctx.db
      .from("sem_asset_health")
      .select(
        "asset_id, asset_tag, asset_name, criticality, status_code, work_center_code, mtbf_days, mttr_hours, failure_count_ytd, open_wo_count, failure_events_12mo, downtime_hrs_12mo, overdue_pm_count, last_reading_at",
      );
    if (typeof args?.asset_tag === "string" && args.asset_tag.trim()) {
      query = query.ilike("asset_tag", args.asset_tag.trim());
    } else {
      query = query
        .order("failure_events_12mo", { ascending: false })
        .order("open_wo_count", { ascending: false })
        .limit(topN);
    }
    const { data, error } = await query;
    if (error) throw new Error(`sem_asset_health query failed: ${error.message}`);

    const rows = data ?? [];
    for (const r of rows) {
      ctx.sources.push({ kind: "assets", ref: r.asset_id, label: `health snapshot ${r.asset_tag}` });
    }
    return {
      data: { assets: rows },
      sources: [{ kind: "semantic_layer", ref: "sem_asset_health", label: `${rows.length} asset health rows` }],
      warnings: rows.length === 0 ? ["No asset matched — check the tag or whether assets exist."] : undefined,
    };
  },
};

// ── lookup_data_definitions ──────────────────────────────────────────────
// Reads the data catalog (semantic_catalog, 0183) so agents ground their
// terminology in the org's canonical definitions — and cite them.
const lookupDataDefinitions: AgentTool = {
  name: "lookup_data_definitions",
  description:
    "Look up the organisation's canonical data definitions from the data catalog: what a dataset or column means, its tags, source tables (lineage) and ISO standard. Use when you need to explain a metric (e.g. event_cost, breach_severity, criticality) or verify what a dataset covers before reasoning about it.",
  parameters: {
    type: "object",
    properties: {
      search: {
        type: "string",
        description: "Free-text term to search titles/descriptions/columns (e.g. 'downtime', 'criticality'). Omit to list all dataset-level definitions.",
      },
    },
    required: [],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    let query = ctx.db
      .from("semantic_catalog")
      .select("object_name, column_name, title, description, tags, source_tables, iso_standard")
      .limit(40);
    if (typeof args?.search === "string" && args.search.trim()) {
      const term = args.search.trim().replace(/[%_]/g, "");
      query = query.or(
        `description.ilike.%${term}%,column_name.ilike.%${term}%,object_name.ilike.%${term}%,title.ilike.%${term}%`,
      );
    } else {
      query = query.is("column_name", null);
    }
    const { data, error } = await query;
    if (error) throw new Error(`semantic_catalog query failed: ${error.message}`);

    const rows = data ?? [];
    return {
      data: { definitions: rows },
      sources: [{ kind: "semantic_layer", ref: "semantic_catalog", label: `${rows.length} catalog definitions` }],
      warnings: rows.length === 0 ? ["No catalog entry matched — the term may not be documented yet."] : undefined,
    };
  },
};

// ── get_investigation ────────────────────────────────────────────────────
// Reads the FULL current state of one RCA investigation — header, cause nodes,
// evidence, corrective actions, linked asset — so the copilot facilitates from
// what the team has actually captured, not from guesses.
const getInvestigation: AgentTool = {
  name: "get_investigation",
  description:
    "Read the current state of an RCA investigation by id: title, problem statement, method, status, linked asset (tag/criticality), all cause nodes (the 5-why/fishbone/tree so far), evidence items, and corrective actions. ALWAYS call this first when facilitating an investigation.",
  parameters: {
    type: "object",
    properties: {
      investigation_id: { type: "string", description: "UUID of the RCA investigation." },
    },
    required: ["investigation_id"],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const id = String(args?.investigation_id ?? "").trim();
    if (!id) throw new Error("investigation_id is required");

    const { data: inv, error } = await ctx.db
      .from("ers_rca_investigations")
      .select("id, title, method, status, problem_statement, root_cause_summary, rca_category, investigation_type, event_date, event_location, asset_id, current_step, created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`investigation query failed: ${error.message}`);
    if (!inv) return { data: { found: false }, sources: [], warnings: ["No investigation with that id (or not visible to this user)."] };

    const [nodesQ, evidenceQ, actionsQ, assetQ] = await Promise.all([
      ctx.db.from("ers_rca_nodes")
        .select("id, parent_id, node_type, description, depth, is_root_cause, cause_category, evidence_notes")
        .eq("investigation_id", id).order("depth").order("created_at"),
      // NB: the column is `content`, not `description` — selecting the wrong
      // name failed the whole query and the copilot saw zero evidence.
      ctx.db.from("ers_rca_evidence")
        .select("id, evidence_type, title, content, quality_grade, event_timestamp")
        .eq("investigation_id", id).limit(50),
      ctx.db.from("ers_rca_corrective_actions")
        .select("action_description, action_type, cause_category, status, work_order_id")
        .eq("investigation_id", id).limit(50),
      inv.asset_id
        ? ctx.db.from("assets").select("id, tag, name, criticality, status_code").eq("id", inv.asset_id).maybeSingle()
        : Promise.resolve({ data: null } as { data: null }),
    ]);

    const asset = (assetQ as { data: { id: string; tag: string; name: string; criticality: string | null } | null }).data;
    ctx.sources.push({ kind: "rca_investigation", ref: inv.id, label: `RCA "${inv.title}"` });

    // Node ↔ evidence citations (0217): which claims are evidenced vs assumed.
    const nodeIds = (nodesQ.data ?? []).map((n: { id: string }) => n.id);
    const linksQ = nodeIds.length > 0
      ? await ctx.db.from("ers_rca_node_evidence")
          .select("node_id, evidence_id, relation")
          .in("node_id", nodeIds)
      : { data: [] as { node_id: string; evidence_id: string; relation: string }[] };
    const linksByNode = new Map<string, { evidence_id: string; relation: string }[]>();
    for (const l of linksQ.data ?? []) {
      const arr = linksByNode.get(l.node_id) ?? [];
      arr.push({ evidence_id: l.evidence_id, relation: l.relation });
      linksByNode.set(l.node_id, arr);
    }
    const nodes = (nodesQ.data ?? []).map((n: Record<string, unknown>) => ({
      ...n,
      cited_evidence: linksByNode.get(n.id as string) ?? [],
      evidence_status: (linksByNode.get(n.id as string) ?? []).some(l => l.relation === "supports")
        ? "evidenced" : "assumed",
    }));

    return {
      data: {
        found: true,
        investigation: inv,
        asset,
        nodes,
        evidence: evidenceQ.data ?? [],
        corrective_actions: actionsQ.data ?? [],
      },
      sources: [{ kind: "rca_investigation", ref: inv.id, label: `investigation state (${(nodesQ.data ?? []).length} nodes)` }],
    };
  },
};

// ── analyze_weibull ──────────────────────────────────────────────────────
// Censored 2-parameter Weibull on an asset's corrective-failure history.
// Faithful server-side mirror of eam/utils/weibull.ts fitWeibull(): Johnson
// adjusted ranks (suspensions shift later failures), Benard's median rank,
// OLS on ln(t) vs ln(-ln(1-F)). Confidence bounds omitted (jstat-free).
function fitWeibullServer(
  failures: number[],
  suspensions: number[],
): { beta: number; eta: number; r2: number; n: number; nSusp: number } | null {
  const f = failures.filter((t) => Number.isFinite(t) && t > 0);
  const s = suspensions.filter((t) => Number.isFinite(t) && t > 0);
  if (f.length < 2) return null;
  const units = [
    ...f.map((time) => ({ time, censored: false })),
    ...s.map((time) => ({ time, censored: true })),
  ].sort((a, b) => a.time - b.time || Number(a.censored) - Number(b.censored));
  const N = units.length;
  let prev = 0;
  const pts: { x: number; y: number }[] = [];
  units.forEach((u, idx) => {
    if (u.censored) return;
    const k = idx + 1;
    prev += (N + 1 - prev) / (2 + N - k); // Johnson adjusted rank
    const F = (prev - 0.3) / (N + 0.4);   // Benard's approximation
    pts.push({ x: Math.log(u.time), y: Math.log(-Math.log(1 - F)) });
  });
  const r = pts.length;
  const xMean = pts.reduce((a, p) => a + p.x, 0) / r;
  const yMean = pts.reduce((a, p) => a + p.y, 0) / r;
  const sxx = pts.reduce((a, p) => a + (p.x - xMean) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p.x - xMean) * (p.y - yMean), 0);
  if (sxx <= 0) return null;
  const beta = sxy / sxx;
  if (!(beta > 0)) return null;
  const intercept = yMean - beta * xMean;
  const eta = Math.exp(-intercept / beta);
  const ssRes = pts.reduce((a, p) => a + (p.y - (beta * p.x + intercept)) ** 2, 0);
  const ssTot = pts.reduce((a, p) => a + (p.y - yMean) ** 2, 0);
  return { beta, eta, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, n: r, nSusp: s.length };
}
const bLife = (beta: number, eta: number, pct: number) =>
  eta * Math.pow(-Math.log(1 - pct / 100), 1 / beta);

const analyzeWeibull: AgentTool = {
  name: "analyze_weibull",
  description:
    "Fit a censored 2-parameter Weibull to an asset's corrective-failure history (inter-failure days; time since last failure enters as a suspension). Returns beta, eta, R², B10/B50 lives, the failure-pattern reading (wear-out / random / infant mortality), and the asset's current active PM programs for comparison. Needs >=3 corrective failures. ALWAYS call this before recommending any PM interval.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: { type: "string", description: "Asset tag (e.g. P-101)." },
      asset_id: { type: "string", description: "Asset UUID (if known)." },
    },
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    let assetId: string | null = args?.asset_id ?? null;
    let assetTag: string | null = args?.asset_tag ?? null;
    if (!assetId && assetTag) {
      const { data: a } = await ctx.db.from("assets").select("id, tag").ilike("tag", assetTag).limit(1);
      if (a && a[0]) { assetId = a[0].id; assetTag = a[0].tag; }
    }
    if (!assetId) {
      return { data: { error: "No matching asset found" }, sources: [], warnings: ["Provide a valid asset_tag or asset_id."] };
    }

    const { data: wos, error } = await ctx.db
      .from("work_orders")
      .select("created_at, type, wo_failure_data!wo_id(failure_mode_code)")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: true })
      .limit(2000);
    if (error) throw new Error(`work_orders query failed: ${error.message}`);

    const failureTimes = (wos ?? [])
      .filter((w: Record<string, any>) => String(w.type ?? "").toUpperCase() === "CM" || failureRow(w))
      .map((w: Record<string, unknown>) => new Date(String(w.created_at)).getTime())
      .sort((a: number, b: number) => a - b);

    const DAY = 86400_000;
    const intervals: number[] = [];
    for (let i = 1; i < failureTimes.length; i++) {
      const d = (failureTimes[i] - failureTimes[i - 1]) / DAY;
      if (d > 0.25) intervals.push(d); // ignore same-day duplicate WOs
    }
    const sinceLast = failureTimes.length
      ? (Date.now() - failureTimes[failureTimes.length - 1]) / DAY
      : 0;

    if (intervals.length < 2) {
      return {
        data: { asset_tag: assetTag, failure_count: failureTimes.length, fit: null },
        sources: [{ kind: "work_orders", ref: assetId, label: `${failureTimes.length} failure events` }],
        warnings: ["Fewer than 3 corrective failures — a Weibull fit would not be statistically meaningful. Recommend collecting more history or condition monitoring."],
      };
    }

    const fit = fitWeibullServer(intervals, sinceLast > 1 ? [sinceLast] : []);
    if (!fit) {
      return { data: { asset_tag: assetTag, fit: null }, sources: [], warnings: ["Degenerate life data — could not fit."] };
    }

    const { data: pms } = await ctx.db
      .from("recurring_work")
      .select("code, title, frequency_interval, frequency_unit, job_type")
      .eq("asset_id", String(assetId))
      .eq("active", true)
      .limit(20);

    const pattern = fit.beta > 1.5 ? "wear_out" : fit.beta > 0.95 ? "random" : "infant_mortality";
    ctx.sources.push({ kind: "work_orders", ref: assetId, label: `Weibull fit on ${fit.n} intervals for ${assetTag}` });
    return {
      data: {
        asset_id: assetId,
        asset_tag: assetTag,
        fit: {
          beta: Math.round(fit.beta * 100) / 100,
          eta_days: Math.round(fit.eta),
          r2: Math.round(fit.r2 * 100) / 100,
          n_intervals: fit.n,
          censored: fit.nSusp > 0,
          b10_days: Math.round(bLife(fit.beta, fit.eta, 10)),
          b50_days: Math.round(bLife(fit.beta, fit.eta, 50)),
          pattern,
          pattern_guidance: pattern === "wear_out"
            ? "Failure probability increases with age — an age-based PM at ~B10 life is statistically justified."
            : pattern === "random"
              ? "Failures are age-independent — fixed-interval PM adds cost without reducing risk; prefer condition monitoring."
              : "Failures cluster early after work — investigate installation/maintenance quality before adding PM frequency.",
        },
        current_pms: pms ?? [],
        methodology: "Median-rank regression: Johnson adjusted ranks over failures + right-censored running time, Benard's approximation, OLS on ln-ln space. Same engine as the Reliability Modelling module.",
      },
      sources: [{ kind: "work_orders", ref: assetId, label: `${failureTimes.length} failure events, ${fit.n} intervals` }],
    };
  },
};

// ── draft_pm_interval ────────────────────────────────────────────────────
// Tier-2 proposal: a PM-interval recommendation grounded in a Weibull fit.
// Never writes — lands in ers_agent_actions (pending_review) and the
// Specialist workspace proposals queue.
const draftPmInterval: AgentTool = {
  name: "draft_pm_interval",
  description:
    "Draft a PM-interval recommendation for an asset, grounded in the analyze_weibull result. This does NOT change any PM — it queues a proposal for human review. Only call AFTER analyze_weibull, and only when the pattern justifies it (wear_out → age-based interval near B10; random → recommend condition monitoring instead; infant_mortality → recommend quality review).",
  parameters: {
    type: "object",
    properties: {
      asset_id: { type: "string" },
      asset_tag: { type: "string" },
      recommendation_type: { type: "string", enum: ["set_interval", "extend_interval", "condition_monitoring", "quality_review"] },
      recommended_interval_days: { type: "number", description: "For set/extend types: the recommended interval in days (typically near B10 life)." },
      basis: { type: "string", description: "One-sentence statistical basis citing beta/eta/B10." },
      current_pm_code: { type: "string", description: "The existing PM this would change, if any." },
    },
    required: ["asset_tag", "recommendation_type", "basis"],
  },
  tier: 2,
  // deno-lint-ignore require-await
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const payload = {
      asset_id: args?.asset_id ?? null,
      asset_tag: String(args?.asset_tag ?? ""),
      recommendation_type: String(args?.recommendation_type ?? "set_interval"),
      recommended_interval_days: Number(args?.recommended_interval_days) || null,
      basis: String(args?.basis ?? ""),
      current_pm_code: args?.current_pm_code ?? null,
      created_by: "weibull_analyst",
    };
    ctx.proposals.push({
      agent_type: "weibull_analyst",
      action_type: "draft_pm_interval",
      asset_id: args?.asset_id ?? null,
      draft_payload: payload,
    });
    return {
      data: { drafted: true, asset: payload.asset_tag, type: payload.recommendation_type },
      sources: [{ kind: "proposal", ref: payload.asset_tag, label: "PM-interval draft (pending review)" }],
    };
  },
};

// ── search_manuals ───────────────────────────────────────────────────────
// Retrieval over indexed OEM manuals / SOPs (0222). Ranked Postgres
// full-text via the search_manual_chunks RPC, which runs SECURITY INVOKER so
// the caller's RLS applies. Every passage carries its source and page, so the
// agent can cite "page 47" rather than assert from general knowledge.
const searchManuals: AgentTool = {
  name: "search_manuals",
  description:
    "Search the organisation's own indexed OEM manuals, SOPs and procedures for passages relevant to a question (torque specs, clearances, lubrication intervals, commissioning steps, alarm meanings). Returns ranked excerpts with their document name and page number for citation. Use this whenever a question could be settled by the equipment's documentation instead of general knowledge.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "What to look for, in the words a manual would use (e.g. 'mechanical seal flush plan', 'bearing axial clearance').",
      },
      asset_tag: {
        type: "string",
        description: "Restrict to manuals indexed against this asset tag. Omit to search all documents.",
      },
      limit: { type: "integer", description: "Max passages to return (default 8, max 25)." },
    },
    required: ["query"],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const query = String(args?.query ?? "").trim();
    if (!query) {
      return { data: { passages: [] }, sources: [], warnings: ["No query supplied."] };
    }
    const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(25, args.limit)) : 8;
    const assetTag = typeof args?.asset_tag === "string" && args.asset_tag.trim()
      ? args.asset_tag.trim()
      : null;

    const { data, error } = await ctx.db.rpc("search_manual_chunks", {
      q: query,
      asset: assetTag,
      max_results: limit,
    });
    if (error) {
      // Pre-0222 databases have no RPC — say so plainly rather than failing the run.
      return {
        data: { passages: [], indexed: false },
        sources: [],
        warnings: [`Manual search is unavailable (${error.message}). No manuals may be indexed yet.`],
      };
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    const passages = rows.map((r) => ({
      document: r.source,
      page: r.page_number,
      document_type: r.document_type,
      asset_tag: r.asset_tag,
      relevance: Math.round(Number(r.score ?? 0) * 1000) / 1000,
      text: r.chunk_text,
    }));
    for (const p of passages) {
      ctx.sources.push({
        kind: "manual",
        ref: String(p.document),
        label: p.page ? `${p.document} p.${p.page}` : String(p.document),
      });
    }

    return {
      data: {
        query,
        asset_tag: assetTag,
        passage_count: passages.length,
        passages,
        retrieval: "Ranked full-text search (ts_rank_cd) over indexed manual chunks.",
      },
      sources: [{ kind: "manual", ref: query, label: `${passages.length} manual passage(s)` }],
      warnings: passages.length === 0
        ? ["No indexed manual matched. Either the wording differs from the document's, or that manual has not been indexed yet — advise the user to add it under Specialist → Manuals."]
        : undefined,
    };
  },
};

// ── query_pid ────────────────────────────────────────────────────────────
// GraphRAG over the plant's own P&IDs. ers_pid_configurations already stores
// the drawing as typed nodes and typed edges (0081); this tool is the retrieval
// half — it serialises that graph for the model, or answers routing questions
// by walking it deterministically. See pidGraph.ts for why traversal is done in
// code rather than by the LLM.
//
// The asset-register join is the part a chat-with-the-drawing cannot do: every
// component carrying an asset tag comes back with its live health from
// sem_asset_health, so "trace the discharge" and "which of those is a bad
// actor" are the same question.
const queryPid: AgentTool = {
  name: "query_pid",
  description:
    "Query a stored P&ID as a connected graph: get an overview of a drawing, trace the flow path between two components, list what is upstream or downstream of a component, or determine which valves isolate it. Components carrying an asset tag are returned with their live health (MTBF, failures, open work orders). Use this for any question about how equipment is connected, what feeds what, or what must be closed to work on something — never infer plant topology from memory.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["overview", "trace", "upstream", "downstream", "isolate"],
        description:
          "overview = the whole drawing as text; trace = flow path from one component to another; upstream/downstream = what feeds or is fed by a component; isolate = the valves to close to work on it.",
      },
      pid_title: {
        type: "string",
        description: "Which drawing to query. Omit when the site has only one; otherwise the tool lists the available drawings.",
      },
      component: {
        type: "string",
        description: "Component label or asset tag, for upstream / downstream / isolate (e.g. 'T4750', 'P-101A').",
      },
      from: { type: "string", description: "Start component label or asset tag, for trace." },
      to: { type: "string", description: "End component label or asset tag, for trace." },
      detail: {
        type: "string",
        enum: ["graph", "topology"],
        description: "overview only: 'graph' keeps attributes and instrument links (default); 'topology' is connectivity alone, at roughly half the tokens.",
      },
    },
    required: ["operation"],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const operation = String(args?.operation ?? "overview");

    // ── Locate the drawing ──
    let q = ctx.db
      .from("ers_pid_configurations")
      .select("id, title, asset_id, equipment, connections, updated_at");
    const title = typeof args?.pid_title === "string" && args.pid_title.trim() ? args.pid_title.trim() : null;
    if (title) q = q.ilike("title", `%${title}%`);

    const { data: configs, error } = await q.limit(25);
    if (error) throw new Error(`ers_pid_configurations query failed: ${error.message}`);

    const rows = (configs ?? []) as Record<string, unknown>[];
    if (rows.length === 0) {
      return {
        data: { found: false },
        sources: [],
        warnings: [
          title
            ? `No P&ID matched "${title}".`
            : "No P&IDs have been drawn yet. They are created under Analyze → Reliability Modelling.",
        ],
      };
    }
    if (rows.length > 1 && !title) {
      // Ambiguous: name them rather than silently picking one.
      return {
        data: { found: true, needs_selection: true, drawings: rows.map((r) => r.title) },
        sources: [],
        warnings: ["Several P&IDs exist — ask which one, or pass pid_title."],
      };
    }
    const cfg = rows[0];

    const graph = buildPidGraph(
      (cfg.equipment ?? []) as PidNodeInput[],
      (cfg.connections ?? []) as PidEdgeInput[],
    );
    ctx.sources.push({ kind: "pid", ref: String(cfg.id), label: `P&ID ${cfg.title}` });

    // Resolve a user-supplied name against labels first, then asset tags.
    const resolve = (name: unknown): string | null => {
      const needle = String(name ?? "").trim().toLowerCase();
      if (!needle) return null;
      for (const n of graph.nodes.values()) {
        if (n.label?.toLowerCase() === needle) return n.id;
      }
      for (const n of graph.nodes.values()) {
        if (n.assetTag?.toLowerCase() === needle) return n.id;
      }
      return null;
    };
    const labelOf = (id: string) => graph.nodes.get(id)?.label ?? id;
    const notFound = (name: unknown): ToolResult => ({
      data: { found: false, component: name },
      sources: [],
      warnings: [
        `"${name}" is not on this drawing. Components present: ${
          [...graph.nodes.values()].map((n) => n.label).join(", ")
        }.`,
      ],
    });

    // ── Traversal operations ──
    if (operation === "trace") {
      const fromId = resolve(args?.from);
      const toId = resolve(args?.to);
      if (!fromId) return notFound(args?.from);
      if (!toId) return notFound(args?.to);
      const path = tracePath(graph, fromId, toId);
      return {
        data: {
          pid: cfg.title,
          from: labelOf(fromId),
          to: labelOf(toId),
          path: path?.map((n) => `${n.label} (${n.type})`) ?? null,
          connected: !!path,
          method: "Breadth-first walk of process-flow edges, following flow direction.",
        },
        sources: [{ kind: "pid", ref: String(cfg.id), label: `flow path on ${cfg.title}` }],
        warnings: path
          ? undefined
          : [`No process path runs from ${labelOf(fromId)} to ${labelOf(toId)} in the direction of flow.`],
      };
    }

    if (operation === "upstream" || operation === "downstream") {
      const id = resolve(args?.component);
      if (!id) return notFound(args?.component);
      const found = walk(graph, id, operation === "upstream" ? "up" : "down");
      return {
        data: {
          pid: cfg.title,
          component: labelOf(id),
          direction: operation,
          components: found.map((n) => ({
            label: n.label,
            type: graph.nodes.get(n.id)?.type,
            hops: n.depth,
          })),
        },
        sources: [{ kind: "pid", ref: String(cfg.id), label: `${operation} of ${labelOf(id)}` }],
        warnings: found.length === 0 ? [`Nothing is drawn ${operation} of ${labelOf(id)}.`] : undefined,
      };
    }

    if (operation === "isolate") {
      const id = resolve(args?.component);
      if (!id) return notFound(args?.component);
      const { valves, unisolatedBranches } = findIsolationPoints(graph, id);
      const warnings: string[] = [];
      if (valves.length === 0) {
        warnings.push(`No isolating valve is drawn upstream of ${labelOf(id)}.`);
      }
      if (unisolatedBranches.length) {
        warnings.push(
          `These inlets reach ${labelOf(id)} with no valve between: ${
            unisolatedBranches.map((b) => b.label).join(", ")
          }. They cannot be isolated from this drawing.`,
        );
      }
      warnings.push(
        "Derived from the drawing only. The site's isolation procedure and a physical walk-down govern; drain, vent and blind requirements are not modelled here.",
      );
      return {
        data: {
          pid: cfg.title,
          component: labelOf(id),
          close_valves: valves.map((v) => v.label),
          unisolated_inlets: unisolatedBranches.map((b) => b.label),
          method: "First isolating device on each upstream branch, walking process-flow edges.",
        },
        sources: [{ kind: "pid", ref: String(cfg.id), label: `isolation for ${labelOf(id)}` }],
        warnings,
      };
    }

    // ── overview: serialise the graph, joined to live asset health ──
    const tags = [...graph.nodes.values()]
      .map((n) => n.assetTag)
      .filter((t): t is string => !!t);

    const facts = new Map<string, AssetFacts>();
    if (tags.length) {
      const { data: health } = await ctx.db
        .from("sem_asset_health")
        .select("asset_tag, criticality, mtbf_days, open_wo_count, failure_events_12mo, overdue_pm_count")
        .in("asset_tag", tags);
      for (const h of (health ?? []) as AssetFacts[]) {
        facts.set(h.asset_tag, h);
        ctx.sources.push({ kind: "assets", ref: h.asset_tag, label: `health ${h.asset_tag}` });
      }
    }

    const mode = args?.detail === "topology" ? "topology" : "graph";
    const text = serializePidGraph(graph, { mode, title: String(cfg.title), facts });

    return {
      data: {
        pid: cfg.title,
        component_count: graph.nodes.size,
        connection_count: graph.edges.size,
        assets_linked: facts.size,
        approx_tokens: estimateTokens(text),
        graph: text,
      },
      sources: [{ kind: "pid", ref: String(cfg.id), label: `${cfg.title} (${graph.nodes.size} components)` }],
      warnings: tags.length === 0
        ? ["No component on this drawing is linked to the asset register, so no health data could be joined. Link them in the P&ID editor to make condition part of the answer."]
        : undefined,
    };
  },
};

// ── get_assessment_trend ─────────────────────────────────────────────────
// Run-over-run deltas from the persisted assessment snapshots (0228) — the
// before/after story. All arithmetic here; the LLM only narrates it.
const getAssessmentTrend: AgentTool = {
  name: "get_assessment_trend",
  description:
    "Compare the latest persisted reliability-assessment snapshot against the previous run and the baseline (first ever). Returns dates plus deltas for 12-month maintenance spend, work-order count, asset count, recoverable warranty, asset-register health % and data-coverage %. Use it to report measurable progress since the baseline assessment. If it reports fewer than 2 snapshots, say the trend unlocks on the next assessment run instead of inventing one.",
  parameters: { type: "object", properties: {} },
  tier: 1,
  async run(_args, ctx: ToolContext): Promise<ToolResult> {
    const { data, error } = await ctx.db
      .from("ers_assessment_snapshots")
      .select("created_at, total_spend_12mo, wo_count_12mo, asset_count, warranty_recoverable, register_health_pct, coverage_cost_pct, coverage_failure_pct, coverage_downtime_pct")
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`assessment snapshots query failed: ${error.message}`);
    const rows = data ?? [];

    // Fixed CALENDAR-month spend (last 6 months incl. current) — trailing-12mo
    // snapshot deltas move when old history rolls out of the window, so spend
    // direction must come from fixed buckets, never from the snapshot delta.
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    monthStart.setUTCMonth(monthStart.getUTCMonth() - 5);
    const { data: recentWos } = await ctx.db
      .from("work_orders")
      .select("created_at, frozen_labor_cost, frozen_material_cost, total_actual_cost")
      .gte("created_at", monthStart.toISOString())
      .limit(20000);
    const monthly = new Map<string, number>();
    for (let i = 0; i < 6; i++) {
      const d = new Date(monthStart);
      d.setUTCMonth(d.getUTCMonth() + i);
      monthly.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, 0);
    }
    for (const w of (recentWos ?? []) as { created_at: string; frozen_labor_cost: number | null; frozen_material_cost: number | null; total_actual_cost: number | null }[]) {
      const key = String(w.created_at).slice(0, 7);
      if (!monthly.has(key)) continue;
      const c = ((Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0)) || Number(w.total_actual_cost) || 0;
      monthly.set(key, (monthly.get(key) ?? 0) + c);
    }
    const monthly_spend = [...monthly.entries()].map(([month, spend]) => ({ month, spend: Math.round(spend) }));
    if (rows.length === 0) {
      return {
        data: { snapshots: 0, note: "No assessment snapshots exist yet — running an assessment records the baseline." },
        sources: [{ kind: "assessment_snapshots", ref: "trend", label: "0 snapshots" }],
      };
    }
    type Snap = (typeof rows)[number];
    const pick = (r: Snap) => ({
      date: String(r.created_at).slice(0, 10),
      spend_12mo: Number(r.total_spend_12mo) || 0,
      wo_count_12mo: Number(r.wo_count_12mo) || 0,
      asset_count: Number(r.asset_count) || 0,
      warranty_recoverable: Number(r.warranty_recoverable) || 0,
      register_health_pct: r.register_health_pct == null ? null : Number(r.register_health_pct),
      coverage_cost_pct: r.coverage_cost_pct == null ? null : Number(r.coverage_cost_pct),
      coverage_failure_pct: r.coverage_failure_pct == null ? null : Number(r.coverage_failure_pct),
    });
    const baseline = pick(rows[0]);
    const latest = pick(rows[rows.length - 1]);
    const previous = rows.length >= 2 ? pick(rows[rows.length - 2]) : null;
    const diff = (a: ReturnType<typeof pick>, b: ReturnType<typeof pick>) => ({
      spend_12mo: a.spend_12mo - b.spend_12mo,
      wo_count_12mo: a.wo_count_12mo - b.wo_count_12mo,
      asset_count: a.asset_count - b.asset_count,
      warranty_recoverable: a.warranty_recoverable - b.warranty_recoverable,
      register_health_pct: a.register_health_pct != null && b.register_health_pct != null
        ? a.register_health_pct - b.register_health_pct : null,
      coverage_failure_pct: a.coverage_failure_pct != null && b.coverage_failure_pct != null
        ? a.coverage_failure_pct - b.coverage_failure_pct : null,
    });
    return {
      data: {
        snapshots: rows.length,
        baseline,
        previous,
        latest,
        delta_vs_baseline: rows.length >= 2 ? diff(latest, baseline) : null,
        delta_vs_previous: previous ? diff(latest, previous) : null,
        monthly_spend,
        window_note:
          "spend deltas in delta_vs_* are TRAILING-12-MONTH windows — they move when old history rolls out and must never be presented as savings. Use monthly_spend (fixed calendar months) for spend direction; use snapshot deltas for register health and coverage only.",
      },
      sources: [{
        kind: "assessment_snapshots",
        ref: "trend",
        label: `${rows.length} snapshot${rows.length === 1 ? "" : "s"} ${baseline.date} → ${latest.date}`,
      }],
    };
  },
};

// ── find_positive_deviants ───────────────────────────────────────────────
// RSA (Root Success Analysis, PSC framework): the cheapest improvement a
// plant owns is a peer that already succeeds. Groups assets sharing a model
// (nameplate), finds the one that outperforms its class on 12-month
// corrective count/cost, and returns the spread so the agent can ask WHY.
const findPositiveDeviants: AgentTool = {
  name: "find_positive_deviants",
  description:
    "Find positive deviants: groups of assets sharing the same model where one asset has far fewer corrective failures / lower corrective cost than its peers over the last 12 months. Returns each group with per-asset failure counts and costs and names the deviant. Use as the starting point of a Root Success Analysis (why does the best one succeed?). If nameplate (model) data is too sparse to form groups, it says so.",
  parameters: {
    type: "object",
    properties: {
      min_group_size: { type: "integer", description: "Minimum assets sharing a model to form a class (default 2)." },
    },
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const minGroup = Number.isFinite(args?.min_group_size) ? Math.max(2, args.min_group_size) : 2;
    const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const [assetQ, woQ] = await Promise.all([
      ctx.db.from("assets").select("id, tag, name, model, manufacturer, criticality, hierarchy_level")
        // A class is EQUIPMENT vs EQUIPMENT — sites/areas sharing a model
        // string are register noise, not peers.
        .in("hierarchy_level", ["EQUIPMENT", "COMPONENT"]).limit(10000),
      ctx.db.from("work_orders")
        .select("asset_id, type, frozen_labor_cost, frozen_material_cost, total_actual_cost")
        .gte("created_at", cutoff).limit(20000),
    ]);
    if (assetQ.error) throw new Error(`assets query failed: ${assetQ.error.message}`);
    type A = { id: string; tag: string; name: string; model: string | null; manufacturer: string | null; criticality: string | null };
    const assets = (assetQ.data ?? []) as A[];
    const stats = new Map<string, { failures: number; cost: number }>();
    for (const w of (woQ.data ?? []) as { asset_id: string | null; type: string | null; frozen_labor_cost: number | null; frozen_material_cost: number | null; total_actual_cost: number | null }[]) {
      if (!w.asset_id || String(w.type ?? "").toUpperCase() !== "CM") continue;
      const c = ((Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0)) || Number(w.total_actual_cost) || 0;
      const cur = stats.get(w.asset_id) ?? { failures: 0, cost: 0 };
      cur.failures += 1; cur.cost += c;
      stats.set(w.asset_id, cur);
    }
    const byModel = new Map<string, A[]>();
    for (const a of assets) {
      const m = (a.model ?? "").trim();
      if (!m) continue;
      const k = `${(a.manufacturer ?? "").trim().toLowerCase()}|${m.toLowerCase()}`;
      (byModel.get(k) ?? byModel.set(k, []).get(k)!).push(a);
    }
    const withModel = [...byModel.values()].reduce((s, g) => s + g.length, 0);
    const groups: Record<string, unknown>[] = [];
    for (const members of byModel.values()) {
      if (members.length < minGroup) continue;
      const rows = members.map((a) => ({
        tag: a.tag, name: a.name, criticality: a.criticality,
        failures_12mo: stats.get(a.id)?.failures ?? 0,
        cm_cost_12mo: Math.round(stats.get(a.id)?.cost ?? 0),
      })).sort((x, y) => x.failures_12mo - y.failures_12mo || x.cm_cost_12mo - y.cm_cost_12mo);
      const meanFailures = rows.reduce((s, r) => s + r.failures_12mo, 0) / rows.length;
      const best = rows[0];
      // A deviant needs peers that actually struggle AND a real gap to explain.
      if (meanFailures < 1 || best.failures_12mo > meanFailures / 2) continue;
      groups.push({
        model: `${members[0].manufacturer ?? ""} ${members[0].model ?? ""}`.trim(),
        class_size: rows.length,
        class_mean_failures_12mo: Math.round(meanFailures * 10) / 10,
        positive_deviant: best,
        peers: rows.slice(1),
      });
    }
    return {
      data: {
        groups,
        note: groups.length === 0
          ? `No positive-deviant groups found: ${withModel}/${assets.length} assets carry a model, and no model class had both struggling peers and a clear outperformer. Improving nameplate completeness widens this search.`
          : `${groups.length} class(es) with a clear outperformer — investigate WHY the deviant succeeds (installation, operating practice, duty) and propose propagating it.`,
      },
      sources: [{ kind: "assets", ref: "positive-deviants", label: `${byModel.size} model classes over ${withModel} nameplated assets` }],
    };
  },
};

// ── RCM coverage (sem_rcm_coverage, 0319) ────────────────────────────────────
// Which assets have an RCM study, how far each study got, and how much of the
// decided programme reached Work Management. Reads the same view the RCM
// landing page and the maturity say-do card read, so every surface agrees.
const getRcmCoverage: AgentTool = {
  name: "get_rcm_coverage",
  description:
    "RCM programme coverage: every RCM study with its asset (tag, criticality), status and revision, counts of failure modes / consequences classified / strategies decided / proactive decisions / PMs generated in Work Management, plus the A- and B-critical assets that have NO study. Use it before claiming anything about maintenance-strategy maturity, before recommending an RCM study (do not recommend one that exists), and to name the critical assets whose decided tasks never reached the CMMS.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: { type: "string", description: "Limit to one asset tag (optional)." },
      status: { type: "string", description: "Limit to one study status: draft | in_progress | review | approved | closed (optional)." },
    },
    required: [],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    let q = ctx.db.from("sem_rcm_coverage").select("*");
    if (typeof args?.asset_tag === "string" && args.asset_tag.trim()) q = q.ilike("asset_tag", args.asset_tag.trim());
    if (typeof args?.status === "string" && args.status.trim()) q = q.eq("status", args.status.trim());
    const { data, error } = await q;
    if (error) throw new Error(`sem_rcm_coverage query failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ study_id: string; title: string; status: string; asset_id: string | null; asset_tag: string | null; criticality: string | null; proactive_count: number; pm_count: number }>;

    const { data: critAssets } = await ctx.db.from("assets").select("id, tag, name, criticality").in("criticality", ["A", "B"]).limit(5000);
    const covered = new Set(rows.filter((r) => r.asset_id && (r.status === "review" || r.status === "approved")).map((r) => r.asset_id));
    const started = new Set(rows.filter((r) => r.asset_id).map((r) => r.asset_id));
    const critical = (critAssets ?? []) as Array<{ id: string; tag: string; name: string; criticality: string }>;
    const uncovered = critical.filter((a) => !started.has(a.id)).slice(0, 40);
    const proactive = rows.reduce((n, r) => n + (Number(r.proactive_count) || 0), 0);
    const implemented = rows.reduce((n, r) => n + (Number(r.pm_count) || 0), 0);

    for (const r of rows) ctx.sources.push({ kind: "rcm_study", ref: r.study_id, label: `RCM study ${r.title}${r.asset_tag ? ` (${r.asset_tag})` : ""}` });
    return {
      data: {
        studies: rows,
        critical_assets: { total: critical.length, covered_review_or_approved: critical.filter((a) => covered.has(a.id)).length, with_any_study: critical.filter((a) => started.has(a.id)).length },
        uncovered_critical_assets: uncovered,
        implementation: { proactive_decisions: proactive, pms_in_work_management: implemented, implemented_pct: proactive ? Math.round((implemented / proactive) * 100) : null },
        note: "Coverage counts a study in review or approved. Level 3 of the maturity question on RCM/FMEA is studies on a few systems; level 4 is results driving the CMMS — implementation.implemented_pct is that distinction, measured.",
      },
      sources: [{ kind: "rcm_study", ref: "sem_rcm_coverage", label: `${rows.length} RCM studies over ${critical.length} A/B-critical assets` }],
      warnings: rows.length === 0 ? ["No RCM studies on record for this organisation."] : undefined,
    };
  },
};

// ── get_asset_context ────────────────────────────────────────────────────
// What the RCM module's Specialist already reads (0317/0318), for every other
// agent: ISO 14224 classification, criticality, make/model, the operating
// context (mode, duty, environment, medium, design vs operating values with
// derating flags), the physical breakdown (registered subunits/components and
// the BOM), the RCM studies on the asset, and its condition-monitoring points.
// Self-contained rendering — the edge bundle cannot import the app's lib.
const getAssetContext: AgentTool = {
  name: "get_asset_context",
  description:
    "Read one asset's engineering context from the register: ISO 14224 category/class/type, criticality, make/model, the operating context (mode, utilisation, hours and starts per year, redundancy, environment, service medium) and its design-vs-operating parameter table with derating flags (operating above design = accelerated wear), the physical breakdown (registered subunits/components and BOM lines, critical spares marked), RCM studies on the asset, and its reading points with alarm bands. Call this before advising on ANY named asset — failure modes, PM intervals, strategy, spares, condition monitoring — so the advice is specific to how this machine is built and run, not generic. Provide asset_tag or asset_id.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: { type: "string", description: "Asset tag (e.g. P-101A)." },
      asset_id: { type: "string", description: "Asset UUID (if known)." },
    },
    required: [],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    let assetId: string | null = typeof args?.asset_id === "string" && args.asset_id.trim() ? args.asset_id.trim() : null;
    const tag = typeof args?.asset_tag === "string" ? args.asset_tag.trim() : "";
    if (!assetId && tag) {
      const { data: a } = await ctx.db.from("assets").select("id").ilike("tag", tag).limit(1);
      if (a && a[0]) assetId = a[0].id;
    }
    if (!assetId) {
      return { data: { found: false, asset_tag: tag || null }, sources: [], warnings: ["No matching asset — provide a valid asset_tag or asset_id."] };
    }

    const { data: asset, error } = await ctx.db
      .from("assets")
      .select("id, tag, name, hierarchy_level, criticality, status_code, manufacturer, model, serial_number, asset_category, asset_class, asset_type_code, operating_context, properties, mtbf_days, mttr_hours, running_hours")
      .eq("id", assetId)
      .maybeSingle();
    if (error) throw new Error(`assets query failed: ${error.message}`);
    if (!asset) return { data: { found: false }, sources: [], warnings: ["Asset not found (or not visible to this user)."] };

    // Classification labels from the reference catalogue (global + tenant rows).
    const codes = [asset.asset_category, asset.asset_class, asset.asset_type_code].filter(Boolean) as string[];
    const labels = new Map<string, string>();
    if (codes.length) {
      const { data: refs } = await ctx.db.from("reference_codes_effective").select("category, code, description").in("code", codes).in("category", ["ASSET_CATEGORY", "ASSET_CLASS", "ASSET_TYPE"]);
      for (const r of refs ?? []) labels.set(`${r.category}:${r.code}`, r.description);
    }
    const classification = {
      category: asset.asset_category ? { code: asset.asset_category, label: labels.get(`ASSET_CATEGORY:${asset.asset_category}`) ?? asset.asset_category } : null,
      class: asset.asset_class ? { code: asset.asset_class, label: labels.get(`ASSET_CLASS:${asset.asset_class}`) ?? asset.asset_class } : null,
      type: asset.asset_type_code ? { code: asset.asset_type_code, label: labels.get(`ASSET_TYPE:${asset.asset_type_code}`) ?? asset.asset_type_code } : null,
    };

    // Operating context (0317) with derating flags.
    const oc = (asset.operating_context && typeof asset.operating_context === "object" ? asset.operating_context : {}) as Record<string, unknown>;
    const params = (Array.isArray(oc.parameters) ? oc.parameters : []) as Array<Record<string, unknown>>;
    const num = (v: unknown) => { if (v === null || v === undefined || String(v).trim() === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
    const parameters = params
      .filter((p) => [p.design, p.operating, p.max].some((v) => v !== null && v !== undefined && String(v).trim() !== ""))
      .map((p) => {
        const d = num(p.design), o = num(p.operating);
        const pct = d !== null && o !== null && d !== 0 ? Math.round((o / d) * 1000) / 10 : null;
        return {
          key: p.key, label: p.label, unit: p.unit ?? "",
          design: p.design ?? null, operating: p.operating ?? null, max: p.max ?? null,
          operating_pct_of_design: pct,
          flag: pct === null ? null : pct > 100 ? "ABOVE_DESIGN" : pct < 50 ? "FAR_BELOW_DESIGN" : null,
        };
      });
    const aboveDesign = parameters.filter((p) => p.flag === "ABOVE_DESIGN").map((p) => p.label);
    const operating_context = {
      mode: oc.mode ?? null, utilisation_pct: oc.utilisation_pct ?? null, hours_per_year: oc.hours_per_year ?? null, starts_per_year: oc.starts_per_year ?? null,
      redundancy: oc.redundancy ?? null, environment: Array.isArray(oc.environment) ? oc.environment : [], service_medium: oc.service_medium ?? null,
      description: (asset.properties as Record<string, unknown> | null)?.description ?? null,
      parameters, above_design: aboveDesign, updated_at: oc.updated_at ?? null,
      complete: !!oc.mode && (!!oc.service_medium || (Array.isArray(oc.environment) && oc.environment.length > 0)) && parameters.some((p) => p.operating_pct_of_design !== null),
    };

    // Physical breakdown (0318): registered children ≤3 levels + BOM.
    const components: Array<Record<string, unknown>> = [];
    let frontier = [assetId];
    for (let depth = 1; depth <= 3 && frontier.length; depth++) {
      const { data: kids } = await ctx.db.from("assets").select("id, tag, name, hierarchy_level, criticality, asset_class, parent_id").in("parent_id", frontier).order("tag").limit(500);
      const rows = (kids ?? []).filter((k: Record<string, unknown>) => !["SITE", "AREA", "UNIT", "SYSTEM", "SUBSYSTEM"].includes(String(k.hierarchy_level ?? "").toUpperCase()));
      for (const k of rows) components.push({ id: k.id, tag: k.tag, name: k.name, level: k.hierarchy_level, criticality: k.criticality, asset_class: k.asset_class, depth });
      frontier = rows.map((k: Record<string, unknown>) => String(k.id));
    }
    const { data: bom } = await ctx.db.from("asset_bom").select("id, part_number, description, quantity, uom, is_critical, replacement_interval_days").eq("asset_id", assetId).order("is_critical", { ascending: false }).limit(200);
    const parts = (bom ?? []).map((b: Record<string, unknown>) => ({ id: b.id, part_number: b.part_number ?? "", description: b.description, qty: Number(b.quantity) || 1, uom: b.uom ?? "EA", critical: !!b.is_critical, replacement_interval_days: b.replacement_interval_days ?? null }));

    // RCM studies on this asset (0319 view where available, else the table).
    let rcm: Array<Record<string, unknown>> = [];
    const cov = await ctx.db.from("sem_rcm_coverage").select("study_id, title, status, proactive_count, pm_count").eq("asset_id", assetId);
    if (!cov.error) rcm = cov.data ?? [];
    else {
      const { data: studies } = await ctx.db.from("ers_rcm_studies").select("id, title, status").eq("asset_id", assetId);
      rcm = (studies ?? []).map((s: Record<string, unknown>) => ({ study_id: s.id, title: s.title, status: s.status }));
    }

    // Condition-monitoring points.
    const { data: points } = await ctx.db.from("reading_definitions").select("name, unit, category, min_warning, max_warning, min_critical, max_critical, limit_source, monitoring_frequency_days").eq("asset_id", assetId).eq("is_active", true).limit(50);

    // What those points have DONE in the last 7 days (0362). One line each, so
    // the Specialist sees "vibration rising 12%" without having to ask; the
    // full window is a query_readings call away. Never blocks the context.
    let recentSignals: Array<Record<string, unknown>> = [];
    let recentWarnings: string[] = [];
    try {
      const r = await summarizeAssetSeries(ctx, assetId, { days: 7, maxSeries: 12, maxPoints: 0 });
      recentWarnings = r.warnings.filter((w) => !w.startsWith("No reading points"));
      recentSignals = r.series.map((s) => ({
        tag: s.tag, unit: s.unit, source: s.source,
        last: s.summary.last, direction: s.summary.direction, pct_change_7d: s.summary.pct_change,
        excursions_warn: s.summary.excursions.warn_high + s.summary.excursions.warn_low,
        excursions_crit: s.summary.excursions.crit_high + s.summary.excursions.crit_low,
        coverage_pct: s.summary.coverage_pct, headline: s.summary.headline,
      }));
    } catch (e) {
      recentWarnings = [`7-day signal summary unavailable: ${(e as Error)?.message ?? e}`];
    }

    ctx.sources.push({ kind: "assets", ref: asset.id, label: `register record ${asset.tag}` });
    if (oc.updated_at) ctx.sources.push({ kind: "assets", ref: `${asset.id}#operating_context`, label: `operating context (updated ${String(oc.updated_at).slice(0, 10)})` });
    for (const r of rcm) ctx.sources.push({ kind: "rcm_study", ref: String(r.study_id), label: `RCM study ${r.title}` });

    const warnings: string[] = [];
    if (!asset.asset_class) warnings.push("No ISO 14224 class on the register — classify the asset before relying on class-specific failure modes.");
    if (!operating_context.complete) warnings.push("Operating context is incomplete (needs mode, medium/environment and at least one design+operating value) — advice on duty, load or derating is unsupported until it is filled.");
    if (aboveDesign.length) warnings.push(`Operating ABOVE DESIGN on: ${aboveDesign.join(", ")} — treat as accelerated-wear evidence.`);
    warnings.push(...recentWarnings);
    const moving = recentSignals.filter((s) => (s.direction === "rising" || s.direction === "falling") || Number(s.excursions_crit) > 0);
    if (moving.length) warnings.push(`Signals moving in the last 7 days: ${moving.slice(0, 4).map((s) => `${s.tag} ${s.headline}`).join(" | ")} — call query_readings before advising.`);

    return {
      data: {
        found: true,
        asset: { id: asset.id, tag: asset.tag, name: asset.name, level: asset.hierarchy_level, criticality: asset.criticality, status: asset.status_code, manufacturer: asset.manufacturer, model: asset.model, serial_number: asset.serial_number, mtbf_days: asset.mtbf_days, mttr_hours: asset.mttr_hours, running_hours: asset.running_hours },
        classification,
        operating_context,
        breakdown: { components, parts, critical_spares: parts.filter((p) => p.critical).length },
        rcm_studies: rcm,
        reading_points: points ?? [],
        recent_signals_7d: recentSignals,
        note: "Classification, context, breakdown and points are register data entered by the organisation (ISO 14224 §7 / Annex A). 'operating_pct_of_design' > 100 means the asset runs beyond its rated value. recent_signals_7d is computed from stored history (live feed or manual rounds, per 'source'); use query_readings for a longer window or the series itself.",
      },
      sources: [{ kind: "assets", ref: asset.id, label: `asset context ${asset.tag}: ${components.length} components, ${parts.length} BOM lines, ${rcm.length} RCM studies, ${(points ?? []).length} reading points` }],
      warnings: warnings.length ? warnings : undefined,
    };
  },
};

// ── query_readings ───────────────────────────────────────────────────────
// The read side of the time-series store. 0236 made every writer append to
// ers_sensor_reading_points; 0362 added hourly rollups and sem_readings_window.
// Until this tool, no agent could see a signal — get_asset_health exposed
// last_reading_at and nothing else — so "P-101 has failed four times" was the
// whole story and "P-101 has run 15% hotter for three weeks" was invisible.
//
// Two sources, one summariser (readingsSummary.ts):
//   • live series  — sem_readings_window(asset, tag, from, to), RLS-scoped;
//   • manual rounds — reading_logs, for every reading definition not covered
//     by a live tag. Most sites are rounds-only on day one; the tool must
//     answer there too, and say so.
// Bands come from reading_definitions (warning + critical), matched to a live
// tag through sensor_tag / reading_type_code (0298), else from the projection's
// alarm_low/high which Predict treats as the alarm line.

const READ_WINDOWS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
const READ_MAX_SERIES = 12;

interface SeriesOut {
  tag: string;
  unit: string | null;
  /** sensor = timestamped history; projection = the untimed last-50 sparkline; manual = rounds. */
  source: "sensor" | "projection" | "manual";
  bands: Bands;
  summary: SeriesSummary;
  buckets?: WindowBucket[];
}

interface ReadingDefRow {
  id: string; name: string; unit: string | null; sensor_tag: string | null; reading_type_code: string | null;
  min_warning: number | null; max_warning: number | null; min_critical: number | null; max_critical: number | null;
}

/**
 * Shared by query_readings and the 7-day lines in get_asset_context. Never
 * throws on a missing RPC (pre-0362 tenant): it degrades to manual rounds and
 * a warning, so asset context still answers.
 */
async function summarizeAssetSeries(
  ctx: ToolContext,
  assetId: string,
  opts: { days: number; tagFilter?: string | null; maxSeries?: number; maxPoints?: number },
): Promise<{ series: SeriesOut[]; from: string; to: string; warnings: string[] }> {
  const to = new Date();
  const from = new Date(to.getTime() - opts.days * 86_400_000);
  const fromIso = from.toISOString(), toIso = to.toISOString();
  const maxSeries = opts.maxSeries ?? READ_MAX_SERIES;
  const maxPoints = opts.maxPoints ?? 0;
  const filter = (opts.tagFilter ?? "").trim().toLowerCase();
  const matches = (s: string | null | undefined) => !filter || String(s ?? "").toLowerCase().includes(filter);
  const warnings: string[] = [];
  const series: SeriesOut[] = [];

  const [defQ, liveQ] = await Promise.all([
    ctx.db.from("reading_definitions")
      .select("id, name, unit, sensor_tag, reading_type_code, min_warning, max_warning, min_critical, max_critical")
      .eq("asset_id", assetId).eq("is_active", true).limit(100),
    ctx.db.from("ers_sensor_readings").select("tag, unit, alarm_low, alarm_high, readings").eq("asset_id", assetId).limit(100),
  ]);
  const defs = (defQ.data ?? []) as ReadingDefRow[];
  const live = (liveQ.data ?? []) as { tag: string; unit: string | null; alarm_low: number | null; alarm_high: number | null; readings?: unknown }[];

  const defForTag = (tag: string): ReadingDefRow | undefined => {
    const t = tag.toLowerCase();
    return defs.find((d) => (d.sensor_tag ?? "").toLowerCase() === t)
      ?? defs.find((d) => (d.reading_type_code ?? "").toLowerCase() === t)
      ?? defs.find((d) => d.name.toLowerCase() === t);
  };
  const bandsFromDef = (d: ReadingDefRow): Bands => ({
    warn_low: d.min_warning, warn_high: d.max_warning, crit_low: d.min_critical, crit_high: d.max_critical,
  });

  // ── Live series ──────────────────────────────────────────────────────
  const coveredDefs = new Set<string>();
  let rpcMissing = false;
  for (const t of live.filter((l) => matches(l.tag)).slice(0, maxSeries)) {
    const def = defForTag(t.tag);
    if (def) coveredDefs.add(def.id);
    const bands: Bands = def ? bandsFromDef(def) : { crit_low: t.alarm_low, crit_high: t.alarm_high };
    const unit = t.unit || def?.unit || null;
    let buckets: WindowBucket[] = [];
    if (!rpcMissing) {
      const { data, error } = await ctx.db.rpc("sem_readings_window", {
        p_asset_id: assetId, p_tag: t.tag, p_from: fromIso, p_to: toIso, p_max_buckets: 96,
      });
      if (error) {
        rpcMissing = true;
        warnings.push(`Signal history unavailable (${error.message}) — only the latest projected values are known for live tags.`);
      } else {
        buckets = normalizeBuckets((data ?? []) as Record<string, unknown>[]);
      }
    }
    // History table empty for this tag but the projection holds a sparkline:
    // say what we have (values in order) and exactly what we don't (dates).
    const proj = Array.isArray(t.readings) ? (t.readings as unknown[]) : [];
    if (buckets.length === 0 && proj.length > 0) {
      series.push({ tag: t.tag, unit, source: "projection", bands, summary: summarizeUntimed(proj, { bands, unit }) });
      warnings.push(`${t.tag}: no timestamped history in the window — summarised the projection's last ${proj.length} untimed sample(s) instead (order only, no rate).`);
      continue;
    }
    series.push({
      tag: t.tag, unit, source: "sensor", bands,
      summary: summarizeWindow(buckets, { from: fromIso, to: toIso, bands, unit }),
      buckets: maxPoints > 0 ? downsample(buckets, maxPoints) : undefined,
    });
  }

  // ── Manual rounds for everything not covered by a live tag ───────────
  const manualDefs = defs.filter((d) => !coveredDefs.has(d.id) && matches(d.name)).slice(0, Math.max(0, maxSeries - series.length));
  if (manualDefs.length) {
    const { data: logs, error } = await ctx.db.from("reading_logs")
      .select("definition_id, reading_date, reading_time, reading_value")
      .eq("asset_id", assetId).eq("is_active", true)
      .gte("reading_date", fromIso.slice(0, 10))
      .order("reading_date", { ascending: true }).limit(5000);
    if (error) warnings.push(`reading_logs query failed: ${error.message}`);
    const byDef = new Map<string, typeof logs>();
    for (const l of (logs ?? []) as { definition_id: string | null }[]) {
      if (!l.definition_id) continue;
      const arr = byDef.get(l.definition_id) ?? [];
      arr.push(l as never);
      byDef.set(l.definition_id, arr);
    }
    for (const d of manualDefs) {
      const bands = bandsFromDef(d);
      const buckets = bucketsFromManualLogs((byDef.get(d.id) ?? []) as never);
      series.push({
        tag: d.name, unit: d.unit, source: "manual", bands,
        summary: summarizeWindow(buckets, { from: fromIso, to: toIso, bands, unit: d.unit }),
        buckets: maxPoints > 0 ? downsample(buckets, maxPoints) : undefined,
      });
    }
  }

  if (series.length === 0) {
    warnings.push("No reading points on this asset — no live feed and no Condition Data definitions. Nothing can be said about its signals.");
  } else if (!series.some((s) => s.source === "sensor") && series.some((s) => s.source === "manual") && !series.some((s) => s.source === "projection")) {
    warnings.push("Manual Condition Data only (no live feed): trends are at route cadence, not continuous.");
  }
  return { series, from: fromIso, to: toIso, warnings };
}

const queryReadings: AgentTool = {
  name: "query_readings",
  description:
    "Read an asset's signal history over a window (24h, 7d, 30d, 90d) — per reading point: trend direction, slope per day and % change, min/avg/max, first and last values, excursions beyond the warning and critical bands, data coverage, and a downsampled series. Reads the live sensor history when a feed exists and falls back to manual Condition Data rounds otherwise (and says which). Use this BEFORE any claim about how a signal is behaving — a single current value or a work-order count is not a trend. Provide asset_tag or asset_id; optionally a tag to narrow to one point.",
  parameters: {
    type: "object",
    properties: {
      asset_tag: { type: "string", description: "Asset tag (e.g. 'P-101'). Or provide asset_id." },
      asset_id: { type: "string", description: "Asset UUID, if known." },
      tag: { type: "string", description: "Reading point / sensor tag to narrow to (substring match, e.g. 'vib', 'BOILER_OUTLET_STEAM_TEMP'). Omit for all points on the asset." },
      window: { type: "string", enum: Object.keys(READ_WINDOWS), description: "Look-back window (default '7d')." },
      max_points: { type: "integer", description: "Downsampled buckets to return per series for plotting or inspection (default 24; 0 = summaries only)." },
    },
    required: [],
  },
  tier: 1,
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    let assetId: string | null = typeof args?.asset_id === "string" && args.asset_id.trim() ? args.asset_id.trim() : null;
    const assetTag = typeof args?.asset_tag === "string" ? args.asset_tag.trim() : "";
    const windowKey: string = typeof args?.window === "string" && READ_WINDOWS[args.window] ? args.window : "7d";
    const maxPoints: number = Number.isFinite(args?.max_points) ? Math.max(0, Math.min(96, args.max_points)) : 24;
    const tagFilter: string | null = typeof args?.tag === "string" && args.tag.trim() ? args.tag.trim() : null;

    let asset: { id: string; tag: string; name: string } | null = null;
    if (assetId) {
      const { data } = await ctx.db.from("assets").select("id, tag, name").eq("id", assetId).limit(1);
      asset = data?.[0] ?? null;
    } else if (assetTag) {
      const { data } = await ctx.db.from("assets").select("id, tag, name").ilike("tag", assetTag).limit(1);
      asset = data?.[0] ?? null;
    }
    if (!asset) {
      return { data: { found: false, asset_tag: assetTag || null }, sources: [], warnings: ["No matching asset — provide a valid asset_tag or asset_id."] };
    }
    assetId = asset.id;

    const { series, from, to, warnings } = await summarizeAssetSeries(ctx, assetId, {
      days: READ_WINDOWS[windowKey], tagFilter, maxSeries: READ_MAX_SERIES, maxPoints,
    });
    if (tagFilter && series.length === 0) {
      warnings.push(`No reading point on ${asset.tag} matches '${tagFilter}' — call without a tag to list what exists.`);
    }

    const sources = series.map((s) => ({
      kind: s.source === "sensor" ? "ers_sensor_reading_points" : s.source === "projection" ? "ers_sensor_readings" : "reading_logs",
      ref: `${assetId}|${s.tag}|${windowKey}`,
      label: `${asset!.tag} ${s.tag}: ${s.summary.n_points} samples, ${windowKey}`,
    }));
    for (const s of sources) ctx.sources.push(s);

    return {
      data: {
        found: true,
        asset,
        window: { label: windowKey, from, to },
        series: series.map((s) => ({
          tag: s.tag, unit: s.unit, source: s.source, bands: s.bands,
          ...s.summary,
          buckets: s.buckets,
        })),
        note: "direction is 'rising'/'falling' only when the fitted trend moves the signal by ≥2% of its mean across the window; excursions count buckets, not samples; coverage_pct < 50 means most of the window has no data — say so rather than extrapolate. Manual series are at route cadence. source 'projection' = the last ≤50 stored samples with NO timestamps: report order and values, never a rate or a date.",
      },
      sources: sources.length ? sources : [{ kind: "assets", ref: assetId, label: `no reading points on ${asset.tag}` }],
      warnings: warnings.length ? warnings : undefined,
    };
  },
};

export const TOOLS: Record<string, AgentTool> = {
  [getAssetContext.name]: getAssetContext,
  [queryReadings.name]: queryReadings,
  [getRcmCoverage.name]: getRcmCoverage,
  [queryPid.name]: queryPid,
  [searchManuals.name]: searchManuals,
  [analyzeWeibull.name]: analyzeWeibull,
  [draftPmInterval.name]: draftPmInterval,
  [rankBadActors.name]: rankBadActors,
  [draftDeTask.name]: draftDeTask,
  [queryFailureHistory.name]: queryFailureHistory,
  [scanCorrosionRisk.name]: scanCorrosionRisk,
  [analyzePmEffectiveness.name]: analyzePmEffectiveness,
  [summarizeWorkBacklog.name]: summarizeWorkBacklog,
  [scanWarrantyRecovery.name]: scanWarrantyRecovery,
  [getAssetHealth.name]: getAssetHealth,
  [lookupDataDefinitions.name]: lookupDataDefinitions,
  [getInvestigation.name]: getInvestigation,
  [getAssessmentTrend.name]: getAssessmentTrend,
  [findPositiveDeviants.name]: findPositiveDeviants,
};
