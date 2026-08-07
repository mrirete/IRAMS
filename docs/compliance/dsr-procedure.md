# Data Subject Request (DSR) Procedure

**Version:** 1.0 — 2026-08-07 · **Review:** annually · **Owner:** `[DECIDE: named role]`
**Intake:** `[DECIDE: privacy@relantern.com]` — check at least weekly; the
Art. 12(3) clock runs from receipt, not from reading.

## Routing rule (the first decision on every request)

- Requester is a **workspace user** (their employer is the controller):
  we do not answer substantively. Acknowledge, tell them to route via their
  employer, and notify the employer's workspace admin that a request
  arrived — Art. 28(3)(e) assistance runs from when the *controller*
  instructs us. Log it either way.
- Requester is an **account owner** (Relantern is controller): we answer
  directly. Deadline: **one month** from receipt; extendable by two months
  for complex requests with notice inside the first month (Art. 12(3)).

**Identity verification before anything else:** reply-to challenge on the
account email; for workspace users, verification is the controller's job.
Never disclose to an unverified requester — including confirming whether
data exists.

## Per-right playbook

| Right | What we do | Mechanics |
|---|---|---|
| Access (Art. 15) | Export the person's data + the §13/14 metadata | SQL export per RoPA tables filtered to the contact/user id; storage objects via signed URLs; include AI-audit rows where actor = subject |
| Rectification (16) | Fix the record | In-product edit (contacts/users) — usually the controller does this themselves |
| Erasure (17) | Run the erasure mechanics | [Retention policy](data-retention-policy.md) "Erasure mechanics" steps 1–6, including the safety-record hold check and the free-text limitation disclosure |
| Restriction (18) | Freeze without deleting | Set `is_active = false` + revoke sessions; document scope |
| Portability (20) | Structured export | Same as access, machine-readable (JSON/CSV) |
| Objection (21) | Assess the legitimate-interest processing objected to | For operational-security processing, document the compelling-grounds analysis |

## Refusals and limits (say them plainly, cite them)

- **Audit events are never deleted** — pseudonymisation of the actor is the
  ceiling (retention policy). The response says so.
- **Safety records under statutory hold** (JSA signatures, permits) are
  retained; the response names the customer's asserted legal basis.
- **Free text**: names inside notes are found only by targeted search on
  requester-supplied strings; the response states this limitation.
- Manifestly unfounded/excessive requests: refusable or chargeable
  (Art. 12(5)) — decision documented, requester told of their complaint
  right.

## Log (append-only, keep here or in the tracker)

| Date recv'd | Requester type | Right | Verified | Controller notified | Closed | Outcome |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## Timeline discipline

Acknowledge within 5 working days. If the one-month deadline will slip,
send the Art. 12(3) extension notice *before* the month ends — a silent
overrun is itself a violation. Every closed request gets an outcome row
above; the log is the Art. 5(2) accountability evidence.
