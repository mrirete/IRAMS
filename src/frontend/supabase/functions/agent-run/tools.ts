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
        .select("asset_id, type, created_at, wo_failure_data(failure_mode_code)")
        .in("asset_id", assetIds.map(String))
        .gte("created_at", cutoff)
        .limit(20000);
      for (const w of wos ?? []) {
        const isFailure = w.wo_failure_data || String(w.type).toUpperCase() === "CM";
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
    const { data: wos } = await ctx.db.from("work_orders").select("status, asset_id").limit(50000);
    const openStatuses = new Set(["OPEN", "WIP", "PLAN"]);
    const byStatus: Record<string, number> = {};
    const openByAsset = new Map<string, number>();
    for (const w of wos ?? []) {
      const s = String(w.status || "UNKNOWN").toUpperCase();
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      if (openStatuses.has(s) && w.asset_id) openByAsset.set(w.asset_id, (openByAsset.get(w.asset_id) ?? 0) + 1);
    }
    const openTotal = [...openStatuses].reduce((n, s) => n + (byStatus[s] ?? 0), 0);

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
      },
      sources: [{ kind: "work_orders", ref: "backlog", label: `${(wos ?? []).length} WOs scanned` }],
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
      .select("created_at, type, wo_failure_data(failure_mode_code)")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: true })
      .limit(2000);
    if (error) throw new Error(`work_orders query failed: ${error.message}`);

    const failureTimes = (wos ?? [])
      .filter((w: Record<string, unknown>) => String(w.type ?? "").toUpperCase() === "CM" || w.wo_failure_data)
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

export const TOOLS: Record<string, AgentTool> = {
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
};
