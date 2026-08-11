# Statement of Applicability (SoA)

**Version:** 1.0 — 2026-08-08 · **Review:** with every risk-register review · Satisfies 6.1.3(d)
All 93 Annex A controls (ISO/IEC 27001:2022). Status: ✅ implemented ·
🟡 partial · 🔵 planned · ⚪ N/A (justified). Evidence points at the repo or
provider attestation — an auditor (or customer) should be able to check each
row without interviewing anyone.

## 5 — Organisational (37)

| # | Control | Status | Implementation / justification |
|---|---|---|---|
| 5.1 | Policies for infosec | ✅ | [information-security-policy.md](information-security-policy.md), approved + reviewed annually |
| 5.2 | Roles & responsibilities | 🟡 | Policy §1; single-operator reality documented as R-06 with compensation |
| 5.3 | Segregation of duties | 🟡 | Structurally limited (R-06); compensated by append-only audit + automated gates that even admin can't bypass silently |
| 5.4 | Management responsibilities | ✅ | Policy commitment §1; management review cycle |
| 5.5 | Contact with authorities | ✅ | DSR/incident docs name OAIC/OPC/DPAs; breach-notification duties mapped |
| 5.6 | Special interest groups | 🔵 | `[DECIDE: subscribe to Supabase security advisories + a CVE feed — 10 min]` |
| 5.7 | Threat intelligence | 🟡 | Daily Trivy CVE scans = tactical; strategic feed = 5.6 |
| 5.8 | Infosec in project mgmt | ✅ | Security work runs as migrations/PRs with verification scripts; e.g. 0281 pattern |
| 5.9 | Inventory of info & assets | ✅ | RoPA (data), sub-processor register (services), repo (software); `storage.buckets`/schema are self-describing |
| 5.10 | Acceptable use | 🟡 | Policy §6; formalise on first hire |
| 5.11 | Return of assets | 🔵 | With first hire (leaver checklist) |
| 5.12 | Classification | ✅ | Retention policy categories P-1…P-11 + bucket sensitivity (the 0281 lesson: classification now precedes storage decisions) |
| 5.13 | Labelling | ⚪ | Single-product SaaS; classification is structural (schema/bucket), not label-based |
| 5.14 | Information transfer | ✅ | TLS everywhere; signed URLs; DPA governs customer transfer |
| 5.15 | Access control | ✅ | RLS + role_can (0241) + tenant conjunct (0258–0281); policy §3 |
| 5.16 | Identity management | ✅ | Supabase Auth; one identity per person; invites tokenised (0190) |
| 5.17 | Authentication info | ✅ | Salted hashes (provider); test creds in env (a8a4313); TOTP 2FA live 2026-08-11 (enrollment + aal2 login challenge); residual: per-account opt-in |
| 5.18 | Access rights | ✅ | Role templates in DB; quarterly review per calendar; same-day leaver revocation path |
| 5.19–5.22 | Supplier security (4 controls) | ✅ | Sub-processor register + annual review + DPAs + inherited attestations |
| 5.23 | Cloud services security | ✅ | Register + region pinning (eu-west-1) + exit path (tenant-portable runner) |
| 5.24 | IR planning | ✅ | [incident-response.md](incident-response.md) |
| 5.25 | Assessment of events | ✅ | IR §2 triage |
| 5.26 | Response to incidents | ✅ | IR §3 |
| 5.27 | Learning from incidents | ✅ | IR §5 post-incident review → findings log; precedent: stuck-spinner & 0238 no-op retros exist in repo docs |
| 5.28 | Evidence collection | ✅ | IR §4; append-only audit_logs are the substrate |
| 5.29 | Security during disruption | 🟡 | Provider SLAs; documented deploy/rollback; BC test pending (R-10) |
| 5.30 | ICT readiness for BC | 🔴 | Follows 8.13: no backups on current plan (verified 2026-08-11) — recovery = migration replay, data lost. Plan upgrade is F-006 |
| 5.31 | Legal/regulatory requirements | ✅ | `docs/compliance/` set (GDPR + NA/AU deltas) |
| 5.32 | Intellectual property | ✅ | Licensed deps only; lockfiles |
| 5.33 | Protection of records | ✅ | Append-only audit; retention schedule + sweep (0282) |
| 5.34 | Privacy & PII | ✅ | Full GDPR set; erase_person (0282); /privacy live |
| 5.35 | Independent review | 🔵 | = the certification audit / first external pentest `[DECIDE: budget a pentest — strongest pre-cert signal]` |
| 5.36 | Compliance w/ policies | ✅ | CI gates + audit scripts ARE the compliance check |
| 5.37 | Documented procedures | ✅ | Runbooks in docs/ + scripts with embedded docs |

## 6 — People (8)

| # | Control | Status | Implementation |
|---|---|---|---|
| 6.1 | Screening | 🔵 | On first hire with prod access |
| 6.2 | Employment terms | 🟡 | Confidentiality for prod access; formalise on hire |
| 6.3 | Awareness & training | 🟡 | Founder-operated; onboarding module on first hire |
| 6.4 | Disciplinary process | 🔵 | With first hire |
| 6.5 | Post-termination duties | 🔵 | Leaver checklist with first hire |
| 6.6 | Confidentiality agreements | 🟡 | In customer DPA; internal NDA template on hire |
| 6.7 | Remote working | 🟡 | Policy §6; device inventory `[DECIDE]` |
| 6.8 | Event reporting | ✅ | IR §1 — anyone reports, no-blame |

## 7 — Physical (14)

| # | Control | Status | Implementation |
|---|---|---|---|
| 7.1–7.4 | Perimeters, entry, offices, monitoring | ⚪ | No company premises hold service data — inherited: AWS/Supabase data-centre controls (their ISO/SOC 2 attestations on file per 5.19) |
| 7.5–7.8 | Physical threats, work in secure areas, desk, siting | ⚪ | Same inheritance; endpoint side → 7.9 |
| 7.9 | Off-premises assets | 🟡 | Dev machines: disk encryption + screen lock `[DECIDE: verify & minute it]` |
| 7.10 | Storage media | ✅ | No removable media in any workflow; cloud-only |
| 7.11–7.13 | Utilities, cabling, maintenance | ⚪ | Inherited (cloud) |
| 7.14 | Secure disposal | ✅ | Provider-side; local: full-disk encryption makes disposal cryptographic |

## 8 — Technological (34)

| # | Control | Status | Implementation |
|---|---|---|---|
| 8.1 | User endpoint devices | 🟡 | = 7.9 |
| 8.2 | Privileged access | ✅ | is_admin() gates; service-role confined to edge functions; SECURITY DEFINER derives tenant (0261) |
| 8.3 | Info access restriction | ✅ | RLS everywhere + private tenant-scoped storage (0281) |
| 8.4 | Source code access | ✅ | Private repo; branch workflow |
| 8.5 | Secure authentication | ✅ | JWT verified server-side (getUser(jwt) in all fns); TOTP MFA + aal2 challenge live 2026-08-11 (F-004) |
| 8.6 | Capacity | ✅ | Provider-managed + tier ceilings (0278) |
| 8.7 | Malware | ⚪ | No file-execution surface server-side; endpoint AV = OS default |
| 8.8 | Technical vulnerabilities | ✅ | Trivy CRITICAL blocking + npm audit critical gate + gitleaks, actions SHA-pinned (F-005, 2026-08-11); HIGH advisory pending triage |
| 8.9 | Configuration mgmt | ✅ | Config = migrations + IaC-ish scripts, ledgered & checksummed |
| 8.10 | Information deletion | ✅ | erase_person + retention_sweep (0282), self-auditing |
| 8.11 | Data masking | 🟡 | Pseudonymisation (0024/0282); no prod-data-in-dev practice |
| 8.12 | Data leakage prevention | ✅ | Private buckets + signed URLs + no-analytics client |
| 8.13 | Backups | 🔴 | **API-verified 2026-08-11: pitr_enabled=false, zero backups — no restore path on current plan.** F-006 → plan upgrade (user). Was wrongly assumed 🟡 |
| 8.14 | Redundancy | ⚪ | Accepted R-11 at current tier |
| 8.15 | Logging | ✅ | Append-only audit_logs + AI/notification logs |
| 8.16 | Monitoring | 🟡 | CI daily + self-auditing views; no realtime alerting `[BUILD: pipe audit findings to email via existing dispatcher]` |
| 8.17 | Clock sync | ⚪ | Provider NTP |
| 8.18 | Privileged utilities | ✅ | Management-API scripts require PAT; not in repo |
| 8.19 | Software installation | ✅ | Lockfiles; CI builds from committed HEAD |
| 8.20–8.22 | Network security/segregation | ⚪ | Inherited (Supabase/Vercel); no self-managed network |
| 8.23 | Web filtering | ⚪ | No office network |
| 8.24 | Cryptography | ✅ | TLS; at-rest (AWS); signed URLs; JWT claims |
| 8.25 | Secure dev lifecycle | ✅ | Policy §4 as practiced (branch→verify→migrate→audit) |
| 8.26 | Application security reqs | ✅ | Security requirements land as failing-closed DB policies |
| 8.27 | Secure architecture | ✅ | Fail-closed tenancy is the architecture (0258–0281) |
| 8.28 | Secure coding | 🟡 | TS strict + tests; **no JS SAST — Bandit only covers the Python layer** `[BUILD: semgrep or eslint-security]` |
| 8.29 | Security testing in dev | ✅ | RLS test suites, storage audit, 568-test suite in CI |
| 8.30 | Outsourced development | ⚪ | None |
| 8.31 | Dev/test/prod separation | ✅ | Separate Supabase projects (load-test project exists); test accounts only in test |
| 8.32 | Change management | ✅ | Ledgered migrations + PR flow + verified deploys |
| 8.33 | Test information | ✅ | Synthetic @cainergy.com data; 0024 purged mock identities |
| 8.34 | Audit-testing protection | ✅ | Audits are read-only scripts with scoped tokens |

## Scoreboard

**✅ 61 · 🟡 13 · 🔵 6 · 🔴 1 · ⚪ 12** (re-scored 2026-08-11 after F-004/F-005/F-007 closed and the backup assumption was corrected — 8.13 is now the only red). Certification-readiness = every 🟡/🔵 either
closed or carrying a documented, risk-accepted justification. The five that
matter most are the risk register's treatment queue (MFA first).
