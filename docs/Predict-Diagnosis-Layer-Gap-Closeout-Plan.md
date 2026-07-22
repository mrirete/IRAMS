# Predict Diagnosis Layer — Gap Closeout Plan

**Date:** 2026-07-22
**Status:** Slices 1–4 BUILT (2026-07-22, migration 0215 applied). Slice 5 (learning loop) open — needs field data first.
**Context:** Competitive audit vs. UptimeAI (detect → diagnose → prescribe). IRAMS Predict has real detection (ISA-18.2 alert scan, class-aware health index, FFT/envelope DSP), real prediction (censored Weibull → conditional MRL RUL), and real prescription (alert → HITL WR draft → work order). The gap is **diagnosis**: nothing deterministically answers *"what is failing and why"* between detection and the Gemini narration. Vibration gets ISO 13373 screening heuristics only; threshold alerts diagnose nothing; the ISO 14224 failure-mode taxonomy (70+ codes) is used for WO coding but never matched against live evidence.

**Goal:** an explainable, evidence-ranked diagnosis layer — every high-signal detection carries *ranked failure-mode hypotheses with traceable evidence*, drawn from the codified taxonomy, asset FMEA/RCM data, and failure history; Gemini narrates that structure instead of inferring from scratch. This is UptimeAI's "Root Cause Agent" axis, built on data IRAMS already owns.

**Design rules (carried from Predict conventions):**
- Pure-TS math in `src/frontend/src/lib/predict/*`, no I/O, unit-tested.
- Honest-by-construction: every output labelled `deterministic-rule` / `screening-heuristic` / `llm-narrated`; no fake confidence.
- HITL unchanged: diagnosis informs drafts; humans approve.

---

## Slice 1 — Bearing defect-frequency engine (BPFO/BPFI/BSF/FTF)

The one place diagnosis already almost works. `spectral.ts diagnose()` finds envelope tones but says "compare against BPFO/BPFI manually" because bearing geometry is unavailable (`spectral.ts:11-14`).

**1a. `lib/predict/bearingFaults.ts` (new, pure TS + tests)**
- Input: `{ ballCount, ballDiameterMm, pitchDiameterMm, contactAngleDeg }` + shaft speed (Hz).
- Standard kinematic formulas → `{ bpfo, bpfi, bsf, ftf }` in Hz and shaft orders.
- `matchEnvelopeTones(envPeaks, faultFreqs, tolFrac)` → matches fundamentals **and 2×/3× harmonics**, plus 1×-shaft sidebands around BPFI (inner-race modulation) — returns named race with match quality.
- No-geometry fallback: approximate-order screening (BPFO ≈ 0.4·n·fr, BPFI ≈ 0.6·n·fr when only ball count known), output labelled `approximate`.

**1b. Geometry + rated RPM storage**
- `assets.properties` JSONB (exists since 0005) under a namespaced key:
  ```json
  "predict": {
    "rated_rpm": 1480,
    "bearings": [{ "position": "DE", "designation": "6205", "ballCount": 9, "ballDiameterMm": 7.94, "pitchDiameterMm": 39.04, "contactAngleDeg": 0 }]
  }
  ```
- Small seed catalog `lib/predict/bearingCatalog.ts` (~20 common designations: 6203–6316, 22210–22230, NU2xx) so users pick a designation instead of typing geometry. Editable in the asset detail popup (calm-popup pattern).

**1c. Wire into the spectral pipeline**
- `SpectralAnalysisPanel.tsx`: default RPM from `properties.predict.rated_rpm` (today it's hand-typed, demo hardcodes 1480); pass asset bearing set into `analyzeWaveform`.
- Extend `diagnose()` with optional `bearingFaultFreqs`; when an envelope tone matches, the finding upgrades from "bearing defect candidate" to e.g. **"Envelope tone 87.2 Hz matches BPFO 87.4 Hz (6205, DE) — outer-race defect signature"**, tone `investigate`.
- Persisted automatically via existing `ers_waveforms.features.diagnosis`.

**Deliverable:** vibration diagnosis names the component and the race, deterministically. ~2–3 days incl. tests.

---## Slice 2 — Deterministic diagnosis rules engine (FMEA-keyed)

**`lib/predict/diagnosisRules.ts` (new, pure TS + tests)**

Input — a `DiagnosisEvidence` bundle assembled by callers:
- Sensor context: tag, measurement type (vib/temp/pressure/current/thickness…), breach direction, trend slope, value vs. band.
- Health-index drivers (already computed class-aware in `healthModels.ts`).
- Spectral findings incl. Slice 1 named faults, when a recent `ers_waveforms` row exists for the asset.
- Equipment class from `equipmentClass.ts` (`declared | inferred | default` basis).
- Asset priors: FMEA rows (`ers_fmea_items`), RCM failure modes (`ers_rcm_failure_modes` — has RPN, `historical_wo_count`, `historical_mtbf_days`), criticality (`ers_criticality_assessments`), and the asset's own failure history (`wo_failure_data.failure_mode_code` frequencies).

Output — ranked hypotheses:
```ts
interface DiagnosisHypothesis {
  failure_mode_code: string;      // reference_codes, category FAILURE_MODE
  failure_mode_label: string;
  confidence: number;             // 0–1, rule-derived, honest
  basis: 'deterministic-rule' | 'screening-heuristic';
  evidence: DiagnosisEvidenceItem[];  // sensor/spectral/FMEA/history citations
  recommended_action: string;     // maps to RCM decision where present
}
```

Rule base — per equipment class (`category_ref` groups in the taxonomy), starting set ~25 rules, e.g.:
- rotating: vib high + 1× dominant → `BAL`; 2× elevated → `MIS`/`LOO`; envelope BPFO/BPFI match → `BRG`; bearing temp high + vib impulsive → `BRG`+`LUB`; temp high alone → `LUB`/`CLG`
- static: LTCR/STCR acceleration (from `integrity.ts`) → corrosion/erosion modes; pressure drift → `LEK`/`PLU`
- electrical: current imbalance/thermal → winding & connection modes
- instrument: flatline/stuck reading (persistence scan already sees this) → `CAL`/`SEL`

Scoring = rule base weight × evidence strength, **boosted by asset priors**: a hypothesis matching a documented FMEA/RCM mode for that asset (or a mode the asset has actually failed with, per `wo_failure_data`) ranks above generic matches — this is the "reasons like an engineer who knows this asset" behavior, done with data IRAMS already has.

Every hypothesis carries its evidence citations — the explainability parity point ("which sensors triggered, which historical patterns support it").

**Deliverable:** any detection can be diagnosed, not just vibration. ~3–4 days incl. tests.

---

## Slice 3 — Persist and surface diagnosis

**3a. Migration `02xx_alert_diagnosis.sql`** (apply via Management API per established procedure):
- `ers_prediction_alerts` + `diagnosis JSONB` (ranked hypotheses + evidence) and `failure_mode_code TEXT` (top hypothesis, for filtering/rollups). Alerts currently carry diagnosis only as free text in `description`.

**3b. Hook points**
- `PredictionService._runAlertScan` — inside the per-sensor breach block (~`:737–763`), build `DiagnosisEvidence`, run the rules engine, attach `diagnosis` to `createAlert`.
- `_runDigitalTwinSnapshot` — on health-index drops, same enrichment on the emitted alert.
- Spectral save path — already persists `features.diagnosis`; extend with named modes from Slice 1.

**3c. UI (calm-popup pattern)**
- Alert detail popup: **"Probable causes"** ranked list — mode label, confidence, evidence chips (sensor values, spectral finding, "documented in FMEA", "failed this way 3× since 2024"), recommended action.
- Alert rows on the Predict overview get a failure-mode chip.

**Deliverable:** diagnosis is stored, queryable, and visible. ~2 days.

---

## Slice 4 — Gemini narrates, doesn't infer

- `AIAnalysisEngine.draftWorkRequestFromAlert` context gains `diagnosis` (top 3 hypotheses + evidence). Prompt inverted: *select/refine from the provided ranked hypotheses and cite their evidence; do not invent codes*. `suggested_failure_mode`/`suggested_failure_cause` must come from the provided list when one exists. Deterministic fallback = top hypothesis verbatim (works with no API key).
- `AgentService.draftWorkOrderFromAlert` copies `diagnosis` into `draft_payload` so `AgentReviewPanel` shows *why* alongside the RPN.
- `generateBadActorRCASummary` consumes the same structure + `wo_failure_data` history.

**Deliverable:** LLM output is grounded and auditable; drafts explain themselves in review. ~1–2 days.

---

## Slice 5 — Learning loop (fast-follow)

- On WO completion, the confirmed `wo_failure_data.failure_mode_code` is compared to the alert's predicted top hypothesis → per-rule precision counters (companion table or `properties` on the rule id).
- Surface a "diagnostic accuracy" stat on the Predict overview; deterministic confidence adjustment mirroring the Bayesian threshold adapter (precision <0.70 → damp rule confidence, >0.90 → boost). No ML training.

**Deliverable:** diagnosis quality is measured and self-corrects. ~2 days, after slices 1–4 have field data.

---

## Sequencing, effort, non-goals

| Order | Slice | Effort | Depends on |
|---|---|---|---|
| 1 | Bearing fault engine | 2–3 d | — |
| 2 | Rules engine | 3–4 d | 1 (consumes named faults) |
| 3 | Persist + UI | 2 d | 2 |
| 4 | Gemini grounding | 1–2 d | 3 |
| 5 | Learning loop | 2 d | field data |

**Non-goals (deferred):** plant-wide causal/propagation graph (upstream cause suppresses downstream symptom alerts — revisit using `assets.parent_id` hierarchy once slices 1–4 are live); trained ML models (XGBoost/LSTM stubs stay stubs); autonomous parameter adjustment (HITL stays).

**Positioning:** closes the one axis UptimeAI leads on, using the explainable-evidence framing the Jul 2026 market research says the market rewards — and IRAMS keeps its edges (real censored-Weibull RUL, API 570 integrity, PSC engine, HITL governance).
