// ═══════════════════════════════════════════════════════════════════════
//  API 580/581 — Risk-Based Inspection Program Assessment Template
//  With API 510 (Vessels), API 570 (Piping), API 653 (Tanks)
// ═══════════════════════════════════════════════════════════════════════

export const API_RBI_TEMPLATE = {
    code: 'API-RBI-580',
    name: 'API 580/581 — Risk-Based Inspection Program Assessment',
    description: 'Assessment of the RBI program framework covering probability/consequence analysis, risk ranking, inspection planning, and equipment-specific compliance with API 510, 570, and 653.',
    standard_reference: 'API 580/581, API 510, API 570, API 653',
    audit_domain: 'AIM' as const,
    industry: 'OIL_GAS',
    version: '2024.1',
    maturity_scale: 'IAM_0_5',
    total_sections: 0,
    total_questions: 0,
    is_active: true,
};

export const API_RBI_SECTIONS = [
    {
        section: { code: 'RBI-01', title: 'RBI Program Framework', sort_order: 1, weight: 1.2, standard_clause: 'API 580 §5', description: 'Planning, team composition, documentation, and program governance.' },
        questions: [
            { code: 'R1.1', question_text: 'Is there a documented RBI program with defined scope, objectives, and governance structure?', guidance_notes: 'Look for: RBI procedure document, program charter, management endorsement, defined scope of equipment.', evidence_expected: 'RBI program document, management endorsement, scope definition', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'R1.2', question_text: 'Is the RBI team composed of qualified personnel including process engineers, inspection specialists, corrosion engineers, and operations representatives?', guidance_notes: 'API 580 requires multidisciplinary team. Check qualifications (API-510/570/653 certifications).', evidence_expected: 'Team roster with qualifications, certification records', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'R1.3', question_text: 'Is the RBI assessment methodology documented and consistently applied (qualitative, semi-quantitative, or quantitative)?', guidance_notes: 'Verify methodology selection rationale and consistent application across equipment groups.', evidence_expected: 'RBI methodology document, assessment worksheets, software configuration', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
        ]
    },
    {
        section: { code: 'RBI-02', title: 'Consequence Analysis', sort_order: 2, weight: 1.3, standard_clause: 'API 581 §5', description: 'Safety, environmental, and financial consequence evaluation.' },
        questions: [
            { code: 'R2.1', question_text: 'Are consequence categories defined and evaluated for safety (flammable, toxic, asphyxiant), environmental (spill volume, receptor proximity), and financial (production loss, repair cost)?', guidance_notes: 'Each equipment item must have consequence ratings for all three categories.', evidence_expected: 'Consequence analysis worksheets, release scenario modeling', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'R2.2', question_text: 'Are consequence of failure (CoF) calculations based on representative release scenarios and fluid properties?', guidance_notes: 'Check release rate calculations, dispersion modeling, and affected area estimates.', evidence_expected: 'CoF calculations, release scenario documentation, fluid data sheets', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'RBI-03', title: 'Probability Analysis', sort_order: 3, weight: 1.5, standard_clause: 'API 581 §4', description: 'Damage mechanism identification, thinning/cracking analysis, and inspection effectiveness.' },
        questions: [
            { code: 'R3.1', question_text: 'Are applicable damage mechanisms identified for each equipment item based on materials, process conditions, and service history?', guidance_notes: 'Use API 571 as reference for damage mechanism identification. Check completeness of DM screening.', evidence_expected: 'DM screening worksheets, API 571 cross-reference, CML assignment rationale', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'R3.2', question_text: 'Are corrosion rates established based on inspection data, and are they used to calculate remaining life and probability of failure?', guidance_notes: 'Check corrosion rate sources: UT thickness data, coupon data, process modeling. Verify statistical confidence.', evidence_expected: 'Corrosion rate database, UT trending data, remaining life calculations', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'R3.3', question_text: 'Is inspection effectiveness categorized (A through E per API 581) and factored into probability calculations?', guidance_notes: 'Each inspection event should be rated for effectiveness. Higher effectiveness reduces PoF.', evidence_expected: 'Inspection effectiveness ratings, PoF adjustment calculations', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
        ]
    },
    {
        section: { code: 'RBI-04', title: 'Risk Ranking & Inspection Planning', sort_order: 4, weight: 1.3, standard_clause: 'API 580 §7-8', description: 'Risk matrix application, inspection plan development, and interval optimization.' },
        questions: [
            { code: 'R4.1', question_text: 'Is a risk matrix or risk ranking system used to prioritize equipment for inspection, with defined risk acceptance criteria?', guidance_notes: 'Check risk matrix dimensions, color coding, and management-approved acceptance thresholds.', evidence_expected: 'Risk matrix, acceptance criteria document, ranked equipment list', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'R4.2', question_text: 'Are inspection plans developed based on RBI results, specifying inspection scope, methods, coverage, and intervals?', guidance_notes: 'Plans must specify: NDE methods, CML locations, coverage %, scheduled dates, and effectiveness targets.', evidence_expected: 'Inspection plans per equipment, NDE procedure specifications', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'RBI-05', title: 'Equipment-Specific Compliance', sort_order: 5, weight: 1.5, standard_clause: 'API 510/570/653', description: 'Compliance with equipment-specific API inspection standards.' },
        questions: [
            { code: 'R5.1', question_text: 'Are pressure vessels inspected per API 510 requirements, including internal/external inspections within maximum intervals, and is an authorized inspector involved?', guidance_notes: 'API 510: Internal inspection max 10 years (or ½ remaining life). External max 5 years. CRO provisions if applicable.', evidence_expected: 'API 510 compliance matrix, inspection records, AI qualifications', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'R5.2', question_text: 'Is piping inspected per API 570 requirements, including thickness measurements at CMLs and injection point examinations?', guidance_notes: 'API 570: Classify piping circuits by service class. Check CML selection rationale and measurement frequency.', evidence_expected: 'Piping circuit database, CML maps, thickness records, circuit classifications', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'R5.3', question_text: 'Are aboveground storage tanks inspected per API 653, including external inspections, internal inspections, and floor scans within mandated intervals?', guidance_notes: 'API 653: External every 5 years (visual). Internal based on corrosion rate or max 20 years. Floor thickness survey required.', evidence_expected: 'Tank inspection records, floor scan reports, settlement survey data', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
        ]
    },
    {
        section: { code: 'RBI-06', title: 'Program Management & Reassessment', sort_order: 6, weight: 1.0, standard_clause: 'API 580 §9-10', description: 'Data management, reassessment triggers, MOC integration, and continuous improvement.' },
        questions: [
            { code: 'R6.1', question_text: 'Is RBI data managed in a structured system (database/software) with version control and data quality assurance?', guidance_notes: 'Check data integrity, input validation, backup procedures, and integration with inspection/EAM systems.', evidence_expected: 'RBI software/database, data quality procedures, integration architecture', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'R6.2', question_text: 'Is the RBI assessment reassessed when triggered by new inspection data, process changes, damage mechanism updates, or at maximum defined intervals?', guidance_notes: 'Verify reassessment triggers are defined and tracked. Typical interval: 5 years or upon significant changes.', evidence_expected: 'Reassessment trigger log, update records, MOC-to-RBI linkage', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
];
