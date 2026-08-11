# Internal Audit, Management Review & Findings

**Version:** 1.0 — 2026-08-08 · Satisfies 9.2, 9.3, 10.2

## 1. Internal audit programme (9.2)

Quarterly, one quarter ahead of any certification Stage 1. At current scale
the "auditor" is whoever did NOT build the area under audit — where that is
impossible (single operator), the audit is script-driven so the evidence is
machine-generated rather than self-assessed, and the limitation is minuted.

**Quarterly audit checklist (run and file the outputs):**

| Check | Command / evidence |
|---|---|
| DB policy posture matches repo | `node scripts/provision/audit-policies.mjs --project-ref <ref> --strict` |
| Storage private + tenant-scoped | `node scripts/provision/audit-storage.mjs --project-ref <ref> --strict` |
| Cross-tenant isolation | `node src/frontend/tests/rls/cross-tenant.mjs` (and the rls suite) |
| Bucket audit view empty | `SELECT * FROM storage_bucket_visibility_audit` → 0 rows |
| Retention sweep operating | `SELECT * FROM audit_logs WHERE action='RETENTION_SWEEP' ORDER BY "timestamp" DESC LIMIT 3` |
| Access review | Enumerate `users` with admin roles + Supabase dashboard members + GitHub collaborators + Vercel team — each still justified? |
| Secrets hygiene | No `.env` tracked (`git ls-files | grep -i env`); PAT/keys rotated ≤ 12 months |
| CI security jobs green | Last 30 days of security-scan.yml runs |
| Sub-processor register current | Diff against edge functions' outbound `fetch(` targets |
| SoA drift | Any 🟡/🔵 changed status? Any new tables without retention row? |

**Schedule & record:**

| Quarter | Date run | By | Findings raised | Filed at |
|---|---|---|---|---|
| 2026 Q3 | — first audit due `[DECIDE: date it]` | | | |

## 2. Management review (9.3) — twice yearly, 30 minutes, minuted

Fixed agenda: status of prior actions · changes in context/interested
parties · security-objective metrics (policy §2 table, actuals vs target) ·
audit results & findings log · incident log · risk register deltas +
treatment queue · supplier review outcomes · resource decisions ·
improvement opportunities. Output = dated minutes + decisions appended to
the findings log. First review: `[DECIDE: schedule within 3 months]`.

## 3. Findings & nonconformity log (10.2)

One log for everything — audit findings, incidents' retro actions, policy
exceptions, improvement items. A finding closes only when its fix carries
evidence (commit, CI run, minute).

| ID | Raised | Source | Description | Action | Owner | Closed | Evidence |
|---|---|---|---|---|---|---|---|
| F-001 | 2026-08-07 | Compliance assessment | Storage buckets public (INC-2026-001) | 0281 + CI audit | — | 2026-08-07 | commit 46b74fb; audit green |
| F-002 | 2026-08-07 | Assessment | No GDPR document set | docs/compliance/ authored | — | 2026-08-08 | commit a105079, d0d69b4 |
| F-003 | 2026-08-08 | Assessment | No erasure/retention mechanics | 0282 applied + cron live | — | 2026-08-08 | ledger row 0282; cron.job present |
| F-004 | 2026-08-08 | Risk assessment | **MFA absent on admin roles (R-08)** | TOTP enrollment panel (Settings→Security), login challenge (aal2), admin nag — built 2026-08-11. Residual: org-wide *mandate* for admin roles is per-account opt-in until enforced in policy | — | 2026-08-11 (capability) | MFAPanel.tsx, Login.tsx challenge step |
| F-005 | 2026-08-08 | Risk assessment | CI vulnerability gates advisory-only; no JS dep scan; no secret scan; Actions unpinned (R-09) | Trivy CRITICAL blocking; npm audit critical gate (protobufjs 7.6.5 bumped to make it green honestly); gitleaks full-history with allowlist (old shared password verified DEAD 2026-08-11 before allowlisting); all actions pinned by SHA. Residual: JS SAST (semgrep) still open → folded into F-009 | — | 2026-08-11 | security-scan.yml, .gitleaks.toml |
| F-006 | 2026-08-08 | Risk assessment | **RECLASSIFIED 2026-08-11 — worse than raised:** management API shows `pitr_enabled: false`, `backups: []` — the production project has **no restorable backup**, not merely an untested one (R-10 likelihood↑). Recovery today = migration replay onto empty schema; data unrecoverable | `[DECIDE: upgrade project to Pro (daily backups + PITR) — this is the single cheapest risk reduction available; then run + minute the restore test]` | **user** | — | API probe 2026-08-11 |
| F-007 | 2026-08-08 | Risk assessment | Gemini key dev-fallback still bundleable (R-05) | `import.meta.env.DEV` guard in all three services — statically false in prod builds, so the key path is dead code eliminated | — | 2026-08-11 | AIAnalysisEngine/AuditAssessor/geminiService |
| F-008 | 2026-08-08 | SoA | security@/privacy@ mailboxes unrouted while published | create mailboxes | **user** | — | — |
| F-009 | 2026-08-11 | F-005 residual | No JS/TS SAST (Bandit covers only the Python layers) | add semgrep (or eslint-security) job | `[DECIDE]` | — | — |
