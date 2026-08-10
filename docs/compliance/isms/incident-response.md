# Incident Response Procedure

**Version:** 1.0 — 2026-08-08 · **Review:** annually + after every incident
Satisfies A.5.24–5.28; feeds DPA §6 (48h controller notification) and the
breach regimes in the retention policy (GDPR 72h, NDB, PIPEDA, state AGs).

## 1. Report (A.6.8)

Anyone who suspects a security event reports it immediately to
`[DECIDE: security@relantern.com — same half-day as privacy@]` — no blame
for reporting, including for false alarms and self-caused events. Automated
reporters: CI security jobs, `storage_bucket_visibility_audit`,
`audit-*.mjs` findings, Supabase advisories.

## 2. Triage (A.5.25) — within 4 hours of report

Classify: **SEV-1** confirmed unauthorised access to customer data / active
compromise · **SEV-2** vulnerability exposing customer data, no evidence of
exploitation (e.g. the public-bucket finding of 2026-08-07 = SEV-2) ·
**SEV-3** policy violation or hardening gap. Record in the incident log
(§6) at triage, not at resolution.

## 3. Respond (A.5.26)

Contain first (revoke keys/sessions via Supabase dashboard; flip bucket
private; disable a function), evidence second (§4), fix third (as a
migration/PR with its own verification, per house pattern). **Personal-data
check at every SEV-1/2:** if personal data was plausibly accessed, start the
notification clocks — controller within 48h (DPA §6); assess GDPR Art. 33
(72h to DPA where we are controller); record in the breach log regardless
of notification (24-month retention row).

## 4. Evidence (A.5.28)

Preserve before fixing: relevant `audit_logs` rows (append-only — they
cannot be tampered with after the fact, which is the point), Supabase logs
export, CI run links, screenshots. Store under the incident ID; never in
the public repo if they contain personal data.

## 5. Learn (A.5.27)

Post-incident review within a week: timeline, root cause, and — house
rule — **the control that would have caught it earlier**, added as code
(the 0281 → `audit-storage.mjs` pattern: fix, then the recurring check
that outlives the fix). Output lands in the findings log.

## 6. Incident log

| ID | Date | SEV | Summary | Personal data? | Notified | Closed | Retro |
|---|---|---|---|---|---|---|---|
| INC-2026-001 | 2026-08-07 | SEV-2 | All four storage buckets public since 0028/0084/0096; P&IDs, JSA signatures, avatars readable by URL. No evidence of exploitation (no access-log indicators reviewed `[DECIDE: request Supabase storage access logs to close this line]`) | Plausible (avatars) | Pre-launch, no external customers on shared instance at time of fix `[DECIDE: confirm & minute]` | 0281 applied + verified same day | audit-storage.mjs now blocking in CI |
