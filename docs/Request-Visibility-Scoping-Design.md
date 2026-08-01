# IREAMS — Request Visibility Scoping (launch-fit slice)

**Status:** Draft for review · **Scope:** `service_requests` read visibility only
**Relationship to the big phase:** This is the **first table of T‑3** in
[Multi-Tenancy-Enterprise-Structure-Design.md](./Multi-Tenancy-Enterprise-Structure-Design.md).
It does **not** replace that phase — it delivers an enforceable visibility boundary on the one
module that needs it now, using scope sources that **already exist**, and is forward‑compatible
with the full site model.

---

## 1. The gap (confirmed in code)

- **Reads are wide open.** RLS on `service_requests` is `SELECT … USING (true)`
  (`0186_phase2_rls_hardening`). Every authenticated user can read **every** request, across
  all plants/sites. Writes are already tightened (admin‑only delete, etc.).
- **The Settings permission matrix gates *actions*, not *rows*.**
  `permissions.requests.{view,create,edit,approve,authorize,delete}`
  ([`rolePermissions.ts`](../src/frontend/src/eam/constants/rolePermissions.ts)) is **all‑or‑nothing
  per module** — `view` decides whether you see the Requests *tab*, not *which* requests.
- **The new plant/equipment filter is UX, not security.** It runs client‑side over data already
  fetched. It can never be the boundary — enforcement must be in the database (RLS).

Net: a technician in Plant A can read every request in Plant B.

---

## 2. Why not just "do site RLS now"

The real site boundary needs the **org spine** (`sites` table, denormalized `site_id` on owned
tables, `user_site_scope()` resolver) — that's T‑0…T‑1 of the multi‑tenancy phase, a dedicated
piece of work touching every table. It is **not** launch‑fit, and half‑building it (a `site_id`
with no backfill/resolver) risks locking users out (RLS is deny‑by‑default).

So for launch we scope requests with sources that are **already populated today**.

---

## 3. Recommendation — ownership + work‑center crew visibility, enforced by RLS

A user may **read a request** if any of:

| Rule | Predicate source | Already exists? |
|---|---|---|
| **Admin / triage roles** — see the whole queue | `public.is_admin()` + `users.roles ∈ {PLANNER, SUPERVISOR, MANAGER, EXECUTIVE, RELIABILITY_ENG}` | ✅ `0171` + `users.roles` |
| **Ownership** — you raised it | `service_requests.requester_id = caller` | ✅ column exists |
| **Crew** — routed to a work center you belong to | `service_requests.work_center_id ∈ caller's work centers` | ✅ `work_center_members` (`0191`) + `work_center_id` on requests |

Everyone else (**TECHNICIAN / REQUESTER / INTERNAL**): own + crew only.

**Why triage roles keep full read.** Requests are triaged *before* they're routed —
a new request can have `work_center_id = NULL` (unassigned) or be routed to a different crew.
Scoping a planner/supervisor to own+crew would **black-hole untriaged work** (they couldn't see
what they must triage). So oversight roles see all; the real restriction lands on rank-and-file.
This is precisely SAP's planner-group (`I_INGRP`) authorization — a planner sees the plant's
notifications, a technician sees their own — minus the site tier we defer.

*Note:* the role check is keyed on `users.roles` names (same approach as `is_admin()`). A **custom**
role with request-oversight rights isn't auto-covered — extend the role array, or move to a
permission-backed check, if you add one.

**Why this model for launch**
- **Enforceable now** — all three predicates map to existing tables; no org spine required.
- **Meaningful boundary** — end‑users (Requester role) stop seeing the whole plant's requests;
  planners see their crew's queue; admins/managers see all.
- **Forward‑compatible** — when the site spine lands, the policy gains **one more `OR`**
  (`site_id = ANY(public.user_site_scope())`); nothing here is thrown away.
- **Fails safe & reversible** — ship behind a per‑table rollback to `USING(true)`.

---

## 4. The one wiring dependency: `caller_contact_id()`

`work_center_members.contact_id` is a **contact** id; the RLS caller is `auth.uid()`.
Per the Comm‑Loop audit, `contacts.id ≠ auth.uid()` — so we need a helper that maps the
authenticated user to their contact id (via `users.contact_id`, the existing link):

```sql
CREATE OR REPLACE FUNCTION public.caller_contact_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT contact_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.caller_work_centers()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(array_agg(work_center_id), '{}')
  FROM public.work_center_members
  WHERE contact_id = public.caller_contact_id()
$$;
```

*(Verify the `users.contact_id` column name during T‑0 of this slice; adjust the join if the
link lives elsewhere.)*

---

## 5. The policy (replaces `USING(true)` on `service_requests` SELECT only)

```sql
DROP POLICY IF EXISTS "p2_select_service_requests" ON public.service_requests;

CREATE POLICY "scope_select_service_requests"
ON public.service_requests FOR SELECT TO authenticated
USING (
  public.caller_can_view_all_requests()                         -- admin + triage roles
  OR requester_id = public.caller_user_id()                     -- own (by users.id)
  OR requester_id = auth.uid()                                  -- own (by auth id)
  OR (work_center_id IS NOT NULL
      AND work_center_id = ANY (public.caller_work_centers()))  -- crew queue
);
```

`requester_id` is `uuid` (FK `users(id)`); the app writes it as the auth user id and `users.id`
normally equals `auth.uid()`, but we test both forms so a legacy `users.id ≠ auth.uid()` can't
hide a user's own requests.

INSERT/UPDATE/DELETE policies are **unchanged** (already hardened in `0186`). This migration
touches read visibility and nothing else.

---

## 6. App‑layer mirror (efficiency + UX, not authority)

- `getRequests()` stays a plain select — **RLS does the filtering server‑side**, so the client
  simply receives fewer rows. No code change required for correctness.
- Optional later: pass the same predicate as a query filter to shrink payloads. Not needed for
  launch (request volumes are small; RLS already trims the result).
- The plant/equipment/sort toolbar keeps working unchanged — it now filters an
  **already‑authorized** set.

---

## 7. Settings — what the admin configures

No new matrix keys required for launch. Visibility is **derived** from data the admin already
maintains:
- **Requester / Technician / Internal** → see own requests; add them to a work center in
  **Admin › Work Centers › Crew** (`work_center_members`, already built) to also see that crew's
  queue.
- **Planner / Supervisor / Manager / Executive / Reliability Eng** → role grants full request
  read (they triage the queue). No crew assignment needed.
- **Super Admin / Sys Admin** → `is_admin()` → see all.

*Forward hook:* when the site spine lands, `users.data_scope_overrides.siteIds` (JSONB column
**already present**, `0000`) becomes the site‑scope input and Admin gains a site assignment UI —
per the multi‑tenancy doc §5.

---

## 8. Rollout (small, gated)

| Step | Deliverable | Gate |
|---|---|---|
| **R‑0** | `caller_contact_id()` + `caller_work_centers()` helpers; verify `users.contact_id` link | read‑only helpers, no behaviour change |
| **R‑1** | Swap `service_requests` SELECT policy to §5; keep a one‑line rollback to `USING(true)` | **the cutover** — verify below |
| **R‑2** | Verification: admin sees all; a Requester test user sees only own; a crew member sees own + crew queue; a stranger sees none | sign‑off |
| **R‑3 (later)** | Add `OR site_id = ANY(user_site_scope())` when the org spine ships | folds into T‑3 |

**Verification queries** live beside the migration (mirror `0186_rls_checks.sql`): assert row
counts per persona before/after.

---

## 9. Bottom line

Full site‑scoped visibility is the multi‑tenancy phase and stays deferred. But we can give
`service_requests` a **real, DB‑enforced** visibility boundary **now** — *own + crew + admin* —
using ownership, `work_center_members`, and `is_admin()` that already exist. It's one migration
(two helpers + one SELECT policy), reversible per‑table, and it becomes the first executed table
of the big phase's T‑3 rather than throwaway work.

**Recommended immediate step:** R‑0 + R‑1 on `service_requests` only, behind verification and a
per‑table rollback.
