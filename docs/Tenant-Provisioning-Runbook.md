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

### 3.2 Apply the schema

```bash
# See what would run, and how each file will be executed
node scripts/provision/apply-migrations.mjs --project-ref <ref> --dry-run

# Apply everything, in order, stopping at the first failure
node scripts/provision/apply-migrations.mjs --project-ref <ref> --apply
```

The runner keeps a ledger (`public.schema_migrations`) in the target project, wraps each migration in a transaction unless the file manages its own (or contains something Postgres refuses to run in one), and records a checksum so a later edit to an applied migration is caught rather than silently re-run.

> ⚠️ **Before the first real customer, prove the replay on a scratch project.** The repo has **23 duplicate migration numbers** (see §6). On a fresh project their order is decided by filename, which may not match the order they were originally applied. The runner refuses `--apply` when duplicates are *pending* until you pass `--allow-duplicates` — do that only after a scratch replay has succeeded.

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

## 6. Known issues

| Issue | Impact | Status |
|---|---|---|
| **23 duplicate migration numbers** (0001, 0002, 0003, 0022, 0025, 0026, 0029, 0031, 0032, 0033, 0036, 0037, 0038, 0049, 0050, 0051, 0052, 0053, 0072, 0073, 0074, 0102, 0141) | Replay order on a fresh project is filename-decided and may not match the original apply order | Runner blocks `--apply` when any are pending. **Prove a scratch replay before the first customer.** |
| Migrations not wrapped in transactions | A mid-file failure half-applies (this is how `0149` lost `ers_rag_documents`) | Runner auto-wraps; `--dry-run` shows the mode per file |
| `0071` header references a historical project ref | Cosmetic — a comment only | No action |

---

## 7. Cost

~$25/month per Supabase project (Pro). Against $1,500–3,000/month per site (strategy §5.3) that is 1–2% of revenue — not a constraint on the model.
