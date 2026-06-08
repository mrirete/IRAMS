/**
 * Mock Integrity data — CMLs, thickness readings, corrosion rates, RBI, damage mechs, FFS, IOW, inspections.
 * Extracted from useIntegrity.ts for centralised management.
 */
import type {
    CML, ThicknessReading, CorrosionRate, RBIAssessment,
    DamageMechanism, FFSAssessment, IOWParameter, InspectionEvent
} from '../types/integrity';

const d = (off: number) => new Date(Date.now() + off * 86400000).toISOString();

export const MOCK_CMLS: CML[] = [
    { id: 'cml-001', asset_id: 'ast-v205', cml_number: 'CML-V205-01', component_type: 'shell', nominal_thickness_mm: 12.7, tmin_mm: 6.35, orientation: '12 o\'clock' },
    { id: 'cml-002', asset_id: 'ast-v205', cml_number: 'CML-V205-02', component_type: 'head', nominal_thickness_mm: 15.9, tmin_mm: 7.95, orientation: 'Top head' },
    { id: 'cml-003', asset_id: 'ast-v205', cml_number: 'CML-V205-03', component_type: 'nozzle', nominal_thickness_mm: 11.1, tmin_mm: 5.55, orientation: 'N1 inlet' },
    { id: 'cml-004', asset_id: 'ast-hx405', cml_number: 'CML-HX405-01', component_type: 'shell', nominal_thickness_mm: 19.05, tmin_mm: 9.52, orientation: '6 o\'clock' },
    { id: 'cml-005', asset_id: 'ast-hx405', cml_number: 'CML-HX405-02', component_type: 'piping_elbow', nominal_thickness_mm: 8.56, tmin_mm: 3.18, orientation: 'Exit elbow' },
    { id: 'cml-006', asset_id: 'ast-p102', cml_number: 'CML-P102-01', component_type: 'piping_straight', nominal_thickness_mm: 7.11, tmin_mm: 3.05, orientation: 'Discharge line' },
    { id: 'cml-007', asset_id: 'ast-tk801', cml_number: 'CML-TK801-01', component_type: 'tank_shell_course', nominal_thickness_mm: 25.4, tmin_mm: 12.7, orientation: 'Course 1' },
    { id: 'cml-008', asset_id: 'ast-tk801', cml_number: 'CML-TK801-02', component_type: 'tank_floor', nominal_thickness_mm: 6.35, tmin_mm: 3.18, orientation: 'NW quadrant' },
    { id: 'cml-009', asset_id: 'ast-k601', cml_number: 'CML-K601-01', component_type: 'shell', nominal_thickness_mm: 38.1, tmin_mm: 19.05, orientation: '3 o\'clock' },
    { id: 'cml-010', asset_id: 'ast-gt301', cml_number: 'CML-GT301-01', component_type: 'piping_tee', nominal_thickness_mm: 9.52, tmin_mm: 4.76, orientation: 'Fuel gas tee' },
];

export const MOCK_READINGS: ThicknessReading[] = [
    { id: 'r-001', cml_id: 'cml-001', reading_date: d(-365), measured_thickness_mm: 11.2, ut_method: 'ut_contact', technician: 'D. Chen' },
    { id: 'r-002', cml_id: 'cml-001', reading_date: d(-180), measured_thickness_mm: 10.9, ut_method: 'ut_contact', technician: 'D. Chen' },
    { id: 'r-003', cml_id: 'cml-001', reading_date: d(-30), measured_thickness_mm: 10.4, ut_method: 'paut', technician: 'M. Okafor' },
    { id: 'r-004', cml_id: 'cml-004', reading_date: d(-200), measured_thickness_mm: 17.8, ut_method: 'ut_contact', technician: 'D. Chen' },
    { id: 'r-005', cml_id: 'cml-004', reading_date: d(-20), measured_thickness_mm: 16.5, ut_method: 'paut', technician: 'D. Chen' },
    { id: 'r-006', cml_id: 'cml-005', reading_date: d(-60), measured_thickness_mm: 4.1, ut_method: 'ut_contact', technician: 'M. Okafor' },
    { id: 'r-007', cml_id: 'cml-007', reading_date: d(-90), measured_thickness_mm: 23.1, ut_method: 'ut_compression', technician: 'A. Burton' },
    { id: 'r-008', cml_id: 'cml-008', reading_date: d(-90), measured_thickness_mm: 3.5, ut_method: 'scan', technician: 'A. Burton' },
    { id: 'r-009', cml_id: 'cml-009', reading_date: d(-45), measured_thickness_mm: 36.8, ut_method: 'paut', technician: 'D. Chen' },
    { id: 'r-010', cml_id: 'cml-006', reading_date: d(-15), measured_thickness_mm: 4.8, ut_method: 'ut_contact', technician: 'M. Okafor' },
];

export const MOCK_CORROSION: CorrosionRate[] = [
    { cml_id: 'cml-001', asset_id: 'ast-v205', short_term_rate_mmpy: 0.30, long_term_rate_mmpy: 0.15, rate_type: 'general', is_accelerating: true, last_reading_date: d(-30) },
    { cml_id: 'cml-004', asset_id: 'ast-hx405', short_term_rate_mmpy: 0.26, long_term_rate_mmpy: 0.22, rate_type: 'general', is_accelerating: false, last_reading_date: d(-20) },
    { cml_id: 'cml-005', asset_id: 'ast-hx405', short_term_rate_mmpy: 0.45, long_term_rate_mmpy: 0.18, rate_type: 'pitting', is_accelerating: true, last_reading_date: d(-60) },
    { cml_id: 'cml-006', asset_id: 'ast-p102', short_term_rate_mmpy: 0.12, long_term_rate_mmpy: 0.10, rate_type: 'general', is_accelerating: false, last_reading_date: d(-15) },
    { cml_id: 'cml-007', asset_id: 'ast-tk801', short_term_rate_mmpy: 0.08, long_term_rate_mmpy: 0.07, rate_type: 'general', is_accelerating: false, last_reading_date: d(-90) },
    { cml_id: 'cml-008', asset_id: 'ast-tk801', short_term_rate_mmpy: 0.35, long_term_rate_mmpy: 0.12, rate_type: 'pitting', is_accelerating: true, last_reading_date: d(-90) },
];

export const MOCK_RBI: RBIAssessment[] = [
    { id: 'rbi-001', asset_id: 'ast-v205', governing_code: 'API 510', pof_score: 4, cof_score: 'C', risk_rank: 'Medium-High', next_inspection_interval_months: 24, next_inspection_due: d(60), assessor: 'S. Jenkins', assessed_date: d(-120) },
    { id: 'rbi-002', asset_id: 'ast-hx405', governing_code: 'API 510', pof_score: 3, cof_score: 'B', risk_rank: 'Medium', next_inspection_interval_months: 36, next_inspection_due: d(180), assessor: 'S. Jenkins', assessed_date: d(-200) },
    { id: 'rbi-003', asset_id: 'ast-tk801', governing_code: 'API 653', pof_score: 5, cof_score: 'A', risk_rank: 'Very High', next_inspection_interval_months: 12, next_inspection_due: d(-10), assessor: 'S. Jenkins', assessed_date: d(-400) },
    { id: 'rbi-004', asset_id: 'ast-p102', governing_code: 'ASME B31.3', pof_score: 2, cof_score: 'D', risk_rank: 'Low', next_inspection_interval_months: 60, next_inspection_due: d(500), assessor: 'N. Nagata', assessed_date: d(-180) },
    { id: 'rbi-005', asset_id: 'ast-k601', governing_code: 'API 510', pof_score: 4, cof_score: 'A', risk_rank: 'High', next_inspection_interval_months: 18, next_inspection_due: d(30), assessor: 'S. Jenkins', assessed_date: d(-300) },
];

export const MOCK_DAMAGE_MECHS: DamageMechanism[] = [
    { id: 'dm-001', api_571_code: '4.3.3', mechanism_name: 'CUI (Corrosion Under Insulation)', description: 'External corrosion on carbon steel beneath wet or damaged insulation in the 50–175°C range.', status: 'active', source: 'engineer_confirmed', affected_asset_ids: ['ast-v205', 'ast-hx405'] },
    { id: 'dm-002', api_571_code: '4.5.3', mechanism_name: 'Sulfidation (H₂S Corrosion)', description: 'High-temperature corrosion in H₂S-containing environments above 260°C.', status: 'susceptible', source: 'historical', affected_asset_ids: ['ast-gt301'] },
    { id: 'dm-003', api_571_code: '5.1.2.3', mechanism_name: 'HIC (Hydrogen-Induced Cracking)', description: 'Blistering and internal cracking from wet H₂S service causing hydrogen charging.', status: 'active', source: 'engineer_confirmed', affected_asset_ids: ['ast-v205'] },
    { id: 'dm-004', api_571_code: '4.2.16', mechanism_name: 'HTHA (High-Temperature Hydrogen Attack)', description: 'Decarburization and fissuring in steels exposed to high temperature/pressure hydrogen.', status: 'latent', source: 'ai_suggested', affected_asset_ids: ['ast-k601'] },
    { id: 'dm-005', api_571_code: '4.5.1', mechanism_name: 'Chloride SCC', description: 'Stress corrosion cracking of austenitic stainless steels in chloride-containing environments.', status: 'susceptible', source: 'ai_suggested', affected_asset_ids: ['ast-hx405'] },
    { id: 'dm-006', api_571_code: '4.3.8', mechanism_name: 'Microbiologically-Influenced Corrosion (MIC)', description: 'Corrosion in stagnant water legs and tank bottoms caused by sulfate-reducing bacteria.', status: 'active', source: 'historical', affected_asset_ids: ['ast-tk801'] },
    { id: 'dm-007', api_571_code: '4.2.7', mechanism_name: 'Erosion-Corrosion', description: 'Metal loss from combined erosion and corrosion in high-velocity or turbulent flow.', status: 'susceptible', source: 'ai_suggested', affected_asset_ids: ['ast-p102'] },
    { id: 'dm-008', api_571_code: '4.3.9', mechanism_name: 'Soil-Side Corrosion', description: 'External corrosion on buried piping and tank bottoms from soil moisture and chemistry.', status: 'active', source: 'engineer_confirmed', affected_asset_ids: ['ast-tk801'] },
];

export const MOCK_FFS: FFSAssessment[] = [
    { id: 'ffs-001', asset_id: 'ast-v205', api_579_part: 'Part 4 — General Metal Loss', level: 'Level 1', status: 'passed', rsf: 0.82, remaining_life_years: 8.5, assessor: 'S. Jenkins', assessed_date: d(-60), recommended_action: 'Continue monitoring. Next assessment in 4 years.' },
    { id: 'ffs-002', asset_id: 'ast-hx405', api_579_part: 'Part 6 — Pitting', level: 'Level 2', status: 'failed', rsf: 0.58, remaining_life_years: 1.2, assessor: 'S. Jenkins', assessed_date: d(-30), recommended_action: 'Weld overlay repair required. Generate WO immediately.' },
    { id: 'ffs-003', asset_id: 'ast-tk801', api_579_part: 'Part 5 — Local Metal Loss', level: 'Level 1', status: 'monitoring', rsf: 0.71, remaining_life_years: 3.0, assessor: 'N. Nagata', assessed_date: d(-90), recommended_action: 'Increase inspection frequency to 6-monthly. Monitor CML-TK801-02.' },
];

export const MOCK_IOW: IOWParameter[] = [
    { id: 'iow-001', asset_id: 'ast-v205', parameter_name: 'Operating Temperature', iow_type: 'critical', unit: '°C', low_limit: 50, high_limit: 175, current_value: 168, breach_status: 'alert', last_breach_date: d(-5) },
    { id: 'iow-002', asset_id: 'ast-v205', parameter_name: 'Operating Pressure', iow_type: 'critical', unit: 'barg', low_limit: null, high_limit: 45, current_value: 38, breach_status: 'normal', last_breach_date: null },
    { id: 'iow-003', asset_id: 'ast-hx405', parameter_name: 'Shell-Side Inlet Temp', iow_type: 'standard', unit: '°C', low_limit: null, high_limit: 320, current_value: 335, breach_status: 'breach', last_breach_date: d(-1) },
    { id: 'iow-004', asset_id: 'ast-tk801', parameter_name: 'Product pH', iow_type: 'standard', unit: 'pH', low_limit: 5.5, high_limit: 8.5, current_value: 6.8, breach_status: 'normal', last_breach_date: null },
    { id: 'iow-005', asset_id: 'ast-k601', parameter_name: 'Vibration Level', iow_type: 'critical', unit: 'mm/s RMS', low_limit: null, high_limit: 11.2, current_value: 14.8, breach_status: 'breach', last_breach_date: d(0) },
    { id: 'iow-006', asset_id: 'ast-gt301', parameter_name: 'Exhaust Gas Temp', iow_type: 'informational', unit: '°C', low_limit: null, high_limit: 620, current_value: 595, breach_status: 'normal', last_breach_date: null },
];

export const MOCK_INSPECTIONS: InspectionEvent[] = [
    {
        id: 'insp-001', asset_id: 'ast-v205', asset_name: 'Separator V-205', inspection_type: 'UT', governing_code: 'API 510',
        scheduled_date: d(3), status: 'scheduled', approval_mode: 'simple', findings_count: 0, inspector: 'D. Chen',
        description: 'Scheduled UT thickness survey — Shell courses 1–4 and heads', location_description: 'V-205 Shell & Heads',
        team: [], findings: [], notes: [],
    },
    {
        id: 'insp-002', asset_id: 'ast-hx405', asset_name: 'Heat Exchanger HX-405', inspection_type: 'PAUT', governing_code: 'API 510',
        scheduled_date: d(-5), status: 'overdue', approval_mode: 'two_step', findings_count: 0, inspector: 'M. Okafor',
        description: 'Phased array UT of tube sheet and shell nozzle welds', location_description: 'HX-405 Tube Sheet',
        team: [
            { id: 'tm-001', user_id: 'usr-okafor', name: 'M. Okafor', role: 'lead_inspector', certification: 'ASNT Level II UT', added_at: d(-10) },
        ], findings: [], notes: [],
    },
    {
        id: 'insp-003', asset_id: 'ast-tk801', asset_name: 'Storage Tank TK-801', inspection_type: 'MFL', governing_code: 'API 653',
        scheduled_date: d(10), status: 'scheduled', approval_mode: 'two_step', findings_count: 0, inspector: 'A. Burton',
        description: 'Magnetic flux leakage floor scan — full tank bottom', location_description: 'TK-801 Floor Plates',
        team: [], findings: [], notes: [],
    },
    {
        id: 'insp-004', asset_id: 'ast-k601', asset_name: 'Compressor K-601', inspection_type: 'VT', governing_code: 'API 510',
        scheduled_date: d(-30), started_date: d(-30), completed_date: d(-29), status: 'completed', approval_mode: 'simple',
        findings_count: 3, inspector: 'S. Jenkins',
        description: 'Visual inspection of pressure casing, nozzles, and foundation bolts',
        location_description: 'K-601 Casing & Foundation',
        team: [
            { id: 'tm-002', user_id: 'usr-jenkins', name: 'S. Jenkins', role: 'lead_inspector', certification: 'API 510', added_at: d(-35) },
            { id: 'tm-003', user_id: 'usr-chen', name: 'D. Chen', role: 'nde_technician', certification: 'ASNT Level II UT', added_at: d(-35) },
        ],
        findings: [
            {
                id: 'fnd-001', inspection_id: 'insp-004', sequence: 1,
                description: 'Surface corrosion observed on discharge nozzle flange face. Approximately 15% of gasket seating surface affected. No active leak detected.',
                severity: 'moderate', status: 'actioned', damage_mechanism_id: 'dm-001', damage_mechanism_name: 'CUI (Corrosion Under Insulation)',
                nde_method: 'VT', recommendation: 'Dress flange face during next turnaround. Replace gasket.',
                action_required: true, media_urls: [], created_by: 'S. Jenkins', created_at: d(-30),
            },
            {
                id: 'fnd-002', inspection_id: 'insp-004', sequence: 2,
                description: 'Foundation bolt on NE corner shows 2mm lateral displacement from baseline. Torque check reads 85% of specification.',
                severity: 'minor', status: 'open', nde_method: 'VT',
                recommendation: 'Re-torque to specification. Add to vibration monitoring watch list.',
                action_required: false, media_urls: [], created_by: 'S. Jenkins', created_at: d(-30),
            },
            {
                id: 'fnd-003', inspection_id: 'insp-004', sequence: 3,
                description: 'Paint coating delamination on lower casing quadrant. Substrate steel appears sound — no measurable wall loss.',
                severity: 'observation', status: 'closed', nde_method: 'VT',
                recommendation: 'Include in next painting campaign scope.',
                action_required: false, media_urls: [], created_by: 'D. Chen', created_at: d(-30),
            },
        ],
        notes: [
            { id: 'note-001', inspection_id: 'insp-004', content: 'Weather clear, 22°C. Good visibility. Unit was online during inspection — vibration levels within IOW.', note_type: 'general', created_by: 'S. Jenkins', created_at: d(-30) },
            { id: 'note-002', inspection_id: 'insp-004', content: 'CUI suspected at nozzle N2 — recommend insulation removal and UT at next shutdown.', note_type: 'observation', created_by: 'S. Jenkins', created_at: d(-30) },
        ],
        weather_conditions: 'Clear, 22°C, wind 5 km/h NW',
    },
    {
        id: 'insp-005', asset_id: 'ast-p102', asset_name: 'Pump P-102', inspection_type: 'PT', governing_code: 'ASME B31.3',
        scheduled_date: d(15), status: 'scheduled', approval_mode: 'simple', findings_count: 0, inspector: 'M. Okafor',
        description: 'Dye penetrant test on discharge piping welds', location_description: 'P-102 Discharge Line Welds',
        team: [], findings: [], notes: [],
    },
    {
        id: 'insp-006', asset_id: 'ast-v205', asset_name: 'Separator V-205', inspection_type: 'RT',
        scheduled_date: d(-60), started_date: d(-60), completed_date: d(-59), status: 'completed', approval_mode: 'simple',
        findings_count: 1, inspector: 'D. Chen',
        description: 'Radiographic inspection of N1 inlet nozzle weld', location_description: 'V-205 Nozzle N1 Weld',
        team: [
            { id: 'tm-004', user_id: 'usr-chen', name: 'D. Chen', role: 'lead_inspector', certification: 'ASNT Level II RT', added_at: d(-65) },
        ],
        findings: [
            {
                id: 'fnd-004', inspection_id: 'insp-006', sequence: 1,
                description: 'Minor porosity cluster detected in root pass of nozzle N1 weld. Max pore diameter 1.2mm. Within ASME Section VIII acceptance criteria.',
                severity: 'minor', status: 'closed', nde_method: 'RT', cml_id: 'cml-003', cml_number: 'CML-V205-03',
                recommendation: 'Acceptable per code. Monitor at next scheduled RT.',
                action_required: false, media_urls: [], created_by: 'D. Chen', created_at: d(-60),
            },
        ],
        notes: [
            { id: 'note-003', inspection_id: 'insp-006', content: 'Ir-192 source, film density 2.3, IQI sensitivity 2-2T achieved. All exposures meet ASME V T-285 requirements.', note_type: 'observation', created_by: 'D. Chen', created_at: d(-60) },
        ],
    },
    {
        id: 'insp-007', asset_id: 'ast-gt301', asset_name: 'Gas Turbine GT-301', inspection_type: 'MT',
        scheduled_date: d(7), status: 'scheduled', approval_mode: 'simple', findings_count: 0, inspector: 'A. Burton',
        description: 'Magnetic particle inspection of turbine exhaust duct welds', location_description: 'GT-301 Exhaust Duct',
        team: [], findings: [], notes: [],
    },
    {
        id: 'insp-008', asset_id: 'ast-hx405', asset_name: 'Heat Exchanger HX-405', inspection_type: 'VT',
        scheduled_date: d(-15), started_date: d(-15), completed_date: d(-14), status: 'completed', approval_mode: 'simple',
        findings_count: 2, inspector: 'D. Chen',
        description: 'External visual inspection of shell, saddles, and piping connections', location_description: 'HX-405 External',
        team: [
            { id: 'tm-005', user_id: 'usr-chen', name: 'D. Chen', role: 'lead_inspector', certification: 'API 510', added_at: d(-20) },
        ],
        findings: [
            {
                id: 'fnd-005', inspection_id: 'insp-008', sequence: 1,
                description: 'Insulation jacketing damaged at 6 o\'clock position. Moisture ingress suspected — potential CUI zone.',
                severity: 'major', status: 'actioned', damage_mechanism_id: 'dm-001', damage_mechanism_name: 'CUI (Corrosion Under Insulation)',
                nde_method: 'VT', recommendation: 'Remove insulation in affected zone. Perform UT thickness survey.',
                action_required: true, media_urls: [], created_by: 'D. Chen', created_at: d(-15),
            },
            {
                id: 'fnd-006', inspection_id: 'insp-008', sequence: 2,
                description: 'Exit elbow CML-HX405-02 approaching Tmin. Latest UT reading 4.1mm vs Tmin 3.18mm. Short-term rate accelerating.',
                severity: 'critical', status: 'actioned', damage_mechanism_id: 'dm-007', damage_mechanism_name: 'Erosion-Corrosion',
                cml_id: 'cml-005', cml_number: 'CML-HX405-02', measurement_value: 4.1, measurement_unit: 'mm',
                nde_method: 'VT', recommendation: 'Immediate FFS assessment required per API 579 Part 5. Consider elbow replacement.',
                action_required: true, media_urls: [], created_by: 'D. Chen', created_at: d(-15),
            },
        ],
        notes: [
            { id: 'note-004', inspection_id: 'insp-008', content: 'Saddle support bolts intact. No visible settlement. Paint condition fair.', note_type: 'general', created_by: 'D. Chen', created_at: d(-15) },
        ],
    },
    {
        id: 'insp-009', asset_id: 'ast-tk801', asset_name: 'Storage Tank TK-801', inspection_type: 'UT', governing_code: 'API 653',
        scheduled_date: d(25), status: 'scheduled', approval_mode: 'two_step', findings_count: 0, inspector: 'D. Chen',
        description: 'UT thickness survey — shell courses 1–6 and annular ring', location_description: 'TK-801 Shell Courses',
        team: [], findings: [], notes: [],
    },
    {
        id: 'insp-010', asset_id: 'ast-esd990', asset_name: 'ESD Valve ESD-990', inspection_type: 'VT',
        scheduled_date: d(-3), started_date: d(-3), completed_date: d(-3), status: 'completed', approval_mode: 'simple',
        findings_count: 0, inspector: 'N. Nagata',
        description: 'Visual inspection and partial stroke test', location_description: 'ESD-990 Valve Body',
        team: [], findings: [], notes: [
            { id: 'note-005', inspection_id: 'insp-010', content: 'Partial stroke test passed — 30% travel achieved in 2.1 seconds (target <3s). No external corrosion or leakage detected.', note_type: 'general', created_by: 'N. Nagata', created_at: d(-3) },
        ],
    },
    {
        id: 'insp-011', asset_id: 'ast-k601', asset_name: 'Compressor K-601', inspection_type: 'UT',
        scheduled_date: d(20), status: 'scheduled', approval_mode: 'simple', findings_count: 0, inspector: 'M. Okafor',
        description: 'UT thickness survey of pressure casing CMLs', location_description: 'K-601 Casing CMLs',
        team: [], findings: [], notes: [],
    },
    {
        id: 'insp-012', asset_id: 'ast-v205', asset_name: 'Separator V-205', inspection_type: 'PAUT', governing_code: 'API 510',
        scheduled_date: d(45), status: 'scheduled', approval_mode: 'two_step', findings_count: 0, inspector: 'D. Chen',
        description: 'Phased array UT of longitudinal weld seams — full mapping', location_description: 'V-205 Longitudinal Welds',
        team: [], findings: [], notes: [],
    },
];

