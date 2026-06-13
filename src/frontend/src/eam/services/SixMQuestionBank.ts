/**
 * SixMQuestionBank.ts — Guided Multiple-Choice 6M Assessment
 *
 * 30 questions (5 per dimension) × 5 answer options each = 150 predefined options.
 * Each option maps to a maturity level (1=Innocent → 5=Optimizing).
 * Users click the answer that best describes their organization.
 */

// ─── Types ─────────────────────────────────────────────────────────

export interface SixMQuestionOption {
    score: number;  // 1-5 maturity
    text: string;   // Descriptive answer
}

export interface SixMChecklistQuestion {
    id: string;
    dimensionKey: string;
    text: string;
    isoRef: string;
    options: SixMQuestionOption[];
}

export interface SixMChecklistAnswer {
    questionId: string;
    dimensionKey: string;
    selectedScore: number;
    optionText: string;
    notes?: string;
}

export interface SixMDimensionExplainer {
    key: string;
    code: string;
    label: string;
    icon: string;
    color: string;
    gradient: string;
    meaning: string;
}

// ─── Dimension Explainers ──────────────────────────────────────────

export const SIXM_EXPLAINERS: SixMDimensionExplainer[] = [
    { key: 'man', code: 'M1', label: 'Man', icon: 'Users', color: '#3b82f6', gradient: 'from-blue-500 to-blue-600', meaning: 'Do you have the right people, with the right skills, in the right roles? This evaluates workforce competency, training, safety culture, and succession planning.' },
    { key: 'machine', code: 'M2', label: 'Machine', icon: 'Cog', color: '#ef4444', gradient: 'from-red-500 to-red-600', meaning: 'How well do you know and maintain your physical assets? This covers your asset register, condition monitoring, inspections, and criticality rankings.' },
    { key: 'method', code: 'M3', label: 'Method', icon: 'ClipboardList', color: '#22c55e', gradient: 'from-green-500 to-green-600', meaning: 'Are your work processes documented, followed, and effective? This examines work management, permits, change control, and maintenance strategies.' },
    { key: 'material', code: 'M4', label: 'Material', icon: 'Package', color: '#f59e0b', gradient: 'from-amber-500 to-amber-600', meaning: 'Can you get the right parts when you need them? This assesses spare parts management, inventory controls, vendor performance, and procurement.' },
    { key: 'measurement', code: 'M5', label: 'Measurement', icon: 'Gauge', color: '#8b5cf6', gradient: 'from-blue-500 to-blue-600', meaning: 'Are you measuring what matters? This evaluates your KPIs, data quality, CMMS usage, and how data drives decisions.' },
    { key: 'mother_nature', code: 'M6', label: 'Mother Nature', icon: 'Cloud', color: '#06b6d4', gradient: 'from-cyan-500 to-cyan-600', meaning: 'How do you manage environmental and regulatory risks? This covers compliance, climate risk, corrosion management, and sustainability.' },
];

// ─── Question Bank ─────────────────────────────────────────────────

export const SIXM_ASSESSMENT_QUESTIONS: SixMChecklistQuestion[] = [
    // ═══ M1: MAN ═══
    { id: 'm1_q1', dimensionKey: 'man', isoRef: 'ISO 55001 §7.2 · ISO 55012',
      text: 'Does your organization have a formal competency framework for maintenance & reliability personnel?',
      options: [
        { score: 1, text: 'No formal framework — competency is assumed based on job title or years of experience' },
        { score: 2, text: 'Basic job descriptions exist but there is no structured competency assessment or tracking' },
        { score: 3, text: 'A competency matrix exists for key roles but is not consistently applied or regularly updated' },
        { score: 4, text: 'Comprehensive competency framework with regular assessments, gap analysis, and targeted training plans' },
        { score: 5, text: 'Fully integrated competence management system with automated tracking, certification management, and succession planning' },
      ],
    },
    { id: 'm1_q2', dimensionKey: 'man', isoRef: 'OSHA PSM §1910.119(g) · ISO 55012',
      text: 'How does your organization verify competence for safety-critical maintenance tasks?',
      options: [
        { score: 1, text: 'No formal verification — relies on worker self-assessment or supervisor assumption' },
        { score: 2, text: 'Informal checks by supervisors before task assignment, but no documentation' },
        { score: 3, text: 'Documented competency assessments exist for some critical tasks but are inconsistently applied' },
        { score: 4, text: 'Systematic competency verification with records, refresher training, and periodic reassessment' },
        { score: 5, text: 'Rigorous verification system with practical assessments, digital sign-off, and real-time competence dashboards' },
      ],
    },
    { id: 'm1_q3', dimensionKey: 'man', isoRef: 'ISO 55012 · ISO 55001 §7.2',
      text: 'What training programs exist for developing asset management capabilities?',
      options: [
        { score: 1, text: 'No structured training — knowledge transfer is informal and on-the-job only' },
        { score: 2, text: 'Some vendor-led training occurs but there is no internal training plan or curriculum' },
        { score: 3, text: 'Annual training plan exists covering technical skills, but no AM-specific development program' },
        { score: 4, text: 'Structured AM training aligned to role requirements with measurable learning outcomes and refreshers' },
        { score: 5, text: 'Comprehensive development program including certifications (CAMA/IAM), mentoring, and career pathways' },
      ],
    },
    { id: 'm1_q4', dimensionKey: 'man', isoRef: 'ISO 45001 · API RP 75',
      text: 'How does your organization promote and measure safety culture within maintenance operations?',
      options: [
        { score: 1, text: 'Safety culture is not actively promoted — focus is purely on compliance with basic regulations' },
        { score: 2, text: 'Safety meetings occur but participation is low and there is no measurement of safety culture' },
        { score: 3, text: 'Regular toolbox talks and incident reporting exist but cultural measurement is informal' },
        { score: 4, text: 'Active safety leadership program with culture surveys, behavioral observations, and improvement plans' },
        { score: 5, text: 'Generative safety culture with proactive reporting, just culture principles, and industry-leading metrics' },
      ],
    },
    { id: 'm1_q5', dimensionKey: 'man', isoRef: 'ISO 55012 · CAMA2 Domain 1',
      text: 'Do you have succession plans for key technical and leadership roles in asset management?',
      options: [
        { score: 1, text: 'No succession planning — key-person dependency is a known but unmanaged risk' },
        { score: 2, text: 'Awareness of key-person risks but no formal plan or identified successors' },
        { score: 3, text: 'Succession plans exist for some leadership roles but not for critical technical specialists' },
        { score: 4, text: 'Formal succession plans for all key roles with identified successors and development programs' },
        { score: 5, text: 'Dynamic succession management with talent pipelines, cross-training rotations, and readiness dashboards' },
      ],
    },

    // ═══ M2: MACHINE ═══
    { id: 'm2_q1', dimensionKey: 'machine', isoRef: 'ISO 55013 · ISO 14224',
      text: 'How complete and accurate is your asset register?',
      options: [
        { score: 1, text: 'No centralized asset register — equipment data scattered across spreadsheets or tribal knowledge' },
        { score: 2, text: 'Basic equipment list exists but is incomplete, outdated, or not linked to the maintenance system' },
        { score: 3, text: 'Asset register covers most equipment but has gaps in hierarchy, specifications, or criticality data' },
        { score: 4, text: 'Comprehensive register with accurate hierarchy, nameplate data, and criticality rankings for all assets' },
        { score: 5, text: 'Fully governed asset register with real-time reconciliation, GIS integration, and automated change tracking' },
      ],
    },
    { id: 'm2_q2', dimensionKey: 'machine', isoRef: 'API 580/581 · ASME PCC-3',
      text: 'Do you have a formal criticality ranking system applied to your assets?',
      options: [
        { score: 1, text: 'No criticality ranking — all assets treated equally regardless of risk or business impact' },
        { score: 2, text: 'Informal criticality awareness — operations "know" which assets are important but it is not documented' },
        { score: 3, text: 'Criticality assessment completed for major equipment but not consistently driving maintenance strategy' },
        { score: 4, text: 'Systematic criticality framework (e.g., consequence × likelihood) applied and linked to strategy selection' },
        { score: 5, text: 'Dynamic, risk-based criticality with automated recalculation, integrated with RBI, RCM, and spares strategy' },
      ],
    },
    { id: 'm2_q3', dimensionKey: 'machine', isoRef: 'ISO 17359 · API 670',
      text: 'What condition monitoring technologies are deployed on your critical assets?',
      options: [
        { score: 1, text: 'No condition monitoring — maintenance is purely time-based or reactive (run-to-failure)' },
        { score: 2, text: 'Basic visual inspections and some portable vibration or temperature readings on an ad-hoc basis' },
        { score: 3, text: 'Route-based vibration, oil analysis, or thermography programs on critical rotating equipment' },
        { score: 4, text: 'Integrated CbM program covering multiple technologies with trending, alerts, and work order triggers' },
        { score: 5, text: 'Online continuous monitoring with predictive analytics, machine learning, and automated diagnostics' },
      ],
    },
    { id: 'm2_q4', dimensionKey: 'machine', isoRef: 'API 510/570/653 · API 580/581',
      text: 'How do you manage inspection programs for static equipment (vessels, piping, tanks)?',
      options: [
        { score: 1, text: 'No formal inspection program — inspections only happen after failures or regulatory notices' },
        { score: 2, text: 'Time-based inspections at fixed intervals with basic visual methods only' },
        { score: 3, text: 'Inspection plans exist for major equipment with NDT methods, but no risk-based prioritization' },
        { score: 4, text: 'Risk-Based Inspection (RBI) program implemented with documented corrosion rates and risk rankings' },
        { score: 5, text: 'Fully quantitative RBI with real-time corrosion monitoring, digital inspection records, and fitness-for-service' },
      ],
    },
    { id: 'm2_q5', dimensionKey: 'machine', isoRef: 'ISO 55001 §8 · ASME BPVC',
      text: 'How do you manage mechanical integrity for pressure-containing equipment?',
      options: [
        { score: 1, text: 'No mechanical integrity program — equipment is operated until failure or regulatory intervention' },
        { score: 2, text: 'Basic pressure testing and relief valve checks at regulatory-mandated intervals only' },
        { score: 3, text: 'MI program exists with defined scope but execution is inconsistent and documentation is incomplete' },
        { score: 4, text: 'Comprehensive MI program with defined procedures, tracking systems, and performance metrics' },
        { score: 5, text: 'Best-in-class MI with digital workflows, automated scheduling, FFS analysis, and continuous improvement' },
      ],
    },

    // ═══ M3: METHOD ═══
    { id: 'm3_q1', dimensionKey: 'method', isoRef: 'ISO 55001 §8.1',
      text: 'How mature is your work management process from identification through to closeout?',
      options: [
        { score: 1, text: 'No formal work management — maintenance is verbal requests and reactive responses' },
        { score: 2, text: 'Work orders exist but are often bypassed; no formal planning, scheduling, or closeout process' },
        { score: 3, text: 'Defined workflow (request → plan → schedule → execute → close) but inconsistently followed' },
        { score: 4, text: 'Disciplined work management with planning, scheduling, resource allocation, and feedback loops' },
        { score: 5, text: 'Optimized work management with KPI tracking, AI-assisted planning, and continuous process improvement' },
      ],
    },
    { id: 'm3_q2', dimensionKey: 'method', isoRef: 'Process Safety · ISO 55001 §8',
      text: 'How mature is your Permit to Work (PTW) system?',
      options: [
        { score: 1, text: 'No formal PTW — work proceeds based on verbal authorization from supervisors' },
        { score: 2, text: 'Paper-based permits exist but the process is poorly understood and inconsistently applied' },
        { score: 3, text: 'Structured PTW system in place for high-risk work but paper-based with limited tracking' },
        { score: 4, text: 'Digital PTW system with risk assessment, isolation verification, and real-time permit status tracking' },
        { score: 5, text: 'Integrated electronic PTW with automated conflicts detection, competence checks, and analytics' },
      ],
    },
    { id: 'm3_q3', dimensionKey: 'method', isoRef: 'ISO 55001 §8.2 · API RP 750',
      text: 'Do you have a formal Management of Change (MOC) process?',
      options: [
        { score: 1, text: 'No MOC process — changes are made without formal review or documentation' },
        { score: 2, text: 'MOC awareness exists but the process is only applied for major capital projects' },
        { score: 3, text: 'Documented MOC procedure covering process and equipment changes but applied inconsistently' },
        { score: 4, text: 'Rigorous MOC program covering all change types with risk assessment, approvals, and follow-up' },
        { score: 5, text: 'Fully digital MOC integrated with asset register, risk systems, and compliance tracking' },
      ],
    },
    { id: 'm3_q4', dimensionKey: 'method', isoRef: 'SAE JA1011 · IEC 61882',
      text: 'What maintenance strategy optimization tools do you use (RCM, FMEA, PMO)?',
      options: [
        { score: 1, text: 'No strategy tools — maintenance tasks are based on OEM recommendations or tradition' },
        { score: 2, text: 'Some awareness of RCM/FMEA but no formal studies have been conducted' },
        { score: 3, text: 'FMEA or RCM applied to a few critical systems but results not fully implemented in the CMMS' },
        { score: 4, text: 'Systematic RCM/FMEA program for critical assets with results driving PM task optimization' },
        { score: 5, text: 'Living RCM program with continuous review, bad-actor elimination, and data-driven task optimization' },
      ],
    },
    { id: 'm3_q5', dimensionKey: 'method', isoRef: 'ISO 55001 §7.5',
      text: 'How are Standard Operating Procedures (SOPs) managed and made accessible?',
      options: [
        { score: 1, text: 'No written SOPs — procedures rely on worker experience and tribal knowledge' },
        { score: 2, text: 'Some SOPs exist in Word/PDF but are outdated, hard to find, and rarely referenced' },
        { score: 3, text: 'SOPs are documented and accessible but version control and review cycles are inconsistent' },
        { score: 4, text: 'Centralized SOP library with version control, regular reviews, and easy field access (tablets/mobile)' },
        { score: 5, text: 'Dynamic digital SOPs with embedded media, competence links, and automated review scheduling' },
      ],
    },

    // ═══ M4: MATERIAL ═══
    { id: 'm4_q1', dimensionKey: 'material', isoRef: 'ISO 55001 §8.1 · API 686',
      text: 'How do you identify and manage critical spare parts?',
      options: [
        { score: 1, text: 'No critical spares identification — parts are ordered reactively when equipment fails' },
        { score: 2, text: 'Some critical spares identified informally but no systematic stock policy or lead-time analysis' },
        { score: 3, text: 'Critical spares list exists with min/max levels, but coverage is incomplete and rarely reviewed' },
        { score: 4, text: 'Systematic critical spares analysis linked to asset criticality with documented stocking policies' },
        { score: 5, text: 'Optimized spares strategy using reliability data, obsolescence management, and vendor-managed inventory' },
      ],
    },
    { id: 'm4_q2', dimensionKey: 'material', isoRef: 'CAMA2 Domain 4',
      text: 'What is your process for setting inventory levels and reorder points?',
      options: [
        { score: 1, text: 'No formal process — stock levels are random or based on historical habit' },
        { score: 2, text: 'Min/max levels set for some items but based on guesswork, not consumption data' },
        { score: 3, text: 'Data-informed stock levels for key items but no automated reorder or demand forecasting' },
        { score: 4, text: 'Systematic min/max/ROP calculations based on consumption, lead time, and criticality analysis' },
        { score: 5, text: 'AI-driven demand forecasting with automated purchasing, vendor scorecards, and cost optimization' },
      ],
    },
    { id: 'm4_q3', dimensionKey: 'material', isoRef: 'NORSOK Z-CR-002',
      text: 'Do you have a preservation management program for stored equipment and spares?',
      options: [
        { score: 1, text: 'No preservation program — stored equipment degrades without any monitoring or protection' },
        { score: 2, text: 'Basic storage practices (shelving, indoor storage) but no formal preservation procedures' },
        { score: 3, text: 'Preservation procedures exist for major rotating equipment but are not consistently executed' },
        { score: 4, text: 'Formal preservation program with scheduled activities, inspections, and compliance tracking' },
        { score: 5, text: 'Comprehensive preservation management with digital tracking, climate-controlled storage, and auditing' },
      ],
    },
    { id: 'm4_q4', dimensionKey: 'material', isoRef: 'ISO 55001 §8.1',
      text: 'How do you manage vendor and supplier performance for maintenance services?',
      options: [
        { score: 1, text: 'No vendor performance management — suppliers are selected based on price or availability only' },
        { score: 2, text: 'Informal feedback on vendor quality but no documented performance evaluation or scoring' },
        { score: 3, text: 'Vendor performance tracked for major contracts but not systematically reviewed or acted upon' },
        { score: 4, text: 'Structured vendor scorecard program with KPIs, regular reviews, and improvement expectations' },
        { score: 5, text: 'Strategic vendor partnerships with integrated performance dashboards, SLA tracking, and innovation sharing' },
      ],
    },
    { id: 'm4_q5', dimensionKey: 'material', isoRef: 'ISO 55001 §8.1 · CAMA2',
      text: 'What percentage of your maintenance materials are procured through managed contracts vs spot buys?',
      options: [
        { score: 1, text: 'Almost all materials are spot-purchased — no frame contracts or procurement planning' },
        { score: 2, text: 'Some frame contracts exist for consumables but most purchases are reactive and unplanned' },
        { score: 3, text: 'Major categories covered by contracts but 40-60% of spend is still unplanned spot purchasing' },
        { score: 4, text: 'Most materials under managed contracts with planned procurement; spot buys under 20% of spend' },
        { score: 5, text: 'Strategic procurement with category management, e-catalogues, and less than 10% reactive spend' },
      ],
    },

    // ═══ M5: MEASUREMENT ═══
    { id: 'm5_q1', dimensionKey: 'measurement', isoRef: 'ISO 55001 §9.1 · EN 15341',
      text: 'What KPIs do you track for maintenance and reliability performance?',
      options: [
        { score: 1, text: 'No formal KPIs — performance is judged by "feel" or reactive response to failures' },
        { score: 2, text: 'Basic metrics like work order count and cost, but no leading indicators or trend analysis' },
        { score: 3, text: 'Standard KPIs (backlog, PM compliance, costs) tracked monthly but not consistently acted upon' },
        { score: 4, text: 'Balanced scorecard of leading and lagging KPIs with targets, trends, and management review' },
        { score: 5, text: 'Real-time KPI dashboards with automated alerts, benchmarking, and data-driven decision-making' },
      ],
    },
    { id: 'm5_q2', dimensionKey: 'measurement', isoRef: 'ISO 14224 · SMRP',
      text: 'Do you measure and track MTBF, MTTR, and OEE for critical assets?',
      options: [
        { score: 1, text: 'No reliability metrics tracked — failure data not captured in a way that enables analysis' },
        { score: 2, text: 'Some failure frequency awareness but no formal MTBF/MTTR calculation or OEE measurement' },
        { score: 3, text: 'MTBF/MTTR calculated for some assets; OEE tracked for major production lines but data quality is poor' },
        { score: 4, text: 'Reliability metrics consistently calculated for critical assets with trend analysis driving improvements' },
        { score: 5, text: 'Automated reliability analytics with Weibull analysis, bad-actor identification, and predictive insights' },
      ],
    },
    { id: 'm5_q3', dimensionKey: 'measurement', isoRef: 'ISO 55013 · ISO 55001 §9.1',
      text: 'How would you rate the data quality in your CMMS/EAM system?',
      options: [
        { score: 1, text: 'No CMMS, or CMMS exists but is rarely used — data is unreliable and incomplete' },
        { score: 2, text: 'CMMS used for work orders but asset data, history, and coding are inconsistent and unreliable' },
        { score: 3, text: 'Reasonable data for recent work orders; historical data and asset attributes have known quality gaps' },
        { score: 4, text: 'Good data quality with governance processes, regular audits, and standardized coding practices' },
        { score: 5, text: 'Excellent data quality with automated validation, master data governance, and data stewardship roles' },
      ],
    },
    { id: 'm5_q4', dimensionKey: 'measurement', isoRef: 'SMRP Best Practices',
      text: 'Do you conduct regular benchmarking of maintenance performance against industry standards?',
      options: [
        { score: 1, text: 'No benchmarking — no awareness of how performance compares to industry peers' },
        { score: 2, text: 'Occasional comparison to published industry averages but no formal benchmarking program' },
        { score: 3, text: 'Periodic benchmarking (annually) against industry databases but limited action on findings' },
        { score: 4, text: 'Regular benchmarking with peer companies, industry surveys, and improvement plans from results' },
        { score: 5, text: 'Continuous benchmarking with SMRP/Solomon indices, internal site comparisons, and executive reporting' },
      ],
    },
    { id: 'm5_q5', dimensionKey: 'measurement', isoRef: 'ISO 55001 §9.1 · ISO 55013',
      text: 'How do you use data analytics to identify trends and optimize maintenance?',
      options: [
        { score: 1, text: 'No analytics — reports are basic work order lists or cost summaries with no trend analysis' },
        { score: 2, text: 'Excel-based analysis done occasionally when problems become obvious or management requests it' },
        { score: 3, text: 'Standard reports and dashboards available from CMMS with some trending capability' },
        { score: 4, text: 'Advanced analytics with Pareto analysis, failure trending, and predictive models for key assets' },
        { score: 5, text: 'AI/ML-powered analytics platform with automated insights, prescriptive recommendations, and digital twins' },
      ],
    },

    // ═══ M6: MOTHER NATURE ═══
    { id: 'm6_q1', dimensionKey: 'mother_nature', isoRef: 'ISO 14001:2015 · ISO 55001 §4.1',
      text: 'How does your organization assess and manage environmental risks from asset operations?',
      options: [
        { score: 1, text: 'No environmental risk assessment — compliance is reactive, driven by incidents or regulatory fines' },
        { score: 2, text: 'Basic awareness of environmental obligations but no formal risk assessment methodology' },
        { score: 3, text: 'Environmental risk register exists for major operations but is not regularly updated or reviewed' },
        { score: 4, text: 'Systematic environmental risk assessment integrated with asset integrity and operational planning' },
        { score: 5, text: 'Proactive environmental management with predictive modelling, zero-incident targets, and ISO 14001 certification' },
      ],
    },
    { id: 'm6_q2', dimensionKey: 'mother_nature', isoRef: 'ISO 55011 · API RP 752/753',
      text: 'How do you track and manage regulatory compliance obligations?',
      options: [
        { score: 1, text: 'No compliance register — regulatory requirements are unknown until an audit or enforcement action' },
        { score: 2, text: 'Key regulations are known informally but there is no centralized tracking or deadline management' },
        { score: 3, text: 'Compliance register exists with due dates but tracking is manual and some obligations may be missed' },
        { score: 4, text: 'Centralized compliance management system with automated reminders, owner assignments, and audit trails' },
        { score: 5, text: 'Integrated regulatory intelligence platform with automated updates, gap analysis, and proactive engagement' },
      ],
    },
    { id: 'm6_q3', dimensionKey: 'mother_nature', isoRef: 'TCFD · ISO 55001 §4.1',
      text: 'Do you assess climate-related risks in your asset management planning?',
      options: [
        { score: 1, text: 'Climate risk is not considered in asset management planning or investment decisions' },
        { score: 2, text: 'General awareness of climate risks but no formal assessment or integration into AM plans' },
        { score: 3, text: 'Climate risk assessed for major capital projects but not integrated into routine AM planning' },
        { score: 4, text: 'Climate risk scenarios (heat, flood, storm) integrated into asset lifecycle and resilience planning' },
        { score: 5, text: 'Comprehensive climate risk framework aligned to TCFD with scenario analysis and adaptation strategies' },
      ],
    },
    { id: 'm6_q4', dimensionKey: 'mother_nature', isoRef: 'API 510/570 · NACE',
      text: 'How do you manage corrosion in your operating environment?',
      options: [
        { score: 1, text: 'No corrosion management — corrosion discovered during failures or routine visual inspections' },
        { score: 2, text: 'Basic painting and coating programs but no formal corrosion monitoring or tracking system' },
        { score: 3, text: 'CML (Corrosion Monitoring Locations) established for critical circuits with periodic thickness readings' },
        { score: 4, text: 'Corrosion management program with predictive models, material selection guidance, and CP monitoring' },
        { score: 5, text: 'Advanced corrosion engineering with real-time sensors, predictive analytics, and material performance databases' },
      ],
    },
    { id: 'm6_q5', dimensionKey: 'mother_nature', isoRef: 'ISO 14001 · ISO 55001 §4.1',
      text: 'Does your organization have sustainability targets integrated into asset lifecycle decisions?',
      options: [
        { score: 1, text: 'No sustainability targets — environmental performance is not a factor in asset decisions' },
        { score: 2, text: 'Corporate sustainability goals exist but are not connected to asset management or maintenance decisions' },
        { score: 3, text: 'Some asset decisions consider sustainability (e.g., energy efficiency) but not systematically' },
        { score: 4, text: 'Sustainability targets formally integrated into asset lifecycle decisions, CAPEX prioritization, and reporting' },
        { score: 5, text: 'Net-zero pathways with asset-level carbon tracking, circular economy principles, and ESG-aligned investment' },
      ],
    },
];
