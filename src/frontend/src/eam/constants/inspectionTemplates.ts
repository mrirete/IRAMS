// ═══════════════════════════════════════════════════════════════════════
//  Inspection Form Templates — Pre-configured per Governing Code
//  Follows InspectionFormTemplate / TemplateSection / TemplateField
//  from types/integrity.ts
// ═══════════════════════════════════════════════════════════════════════

import type {
    InspectionFormTemplate,
    TemplateSection,
    TemplateField,
} from '../../types/integrity';

// ── Reusable Administrative Section ────────────────────────────────────
const adminFields: TemplateField[] = [
    {
        id: 'inspector_name',
        label: 'Inspector Name',
        field_type: 'text',
        required: true,
        placeholder: 'Full name of lead inspector',
    },
    {
        id: 'inspection_date',
        label: 'Inspection Date',
        field_type: 'date',
        required: true,
    },
    {
        id: 'weather_conditions',
        label: 'Weather Conditions',
        field_type: 'text',
        required: false,
        placeholder: 'e.g. Clear, 28 °C, light wind',
    },
    {
        id: 'equipment_tag_verified',
        label: 'Equipment Tag Verified',
        field_type: 'checkbox',
        required: false,
        help_text: 'Confirm the equipment tag matches the work-order scope.',
    },
];

const makeAdminSection = (): TemplateSection => ({
    id: 'admin',
    title: 'Administrative',
    description: 'General inspection identification and context.',
    icon: 'ClipboardList',
    required: true,
    fields: [...adminFields],
});

// ═══════════════════════════════════════════════════════════════════════
//  1 — API 510  Pressure Vessel Inspection
// ═══════════════════════════════════════════════════════════════════════
export const API_510_TEMPLATE: InspectionFormTemplate = {
    id: 'tpl_api510_pv',
    name: 'API 510 — Pressure Vessel Inspection',
    governing_code: 'API 510',
    inspection_types: ['VT', 'UT', 'MT', 'PT', 'RT', 'PAUT'],
    description:
        'Comprehensive inspection template aligned with API 510 for fixed pressure vessels. Covers external/internal visual assessment, thickness measurements, and pressure-relief device evaluation.',
    version: '1.0.0',
    sections: [
        // — Administrative —
        makeAdminSection(),

        // — External Visual —
        {
            id: 'external_visual',
            title: 'External Visual',
            description: 'Assessment of all externally visible conditions.',
            icon: 'Eye',
            required: true,
            fields: [
                {
                    id: 'external_corrosion',
                    label: 'External Corrosion Assessment',
                    field_type: 'select',
                    required: true,
                    options: ['none', 'minor', 'moderate', 'severe'],
                },
                {
                    id: 'insulation_condition',
                    label: 'Insulation Condition',
                    field_type: 'select',
                    required: false,
                    options: ['good', 'damaged', 'missing', 'N/A'],
                },
                {
                    id: 'foundation_support',
                    label: 'Foundation & Support Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'minor_defects', 'major_defects'],
                },
                {
                    id: 'paint_coating',
                    label: 'Paint / Coating Condition',
                    field_type: 'select',
                    required: false,
                    options: ['good', 'fair', 'poor', 'failed'],
                },
                {
                    id: 'nozzle_flange',
                    label: 'Nozzle & Flange Inspection',
                    field_type: 'textarea',
                    required: false,
                    placeholder: 'Describe nozzle and flange conditions observed...',
                },
                {
                    id: 'leak_detected',
                    label: 'Active Leak Detected?',
                    field_type: 'checkbox',
                    required: false,
                    help_text:
                        'If checked, immediately notify the Operations Supervisor and isolate as required per site emergency procedures.',
                },
            ],
        },

        // — Thickness Measurements —
        {
            id: 'thickness_measurements',
            title: 'Thickness Measurements',
            description: 'CML survey results and wall-loss assessment.',
            icon: 'Ruler',
            required: true,
            fields: [
                {
                    id: 'cml_count',
                    label: 'Number of CMLs Surveyed',
                    field_type: 'number',
                    required: true,
                    min_value: 0,
                },
                {
                    id: 'min_reading',
                    label: 'Minimum Reading Recorded',
                    field_type: 'measurement',
                    required: true,
                    unit: 'mm',
                    min_value: 0,
                },
                {
                    id: 'min_reading_location',
                    label: 'Location of Minimum Reading',
                    field_type: 'text',
                    required: false,
                    placeholder: "e.g. Shell Course 3, 6 o'clock",
                },
                {
                    id: 'below_tmin',
                    label: 'Readings Below Tmin?',
                    field_type: 'checkbox',
                    required: false,
                    help_text:
                        'Any reading below the calculated minimum thickness requires immediate engineering review.',
                },
                {
                    id: 'wall_condition',
                    label: 'General Wall Condition',
                    field_type: 'select',
                    required: false,
                    options: ['acceptable', 'approaching_limits', 'below_limits'],
                },
            ],
        },

        // — Pressure Relief Devices —
        {
            id: 'pressure_relief',
            title: 'Pressure Relief Devices',
            description: 'Verification and condition of PRVs/PSVs.',
            icon: 'Gauge',
            required: true,
            fields: [
                {
                    id: 'prv_tag',
                    label: 'PRV Tag Number',
                    field_type: 'text',
                    required: false,
                    placeholder: 'e.g. PSV-2041',
                },
                {
                    id: 'set_pressure_verified',
                    label: 'Set Pressure Verified',
                    field_type: 'checkbox',
                    required: false,
                },
                {
                    id: 'prv_last_test_date',
                    label: 'Last Test Date',
                    field_type: 'date',
                    required: false,
                },
                {
                    id: 'prv_condition',
                    label: 'PRV Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'requires_attention', 'failed'],
                },
            ],
        },

        // — Internal Visual (Conditional) —
        {
            id: 'internal_visual',
            title: 'Internal Visual',
            description:
                'Internal condition assessment — complete only when vessel entry or remote visual is performed.',
            icon: 'Flashlight',
            required: false,
            fields: [
                {
                    id: 'internal_access',
                    label: 'Internal Access Available',
                    field_type: 'checkbox',
                    required: false,
                    help_text: 'Enable this to reveal internal-inspection fields.',
                },
                {
                    id: 'internal_corrosion',
                    label: 'Internal Corrosion Assessment',
                    field_type: 'select',
                    required: false,
                    options: ['none', 'minor', 'moderate', 'severe'],
                    condition: { depends_on: 'internal_access', equals: true },
                },
                {
                    id: 'tray_internals',
                    label: 'Tray / Internals Condition',
                    field_type: 'select',
                    required: false,
                    options: ['good', 'damaged', 'missing', 'N/A'],
                    condition: { depends_on: 'internal_access', equals: true },
                },
                {
                    id: 'deposits_scale',
                    label: 'Deposits / Scale Observed',
                    field_type: 'checkbox',
                    required: false,
                    condition: { depends_on: 'internal_access', equals: true },
                },
                {
                    id: 'internal_coating',
                    label: 'Internal Coating Condition',
                    field_type: 'select',
                    required: false,
                    options: ['good', 'fair', 'poor', 'failed'],
                    condition: { depends_on: 'internal_access', equals: true },
                },
            ],
        },
    ],
};

// ═══════════════════════════════════════════════════════════════════════
//  2 — API 570  Piping Inspection
// ═══════════════════════════════════════════════════════════════════════
export const API_570_TEMPLATE: InspectionFormTemplate = {
    id: 'tpl_api570_piping',
    name: 'API 570 — Piping Inspection',
    governing_code: 'API 570',
    inspection_types: ['VT', 'UT', 'RT', 'PAUT'],
    description:
        'Piping system inspection template per API 570, including circuit identification, external assessment, thickness data, and small-bore / branch connection evaluation.',
    version: '1.0.0',
    sections: [
        // — Administrative —
        makeAdminSection(),

        // — Piping Circuit Identification —
        {
            id: 'piping_circuit',
            title: 'Piping Circuit Identification',
            description: 'Identify the piping circuit under inspection.',
            icon: 'GitBranch',
            required: true,
            fields: [
                {
                    id: 'circuit_id',
                    label: 'Circuit ID',
                    field_type: 'text',
                    required: true,
                    placeholder: 'e.g. CIR-204-HC-001',
                },
                {
                    id: 'piping_class',
                    label: 'Piping Class (API 570)',
                    field_type: 'select',
                    required: false,
                    options: ['1', '2', '3', '4'],
                    help_text:
                        'Class 1 = highest consequence, Class 4 = lowest. Determines inspection interval.',
                },
                {
                    id: 'service_description',
                    label: 'Service Description',
                    field_type: 'text',
                    required: false,
                    placeholder: 'e.g. Hot crude transfer, 320 °C',
                },
                {
                    id: 'material_spec',
                    label: 'Material Specification',
                    field_type: 'text',
                    required: false,
                    placeholder: 'e.g. A106 Gr. B, SA-335 P11',
                },
            ],
        },

        // — External Visual —
        {
            id: 'external_visual',
            title: 'External Visual',
            description: 'Visual assessment of the piping system exterior.',
            icon: 'Eye',
            required: true,
            fields: [
                {
                    id: 'external_corrosion',
                    label: 'External Corrosion',
                    field_type: 'select',
                    required: true,
                    options: ['none', 'minor', 'moderate', 'severe'],
                },
                {
                    id: 'cui_indicators',
                    label: 'CUI Indicators',
                    field_type: 'select',
                    required: false,
                    options: ['none', 'staining', 'bulging', 'confirmed'],
                    help_text:
                        'Corrosion Under Insulation indicators per API 583.',
                },
                {
                    id: 'support_condition',
                    label: 'Support Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'minor_defects', 'major_defects'],
                },
                {
                    id: 'insulation_condition',
                    label: 'Insulation Condition',
                    field_type: 'select',
                    required: false,
                    options: ['good', 'damaged', 'missing', 'N/A'],
                },
                {
                    id: 'flange_gasket',
                    label: 'Flange & Gasket Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'leaking', 'corroded'],
                },
                {
                    id: 'vibration_observed',
                    label: 'Vibration Observed',
                    field_type: 'checkbox',
                    required: false,
                    help_text:
                        'Excessive vibration may indicate fatigue risk — flag for engineering review.',
                },
            ],
        },

        // — Thickness Measurements —
        {
            id: 'thickness_measurements',
            title: 'Thickness Measurements',
            description: 'CML survey results and wall-loss assessment.',
            icon: 'Ruler',
            required: true,
            fields: [
                {
                    id: 'cml_count',
                    label: 'Number of CMLs Surveyed',
                    field_type: 'number',
                    required: true,
                    min_value: 0,
                },
                {
                    id: 'min_reading',
                    label: 'Minimum Reading Recorded',
                    field_type: 'measurement',
                    required: true,
                    unit: 'mm',
                    min_value: 0,
                },
                {
                    id: 'min_reading_location',
                    label: 'Location of Minimum Reading',
                    field_type: 'text',
                    required: false,
                    placeholder: "e.g. Elbow E-3, 6 o'clock",
                },
                {
                    id: 'below_tmin',
                    label: 'Readings Below Tmin?',
                    field_type: 'checkbox',
                    required: false,
                    help_text:
                        'Any reading below the calculated minimum thickness requires immediate engineering review.',
                },
                {
                    id: 'wall_condition',
                    label: 'General Wall Condition',
                    field_type: 'select',
                    required: false,
                    options: ['acceptable', 'approaching_limits', 'below_limits'],
                },
            ],
        },

        // — Small-Bore & Branch Connections —
        {
            id: 'small_bore',
            title: 'Small-Bore & Branch Connections',
            description:
                'Inspection of small-bore connections, injection points, and dead-legs.',
            icon: 'Plug',
            required: false,
            fields: [
                {
                    id: 'sb_count',
                    label: 'Small-Bore Connection Count Inspected',
                    field_type: 'number',
                    required: false,
                    min_value: 0,
                },
                {
                    id: 'injection_point',
                    label: 'Injection Point Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'corroded', 'plugged'],
                },
                {
                    id: 'dead_leg',
                    label: 'Dead-Leg Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'corroded', 'plugged', 'N/A'],
                },
            ],
        },
    ],
};

// ═══════════════════════════════════════════════════════════════════════
//  3 — API 653  Storage Tank Inspection
// ═══════════════════════════════════════════════════════════════════════
export const API_653_TEMPLATE: InspectionFormTemplate = {
    id: 'tpl_api653_tank',
    name: 'API 653 — Storage Tank Inspection',
    governing_code: 'API 653',
    inspection_types: ['VT', 'UT', 'MFL'],
    description:
        'Aboveground storage tank inspection template per API 653, covering external shell, tank bottom (floor scan), roof, and appurtenances.',
    version: '1.0.0',
    sections: [
        // — Administrative —
        makeAdminSection(),

        // — External Shell —
        {
            id: 'external_shell',
            title: 'External Shell',
            description: 'Shell course assessment, settlement, and external condition.',
            icon: 'Cylinder',
            required: true,
            fields: [
                {
                    id: 'shell_course_assessed',
                    label: 'Shell Course Assessed',
                    field_type: 'number',
                    required: false,
                    min_value: 1,
                    help_text: 'Enter the shell course number being assessed.',
                },
                {
                    id: 'shell_plumb',
                    label: 'Shell Plumb Measurement',
                    field_type: 'measurement',
                    required: false,
                    unit: 'mm',
                },
                {
                    id: 'differential_settlement',
                    label: 'Differential Settlement Detected?',
                    field_type: 'checkbox',
                    required: false,
                    help_text:
                        'Flag if differential settlement exceeds API 653 Table 9-1 limits.',
                },
                {
                    id: 'external_corrosion',
                    label: 'External Corrosion',
                    field_type: 'select',
                    required: true,
                    options: ['none', 'minor', 'moderate', 'severe'],
                },
                {
                    id: 'foundation_condition',
                    label: 'Foundation Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'erosion', 'settlement', 'cracking'],
                },
            ],
        },

        // — Tank Bottom —
        {
            id: 'tank_bottom',
            title: 'Tank Bottom',
            description: 'Floor scan results and annular ring assessment.',
            icon: 'Layers',
            required: true,
            fields: [
                {
                    id: 'floor_scan_method',
                    label: 'Floor Scan Method',
                    field_type: 'select',
                    required: true,
                    options: ['MFL', 'UT', 'visual'],
                },
                {
                    id: 'floor_condition',
                    label: 'Floor Condition',
                    field_type: 'select',
                    required: true,
                    options: ['satisfactory', 'pitting', 'general_thinning', 'perforated'],
                },
                {
                    id: 'annular_ring_min',
                    label: 'Annular Ring Minimum Thickness',
                    field_type: 'measurement',
                    required: false,
                    unit: 'mm',
                    min_value: 0,
                },
                {
                    id: 'critical_zone_readings',
                    label: 'Critical Zone Readings',
                    field_type: 'number',
                    required: false,
                    min_value: 0,
                    help_text: 'Number of readings in the 3-inch annular zone.',
                },
            ],
        },

        // — Roof —
        {
            id: 'roof',
            title: 'Roof',
            description: 'Roof structure, plates, seals, and drainage assessment.',
            icon: 'Home',
            required: true,
            fields: [
                {
                    id: 'roof_type',
                    label: 'Roof Type',
                    field_type: 'select',
                    required: true,
                    options: ['fixed_cone', 'floating_internal', 'floating_external'],
                },
                {
                    id: 'roof_plate_condition',
                    label: 'Roof Plate Condition',
                    field_type: 'select',
                    required: false,
                    options: ['good', 'fair', 'poor', 'failed'],
                },
                {
                    id: 'floating_roof_seal',
                    label: 'Floating Roof Seal Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'torn', 'missing', 'N/A'],
                    condition: { depends_on: 'roof_type', equals: 'floating_internal' },
                    help_text:
                        'Applicable to floating roof tanks only. Select N/A for fixed-cone roofs.',
                },
                {
                    id: 'roof_drain',
                    label: 'Roof Drain Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'blocked', 'corroded', 'N/A'],
                },
            ],
        },

        // — Appurtenances —
        {
            id: 'appurtenances',
            title: 'Appurtenances',
            description: 'Vents, gauging/sampling, nozzles, and manways.',
            icon: 'Wrench',
            required: false,
            fields: [
                {
                    id: 'vents_condition',
                    label: 'Vents Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'blocked', 'corroded', 'missing'],
                },
                {
                    id: 'gauging_sampling',
                    label: 'Gauging / Sampling',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'inoperable', 'corroded', 'N/A'],
                },
                {
                    id: 'nozzle_manway',
                    label: 'Nozzle / Manway Condition',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'leaking', 'corroded', 'gasket_failure'],
                },
            ],
        },
    ],
};

// ═══════════════════════════════════════════════════════════════════════
//  4 — General VT  Visual Inspection
// ═══════════════════════════════════════════════════════════════════════
export const GENERAL_VT_TEMPLATE: InspectionFormTemplate = {
    id: 'tpl_general_vt',
    name: 'General VT — Visual Inspection',
    governing_code: 'ASME B31.3',
    inspection_types: ['VT'],
    description:
        'General-purpose visual inspection template suitable for any asset type. Covers overall condition rating, corrosion, structural integrity, and free-text observations.',
    version: '1.0.0',
    sections: [
        // — Administrative —
        makeAdminSection(),

        // — General Condition —
        {
            id: 'general_condition',
            title: 'General Condition',
            description: 'High-level asset condition assessment.',
            icon: 'Activity',
            required: true,
            fields: [
                {
                    id: 'overall_rating',
                    label: 'Overall Condition Rating',
                    field_type: 'select',
                    required: true,
                    options: [
                        '1_excellent',
                        '2_good',
                        '3_fair',
                        '4_poor',
                        '5_unacceptable',
                    ],
                },
                {
                    id: 'external_corrosion',
                    label: 'External Corrosion',
                    field_type: 'select',
                    required: false,
                    options: ['none', 'minor', 'moderate', 'severe'],
                },
                {
                    id: 'structural_integrity',
                    label: 'Structural Integrity',
                    field_type: 'select',
                    required: false,
                    options: ['satisfactory', 'minor_defects', 'major_defects'],
                },
                {
                    id: 'leak_evidence',
                    label: 'Leak Evidence',
                    field_type: 'checkbox',
                    required: false,
                },
                {
                    id: 'vibration_noise',
                    label: 'Vibration / Noise',
                    field_type: 'checkbox',
                    required: false,
                },
                {
                    id: 'lubrication_condition',
                    label: 'Lubrication Condition',
                    field_type: 'select',
                    required: false,
                    options: ['adequate', 'low', 'dry', 'N/A'],
                },
            ],
        },

        // — Observations —
        {
            id: 'observations',
            title: 'Observations',
            description: 'Detailed findings, hazards, and safety concerns.',
            icon: 'FileText',
            required: true,
            fields: [
                {
                    id: 'detailed_observations',
                    label: 'Detailed Observations',
                    field_type: 'textarea',
                    required: true,
                    placeholder:
                        'Describe all observations, anomalies, and conditions noted during the inspection...',
                },
                {
                    id: 'immediate_hazards',
                    label: 'Immediate Hazards Identified',
                    field_type: 'checkbox',
                    required: false,
                    help_text:
                        'If checked, stop work and notify site HSE immediately.',
                },
                {
                    id: 'safety_concerns',
                    label: 'Safety Concerns',
                    field_type: 'textarea',
                    required: false,
                    placeholder: 'Detail any safety concerns identified...',
                    condition: { depends_on: 'immediate_hazards', equals: true },
                },
            ],
        },
    ],
};

// ── Convenience lookup map ─────────────────────────────────────────────
export const INSPECTION_TEMPLATES: Record<string, InspectionFormTemplate> = {
    [API_510_TEMPLATE.id]: API_510_TEMPLATE,
    [API_570_TEMPLATE.id]: API_570_TEMPLATE,
    [API_653_TEMPLATE.id]: API_653_TEMPLATE,
    [GENERAL_VT_TEMPLATE.id]: GENERAL_VT_TEMPLATE,
};

/** Get a template by governing code */
export const getTemplateByCode = (
    code: string,
): InspectionFormTemplate | undefined =>
    Object.values(INSPECTION_TEMPLATES).find((t) => t.governing_code === code);

// Suppress noUnusedLocals for type-only imports used for documentation
void (undefined as unknown as TemplateField);
void (undefined as unknown as TemplateSection);
