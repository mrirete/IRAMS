# Process test — Nested PM intervals (0366)

Purpose: prove that a shorter-interval preventive task nested within a
longer-interval task on the same asset is satisfied by the longer order when
both fall due together — no duplicate order, no duplicated steps in
*Supersedes* mode, tagged steps in *Combines* mode, correct roll-forward,
correct PM compliance, and a documented trail on the order.

Grounding (vendor-neutral): RCM task packaging (IEC 60300-3-11 / SAE
JA1012), ISO 14224 maintenance-record content (activity + interval
satisfied), ISO 55001 §7.5 documented information, SMRP PM-compliance metric.

## Fixture

One asset (e.g. `K-602`). Two calendar schedules, same asset, Autopilot on:

| Code | Interval | Lead time | Plan |
|---|---|---|---|
| PM-3M | 3 Months | 7 days | Inspect bearings; Check leaks |
| PM-6M | 6 Months | 14 days | Inspect bearings; Check leaks; Change oil (superset) |

Set both **First due** to the same date (today works). Open PM-3M → *Nested
within (longer-interval task)* → pick PM-6M → mode **Supersedes** → Save.

## Steps and expected results

| # | Action | Expected |
|---|---|---|
| 1 | Recurring Work list | PM-3M shows chip `nested in PM-6M` and Autopilot chip `Waiting — satisfied by PM-6M`; PM-6M shows `nests 1`. |
| 2 | Generator → Run for today | Both appear. PM-3M row status **Nested**, reason *"Nested within PM-6M (due …) — satisfied by that order"*. |
| 3 | Create (both ticked) | **One** order (PM-6M's). Result text: *"1 nested occurrence satisfied by a longer-interval order — PM-3M satisfied by WO-…"*. |
| 4 | Open the order | Title ends *(also satisfies PM-3M · 3 Months)*. Steps = PM-6M's three only — **no** duplicated "Inspect bearings". Assigned to PM-6M's lead labour contact. |
| 5 | Order record | `properties.included_scopes` = `[{pmId, code: PM-3M, cadence: 3 Months, dueDate, mode: SUPERSEDES}]`, `included_pm_ids` = `[PM-3M id]`. |
| 6 | Recurring Work | PM-3M next due = +3 months; PM-6M next due = +6 months. PM-3M History tab shows *"Occurrence satisfied by a longer-interval order — WO-… (supersedes)"*. |
| 7 | Complete the order (TECO) as the technician | PM-3M History shows *"Nested occurrence completed — on time"*. Both schedules now armed (Autopilot chips no longer say *arms after 1st*). |
| 8 | Dashboard → PM compliance for the month | Due **2**, on time **2** (the 3M occurrence counts at its own due date). |
| 9 | Switch PM-3M to **Combines**, set PM-3M's plan to a distinct step ("Grease coupling"), align both due dates again, Generator → Create | One order; steps = PM-6M's three + `[PM-3M · 3 Months] Grease coupling` numbered after them; parts likewise tagged. |
| 10 | Change PM-3M to 4 Months | Amber note under the picker: *"Intervals are not harmonic …"* — on non-coincident dates PM-3M raises its own order. |
| 11 | Daily sweep (`cron.job_run_details`, next 04:20 UTC) | Rows for the pair read *"waiting: nested within …"* / *"generated … also satisfies …"* / *"satisfied by …"* — never two orders for one date. |

## Negative checks

- The picker only offers same-asset, longer-interval, time-based schedules; a
  schedule that already nests this one is excluded (no cycles).
- With PM-6M **paused**, PM-3M raises its own order (a paused task cannot
  satisfy anything).
- With PM-6M's previous order still open on the coincident date, PM-3M keeps
  waiting (reason visible); when PM-6M's order is completed and the next is
  raised as a catch-up, it still records and rolls PM-3M.

## Known limits (deliberate)

- One nesting level (no grandparent merging).
- Month/year intervals are approximated at 30/365 days for the harmonic check
  and the lead-time clamp only; due dates themselves are calendar-exact.
- The manual Generator processes longer-interval tasks first; if only the
  nested task is ticked it is refused with the nested reason, not raised.
