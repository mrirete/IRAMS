# Systems Thinking for Equipment Failures — Implementation Plan

**Status:** Draft for review · **Audience:** product + engineering
**Goal:** help every user — technician to plant manager — see failures as *system events*, not isolated asset events, using data the platform already captures.
**Design constraint:** no new module, no new mental model to learn. One new idea is introduced to end users — **"a failure can be caused by another failure"** — and everything else is views on existing screens.

---

## 0. The concept, in end-user language

The reliability literature calls this primary/secondary failures (ISO 14224), cascade analysis, reliability block diagrams, common-cause initiators. **Users never see those words.** They see four plain things, each on a screen they already use:

| Users see | Where | The concept underneath |
|---|---|---|
| **"What else happened around this time?"** | WO Analysis tab, RCA | Temporal event correlation |
| **"Was this caused by another failure?"** (one question, one picker) | Failure coding / Complete | ISO 14224 secondary failure + caused-by link |
| **"Trouble Makers"** — what causes damage beyond itself | Reports / Dashboard | Cascade-initiator Pareto |
| **"System View"** — is the function healthy, what's the weakest link, is the backup ready? | Asset/System pages | Dependency model + availability math (RBD) |

The single behavioral lever: the closeout question. Asked of every technician at every corrective closeout, it trains systems thinking *in the workflow* — no course, no glossary.

---

## 1. Why this is cheap for us and hard for competitors

Two ingredients most CMMSs lack, already shipped here:

1. **True failure event times** — `malfunction_start` (0283), not paperwork dates → honest "what happened around this time".
2. **Plant topology** — the P&ID connectivity graph with deterministic traversal → "what is upstream of this".

Plus the supporting cast: coded failure taxonomy L6→L9 (0285–0288), `sem_failure_events` / `sem_asset_reliability` canonical views, the RCA evidence ladder (0217), Weibull/study loop, level-aware hierarchy.

---

## 2. Phases

### Phase 1 — "Around this failure" + the closeout question  *(days · highest value/effort ratio)*

**Migration (1 file):** `wo_failure_data` gains
- `secondary_failure boolean` — NULL = not asked (legacy), false = primary, true = collateral
- `caused_by_wo_id uuid REFERENCES work_orders(id) ON DELETE SET NULL`

**UI:**
- **"Around this failure" panel** (WO Analysis tab, corrective only): failure events plant-wide within ±24h of this WO's event time, sorted by time gap. Each row: asset, event, gap ("40 min before"), one-click open. Empty state: "No other failures in the window."
- **The question**, in the same panel and in the Complete modal: *"Was this caused by another failure?"* → picker defaults to the panel's candidates (search-all fallback). Selecting sets `secondary_failure + caused_by_wo_id` and writes a system journal on **both** WOs ("Marked as collateral of WO-X" / "Caused collateral damage: WO-Y").
- **Cause/effect chips** on the WO header area: `⚡ Collateral of WO-X` / `⚡ Caused: WO-Y, WO-Z` (both directions clickable — same pattern as the follow-up chain).

**Engine (honesty rule):** `isFailure`/`computeAssetReliability` gain an option to exclude secondary failures from the *victim's* MTBF/Weibull sample; asset cards show `4 failures (1 collateral)` — never silently dropping events. `FAILURE_QUERY_COLUMNS` extends with the two fields.

**Value proof:** % of corrective closeouts answering the question; count of documented cascades in month 1.

### Phase 2 — Trouble Makers + system rollup  *(days)*

- **Trouble Makers** (Reports → Asset Health): group cascades by initiator: own downtime/cost **plus** collateral downtime/cost across victims. "Cooling water pump: 1 failure → 3 collateral events, 41h total downtime, $84k." This is a truer bad-actor list than per-asset counts; render beside the existing Pareto, labeled plainly.
- **System rollup**: failures/downtime/cost aggregated to *system-level* hierarchy nodes (the level-aware hierarchy + subunit coding make this a view): the manager's Pareto reads "Lube-oil system — Unit 1100," not five asset rows hiding one systemic problem.

### Phase 3 — System View (the RBD rebuilt as data)  *(≈1 week)*

**Schema:** `system_functions` (name, description, hierarchy node) + `system_function_members` (asset_id, group_no, k_of_n) — series groups of parallel sets; covers ~90% of real plant redundancy ("2×100% pumps", "2oo3 transmitters") without an RBD editor.

**Math:** block availabilities from `sem_asset_reliability` (live, not typed in); series/parallel/k-oo-n composition; **importance ranking** = which member's improvement buys the most system availability.

**End-user framing — plain words only:**
- System card: traffic light + *"Weakest link: P-101 — improving its MTBF gains the most."*
- Redundancy: *"Backup coverage: standby pump available / ⚠ backup is down — single point of failure right now."* (live status from open WOs on members — this line alone justifies the phase for operations.)
- The Modelling division's RBD tool **auto-seeds** from this model with live rates; hand-drawn mode remains for what-if. Honesty label: rankings are trustworthy, absolute % is an approximation (same rule as OEE estimates).

### Phase 4 — Topology + model learning  *(after P&ID coverage check)*

- Rank Phase-1 candidates by P&ID graph distance/direction: upstream = cause candidate, downstream = fellow victim; utility systems flagged as common-cause suspects.
- **The plant teaches the diagram:** documented cascades that cross "independent" paths in the system model ⇒ "possible hidden dependency" prompt (usually a shared utility).
- RCA copilot ingests Phase-1/4 candidates as *graded evidence* (0217 ladder): machine-gathered, human-confirmed.

---

## 3. Simplicity rules (binding)

1. **One new concept** for users: failures can cause failures. Everything else is a view.
2. **No new nav item** until Phase 3's System View earns one; Phases 1–2 live inside existing screens.
3. **Plain names in UI** — "Trouble Makers", "Weakest link", "Backup coverage", "Around this failure". Standard terms (secondary failure, RBD, k-oo-n) live in tooltips/docs only.
4. **Never silently change a number.** Excluding collateral from MTBF is always labeled ("4 failures, 1 collateral").
5. **The system proposes, the person confirms.** No auto-linked causes; candidates only.

## 4. Sequence & dependencies

| Phase | Depends on | New tables/cols | Effort |
|---|---|---|---|
| 1 | shipped (0283+) | 2 cols | days |
| 2 | Phase 1 | none (views) | days |
| 3 | none (parallel-ok) | 2 tables | ~1 week |
| 4 | P&ID coverage; Phases 1+3 | none | ~1 week |

Recommended order: **1 → 2 → 3 → 4.** Phase 1 changes behavior and fixes MTBF integrity; 2 makes it visible to managers; 3 makes systems computable; 4 makes the model self-correcting.

## 5. Value evidence (checked one cycle after each phase)

- P1: closeout-question answer rate ≥60%; ≥1 documented cascade; victim-asset MTBF corrections visible.
- P2: Trouble-Makers list diverges from the plain bad-actor list (proof it adds signal).
- P3: ≥1 planning decision citing a weakest-link/backup-coverage readout.
- P4: ≥1 hidden dependency surfaced from cascade-vs-model divergence.
