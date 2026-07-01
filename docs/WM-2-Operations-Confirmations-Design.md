# WM-2 — Operations, Work Centers & Confirmations (Design & Scope)

**Status:** Draft for build · **Wave:** 2 (order-to-cost spine) · **SAP mapping:** PM operations + CR work centers + IW41/CO11 time confirmations
**Effort:** L (multi-week) · **Depends on / feeds:** FI-1 (actual-cost roll-up & settlement) consumes the confirmations this delivers.

---

## 1. Why this is the spine

WM-2 is the load-bearing member of the order-to-cost backbone. Everything downstream (FI-1 settlement, planned-vs-actual labour cost, capacity/scheduling accuracy) depends on **actual work being confirmed against a numbered operation on a costed work center**. Today labour is posted against the *order*, not the *operation*, and there is no work-center rate — so actual labour cost can't be attributed, planned-vs-actual is coarse, and capacity is informal.

```
Order ─▶ Operation 0010 (Work Center MECH-01, plan 4h)
             ├─ Confirmation #1  2h  (partial)  ─┐
             └─ Confirmation #2  2.5h (final)   ─┴▶ actual 4.5h × WC rate ▶ actual labour cost ▶ settlement (FI-1)
```

## 2. Current state (field-level)

| SAP concept | Today | Table |
|---|---|---|
| Operation | `job_tasks` row — `sequence`, `est_hours`, `actual_hours`, `status`, `predecessor_task_id`, assignments | `job_tasks` (0023) |
| Time confirmation | `work_order_labor` — `hours_worked`, `rate_per_hour`, `date_worked`, `headcount`, `is_lead`, `cost_center_id`; **not linked to an operation**, no partial/final flag | `work_order_labor` |
| Work center | — none — | — |
| Operation number | `sequence` (1,2,3…), not 0010/0020 | — |
| Control key (internal/external) | — none (WorkOrderType is order-level only) | — |

**Gap:** no work-center master, no operation numbering, no operation↔confirmation link, no partial/final confirmation, no work-center capacity or rate → no actual labour attribution.

## 3. Data model deltas

### 3.1 New: `work_centers` master (CR01 equivalent)
```
work_centers
  id            uuid pk
  code          text unique      -- e.g. MECH-01, ELEC-01, I&C-01
  name          text
  site_id       uuid  fk sites            -- capacity belongs to a site
  cost_center_id uuid fk cost_centers     -- default settlement receiver (feeds FI-1)
  activity_rate numeric            -- planned cost/hour when operation has no explicit rate
  capacity_hours_per_day numeric   -- available capacity (scheduling / MRS)
  active        boolean default true
```
Admin CRUD screen (mirror HierarchyConfig / Dictionaries pattern). Low drift risk — new page + new table.

### 3.2 Extend: `job_tasks` → operations (additive columns)
```
ALTER TABLE job_tasks ADD COLUMN operation_no    text;      -- '0010' (display = sequence*10, stored for stability)
ALTER TABLE job_tasks ADD COLUMN work_center_id  uuid REFERENCES work_centers(id);
ALTER TABLE job_tasks ADD COLUMN control_key     text DEFAULT 'PM01';  -- PM01 internal labour, PM02 external/service
ALTER TABLE job_tasks ADD COLUMN planned_rate    numeric;   -- overrides work-center activity_rate
```
`operation_no` derived `sequence*10`, zero-padded to 4, on write; kept editable later.

### 3.3 Extend: `work_order_labor` → operation-linked confirmations
```
ALTER TABLE work_order_labor ADD COLUMN operation_id     uuid REFERENCES job_tasks(id);
ALTER TABLE work_order_labor ADD COLUMN is_final         boolean DEFAULT false;  -- final confirmation closes the operation
ALTER TABLE work_order_labor ADD COLUMN confirmation_no  integer;                -- 1,2,3 per operation
ALTER TABLE work_order_labor ADD COLUMN remaining_hours  numeric;                -- optional forecast-to-complete
```
A confirmation posts hours against an operation; the **final** flag rolls the summed hours into `job_tasks.actual_hours` and sets the operation `status = COMPLETED`. Actual labour cost per operation = Σ(hours × rate), rate = `planned_rate` ?? work-center `activity_rate` ?? `rate_per_hour`.

No destructive changes — all additive/nullable, so existing WOs/labour keep working (each labour row simply has a null `operation_id` = order-level, as today).

## 4. Build phases

| Phase | Scope | Files | Drift risk | Deliverable |
|---|---|---|---|---|
| **WM-2a** | `work_centers` table + admin CRUD screen + service (get/save/delete) | new migration, new `WorkCentersPage`, `DatabaseService`, `constants`/registry | **Low** (new files) | Costed, capacity-bearing work-center master — standalone |
| **WM-2b** | Operations layer: `operation_no`, `work_center_id`, `control_key` on tasks; task editor shows op number + work-center picker; roll-up helpers | migration, `DatabaseService` (task read/write), `types`, **WO task editor UI** | **High** (WorkOrders.tsx under concurrent edit) | Numbered operations on costed work centers |
| **WM-2c** | Confirmations: operation-linked partial/final time posting; actual roll-up to operation + WO; feeds FI-1 | migration, `DatabaseService` (labour/confirmation write + roll-up), **confirmation UI** | **High** (WorkOrders.tsx) | Partial/final confirmations → actual labour cost by operation |

**Sequencing:** build **WM-2a now** (isolated, no drift). Land WM-2b/WM-2c after the concurrent WorkOrders/ServiceRequests edits settle — the schema/migration + service layer for both can be prepared ahead of the UI so the drift-file touch is minimal and last.

## 5. Cost roll-up contract (the FI-1 handoff)

WM-2 must expose a stable per-operation actual roll-up so FI-1 can settle without re-deriving:
```
operationActuals(woId) -> [{ operationId, workCenterId, costCenterId, actualHours, actualLabourCost }]
orderActuals(woId)     -> { labourCost, (parts from IN-1), (service), total }  // settlement basis
```
Settlement receiver defaults from the operation's work-center `cost_center_id`, overridable per the signed FI-1 decision (**settle to both cost center and asset**).

## 6. Effort & risk

- WM-2a: **M** (table + one admin screen + service). Independent, shippable this wave.
- WM-2b: **M–L**, gated on drift.
- WM-2c: **L**, gated on drift; highest value (the actual-cost posting).
- Migrations additive/reversible (drop columns / drop table to roll back). RLS: permissive `USING(true) TO authenticated` per house convention.

## 7. Recommendation

Start with **WM-2a (work-center master)** — zero drift, immediately useful (costing rate + capacity for scheduling/MRS), and the prerequisite both WM-2b and FI-1 build on. Prepare the WM-2b/2c migration + service layer in parallel, holding the WorkOrders.tsx UI touch until the concurrent edits land.
