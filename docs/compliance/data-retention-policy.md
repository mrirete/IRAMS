# Data Retention & Erasure Policy

**Version:** 1.0 — 2026-08-07 · **Review:** annually, and whenever a new
personal-data table ships · **Owner:** `[DECIDE: named role]`

Two principles reconcile here, and this policy exists to say how:

1. **Storage limitation (Art. 5(1)(e))** — keep personal data no longer than
   needed.
2. **Record integrity** — the audit trail is append-only *by design*
   (migrations 0171/0186: no role, admin included, can update or delete
   audit rows). This is a feature, not an oversight: it is what makes the
   trail evidence.

The reconciliation: **events are kept, identities are removable.** When a
person must be erased, audit rows survive with the actor reference
pseudonymised — the precedent is migration 0024, which nulls
`audit_logs.changed_by` for removed identities while preserving the events.
The row then says "someone with role X did Y at time T", which is integrity
without identifiability.

## Retention schedule

| Category (RoPA ref) | Retention | Trigger & mechanism |
|---|---|---|
| People directory (P-1) | Life of the workspace; individual rows until the customer deactivates/deletes them | Customer-driven in-product; `is_active` then delete |
| Accounts & auth (P-2) | Life of the account | Admin delete → `delete_auth_user` RPC removes the auth identity |
| Invitations (P-3) | Until accepted/expired + 90 days | `retention_sweep()` (0282, pg_cron job `gdpr-retention-sweep`, monthly): pending invites past `expires_at` are marked expired; expired/revoked rows are deleted 90 days after expiry |
| Work records (P-4) | Life of the workspace (engineering history is the product's value; these are records *about equipment* that reference people) | Person-references pseudonymised on erasure; records kept |
| Safety records (P-5) | Statutory occupational-safety periods set BY THE CUSTOMER (controller) — commonly 5–40 years by jurisdiction | Not deleted on individual erasure while the customer asserts a legal-obligation hold; noted in the DSR response |
| Qualifications (P-6) | While the person is active + `[DECIDE: 2 years]` | Customer-driven |
| Audit trail (P-7) | Workspace life; **identities pseudonymised on erasure, events never deleted** | 0024-pattern update; append-only otherwise |
| Messages & notifications (P-8) | Messages: workspace life. Notifications & outbox/logs: 12 months | `retention_sweep()` (0282): `notifications`, `notification_logs`, `notification_outbox` rows older than 12 months deleted monthly |
| AI audit log (P-9) | 12 months (spend/abuse accountability) | `retention_sweep()` (0282): `ers_ai_audit_log` rows older than 12 months deleted monthly; no aggregate is kept `[DECIDE: whether a monthly spend aggregate should survive the sweep]` |
| Email dispatch logs (P-10) | Provider-side per Resend policy; our `notification_logs` 12 months | as P-8 |
| Files & images (P-11) | Follow their parent record; orphaned objects removed by the storage audit's orphan-tenant finding | `audit-storage.mjs` detects; manual removal |
| Signup/tenancy data (C-1) | Account life + `[DECIDE: 30–90 days]` | Workspace termination runbook |
| Whole workspace (termination) | Export offered, then deletion within `[DECIDE: 30/60/90]` days per DPA §8 | `[BUILD: tenant-teardown script — inverse of provision]` |
| Backups | Supabase PITR/backup window `[DECIDE: confirm plan's window and state it — erased data ages out of backups within that window]` | Provider-managed |
| Personal-data breach records | **24 months minimum** (PIPEDA s.10.3 requires it; also serves Art. 33(5) GDPR documentation duty) — record every breach, reportable or not | DSR/incident log; never swept |

Sweep evidence: every monthly run inserts a `RETENTION_SWEEP` row into
`audit_logs` with the per-table delete counts (0282), so the policy is
provably operating, not just written.

## Erasure mechanics (what actually runs)

An erasure for person *p* in tenant *t*:

1. `contacts` row: hard-delete, or anonymise in place if referenced by
   FK-bearing history (name → "Removed person", nulls for email/phone/photo).
2. `users`/auth: `delete_auth_user` RPC.
3. Storage: remove avatar object and certificate scans (`deleteImage`
   handles ref forms); signed URLs die with the objects.
4. `audit_logs`: `UPDATE ... SET changed_by = NULL WHERE changed_by = p`
   (0024 pattern). Same for `ers_ai_audit_log` actor columns.
5. Free-text sweep: the honest limit — names inside free-text fields
   (work-order notes) are not systematically discoverable. The DSR
   procedure records this limitation and offers a targeted search when the
   requester supplies the strings to search for.
6. Safety-record hold check (P-5): if the customer asserts a statutory
   hold, signature objects and sign-off identities are retained and the
   hold documented in the DSR log.

Built (0282): `erase_person(contact_id)` is a SECURITY DEFINER function that
runs steps 1–4 as one audited call; EXECUTE is revoked from `public` and
`anon` and granted to authenticated users; inside, the call is refused unless the caller
is an admin of the same tenant as the contact.

## What this policy does NOT allow

- Deleting or rewriting audit events (any request to do so is refused;
  pseudonymisation is the ceiling).
- Retention "just in case" without a row in the schedule above.
- New personal-data tables shipping without a row here — the migration
  review checklist gains this question.
