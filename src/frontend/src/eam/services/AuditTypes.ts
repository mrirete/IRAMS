/**
 * AuditTypes.ts — Shared types for the 7-Step Integrated Audit Engine
 *
 * Steps:
 *  1. Intake & Scope Definition (ISO 55001 §4 + ISO 55000 Series Alignment)
 *  2. Pre-Audit Document Review
 *  3. Site Verification
 *  4. Interviews
 *  5. 6M Root-Cause Assessment (AI)
 *  6. Score Findings
 *  7. Report & Closeout
 *
 * Standards: ISO 55000:2024, ISO 55001:2024, ISO 55002:2024,
 *            ISO 55010:2024, ISO 55011:2024, ISO 55012:2024, ISO 55013:2024,
 *            API RP 754, API RP 75, ASME BPVC, CAMA2/GFMAM
 */

// ═══════════════════════════════════════════════════════════════
//  ENUMS & CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const AUDIT_STEPS = [
    { step: 1, key: 'intake',       label: 'Intake & Scope',       shortLabel: 'Intake',     icon: 'ClipboardList',   description: 'Assessor registration, audit scope, and organizational context' },
    { step: 2, key: 'documents',    label: 'Document Review',      shortLabel: 'Documents',  icon: 'FileSearch',      description: 'Pre-audit document request and status tracking' },
    { step: 3, key: 'site',         label: 'Site Verification',    shortLabel: 'Site Walk',  icon: 'HardHat',         description: 'Field walkdown observations and condition assessment' },
    { step: 4, key: 'interviews',   label: 'Interviews',           shortLabel: 'Interviews', icon: 'MessageSquare',   description: 'Department interviews to validate system-in-practice' },
    { step: 5, key: 'sixm',         label: '6M Assessment',        shortLabel: '6M',         icon: 'Sparkles',        description: 'AI-powered root-cause analysis across 6 dimensions' },
    { step: 6, key: 'findings',     label: 'Score Findings',       shortLabel: 'Findings',   icon: 'Target',          description: 'Risk-rated finding register with impact analysis' },
    { step: 7, key: 'report',       label: 'Report & Closeout',    shortLabel: 'Report',     icon: 'FileText',        description: '5-part report with roadmap and maturity scorecard' },
] as const;

/** Streamlined 5-step assessment flow for client self-service (entry-level marketing tool) */
export const ASSESSMENT_STEPS = [
    { step: 1, key: 'intake',       label: 'Intake & Scope',       shortLabel: 'Intake',     icon: 'ClipboardList',   description: 'Your details, audit scope, and organizational context' },
    { step: 2, key: 'documents',    label: 'Document Readiness',   shortLabel: 'Documents',  icon: 'FileSearch',      description: 'Quick document availability check — Yes / No / Partial / N/A' },
    { step: 3, key: 'sixm',         label: '6M Assessment',        shortLabel: '6M',         icon: 'Sparkles',        description: 'Guided maturity assessment across 6 dimensions' },
    { step: 4, key: 'findings',     label: 'Score Findings',       shortLabel: 'Findings',   icon: 'Target',          description: 'AI-generated findings with risk-rated scoring' },
    { step: 5, key: 'report',       label: 'Report & Roadmap',     shortLabel: 'Report',     icon: 'FileText',        description: 'Maturity report with improvement roadmap' },
] as const;

export type AuditStepKey = typeof AUDIT_STEPS[number]['key'];

/** Colleague invitation for collaborative assessments */
export interface AssessmentCollaborator {
    id: string;
    assessmentId: string;
    email: string;
    role: 'viewer' | 'contributor';
    status: 'pending' | 'accepted' | 'declined';
    inviteToken: string;
    invitedBy: string;
    invitedAt: string;
    acceptedAt?: string;
}

export const INDUSTRY_OPTIONS = [
    { value: 'Oil & Gas (Upstream)',   label: 'Oil & Gas — Upstream' },
    { value: 'Oil & Gas (Midstream)',  label: 'Oil & Gas — Midstream' },
    { value: 'Oil & Gas (Downstream)', label: 'Oil & Gas — Downstream' },
    { value: 'Manufacturing',          label: 'Manufacturing' },
    { value: 'Mining & Minerals',      label: 'Mining & Minerals' },
    { value: 'Power Generation',       label: 'Power Generation' },
    { value: 'Utilities',              label: 'Utilities' },
    { value: 'Pharmaceutical',         label: 'Pharmaceutical' },
    { value: 'Food & Beverage',        label: 'Food & Beverage' },
    { value: 'Other',                  label: 'Other' },
] as const;

// Industry-specific key risk areas for checkbox selection (ISO 31000 risk categories)
export const INDUSTRY_RISK_MAP: Record<string, string[]> = {
    'Oil & Gas (Upstream)': [
        'Aging infrastructure & corrosion',
        'Process safety / Tier 1 events',
        'Well integrity & blowout prevention',
        'Rotating equipment reliability',
        'Environmental compliance (flaring, spills)',
        'Remote location logistics',
        'Subsea / offshore structural integrity',
        'Contractor safety management',
    ],
    'Oil & Gas (Midstream)': [
        'Pipeline integrity & corrosion',
        'Compressor station reliability',
        'SCADA / control system cyber risk',
        'Right-of-way & third-party damage',
        'Process safety / Tier 1 events',
        'Environmental compliance (leaks, emissions)',
        'Cathodic protection failures',
        'Emergency response readiness',
    ],
    'Oil & Gas (Downstream)': [
        'Process safety / Tier 1 events',
        'Turnaround & shutdown execution',
        'Heat exchanger / furnace degradation',
        'Rotating equipment reliability',
        'Environmental compliance (emissions)',
        'Aging infrastructure & corrosion',
        'Instrumented safety systems (SIS/SIL)',
        'Fire & gas detection systems',
    ],
    'Manufacturing': [
        'Production line downtime',
        'Preventive maintenance backlog',
        'Spare parts obsolescence',
        'Electrical system reliability',
        'Workplace safety (OSHA compliance)',
        'Quality control equipment drift',
        'Energy efficiency & consumption',
        'Supply chain disruption',
    ],
    'Mining & Minerals': [
        'Heavy mobile equipment reliability',
        'Slope stability & ground control',
        'Conveyor system failures',
        'Dust / ventilation management',
        'Tailings dam integrity',
        'Crusher & mill availability',
        'Environmental rehabilitation',
        'Remote site workforce safety',
    ],
    'Power Generation': [
        'Turbine / generator reliability',
        'Boiler & pressure vessel integrity',
        'Grid stability & dispatch compliance',
        'Environmental emissions (SOx, NOx)',
        'Fuel supply chain risk',
        'Cooling system reliability',
        'Switchgear & transformer aging',
        'Renewable integration challenges',
    ],
    'Utilities': [
        'Water treatment system reliability',
        'Distribution network leakage',
        'Aging buried infrastructure',
        'SCADA / cyber security',
        'Regulatory compliance (water quality)',
        'Pump station reliability',
        'Storm/flood resilience',
        'Customer service disruption',
    ],
    'Pharmaceutical': [
        'GMP / cleanroom equipment compliance',
        'Calibration & validation drift',
        'HVAC / environmental controls',
        'Batch process equipment reliability',
        'Data integrity (21 CFR Part 11)',
        'Cold chain / storage systems',
        'Contamination prevention',
        'Regulatory audit readiness',
    ],
    'Food & Beverage': [
        'Food safety / HACCP compliance',
        'Refrigeration system reliability',
        'Packaging line downtime',
        'CIP (Clean-in-Place) system integrity',
        'Allergen cross-contamination risk',
        'Energy & water efficiency',
        'Pest control infrastructure',
        'Supply chain traceability',
    ],
    'Other': [
        'Aging infrastructure',
        'Process safety',
        'Equipment reliability',
        'Environmental compliance',
        'Regulatory readiness',
        'Workforce safety',
        'Cyber / OT security',
        'Spare parts availability',
    ],
};

// Industry-specific opportunities for checkbox selection (ISO 55001:2024 §6.1)
export const INDUSTRY_OPPORTUNITY_MAP: Record<string, string[]> = {
    'Oil & Gas (Upstream)': [
        'Predictive maintenance on rotating equipment',
        'Digital twin for well integrity monitoring',
        'Condition-based monitoring (vibration, thermography)',
        'Turnaround optimization through RCM',
        'Drone / robotic inspection for remote assets',
        'Standardized failure coding (ISO 14224)',
    ],
    'Oil & Gas (Midstream)': [
        'Inline inspection (ILI) program optimization',
        'Predictive analytics for compressor health',
        'Remote SCADA monitoring expansion',
        'Cathodic protection performance trending',
        'Spare parts rationalization across stations',
        'Digital pipeline integrity management',
    ],
    'Oil & Gas (Downstream)': [
        'Risk-based inspection (RBI) maturity uplift',
        'Turnaround scope optimization (value engineering)',
        'Reliability-centered maintenance program',
        'Advanced corrosion monitoring (UT, CML)',
        'SIL verification & proof test optimization',
        'Energy efficiency through heat integration',
    ],
    'Manufacturing': [
        'OEE improvement through TPM deployment',
        'Predictive quality via sensor integration',
        'Spare parts inventory optimization (MRP)',
        'Energy management system (ISO 50001)',
        'Automation & robotics for repetitive tasks',
        'Lean maintenance program implementation',
    ],
    'Mining & Minerals': [
        'Fleet management system optimization',
        'Predictive analytics for crusher/mill health',
        'Conveyor condition monitoring expansion',
        'Autonomous haulage opportunities',
        'Tailings management technology upgrade',
        'Workforce competency development (SAMP)',
    ],
    'Power Generation': [
        'Outage optimization through planning maturity',
        'Condition monitoring for turbine/generator',
        'Grid flexibility via battery/storage integration',
        'Emissions reduction through combustion tuning',
        'Digital twin for boiler performance',
        'Renewable portfolio diversification',
    ],
    'Utilities': [
        'Smart metering & leak detection deployment',
        'Asset renewal planning (pipe replacement)',
        'SCADA modernization & cyber hardening',
        'Pump efficiency optimization',
        'Climate resilience infrastructure upgrades',
        'Customer experience digitization',
    ],
    'Pharmaceutical': [
        'Paperless quality management (eQMS)',
        'Calibration lifecycle optimization',
        'Cleanroom HVAC energy efficiency',
        'Serialization & track-and-trace maturity',
        'Continuous manufacturing transition',
        'Data integrity automation (ALCOA+)',
    ],
    'Food & Beverage': [
        'HACCP digital compliance automation',
        'Refrigeration energy optimization',
        'Packaging line OEE improvement',
        'CIP cycle time & water reduction',
        'Traceability digitization (blockchain)',
        'Predictive food safety monitoring',
    ],
    'Other': [
        'Predictive maintenance deployment',
        'Reliability-centered maintenance (RCM)',
        'Asset lifecycle cost optimization',
        'Digital transformation of maintenance',
        'Competency framework development',
        'Energy management improvement',
    ],
};

export const ASSET_CLASS_OPTIONS = [
    'Rotating Equipment', 'Static Equipment', 'Electrical Systems',
    'Instrumentation & Controls', 'Piping & Valves', 'Safety-Critical Systems',
    'Civil & Structural', 'Mixed / All Classes',
] as const;

export const FINDING_RATINGS = [
    { value: 'compliant',     label: 'Compliant',     color: '#22c55e', weight: 0 },
    { value: 'minor_gap',     label: 'Minor Gap',     color: '#f59e0b', weight: 1 },
    { value: 'major_gap',     label: 'Major Gap',     color: '#f97316', weight: 2 },
    { value: 'critical_risk', label: 'Critical Risk', color: '#ef4444', weight: 3 },
] as const;

export const FINDING_CATEGORIES = [
    'Governance & Strategy',
    'Asset Integrity',
    'Process Safety',
    'Maintenance & Reliability',
    'Data & Competence',
    'Financial Alignment',
    'People & Culture',
    'Regulatory & Policy',
] as const;

export const SIXM_CATEGORIES = [
    'Man', 'Machine', 'Method', 'Material', 'Measurement', 'Mother Nature',
] as const;

export const IMPACT_LEVELS = ['None', 'Low', 'Medium', 'High', 'Critical'] as const;

// ═══════════════════════════════════════════════════════════════
//  ISO 55000:2024 SERIES DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export const ISO_55000_SERIES = [
    {
        standard: 'ISO 55000:2024',
        title: 'Principles, Overview, Terminology',
        scope: 'Foundation standard. Provides the 7 principles of asset management, key terminology, and the context for the entire series.',
        auditRole: 'Ensures consistent terminology and understanding across the audit.',
        color: '#8B1A1A',
    },
    {
        standard: 'ISO 55001:2024',
        title: 'Requirements',
        scope: 'Certifiable requirements for establishing, implementing, maintaining, and improving an asset management system (AMS). Follows Harmonized Structure §4–§10.',
        auditRole: 'Primary audit standard — clause-by-clause maturity assessment.',
        color: '#8B1A1A',
        clauses: [
            { clause: '§4', title: 'Context of the Organization', layer: 'Governance', description: 'Internal/external issues, stakeholder needs, AMS scope, decision-making framework (NEW 2024)' },
            { clause: '§5', title: 'Leadership', layer: 'Governance', description: 'Top management commitment, AM policy, roles/responsibilities/authorities' },
            { clause: '§6', title: 'Planning', layer: 'Governance', description: 'Risks & opportunities, SAMP (mandatory), AM objectives' },
            { clause: '§7', title: 'Support', layer: 'Execution', description: 'Resources, competence (→55012), awareness, communication, data & info (7.6 →55013), knowledge (7.7)' },
            { clause: '§8', title: 'Operation', layer: 'Execution', description: 'Operational planning & control, full asset lifecycle, change management, outsourced processes' },
            { clause: '§9', title: 'Performance Evaluation', layer: 'Improvement', description: 'Monitoring/measurement, analysis/evaluation, internal audit, management review' },
            { clause: '§10', title: 'Improvement', layer: 'Improvement', description: 'Nonconformity/corrective action, predictive action (10.3 NEW 2024), continual improvement' },
        ],
    },
    {
        standard: 'ISO 55002:2024',
        title: 'Guidance',
        scope: 'Implementation guidance for ISO 55001. Provides practical "how-to" advice for each clause.',
        auditRole: 'Supplementary scoring depth — maturity progression indicators.',
        color: '#8B1A1A',
    },
    {
        standard: 'ISO 55010:2024',
        title: 'Financial & Non-Financial Alignment',
        scope: 'Bridges financial (accounting, budgeting, CAPEX) and non-financial (engineering, operations, maintenance) functions. Covers asset register alignment, capital planning, performance metrics integration.',
        auditRole: 'Assesses whether finance and engineering speak the same language about assets.',
        color: '#8B1A1A',
    },
    {
        standard: 'ISO 55011:2024',
        title: 'Public Policy Guidance',
        scope: 'Guidance for developing public policies that enable asset management. Covers regulatory environment, policy instruments, stakeholder engagement across jurisdictions.',
        auditRole: 'Assesses regulatory awareness and compliance landscape.',
        color: '#8B1A1A',
    },
    {
        standard: 'ISO 55012:2024',
        title: 'People Involvement & Competence',
        scope: 'Guidance on human and cultural factors affecting AM effectiveness. Covers competence frameworks aligned to SAMP, leadership engagement, training programs, outsourced resource competence.',
        auditRole: 'Assesses whether the right people have the right skills, aligned to strategic AM objectives.',
        color: '#8B1A1A',
    },
    {
        standard: 'ISO 55013:2024',
        title: 'Data for Asset Management',
        scope: 'Guidance on managing data as a strategic asset. Covers data governance (EDM model), data quality, data lifecycle (Define→Collect→Store→Report→Decide→Dispose), distinction between asset data and data assets.',
        auditRole: 'Assesses whether data is treated as a governed asset, not just a byproduct.',
        color: '#8B1A1A',
    },
] as const;

// ═══════════════════════════════════════════════════════════════
//  STEP 1: INTAKE & SCOPE
// ═══════════════════════════════════════════════════════════════

export interface ISOSeriesAlignment {
    // ISO 55010: Financial & Non-Financial Alignment
    iso55010_financial_alignment: string;
    iso55010_register_alignment: string;
    iso55010_capex_integration: string;

    // ISO 55011: Public Policy Guidance
    iso55011_regulatory_mapping: string;
    iso55011_policy_engagement: string;

    // ISO 55012: People Involvement & Competence
    iso55012_competence_framework: string;
    iso55012_cultural_factors: string;
    iso55012_outsourced_competence: string;

    // ISO 55013: Data for Asset Management
    iso55013_data_governance: string;
    iso55013_data_quality: string;
    iso55013_data_asset_distinction: string;
}

export const EMPTY_ISO_ALIGNMENT: ISOSeriesAlignment = {
    iso55010_financial_alignment: '',
    iso55010_register_alignment: '',
    iso55010_capex_integration: '',
    iso55011_regulatory_mapping: '',
    iso55011_policy_engagement: '',
    iso55012_competence_framework: '',
    iso55012_cultural_factors: '',
    iso55012_outsourced_competence: '',
    iso55013_data_governance: '',
    iso55013_data_quality: '',
    iso55013_data_asset_distinction: '',
};

export interface AuditIntakeData {
    // Section A: Assessor
    firstName: string;
    lastName: string;
    fullName: string;       // Computed: "FirstName LastName" — kept for backward compat & display
    username: string;       // System username — bridges to People/Contacts module
    autoUsername: boolean;   // If true, username = first initial + '.' + lastName (e.g. j.martinez)
    jobTitle: string;
    company: string;
    email: string;
    mobileCountryCode: string;
    mobile: string;
    siteName: string;
    industrySector: string;
    assetClass: string;
    certifications?: never; // Removed — not needed in intake
    auditDate: string;      // Auto-set at save time

    // Section B: Scope — ISO 55001:2024 §6.1 Risks & Opportunities
    auditObjective: string;
    reportingLine: string;
    keyRisks: string[];
    keyOpportunities: string[];

    // Section C: Organizational Context (ISO 55001 §4)
    orgVision: string;
    orgMission: string;
    orgStrategicObjectives: string;
    orgAMPolicy: string;
    orgSAMP: string;
    orgRolesAuthorities: string;
    orgRiskFramework: string;
    orgBudgetAlignment: string;

    // Section D: ISO 55000 Series Alignment
    isoAlignment: ISOSeriesAlignment;
}

// International dialling codes — sorted alphabetically (ISO 3166-1 alpha-3 + ITU-T E.164)
export const COUNTRY_CODES = [
    { code: '+213', iso3: 'DZA', label: 'Algeria' },
    { code: '+244', iso3: 'AGO', label: 'Angola' },
    { code: '+54',  iso3: 'ARG', label: 'Argentina' },
    { code: '+61',  iso3: 'AUS', label: 'Australia' },
    { code: '+973', iso3: 'BHR', label: 'Bahrain' },
    { code: '+55',  iso3: 'BRA', label: 'Brazil' },
    { code: '+1',   iso3: 'CAN', label: 'Canada' },
    { code: '+56',  iso3: 'CHL', label: 'Chile' },
    { code: '+86',  iso3: 'CHN', label: 'China' },
    { code: '+57',  iso3: 'COL', label: 'Colombia' },
    { code: '+20',  iso3: 'EGY', label: 'Egypt' },
    { code: '+33',  iso3: 'FRA', label: 'France' },
    { code: '+49',  iso3: 'DEU', label: 'Germany' },
    { code: '+233', iso3: 'GHA', label: 'Ghana' },
    { code: '+91',  iso3: 'IND', label: 'India' },
    { code: '+62',  iso3: 'IDN', label: 'Indonesia' },
    { code: '+964', iso3: 'IRQ', label: 'Iraq' },
    { code: '+39',  iso3: 'ITA', label: 'Italy' },
    { code: '+81',  iso3: 'JPN', label: 'Japan' },
    { code: '+7',   iso3: 'KAZ', label: 'Kazakhstan' },
    { code: '+254', iso3: 'KEN', label: 'Kenya' },
    { code: '+965', iso3: 'KWT', label: 'Kuwait' },
    { code: '+218', iso3: 'LBY', label: 'Libya' },
    { code: '+60',  iso3: 'MYS', label: 'Malaysia' },
    { code: '+52',  iso3: 'MEX', label: 'Mexico' },
    { code: '+258', iso3: 'MOZ', label: 'Mozambique' },
    { code: '+31',  iso3: 'NLD', label: 'Netherlands' },
    { code: '+64',  iso3: 'NZL', label: 'New Zealand' },
    { code: '+234', iso3: 'NGA', label: 'Nigeria' },
    { code: '+47',  iso3: 'NOR', label: 'Norway' },
    { code: '+968', iso3: 'OMN', label: 'Oman' },
    { code: '+92',  iso3: 'PAK', label: 'Pakistan' },
    { code: '+51',  iso3: 'PER', label: 'Peru' },
    { code: '+63',  iso3: 'PHL', label: 'Philippines' },
    { code: '+48',  iso3: 'POL', label: 'Poland' },
    { code: '+974', iso3: 'QAT', label: 'Qatar' },
    { code: '+7',   iso3: 'RUS', label: 'Russia' },
    { code: '+966', iso3: 'SAU', label: 'Saudi Arabia' },
    { code: '+65',  iso3: 'SGP', label: 'Singapore' },
    { code: '+27',  iso3: 'ZAF', label: 'South Africa' },
    { code: '+82',  iso3: 'KOR', label: 'South Korea' },
    { code: '+34',  iso3: 'ESP', label: 'Spain' },
    { code: '+255', iso3: 'TZA', label: 'Tanzania' },
    { code: '+66',  iso3: 'THA', label: 'Thailand' },
    { code: '+90',  iso3: 'TUR', label: 'Türkiye' },
    { code: '+256', iso3: 'UGA', label: 'Uganda' },
    { code: '+971', iso3: 'ARE', label: 'UAE' },
    { code: '+44',  iso3: 'GBR', label: 'UK' },
    { code: '+1',   iso3: 'USA', label: 'USA' },
    { code: '+58',  iso3: 'VEN', label: 'Venezuela' },
    { code: '+84',  iso3: 'VNM', label: 'Vietnam' },
] as const;

/** Look up E.164 dial code from ISO3 country code */
export function getDialCode(iso3: string): string {
    return COUNTRY_CODES.find(c => c.iso3 === iso3)?.code || '+1';
}

export const EMPTY_INTAKE: AuditIntakeData = {
    firstName: '', lastName: '', fullName: '', username: '', autoUsername: true, jobTitle: '', company: '', email: '', mobileCountryCode: 'USA', mobile: '', siteName: '',
    industrySector: 'Oil & Gas (Upstream)', assetClass: 'Mixed / All Classes',
    auditDate: '',
    auditObjective: '', reportingLine: '', keyRisks: [], keyOpportunities: [],
    orgVision: '', orgMission: '', orgStrategicObjectives: '',
    orgAMPolicy: '', orgSAMP: '', orgRolesAuthorities: '',
    orgRiskFramework: '', orgBudgetAlignment: '',
    isoAlignment: { ...EMPTY_ISO_ALIGNMENT },
};

// ISO Series alignment dropdown options
export const ISO_ALIGNMENT_OPTIONS = {
    iso55010_financial_alignment: [
        { value: 'Fully integrated — financial and non-financial functions aligned', label: 'Fully integrated' },
        { value: 'Partially aligned — some integration exists', label: 'Partially aligned' },
        { value: 'Siloed — finance and engineering operate independently', label: 'Siloed' },
        { value: 'No alignment between financial and technical functions', label: 'No alignment' },
    ],
    iso55010_register_alignment: [
        { value: 'Aligned and reconciled — technical and financial registers match', label: 'Aligned & reconciled' },
        { value: 'Partially aligned — some inconsistencies', label: 'Partially aligned' },
        { value: 'Not aligned — registers maintained independently', label: 'Not aligned' },
    ],
    iso55010_capex_integration: [
        { value: 'Fully integrated — CAPEX planning driven by asset lifecycle analysis', label: 'Fully integrated' },
        { value: 'Partially — some lifecycle consideration in CAPEX', label: 'Partially' },
        { value: 'Ad-hoc — CAPEX based on urgency/failure', label: 'Ad-hoc' },
        { value: 'No integration — CAPEX and AM disconnected', label: 'No integration' },
    ],
    iso55011_regulatory_mapping: [
        { value: 'Comprehensive — all regulatory obligations mapped and tracked', label: 'Comprehensive map' },
        { value: 'Partial — key regulations tracked, gaps exist', label: 'Partial' },
        { value: 'Informal — known but not documented', label: 'Informal' },
        { value: 'Not mapped — no systematic regulatory tracking', label: 'Not mapped' },
    ],
    iso55011_policy_engagement: [
        { value: 'Active — participates in industry standards/policy bodies', label: 'Active' },
        { value: 'Occasional — engages when required', label: 'Occasional' },
        { value: 'Passive — monitors but does not participate', label: 'Passive' },
        { value: 'None — no engagement with policy/standards bodies', label: 'None' },
    ],
    iso55012_competence_framework: [
        { value: 'Formal framework exists, aligned to SAMP objectives', label: 'Formal — SAMP aligned' },
        { value: 'Framework exists but generic, not AM-specific', label: 'Exists — generic' },
        { value: 'Informal — ad-hoc training only', label: 'Informal' },
        { value: 'No competence framework for AM roles', label: 'None' },
    ],
    iso55012_cultural_factors: [
        { value: 'Formally assessed — culture surveys, leadership reviews', label: 'Formally assessed' },
        { value: 'Informally considered — not measured', label: 'Informally' },
        { value: 'Not considered as factor in AM effectiveness', label: 'Not considered' },
    ],
    iso55012_outsourced_competence: [
        { value: 'Yes — contractors included in competence programs', label: 'Yes — included' },
        { value: 'Partially — some contractor competence verified', label: 'Partially' },
        { value: 'No — contractor competence not managed', label: 'No' },
    ],
    iso55013_data_governance: [
        { value: 'Formal structure with stewardship roles and EDM model', label: 'Formal with stewardship' },
        { value: 'Informal governance — no clear ownership', label: 'Informal' },
        { value: 'No data governance structure', label: 'None' },
    ],
    iso55013_data_quality: [
        { value: 'Actively managed — quality metrics, cleansing programs', label: 'Actively managed' },
        { value: 'Ad-hoc — cleaned when issues found', label: 'Ad-hoc' },
        { value: 'Not managed — data quality unknown', label: 'Not managed' },
    ],
    iso55013_data_asset_distinction: [
        { value: 'Yes — organization treats data as a strategic asset', label: 'Yes — strategic asset' },
        { value: 'Partially — some awareness, no formal approach', label: 'Partially' },
        { value: 'No — data seen as byproduct, not asset', label: 'No understanding' },
    ],
} as const;

// ═══════════════════════════════════════════════════════════════
//  STEP 2: DOCUMENT REVIEW
// ═══════════════════════════════════════════════════════════════

export type DocStatus = 'received' | 'partial' | 'missing' | 'na';

export interface DocumentReviewItem {
    id: string;
    document: string;
    category: string;
    isoRef: string;
    status: DocStatus;
    notes: string;
}

export const DEFAULT_DOCUMENTS: Omit<DocumentReviewItem, 'id' | 'notes' | 'status'>[] = [
    { document: 'Asset Management Policy & Plans',         category: 'Governance',       isoRef: 'ISO 55001 §5.2' },
    { document: 'Strategic Asset Management Plan (SAMP)',   category: 'Governance',       isoRef: 'ISO 55001 §6.2.1' },
    { document: 'Equipment Lists & Asset Hierarchy',        category: 'Asset Integrity',  isoRef: 'ISO 55013, ISO 14224' },
    { document: 'P&IDs and Process Flow Diagrams',          category: 'Asset Integrity',  isoRef: 'API RP 754' },
    { document: 'Maintenance Strategy & Plans',             category: 'Maintenance',      isoRef: 'ISO 55001 §8.1' },
    { document: 'Inspection Plans & RBI Documents',         category: 'Asset Integrity',  isoRef: 'API 580/581' },
    { document: 'PSM / SEMS Documentation',                 category: 'Process Safety',   isoRef: 'API RP 75, OSHA PSM' },
    { document: 'Incident & Near-Miss Logs',                category: 'Process Safety',   isoRef: 'API RP 754, ISO 55001 §10.1' },
    { document: 'KPI Reports & Dashboards',                 category: 'Data & Competence', isoRef: 'ISO 55001 §9.1, ISO 55013' },
    { document: 'MOC Records & Register',                   category: 'Process Safety',   isoRef: 'ISO 55001 §8.2' },
    { document: 'Competence Matrix & Training Records',     category: 'Data & Competence', isoRef: 'ISO 55012' },
    { document: 'Shutdown / Turnaround Records',            category: 'Maintenance',      isoRef: 'ISO 55001 §8.1' },
    { document: 'Corrosion / Defect Management Program',    category: 'Asset Integrity',  isoRef: 'API 510/570/653' },
    { document: 'Barrier Management Documentation',         category: 'Process Safety',   isoRef: 'API RP 754' },
    { document: 'Emergency Preparedness Plans',             category: 'Process Safety',   isoRef: 'API RP 75' },
    { document: 'Spares Strategy & Inventory Records',      category: 'Maintenance',      isoRef: 'ISO 55001 §8.1' },
    { document: 'Calibration Records',                      category: 'Data & Competence', isoRef: 'ISO 55001 §9.1' },
    { document: 'Work Order History (12 months)',            category: 'Maintenance',      isoRef: 'ISO 55001 §8.1' },
    { document: 'Financial Asset Register / Fixed Asset Register', category: 'Financial',  isoRef: 'ISO 55010' },
    { document: 'CAPEX / Budget Plans',                     category: 'Financial',        isoRef: 'ISO 55010' },
    { document: 'Regulatory Compliance Register',           category: 'Regulatory',       isoRef: 'ISO 55011' },
];

// ═══════════════════════════════════════════════════════════════
//  STEP 3: SITE VERIFICATION
// ═══════════════════════════════════════════════════════════════

export type VerificationStatus = 'ok' | 'minor_gap' | 'major_gap' | 'critical';

export interface SiteVerificationItem {
    id: string;
    area: string;
    checkItem: string;
    isoRef: string;
    status: VerificationStatus;
    photoRef: string;
    notes: string;
}

export const DEFAULT_SITE_CHECKS: Omit<SiteVerificationItem, 'id' | 'status' | 'photoRef' | 'notes'>[] = [
    { area: 'Asset Register',          checkItem: 'Tag accuracy and legibility on equipment',            isoRef: 'ISO 55013' },
    { area: 'Asset Register',          checkItem: 'Equipment matches asset register data',               isoRef: 'ISO 55013, ISO 55010' },
    { area: 'Physical Condition',      checkItem: 'General equipment condition assessment',              isoRef: 'ISO 55001 §8' },
    { area: 'Physical Condition',      checkItem: 'Evidence of corrosion, leaks, or degradation',        isoRef: 'API 510/570' },
    { area: 'Inspection Status',       checkItem: 'Inspection certificates and colour coding current',   isoRef: 'API 580/581' },
    { area: 'Inspection Status',       checkItem: 'Overdue inspections identified',                      isoRef: 'API 580/581' },
    { area: 'Maintenance Execution',   checkItem: 'Evidence of completed PMs (grease, filter changes)',  isoRef: 'ISO 55001 §8.1' },
    { area: 'Maintenance Execution',   checkItem: 'Backlog equipment visible on site',                   isoRef: 'ISO 55001 §8.1' },
    { area: 'Safety-Critical',         checkItem: 'Relief devices tagged and tested within schedule',    isoRef: 'API RP 754' },
    { area: 'Safety-Critical',         checkItem: 'ESD / shutdown systems functional and tested',        isoRef: 'API RP 754, IEC 61511' },
    { area: 'Safety-Critical',         checkItem: 'Fire & gas detection operational',                    isoRef: 'API RP 754' },
    { area: 'Permit-to-Work',          checkItem: 'Active permits correctly displayed',                  isoRef: 'Process Safety' },
    { area: 'Permit-to-Work',          checkItem: 'Isolation and LOTO procedures followed',              isoRef: 'OSHA 1910.147' },
    { area: 'Field Compliance',        checkItem: 'SOPs available at point of use',                      isoRef: 'ISO 55001 §7.5' },
    { area: 'Field Compliance',        checkItem: 'PPE compliance observed',                             isoRef: 'ISO 55012' },
    { area: 'Housekeeping',            checkItem: 'Work areas clean and organized',                      isoRef: 'ISO 55001 §8' },
];

// ═══════════════════════════════════════════════════════════════
//  STEP 4: INTERVIEWS
// ═══════════════════════════════════════════════════════════════

export interface InterviewRecord {
    id: string;
    name: string;
    role: string;
    department: string;
    keyFindings: string;
    notes: string;
}

export const INTERVIEW_DEPARTMENTS = [
    'Operations', 'Maintenance', 'Asset Integrity', 'HSE / PSM',
    'Planning & Scheduling', 'Stores / Procurement', 'Leadership / Management',
    'Engineering', 'Reliability', 'Finance / Accounting', 'Other',
] as const;

// ═══════════════════════════════════════════════════════════════
//  STEP 6: SCORED FINDINGS
// ═══════════════════════════════════════════════════════════════

export interface ScoredFinding {
    id: string;
    finding: string;
    category: string;
    rating: string;
    riskRank: number;
    businessImpact: string;
    safetyImpact: string;
    environmentalImpact: string;
    productionImpact: string;
    isoReference: string;
    recommendedAction: string;
    owner: string;
    dueDate: string;
    sixmCategory: string;
    /** Set when the finding was drafted from a 6M checklist answer (sixmScoring). */
    sourceQuestionId?: string;
    /** Set once "Create corrective action" has written an audit_corrective_actions row (0308). */
    correctiveActionId?: string;
    correctiveActionNumber?: string;
}

// ═══════════════════════════════════════════════════════════════
//  FULL ASSESSMENT STATE
// ═══════════════════════════════════════════════════════════════

export interface AuditAssessmentState {
    id?: string;
    assessmentNumber?: string;
    currentStep: number;
    status: 'in_progress' | 'completed' | 'archived' | 'deleted';

    intake: AuditIntakeData;
    documentReview: DocumentReviewItem[];
    siteVerification: SiteVerificationItem[];
    interviews: InterviewRecord[];

    // 6M guided checklist (assessment flow)
    sixmChecklistAnswers?: any[];
    sixmDimensionNotes?: Record<string, string>;

    dimensionResults: any[];
    dimensionsCompleted: number;
    scoredFindings: ScoredFinding[];

    overallMaturity: number | null;
    overallPercentage: number | null;
    maturityLevel: string | null;
    reportData: any;
    roadmapData: any;
    notes: string;
}

