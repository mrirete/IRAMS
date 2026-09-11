# Process Test — Reliability Modelling (RBD · RAM · Weibull · Monte Carlo · Spares)

**Date:** 2026-09-10 · **Tenant:** origin project `hacrebcfvyqdnjvilhqc` (dev server on :5173) · **Asset under test:** K-601 Gas Compressor (17 WOs, 10 corrective; sub-assets K-601-DGS / RADBRG / AXBRG with 0 WOs)

**What was run**

1. Code audit of the modelling tier: `eam/utils/weibull.ts`, `eam/utils/monteCarloEngine.ts`, `eam/services/reliabilityMetrics.ts`, `eam/lib/systemAvailability.ts`, `ReliabilityToolkit.tsx` (inline χ²/MTTR/Poisson math), `ReliabilityBlockDiagram.tsx` / `ReliabilityModelingTab.tsx` (RBD engine), `ReliabilityModellingDivision.tsx` + `ReliabilityStudyRecords.tsx` (save / version / lifecycle), `CreatePMFromWeibullModal.tsx`, `AnalyzeService.ts`, migrations 0081 / 0102a / 0153 / 0154 / 0155 / 0204, live RLS on `ers_reliability_analyses` / `ers_reliability_studies` / `ers_rbd_models` / `ers_agent_actions` / `inventory_items`, and the `agent-run` tools `analyze_weibull` / `draft_pm_interval` / `analyze_pm_effectiveness` / `query_failure_history`.
2. Numeric harness (vitest, 15 checks, scratchpad `engine-audit.test.ts`): parameter recovery from seeded Weibull samples with and without censoring, Johnson ranks against the textbook example, MRL vs. Γ-mean, Poisson sizing vs. a log-space reference, Monte Carlo MTBF vs. mission time, k-of-n vs. series fall-through, engine edge cases.
3. Scripted three-role walkthrough (Playwright, `re1.mjs` / `tech1.mjs` / `req1.mjs`): **K.Syrus (RELIABILITY_ENG)** walks Weibull → Create PM → Send to RCM → Monte Carlo → RAM → Spares → Apply min level → Save study → approve; **J.tech (TECHNICIAN, reliability VIEW_ONLY)** and **requester01 (REQUESTER)** probe the same surfaces through the UI and through PostgREST.
4. Agent check: `weibull_analyst` and `specialist_supervisor` asked for K-601's Weibull.

Test data created by the run was removed afterwards (`cleanup.mjs`); see §5.

---

## 0. Closure status (2026-09-11)

| Finding | Status | Where |
|---|---|---|
| M-1 demo data → real PM | **CLOSED** (UX half 2583a76: no-history asset clears the box; RBAC half 0358 + role state) | ReliabilityToolkit.tsx, 0358 |
| M-2 dead agent tools | **CLOSED** 695c789 (`wo_failure_data!wo_id` ×3 + `failureRow()`), agent-run redeploy by the fixing session | agent-run/tools.ts |
| M-3 PM provenance contradiction | **CLOSED** 695c789 (basis follows the interval used; `origin.interval_hours` / `interval_recommended_hours` / `interval_edited`) | CreatePMFromWeibullModal.tsx |
| M-4 spares false success | **CLOSED** fccd311 (`.select()` + row check; no ghost ledger row) | ReliabilityToolkit.tsx |
| M-5 no page role state | **CLOSED** — `useReliabilityPerms()` hook; view-only banner; Save / New study / delete / govern / Create PM / Send to RCM / Apply min level gated | ReliabilityModellingDivision, ReliabilityToolkit, MonteCarloSimTab, ReliabilityStudyWorkspace |
| M-6 technician created a PM | **CLOSED** 0358 — `recurring_work` INSERT needs pm.create / pm.edit / admin | 0358 |
| M-7 role-blind RLS | **CLOSED** 0358 — `rel_can_view/rel_can_write/rel_study_can_edit/rel_study_can_approve`; per-verb policies on studies / analyses / rbd_models / pid_configurations (+ outcomes select); `TO authenticated` | 0358 |
| M-8 governance | **CLOSED** 0358 — `created_by_user_id` / `approved_by_user_id` / `revision`; insert forces `active`; approval = reliability.approve by someone other than the author, or admin (four-eyes); approver stamps trigger-set; approved study + its analyses frozen (PM link may still be stamped); reopen = approver/admin, bumps revision | 0358, StudyWorkspace |
| M-9 Poisson overflow | **CLOSED** 695c789 (`eam/utils/poissonSpares.ts` log-space + tests; `truncated` now surfaced as a warning) | poissonSpares.ts, SparesTab |
| M-10 MC ≠ Weibull tab | **CLOSED** — Monte Carlo spool passes `runningSuspensionHours()` (now exported from the engine and shared by the Weibull tab) | MonteCarloSimTab, reliabilityMetrics |
| M-11 MC engine | **CLOSED** — `mtbfSim` on mission time; `converged` = 95 % half-width of mean failures < 2 %; survival curve = empirical first-TTF sample; tests | monteCarloEngine.ts (+test) |
| M-12 RBD maths | **CLOSED** — `eam/lib/rbdEngine.ts` (exact heterogeneous k-of-n for R and A, cold standby R, standby A flagged as bound, system MTBF = ∫R dt with adaptive step, implied MTTR); all three former copies now call it; RBD→RAM bridge carries the topology MTBF; tests | rbdEngine.ts, ReliabilityBlockDiagram, ReliabilityModelingTab |
| M-13 RAM repair series | **CLOSED** — `failureRepairHoursWindowed()` (engine pool) in RAM, Availability, MTBF, RBD link | reliabilityMetrics, ReliabilityToolkit |
| M-14 Weibull → RCM attach | OPEN (design: attach evidence to the existing approved study) | — |
| M-15 trend test before Weibull | OPEN (method) | — |
| M-16 hours → calendar utilisation | OPEN (needs operating-context factor) | — |
| M-17 agent failure predicate | OPEN (read `sem_asset_reliability` in the tool) | — |
| M-18 Maintainability / Availability bases | **CLOSED** — Maintainability spools primaries via the engine; Availability zeroes MLDT when the downtime chain (MDT) is auto-filled | ReliabilityToolkit |
| M-19 ledger insert | **CLOSED** 0358 — `status='applied'` needs reliability / inventory / pm edit or admin; proposals stay open | 0358 |
| M-20 toolkit route | **CLOSED** — `/reliability-toolkit` gated on `reliability`; Sidebar map entry | App.tsx, Sidebar.tsx |
| M-21 PM link FK | **CLOSED** 0358 — `linked_pm_id` TEXT → FK `recurring_work(id)` ON DELETE SET NULL; dangling ids nulled | 0358 |
| M-22 requester reads analyses | **MITIGATED** 0358 — SELECT needs `reliability.view`; the role templates grant view to every role (product ruling: the Specialist is open to all), so a requester still reads analyses. Change the template if that is not wanted. | 0358 |
| M-23 downtime > window | **CLOSED** — per-event downtime capped at the window, operating time ≥ 1 h, `downtimeSuspect` flag | reliabilityMetrics |

**Follow-up found while re-testing (peer session, 0359 + 0360, commit 47e5b5b):** driving the storekeeper-shaped profile (SUPERVISOR = inventory.edit + reliability.view) after 0358 showed the min level moved and the ledger logged it, but `ers_reliability_study_outcomes` INSERT (0357, gated on reliability.edit) returned 403 and the client swallowed it — the study still said "no work produced yet". 0359: an outcome may be recorded by whoever may perform the work (inventory.edit → spares, pm.create/edit → pm, workOrders.create/edit → wo). 0360: an outcome must name a record that exists and that the caller can see (EXISTS under the caller's RLS); reference-less kinds (rcm, rca) stay with reliability editors — a technician can no longer invent "→ WO raised" to silence the pre-review warning. Re-verified SUPERVISOR 200/201/201, REQUESTER and TECHNICIAN 403 on all kinds. **Tip:** `role_permissions?select=role,module,action` says which existing login stands in for a role you have no account for.

Verified after 0358 (`verify2.mjs` / `verify3.mjs`, 2026-09-11): RE creates → status forced `active`, forged approver ignored; RE self-approve → `REL_APPROVE_DENIED`; bad `linked_pm_id` → FK 23503; technician: view-only banner, no Create PM / Save / Send to RCM, INSERT analysis 403, PATCH/DELETE study and analysis 0 rows, INSERT recurring_work 403, INSERT applied action 403, PATCH rbd 0 rows; requester INSERT study / rbd 403; admin approves → `approved_by_user_id` + email stamped; approved study frozen (`REL_STUDY_FROZEN` on analysis delete and rename); author reopen → `REL_REOPEN_DENIED`; admin reopen → revision 2; author workspace shows "Awaiting approval" instead of Approve, admin workspace approves. Engine tests: 51 passing (rbdEngine 10, monteCarloEngine 4, poissonSpares 8, weibull 9, reliabilityMetrics 17, reliabilityKpis 12).

---

## 1. Findings register

Severity: **P0** = wrong number reaches a maintenance decision or a security boundary is missing · **P1** = loophole a real user will hit · **P2** = gap / inconsistency · **P3** = hygiene.

| # | Sev | Area | Loophole | Evidence | Suggested fix |
|---|-----|------|----------|----------|---------------|
| M-1 | **P0** | Weibull tab · demo data | Selecting an asset with **no failure history** leaves the illustrative default dataset `20, 42, 55 … 139` in the box; the page shows "Fit basis: 8 failures", β=1.69, η=94 h, and arms **Create PM Program** and **Send to RCM Study**. No warning. | Run 1 picked K-601-DGS (0 WOs) and the engineer created **PM-30235, every 1 day** on a dry gas seal from placeholder numbers. Screenshot `re-01b-dgs-demo.png`. | Clear `dataStr`/`suspStr` when an asset yields no intervals and show "no failure history for this asset"; never seed a real PM from the sample set (disable Create PM / Send to RCM while `dataStr` equals the default or `asset` has 0 failures). |
| M-2 | **P0** | Agent tools | `analyze_weibull`, `analyze_pm_effectiveness` and `query_failure_history` embed `wo_failure_data(...)` **without the FK hint**. Since 0289 added `caused_by_wo_id` (a second FK to `work_orders`) PostgREST refuses the embed → all three tools throw, so `weibull_analyst`, `pm_optimizer` and the supervisor's Weibull path return "unable to analyse". | Agent answer: *"Could not embed because more than one relationship was found for 'work_orders' and 'wo_failure_data'"*. REST probe: `wo_failure_data(failure_mode_code)` → 300 PGRST201; `wo_failure_data!wo_id(...)` → 200. | `tools.ts:205,408,881` → `wo_failure_data!wo_id(...)` (the client's `FAILURE_QUERY_COLUMNS` already does this); redeploy `agent-run`; add a smoke test that runs each tier-1 tool. |
| M-3 | **P1** | Weibull → PM provenance | The PM interval written is **B10** (target-reliability age), but `origin.interval_basis` says `"75% of η"` / `"80% of η"` and the auto description says "Interval = N% of characteristic life". The PM detail's Origin chip and any audit read a basis that contradicts the number. | PM-42783: interval 20 Days (~480 h) = B10 469 h; origin `interval_basis: "75% of η"` (= 906 h). Same on PM-30235. | `CreatePMFromWeibullModal`: derive `pct`/basis from the interval actually used (`data.pmInterval` → "B10 life") and print it in the description. |
| M-4 | **P1** | Spares → Inventory | **False success.** "Apply min level" runs `inventory_items.update()`; for a role without `inventory.edit` (RELIABILITY_ENG is VIEW_ONLY) RLS filters the update to 0 rows, no error is raised, the UI toasts "Min level set to 16 ✓" and **still inserts** an `ers_agent_actions` row with `status='applied'` (ROI ledger / audit trail). | Toast "Min level set to 16 on 64379-Gasket ✓"; `min_level` unchanged (0); action row `fd06bacf…` status applied. | Check `data.length` (use `.select()`) before declaring success; write the action row only after a confirmed row; if the caller lacks `inventory.edit`, offer "Propose to storekeeper" (pending_review) instead of Apply. |
| M-5 | **P1** | Page role state | The modelling page has **no view-only state**. A technician (reliability VIEW_ONLY, pm VIEW_ONLY) sees Save / Create PM Program / Send to RCM / Apply min level; nothing in `ReliabilityModellingDivision` or `ReliabilityToolkit` reads `hasPermission`. | J.tech: Create PM ×2, Save ×2, Send to RCM ×1 rendered; `tech-01-weibull.png`. | Mirror RCMPage: `canEdit = hasPermission('reliability','edit')`, `canCreatePm = pm.create`, `canApplyStock = inventory.edit`; view-only banner + disabled actions. |
| M-6 | **P1** | PM creation (DB) | A technician **created PM-33872** from the Weibull tab. `recurring_work` INSERT is not RBAC-gated for this path (the modal calls `DatabaseService.createPM` directly). | `tech-02-pm-attempt.png`; row `01eda9d3…` created 15:12:37 by j.tech. | Gate `recurring_work` INSERT with `caller_can('pm','create')` (or route Weibull PMs through the existing PM-creation RPC); page gate per M-5. |
| M-7 | **P1** | RLS — role-blind | Live policies on `ers_reliability_analyses`, `ers_reliability_studies`, `ers_rbd_models` are `company_id = caller_company() AND true` for ALL verbs. Any tenant member can insert, rewrite, approve, rename and delete anyone's study or analysis. The studies policy is also bound to `public` (no `TO authenticated`). | Technician: INSERT analysis 201; PATCH RE's saved results β→0.01 + `linked_pm_id` → all-zero uuid 200; PATCH study `status=approved, approved_by="Chief Engineer (forged)"` 200; DELETE the RE's approved study 200 (1 row). Requester: INSERT study **directly in `approved`** 201; INSERT RBD model 201. | New migration in the 0332/0335 pattern: `rel_can_edit(study)` = admin \| reliability.edit \| creator; SELECT stays tenant-wide; INSERT/UPDATE/DELETE require it; delete = admin or creator; `TO authenticated`. |
| M-8 | **P1** | Study governance | Approval is one click by anyone incl. the author; `approved_by` is a **typed display string** (no user id), there is no reviewer, no notification, and **approved studies are not frozen** — member analyses can still be added, edited, deleted and the study itself deleted. Status can also be set straight to `approved` on insert. | RE approved own study in the modal; then `DELETE ers_reliability_analyses?id=…` under the approved study → 200, 1 row. Requester inserted `status='approved'`. | `approved_by_user_id`, `created_by_user_id`, guard trigger like `trg_rcm_study_approval_guard` (approve needs a reviewer ≠ author with reliability.approve; leaving approved bumps a revision; freeze analyses under approved), `notifyTeam` on review/approve. |
| M-9 | **P1** | Spares sizing math | `poissonSpares` computes the pmf as `λ^k·e^{-λ}/k!` in linear space; for λ ≳ 140 the term overflows to `Infinity`/`NaN`, the loop exits early and the recommendation is **far too low**. Plausible inputs (population 100, MTBF 1000 h, resupply 2160 h → λ=216). | Harness: page formula → **133** spares, correct 95 % quantile → **240**. | Accumulate in log space (or use `jStat.poisson.cdf`); cap and warn when λ is large enough that a normal approximation is more appropriate. |
| M-10 | **P2** | Weibull ↔ Monte Carlo | Monte Carlo spools the same asset but fits **failures only** (`fitWeibullFromTTFs(ttfs)` passes no suspension), so the two tools disagree on identical data; the MC→PM modal then carries the different β/η into `origin`. The Weibull→MC bridge state is also lost on the URL-driven tool switch, so the "auto-bridge" never survives navigation. | K-601: Weibull tab β=2.38 η=1208 h (9 failures + 1 suspension); Monte Carlo β=2.55 η=1108 h. `re-06-mc-results.png`. | Pass `runningSuspensionHours` into `fitWeibullFromTTFs`; persist bridge data in the URL/state so `?tool=montecarlo` receives it. |
| M-11 | **P2** | Monte Carlo engine | (a) `mtbfSim` divides by `runs × 8760` regardless of `missionTime`; (b) `converged` is `CV(Ao) < 2 %` — Ao is ~97–99 % so CV is always tiny and every run reports "Converged"; (c) the "simulated" survival curve is `fraction of runs with missionTime/failures > t`, not an empirical survival function. | Harness: mission 17 520 h → mtbfSim 445 h vs. theoretical mean 886 h (8760 h mission → 923 h). Survival at t≈1000: simulated 31.4 vs theoretical 36.8. | Use `missionTime` in the uptime basis; converge on the standard error of the mean (or of failures/cost); pool the actual TTF draws for the Kaplan-Meier curve. |
| M-12 | **P2** | RBD engine | `systemMetrics.groupAo` in `ReliabilityModelingTab` has **no k-of-n branch** (falls through to the series product) and treats **standby as active parallel**; `ReliabilityBlockDiagram.groupReliability` uses an *average* R for k-of-n and an *average* λ for standby; `systemMetrics.mtbf/mttr` are the plain **averages of the block values** and that "system MTBF" is what the RBD→RAM bridge sends (`failures = 8760/avgMtbf`). `topoMTBF` integrates R(t) with dt = 400 h (coarse for short-life blocks). | Harness: 2oo3 at A=0.95 → exact 0.99275, fall-through 0.857. Code: `ReliabilityModelingTab.tsx:675-699`, `ReliabilityBlockDiagram.tsx:630-664, 684-695`. | Reuse `systemAvailability.kOfNAvailability` (exact heterogeneous DP already in the repo) for Ao; cold-standby Ao via Markov or MC; send `topoMTBF` (∫R) and a duty-weighted MTTR to RAM; adaptive integration step. |
| M-13 | **P2** | RAM ↔ Metrics reconciliation | RAM's MTBF reconciles with `sem_asset_reliability` (2131 vs 2132 h) but its **repair-time series is lifetime** (`failureRepairHours`, 8 points → MTTR 58.7 h) while the engine's MTTR/MDT is **window-based** (32 h, 4 failures). Ao on the RAM tab (97.32 %) therefore differs from Metrics Ai/Ao (98.5 / 97.8 %) for the same asset, contradicting the "same engine" note in the code. | `re-07-ram.png`; `sem_asset_reliability` row for K-601. | Window the repair series like the engine (or label "lifetime repair basis"); show the SMRP basis flag on the RAM cards. |
| M-14 | **P2** | Weibull → RCM | "Send to RCM Study" always opens a **new** study form, even when the asset already has an approved RCM study (K-601 has one at rev 10). The evidence is only prose in `operating_context`; there is no "attach this fit as evidence to the existing study / revise it" path. | `re-05-rcm-seeded.png`: new-study form with the Weibull sentence; existing approved study untouched. | If `ers_rcm_studies` has a study for the asset, offer "Attach evidence → revise" (creates an evidence flag / bumps revision) instead of a new draft. |
| M-15 | **P2** | Method | Inter-arrival times of a **repairable** asset are fitted as i.i.d. life data with no trend test (Laplace / Crow-AMSAA). If the asset is deteriorating or improving, the renewal assumption is wrong and β is misread; the B10 → PM step inherits it. | `failureIntervalsHours` → `fitWeibull` with no trend check. | Run a Laplace trend test on the event times first; if trend is significant, show "process is not renewal — use Crow-AMSAA / NHPP" and withhold the PM recommendation. |
| M-16 | **P2** | Hours → calendar | B10 in operating hours is converted to a calendar cadence by `/24` (24 h/day). `assets.operating_context.mode` (continuous / intermittent) is not consulted, so an intermittent asset gets a PM at roughly the wrong multiple. | `CreatePMFromWeibullModal` `intervalValue = round(pmHrs/24)`. | Apply a utilisation factor from the operating context (or run-hour meter) when converting; show both. |
| M-17 | **P2** | Agent failure predicate | Server tools classify failures as `type === 'CM' OR any wo_failure_data row` — ignores `breakdown`, counts PMs that carry a failure code, includes secondary failures, uses `created_at` (not `malfunction_start`) and drops same-day events; the client engine (`isFailure`) does the opposite on each point. Even once M-2 is fixed the agent's β/η will not match the UI. | `tools.ts:891` vs `reliabilityMetrics.ts:137`. | Read `sem_asset_reliability` / `sem_work_history` (the canonical predicate lives in SQL since 0295) instead of re-deriving in the edge function. |
| M-18 | **P2** | Maintainability / Availability tabs | Maintainability auto-populate reads **all** WOs (PM included) and takes `actual_downtime_hrs || actual_duration_hrs`; Availability's "MTTR" is the engine's downtime (MDT) series and MLDT is then **added again**. Neither shows the SMRP basis flag. | `ReliabilityToolkit.tsx:1517-1530, 776-784`. | Use `failureRepairHours` (primaries) and label MDT vs MTTR per the 0307 basis. |
| M-19 | **P2** | Provenance ledger | `ers_agent_actions` INSERT has no role check while UPDATE requires `reliability.edit`; a technician inserted a `spares_optimizer` row with `status='applied'`. Combined with M-4, the ROI statement can count stocking decisions that never happened. | Technician INSERT 201 (`ad5fc29a…`). | INSERT needs `reliability.edit` (or the applier RPC writes it); `applied` rows should be written by the RPC that performs the apply. |
| M-20 | **P2** | Toolkit route | `/reliability-toolkit` (a second copy of the calculators incl. Apply min level and Create PM) is gated on `analytics`, not `reliability`, and is absent from the Sidebar RBAC path map. PLANNER / STOREKEEPER (analytics VIEW_ONLY) reach it; technicians are blocked only because analytics is NO_ACCESS for them. | `App.tsx:220`; `Sidebar.tsx:41-46`. | Gate on `reliability` (or retire the route — the Division already mounts the same tabs). |
| M-21 | **P3** | Data model | `linked_pm_id` is a UUID with **no FK** to `recurring_work` (whose id is TEXT — RCM PMs `RCM-…` could never be linked); `created_by` / `approved_by` are display strings; no audit rows on study/analysis changes; the technician set `linked_pm_id` to an all-zero uuid and the card renders it as a live link. | 0154 comment "soft link"; tech PATCH 200. | Text FK to `recurring_work(id)` ON DELETE SET NULL; `*_user_id` columns; audit trigger like `rca_audit_row`. |
| M-22 | **P3** | Read exposure | A requester (no work-order access: `work_orders` → 0 rows) can read every saved analysis and its `results`/`inputs` (5 rows), i.e. failure data they cannot see at source. | `req1.mjs`: analyses 200 / 5 rows, WOs 200 / 0 rows. | SELECT policy = `caller_can('reliability','view')` at minimum; consider mirroring WO visibility. |
| M-23 | **P3** | Engine edge | A single failure whose recorded downtime exceeds the window (e.g. 9 000 h in 8 760 h) drives operating time to 0 → MTBF 0, Ai 0 %; no clamp/flag. | Harness "downtime > window" → mtbfDays 0. | Cap per-event downtime at the window and flag the record as suspect. |

**Retracted during the run:** "RCM page did not show the Weibull evidence" (run 1 read `innerText`; the evidence is in the textarea value and is present). "RBD Generate from hierarchy missing" (it lives inside a study; the launcher shows the study list).

**Confirmed sound:** `fitWeibull` recovers β/η from complete (β 1.99 / η 1020 for 2 / 1000) and 53 %-censored samples (1.95 / 1095 vs. naive 2.31 / 618), Johnson ranks match the textbook example (1, 2.167, 3.333, 4.5, 6.25), MRL(0) = ηΓ(1+1/β), χ² MTBF bounds use the time-terminated form correctly, RAM MTBF reconciles with `sem_asset_reliability`, Weibull → PM writes `origin` and auto-saves a linked analysis, Send to RCM seeds the operating context, tenancy isolation holds (all four tables tenant-scoped), inventory RLS refused the technician's `min_level` change.

---

## 2. Engine audit summary

| Engine | Method | Verdict |
|---|---|---|
| `weibull.ts` | Median-rank regression (Benard) on Johnson adjusted ranks, right censoring, Student-t/delta-method bounds (labelled approximate) | Sound. MLE not offered (fine for n<20); bounds are regression bounds, honestly labelled. |
| `reliabilityMetrics.ts` | SMRP 7th ed. operating-time MTBF / MTTR-vs-MDT / MTBM / MTTF / Ai / Ao | Sound; M-23 edge. RAM's repair series is not windowed (M-13). |
| Toolkit inline: `computeMTBFWithConfidence`, `computeMTTR`, `poissonSpares` | χ² time-terminated; exponential Mmax; Poisson quantile | χ² correct; Mmax is the exponential approximation (labelled); **Poisson overflows (M-9)**. |
| `monteCarloEngine.ts` | Inverse-CDF Weibull TTF, lognormal TTR, PM-vs-RTF event loop | Loop is fine; **mtbfSim / converged / survival curve wrong (M-11)**; no seed → non-reproducible runs. |
| RBD (`ReliabilityBlockDiagram` + `ReliabilityModelingTab`) | Series / parallel exact; k-of-n and standby approximated; ∫R(t) MTBF | **k-of-n Ao missing, standby = parallel, "system MTBF" = average (M-12)**. `systemAvailability.ts` has the exact k-of-n DP but is only used by Reports › SystemView. |
| Agent `fitWeibullServer` | Mirror of the client fitter | Fitter correct; **tool dead (M-2)**, predicate diverges (M-17). |

---

## 3. Role matrix observed

| Surface / action | RELIABILITY_ENG | TECHNICIAN (reliability VIEW_ONLY) | REQUESTER |
|---|---|---|---|
| Open `/reliability-modelling` | yes | yes | yes |
| Create PM from Weibull (UI → DB) | yes | **yes (PM-33872)** | not tried |
| Apply min level (inventory) | **toast success, 0 rows** | UI offered; REST 0 rows | — |
| Save analysis / study | yes | **yes (REST)** | **yes, directly approved (REST)** |
| Approve study | **own study, 1 click** | **yes (REST, forged approver)** | — |
| Edit / delete others' analyses or studies | yes | **yes** | — |
| Edit RBD models | yes | **yes** | **insert yes** |
| Read saved analyses | yes | yes | **yes (cannot read WOs)** |
| `/reliability-toolkit` | yes | blocked (analytics) | blocked |

---

## 4. Suggested fix order

1. **M-2** (three dead agent tools) — one-line embed fix ×3 + redeploy; add a tool smoke test.
2. **M-1 + M-3 + M-4** — the three ways a wrong number reaches a maintenance record from this page.
3. **M-7 + M-8 + M-6 + M-5** — one migration (team/role functions + guard trigger, RCM 0335 pattern) + page role state.
4. **M-9, M-10, M-11, M-12, M-13** — engine corrections, each with a regression test (the scratchpad harness is a starting point).
5. M-14 … M-23.

---

## 5. Fixtures and clean-up

Created by the run and **removed** by `cleanup.mjs` (admin session): PM-30235 (K-601-DGS, demo data), PM-42783 (K-601), PM-33872 (technician), auto-saved analyses `c4ee971f…`, `3cac5d85…` (rewritten by the technician), `4b593339…` and `b80f59bd…` (technician), `9bab1ab1…` (deleted during the freeze probe), studies "AUDIT study K-601" (deleted by the technician during the run) and "AUDIT requester-created study", RBD model "AUDIT requester RBD", two `spares_optimizer` action rows. Restored: "Demo — Gas Compression Train" `system_availability` (technician had set 0.01). `inventory_items` 64379-Gasket was never changed (RLS). The pre-existing 20000005 lifecycle-test study and its two analyses were not touched.

Scripts: scratchpad `lib.mjs`, `re1.mjs`, `tech1.mjs`, `req1.mjs`, `agent1.mjs`, `cleanup.mjs`, `engine-audit.test.ts`; screenshots `re-*.png`, `tech-*.png`, `req-*.png`.

Related registers: `docs/Process-Test-RCM-Team.md`, `docs/Process-Test-RCA-Team.md` (same loophole classes — role-blind RLS, display-name approvals, no freeze — closed there by 0332–0337).
