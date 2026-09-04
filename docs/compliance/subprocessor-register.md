# Sub-processor Register (Art. 28(2), 28(3)(d))

**Version:** 1.2 — 2026-09-04 (1.1 of 2026-08-10 verified transfer mechanisms and DPA routes against vendor sources; 1.2 re-grepped the outbound mail senders and recorded the Vercel plan status; remaining `[ACTION]` items are execution steps, not open questions) · **Review:** on every vendor change (BEFORE go-live), else quarterly
**Rule:** no production data flows to a vendor not on this list. Adding a row
requires: DPA signed, transfer mechanism identified, and customer notice per
the DPA's sub-processor clause (30 days to object).

## Active sub-processors

| Vendor | Service | What personal data reaches it | Region | Transfer mechanism | DPA status |
|---|---|---|---|---|---|
| **Supabase** (Supabase Inc.) | Database, auth, file storage, edge functions | All workspace data (RoPA P-1…P-11), auth credentials | AWS **eu-west-1** (Ireland) | Data stays in EU; Supabase DPA (supabase.com/legal/dpa) incl. SCCs Schedule 2 + UK Addendum + Swiss Addendum for any support access | `[ACTION: execute — Dashboard → Organization → Documents (DocuSign flow), or sign the DPA PDF and return to privacy@supabase.io; route verified 2026-08-10]` |
| **Amazon Web Services** | Underlying infrastructure (via Supabase) | Same as Supabase (encrypted at rest) | eu-west-1 | Via Supabase's vendor chain | Covered by Supabase DPA |
| **Vercel Inc.** | Application hosting & CDN | Application code and static assets; request metadata/IPs in edge logs. Database contents do NOT transit Vercel | Global edge; US entity | EU-US DPF (EU/UK/Swiss transfers) — Vercel self-attests certification (KB checked 2026-08-10; listing verifiable at dataprivacyframework.gov/list); SCCs in Vercel DPA as fallback | DPA (vercel.com/legal/dpa) is incorporated into the ToS — no signature step. Processor commitments apply to **Pro/Enterprise** plans `[ACTION: upgrade — the production project (team mrirete-3248s-projects) was on the **Hobby** plan as of 2026-08-13; Hobby is non-commercial and sits outside the processor clause, so moving to Pro is a go-live precondition, not a check]` |
| **Google LLC** (Gemini API) | AI analysis (`ai-proxy`, `agent-run` edge functions; model `gemini-2.5-flash`) | Prompt text + record context; may incidentally contain names/identifiers from free-text fields | Google global | Paid Services processed under Google's Data Processing Addendum (processor role) incl. its SCCs — verified 2026-08-10 against Gemini API Additional Terms (eff. 2026-03-23) | Paid tier: "Google doesn't use your prompts … or responses to improve our products"; prompts/responses logged only briefly for abuse detection. The same terms **require** Paid Services for EEA/CH/UK users. `[ACTION: confirm the production key's GCP project is billing-enabled — unpaid tier both lacks the no-training guarantee and is prohibited for EEA users]` |
| **Resend** (Plus Five Five, Inc.) | Transactional email (`notify-dispatch` alerts, `audit-invite` website invites, `signup-tenant` email verification, `specialist-briefing` weekly digest; FROM `mail.relantern.com`) | Recipient email addresses, mail subject/body (may contain names, work-order details) | US | EU SCCs Modules 2/3 + UK Addendum + Swiss modifications, incorporated in Resend DPA §6 and deemed signed with the DPA (verified 2026-08-10). Resend also self-reports DPF certification — not independently confirmed; SCCs govern regardless | DPA (resend.com/legal/dpa) binding on acceptance of the Agreement per its §12 — no separate signature step |

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
- Vercel DPF (2026-08-10): vercel.com/kb/guide/is-vercel-certified-under-dpf
  (page updated 2025-11-10) states certification covering EU/UK/Swiss
  transfers and points to dataprivacyframework.gov/list for the public
  listing. The DPF site's search is a JS app that resisted automated
  scraping — one manual click to confirm the listing when countersigning
  paperwork for an enterprise customer.
- Gemini terms (2026-08-10): ai.google.dev/gemini-api/terms, effective
  2026-03-23. Paid Services → "Google doesn't use your prompts (including
  associated system instructions, cached content, and files…) or responses
  to improve our products, and will process your prompts and responses in
  accordance with the Data Processing Addendum for Products Where Google is
  a Data Processor." Retention: logged "for a limited period of time,
  solely for detecting and preventing violations of the Prohibited Use
  Policy". EEA/CH/UK: "You may use only Paid Services when making API
  Clients available to users in the European Economic Area, Switzerland,
  or the United Kingdom."
- Resend DPA (2026-08-10): resend.com/legal/dpa — §6 incorporates EU SCCs
  (Modules 2/3, governed by Irish law), UK Addendum, Swiss modifications,
  "deemed entered into"; §12 makes the DPA binding on acceptance of the
  Agreement. DPF status claimed by third-party trust pages only — treated
  as unconfirmed; SCCs are the recorded mechanism.
- Supabase DPA route (2026-08-10): supabase.com/legal/dpa; execution is
  self-serve via Dashboard → Organization → Documents (DocuSign) or by
  returning the signed PDF to privacy@supabase.io.
- Outbound mail senders re-grepped 2026-09-04: four edge functions call
  Resend — `notify-dispatch`, `audit-invite`, `signup-tenant` (email
  verification, migration 0314) and `specialist-briefing` (weekly digest).
  The register row lists all four; earlier versions named only the first two.
- Gemini model in use (2026-09-04): `gemini-2.5-flash` in `ai-proxy` and
  `agent-run`; `gemini-2.0-flash` appears only in a retirement comment.
