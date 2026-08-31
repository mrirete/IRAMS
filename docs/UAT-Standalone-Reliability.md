# UAT — Standalone Reliability Tier & CMMS Integration

**Scope:** the gap-closure shipped 2026-08-29 (commit `dbe86b9`, migration 0298, edge
functions `ingest-work-orders` + `ingest-readings`) plus the two demo flows in
"How IREAMS Works" (Scripts A and B). Run against **irams.vercel.app** with a
non-production tenant or rollback-able batches — every import/sync test below is
designed to be undone.

**Tester prerequisites:** an admin login; one collector API key
(`node scripts/provision/mint-collector-key.mjs --name "UAT"` — revoke after);
the SAP work-order-history template filled with ~50 rows spanning 2+ years,
including some `PM03` rows, some breakdown flags, and a few type codes IREAMS
won't recognise (e.g. `ZM01`).

Mark each case **Pass / Fail** and note the evidence (screenshot or response JSON).

---

## A. Import honesty (Import Wizard)

| # | Do | Expect | P/F |
|---|----|--------|-----|
| A1 | Import the history file through the wizard; review the mapping proposal before confirming | AI-proposed mapping is editable; nothing is written before you confirm | |
| A2 | Check the data-quality report | It grades cost coverage, failure-coding coverage, breakdown coverage, and **lists the unrecognised type codes by name** (e.g. `ZM01`) with a note that they are kept as-is and not counted as failures | |
| A3 | After commit, open a `PM02` row's work order | Its type is **PM** (preventive), not CM — and a `PM01` row is CM | |
| A4 | Open a `PM03` or `ZM01` row's work order | Type kept **verbatim** (plant-configured / unknown codes are never silently rebranded CM); the DQ report listed them for value-mapping | |
| A5 | Open the asset Metrics scoreboard for an asset whose rows carried breakdown flags | Failure count matches the number of breakdown-true rows, not the raw corrective count | |
| A6 | A row that had a failure *cause* but no failure *mode* | Failure coding shows the cause; mode is blank — **no "UNKNOWN" placeholder anywhere** | |
| A7 | Roll the batch back from the Migration Center | All imported WOs and batch-created assets disappear; metrics return to the prior state | |
| A8 | Include cost cells in mixed formats — `€1.234,56`, `$2,000`, `(500)`, `1 250.75` | All parse to the correct numbers (check `total_actual_cost` on the imported WOs); unparseable cells are reported as issues, not silently zeroed | |
| A9 | After commit, open Reports → bad actors / asset spend for an imported asset | Money figures equal the file's frozen order totals (labor + material, or the combined total) | |
| A10 | Log in as a RELIABILITY_ENG account: run a work-order history import through the wizard; then attempt to roll the batch back | Import commits (0303 — REs hold history-refresh rights); rollback is refused — batch deletion stays admin-only, the governance line | |

## B. Sync API (`ingest-work-orders`)

Use `curl`/Postman with the UAT collector key (examples in `docs/CMMS-Sync-API.md`).

| # | Do | Expect | P/F |
|---|----|--------|-----|
| B1 | POST one WO referencing a nonexistent asset tag | HTTP 422, `unknownAssets` names the tag, nothing created | |
| B2 | POST one breakdown WO (TECO, costs, malfunction window, failure cause) on a real asset | 200 with `created:1`; WO visible in-app with frozen costs intact and correct dates | |
| B3 | Re-POST the same WO with status CLOSED | 200 with `updated:1`, **not** a duplicate; costs still the synced values (not zeroed) | |
| B4 | POST a WO whose `wo_number` matches a **native** in-app work order | Listed under `conflicts`; the native record untouched | |
| B5 | Open Admin › Migration Center batches | Each API call appears as a batch (`api:<key name>`); rollback of a sync batch removes its rows | |
| B6 | Check the synced failure event in the Reliability Toolkit | The asset's Weibull auto-populate includes the synced event | |

## C. Old-history visibility (the 12-month blind spot)

| # | Do | Expect | P/F |
|---|----|--------|-----|
| C1 | Pick an asset whose imported failures are all **older than 12 months**; open Weibull, RAM, Spares, MTBF tabs | All auto-populate from lifetime history (no empty calculators) | |
| C2 | Reliability Toolkit critical-asset shortlist | Assets with only old imported history appear, ranked by failure count | |
| C3 | Fleet PM optimization (Specialist) | Programmes on assets with imported `CORRECTIVE`/`EM`-typed history get verdicts (not "no failures ever") | |
| C4 | Monte Carlo tab → select an asset with history | EAM Data Spool reports failures/repairs and fits β, η (this was silently empty before) | |

## D. Sensor → condition bridge (`ingest-readings`)

| # | Do | Expect | P/F |
|---|----|--------|-----|
| D1 | On a test asset, create a reading definition and set its `sensor_tag` to match a pushed series tag (or name the definition's type code identically) | — | |
| D2 | POST a reading above the definition's critical threshold via `ingest-readings` | Response shows `mirroredToConditionLogs: 1`; a reading log appears on the asset flagged as alarm, entered by `collector:<name>` | |
| D3 | POST again within 15 minutes | No second reading log (throttle); sensor series still updates | |

## E. Demo dry-runs (Scripts A & B from "How IREAMS Works")

| # | Do | Expect | P/F |
|---|----|--------|-----|
| E1 | Run Script A end to end (breakdown WO → metrics → Weibull → create PM → fleet optimization → proposal queue) | Every step lands on the first click, on mobile width for the field steps | |
| E2 | Run Script B end to end (Migration Center → wizard import → toolkit on their bad actor → approve + write-back package) | Write-back export is in the source system's column vocabulary | |

---

**Exit criteria:** all A–D pass; E passes smoothly enough to demo live.
**Cleanup:** roll back every UAT batch, revoke the UAT collector key, delete the
test reading definition.
