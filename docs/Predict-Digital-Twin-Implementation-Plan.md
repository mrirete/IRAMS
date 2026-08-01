# Predict / Digital Twin — Implementation Plan

**Status:** Proposed · **Owner:** Reliability Tier · **Date:** 2026-07-16
**Related:** [Reliability-Module-Integration-Design.md](./Reliability-Module-Integration-Design.md), [reliability-ai-agents-design.md](./reliability-ai-agents-design.md)

## 1. Purpose

Close the credibility and capability gaps in the **Predict** module (`/predict`) surfaced by the July-2026 audit, and evolve the Digital Twin from a single one-size-fits-all health equation into a **class-aware, hierarchical, standards-aligned** twin that can analyse rotating equipment, static equipment, sub-systems, systems and units.

The audit's three root problems:

1. **Honesty** — a stale feed ("Updated 139d ago") shown as green *Running/Live*; `Math.random()` sub-indices; a mock fleet and a fake "Monte-Carlo · 5,000 runs" presented as real.
2. **One weak engine** — [PredictionService.ts](../src/frontend/src/eam/services/PredictionService.ts) re-implements RUL / Weibull / degradation with hand-tuned constants and **does not use** the rigorous engine ([weibull.ts](../src/frontend/src/eam/utils/weibull.ts)), violating that module's own "must fit through this module" mandate.
3. **No equipment-class awareness** — the same vibration-weighted health index (`Vib .35 / Temp .30 / Press .20 / Flow .15`, [PredictionService.ts:435](../src/frontend/src/eam/services/PredictionService.ts#L435)) is applied to a static heat-exchanger (E-605) as to a pump. Hierarchy (`enterprise…component`) and `EquipmentClass` exist in the data model but are ignored by the forecast engine.

## 2. Guiding principles

- **One engine.** All survival / RUL / Weibull math flows through `weibull.ts` + `pmRecommendation.ts` + `reliabilityMetrics.ts`. No local re-implementations.
- **Honest by construction.** Never render a heuristic in the visual grammar of a fitted statistic; never show a stale feed as live; never invent numbers (no `Math.random()` in compute).
- **Class-aware.** Health, degradation and prognostics branch on `EquipmentClass`. Rotating ≠ static.
- **Standards-aligned.** ISO 13374 processing spine (DA→DM→SD→HA→PA→AG); ISO 20816 for rotating vibration; API 570/581 RBI for static equipment; ISO 14224 hierarchy for roll-up.
- **Hierarchical.** Component → subunit → equipment → system → unit, with roll-up (health aggregation) and roll-down (fault localisation).
- **Data-gated.** A capability appears only when its data exists; otherwise an honest empty/"directional-only" state.

## 3. Current-state reference (grounded)

| Concern | File | Verdict |
|---|---|---|
| Page shell / tabs / fleet / picker | `pages/PredictPage.tsx` | real plumbing |
| Overview tab | `components/predict/PredictOverviewTab.tsx` | heuristic + `Math.random()` sub-indices (`:134`) |
| Digital Twin tab | `components/predict/DigitalTwinTab.tsx` | linear-decay trajectory + inferred "physics" |
| RUL & Reliability tab | `components/predict/RULReliabilityTab.tsx` | heuristic RUL + fixed-β Weibull chart |
| Twin trajectory chart | `components/predict/TwinHealthChart.tsx` | plots deterministic decay; threshold line at 60 |
| Weibull chart | `components/predict/WeibullChart.tsx` | **β hardcoded = 2.5**, parametric plot not a fit |
| What-If simulator | `components/predict/ScenarioSimulator.tsx` | **entirely mock** (setTimeout, hardcoded baseline) |
| Fleet cards | `components/predict/FleetHealthMap.tsx` | `MOCK_FLEET` fallback when no twins |
| **Compute engine** | `eam/services/PredictionService.ts` | heuristic second engine |
| **THE reliability engine** | `eam/utils/weibull.ts` | rigorous, censored, MRL — underused |
| Grounded RUL / PM | `lib/pmRecommendation.ts` | `groundedRulFromHistory`, `recommendPM` — ready to wire |
| Canonical MTBF/failures | `eam/services/reliabilityMetrics.ts` | single failure definition |
| Real Monte Carlo | `eam/utils/monteCarloEngine.ts` | used by Modelling, not Predict |
| Taxonomy + class | `types/assets.ts` | `TaxonomyLevel`, `EquipmentClass` — unused by Predict |

Key engine signatures already available to reuse:

```ts
// weibull.ts
fitWeibull(failureTimes: number[], suspensionTimes?: number[], opts?): WeibullFitResult | null
weibullBLife(beta, eta, pct): number
meanResidualLifeHours(beta, eta, ageHours): number   // the REAL RUL

// pmRecommendation.ts
groundedRulFromHistory(failureIntervalsHours, suspensionsHours): GroundedRul   // {rulDays, beta, eta, method}
recommendPM(failureIntervalsHours, suspensionsHours, costs): PMRecommendation
```

---

## 4. Phased plan

Ordered by **credibility-per-effort**. Phases 0–1 are shippable in the current sprint; 2–5 are the capability build; 6 is the structural refactor that makes the rest clean.

### Phase 0 — Honesty & de-risk (small, mostly subtractive)

Goal: nothing on screen claims more than the data supports. No new math.

**0.1 Freshness gating.** Derive `dataAgeDays` from the newest sensor/reading timestamp already fetched. When `> STALE_DAYS` (default 7), the "Running/Live" pill becomes **Stale — reconnect** and the "Live Sensor Readings" heading drops "Live".
- Files: `PredictOverviewTab.tsx` (readings header + "Updated Xd ago"), `PredictPage.tsx` (pass `lastReadingAt` down). Add `STALE_DAYS` to `config/demoMode.ts` or a new `config/predict.ts`.
- Accept: with a 139-day-old feed the header reads *Stale (139d)*; a <7-day feed still reads *Running*.

**0.2 Kill `Math.random()` sub-indices.** Replace the jitter in `decomposeHealthIndex` ([PredictOverviewTab.tsx:112-149](../src/frontend/src/components/predict/PredictOverviewTab.tsx#L112)) with a **deterministic** decomposition from the actual per-sensor scores already computed (Mechanical = vibration-tagged sensors, Thermal = temperature, Performance = flow/pressure).
- Accept: identical inputs → identical sub-indices across renders.

**0.3 Badge the mock fleet.** When `FleetHealthMap` falls back to `MOCK_FLEET`, render a visible **"Sample data — connect assets to see your fleet"** ribbon.
- Accept: real twins → no ribbon; zero twins → ribbon + sample cards clearly marked.

**0.4 De-fictionalise What-If.** Relabel `ScenarioSimulator` header from "Monte Carlo · 5,000 runs" to **"Illustrative estimate"** until Phase 6 wires the real engine. Remove the `monte_carlo_runs: 5000` claim from the payload.
- Accept: no UI text asserts a simulation that didn't run.

**0.5 Reconcile the risk signals.** Make the KPI header consistent: if any sensor is in "Watch"/breach or fleet shows "at risk", the "Risk Alerts / No active alerts" copy must not read *0 / all clear*. Single source: R-4 condition alarms + `ers_prediction_alerts`.
- Accept: "Watch" state and "0 alerts / all clear" never co-occur.

*Effort: ~1–2 days. Purely trust-restoring; no data dependencies.*

### Phase 1 — One engine (route Predict through `weibull.ts`)

Goal: the RUL, confidence bands, P(failure) and Weibull curve become **real fits** when failure history exists, and an explicit *directional-only* heuristic otherwise.

**1.1 Grounded RUL in `_runRULAnalysis`.** Before the heuristic, pull the asset's failure inter-arrivals + suspension (current age) from `reliabilityMetrics` (`failureIntervalsHours`, `failureRepairHours`, `isFailure`) and call `groundedRulFromHistory(...)`.
- If `method === 'weibull-mrl'`: persist `rul_days = grounded.rulDays`, `distribution_type = 'weibull_2p'`, and set `confidence_bands` from `weibullBLife(beta, eta, [10,50,90])`. Store `beta`, `eta` on the estimate.
- Else: keep the current heuristic but tag `distribution_type = 'heuristic'` and surface the `groundedRul.note` ("directional only") in the UI.
- Files: `PredictionService.ts:_runRULAnalysis`; extend `RULEstimate` type with `beta?`, `eta?`, `method`.
- Accept: an asset with ≥2 failure intervals shows an MRL-based RUL whose bands come from B-life percentiles; the header labels method truthfully.

**1.2 Real Weibull curve.** `WeibullChart.tsx` stops hardcoding β=2.5. When a fit exists, plot `fit.plotData` (reliability/failure vs t) from the persisted `beta`/`eta`; otherwise show an **"insufficient failure history"** empty state instead of a fabricated curve.
- Accept: curve shape reflects the fitted β; no history → honest empty state, not a smooth fake.

**1.3 Conditional P(failure) 30D.** Replace `calcPFailure`'s hardcoded-β CDF ([PredictOverviewTab.tsx:101](../src/frontend/src/components/predict/PredictOverviewTab.tsx#L101)) with the **conditional** survival from the fit: `P = 1 − R(age+30)/R(age)`, `R(x)=exp(−(x/η)^β)`. Fall back to "—" (already gated) when no fit.
- Accept: P(failure) is consistent with the same β/η that drive the RUL and curve.

**1.4 Keep the Advisor path unified.** The Reliability Advisor modal already uses `recommendPM`/`fitWeibull`; ensure it and the tabs now read the **same** persisted fit so the numbers match.
- Accept: Advisor RUL == Overview RUL for the same asset.

*Effort: ~3–5 days. Depends on failure history (WOs) existing — most brownfield assets have some; where absent, the directional path is honest.*

### Phase 1.5 — Acceptable limits & threshold intelligence

**Problem.** Health Index, alerts, and (through health) RUL all derive from `alarm_high`/`alarm_low` on each measurement point — yet nothing tells the user what an *acceptable* limit is. Today bands come from the SetupJourney class templates (critical-only, no warning level, and the vibration default of **7.1 mm/s is the ISO 20816-3 Group-1 boundary applied to every pump/motor regardless of size or mounting** — a 90 kW rigid-mount motor should alarm at 2.8) or are typed in blind. Bad bands poison everything downstream. This phase makes the system *propose* limits and the human approve them.

**How the leading AI-PdM vendors handle this** (orientation, not imitation):

| Vendor | Approach to "what's acceptable" |
|---|---|
| **C3 AI Reliability** | Multi-source ML **risk score** instead of raw thresholds; on deviation it assembles an **evidence package** (maintenance history, environment, upstream process variables) and recommends actions — human reviews. |
| **Siemens Senseye** | **Automatic baseline learning** per asset + trend-pattern engines; thresholds are largely learned from the machine's own healthy behaviour, not typed by the user. |
| **Augury** | Fleet-learned diagnostics (baselines from thousands of similar machines) + prescriptive advice as a managed service. |
| Common thread | *The user almost never invents a number. The system proposes; the human approves.* |

**IREAMS differentiator:** standards-first transparency — every suggested limit cites an auditable source (ISO 20816-3 zone, learned baseline stats, OEM datasheet), then refines from data. That beats black-box scores for a governance-minded EAM.

**1.5.1 Standards-based limit library.** New `lib/predict/limitLibrary.ts` encoding ISO 20816-3 zone boundaries per machine group — G1 (large, rigid): A/B 2.3, B/C 4.5, C/D 7.1 mm/s · G2 (medium 15–300 kW, rigid): 1.4 / 2.8 / 4.5 · G3 (large, flexible): 3.5 / 7.1 / 11.2 · G4 (medium, flexible): 2.3 / 4.5 / 7.1 — plus temperature classes and hooks for static-equipment limits (t-min, design pressure — consumed by Phases 2.4/5). Convention: **warning = B/C boundary, critical (trip) = C/D**. SetupJourney step 2 gains a two-question picker (power >300 kW? rigid or flexible mount?) that resolves the group instead of the blanket 7.1; `PointDraft` gains warning levels (schema already has `max_warning`/`min_warning` — currently unused by the journey).
- Files: `SetupJourney.tsx` (TEMPLATES + step-2 UI), new `lib/predict/limitLibrary.ts`.
- Accept: a 90 kW rigid-mount motor template proposes 2.8 warn / 4.5 crit; every suggested value displays its standard source.

**1.5.2 Learned baselines — "Suggest limits from data".** Senseye-style, transparent: with ≥N readings (default 30) over a healthy window, propose warning = μ + 2σ (or P95) and critical = μ + 3σ, **clamped to the standards envelope** from 1.5.1 so statistics never exceed ISO zones. Offered as a button in the Readings band editor, SetupJourney step 2, and on sensor cards with missing/unverified bands.
- Files: new `lib/predict/baselineLimits.ts`; wire into Readings editor + SetupJourney.
- Accept: clicking Suggest shows proposed bands **with rationale** ("learned from 47 readings, μ=2.1, σ=0.3, clamped by ISO 20816-3 G2") that the user applies or edits.

**1.5.3 Band provenance + explain-the-limit UI.** Persist `limit_source` per reading definition (`'iso20816' | 'template' | 'learned' | 'oem' | 'manual'`) and render a provenance chip + in-band position meter on each sensor card (Overview + Readings). This answers "how do I know this is acceptable?" at a glance; legacy bands with no provenance show **"unverified — review"**.
- Accept: every displayed band names its source; unverified bands are visually flagged.

**1.5.4 Feedback-driven adaptation — surface the existing agent.** The `threshold_adapter` agent (AgentService.ts ~:340–392) already turns actionable/false-alarm feedback into band proposals with HITL review (`ers_agent_actions`, AgentReviewPanel). Make it visible: after K false-alarm feedbacks on a sensor, nudge "Review proposed limits" on the sensor card and in AgentReviewPanel; approval writes the new bands with provenance `'learned'`. This is the C3-style human-approved adaptation loop — the plumbing exists, it just isn't discoverable.
- Accept: 3 false-alarm feedbacks yield a pending proposal in the review panel; approving updates the definition and its provenance.

**1.5.5 Alarm hygiene (ISA-18.2-lite).** Deadband (default: a % of the band width) + persistence (M consecutive breaching readings) before an alert fires, so values oscillating around a limit produce one alert, not a stream. Optional cause / consequence / operator-action text per alarm (rationalization-lite) — later feeds the ISO 13374 Advisory (AG) layer.
- Files: `PredictionService._runAlertScan`, alert detail UI.
- Accept: a chattering value produces a single alert; alert detail shows action guidance when provided.

*Effort: 1.5.1–1.5.3 ~1 week; 1.5.4 ~2 days (scaffolding exists); 1.5.5 ~2–3 days. No dependency on Phase 2 — but Phase 2's class health-models must consume the limit library rather than invent their own numbers.*

### Phase 2 — Class-aware health (rotating vs static)

Goal: the Health Assessment (ISO 13374 HA layer) branches on `EquipmentClass`; static equipment stops being scored on vibration.

**2.1 Health-model strategy.** Introduce `lib/predict/healthModels.ts` exporting a per-class config:

```ts
type ClassHealthModel = {
  weights: Record<SensorKind, number>;   // e.g. rotating: vibration-led
  primaryKpis: KpiKind[];                // what the card leads with
  vibrationZoning: boolean;              // ISO 20816 zones only when true
};
```

- **rotating** — vibration-led (ISO 20816 severity + spectral: 1× imbalance, 1×/2× misalignment, BPFO/BPFI bearing tones), temperature + oil-analysis secondary; `vibrationZoning: true`. Zone boundaries come from the Phase 1.5 **limit library** (machine group-aware), not hardcoded constants.
- **static_pressure / piping** — **no vibration**; driven by wall-thickness/corrosion rate, thermal effectiveness / fouling factor / ΔP; `vibrationZoning: false`.
- **electrical** — thermography (hotspot ΔT), insulation resistance, load.
- **instrument / control / safety** — calibration drift, proof-test/response, availability.
- fallback **other** — current generic blend.

**2.2 Wire into `_runDigitalTwinSnapshot`.** Look up the asset's `equipment_class`, select the model, compute HA with that model's weights instead of the hardcoded blend at `:435`.
- Files: `PredictionService.ts` (fetch asset class; parameterise scoring), new `lib/predict/healthModels.ts`.

**2.3 Class-appropriate card.** `PredictOverviewTab.tsx` renders KPIs from `model.primaryKpis`; ISO-zone chips only when `model.vibrationZoning`. E-605 (a cooler) then leads with **fouling / thermal effectiveness / wall-loss & next-inspection**, not an ISO vibration zone.
- Accept: a `static_pressure` asset shows no vibration ISO zone; a `rotating` asset does.

**2.4 Static-equipment data capture.** Static health needs thickness/effectiveness inputs. Add class **reading-definition templates** (thickness CMLs, inlet/outlet temps for exchanger effectiveness) so operators can log them via the existing Condition Data path (`reading_definitions`/`reading_logs`). Corrosion rate = regression slope of thickness over time (LTCR/STCR, take the higher).
- Accept: entering successive thickness readings yields a corrosion rate + remaining life to t-min.

*Effort: ~1–2 weeks. 2.1–2.3 are engine/UI; 2.4 introduces the static data pipeline and can land incrementally.*

### Phase 3 — Physics-informed degradation

Goal: replace the inferred "physics" (`_runDegradationUpdate` health-band guesses, invented `wear_rate`) with real class-specific degradation models that feed the same RUL engine.

- **rotating** — bearing **L10** / Weibull wear-out (β 1.5–2.5) fitted, not assumed.
- **static** — corrosion-rate law → remaining life to t-min; exchanger fouling growth.
- **hybrid** — physical model + small data-driven residual correction (particle-filter/regression on the residual) for interpretability, per current physics-informed-ML practice.
- Degradation and RUL must be **one number**: the degradation model's failure projection == the RUL estimate (no two contradicting timelines).
- Files: `PredictionService.ts:_runDegradationUpdate`, `lib/predict/degradation/*`.
- Accept: "Active Degradation Mechanisms" lists a mechanism whose projected-failure date equals the RUL tab's date; no `Math.*` constants unbacked by data.

*Effort: ~2 weeks; start rotating (L10) then static (corrosion).*

### Phase 4 — Hierarchy: roll-up & roll-down

Goal: sub-systems, systems and units get meaningful twins.

**4.1 Roll-up.** Aggregate child health into parent along `parent_id`/`taxonomy_level`. Structural levels never own sensors (existing NON_MAINTAINABLE rule); their health is a **criticality-weighted worst-link** aggregate, and — where a Reliability Block Diagram exists (Reliability Modelling already has RBD) — a series/parallel reliability roll-up that respects redundancy.
- Files: `PredictPage.tsx` fleet builder (currently *filters out* system/unit at `:181`), new `lib/predict/rollup.ts`.
- Accept: a system card's health reflects its children; a redundant pair doesn't drag a system down like a series element would.

**4.2 Roll-down (fault localisation).** When a system/unit deviates, rank child contributors so the twin points to the responsible sub-system/component.
- Accept: clicking a degraded system lists the top offending children by health deficit × criticality.

*Effort: ~1–2 weeks. Pure aggregation over data that already exists; highest "makes the twin feel real at plant scale" payoff.*

### Phase 5 — Risk-Based Inspection for static (API 581-lite)

Goal: static equipment gets a **risk** surface (the correct prognostic for fixed equipment), not a bearing-style RUL curve.

- **PoF** = generic failure frequency × **Damage Factor** (from corrosion rate / thickness trend from Phase 2.4) × management factor.
- **CoF** = simplified consequence (fluid, size, criticality) — reuse `CriticalityRank`.
- **Risk = PoF × CoF** → risk matrix cell + **next-inspection date** before t-min is reached.
- Files: new `lib/predict/rbi.ts`; a static-equipment "Integrity" panel in `DigitalTwinTab.tsx`.
- Accept: E-605 shows an RBI risk badge and a defensible re-inspection interval, sourced from thickness trend — not a vibration RUL.

*Effort: ~2 weeks. Depends on Phase 2.4 thickness data. Ship as "RBI-lite"; full API 581 DF tables are a later refinement.*

### Phase 6 — Real What-If + ISO 13374 refactor

**6.1 Real Monte Carlo.** Wire `ScenarioSimulator` to `eam/utils/monteCarloEngine.ts` (the real engine used by Modelling) — remove the `setTimeout` mock and the hardcoded baseline; drive baseline from the asset's fitted distribution.
- Accept: sliders change inputs to an actual simulation; run count is real.

**6.2 ISO 13374 spine.** Restructure `PredictionService` compute into named layers — **DA** (acquisition), **DM** (feature extraction: RMS/kurtosis/crest, FFT/envelope where signal data exists), **SD** (state detection / anomaly), **HA** (health), **PA** (prognostics/RUL), **AG** (advisory → Create-WR/inspection). This gives clean seams for the class-specific logic from Phases 2–5 and makes every number explainable.
- Accept: each KPI traces to a named layer; adding a new equipment class touches HA/PA config only.

*Effort: 6.1 ~2 days; 6.2 ~1–2 weeks (refactor, no behaviour change).*

---

## 5. Data-model / migration touch-points

- `ers_rul_estimates`: add `beta`, `eta`, `method` (`'weibull-mrl' | 'heuristic'`). *(Phase 1)*
- `reading_definitions`: add `limit_source` (`'iso20816' | 'template' | 'learned' | 'oem' | 'manual'`) + optional `alarm_deadband`, `alarm_persistence`, `operator_action`. *(Phase 1.5)*
- `reading_definitions`: class templates for thickness CMLs & exchanger temps (no schema change; seed templates). *(Phase 2.4)*
- New (Phase 5): `ers_integrity_assessments` (asset_id, corrosion_rate, t_min, remaining_life, pof, cof, risk, next_inspection_at) — or fold into `ers_twin_states.degradation_models`.
- No change needed to `assets` — `equipment_class`, `taxonomy_level`, `parent_id` already present.

## 6. Sequencing & dependencies

```
Phase 0 ──▶ Phase 1 ──▶ Phase 1.5 ──▶ Phase 2 ──▶ Phase 3 ──▶ Phase 5
   (honesty)  (one engine)  (limits)   (class-aware)  (physics)  (RBI, needs 2.4)
                   └──────────────────────▶ Phase 4 (hierarchy, parallel to 1.5/2/3)
                                                └──▶ Phase 6 (real MC + ISO 13374 refactor)
```

- **Ship independently:** Phase 0 (now), Phase 1 (next), Phase 1.5 & Phase 4 (parallelisable).
- **Order rationale:** limits (1.5) before class-aware health (2) — band quality gates the health index, and Phase 2's class models consume the limit library.
- **Data-gated:** Phases 2.4 & 5 need thickness data flowing; land the capture path early.

## 7. Acceptance / definition of done (module-level)

1. No stale feed ever shows as "Live"; no `Math.random()` in any compute path.
2. Every RUL / P(failure) / Weibull surface in Predict derives from `weibull.ts` (or is explicitly labelled heuristic/directional).
3. **Every alarm band has a provenance** (standard / learned / OEM / manual) and the user always has a suggested-limit path — no one is left inventing numbers; unverified bands are flagged.
4. A `static_pressure` asset and a `rotating` asset show **different**, class-appropriate KPIs and degradation models.
5. System/unit twins reflect their children (roll-up) and can point to the offending child (roll-down).
6. What-If runs a real simulation or is labelled illustrative.
7. Compute is organised along the ISO 13374 DA→…→AG spine.

## 8. References (industry practice)

- ISO 13374 six-layer processing (DA/DM/SD/HA/PA/AG); ISO 17359 CM workflow — practical ML deployment.
- ISO 20816-3 vibration severity for rotating machinery — machine groups & zone boundaries (G1 2.3/4.5/7.1 · G2 1.4/2.8/4.5 · G3 3.5/7.1/11.2 · G4 2.3/4.5/7.1 mm/s RMS); alarm at B/C, trip at C/D.
- ISA-18.2 alarm management — rationalization (cause/consequence/operator-action/setpoint), deadbands + delays against chattering; rationalization typically eliminates 30–60% of configured alarms.
- Vendor practice: C3 AI Reliability (risk score + evidence package, HITL actions), Siemens Senseye (automatic per-asset baseline learning), Augury (fleet-learned diagnostics) — common pattern: *system proposes limits, human approves*.
- API 570 (thickness/CML corrosion-rate, LTCR/STCR, remaining life) and API 580/581 RBI (PoF × Damage Factor × management factor) for static equipment.
- Physics-informed / hybrid RUL (physical model + data-driven residual) for interpretable, safety-critical prognostics.
- System / system-of-systems digital twins — health roll-up and fault localisation across a multi-layer hierarchy (ISO 14224 / ISO 23247).
