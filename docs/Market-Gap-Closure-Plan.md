# Market Gap Closure Plan

**Date:** 2026-07-17
**Input:** July 2026 market research (Verdantix 2026 APM Green Quadrant; MaintainX 2026 State of Industrial Maintenance, n=2,234) mapped against IRAMS current state.
**Positioning being defended:** *APM-grade reliability thinking at CMMS-tier simplicity — closed-loop, sensor-optional, agent-ready.*

The market's three buying criteria are (1) predictions that end in executed, verified work; (2) software a shrinking deskless workforce adopts; (3) AI on trustworthy, well-modeled data. IRAMS is architecturally aligned on all three. The gaps are **delivery plumbing**: notifications that never leave the app, parts disconnected from work orders, a mock connector hub, and knowledge capture that exists but isn't surfaced. This plan closes them in three waves.

---

## Current state (verified 2026-07-17)

| Gap | Where it stands |
|---|---|
| A. Notifications | In-app routing now works end-to-end (87ee541: recipient-id unified, role/crew routing, live escalation, every active rule has a live emitter). **But IN_APP is the only real channel** — EMAIL/SMS senderless, PUSH/WEBHOOK flags cosmetic, detection is client-side on page visit, `notifications` not in the realtime publication (bell polls 30s), HomePage AlertFeed is hardcoded mock. |
| B. Parts/Inventory ↔ Work | Inventory module is mature (stock, POs, vendors, movements) but **no reservation netting/ATP** (`qtyOnHand`, no `qtyReserved`), parts not planned/issued against WOs, no actual-cost roll-up. Design exists: `SAP-Parity-Gap-Assessment.md` + `WM-2-Operations-Confirmations-Design.md`. |
| C. Sensor ingestion | Manual readings + CSV import are real (condition-monitoring parity essentially complete vs AMPRO/SAP). **Connector Hub cards are mock** (`useConnectors`), `supabase/functions/sensor-sync` is a real REST poller but unrunnable — migration `0177_connectors.sql` is an empty file. |
| D. Knowledge capture | WO-anchored threads (0189), coded findings/valuation codes, RCA library all exist — but none are surfaced as "what did we learn last time," and the product story doesn't claim it. |

Why these four: the MaintainX survey names **asset-management systems and inventory management** as the two proven downtime-cost reducers, cites **labor/skills loss** as a primary downtime driver, and Verdantix's #1 criterion is the **closed loop** — which is not closed if no one is told outside the app.

---

## Wave 1 — Launch-critical (~1 week): "the loop actually closes"

### A1. Email delivery (highest leverage single item)
One `notify-dispatch` Supabase Edge Function (pattern already established: `agent-run`, `create-user`, `sensor-sync`) using Resend (or SMTP relay of user's choice).
- `NotificationService.dispatch()` already fans out per-channel; make the EMAIL branch enqueue to a `notification_outbox` table (migration) that the edge function drains. Outbox pattern, not direct-send from browser — dispatch is already fire-and-forget and killed by page close (known gotcha), so the outbox also fixes reliability of the existing in-app path's slow serial REST round trips.
- Recipient email: `users.email` (real emails now collected — launch-login-company-email + 0190 invites).
- One plain, calm template: event name, entity number, deep link, escalation level. No HTML art.
- **Synergy:** the same sender makes colleague-invite links (0190) actually emailable — currently share-by-hand.
- User-deploy items: edge function + RESEND_API_KEY secret + outbox migration (Supabase SQL editor, as usual).

### A2. Realtime + badges (kill the 30s poll)
- Add `notifications` to the `supabase_realtime` publication (one-line migration; `messages` already in it).
- Bell subscribes instead of polling; mobile BottomNav gets the unread badge; My Work refetches on window focus.
- Replace hardcoded HomePage AlertFeed with a real query over the user's notifications (component exists, just re-point it).

### B1. Reservation netting / ATP (the SAP reviewer's known trap, and a real downtime lever)
- Migration: `qtyReserved` on inventory items (+ optional `stock_status` deferred).
- Plan a part on a WO → reserve; complete/cancel → release or consume. Available-to-promise = `qtyOnHand − qtyReserved` shown everywhere quantity is shown.
- STOCK_LOW/STOCK_OUT events already emit and have live rules — netting makes them fire at the *right* moment.

### C1. Connector Hub: mock → live (REST first, honest about the rest)
- Fill `0177_connectors.sql` (table per existing `sensor-sync` expectations), wire `useConnectors` to the DB, delete `Math.random` Test Connection.
- REST/API-key poll connector = the one live type (sensor-sync already implements it; needs pg_cron schedule or manual "Sync now" first).
- MQTT/OPC-UA cards stay visible with honest "Coming soon" (honesty-banner pattern already in place).
- This completes the SetupJourney step-3 "live" route that currently dead-ends.

**Wave 1 exit test (demo-able sentence):** *A pump breaches a critical band → supervisor gets an email with a deep link → opens the WO with the needed part reserved against real stock → completes it → requester is notified.* That sentence is the entire market ask.

---

## Wave 2 — Structural (~2–3 weeks): "the spine"

### A3. Server-side detection
- One scheduled edge function (`pg_cron` → `detect-sweep`) runs escalations, PM due/overdue, reading-due checks centrally.
- Fixes the per-browser dedup problem (multi-user duplicate PM alerts) and "nothing happens until someone opens the page."
- Client-side checks remain as instant-feedback complements, but the server is authoritative.

### B2. Parts-to-cost slice (thin vertical through WM-2/FI-1, not the full design)
- WO gains a **Parts tab**: plan (→ reserve, from B1) → goods issue on completion (movement + stock decrement) → line cost.
- WO gains **actual cost**: issued parts + labour (labourRate cascade already committed, ec3e0f5) rolled up on TECO.
- Defer: operations/work-center confirmations, settlement to cost centers, SAP movement-type codes (Wave 3 / post-launch). One WO-level cost number beats a full spine nobody sees at launch.

### C2. Ingestion polish
- Per-point monitoring frequency + P-F interval columns (migration) — rounds-due engine reads per-point cadence instead of criticality default only.
- `ingest-readings` webhook edge function (push model): gateways POST signed readings → `ers_sensor_readings`. Cheaper and more universal than an MQTT broker; makes "live" true for any device that can POST.

### D1. Knowledge capture surfacing (cheap — it's packaging, not building)
- WO detail gains **"Past work on this asset"**: closed WOs same asset (+ same coded finding when present), with their discussion threads one click away.
- Report/Request form shows "similar recent requests" (search already live post-490e5ec).
- Product description doc gains the knowledge-capture claim — threads anchored to work + coded findings + RCA library = the answer to the retiring-workforce question buyers are asking.

---

## Wave 3 — Post-launch depth

- **A4:** Web push (service worker — deliberately retired once; revisit), SMS via Twilio behind the same outbox, per-user channel preferences UI (table already exists).
- **B3:** Operations + confirmations, SAP movement types, settlement to cost center/asset, budget actual-vs-plan tie-in (full `WM-2-Operations-Confirmations-Design.md`).
- **C3:** MQTT/OPC-UA connectors (needs broker/gateway infra), connector health monitoring.
- **D2:** Agent-assisted knowledge ("summarize past failures of this asset" — semantic layer sem_* views + agent tools are already the substrate; mount AgentReviewPanel, currently unmounted).

---

## Sequencing logic and dependencies

1. **A1 before everything** — every other gap's value multiplies once events leave the app (B1's stock-out alert, C1's breach alert, D1's mention all become *reachable*).
2. **B1 before B2** — netting is the primitive the Parts tab consumes.
3. **C1 is independent** — can run parallel with A1 (different files, different migration).
4. All migrations go through the established path: user applies via Supabase SQL editor; code ships strip-and-retry safe pre-migration (0192 pattern).
5. Edge functions are user-deployed (established pattern); A1 needs one new secret (mail API key).
6. Nothing here touches the multi-site question — single-tenant-per-deployment decision (2026-07-04) stands; site-scoped RLS remains deferred.

## Wave 1 status (2026-07-17)

| Slice | Status | You must apply |
|---|---|---|
| A1 email delivery | ✅ d175a0f, **0199 applied** | `supabase functions deploy notify-dispatch` |
| A2 realtime + badges | ✅ ee1f260 | migration **0200** (SQL editor) |
| B1 ATP netting | ✅ 2854868 + 3867fec, **0201 applied** | — |
| C1 Connector Hub live | ✅ 2b63088 | migration **0202** (SQL editor) + `supabase functions deploy sensor-sync` |

**Wave 1 is code-complete.** A2: bell is realtime (30s poll retired; focus + 2-min fallback until 0200 is applied), mobile Home dot, dashboard Alert Feed shows real notifications with deep links, My Work refetches on focus. B1: `stock_reserved` materialized by trigger from planned parts on open WOs; Inventory shows Avail when stock is committed; STOCK_LOW/OUT fire on availability. C1: Connector Hub is DB-backed (0202 supersedes the empty 0177) — REST connectors execute through sensor-sync, Test Connection performs a genuine pull (draft row → sensor-sync → real points-landed count or the source's actual error), reading-map fields added to the REST form, non-executable types honestly gated Coming-soon, DQS shows "—" until a real quality engine exists. Optional: schedule sensor-sync with pg_cron for hands-off polling.

## Wave 2 progress (2026-07-17)

| Slice | Status | You must apply |
|---|---|---|
| A3 detect-sweep (server-side escalations) | ✅ f5dc1fd | `supabase functions deploy detect-sweep`, then pg_cron schedule (snippet in function header) |
| C2 ingest-readings (webhook push) | ✅ f5dc1fd | `supabase functions deploy ingest-readings --no-verify-jwt` + `supabase secrets set INGEST_API_KEY=<long random>` |
| B2 goods issue on TECO (parts consume stock, cost reflects it) | ✅ 42adb2d | — (uses existing tables) |
| D1 past-work-on-asset in WO detail | ✅ 63937fc | — |

**Wave 2 is code-complete.** B2: TECO consumes planned parts — per-location stock decrement (largest holding first, ISSUE transactions), parts flip planned→issued with `date_used`, the 0201 trigger releases reservations at the same moment, shortfalls floor at zero and get reported rather than inventing negative stock; the existing CostTab/getOrderActuals roll-up now reflects real consumption. D1: the WO detail lists the four most recent finished WOs on the same asset, deep-linked — the knowledge-capture surface. Deferred within D1 scope: similar-recent-requests on the Report form, knowledge-capture claim in the product description doc.

A3: sweeps ALL users' breached escalation deadlines centrally (service role) — no open tab required; creates escalation copies (same title/level/dedup semantics as the client sweep, which stays as instant-feedback complement), and queues escalation EMAILs via the 0199 outbox when the channel is on. Role resolution is GLOBAL server-side (documented divergence from the client's org-walk); `__SUPERVISOR` resolves via contacts.parent_id. C2: any device/gateway that can POST JSON with an `x-api-key` header streams readings into `ers_sensor_readings` — push complement to sensor-sync's poll; appends to existing series (last 50), resolves assets by tag or id, reports unknown assets. Schedule both sweepers in pg_cron alongside sensor-sync and notify-dispatch for a fully hands-off loop.

Remaining Wave 2: B2 parts-to-cost slice, D1 knowledge surfacing.

## A1 deploy runbook (email delivery — BUILT 2026-07-17)

Code shipped: `0199_notification_outbox.sql`, `supabase/functions/notify-dispatch/index.ts`,
`eam/lib/notificationEmail.ts`, enqueue hooks in `NotificationService` (`notify()` direct path +
rule `dispatch()` when the rule carries EMAIL), `DatabaseService.enqueueEmailOutbox`.
The app is safe to deploy before either step below — enqueue failures just log, in-app delivery unaffected.

1. **Apply migration 0199** in the Supabase SQL editor. It creates `notification_outbox`
   (clients INSERT-only; only the service role reads/updates), flips the global EMAIL channel
   ON, and adds EMAIL to CRITICAL-severity and escalating rules. Kill-switch stays at
   Admin › Notifications › Delivery Channels.
2. **Deploy the function:** `supabase functions deploy notify-dispatch`. It reuses the
   secrets already set for `audit-invite` (`RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`) — no new ones.
3. *(Optional, Wave 2 preview)* Schedule a sweeper so rows left by closed tabs drain without
   waiting for the next in-app event — pg_cron + `net.http_post` sample is in the function header.
4. **Verify:** assign a WO to a colleague → row appears in `notification_outbox` → email arrives
   with a working deep link; `status` flips PENDING→SENT. A recipient without `users.email`
   ends as SKIPPED, delivery failures retry up to 3 attempts then FAILED (`last_error` says why).

## Explicitly deferred (and why)

- **Full SAP order-to-cost spine at launch** — buyers at this tier buy the closed loop and ease of use, not settlement documents. One honest WO cost number wins the demo.
- **MQTT/OPC-UA** — infra-heavy; REST poll + webhook covers the realistic launch-customer device population. Honest Coming-soon preserves trust.
- **Multi-site RLS** — not asked for by the target segment; single-tenant deployment model already decided.
- **SMS/Push in Wave 1** — email is the channel maintenance supervisors actually check; add others once the outbox exists.
