# IREAMS Information Security Management System (ISMS)

**Version:** 1.0 — 2026-08-08 · **Owner:** `[DECIDE: top management sponsor — at current scale, the founder]`
**Standard:** ISO/IEC 27001:2022 · **Status:** operating toward certification-readiness

This is the ISMS manual — the Clause 4–10 skeleton that the other documents
hang off. Being *compliant* means this system exists and demonstrably
operates; being *certified* means an accredited body audited it. This pack
targets the former; the latter is a purchasing decision.

## Clause map — where each requirement lives

| Clause | Requirement | Where satisfied |
|---|---|---|
| 4.1/4.2 | Context, interested parties | §1–2 below |
| 4.3 | **Scope** | §3 below |
| 4.4 | ISMS and its processes | this pack, operating per the calendar in [internal-audit-and-review.md](internal-audit-and-review.md) |
| 5.1–5.3 | Leadership, policy, roles | [information-security-policy.md](information-security-policy.md) |
| 6.1 | Risk assessment & treatment | [risk-register.md](risk-register.md) |
| 6.1.3(d) | **Statement of Applicability** | [statement-of-applicability.md](statement-of-applicability.md) |
| 6.2 | Security objectives | policy §2 |
| 7.1–7.5 | Resources, competence, awareness, documented information | policy §6; this repo is the documented-information system (versioned, reviewed via PRs) |
| 8 | Operation | the controls in the SoA, as implemented in code/config |
| 9.1 | Monitoring & measurement | CI security scans, storage audit, RLS audit scripts; metrics in review template |
| 9.2 | **Internal audit** | [internal-audit-and-review.md](internal-audit-and-review.md) §1 |
| 9.3 | **Management review** | same doc, §2 |
| 10 | Nonconformity & improvement | same doc, §3 (findings log) |

## 1. Context (4.1)

IREAMS is a multi-tenant SaaS for reliability and enterprise asset
management, sold to industrial operators. Issues that shape the ISMS:
customer data includes safety-critical records and personal data; tenants
share one database (isolation is the paramount technical risk); the operating
team is very small (segregation of duties is structurally limited and must be
compensated by logging and automation); the platform builds on Supabase/AWS,
Vercel, Google, Resend (supplier risk is inherited); AI features move
free-text data to a third party.

## 2. Interested parties (4.2)

Customers (tenant isolation, availability, confidentiality of plant data);
data subjects — customer employees (GDPR set in `docs/compliance/`);
regulators (GDPR; customers' safety regulators indirectly); suppliers
(sub-processor terms); the certification body, eventually.

## 3. Scope (4.3)

**In scope:** the IREAMS SaaS — production Supabase project(s) (database,
auth, storage, edge functions), the Vercel-hosted frontend, the GitHub
repository and CI/CD, the provisioning/migration tooling in `scripts/`, and
the operational processes around them (access, change, incident, vendor
management).

**Out of scope:** customer-side devices and networks; suppliers' internal
controls (managed via 5.19–5.23 supplier controls and inherited
attestations — Supabase/AWS/Vercel hold their own SOC 2 / ISO certs);
corporate IT unrelated to the service `[DECIDE: confirm — if company
laptops access production, they are IN scope for A.7/A.8 endpoint controls]`.

## 4. How this ISMS stays real (the operating loop)

The failure mode of small-company ISMSs is documents that describe nothing.
Ours inverts the direction: **the repo is the system**. Controls are
migrations, CI jobs, and scripts; their evidence is git history, CI runs, and
self-auditing database functions (`retention_sweep()` logs its own runs;
`storage_bucket_visibility_audit` must return zero rows; `audit-policies.mjs`
and `audit-storage.mjs` diff claimed posture against actual). The quarterly
calendar in [internal-audit-and-review.md](internal-audit-and-review.md) is
the human loop on top.
