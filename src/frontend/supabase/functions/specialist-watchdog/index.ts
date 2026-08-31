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
//   5. Golden-Spot drift (PSC, Phase E2) — an asset whose latest reading on a
//      banded point sits OUTSIDE its warning band queues a restore-the-optimum
//      proposal — acting on Sub-Optimal Drift BEFORE Critical Departure is
//      the framework's whole point.
//   6. Budget breach (RF-01 dedup ruling) — a cost center whose committed +
//      actual crosses 90% (warn) or 100% (breach) of its OpEx budget notifies
//      the finance-authority roles directly. NOT a proposal: budgets are
//      FinOps' math (variance already computed there) — this is the missing
//      announcement, once per budget per 30 days.
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
const DRIFT_LOOKBACK_DAYS = 14;
const DRIFT_MAX_PER_RUN = 5;

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

    // ── 5. Golden-Spot drift (PSC E2) ─────────────────────────────────────
    // Latest reading per banded point vs its bands; the asset's worst state
    // decides. Snooze key is shared with other DE-shaped proposals per asset,
    // which is deliberate politeness: one open ask per asset at a time.
    let driftFlags = 0;
    {
      const [defQ, logRecentQ] = await Promise.all([
        admin.from("reading_definitions")
          .select("id, asset_id, name, min_warning, max_warning, min_critical, max_critical")
          .eq("is_active", true).limit(20000),
        admin.from("reading_logs")
          .select("definition_id, asset_id, reading_date, reading_time, reading_value")
          .gte("reading_date", new Date(now - DRIFT_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10))
          .order("reading_date", { ascending: false })
          .limit(10000),
      ]);
      type Def = { id: string; asset_id: string | null; name: string; min_warning: number | null; max_warning: number | null; min_critical: number | null; max_critical: number | null };
      const defs = new Map(((defQ.data ?? []) as Def[])
        .filter((d) => d.asset_id && [d.min_warning, d.max_warning, d.min_critical, d.max_critical].some((b) => b != null))
        .map((d) => [d.id, d]));
      // First row seen per definition is the latest (ordered desc).
      const latest = new Map<string, { value: number; date: string }>();
      for (const l of (logRecentQ.data ?? []) as { definition_id: string | null; reading_date: string | null; reading_value: number | null }[]) {
        if (!l.definition_id || l.reading_value == null || latest.has(l.definition_id) || !defs.has(l.definition_id)) continue;
        latest.set(l.definition_id, { value: Number(l.reading_value), date: String(l.reading_date) });
      }
      type AssetState = { worst: "DRIFT" | "CRITICAL"; params: string[] };
      const byAssetState = new Map<string, AssetState>();
      for (const [defId, r] of latest) {
        const d = defs.get(defId)!;
        const critical = (d.min_critical != null && r.value < d.min_critical) || (d.max_critical != null && r.value > d.max_critical);
        const drift = !critical && ((d.min_warning != null && r.value < d.min_warning) || (d.max_warning != null && r.value > d.max_warning));
        if (!critical && !drift) continue;
        const cur = byAssetState.get(d.asset_id!) ?? { worst: "DRIFT" as const, params: [] };
        if (critical) cur.worst = "CRITICAL";
        cur.params.push(`${d.name} = ${r.value} (${r.date})`);
        byAssetState.set(d.asset_id!, cur);
      }
      let taken = 0;
      for (const [assetId, st] of byAssetState) {
        if (taken >= DRIFT_MAX_PER_RUN) break;
        if (snoozed.has(`${assetId}|draft_de_task`)) continue;
        const a = assetById.get(assetId);
        taken += 1; driftFlags += 1;
        findings.push(`golden-spot:${a?.tag ?? assetId}`);
        proposals.push({
          agent_type: "watchdog",
          asset_id: assetId,
          action_type: "draft_de_task",
          status: "pending_review",
          draft_payload: {
            asset_id: assetId,
            asset_tag: a?.tag ?? "(unknown)",
            title: `${st.worst === "CRITICAL" ? "Critical departure" : "Golden-Spot drift"} — restore ${a?.tag ?? "asset"} to its optimal envelope`,
            root_cause_summary: `Latest readings outside the ${st.worst === "CRITICAL" ? "CRITICAL" : "warning"} band: ${st.params.slice(0, 3).join("; ")}.`,
            proposed_solution: st.worst === "CRITICAL"
              ? "Inspect now and restore operating conditions — the asset has left its optimal envelope entirely (PSC: Critical Departure)."
              : "Inspect and correct the drifting parameter(s) before this becomes a departure — defending the Golden Spot is cheaper than restoring it.",
            annual_cost: 0,
            estimated_savings: 0,
            priority: st.worst === "CRITICAL" ? "HIGH" : "MEDIUM",
            created_by: "watchdog",
          },
        });
      }
    }

    // ── 6. Budget breach → notify finance authority ───────────────────────
    // FinOps owns the variance math; this is only the announcement. Once per
    // budget per 30 days (entity_id-keyed dedupe), to MANAGER / EXECUTIVE /
    // ASSET_MANAGER holders resolved the same way detect-sweep resolves roles.
    let budgetAlerts = 0;
    try {
      const FY = new Date().getFullYear();
      const [budQ, ccQ, notifQ, contactsQ, usersQ] = await Promise.all([
        admin.from("budgets").select("id, cost_center_id, fiscal_year, opex_budget, committed, actual, currency, status").eq("fiscal_year", FY).gt("opex_budget", 0).limit(500),
        admin.from("cost_centers").select("id, code, name").limit(1000),
        admin.from("notifications").select("entity_id, severity")
          .eq("notification_type", "BUDGET_BREACH")
          .gte("created_at", new Date(now - 30 * DAY_MS).toISOString()).limit(1000),
        admin.from("contacts").select("id, roles").limit(5000),
        admin.from("users").select("id, contact_id").limit(5000),
      ]);
      const ccById = new Map(((ccQ.data ?? []) as { id: string; code: string | null; name: string | null }[]).map((c) => [c.id, c]));
      const alerted = new Map(((notifQ.data ?? []) as { entity_id: string | null; severity: string }[])
        .filter((n) => n.entity_id).map((n) => [n.entity_id as string, n.severity]));
      const usersByContact = new Map(((usersQ.data ?? []) as { id: string; contact_id: string | null }[])
        .filter((u) => u.contact_id).map((u) => [u.contact_id as string, u.id]));
      const FIN_ROLES = new Set(["MANAGER", "EXECUTIVE", "ASSET_MANAGER", "SUPER_ADMIN", "SYS_ADMIN"]);
      const recipients = [...new Set(((contactsQ.data ?? []) as { id: string; roles: string[] | null }[])
        .filter((c) => (c.roles ?? []).some((r) => FIN_ROLES.has(String(r).toUpperCase().replace(/\s+/g, "_"))))
        .map((c) => usersByContact.get(c.id))
        .filter((u): u is string => !!u))];

      if (recipients.length) {
        const notifRows: Record<string, unknown>[] = [];
        for (const b of (budQ.data ?? []) as { id: string; cost_center_id: string | null; opex_budget: number; committed: number | null; actual: number | null; currency: string | null; status: string | null }[]) {
          if (String(b.status ?? "").toLowerCase() === "closed") continue;
          const spent = (Number(b.actual) || 0) + (Number(b.committed) || 0);
          const util = spent / Number(b.opex_budget);
          if (util < 0.9) continue;
          const severity = util >= 1 ? "CRITICAL" : "WARNING";
          // Re-notify only when a warning later becomes a breach.
          const prior = alerted.get(b.id);
          if (prior && !(prior === "WARNING" && severity === "CRITICAL")) continue;
          const cc = b.cost_center_id ? ccById.get(b.cost_center_id) : null;
          const ccLabel = cc ? `${cc.code ?? ""} ${cc.name ?? ""}`.trim() : "cost center";
          budgetAlerts += 1;
          findings.push(`budget:${ccLabel}@${Math.round(util * 100)}%`);
          for (const recipientId of recipients) {
            notifRows.push({
              recipient_id: recipientId,
              title: util >= 1
                ? `Budget breached — ${ccLabel} at ${Math.round(util * 100)}% of FY${FY} OpEx`
                : `Budget at ${Math.round(util * 100)}% — ${ccLabel} approaching its FY${FY} OpEx limit`,
              message: `Actual + committed ${Math.round(spent).toLocaleString()} ${b.currency ?? ""} against a budget of ${Math.round(Number(b.opex_budget)).toLocaleString()} ${b.currency ?? ""}. Review commitments in FinOps › Budget Control.`,
              severity,
              module: "finops",
              notification_type: "BUDGET_BREACH",
              is_read: false,
              entity_id: b.id,
              entity_type: "budget",
              action_link: "/finops",
            });
          }
        }
        if (notifRows.length) {
          const { error } = await admin.from("notifications").insert(notifRows);
          if (error) console.error("budget notification insert failed:", error.message);
        }
      }
    } catch (e) {
      console.error("budget-breach check failed (non-fatal):", e);
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
      `${driftFlags ? ` · ${driftFlags} Golden-Spot drift(s)` : ""}` +
      `${rcaDrafts ? ` · ${rcaDrafts} RCA draft(s) opened` : ""}` +
      `${budgetAlerts ? ` · ${budgetAlerts} budget alert(s) sent` : ""}` +
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
      golden_spot_drift: driftFlags,
      rca_drafts: rcaDrafts,
      budget_alerts: budgetAlerts,
      dq_regression: Boolean(dqNote),
      proposals_queued: inserted,
      skipped_snoozed: snoozed.size,
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
