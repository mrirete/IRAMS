# Reliability AI Agents — Full Design

_Status: design (2026-06-19). Target: turn the existing scaffolding + single‑shot AI assists into a governed, tool‑calling multi‑agent system for reliability work._

## 1. Goals & principles

- **Agents orchestrate, tools compute.** The LLM never does reliability math. It decides *which* deterministic tool to call (Weibull fit, Monte Carlo, bad‑actor ranking, RCM logic) and how to interpret/communicate the result. This matches the existing rule in `reliability_analyst.py`: _"RCM task selection uses deterministic logic, not your judgment."_
- **Every claim is cited.** Answers reference specific work orders, failure records, analyses, or document chunks. _"Never guess — derive from data or state uncertainty."_
- **Human‑in‑the‑loop by tier.** Nothing that mutates plant data executes without the governance tier allowing it (see §6).
- **Build on what's real.** Reuse `geminiService` (LLM + server proxy), `monteCarloEngine`, `RCMService`, `bad_actor/analyzer.py`, `integrityCalcs`, and the `ers_agent_actions` / `ers_ai_audit_log` / `ers_rag_documents` tables. Don't reinvent.

## 2. Architecture — four planes

```
┌──────────────────────────────────────────────────────────────┐
│  UI plane    Relantern co‑pilot · per‑page "Ask" · agent panel │
├──────────────────────────────────────────────────────────────┤
│  Orchestration   Router (intent) → Agent(s) → Supervisor       │  ← server-side (edge fn / proxy)
│                  tool-calling loop, governance gate, audit log  │
├──────────────────────────────────────────────────────────────┤
│  Tool plane   deterministic functions (typed I/O, cited)        │
│   weibull_fit · monte_carlo · bad_actor_rank · rcm_decide ·     │
│   query_failure_history · rag_search · draft_pm · ...           │
├──────────────────────────────────────────────────────────────┤
│  Substrate   geminiService (function-calling, JSON schema),     │
│              Supabase (RLS), pgvector (RAG), audit tables       │
└──────────────────────────────────────────────────────────────┘
```

**Where orchestration runs:** server‑side (Supabase Edge Function or the existing `VITE_AI_PROXY_URL` backend), *not* the browser. Reasons: (1) the Gemini key stays server‑side (already the design intent in `geminiService`), (2) tools execute with a trusted role and the result is what gets audited, (3) the client can't forge tool outputs or skip the governance gate. The browser only sends the user's intent + context and renders streamed results.

## 3. The agent roster

Each agent = **system prompt + allowed toolset + max governance tier + output schema.** This is exactly the shape the `BaseAgent` stub already defines (`DOMAIN`, `KEYWORDS`, `SYSTEM_PROMPT`, `MAX_AUTONOMOUS_TIER`) — we make `execute()` real.

| Agent | Job | Key tools | Max tier | Status to build |
|---|---|---|---|---|
| **Bad Actor Hunter** | Rank assets by downtime/cost/frequency (Pareto), explain *why*, draft Defect‑Elimination tasks | `bad_actor_rank`, `query_wo_cost`, `pareto`, `draft_de_task` | 2 (suggest) | analyzer + UI exist → wrap |
| **RCA Challenger** | Adversarially critique a proposed root cause / 5‑Why / fishbone: evidence gaps, logical leaps, alternative hypotheses, verification tests | `get_rca`, `query_failure_history`, `rag_search` | 1 (advisory) | pure‑LLM, no new data |
| **Weibull Analyst** | Pull life data from WO history, run a real fit (median‑rank + censoring), interpret β/η, recommend PM interval, draft PM | `query_failure_history`, `weibull_fit`, `b_life`, `monte_carlo`, `draft_pm` | 2 | math exists → wrap |
| **Manual Reader (RAG)** | Ingest OEM manuals/SOPs/standards into pgvector; answer with citations; extract PM tasks, spares, intervals | `rag_ingest`, `rag_search`, `extract_pm`, `draft_pm` | 1 read / 2 extract | RAG scaffold exists |
| **CMMS Analyst (Digest)** | Ingest a raw CMMS export (CSV/XLSX), map to ERS schema, flag data‑quality issues, summarize, stage an import | `parse_file`, `map_schema`, `dq_check`, `stage_import` | 2 (proposes import) | new |
| **Supervisor** | Multi‑step jobs: "analyse asset X end‑to‑end" → Bad Actor → Weibull → RCA Challenger → PM draft | calls other agents as tools | inherits | new |

The existing broad domain agents (`predictive_maintenance`, `asset_integrity_auditor`, `compliance_safety`, …) remain as peers/supervisors; the five above are the reliability‑focused micro‑agents requested.

## 4. Tool contract

One uniform interface; Gemini function‑calling maps to it.

```ts
interface AgentTool<P, R> {
  name: string;                       // "weibull_fit"
  description: string;                // shown to the model
  parameters: JSONSchema;             // validated before run
  tier: GovernanceTier;               // tier this tool's effect requires
  run(params: P, ctx: AgentContext): Promise<ToolResult<R>>;
}
interface ToolResult<R> { data: R; sources: Source[]; warnings?: string[]; }
```

- **Read tools** (`query_failure_history`, `rag_search`, `bad_actor_rank`) → Tier 1, run freely, always return `sources`.
- **Compute tools** (`weibull_fit`, `monte_carlo`) → pure functions over data, deterministic, Tier 1.
- **Mutating/draft tools** (`draft_pm`, `stage_import`, `draft_de_task`) → produce a **proposal object**, never write directly; Tier 2+ and surfaced for human approval.

Tools wrap existing code: `weibull_fit`→ the Weibull regression in `ReliabilityToolkit`/engine; `monte_carlo`→ `monteCarloEngine.ts`; `bad_actor_rank`→ `bad_actor/analyzer.py`; `rcm_decide`→ `RCMService`; `rag_*`→ `engines/rag.py` + `ers_rag_documents`.

## 5. Orchestration loop

1. **Route** — `routing/router.py` picks an agent by keyword + (later) embedding similarity. Ambiguous/multi‑domain → Supervisor.
2. **Plan + call** — agent runs the Gemini function‑calling loop: model proposes a tool call → server validates params + tier → executes → feeds result back → repeat until the model emits a final structured answer.
3. **Gate** — before any Tier‑2+ effect, check `MAX_AUTONOMOUS_TIER`; if exceeded, mark `requires_human_approval` (the `BaseAgent._build_response` logic already does this).
4. **Audit** — write the full trace (query, tools, params, sources, tier, approval state) to `ers_agent_actions` + `ers_ai_audit_log`.
5. **Return** — structured `AgentResponse` (answer, confidence, sources, proposals, safety_flags) streamed to the UI; proposals render as review cards (reuse `AgentReviewPanel`).

## 6. Governance tiers

- **Tier 1 — Advisory/read.** Auto. Analysis, ranking, RCA critique, RAG answers. No data mutation.
- **Tier 2 — Suggest/draft.** Produces a proposal (PM, DE task, import, threshold) that a human approves before it writes. Default ceiling for the reliability agents.
- **Tier 3 — Act.** Reserved; not enabled at launch. Anything touching safety/permits stays Tier 3 + human.

Hard rules: citations required; "state uncertainty, don't guess"; safety **exclusion zones** enforced in RAG (`rag.py` already references this); every action logged immutably.

## 7. Reuse map (don't rebuild)

| Need | Existing asset |
|---|---|
| LLM access + key security | `eam/services/geminiService.ts` (+ `VITE_AI_PROXY_URL` proxy) |
| Frontend orchestration / "draft X" | `eam/services/AgentService.ts` (formalize into agents) |
| Agent base/router/schemas | `layer3-agents/` (make `execute()` real) |
| Reliability math | `monteCarloEngine.ts`, Weibull fit, `RCMService`, `integrityCalcs.ts` |
| Bad‑actor ranking | `layer2-modules/ers-analyze/bad_actor/analyzer.py` |
| RAG | `engines/rag.py` + `ers_rag_documents` (pgvector) |
| Audit/governance | `ers_agent_actions`, `ers_ai_audit_log` |
| Review UI | `components/predict/AgentReviewPanel.tsx`, `agent-panel/AgentPanel.tsx`, Relantern co‑pilot |

## 8. Build phases

- **Phase 0 — Plumbing.** Server‑side tool runner + governance gate + audit writes; the `AgentTool` interface; wire `geminiService` function‑calling. (Unblocks everything.)
- **Phase 1 — Flagship.** Ship **one** agent end‑to‑end. Recommended: **Bad Actor Hunter** (data + analyzer already exist, ranking is deterministic/defensible, high buyer "wow") or **RCA Challenger** (pure‑LLM, zero new data plumbing, demos beautifully).
- **Phase 2 — Weibull Analyst + Manual Reader (RAG).** Wrap the existing Weibull/MC math; stand up pgvector embeddings for manuals.
- **Phase 3 — CMMS Analyst (import) + Supervisor.** File ingest + multi‑agent "analyse this asset end‑to‑end."

## 9. Open decisions (need your call)

1. **Orchestration host** — Supabase Edge Function vs. the existing AI‑proxy backend. (Recommend: whichever already holds the Gemini key server‑side.)
2. **Flagship pick** — Bad Actor Hunter (data‑rich) vs. RCA Challenger (no plumbing). (Recommend: Bad Actor Hunter for the moat; RCA Challenger if you want a demo this week.)
3. **Provider** — staying on **Gemini** (Relantern), confirmed.
4. **Autonomy ceiling at launch** — confirm Tier 2 (draft + human approve) as the hard cap.

## 10. Extended agent catalog

Beyond the §3 core roster, these agents extend value across Integrity, Compliance/Audit,
PSM, Plan/Work, FinOps, Predict/Vision and cross‑cutting reporting. **The point of this
catalog: most are wrap‑and‑chain, not build‑from‑scratch** — they orchestrate compute that
already exists.

Legend: 🟢 = real compute already exists (low effort) · ⭐ = recommended early pick.
"Reuses" names the existing service/method/engine the agent's tools wrap.

### Integrity (API 510/570/653)
| Agent | Job | Reuses | Tier |
|---|---|---|---|
| ⭐🟢 **Corrosion / Integrity Sentinel** | Read thickness history → corrosion rate + remaining life; flag CMLs nearing t‑min or accelerating; recommend next inspection date (code half‑life); draft inspection WOs | `integrityCalcs.ts`, `IntegrityService` (getCorrosionRates / addThicknessReading / getCMLs / getInspections) | 2 |
| 🟢 **RBI Strategist** | Justify/challenge risk‑based inspection intervals from damage mechanism + corrosion + consequence (over‑ and under‑inspection) | `IntegrityService` (getRBIAssessments / getDamageMechanisms / getCorrosionRates) | 2 |
| 🟢 **FFS Advisor** | API 579 Level‑1 screening for thinning/flaws → repair / replace / escalate to FFS | `IntegrityService` (createFFSAssessment / getFFSAssessments) | 1/2 |

### Compliance & Audit
| Agent | Job | Reuses | Tier |
|---|---|---|---|
| ⭐🟢 **Compliance Gap Hunter** | Score maturity, prioritize findings by risk, draft CAPAs, map finding → corrective action → WO, track closure | `AuditService` (calculateMaturity / generateAIAnalysis / createFinding / createCorrectiveAction), `AgentService.auditDataCompliance` | 2 |
| 🟢 **Regulatory Watchdog** | Map assets → applicable codes; flag overdue inspections, expired certs, missing PSSR | `AgentService.checkCertificationExpiry`, `IntegrityService`, `PSMService` (PSSR) | 1/2 |

### Process Safety (PSM)
| Agent | Job | Reuses | Tier |
|---|---|---|---|
| 🟢 **HAZOP Facilitator + LOPA/SIL Verifier** | Suggest deviations (guideword × parameter), propose safeguards, draft LOPA scenarios, challenge IPL independence + SIL achieved‑vs‑required | `PSMService` (createHazopNode / createDeviation / createLOPAScenario / createSILAssessment) | 2 (safety‑critical → human) |

### Plan / Work / Inventory
| Agent | Job | Reuses | Tier |
|---|---|---|---|
| ⭐🟢 **PM Optimizer** | Find redundant/ineffective PMs (low find‑rate), over/under‑maintenance vs Weibull β, consolidate routes, estimate labor/cost saved | `RCMService.evaluatePMEffectiveness`, WO history, `weibull_fit` | 2 |
| 🟢 **Spares Optimizer** | Poisson demand + lead time + criticality → min/max/reorder; stockout risk for critical assets | Toolkit Poisson spares, `AgentService.preventStockout`, `FinOpsService.calculateInventoryWAC` | 2 |
| **Backlog Triage / Scheduler** | Rank WO backlog by criticality × risk × crew availability; flag overdue safety‑critical | `ers-work/engines`, scheduling data | 2 |

### FinOps
| Agent | Job | Reuses | Tier |
|---|---|---|---|
| ⭐🟢 **Warranty Recovery Agent** | Scan completed WOs against active warranties → auto‑draft recovery claims (direct $) | `FinOpsService.autoGenerateWarrantyClaimFromWO / checkWarrantyStatus` | 2 |
| 🟢 **Repair‑vs‑Replace / CAPEX Advisor** | Cost history + depreciation + lifecycle sim → repair/replace with payback | `monteCarloEngine.ts` (PM‑vs‑RTF), `FinOpsService.calculateDepreciation` | 1/2 |
| 🟢 **Budget Sentinel** | Proactive variance explanations | `FinOpsService.checkBudgetAvailability`, `AgentService.flagBudgetOverrun`, `KPICommentaryService` | 1 |

### Predict / Vision
| Agent | Job | Reuses | Tier |
|---|---|---|---|
| 🟢 **PdM Alert Triage** | Correlate sensor alerts with failure modes, draft corrective WOs, suppress false positives | `AgentService.draftWorkOrderFromAlert / proposeThresholdAdjustments`, `PredictionService` | 2 |
| 🟢 **Vision Inspector** | Grade corrosion/thermal/drone imagery → draft inspection finding/WO | `VisionService`, `AgentService.draftWorkOrderFromVisionFinding / draftWorkOrderFromInspectionFinding` | 2 |

### Cross‑cutting
| Agent | Job | Reuses | Tier |
|---|---|---|---|
| ⭐🟢 **Reliability & Integrity Digest (KPI Narrator)** | Recurring, cited executive report: emerging bad actors, overdue inspections, MTBF trends, budget variance. This is the "CMMS analyst digest" as a scheduled deliverable | `KPICommentaryService`, Bad Actor Hunter, Corrosion Sentinel outputs | 1 |
| 🟢 **People / Competency Agent** | Qualification expiry, skills‑gap vs upcoming work, training recommendations | `NotificationService.triggerQualificationExpiryNotifications`, `ers-people/engines` | 1/2 |
| **MOC Reviewer** | Assess a proposed change's reliability/integrity/safety impact; ensure PSSR before startup | `PSMService`, MOC data | 2 (safety → human) |
| 🟢 **Sustainability / ESG Agent** | Carbon metrics + climate‑risk exposure per asset | `ers-sustain/engines` | 1 |

### Recommended early picks (value × low‑effort, alongside the Bad Actor Hunter flagship)
1. **Warranty Recovery Agent** — method exists; tangible dollars; near‑zero build.
2. **Corrosion / Integrity Sentinel** — predictive + regulatory; real moat vs MaintainX.
3. **PM Optimizer** — the "cut maintenance cost" story buyers buy.
4. **Reliability & Integrity Digest** — the weekly artifact that makes the agent system *visible*.

These slot into the §8 phases as: Phase 1 (+ Warranty Recovery as a fast second), Phase 2 (+ Corrosion Sentinel, PM Optimizer), Phase 3 (+ Digest once the data‑producing agents exist to feed it).
