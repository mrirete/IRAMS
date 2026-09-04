# Maturity Framework Crosswalk: 6M → ISO 55001 / GFMAM

**Status:** IMPLEMENTED 2026-09-04 (decisions 7.1 A, 7.2 A, 7.3 A). Migration 0316 applied; the bank in
`MaturityQuestionBank.ts` is `gfmam-v1`; the module is the "Assess & Improve" sidebar section.
**Decision it serves:** the guided maturity assessment stops using the six Ishikawa
categories as its scoring dimensions and adopts the six GFMAM subject groups, which
are the CAMA syllabus and map one-to-one onto ISO 55001 clauses. The 6M taxonomy
stays where it belongs: the RCA fishbone in Analyze, and an optional cause tag on a
finding.

Migration 0316 already made the stored columns framework-neutral and stamps every
row with `maturity_framework` (`sixm-v1` today, `gfmam-v1` once this lands), so old
snapshots stay comparable with themselves and never blend with the new scale.

## 1. Why the grouping changes and the questions mostly do not

The 30 existing questions are good: each has five behaviourally distinct anchors and
a clause reference. What is wrong is the *grouping*. Ishikawa's categories answer
"why did this one thing fail"; a maturity assessment answers "how well is the
management system built". Regrouping keeps the anchors, keeps the six-tab UI, keeps
the scoring engine, and changes only the dimension key each question carries.

Framework anchors, in ISO 55002 terms, are unchanged:
1 Innocent · 2 Aware · 3 Developing · 4 Competent · 5 Optimizing.

## 2. The six groups

| Key | Group (GFMAM Landscape) | ISO 55001 clauses | Intake proxy (IntakeQuickAnalysis) | Say-do proxies available today |
|---|---|---|---|---|
| `strategy` | Strategy & Planning | 4, 5, 6.2 | governance | PM programme share |
| `decisions` | Asset Management Decision-Making | 6.1, 8.1 | financial | cost capture, downtime rate configured |
| `lifecycle` | Lifecycle Delivery | 8 | none | assignment discipline, preventive share |
| `information` | Asset Information | 7.5, 7.6 | data | failure-coding coverage, downtime capture |
| `people` | Organisation & People | 5.3, 7.1–7.4 | people | assignment coverage |
| `risk` | Risk & Review | 6.1, 8.2, 9, 10 | regulatory | none yet (compliance register is not a system object) |

The intake's five directional dimensions fold into the same keys, so intake, checklist,
gap card and agent context all read one vector. Lifecycle Delivery has no intake proxy
and will show as "unmeasured" on the gap card until the evidence bridge lands, which
is honest.

## 3. Crosswalk of the 30 existing questions

Legend: **keep** = move as-is; **merge** = fold into one question; **reword** = same
question, level-5 anchor rewritten (see §5).

| Current id | Question (short) | Current 6M | New group | Action |
|---|---|---|---|---|
| m1_q1 | Competency framework | Man | people | keep |
| m1_q2 | Competence verification, safety-critical tasks | Man | people | keep |
| m1_q3 | AM capability training | Man | people | keep |
| m1_q4 | Safety culture | Man | people | keep |
| m1_q5 | Succession planning | Man | people | keep |
| m2_q1 | Asset register completeness | Machine | information | keep |
| m2_q2 | Criticality ranking | Machine | decisions | keep |
| m2_q3 | Condition monitoring | Machine | risk | keep (GFMAM: asset performance & health monitoring); reword L5 |
| m2_q4 | Static equipment inspection / RBI | Machine | decisions | keep |
| m2_q5 | Mechanical integrity programme | Machine | lifecycle | keep |
| m3_q1 | Work management maturity | Method | lifecycle | keep; reword L5 |
| m3_q2 | Permit to work | Method | lifecycle | keep |
| m3_q3 | Management of change | Method | risk | keep (GFMAM lists MoC under Risk & Review) |
| m3_q4 | RCM / FMEA / PMO | Method | decisions | keep |
| m3_q5 | SOP management | Method | lifecycle | keep |
| m4_q1 | Critical spares identification | Material | decisions | keep (a stocking *decision*, not a store process) |
| m4_q2 | Inventory levels and reorder points | Material | lifecycle | keep; reword L5 |
| m4_q3 | Preservation of stored equipment | Material | lifecycle | keep |
| m4_q4 | Vendor performance | Material | lifecycle | **merge** with m4_q5 → L8 "Supplier & contract management" |
| m4_q5 | Contracted vs spot procurement | Material | lifecycle | **merge** into L8 |
| m5_q1 | KPIs tracked | Measurement | information | keep |
| m5_q2 | MTBF / MTTR / OEE | Measurement | information | keep; reword L5 |
| m5_q3 | CMMS data quality | Measurement | information | keep |
| m5_q4 | Benchmarking | Measurement | risk | **merge** into R6 "Management review, audit & assurance" |
| m5_q5 | Data analytics use | Measurement | information | keep; reword L5 |
| m6_q1 | Environmental risk assessment | Mother Nature | risk | keep |
| m6_q2 | Regulatory compliance obligations | Mother Nature | risk | keep |
| m6_q3 | Climate-related risk | Mother Nature | risk | keep |
| m6_q4 | Corrosion management | Mother Nature | lifecycle | keep |
| m6_q5 | Sustainability in lifecycle decisions | Mother Nature | strategy | keep |

Result: 27 questions survive unchanged, 3 merge into 2, and 8 new questions fill
the holes (§4). Group sizes are deliberately unequal; each group scores as its own
mean, so counts do not need to match.

| Group | Questions | Of which new |
|---|---|---|
| Strategy & Planning | 5 | 4 |
| Decision-Making | 6 | 2 |
| Lifecycle Delivery | 8 | 0 (one merged) |
| Asset Information | 6 | 1 |
| Organisation & People | 5 | 0 |
| Risk & Review | 6 | 1 (one merged) |
| **Total** | **36** | **8** |

## 4. New questions (draft anchors for review)

Conventions: level 5 describes an *embedded, measured, continually improved* practice,
benchmarked externally. Technology is named only as an illustration, never as the
criterion. Each anchor is meant to be recognisable by the person answering, in their
own words.

### S1 · Asset management policy (`strategy`) — ISO 55001 §5.2
**Is there a written asset management policy, signed off by top management, that people actually use when they make decisions about assets?**
1. No asset management policy exists; maintenance and capital decisions follow local custom.
2. A policy statement exists on paper but is not signed off by top management and is not referenced in decisions.
3. An authorised policy exists and is communicated, but its principles are applied inconsistently across sites or functions.
4. The policy is authorised, communicated, reviewed on a cycle, and decisions can be traced to its principles.
5. The policy is a living instrument: reviewed against performance and stakeholder feedback, cascaded into objectives and plans, and its application is audited.

### S2 · Strategic asset management plan (`strategy`) — ISO 55001 §6.2.1
**Is there a long-range plan for the asset base (a SAMP) that shows how what you do to assets serves what the business is trying to achieve?**
1. No SAMP; asset plans are annual budgets with no stated link to business objectives.
2. Strategic intent is understood informally by a few leaders but not documented as a SAMP.
3. A SAMP exists for the main asset portfolio, but the line of sight from objectives to individual asset plans is incomplete or out of date.
4. The SAMP is current, covers the portfolio, and every asset management plan can show which organisational objective it serves.
5. The SAMP is reviewed against results each cycle; scenario and demand analysis feed it, and plans are re-prioritised when objectives change.

### S3 · Asset management objectives and plans (`strategy`) — ISO 55001 §6.2.2
**Are there specific, measurable targets for asset performance, each with a plan, a named owner, and a budget behind it?**
1. No asset management objectives beyond "keep it running"; no plans beyond the maintenance schedule.
2. Objectives exist as slogans (for example "world-class reliability") with no measures or owners.
3. Measurable objectives exist for some areas; plans are written but not resourced or tracked to completion.
4. Objectives are specific and measurable, plans are resourced with named owners, and progress is reviewed on a cycle.
5. Objectives and plans are integrated with the business planning cycle, trade-offs between cost, risk and performance are explicit, and results feed the next cycle.

### S4 · Demand and capacity planning (`strategy`) — ISO 55001 §6.2, §8.1
**How do you work out what your assets will need to deliver in the coming years, and plan capacity, replacements and investment to match?**
1. No demand forecasting; capacity problems are discovered when production or service is constrained.
2. Demand is discussed at budget time but no method or horizon is defined.
3. Demand forecasts exist for major assets over a short horizon; renewal and capacity plans are not linked to them.
4. A defined method forecasts demand over a stated horizon; capacity, renewal and investment plans are built from it and revisited annually.
5. Demand scenarios are modelled, asset capacity and condition are held against them, and investment timing is optimised on whole-life cost and risk.

### D5 · Investment and replace-or-repair decisions (`decisions`) — ISO 55001 §6.1, §8.1; ISO 55010
**When money is spent on buying, replacing or overhauling an asset, how is that decision made, and does it consider the full cost over the asset's life?**
1. Investment decisions are reactive: assets are replaced when they fail or when a champion argues loudly enough.
2. Decisions are made on purchase price and urgency; whole-life cost is not considered.
3. A defined business-case template exists for large projects; smaller renewals and repair-versus-replace decisions are still judgement calls.
4. All investment and renewal decisions use whole-life cost, risk and performance criteria, and options are compared consistently.
5. A portfolio-level decision framework ranks investments on value and risk across the asset base; post-investment reviews check the outcomes and refine the criteria.

### D6 · Shutdown and outage decisions (`decisions`) — ISO 55001 §8.1
**How do you decide when to take plant down for a shutdown or outage, and what work gets included?**
1. Shutdowns happen when failures force them; scope is assembled at the last minute.
2. A shutdown calendar exists, but scope is a wish list with no risk or value ranking.
3. Scope is challenged for major shutdowns using a defined process; timing is fixed by tradition rather than by condition or risk.
4. Scope and timing are set by risk and condition data; a scope-challenge process removes low-value work and is documented.
5. Shutdown strategy is optimised across the site or portfolio on production impact, risk and whole-life cost, and post-shutdown reviews feed the next cycle.

### I6 · Asset information standards (`information`) — ISO 55001 §7.5, §7.6; ISO 55013; ISO 14224
**Has someone defined which asset data must be kept, in what format (for example tagging and failure codes), and who is responsible for keeping it right?**
1. No definition of required asset information; each system and person keeps what suits them.
2. Some information requirements are implied by the CMMS fields, but nobody owns the standards.
3. Information standards exist for parts of the base (for example a tagging convention or a failure-coding standard) but are not governed or audited.
4. An asset information strategy defines required information, standards (including failure and maintenance coding) and named owners; compliance is checked.
5. Information requirements are derived from decision needs, quality is measured and reported, and standards are improved as decisions change.

### R6 · Leadership review and audit (`risk`) — ISO 55001 §9.2, §9.3; absorbs m5_q4 benchmarking
**How often does leadership formally review how the assets are being managed, and is that way of working itself checked by audit and compared with other companies?**
1. No management review of asset management; performance is discussed only when something fails.
2. Performance is reported to leadership occasionally, with no defined agenda, decisions or follow-up.
3. A periodic management review exists with a defined agenda; internal audit of the asset management system is informal and comparison with peers is occasional.
4. Management review runs on a cycle with recorded decisions and actions; the asset management system is audited on a programme; performance is benchmarked against industry data.
5. Review, audit and benchmarking findings drive improvement plans that are tracked to closure; assurance covers contractors and outsourced activities, and the programme is risk-weighted.

### L8 · Suppliers and contracts (`lifecycle`) — merges m4_q4 and m4_q5; ISO 55001 §8.1, §8.3
**How do you choose and manage suppliers and contractors, and how much of your spend is under a contract rather than bought on the day?**
1. Suppliers are chosen on price or availability; almost all materials and services are spot-purchased; no performance feedback.
2. Some frame contracts exist for consumables; supplier performance is discussed informally.
3. Major categories and services are under contract; performance is tracked for the largest contracts but rarely acted on; a large share of spend is still unplanned.
4. Structured category management with scorecards, regular reviews and improvement expectations; unplanned spend is a small and measured share.
5. Strategic supplier relationships with shared performance data, risk-based contract controls for outsourced asset management activities, and continual reduction of reactive spend.

## 5. Level-5 anchors to reword (technology named as the criterion)

An assessor will challenge anchors where the top level is defined by owning a tool.
Maturity in ISO 55002 is a property of the practice, not the software. Proposed
principle: level 5 = embedded, measured, improved, externally benchmarked; a tool
may be mentioned as an example after "for example".

| Question | Current L5 phrase | Proposed L5 |
|---|---|---|
| m2_q3 condition monitoring | "predictive analytics, machine learning, and automated diagnostics" | Continuous or online monitoring on critical assets, alarms with defined responses, diagnostic accuracy measured and improved, results feeding strategy reviews. |
| m3_q1 work management | "AI-assisted planning" | Work management KPIs (planning quality, schedule compliance, rework) are measured, reviewed and improved; process changes are controlled. |
| m4_q2 inventory levels | "AI-driven demand forecasting with automated purchasing" | Stocking parameters are recalculated from consumption, lead time and criticality on a cycle; stock-outs and excess are measured and reduced. |
| m5_q2 reliability metrics | "Automated reliability analytics with Weibull analysis" | Reliability metrics are computed to a defined standard, trended, and used to change maintenance strategy; bad actors are eliminated on a programme. |
| m5_q5 analytics | "AI/ML-powered analytics platform ... digital twins" | Analysis is embedded in decisions: failure patterns and cost drivers are reviewed on a cycle, actions are tracked, and the value of analysis is measured. |
| m6_q4 corrosion | "real-time sensors, predictive analytics" | Corrosion rates are measured and modelled, inspection intervals derive from them, and material selection and control decisions are reviewed against results. |
| m1_q1 competency | "automated tracking" | Competence requirements derive from the SAMP, are assessed on a cycle, and gaps drive development plans; contractor competence is included. |
| m1_q5 succession | "readiness dashboards" | Successors are identified for all key roles, readiness is reviewed on a cycle, and cross-training rotations are planned. |

## 6. What changes in code when this is approved

1. `SixMQuestionBank.ts` becomes `MaturityQuestionBank.ts`: `dimensionKey` per §3, 8 new questions per §4, 2 merges, anchors per §5. Question ids are kept for the surviving 27 so old answers remain readable.
2. `SIXM_DIMENSIONS` / `SIXM_EXPLAINERS` become `MATURITY_DIMENSIONS` with the six GFMAM groups; the tab UI is unchanged.
3. `MATURITY_FRAMEWORK` becomes `'gfmam-v1'`. Snapshots, org context and assessment rows written after that carry the new stamp; trend and "previous run" already filter on it (0316).
4. `IntakeQuickAnalysis` dimension keys map to the same six groups (governance → strategy, financial → decisions, regulatory → risk, people → people, data → information).
5. `sayDoGap` proxies are re-keyed to the six groups; Lifecycle Delivery reports unmeasured until an evidence proxy exists.
6. `sixmScoring.ts` is renamed `maturityScoring.ts`; the finding drafter's dimension → category map follows the new groups.
7. Copy sweep: "6M" disappears from the assessment surfaces; "6M root cause" stays on the finding as an optional cause tag shared with the RCA fishbone.
8. `DIMENSION_CATEGORY` for findings: strategy → Governance & Strategy; decisions → Financial Alignment; lifecycle → Maintenance & Reliability; information → Data & Competence; people → People & Culture; risk → Regulatory & Policy.

## 7. Three decisions needed before this is coded

Each one is a yes/no with a recommendation. Reply with the number and A or B.

**7.1 Should every group have the same number of questions?**
Today the plan gives Lifecycle Delivery 8 questions and Strategy & Planning 5. Because
each group is scored as its own average, unequal counts do not distort the overall score.
The only effect is on the person answering: the Lifecycle tab takes longer.
- **A (recommended):** keep unequal counts, 5 to 8 per group, 36 questions in total.
- **B:** trim Lifecycle Delivery to 6 by merging "SOP management" into "Work management"
  and "Preservation of stored equipment" into "Inventory levels", giving 34 in total.

**7.2 Can a question be answered "does not apply to us"?**
Two questions do not fit every industry: climate-related risk (a small manufacturer may
reasonably have nothing here) and shutdown/outage decision-making (continuous process
plants have turnarounds, a water utility may not). Today every question must be given a
level 1 to 5, so those organisations are marked down for something irrelevant.
- **A (recommended):** add a "Not applicable" option on those two questions only. A
  not-applicable answer is left out of the group average and is shown as such on the
  report, so the score is not lowered and the gap is not hidden.
- **B:** keep every question mandatory, and accept that some industries score low on
  those two.

**7.3 When the evidence-based "Audit" mode is built later, which question set should it use?**
This does not affect the current release. It affects what we name things now.
- **A (recommended):** the same 36 questions, but each answer must carry evidence (a
  document link, a record in the system, or a photo) before it counts. One bank, two
  levels of rigour; the maturity trend stays comparable between self-assessment and audit.
- **B:** the separate ISO 55001 clause bank (25 questions, already written in
  `audit-templates/iso55001.ts`) becomes the audit's question set. Two banks, two scales;
  the audit reads as a true clause-by-clause conformity check, but its score cannot be
  trended against the self-assessment.
