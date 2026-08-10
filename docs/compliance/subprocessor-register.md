# Sub-processor Register (Art. 28(2), 28(3)(d))

**Version:** 1.0 — 2026-08-07 · **Review:** on every vendor change (BEFORE go-live), else quarterly
**Rule:** no production data flows to a vendor not on this list. Adding a row
requires: DPA signed, transfer mechanism identified, and customer notice per
the DPA's sub-processor clause (30 days to object).

## Active sub-processors

| Vendor | Service | What personal data reaches it | Region | Transfer mechanism | DPA status |
|---|---|---|---|---|---|
| **Supabase** (Supabase Inc.) | Database, auth, file storage, edge functions | All workspace data (RoPA P-1…P-11), auth credentials | AWS **eu-west-1** (Ireland) | Data stays in EU; Supabase DPA incl. SCCs for support access | `[DECIDE: countersign Supabase DPA — self-serve in dashboard]` |
| **Amazon Web Services** | Underlying infrastructure (via Supabase) | Same as Supabase (encrypted at rest) | eu-west-1 | Via Supabase's vendor chain | Covered by Supabase DPA |
| **Vercel Inc.** | Application hosting & CDN | Application code and static assets; request metadata/IPs in edge logs. Database contents do NOT transit Vercel | Global edge; US entity | EU-US DPF / SCCs `[DECIDE: confirm current DPF status]` | `[DECIDE: accept Vercel DPA]` |
| **Google LLC** (Gemini API) | AI analysis (`ai-proxy`, `agent-run` edge functions; model `gemini-2.5-flash`) | Prompt text + record context; may incidentally contain names/identifiers from free-text fields | Google global | SCCs in Google API terms `[DECIDE: verify paid-tier data-use terms — no-training guarantee differs by tier]` | `[DECIDE]` |
| **Resend** (Plus Five Five, Inc.) | Transactional email (`notify-dispatch`, `audit-invite`; FROM `mail.relantern.com`) | Recipient email addresses, mail subject/body (may contain names, work-order details) | US | DPF / SCCs `[DECIDE: confirm]` | `[DECIDE: accept Resend DPA]` |

## Not sub-processors (recorded to pre-empt questionnaire queries)

- **Namecheap / cPanel** — DNS for relantern.com; no personal data processed
  beyond WHOIS/registrar data of Relantern itself.
- **GitHub** — source code hosting and CI. No production personal data;
  secrets are held in Actions secrets; the storage-posture audit connects to
  production with a scoped access token but reads only bucket/policy
  metadata and object *counts*, not contents.
- **Playwright/test tooling** — test accounts only (`*@cainergy.com`), no
  real-person data.

## Use by customers outside the EU

This register plus the executed DPA are the artefacts non-EU customers need
for their own accountability duties: for Australian customers, the
"reasonable steps" evidence APP 8 requires before disclosing personal
information to an overseas recipient (they remain accountable for us — this
register is what their privacy team files); for Canadian customers, the
PIPEDA openness/accountability record for cross-border processing; for US
customers under CCPA, the service-provider chain. Hand it over proactively in
procurement — it shortens security review.

## Customer notification log

| Date | Change | Notified |
|---|---|---|
| 2026-08-07 | Initial register established | n/a (baseline) |

## Verification notes (how each claim was checked)

- Supabase region: management API `GET /v1/projects` → `eu-west-1`
  (2026-08-07).
- Gemini endpoint & model: `supabase/functions/ai-proxy/index.ts` —
  `generativelanguage.googleapis.com`, `GEMINI_MODEL ?? "gemini-2.5-flash"`.
- Resend: `supabase/functions/notify-dispatch/index.ts` → `api.resend.com`;
  FROM domain `mail.relantern.com` verified 2026-08-05.
- No other outbound data flows: grep edge functions for `fetch(` targets.
  Re-run this check at each review.
