# IREAMS — SAP Parity Gap Assessment & Improvement Design

**Status:** Draft for review · **Audience:** product + engineering, ahead of the SAP-background UAT reviewer
**Scope:** Work Management (SAP **PM**), Inventory (SAP **MM/IM**), People & Org (SAP **HR/OM/BP**), Financial Ops (SAP **FI-CO**)
**Purpose:** identify — and pre-emptively close — the gaps a SAP practitioner will flag next, with SAP object mapping, effort, and a sequenced roadmap.
**Method:** grounded in the actual schema/types (field-level), not generic. Effort key: **S** = ≤1–2 days · **M** = ~days · **L** = 1–2 weeks · **XL** = multi-week phase (DB + service + UI).

---

## 0. The unifying theme — the order-to-cost backbone

The single structural pattern a SAP expert will home in on is the **order-to-cost spine**:

```
Notification ▶ Order (operations on work centers)
                 ├─ Time confirmations  ─────────────▶ actual labour cost
                 ├─ Goods issues (reserved stock)  ──▶ actual material cost + ATP netting
                 └─ Services/PO  ────────────────────▶ actual service cost
                                    ▼
                     Settlement to Cost Center / Asset ▶ Budget actual vs plan
```

Three of our biggest gaps — **WM confirmations**, **Inventory ATP/reservation netting**, and **FinOps settlement** — are three faces of this one missing spine. Individual patches help; the strategic win is building the spine.

---

## 1. Work Management — SAP **Plant Maintenance (PM)**

**Solid (SAP parity):** notifications (service requests) with ISO 14224 failure coding; `WorkOrderType`; tasks with `estHours`/`actualHours`; labour + parts; JSA/PTW incl. normal/isolated LOTO positions; TECO/CLOSED; PMs with **time and reading** triggers; planned-vs-reactive KPI; closeout gates.

| # | SAP object / concept | Current state | Gap | Effort | Pri |
|---|---|---|---|---|---|
| WM-1 | **Catalog profiles & code groups** — Damage (D), Cause (C), **Object Part (B)**, **Activity (A)**, Task (T), assigned per equipment class | Flat `failure_mode` / `failure_cause` dictionaries only | No object-part or activity catalogs; no coding profile per class. The signature ISO 14224/SAP-PM structure he expects first. | **M** | 🔴 |
| WM-2 | **Operations + Work Centers + Confirmations** — numbered ops (0010/0020) on work centers, partial/final time confirmations | Tasks carry est/actual hours, no work-center or confirmation posting | No capacity-bearing operations; actual labour isn't formally confirmed/rolled up | **L** | 🔴 |
| WM-3 | **Object list** — multiple technical objects per order | One WO = one asset | Can't raise one order across several equipment | **M** | 🟡 |
| WM-4 | **Order-type config** — number ranges, settlement rule, field selection per type (PM01–04) | `WorkOrderType` is a label | Type doesn't drive numbering/settlement/fields | **M** | 🟡 |
| WM-5 | **Permit / Work Clearance Management** depth (isolation certificates, LOTO workflow) | JSA/PTW + LOTO positions exist | Formal permit issue/return + isolation steps partial | **M** | 🟢 |

## 2. Inventory — SAP **Materials Management / Inventory (MM/IM)**

**Solid:** item master; multi-location + bins; min/max/reorder + `qtyOnOrder`; transactions (ISSUE/RECEIPT/ADJUSTMENT/STOCKTAKE/RETURN); serialized items; valuation & depreciation settings.

| # | SAP object / concept | Current state | Gap | Effort | Pri |
|---|---|---|---|---|---|
| IN-1 | **Reservation netting / ATP** — available = on-hand − reserved | `qtyOnHand`, `qtyOnOrder`; **no `qtyReserved`/`qtyAvailable`** | WO reservations don't reduce available → two orders commit the same part | **M** | 🔴 |
| IN-2 | **Stock types** — unrestricted / quality-inspection / blocked / in-transit | All stock is "available" | No quality/blocked segregation | **M** | 🟡 |
| IN-3 | **Movement types** — 101/201/261/311/561 with account assignment, auto-post to FI | ✅ **Shipped (`0245`)** — `movement_types` catalog (101/102/201/202/261/262/311/501/551/552/561/701/702), every movement carries type + storage location + cost centre + asset + value, direct FI posting for non-order movements, `sem_stock_movements` register | Remaining: G/L accounts are unseeded by design (mapped per tenant at ERP onboarding); stock-account valuation postings still out of scope | **M–L** | 🟢 |
| IN-4 | **MRP / reorder proposal** — min/max → PR/PO proposal, safety stock, lead time | Min/max/reorder stored; manual | No auto reorder-to-PO proposal | **M** | 🟡 |
| IN-5 | **Batch management** | Serial yes, batch no | No batch/lot tracking (shelf-life, recalls) | **M** | 🟢 |

## 3. People & Org — SAP **HR / Org Management / Business Partner**

**Solid:** contacts; flexible org-unit types (post-`0166`); roles/permissions/data-scope; **qualifications with `dateExpires`**; hourly rate; cost center; LOTO positions.

| # | SAP object / concept | Current state | Gap | Effort | Pri |
|---|---|---|---|---|---|
| PO-1 | **Competency-gated assignment** — order checks required qualification/validity before assigning a tech | Qualifications + expiry recorded | Verify assignment is **blocked** on missing/expired cert (safety) — likely advisory only | **S–M** | 🔴 |
| PO-2 | **Positions vs holders** — SAP OM separates positions (chairs) from persons | Persons assigned directly to org units | No vacancy/position planning | **M** | 🟡 |
| PO-3 | **Work center ↔ crew capacity** | Labour resources exist (scheduling) | Person→work-center capacity link informal | **M** | 🟡 |
| PO-4 | **Approval / release strategy** — hierarchical, value-banded | Request Review→Authorize→Approve + spending limits | Multi-level release by value/type partial | **M** | 🟢 |
| PO-5 | **Org effective-dating** — time-dependent org (valid-from/to) | Static | No historical org as-of reporting | **M** | 🟢 |

## 4. Financial Ops — SAP **FI-CO (Controlling)** — *strongest module*

**Solid:** cost centers + budgets (opex/capex) with **availability control** (`committed`/`actual`/`available`, `BudgetCheckResult`); maintenance forecast; **replacement value (RAV)**; warranties + claims; **capitalization events** (overhaul/replacement/upgrade); depreciation book/method; `invoiceMatched`.

| # | SAP object / concept | Current state | Gap | Effort | Pri |
|---|---|---|---|---|---|
| FI-1 | **Order settlement** — WO cost (labour+material+service) settles to cost center/asset via settlement rule | ✅ **Shipped (`0244` + `0249`)** — finishing an order posts labour, material **and service** actuals to `cost_allocations` against both receivers (cost center + asset); delta posting, so re-runs, late costs and reversals are all safe; `budgets.actual` recomputed from the ledger | Remaining: settlement rules configurable per order type (WM-4) | **L** | 🟢 |
| FI-2 | **RAV-based cost KPIs** — maintenance cost % of RAV, stores % of RAV, %contractor | RAV stored; ratios not surfaced | One plug into the reliability metrics cockpit | **S** | 🟡 |
| FI-3 | **3-way match** — PO ↔ GR ↔ Invoice, tolerance, block | ✅ **Shipped (`0248` + `0255`/`0256`)** — all three legs are documents; the match scores **per line** (a header comparison nets a price error against a quantity error), tolerances are a configurable table (SAP keys PP/DQ), payment blocks on PRICE or QUANTITY, `UNIQUE(vendor_id, invoice_number)` blocks duplicate payment, `sem_invoice_matches` is the payables queue | Remaining: payment terms/due-date derivation, credit notes | **M** | 🟢 |
| FI-4 | **Cost element accounting** — primary/secondary elements | Cost centers only | No cost-element granularity | **M** | 🟢 |

---

## 5. Other possible improvements (broader SAP capability backlog)

Beyond the four-module gaps, these SAP-EAM capabilities would materially raise the platform (some tie to reliability work already shipped):

| # | Capability (SAP) | Value | Effort |
|---|---|---|---|
| X-1 | **Maintenance Strategies & Packages** — nested cycle sets (1M/3M/6M/12M) where the annual absorbs the due monthlies | Kills PM over/under-maintenance; biggest PM upgrade | **L** |
| X-2 | **Classification System** — class → **characteristics** (attribute templates per equipment class; the 2nd ISO 14224 axis) | Standardized equipment data + far better analytics/search | **L** |
| X-3 | **Rotables / Refurbishment** — remove → refurb order → return-to-stock, serialized history on the `equipment_installations` log (already scaffolded, `0156`) | Repairable-spares lifecycle; extends what exists | **M** |
| X-4 | **Measurement documents + counter/condition triggers** — formal measurement docs, threshold alarms → auto-notification | Condition-based maintenance loop | **M** |
| X-5 | **Calibration / QM** — test equipment, results, pass/fail certificates | `CALIBRATION` type exists but shallow | **M** |
| X-6 | **Maintenance BOM** depth — spare↔equipment structure driving reservations | Closes the WO→parts loop | **M** |
| X-7 | **Shift handover / operator rounds / logbook** | Operations governance | **M** |

---

## 6. Prioritized roadmap

**Wave 1 — quick, high-visibility (close before the reviewer's next cycle):** ✅ **DELIVERED**
- ✅ **IN-1** Reservation netting / ATP — `checkMaterialAvailability` now nets stock reserved by other open WOs; material check shows Reserved / net Available (`1634a1d`). *Follow-up: Available column on the inventory master list.*
- ✅ **FI-2** RAV cost KPIs — Maintenance-cost-%-of-RAV card on the reliability metrics cockpit (`02e4c6f`).
- ✅ **PO-1** Competency-gated assignment — AssignmentModal blocks techs with missing/expired required certs (supervisor override) + always-on expired-cert advisory (`2f31fc9`). *Follow-up: WO required-competency source field so the gate is data-driven, not latent.*
- ✅ **WM-1** Catalog code-groups — Object Part (B) + Activity (A) code-groups added, admin-manageable + seeded (`4b34a29`). *Follow-up: object-part/activity coding fields on the WO/notification (files under concurrent edit).*

**Wave 2 — the order-to-cost spine (the strategic core):**
- ✅ **WM-2** Operations + work centers + confirmations (`0168`/`0169`/`0170`).
- ✅ **FI-1** Actual-cost roll-up + settlement to cost center/asset (`0244`) — trigger on order completion, delta postings, `sem_wo_settlement` reconciliation view, `ers_settlement_run()` for the periodic run (SAP KO8G). Also fixed `budgets.actual`, which never moved: the old path called an `increment_budget_actual` RPC that exists in no migration.
- ✅ **IN-3** Movement types with account assignment → FI posting (`0245`).
- ✅ **PO lines as rows** (`0248`) — `purchase_orders.items` JSONB replaced by `purchase_order_lines` (SAP EKPO), line numbers spaced by 10, receipts pointing at a line id instead of an array position. The JSONB column is frozen, not dropped, until the table has run in anger.
- ✅ **SERVICE settlement** (`0249`) — the third input to the spine.
- ✅ **ERP external keys** (`0250`) — `erp_object_map`, the identity layer an adapter needs to be idempotent. Inert until something writes to it.

**The spine is closed, all three inputs.** Confirmations → labour actual, goods issues → material actual, received service-PO lines → service actual; all settling to a cost centre and an asset, with budget actuals recomputed from the ledger.

**The recognition rule, stated once:** *ordering is a commitment, receipt or issue is the cost.* A planned part, an ordered service and an outstanding PO line are all excluded from actuals for the same reason. It is why `sem_wo_actual_lines` filters on `is_planned` for material and on `qty_received` for service.

**Why a MATERIAL PO line never posts to its work order:** it is received into stock (101), then issued to the order (261), and the issue is what makes it cost. Posting the line as well would charge the order twice for one part. Same guard shape as `movement_types.fi_posting` — a `line_type` filter, so double counting is structurally impossible rather than merely avoided.

**Decisions settled in `0245`:**
1. **Material actual = issued parts only.** A planned part is a commitment — `0201` has already netted it out of ATP; charging it as spend as well bills the plant for a decision rather than a consumption. The goods-issue engine already flips `is_planned → false` at TECO, so the distinction is real data. `sem_wo_actual_lines` and `getOrderActuals` changed together; orders settled under the old definition self-correct on their next run, and the correction posts as a visible negative line.
2. **Backfill is preview-then-run.** `ers_settlement_preview(n)` shows exactly what would post, largest variance first, without posting it. Runbook: total it → eyeball the largest → prove one order → batch with `ers_settlement_run(100)`. Safe to re-run at every step, because postings are deltas.

**Where `0245` deviates from SAP, deliberately:** SAP posts a 261 to FI *and* to the order, then settles the order — two documents. We have one ledger, so a work-order movement carries its account assignment but does not post; settlement is the single poster for anything with an order, which makes double counting structurally impossible. `movement_types.fi_posting` records which rule each type follows (`NONE` / `DIRECT` / `VIA_SETTLEMENT`).

**Wave 3 — structural depth:**
- **X-1** Maintenance strategies/packages · **X-2** Classification/characteristics · **WM-3/4** object list + order types · **IN-2/4** stock types + MRP · **PO-2/3** positions + work-center capacity.

**Wave 4 — extended:** X-3 rotables · X-4 measurement docs *(SAP-sheet import shipped)* · X-5 calibration · ~~FI-3 3-way match~~ *(shipped — `0248`/`0255`/`0256`, see §4)* · X-6/7.

---

## 7. Recommended first moves
Start **Wave 1** — it's ~1 week total, all high-credibility with the SAP reviewer, and each item is contained (no cross-module rewrite):
1. **IN-1** and **FI-2** first (contained, visible), then **PO-1** (safety), then **WM-1** (the catalog structure he'll expect).
Then commit to **Wave 2** as a deliberate phase — it's the SAP order-to-cost backbone and the highest structural value, but it's a multi-week build touching WM + Inventory + FinOps together (mirror the multi-tenancy design's phased, RLS-style cutover discipline).

**Decisions (signed off):** (a) **Wave-1 scope confirmed.** (b) Settlement to **both cost center and asset** (SAP multi-receiver settlement rule). (c) Catalogs — **start with Object Part + Activity** (B/A), extend to full D/C/T later.
