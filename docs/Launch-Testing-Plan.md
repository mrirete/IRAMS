# IRAMS Launch Testing Plan

**Status:** draft for execution · **Owner:** product/eng · **Target:** launch readiness sign-off
**Scope:** the whole shipping surface, weighted toward the journey most users will actually take —
**AI Reliability Specialist → EAM execution → back to the Specialist for proof.**

---

## 1. What we are actually testing

Per the specialist-led strategy, the product is sold as the **AI Reliability Specialist**. The EAM
is what the Specialist *sends you into*. That makes the seam between them the highest-value and
highest-risk surface in the product: a break there doesn't look like a crash, it looks like advice
that goes nowhere.

So this plan is not "click every page." It is organised around three questions:

1. **Does the spine hold?** Can a new customer go login → import → assessment → mission → do the
   work in the EAM → see the mission close itself, without a dead end?
2. **Does it lie?** Does anything report success it didn't achieve, show numbers it didn't compute,
   or render a control that does nothing?
3. **Does it hold on a phone?** The field half of the audience is thumb-first on a 390px screen,
   often on bad signal.

Everything below serves one of those three.

### Launch-ready definition

The build is launch-ready when:

- Every **P0** and **P1** defect is closed (§8 severity model).
- Every **S-series** spine journey passes on desktop **and** mobile, for the roles that own it.
- The **silent-success scanner** and **dead-control sweep** are clean or explicitly waived in writing.
- The **authenticated prod smoke** passes against the release SHA with the full route list (§9.1).
- No route in `App.tsx` renders a blank body, a permanent spinner, or an uncaught error for any of
  the 10 roles (pass = rendered content *or* an intentional "Access Restricted").

---

## 2. The spine — the journey to protect

Derived from [App.tsx](src/frontend/src/App.tsx#L153-L264),
[SpecialistWorkspacePage.tsx](src/frontend/src/pages/specialist/SpecialistWorkspacePage.tsx),
[briefingParse.ts](src/frontend/src/lib/briefingParse.ts) and
[missionEngine.ts](src/frontend/src/lib/missionEngine.ts).

```
  /login
    └─ RoleLanding
         ├─ TECHNICIAN            → /my-work
         ├─ edition = specialist  → /specialist        ← most users land here
         └─ everyone else         → /dashboard
                                        │
  /specialist  (workspace = home)       │
    ├─ /specialist/import  ──────────►  /specialist/assessment
    ├─ /specialist/assessment ───────►  /analyze
    ├─ /specialist/deliver
    ├─ /specialist/manuals
    ├─ /specialist/roi
    ├─ /specialist/meeting
    ├─ /admin/migration
    └─ MISSIONS ── deep link ──►  EAM modules:
            /recurring-work?due=overdue
            /work-orders?asset=<TAG>
            /analyze?tab=rca&asset=<UUID>
            /analyze?tab=defect_elimination
            /comply/evaluate
            /specialist/deliver
                     │
                     ├─ MissionGuide travels via sessionStorage
                     │  (MISSION_HANDOFF_KEY = 'specialist-active-mission')
                     │
                     └─ work done in EAM ──► mission self-verifies from live data
                                        ──► briefing / ROI / meeting pack reflect it
```

**The three seams that carry all the risk:**

| Seam | What crosses it | How it breaks silently |
|---|---|---|
| **Route seam** | `deepLink()` path → a `<Route>` in App.tsx | Path drifts, route renamed → 404 or bare module root |
| **Param seam** | `?asset=`, `?tab=`, `?due=` | Target page ignores the param → user lands unscoped and doesn't notice |
| **State seam** | `sessionStorage` mission handoff | Cleared by refresh/new tab/private mode → guidance vanishes mid-task |
| **Proof seam** | EAM writes → mission self-verification | Verifier reads a different definition than the writer wrote → mission never closes |

---

## 3. Risk register — defect classes this codebase has actually produced

Not hypothetical. Each of these has shipped here before, so each gets a dedicated sweep.

| # | Class | Evidence | Sweep |
|---|---|---|---|
| R1 | **Silent success** — toast says it worked, nothing was written | 4 known instances; `scripts/scan-silent-success.mjs` exists because of them | D-series |
| R2 | **Stuck spinner** — every page hangs for logged-in users while build/types/unit tests stay green | 2026-07 incident; presence-hook render loop starved Suspense | S/L3-series |
| R3 | **Dead controls** — a rendered button whose handler is a placeholder | Confirmed live example: [WorkOrders.tsx:302-310](src/frontend/src/eam/pages/WorkOrders.tsx#L302-L310) — `handleStatusConfirm` only `console.log`s, wired to a Confirm button at L453. *(Currently unreachable — no `setShowStatusModal(true)` anywhere — so it is dead weight, not a live bug. Exactly what the sweep must distinguish.)* | D4 |
| R4 | **Schema drift** — local migrations ≠ remote schema (lost FKs, RPC `search_path`, JSONB where a join table was expected) | 0216 drift repair, 0224 trigger repair, 0225 gap closure | D5 |
| R5 | **Mock leakage** — placeholder data reaching a real screen | `RecurringWork.tsx:178` generator "(Mock)", `FinOps.tsx:1681`, `PurchaseOrders.tsx:1093`, `Assets.tsx:532`, `ContactsTabs.tsx:717` | D3 |
| R6 | **Param semantics collision** | `/work-orders?asset=` receives a **tag** from `deepLink()` ([briefingParse.ts:216](src/frontend/src/lib/briefingParse.ts#L216)) but is read as an **id** on the create path ([WorkOrders.tsx:129](src/frontend/src/eam/pages/WorkOrders.tsx#L129)) and as a search string at L313 | H3 |
| R7 | **Misaddressed notifications** — `contacts.id` vs `auth.uid` | comm-loop audit | A/R-series |
| R8 | **Unstable-deps render loops** | stuck-spinner root cause; same class can recur in any new hook | L3 console-error gate |
| R9 | **AI cost/abort** — paid calls on thin data, or 10s abort killing a live agent | AI budget 0229, agent abort exemption | A-series |
| R10 | **Permission leakage** — a module visible or writable to a role that shouldn't have it | 10-role matrix, `PermissionGate` + `Gated` (edition) double gate | P-series |

---

## 4. Test architecture — five layers

Each layer catches a class the layer below cannot. Do not substitute one for another; the
stuck-spinner incident happened *because* green L0–L1 was mistaken for a working app.

| Layer | What it is | Catches | Cost | Gate |
|---|---|---|---|---|
| **L0 Static** | `tsc -b`, `eslint`, `knip`, `scan:silent --strict`, route/param contract test | type breaks, dead files, unchecked writes, broken deep links | seconds | every PR, blocking |
| **L1 Unit** | vitest — 36 spec files today, all pure-logic (`missionEngine`, `briefingParse`, `woState`, `psc`, `pmOptimization`…) | engine math, parsing, state derivation | seconds | every PR, blocking |
| **L2 Data/RLS** | scripted Supabase calls per role against a seeded tenant | RLS holes, RPC failures, trigger/FK drift, write-actually-persisted | ~2 min | nightly + pre-release |
| **L3 Browser E2E** | Playwright, real session, real deploy — extend `tests/e2e/smoke.mjs` | stuck spinners, blank pages, uncaught errors, mobile layout, the spine | ~10 min | post-deploy + pre-release |
| **L4 Exploratory** | timeboxed human charters (§7) | judgement, "feels wrong", UX friction, novel breakage | 2h/charter | pre-release |

Current state: **L0 and L1 exist and are healthy. L2 does not exist. L3 exists but covers 10 routes
and zero Specialist routes.** Closing those two gaps is the single biggest testing investment in
this plan (§9).

---

## 5. Coverage matrices

### 5.1 Role × surface (10 roles)

Roles from [rolePermissions.ts](src/frontend/src/eam/constants/rolePermissions.ts):
`SUPER_ADMIN, SYS_ADMIN, PLANNER, RELIABILITY_ENG, SUPERVISOR, MANAGER, EXECUTIVE, TECHNICIAN, REQUESTER, INTERNAL`

Test every role against every route. Three legal outcomes; a fourth is a defect.

| Outcome | Meaning |
|---|---|
| ✅ Renders with data | permitted |
| 🔒 "Access Restricted" | intentional denial — **pass** |
| ➖ Not in nav *and* blocked on direct URL | correctly hidden |
| ❌ Blank / spinner / crash / **visible in nav but blocked on click** | **defect** |

**Priority roles for deep testing** (they carry the spine):
`RELIABILITY_ENG` (the Specialist's primary user) · `TECHNICIAN` (mobile execution) ·
`SUPERVISOR` (approval) · `REQUESTER` (the widest, least-trained population) · `SYS_ADMIN` (setup).

Special checks:
- Nav must not advertise what the role cannot open. Walk the sidebar, command palette and mobile
  bottom nav as each role and click **every** item.
- `SUPER_ADMIN` is the only role with the Admin Activity Log and SYS_ADMIN promotion — verify
  `SYS_ADMIN` cannot self-promote.
- `EXECUTIVE`/`viewCosts` — confirm cost fields are hidden, not merely blanked, for roles without it.

### 5.2 Edition × module

`Gated moduleId=` wraps specialist/predict/comply/audits/vision/intelligence/sustain.
Test each edition (`specialist`, `platform`, others in `companies.edition`):
- gated module hidden from nav **and** blocked on direct URL,
- `RoleLanding` lands correctly (specialist edition → `/specialist`),
- upgrade/denial copy is a clear offer, not a dead end.

### 5.3 Device × viewport

| Class | Viewport | Notes |
|---|---|---|
| Phone S | 360×640 | smallest realistic Android; the layout floor |
| Phone M | 390×844 | iPhone 14/15 — **primary mobile target** |
| Phone L | 430×932 | Pro Max |
| Tablet | 768×1024 | the `md` breakpoint boundary — bottom nav appears/disappears here, test both sides |
| Laptop | 1366×768 | most common desktop; the density that gets neglected |
| Desktop | 1920×1080 | the design target |

Plus: **landscape phone** (390×844 rotated) for any modal or wizard, and **browser zoom 150%** on
laptop as an accessibility proxy.

Browsers: Chrome + Safari (iOS Safari is non-negotiable — different scroll, `100vh`, and date-input
behaviour), Edge, Firefox spot-check.

---

## 6. Test suites

IDs are stable; log defects against them.

### S — Spine journeys (highest priority, run on desktop AND mobile)

| ID | Journey | Pass criteria |
|---|---|---|
| **S1** | **Cold start.** New tenant → login → RoleLanding → workspace renders | Lands on `/specialist` for specialist edition; briefing present or a clear "no briefing yet" state (not a spinner, not an empty box) |
| **S2** | **Import.** `/specialist/import` → upload a real register file → validate → commit → `/specialist/assessment` | Row counts on the success screen match rows **actually in the DB** (R1). Bad file → actionable errors, no partial commit |
| **S3** | **Assessment.** Report renders, charts populate, export produces a valid file | No `NaN`/`undefined`/`Invalid Date` anywhere; PDF/export opens |
| **S4** | **Mission → EAM → close the loop.** Pick each mission type, click Go, land in the module, do the real work, return | Mission self-verifies and closes from live data. Not manual-dismiss-only |
| **S5** | **Guided handoff persistence.** Click Go, then hard-refresh in the destination | MissionGuide survives or degrades gracefully — never a half-guided orphan (R: sessionStorage) |
| **S6** | **Deliver work.** `/specialist/deliver` → proposal → approve | State transition persists across reload; approver role enforced |
| **S7** | **ROI + Meeting pack.** `/specialist/roi`, `/specialist/meeting` | Numbers trace to real records; print view is not clipped; no-print elements excluded |
| **S8** | **Technician path.** TECHNICIAN login → `/my-work` → open WO → execute → complete | Completion is visible to the Supervisor **and** moves the Specialist's mission |
| **S9** | **Requester path.** REQUESTER → submit a request → it becomes visible to the right people only | Request visibility scoping behaves as designed (currently read-open — confirm this is the intended launch posture or fix before launch) |
| **S10** | **Invite path.** Admin sends invite → `/invite/:token` → accept → correct role and contact dedup | Token single-use; expired token gives a clear message |

### H — Handoff contract (automatable; make these L0/L1)

| ID | Check |
|---|---|
| **H1** | Every `path` returned by `routeForMission()` ([briefingParse.ts:197-203](src/frontend/src/lib/briefingParse.ts#L197-L203)) and `missionEngine.ts` resolves to a real `<Route>` in App.tsx. **Assert in a unit test**, not by hand |
| **H2** | Every deep-linked query param is *consumed* by the destination. Confirmed consumers: `/recurring-work` (`urlParams`), `/work-orders` (`asset`, `action`, `title`, `type`), `/analyze` (`asset`, `tab`/`division`). **Unverified:** `?due=overdue` on `/recurring-work` — prove the list actually filters, don't assume |
| **H3** | **R6 collision.** `/work-orders?asset=` is a **tag** from `deepLink()` but read as an **id** on the create path. Test both entry shapes; if they must differ, rename one param |
| **H4** | Deep link with a stale/deleted asset → graceful empty state, not a crash |
| **H5** | Deep link opened in a **new tab** (no sessionStorage mission) → destination still usable |
| **H6** | Missions with `path: null` render as non-clickable, not as a broken button |

### P — Permission & gating

| ID | Check |
|---|---|
| **P1** | Full role × route sweep (§5.1) — automate as an L3 loop over the 10 roles |
| **P2** | Direct-URL access to every admin route as each non-admin role |
| **P3** | Write attempts (create/edit/delete/approve) beyond a role's matrix are refused **at the DB**, not only hidden in the UI — this is the leak that matters (L2) |
| **P4** | `spendingLimit` enforced server-side on approvals |
| **P5** | Edition gating (§5.2) |
| **P6** | Logged-out access to every route redirects to `/login` and returns you to the intended page after auth |

### M — Mobile & responsive

| ID | Check |
|---|---|
| **M1** | Every spine screen at 360/390/430 — no horizontal scroll, no clipped text, no overlapped controls |
| **M2** | **Bottom nav gap.** [MobileBottomNav.tsx](src/frontend/src/shell/MobileBottomNav.tsx#L26-L33) offers Home / My Work / Report / Assets / Inventory — **there is no Specialist entry.** If the Specialist is the product, mobile users of the specialist edition currently reach it only via `/` landing. Decide and test: add it, or prove the landing redirect is sufficient |
| **M3** | Tap targets ≥ 44px; the raised centre Report button doesn't cover content behind it |
| **M4** | Modals and wizards on a phone: scrollable, dismissible, keyboard doesn't cover the submit button; test with the on-screen keyboard **open** |
| **M5** | Tables → verify the mobile treatment (card/stack/scroll) on Work Orders, Assets, Inventory, Requests, Readings — these are the densest grids |
| **M6** | Charts (recharts) resize and remain readable at 360px; legends don't overflow |
| **M7** | iOS Safari specifics: `100vh` under the URL bar, date/time inputs, momentum scroll trapped in modals, safe-area inset under the bottom nav |
| **M8** | Landscape phone on the Import Wizard and any multi-step flow |
| **M9** | Offline/poor network: PWA behaviour, queued writes, and what the user is told. **A write that silently vanishes offline is a P0** |
| **M10** | Camera/QR (`html5-qrcode`) and file upload from a phone |

### D — Data integrity & the "does it lie" sweep

| ID | Check |
|---|---|
| **D1** | `npm run scan:silent -- --strict` clean. Every `silent-success-ok` waiver re-read and justified |
| **D2** | For each of the top 20 write actions: perform it, then **query the DB directly** to confirm the row. Do not trust the toast |
| **D3** | **Mock leakage sweep** (R5) — walk `RecurringWork` PM generation, `FinOps` dashboard/run, `PurchaseOrders` permission check, `Assets` file input, `ContactsTabs` upload. Each: real, or clearly labelled unavailable. No third option |
| **D4** | **Dead-control sweep** — click every button, menu item and link on the spine screens. Anything that does nothing gets logged. `knip` for dead files; manual for dead handlers (R3) |
| **D5** | **Schema drift check** — run the migration ledger against the release target; diff local `migrations/` vs live schema (FKs, RPC `search_path`, triggers, RLS policies). Two `0234_*` migrations exist — confirm ordering is deterministic |
| **D6** | **One-definition check** — canonical WO state (`lib/woState.ts` / `sem_work_orders`) is the *only* definition in play. Any screen computing "open WO" independently is a defect |
| **D7** | Numbers agree across surfaces: dashboard vs report vs briefing vs ROI for the same metric and period |
| **D8** | Timezone/date: due dates, overdue calculations, and "this week" boundaries around midnight and month-end |
| **D9** | Deleting an asset/WO/person referenced elsewhere → blocked or cascaded deliberately; never an orphan |

### A — AI, agents, notifications

| ID | Check |
|---|---|
| **A1** | Briefing generation end-to-end: cron-triggered and manual; failure produces a visible state, not a stale briefing presented as fresh |
| **A2** | AI spend budget (0229): cap enforced; the user is told when the cap is hit; no paid call fires from a UI that's meant to be gated |
| **A3** | **Credit gating** — paid-AI/record-creating buttons locked until the record has enough data. Verify the gate is in the engine, not just the button |
| **A4** | Agent timeouts: long-running agent isn't killed by the generic abort; the UI shows progress rather than freezing |
| **A5** | Grounding: assessment/briefing claims trace to real records. **Spot-check 10 claims against the DB** — a confidently wrong Specialist is the worst possible launch defect |
| **A6** | Notification addressing (R7): assignment → the right person's bell, `auth.uid` not `contacts.id`. Test with a user whose contact id ≠ auth id |
| **A7** | Email delivery: verified domain + `FROM_EMAIL` set + dispatch cron running — or the feature is visibly off, not silently dead |
| **A8** | Realtime/presence: two sessions, one asset — updates propagate, no render loop (watch the console for R8) |

### R — Resilience

| ID | Check |
|---|---|
| **R1e** | Throttle to Slow 3G on the spine — spinners resolve or time out with a retry, never hang |
| **R2e** | Kill the network mid-write on each of the top 10 writes — the user is told; on reconnect, no duplicate |
| **R3e** | Expired/revoked session mid-session → clean re-auth, returns to the same page |
| **R4e** | Two tabs, conflicting edits to one record → last-write-wins is *stated*, or conflict is handled |
| **R5e** | Back/forward button through the whole spine; deep-link refresh on every route |
| **R6e** | Large tenant: 5k assets / 20k WOs — list virtualisation, search responsiveness, chart render time |
| **R7e** | Error boundary: force a component throw → recoverable UI, error logged to `/admin/error-logs` |

### X — Exploratory charters (L4, 2h each, one tester, written notes)

1. *"I'm a reliability engineer on day 1 with a messy register."* — import garbage on purpose.
2. *"I'm a technician on a phone in a plant with one bar."*
3. *"I'm an executive who only opens the ROI page and doesn't trust it."*
4. *"I'm a requester who has never seen this system."*
5. *"I'm trying to break it"* — paste emoji/RTL/10k-char strings, negative numbers, far-future dates, double-click every submit.
6. *"I follow every mission literally and never think."* — does the Specialist ever send me somewhere useless?

---

## 7. Severity model

| Sev | Definition | Launch gate |
|---|---|---|
| **P0** | Data loss, silent success, wrong number presented as fact, security/permission leak, spine blocked | **Blocks launch** |
| **P1** | A spine step fails or is unusable on a supported device; a role can't do its core job | **Blocks launch** |
| **P2** | Non-spine feature broken; ugly but workable UX; cosmetic on mobile | Fix or document as known |
| **P3** | Polish, copy, nice-to-have | Post-launch backlog |

Rule: **anything that reports success without achieving it is automatically P0**, regardless of how
small the feature is. That's the class this codebase produces.

---

## 8. Execution schedule

| Phase | Work | Exit |
|---|---|---|
| **Phase 0 — build the harness** | §9 automation gaps: extend smoke to the Specialist routes + mobile viewport; add H1/H2 contract unit test; stand up the L2 role/RLS script | Harness runs green in CI |
| **Phase 1 — automated sweep** | L0 + L1 + L2 + extended L3 across roles, editions, viewports | Defect list triaged |
| **Phase 2 — spine by hand** | S1–S10 on desktop and mobile, per priority role | All P0/P1 logged |
| **Phase 3 — the lie sweep** | D-series + A5 grounding spot-check | D1 clean, D2 verified |
| **Phase 4 — exploratory** | X charters + R-series resilience | Charter notes filed |
| **Phase 5 — fix and re-verify** | Close P0/P1; re-run Phases 1–3 on the release candidate | Launch-ready per §1 |

Run Phase 1 continuously in CI from Phase 0 onward — it is cheap and it protects the fixes.

---

## 9. Automation to build (the honest gap)

### 9.1 Extend the prod smoke — ✅ DONE (2026-07-31)
[tests/e2e/smoke.mjs](src/frontend/tests/e2e/smoke.mjs) went from 10 routes / 1 viewport / 1 login to:

- **26 routes** including the whole Specialist surface, `/comply/evaluate`, `/admin/migration`,
  `/admin/connectors`, and the deep-linked forms `?tab=rca` and `?due=overdue`;
- **13 spine routes re-swept at 390×844**, failing on horizontal page scroll and naming the
  offending element — offenders nested in a deliberate `overflow-x` container are excluded, because
  a wide table is *supposed* to scroll in place;
- **multi-role sweep** via one `SMOKE_LOGINS_JSON` secret (falls back to the original
  `SMOKE_EMAIL`/`SMOKE_PASSWORD`, so existing CI is untouched);
- **settle-based rendering check** replacing first-paint. This came out of running it: `/requests`
  measured 237 chars at first paint and 1010 settled, so the old assertion covered a third of the
  page — and a route that painted a header then hung a panel forever was indistinguishable from a
  healthy one. Now it polls for two consecutive identical text lengths with no spinner left in
  `<main>`, and reports `STUCK REGION` when a panel never resolves;
- **mobile content-parity warning** — flags (never fails) a spine route whose phone text is under
  50% of its desktop text. Verified exceptions are marked `parityOk` in the route table with a
  reason, so the check stays quiet until something new drops.

Baseline against production: **39/39 pass**, no stuck spinners, no horizontal overflow, no uncaught
errors. Runtime ~4 min per login.

### 9.2 Handoff contract test — ✅ DONE (2026-07-31)
[src/lib/handoffContract.test.ts](src/frontend/src/lib/handoffContract.test.ts) parses App.tsx as the
source of truth (route table + element map + `lazyWithReload` import map) and **runs the real
emitters** rather than grepping for literals, so runtime-built paths are covered too:
`missionEngine`, `briefingParse.routeForAction` + `deepLink`, `notificationNav`, and the workspace's
own path tables. **45 emitted paths, all resolving.** H1/H2 are now permanent.

It immediately found the `?id=` gap (§11). Known-broken handoffs live in a `KNOWN_GAPS` map that is
asserted to *stay* broken — fix one and the test fails telling you to delete its line, so the
allowlist cannot rot into permanent silence.

### 9.3 L2 role/RLS script (new)
Per role: authenticate, attempt the full CRUD matrix against seeded records, assert
allow/deny at the database. This is the only layer that catches P3-class permission leaks, and it
does not exist today.

### 9.4 Mobile viewport in CI
Reuse the smoke harness; a screenshot diff on the spine screens at 390px catches layout regressions
that no assertion will.

---

## 10. Defect log format

```
ID:        <suite-id>-<n>            e.g. S4-03
Severity:  P0 | P1 | P2 | P3
Route:     /work-orders?asset=K-601
Role:      RELIABILITY_ENG
Device:    iPhone 14 / iOS Safari / 390×844
Steps:     1. … 2. … 3. …
Expected:  …
Actual:    …
Evidence:  screenshot / console output / DB query showing the row absent
Class:     R1 silent-success | R2 spinner | R3 dead control | … (§3)
```

Tagging every defect with its §3 class tells us at the end whether we fixed instances or fixed the
class. Launch on instances; schedule the class.

---

## 11. Known items already surfaced by this plan's preparation

Logged here so they aren't rediscovered as "new" during execution.

### 11.0 P0 — role gating not applied to the analytics or Specialist surface — ✅ FIXED (6455c75)

Found by the first real multi-role sweep (§9.1), 2026-07-31. **This is the finding that justifies
the multi-role harness.**

**Resolution.** `Gated` now applies `PermissionGate` as well as `ModuleGate`, with the licence-module
→ permission-key map shared with the sidebar (`config/modulePermissions.ts`) so the nav and the route
cannot disagree. Product ruling applied: the Specialist is open to **all** roles by default
(`reliability` moved from `NO_ACCESS` to `VIEW_ONLY` on the five roles that lacked it), so nobody
loses access on deploy; withdrawing it is a per-user override. `integrity`/`sustain` keep their
stated `NO_ACCESS`, so `/comply/*` is now closed to TECHNICIAN, PLANNER, SUPERVISOR, REQUESTER and
INTERNAL — the policy the matrix always declared and the router never enforced.

Verified in a browser: technician keeps the Specialist and the whole reliability suite, loses
`/comply/evaluate`; admin sets `reliability.view=false` for one technician → route refuses; original
overrides restored. The per-user control finally does what the admin UI always implied.

**Still open:** this was a UI-surface fix. Whether the *data* is readable underneath remains a
question only §9.3 (L2) can answer.

The original finding, for the record:

`TECHNICIAN`'s matrix is explicit: `analytics: NO_ACCESS_PERM`, `reliability: NO_ACCESS_PERM`,
`integrity: NO_ACCESS_PERM` ([rolePermissions.ts:224-241](src/frontend/src/eam/constants/rolePermissions.ts#L224-L241)).
But most of those routes are wrapped in `Gated` (= `ModuleGate`), which is a **licence paywall with
no role awareness at all** — its denial copy is literally *"This module requires an active license."*
Only `PermissionGate` consults the role matrix.

The result, measured against production as a real TECHNICIAN:

| Route | Gate | TECHNICIAN gets | Matrix says |
|---|---|---|---|
| `/reports` | `PermissionGate module="analytics"` | 🔒 Access Restricted | NO_ACCESS ✅ correct |
| `/reliability-metrics` | `Gated moduleId="predict"` | **2245 chars — byte-identical to SUPER_ADMIN** | NO_ACCESS ❌ |
| `/reliability-modelling` | `Gated moduleId="predict"` | 750 chars, full page | NO_ACCESS ❌ |
| `/analyze`, `/analyze?tab=rca` | `Gated moduleId="predict"` | renders | NO_ACCESS ❌ |
| `/predict` | `Gated moduleId="predict"` | 1235 chars, full page | NO_ACCESS ❌ |
| `/comply/evaluate` | `Gated moduleId="comply"` | renders | `integrity: NO_ACCESS` ❌ |
| `/specialist` + all 6 sub-pages | `Gated moduleId="specialist"` | **whole workspace, incl. Import Wizard, ROI statement, Meeting Pack** | no role gate exists ❌ |

Two things make this launch-relevant rather than cosmetic:

- **`/specialist/import` is a data-mutating surface.** A technician can open the CMMS Import Wizard.
- **`/specialist/roi` and `/specialist/meeting` are financial/exec-facing**, and `viewCosts` is a
  permission the matrix deliberately withholds from most roles.

The fix pattern already exists in the codebase and is simply applied unevenly —
`/comply/inspections/:id` and the `/audits/*` routes correctly compose both gates
(`<Gated moduleId><PermissionGate module>`). The remedy is to compose the two everywhere, and to
decide deliberately which roles may see the Specialist.

**Caveat on scope:** this is a *UI-surface* finding. Whether the underlying data is also readable is
a separate question that only the L2 layer (§9.3, not built) can answer. Do not assume the DB is
safe because the UI is fixed.

### 11.1 Other items

| Item | Location | Class | Action |
|---|---|---|---|
| `handleStatusConfirm` is a placeholder that only `console.log`s, wired to a Confirm button; **currently unreachable** (no `setShowStatusModal(true)`) | [WorkOrders.tsx:302-310](src/frontend/src/eam/pages/WorkOrders.tsx#L302-L310), modal L425-453 | R3 | Delete the dead modal + handler, or implement it. Don't ship a Confirm button that lies if it ever becomes reachable |
| `?asset=` carries a **tag** from `deepLink()` but is read as an **id** on the create path | [briefingParse.ts:216](src/frontend/src/lib/briefingParse.ts#L216) vs [WorkOrders.tsx:129](src/frontend/src/eam/pages/WorkOrders.tsx#L129) | R6 | Verify both shapes work; consider `assetTag` vs `assetId` |
| Mobile bottom nav has no Specialist entry | [MobileBottomNav.tsx:26-33](src/frontend/src/shell/MobileBottomNav.tsx#L26-L33) | M2 | Product decision before launch |
| Mock/TODO markers on live pages | `RecurringWork:178,3248`, `FinOps:831,1681`, `PurchaseOrders:1093`, `Assets:532`, `ContactsTabs:717`, `Readings:265` | R5 | Triage each: real, or labelled unavailable |
| Two migrations numbered `0234` | `0234_asset_reliability_canonical.sql`, `0234_rcm_decisions_unique.sql` | R4 | Confirm deterministic apply order in the tenant runner |
| ~~Prod smoke covers 10 routes, none of them Specialist~~ — now 26 routes + phone sweep + multi-role | `tests/e2e/smoke.mjs` | — | ✅ §9.1 done |
| Smoke asserted on **first paint**, not settled content — `/requests` was 237 chars vs 1010 settled | `tests/e2e/smoke.mjs` | R2 | ✅ fixed with the settle poll |
| `/requests` phone shows 42% of desktop text | [ServiceRequests.tsx:374-390](src/frontend/src/eam/pages/ServiceRequests.tsx#L374-L390) | M5 | **Not a defect** — `MobileRequestGroup` collapsibles, only "New" `defaultOpen`. Marked `parityOk` |
| `notificationRoute` documents "Assets / Requests / POs / Inventory / PMs open by `?id=`" — only **Assets** implements it. The other four land on a list, not the record | [notificationNav.ts:22-31](src/frontend/src/lib/notificationNav.ts#L22-L31) vs ServiceRequests / PurchaseOrders / Inventory / RecurringWork | H2 | Tracked in `KNOWN_GAPS`; decide fix-or-drop before launch |
| **Global Settings saved nothing.** `handleSave` set its own label to "Saved" for 2s and wrote nowhere; values lived in `localStorage`, so "Enterprise-wide configuration" was per-browser — two users could see the same costs in different currencies | GlobalSettingsPage / SettingsContext | R1 | ✅ **FIXED** (e585754 + migration 0235) — persisted to `companies.app_settings`, admin-only via existing RLS, save reports refusals. An RLS denial returns HTTP 200 with 0 rows, so the code checks row count, not just `error` |
| No L2 (data/RLS) layer exists | — | R10 | §9.3 — **now the top gap**, since §11.0 is UI-only |

### 11.2 Multi-role test credentials

The sweep runs on existing accounts; nothing was provisioned. Verified working 2026-07-31 with the
shared dev password: `admin001@cainergy.com` (SUPER_ADMIN), `k.syrus@cainergy.com` and
`john.doe@cainergy.com` (RELIABILITY_ENG), `bea@cainergy.com` and `alex@cainergy.com` (TECHNICIAN).

**Gap: there is no REQUESTER account.** REQUESTER is the widest and least-trained population at
launch (§5.1) and is currently untestable. `smoke-ci@irams.app` exists as a TECHNICIAN but its
password is not the shared one — that is the account CI should use once its secret is set.
