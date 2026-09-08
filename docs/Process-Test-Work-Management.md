# Work Management — Role-Based Process Test

**Date prepared:** 2026-09-06 · **Migrations required:** 0321, 0322, 0323 (all applied to `hacrebcfvyqdnjvilhqc`) · **Frontend:** the role-template changes (supervisor authorises requests, technician sees people) live in the bundle — run the test on the local dev server (`npm run dev`, port 5173) or after the next Vercel deploy.

## Accounts

| Role | Username | What they should be able to do |
|---|---|---|
| REQUESTER | `requester01` | Raise and follow their own requests. Nothing else. |
| SUPERVISOR | `J.Supeervisor` (note the double *e*) | Review + authorise requests, assign people, move the schedule, approve/cancel work orders, view the crew's JSAs. |
| PLANNER | `P.test1` | Approve and convert requests, plan tasks/labour/parts, own PM strategies, schedule and assign. |
| TECHNICIAN | `J.tech` | Execute assigned work: start, confirm time, observations, complete with failure coding, raise a follow-up. Per-user override: create/edit task library templates. |
| SYS_ADMIN | `J.test1` | Financial close. Anything the others cannot. |

Passwords: `IREAMS_TEST_PASSWORD` in the repo-root `.env.local`. Log in with the username; the login screen maps it to `<username>@cainergy.com`.

**Before starting:** every account signs out and back in once. Tenant membership is carried in the login token (0321) and is only refreshed on a new sign-in.

## The process (one request, end to end)

Work through the rows in order. Each row names the account, the action, and what must happen. A ✗ row is a *negative* check: the action must be refused, and the refusal must be visible (disabled control, tooltip or toast), never a silent no-op.

### 1 · Raise (requester01)
| # | Action | Expected |
|---|---|---|
| 1.1 | Sidebar | Home, Requests, Assets (view), Notifications, Specialist (view). **No** Work Orders, Scheduling, Recurring Work, Inventory, Contacts. |
| 1.2 | Requests → Raise Work → only the **Request** kind is offered → pick an asset, describe the fault, submit | Request created in **NEW**. |
| 1.3 | Requests list | Only this user's own requests are listed. |
| 1.4 ✗ | Open the request → Review / Authorize / Approve | Review is enabled (requester may hand it on); Authorize and Approve are disabled. |

### 2 · Triage (J.Supeervisor)
| # | Action | Expected |
|---|---|---|
| 2.1 | Requests | All requests in the company are visible, including 1.2. |
| 2.2 | Open it → **Review** | Status → REVIEW. |
| 2.3 | **Authorize** | Enabled (0323). Status → AUTHORIZED, authorised-by stamp shows the supervisor. |
| 2.4 | Leave Approve to the planner | (Supervisor *can* approve too; the split is the test.) |

### 3 · Plan (P.test1)
| # | Action | Expected |
|---|---|---|
| 3.1 | Requests → the AUTHORIZED request → **Approve & Convert** | A corrective work order is created (OPEN), request → CONVERTED, "Job raised" badge. Requester gets a notification. |
| 3.2 | Work Orders → open it → Details | Status dropdown offers OPEN / PLAN / SCHED / WIP / WAIT / TECO / CLOSED / CANC. |
| 3.3 | Tasks → add a task from the Task Library, add a labour line (craft), add a part | Task, labour and part lines save. |
| 3.4 | Tasks → Resources → tick **J.tech** as assigned | Checkbox enabled (planner holds `assign`). J.tech gets an assignment notification. |
| 3.5 | Scheduling → drag the WO onto a date | Moves; status → SCHED. |
| 3.6 | Scheduling → MRS or Backlog → assign to J.tech | Assignment saved. |
| 3.7 | Recurring Work → **New** → create a monthly PM on the same asset with one task → **Generate** | New / Save / Generate enabled. A PM work order appears in Work Orders (`recurring_work_id` set). |

### 4 · Execute (J.tech)
| # | Action | Expected |
|---|---|---|
| 4.1 | Sidebar | Home, My Work, Requests, Work Orders, Recurring Work (view), Scheduling (view), Assets, Inventory (view), Readings, Task Library, **Contacts (view — new)**, Notifications, Specialist. |
| 4.2 | Raise Work | Only **Request** is offered — no direct Work Order, no PM. |
| 4.3 | My Work | Both work orders from step 3 are listed, assignee shows **J.tech's name** (not blank — that was the contacts gap). |
| 4.4 | Open the corrective WO → **Start** | Status → WIP. |
| 4.5 | Tasks → Resources → post a time confirmation for yourself | "Worked by" defaults to J.tech; posts; labour actuals show a value. |
| 4.6 | Tasks → Resources → try to tick anyone, yourself included | Every checkbox **disabled** with "Assignments are made by your supervisor or planner". Assignment at step level needs Assign, like the order-level responsible person (0346, 2026-09-08). |
| 4.7 | Details → status dropdown | **No** CANC / CLOSED options (edit only, no approve). |
| 4.8 | Instructions → tick steps, add an observation with a photo | Saves; observation visible inline. |
| 4.9 | **Complete** → fill failure coding (failure mode, cause, remedy) → tick *defect found* → complete | Status → TECO. A **follow-up corrective WO** is created and linked (parent) — this failed at the database before 0323. |
| 4.10 ✗ | Scheduling → drag any item | Toast: "view the schedule but not move work". Nothing moves. |
| 4.11 ✗ | Recurring Work → New / Save / Delete / Generate | All disabled with "Needs Recurring Work · …" tooltips. |
| 4.12 | Task Library → New / Edit | Allowed (per-user override on J.tech). **Delete** refused. |
| 4.13 | Execute the PM work order from 3.7 the same way (4.4 → 4.9) | Completes; Recurring Work shows the last-done date advanced. |

### 5 · Supervise (J.Supeervisor)
| # | Action | Expected |
|---|---|---|
| 5.1 | Work Orders | The follow-up WO from 4.9 is listed (OPEN, priority HIGH or EMERGENCY). |
| 5.2 | Open it → Tasks → Resources → assign J.tech | Enabled. |
| 5.3 | Open the completed WO (TECO) → Details → status dropdown | CANC and CLOSED **are** offered (approve). Do not close here — closing is financial. |
| 5.4 | Scheduling → move the follow-up onto tomorrow | Moves. |
| 5.5 ✗ | Work Orders → **Close (Financial)** on the TECO order | Refused: needs `finops.edit`, which the supervisor does not hold. |

### 6 · Close (J.test1)
| # | Action | Expected |
|---|---|---|
| 6.1 | Work Orders → the TECO order → **Close (Financial)** | Status → CLOSED; costs settled. |
| 6.2 | Try to edit anything on it | Frozen (freeze-at-CLOSED). |
| 6.3 | Admin → Ops Health | "Logins without company" = 0, "unlinked persons" = 0. |

## What each layer enforces (for when a step fails)

| Step | Page check (what the button reads) | Database check (what RLS enforces) |
|---|---|---|
| Raise request | `requests.create` | tenant only |
| Review | `requests.edit` | tenant only |
| Authorize | `requests.authorize` | tenant only |
| Approve & Convert | `requests.approve` + WO insert | `workOrders.create` |
| See all requests vs own | — | `caller_can_view_all_requests()` (PLANNER, SUPERVISOR, MANAGER, EXECUTIVE, RELIABILITY_ENG, admins) |
| Edit / start / complete WO | `workOrders.edit` | `workOrders.edit` |
| Cancel / Close from dropdown | `workOrders.approve` | `workOrders.edit` |
| Assign people to a task | `workOrders.assign` or `scheduling.assign` (self always) | `workOrders.edit` |
| Move on the schedule | `scheduling.edit` | `workOrders.edit` |
| Follow-up WO from completion | — (raised for you) | `workOrders.create` **or** `parent_wo_id` + `workOrders.edit` |
| PM order generation | `pm.edit` | `recurring_work_id` + `pm.view` |
| PM strategy create/edit/delete | `pm.create` / `pm.edit` / `pm.delete` or admin | tenant only / admin (delete) |
| Task library | `taskLibrary.create/edit/delete` | tenant only |
| See people (names, assignees) | — | `contacts.view` |
| Financial close | `finops.edit` | `workOrders.edit` |

Where the database column says *tenant only*, the page is the gate. Where the page column says *—*, the database is.

## Known, accepted for this test
- A technician can issue parts against a work order (inventory transactions are tenant-only at the database; the WO parts tab does not check `inventory.edit`). Storekeeper separation is a later decision.
- A requester can press **Review** on their own request (`requests.edit`). Harmless; moves it into the supervisor's queue.
- Cancelling or closing from the status dropdown is refused by the page for a technician, but the database would accept it if called directly (`workOrders.edit`). A DB-level gate on terminal states is future work.
