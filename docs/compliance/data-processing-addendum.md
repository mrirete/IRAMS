# Data Processing Addendum (template)

**Version:** 1.0 — 2026-08-07 · **Status:** TEMPLATE — have counsel review
before first execution `[DECIDE: legal review]` · **Review:** annually

Between the customer identified in the Order Form (**Controller**) and
Relantern `[DECIDE: legal entity]` (**Processor**), incorporated into the
IREAMS service agreement. Where this DPA conflicts with the agreement, this
DPA prevails for personal-data matters.

---

## 1. Subject matter, duration, nature and purpose (Art. 28(3))

Processor provides IREAMS, a reliability and enterprise asset management
SaaS. Processing covers hosting, storage, transmission, display, analysis
(including AI-assisted analysis where enabled), notification delivery, and
backup of personal data the Controller and its users put into the workspace,
for the duration of the agreement.

**Categories of data subjects and personal data:** as per Annex I (mirrors
the processor section of Relantern's [records of processing](records-of-processing.md),
P-1 through P-11 — employee/contractor directory data, account data, work
and safety records including signature images, qualifications, audit
trails, messages, and free-text content).

**No special categories** are required by the service. The Controller
instructs its users not to enter Art. 9 data into free-text fields; the
Processor is not obliged to police free text but will support deletion on
instruction.

## 2. Controller instructions

Processing occurs only on documented instructions: this DPA, the agreement,
the product's configuration surface (roles, settings the Controller's
admins operate), and written instructions via the support channel.
Processor informs Controller if an instruction, in its opinion, infringes
GDPR.

## 3. Confidentiality (Art. 28(3)(b))

Persons authorised to process are bound by contractual confidentiality.
Production access is limited to operations/support need.

## 4. Security (Art. 28(3)(c), Art. 32)

Technical measures in force, verifiable in the codebase:

- **Tenant isolation** enforced in the database: every row carries the
  tenant, every policy carries the tenant conjunct derived from the signed
  JWT; a missing claim denies (fails closed).
- **Private object storage**: no unauthenticated object access; reads via
  short-lived signed URLs; objects keyed per tenant; a CI job continuously
  audits bucket visibility.
- **Role-based access** enforced in-database, not only client-side;
  administrative deletes restricted; append-only audit trail that no role
  can rewrite.
- **Encryption** in transit (TLS) and at rest (AWS).
- **EU data residency** for storage (AWS eu-west-1).
- **Vulnerability management**: daily dependency and filesystem scanning in
  CI.
- Organisational measures: access on need, joiner/leaver handling,
  `[DECIDE: incident-response runbook — referenced by §6, must exist]`.

## 5. Sub-processors (Art. 28(2), (4))

Controller grants general authorisation for the sub-processors in the
[register](subprocessor-register.md). Processor gives 30 days' notice of
additions/replacements; Controller may object on reasonable data-protection
grounds, in which case the parties seek a solution and, failing one,
Controller may terminate the affected service. Processor flows down
equivalent obligations and remains liable for sub-processors.

**AI opt-out:** AI-assisted features (Google Gemini) can be disabled per
workspace on written request; disabling removes Google from the active flow
for that Controller.

## 6. Personal data breach (Art. 33/34 support)

Processor notifies Controller **without undue delay and within 48 hours**
of becoming aware of a personal data breach affecting Controller data, with
the Art. 33(3) particulars as they become available, and reasonably assists
with notifications. `[DECIDE: 48h is the offered SLA — confirm it is
operationally honest before signing]`

## 7. Assistance (Art. 28(3)(e), (f))

Processor assists with data subject requests per the
[DSR procedure](dsr-procedure.md) (identify, export, rectify, erase within
the stated timelines), and with DPIAs and prior consultation where the
processing under this DPA is in scope.

## 8. Return and deletion (Art. 28(3)(g))

On termination, Controller may export its data (structured export of
database records; storage objects retrievable via the product or a bulk
handover). Processor deletes Controller personal data within
`[DECIDE: 30/60/90]` days of termination, backups aging out per the
[retention policy](data-retention-policy.md), except where EU/member-state
law requires retention.

## 9. Audit (Art. 28(3)(h))

Processor makes available information necessary to demonstrate compliance:
this DPA's referenced registers, security documentation, and third-party
attestations when available. Controller-led audits: annually, 30 days'
notice, during business hours, no access to other controllers' data, at
Controller's cost.

## 10. Transfers

Storage and processing in the EU (§4). Where a sub-processor entails a
third-country transfer (register column "Transfer mechanism"), the listed
mechanism (SCCs / DPF) applies.

---

### Annex I — Processing particulars
Data subjects & categories: see RoPA §A. Frequency: continuous. Retention:
per [retention policy](data-retention-policy.md).

### Annex II — TOMs
As §4 above, maintained in the codebase and its migration history (the
audit trail of the controls themselves).
