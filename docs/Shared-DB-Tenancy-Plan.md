# Shared-Database Tenancy — Implementation Plan

**Goal:** one codebase that serves an SMB tier (many customers, one database) alongside the
enterprise tier (one customer, one database), so both can be sold from the same pricing page.
**Status:** plan for execution · **Owner:** eng · **Prereq:** none — this is independent of launch

---

## 1. The recommendation that shapes everything else

**Do not build a separate SMB variant. Build tenancy properly, and let enterprise be N = 1.**

The instinct is to fork: keep the enterprise deployment as-is, add a shared-DB build for SMB. Resist
it. Two schema variants of 162 tables means every migration written twice, tested twice, and drifting
permanently — and this codebase has already shown how quickly the repo stops describing the database.

Instead: `company_id` becomes universal. Every deployment is tenancy-aware. An enterprise customer's
database simply contains one row in `companies`, and every policy still works. Same schema, same
migrations, same tests, one code path.

That choice also fixes something already broken. `assets.company_id` exists today and is **NULL on all
69 rows**. The column was added and never used. Under this plan it becomes NOT NULL with a default,
so the enterprise deployments gain correctness they currently lack rather than carrying dead columns.

---

## 2. Assessment — measured, not estimated

| | Count | Note |
|---|---|---|
| Base tables | **162** | |
| Already tenant-aware | **4** | `assets`, `companies`, `numbering_config_overrides`, `organization_units` |
| …of which actually populated | **2** | `assets.company_id` is NULL on 69/69 rows |
| Reach a tenant via FK to a core parent | **56** | could derive, but see §3.3 — denormalise instead |
| RLS policies | **504** | zero reference a tenant column |
| Views / functions | 16 / 57 | |
| Client `supabase.from()` call sites | **478** across 50 files | see §3.4 — most need no change |

**Tenant resolution does not exist today.** `public.users` has `id, username, email, contact_id,
status, roles, …` — no company link. The `contact → organization_unit → company` chain is intact at
the org level (10/10 org units carry `company_id`) but broken at the person level: **1 of 11 contacts
has an `organization_unit_id`**. So there is no working path from a logged-in user to their tenant.

That is the single most important finding. This is not "finish tenancy" — it is "build tenancy",
greenfield, on a schema that has a column reserved for it.

---

## 3. Architecture

### 3.1 Tenant identity lives in the JWT

Add `public.users.company_id`, and mirror it into the auth token as an `app_metadata` claim on
sign-in. Then:

```sql
CREATE OR REPLACE FUNCTION public.caller_company()
RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid $$;
```

**Why the claim rather than a table lookup:** RLS evaluates per statement, and §3.2 of the RBAC plan
proved what a table-touching function costs there — `is_admin()` bare was 3,013 ms on 200k rows
versus 20 ms wrapped. Reading a claim touches nothing. It is the cheapest possible predicate, and
tenancy is the one predicate that will be on *every* table.

`users.company_id` remains the source of truth; the claim is a cache refreshed at login.

### 3.2 Tenancy and permission compose, they do not merge

`caller_can()` answers *may this role see this module*. `caller_company()` answers *whose data is
this*. They are independent axes and both belong in the policy:

```sql
USING (
    company_id = (SELECT public.caller_company())
    AND (SELECT public.caller_can('assets', 'view'))
)
```

Put the tenant test **first** — it is an indexed column comparison, so it eliminates almost every row
before the function is consulted.

Nothing about the role model changes. The 504 policies already going through `caller_can()` gain a
conjunct; they are not rewritten.

### 3.3 Denormalise `company_id`, do not derive it

56 tables could reach a tenant by joining to a parent. Do not. A policy of the form

```sql
EXISTS (SELECT 1 FROM assets a WHERE a.id = child.asset_id AND a.company_id = caller_company())
```

is a correlated subquery per row — exactly the shape that made a bare function 72× slower. Put the
column on the child table, index it, and compare locally.

Denormalisation risks divergence (a child pointing at another tenant's parent). A `CHECK` or a
composite FK on `(id, company_id)` closes that, and it is worth the extra constraint.

### 3.4 The default is what saves the 478 call sites

```sql
ALTER TABLE assets
    ADD COLUMN company_id uuid NOT NULL DEFAULT public.caller_company()
        REFERENCES companies(id);
```

A `DEFAULT` may call a function. So a client that never mentions `company_id` still writes the
correct tenant, and RLS filters what it reads.

**This is the difference between a 4-week project and a 4-month one.** The 478 call sites across 50
files do not need touching for tenancy. Reads are filtered beneath them; writes are stamped beneath
them. Only code carrying an explicit single-tenant assumption needs changing — see §4, Phase 5 —
and there are a handful, not hundreds.

Belt and braces: a `WITH CHECK` on every write policy asserting `company_id = caller_company()`, so a
client that *does* pass a company_id cannot pass someone else's.

### 3.5 Config: global default plus per-tenant override

You have already solved this once. `numbering_config_overrides` is keyed `(company_id, object_class)`
over a global `numbering_config`. Apply the same shape to `dictionaries`, `hierarchy_config` and
`reference_codes`.

The part that bites is uniqueness: `dictionaries` is unique on `(type, code)` today, so tenant A's
`COND_ALARM` collides with tenant B's. Every config key widens to include `company_id`. Miss one and
customer #2 hits a constraint violation on day one — loud, at least, rather than silent.

**`role_permissions` stays global.** The others are the customer's data; that one is your product's
role model. Tenants customise via the per-user `permission_overrides` that already exist. Making it
per-tenant would mean `caller_can()` resolving by tenant and the TypeScript matrix ceasing to be the
single source of truth — cost with no demand behind it.

---

## 4. Phases

Each ends at a gate. Do not start the next until it is green — three detectors I wrote this week
returned confident wrong answers, and every one was caught by verifying rather than assuming.

### Phase 0 — Tenant identity (2–3 days)
`users.company_id`, the auth hook that mints the claim, `caller_company()`, and backfill of the
single existing company.

**Gate G0:** every existing user resolves to a company; `caller_company()` returns it from a real
token for all four test roles; a user with no company resolves to NULL and is refused everywhere
(fail-closed, verified — not assumed).

### Phase 1 — The column, everywhere (3–4 days)
Generated migration adding `company_id` to every tenant-owned table: nullable → backfill → NOT NULL
→ DEFAULT → index → FK. Config and product tables (§3.5, `schema_migrations`, `role_permissions`,
`semantic_catalog`) are explicitly excluded by a reviewed list, not by omission.

**Gate G1:** zero NULLs in any `company_id`; every table classified as tenant-owned, config, or
product with the classification recorded in the migration; existing app behaviour unchanged
(smoke + 486 tests + the RLS matrix all green, since no policy references the column yet).

### Phase 2 — Compose the policies (3–4 days)
Regenerate all 504 policies from `pg_policies`, adding the tenant conjunct. Same mechanical rewrite
as `0251`, which did exactly this for the `(SELECT …)` wrap and is the proven template.

**Gate G2:** the RLS matrix passes unchanged for the single existing tenant — tenancy must be
invisible when N = 1. Plus `EXPLAIN` confirming the tenant predicate is an index scan, not a filter.

### Phase 3 — Prove isolation (2 days) — **the gate that matters**
Create a second company with its own users and data. Extend `tests/rls/rls-matrix.mjs` with a
cross-tenant axis: for every table, assert tenant A's token reads **zero** of tenant B's rows and
cannot write them.

**Gate G3:** zero cross-tenant reads and zero cross-tenant writes across all 162 tables. This is the
one gate with no acceptable partial result, and it belongs in CI permanently — it is the test that
stands between you and the incident that ends the product.

**Result:** G3 green — 76 tables probed, zero cross-tenant reads, zero cross-tenant writes, no rows
stranded in the probe tenant. But 76 is not 146, and the shortfall turned out to matter.

#### Gate G4 — the part G3 structurally cannot reach

G3 borrows an existing row and hands it to a probe tenant. That design can only speak about tables it
can reach, and it cannot reach two kinds:

| Blind spot | Count | Visible in G3's output? |
|---|---|---|
| Empty — no row to borrow | 70 | Yes, reported inconclusive |
| No `id` column (composite PK) — the probe addresses rows as `?id=eq.…` | 6 | **No — absent from the denominator entirely** |

`movement_type_gl_overrides` sat in both. It was created by **0262**, *after* 0261's one-shot policy
sweep had already run, with `USING (true)` on its read policy — in a schema G3 had just called green.
Its own table comment says "the chart of accounts is the customer's", so the design was tenant-correct
and only the policy was a placeholder. Every tenant would have read every other tenant's G/L account
mapping the moment that table held data.

**Seeding the 70 empty tables was the obvious fix and the wrong one.** It is buildable — the FK chains
are only two deep (`ers_hazop_deviations → ers_hazop_nodes → ers_psm_studies`), the hardest table needs
six values, and 53 of the 76 CHECK constraints are value-lists a generator can parse. But it is the
expensive way to learn less: it would have raised coverage to 146, still missed all six no-`id` tables,
and still proved nothing about the *next* table a migration adds.

The claim being made — *every tenant-owned table carries the conjunct* — is **static**. It is a fact
about `pg_policies`, not about data. Checking it needs no rows, covers all 152 tables, and an empty
table cannot hide from it.

**Gate G4** (`tests/rls/tenant-completeness.mjs`, backed by `public.tenancy_policy_gaps()` in **0264**)
asserts three things across every tenant-owned table: RLS is on and at least one policy exists; every
*permissive* policy carries the tenant test (permissive policies OR together, so one bare policy defeats
all its siblings — the 0238 bug, verbatim); and no DEFINER view reads past RLS unfiltered.

The query lives in the database, not in the test, so it cannot drift from the schema it describes.
`--self-test` introduces each gap shape on purpose inside a rolled-back transaction and fails if the
detector stays quiet — four detectors in this workstream returned a confident wrong answer, so a check
that has never gone red is not yet evidence.

**Both gates belong in CI.** G3 proves the conjunct *works*; G4 proves every table *has* one. Neither
alone is the guarantee, and G4 is the one that catches tomorrow's migration.

### Phase 4 — Per-tenant config (3–4 days)
`dictionaries`, `hierarchy_config`, `reference_codes` to the override pattern; widen the uniqueness
keys; seeding step in provisioning so a new tenant starts with the ISO 14224 catalogue rather than
an empty dropdown (see §6 — that catalogue is empty today).

**Gate G4:** two tenants hold different fault codes and neither sees the other's; a fresh tenant is
usable immediately after provisioning.

### Phase 5 — Remove the single-tenant assumptions (2–3 days)
The handful of places that read "the first active company row":
`useEdition`, `SettingsContext` (`companies.app_settings`), `hierarchy_config` (`.eq('id', 1)`).
Each becomes tenant-scoped.

**Gate G5:** two tenants hold different editions and different settings simultaneously.

### Phase 6 — Self-serve signup and tiering (4–5 days)
The SMB tier needs what enterprise never did: a signup that creates a company, its first admin, and
its seed config in one transaction. Plus `companies.tier` driving what the pricing page sells —
`ModuleGate` already reads a licence set, so tiering plugs into machinery that exists.

**Gate G6:** a signup from a clean browser produces a working, isolated tenant with correct module
access — and G3 still passes with three tenants.

---

## 5. Risks, from this codebase specifically

| Risk | Why it is real here | Mitigation |
|---|---|---|
| A policy misses the tenant conjunct | 504 policies; 0238 proved a migration can apply cleanly and change nothing | Phase 2 is generated, not hand-written; **G4** proves statically that every table has one — G3 alone missed `movement_type_gl_overrides` |
| Permissive policy survives beside a tenant-scoped one | Exactly how 0238 became a no-op — RLS is OR-ed | `audit-policies.mjs` already detects orphans; extend it to flag any policy on a tenant-owned table lacking the conjunct |
| Per-row tenant predicate | Proven 72× penalty for a bare function call | Indexed column comparison, tenant test first, `EXPLAIN` in G2 |
| Child row points at another tenant's parent | Denormalisation permits it | Composite FK on `(id, company_id)` |
| Client passes a foreign `company_id` | 478 call sites, any could | `WITH CHECK (company_id = caller_company())` on every write policy |
| Config key collision between tenants | `dictionaries` unique on `(type, code)` today | Widen every config key in Phase 4; G4 covers it |

---

## 6. What this does not solve

- **The empty `FAULT_TYPE` catalogue.** One seeded code (`COND_ALARM`) exists; the human-facing ISO
  14224 catalogue is empty. Multiplying an empty catalogue across tenants does not fill it. Still
  needs a maintenance engineer.
- **Cross-tenant benchmarking.** The Strategy §7 flywheel wants aggregate insight across customers.
  Shared-DB makes it *technically* easier and *legally* harder — it needs consent and anonymisation
  designed deliberately, not a convenient join.
- **The enterprise provisioning gap.** Separate work, separate plan.

---

## 7. Estimate

| Phase | Days | Risk |
|---|---|---|
| 0 Tenant identity | 2–3 | low |
| 1 Column everywhere | 3–4 | medium — generated, but 162 tables |
| 2 Compose policies | 3–4 | medium — proven template (0251) |
| 3 Prove isolation | 2 | **the gate that matters** |
| 4 Per-tenant config | 3–4 | medium — uniqueness keys are fiddly |
| 5 Single-tenant assumptions | 2–3 | low — handful of files |
| 6 Signup and tiering | 4–5 | medium — new surface |

**Total ≈ 4–5 weeks.** Phases 0–3 (≈ 2 weeks) deliver provable isolation; 4–6 make it sellable.

Lower than my first estimate because of §3.4: the column default means the 478 client call sites do
not need rewriting. That single design choice removes the bulk of what looked like the work.

---

## 8. What not to do

- **Do not fork the schema.** One tenancy model, enterprise runs at N = 1.
- **Do not derive tenancy through joins.** Denormalise; the performance evidence is unambiguous.
- **Sequencing — corrected 2026-08-03.** This section originally said "not a launch blocker, do not
  start before the enterprise launch is stable". That assumed enterprise customers came first. The
  marketing plan is the opposite: **SMBs are the opening cohort, larger clients follow.**

  If SMBs land first, they land on a shared database, and Phases 0–3 become **launch-blocking** —
  there is no SMB tier to sell until cross-tenant isolation is proven. Phases 4–6 make it sellable
  (per-tenant config, self-serve signup, pricing tiers) and are also on the critical path for a
  self-serve product.

  What does *not* change: **Phase 3 is still the gate with no acceptable partial result.** Shipping
  an SMB tier whose isolation has not been proven table-by-table is the one mistake that ends the
  product rather than embarrassing it. Under launch pressure the temptation is to accept "we tested
  the main tables" — don't.

  The enterprise deployments are unaffected either way: they run the same schema at N = 1.
