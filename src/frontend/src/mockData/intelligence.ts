/**
 * Mock Intelligence data — twin states, RUL, alerts, bad actors, FMEA, RCA, network.
 * Extracted from useIntelligence.ts for centralised management.
 */
import type {
    TwinState, RULEstimate, PredictionAlert,
    BadActorAsset, FMEAWorksheetRead, RCAInvestigationRead,
    ImpactNetworkResponse, SensorTrend
} from '../types/intelligence';

// ── Asset Picker Options ──
export interface AssetOption {
    id: string;
    name: string;
    unit: string;
    criticality: 'A' | 'B' | 'C';
}

export const MOCK_PREDICT_ASSETS: AssetOption[] = [
    { id: 'ast-k601', name: 'Gas Compressor K-601', unit: 'Compression Train A', criticality: 'A' },
    { id: 'ast-p102', name: 'Booster Pump P-102', unit: 'Water Injection', criticality: 'B' },
    { id: 'ast-gt301', name: 'Gas Turbine GT-301', unit: 'Power Generation', criticality: 'A' },
    { id: 'ast-hx105', name: 'Overhead Condenser HX-105', unit: 'Crude Distillation', criticality: 'B' },
    { id: 'ast-v602', name: 'Knockout Drum V-602', unit: 'Compression Train A', criticality: 'C' },
];

// ── Digital Twin States ──
export const MOCK_TWIN_STATES: Record<string, TwinState> = {
    'ast-k601': {
        asset_id: 'ast-k601', twin_id: 'twn-k601', health_index: 82.5,
        last_calibrated_at: new Date().toISOString(), calibration_quality: 94, calibration_drift: 0.02,
        sensor_summary: { 'Vib Radial (mm/s)': 4.2, 'Vib Axial (mm/s)': 2.1, 'Bearing Temp (°C)': 68.5, 'Discharge Flow (m³/h)': 1240.2 },
        updated_at: new Date().toISOString(),
        degradation_models: [
            { mechanism: 'Bearing Wear', model_type: 'L10 Lifetime', parameters: { l10_base: 50000 }, current_damage_pct: 17.5, projected_failure_date: new Date(Date.now() + 180 * 86400000).toISOString() },
            { mechanism: 'Seal Degradation', model_type: 'Linear Wear', parameters: { wear_rate: 0.003 }, current_damage_pct: 42.0, projected_failure_date: new Date(Date.now() + 95 * 86400000).toISOString() },
        ],
        health_projection: Array.from({ length: 30 }, (_, i) => ({ days_ahead: i, health_index: 82.5 - i * 0.15, confidence_lower: 82.5 - i * 0.15 - i * 0.05, confidence_upper: 82.5 - i * 0.15 + i * 0.05 })),
    },
    'ast-p102': {
        asset_id: 'ast-p102', twin_id: 'twn-p102', health_index: 64.2,
        last_calibrated_at: new Date().toISOString(), calibration_quality: 78, calibration_drift: 0.08,
        sensor_summary: { 'Discharge Pressure (bar)': 14.8, 'Suction Pressure (bar)': 2.1, 'Motor Temp (°C)': 82.5, 'Vibration (mm/s)': 6.8 },
        updated_at: new Date().toISOString(),
        degradation_models: [
            { mechanism: 'Impeller Erosion', model_type: 'Exponential', parameters: { rate: 0.005 }, current_damage_pct: 55.0, projected_failure_date: new Date(Date.now() + 60 * 86400000).toISOString() },
        ],
        health_projection: Array.from({ length: 30 }, (_, i) => ({ days_ahead: i, health_index: 64.2 - i * 0.35, confidence_lower: 64.2 - i * 0.35 - i * 0.1, confidence_upper: 64.2 - i * 0.35 + i * 0.1 })),
    },
    'ast-gt301': {
        asset_id: 'ast-gt301', twin_id: 'twn-gt301', health_index: 91.0,
        last_calibrated_at: new Date().toISOString(), calibration_quality: 98, calibration_drift: 0.01,
        sensor_summary: { 'Exhaust Temp (°C)': 545.0, 'Inlet Temp (°C)': 32.0, 'Shaft Speed (RPM)': 14200, 'Power Output (MW)': 24.8 },
        updated_at: new Date().toISOString(),
        degradation_models: [
            { mechanism: 'Hot Section Creep', model_type: 'Larson-Miller', parameters: { c: 25 }, current_damage_pct: 8.0, projected_failure_date: new Date(Date.now() + 365 * 86400000).toISOString() },
        ],
        health_projection: Array.from({ length: 30 }, (_, i) => ({ days_ahead: i, health_index: 91.0 - i * 0.05, confidence_lower: 91.0 - i * 0.05 - i * 0.02, confidence_upper: 91.0 - i * 0.05 + i * 0.02 })),
    },
};

// ── RUL Estimates ──
export const MOCK_RUL: Record<string, RULEstimate> = {
    'ast-k601': { asset_id: 'ast-k601', rul_days: 142.5, confidence: 0.88, distribution_type: 'weibull_2p', dqs_impact: 0.02, governance_tier: 3, computed_at: new Date().toISOString(), confidence_bands: [{ percentile: 50, lower_days: 130, upper_days: 155, median_days: 142.5 }, { percentile: 80, lower_days: 110, upper_days: 180, median_days: 142.5 }, { percentile: 95, lower_days: 90, upper_days: 210, median_days: 142.5 }] },
    'ast-p102': { asset_id: 'ast-p102', rul_days: 58.0, confidence: 0.72, distribution_type: 'lognormal', dqs_impact: 0.08, governance_tier: 2, computed_at: new Date().toISOString(), confidence_bands: [{ percentile: 50, lower_days: 45, upper_days: 70, median_days: 58 }, { percentile: 80, lower_days: 30, upper_days: 90, median_days: 58 }, { percentile: 95, lower_days: 15, upper_days: 120, median_days: 58 }] },
    'ast-gt301': { asset_id: 'ast-gt301', rul_days: 320.0, confidence: 0.95, distribution_type: 'weibull_3p', dqs_impact: 0.01, governance_tier: 3, computed_at: new Date().toISOString(), confidence_bands: [{ percentile: 50, lower_days: 300, upper_days: 340, median_days: 320 }, { percentile: 80, lower_days: 270, upper_days: 380, median_days: 320 }, { percentile: 95, lower_days: 240, upper_days: 420, median_days: 320 }] },
};

// ── Alerts ──
export const MOCK_ALERTS: PredictionAlert[] = [
    { alert_id: 'alt-001', asset_id: 'ast-k601', alert_type: 'trend_deviation', severity: 'high', title: 'Accelerated Bearing Wear Detected', description: 'Vibration signature in high-frequency band indicates early stage inner race spalling.', confidence: 0.92, dqs_impact: 0.01, governance_tier: 3, created_at: new Date(Date.now() - 3600000 * 2).toISOString() },
    { alert_id: 'alt-002', asset_id: 'ast-p102', alert_type: 'threshold_breach', severity: 'medium', title: 'Discharge Pressure Dropping', description: 'Discharge pressure is 5% below expected dynamic threshold.', confidence: 0.85, dqs_impact: 0.05, governance_tier: 2, created_at: new Date(Date.now() - 3600000 * 24).toISOString() },
    { alert_id: 'alt-003', asset_id: 'ast-k601', alert_type: 'anomaly', severity: 'low', title: 'Minor Seal Leak Rate Increase', description: 'Primary seal leak rate has increased by 12% over the past 72 hours.', confidence: 0.78, dqs_impact: 0.0, governance_tier: 3, created_at: new Date(Date.now() - 3600000 * 48).toISOString() },
];

// ── Bad Actors ──
export const MOCK_BAD_ACTORS: Record<string, BadActorAsset[]> = {
    cost: [
        { asset_id: 'pmp-411', asset_name: 'Boiler Feed Pump B', rank: 1, metric_value: 125000, metric_unit: '$', pct_of_total: 25.5, cumulative_pct: 25.5, trend: 'worsening', previous_rank: 3 },
        { asset_id: 'cmp-201', asset_name: 'Main Air Compressor', rank: 2, metric_value: 85000, metric_unit: '$', pct_of_total: 17.3, cumulative_pct: 42.8, trend: 'stable', previous_rank: 2 },
        { asset_id: 'hx-105', asset_name: 'Overhead Condenser', rank: 3, metric_value: 55000, metric_unit: '$', pct_of_total: 11.2, cumulative_pct: 54.0, trend: 'improving', previous_rank: 1 },
        { asset_id: 'mv-881', asset_name: 'Inlet Block Valve', rank: 4, metric_value: 25000, metric_unit: '$', pct_of_total: 5.1, cumulative_pct: 59.1, trend: 'stable', previous_rank: 4 },
        { asset_id: 'tk-005', asset_name: 'Slop Oil Tank', rank: 5, metric_value: 16700, metric_unit: '$', pct_of_total: 3.4, cumulative_pct: 62.5, trend: 'worsening', previous_rank: 12 },
    ],
    downtime: [
        { asset_id: 'cmp-201', asset_name: 'Main Air Compressor', rank: 1, metric_value: 480, metric_unit: 'hrs', pct_of_total: 22.0, cumulative_pct: 22.0, trend: 'worsening', previous_rank: 1 },
        { asset_id: 'pmp-411', asset_name: 'Boiler Feed Pump B', rank: 2, metric_value: 310, metric_unit: 'hrs', pct_of_total: 14.2, cumulative_pct: 36.2, trend: 'stable', previous_rank: 3 },
        { asset_id: 'cv-902', asset_name: 'Conveyor Belt C-902', rank: 3, metric_value: 255, metric_unit: 'hrs', pct_of_total: 11.7, cumulative_pct: 47.9, trend: 'worsening', previous_rank: 8 },
        { asset_id: 'hx-105', asset_name: 'Overhead Condenser', rank: 4, metric_value: 180, metric_unit: 'hrs', pct_of_total: 8.3, cumulative_pct: 56.2, trend: 'improving', previous_rank: 2 },
        { asset_id: 'tk-005', asset_name: 'Slop Oil Tank', rank: 5, metric_value: 95, metric_unit: 'hrs', pct_of_total: 4.4, cumulative_pct: 60.6, trend: 'stable', previous_rank: 5 },
    ],
    wo_frequency: [
        { asset_id: 'cv-902', asset_name: 'Conveyor Belt C-902', rank: 1, metric_value: 42, metric_unit: 'WOs', pct_of_total: 18.5, cumulative_pct: 18.5, trend: 'worsening', previous_rank: 2 },
        { asset_id: 'pmp-411', asset_name: 'Boiler Feed Pump B', rank: 2, metric_value: 35, metric_unit: 'WOs', pct_of_total: 15.4, cumulative_pct: 33.9, trend: 'stable', previous_rank: 1 },
        { asset_id: 'cmp-201', asset_name: 'Main Air Compressor', rank: 3, metric_value: 28, metric_unit: 'WOs', pct_of_total: 12.3, cumulative_pct: 46.2, trend: 'stable', previous_rank: 3 },
        { asset_id: 'mv-881', asset_name: 'Inlet Block Valve', rank: 4, metric_value: 18, metric_unit: 'WOs', pct_of_total: 7.9, cumulative_pct: 54.1, trend: 'improving', previous_rank: 4 },
        { asset_id: 'hx-105', asset_name: 'Overhead Condenser', rank: 5, metric_value: 12, metric_unit: 'WOs', pct_of_total: 5.3, cumulative_pct: 59.4, trend: 'stable', previous_rank: 6 },
    ],
};

// ── FMEA ──
export const MOCK_FMEA: FMEAWorksheetRead = {
    id: 'fmea-001', asset_id: 'cmp-201', title: 'Centrifugal Compressor FMEA', fmea_type: 'equipment', status: 'active', max_rpn: 280, avg_rpn: 85, high_risk_count: 3, created_at: '2025-11-10T00:00:00Z',
    items: [
        { id: 'item-1', component: 'Radial Bearing', function: 'Support rotor radially', failure_mode: 'Babbitt fatigue/wiping', failure_effect: 'High vibration, rotor contact', failure_cause: 'Lube oil starvation', severity: 8, occurrence: 4, detection: 3, rpn: 96, current_controls: 'Vibration monitoring (monthly route)', recommended_action: 'Install continuous vibration sensors', action_status: 'open' },
        { id: 'item-2', component: 'Dry Gas Seal', function: 'Prevent gas leakage', failure_mode: 'O-ring explosive decompression', failure_effect: 'Gas leak, unit trip', failure_cause: 'Rapid depressurization', severity: 10, occurrence: 2, detection: 2, rpn: 40, current_controls: 'Slow depressurization procedure', recommended_action: null, action_status: 'closed' },
        { id: 'item-3', component: 'Thrust Bearing', function: 'Absorb axial loads', failure_mode: 'Overload wiping', failure_effect: 'Rotor crash, extensive damage', failure_cause: 'Surge event', severity: 10, occurrence: 4, detection: 7, rpn: 280, current_controls: 'Anti-surge valve', recommended_action: 'Recalibrate anti-surge controller tuning', action_status: 'open' },
        { id: 'item-4', component: 'Lube Oil Pump', function: 'Circulate lube oil', failure_mode: 'Low oil pressure', failure_effect: 'Bearing damage', failure_cause: 'Filter blockage', severity: 7, occurrence: 3, detection: 4, rpn: 84, current_controls: 'dP alarm on filter', recommended_action: 'Add redundant oil pump', action_status: 'open' },
        { id: 'item-5', component: 'Coupling', function: 'Transmit torque', failure_mode: 'Misalignment fatigue', failure_effect: 'Vibration, premature failure', failure_cause: 'Foundation settling', severity: 6, occurrence: 2, detection: 5, rpn: 60, current_controls: 'Laser alignment on overhaul', recommended_action: null, action_status: 'closed' },
    ]
};

// ── RCA ──
export const MOCK_RCAS: RCAInvestigationRead[] = [
    {
        id: 'rca-105', asset_id: 'pmp-411', title: 'Premature Seal Failure', method: 'five_why', status: 'review',
        problem_statement: 'Mechanical seal failed after only 3 weeks of operation, causing a tier 2 environmental spill.',
        root_cause_summary: 'Incorrect seal face material selected during procurement due to undocumented process fluid change (higher H2S content).',
        created_at: '2026-02-15T00:00:00Z',
        root_causes: [{ id: 'node-5', parent_id: 'node-4', node_type: 'root_cause', description: 'MoC process was not followed when process fluid composition was changed to include higher H2S.', depth: 4, is_root_cause: true, children: [] }],
        nodes: [
            { id: 'node-1', parent_id: null, node_type: 'problem', description: 'Mechanical seal failed prematurely', depth: 0, is_root_cause: false, children: [] },
            { id: 'node-2', parent_id: 'node-1', node_type: 'why', description: 'Seal faces became heavily pitted', depth: 1, is_root_cause: false, children: [] },
            { id: 'node-3', parent_id: 'node-2', node_type: 'why', description: 'Material chemically attacked by process fluid', depth: 2, is_root_cause: false, children: [] },
            { id: 'node-4', parent_id: 'node-3', node_type: 'why', description: 'Procurement ordered standard material', depth: 3, is_root_cause: false, children: [] },
            { id: 'node-5', parent_id: 'node-4', node_type: 'root_cause', description: 'MoC process was not followed when process fluid composition was changed', depth: 4, is_root_cause: true, children: [] },
        ]
    },
    {
        id: 'rca-112', asset_id: 'cv-902', title: 'Repeated Belt Failures', method: 'fishbone', status: 'in_progress',
        problem_statement: 'Conveyor belts snapping every 3-4 months, well below expected 24 month lifespan.',
        root_cause_summary: null, created_at: '2026-02-18T00:00:00Z',
        root_causes: [],
        nodes: [
            { id: 'n-1', parent_id: null, node_type: 'problem', description: 'Belt snapping every 3-4 months', depth: 0, is_root_cause: false, children: [] },
            { id: 'n-2', parent_id: 'n-1', node_type: 'category', description: 'Material — belt grade below specification', depth: 1, is_root_cause: false, children: [] },
            { id: 'n-3', parent_id: 'n-1', node_type: 'category', description: 'Machine — idler roller seizure causing hot spots', depth: 1, is_root_cause: false, children: [] },
        ]
    }
];

// ── Knowledge Graph / Impact Network ──
export const MOCK_NETWORK: ImpactNetworkResponse = {
    root_asset: { id: 'ast-k601', label: 'Asset', name: 'Gas Compressor K-601', group: 1, critical: true },
    directly_fed_assets: [
        { id: 'ast-v602', label: 'Asset', name: 'Knockout Drum V-602', group: 1 },
        { id: 'ast-e605', label: 'Asset', name: 'Discharge Cooler E-605', group: 1 },
    ],
    cascade_depth: 4,
    total_impacted: 18,
    paths: [
        { source: 'ast-k601', target: 'ast-v602', type: 'FEEDS' },
        { source: 'ast-k601', target: 'ast-e605', type: 'FEEDS' },
        { source: 'ast-v602', target: 'ast-s610', type: 'FEEDS' },
        { source: 'ast-e605', target: 'ast-t620', type: 'FEEDS' },
        { source: 'ast-s610', target: 'ast-flr01', type: 'FEEDS' },
        { source: 'psn-001', target: 'ast-k601', type: 'MAINTAINS' },
        { source: 'psn-002', target: 'ast-k601', type: 'MAINTAINS' },
        { source: 'psn-001', target: 'ast-v602', type: 'MAINTAINS' },
        { source: 'psn-003', target: 'ast-e605', type: 'MAINTAINS' },
        { source: 'ast-k601', target: 'fm-001', type: 'EXPERIENCES' },
        { source: 'ast-k601', target: 'fm-002', type: 'EXPERIENCES' },
        { source: 'ast-v602', target: 'fm-003', type: 'EXPERIENCES' },
        { source: 'fm-001', target: 'cau-001', type: 'CAUSED_BY' },
        { source: 'fm-001', target: 'cau-002', type: 'CAUSED_BY' },
        { source: 'fm-002', target: 'cau-003', type: 'CAUSED_BY' },
        { source: 'fm-003', target: 'cau-004', type: 'CAUSED_BY' },
        { source: 'fm-001', target: 'kpi-001', type: 'ALSO_AFFECTS' },
        { source: 'fm-002', target: 'kpi-002', type: 'ALSO_AFFECTS' },
        { source: 'psn-001', target: 'comp-001', type: 'HAS_COMPETENCY' },
        { source: 'psn-002', target: 'comp-002', type: 'HAS_COMPETENCY' },
        { source: 'psn-003', target: 'comp-001', type: 'HAS_COMPETENCY' },
        { source: 'dept-001', target: 'ast-k601', type: 'OWNS' },
        { source: 'dept-001', target: 'ast-v602', type: 'OWNS' },
        { source: 'dept-002', target: 'ast-e605', type: 'OWNS' },
    ]
};

// ── Sensor Trends ──
function generateReadings(base: number, variance: number, trend: 'rising' | 'falling' | 'stable', count = 24): number[] {
    return Array.from({ length: count }, (_, i) => {
        const trendOffset = trend === 'rising' ? i * variance * 0.04 : trend === 'falling' ? -i * variance * 0.03 : 0;
        return base + trendOffset + (Math.random() - 0.5) * variance;
    });
}

export const MOCK_SENSOR_TRENDS: Record<string, SensorTrend[]> = {
    'ast-k601': [
        { tag: 'Vib Radial (mm/s)', current: 4.2, unit: 'mm/s', readings: generateReadings(3.8, 0.8, 'rising'), trend: 'rising', alarm_high: 6.0 },
        { tag: 'Vib Axial (mm/s)', current: 2.1, unit: 'mm/s', readings: generateReadings(2.0, 0.3, 'stable'), trend: 'stable', alarm_high: 4.0 },
        { tag: 'Bearing Temp (°C)', current: 68.5, unit: '°C', readings: generateReadings(65, 4, 'rising'), trend: 'rising', alarm_high: 85 },
        { tag: 'Discharge Flow (m³/h)', current: 1240.2, unit: 'm³/h', readings: generateReadings(1260, 30, 'falling'), trend: 'falling', alarm_low: 1100 },
    ],
    'ast-p102': [
        { tag: 'Discharge Pressure (bar)', current: 14.8, unit: 'bar', readings: generateReadings(15.5, 1.0, 'falling'), trend: 'falling', alarm_low: 13 },
        { tag: 'Suction Pressure (bar)', current: 2.1, unit: 'bar', readings: generateReadings(2.2, 0.2, 'stable'), trend: 'stable' },
        { tag: 'Motor Temp (°C)', current: 82.5, unit: '°C', readings: generateReadings(78, 5, 'rising'), trend: 'rising', alarm_high: 95 },
        { tag: 'Vibration (mm/s)', current: 6.8, unit: 'mm/s', readings: generateReadings(5.5, 1.5, 'rising'), trend: 'rising', alarm_high: 8.0 },
    ],
    'ast-gt301': [
        { tag: 'Exhaust Temp (°C)', current: 545.0, unit: '°C', readings: generateReadings(540, 8, 'stable'), trend: 'stable', alarm_high: 580 },
        { tag: 'Inlet Temp (°C)', current: 32.0, unit: '°C', readings: generateReadings(31, 2, 'stable'), trend: 'stable' },
        { tag: 'Shaft Speed (RPM)', current: 14200, unit: 'RPM', readings: generateReadings(14200, 50, 'stable'), trend: 'stable' },
        { tag: 'Power Output (MW)', current: 24.8, unit: 'MW', readings: generateReadings(25, 0.5, 'falling'), trend: 'falling', alarm_low: 22 },
    ],
};
