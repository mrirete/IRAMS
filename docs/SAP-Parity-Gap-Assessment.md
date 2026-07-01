# IRAMS — SAP Parity Gap Assessment & Improvement Design

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
| IN-3 | **Movement types** — 101/201/261/311/561 with account assignment, auto-post to FI | Generic transaction labels | Movements don't carry account assignment or post to FinOps | **M–L** | 🟡 |
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
| FI-1 | **Order settlement** — WO cost (labour+material+service) settles to cost center/asset via settlement rule | Budgets have committed/actual fields | Verify actuals **auto-roll-up from WOs/confirmations/goods-issues**; if manual, the CO backbone is missing | **L** | 🔴 |
| FI-2 | **RAV-based cost KPIs** — maintenance cost % of RAV, stores % of RAV, %contractor | RAV stored; ratios not surfaced | One plug into the reliability metrics cockpit | **S** | 🟡 |
| FI-3 | **3-way match** — PO ↔ GR ↔ Invoice, tolerance, block | `invoiceMatched` flag | Full match + tolerance/block partial | **M** | 🟡 |
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

**Wave 1 — quick, high-visibility (close before the reviewer's next cycle):**
- **IN-1** Reservation netting / ATP (`qtyReserved` → available). **M**
- **FI-2** RAV cost KPIs on the metrics cockpit. **S**
- **PO-1** Verify & enforce competency-gated assignment. **S–M**
- **WM-1** Catalog code-groups (Object Part + Activity + coding profile). **M**

**Wave 2 — the order-to-cost spine (the strategic core):**
- **WM-2** Operations + work centers + confirmations. **L**
- **FI-1** Actual-cost roll-up + settlement to cost center/asset. **L**
- **IN-3** Movement types with account assignment → FI posting. **M–L**

**Wave 3 — structural depth:**
- **X-1** Maintenance strategies/packages · **X-2** Classification/characteristics · **WM-3/4** object list + order types · **IN-2/4** stock types + MRP · **PO-2/3** positions + work-center capacity.

**Wave 4 — extended:** X-3 rotables · X-4 measurement docs · X-5 calibration · FI-3 3-way match · X-6/7.

---

## 7. Recommended first moves
Start **Wave 1** — it's ~1 week total, all high-credibility with the SAP reviewer, and each item is contained (no cross-module rewrite):
1. **IN-1** and **FI-2** first (contained, visible), then **PO-1** (safety), then **WM-1** (the catalog structure he'll expect).
Then commit to **Wave 2** as a deliberate phase — it's the SAP order-to-cost backbone and the highest structural value, but it's a multi-week build touching WM + Inventory + FinOps together (mirror the multi-tenancy design's phased, RLS-style cutover discipline).

**Open decisions for sign-off:** (a) confirm Wave-1 scope; (b) is settlement to **cost center**, **asset**, or both (SAP allows a settlement rule with multiple receivers)?; (c) catalog depth — full B/C/D/A/T code groups or start with Object Part + Activity?
