# Records of Processing Activities (Art. 30)

**Version:** 1.0 — 2026-08-07 · **Review:** quarterly, and on any schema change touching personal data
**Entity:** Relantern `[DECIDE: legal entity]` · **Privacy contact:** `[DECIDE]`
**Art. 27 EU representative:** `[DECIDE: required only if the entity is established outside the EU]`

Grounded in the actual schema — table/column citations are greppable in
`src/frontend/supabase/migrations/`. Two sections, per role.

---

## A. As PROCESSOR (Art. 30(2)) — customer workspace data

One record per category of processing carried out on behalf of controllers
(customers). Common facts for all rows:

- **Controllers:** IREAMS customers (list maintained in `companies` table; one
  row per tenant).
- **Transfers outside the EU:** none for storage (eu-west-1); Google Gemini
  API calls may be served outside the EU — safeguard: Google Cloud standard
  contractual clauses `[DECIDE: confirm SCC module in force for the
  Gemini API terms accepted]`. Resend (email) is US-based — safeguard: EU-US
  Data Privacy Framework / SCCs `[DECIDE: confirm Resend's current DPF
  certification status]`.
- **Security measures (Art. 32 summary):** tenant isolation via row-level
  security with JWT-derived company claim (migrations 0258–0281); private
  storage buckets with tenant-scoped policies and signed URLs (0281);
  role-gated writes enforced in-database (0186, 0241); append-only audit
  trail (0171/0186); TLS in transit; encryption at rest (AWS); daily
  dependency/vulnerability scans; storage-posture audit in CI.

| # | Processing | Data subjects | Personal data | Where (tables/buckets) |
|---|---|---|---|---|
| P-1 | People directory | Customer employees, contractors, vendor contacts | Name, work email, phone/mobile, job title, department, cost centre, hourly rate, address, photo | `contacts`, `avatars` bucket |
| P-2 | User accounts & auth | Workspace users | Email, password hash (Supabase Auth), role, permission flags, company claim | `users`, `auth.users` |
| P-3 | Invitations | Invitees | Email or phone, token, inviter identity | `user_invites` |
| P-4 | Work execution records | Users named in/assigned to work | Assignments, completions, labor bookings, free-text notes that may name people | `work_orders`, `work_order_labor`, `service_requests`, `job_tasks` |
| P-5 | Safety records | Signing workers | Hand-drawn signature images, sign-off identity + timestamp, JSA/permit roles | `jsa_assessments.signoffs`, `ptw_*`, `loto_permits`, `work-order-docs` bucket |
| P-6 | Qualifications | Certificate holders | Qualification type, validity, certificate scan | `qualifications`, `entity_files` |
| P-7 | Audit trail | All acting users | Actor id, action, entity, timestamp, before/after values | `audit_logs`, `ers_ai_audit_log` |
| P-8 | Messaging & notifications | Users | Thread messages, @mentions, read receipts, notification payloads incl. email address | `messages`, `thread_reads`, `notifications`, `notification_outbox`/`_logs` |
| P-9 | AI-assisted analysis | Incidental (people named in free text) | Prompt text + record context transmitted to Google Gemini; prompt/response metadata logged | edge functions `ai-proxy`, `agent-run`; `ers_ai_audit_log` |
| P-10 | Operational email | Recipients | Email address, subject/body of operational mail | Resend API via `notify-dispatch`, `audit-invite` |
| P-11 | Uploaded files & images | People appearing in photos/documents | Asset photos, work-order documents, P&ID diagrams (rarely personal), procedure evidence images | `assets`, `pid-diagrams`, `work-order-docs` buckets, `entity_files` |

## B. As CONTROLLER (Art. 30(1)) — Relantern's own processing

| # | Processing | Purpose | Data subjects | Personal data | Basis | Retention |
|---|---|---|---|---|---|---|
| C-1 | Signup & tenancy | Create workspace, tier enforcement | Account owners | Company name, work email, password hash | Contract | Life of account + `[DECIDE: 30–90 days]` post-closure |
| C-2 | Support & operations | Diagnose issues, apply migrations | Workspace users (incidental) | Whatever the support case surfaces | Legitimate interest | Case life + 12 months |
| C-3 | Security monitoring | Abuse prevention, audit | All users | Auth events, IPs in provider logs, audit rows | Legitimate interest / Art. 32 | Provider default (Supabase logs) `[DECIDE: confirm & state]` |
| C-4 | Billing | `[DECIDE: not yet built — add when tier pricing ships]` | Account owners | — | Contract | — |

## C. Deliberate design choices worth recording

- **Login requires a company email at launch** (Add Person collects a real
  email) — personal-mailbox identifiers are avoided by design.
- **No analytics/tracking**: the client stores only auth state; there is no
  third-party analytics SDK in the bundle.
- **Free-text is the main leak vector into P-9**: work-order notes naming
  people flow into AI context. Mitigations: server-side proxy, per-workspace
  AI budget, workspace-level AI disable on request.
- **Erasure vs audit integrity** is reconciled by pseudonymisation, not
  deletion, of audit rows — precedent: migration 0024 nulls
  `audit_logs.changed_by` for removed identities. See retention policy §4.
