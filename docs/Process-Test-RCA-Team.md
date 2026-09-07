# Process test — RCA as a team (technician + supervisor)

**Date:** 2026-09-07 · **Investigation:** "E2E open items 1788787548576" on P-101-A (Primary Feed Pump A, criticality A, 4 CM work orders in 12 months, 2 prior RCAs) · **Facilitator:** admin001 · **Team:** J.tech (TECHNICIAN, editor) and J.Supeervisor (SUPERVISOR, reviewer) · **Driver:** scripted browser sessions per user against the dev server and the live project.

## What worked

- Invite: the Study Team panel finds both people by username, adds them with a role, and each receives an in-app "RCA Team Invitation" pointing at the investigation.
- Both invitees can open the investigation, see the team with roles, the owner chips, the work-order and MOC chips on step 5, and the printable report.
- The rule-based method suggestion reads the asset: criticality A gave "Fault Tree" with its reason; a technician switching method meets the "causes recorded under 5-Why" pause before the switch.
- A technician raising work from an action is offered a maintenance request only, never a work order — the notification → order split holds.
- Step 6 verification stays locked for everyone until every action is complete.
- Pareto lists P-101-A among the bad actors.

## Loopholes

| # | Sev | Area | Finding | Evidence |
|---|-----|------|---------|----------|
| 1 | P1 | Permissions | TECHNICIAN and SUPERVISOR are `reliability: VIEW_ONLY` in `rolePermissions.ts`, yet the investigation page has no permission checks at all and every `ers_rca_*` INSERT/UPDATE/DELETE policy is tenant-only (`company_id = caller_company() AND true`). The technician edited and saved the problem definition, added evidence, added a corrective action, and could have committed a method, deleted evidence or deleted the investigation. | Saved statement read back as J.tech; `pg_policies` for `ers_rca_investigations/nodes/evidence` |
| 2 | P1 | Notifications | Any non-admin notifying someone else fails: `createNotification` does `insert().select().single()`, but the SELECT policy only allows the recipient or an admin to read a notification, so the returning read is refused (42501) and the insert rolls back. A technician assigning an action to the supervisor produced no notification. Admin-sent invites work only because admins pass the policy. | J.tech console: `new row violates row-level security policy for table "notifications"`; `p2_select_notifications` |
| 3 | P1 | Sign-off | "Close Investigation" (step 6) renders for anyone on the page; there is no owner/reviewer sign-off, no role check, and closing needs only "all actions complete". The reviewer role is a label. | `RCAInvestigationPage` step-6 footer; collaborator roles are never read by page or DB |
| 4 | P2 | Pareto → RCA | Every investigation is created with `trigger_type = 'manual'`, including ones started from Pareto ("Initiated from Pareto analysis" lands only in the description). The method rule, the "repeat failure" test for the DE hand-off, and reporting cannot see a Pareto origin; nor can an existing RCA be marked as a bad-actor study later. | `createRCAInvestigation` payload; `handleInitiateRCA` in `AnalyzePage` |
| 5 | P2 | Audit trail | None of the edits, evidence, method commits or actions wrote an `ers_rca_audit_log` row; the "Audit Log History" on step 6 only ever records the close. Who changed what, and when, is not recoverable. | `ers_rca_audit_log` empty after the whole walkthrough |
| 6 | P2 | Access scope | Team membership does not scope access: anyone in the tenant with the reliability view permission can open, edit and close any investigation, invited or not. The team is a notification list, not an access list. | Policies above; page reads `collaborators` only to render avatars |
| 7 | P3 | Method gate | A method committed earlier (5-Why) survives a rewrite of the problem statement with no prompt to reconsider; a new team member lands on the committed banner and must find "Change method". | Technician session |
| 8 | P3 | Invite UX | Adding a person means clicking the result row; the only affordance is a faint person-plus icon at the far right, with no "Add" button. | Team panel screenshot |
| 9 | P3 | Test accounts | J.tech and J.Supeervisor could not sign in with the shared test password; both were reset to it by the facilitator for this test. The supervisor's username carries a typo ("Supeervisor"). | `auth.users` update 2026-09-07 |

## Fixes shipped (same day, migrations 0332 + 0333)

| # | Fix | Verified by |
|---|-----|-------------|
| 1, 6 | `rca_can_edit(inv)` / `rca_can_close(inv)` + policies on every `ers_rca_*` table: read tenant-wide; create = reliability create/edit or admin; edit = admin, reliability.edit, the creator, or a team **owner / editor**; close = admin, the creator, or a team **owner / reviewer**; delete = admin. The page mirrors this: view-only banner, disabled Save / add / method cards, sign-off button with the reason. | Outsider technician (bea): banner shown, PATCH → 0 rows, INSERT evidence → 42501, DELETE → 0 rows. Team editor (J.tech): edits saved. |
| 2 | `createNotification` inserts without reading the row back (id generated client-side). | J.tech assigned an action to J.Supeervisor → "Corrective action assigned" reached the supervisor. |
| 3 | `trg_rca_investigation_close_guard`: closing needs owner / reviewer / admin **and** a recorded effectiveness verdict; a reviewer may change only the sign-off columns. Button reads "Sign off & close as team reviewer". | J.tech PATCH closed → RCA_CLOSE_DENIED; supervisor: button disabled until verdict, then closes; audit row `closed@j.supeervisor`. |
| 4 | `trigger_type` stamped from the entry point (Pareto drill drawer and the row "Investigate" both pass `pareto`); step 1 has a Trigger select. | Pareto → Initiate RCA → new investigation opened with Trigger = "Pareto / bad actor" and saved `trigger_type = pareto`. |
| 5 | `trg_rca_audit` on investigations, nodes, evidence, actions, barriers writes `ers_rca_audit_log` (SECURITY DEFINER, existing vocabulary extended). | 12 rows after the walkthrough: created, action_added@j.tech, effectiveness_reviewed@j.supeervisor, closed@j.supeervisor, … |
| — | Side fix: effectiveness date/verdict selects read `e.target.value` after an await, so the page state lagged the database; value is captured first now. | Verdict select enables the sign-off immediately. |

Closed afterwards (migration 0334):

| # | Fix | Verified by |
|---|-----|-------------|
| 7 | The method banner shows "The problem definition changed after this method was chosen — reconsider it" whenever a `definition_updated` audit row is newer than `method_locked_at`. | Notice visible on this investigation after the technician's rewrite. |
| 8 | Each search result carries an explicit "Add as editor / reviewer …" button that names the role about to be granted. | Search for P.test1 shows the button. |
| 9 | Username and contact renamed to J.Supervisor, and the stored team list on this investigation updated. The login email is unchanged (j.supeervisor@cainergy.com) so the person can still sign in. | `users`, `contacts`, `collaborators` rows. |
| — | Pareto counts every non-cancelled work order in range and prices settled ones by their frozen figures, then labour + parts lines, then total_actual_cost. | P-101-A now ranks with 4 events ($1,040, #3 by cost, #1 by frequency); 4 assets analysed instead of 1. |

Nothing from this walkthrough remains open.


## The 5-Why itself (run as the team editor, J.tech)

Problem node seeded from the step-1 statement; four whys with escalating prompts (immediate → contributing → systemic → organisational); the "have you reached the root cause?" nudge at why 4; root cause declared through the soft evidence gate; the operator statement cited as a supporting fact on the root cause; step 3 ticked; the chain reads:

1. Seal faces ran dry after the discharge set-point was raised from 8 to 10 bar (suction fell below the NPSH margin, flush starved).
2. The set-point was changed at the panel without an engineering check or a change request.
3. Nothing requires a change request for an operating-parameter change on a criticality-A pump.
4. The change-control procedure covers physical modifications only.
- **Root cause:** change control excludes operating-parameter changes on critical assets.

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| 10 | P2 | Step 4 ↔ step 3 | Corrective actions are never linked to the root-cause node they address: `cause_node_id` is always null and the add-action drawer asks only for a cause *layer*. "One action per root cause" cannot be checked, and the RCM / FMEA hand-offs carry every action regardless of cause. | Fixed: the add-action drawer asks "Which root cause does this fix?" (defaults when there is one); each action shows what it fixes, an unlinked action can be linked inline; step 4 lists root causes with no action; step 6 warns about them. |
| 11 | P3 | 5-Why summary | The workspace wrote the new root-cause summary to the database but showed the previous one ("Seal grade not rated…") with a VERIFIED 90% badge until the page reloaded — the workspace updates the investigation directly and the page's copy went stale. | Fixed (onSummaryChange hook). |
| 12 | P3 | Evidence discipline | The root-cause gate is soft ("Mark anyway — I'll cite it") and each Why is a separate claim, yet nothing asks for evidence while whys are typed; the "therefore" reverse test correctly flags all four as ASSUMED afterwards. Nothing downstream (step 4, sign-off) reacts to an uncited chain. | Fixed (soft): step 6 shows "Before signing off: n causal steps cite no evidence / the root cause cites no evidence" and points back to the workspace. Still not a hard block, by design. |

## Recommended order (as executed)

1. Enforce roles in the database, not only in templates: reliability `edit` for writes on `ers_rca_*`, `admin`/owner for delete and close, and a `caller_can('reliability','edit')` conjunct on the policies — the same mechanism work orders already use.
2. Make `createNotification` insert without a returning read (or a SECURITY DEFINER RPC), so assignments and invites from any role reach their recipient.
3. Add a sign-off: closing requires the owner or a reviewer; record it in the audit log with the effectiveness verdict.
4. Stamp `trigger_type` from the entry point (Pareto, bad-actor hunter, work order, manual) and allow editing it in step 1.
5. Write audit rows from the page's write paths (definition, evidence, method, actions, status) — the table and step-6 panel already exist.
6. Decide whether the team scopes access; if it does, add `investigation_id IN (my teams)` to the policies.
