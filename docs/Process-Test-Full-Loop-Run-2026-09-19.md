# Full-Loop Assurance Run — 2026-09-19 (PM → WO → spares → PO → people → scheduling → finance)

**Scope:** one preventive job driven end to end on the live tenant (dev server, commit dfb886f) as planner P.test1, supervisor J.Supervisor, technician J.tech and sys-admin J.test1, with the database read after every step. Harness and 78 screenshots: session scratchpad `e2e/`. Published page: see memory `full-loop-assurance-run-2026-09-19`.

**Record under test:** PM-72404 *ZZ-E2E Gasket change LCV-001* (LCV-001, criticality B) → WO 2026-825423 (PLAN → SCHED → WIP → TECO → CLOSED) · PO-2026-7714 (NOV, 2 × 64379-Gasket @ 15.00) → GRN-2026-000001 → INV-ZZ-E2E-001 matched · labour 2 h @ $40 frozen 80.00 · material frozen 30.00. Records left in place as evidence (ZZ-E2E prefix).

**Verdict:** the loop closes, but the record at the end is wrong in ways a user cannot see. 1 P0 · 13 P1 · 16 P2 · 8 P3.

## Stage verdicts

| Stage | Result | Notes |
|---|---|---|
| Plan the schedule | PASS | PM-72404 built through the UI by the planner: 2 steps, J.tech 2 h @ $40 pinned to a step, 2 parts, hazard with matrix. Readiness 100 %. |
| Raise the order | PASS | Generate dialog → WO 2026-825423 landed as PLAN with J.tech, rate, step link, JSA copied, 7 notices sent. |
| Reserve & buy | MIXED | Reservation netted correctly. PO-2026-7714 → authorised → GRN-2026-000001 → invoice matched → completed. But the first line save was lost, an empty order was authorised, and no budget ever moved. |
| Schedule | MIXED | Assign from Backlog notified J.tech but left the order in PLAN; frozen-zone override worked; Resources grid is empty; no schedule notice or journal. |
| Execute | FAIL | Staging gate held. JSA authorised by one person; WIP allowed without it. The technician's first save deleted a planned step. Time posting, observation, goods issue and TECO worked. |
| Close & settle | MIXED | Financial close froze labour 80 and material 30 and refuses new postings. Settlement has no cost-centre receiver; reservations never released; schedule history says "Never completed". |

## Findings register

Severity: **P0** data integrity · **P1** process step wrong or silent · **P2** honesty, clarity, master data · **P3** cosmetic.

| # | Sev | Area | Finding | Evidence |
|---|---|---|---|---|
| 1 | P0 | Execution · data loss | The technician's first ordinary save (status → Work In Progress from the Details tab) deleted BOTH planned steps and re-inserted only step 1: audit_logs 23:56:25.532 DELETE 4404aaf8 (step 20 "Replace seat-ring gasket", 2 h, the step carrying the planned labour) + DELETE 1b8c8bb3, then 23:56:25.797 INSERT 1b8c8bb3 only. Step 2 never came back; the planned labour line lost its step link (job_task_id NULL); est_duration fell 7 → 5. The save pipeline still treats the client's in-memory step list as the truth and deletes whatever is not in it (updateWorkOrder → staleTaskIds delete), so a save that did not touch steps can destroy planned work | audit_logs job_tasks/work_order_labor for WO 2026-825423 at 23:56:24–26; DatabaseService.ts:3243 |
| 2 | P1 | UX · Shortage | Planner plans 2 gaskets with 0 on hand and the order page shows no shortage or "raise a purchase" cue — the gap only appears at scheduling (Material Check) or at goods issue | gasket soh=0 |
| 3 | P1 | Generate → crew | The plan names J.tech on the labour line, but the generated order's step shows "Assigned: 0 of 1 filled" — step assignees (job_tasks.assigned_user_ids) are not derived from the labour line, so the planner must assign the same person again on every step | assigned_user_ids empty on both steps; work_order_labor.contact_id = J.tech |
| 4 | P1 | WO parts | Changing a planned part quantity in the step drawer does not persist: the UI shows 2 and $30, every autosave and Save & close write quantity 1. Cause: toDBJobInventory writes actualQty ?? estQty and toUIJobInventory seeds actualQty from the stored quantity, so an estQty edit is overwritten by the stale actual on save | DataMapper.ts toDBJobInventory/toUIJobInventory; POST work_order_parts 200 with quantity 1 |
| 5 | P1 | Finance | An authorised PO whose lines carry no cost centre (and whose header cost centre is empty) never reaches budgets.committed — the commitment is invisible to Finance and nothing on the PO warns about it | {"cost_center_id":"7a6dadb3-8d6b-4696-bd71-549baad4ba34","committed":0,"actual":15} |
| 6 | P1 | PO | On a freshly created PO, the first Save after adding a line persisted nothing (reproduced once; a second Save after reload wrote the line), and Authorise ran the budget check on the empty order ("No lines carry a cost centre") and still returned Within budget — so an order with no lines and no receiver was authorised and its cost centre locked | PO PO-2026-7714: status OPEN, authorized_at set, purchase_order_lines = 0 |
| 7 | P1 | Finance · WO | The Cost Centre picked on the order is written to work_orders.cost_center (a text column); work_orders.cost_center_id — the column settlement, the budget check and the PO line receiver read — stays NULL. Consequences seen in the run: the generated order had no receiver, settlement posted LABOR 80 + MATERIAL 30 to the asset only (cost_center_id null), and the 1000-MAINT budget actual never moved | cost_center=7a6dadb3… cost_center_id=null after choosing 1000-MAINT |
| 8 | P1 | Scheduling | Backlog › Assign writes only the assignee: the order stays in PLAN with no scheduled date, so "assigned" and "scheduled" diverge (the Resources-grid drop sets person + date + SCHED; this path does not) | status PLAN after Assign to J.tech; notification "New Assignment" sent |
| 9 | P1 | Scheduling · Resources | Multi-Resource Scheduling shows no labour resources although J.tech is a TECHNICIAN contact — contacts lack the labour flag / working-day configuration | No labor resources found Configure contacts as labor in the People module. |
| 10 | P1 | JSA gate | Work on a criticality-B asset started while the JSA was not authorised — nothing blocks WIP on JSA status | jsa DRAFT |
| 11 | P1 | JSA governance | The supervisor alone authorised the JSA by signing all three pads, including "Worker" — no four-eyes on the JSA (PTW has it, the JSA does not) | status AUTHORIZED with one person |
| 12 | P1 | Task Library → execution | Task Library templates store each instruction's text in block.description (e.g. "Isolation and Safe Area Preparation"), but the PM import, the WO step drawer and Do-work mode read block.label — so a library step arrives as five empty TEXT blocks and the technician sees five identical "Technician observation" boxes with no instruction text at all | task_library_items "LCV-001 Leakage": 5 TEXT blocks with description set and no label; WO job_tasks step 1 labels empty; p4-tech-step1-dowork.png |
| 13 | P1 | Inventory · reservations | Reservations are not released when a technician completes the order: after TECO the gasket still shows reserved 2 (no open order holds it) and the seal reserved 2 (one open order holds 1). stock_on_hand was released correctly (sync_stock_on_hand is SECURITY DEFINER since 0345) but sync_stock_reserved runs under the caller's RLS, and a technician may not update inventory_items — the same silent-no-op class 0345 fixed for on-hand | trg_sync_stock_reserved_wo enabled; stock_reserved gasket=2 seal=2 vs open-order sums 0 and 1 |
| 14 | P1 | State machine | Technician can still rewrite a technically-complete order through the API (title changed) | PATCH 200 |
| 15 | P2 | UX · PM create | Create modal defaults to raising the first order immediately — before steps, labour, parts or JSA exist, so the first order is always unplanned |  |
| 16 | P2 | PM Inventory | Picking a catalogue part on the schedule always saves unit cost 0 — the PM reads unitCost/unit_cost but the catalogue rows carry itemCost, so Est. Material Cost is $0 and the generated order's part lines are valued at $0 (gasket is $15 in the catalogue) | templates.inventory cost:0 for 64379-Gasket; WO parts unit_cost 0 |
| 17 | P2 | UX · PO | Creating a PO offers no view of open demand (reserved but unstocked parts) — the buyer must know the shortage exists | PO Details tab |
| 18 | P2 | Governance | The same planner created, authorised, will receive and will invoice-match the PO — no segregation-of-duties control (requester ≠ approver) on purchasing, unlike PTW four-eyes | P.test1 holds purchasing.create+approve |
| 19 | P2 | PO | Cost centre is locked once authorised, and authorisation was allowed before any receiver existed — a PO can end up permanently without a budget receiver | PO rail: "— none —", select disabled after Authorise |
| 20 | P2 | PO | PO status after full receipt is OPEN, expected ALL_RECEIVED |  |
| 21 | P2 | UX · PO | Complete (and every line edit) changes the order only in memory until Save is pressed — after confirming "Complete PO" the database still said OPEN; a user who closes the tab loses the completion. Receipt is the one action that writes immediately | status OPEN after confirm, COMPLETED only after Save |
| 22 | P2 | UX · Scheduling | No "Send Notifications?" prompt when moving the order to Scheduled from the Details tab |  |
| 23 | P2 | Notifications | Moving the order to Scheduled sent J.tech no "scheduled for <date>" notice — he has the generation notice and the assignment notice only | ["New Assignment: 2026-825423","PM assigned to you: 2026-825423"] |
| 24 | P2 | Audit | No journal entry records the move to Scheduled (assignment change is journaled, the status change is not) | ["Assignment changed: unassigned → c8980be"] |
| 25 | P2 | Review | Accept work on the TECO order did not stamp reviewed_by/reviewed_at (dialog dismissed without a write) — reproduced once; unverified after financial close because the action disappears on CLOSED orders | {"status":"TECO","reviewed_by":null,"reviewed_at":null,"review_notes":null,"handed_back_at":null} |
| 26 | P2 | PM History | History strip still says "Last completed: Never" after the generated order was completed and closed — complianceData is not written back to the schedule | LAST COMPLETED Never WOS GENERATED 1 COMPLET |
| 27 | P2 | UX · People | Add Person asks only Username, Description, System Role and password: no e-mail (the login becomes <username>@cainergy.com, against the launch rule of company-e-mail sign-in), no hourly rate, no craft or "Is Labour" flag — so a new technician is priced at the default rate and never appears on the scheduling grid until someone edits the record elsewhere |  |
| 28 | P2 | UX · Vendors | Vendor detail does not show the vendor's purchase orders, receipts or invoices — no supplier history from the People side | NOV: PO-2026-7714 not listed |
| 29 | P2 | UX · Technician landing | On a phone the technician's Work Orders page opens on the whole plant's list (All Work Orders, priority sort, a greyed-out "New Work Order" button he cannot use) instead of the My Work Today cockpit; My Work itself is a list of links with no Start/Complete actions | p3-mywork-today-tech.png, p3-mywork-tech-mobile.png |
| 30 | P2 | Roles & notifications | There is no FINANCE role template (finops is admin/manager/executive only) and no STOREKEEPER login in the tenant, while the seeded notification rules target roles named Finance, Budget Holder, Area Authority and HSE that exist in no template — PO approval, budget-threshold and PTW notices have nobody to reach | rolePermissions.ts; 0053a_seed_notification_rules.sql; users census 2026-09-19 |
| 31 | P3 | UX · step drawer | Parts footer renders a broken character: "2 items � 3.0 total qty" | p1e-before-save.png |
| 32 | P3 | UX · People | Directory lists virtual "SYS-USER / System Account" rows for logins without a contact — noise for an admin looking for people | 2 rows |
| 33 | P3 | UX · Journal | The assignment journal reads "Assignment changed: unassigned → c8980be6-…" — a raw contact uuid instead of the person's name, and "unassigned" although the generator had already assigned J.tech | journal_entries on WO 2026-825423 |
| 34 | P3 | UX · PM Details | The schedule's "Est. Duration (hrs)" field (3 h) is independent of the steps (5 h + 2 h); the generated order shows 7 h, so the planner's number is silently replaced | PM-72404 est_duration 3 vs WO est_duration 7 |
| 35 | P3 | UX · WO schedule rail | "Required by" is derived from priority (P4 → +30 days = 18 Oct) and sits after the Due date (18 Sep) on a PM raised on its due day — two dates that contradict each other in the same panel | p1b-wo-details-planner.png |
| 36 | P3 | UX · Inventory history | Movement history rows show 101/261 with no document reference — neither the GRN number nor the work order number that caused the movement | p6-inventory-history.png |
| 37 | P3 | UX · Notifications | The PO authorisation notice is typed APPROVAL_REQUIRED ("Purchase Order Authorised") — an information notice labelled as an action request; the TECO notice "WO Technically Complete — review" is sent twice | notifications table after phases 2 and 4 |
| 38 | P3 | UX · Purchasing | The PO header "Print" button has an empty click handler; "Duplicate" and "Complete" sit beside it with no indication that Complete needs a Save afterwards | PurchaseOrders.tsx:363; phase 2c |

## What held up

- A fully planned schedule now raises a Planned order: person (users.id), rate, headcount, step link and JSA all copy (yesterday's 0369/0370 fix, verified live).
- ATP reservation netting reacts to every planned quantity; the Material Availability Check at scheduling reads it.
- Purchasing spine: line rows, authorisation with budget check, sequence-issued GRN, stock 0 → 2 with a 101 movement, line-level three-way match "cleared for payment".
- Execution record: actual start at WIP, 2 h confirmation valued at the person rate ($40), final posting closes the operation, observation persists on the block, goods issue 261 at TECO, actual finish stamped.
- Financial close: cost frozen (labour 80.00, material 30.00), COST_FROZEN refuses a post after close, settlement rows written with the asset as receiver, sem_wo_settlement reconciles to 110.00.
- Frozen-zone override demands a written reason; the PM generation trigger notifies planners and the assignee; My Work shows the assigned order on a phone.
- Role gates held where tested: technician denied Purchasing, FinOps and Vendors; costs hidden ("Resources" tab); no Cancel/Close in his status list.

## Fix order (by how much of the register each retires)

1. **Stop the save pipeline from deleting steps** — Make step deletion an explicit user action (the Delete step button) and never a side effect of a status or field save; refuse server-side to delete a step that carries planned labour, parts or a confirmation. This is the P0 and it is the same bug class as 2026-09-08 P0-A.
2. **Give the order one cost-centre column** — Write work_orders.cost_center_id from the Details select (retire the text column), default it from the schedule / asset, and make the PO line inherit it. Every finance finding (no receiver, budget never moving, PO authorised without one) follows from this.
3. **Release reservations under a definer** — Make sync_stock_reserved SECURITY DEFINER like 0345 did for on-hand, and resync once.
4. **One field for instruction text** — Task Library blocks must carry label; migrate description → label for existing templates and render label in Do-work mode above the observation box.
5. **JSA and PTW share one rule** — A pad accepts only the signed-in user's own role; WIP on criticality A/B is blocked until the JSA is authorised (the PM already promises "JSA required before activation").
6. **Seat the person on the step** — When the labour line names a person, put them in job_tasks.assigned_user_ids for the step it is pinned to, so the drawer reads "1 of 1 filled" and My Work Today lists the job.
7. **Make scheduling one action** — Backlog › Assign should take a date and move PLAN → SCHED, send the "scheduled for" notice and journal it; the Resources grid needs contacts flagged as labour by default for technician roles.
8. **Purchasing writes when you act** — Persist Complete, Save and line edits immediately (receipt already does); refuse Authorise on an order with no lines or no receiver; derive ALL_RECEIVED on receipt; show open demand (reserved > on hand) when a PO is created.

## UI/UX recommendations

- **Shortage never surfaces to the planner** — A planned part with 0 available should show an amber "0 of 2 available — raise a purchase" line on the step and on the readiness strip, with a one-click PO that pre-fills vendor, quantity, cost centre and job link.
- **Technician lands on the plant, not his day** — Open technicians on My Work Today with Start / Complete on the card; hide "New Work Order" for roles that cannot create.
- **Do-work mode shows instructions, then the answer box** — Instruction text first, observation second, and one observation box per step rather than one per block when the blocks carry no text.
- **Create-PM modal** — Default "Raise the first work order now" to off, or explain that the first order will be unplanned.
- **Dates that agree** — Required-by should never be later than Due; the schedule's Est. Duration should read from its steps.
- **Names, not ids** — Journals and audit lines show people's names; movement history shows the GRN or work-order number.
- **People setup in one pass** — Add Person collects e-mail, craft, hourly rate and "schedulable labour" — the four things every later screen depends on.
- **Vendor page as supplier history** — Purchase orders, receipts and matched invoices on the vendor record.

## Method notes

Headless Chromium per role (session injection), real screens, then REST reads of recurring_work, work_orders, job_tasks, work_order_labor, work_order_parts, inventory_items, purchase_order_lines, goods_receipts, invoice_matches, cost_allocations, budgets, notifications, journal_entries, audit_logs; direct API probes as the technician at TECO and CLOSED. Two harness mistakes were excluded (mis-targeted quantity input; mis-read part picker). "Accept work did not stamp" was seen once and could not be re-checked after financial close.
