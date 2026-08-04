# IREAMS ⇄ SAP — Integration Design

**Status:** Design, ahead of Phase 1 · **Audience:** product + engineering, and the client's Basis/CPI team
**Assumption on record:** the client runs **SAP BTP / Cloud Integration (CPI)**. That removes the single largest cost unknown — the integration is an iFlow on capacity they already own, not a middleware procurement.
**Open:** ECC or S/4HANA. This document is written **S/4-first** and says exactly what changes if the answer is ECC.

---

## 0. What is already built

Phase 0 is complete and applied. The integration does not start from a blank page:

| Asset | Migration | What it gives an adapter |
|---|---|---|
| `cost_allocations` + `source` | `0244` | Settled cost as documents, never mutated — each row is one thing to send, once |
| `sem_wo_settlement.unsettled_variance` | `0244` | The outbound queue for cost postings |
| `movement_types` + account assignment | `0245` | Every stock movement speaks BWART, with cost centre, asset and value |
| `sem_stock_movements.fi_status` | `0245` | Which movements still owe a financial document |
| `purchase_order_lines` (EKPO shape) | `0248` | Line-item granularity — SAP posts per line, not per order |
| `goods_receipts` with sequence numbering | `0248` | Real GR documents pointing at a line id |
| SERVICE settlement | `0249` | Contractor cost reaches the ledger |
| `erp_object_map` | `0250` | The identity layer: which of their records is which of ours |
| `invoice_matches` + line-level match | `0255`/`0256` | The invoice leg, with tolerance and payment block |

**The one design decision that shapes everything downstream:** settlement is the *sole* poster for anything carrying a work order, and only order-less movements post directly. Double counting is prevented structurally, by a `WHERE` clause, not by discipline. Any adapter must preserve that — do not "improve" a 261 into a direct FI post.

---

## 1. Integrating more than finance

Finance is the ask, but it is the narrowest slice of what the two systems share. Ranked by value-per-effort:

| # | Domain | Direction | Why it matters | Effort | Depends on |
|---|---|---|---|---|---|
| **D1** | **Equipment & functional locations** (SAP PM: EQUI/IFLOT) | SAP → IREAMS | The asset register is the spine of everything. If SAP masters equipment, every WO, reading and cost we produce hangs off *their* identifiers, and reconciliation stops being an argument. **Do this before finance.** | **M** | `erp_object_map` |
| **D2** | **Material master & stock** (MM: MARA/MARD) | Bidirectional | Their material numbers, our bin-level stock. `inventory_items.material_number` already exists for the key. | **M** | D1 pattern |
| **D3** | **Vendors / business partners** (BP/LFA1) | SAP → IREAMS | POs cannot be posted against a vendor SAP does not recognise. | **S** | — |
| **D4** | **Cost centres, WBS, G/L** (CSKS/PRPS/SKA1) | SAP → IREAMS | Already modelled with SAP field names; `gl_account` columns are deliberately unseeded, waiting for this. | **S** | — |
| **D5** | **Purchase requisitions → PO** (EBAN/EKKO) | IREAMS → SAP | Maintenance raises the demand; procurement owns the commitment. Often the *politically* easiest win: we feed their process rather than replacing it. | **M** | `purchase_order_lines` |
| **D6** | **Goods movements** (MIGO/MB51) | IREAMS → SAP | Already speak movement types. Highest-volume traffic. | **M** | `0245` |
| **D7** | **Maintenance notifications/orders** (IW21/IW31) | Bidirectional | Only if they intend to keep SAP PM running in parallel. Usually a sign the deal is really a *replacement*, not an integration — worth asking. | **L** | D1 |
| **D8** | **People, qualifications, org** (HR/OM) | SAP → IREAMS | Feeds competency-gated assignment (PO-1), which is a safety control, not a convenience. | **M** | — |
| **D9** | **Production/OEE, downtime** (PP) | SAP → IREAMS | Turns our reliability maths from maintenance-only into true availability. | **M** | — |
| **D10** | **Documents** (DMS) | SAP → IREAMS | Drawings, manuals, certificates. Connector Hub already has a `document_store` type. | **M** | — |

**Two things worth saying to the client:**

1. **Master data first, transactions second.** D1/D3/D4 are cheap, low-risk, and every later flow depends on them. Sending a cost posting before the cost centres agree is how integrations get switched off in week three.
2. **Non-finance data is where the differentiation is.** Anyone can post a journal. Equipment hierarchy, condition data and reliability results flowing back into their asset record is the thing SAP does not do well — and it is the argument for keeping IREAMS rather than absorbing it.

**Sensor and condition data is already solved and does not belong in this project.** The Connector Hub ingests REST/historian/OPC-UA telemetry today. Do not route it through CPI: it is high-frequency, low-value-per-message, and SAP is the worst possible middleman for it.

---

## 2. S/4HANA-first design

S/4 exposes released **OData V4 APIs** over CDS views, versioned and documented on SAP Business Accelerator Hub. Design to those:

| Our object | S/4 API | Notes |
|---|---|---|
| Settled cost | `API_JOURNALENTRY_SRV` / ACDOCA posting | Or Central Finance staging if they run it |
| PO / PO line | `API_PURCHASEORDER_PROCESS_SRV` | Line = `PurchaseOrderItem`, our `line_no` maps to `EBELP` |
| Goods receipt | `API_MATERIAL_DOCUMENT_SRV` | Movement type is a first-class field — that is why `0245` exists |
| Supplier invoice | `API_SUPPLIERINVOICE_PROCESS_SRV` | Our block reason maps to their payment block |
| Equipment / FLOC | `API_EQUIPMENT`, `API_FUNCTIONALLOCATION` | D1 |
| Material | `API_MATERIAL_STOCK_SRV`, `API_PRODUCT_SRV` | D2 |
| Business partner | `API_BUSINESS_PARTNER` | D3 |

**Three S/4 properties to design around from day one:**

- **Idempotency.** These APIs are not naturally idempotent. `erp_object_map` is what makes a retry safe: write the mapping in the same transaction as the send, and never send an object that already has an `external_key` for that system.
- **Deep inserts.** S/4 accepts a header with its items in one payload. Our line-item table exists so we can build that payload — this was impossible from the JSONB.
- **ETag concurrency.** Updates require the current ETag. Store it in `erp_object_map.external_ref`; a 412 means their copy moved and our `ownership` rule decides who wins.

---

## 3. Accommodating ECC customers

ECC has no OData layer worth targeting. It speaks **BAPI/RFC** and **IDoc**, and the objects are the same objects — `BAPI_GOODSMVT_CREATE01` and `API_MATERIAL_DOCUMENT_SRV` both want a movement type, a plant, a quantity and an account assignment.

**So do not write two integrations. Write one canonical document layer and two transports.**

```
IREAMS tables ──▶ canonical document  ──┬──▶ OData V4 JSON   (S/4, direct or via CPI)
  (0244-0256)     (movement, PO, GR,    ├──▶ BAPI/RFC        (ECC via CPI)
                   invoice, cost)       └──▶ IDoc XML        (ECC, file or queue)
                          │
                    erp_object_map ──▶ idempotency + ownership, identical for both
```

The canonical document is ours and stable. Only the **emitter** differs, selected per tenant by an `erp_profile` (release, dialect, endpoint, field map). Nothing above the emitter knows which SAP is on the other end.

**What actually differs, and how each is absorbed:**

| Concern | S/4 | ECC | How the design absorbs it |
|---|---|---|---|
| Transport | OData V4 / REST | BAPI/RFC or IDoc | Emitter choice |
| Payload | JSON, deep insert | Flat structures / IDoc segments | Emitter serialises the same canonical doc |
| Vendor identity | Business Partner | LFA1 vendor | `erp_object_map.entity_type = 'vendor'` — one row either way |
| Material number | 40 chars | 18 chars | **Validate at map time, not send time**; ECC profile caps the key length |
| Idempotency | none built in | none built in | `erp_object_map`, identical for both |
| Errors | HTTP + message payload | BAPI `RETURN` table / IDoc status | Emitter normalises to one error shape for the dead-letter queue |
| Async | mostly sync | IDoc is fire-and-forget | Outbox with status per document — needed for ECC, harmless for S/4 |

**The ECC field-length trap is worth calling out.** ECC's 18-character material number and 10-character equipment number are shorter than S/4's. Design the canonical layer to S/4's widths and validate against the *tenant's* profile when the mapping is created — so an ECC customer is told at onboarding that a key will not fit, rather than at 2 a.m. when a goods movement is rejected.

**Recommendation:** build S/4/OData as the reference emitter, because it is what new customers run and what the client most likely runs. Ship ECC as a second emitter only when a paying ECC customer exists. The canonical layer means that is roughly 2–3 weeks of adapter work, not a second project — provided the canonical documents are defined now, while there is only one emitter to keep honest.

---

## 4. What Phase 1 actually builds

Unchanged from the earlier estimate; this is the shape of it.

1. **Canonical document contracts** — movement, PO, GR, invoice, cost posting. Typed, versioned, tested against fixtures. Nothing SAP-specific.
2. **Outbox** (`erp_outbox`) — one row per document, with status, attempts, last error, and the `erp_object_map` write in the same transaction as the send.
3. **`erp-sync` edge function** — the second worker on the existing connector registry, reusing its scheduling, health and logging.
4. **Emitter: S/4 OData**, behind an interface a second emitter can implement.
5. **Reconciliation UI** — the dead-letter queue someone in stores or AP actually works, fed by `unsettled_variance`, `fi_status` and `payables_status`, which already exist.

**Do not start any of it until:** the equipment master direction is agreed (D1), the per-object ownership rules are written down, and their CPI team has confirmed a sandbox. Those three answers change the build; guessing them wastes the phase.
