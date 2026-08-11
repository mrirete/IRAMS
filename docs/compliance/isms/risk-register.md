# Risk Assessment & Register

**Version:** 1.0 — 2026-08-08 · **Review:** quarterly + on material change · Satisfies 6.1.2/6.1.3

## Methodology (kept deliberately simple so it gets used)

Risk = Likelihood (1–3) × Impact (1–3), assessed against C/I/A of customer
data and service. **Treat** everything ≥ 6; **monitor** 3–4; **accept** 1–2
with a note. Treatment lands as a control in the SoA, ideally as code.
Assessor: `[DECIDE: owner]`. History note: this register is seeded from
*real* findings of 2026 security work, not hypotheticals — each row cites
its evidence.

## Register

| ID | Risk | L | I | Score | Treatment | Status |
|---|---|---|---|---|---|---|
| R-01 | Cross-tenant data access via missed RLS conjunct on a new table | 2 | 3 | **6** | Tenant conjunct pattern (0269/0270 must-bind), `aa_stamp_tenant` triggers (0276), `audit-policies.mjs --strict`, `tests/rls/cross-tenant.mjs` | Treated — controls live; residual: new-table discipline |
| R-02 | Unauthenticated storage exposure (was REAL: public buckets until 0281) | 2 | 3 | **6** | 0281 private+tenant-scoped buckets; `audit-storage.mjs` blocking in CI | Treated 2026-08-07; recurring control operating |
| R-03 | Orphan/hand-made DB policies defeating migrations (was REAL: 0238 no-op, 0240 orphans) | 2 | 3 | **6** | Ledgered migration runner (checksums), wipe-and-recreate policy pattern (0186), `audit-policies.mjs` orphan detection | Treated; audit run per calendar |
| R-04 | Personal data reaching AI provider beyond expectation (free-text in prompts) | 2 | 2 | 4 | Server-side proxy only, per-workspace budget (0229), workspace AI-disable option, disclosure in privacy notice §4 | Monitor; paid-tier no-training terms verified 2026-08-10 (sub-processor register); `[ACTION: confirm prod key billing-enabled]` |
| R-05 | Secret leakage via client bundle (VITE_ vars) or repo | 2 | 3 | **6** | `.env*` gitignored; service keys server-side only; Gemini fallback DEV-guarded (F-007, 2026-08-11); gitleaks full-history in CI with dead-credential allowlist (F-005) | Treated 2026-08-11 |
| R-06 | Single-operator risk: one person holds all admin access (bus factor, no segregation) | 3 | 2 | **6** | Compensating: append-only audit of admin actions; self-auditing controls; `[DECIDE: break-glass credential escrow + second admin when team grows]` | Accepted with compensation — structural at current size; revisit at first hire |
| R-07 | Supplier failure/breach (Supabase/Vercel/Google/Resend) | 1 | 3 | 3 | Register + DPAs; suppliers hold own certifications; export/portability path per tenant | Monitor annually |
| R-08 | Account takeover of admin | 2 | 3 | **6** | TOTP built 2026-08-11 (F-004): enrollment in Settings→Security, aal2 challenge at login, admin nag; unenroll requires aal2 | Treated (capability); residual = per-account opt-in until an org mandate — admins must actually enroll |
| R-09 | Malicious/compromised dependency (supply chain) | 2 | 2 | 4 | Trivy daily + CRITICAL blocking; npm audit critical gate; protobufjs bumped 7.6.5; Actions pinned by SHA (F-005, 2026-08-11) | Treated; residual = JS SAST (F-009) |
| R-10 | Data loss (bad migration, deletion bug) | **3** | 3 | **9** | Transactional ledgered migrations only. **Re-scored 2026-08-11: API probe shows pitr_enabled=false and zero backups — there is NO restore path on the current plan.** Sole treatment: plan upgrade (F-006, user) | **OPEN — now the top risk in the register** |
| R-11 | Availability loss of prod (region outage, quota) | 1 | 2 | 2 | Accepted at current tier; Supabase/Vercel SLAs; smoke tests | Accepted |
| R-12 | Unverifiable erasure in free text (GDPR limit) | 2 | 1 | 2 | Documented limitation in DSR procedure; targeted-search offer | Accepted, disclosed |
| R-13 | Test/demo accounts in prod with known passwords (was REAL until env-var move) | 2 | 2 | 4 | Creds moved to env (a8a4313); `[DECIDE: disable demo accounts at launch per launch-login plan]` | Partially treated |
| R-14 | Signup abuse (no CAPTCHA/email-verify) — tenant spam, resource burn | 2 | 1 | 2 | Tier ceiling caps blast radius; `[BUILD: email verification at signup — planned]` | Monitor |

## Treatment queue (what "Open"/"[BUILD]" rows imply, ordered)

1. **R-08 MFA for admin roles** — the only score-6 with no live control.
2. R-05: dev-only guard on the Gemini key fallback; add gitleaks to CI.
3. R-09: `npm audit --audit-level=high` gate; pin third-party GitHub Actions by SHA.
4. R-10: perform and minute one restore test (evidence for A.8.13/A.5.30).
5. R-13/R-14: launch-gate items already on the launch plan.

Every treated row must point at a control that produces evidence on its own
(CI job, audit view, script) — a treatment that requires remembering is a
monitor row, not a treated one.
