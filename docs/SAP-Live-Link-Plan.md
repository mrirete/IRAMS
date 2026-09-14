# IREAMS ⇄ SAP — from file exchange to a live link

*Plan, 2026-09-14. Companion to [ERP-Integration-Design.md](ERP-Integration-Design.md), which set the architecture (canonical documents, swappable emitters, three integration modes) and the commercial tiers. This document is the build plan for Tier 2/3: data moving between IREAMS and SAP PM on a clock, in both directions, without anyone loading a file.*

## 1. Where we stand

| Direction | Today | Mechanism |
|---|---|---|
| SAP → IREAMS | Migration Cockpit workbook (8 objects), PM load files (measuring points, plans/items, task lists/packages/components), work-order history | Files through the Migration Center / Recurring Jobs / Import Wizard |
| IREAMS → SAP | Same 8 objects, open work as notifications, closed history as extract | SAP Load Center (files) |
| IREAMS → SAP finance | Cost postings, goods movements, receipts, PO lines, invoices | `lib/erp` canonical documents → CSV, nightly `erp-export` to a bucket (Tier 1, live) |
| IREAMS → any CMMS | Approved Specialist proposals | `proposal-writeback`: `writeback_targets` + `writeback_log` (exactly-once, dry-run, secret-by-name) |
| Any system → IREAMS | Work orders, sensor readings | `ingest-work-orders`, `ingest-readings` HTTP APIs with collector keys |

So the *mappings* exist (Load Center spec + inbound profiles), the *document model* exists (`lib/erp/canonical.ts`), an *exactly-once outbox* exists (`writeback_log`), *identity* exists (`erp_object_map`), and a *scheduled worker pattern* exists (`sensor-sync` due-check, `erp-export` cron key). What does not exist:

1. a worker that runs on a clock and moves documents both ways (`erp-sync`);
2. an API emitter — every emitter today renders files;
3. an inbound poller that asks SAP "what changed since my watermark";
4. a per-tenant target definition with ownership rules and per-family switches;
5. a way to test any of it before a client gives us a sandbox.

Item 5 decides the plan. Every SAP integration I have seen stalls on the client's Basis team. This plan makes the whole loop demonstrable on our own infrastructure first, so connecting a real S/4 is a URL and a credential, not a project.

## 2. Design

### 2.1 One spine, three families (unchanged from the design doc)

```
IREAMS tables ──watermark──▶ canonical document ──▶ Emitter ──▶ SAP
                                   │                   │
                                   └── erp_outbox ◀────┘  (status, payload, response, retries)
SAP ──"changed since"──▶ inbound document ──▶ existing importers (upsert on external key)
                                   │
                                   └── erp_object_map (identity + ETag + ownership)
```

Families and their guarantees, as already decided:

| Family | Direction | Guarantee | Landing point in SAP |
|---|---|---|---|
| Master data: functional locations, equipment, measuring points, materials, work centres | both, owner per tenant | idempotent upsert | `API_FUNCTIONALLOCATION`, `API_EQUIPMENT`, measuring point API, `API_PRODUCT` |
| Condition: measurement documents (readings) | IREAMS → SAP | at-least-once, natural idempotency (point + timestamp) | measurement document API |
| Work: notifications, orders, status | both | two state machines converge (`ers_wo_state`) | `API_MAINTNOTIFICATION`, `API_MAINTENANCEORDER` |
| Reliability: PM cycle revisions, criticality | IREAMS → SAP, advisory | supersession, not exactly-once | maintenance plan / equipment ABC |
| Finance: postings, movements, receipts, invoices | IREAMS → SAP | exactly-once | already canonical; API emitter replaces the CSV |

*Which public OData services exist for measuring points and measurement documents varies by S/4 release. That is verified against the SAP API Business Hub in phase 1 before the emitter is written; where a release lacks one, the CPI iFlow calls the BAPI and the emitter's job does not change.*

### 2.2 Change capture: watermarks, not triggers

Both directions use the same rule: *give me everything whose last-change timestamp is later than the watermark I stored last run.* IREAMS tables carry `updated_at`; S/4 entities carry `LastChangeDateTime`. No database triggers, no change tables, nothing to keep in step when a table is added. The watermark advances only after a run commits its outbox rows, so a crashed run replays, and the outbox makes the replay harmless.

### 2.3 Identity and ownership

`erp_object_map` already links an IREAMS row to a SAP key. It gains `company_id` (the tenancy plan's item), `etag` (S/4 concurrency), and `owner` (`sap` | `ireams`). The ownership rule is per family per tenant, written into the target, and it decides two things: which side's edit wins on conflict, and which side's UI marks the field read-only. Default: SAP owns master data and orders, IREAMS owns readings, reliability results and PM cycle proposals. A tenant that is *replacing* SAP PM flips the master-data owner. This is the "who wins" rule the design doc says must exist in writing before phase C.

### 2.4 Exactly-once

`writeback_log`'s partial unique index on successful sends is the guarantee that a retried send cannot deliver twice. `erp_outbox` keeps it: `UNIQUE (target_id, family, document_id) WHERE status = 'sent'`. One advisory lock per tenant per run so two workers never process the same watermark window. A test proves both before any emitter goes live.

### 2.5 The SAP PM simulator

A small Deno edge function (`sap-sim`) that implements the subset of S/4 OData V4 the link uses: the entity sets above, `$filter` on `LastChangeDateTime`, `If-Match` ETags, `412` on stale writes, `201` with a generated number on create, deep insert for order header + operations. It keeps its state in a table (`sap_sim_entities`, tenant-scoped) so a journey can create in IREAMS, watch it appear, change it "in SAP", and watch it come back. It is not a SAP. It is enough SAP to prove the runtime, the conflict rule, the retry path and the exception queue, and it is what every demo runs against until a client sandbox exists.

### 2.6 Where it is operated

- **Admin › Integrations** (replaces the Specialist-only writeback screen): targets per tenant (system, base URL, auth secret *name*, poll interval, per-family direction and owner), Test connection, Dry-run (renders and logs, sends nothing), Sync now, run history, and the exception queue with Retry / Skip / Open record.
- Failed documents are the product. The design doc's rule stands: the SOW names an owner for the exception queue.

### 2.7 Security rules carried forward

Service-role worker with an explicit `company_id` on every query (the `erp-export` lesson). Credentials referenced by secret name, never stored. Every outbound payload logged verbatim (SOX evidence). Dry-run before the first real send of any family. Human approval stays on reliability writes (an interval change to a live maintenance plan is not a background job).

## 3. Phases

Each phase ends with something that runs on a clock and a journey that proves it against the simulator.

| | Phase | Delivers | Weeks | Needs the client? |
|---|---|---|---|---|
| **1** | **Spine + simulator + master data** | `erp_targets`, `erp_outbox` (tenant-aware, exactly-once), `erp-sync` worker on pg_cron with watermarks both ways, `sap-sim`, S/4 OData emitter and inbound poller for functional locations and equipment, Admin › Integrations with dry-run and exception queue. Demo: create equipment in IREAMS → it exists in the simulator within a minute; rename it there → IREAMS shows the rename; edit both sides → the owner wins and the loser is queued with the reason. | 3 | No |
| **2** | **Condition + work** | Measuring points and measurement documents outbound (every logged reading becomes a SAP measurement document); notifications outbound from alerts and requests; orders and status inbound through `ers_wo_state`; open orders arrive as IREAMS work orders. Demo: a reading trips a limit → notification appears in the simulator → an order created there appears in My Work → TECO there closes it here. | 3 | No |
| **3** | **Reliability + materials + finance hot path** | PM cycle revisions to maintenance plans (the highest-value landing point: Weibull changes what their planners see), criticality to the equipment ABC indicator, material master inbound, goods movements and receipts live instead of nightly. | 2 | No |
| **4** | **Client connect** | Point a target at their S/4 (direct OData or through CPI), OAuth2 client credentials or basic auth, dry-run every family against their sandbox, UAT, parallel run with daily reconciliation. Nothing in phases 1–3 changes. | 3–6 + 4 | **Yes** — sandbox, Basis time |

Phases 1–3 are about eight weeks and need nothing from anyone. They also retire the two half-spines (finance CSV lane and Specialist writeback lane become two families on one outbox), which the design doc listed as a known debt.

## 4. What this plan deliberately does not do

- It does not push sensor data through the link. High-frequency telemetry stays on the Connector Hub; only *logged readings* become measurement documents.
- It does not make the Migration Center obsolete. First load is still a file; the link carries changes after go-live. The one change the Migration Center needs, repeatable master-data imports keyed on the external key, is part of phase 1.
- It does not promise "real time". Cadence is a per-target setting; five minutes is the default and a tenant can go to one.
- It does not shorten phase 4. Sandbox connection and parallel run are where every estimate dies; they are quoted separately and honestly.

## 5. Decisions taken in this plan (say so if any is wrong)

1. Inbound is **pull** (IREAMS polls SAP) rather than SAP pushing to us. Pull needs nothing configured on the SAP side beyond a user, works through CPI or direct, and the watermark makes it restartable.
2. Change capture is **watermark on timestamps**, not triggers or a change-data-capture table.
3. **Ownership defaults**: SAP owns master data and orders; IREAMS owns readings, reliability results and PM cycle proposals. Per-tenant override.
4. The **simulator is a first-class deliverable**, not test scaffolding: it is the demo environment and the regression harness for every later change.
5. The Specialist writeback and the finance export become **families on the new outbox**; the old screens are retired once parity is proven, not before.

## 6. First step if approved

Phase 1, starting with the migration (`erp_targets`, `erp_outbox`, `erp_object_map` widened) and the exactly-once test, then the simulator, then the equipment round trip. Nothing goes near a real SAP until phase 4.
