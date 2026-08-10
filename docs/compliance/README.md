# IREAMS Compliance Document Set

GDPR-first document set for IREAMS (by Relantern). Written 2026-08-07, after the
storage-privacy remediation (migration 0281) closed the last known live
exposure. These documents describe the system **as it actually is** — where a
statement is aspirational or needs a legal decision, it is marked `[DECIDE: …]`.

| Document | GDPR basis | Also feeds |
|---|---|---|
| [privacy-notice.md](privacy-notice.md) | Art. 13/14 — transparency | ISO A.5.34 |
| [records-of-processing.md](records-of-processing.md) | Art. 30 — RoPA | SOC 2 CC1/CC3 scoping |
| [subprocessor-register.md](subprocessor-register.md) | Art. 28(2)/(3)(d) | ISO A.5.19–A.5.23, SOC 2 CC9.2 |
| [data-processing-addendum.md](data-processing-addendum.md) | Art. 28(3) — processor terms | Enterprise procurement |
| [data-retention-policy.md](data-retention-policy.md) | Art. 5(1)(e), Art. 17 | ISO A.8.10, SOC 2 C1.2 |
| [dsr-procedure.md](dsr-procedure.md) | Art. 12–23 — data subject rights | ISO A.5.34 |
| [isms/](isms/) | — | **ISO 27001:2022 ISMS**: manual+scope, policy, risk register, SoA (93 controls), incident response, audit/review programme |
| [soc2-roadmap.md](soc2-roadmap.md) | — | SOC 2 Type 2 path: control map, phases, window rules |

## Operating rules

1. **These are living documents.** An out-of-date RoPA at an audit is worse
   than none — it proves the process isn't operating. Review cadence is stated
   in each document's header; the sub-processor register additionally changes
   whenever a vendor is added or dropped, *before* the vendor goes live.
2. **The repo is the source of truth.** Each factual claim cites the code,
   migration, or configuration it derives from, so drift is detectable by
   grep, not by memory.
3. **Roles:** Relantern is **processor** for the data customers put in their
   IREAMS workspace (their employees, vendors, work records), and
   **controller** for account/signup data and its own operations. Both RoPA
   sections exist accordingly.

## Known open items (honest list)

- Privacy notice is not yet linked from the app (login/signup footer) — code
  change, tracked separately.
- No cookie/consent banner: currently believed unnecessary (no third-party
  trackers; only strictly-necessary auth storage) — re-verify if analytics is
  ever added.
- CAPTCHA / email-verification on /signup still open (see shared-DB tenancy
  notes) — relevant to Art. 5(1)(f) as an anti-abuse control.
- `[DECIDE]` markers throughout need a legal-entity pass: registered entity
  name & address, EU representative (Art. 27) if the entity is non-EU, DPO
  appointment decision (Art. 37 — likely not mandatory at current scale, but
  a named privacy contact is required regardless).
