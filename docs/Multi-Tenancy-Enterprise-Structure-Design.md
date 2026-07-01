# IRAMS — Multi-Tenancy & Enterprise Structure Design (SAP-modeled)

**Status:** Draft for review · **Scope:** platform-wide (every module & table)
**Goal:** let one deployment serve a parent company with multiple **sub-companies** and **sites**, each running its **own asset register, work management, numbering framework and configuration**, with **group-level rollup** for the parent.
**Anchor:** SAP PM/EAM enterprise structure & authorization model.
**Prerequisite:** this supersedes the interim note "RLS deferred to a project-wide phase" — this *is* that phase.

---

## 1. Problem statement

Today IRAMS is effectively **single-tenant with cosmetic filtering**:

- Row Level Security is **permissive** — every policy is `USING (true) TO authenticated` (`0150_reenable_core_rls`, `0155`). Any authenticated user can read/write **all** rows directly; scoping is not a security boundary.
- Scoping that exists is **client-side only** — `DatabaseService.filterAssetsBySiteScope()` walks the asset tree to a `site`/`area` root and filters by `DataScope.siteIds`. It's a convenience filter, bypassable by any direct query.
- There is **no sub-company (legal entity) tier** — sites are top-level.
- **Configuration is global singletons** — `hierarchy_config` and `numbering_config` are `id = 1` (one level model + one number range for the whole system). Sub-companies cannot have their own numbering framework or level model.

We need real, enforced separation with parent rollup — the problem SAP solved with its enterprise structure.

---

## 2. SAP enterprise structure → IRAMS

| SAP org level | Meaning | IRAMS target |
|---|---|---|
| **Client (Mandant)** | hard data isolation; the tenant | deployment boundary / logical `tenant_id` |
| **Company Code (BUKRS)** | legal entity — a **sub-company**, own P&L & rollup | new **`company_id`** |
| **Plant / Maint. Plant (WERKS/SWERK)** | operational **site** where assets live & work happens | **`site_id`** (concept exists on assets) |
| **Storage Location (LGORT)** | inventory within a plant | inventory location (`site_id`-scoped) |
| **Work Center (ARBPL)** | crews executing work | scheduling labour resources |
| **Functional Location / Equipment (TPLNR/EQUNR)** | technical objects | `assets` (✅ delivered — FLOC vs Equipment, install log, configurable levels) |
| **Number range object + interval (NRIV)** | per-org identifier ranges | `numbering_config` keyed by org (§6) |
| **Authorization objects (I_SWERK, I_BEGRP, I_INGRP)** | access granted per org value | RLS filtered by the user's org scope (§7) |

**Ownership chain:** `Tenant → Company Code → Site → (Area → System → Sub-system → Equipment → Component)`.
The last five tiers already exist via `hierarchyModel`. This design adds **Company Code** and makes **Site** a first-class, enforced key.

---

## 3. Tenancy model decision

**Chosen: logical multi-tenancy — single database, row-scoped by org, enforced with RLS.**

| Option | Isolation | Group rollup | Ops cost | Verdict |
|---|---|---|---|---|
| **A. Single DB, row-scoped (RLS)** | strong (DB-enforced) | ✅ native (parent sees all) | low | **Recommended** |
| B. Schema/DB per company | hard | ❌ lost / manual ETL | high | Only if legally mandated |
| C. Separate deployments | hardest | ❌ none | highest | Reject unless regulatory |

Rationale: a parent with sub-companies wants **both** separation *and* consolidated reliability/cost benchmarking. A single SAP Client with company codes + plant authorizations gives exactly that; Option A is its cloud-native equivalent. Separate databases would kill cross-company rollup and multiply migration/ops overhead.

---

## 4. Org spine — schema

Introduce an explicit org backbone and stamp all owned data with the owning **site** (which rolls up to company → tenant).

```
tenants        (id, name, ...)                         -- usually one; future-proofing
companies      (id, tenant_id, code, name, ...)        -- SAP Company Code (sub-company)
sites          (id, company_id, code, name, ...)       -- SAP Plant  (or reuse SITE-level assets)
```

Decision point (see §12): **`sites` as a dedicated table** vs **reuse the existing SITE-level `assets` rows** as the plant. Recommended: a thin `sites` table that the SITE-level asset references, so org membership isn't inferred by tree-walking (the current fragile approach).

**Owned tables** get a denormalized **`site_id`** (fast RLS, no joins): `assets`, `work_orders`, `service_requests`, `recurring_work`, `job_tasks`, inventory, readings, RCA/FMEA, audits, etc. `company_id`/`tenant_id` are derivable from `site_id` via the org tables but may be denormalized on hot tables for policy speed.

Backfill: existing rows → a default company + site (the current implicit tenant).

---

## 5. Access model — DataScope → enforced

Reuse and formalize the existing `DataScope` (`types.ts`): `{ siteIds: string[]; departmentIds: string[]; ownWorkOnly: boolean }`, `['*']` = all.

- Stored per user (`users.data_scope_overrides`) and per role (`CONTACT_TYPE.dataScope`).
- A user's **effective scope** = role scope ∪ user overrides.
- **Group/parent users** get `siteIds: ['*']` (client-level super-user).
- Exposed to Postgres via a helper (JWT claim or a `user_site_scope` lookup table keyed by `auth.uid()`), so RLS can read it cheaply.

`filterAssetsBySiteScope` (client-side) is retained only as UX (fast pre-filter); the **authority moves to RLS**.

---

## 6. Number ranges per org (SAP NRIV)

Replace the **singleton** `numbering_config` with an **org-keyed** model:

```
numbering_config (
  scope_type text,        -- 'TENANT' | 'COMPANY' | 'SITE'
  scope_id   uuid,        -- the org id (NULL for the client-level default)
  object_class text,      -- 'FLOC' | 'EQUIPMENT' | 'WORK_ORDER' | 'NOTIFICATION' | ...
  prefix text, pad int, next_number bigint,
  auto_number_untagged boolean,
  PRIMARY KEY (scope_type, scope_id, object_class)
)
```

- Resolution order at generation time (most specific wins): **SITE → COMPANY → TENANT default**.
- So Plant 1000 issues `EQ-10xxxx`, Plant 2000 issues `EQ-20xxxx`; a sub-company can set its own FLOC prefix; unset objects fall back to the client default.
- The `generate_equipment_number()` trigger reads the resolved config for the new row's `site_id`.
- Extends naturally to WO/notification/order numbers (SAP has a number range object per document type).

This is the direct answer to *"unique numbering framework per entity."*

---

## 7. Configuration — central default + org override (SAP IMG pattern)

SAP splits **client-level config** (shared, transported) from **org-assigned** config. Mirror it:

- `hierarchy_config` (level model): **client-level default**, with optional **per-company override** (`scope_type/scope_id` like §6). Most tenants use the default; a sub-company with a different taxonomy overrides it. App loads the active tenant's effective config at bootstrap (`AppLayout` already hydrates via `setLevelModel`).
- Criticality rules, field visibility: same central-default + override.

---

## 8. RLS = authorization objects

Replace `USING(true)` with org-scoped policies (the SAP `I_SWERK`/`I_BEGRP` equivalent). Pattern per owned table:

```sql
-- read: rows in the user's allowed sites (or global)
CREATE POLICY "scope_select_assets" ON assets FOR SELECT TO authenticated
USING (
  public.user_has_global_scope()          -- ['*'] group users
  OR site_id = ANY (public.user_site_scope())  -- their sites
);
-- write: same predicate in USING + WITH CHECK
```

- `user_site_scope()` / `user_has_global_scope()` = `STABLE SECURITY DEFINER` helpers reading the caller's effective `DataScope` (from `data_scope_overrides` / a claims table).
- Applied to **every owned table**; shared tables (§9) keep a permissive read.
- `ownWorkOnly` adds an assignee predicate on work orders.

---

## 9. Central vs local data (what's shared vs scoped)

| Shared (client-level, all tenants) | Org-scoped (per site/company) |
|---|---|
| Manufacturer master (`manufacturers`) + models | Assets (FLOC/Equipment) |
| Vendors / business partners | Work orders, requests, PMs, tasks |
| Dictionaries (status, criticality, **ISO 14224 class/failure catalogs**) | Inventory & stock |
| Reliability metric *definitions* | Readings, RCA/FMEA, audits |
| Level-model default | Documents/files, financials |

Shared catalogs stay global so sub-companies benchmark consistently (same failure taxonomy) — exactly SAP's central class system + local technical objects.

---

## 10. UX

- **Tenant/Site switcher** for multi-scope (parent/group) users — sets the active org context; single-site users are auto-scoped, no switcher.
- **Create flows** stamp `site_id` from the active context (assets, WOs, etc.).
- **Number-range & config editors** (Admin) gain a scope selector (Client default / Company / Site).
- Reports/KPIs respect scope; group users can toggle "all companies" rollup vs a single entity.

---

## 11. Migration & rollout (phased, non-breaking)

| Phase | Deliverable | Risk gate |
|---|---|---|
| **T-0 Org spine** | `tenants/companies/sites` tables; add nullable `site_id` (+ `company_id`) to owned tables; backfill to a default org | additive; no behaviour change |
| **T-1 Scope resolver** | `user_site_scope()` / `user_has_global_scope()` from `data_scope_overrides`; seed group users `['*']` | read-only helpers |
| **T-2 Numbering & config per org** | migrate `numbering_config`/`hierarchy_config` to `(scope_type, scope_id)`; resolver most-specific-wins; trigger reads by `site_id` | keep client-default = today's values |
| **T-3 RLS enforcement** | swap `USING(true)` → scoped policies, **table by table**, behind testing; shared tables stay open | **the real cutover** — do per-table with verification |
| **T-4 UX** | site switcher, scoped create/config editors, rollup toggles | — |

**Safety:** T-3 is the sensitive step — enabling scoped RLS with a mis-seeded scope locks users out (deny-by-default). Do it **one table at a time**, verify group users still see all and a scoped test user sees only their site, with a fast rollback to `USING(true)` per table.

---

## 12. Decisions (signed off)

1. **Company Code tier — INCLUDED now.** Full SAP fidelity `tenant → company → site`. Added as a column from the start (cheap now, expensive to retrofit).
2. **Dedicated `sites` table — YES.** A thin `sites` table (SAP Plant); the SITE-level asset references it. Ownership is an explicit key, not inferred by tree-walking.
3. **Scope delivery — `user_site_scope` lookup table** (keyed by `auth.uid()`), read by RLS helpers. Simpler than JWT claims; revisit claims only if policy latency demands it.
4. **Denormalize `company_id`/`site_id`** on hot tables (`assets`, `work_orders`, …) for fast policies; org tables remain the source of truth.
5. **Shared vs scoped** — per the §9 catalog (shared: manufacturer/vendor/dictionaries/ISO 14224 classes/metric definitions; scoped: assets/WOs/inventory/PMs/readings/RCA/FMEA/audits/files/financials).

*All signed off — the design is ready to drive T-0. The org-key on the two config tables (§13) is shipped ahead of T-0 as the low-regret step (migration `0165`).*

---

## 13. Bottom line

The SAP enterprise-structure blueprint de-risks this: our **technical-object layer already matches SAP** (TPLNR/EQUNR, install relationship, configurable levels). The remaining work is the **enterprise-structure + authorization phase** — add the Company Code tier, make **number ranges and config org-assigned** (SAP NRIV/IMG), and **enforce with RLS as authorization objects**. It touches every table, so it's a **dedicated phase, not a bolt-on** — but it's an *extension* of a system already leaning this way, executed against a proven model.

**Recommended immediate, low-regret step:** even before the full phase, give `numbering_config` and `hierarchy_config` an org key (`scope_type/scope_id`, default = client) so they aren't migrated twice.
