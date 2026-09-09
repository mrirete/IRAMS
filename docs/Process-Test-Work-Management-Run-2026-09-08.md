# Work Management — Production Assurance Run, 2026-09-08

**Scope:** one work request driven end to end through five roles on the live tenant (dev server at port 5173, commit dec4989, same database as production). Script: `docs/Process-Test-Work-Management.md`, extended with two resources on the job, direct-API loophole probes, and database inspection after every step.

**Record under test:** REQ-2026-297180 → **WO-2026-01001** on PMP-411 *Boiler Feed Pump B* (criticality A). Raised 12:01, converted 12:04, planned 12:10, scheduled 12:13, in progress 12:16, technically complete 12:27, financially closed ~12:35 (WAT).

| Role | Account | Did |
|---|---|---|
| Requester / lead technician | J.tech | Raised the request; started, executed, wrote up and technically completed the job |
| Second technician | efosa01 | Posted time on step 2 |
| Supervisor | J.Supervisor | Reviewed, authorized, approved (converted); built 3 steps with instructions, crafts (2 people each), part |
| Planner | P.test1 | Due date, staging, Scheduled (+ notify), assigned J.tech as responsible person via Backlog |
| Sys admin | J.test1 | Financial close |

**Verdict:** the process runs end to end and the record at the end is rich (failure coding ELP/AGE, detection, subunit, effects, observations with photo, two people's time, derived downtime 6.5 h, frozen costs). But the database does not defend the process: terminal states, the cost freeze, and the append-only journal are page conventions only, and three save paths (task editing, completion, financial close) skip work the ordinary save path does.

## Findings register

Severity: **P0** data integrity / control failure · **P1** process step silently wrong or missing · **P2** honesty, clarity, master data · **P3** accepted / cosmetic.

### P0

| # | Finding | Evidence | Cause (code) |
|---|---|---|---|
| A | **Task steps multiply on every save once labour is planned.** 3 steps became 10 `job_tasks` rows after the supervisor's session; the UI showed 3. | Phase 3; console `[updateJobTasks] Error deleting tasks: 23503 … work_order_labor_job_task_id_fkey`. Repaired twice in test data (10→3). | `DatabaseService.updateWorkOrder` child sync deletes tasks before labour; the delete fails on the FK, the re-insert proceeds with new ids. Planner-only saves (status, dates) did not duplicate; any save carrying task edits does. |
| B | **A financially CLOSED order is not immutable at the database.** As J.tech via the API: status CLOSED→WIP accepted; posted hours 3.5→99 accepted; title rewritten. Through the UI: 0.5 h posted after close. | Phase 6.6, 7.2, 7.6, 7.10 (all reverted). | `freeze_costs_on_close` (0284) guards the cost columns only; `rbac_update_work_orders` / `rbac_update_work_order_labor` = `workOrders.edit`, tenant-wide, no state check. |
| C | **Terminal states and assignment are not enforced at the database.** J.tech cancelled WO-2026-01000 (someone else's SCHED order) and self-assigned it via the API. The pages hide those options for a technician. | Phase 7.3, 7.4 (reverted). | Same policy as B; the "accepted gap" in the 2026-09-06 script is now a demonstrated exploit. |

### P1

| # | Finding | Evidence | Cause (code) |
|---|---|---|---|
| 1 | **Completion through the Complete modal skips the save pipeline.** No `WIP → TECO` journal, no goods issue (seal stock 7 → 7, part line still `is_planned`), no "WO Technically Complete — review" notification to planner/supervisor, no email although the rule has EMAIL. Financial close: same (no journal, no notification). | Phase 5c, 6.0, 6.4 | `handleConfirmCompletion` and the financial-close handler call `DatabaseService.updateWorkOrder` directly; journaling, `issueWorkOrderParts` and `checkRules` live in `updateJob`/`persistToDb` (`WorkOrders.tsx:1412-1445, 1542-1561`). |
| 2 | **Planned craft lines are costed as actual labour.** Frozen labour 990.00 vs 502.50 of posted confirmations; step 1 `actual_hours` = 1 planned + 1 posted = 2.00. | Phase 6.4, 5.3 | `sem_wo_actual_lines` sums every `work_order_labor` row (`hours_worked × rate`), planned and posted alike, ignoring `headcount` and `confirmation_no`; task roll-up does the same. |
| 3 | **Save & close after a final time posting reverts the step.** Steps 2 and 3 ended PENDING with `actual_hours` null although each was posted as final. | audit_logs on `job_tasks`: server set COMPLETED, next client save wrote PENDING | Client task state is stale after `postConfirmation`; the WO save writes it back over the server roll-up. |
| 4 | **"Yes, Notify & Schedule" claims "Notifications sent to 2 recipient(s)" and sends nothing.** | Phase 4.3: zero rows for either technician | `DatabaseService.sendJobNotifications` is a stub that counts assignees and returns ≥ 1. |
| 5 | **Assigning people on task steps raises no notification.** Only the Backlog "Assign" (order-level `assigned_to`) notified J.tech. efosa01 never heard he was on the job. | Phase 3.4, 4.4 | No `notify` call on `job_tasks.assigned_user_ids` changes. |
| 6 | **The requester learns nothing during triage.** No notice on Review or Authorize; the "converted" notice never fires because Approve converts twice (second call throws `Workflow Violation`), which also leaves the panel on AUTHORIZED without the JOB RAISED banner until reload. | Phase 2.3, 2.4; console error | `ServiceRequests.tsx:194-221` — `handleApprove` converts, then `handleStatusChange(CONVERTED)` converts again; the throw skips `refreshData` and `checkRules`. No rule for REVIEW/AUTHORIZED. |
| 7 | **Notification dispatch runs in the sender's browser, sequentially, without retry.** Nine recipients take ~20 s; leaving the page after 6 s delivered 2 of 9 (the supervisor was among the missed). | Phase 1.3 vs diagnostic re-run | `NotificationService.dispatch` → per-recipient resolution and insert on the client; no server-side outbox for in-app rows. |
| 8 | **No permission gate on Close (Financial).** Offered to the technician and the supervisor; the 2026-09-06 script expected refusal without `finops.edit`. The DB accepts CLOSED from any `workOrders.edit` holder. | Phase 5c 5.10, 6.3 | `WorkOrders.tsx:1963-1971` renders the button on status alone. |
| 9 | **Technician can delete system journal rows via the API.** | Phase 7.5 (row restored) | `finops_delete_journal_entries` is tenant-only; no audit trigger on `journal_entries`. |
| 10 | **A request on a criticality-B system asset failed with "Could not submit request. Try again."** The reason is hidden from the user. | Phase 1b (SYS-500-WI) | Generic catch in `useCreateServiceRequest`; probable server-side validation/NOT NULL. |
| 11 | **Start Job in Work Orders › My Work Today writes nothing** (`onUpdateJob` is a no-op). Read in code, not exercised. | `WorkOrders.tsx:440` | — |

### P2

- Authorized-by renders a raw user UUID; fault type shows a raw UUID above its label; priority shows MEDIUM on the request panel while the form and the work order say EMERGENCY (`DataMapper.toUIRequest` hard-codes MEDIUM).
- No Requester Information card for the supervisor (contact resolution empty).
- Assignment from Scheduling › Backlog writes `assigned_to` directly: no "Assignment changed" journal, so nobody can see who assigned or when.
- Confirmation numbers are not unique: J.tech's three confirmations are all #2 (efosa01's is #3).
- Remedy is stored as narrative in `wo_failure_data.remedy_code` because no REMEDY_CODE dictionary is seeded.
- Subunit list for PMP-411 offers four generic entries (control & monitoring, misc, power transmission, structure); the seal system has no L7 home because the asset has no `asset_class`.
- Every notification rule exists twice in `notification_rules`; the SR_CREATED rule fans out to every SYS_ADMIN and REQUESTER-role contact (9 people including ai.developer).
- Any authenticated user can insert a notification addressed to anyone in the tenant (`INSERT WITH CHECK (true)` + tenant).
- Four of five technician logins (alex, bea, charlie, dana) have no person record and cannot be assigned.
- Desktop request card shows no request number (search by number works).
- Console: "value prop without onChange" on the request form; "Workflow Violation" on Approve; the scheduling override audit insert writes a username into the UUID `changed_by` column (code read).

### P3 / accepted
- The requester is notified about their own new request. The requester can move their own request to Under Review.

## What held

Request with mandatory ISO 14224 fault type on a criticality-A asset; supervisor Review → Authorize (stamped) → Approve creating WO-2026-01001 (CM, EMERGENCY, `request_id` link, created_by = supervisor); three steps with Checkbox / Text / Inspection instructions, craft lines (headcount 2), both technicians ticked, a part from stock; status changes OPEN→PLAN→SCHED→WIP journaled with author; due date and staging flag; Backlog assign notifies J.tech; both technicians see the job on My Work with a dated status sentence; ticks, observations and a photo persist; two people's time confirmations at their own rates; "assign yourself only" enforced for technicians; failure coding ELP / AGE, detection OBSERVATION, subunit, failed component, local and plant-wide effects; malfunction window 06:30–13:00 → downtime 6.5 h derived; TECO stamps `closed_at`; the DB refuses a technician creating a work order (403); financial close freezes and the Cost tab shows the snapshot; both technicians' Done tabs and the requester's JOB RAISED banner show the outcome.

## Recommendations (in order)

1. **State machine in the database.** A `work_orders` trigger/policy: CLOSED rows immutable except by an admin; CANC/CLOSED require `workOrders.approve`; `assigned_to` changes require `workOrders.assign` or self; labour/parts inserts and updates refused when `cost_frozen`; `journal_entries` update/delete admin-only plus an audit trigger. Closes A/B/C, P1-8, P1-9.
2. **Child rows by id, not delete-and-reinsert.** Upsert tasks/labour/parts by id with explicit `deletedIds`; delete labour and parts before tasks. Closes P0-A and P1-3.
3. **One save path for state transitions.** Route TECO and CLOSED through `updateJob` (or move journaling, goods issue and rule dispatch to DB triggers) so the record is complete whichever button was used. Closes P1-1.
4. **Cost model: planned vs posted.** Filter `sem_wo_actual_lines` and the task roll-up on `confirmation_no`; cost planned lines as `headcount × hours × rate` in a separate planned view. Closes P1-2.
5. **Notifications.** Server-side dispatch (outbox already exists for email — use it for in-app rows); remove the scheduling stub; notify task assignees; requester notices on Review/Authorize/Convert; fix the double convert; trim SR_CREATED recipients; dedupe rules. Closes P1-4..7.
6. **Master data.** Seed REMEDY_CODE; set `asset_class` on pumps so ISO 14224 pump subunits appear; link the four technician logins to person records.
7. **Clarity.** Names not UUIDs; consistent priority; request number on cards; unique confirmation numbers; a real error message when a request cannot be saved.

## Test-data notes

Repairs made during the run: 7 duplicate `job_tasks` rows deleted (twice checked afterwards); one system journal row restored after the delete probe (author `restored-by-test`); every API probe write reverted (status CLOSED, WO-2026-01000 back to SCHED/unassigned, hours 99 → 3.5, title, probe notification removed). Left in place as evidence: WO-2026-01001 (CLOSED, frozen labour 990.00), a diagnostic request `E2E-…-C` in NEW, and one 0.5 h confirmation posted after close.

Harness: Playwright (headless Chromium) with session injection per role, database probes through the Management API, findings log `findings.jsonl` (63 info, 53 OK, 5 P0, 32 P1, 18 P2 rows before de-duplication; several rows are corrected by later rows and consolidated above).


---

## Close-out — 2026-09-08, second run on REQ-2026-165819 → WO-2026-01002

Every finding above was closed the same day and the whole loop was driven again on a fresh request with the same accounts. Migrations 0340–0345 are applied to the origin project and recorded in the ledger.

| # | Closed by | Verified |
|---|---|---|
| P0-A duplicate task rows | Task ids minted once at creation (`crypto.randomUUID`), saves upsert by id; removed steps are deleted after labour/parts are re-synced, with posted confirmations detached first; "saved yet" tracked in `job.persistedTaskIds` | 3 steps → 3 rows through planning, execution and close; no FK error |
| P0-B closed order mutable | **0340** `enforce_wo_state_machine`: CLOSED / cost-frozen rows change only by admins; labour and parts writes refused when frozen | API reopen → `STATE_LOCKED`; hours edit → `COST_FROZEN`; title edit refused; UI posting after close → `COST_FROZEN` toast |
| P0-C terminal states / assignment | **0340**: CANC needs `workOrders.approve`, CLOSED needs `finops.edit`, `assigned_to` needs an Assign permission | technician cancel → `APPROVE_REQUIRED`; self-assign refused; supervisor financial close → `FINOPS_REQUIRED`; SYS_ADMIN close → CLOSED, frozen |
| P1-1 completion bypasses the pipeline | `runStatusSideEffects` shared by the ordinary save, the Complete modal and the financial close; SYSTEM journal stamps for `→ TECO` and `→ CLOSED` | journal carries WIP → TECO and TECO → CLOSED; goods issue ran ("1 part line consumed", movement 261, STR-MAIN 7 → 6); "WO Technically Complete — review" reached supervisor and planner in-app and by email (outbox SENT) |
| P1-2 planned labour costed as actual | **0341** `sem_wo_actual_lines` = confirmations only; new `sem_wo_planned_lines`; task roll-up and Cost tab filter the same way | frozen labour 502.50 = posted confirmations 502.50; step actuals 1.00 / 3.50 |
| P1-3 save reverts a completed step | Client reloads rolled-up rows into the pending save; **0344** `keep_confirmed_rollup` keeps COMPLETED / hours when a stale save carries none | race reproduced (stale write 0.6 s after roll-up) and closed at the DB |
| P1-4 scheduling notify stub | `sendJobNotifications` writes real `SCHEDULE_ALERT` rows to every task assignee and the responsible person; honest toast (0 recipients says so) | "Scheduling notice sent to 2 people on the job"; both technicians received "WO-2026-01002 is scheduled for Fri, Sep 11" |
| P1-5 task-step assignment silent | `runStatusSideEffects` diffs assignees against the last persisted order; manual Save keeps the pending change set | alex ticked on a step → "You're on WO-2026-01003" |
| P1-6 requester in the dark; double convert | Direct notices on Review and Authorize; convert is idempotent (fresh status read) | requester got "is being reviewed", "has been authorized", "WR Converted to Work Order"; panel shows JOB RAISED; no Workflow Violation |
| P1-7 slow, lossy dispatch | Recipients resolved in parallel, rows written in parallel | 3 recipients written within the same second as the request |
| P1-8 no gate on Close (Financial) | Button needs `finops.edit`; **0340** enforces it | hidden from technician and supervisor; SYS_ADMIN closes |
| P1-9 journal rows deletable | **0340**: update/delete admin-only or own non-system entry on an open order; audit trigger on `journal_entries` | technician delete refused |
| P1-10 system-asset request failed | A picked location/system is submitted as the request's asset; the toast names the real reason | REQ-2026-459238 raised on SYS-500-WI (HIGH) |
| P1-11 Start Job no-op | My Work Today's `onUpdateJob` writes the status through `updateWorkOrder` | code path wired (not driven in this run) |
| P2 UUIDs / priority | `authorizedByName` resolved; fault type shows its code; priority read back from the stored score (`lib/requestPriority.ts`) | "Authorized By: J.Supervisor", "ELP", EMERGENCY on the panel |
| P2 Scheduling journal / audit | `journalAssignment` on both Scheduling assign paths; override audit writes a uuid and jsonb | "Assignment changed: unassigned → … (P.test1)" in the journal |
| P2 confirmation numbers | Per-order sequence | #1, #2, #3, #4 on the second run |
| P2 remedy free text | **0343** seeds 13 ISO 14224 B.5 REMEDY_CODE rows (product standard) | Complete modal renders the coded select |
| P2 pump subunits | `asset_class = PUMP` on P-101-A, PMP-411, P-HX-105 (tenant data repair) | rotating subunits including `ROT_SEAL` offered |
| P2 unlinked technicians | Person records created and linked for alex, bea, charlie, dana (tenant data repair) | alex assignable and notified |
| P2 spoofed notifications | **0342**: insert requires `created_by` = caller; the app stamps it from the session | forged sender → 403; escalation sweep stamps the recipient's own session |
| P2 request fan-out | **0342**: SR_CREATED goes to requester, planner, supervisor, work-centre crew | 3 recipients instead of 9 |
| P2 request number on cards | Shown beside the priority pill | — |
| P2 on-hand not synced (found in run 2) | **0345** `sync_stock_on_hand` runs as definer; one-off resync | SL01 item master 7 → 6 |

**Corrections to the first report:** the "duplicate rules" were per-tenant copies behind a tenant-scoped read policy (not a defect; the 0342 de-duplication is a no-op); the missing supervisor notification was the dispatch being cut off when the requester left the page, not a resolution error; the Requester Information card and the authorized-by stamp were present (the check was case-sensitive against uppercase-rendered text).

**Design decisions taken:** technicians cannot self-assign at order level (they tick themselves on task steps); financial close is FinOps · Edit only (admins, asset managers) and cancellation is Work Orders · Approve; any user may still address an in-app notification to a colleague under their own name.

**Still open, by choice:** P3 requester notified about their own request; requester can press Review; the "Do work" toggle stays visible after TECO (postings are refused once closed).

**Follow-up decision, 2026-09-08 (option 1):** step-level assignment is Assign-only, the SAP PM position. **0346** `enforce_step_assignment` refuses any change to a step's assignees by a caller without `workOrders.assign` / `scheduling.assign` (no self-pickup, no self-removal), steps are immutable under a frozen order, and every change is journaled ("Step 0100 assignment changed: added J.tech"). The Resources checkboxes follow the matrix: technicians see them disabled with "Assignments are made by your supervisor or planner". Verified: technician add/clear via API → 403 `ASSIGN_REQUIRED`, step text still editable, own box disabled; supervisor assigns, journal line and notice written.


**Follow-up, 2026-09-08 evening (two more findings from the user's own testing):**

- **A technician's status save failed with `ASSIGN_REQUIRED`.** The page sent every step's assignee list on every save, so a stale copy tripped the 0346 gate on an unrelated edit. The save path now drops an unchanged assignee list from the step payload and drops a drifted one with a warning instead of failing the save. Verified: J.tech changed a step to IN PROGRESS and the order to WIP on WO-2026-01003 with assignees intact.
- **A technician could raise, approve (all four approval roles), issue and activate their own permit to work.** The PTW screen checked nothing and the matrix gave every line role safety view-only. **0347** re-seeds the matrix: TECHNICIAN safety view+create, PLANNER view/create/edit, SUPERVISOR view/create/edit/approve. **0348** enforces the lifecycle on `ptw_permits` / `ptw_approvals`: raise needs Safety · Create and the requester is stamped from the session; submit by the requester or a safety editor; approval steps, approve/reject, issue, suspend, resume and close need Safety · Approve by someone other than the requester (four-eyes); accept and return by the requester or permit holder; toolbox talk before issue; approver, issuer and receiver stamped from the session. The Safety tab buttons follow the same rule with explanatory tooltips. Verified end to end as J.tech and J.Supervisor (13 checks, including the four-eyes refusal when a supervisor approves their own permit).


## Execution record — 2026-09-09

**Trigger:** the user noticed low Work Readiness / Closeout scores and missing execution data (no estimate, no actual time, no close-out note) on the closed test orders.

**Execution test (fresh order, WO-EXEC-09091056, before the fix):** 3 steps planned at 1 / 4 / 1.5 h with instructions and crafts, both technicians assigned, 4 confirmations totalling 11 h, every step posted as final, failure mode and coded remedy at completion.

| Field | Expected | Before | After (WO-EXEC-09091125) |
|---|---|---|---|
| Order estimate | 6.5 h from the steps | 0 | 6.50 (rolled up, decimal) |
| Actual start / finish | stamped at WIP / TECO | no columns; "Completed" date saved into the void | 11:26:59 / 11:28:18, editable on the rail |
| Step 2 actual hours | 4.5 + 4 = 8.5 | 4.5 (second person ignored) | 8.50 |
| Order actual hours | 11 h posted | null unless typed | 11.00 (posted, read-only) |
| Waiting reason | asked and shown | nothing | "coupling insert from stores · since 11:27", cleared on resume |
| Close-out note | always asked | hidden once any journal row existed | required (≥ 10 chars), journal type **Closeout** |
| Completed by / accepted by / handed back / closed by | on the record | reviewed_by columns existed, never written | J.tech · J.Supervisor (note) · J.tech · (at close) |
| Required by | from priority | nothing | P3 → +7 days, editable |
| Committed start / released by | first schedule | nothing | stamped on first SCHED |
| Closeout Quality | honest | 88 % "Ready to close" on system lines alone | 82 % at TECO, 91 % after supervisor acceptance; system lines no longer count |
| Readiness after execution | quiet | "1 planning item to complete before scheduling" on a finished job | "1 planning item was missing when this job was executed" |

**Shipped:** migration **0349** (columns: required_by, committed_start, released_at/by, actual_start_at, actual_finish_at, completed_at/by, closed_by, wait_reason/since, reported_by, planner_id, handed_back_at/by; job_tasks.completed_at/by; `stamp_wo_execution` BEFORE INSERT/UPDATE stamps and forces the roll-ups; `rollup_confirmations` AFTER on work_order_labor sums every posted confirmation on the step and the order and marks the step COMPLETED with completed_by on a final posting; `rollup_step_estimates`; backfill of all existing orders) and **0350** (est_duration integer → numeric(8,2), sem_work_orders recreated around it). Page: Waiting prompts for a reason and journals it; Complete modal always asks for the close-out note and shows posted hours read-only; Accept work (workOrders.approve) and Hand back (edit) on TECO orders write the review and hand-back columns and journal it; Details rail rebuilt: Required by, Due, Committed, Est. hours (from steps), Est. downtime, Waiting for, Actual start / finish, Hours worked vs plan, Completed / Accepted / Handed back / Closed by. Scores: `assessCloseout` counts human entries only, adds Close-out note (required for corrective) and Accepted by supervisor; readiness strip stops nagging after execution; `woTimeline` reads the stamps and the waiting reason.

**Still open:** reported_by and planner_id exist but have no UI yet (planner picker on the Details tab is the natural place); the Cost tab's variance uses the same posted figures but does not yet show plan vs posted hours per step.


### Complete form, verdict applied (2026-09-09 afternoon)

The user asked where actual finish lives, whether the actuals on the Complete form are necessary, and why a "close-out note" existed beside Journals & Notes. Verdict and result:

| Field on the form | Verdict | Now |
|---|---|---|
| Actual labour | Deduced from confirmations | Posted total shown read-only; with nothing posted, the hours typed become a final confirmation for the person completing |
| Equipment downtime | Derived from the malfunction window | Box removed; derived by the existing trigger, correctable on the Details rail |
| Malfunction start | The failure event, not deducible from tasks | Kept for corrective work, pre-filled from the request's reported time (else order creation) |
| Back in service | Defaults to work finished | Kept, pre-filled |
| Breakdown | Only the person knows | Kept, corrective only |
| Work finished | The SAP reference time, was missing | Added, pre-filled from the latest step completion or posting, editable; written to actual_finish_at |
| Close-out note | Duplicate of Journals & Notes | One shared `JournalComposer`; Close-out is a journal type in both places; an earlier Close-out entry satisfies completion; recent entries shown for context |

Actual finish is visible on the Details rail (Schedule card) and on the lifecycle rail under the title.
