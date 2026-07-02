# Reliability Module — Integration & Loop-Closing Design

**Status:** Draft for review · **Scope:** Reliability Tier (Metrics · Predict · Modelling · Analyze · RCM)
**Problem owner's framing:** *"Metrics and Reliability Modelling seem to have similar features… Metrics is hardcoded, a user cannot really use it for computations or analysis. See how features can be integrated to derive real value."*

---

## 1. Executive summary

The Reliability Tier is **five capable but disconnected islands**. Several compute the same reliability math (MTBF/MTTR/availability, bad actors, Weibull) with **separate engines that don't reconcile**, and the passive **Metrics** scoreboard dead-ends instead of dispatching work into the interactive **Modelling** lab or to action (RCA/RCM/PM).

The fix is **not** to rebuild the compute — the Metrics engine already computes real numbers from work-order history. The fix is to:
1. **Unify on one reliability engine** so every surface shows reconciled numbers.
2. **Close the loop** Measure → Diagnose → Model → Decide → Measure, so a finding on the scoreboard flows in one click into the lab and to a maintenance decision.
3. **Make Metrics interactive** (windows, filters, benchmarks) so users analyze rather than view.

---

## 2. Current state (field-level)

### 2.1 The five sub-modules (`moduleRegistry.ts` → "Reliability Tier")

| Sub-module | Route | What it does | Nature |
|---|---|---|---|
| **Metrics** | `/reliability-metrics` | Fleet KPI scoreboard + bad-actor table | Passive · auto · read-only |
| **Predict** | `/predict` | RUL, digital twin, fleet health, scenario sim, Weibull chart, vision | Largely demo / forward-looking |
| **Reliability Modelling** | `/reliability-modelling` | RBD · RAM (MTBF/MTTR/Ao + CI) · Weibull · Monte Carlo · Spares | Interactive lab · savable studies |
| **Analyze** | `/analyze` | Bad-actor Pareto (cost/downtime) · RCA · Defect Elimination | Investigation |
| **RCM** | `/rcm` | RCM decision wizard · FMEA | Strategy |

### 2.2 Clarifying "hardcoded"

`ReliabilityMetricsPage.tsx` computes real KPIs from the last 12 months of work orders via `reliabilityMetrics.ts` (`computeAssetReliability`, `computePMEffectiveness`, `computeScheduleCompliance`, …). The values are **not** faked. What is hardcoded / inert:

- **Fixed time windows** — 12 months and 90 days, not user-selectable.
- **Fixed benchmarks** — `>= 80%`, `>= 90%`, `<= 3% RAV` baked into the KPI list.
- **Fixed scope** — whole fleet; no criticality / site / class filter.
- **Zero interactivity / dead-ends** — you cannot drill a KPI, tweak an assumption, or push an asset into the analysis tools. The bad-actor list even links to the Analyze **Pareto**, not to the calculators that would analyze it.

So Metrics is a **passive scoreboard**, and that is the user-perceived "can't use it for computation or analysis."

### 2.3 Overlap map (the "similar features")

| Capability | Appears in | Engines |
|---|---|---|
| MTBF / MTTR / Availability | **Metrics** (fleet, auto) **and** Modelling **RAM tab** (per-asset, manual/WO, +CI) | `reliabilityMetrics.computeAssetReliability` vs RAM tab calc — **2 engines, unreconciled** |
| Bad actors | **Metrics** (failure count) · **Analyze** (cost/downtime Pareto) · `bad_actor_hunter` agent (server) | **3 rankings** that can disagree |
| Weibull life analysis | Modelling (fitting lab) · Predict (`WeibullChart`) | 2 surfaces |
| Simulation | Modelling **Monte Carlo** · Predict **ScenarioSimulator** | 2 surfaces |
| RCA trigger | Metrics computes `recommendRCA` + reason (display-only) · Analyze runs the RCA · RCM FMEA | disconnected |

`computeAssetReliability` (`reliabilityMetrics.ts:50`) already returns per-asset **MTBF, MTTR, recurring failure modes, and an RCA recommendation with a reason** — precisely the inputs the Modelling lab needs. **That data currently never travels between pages.**

---

## 3. The core problem — the loop is broken

The reliability workflow is inherently a loop:

```
  ┌──────────────────────────────────────────────────────────────┐
  │  MEASURE ──▶ DIAGNOSE ──▶ MODEL ──▶ DECIDE ──▶ (MEASURE) ─────┘
  │  Metrics     Analyze/RCA  Modelling  RCM/PM
```

Today each stage is a separate page unaware of the others:

- **Metrics** says *"GT-301: 6 failures/12mo, MTBF 40d, recurring seal failure, RCA recommended"* — then stops.
- **Modelling** is a powerful lab that **starts from a blank input**; it has asset-WO integration but no idea Metrics just flagged GT-301.
- The engineer manually re-navigates and re-derives what the system already computed one screen earlier.

**Value is lost at every hand-off** because the data and context don't move.

---

## 4. Design principles

1. **One engine, many lenses.** Reliability math is computed once (`reliabilityMetrics.ts` as the source of truth) and rendered by fleet, per-asset, and agent surfaces alike. No surface re-implements MTBF/MTTR/bad-actor logic.
2. **Every number is a launch point.** A KPI or bad actor is not a terminus; it dispatches into the lab, RCA, or RCM with full context.
3. **Context travels.** Asset id + computed reliability (failures, MTBF, modes) flow via navigation state / props into the target tool — no manual re-entry.
4. **Close the loop visibly.** A decision (Weibull→PM, RCM) is shown moving the KPI it targeted, and studies link back to the asset where the problem was seen.
5. **Reuse, don't rebuild.** The lab, the Weibull→Create-PM spine, the study persistence, and the agents already exist — integration wires them together.

---

## 5. Integration moves (prioritized)

### M1 — One reliability engine *(structural)*
Make the Modelling **RAM tab** "asset-WO integration" call `computeAssetReliability` so the fleet MTBF on Metrics and the per-asset MTBF in the lab reconcile. Retire the duplicate math; align the `bad_actor_hunter` server tool to the same definition. **Outcome:** the numbers agree everywhere.

### M2 — Actionable bad actors / KPIs *(drill-through)*
Each bad-actor row and each KPI gains one-click actions: **Model** (opens Weibull/RAM pre-loaded with the asset's failure history), **RCA** (Analyze), **RCM** (study). The already-computed `recommendRCA` reason becomes a button, not a tooltip.

### M3 — Failures → Weibull (the killer bridge) *(flagship)*
Today the Weibull tab needs manual data entry; the asset's failure timestamps already sit in WO history. **"Fit Weibull on this bad actor"** pulls those timestamps straight into the Weibull tab → fit → the existing **Create-PM** spine. Turns a scoreboard number into a life-data-driven maintenance decision in one click.

### M4 — Interactive Metrics
Add a **time-window selector** (12mo / 90d / custom), **criticality / site / class filters**, and **editable benchmarks**. Each re-runs the shared engine. This is the difference between "view" and "analyze."

### M5 — Close the loop visibly
When a Weibull→PM or RCM decision lands, show it move the needle (proactive %, PM effectiveness) with before/after, and surface saved studies on the bad-actor list (*"2 studies · 1 PM created"*). Studies are already persisted (`AnalyzeService`) — they're just not shown where the problem is seen.

### M6 — Consolidate the IA
Five overlapping tiles is too many. Fold toward **Measure (Metrics) → Model (Modelling) → Decide (RCM)**, with Analyze/Predict as lenses/tabs rather than peer entries. The Modelling page already has a Model→Fit→Simulate→Create-PM **workflow spine**; extend that idea fleet-wide as the tier's backbone.

---

## 6. Recommended first slice

**M2 + M3 together as one vertical slice:** make the Metrics bad-actor list actionable, with the flagship action **"Fit Weibull → Create PM"** pre-loaded from that asset's WO failure history.

- Shortest path from "passive scoreboard" to "drives real analysis and a maintenance decision."
- Reuses the existing engine, lab, and Create-PM bridge — **net-new code is mostly the data hand-off**, not new compute.
- Immediately demonstrable: click a bad actor → land in Weibull with its failures fitted → create the PM.

**Sequencing:** M2+M3 slice → M1 (unify engine, now that both sides consume it) → M4 (interactivity) → M5 (loop-closing readouts) → M6 (IA consolidation).

---

## 7. Risks & notes

- **Data sufficiency.** Weibull needs enough failure events; the bridge must degrade gracefully (fall back to RAM/point-estimate when < ~3 failures), reusing the `recommendRCA`/thin-data signalling already in `computeAssetReliability`.
- **Engine unification is behavioural.** Reconciling RAM-tab math to `computeAssetReliability` may shift displayed numbers; call it out as an intended correctness fix, not a regression.
- **Three bad-actor definitions** (count vs cost/downtime vs agent) should be reconciled or explicitly labelled by lens so users know why rankings differ.
- **Agents already compute overlapping analysis** server-side ([[reliability-ai-agents]]); the unified engine should be the shared definition the agent tools also target.
- **RLS/multi-tenancy** hardening for the reliability surfaces stays deferred to the project-wide phase (per prior decision) — not in scope here.

---

## 8. Success criteria

- Fleet MTBF (Metrics) and per-asset MTBF (Modelling) derive from **one engine** and reconcile.
- From a bad actor, an engineer reaches a **fitted Weibull and a created PM without re-entering any data**.
- Metrics supports **at least one interactive dimension** (window or filter) that re-runs the compute.
- A completed analysis is **traceable** on the asset it came from and is shown to move the KPI it targeted.
