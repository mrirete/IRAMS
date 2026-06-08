// ═══════════════════════════════════════════════════════════════════════
//  ISO 55001:2024 — Asset Management System Assessment Template
//  Clauses 4–10 (Annex SL High-Level Structure)
//  For CAMA2-certified assessors and Relantern AI
// ═══════════════════════════════════════════════════════════════════════

export const ISO55001_TEMPLATE = {
    code: 'ISO55001-2024',
    name: 'ISO 55001:2024 — Asset Management System Assessment',
    description: 'Full maturity assessment against ISO 55001:2024 requirements (Clauses 4–10). Aligned with IAM maturity scale (0–5) and GFMAM Asset Management Landscape.',
    standard_reference: 'ISO 55001:2024',
    audit_domain: 'AMS' as const,
    industry: 'GENERAL',
    version: '2024.1',
    maturity_scale: 'IAM_0_5',
    total_sections: 0,
    total_questions: 0,
    is_active: true,
};

export const ISO55001_SECTIONS = [
    {
        section: {
            code: '4', title: 'Context of the Organization', sort_order: 1, weight: 1.0,
            standard_clause: 'ISO 55001:2024 Clause 4',
            description: 'Understanding the organization, its context, stakeholders, and the scope of the AMS.',
        },
        questions: [
            { code: 'Q4.1', question_text: 'Has the organization determined external and internal issues relevant to its purpose and strategic direction that affect its ability to achieve the intended outcomes of its asset management system?', guidance_notes: 'Look for: PESTLE analysis, strategic context documents, risk registers referencing external factors (regulatory, market, environmental).', evidence_expected: 'Context analysis document, strategic plan, board minutes', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'Q4.2', question_text: 'Has the organization identified interested parties (stakeholders) relevant to the AMS and determined their needs and expectations?', guidance_notes: 'Look for: Stakeholder register, needs analysis, communication plan.', evidence_expected: 'Stakeholder register, engagement plan', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'Q4.3', question_text: 'Is the scope of the AMS defined and documented, including boundaries and applicability?', guidance_notes: 'The scope must consider asset types, lifecycle stages, organizational boundaries, and outsourced activities.', evidence_expected: 'AMS scope statement, asset portfolio definition', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
            { code: 'Q4.4', question_text: 'Has the organization established, implemented, maintained and continually improved an asset management system?', guidance_notes: 'Assess evidence of a systematic, documented AMS that covers policy, planning, support, operation, evaluation, and improvement.', evidence_expected: 'AMS manual, process maps, management framework document', question_type: 'maturity' as const, is_mandatory: true, sort_order: 4 },
        ]
    },
    {
        section: {
            code: '5', title: 'Leadership', sort_order: 2, weight: 1.2,
            standard_clause: 'ISO 55001:2024 Clause 5',
            description: 'Top management commitment, policy, and organizational roles and responsibilities.',
        },
        questions: [
            { code: 'Q5.1.1', question_text: 'Does top management demonstrate leadership and commitment with respect to the asset management system?', guidance_notes: 'Evidence of active involvement: chairing reviews, resource allocation, communicating importance of AM.', evidence_expected: 'Management review minutes, resource allocation records, leadership communications', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'Q5.1.2', question_text: 'Has top management ensured that the AM policy and objectives are compatible with the strategic direction of the organization?', guidance_notes: 'Check alignment between organizational strategy, SAMP, and AM objectives.', evidence_expected: 'Strategic plan, SAMP, AM objectives with traceability', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'Q5.2', question_text: 'Is there a documented Asset Management Policy that is appropriate, provides a framework for objectives, includes commitment to continual improvement, and is communicated?', guidance_notes: 'Policy must be signed by top management, reviewed periodically, and accessible to all relevant parties.', evidence_expected: 'Signed AM policy, communication records, awareness evidence', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
            { code: 'Q5.3', question_text: 'Are organizational roles, responsibilities and authorities for AM defined, assigned and communicated?', guidance_notes: 'Look for: RACI matrices, job descriptions, organizational charts, competency frameworks.', evidence_expected: 'RACI matrix, org chart, role descriptions, delegation of authority', question_type: 'maturity' as const, is_mandatory: true, sort_order: 4 },
        ]
    },
    {
        section: {
            code: '6', title: 'Planning', sort_order: 3, weight: 1.5,
            standard_clause: 'ISO 55001:2024 Clause 6',
            description: 'Actions to address risks and opportunities, AM objectives, and the SAMP.',
        },
        questions: [
            { code: 'Q6.1', question_text: 'Does the organization address risks and opportunities related to the AMS to ensure intended outcomes, prevent undesired effects, and achieve continual improvement?', guidance_notes: 'Look for: Risk assessment methodology, risk register, opportunity identification process.', evidence_expected: 'Risk register, risk assessment methodology, risk treatment plans', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'Q6.2.1', question_text: 'Has the organization established asset management objectives at relevant functions and levels, and are they measurable and consistent with the AM policy?', guidance_notes: 'Objectives should be SMART, cascaded through the organization, and traceable to strategic objectives.', evidence_expected: 'AM objectives register, KPIs, performance dashboards', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'Q6.2.2', question_text: 'Is there a Strategic Asset Management Plan (SAMP) that documents how organizational objectives translate to AM objectives?', guidance_notes: 'The SAMP is the cornerstone document. It must link organizational strategy to AM activities, lifecycle decisions, and resource plans.', evidence_expected: 'SAMP document, line-of-sight traceability matrix', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
            { code: 'Q6.2.3', question_text: 'Are there documented AM plans that specify activities, resources, responsibilities, timeframes, and methods to achieve AM objectives?', guidance_notes: 'AM plans translate objectives into operational activities. Check for maintenance strategies, capital plans, lifecycle plans.', evidence_expected: 'AM plans, capital investment plans, maintenance strategy documents', question_type: 'maturity' as const, is_mandatory: true, sort_order: 4 },
        ]
    },
    {
        section: {
            code: '7', title: 'Support', sort_order: 4, weight: 1.0,
            standard_clause: 'ISO 55001:2024 Clause 7',
            description: 'Resources, competence, awareness, communication, and documented information.',
        },
        questions: [
            { code: 'Q7.1', question_text: 'Has the organization determined and provided the resources needed for the AMS?', guidance_notes: 'Resources include: people, tools, technology (EAM/CMMS), budget, infrastructure.', evidence_expected: 'Resource plans, budgets, technology roadmap, staffing plans', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'Q7.2', question_text: 'Has the organization determined necessary competence, ensured persons are competent, and taken action to acquire competence where needed?', guidance_notes: 'Look for: Competency frameworks, training plans, qualification records, certification tracking.', evidence_expected: 'Competency matrix, training records, certification database', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'Q7.3', question_text: 'Are relevant persons aware of the AM policy, their contribution to AMS effectiveness, and implications of non-conformance?', guidance_notes: 'Check for awareness programs, induction processes, toolbox talks, AM communications.', evidence_expected: 'Awareness records, induction checklists, communication logs', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
            { code: 'Q7.5', question_text: 'Does the organization control documented information required by the AMS, including creation, update, and control of documents?', guidance_notes: 'Document control process, version management, accessibility, retention policies.', evidence_expected: 'Document management system, document register, control procedures', question_type: 'maturity' as const, is_mandatory: true, sort_order: 4 },
        ]
    },
    {
        section: {
            code: '8', title: 'Operation', sort_order: 5, weight: 1.3,
            standard_clause: 'ISO 55001:2024 Clause 8',
            description: 'Operational planning and control, management of change, and outsourcing.',
        },
        questions: [
            { code: 'Q8.1', question_text: 'Does the organization plan, implement and control processes needed to meet AM objectives and implement actions from planning?', guidance_notes: 'Look for: Work management processes (WO system), preventive/predictive maintenance programs, lifecycle delivery processes.', evidence_expected: 'Work management procedures, PM/PdM programs, WO completion data', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'Q8.2', question_text: 'Has the organization established processes for Management of Change to evaluate and manage risks from planned and unplanned changes?', guidance_notes: 'MOC process must cover: asset modifications, organizational changes, technology changes, regulatory changes.', evidence_expected: 'MOC procedure, MOC register, change impact assessments', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'Q8.3', question_text: 'When outsourcing AM activities, does the organization ensure outsourced processes are controlled and documented?', guidance_notes: 'Contractor management, SLAs, performance monitoring, competency verification for outsourced activities.', evidence_expected: 'Contractor management procedures, SLAs, performance reports', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
        ]
    },
    {
        section: {
            code: '9', title: 'Performance Evaluation', sort_order: 6, weight: 1.2,
            standard_clause: 'ISO 55001:2024 Clause 9',
            description: 'Monitoring, measurement, analysis, evaluation, internal audit, and management review.',
        },
        questions: [
            { code: 'Q9.1', question_text: 'Does the organization monitor, measure, analyze and evaluate asset performance and the AMS effectiveness?', guidance_notes: 'KPIs should cover: availability, reliability, cost, risk, condition, and AMS process effectiveness.', evidence_expected: 'KPI dashboards, performance reports, trend analysis, benchmarking data', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'Q9.2', question_text: 'Does the organization conduct internal audits at planned intervals to provide information on AMS conformity and effectiveness?', guidance_notes: 'Audit program, trained auditors, audit reports, finding closure tracking.', evidence_expected: 'Audit program, audit reports, auditor qualifications, finding register', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'Q9.3', question_text: 'Does top management review the AMS at planned intervals to ensure its continuing suitability, adequacy and effectiveness?', guidance_notes: 'Management review must cover: audit results, stakeholder feedback, process performance, risk changes, improvement opportunities.', evidence_expected: 'Management review minutes, action items, attendance records', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
        ]
    },
    {
        section: {
            code: '10', title: 'Improvement', sort_order: 7, weight: 1.0,
            standard_clause: 'ISO 55001:2024 Clause 10',
            description: 'Nonconformity, corrective action, preventive action, and continual improvement.',
        },
        questions: [
            { code: 'Q10.1', question_text: 'When a nonconformity occurs, does the organization react, evaluate the need for corrective action, implement actions, and review their effectiveness?', guidance_notes: 'Root cause analysis, CAPA process, effectiveness verification, trend analysis of nonconformities.', evidence_expected: 'NCR register, RCA reports, CAPA records, effectiveness reviews', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'Q10.2', question_text: 'Does the organization take preventive action to eliminate potential nonconformities and anticipate risks?', guidance_notes: 'Proactive risk identification, reliability-centered maintenance, predictive analytics, lesson-learned programs.', evidence_expected: 'Risk assessment outputs, RCM/FMEA studies, predictive maintenance program', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'Q10.3', question_text: 'Does the organization continually improve the suitability, adequacy and effectiveness of its asset management and AMS?', guidance_notes: 'Systematic improvement programs, benchmarking, best practice adoption, innovation programs.', evidence_expected: 'Improvement register, benchmarking studies, innovation programs, maturity roadmap', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
        ]
    },
];
