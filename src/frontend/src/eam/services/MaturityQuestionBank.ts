/**
 * MaturityQuestionBank.ts — Guided maturity assessment, ISO 55001 / GFMAM grouping
 *
 * 36 questions in six groups, each with five anchored answers mapped to a
 * maturity level (1 Innocent → 5 Optimizing). The person answering clicks the
 * anchor that best describes their organisation; a few questions may also be
 * marked "not applicable" (excluded from the group mean, shown on the report).
 *
 * The six groups are the GFMAM Asset Management Landscape subject groups —
 * the CAMA syllabus — and map one-to-one onto ISO 55001 clauses. They replaced
 * the Ishikawa "6M" grouping on 2026-09-04 (docs/Maturity-Framework-Crosswalk.md):
 * 6M is a cause taxonomy for one failure event (Analyze › RCA fishbone), not a
 * framework for the maturity of a management system. The 27 questions that
 * survived the crosswalk keep their original ids so earlier answers still score.
 *
 * Framework id for stored rows: maturityScoring.MATURITY_FRAMEWORK ('gfmam-v1').
 */

// ─── Types ─────────────────────────────────────────────────────────

export type MaturityDimensionKey = 'strategy' | 'decisions' | 'lifecycle' | 'information' | 'people' | 'risk';

export interface MaturityQuestionOption {
    score: number;  // 1-5 maturity
    text: string;   // Descriptive anchor
}

export interface MaturityQuestion {
    id: string;
    dimensionKey: MaturityDimensionKey;
    text: string;
    isoRef: string;
    options: MaturityQuestionOption[];
    /** May be answered "does not apply to us" (decision 7.2): excluded from the mean, reported as such. */
    allowNotApplicable?: boolean;
}

export interface MaturityAnswer {
    questionId: string;
    /** Stored for readability; scoring re-derives the group from the bank so regrouped banks still score old answers. */
    dimensionKey: string;
    /** null when the question was marked not applicable. */
    selectedScore: number | null;
    optionText: string;
    notApplicable?: boolean;
    notes?: string;
}

export interface MaturityDimension {
    key: MaturityDimensionKey;
    code: string;
    label: string;
    icon: string;
    color: string;
    gradient: string;
    /** One plain sentence for the tab header. */
    meaning: string;
    /** ISO 55001 clauses the group scores against. */
    clauses: string;
    /** What the group covers — used by the report and the assessor prompt. */
    covers: string;
    standards: string[];
}

// ─── Dimensions (GFMAM subject groups) ─────────────────────────────

export const MATURITY_DIMENSIONS: MaturityDimension[] = [
    {
        key: 'strategy', code: 'G1', label: 'Strategy & Planning', icon: 'Compass',
        color: '#8b5cf6', gradient: 'from-violet-500 to-violet-600',
        meaning: 'Is there a policy, a long-range plan and measurable objectives that connect what the business wants to what happens to its assets?',
        clauses: 'ISO 55001 §4–§6',
        covers: 'Asset management policy, strategic asset management plan (SAMP), objectives and plans, demand and capacity planning, sustainability in lifecycle decisions',
        standards: ['ISO 55001 §5.2', 'ISO 55001 §6.2', 'ISO 55002', 'GFMAM Landscape group 1'],
    },
    {
        key: 'decisions', code: 'G2', label: 'Decision-Making', icon: 'Scale',
        color: '#b45309', gradient: 'from-amber-600 to-amber-700',
        meaning: 'How are criticality, maintenance strategy, spares, investment and shutdown decisions made, and on what evidence?',
        clauses: 'ISO 55001 §6.1, §8.1; ISO 55010',
        covers: 'Criticality ranking, RCM/FMEA/PMO, risk-based inspection, critical spares strategy, capital investment and whole-life cost, shutdown and outage decisions',
        standards: ['ISO 55001 §6.1', 'ISO 55010', 'SAE JA1011', 'API 580/581', 'GFMAM Landscape group 2'],
    },
    {
        key: 'lifecycle', code: 'G3', label: 'Lifecycle Delivery', icon: 'Wrench',
        color: '#22c55e', gradient: 'from-green-500 to-green-600',
        meaning: 'How well is the day-to-day work done: work management, permits, procedures, integrity, corrosion, stores, preservation and suppliers?',
        clauses: 'ISO 55001 §8',
        covers: 'Work management, permit to work, SOPs, mechanical integrity, corrosion management, inventory levels, preservation, suppliers and contracts',
        standards: ['ISO 55001 §8.1', 'ISO 55001 §8.3', 'API 510/570/653', 'API 686', 'NORSOK Z-CR-002', 'GFMAM Landscape group 3'],
    },
    {
        key: 'information', code: 'G4', label: 'Asset Information', icon: 'Database',
        color: '#3b82f6', gradient: 'from-blue-500 to-blue-600',
        meaning: 'Is the asset data complete, governed and trusted, and turned into measures and analysis that people act on?',
        clauses: 'ISO 55001 §7.5–§7.6; ISO 55013',
        covers: 'Asset register, information standards and ownership, CMMS data quality, KPIs, reliability metrics, analytics',
        standards: ['ISO 55013', 'ISO 14224', 'ISO 55001 §7.5', 'ISO 55001 §9.1', 'EN 15341', 'GFMAM Landscape group 4'],
    },
    {
        key: 'people', code: 'G5', label: 'Organisation & People', icon: 'Users',
        color: '#0ea5e9', gradient: 'from-sky-500 to-sky-600',
        meaning: 'Do you have the right people, with verified competence, a safety culture and a plan for who comes next?',
        clauses: 'ISO 55001 §5.3, §7.1–§7.4; ISO 55012',
        covers: 'Competency framework, competence verification, training, safety culture, succession',
        standards: ['ISO 55012', 'ISO 55001 §7.2', 'ISO 45001', 'OSHA PSM §1910.119(g)', 'GFMAM Landscape group 5'],
    },
    {
        key: 'risk', code: 'G6', label: 'Risk & Review', icon: 'ShieldAlert',
        color: '#ef4444', gradient: 'from-red-500 to-rose-600',
        meaning: 'Are risks to assets and from assets — safety, environment, climate, compliance, change — managed, monitored and reviewed by leadership?',
        clauses: 'ISO 55001 §6.1, §8.2, §9–§10; ISO 55011',
        covers: 'Management of change, asset health monitoring, environmental risk, compliance obligations, climate risk, management review and audit',
        standards: ['ISO 55001 §8.2', 'ISO 55001 §9.2–§9.3', 'ISO 55011', 'ISO 14001', 'ISO 31000', 'GFMAM Landscape group 6'],
    },
];

export const MATURITY_DIMENSION_KEYS: MaturityDimensionKey[] = MATURITY_DIMENSIONS.map(d => d.key);

// ─── Question Bank ─────────────────────────────────────────────────
// Level-5 anchors describe an embedded, measured, continually improved and
// externally benchmarked practice. Tools are illustrations, never the criterion.

export const MATURITY_QUESTIONS: MaturityQuestion[] = [
    // ═══ G1: STRATEGY & PLANNING ═══
    { id: 's1_policy', dimensionKey: 'strategy', isoRef: 'ISO 55001 §5.2',
      text: 'Is there a written asset management policy, signed off by top management, that people actually use when they make decisions about assets?',
      options: [
        { score: 1, text: 'No asset management policy exists; maintenance and capital decisions follow local custom' },
        { score: 2, text: 'A policy statement exists on paper but is not signed off by top management and is not referenced in decisions' },
        { score: 3, text: 'An authorised policy exists and is communicated, but its principles are applied inconsistently across sites or functions' },
        { score: 4, text: 'The policy is authorised, communicated, reviewed on a cycle, and decisions can be traced to its principles' },
        { score: 5, text: 'The policy is a living instrument: reviewed against performance and stakeholder feedback, cascaded into objectives and plans, and its application is audited' },
      ],
    },
    { id: 's2_samp', dimensionKey: 'strategy', isoRef: 'ISO 55001 §6.2.1',
      text: 'Is there a long-range plan for the asset base (a SAMP) that shows how what you do to assets serves what the business is trying to achieve?',
      options: [
        { score: 1, text: 'No SAMP; asset plans are annual budgets with no stated link to business objectives' },
        { score: 2, text: 'Strategic intent is understood informally by a few leaders but not documented as a SAMP' },
        { score: 3, text: 'A SAMP exists for the main asset portfolio, but the line of sight from objectives to individual asset plans is incomplete or out of date' },
        { score: 4, text: 'The SAMP is current, covers the portfolio, and every asset management plan can show which organisational objective it serves' },
        { score: 5, text: 'The SAMP is reviewed against results each cycle; scenario and demand analysis feed it, and plans are re-prioritised when objectives change' },
      ],
    },
    { id: 's3_objectives', dimensionKey: 'strategy', isoRef: 'ISO 55001 §6.2.2',
      text: 'Are there specific, measurable targets for asset performance, each with a plan, a named owner, and a budget behind it?',
      options: [
        { score: 1, text: 'No asset management objectives beyond "keep it running"; no plans beyond the maintenance schedule' },
        { score: 2, text: 'Objectives exist as slogans (for example "world-class reliability") with no measures or owners' },
        { score: 3, text: 'Measurable objectives exist for some areas; plans are written but not resourced or tracked to completion' },
        { score: 4, text: 'Objectives are specific and measurable, plans are resourced with named owners, and progress is reviewed on a cycle' },
        { score: 5, text: 'Objectives and plans are integrated with the business planning cycle, trade-offs between cost, risk and performance are explicit, and results feed the next cycle' },
      ],
    },
    { id: 's4_demand', dimensionKey: 'strategy', isoRef: 'ISO 55001 §6.2 · §8.1',
      text: 'How do you work out what your assets will need to deliver in the coming years, and plan capacity, replacements and investment to match?',
      options: [
        { score: 1, text: 'No demand forecasting; capacity problems are discovered when production or service is constrained' },
        { score: 2, text: 'Demand is discussed at budget time but no method or horizon is defined' },
        { score: 3, text: 'Demand forecasts exist for major assets over a short horizon; renewal and capacity plans are not linked to them' },
        { score: 4, text: 'A defined method forecasts demand over a stated horizon; capacity, renewal and investment plans are built from it and revisited annually' },
        { score: 5, text: 'Demand scenarios are modelled, asset capacity and condition are held against them, and investment timing is optimised on whole-life cost and risk' },
      ],
    },
    { id: 'm6_q5', dimensionKey: 'strategy', isoRef: 'ISO 14001 · ISO 55001 §4.1',
      text: 'Does your organization have sustainability targets integrated into asset lifecycle decisions?',
      options: [
        { score: 1, text: 'No sustainability targets — environmental performance is not a factor in asset decisions' },
        { score: 2, text: 'Corporate sustainability goals exist but are not connected to asset management or maintenance decisions' },
        { score: 3, text: 'Some asset decisions consider sustainability (e.g., energy efficiency) but not systematically' },
        { score: 4, text: 'Sustainability targets formally integrated into asset lifecycle decisions, CAPEX prioritization, and reporting' },
        { score: 5, text: 'Net-zero pathways with asset-level carbon tracking, circular economy principles, and ESG-aligned investment' },
      ],
    },

    // ═══ G2: DECISION-MAKING ═══
    { id: 'm2_q2', dimensionKey: 'decisions', isoRef: 'API 580/581 · ASME PCC-3',
      text: 'Do you have a formal criticality ranking system applied to your assets?',
      options: [
        { score: 1, text: 'No criticality ranking — all assets treated equally regardless of risk or business impact' },
        { score: 2, text: 'Informal criticality awareness — operations "know" which assets are important but it is not documented' },
        { score: 3, text: 'Criticality assessment completed for major equipment but not consistently driving maintenance strategy' },
        { score: 4, text: 'Systematic criticality framework (e.g., consequence × likelihood) applied and linked to strategy selection' },
        { score: 5, text: 'Dynamic, risk-based criticality with automated recalculation, integrated with RBI, RCM, and spares strategy' },
      ],
    },
    { id: 'm3_q4', dimensionKey: 'decisions', isoRef: 'SAE JA1011 · IEC 61882',
      text: 'What maintenance strategy optimization tools do you use (RCM, FMEA, PMO)?',
      options: [
        { score: 1, text: 'No strategy tools — maintenance tasks are based on OEM recommendations or tradition' },
        { score: 2, text: 'Some awareness of RCM/FMEA but no formal studies have been conducted' },
        { score: 3, text: 'FMEA or RCM applied to a few critical systems but results not fully implemented in the CMMS' },
        { score: 4, text: 'Systematic RCM/FMEA program for critical assets with results driving PM task optimization' },
        { score: 5, text: 'Living RCM program with continuous review, bad-actor elimination, and data-driven task optimization' },
      ],
    },
    { id: 'm2_q4', dimensionKey: 'decisions', isoRef: 'API 510/570/653 · API 580/581',
      text: 'How do you manage inspection programs for static equipment (vessels, piping, tanks)?',
      options: [
        { score: 1, text: 'No formal inspection program — inspections only happen after failures or regulatory notices' },
        { score: 2, text: 'Time-based inspections at fixed intervals with basic visual methods only' },
        { score: 3, text: 'Inspection plans exist for major equipment with NDT methods, but no risk-based prioritization' },
        { score: 4, text: 'Risk-Based Inspection (RBI) program implemented with documented corrosion rates and risk rankings' },
        { score: 5, text: 'Fully quantitative RBI with real-time corrosion monitoring, digital inspection records, and fitness-for-service' },
      ],
    },
    { id: 'm4_q1', dimensionKey: 'decisions', isoRef: 'ISO 55001 §8.1 · API 686',
      text: 'How do you identify and manage critical spare parts?',
      options: [
        { score: 1, text: 'No critical spares identification — parts are ordered reactively when equipment fails' },
        { score: 2, text: 'Some critical spares identified informally but no systematic stock policy or lead-time analysis' },
        { score: 3, text: 'Critical spares list exists with min/max levels, but coverage is incomplete and rarely reviewed' },
        { score: 4, text: 'Systematic critical spares analysis linked to asset criticality with documented stocking policies' },
        { score: 5, text: 'Optimized spares strategy using reliability data, obsolescence management, and vendor-managed inventory' },
      ],
    },
    { id: 'd5_investment', dimensionKey: 'decisions', isoRef: 'ISO 55001 §6.1 · §8.1 · ISO 55010',
      text: 'When money is spent on buying, replacing or overhauling an asset, how is that decision made, and does it consider the full cost over the asset\'s life?',
      options: [
        { score: 1, text: 'Investment decisions are reactive: assets are replaced when they fail or when a champion argues loudly enough' },
        { score: 2, text: 'Decisions are made on purchase price and urgency; whole-life cost is not considered' },
        { score: 3, text: 'A defined business-case template exists for large projects; smaller renewals and repair-versus-replace decisions are still judgement calls' },
        { score: 4, text: 'All investment and renewal decisions use whole-life cost, risk and performance criteria, and options are compared consistently' },
        { score: 5, text: 'A portfolio-level decision framework ranks investments on value and risk across the asset base; post-investment reviews check the outcomes and refine the criteria' },
      ],
    },
    { id: 'd6_shutdown', dimensionKey: 'decisions', isoRef: 'ISO 55001 §8.1', allowNotApplicable: true,
      text: 'How do you decide when to take plant down for a shutdown or outage, and what work gets included?',
      options: [
        { score: 1, text: 'Shutdowns happen when failures force them; scope is assembled at the last minute' },
        { score: 2, text: 'A shutdown calendar exists, but scope is a wish list with no risk or value ranking' },
        { score: 3, text: 'Scope is challenged for major shutdowns using a defined process; timing is fixed by tradition rather than by condition or risk' },
        { score: 4, text: 'Scope and timing are set by risk and condition data; a scope-challenge process removes low-value work and is documented' },
        { score: 5, text: 'Shutdown strategy is optimised across the site or portfolio on production impact, risk and whole-life cost, and post-shutdown reviews feed the next cycle' },
      ],
    },

    // ═══ G3: LIFECYCLE DELIVERY ═══
    { id: 'm3_q1', dimensionKey: 'lifecycle', isoRef: 'ISO 55001 §8.1',
      text: 'How mature is your work management process from identification through to closeout?',
      options: [
        { score: 1, text: 'No formal work management — maintenance is verbal requests and reactive responses' },
        { score: 2, text: 'Work orders exist but are often bypassed; no formal planning, scheduling, or closeout process' },
        { score: 3, text: 'Defined workflow (request → plan → schedule → execute → close) but inconsistently followed' },
        { score: 4, text: 'Disciplined work management with planning, scheduling, resource allocation, and feedback loops' },
        { score: 5, text: 'Work management KPIs (planning quality, schedule compliance, rework) are measured, reviewed and improved; process changes are controlled' },
      ],
    },
    { id: 'm3_q2', dimensionKey: 'lifecycle', isoRef: 'Process Safety · ISO 55001 §8',
      text: 'How mature is your Permit to Work (PTW) system?',
      options: [
        { score: 1, text: 'No formal PTW — work proceeds based on verbal authorization from supervisors' },
        { score: 2, text: 'Paper-based permits exist but the process is poorly understood and inconsistently applied' },
        { score: 3, text: 'Structured PTW system in place for high-risk work but paper-based with limited tracking' },
        { score: 4, text: 'Digital PTW system with risk assessment, isolation verification, and real-time permit status tracking' },
        { score: 5, text: 'Integrated electronic PTW with automated conflicts detection, competence checks, and analytics' },
      ],
    },
    { id: 'm3_q5', dimensionKey: 'lifecycle', isoRef: 'ISO 55001 §7.5',
      text: 'How are Standard Operating Procedures (SOPs) managed and made accessible?',
      options: [
        { score: 1, text: 'No written SOPs — procedures rely on worker experience and tribal knowledge' },
        { score: 2, text: 'Some SOPs exist in Word/PDF but are outdated, hard to find, and rarely referenced' },
        { score: 3, text: 'SOPs are documented and accessible but version control and review cycles are inconsistent' },
        { score: 4, text: 'Centralized SOP library with version control, regular reviews, and easy field access (tablets/mobile)' },
        { score: 5, text: 'Dynamic digital SOPs with embedded media, competence links, and automated review scheduling' },
      ],
    },
    { id: 'm2_q5', dimensionKey: 'lifecycle', isoRef: 'ISO 55001 §8 · ASME BPVC',
      text: 'How do you manage mechanical integrity for pressure-containing equipment?',
      options: [
        { score: 1, text: 'No mechanical integrity program — equipment is operated until failure or regulatory intervention' },
        { score: 2, text: 'Basic pressure testing and relief valve checks at regulatory-mandated intervals only' },
        { score: 3, text: 'MI program exists with defined scope but execution is inconsistent and documentation is incomplete' },
        { score: 4, text: 'Comprehensive MI program with defined procedures, tracking systems, and performance metrics' },
        { score: 5, text: 'Best-in-class MI with digital workflows, automated scheduling, FFS analysis, and continuous improvement' },
      ],
    },
    { id: 'm6_q4', dimensionKey: 'lifecycle', isoRef: 'API 510/570 · NACE',
      text: 'How do you manage corrosion in your operating environment?',
      options: [
        { score: 1, text: 'No corrosion management — corrosion discovered during failures or routine visual inspections' },
        { score: 2, text: 'Basic painting and coating programs but no formal corrosion monitoring or tracking system' },
        { score: 3, text: 'CML (Corrosion Monitoring Locations) established for critical circuits with periodic thickness readings' },
        { score: 4, text: 'Corrosion management program with predictive models, material selection guidance, and CP monitoring' },
        { score: 5, text: 'Corrosion rates are measured and modelled, inspection intervals derive from them, and material selection and control decisions are reviewed against results' },
      ],
    },
    { id: 'm4_q2', dimensionKey: 'lifecycle', isoRef: 'CAMA2 Domain 4',
      text: 'What is your process for setting inventory levels and reorder points?',
      options: [
        { score: 1, text: 'No formal process — stock levels are random or based on historical habit' },
        { score: 2, text: 'Min/max levels set for some items but based on guesswork, not consumption data' },
        { score: 3, text: 'Data-informed stock levels for key items but no automated reorder or demand forecasting' },
        { score: 4, text: 'Systematic min/max/ROP calculations based on consumption, lead time, and criticality analysis' },
        { score: 5, text: 'Stocking parameters are recalculated from consumption, lead time and criticality on a cycle; stock-outs and excess are measured and reduced' },
      ],
    },
    { id: 'm4_q3', dimensionKey: 'lifecycle', isoRef: 'NORSOK Z-CR-002',
      text: 'Do you have a preservation management program for stored equipment and spares?',
      options: [
        { score: 1, text: 'No preservation program — stored equipment degrades without any monitoring or protection' },
        { score: 2, text: 'Basic storage practices (shelving, indoor storage) but no formal preservation procedures' },
        { score: 3, text: 'Preservation procedures exist for major rotating equipment but are not consistently executed' },
        { score: 4, text: 'Formal preservation program with scheduled activities, inspections, and compliance tracking' },
        { score: 5, text: 'Comprehensive preservation management with digital tracking, climate-controlled storage, and auditing' },
      ],
    },
    { id: 'l8_suppliers', dimensionKey: 'lifecycle', isoRef: 'ISO 55001 §8.1 · §8.3',
      text: 'How do you choose and manage suppliers and contractors, and how much of your spend is under a contract rather than bought on the day?',
      options: [
        { score: 1, text: 'Suppliers are chosen on price or availability; almost all materials and services are spot-purchased; no performance feedback' },
        { score: 2, text: 'Some frame contracts exist for consumables; supplier performance is discussed informally' },
        { score: 3, text: 'Major categories and services are under contract; performance is tracked for the largest contracts but rarely acted on; a large share of spend is still unplanned' },
        { score: 4, text: 'Structured category management with scorecards, regular reviews and improvement expectations; unplanned spend is a small and measured share' },
        { score: 5, text: 'Strategic supplier relationships with shared performance data, risk-based contract controls for outsourced asset management activities, and continual reduction of reactive spend' },
      ],
    },

    // ═══ G4: ASSET INFORMATION ═══
    { id: 'm2_q1', dimensionKey: 'information', isoRef: 'ISO 55013 · ISO 14224',
      text: 'How complete and accurate is your asset register?',
      options: [
        { score: 1, text: 'No centralized asset register — equipment data scattered across spreadsheets or tribal knowledge' },
        { score: 2, text: 'Basic equipment list exists but is incomplete, outdated, or not linked to the maintenance system' },
        { score: 3, text: 'Asset register covers most equipment but has gaps in hierarchy, specifications, or criticality data' },
        { score: 4, text: 'Comprehensive register with accurate hierarchy, nameplate data, and criticality rankings for all assets' },
        { score: 5, text: 'Fully governed asset register with real-time reconciliation, GIS integration, and automated change tracking' },
      ],
    },
    { id: 'i6_info_standards', dimensionKey: 'information', isoRef: 'ISO 55001 §7.5 · §7.6 · ISO 55013 · ISO 14224',
      text: 'Has someone defined which asset data must be kept, in what format (for example tagging and failure codes), and who is responsible for keeping it right?',
      options: [
        { score: 1, text: 'No definition of required asset information; each system and person keeps what suits them' },
        { score: 2, text: 'Some information requirements are implied by the CMMS fields, but nobody owns the standards' },
        { score: 3, text: 'Information standards exist for parts of the base (for example a tagging convention or a failure-coding standard) but are not governed or audited' },
        { score: 4, text: 'An asset information strategy defines required information, standards (including failure and maintenance coding) and named owners; compliance is checked' },
        { score: 5, text: 'Information requirements are derived from decision needs, quality is measured and reported, and standards are improved as decisions change' },
      ],
    },
    { id: 'm5_q3', dimensionKey: 'information', isoRef: 'ISO 55013 · ISO 55001 §9.1',
      text: 'How would you rate the data quality in your CMMS/EAM system?',
      options: [
        { score: 1, text: 'No CMMS, or CMMS exists but is rarely used — data is unreliable and incomplete' },
        { score: 2, text: 'CMMS used for work orders but asset data, history, and coding are inconsistent and unreliable' },
        { score: 3, text: 'Reasonable data for recent work orders; historical data and asset attributes have known quality gaps' },
        { score: 4, text: 'Good data quality with governance processes, regular audits, and standardized coding practices' },
        { score: 5, text: 'Excellent data quality with automated validation, master data governance, and data stewardship roles' },
      ],
    },
    { id: 'm5_q1', dimensionKey: 'information', isoRef: 'ISO 55001 §9.1 · EN 15341',
      text: 'What KPIs do you track for maintenance and reliability performance?',
      options: [
        { score: 1, text: 'No formal KPIs — performance is judged by "feel" or reactive response to failures' },
        { score: 2, text: 'Basic metrics like work order count and cost, but no leading indicators or trend analysis' },
        { score: 3, text: 'Standard KPIs (backlog, PM compliance, costs) tracked monthly but not consistently acted upon' },
        { score: 4, text: 'Balanced scorecard of leading and lagging KPIs with targets, trends, and management review' },
        { score: 5, text: 'Real-time KPI dashboards with automated alerts, benchmarking, and data-driven decision-making' },
      ],
    },
    { id: 'm5_q2', dimensionKey: 'information', isoRef: 'ISO 14224 · SMRP',
      text: 'Do you measure and track MTBF, MTTR, and OEE for critical assets?',
      options: [
        { score: 1, text: 'No reliability metrics tracked — failure data not captured in a way that enables analysis' },
        { score: 2, text: 'Some failure frequency awareness but no formal MTBF/MTTR calculation or OEE measurement' },
        { score: 3, text: 'MTBF/MTTR calculated for some assets; OEE tracked for major production lines but data quality is poor' },
        { score: 4, text: 'Reliability metrics consistently calculated for critical assets with trend analysis driving improvements' },
        { score: 5, text: 'Reliability metrics are computed to a defined standard, trended, and used to change maintenance strategy; bad actors are eliminated on a programme' },
      ],
    },
    { id: 'm5_q5', dimensionKey: 'information', isoRef: 'ISO 55001 §9.1 · ISO 55013',
      text: 'How do you use data analytics to identify trends and optimize maintenance?',
      options: [
        { score: 1, text: 'No analytics — reports are basic work order lists or cost summaries with no trend analysis' },
        { score: 2, text: 'Excel-based analysis done occasionally when problems become obvious or management requests it' },
        { score: 3, text: 'Standard reports and dashboards available from CMMS with some trending capability' },
        { score: 4, text: 'Advanced analytics with Pareto analysis, failure trending, and predictive models for key assets' },
        { score: 5, text: 'Analysis is embedded in decisions: failure patterns and cost drivers are reviewed on a cycle, actions are tracked, and the value of analysis is measured' },
      ],
    },

    // ═══ G5: ORGANISATION & PEOPLE ═══
    { id: 'm1_q1', dimensionKey: 'people', isoRef: 'ISO 55001 §7.2 · ISO 55012',
      text: 'Does your organization have a formal competency framework for maintenance & reliability personnel?',
      options: [
        { score: 1, text: 'No formal framework — competency is assumed based on job title or years of experience' },
        { score: 2, text: 'Basic job descriptions exist but there is no structured competency assessment or tracking' },
        { score: 3, text: 'A competency matrix exists for key roles but is not consistently applied or regularly updated' },
        { score: 4, text: 'Comprehensive competency framework with regular assessments, gap analysis, and targeted training plans' },
        { score: 5, text: 'Competence requirements derive from the SAMP, are assessed on a cycle, and gaps drive development plans; contractor competence is included' },
      ],
    },
    { id: 'm1_q2', dimensionKey: 'people', isoRef: 'OSHA PSM §1910.119(g) · ISO 55012',
      text: 'How does your organization verify competence for safety-critical maintenance tasks?',
      options: [
        { score: 1, text: 'No formal verification — relies on worker self-assessment or supervisor assumption' },
        { score: 2, text: 'Informal checks by supervisors before task assignment, but no documentation' },
        { score: 3, text: 'Documented competency assessments exist for some critical tasks but are inconsistently applied' },
        { score: 4, text: 'Systematic competency verification with records, refresher training, and periodic reassessment' },
        { score: 5, text: 'Rigorous verification system with practical assessments, digital sign-off, and real-time competence dashboards' },
      ],
    },
    { id: 'm1_q3', dimensionKey: 'people', isoRef: 'ISO 55012 · ISO 55001 §7.2',
      text: 'What training programs exist for developing asset management capabilities?',
      options: [
        { score: 1, text: 'No structured training — knowledge transfer is informal and on-the-job only' },
        { score: 2, text: 'Some vendor-led training occurs but there is no internal training plan or curriculum' },
        { score: 3, text: 'Annual training plan exists covering technical skills, but no AM-specific development program' },
        { score: 4, text: 'Structured AM training aligned to role requirements with measurable learning outcomes and refreshers' },
        { score: 5, text: 'Comprehensive development program including certifications (CAMA/IAM), mentoring, and career pathways' },
      ],
    },
    { id: 'm1_q4', dimensionKey: 'people', isoRef: 'ISO 45001 · API RP 75',
      text: 'How does your organization promote and measure safety culture within maintenance operations?',
      options: [
        { score: 1, text: 'Safety culture is not actively promoted — focus is purely on compliance with basic regulations' },
        { score: 2, text: 'Safety meetings occur but participation is low and there is no measurement of safety culture' },
        { score: 3, text: 'Regular toolbox talks and incident reporting exist but cultural measurement is informal' },
        { score: 4, text: 'Active safety leadership program with culture surveys, behavioral observations, and improvement plans' },
        { score: 5, text: 'Generative safety culture with proactive reporting, just culture principles, and industry-leading metrics' },
      ],
    },
    { id: 'm1_q5', dimensionKey: 'people', isoRef: 'ISO 55012 · CAMA2 Domain 1',
      text: 'Do you have succession plans for key technical and leadership roles in asset management?',
      options: [
        { score: 1, text: 'No succession planning — key-person dependency is a known but unmanaged risk' },
        { score: 2, text: 'Awareness of key-person risks but no formal plan or identified successors' },
        { score: 3, text: 'Succession plans exist for some leadership roles but not for critical technical specialists' },
        { score: 4, text: 'Formal succession plans for all key roles with identified successors and development programs' },
        { score: 5, text: 'Successors are identified for all key roles, readiness is reviewed on a cycle, and cross-training rotations are planned' },
      ],
    },

    // ═══ G6: RISK & REVIEW ═══
    { id: 'm3_q3', dimensionKey: 'risk', isoRef: 'ISO 55001 §8.2 · API RP 750',
      text: 'Do you have a formal Management of Change (MOC) process?',
      options: [
        { score: 1, text: 'No MOC process — changes are made without formal review or documentation' },
        { score: 2, text: 'MOC awareness exists but the process is only applied for major capital projects' },
        { score: 3, text: 'Documented MOC procedure covering process and equipment changes but applied inconsistently' },
        { score: 4, text: 'Rigorous MOC program covering all change types with risk assessment, approvals, and follow-up' },
        { score: 5, text: 'Fully digital MOC integrated with asset register, risk systems, and compliance tracking' },
      ],
    },
    { id: 'm2_q3', dimensionKey: 'risk', isoRef: 'ISO 17359 · API 670',
      text: 'What condition monitoring technologies are deployed on your critical assets?',
      options: [
        { score: 1, text: 'No condition monitoring — maintenance is purely time-based or reactive (run-to-failure)' },
        { score: 2, text: 'Basic visual inspections and some portable vibration or temperature readings on an ad-hoc basis' },
        { score: 3, text: 'Route-based vibration, oil analysis, or thermography programs on critical rotating equipment' },
        { score: 4, text: 'Integrated CbM program covering multiple technologies with trending, alerts, and work order triggers' },
        { score: 5, text: 'Continuous or online monitoring on critical assets, alarms with defined responses, diagnostic accuracy measured and improved, results feeding strategy reviews' },
      ],
    },
    { id: 'm6_q1', dimensionKey: 'risk', isoRef: 'ISO 14001:2015 · ISO 55001 §4.1',
      text: 'How does your organization assess and manage environmental risks from asset operations?',
      options: [
        { score: 1, text: 'No environmental risk assessment — compliance is reactive, driven by incidents or regulatory fines' },
        { score: 2, text: 'Basic awareness of environmental obligations but no formal risk assessment methodology' },
        { score: 3, text: 'Environmental risk register exists for major operations but is not regularly updated or reviewed' },
        { score: 4, text: 'Systematic environmental risk assessment integrated with asset integrity and operational planning' },
        { score: 5, text: 'Proactive environmental management with predictive modelling, zero-incident targets, and ISO 14001 certification' },
      ],
    },
    { id: 'm6_q2', dimensionKey: 'risk', isoRef: 'ISO 55011 · API RP 752/753',
      text: 'How do you track and manage regulatory compliance obligations?',
      options: [
        { score: 1, text: 'No compliance register — regulatory requirements are unknown until an audit or enforcement action' },
        { score: 2, text: 'Key regulations are known informally but there is no centralized tracking or deadline management' },
        { score: 3, text: 'Compliance register exists with due dates but tracking is manual and some obligations may be missed' },
        { score: 4, text: 'Centralized compliance management system with automated reminders, owner assignments, and audit trails' },
        { score: 5, text: 'Integrated regulatory intelligence platform with automated updates, gap analysis, and proactive engagement' },
      ],
    },
    { id: 'm6_q3', dimensionKey: 'risk', isoRef: 'TCFD · ISO 55001 §4.1', allowNotApplicable: true,
      text: 'Do you assess climate-related risks in your asset management planning?',
      options: [
        { score: 1, text: 'Climate risk is not considered in asset management planning or investment decisions' },
        { score: 2, text: 'General awareness of climate risks but no formal assessment or integration into AM plans' },
        { score: 3, text: 'Climate risk assessed for major capital projects but not integrated into routine AM planning' },
        { score: 4, text: 'Climate risk scenarios (heat, flood, storm) integrated into asset lifecycle and resilience planning' },
        { score: 5, text: 'Comprehensive climate risk framework aligned to TCFD with scenario analysis and adaptation strategies' },
      ],
    },
    { id: 'r6_review', dimensionKey: 'risk', isoRef: 'ISO 55001 §9.2 · §9.3 · SMRP Best Practices',
      text: 'How often does leadership formally review how the assets are being managed, and is that way of working itself checked by audit and compared with other companies?',
      options: [
        { score: 1, text: 'No management review of asset management; performance is discussed only when something fails' },
        { score: 2, text: 'Performance is reported to leadership occasionally, with no defined agenda, decisions or follow-up' },
        { score: 3, text: 'A periodic management review exists with a defined agenda; internal audit of the asset management system is informal and comparison with peers is occasional' },
        { score: 4, text: 'Management review runs on a cycle with recorded decisions and actions; the asset management system is audited on a programme; performance is benchmarked against industry data' },
        { score: 5, text: 'Review, audit and benchmarking findings drive improvement plans that are tracked to closure; assurance covers contractors and outsourced activities, and the programme is risk-weighted' },
      ],
    },
];

/** Question ids from the 6M-grouped bank (sixm-v1) that were merged away and no longer score. */
export const RETIRED_QUESTION_IDS = ['m4_q4', 'm4_q5', 'm5_q4'] as const;

export function questionById(id: string): MaturityQuestion | undefined {
    return MATURITY_QUESTIONS.find(q => q.id === id);
}

export function questionsFor(key: MaturityDimensionKey): MaturityQuestion[] {
    return MATURITY_QUESTIONS.filter(q => q.dimensionKey === key);
}
