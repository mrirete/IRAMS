# Process Test — Invitations and Study Teams

Walkthrough of every place one person brings another into a piece of work, from the invitee's chair.
Written 2026-09-08 after J.test1 received an assessment invitation with no way to answer it (0338).

## The contract

There are two kinds of "bring someone in", and they behave differently on purpose.

| Surface | Kind | What the person receives | What they can do |
|---|---|---|---|
| Maturity assessment (Assess & Improve) | **Invitation** — pending until answered | Bell notification with **Accept / Decline**; the same banner on the assessment | Accept (access follows: view for a viewer, view + edit for a contributor) or decline. The inviter is told either way. |
| RCM study team | **Access list** — membership on add | "Added to an RCM study team" (no action flag) | Work by role; **Leave** from the Team drawer |
| RCA investigation team | Access list | "Added to an RCA team" | Same; Leave via the Team drawer |
| Defect-elimination task team | Access list | "Added to a defect-elimination task" with a deep link | Same |
| Reliability / P&ID study team | Access list | "Added to a … study team" (was silent before 0338) | Same |
| Colleague invite (`/invite/:token`, 0190) | Invitation | Token link shared by the admin | Register + accept |

Rule: a message that says *invited* must be answerable; a message that says *added* asks nothing.

## Roles

- **Inviter**: admin001 (SYS_ADMIN).
- **Invitee**: J.test1 (assessment), J.tech (RCM, set to *reviewer* for the leave test so the edit gate is exercised).

## Script

### A. Assessment — decline from the bell
1. admin001 → Assess & Improve → open an assessment → **Invite** → System Users → J.test1 → Contributor → Invite.
   Expect: row reads **Awaiting answer**; J.test1's permission overrides gain nothing yet.
2. J.test1 → bell → the invitation carries **Accept / Decline**. Click Decline.
   Expect: toast, row **Declined**, admin001 receives "Assessment invitation declined".

### B. Assessment — accept from the assessment
3. admin001 → Invite panel → remove the declined row → invite J.test1 again.
4. J.test1 → open the notification (lands on `/audits?open=<id>`, not the list).
   Expect: blue banner "admin001 invited you … as a contributor" with **Accept / Decline**; header chip **View only**; nothing saves while unanswered.
5. Click Accept.
   Expect: banner gone, View only gone, `audit_assessment_collaborators.status = accepted`, `users.permission_overrides.audits = {view, edit}` only, admin001 told.
6. admin001 → Invite panel → **Accepted**.

### C. Assessment — viewer
7. Invite someone as **Viewer**, accept: the wizard stays View only; overrides gain `{view}` only.

### D. External address
8. External Email tab → address → Invite.
   Expect: row with a **copy link** and **mail** button; the link is `/audits?invite=<token>` and resolves only for a signed-in user whose email matches.

### E. RCM — leave
9. J.tech (reviewer) → open the study → **Team (n)** → own row shows **Leave** → confirm.
   Expect: J.tech gone from `collaborators`, other members untouched (the approval guard lets a self-leave through; any other team edit by a non-editor is still refused).
10. admin001 → Team → Add People or Teams → J.tech → Add as editor.
    Expect: J.tech's notification reads **Added to an RCM study team**, `action_required = false`.

## Evidence (2026-09-08, dev server, Playwright)
All steps A–B, E and the DB assertions passed; screenshots in the session scratchpad. The only miss was the toast check racing the RPC, not the outcome.

## Known limits
- IREAMS delivers email only to registered users (outbox is keyed on user id). External invitees get a link the inviter sends.
- Leaving a defect-elimination or reliability-study team is a plain remove (those tables have no team edit gate).
