# The $150k Replacement Plan — Reliability Specialist

**Date:** 2026-07-27 (rev. 2 — strategy, PSC/Golden Spot and culture layers added) · **Status:** Phase A SHIPPED · **Owner:** Specialist-led strategy (see `IRAMS-Specialist-Strategy.md`)

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
| 12 | **Develop the maintenance strategy** — per-asset task selection from criticality + failure behaviour, not folklore | ⚠️ All the engines exist (criticality assessments, FMECA/RCM, Weibull, meter-PM) but nothing composes them into a per-asset strategy verdict | **D** strategy engine: every critical asset gets a deliberate, defensible strategy |
| 13 | **Assure success, not just prevent failure** — where does the plant sit vs its optimum, and how do we keep it there | ⚠️ PSC layer shipped (Golden Spot, MTOP/SR, SMEA, D-I-S-G forecasting) but lives beside the Specialist, not inside it | **E** Golden-Spot operating strategy: the published-framework moat |
| 14 | Build the reliability culture — TPM/operator care, leadership cadence, wins made visible | ❌ Building blocks exist (rounds, My Work, OEE RPC, value ledger) with no program layer | **F** culture & leadership operating system |

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

### Phase A — prove value (SHIPPED 2026-07-27, commit 4a2f45a, migration 0228 applied)
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
- **B1. SHIPPED 2026-07-28 (2e2313a):** digest consumes snapshot history via the
  `get_assessment_trend` tool — "Trend since baseline" section with deterministic deltas.
- **B2. SHIPPED 2026-07-28 (0108b3b):** "Assess an area" — the engine (extracted to
  `assessmentEngine`) runs over any hierarchy subtree and persists as an
  `ers_reliability_studies` record with structured findings. Same engine, one filter.
- **B3. SHIPPED 2026-07-28:** fleet-wide PM optimization (`lib/pmOptimization`): every active PM ×
  failure history × censored Weibull → stretch / tighten / shift-to-CBM / consolidate verdicts with
  PM-events-per-year recovered, drafted into the proposals queue (pm_optimizer →
  draft_pm_interval) — same approve → deliver → measure loop.
- **B4.** Spares exposure: stock lines vs criticality/lead time once Migration Center phase 3 data
  exists.

### Phase C — the always-on advantage
- **C1. SHIPPED 2026-07-28 (ce593ae):** specialist-watchdog on a nightly cron (05:30 UTC,
  deterministic, zero-LLM): emergent bad-actor step change → draft_de_task, PM-effectiveness
  drift → draft_pm_interval, data-quality regression → audit note; snoozed while pending or
  for 30 days after a human decision.
- **C2. SHIPPED 2026-07-28 (e23cc5a):** big-failure RCA auto-draft — the nightly watchdog opens a
  reactive draft investigation (≥24h downtime or ≥$25k, deduped via trigger_reference_id) with
  the event context prefilled, while the evidence is fresh.
- **C3. SHIPPED 2026-07-28 (2e2313a):** `/specialist/roi` "Return on Reliability" — measured vs
  identified value, subscription vs the $150k benchmark, snapshot-trend corroboration, printable.

### Phase D — maintenance-strategy development (the engineer's real deliverable)

> **D1 + D2 SHIPPED 2026-07-28 (9c8c86d):** `lib/strategySelect` engine + the assessment's
> "Maintenance strategy" section (coverage KPI trended via 0231, regime distribution,
> worst-first gap table drafting into the proposals queue). D3 (task→failure-mode
> rationalization) and D4 (living strategy re-opens) remain.

A $150k engineer's signature artifact is the **maintenance strategy**: for each asset, a
deliberate, documented decision about *how* it will be maintained. IRAMS already owns every
input — criticality assessments (0088), FMECA + RCM (0118), censored Weibull fits, meter-based PM,
condition monitoring, spares data. Phase D composes them:

- **D1. Strategy engine (deterministic, `lib/maintenanceStrategy`-style):** per asset, combine
  criticality × failure behaviour (Weibull β) × detectability/monitorability × cost of failure →
  one of: **run-to-failure** (low-consequence, β≈1), **fixed-interval PM** (wear-out β>1.5, B10
  basis), **condition-based / PdM** (random β≈1 + monitorable — sensors or rounds), **redesign /
  defect elimination** (infant mortality β<1 — more PM makes it worse), **RCM study** (safety-
  critical or high-stakes ambiguity). Output = a strategy verdict with the evidence chain, drafted
  into the proposals queue; approval writes/updates `recurring_work` with analysis provenance
  (`linked_pm_id` lineage already exists).
- **D2. Strategy coverage KPI** in assessment + snapshots: "% of A/B-criticality assets with a
  deliberate strategy" (vs inherited/imported folklore). World-class ≥95% on criticals. This is a
  first-class trend number — it is how a plant manager sees the Specialist *building* something,
  not just flagging things.
- **D3. Task-level rationalization:** for existing PM libraries, map each task to the failure mode
  it defends (FMEA link); tasks defending nothing → kill-list with annual hours freed (feeds B3's
  economics). Duplicate-defence tasks → consolidate.
- **D4. Living strategy:** watchdogs (C1) re-open a strategy when its evidence changes — β drifts,
  a new failure mode appears, sensor coverage arrives. Strategies carry review-by dates like any
  governed document.

### Phase E — the Golden Spot operating strategy (PSC: the moat no competitor can copy)

IRAMS is the reference implementation of the user's published PSC framework (Olorunfemi 2026,
*A Success-Centric Evolution of RCM*). Everything else in this plan, competitors can eventually
imitate; **a published, peer-reviewed framework with its engines already shipped
(`lib/psc.ts`, SMEA, D-I-S-G forecasting) is a defensible category position: the Specialist
doesn't just prevent failure — it keeps the plant *in its Golden Spot*.**

- **E1. Success layer in the assessment:** fleet Golden-Spot residency, MTOP, MTTRg, SR
  (≥90 target / ≥95 world-class) and OPE = SR×PQ×EE (≥85) join the report + snapshots for assets
  with banded reading points; the org's position is stated plainly: "you sit at X — the top
  quartile sits at Y — here is the residency gap in hours and dollars."
- **E2. Golden-Spot watchdog (C1 family):** Sub-Optimal Drift entry (not just alarm breach)
  → early proposal *before* Critical Departure, using the D-I-S-G drift forecasts already shipped
  (predicted time-to-departure). This operationalizes "defend the optimum" as the daily loop.
- **E3. SMEA into strategy:** D1's verdicts consume SMEA's SPN (Value × Sustainability ×
  Monitorability) so what gets *sustained* is ranked with the same rigor FMEA ranks what gets
  prevented — success modes with high SPN get explicit sustainment tasks in the strategy.
- **E4. RSA (Root Success Analysis) agent mode:** when an asset beats its class (top MTOP/SR),
  the Specialist investigates *why* (positive deviance) and proposes propagating the practice —
  the success-side mirror of RCA, and the cheapest improvement mechanism a plant owns.
- **E5. D-I-S-G at the front of life:** new/overhauled assets get design-and-installation quality
  gates (time-to-Success tracked); infant-mortality signatures (β<0.85) route to installation-
  quality review, not more PM.

### Phase F — TPM & proactive reliability culture (the leadership operating system)

Tools don't move plants; operating rhythms do. A world-class RE spends half their week on culture:
making operators owners, making leaders review the right numbers, making wins visible. The
Specialist becomes the **cadence engine**:

- **F1. Operator care (TPM autonomous maintenance):** clean-inspect-lubricate routes built from
  the strategy engine's CBM verdicts, delivered as mobile rounds (condition-data module); abnormality
  reporting one tap from a round; AM step progression tracked per area.
- **F2. OEE + OPE side by side:** the classic loss lens (OEE RPC exists, 0203) next to the
  success lens (OPE) — availability losses decomposed into the six big losses, each loss tied to
  the asset strategies (D) that attack it.
- **F3. Leadership pack (auto-drafted, cadence-bound):** weekly reliability meeting agenda from
  live data (new bad actors, proposals awaiting decision >7 days, wins realized); monthly
  management report (snapshot deltas, measured value, strategy coverage, SR trend) — the
  Specialist writes the pack, the leader runs the room. Decision latency (time-to-approve) is
  itself a tracked culture KPI.
- **F4. Wins made visible:** value-ledger events pushed to the contextual-messaging threads of the
  crews that did the work — reinforcement, not reporting.
- **F5. Skills & accountability:** training/qualification matrix vs the strategies deployed (who
  can do precision alignment? laser? thermography?); gaps become proposals; policy-deployment
  goals (hoshin-style) cascade from the plant SR/OPE target to area-level KPIs on My Work.

## 6. World-class program elements — adoption map

Benchmarks the majors sell against (SMRP Body of Knowledge, Uptime Elements, ISO 55000/55001,
TPM pillars, RCM-II). Status: ✅ shipped in IRAMS · ⚠️ partial · ❌ roadmap.

| Program element | Status | Where / next |
|---|---|---|
| Criticality analysis | ✅ | 0088 assessments; feeds D1 |
| FMEA/FMECA + RCM | ✅ | 0118 + FMECA division; D3 links tasks→modes |
| Weibull / life-data analysis | ✅ | assessment + analyst + studies (A4) |
| PM optimization | ⚠️ | flags shipped; B3 fleet-wide economics |
| Predictive maintenance | ✅ | Predict: FFT/envelope, bearing freqs, rules, alert diagnosis |
| Alarm rationalization | ✅ | 0205 — fold into E2 watchdog |
| Defect elimination | ✅ | DE panel + evidence confidence (0218); F4 celebrates closures |
| RCA (evidence-graded) | ✅ | 0217; C2 auto-draft |
| Planning & scheduling excellence | ⚠️ | schedule compliance measured; wrench-time/backlog-weeks KPIs → F3 pack |
| MRO storeroom / spares optimization | ⚠️ | ATP netting shipped; B4 criticality-driven min/max proposals |
| Precision maintenance standards | ❌ | alignment/balance/lube specs as task-library standards (D3 attach) |
| Lubrication program | ❌ | route-based, from D1 CBM verdicts (F1 delivery) |
| Operator-driven reliability (TPM AM) | ❌ | F1 |
| OEE / six big losses | ⚠️ | RPC exists; F2 surfaces + decomposes |
| Leadership cadence & scorecards | ❌ | F3 |
| Skills / qualification matrix | ⚠️ | qualifications table exists; F5 gap analysis |
| Asset lifecycle / repair-vs-replace | ⚠️ | RUL reset on capital events exists; economics popup on dossier → B-phase |
| Warranty recovery | ✅ | assessment section (self-funding closer) |
| Management of change | ⚠️ | audit trail exists; strategy re-open (D4) is the reliability MoC |
| Benchmarking flywheel | ❌ | consented anonymized cross-tenant aggregation (strategy O1 decision) |
| **Success-centric layer (PSC/Golden Spot)** | ✅ engines / ⚠️ integration | **E — nobody else has this; it is the category claim** |

## 7. Guardrails (unchanged)

Every number deterministic; LLM writes prose over computed findings, never the reverse. Human
approves every outward action (`ers_agent_actions` → Deliver). Snapshots append-only. All agent
runs audited in `ers_ai_audit_log`.
