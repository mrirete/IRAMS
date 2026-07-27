# The $150k Replacement Plan — Reliability Specialist

**Date:** 2026-07-27 · **Status:** Phase A in execution · **Owner:** Specialist-led strategy (see `IRAMS-Specialist-Strategy.md`)

## 1. The claim we have to be able to defend

A senior reliability engineer costs $150,000+/yr (salary + burden). The Specialist is sold as doing
that job for a fraction of the price. That claim survives customer scrutiny only if the product can
do three things a human RE does:

1. **Do the work** — the actual engineering analyses, on the customer's real data, continuously.
2. **Show the work** — every number deterministic, cited, printable, reviewable.
3. **Prove the value** — a before/after ledger the plant manager can take to *their* boss.
   A human RE keeps their job with one slide: "here is what I saved you this year." The Specialist
   must produce that slide automatically, from measured deltas — not vendor-math "identified value."

Point 3 is the differentiator. Every CMMS vendor claims "AI finds savings." Almost none *measure
what actually happened after the recommendation was applied.* That closed loop is the product.

## 2. What you pay a $150k reliability engineer for — capability map

| # | Human RE deliverable | Specialist today | Gap → plan |
|---|---|---|---|
| 1 | Plant reliability assessment (Pareto, bad actors, PM review, warranty scan) | ✅ Real, deterministic (`AssessmentReportPage`) — but **ephemeral**: not stored, no history | **A1** persist snapshots, run-over-run deltas |
| 2 | Asset register / data stewardship (ISO 14224 hygiene) | ❌ Assessment only scores WO coverage; register checks are mock (`DataQualityPage`) | **A2** register-quality engine in the assessment |
| 3 | "What did I save you" annual review | ❌ Ledger counts *identified* $ from draft payloads only | **A3** measured realized value: before/after CM run-rate on assets with approved actions |
| 4 | Weibull / life-data analysis with a defensible PM basis | ✅ Weibull Analyst (per asset) + assessment top-5 fits — but results **discarded**, never become records | **A4** one click: finding → `ers_reliability_studies` + versioned `ers_reliability_analyses` |
| 5 | Scoped deep-dive studies (one system, one failure mode) | ⚠️ Study containers exist with full lifecycle (0153/0204) but the Specialist never creates or reads them | **A4** now; **B2** study-scoped assessment later |
| 6 | Monthly report to management | ⚠️ Monday briefing cron (prose) — no KPI trend | **B1** briefing reads snapshot deltas: "spend down X since baseline" |
| 7 | Bad-actor elimination program | ✅ bad_actor_hunter → DE drafts → approval → CMMS write-back | Realization measurement (A3) closes its loop |
| 8 | PM optimization across the fleet | ⚠️ Assessment flags top-10 waste; Weibull is top-5 by failure count | **B3** full-fleet PM review with kill-list economics |
| 9 | RCA facilitation after big failures | ✅ RCA module with evidence grading (0217) | **C2** auto-draft RCA on downtime threshold |
| 10 | Spares/stock advice tied to criticality | ❌ Not connected to Specialist | **B4** after Migration Center phase 3 data lands |
| 11 | Always-on monitoring (a human is ~1 FTE; agent never sleeps) | ⚠️ Cron briefing exists; watchdogs don't | **C1** emergent-bad-actor + PM-drift + DQ-regression watchdogs feeding proposals |

## 3. The economics, stated plainly

- Human RE: $150k/yr, one plant, ~1,800 productive hours, analyses quarterly at best, leaves and
  takes the knowledge along.
- Specialist: runs the same deterministic methods (median-rank-regression censored Weibull, Pareto
  on frozen costs, PM-vs-failure effectiveness, warranty windows) **continuously**, on every asset,
  with an auditable trail, and a human approving every action.
- Target price point: a low-five-figures subscription → 10x+ cheaper. The sales artifact is the
  assessment report (day 1) plus the realized-value ledger (day 90): *"$X measured reduction in
  corrective run-rate on the assets the Specialist touched — here is the math."*

## 4. Value measurement methodology (must survive a skeptical plant manager)

Realized value is **never** an LLM estimate. For each asset with an approved Specialist action:

- **Before rate** = corrective (CM) cost on that asset in the 365 days before first approval ÷ 365.
- **After rate** = CM cost from first approval to today ÷ elapsed days.
- **Measured value to date** = (before − after) × elapsed days. Reported net — negative results are
  shown as "no measurable change yet," never hidden.
- An asset enters the measured set only after a 30-day maturity window (before that it is
  "maturing"); one asset counts once regardless of how many actions touched it (no double counting).
- Caveats stated on the tile: run-rate deltas are attribution-adjacent, not causal proof; the
  assessment snapshots (A1) provide the plant-level corroboration (total spend trend).

Identified value (draft `estimated_savings`) stays, but is always labeled distinctly from measured.

## 5. Phases

### Phase A — prove value (this session)
- **A1. Assessment snapshots** — `ers_assessment_snapshots` (0228): every qualifying run persists
  KPIs + full findings JSON + narrative, append-only, admin-write. Report shows deltas vs the
  previous snapshot. This creates the baseline→now story and makes the briefing trendable.
- **A2. Register-quality engine** — pure module `lib/registerQuality.ts`: hierarchy structure %,
  criticality-spread (detects defaulted-to-C imports), nameplate completeness, normalized tag
  collisions, WO-linkage. Composite health % rendered as a first-class assessment section and
  stored in the snapshot.
- **A3. Realized-value ledger** — pure module `lib/valueRealization.ts` (unit-tested) + workspace
  tile "Value measured": methodology in §4.
- **A4. Findings → studies** — "Save as study" on every assessment Weibull finding writes the fit
  into `ers_reliability_studies` + `ers_reliability_analyses` (type `weibull`, versioned), finally
  joining the Specialist to the reliability tier's spine.
- **A5. Import clarity** — per-source export instructions in the wizard (SAP IW38/IH06, Maximo
  app downloads, MaintainX CSV exports…), so "Import CMMS data" stops reading as "upload a database."

### Phase B — match the engineer's scope
- **B1.** Briefing/digest consumes snapshot history: "since the baseline assessment (date): spend Δ,
  coverage Δ, register health Δ" with the same citation discipline.
- **B2.** Study-scoped assessment: run the assessment engine over one system/asset set, persisted
  against the study record. (The Explore→popup pattern; no new engine, a filter.)
- **B3.** Fleet-wide PM optimization: every active PM × failure history × Weibull where fittable →
  ranked kill/stretch/shift-to-condition list with annual hours + $ freed.
- **B4.** Spares exposure: stock lines vs criticality/lead time once Migration Center phase 3 data
  exists.

### Phase C — the always-on advantage
- **C1.** Watchdogs on cron: emergent bad actor (cost-rate step change), PM-effectiveness drift,
  data-quality regression → proposals queue, so value generation is not click-driven.
- **C2.** Downtime-threshold RCA auto-draft into the RCA module.
- **C3.** Customer-facing ROI page: subscription cost vs measured value, printable for renewals.

## 6. Guardrails (unchanged)

Every number deterministic; LLM writes prose over computed findings, never the reverse. Human
approves every outward action (`ers_agent_actions` → Deliver). Snapshots append-only. All agent
runs audited in `ers_ai_audit_log`.
