// ═══════════════════════════════════════════════════════════════════════
//  PSM 14 Elements — OSHA 1910.119 Process Safety Management Template
//  For Oil & Gas, Chemical, and Petrochemical operations
// ═══════════════════════════════════════════════════════════════════════

export const PSM14_TEMPLATE = {
    code: 'PSM-14-OSHA',
    name: 'OSHA 1910.119 — Process Safety Management (14 Elements)',
    description: 'Full compliance audit against all 14 elements of the OSHA Process Safety Management standard. Applicable to facilities handling highly hazardous chemicals.',
    standard_reference: 'OSHA 29 CFR 1910.119',
    audit_domain: 'PSM' as const,
    industry: 'OIL_GAS',
    version: '2024.1',
    maturity_scale: 'IAM_0_5',
    total_sections: 0,
    total_questions: 0,
    is_active: true,
};

export const PSM14_SECTIONS = [
    {
        section: { code: 'PSM-01', title: '1. Employee Participation', sort_order: 1, weight: 0.8, standard_clause: '1910.119(c)', description: 'Written plan of action for employee participation in PSM activities.' },
        questions: [
            { code: 'P1.1', question_text: 'Is there a written plan of action for employee participation in PSM program development and conduct?', guidance_notes: 'Verify documented plan exists and is communicated.', evidence_expected: 'Written participation plan, communication records', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P1.2', question_text: 'Do employees have access to PHA results, PSI, and other relevant PSM information?', guidance_notes: 'Check accessibility of documents and awareness among operators.', evidence_expected: 'Access records, employee interviews, document locations', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'PSM-02', title: '2. Process Safety Information (PSI)', sort_order: 2, weight: 1.0, standard_clause: '1910.119(d)', description: 'Complete and accurate information on hazards, technology, and equipment.' },
        questions: [
            { code: 'P2.1', question_text: 'Is there compiled PSI on the hazards of chemicals used or produced, including SDSs, permissible exposure limits, physical and reactivity data?', guidance_notes: 'Verify completeness of chemical hazard data.', evidence_expected: 'SDS library, chemical inventory, hazard data sheets', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P2.2', question_text: 'Is process technology information documented including block flow diagrams, process chemistry, safe operating limits, and consequence of deviations?', guidance_notes: 'Check for documented safe upper/lower limits for all critical parameters.', evidence_expected: 'PFDs, P&IDs, operating envelopes, deviation matrices', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'P2.3', question_text: 'Is equipment information documented including materials of construction, P&IDs, electrical classifications, relief system design, and ventilation system design?', guidance_notes: 'Equipment data must be current and reflect as-built conditions.', evidence_expected: 'Equipment data sheets, P&IDs (as-built), relief valve register', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
        ]
    },
    {
        section: { code: 'PSM-03', title: '3. Process Hazard Analysis (PHA)', sort_order: 3, weight: 1.5, standard_clause: '1910.119(e)', description: 'Systematic evaluation of potential hazards associated with processes.' },
        questions: [
            { code: 'P3.1', question_text: 'Has the employer performed an initial PHA appropriate to the complexity of the process using a recognized methodology (HAZOP, What-If, Checklist, FMEA)?', guidance_notes: 'Verify methodology is appropriate for process complexity. HAZOP preferred for complex processes.', evidence_expected: 'PHA reports, methodology selection rationale', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P3.2', question_text: 'Does the PHA address hazards of the process, previous incidents, engineering and administrative controls, consequences of failure, facility siting, human factors, and qualitative evaluation of safeguards?', guidance_notes: 'Each PHA must cover all mandatory topics per 1910.119(e)(2).', evidence_expected: 'PHA worksheets covering all required topics', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'P3.3', question_text: 'Are PHAs updated and revalidated at least every 5 years?', guidance_notes: 'Check revalidation dates against 5-year cycle. Verify methodology and team composition.', evidence_expected: 'PHA revalidation schedule, completed revalidation reports', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
            { code: 'P3.4', question_text: 'Are PHA recommendations resolved and documented in a timely manner?', guidance_notes: 'Track action item closure rates and overdue items.', evidence_expected: 'Action tracking register, closure rates, overdue analysis', question_type: 'maturity' as const, is_mandatory: true, sort_order: 4 },
        ]
    },
    {
        section: { code: 'PSM-04', title: '4. Operating Procedures', sort_order: 4, weight: 1.0, standard_clause: '1910.119(f)', description: 'Written operating procedures for each covered process.' },
        questions: [
            { code: 'P4.1', question_text: 'Are written operating procedures in place that provide clear instructions for safely conducting activities for each covered process, including steps for each operating phase?', guidance_notes: 'Procedures must cover: startup, normal, temporary, emergency shutdown, and startup after turnaround.', evidence_expected: 'SOPs for each operating phase, procedure index', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P4.2', question_text: 'Are operating procedures reviewed and certified annually as current and accurate?', guidance_notes: 'Check annual review signatures and dates. Verify procedures reflect current operations.', evidence_expected: 'Annual certification records, review signatures', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'PSM-05', title: '5. Training', sort_order: 5, weight: 1.0, standard_clause: '1910.119(g)', description: 'Initial and refresher training for employees in covered processes.' },
        questions: [
            { code: 'P5.1', question_text: 'Is initial training provided to each employee currently involved in operating a covered process, emphasizing specific safety and health hazards, emergency operations, and safe work practices?', guidance_notes: 'Training must be process-specific, not generic safety.', evidence_expected: 'Training records, curricula, competency assessments', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P5.2', question_text: 'Is refresher training provided at least every 3 years, and is training documentation maintained?', guidance_notes: 'Check 3-year cycle compliance and documentation completeness.', evidence_expected: 'Refresher training schedule, attendance records, competency records', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'PSM-06', title: '6. Contractors', sort_order: 6, weight: 0.8, standard_clause: '1910.119(h)', description: 'Contractor safety management for covered processes.' },
        questions: [
            { code: 'P6.1', question_text: 'Does the employer obtain and evaluate contract employer safety performance and programs when selecting contractors?', guidance_notes: 'Pre-qualification process, safety statistics evaluation, past performance review.', evidence_expected: 'Contractor pre-qualification records, safety performance data', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P6.2', question_text: 'Are contract employees trained in safe work practices, emergency procedures, and known potential fire/explosion/toxic release hazards?', guidance_notes: 'Verify contractor orientation and process-specific training.', evidence_expected: 'Contractor training records, orientation checklists', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'PSM-07', title: '7. Pre-Startup Safety Review (PSSR)', sort_order: 7, weight: 1.0, standard_clause: '1910.119(i)', description: 'Safety review before introducing HHC to a new or modified facility.' },
        questions: [
            { code: 'P7.1', question_text: 'Is a PSSR performed for new facilities and for modified facilities when the modification is significant enough to require a change in PSI?', guidance_notes: 'PSSR must confirm: construction meets design specs, safety/operating/maintenance procedures are in place, PHA is complete, training is complete.', evidence_expected: 'PSSR checklists, sign-off records, completion certificates', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
        ]
    },
    {
        section: { code: 'PSM-08', title: '8. Mechanical Integrity', sort_order: 8, weight: 1.5, standard_clause: '1910.119(j)', description: 'Ongoing integrity of process equipment through inspection, testing, and preventive maintenance.' },
        questions: [
            { code: 'P8.1', question_text: 'Are written procedures established and maintained for the ongoing integrity of process equipment including pressure vessels, storage tanks, piping systems, relief/vent systems, controls, and emergency shutdown systems?', guidance_notes: 'Procedures must cover: inspection frequency, test methods, acceptance criteria, documentation requirements.', evidence_expected: 'MI procedures, inspection standards, equipment lists', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P8.2', question_text: 'Are inspections and tests performed on process equipment at frequencies consistent with applicable codes and standards (API 510, 570, 653)?', guidance_notes: 'Check inspection records against API/ASME frequencies. Verify qualified inspectors.', evidence_expected: 'Inspection records, API compliance matrix, inspector qualifications', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
            { code: 'P8.3', question_text: 'Are deficiencies in equipment corrected in a safe and timely manner, and is equipment suitable for the process application?', guidance_notes: 'Track deficiency identification to correction. Verify fitness-for-service evaluations.', evidence_expected: 'Deficiency tracking, repair records, FFS assessments', question_type: 'maturity' as const, is_mandatory: true, sort_order: 3 },
        ]
    },
    {
        section: { code: 'PSM-09', title: '9. Hot Work Permit', sort_order: 9, weight: 0.6, standard_clause: '1910.119(k)', description: 'Permit system for hot work operations in or near covered processes.' },
        questions: [
            { code: 'P9.1', question_text: 'Is a hot work permit issued for all hot work operations conducted on or near a covered process, documenting fire prevention and protection requirements?', guidance_notes: 'Verify permit content, authorization, fire watch requirements, and atmospheric monitoring.', evidence_expected: 'Hot work permits, fire watch logs, atmospheric test records', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
        ]
    },
    {
        section: { code: 'PSM-10', title: '10. Management of Change (MOC)', sort_order: 10, weight: 1.3, standard_clause: '1910.119(l)', description: 'Procedures for managing changes to process chemicals, technology, equipment, and procedures.' },
        questions: [
            { code: 'P10.1', question_text: 'Are written procedures established to manage changes (except replacements in kind) to process chemicals, technology, equipment, procedures, and facilities?', guidance_notes: 'MOC must address: technical basis, safety/health impacts, modifications to procedures, necessary time period, authorization requirements.', evidence_expected: 'MOC procedure, MOC register, impact assessments', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P10.2', question_text: 'Are affected employees informed of and trained on the change prior to startup?', guidance_notes: 'Verify communication and training records for each MOC.', evidence_expected: 'MOC communication records, training logs, employee acknowledgements', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'PSM-11', title: '11. Incident Investigation', sort_order: 11, weight: 1.2, standard_clause: '1910.119(m)', description: 'Investigation of incidents resulting in or which could reasonably have resulted in a catastrophic release.' },
        questions: [
            { code: 'P11.1', question_text: 'Are incidents that resulted in or could reasonably have resulted in a catastrophic release investigated within 48 hours?', guidance_notes: 'Check timeliness of investigation initiation and team assembly.', evidence_expected: 'Incident investigation reports, timeline records', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P11.2', question_text: 'Does each investigation identify contributing factors and recommendations, and are findings communicated to affected personnel and resolved promptly?', guidance_notes: 'Look for: root cause analysis, recommendation tracking, communication records.', evidence_expected: 'Investigation reports with root causes, action tracking, communication logs', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'PSM-12', title: '12. Emergency Planning & Response', sort_order: 12, weight: 1.0, standard_clause: '1910.119(n)', description: 'Emergency action plan for the entire plant.' },
        questions: [
            { code: 'P12.1', question_text: 'Has the employer established and implemented an emergency action plan for the entire plant, including procedures for handling small releases?', guidance_notes: 'Plan must comply with 29 CFR 1910.38. Verify drill frequency and participation.', evidence_expected: 'Emergency response plan, drill records, muster point procedures', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
        ]
    },
    {
        section: { code: 'PSM-13', title: '13. Compliance Audits', sort_order: 13, weight: 1.0, standard_clause: '1910.119(o)', description: 'Evaluation of compliance with PSM provisions at least every 3 years.' },
        questions: [
            { code: 'P13.1', question_text: 'Does the employer certify that compliance audits are conducted at least every 3 years to verify PSM program effectiveness?', guidance_notes: 'Check audit schedule, team qualifications, and finding resolution.', evidence_expected: 'Audit schedule, audit reports, 3-year compliance matrix', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
            { code: 'P13.2', question_text: 'Are audit findings promptly addressed and documented, and is the most recent audit report retained?', guidance_notes: 'Verify finding closure rates and retention of two most recent audit reports.', evidence_expected: 'Finding closure tracking, retained audit reports', question_type: 'maturity' as const, is_mandatory: true, sort_order: 2 },
        ]
    },
    {
        section: { code: 'PSM-14', title: '14. Trade Secrets', sort_order: 14, weight: 0.5, standard_clause: '1910.119(p)', description: 'Access to trade secret information for PSM compliance.' },
        questions: [
            { code: 'P14.1', question_text: 'Does the employer make all information necessary to comply with the PSM standard available to those persons responsible for compiling PSI, PHA, and other PSM elements, regardless of trade secret claims?', guidance_notes: 'Verify that trade secret protections do not impede PSM compliance activities.', evidence_expected: 'Confidentiality agreements, access records, information sharing policy', question_type: 'maturity' as const, is_mandatory: true, sort_order: 1 },
        ]
    },
];
