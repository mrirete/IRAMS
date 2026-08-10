# SOC 2 Type 2 — Readiness Roadmap

**Version:** 1.0 — 2026-08-08 · **Goal:** Type 2 report in hand ~9 months from kickoff
SOC 2 is an attestation that controls **operated over a window**, so the
entire game is: define controls → operate them observably → let a CPA firm
sample the evidence. Nothing here is wasted if ISO 27001 follows — the ISMS
pack in `isms/` is ~70% of the shared evidence base.

## 1. Scope decision (make once, at kickoff)

**Trust Services Criteria:** Security (mandatory) + **Confidentiality**
(customer plant data is the product's sensitive core). Recommend deferring
Availability until an SLA is published, and skipping Processing Integrity
and Privacy (the GDPR set already covers privacy substance for buyers;
adding the Privacy TSC roughly doubles audit scope for little sales value).

**System boundary:** same as the ISMS scope (isms/README §3).

## 2. Control set — mapped to what already exists

| TSC | Control (as the auditor will phrase it) | Already operating? | Evidence source |
|---|---|---|---|
| CC1/CC5 | Policies approved, reviewed annually; roles defined | ✅ | ISMS policy + review minutes |
| CC3 | Risk assessment performed and maintained | ✅ | isms/risk-register.md (quarterly) |
| CC4 | Monitoring of controls; deficiencies tracked | ✅ | quarterly audit checklist + findings log |
| CC6.1 | Logical access restricted per role & tenant | ✅ | RLS suites, audit-policies.mjs runs |
| CC6.1 | Storage access restricted | ✅ | audit-storage.mjs CI job (blocking) |
| CC6.2/6.3 | Access provisioning & revocation w/ approval; periodic review | 🟡 operate it | quarterly access review — **the evidence gap is cadence records, not capability** |
| CC6.6 | MFA on privileged access | ❌ | F-004 — close before window opens |
| CC6.7 | Encryption in transit/at rest | ✅ | provider attestations + TLS |
| CC7.1 | Vulnerability scanning | 🟡 | daily CI scans; make CRITICAL blocking (F-005) |
| CC7.2–7.5 | Incident detection→response→lessons | ✅ | isms/incident-response.md + log |
| CC8.1 | Change management: reviewed, tested, approved changes | ✅ | PR flow + ledgered migrations + CI |
| CC9.2 | Vendor management | ✅ | sub-processor register + annual review |
| C1.1/C1.2 | Confidential data identified; retained & disposed per policy | ✅ | retention policy + retention_sweep audit rows |
| A1 (if taken later) | Backup/restore, capacity | 🟡 | restore test (F-006) |

Reading: **the control *capabilities* are nearly complete; what Type 2
demands is months of operating *records*.** Every quarterly checklist run,
access-review minute, findings-log closure and sweep audit row from now on
is window evidence.

## 3. The path (sequential, with the clock in view)

| Phase | When | What |
|---|---|---|
| 0. Close the gate items | now → +6 weeks | F-004 MFA, F-005 CI gates/SAST/pinning, F-006 restore test, F-007 key fallback, F-008 mailboxes. These are the findings an auditor would flag as exceptions if the window opened today |
| 1. Platform + auditor | +6 weeks | Pick compliance automation (Vanta / Drata / Secureframe — choose on Supabase+Vercel+GitHub integration quality); pick the CPA firm NOW (they advise on control wording before the window; firms like the one whose badge you've seen bundle with platforms) |
| 2. Type 1 (optional but recommended) | +2–3 months | Point-in-time report on control *design* — sales-usable months before Type 2, and a dress rehearsal |
| 3. **Observation window opens** | +3 months | 3 months minimum for a first report (6 reads better for enterprise). During: operate the calendar, keep every record, treat every alert |
| 4. Fieldwork + report | +6–8 months | Auditor samples the window's evidence; report ~4–6 weeks later |

**Total: ~8–9 months to a Type 2 report; Type 1 in hand around month 3.**

## 4. Cost expectation (order of magnitude)

Platform ~$8–20k/yr · Type 1+Type 2 audit ~$15–35k first year (Security+
Confidentiality, small org) · internal time: a few hours/week during the
window, front-loaded in phase 0–1.

## 5. Rules for the window (pin these)

1. Nothing changes about *how* work is done — that's the point of having
   built controls as code. What changes is that **records are never skipped**:
   a missed quarterly review isn't a gap, it's an audit exception.
2. Every incident goes in the log even if trivial — an empty incident log
   over 6 months reads as non-detection, not perfection.
3. New engineers/tools enter through the access-review and vendor-register
   front doors, never sideways.
4. The badge comes from the auditor, and only after the report exists.
