# Tenant Provisioning Runbook

_Status: operational · Model: **one Supabase project per customer** (deployment-per-tenant) · Companion: `IRAMS-Specialist-Strategy.md`_

---

## 1. The model, and why

Each customer gets **their own Supabase project** — their own database, their own storage, their own function secrets. No shared rows, no neighbours.

This is the posture migration `0173` shipped ("_No separate `tenants` table under the chosen SINGLE-TENANT-PER-DEPLOYMENT model — one deployment == one tenant_"), and it deliberately deviates from the shared-database recommendation in `Multi-Tenancy-Enterprise-Structure-Design.md` §3. Both are right for different questions:

| Question | Answer |
|---|---|
| Separating **different customers** who don't know each other | **Deployment-per-tenant** — this document |
| Separating **sub-companies / sites inside one customer** | The `companies` + `organization_units` org spine, *within* that customer's project |

**Consequences to keep in mind:**

- The risky T-3 RLS enforcement cutover (documented deny-by-default lockout risk) is **not needed** for customer isolation.
- Data-privacy answer becomes the strongest possible: *your data is in your own database.*
- **Cross-tenant benchmarking is not free.** Strategy §7 O1 (the benchmarking flywheel) needs a deliberate consented, anonymized aggregation into a central store — it is no longer a byproduct.
- Every migration must be applied to **every** project. That is what §3 automates.

---

## 2. Prerequisites

| Need | How |
|---|---|
| Supabase personal access token (`sbp_…`) | Account → Access Tokens. Export as `SUPABASE_ACCESS_TOKEN`. |
| Supabase CLI | `npx --no-install supabase` (already vendored in `src/frontend/node_modules`) |
| Node 20+ | for the migration runner |

```powershell
# PowerShell — this machine keeps the token in Credential Manager ("Supabase CLI:supabase")
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
```

---

## 3. Provision a new customer project

### 3.1 Create the project

Create it in the Supabase dashboard (or Management API). Record the **project ref** and the database password.

### 3.2 Load the baseline schema and reference data

**Do not replay migration history** — it does not work (§6). New tenants load a baseline generated from the known-good origin project:

```bash
# 1. Schema — 150 tables, 489 indexes, 472 policies, 37 functions, 6 views…
node scripts/provision/load-baseline.mjs --project-ref <ref> \
     --file src/frontend/supabase/baseline/schema.sql

# 2. Reference data — codes, dictionaries, config, audit templates (448 rows)
node scripts/provision/load-baseline.mjs --project-ref <ref> \
     --file src/frontend/supabase/baseline/seed.sql

# 3. Record history so FUTURE migrations apply incrementally
node scripts/provision/apply-migrations.mjs --project-ref <ref> --baseline

# 4. Confirm
node scripts/provision/load-baseline.mjs --project-ref <ref> --census
```

Step 3 matters: `--baseline` marks every existing migration as applied without running it, so a migration added tomorrow applies to this tenant with a plain `--apply`.

**Verified 2026-07-25** by loading into a throwaway project and comparing against the origin: all ten catalog counts matched, and six structural fingerprints (columns with types and defaults, constraint definitions, index definitions, policy predicates, function signatures, every enum label) matched exactly. Reference data matched row-for-row across all 15 tables, with zero rows in `assets`, `work_orders`, `users`, `contacts`, `audit_logs` or any operational table.

### 3.2a Refreshing the baseline

Regenerate whenever the origin schema changes materially:

```bash
node scripts/provision/export-schema.mjs --project-ref hacrebcfvyqdnjvilhqc
node scripts/provision/export-seed.mjs   --project-ref hacrebcfvyqdnjvilhqc
```

`export-seed.mjs` carries an explicit allowlist of reference tables. **Anything not on that list is never exported** — adding a table means asserting it holds no customer data. `schema_migrations` is deliberately excluded, since each project owns its own ledger.

Seed loading suppresses triggers (`session_replication_role = replica`), so the audit trigger does not record the seeding itself and a new tenant opens with an empty `audit_logs`.

### 3.3 Function secrets

```bash
cd src/frontend
npx --no-install supabase link --project-ref <ref>
npx --no-install supabase secrets set \
  GEMINI_API_KEY=...        `# agent-run, specialist-briefing` \
  BRIEFING_CRON_KEY=...     `# must match the vault secret in 3.4` \
  RESEND_API_KEY=...        `# notify-dispatch, audit-invite` \
  FROM_EMAIL="Relantern <briefings@yourdomain>" \
  APP_URL=https://<customer-app-url> \
  INGEST_API_KEY=...        `# ingest-readings webhook`
```

Per-customer CMMS write-back tokens are added the same way, named to match the `config.auth.secret_env` on their `writeback_targets` row (see `0221`).

### 3.4 Vault secrets

Two secrets live in the database, not the function environment, because `pg_cron` reads them at fire time:

```sql
SELECT vault.create_secret('https://<ref>.supabase.co', 'project_url');
SELECT vault.create_secret('<same value as BRIEFING_CRON_KEY>', 'briefing_cron_key');
```

**`project_url` is required** — migration `0223` builds the Monday-briefing URL from it. Without it the cron posts to NULL and does nothing (a visible no-op, deliberately, rather than calling another tenant's deployment).

### 3.5 Deploy the edge functions

```bash
cd src/frontend
for f in agent-run specialist-briefing notify-dispatch proposal-writeback sensor-sync detect-sweep audit-invite create-user; do
  npx --no-install supabase functions deploy $f
done
npx --no-install supabase functions deploy ingest-readings --no-verify-jwt   # webhook, x-api-key auth
npx --no-install supabase functions deploy specialist-briefing --no-verify-jwt  # cron, x-cron-key auth
```

### 3.6 Set the edition

```sql
-- 'specialist' hides EAM navigation and lands users in the Specialist workspace;
-- 'platform' is the full IRAMS.
UPDATE companies SET edition = 'specialist' WHERE code = 'MAIN';
```

### 3.7 First admin user

Use the `create-user` function or the Supabase dashboard, then confirm the row in `public.users` carries an admin role. Reference data (dictionaries, reference codes, the default `MAIN` company) is seeded by numbered migrations and needs no extra step.

> `master_seed.sql` and `cleanup_finops.sql` are **not** numbered migrations and the runner ignores them by design — they carry demo data and must not run for a real customer.

### 3.8 Verify

```bash
node scripts/provision/apply-migrations.mjs --project-ref <ref> --status   # expect: Pending 0
```

Then in the app: sign in, open **Specialist → Import CMMS Data**, run a small import, and confirm the assessment renders.

---

## 4. Apply a new migration to existing tenants

Add the migration to `src/frontend/supabase/migrations/`, then for each tenant:

```bash
node scripts/provision/apply-migrations.mjs --project-ref <ref> --apply
```

Only what is new runs. Keep a list of live project refs and loop over it.

---

## 5. The original project (dev / demo)

It predates the runner, so its history was recorded without re-executing anything:

```bash
node scripts/provision/apply-migrations.mjs --project-ref hacrebcfvyqdnjvilhqc --baseline
```

Baseline marks every current migration as applied **without running it**. Done on 2026-07-25 (229 migrations). From then on it takes new migrations incrementally like any tenant — `0223` was the first applied that way.

Caveat: baselining asserts the schema already matches. That project has known historical drift (0149's RAG section never applied — repaired by `0222`), so treat it as a dev environment, not a template.

---

## 6. Why history is not replayed (RESOLVED — kept as the record)

> **Status: no longer a blocker.** §3.2 provisions from a verified baseline instead. This section documents what the replay test found, so the decision isn't re-litigated and the underlying repo issues stay visible.

**Tested 2026-07-25 on a throwaway project (created, replayed, deleted).** Result: of 230 migrations, **187 applied and 43 failed**. §3.2 as written cannot yet provision a real customer.

Reproduce with:

```bash
node scripts/provision/apply-migrations.mjs --project-ref <scratch> --apply --allow-duplicates --continue-on-error
```

`--continue-on-error` is **diagnostic only** — it keeps going so one pass enumerates every break. Never use it for real provisioning.

### 6.1 Root causes (the rest are knock-on)

| # | Migration | Failure | Class |
|---|---|---|---|
| 1 | `0114_create_audit_logs.sql` | `syntax error at or near "br"` — **the file's entire content is the two characters `br`** | **Corrupted file.** Cascades to 0118, 0121, 0130, 0158 → then 0157, 0160, 0162, 0165, 0167 → **0171**, which defines `public.is_admin()`, cascading again to 0173, 0175, 0183, 0186, 0190, 0191, 0219, 0221, 0222. One lost file accounts for roughly half the failures. |
| 2 | `0047_seed_reference_data.sql` | `relation "reference_codes" does not exist` | Numbered before the migration that creates the table. Cascades to 0049, 0050, 0054, 0060, 0061, 0062, 0064. |
| 3 | `0025_add_rca_collaborators.sql` | `relation "ers_rca_investigations" does not exist` | Numbered ~130 files before its dependency. |
| 4 | `0026_create_jsa_tables.sql` | `function moddatetime() does not exist` | Extension never enabled — **the same class of bug as `0149`/pgvector.** Cascades to 0051. |
| 5 | `0044_add_finops_tables.sql` | `function update_modified_column() does not exist` | Helper function never defined. |
| 6 | `0029_add_cost_center_cols.sql` | `relation "cost_centers" does not exist` | Ordering. |
| 7 | `0086_seed_manufacturers.sql` | `column "default_role" of relation "contacts" does not exist` | Ordering. |
| 8 | `0027_populate_dictionary_hierarchy.sql` | HTML gateway error, not SQL | Needs investigation (file is only 2 KB, so not size). |
| 9 | `0201_atp_reservation_netting.sql` | `column wop.quantity does not exist` | Ordering. |
| 10 | `0216_schema_drift_repair.sql` | FK violation on `warranties` | Seed-data ordering. |

The **23 duplicate migration numbers** (0001, 0002, 0003, 0022, 0025, 0026, 0029, 0031, 0032, 0033, 0036, 0037, 0038, 0049, 0050, 0051, 0052, 0053, 0072, 0073, 0074, 0102, 0141 — 0141 has four files) are a real hazard but were **not** the main cause; ordering and the corrupted file were.

### 6.2 The fix that shipped — squash to a verified baseline

Repairing 230 files of history was the losing option: each fix needs a fresh replay to verify, and the archaeology never ends. History is now squashed into a baseline instead (§3.2).

`supabase db dump` runs `pg_dump` inside Docker, which wasn't available, so `export-schema.mjs` asks Postgres to emit its own DDL over the Management API — `pg_get_functiondef`, `pg_get_indexdef`, `pg_get_constraintdef`, `pg_get_triggerdef`, `pg_get_viewdef`, plus catalog reads for tables, enums, RLS and grants. Emission order mirrors pg_dump (extensions → types → sequences → functions → tables → constraints → indexes → views → triggers → RLS → grants) with `check_function_bodies = off` so functions can be created before the tables they reference.

Because it is hand-rolled rather than `pg_dump`, it is **verified rather than trusted**: load it into a scratch project and compare fingerprints against the origin (§3.2). Re-run that check after any baseline refresh.

### 6.2a Repairs made anyway

- **`0114_create_audit_logs.sql` reconstructed** from the live schema. It is no longer a two-character file, so a subset replay of history no longer detonates at the root of the largest cascade.

Remaining root causes (0047, 0025, 0026, 0044, 0029, 0086, 0027, 0201, 0216) are **not** fixed. They are harmless now — history is never replayed — but they are why a partial replay still cannot be trusted.

### 6.3 Other issues

| Issue | Impact | Status |
|---|---|---|
| Migrations not wrapped in transactions | A mid-file failure half-applies (how `0149` lost `ers_rag_documents`) | Runner auto-wraps; `--dry-run` shows the mode per file |
| `0177_connectors.sql` is empty by design, `0114` is empty by accident | Two files lost content; only one was noticed at the time | 0114 must be reconstructed or superseded |
| `0071` header references a historical project ref | Cosmetic — a comment only | No action |

---

## 7. Cost

~$25/month per Supabase project (Pro). Against $1,500–3,000/month per site (strategy §5.3) that is 1–2% of revenue — not a constraint on the model.
