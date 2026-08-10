# Information Security Policy

**Version:** 1.0 — 2026-08-08 · **Approved by:** `[DECIDE: top management signature]` · **Review:** annually
Satisfies Clause 5.2; topic-specific policies (A.5.1) are the numbered
sections — at this organisation's size one document beats eight thin ones.

## 1. Commitment

Relantern protects the confidentiality, integrity and availability of
customer and company information as a first-order product property, not a
compliance afterthought. Security controls are implemented **in the platform**
(database-enforced, CI-enforced) wherever possible, so that they cannot
silently drift from this policy. Top management commits the resources the
ISMS needs and reviews its performance per the management-review cycle.

## 2. Security objectives (6.2) — measured, not aspirational

| Objective | Measure | Target |
|---|---|---|
| No cross-tenant data access | `tests/rls/cross-tenant.mjs` + `audit-policies.mjs --strict` | zero findings, every run |
| No unauthenticated data exposure | `storage_bucket_visibility_audit` view + `audit-storage.mjs --strict` in CI | zero rows / green job |
| Audit trail integrity | append-only policies on `audit_logs` | zero UPDATE/DELETE policies ever |
| Vulnerability response | CI scans (Trivy/Bandit) | CRITICAL fixed ≤ 14 days `[DECIDE: confirm SLA]` |
| Breach notification | DPA §6 | controller informed ≤ 48h |
| Availability | Supabase/Vercel status + smoke tests (`prod-smoke.yml`) | `[DECIDE: publish a target once measured]` |

## 3. Access control (A.5.15–18, A.8.2–8.5)

Least privilege, enforced in the database: row-level security with
JWT-derived tenant claim on every table; role gates (`role_can`, 0241) for
writes; admin-only deletes; `is_admin()` for governance tables. The
service-role key is confined to edge functions' server-side env. Production
credentials live in a password manager `[DECIDE: name it]`, never in the
repo (CI-verified: `.env*` gitignored). Access reviews quarterly per the
calendar; leavers lose access the same day via `delete_auth_user` +
credential rotation.

## 4. Change management & secure development (A.8.25–8.32)

All changes flow through git on a feature branch; schema changes are
numbered migrations applied by the ledger-keeping runner (checksummed,
transactional, refuses drift); posture-affecting changes carry their own
verification (the `audit-*.mjs` scripts). CI runs typecheck, unit tests,
security scans on every push; deploys are CLI-driven from committed HEAD
only. Test data uses `@cainergy.com` accounts, never production personal
data.

## 5. Operations (A.8.6–8.16, A.5.29–5.30)

Logging: append-only `audit_logs`, AI audit log, notification logs, CI run
history. Monitoring: daily scheduled security scans; self-auditing database
functions. Backups: Supabase PITR `[DECIDE: confirm window]`; restore test
annually per calendar. Capacity: Supabase/Vercel managed, reviewed at
management review.

## 6. People (A.6.1–6.8)

Everyone with production access signs confidentiality terms; security
awareness is part of onboarding; screening per local law for roles with
production access `[DECIDE: formalise when first hire with prod access
happens]`. Remote work: production access only from managed devices with
disk encryption `[DECIDE: confirm and inventory devices — this is the
weakest documented area at current scale]`.

## 7. Suppliers (A.5.19–5.23)

No production data flows to a vendor absent from the
[sub-processor register](../subprocessor-register.md); vendors are reviewed
annually (attestations: Supabase SOC 2, AWS, Vercel, Google, Resend) and
before adoption. Cloud-service exit: the tenant-portable migration runner
and per-tenant export exist precisely so no supplier is a roach motel.

## 8. Incidents (A.5.24–5.28)

Per [incident-response.md](incident-response.md). Everyone reports suspected
events; nobody is penalised for reporting; evidence handling and
notification duties are defined there.

## 9. Exceptions

Any deviation from this policy requires a written, time-boxed exception in
the [findings log](internal-audit-and-review.md#3-findings--nonconformity-log)
with a compensating control. Standing exceptions are reviewed at every
management review.
