// specialist-watchdog — the always-on layer (Phase C1,
// docs/Specialist-150k-Replacement-Plan.md): deterministic nightly checks
// that queue proposals WITHOUT anyone clicking. No LLM anywhere — this runs
// at zero inference cost, even with AI credits exhausted.
//
// Checks:
//   1. Emergent bad actor — an asset whose corrective-cost run-rate over the
//      last 30 days is ≥3× its prior-year baseline (with materiality and
//      event-count floors) → draft_de_task proposal.
//   2. PM-effectiveness drift — an ACTIVE programme whose asset took ≥3
//      corrective hits in the last 90 days → draft_pm_interval
//      (condition_monitoring review) proposal.
//   3. Data-quality regression — failure-code or cost coverage over the last
//      30 days ≥15 points below the trailing-year average → audit-log note
//      (not a CMMS deliverable).
//   4. Big-failure RCA — a corrective event in the last 30 days with ≥24h
//      downtime or ≥$25k cost auto-drafts a REACTIVE RCA investigation
//      (status 'draft', trigger_reference_id = the WO, so it never drafts
//      twice) — the same draft a good engineer opens the morning after.
//
// Idempotent by design: a proposal is skipped while a matching watchdog
// proposal is pending, or was reviewed in the last 30 days (never nag a
// human who already decided).
//
// Deploy:  supabase functions deploy specialist-watchdog --no-verify-jwt
// Secrets: BRIEFING_CRON_KEY (same key the briefing cron uses — one secret,
//          both schedules).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const DAY_MS = 86_400_000;

// Thresholds — stated here once, echoed into every proposal's basis text.
const SPIKE_MULTIPLE = 3;
const SPIKE_MIN_COST_30D = 5_000;
const SPIKE_MIN_EVENTS_30D = 2;
const DRIFT_MIN_FAILURES_90D = 3;
const DQ_DROP_POINTS = 15;
const DQ_MIN_RECENT_WOS = 5;
const SNOOZE_DAYS = 30;
const RCA_MIN_DOWNTIME_HRS = 24;
const RCA_MIN_COST = 25_000;
const RCA_MAX_PER_RUN = 3;

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const CRON_KEY = Deno.env.get("BRIEFING_CRON_KEY") ?? "";
  if (!CRON_KEY) return json({ error: "BRIEFING_CRON_KEY not configured" }, 500);
  if (req.headers.get("x-cron-key") !== CRON_KEY) return json({ error: "Unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const started = Date.now();
  const now = Date.now();

  try {
    // ── shared reads ──────────────────────────────────────────────────────
    const cutoff395 = new Date(now - 395 * DAY_MS).toISOString();
    const [woQ, assetQ, pmQ, failQ, existingQ] = await Promise.all([
      admin.from("work_orders")
        .select("id, asset_id, type, created_at, frozen_labor_cost, frozen_material_cost, total_actual_cost, actual_downtime_hrs")
        .gte("created_at", cutoff395)
        .limit(20000),
      admin.from("assets").select("id, tag, name, criticality").limit(10000),
      admin.from("recurring_work").select("id, code, title, asset_id").eq("active", true).limit(3000),
      admin.from("wo_failure_data").select("wo_id").limit(20000),
      // Snooze set: anything watchdog-flagged that is pending or recently reviewed.
      admin.from("ers_agent_actions")
        .select("asset_id, action_type, status, reviewed_at, created_at")
        .eq("agent_type", "watchdog")
        .gte("created_at", new Date(now - 60 * DAY_MS).toISOString())
        .limit(2000),
    ]);
    if (woQ.error) throw new Error(`work_orders: ${woQ.error.message}`);

    type Wo = { id: string; asset_id: string | null; type: string | null; created_at: string; frozen_labor_cost: number | null; frozen_material_cost: number | null; total_actual_cost: number | null; actual_downtime_hrs: number | null };
    const wos = (woQ.data ?? []) as Wo[];
    const assetById = new Map(((assetQ.data ?? []) as { id: string; tag: string; name: string; criticality: string | null }[]).map((a) => [a.id, a]));
    const codedIds = new Set(((failQ.data ?? []) as { wo_id: string }[]).map((f) => f.wo_id));
    const cost = (w: Wo) => ((Number(w.frozen_labor_cost) || 0) + (Number(w.frozen_material_cost) || 0)) || Number(w.total_actual_cost) || 0;
    const isCm = (w: Wo) => String(w.type ?? "").toUpperCase() === "CM";

    const snoozed = new Set(
      ((existingQ.data ?? []) as { asset_id: string | null; action_type: string; status: string; reviewed_at: string | null }[])
        .filter((a) =>
          a.status === "pending_review" ||
          (a.reviewed_at && now - new Date(a.reviewed_at).getTime() < SNOOZE_DAYS * DAY_MS))
        .map((a) => `${a.asset_id}|${a.action_type}`),
    );

    const proposals: Record<string, unknown>[] = [];
    const findings: string[] = [];

    // ── 1. Emergent bad actor (cost-rate step change) ─────────────────────
    const recent = new Map<string, { cost: number; events: number }>();
    const baseline = new Map<string, number>();
    const cut30 = now - 30 * DAY_MS;
    for (const w of wos) {
      if (!w.asset_id || !isCm(w)) continue;
      const t = new Date(w.created_at).getTime();
      if (t >= cut30) {
        const r = recent.get(w.asset_id) ?? { cost: 0, events: 0 };
        r.cost += cost(w); r.events += 1;
        recent.set(w.asset_id, r);
      } else {
        baseline.set(w.asset_id, (baseline.get(w.asset_id) ?? 0) + cost(w));
      }
    }
    let spikes = 0;
    for (const [assetId, r] of recent) {
      if (r.cost < SPIKE_MIN_COST_30D || r.events < SPIKE_MIN_EVENTS_30D) continue;
      const baseDaily = (baseline.get(assetId) ?? 0) / 365;
      const recentDaily = r.cost / 30;
      // A silent asset that suddenly costs real money is also a step change.
      if (baseDaily > 0 && recentDaily < baseDaily * SPIKE_MULTIPLE) continue;
      if (snoozed.has(`${assetId}|draft_de_task`)) continue;
      const a = assetById.get(assetId);
      const annualized = Math.round(recentDaily * 365);
      const baselineAnnual = Math.round(baseDaily * 365);
      spikes += 1;
      findings.push(`spike:${a?.tag ?? assetId}`);
      proposals.push({
        agent_type: "watchdog",
        asset_id: assetId,
        action_type: "draft_de_task",
        status: "pending_review",
        draft_payload: {
          asset_id: assetId,
          asset_tag: a?.tag ?? "(unknown)",
          title: `Cost step-change on ${a?.tag ?? "asset"} — investigate before it becomes the next bad actor`,
          root_cause_summary: `Corrective spend ran ${Math.round(r.cost)} over the last 30 days (${r.events} events) vs a prior-year baseline of ${baselineAnnual}/yr — a ≥${SPIKE_MULTIPLE}× run-rate step change.`,
          proposed_solution: "Open a defect-elimination review of the recent failures; confirm whether one failure mode drives the step change.",
          annual_cost: annualized,
          estimated_savings: Math.max(0, annualized - baselineAnnual),
          priority: a?.criticality === "A" ? "HIGH" : "MEDIUM",
          created_by: "watchdog",
        },
      });
    }

    // ── 2. PM-effectiveness drift ─────────────────────────────────────────
    const failures90 = new Map<string, number>();
    const cut90 = now - 90 * DAY_MS;
    for (const w of wos) {
      if (!w.asset_id || !isCm(w)) continue;
      if (new Date(w.created_at).getTime() >= cut90) failures90.set(w.asset_id, (failures90.get(w.asset_id) ?? 0) + 1);
    }
    let drifts = 0;
    const seenPmAsset = new Set<string>();
    for (const p of (pmQ.data ?? []) as { id: string; code: string; title: string; asset_id: string | null }[]) {
      if (!p.asset_id || seenPmAsset.has(p.asset_id)) continue;
      const f = failures90.get(p.asset_id) ?? 0;
      if (f < DRIFT_MIN_FAILURES_90D) continue;
      if (snoozed.has(`${p.asset_id}|draft_pm_interval`)) continue;
      seenPmAsset.add(p.asset_id);
      const a = assetById.get(p.asset_id);
      drifts += 1;
      findings.push(`drift:${a?.tag ?? p.asset_id}`);
      proposals.push({
        agent_type: "watchdog",
        asset_id: p.asset_id,
        action_type: "draft_pm_interval",
        status: "pending_review",
        draft_payload: {
          asset_id: p.asset_id,
          asset_tag: a?.tag ?? "(unknown)",
          recommendation_type: "condition_monitoring",
          recommended_interval_days: null,
          basis: `${f} corrective failures in the last 90 days while ${p.code} is active — the programme is not intercepting the current failure mode. Review the task content or shift to condition monitoring.`,
          current_pm_code: p.code,
          created_by: "watchdog",
        },
      });
    }

    // ── 3. Data-quality regression (audit note, not a proposal) ───────────
    const recent30 = wos.filter((w) => new Date(w.created_at).getTime() >= cut30);
    const priorYear = wos.filter((w) => new Date(w.created_at).getTime() < cut30);
    let dqNote: string | null = null;
    if (recent30.length >= DQ_MIN_RECENT_WOS && priorYear.length >= DQ_MIN_RECENT_WOS) {
      const pct = (rows: Wo[], pred: (w: Wo) => boolean) => Math.round((rows.filter(pred).length / rows.length) * 100);
      const codeDrop = pct(priorYear, (w) => codedIds.has(w.id)) - pct(recent30, (w) => codedIds.has(w.id));
      const costDrop = pct(priorYear, (w) => cost(w) > 0) - pct(recent30, (w) => cost(w) > 0);
      const drops: string[] = [];
      if (codeDrop >= DQ_DROP_POINTS) drops.push(`failure-code coverage down ${codeDrop} pts vs the trailing year`);
      if (costDrop >= DQ_DROP_POINTS) drops.push(`cost coverage down ${costDrop} pts vs the trailing year`);
      if (drops.length) {
        dqNote = `Data-quality regression over the last 30 days: ${drops.join("; ")} (${recent30.length} recent WOs). Recent work is being closed without the fields every analysis runs on.`;
        findings.push("dq-regression");
      }
    }

    // ── 4. Big-failure RCA auto-draft ─────────────────────────────────────
    // The draft a good engineer opens the morning after a major event —
    // status 'draft' in the RCA module, never delivered anywhere. Dedup is
    // structural: trigger_reference_id = the work order id.
    let rcaDrafts = 0;
    const bigOnes = wos
      .filter((w) => w.asset_id && isCm(w) && new Date(w.created_at).getTime() >= cut30)
      .map((w) => ({ w, downtime: Number(w.actual_downtime_hrs) || 0, c: cost(w) }))
      .filter(({ downtime, c }) => downtime >= RCA_MIN_DOWNTIME_HRS || c >= RCA_MIN_COST)
      .sort((a, b) => (b.downtime * 1000 + b.c) - (a.downtime * 1000 + a.c))
      .slice(0, RCA_MAX_PER_RUN);
    if (bigOnes.length) {
      const { data: existingRca } = await admin
        .from("ers_rca_investigations")
        .select("trigger_reference_id")
        .in("trigger_reference_id", bigOnes.map(({ w }) => w.id));
      const drafted = new Set(((existingRca ?? []) as { trigger_reference_id: string | null }[]).map((r) => r.trigger_reference_id));
      for (const { w, downtime, c } of bigOnes) {
        if (drafted.has(w.id)) continue;
        const a = assetById.get(w.asset_id!);
        const day = w.created_at.slice(0, 10);
        const why = downtime >= RCA_MIN_DOWNTIME_HRS ? `${Math.round(downtime)}h downtime` : `${Math.round(c)} corrective cost`;
        const { error } = await admin.from("ers_rca_investigations").insert({
          asset_id: w.asset_id,
          title: `RCA — ${a?.tag ?? "asset"}: major corrective event ${day} (${why})`,
          status: "draft",
          investigation_type: "reactive",
          rca_category: "asset_failure",
          trigger_type: downtime >= RCA_MIN_DOWNTIME_HRS ? "downtime" : "cost",
          trigger_reference_id: w.id,
          problem_statement:
            `${a?.tag ?? "Asset"} (${a?.name ?? ""}) took a corrective event on ${day} with ` +
            `${Math.round(downtime)}h recorded downtime and ${Math.round(c)} recorded cost — above the ` +
            `watchdog threshold (≥${RCA_MIN_DOWNTIME_HRS}h or ≥${RCA_MIN_COST}). Drafted automatically; ` +
            `investigate while the evidence is fresh.`,
          event_date: day,
          event_how_much: { cost: Math.round(c), downtime_hrs: Math.round(downtime) },
          created_by: "00000000-0000-0000-0000-000000000000",
        });
        if (error) { console.error("rca draft failed:", error.message); continue; }
        rcaDrafts += 1;
        findings.push(`rca:${a?.tag ?? w.asset_id}`);
      }
    }

    // ── persist ───────────────────────────────────────────────────────────
    let inserted = 0;
    if (proposals.length) {
      const { error } = await admin.from("ers_agent_actions").insert(proposals);
      if (error) console.error("proposal insert failed:", error.message);
      else inserted = proposals.length;
    }

    const summary =
      `Nightly watchdog: ${wos.length} WOs scanned · ${spikes} cost step-change(s) · ${drifts} PM-drift signal(s)` +
      `${rcaDrafts ? ` · ${rcaDrafts} RCA draft(s) opened` : ""}` +
      `${dqNote ? " · data-quality regression flagged" : ""} · ${inserted} proposal(s) queued.` +
      (dqNote ? `\n\n${dqNote}` : "");
    try {
      await admin.from("ers_ai_audit_log").insert({
        user_id: null,
        username: "specialist-watchdog",
        module: "reliability",
        action_type: "agent_run",
        query_text: "Nightly deterministic watchdog sweep (bad-actor step change, PM drift, data quality).",
        response_text: summary,
        context_type: "watchdog_run",
        context_summary: findings.join(", ") || "all clear",
        model_used: "deterministic",
        tokens_used: 0,
        duration_ms: Date.now() - started,
      });
    } catch (e) {
      console.error("audit log write failed:", e);
    }

    return json({
      ok: true,
      scanned_wos: wos.length,
      spikes,
      pm_drift: drifts,
      rca_drafts: rcaDrafts,
      dq_regression: Boolean(dqNote),
      proposals_queued: inserted,
      skipped_snoozed: snoozed.size,
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
