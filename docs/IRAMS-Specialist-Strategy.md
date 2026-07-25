# IRAMS Specialist-Led Strategy — "Hire Your Reliability Specialist"

_Status: strategy (2026-07-24). Supersedes the EAM-first positioning in `IRAMS-Product-Description.md` §1. Companion docs: `reliability-ai-agents-design.md` (technical design), `Market-Gap-Closure-Plan.md` (loop-closing work)._

---

## 0. Executive summary

**The thesis.** The scarcest resource in industrial maintenance is not software — it is reliability engineering skill. Plants sit on years of CMMS history that nobody on staff is qualified to read, and they cannot hire the person who could: the skills gap is a top-three downtime driver in the industry's own survey data. IRAMS stops selling "an EAM with AI features" and starts selling **an AI Reliability Specialist any organization can employ** — on top of whatever CMMS they already run, or inside the IRAMS platform for those who want one system. We price it like the labor it replaces, not like the software it resembles.

**Why this wins now — three verified facts (2026-07-24):**

1. **The engineering layer of the market's AI is empty.** Maximo's watsonx assistant is chat-over-data. MaintainX AI ($2.5B valuation, #1 on G2) does anomaly flags, parts prediction, and natural-language analytics. Limble's Winter-2026 AI does scheduling and photo-to-asset. None of them do engineering: no censored Weibull, no RCM logic, no evidence-graded RCA, no API-570 remaining life. IRAMS already has all of it, built and live.
2. **The category is unclaimed.** No product anywhere markets an "AI reliability engineer" for physical assets (the phrase today means humans babysitting AI systems). Whoever names the category owns its search results, its analyst coverage, and its buyer vocabulary.
3. **The delivery model is being validated by others — so the window is finite.** Facilio's "Atom" already sells AI agents layered on IBM Maximo "without replacing, migrating, or reconfiguring your existing setup." The agents-on-top pattern works; nobody has aimed it at reliability engineering yet. Assume 12–18 months before someone does.

**The play in one sentence:** land with a same-day reliability assessment run on the prospect's own CMMS export, convert to a monthly "the Specialist stays employed" subscription, and expand to the IRAMS platform when the customer is ready to consolidate.

**What changes:** positioning inverts (Specialist is the product; EAM is a deployment mode), pricing re-anchors (per-site fraction-of-a-salary, not per-user seats), and the build queue re-sequences to revenue (import agent + assessment report first). **What does not change:** the Gemini provider decision, the Tier-2 autonomy ceiling (human approves every write), the semantic-layer strategy, and the EAM itself — which becomes the closed-loop rail and the second deployment mode, not a regret.

---

## 1. The strategic thesis in full

### 1.1 The original dream, restated

A Reliability Specialist AI that works like a real reliability engineer and can be employed by any organization — purchasable as a single product. Not a dashboard, not a copilot feature: an employee. It reads your maintenance history, notices what's costing you money, runs the analyses a specialist would run (Pareto, Weibull, RCA, PM optimization, integrity), proposes work, and follows through — under human supervision.

### 1.2 What actually happened, and why it was the right detour

Building the EAM was not a deviation; it was the apprenticeship. A reliability engineer with no CMMS has nothing to read and nowhere to write. The EAM forced the build-out of everything the Specialist needs to exist:

- a **data model** rich enough to reason over (assets, work, failures, readings, costs, warranties);
- a **deterministic tool plane** (the actual engineering math — see §2);
- a **governance and audit frame** (autonomy tiers, immutable logs, citations) — the "employment contract";
- a **system of action** so recommendations become work orders and outcomes, which the market demands (Verdantix 2026: buyers reject advice-only tools);
- a **semantic layer** that abstracts the agents from the schema — the portability hinge.

The error was not building the EAM. The error was letting the EAM become the noun and the Specialist the adjective. `IRAMS-Product-Description.md` currently leads with "the first **EAM platform** built around a Reliability Specialist." This strategy inverts that sentence.

### 1.3 The core commercial insight: sell labor, not software

Software budgets for CMMS are small and contested ($21–59/user/month is the mid-market clearing price). Labor budgets for engineering skill are large and **unspendable** — the role goes unfilled. A loaded reliability engineer costs $150k–220k/yr in Western markets and effectively cannot be hired by a mid-market plant at any price. A Specialist priced at a fraction of that unfillable salary:

- is compared to a salary line, not to MaintainX's seat price;
- lands inside the "75% of adopters report AI ROI in under 6 months" expectation window;
- makes the buyer the plant manager / reliability manager (labor problem owner), not IT (software problem owner).

This single reframe changes pricing, messaging, the demo, and the roadmap. Everything below follows from it.

---

## 2. Strategic asset inventory — what we are strong in, verified in the build

Strategy must be built on strengths that are real, scarce, and hard to copy. Every item below exists in the codebase today (not roadmap), with its competitive meaning stated.

| # | Asset (verified in build) | Why it is scarce | Strategic use |
|---|---|---|---|
| S1 | **Governed agent runtime** — 7 live server-side agents (`agent-run` edge function): RCA Copilot (multi-turn), Bad Actor Hunter, RCA Challenger, Corrosion Sentinel, PM Optimizer, Reliability Digest, Warranty Recovery. Autonomy tiers (T1 advise / T2 draft+human-approve / T3 off), immutable audit (`ers_ai_audit_log`, `ers_agent_actions`), citations required, JWT + RLS enforced server-side. | Competitors ship chat UIs. We ship an **employment framework**: job description (system prompt + toolset), supervision (tiers), personnel file (audit log). This directly answers the market's #1 stated fear about agents — reliability and accountability of the agent itself. | The product core. The governance story is a *selling point* for safety-critical industries, not compliance overhead. |
| S2 | **Deterministic engineering core — "agents orchestrate, tools compute."** Censored Weibull (median-rank regression, Johnson-adjusted ranks, suspensions handled), Monte Carlo RAM (inverse-CDF sampling, Box-Muller repair times, convergence checks), JA1011-aligned RCM/FMEA, API 510/570/653 corrosion-rate + remaining-life, bearing-fault spectral diagnosis (FFT/envelope, named fault frequencies). The LLM never performs the math. | Every incumbent's "AI" is an LLM talking about data. Ours is an LLM *driving verified engines*. This is the difference between a chatbot that sounds like an engineer and an employee whose calculations are defensible in a reliability review. It took years of domain knowledge to encode; it cannot be prompt-engineered into existence. | The moat. Lead every proof conversation with it ("ask our Specialist to show its math — it can, because it didn't do the math; the engine did"). |
| S3 | **Evidence-graded RCA** — quality ladder (fact > inference > opinion > hearsay), node↔evidence citations, evidenced/assumed tagging on every cause node, Physical → Human → Latent causal ladder with a soft root-cause gate. | No CMMS-tier product structures investigation evidence at all. This mirrors how real incident investigators work and produces **auditable** root-cause cases — insurance, regulatory, and corporate-HSE value. | Flagship differentiation for the RCA Copilot; a wedge into regulated industries. |
| S4 | **Semantic layer** — `sem_*` canonical views + `semantic_catalog` (descriptions, lineage, ISO 14224 annotations); agents consume the semantic contract, not raw tables. | This is the same architectural bet SAP paid for when it acquired Dremio — built natively, small, and domain-annotated. | **The portability hinge.** Any foreign CMMS data mapped into `sem_*` shapes makes the entire agent roster work unchanged. "Employable by any organisation" is a data-mapping problem, not a rewrite. |
| S5 | **PSC framework — published research.** Percentage-of-Success-Centred maintenance (Olorunfemi, *Science, Technology & Public Policy*, 2026): D-I-S-G curve, Golden Spot, MTOP/MTTRg/SR/OPE, SMEA. IRAMS is the reference implementation (engine + metrics live). | Competitors have features; we have a **methodology with a citation**. Categories are built on named frameworks (RCM had Nowlan & Heap; TPM had Nakajima). | Category-creation ammunition: talks, papers, training. The Specialist doesn't just work like an engineer — it practices a published discipline. |
| S6 | **A complete system of action** — full EAM: work orders, PM/scheduling with frozen zones, inventory with ATP, requests, condition monitoring/readings, FinOps (budgets, RAV, depreciation, warranty), people/competency, multi-company enterprise structure, offline-first mobile, anchored team messaging, email delivery rails, webhook ingestion, connector hub. | The market rejects advice-only tools (Verdantix: closed loop or nothing). Most AI startups have no action rail; most CMMS vendors have no engineering. We have both, in one codebase. | Deployment Mode B (§5.2), the expansion tier, and the fallback for the no-CMMS segment. Also the demo environment where the Specialist's full loop is visible. |
| S7 | **Sensor-free predictive entry.** Weibull/bad-actor/PM analysis run on work-order history alone; spectral diagnosis is additive when sensor data exists (webhook + REST connectors already live). | Predictive maintenance adoption is stuck at 27–30% because of sensor cost and skills. Hardware-dependent competitors (Augury-class) structurally cannot serve the unsensored 70%. | The wedge into the majority of the market: "start with the data you already have." |
| S8 | **Integrity module (API 510/570/653)** — CML thickness tracking, short/long-term corrosion rates, controlling rate, remaining life, code-capped inspection dates. | No CMMS-tier or mobile-first player has mechanical-integrity engineering. It is a statutory need in process industry. | Beachhead vertical moat (§5.4): oil & gas, chemicals, terminals — where the hiring gap is also most acute. |
| S9 | **Structural cost advantage.** Solo founder + AI-assisted development; Supabase serverless; Gemini inference costs are cents per agent run because tools compute deterministically and the LLM only orchestrates. | VC-backed competitors carry $100M+ burn and must chase enterprise ACVs. We can profitably serve a mid-market site at price points they cannot touch, with ~90%+ gross margin at the proposed pricing. | Pricing freedom (§5.3) and survivability: the strategy does not require outside capital to reach revenue. |

**Reading of the board:** S1+S2+S3 make the Specialist *credible*, S4+S7 make it *employable anywhere*, S5 makes it a *category*, S6 makes it *actionable*, S8 picks the *beachhead*, S9 makes the business *survivable while small*. The strategy's job is to point all nine at one motion.

---

## 3. Market truth — demand side

Sources: Verdantix Green Quadrant APM 2026; MaintainX State of Industrial Maintenance 2026 (n=2,234); AI-CMMS market roundups verified 2026-07-24; sizes as noted.

1. **The labor gap is the budget line.** Labor shortage / skills gap ranks as a top downtime driver in the industry's own survey. An aging reliability workforce is retiring faster than it is replaced; mid-market plants cannot hire the discipline at all. *Implication: the buyer's unspent salary budget is our revenue pool.*
2. **Action over prediction.** Buyers explicitly reject predict-only and advise-only tools; they want prediction → work order → verified outcome. *Implication: the Specialist must write back into a work stream (theirs or ours) — pure-advisory standalone is a known-failed category.*
3. **The PM intention–execution gap.** 71% call preventive maintenance core; under 35% live it; only 32% have real programs. *Implication: PM Optimizer and Weibull-derived intervals attack a felt, admitted failure — not a need we must educate into existence.*
4. **Predictive adoption is plateaued at 27–30%**, blocked by sensor cost and skills. *Implication: sensor-free entry (S7) addresses the 70%, not the crowded 30%.*
5. **AI appetite is proven and impatient.** 58% of maintenance teams already use AI somewhere; 75% of adopters report ROI within 6 months; 65% of organizations plan AI-powered maintenance by end of 2026. *Implication: a same-day assessment with dollar figures lands exactly inside the buyer's expectation window.*
6. **Money at stake:** unplanned downtime costs industrial manufacturers an estimated $50B/yr; APM market $2.5B → $5B by 2028 (11.9% CAGR); PdM ~$15B growing ~23% CAGR. *Implication: a category-defining niche inside this is a real business, not a lifestyle product.*
7. **Buying behavior:** mid-market buys simplicity and adopts bottom-up (MaintainX's 12x growth path); enterprise buys layers on top of SAP/Maximo rather than replacements (Facilio's model). *Implication: nobody in either segment wants rip-and-replace from an unknown vendor — the wedge must not require it.*

---

## 4. Competitive truth — supply side

Verified 2026-07-24 unless noted.

| Player class | Examples | Their AI, today | What they lack | Threat to us |
|---|---|---|---|---|
| Mobile-first CMMS | MaintainX ($2.5B val., $254M raised, #1 G2, 14k customers, $21–59/user/mo), Limble ($450M val., Winter-26: AI scheduling, Asset Snap, MCP), UpKeep | Administrative AI: anomaly flags, parts prediction, NL analytics, voice, scheduling | **Reliability engineering** — even Limble's own comparison page concedes MaintainX "lacks the deep reliability engineering tools" | High reach, low depth. Will bundle "AI agents" as checkbox features; cannot credibly do engineering soon. |
| Enterprise EAM | IBM Maximo 9.1 (watsonx assistant, ~$250/user/mo), SAP (Dremio-powered BDC feeding agents) | Chat-over-data + IoT condition monitoring at platform scale | Agility, mid-market price, and independence — their agents exist to defend their platform and only see their data | Sets the "agentic" narrative at the top of the market; not a mid-market competitor. |
| Sensor-AI / PdM | Augury, UptimeAI, Nanoprecise, Tractian | Hardware + ML diagnosis (vibration/acoustic), strong at fault detection | The engineering *discipline* (Weibull programs, RCM, RCA facilitation, integrity) and the unsensored 70% of the market | Adjacent, not overlapping; potential partners/channel later. |
| Agents-on-top | **Facilio "Atom"** (agents on Maximo via REST, "without replacing, migrating, or reconfiguring") | Autonomous operational intelligence for facilities | Reliability engineering focus; heavy-industry domain depth | **The pattern-prover.** Validates our delivery model and starts the clock on the window. |
| **The empty cell** | — | **Engineering-grade, system-independent, sensor-optional AI reliability specialist** | — | **This is IRAMS's position. Nobody occupies it. Search-verified: no product markets an "AI reliability engineer" for physical assets.** |

**Structural note on incumbent bundling (the most-cited risk):** platform vendors' agents are strategically *captive* — MaintainX will never build agents for Maximo customers, and vice versa, because their agents exist to lock in their platforms. Independence is not a feature we defend; it is a position they structurally cannot take. Our depth (S2, S3, S8) is the second wall: administrative AI does not become censored-Weibull engineering by adding a bigger model.

---

## 5. The strategy

### 5.1 Category creation: name the job, not the software

We create and own the category **"AI Reliability Specialist"**. Brand hierarchy (fixed 2026-07-25): **Relantern** is the parent company, **IRAMS** is the integrated system (EAM + Reliability suite — deployment Mode B below), and the **Reliability Specialist** is the hero product, sold under its own name. The category claim: *reliability engineering as an employable AI — works with the CMMS you have, supervised like a member of your team.*

Category mechanics:

- **Name the employee, not the module.** All messaging speaks of hiring, briefings, proposals, supervision, and a track record — never "features."
- **Anchor to the published methodology (S5).** PSC/SMEA papers, conference talks, and training give the category intellectual legitimacy the way RCM and TPM got theirs. The Specialist "practices PSC" — a discipline, not a prompt.
- **Own the search white space.** Nobody ranks for "AI reliability engineer / specialist" in the industrial sense. Content strategy targets it from day one; it is cheap to win an empty term and expensive to retake a claimed one.
- **Publish the governance model.** The market's loudest fear about agents is their own reliability and accountability. Our tier system + immutable audit + citations-required is the answer *by design* — publish it as "how to employ an AI safely in a plant," and let it become the category's reference standard.

### 5.2 Product architecture: one Specialist, two deployment modes

**The Specialist is a single product** (the dream's "purchasable as a single product") consisting of: the agent roster, the deterministic tool plane, the semantic contract, the governance frame, and one workspace. It deploys two ways:

- **Mode A — Specialist on your CMMS.** Customer data enters via (1) file import — the CMMS Analyst agent ingests any export (SAP PM, Maximo, MaintainX, eMaint, spreadsheets), maps it to `sem_*` shapes with a data-quality report, and stages it; later (2) live connectors (REST rails already exist). Outputs return as drafted work (write-back where the host CMMS API allows; clean export where it doesn't). The customer keeps their system; the Specialist is simply staffed onto it.
- **Mode B — the IRAMS Platform.** Full EAM with the Specialist embedded — for organizations with no real CMMS (spreadsheets), those who outgrow mobile-first tools, or Mode-A customers ready to consolidate. This is the expansion tier and the complete closed loop.

**The semantic layer is the hinge (S4):** both modes feed the same `sem_*` contract, so agents, reports, and the workspace are identical across modes. Every new import mapping is a reusable template, compounding coverage of the CMMS installed base.

**Packaging ruling — standalone commercially, one platform technically (decided 2026-07-25).** The Reliability Specialist is a standalone *product*: its own name, price, and front door, purchasable without ever seeing or configuring the EAM — the wedge fails the moment hiring the Specialist requires adopting IRAMS. But it is not a separate *system*: one codebase, one backend, with a per-tenant **edition flag** (`specialist` | `platform`) gating entitlements and navigation. "Standalone" is achieved by turning the EAM off, not by moving the Specialist out.

| | Specialist edition (Mode A) | Platform edition (Mode B) |
|---|---|---|
| Customer sees | Specialist workspace only: briefing, proposals queue, chat, value ledger, imports/connectors, assessment reports | Full IRAMS (EAM + Reliability suite) with the same Specialist embedded |
| Data source | CMMS export / live connector, loaded into the **same tables** | IRAMS's own transactions |
| Proposals sink | Export package, or the host CMMS API where it allows write-back | IRAMS work orders directly |
| EAM modules | Hidden by entitlement | On |

The agents never know the difference — they read `sem_*` either way. Three strategic consequences: (1) **upgrade is a switch, not a migration** — a Mode-A customer's imported history is already home, so Motion 3 (§5.4) works by architecture: the lowest-friction EAM migration they will ever be offered; (2) **one build serves both sales** — every agent, report, and workspace improvement ships to both editions simultaneously, which a separate standalone app would fork instantly (and capacity is risk R6); (3) **the assessment motion depends on it** — "send us your export" provisions a Specialist-edition tenant in minutes, which a full EAM implementation never could.

**Brand architecture:** **Relantern** (parent company) → **IRAMS** (the integrated system: EAM + Reliability suite = Mode B) → **Reliability Specialist** (the hero product — standalone in Mode A, embedded in Mode B). The marketing site has two doors; the software has one.

**The employment metaphor is product design, not marketing.** The Specialist needs what an employee has:

1. **An identity** — name, avatar, introduction ("I'm your Reliability Specialist. Send me your maintenance history and I'll get to work.").
2. **A desk** — one workspace: latest briefing, proposals awaiting review (already in `ers_agent_actions` with `pending_review` status), the conversation, and the work log. Today's seven scattered panels consolidate here.
3. **A work rhythm** — the scheduled Monday-morning briefing by email (pg_cron + the notification outbox rails, both already built). Proactivity is the single feature that flips perception from tool to colleague.
4. **Supervision** — the tier system surfaced in plain language: "Your Specialist may analyze freely and draft work for your approval. It never changes your plant data itself."
5. **A performance review** — the value ledger (§9): dollars found (warranty recovery, PM waste), proposals accepted, outcomes verified. The Specialist reports its own ROI, continuously.

### 5.3 Business model and pricing (hypotheses to validate at Gate 2)

Anchor: a loaded reliability engineer is $150k–220k/yr and unfillable. Price the Specialist as unmistakably a labor bargain while remaining far above software-seat psychology:

| Tier | Price (hypothesis) | What it is |
|---|---|---|
| **Reliability Assessment** | Free for qualified prospects (or $2.5k credited against year 1) | The assessment-led sale (§5.4): same-day report from their CMMS export. The demo *is* the deliverable. |
| **Specialist (Mode A)** | **$1,500–3,000 / site / month** | The Specialist employed on their CMMS: weekly briefings, full agent roster, RCA facilitation, proposals queue, value ledger. Reads as ~10–15% of the salary they cannot fill. |
| **Platform (Mode B)** | Per-user EAM pricing (market-normal $20–40/user/mo) **+ Specialist per site** | Full IRAMS with the Specialist embedded. The EAM is priced like the market expects; the Specialist premium is preserved — never given away as a feature. |

Rules: the Specialist is **never free and never per-seat** (labor is priced per employee-on-site, and unlimited human colleagues may talk to it). Warranty recovery gives the sale a self-funding story — the assessment routinely finds recoverable money before the first invoice. Gross margin is structurally ~90%+ (S9): inference is cents per run because the math is deterministic.

### 5.4 Go-to-market

**Motion 1 — the assessment-led sale (the core motion).**
"Send us your CMMS export — any system. Your Specialist reports back the same day." The report: top bad actors with Pareto split; Weibull fits on the worst offenders with B10 life and PM-interval recommendation; PM waste (over-maintenance / ineffective / redundant); recoverable warranty money in dollars; integrity red flags if thickness data exists; and a data-quality appendix (what your data cannot yet answer, and how to fix it — a real engineer's first-week memo, and the seed of the improvement roadmap we then sell against). Close: "This is what your Specialist found in one day. Keep it employed."
Why it wins: zero deployment friction, no rip-and-replace, ROI demonstrated on *their* data inside the 6-month-expectation window — and the sales cycle collapses because the proof precedes the contract.

**Beachhead: mid-market process / heavy industry** (oil & gas, chemicals, terminals, heavy manufacturing) — where the integrity moat (S8) is a statutory need, failure costs are visible, and the hiring gap is most acute. Start where existing credibility and networks already reach (the PSC paper's audience is exactly this community). One vertical until the motion converts repeatably.

**Motion 2 — enterprise layer (phase 2).** The Specialist on top of SAP PM / Maximo installed bases — Facilio has validated the appetite. Enter via the same assessment (an export costs the enterprise nothing to share), not via RFP. The semantic layer's Iceberg/open-catalog export (already strategized) becomes relevant here when a real prospect asks.

**Motion 3 — platform consolidation (pull, not push).** Mode-A customers who tire of their CMMS migrate to Mode B; their data is already in `sem_*` shapes, making IRAMS the lowest-friction migration they will ever be offered. The EAM sells itself as the Specialist's preferred habitat — we never lead with it.

**Channels:** founder-led direct sales off the assessment motion first. Content/SEO on the unclaimed category terms. Later: reliability consultancies as a channel (§7-O3), OEM/insurer partnerships (§7-O2).

### 5.5 Positioning and message house

**Headline:** *Hire your Reliability Specialist. Keep your CMMS.*
**Sub:** *The Reliability Specialist is an AI reliability engineer you employ, not software you implement. It reads the maintenance history you already have, finds what failure is costing you, and drafts the work to fix it — every number cited, every action approved by you. Runs on your CMMS today; comes with IRAMS, the full EAM platform, when you want one system.*

| Element | Content |
|---|---|
| For | Plant managers, maintenance managers, reliability managers at asset-intensive mid-market operations (beachhead: process industry) |
| Problem | You can't hire reliability engineering skill, so your CMMS history sits unread while failures repeat and PM waste compounds |
| Promise | A Specialist employed on your data in one day — findings in dollars, analyses that would survive a reliability review, work drafted for your approval |
| Proof | Deterministic engines (censored Weibull, RAM, RCM, API 510/570/653); every claim cited to your records; tiered governance with immutable audit; published PSC methodology; the assessment itself |
| Against | Incumbent "AI" that chats about your data but can't do engineering; sensor-first PdM that needs hardware you don't have; rip-and-replace platforms |

---

## 6. Execution roadmap — sequenced to revenue, not to features

Discipline rule carried over from the market-gap plan: **EAM investment only where it closes the Specialist's loop.** SAP-parity work is frozen except where a paying customer's deployment requires it.

### Phase 1 (weeks 1–4): make the assessment sellable
1. **CMMS Analyst import agent** (design doc §3, unbuilt — now P0): CSV/XLSX ingest → LLM-assisted schema mapping → data-quality report → staged load into `sem_*` shapes. Start with three mapping templates: SAP PM export, Maximo export, MaintainX CSV. Each new template is reusable coverage (S4).
2. **Assessment report generator:** orchestrates existing agents/tools (rank_bad_actors, Weibull fit, analyze_pm_effectiveness, scan_warranty_recovery, scan_corrosion_risk, DQ findings) into one branded, dollar-led document (web + PDF).
3. **Specialist workspace v1:** identity + desk — briefing, proposals queue (over existing `ers_agent_actions`), chat, work log. Consolidates the seven panels.
4. **Edition flag + entitlement-gated navigation:** per-tenant `specialist` | `platform` edition; Specialist-edition tenants land in the workspace with EAM modules hidden (§5.2 packaging ruling). A small build, but load-bearing — it is what makes the Specialist sellable standalone.
5. **Run 3–5 pilot assessments** on friendly/prospect data. Gate 1 sits here.

### Phase 2 (weeks 5–8): make it an employee
5. **Scheduled Monday briefing:** pg_cron → reliability_digest → notification outbox → email (all rails exist; this is wiring, not construction).
6. **Weibull Analyst agent:** wrap the existing censored-Weibull + Monte Carlo engines as tools with a PM-interval recommendation flow — the report's credibility centerpiece becomes interactive.
7. **Supervisor agent:** "work up asset X end-to-end" chaining existing agents — the moment it feels like an engineer, not six buttons.
8. **Value ledger v1:** running totals of dollars found / proposals accepted / outcomes verified, on the workspace and in the briefing.

### Phase 3 (months 3–6): make it employable anywhere
9. **Live connectors** beyond import: REST reads of MaintainX/Limble/Maximo where APIs allow (connector hub + sensor-sync rails exist); write-back of drafted WOs/PMs where possible, clean export packages where not.
10. **Manual Reader (RAG):** OEM manuals/SOPs into pgvector (tables exist since migration 0149) — the employee that reads *your* documentation and cites it.
11. **Multi-tenant hardening:** the deferred site-scoping RLS phase becomes mandatory before serving multiple customer organizations on one instance; per-tenant isolation is also the data-privacy selling point.
12. **Pricing/packaging validation** across the first ~10 paid sites. Gate 2 concludes here.

### Phase 4 (months 6–12): make it the category
13. PSC/SMEA productization as the flagship methodology (training, certification content, conference circuit).
14. Enterprise motion (SAP/Maximo installed base); Iceberg/open-catalog export on first qualified pull.
15. Benchmarking flywheel (§7-O1) once ≥10 tenants consent to anonymized aggregation.
16. Design-doc §10 agent expansion as pull dictates: Spares Optimizer, RBI Strategist, Compliance Gap Hunter, PdM Alert Triage.

---

## 7. Opportunities — the upside if it works

- **O1 — The benchmarking flywheel (the compounding moat).** Every assessment and tenant adds anonymized failure/cost/interval data. At modest scale the Specialist can say "your centrifugal-pump MTBF is in the bottom quartile for your industry" — cross-fleet context no single-plant tool or in-house engineer possesses. Data network effects arrive with consent + aggregation views; nothing in the architecture blocks it.
- **O2 — Warranty and insurance adjacency.** The warranty-recovery agent generalizes to OEM warranty analytics (a product OEMs and buyers both want); a verified reliability posture (value ledger + governance audit) is exactly what industrial insurers want to price against. Both are premium data products on the same substrate.
- **O3 — Consultancies as channel, not competitor.** Reliability consultants face the same labor shortage. A white-label / per-engagement Specialist makes every consultant a distributor and converts the most credible potential detractors into advocates.
- **O4 — Education and certification.** The skills gap that creates our market also creates demand for training. PSC courses with the Specialist as the teaching instrument monetize the methodology twice and deepen category ownership.
- **O5 — Geographic arbitrage.** The pitch is strongest where reliability engineers are scarcest — industrializing markets with growing asset bases and thin specialist labor pools. Cloud delivery makes these markets reachable without presence.
- **O6 — Strategic optionality (M&A).** Category ownership + a published methodology + an engineering layer that mobile-first CMMS vendors demonstrably lack (their own comparison pages admit it) makes IRAMS a natural acquisition for a MaintainX/Limble-class player the day agentic depth becomes their competitive necessity. Not the goal; a real backstop.

---

## 8. Risks — honest, ranked, with mitigations

| # | Risk | Likelihood / Impact | Mitigation |
|---|---|---|---|
| R1 | **Incumbents bundle "AI agents" free**, freezing buyer budgets ("our CMMS says it's adding that") | High / Medium | Structural independence (their agents are platform-captive — §4); depth gap measured in years of domain encoding, not model size; move fast on category naming so their bundles are judged against *our* definition; their AI is already gated behind premium tiers, blunting "free." |
| R2 | **Category education cost** — nobody searches for what doesn't exist yet | High / Medium | The assessment-led sale sells a report with dollar figures, not a concept — no education needed to say "we found $84k." SEO white space cuts both ways: cheap to own. PSC gives the category academic legitimacy. |
| R3 | **Garbage-in** — customer exports are incomplete, miscoded, or tiny | High / Medium | The data-quality report is deliverable #1, exactly like a human engineer's first-week memo; honest-uncertainty behavior is already engineered into every agent prompt ("state uncertainty, don't guess; if the tool returns nothing, say so"). Bad data becomes the improvement roadmap we sell against, not a refund. |
| R4 | **Trust barrier in safety-critical industries** ("an AI told us to change the PM?") | Medium / High | This is our strongest ground, counterintuitively: deterministic math (S2), citations to their own records, Tier-2 ceiling (a human approves every write), immutable audit. Publish the governance model (§5.1) and make "how we supervise the Specialist" the first sales slide, not the fine print. Never enable Tier 3 at this stage. |
| R5 | **Provider dependency (Gemini)** — pricing, deprecation, or quality shifts | Medium / Medium | Tools compute (S2), so the LLM layer is thin by design; the function-calling loop is ~one file; provider swap is days, not months. Keep prompts provider-neutral; revisit only on a material shift. |
| R6 | **Solo-founder capacity and bus factor** | High / High | One vertical, one motion, everything productized (the report generates itself; the import agent does the onboarding). Revenue funds the first hires; the strategy deliberately requires no capital raise to reach Gate 2 (S9). Document ruthlessly (this docs/ tree is the institutional memory). |
| R7 | **Import friction** — every CMMS export is different | Medium / Medium | LLM-assisted schema mapping is precisely what the CMMS Analyst was designed for; three templates cover the bulk of the installed base; every engagement's mapping becomes a reusable template (compounding asset, not recurring cost). |
| R8 | **Data privacy / security objections** to uploading maintenance history | Medium / Medium | Per-tenant isolation + RLS (hardened in Phase 3), clear data-processing terms, no training on customer data, delete-on-request. Position it: "your data stays yours; the Specialist works for *you*." For the assessment, offer redacted/sample exports as a soft entry. |
| R9 | **A funded copycat** enters the named category | Medium / High | Speed to the naming window; moats that don't copy quickly: the deterministic engine depth (S2), evidence-graded RCA (S3), published methodology (S5), integrity vertical (S8), and — once running — the benchmarking flywheel (O1) and value-ledger track records. Being second into a category someone else named is expensive; make them second. |
| R10 | **Advice fatigue** — customers stop reading briefings, proposals pile up unapproved, churn follows | Medium / High | The value ledger keeps ROI visible weekly; write-back (Phase 3) reduces friction from approval to execution; the Monday briefing leads with "act this week" (already the digest's design); track proposal-acceptance rate as a churn early-warning KPI (§9). |

**Pre-mortem summary:** if this fails, the most probable causes are (R6) spreading thin across motions, (R2+R10) selling the concept instead of the report and letting engagement decay, or (R9) moving too slowly through the naming window. All three are discipline failures, not market failures — which is the strongest argument that the strategy is sound: the market risk is already largely retired by others' data (65% adoption intent, Facilio's model proof, the admitted skills gap).

---

## 9. Measures of success

**North star: Specialists employed** (paying sites with an active subscription).

| Class | Metric | Early target (validate at gates) |
|---|---|---|
| Motion | Assessments delivered / month; export-to-report turnaround | 4+/mo by end of Phase 2; < 1 business day |
| Conversion | Assessment → paid Specialist | ≥ 30% |
| Value (per customer) | Value ledger: $ found (warranty + PM waste + avoided failures), proposals accepted, outcomes verified | Ledger ≥ 3× subscription within 6 months |
| Engagement (churn early-warning) | Briefing open rate; proposal acceptance rate; workspace WAU | Open ≥ 60%; acceptance ≥ 25% |
| Category | Ranking for "AI reliability specialist/engineer" (industrial intent); inbound assessment requests | #1 within 12 months; inbound > outbound by month 9 |

The value ledger is deliberately both a KPI and a product feature: the Specialist writes its own performance review, and that review is the renewal conversation.

---

## 10. Decision gates

- **Gate 1 (end Phase 1):** Can we turn a foreign CMMS export into a compelling, dollar-led assessment in under one day, 3 times out of 5 attempts? *If no:* diagnose whether the blocker is mapping (fix templates) or report substance (fix orchestration) before any further roadmap spend.
- **Gate 2 (first ~10 assessments):** Conversion ≥ 30% and at least 3 paying sites at ≥ $1,500/mo? *If conversion high but price resists:* test per-report pricing (productized service) as the wedge instead. *If prospects convert but demand Mode B:* the market is telling us to lead platform-first in this segment — follow it; the strategy's assets all survive that pivot.
- **Gate 3 (month 6):** Engagement holding (briefing opens, proposal acceptance) and ledger ≥ subscription? *If usage decays:* the employee experience is failing before the economics — prioritize write-back and briefing quality over any new agent.
- **Standing kill-criterion for the freeze:** any EAM-parity work request must name the paying customer or signed assessment that needs it, or it stays frozen.

---

## 11. Summary — the dream, aligned

The original dream was a Reliability Specialist AI that works like a real reliability engineer and can be employed by any organization, sold as a single product. The detour built its body: the engines, the governance, the data substrate, the action rail. This strategy gives it the rest — a name, a desk, a work rhythm, a salary-anchored price, and a hiring process that starts with one email: *"send us your CMMS export."*

The EAM was never the deviation. Leading with it was. From today, Relantern sells the engineer — standalone when the customer keeps their CMMS, inside IRAMS when they want one system.
