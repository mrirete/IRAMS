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

## 4. This is not the Migration Center

Both move data from another system, and that is where the similarity ends.

**The Migration Center is how a customer moves in. This is how they stay married.**

| | Migration Center (`0219`) | ERP integration |
|---|---|---|
| Trigger | a person uploads a file | an event, or a schedule |
| Direction | one way, in | both ways |
| Frequency | once per phase, at onboarding | continuously, forever |
| Grain | whole entities — *all* the assets | one document — *this* goods receipt |
| Identity | matched on tag/code during the import | a permanent map (`erp_object_map`) |
| Getting it wrong | roll the batch back | post a reversal; the ledger is append-only |
| On failure | the import fails, fix the file, re-run | dead-letter queue someone works |
| Who operates it | an onboarding consultant, once | nobody — it runs |
| Lifetime | weeks | years |

The Migration Center's nine phases (assets → people → inventory → vendors → PM schedules → WO history → failure codes → meter history → live feeds) exist to enforce an ordering constraint, because importing work-order history before the asset register creates flat, level-less rows the hierarchy can never absorb. That is a **one-time correctness problem**. The integration's problem is the opposite: *given that both systems will keep changing forever, how do we never double-post and never lose a document?*

They are complementary, and phase 9 already proves the pattern — it hands off to the Connector Hub for ongoing telemetry rather than trying to own it. Three distinct jobs:

- **Migration Center** — one-time, file-based, bulk, human-supervised
- **Connector Hub** — ongoing, high-frequency, low-value-per-message telemetry
- **`erp-sync`** — ongoing, low-frequency, high-value-per-message business documents

### One concrete improvement worth making early

**The Migration Center should seed `erp_object_map`.** `import_batches.source_system` already records `sap_pm`, and a SAP PM export carries SAP's own equipment and material numbers. Those are precisely the `external_key` values the integration will need. Today they are used to match a row and then discarded.

Writing an `erp_object_map` row per imported record — when the source system is an ERP — means the integration begins life **already mapped**, instead of opening with a reconciliation project against the very data we just loaded. It is a small change to the import path and it removes the largest source of week-one integration pain.

---

## 5. Other systems, not just SAP

Yes — by construction, and this matters commercially. The architecture in §3 is provider-agnostic; SAP lives only in the emitter.

**Generic — reused by every target, built already or in Phase 1:**
`erp_object_map` (its `system` column is free text with no constraint — multi-system is possible today, `'SAP'` is only a default), the canonical documents, the outbox with retry and dead-letter, the ownership/conflict model, the reconciliation views, and the connector registry with its scheduling, health and logging.

**SAP-specific — confined to one replaceable layer:**
the OData/BAPI/IDoc transport, the field maps, ETag concurrency, deep-insert payload shapes, and field-length limits.

Plausible second and third emitters:

| Target | Why | Emitter effort |
|---|---|---|
| **QuickBooks / Xero** | The SMB tier's finance system. Simple REST, well-documented. Commercially the highest-value second emitter — it makes finance integration a *product feature*, not an enterprise engagement. | **S** |
| Microsoft Dynamics 365 BC / F&O | Common mid-market EAM neighbour; OData, so close to the S/4 emitter | **M** |
| NetSuite, Odoo, Sage Intacct | Mid-market ERP | **M** |
| Oracle Fusion / EBS, Infor, IFS | Tier-1 alternatives | **M–L** |
| Coupa / Ariba | Procurement only — POs and invoices, no cost postings | **M** |
| Data warehouse / BI | Nearly free once documents are canonical — it is the same document, written to a different sink | **S** |

**The guardrail that makes this true, and the one way to lose it:** the canonical document must carry *semantics*, not SAP codes. `movement_types` is keyed on SAP's BWART (`101`, `261`, `701`) — a deliberate choice, because BWART is the lingua franca of maintenance materials management and it gave the schema a vocabulary that was already thought through. But the **canonical document must say `issue_to_order`, not `261`**, with BWART as one mapping among several. Likewise ETags, deep inserts and 18-character field limits must never leak above the emitter.

Get that wrong and the canonical layer becomes SAP-with-extra-steps, and the second emitter costs as much as the first. Get it right and the honest description of this investment is not "an SAP integration" — it is **a finance-integration platform whose first and hardest emitter happens to be SAP**. Doing the hardest one first is the right order; everything after it is easier.

---

## 6. Three integration modes — finance is the narrowest one

Finance was the client's ask, not the shape of the problem. There are three modes, and **they have genuinely different engineering requirements**. Treating them as one thing is a mistake in both directions.

| | **Financial documents** | **Operational work** | **Reliability intelligence** |
|---|---|---|---|
| Direction | outbound | **bidirectional** | outbound, advisory |
| Guarantee needed | **exactly-once, immutable** | state convergence | **supersession** — latest wins |
| Correcting a mistake | post a reversal | reconcile the state | just send a better one |
| Cost of failure | money posted twice | duplicate work; a technician on stale instructions | a stale recommendation |
| Cadence | per document / daily run | near real-time | per study |
| Difficulty | medium | **hardest** | low |
| Status | ✅ built (`0244`–`0256`) | 🟡 partly (`0221`) | 🟡 partly (`0221`) |

**Reliability must not be forced through the finance pipe.** A settlement is immutable and must land exactly once. A recommendation is the opposite: recomputing β and η next quarter *should* overwrite last quarter's advice. Push recommendations through an exactly-once outbox and you accumulate stale documents nobody can retract.

### The work-management half is already prototyped

`0221` + `lib/writebackPackage.ts` + the `proposal-writeback` function are **already the architecture proposed in §3**, built for work management before it was designed for finance:

| §3 concept | Already exists as |
|---|---|
| Canonical document | `NormalizedAction` — explicitly system-neutral: *"vendor columns never read draft_payload directly"* |
| Swappable emitters | `TargetSystem = 'generic' \| 'sap_pm' \| 'maximo' \| 'maintainx'` |
| Per-tenant ERP profile | `writeback_targets` |
| Exactly-once outbox | `writeback_log` with a **partial unique index on successful sends** — retryable on failure, never delivered twice |
| Dry run before committing | `dry_run` builds and logs the payload with no outbound call |

It even independently arrived at the guardrail from §5 — the vendor mapping renders from the neutral action, never from the raw payload. Its scope is narrower than the name suggests: **approved Specialist proposals only**, not full work-order lifecycle sync. But the spine is right.

**`ers_wo_state` (`0233`) is the other half of mode 2, already built.** It normalises SAP PM (`CRTD`/`REL`/`TECO`/`CLSD`) and Maximo (`WAPPR`/`INPRG`/`COMP`) vocabularies into one canonical state. Bidirectional work sync fails on exactly this — two state machines that disagree about what "done" means — and that translation already exists and is tested.

### Where reliability lands in SAP

This is the loop the client cannot build themselves, and it is the commercial argument for IREAMS sitting alongside SAP rather than inside it:

```
SAP PM history ──▶ IREAMS ──▶ Weibull / RCM / FMEA / criticality ──▶ recommendation ──▶ SAP PM
```

| Our output | Where it lands in SAP PM |
|---|---|
| Weibull β/η, B10 → interval change | Maintenance plan cycle (IP02) — *the highest-value flow: it changes what their planners actually do* |
| RCM decision, task selection | Task list operations |
| Criticality assessment | Equipment ABC indicator |
| FMEA / RPN, failure modes | Classification characteristics; catalog codes |
| Alert diagnosis, inspection finding | PM notification (IW21) |
| PSC / reliability metrics | Usually **not** SAP — a BI sink is the right destination |

Note the last row. Not everything should go to SAP; some of it has nowhere sensible to land there, and pushing it anyway produces data their team ignores.

### Recommendation: one spine, three document families

Do **not** build a second outbound mechanism for finance. Two half-built integration spines is precisely the drift this codebase keeps paying for.

Generalise what `0221` proved:

- `writeback_log` → `erp_outbox`, carrying **all** document families, keeping the partial-unique exactly-once index for finance and work, and a supersede-by-key rule for reliability.
- `writeback_targets` + `connectors` + the per-tenant ERP profile → **one** target registry with a mode per target.
- `NormalizedAction` → one member of a canonical document set alongside movement, PO, GR, invoice and cost posting.

That reframes Phase 1 from "build an integration" to "**generalise the one that exists and add the finance documents to it**" — cheaper, and it retires a divergence rather than creating one.

---

## 7. What this can and cannot carry

"Anything" is too strong, and the distinction is worth holding because getting it wrong is expensive.

**It carries documents.** A document has three properties: a definite moment it happened, a stable identity, and a state you can ask about later. Goods movements, receipts, invoices, cost postings, work orders, notifications, inspection results, meter readings, recommendations — all documents.

**It must not carry bulk history.** This is the maintenance/inspection-history case specifically:

> **History migrates once. Events integrate forever.** Same data, different mechanism, and the cutover date is the boundary between them.

Ten years of work-order history is not 400,000 documents to push through an outbox one at a time — it is a bulk load. Force it through the document pipe and you get a slow, expensive run that produces 400,000 dead-letter candidates and an exception queue nobody can work. That is the Migration Center's job, and it already has the phases for it: work-order history (6), failure-code catalogs (7), meter and condition history (8).

**It should not carry** high-frequency telemetry (Connector Hub already does, correctly), large binaries such as drawings and certificates (send a pointer, not the payload), or free-form analytics (a BI sink, not SAP).

### Maintenance and inspection history, concretely

| Data | Direction | Mechanism | Notes |
|---|---|---|---|
| Their SAP PM work-order history | in | **Migration Center** | *The most valuable inbound data there is* — Weibull needs failures, and their history is where the failures are |
| Their failure/damage/cause codes | in | Migration Center | Maps to the ISO 14224 coding already in the schema |
| Their meter and condition history | in | Migration Center | Feeds degradation models |
| Ongoing completed work orders | out | outbox | Order confirmation / TECO |
| Ongoing inspection results | out | outbox | As a PM notification, or a measurement document |
| CML thickness readings, design basis (`ers_cmls`, `0213`) | — | **stays here** | SAP PM has nowhere good to put these. Not a gap — a reason they need IREAMS |
| Audit findings and corrective actions | out | outbox, as notifications | Only if they want them in SAP; often they do not |

The last two rows are worth saying out loud in a client meeting. Some of what IREAMS holds has **no sensible SAP home**, and that is the argument for the product, not a limitation of the integration.

---

## 8. What actually gets a client to yes

Most of this exists already and simply is not being said.

**Already built — name it in the proposal:**

| Concern they will raise | The answer, already in the code |
|---|---|
| "What will it write into our system?" | **Dry run.** `proposal-writeback` builds and logs the exact payload with no outbound call. They can see every write before any write happens. |
| "Where do our credentials live?" | **Not in a table.** `writeback_targets.config.auth.secret_env` stores the *name* of a secret the edge function reads at send time. |
| "Can your software post to SAP on its own?" | **No.** Every proposal is re-read server-side and must be human-approved. A client cannot deliver work a person never approved, whatever the request body says. Segregation of duties, which their auditor will ask about. |
| "Prove what you sent us." | `writeback_log` holds the exact payload per delivery; the cost ledger is append-only and corrections are visible reversals. That is a SOX evidence pack. |
| "What if we stop?" | SAP keeps everything it was sent; IREAMS exports. Say it plainly — an exit story they can verify beats a lock-in claim they cannot. |

**The single biggest unlock, and it needs no answers to the open questions:**

> **A read-only pilot that writes nothing to SAP.** Pull their equipment master and work-order history, run the reliability assessment, hand them findings on *their own data*.

No writes means no change control, no Basis risk, no audit scope, and no need to know whether they are on ECC or S/4 yet. It is roughly **2–3 weeks**, mostly using the Migration Center and the Specialist assessment that already exist — and it converts a 4–6 month integration decision into something a manager can approve alone. It also demonstrates the differentiator rather than describing it: their history, their failures, their Weibull curves, their bad actors.

**Worth adding before the conversation:**

1. **Per-document-family toggles.** Let them switch on goods receipts only, then add invoices, then costs. Incremental is far easier to approve than all-or-nothing, and it caps the blast radius of a first mistake.
2. **A named owner for the exception queue, written into the SOW.** Integrations die in week three because nobody owns failed documents. Naming the person is worth more than any amount of retry logic.
3. **A one-page data-flow diagram** for their security review — what leaves their network, to where, over what, holding what. It gets asked for every time; having it ready reads as competence.
4. **The list of what you need from them, given early.** Sandbox, a Basis contact, cost-centre and G/L extracts, movement-type account mapping, tolerance policy. A client who sees the ask up front trusts the estimate; one who discovers it in week four does not.
5. **An ROI line their champion can take to a CFO.** Not "integration" — eliminated double-keying (countable), stock accuracy, and maintenance cost per asset, which their SAP cannot produce today. The champion needs a number to defend internally.

**And one risk to raise before they do:** if they are SOX-scoped, your posting path becomes an audited system. Offer the evidence pack proactively. Being asked for it and improvising is a much worse meeting.

---

## 9. The revised plan

The original plan was a straight line: build foundations, build an adapter, connect to their sandbox, run in parallel. Four findings since then change it — not the total duration, but **the critical path and the order**.

### What changed, and why it matters

| Finding | Effect on the plan |
|---|---|
| **Phase 0 is complete** (`0244`–`0256`) | Removes 3–5 weeks that were still in the estimate |
| **`0221` already implements the outbound spine** | The adapter phase is a *refactor of tested code*, not new invention — and it retires a divergence instead of creating one |
| **A read-only pilot needs nothing from their Basis team** | Time-to-first-value drops from months to weeks, and it does not need the ECC-or-S/4 answer |
| **Equipment master should precede finance** (D1) | Reordered — and it is the same data the pilot needs, so it is no longer an extra step |

**The critical path used to run through their sandbox.** Everything queued behind a Basis team we do not control. It no longer does: there is now a three-week path to something demonstrable that needs only a data extract.

### Revised phases

| | Phase | Weeks | Needs from them | Blocked on Basis? |
|---|---|---|---|---|
| ~~0~~ | ~~Foundations — order-to-cost spine, PO lines, external keys~~ | — | — | ✅ **done** |
| **A** | **Read-only pilot** — import equipment master + WO history, seed `erp_object_map` from their own numbers, run the assessment, deliver findings on their data | **2–3** | a file export | **No** |
| **B** | **Unify the spine** — `writeback_log` → `erp_outbox`, one target registry, `NormalizedAction` joins the canonical set, per-family toggles | **2–3** | nothing | **No** |
| **C** | **First emitter + first family** — S/4 OData, goods movements only, dry-run end to end | **2–3** | field mapping | **No** (dry-run) |
| **D** | **Master data inbound** — vendors, cost centres, G/L, materials | **1–2** | extracts + ownership rules | Partly |
| **E** | **Remaining families** — PR/PO, invoices, cost postings | **2–3** | — | No |
| **F** | **Sandbox connect + UAT** | **3–6** | sandbox, Basis time | **Yes** |
| **G** | **Parallel run** — both systems live, daily reconciliation | **4+** | their operations | **Yes** |

**Still 4–6 months end to end.** Do not shorten that number — F and G are where estimates die, and skipping the parallel run is how garbage reaches a live GL. What changed is that **A delivers value in week three**, and A→E — about three months of work — needs nothing from their Basis team but a data extract and a field mapping.

### The sequencing rule

**Do A regardless.** It is the assessment you would run to win the deal anyway, it seeds the identity map as a side effect, and it is the only phase whose value survives the client saying no.

**Do B next, regardless.** It retires a divergence in your own codebase — two half-built outbound paths — and it is worth doing even if this client walks.

**Do not start C until three answers exist:** the equipment-master direction agreed, the per-object ownership rules written down, and a confirmed sandbox. Those change the build; guessing them wastes the phase. Note that A and B are unaffected by all three — which is precisely why they go first.

### Scoping down: the 4–6 months is one option, not the only one

**4–6 months buys continuous, bidirectional, API-level integration.** That is what the client described, but it is rarely what they need. Most organisations that ask for "continuous both ways" actually need **"correct by tomorrow morning"** — and finance is the domain where that is most true, because a nightly posting run is how SAP shops have always worked.

Deciding what must be *live* versus what can be *nightly* or *once* collapses the cost far more than trimming features does.

| Tier | What it is | Weeks | Basis involvement |
|---|---|---|---|
| **1** | **Migration Center + nightly file exchange.** Outbound: a daily file of cost postings and goods movements into their CPI. Inbound: a nightly master-data file (vendors, cost centres, G/L, materials). Everything else loaded once at onboarding. | **6–10** | **Minimal** — a file drop is standard and low change-control |
| **2** | **+ API for the hot path.** Real-time goods movements and PO/GR, where next-morning latency actually hurts stores. | **+6–8** | Moderate — sandbox, auth, UAT |
| **3** | **+ Full bidirectional.** Work-order lifecycle sync, master data both ways. Only if they are keeping SAP PM running in parallel. | **+8–12** | Heavy |

**Tier 1 covers the client's stated business need**: keep finance in SAP, run spares and POs in IREAMS, and have the numbers agree. What it gives up is latency — corrections land the next day, and there is no live PO status inside SAP. For a maintenance storeroom that is almost always acceptable, and it is worth asking rather than assuming.

**Tier 1's outbound half is already demonstrated.** `writebackPackage` renders a `columns`/`rows` export package precisely so a customer can bulk-import it, alongside the live-API path — *"Export package — always available; the customer bulk-imports the file."* A finance file emitter is the same pattern with different documents, not a new mechanism.

**Where the Migration Center handles it instead of the integration:**

| Data | Mechanism | Cadence |
|---|---|---|
| Equipment master, hierarchy | Migration Center | Once, then re-run when they restructure |
| Work-order history, failure codes, meter history | Migration Center | Once |
| Vendors, cost centres, G/L, materials | Migration Center, **re-runnable** | Nightly or monthly file |
| Cost postings, goods movements | Integration | Nightly (T1) or live (T2) |

The only change the Migration Center needs for this is that a **master-data import must be safely repeatable** — upsert on the external key rather than insert — which is a small change and is the same `erp_object_map` seeding described in §4.

**Recommendation: quote Tier 1, design for Tier 2.** Start where the value is provable and the risk is low, keep the canonical documents and emitter interface that make Tier 2 an upgrade rather than a rebuild, and let a real operational pain — not an assumption — justify the move.

### Running this alongside the shared-DB tenant tier

The two can run concurrently — the tenancy plan's column sweep and policy regeneration are *generated* over whatever tables exist, so new ERP tables are picked up automatically. But this stream owes tenancy four things, three of them defects introduced here.

| Interference | Status |
|---|---|
| **`sem_*` views bypassed RLS as owner.** `0183` set the rule (`security_invoker = true`) and 0244–0255 did not follow it. Live effect: `sem_wo_settlement` walked around the `0246` FinOps read gate. Under tenancy it would have been a **cross-tenant read of every object the semantic layer covers**. | ✅ **fixed, `0259`** |
| **`SECURITY DEFINER` functions bypass RLS entirely.** `ers_settle_work_order`, `ers_refresh_budget_actual` and `ers_match_invoice` take a UUID from an `authenticated` caller; `ers_settlement_run` takes none and would settle **every tenant's** orders. Harmless at N=1, a cross-tenant write vector at N>1. | ⚠️ **needs a tenant predicate in tenancy Phase 2** |
| **Uniqueness keys that ignore the tenant** — `erp_object_map (system, entity_type, external_key)` collides the moment two tenants both map SAP vendor 100234; `invoice_tolerances (name)` collides on the seeded `DEFAULT`. Exactly the class the tenancy plan flags for `dictionaries (type, code)`. | ⚠️ **widen with `company_id` in tenancy Phase 4** |
| **`goods_receipt_seq` is one global number range.** Tenants would share GRN numbering — not a data leak, but it leaks volume and breaks the per-company-code convention. `numbering_config_overrides` keyed `(company_id, object_class)` is the pattern already in this codebase. | ⚠️ **re-key in tenancy Phase 4** |

Also: `movement_types` is a global catalog carrying `gl_account`, which is per-tenant. It needs the plan's §3.5 shape — a global default with a per-tenant override — not a column on a shared row.

**The sequencing rule that matters:** a table created *between* the tenancy column sweep (Phase 1) and the isolation gate (Phase 3) misses both. So either land the sweep first, or add `company_id` explicitly to every new table from here.

**Recommended order.** Tenancy Phases 0–3 are about two weeks and end at the isolation gate — treat that as a freeze on new ERP tables. Run **ERP Phase A (the read-only pilot) straight through it**: it adds no tables and touches no policies, so it cannot interfere. Resume Phase B onward on a tenant-aware schema, which is cheaper than retrofitting it.

**One process note.** Three streams are now writing migrations against one repo, and migration numbers have collided three times in two days (`0237`, `0246`, `0250`). Always run `--status` before choosing a number.

### One risk to name in phase B

`writeback_log`'s partial unique index is what makes delivery exactly-once. Generalising it is a refactor of correctness-critical code on a live path. Do it with the existing tests green before and after, and add a test that proves a retried send still cannot deliver twice — the failure mode here is silent and expensive.
