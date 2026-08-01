# IREAMS — Integrated Reliability and Enterprise Management System

*Source content for brochure, user manuals, and website copy. Grounded in the current build (2026-07-11); marks noted where a capability is in active rollout rather than fully live so marketing claims stay honest.*

---

## 1. Positioning statement

**IREAMS is the first EAM platform built around a Reliability Specialist, not just a work-order queue.**

Most CMMS/EAM tools make you choose: the friendly, mobile-first work-management tools (MaintainX-class) that technicians love but that stop at "log the work," or the deep enterprise reliability suites (SAP PM/EAM-class) that engineers need but that take months to configure and nobody in the field wants to touch. IREAMS closes that gap — full asset, work, inventory, and cost management for the whole organization, with genuine reliability engineering (Weibull analysis, RCM, RCA, Monte Carlo simulation, criticality/FMEA) built in natively, not bolted on — and an AI Reliability Specialist that sits across the whole system, reads your real data, and helps you act on it.

**Tagline options:**
- "SAP-class reliability. MaintainX-class simplicity."
- "The EAM platform with a reliability engineer built in."
- "Your assets. Your data. Your Reliability Specialist."

---

## 2. EAM core — full asset and work management

IREAMS is a complete, Supabase-backed EAM system covering the day-to-day operational backbone:

- **Asset Register** — hierarchical asset trees (site → area → equipment → component), criticality classification (A/B/C/D), full asset history, warranty tracking, and document/photo attachments.
- **Work Orders** — corrective, preventive, and emergency work, task lists, labor and parts tracking, JSA/safety steps, crew-aware assignment, mobile execution with offline support.
- **Preventive Maintenance & Recurring Work** — calendar- and meter-based PM triggers, maintenance strategy "packages" with automatic task absorption (e.g., a 12-month PM absorbs the 1/3/6-month visits when intervals align), so technicians aren't sent out three times for one shutdown window.
- **Scheduling** — visual, criticality-aware scheduling with frozen-zone protection near execution dates.
- **Inventory & Parts** — stock levels, reservations, purchase orders, vendor management.
- **Service Requests / Work Requests** — a simple front door for anyone in the organization to report a problem, auto-triaged by severity, converting one-tap into a work order.
- **Condition Monitoring & Meter Readings** — a full manual/handheld readings module (the real-world path for sites without networked sensors): alarm-banded reading points, rounds/"readings due" tracking by criticality, automatic PM triggers off meter values, parent→child meter propagation across asset hierarchies, trend charts with least-squares trend lines, and one-tap work-order creation on a critical breach.
- **FinOps** — budget availability control, replacement asset value (RAV), depreciation, warranty recovery, and cost roll-up from work orders to cost centers.
- **People & Competency** — contacts, crews, qualifications with expiry tracking, competency-gated assignment.
- **Multi-Company / Multi-Site enterprise structure** — SAP-style Company Code and organization-unit tiers, with per-company numbering ranges (e.g., each subsidiary gets its own equipment-numbering scheme) and group roll-up for the parent organization — the enterprise depth that lets IREAMS scale from a single plant to a multi-site group without changing systems.
- **Team Messaging, anchored to the work** — every work order, RCA, and service request carries its own real-time discussion thread with @mentions and offline-safe delivery. Unlike a generic chat app bolted on the side, the conversation becomes permanent, searchable history attached to the asset — evidence you can point to during an RCA, not a message that scrolled away.
- **Offline-first field operations** — technicians can report problems, log readings, and save work orders with no signal; writes queue locally and sync automatically and idempotently the moment connectivity returns. Built for real plant floors, not just office wifi.
- **Command Palette & role-aware navigation** — instant search-and-go across pages, work orders, and assets; home screens tailored to the user's role (technicians land on "My Work," not a dashboard built for engineers).

---

## 3. Reliability tier — the depth that sets IREAMS apart

This is IREAMS's core differentiator: reliability engineering that is *computed from your actual maintenance data*, not a static scorecard or a demo.

- **Metrics** — live MTBF, MTTR, availability, and bad-actor rankings computed from real work-order history, with adjustable analysis windows (90 days to 24 months) and criticality/class filters.
- **Analyze (RCA / Defect Elimination)** — structured root-cause investigations following a Physical → Human → Latent causal ladder (the physical cause is never the root — most true roots are systemic/organizational), with business-impact quantification and a defect-elimination task tracker.
- **Weibull Reliability Modelling** — a genuine, statistically correct Weibull fitting engine (median-rank regression with Johnson-adjusted ranks) that **properly handles censored data** — assets still running when the data was pulled are treated as suspensions, not ignored, which is the single most common way naive reliability tools overstate failure risk. Confidence bounds included.
- **Monte Carlo Simulation & RAM (Reliability-Availability-Maintainability)** — real discrete-event simulation (inverse-CDF Weibull sampling, Box-Muller lognormal repair times) to compare preventive-maintenance strategies against run-to-failure on cost and availability, with convergence checking — not a rule-of-thumb calculator.
- **FMEA / RCM** — JA1011-aligned failure mode and criticality analysis that auto-generates PM tasks from the failure modes identified, closing the loop from "what can fail" to "what we do about it."
- **Criticality Assessment** — a consequence × probability risk matrix (safety, environment, production, cost, reputation) that drives A/B/C/D criticality classification, which in turn drives reading cadence, maintenance strategy defaults, and scheduling protection.
- **Integrity Management** — API-510/570/653-aligned corrosion-rate and remaining-life calculations from thickness readings (short-term and long-term corrosion rate, controlling rate, next-inspection-due date capped to code maximums).
- **One connected loop, not five silos** — bad actors identified in Metrics link directly into a Weibull fit pre-seeded with that asset's failure history, which links into a Monte Carlo comparison, which links into "Create PM," which links into RCM/RCA. Reliability engineers navigate a spine (Measure → Diagnose → Model → Decide → Forecast), not five disconnected tools computing MTBF five different ways.

### Success-Centric Evolution (PSC) — a published-research differentiator

IREAMS is the **reference implementation** of the Percentage of Success Centred (PSC) framework, a published evolution of Reliability-Centred Maintenance (Olorunfemi, *Science, Technology & Public Policy*, 2026). Where classical RCM tracks a Defect-Initiation-to-Potential-Failure (D-I-P-F) curve, PSC tracks the **D-I-S-G curve** (Defect Initiation → Sub-optimal → Golden-spot restoration), reframing reliability around an asset's *Golden Spot* — its optimal operating envelope — and how much time it spends there.

- **Golden Spot** — each asset's optimal parameter bands (6–10 parameters), computed directly from its condition-monitoring alarm bands.
- **Zone tracking** — In Golden Spot → Sub-Optimal Drift → Critical Departure → Restored, replayed from real reading history.
- **MTOP** (Mean Time Operating in Golden Spot) **/ MTTRg** (Mean Time To Restore Golden spot) **/ SR** (Success Rate = MTOP ÷ (MTOP + MTTRg), targeting ≥90%, world-class ≥95%) **/ OPE** (Operational Process Effectiveness = SR × Process Quality × Energy Efficiency).
- **SMEA** (Success Mode & Effects Analysis) — the positive-deviance counterpart to FMEA: instead of ranking failure modes by risk, SMEA ranks *success modes* by SPN (Success Priority Number = Value × Sustainability × Monitorability), tracked through a status lifecycle from identified to sustained.
- Traditional failure analysis (FMEA/RCA) stays fully in place and remains authoritative for safety-critical cases — PSC is an additive success layer, not a replacement.

**Marketing angle:** *"The first EAM with native support for the PSC framework — built by the person who published it."*

---

## 4. The Reliability Specialist — AI built on tools, not guesses

IREAMS's AI layer is named **the Reliability Specialist** (one consistent persona across the product; powered by Google Gemini under the hood, branded as "Relantern AI"). It is deliberately architected so **the AI never does the reliability math itself** — every number it cites comes from IREAMS's own deterministic engines (the same Weibull fitter, Monte Carlo engine, and criticality calculators used everywhere else in the product). The AI's job is to query, interpret, cite, and converse — not to hallucinate a failure rate.

**How it's surfaced:** one calm, floating launcher available from anywhere in the app (not a wall of separate chat boxes bolted onto every page) that opens a slide-in drawer, pre-grounded in the asset or investigation you're looking at.

**Specialist skills currently live:**
- **RCA Copilot** — a multi-turn conversational partner for root-cause investigations. It grounds itself in the asset's health and failure history, asks one focused question at a time, enforces the Physical → Human → Latent ladder so investigations don't stop at the first symptom, and proposes structured RCA findings (why-chain, corrective actions, problem statement) that a human reviews and applies — nothing is written to the record without a person clicking "Apply."
- **Bad Actor Hunter** — ranks your worst-performing assets by real cost and downtime from work-order history and drafts defect-elimination tasks for human review and approval.
- **RCA Challenger** — a Socratic reviewer that questions a root-cause investigation against the asset's actual failure history, flagging thin evidence.
- **Corrosion Sentinel** — monitors integrity data (API 510/570/653 thickness readings) and flags assets approaching their remaining-life or inspection-due thresholds.
- **PM Optimizer** — compares active PM programs against actual corrective-failure history to flag over-maintenance, ineffective PMs, and redundant tasks.
- **Reliability Digest** — a standing morning-briefing agent that summarizes bad actors, corrosion risk, and work backlog into one readable digest on the home screen.
- **Warranty Recovery** — automatically matches completed work orders against active warranty windows to surface money the organization is owed back from vendors.

**Governance built in, not bolted on:** every agent runs at an explicit autonomy tier — advisory-only agents that can read and suggest, or draft-and-approve agents whose proposed actions require a human click before anything changes. No agent is allowed to autonomously write to the record. Every run is written to an immutable audit log. This is a deliberate design choice for a maintenance/reliability system: the AI accelerates judgment, it doesn't replace the engineer's sign-off.

**Marketing framing:** *"An AI that cites its sources. Every number the Reliability Specialist gives you traces back to your own data — not a black box, not a guess."*

---

## 5. Seamless data unification — the semantic layer

This is IREAMS's newest and most forward-looking technical capability, and directly answers the industry's current direction (large enterprise platforms — including SAP's own recent move to acquire a semantic/data-catalog layer — are racing to make plant data "AI-ready").

**The problem it solves:** reliability data in any EAM lives scattered across many raw tables — failure records, work history, condition readings, PM compliance, asset health — each with its own quirks, historical naming, and unit conventions. Ask five different reports for "asset health" and you can get five different, quietly inconsistent answers. And raw database tables are not something an AI agent — or a new integration partner — can safely query without knowing all those quirks.

**What IREAMS built:** a **semantic layer** that sits over the raw operational data and exposes it as clean, canonical, self-describing views:

- **Five canonical semantic views** — unified, standards-aligned representations of failure events, work history, condition readings, PM compliance, and asset health — each a single source of truth that every report, chart, and AI agent reads from, so "MTBF" and "asset health" mean the same thing everywhere in the product.
- **A live data catalog** — every dataset and column is annotated in a searchable catalog: what it means, what standard it maps to (ISO 14224 for failure/reliability taxonomy, ISO 55000 for asset management terminology), where it came from (full lineage back to source tables), and its sensitivity classification. This is the same "annotate first" pattern that industry-leading data platforms use to make raw data trustworthy for both humans and AI — built natively into IREAMS rather than requiring a separate data-lake product.
- **Agent-callable by design** — the Reliability Specialist's tools query these semantic views directly (`get_asset_health`, `lookup_data_definitions`), so when the AI answers a question about an asset, it is reading the same governed, standards-annotated data your reports read — not a raw, ambiguous table.
- **Open by design** — because the semantic layer is standards-annotated (ISO 14224, ISO 55000) and cleanly modeled, it is architected to export into open table/catalog formats (e.g., Apache Iceberg) for organizations that want to federate IREAMS data into a broader enterprise data platform (SAP Business Data Cloud, Databricks, or similar) — without having to reverse-engineer IREAMS's internal schema first.

**Why this matters for the brochure:** it's the difference between "we have an AI chatbot" and "our data is structured so AI — ours or yours — can actually be trusted to reason over it." IREAMS's moat here isn't the semantic-layer technology itself; it's the *domain-specific annotation* — reliability and asset-management vocabulary (ISO 14224 failure taxonomy, criticality, RCM/FMEA/PSC constructs) encoded directly into the catalog, which a generic data platform won't have out of the box.

**Marketing framing:** *"AI-ready reliability data, open by design."*

---

## 6. Platform & architecture (for technical buyers / IT audiences)

- **Modern cloud stack** — Supabase (Postgres) backend, React frontend, deployed on Vercel; real-time subscriptions for live collaboration (messaging, notifications).
- **Row-level security** — governed write access at the database layer (not just app-level checks): sensitive configuration and admin actions are enforced by database policy, and system audit logs are append-only/tamper-evident by design.
- **Single-tenant-per-deployment** — each customer gets a dedicated database and deployment, giving strong data isolation by construction (no shared-tenant data leakage risk) while still supporting a multi-company, multi-site structure *within* that deployment for organizations with subsidiaries or multiple plants.
- **Offline-first mobile experience** — installable PWA with safe-area support for handheld devices, large touch targets for gloved use, and a durable offline write queue so field data is never lost to a bad signal.
- **Standards-aligned throughout** — ISO 14224 (reliability data taxonomy), ISO 55000 (asset management), API 510/570/653 (integrity/inspection), JA1011 (RCM), the PSC framework — not generic maintenance software with reliability terms sprinkled on top.

---

## 7. Suggested copy blocks (ready to lift)

**Short (elevator / homepage hero):**
> IREAMS is the EAM platform with a reliability engineer built in. Full asset, work, and cost management for your whole operation — plus real Weibull analysis, RCM, RCA, and Monte Carlo simulation computed from your actual data, and an AI Reliability Specialist that cites its sources.

**Medium (brochure intro paragraph):**
> Most maintenance software makes you choose between simplicity and depth. IREAMS doesn't. It's a complete, modern EAM system — assets, work orders, PMs, inventory, scheduling, cost, and offline-capable field tools — built around a genuine reliability engineering core: censored Weibull analysis, discrete-event Monte Carlo simulation, RCM/FMEA, and the published PSC (Percentage of Success Centred) framework, of which IREAMS is the reference implementation. An AI Reliability Specialist sits across the whole system — hunting bad actors, drafting root-cause analyses, tracking corrosion risk, recovering warranty dollars — every claim traceable back to your own governed, standards-annotated data.

**Technical/website "under the hood" blurb:**
> IREAMS's data isn't just stored — it's annotated. A semantic layer maps every core reliability dataset to ISO 14224 and ISO 55000 vocabulary with full lineage, so reports, dashboards, and AI agents all read from one governed, self-describing source of truth — and so the platform is ready to federate into a broader enterprise data ecosystem when you need it to be.

---

## 8. Honesty notes (internal — do not publish)

For accuracy when drafting external copy, keep these distinctions in mind:

- The **Predict** page's RUL estimate is currently a labeled "Experimental" heuristic, distinct from the fully statistical Weibull/Monte Carlo modelling tool — don't market it as a certified prognostic without checking current status first.
- **Multi-site row-level-security enforcement** (data isolation *between* sites within one deployment) is on the roadmap but not the current security boundary — today's isolation guarantee is *between customers* (separate deployments), not between sites of the same customer. Fine to market single-tenant isolation; don't claim per-site data walls yet.
- Full **streaming IoT/sensor connectors** (MQTT/OPC-UA/REST-poll) are not yet built — the live condition-monitoring story today is manual/handheld readings plus a CSV sensor-import path. Market "condition monitoring," not "IoT platform," until connectors ship.
- Real email/SMS delivery for colleague invites isn't wired yet (link-sharing works today). Not brochure-relevant, but avoid promising automated invite emails in onboarding copy.

Before finalizing any external claim not covered above, a quick recheck against current code/CLAUDE.md is worthwhile — this document is a snapshot as of 2026-07-11.
