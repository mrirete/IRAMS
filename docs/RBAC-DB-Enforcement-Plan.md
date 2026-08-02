# RBAC DB Enforcement — Implementation Plan

**Goal:** make the permission matrix an admin actually edits govern the **database**, not just the UI.
**Status:** plan for execution · **Prereq:** `npm run test:rls` (built 2026-08-02) · **Owner:** eng

---

## 1. Why a mechanism rather than twenty policies

The L2 harness found 39 role×table cases where the API is more permissive than the UI. The obvious
response — write an RLS policy per table keyed on role names — is a trap:

- Policies keyed on `users.roles` duplicate the matrix in SQL. Edit a role template in TypeScript and
  the database silently keeps the old answer. That is the exact drift class this whole effort exists
  to kill, reintroduced in a new place.
- Custom roles (`reference_codes`) and per-user `permission_overrides` would be invisible to those
  policies. An admin who withdraws `finops` from one person would see it work in the UI and not in
  the API — the same split we just fixed at the route layer.
- 0197 already hit this and said so in a comment: *"a custom role with request-oversight rights isn't
  covered here; extend the array (or move to a permission-backed check)."* This plan is that move.

One function, `caller_can(module, action)`, collapses all of it. Policies become one-liners, new
tables are trivial to gate, and there is exactly one definition of "may this user see finops".

---

## 2. Architecture

Three pieces. Each is independently verifiable, and none of them is useful alone.

```
  rolePermissions.ts  ──generator──►  role_permissions (table)  ──┐
  (source of truth,                   DB mirror, seeded            │
   stays in TypeScript)               by migration                 │
                                                                   ├──►  caller_can(module, action)
  users.roles ──────────────────────────────────────────────────── │      SECURITY DEFINER, STABLE
  users.permission_overrides ────────────────────────────────────── ┘             │
  reference_codes.properties.permissions (custom roles) ───────────┘              │
                                                                                  ▼
                                    RLS:  USING ((SELECT public.caller_can('finops','view')))
                                          ^^^^^^ the (SELECT …) wrap is mandatory — see 3.2
```

### 2.1 `role_permissions` — the DB mirror

```sql
CREATE TABLE public.role_permissions (
    role   TEXT NOT NULL,
    module TEXT NOT NULL,
    action TEXT NOT NULL,          -- view | create | edit | delete | approve | authorize | viewCosts | assign
    PRIMARY KEY (role, module, action)
);
```

Rows exist only where the flag is **true** — presence means permitted, absence means not. That keeps
the table small and makes the function a simple `EXISTS`.

### 2.2 `caller_can()` — the single definition

```sql
CREATE OR REPLACE FUNCTION public.caller_can(p_module text, p_action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    WITH me AS (
        SELECT u.roles, u.permission_overrides
        FROM users u
        WHERE (
                lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
             OR lower(coalesce(u.username, '')) = lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1))
              )
          AND coalesce(u.status, 'active') = 'active'
        LIMIT 1
    )
    SELECT CASE
        -- 1. Per-user override wins outright, in either direction.
        WHEN (SELECT permission_overrides -> p_module ->> p_action FROM me) IS NOT NULL
            THEN (SELECT permission_overrides -> p_module ->> p_action FROM me)::boolean
        -- 2. Otherwise the role template.
        ELSE EXISTS (
            SELECT 1 FROM role_permissions rp
            WHERE rp.role   = coalesce((SELECT roles ->> 0 FROM me), '__default__')
              AND rp.module = p_module
              AND rp.action = p_action
        )
    END;
$$;
```

> **`users.roles` is `jsonb`, not `text[]`** — verified against production. So the first role is
> `roles ->> 0`, not `roles[1]`. `is_admin()` uses the jsonb operator `?|` for the same reason.
> Beware: **`contacts.roles` IS `text[]`.** Same column name, different type on the two tables, and
> the array-subscript form will silently fail or mis-parse on the wrong one. `permission_overrides`
> and `data_scope_overrides` are both `jsonb`.

**The identity lookup is copied verbatim from `is_admin()` (0171)** — same email/username fallback,
same active check. If those two ever disagree about who you are, admin access and module access
diverge, and that is a very bad bug to debug.

### 2.3 Semantics it must reproduce exactly

Taken from [AuthContext.tsx:219-229](src/frontend/src/eam/contexts/AuthContext.tsx#L219-L229). The
function is wrong if it differs from this in any respect:

| Rule | Client behaviour | Consequence for the function |
|---|---|---|
| Role selection | `users.roles[0]` only | `roles ->> 0` (jsonb) — **not** "any of the roles" |
| Unknown role | falls back to `BASE_PACKAGE_DEFAULTS` (fail-closed) | seed `BASE_PACKAGE_DEFAULTS` under role `'__default__'` and fall back to it |
| Overrides | shallow merge **per module**: `{...base[mod], ...override[mod]}` | an override sets one *action*, it does not replace the module |
| Override of `false` | explicitly withdraws | must distinguish `false` from absent — hence the `IS NOT NULL` test, not a truthiness test |

That last row is the subtle one. `permission_overrides = {"finops": {"view": false}}` must **deny**,
not fall through to the template. A naive `coalesce(override, template)` gets this backwards.

---

## 3. The two footguns

### 3.1 Infinite recursion — read this before writing any policy

`caller_can()` reads `users`. If `users` ever gets an RLS policy that calls `caller_can()`, Postgres
recurses until it errors, and **every query in the app fails**, including login.

`SECURITY DEFINER` is what prevents it: the function runs as its owner and bypasses RLS on `users`.
`is_admin()` already relies on this. Two rules follow, and they are not optional:

- **Never** put a `caller_can()` policy on `users`, `role_permissions`, or `reference_codes`.
- **Never** drop `SECURITY DEFINER` from the function.

Both belong in a comment on the function itself, because the failure is total and the cause is
non-obvious.

### 3.2 Per-row evaluation

RLS policies are evaluated per row. A function that does a subquery per row on a 20k-row work-order
list would be a visible outage.

**This section originally claimed Postgres hoists a `STABLE` function with constant arguments to an
InitPlan. That is false, and Gate G2 disproved it — see Phase 2.** A bare call is evaluated once per
row: 18,969 ms versus 33 ms on 200k rows.

The fix is to wrap every call in an uncorrelated scalar subquery, which Postgres *does* evaluate
once:

```sql
USING ((SELECT public.caller_can('finops', 'view')))
```

Never write the bare form. It is 72x slower and nothing warns you — the policy is correct, the tests
pass, and only a customer with real data ever finds out.

---

## 4. Keeping the mirror honest

Two sources of truth is the risk this plan creates. It is contained by a generator plus a test, the
same shape as `KNOWN_GAPS`: the safety net fails loudly rather than rotting quietly.

1. `scripts/gen-role-permissions.mjs` imports `ROLE_PERMISSION_TEMPLATES` and
   `BASE_PACKAGE_DEFAULTS` and emits the seed SQL (a `DELETE` + `INSERT` inside one transaction).
2. A vitest spec regenerates in memory and asserts the committed migration matches byte for byte.
   Edit a role template without regenerating and CI fails with the diff.

TypeScript stays the source of truth; the table is a build artefact that happens to live in a
migration.

---

## 5. Rollout

Every phase ends at a gate. **Do not start a phase until the previous gate is green** — the two
failures on 2026-08-02 (a migration that applied and changed nothing; a fix that broke error logging)
both came from moving on without checking.

### Phase 0 — Audit what is actually there ✅ DONE (2026-08-02)
`node scripts/provision/audit-policies.mjs --project-ref <ref>` — replays every migration
(CREATE/DROP POLICY, ENABLE/DISABLE RLS) and diffs the result against `pg_policies`.

**Result: 2 genuine orphans out of 486 live policies, now captured in 0240. Gate G0 green.**

Correction to what prompted this phase: `p2_select_error_logs` and `p2_select_audit_logs` are **not**
out-of-band. [0186](src/frontend/supabase/migrations/0186_phase2_rls_hardening.sql#L74-L88) generates
them in a PL/pgSQL loop via `EXECUTE format(...)`, which a literal `CREATE POLICY` grep cannot see.
They were authored and deliberate. What defeated 0238 was RLS being permissive, not a rogue policy.

Building the audit took three parser corrections, each of which had silently inflated the count:

| Bug | Wrong answer | Cause |
|---|---|---|
| Ignored `EXECUTE format` loops | 465 orphans | 21 migrations generate policies dynamically; 416 of 418 unmatched policies come from them |
| Applied all CREATEs then all DROPs | 274 orphans | `DROP IF EXISTS x; CREATE x;` — the commonest shape here — netted to "absent". Must replay in source order |
| Parsed SQL comments | 3 orphans | 0197 documents its own rollback as `-- DROP POLICY …`, which deleted a live policy from the expected set |

**What it found:**

- **0 tables with RLS disabled** — the one genuinely bad outcome, and it is clean.
- `ers_agent_actions` — a single `FOR ALL USING (true)` policy replaced the three narrow ones 0149
  authored (`SELECT` / `INSERT` / `UPDATE`, deliberately **no DELETE**). The AI action queue is
  deletable by any logged-in user, and nothing in the repo recorded the change.
- `ers_prediction_feedback` — **the table itself is in no migration.** Created out-of-band, so the
  repo has never described it. Empty today. 0240 captures its policy; its *schema* is still
  unversioned (use `export-schema.mjs`).

Both captured verbatim in [0240](src/frontend/supabase/migrations/0240_capture_orphan_policies.sql)
with no behaviour change — Phase 0 audits, Phase 3 decides.

**Re-run this after every phase** (step 5 of §6). It is now a two-orphan-to-zero check, so any new
number is a real signal.

### Phase 1 — Mechanism, applied to nothing
Migration: `role_permissions` table + generator + seed + `caller_can()`. No policy uses it yet.

**Gate G1:** a SQL test asserts `caller_can()` agrees with the TypeScript matrix for **every**
(role × module × action) triple, plus the four override cases: absent, `true`, `false`, and a module
the role has no entry for. Zero behaviour change in the app — nothing consumes the function.

### Phase 2 — Prove performance ✅ DONE (2026-08-02) — **it failed, and the fix is one line**

**§3.2 of this plan was wrong.** A `STABLE` function with constant arguments is *not* hoisted to an
InitPlan in an RLS qual. Postgres evaluates it **once per row**.

Production tables are too small to show it (largest is 1,965 rows), so the benchmark builds a
200,000-row table inside a transaction that rolls back, with `SET LOCAL ROLE authenticated` — without
that the Management API connects as a superuser, which **bypasses RLS entirely** and would have
produced a beautiful, meaningless plan.

| Policy | Execution | Buffers | Plan |
|---|---|---|---|
| `USING (true)` | 265 ms | 1,870 | — |
| `USING (caller_can(…))` | **18,969 ms** | 602,112 | per-row ❌ |
| `USING ((SELECT caller_can(…)))` | **33 ms** | 2,127 | `InitPlan 1` ✅ |
| `USING (is_admin())` | **3,013 ms** | 68,706 | per-row ❌ |
| `USING ((SELECT is_admin()))` | 20 ms | 2,041 | `InitPlan 1` ✅ |

An **uncorrelated scalar subquery** is what makes the difference — Postgres evaluates it once and
reuses it. The wrapped plan reads `Filter: ((InitPlan 1).col1 AND …)`.

**Gate G2: GREEN, conditional on always writing the wrapped form.**

```sql
USING ((SELECT public.caller_can('finops', 'view')))   -- correct
USING (public.caller_can('finops', 'view'))            -- 72× slower, silently
```

**This was never a `caller_can()` problem.** `is_admin()` has the identical defect and has been in
production since 0171, generated across dozens of tables by 0186. It is invisible at current volume
and would be an outage on a real tenant.

[0243](src/frontend/supabase/migrations/0243_wrap_rls_function_calls.sql) fixes the five policies
from this workstream. **83 pre-existing policies still call a function bare** (6 of them `SELECT`,
which is where it hurts most). `audit-policies.mjs` now lists them — that sweep is its own task, and
mostly means regenerating 0186's loop with the wrapped form.

### Phase 3 — Tier 2 (money and procurement)
Narrow readers, unambiguous policy, highest indefensibility.

| Module | Tables | Known readers |
|---|---|---|
| `finops` | `cost_centers`, `depreciation_books`, `capital_events`, `budgets`, `journal_entries` | FinOps page |
| `purchasing` | `purchase_orders`, `goods_receipts`, `invoice_matches` | PurchaseOrders page |
| `vendors` | `vendors` | Vendors page, PO supplier picker |

⚠ `vendors` is read by the PO supplier picker. Confirm which roles open that before gating, or
buying breaks for planners.

**Gate G3:** `npm run test:rls` shows those tables denied for roles without the permission and
allowed for roles with it; `smoke.mjs` passes for all four roles; the FinOps and PO pages still load
for a role that *should* see them.

### Phase 4 — Tier 3 (operational + scoping)
`work_orders`, `inventory_*`, `recurring_work`, `contacts`, integrity, safety. Wide readers, so each
table needs a reader sweep first.

This is also where `dataScope` stops being decorative. `departmentIds` is currently used **nowhere**
— every template ships `[]` — so "scope users to their unit" is a build, not a setting. Add
`caller_org_units()` mirroring the working `caller_work_centers()` from 0197, and combine:

```sql
USING (public.caller_can('workOrders','view') AND public.in_caller_scope(org_unit_id))
```

**Gate G4:** harness clean except documented `EXPECTED_OPEN` entries; full smoke green for all
roles; a manual pass of the S-series spine journeys.

### Not in scope
- **`users` column exposure.** Needs a directory view exposing `(id, username)` with the base table
  restricted, plus a code change in `DatabaseService` — RLS is row-level and cannot solve it. Own
  ticket.
- **`companies`.** Infrastructure every session reads; see `EXPECTED_OPEN`.
- **Making `reference_codes` custom roles first-class.** The function reads them, but the admin UI
  for authoring them is untouched here.

---

## 6. Verification protocol

Per phase, in order. Anything red stops the phase.

1. `npm run test:rls` — the leak count must only ever go down, and any new `EXPECTED_OPEN` entry
   must carry a written reason.
2. `npm run test:rls -- --writes` on the phase's tables — reads and writes are different policies and
   a `USING` clause refuses updates **silently**.
3. `SMOKE_LOGINS_JSON=<4 roles> node tests/e2e/smoke.mjs` — catches a locked table that blanks a page.
4. Feature spot-check for whatever the phase touched, as a non-admin who *should* have access. This
   is the step that catches "closed the leak, deleted the feature" — the trap that nearly took out
   the asset Audit Trail tab.
5. `pg_policies` diff again — confirm you changed what you think you changed. 0238 taught this one.

---

## 7. Rollback

Each phase is one migration and reverses with a forward migration restoring the prior policy. Keep
the previous policy text in the migration comment so the revert is copy-paste rather than
archaeology.

`caller_can()` itself is safe to leave in place on rollback — a function nothing references is inert.

---

## 8. Estimate

| Phase | Work | Risk |
|---|---|---|
| 0 Policy audit | 0.5 day | none (read-only) |
| 1 Mechanism | 1 day | low — nothing consumes it |
| 2 Performance | 0.5 day | low, but a hard stop if it fails |
| 3 Tier 2 | 1 day | medium — narrow readers |
| 4 Tier 3 + scoping | 3–5 days | high — wide readers, needs the scope build |

**Phases 0–3 are the launch-relevant slice: ~3 days.** Phase 4 is the multi-tenancy prerequisite and
should be scheduled against that date, not this one.

---

## 9. The decision this plan assumes

Today, single-tenant with trusted staff, these leaks are *policy not enforced* rather than *data
breached*. That justifies deferring Phase 4 — and it stops being true the moment a second customer,
or a contractor, shares this database. Phase 4 is a hard gate on multi-tenancy, and the invite-token
escalation (0237) is the reminder that the distinction is not always academic.
