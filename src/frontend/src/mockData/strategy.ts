/**
 * Mock Strategy data — carbon, repair-vs-replace, waste, climate, vision, drones, data quality.
 * Extracted from useStrategy.ts for centralised management.
 */
import type {
    CarbonMetrics, RepairVsReplace, WasteStream, ClimateRisk,
    VisionResult, DroneSurvey, DataQualityScore, DataViolation
} from '../types/strategy';

const d = (off: number) => new Date(Date.now() + off * 86400000).toISOString();

export const MOCK_CARBON: CarbonMetrics[] = [
    { asset_id: 'ast-gt301', asset_name: 'Gas Turbine GT-301', scope1_tco2: 12400, scope2_tco2: 850, total_tco2: 13250 },
    { asset_id: 'ast-k601', asset_name: 'Gas Compressor K-601', scope1_tco2: 8200, scope2_tco2: 1200, total_tco2: 9400 },
    { asset_id: 'ast-flr001', asset_name: 'Ground Flare FLR-001', scope1_tco2: 3800, scope2_tco2: 50, total_tco2: 3850 },
    { asset_id: 'ast-htr101', asset_name: 'Process Heater HTR-101', scope1_tco2: 5600, scope2_tco2: 200, total_tco2: 5800 },
    { asset_id: 'ast-p102', asset_name: 'Transfer Pump P-102', scope1_tco2: 0, scope2_tco2: 340, total_tco2: 340 },
];

export const MOCK_RVR: RepairVsReplace[] = [
    { asset_id: 'ast-hx405', asset_name: 'Heat Exchanger HX-405', repair_cost: 45000, replace_cost: 220000, repair_carbon_kg: 1200, replace_carbon_kg: 18500, recommendation: 'repair' },
    { asset_id: 'ast-p102', asset_name: 'Transfer Pump P-102', repair_cost: 18000, replace_cost: 35000, repair_carbon_kg: 800, replace_carbon_kg: 4200, recommendation: 'repair' },
    { asset_id: 'ast-tk801', asset_name: 'Storage Tank TK-801', repair_cost: 180000, replace_cost: 320000, repair_carbon_kg: 22000, replace_carbon_kg: 95000, recommendation: 'repair' },
];

export const MOCK_WASTE: WasteStream[] = [
    { category: 'recycled', mass_tonnes: 245, pct: 35 },
    { category: 'reused', mass_tonnes: 140, pct: 20 },
    { category: 'landfill', mass_tonnes: 175, pct: 25 },
    { category: 'incinerated', mass_tonnes: 70, pct: 10 },
    { category: 'hazardous', mass_tonnes: 70, pct: 10 },
];

export const MOCK_CLIMATE: ClimateRisk[] = [
    { asset_id: 'ast-tk801', asset_name: 'Storage Tank TK-801', risk_level: 'high', risk_factors: ['Storm surge flooding', 'High wind — roof uplift'], vulnerability_score: 78 },
    { asset_id: 'ast-gt301', asset_name: 'Gas Turbine GT-301', risk_level: 'moderate', risk_factors: ['Extreme heat — derating', 'Sandstorm abrasion'], vulnerability_score: 52 },
    { asset_id: 'ast-subsea', asset_name: 'Subsea Manifold SM-01', risk_level: 'high', risk_factors: ['Sea temperature rise', 'Increased storm frequency'], vulnerability_score: 84 },
    { asset_id: 'ast-p102', asset_name: 'Transfer Pump P-102', risk_level: 'low', risk_factors: ['Flooding (low probability)'], vulnerability_score: 22 },
];

export const MOCK_VISION: VisionResult[] = [
    { id: 'vis-001', image_name: 'V205_shell_12oclock.jpg', analysis_type: 'corrosion', detected_items: 3, max_severity: 'moderate', timestamp: d(-5), asset_id: 'ast-v205', reviewed: true },
    { id: 'vis-002', image_name: 'HX405_exit_elbow.jpg', analysis_type: 'corrosion', detected_items: 7, max_severity: 'severe', timestamp: d(-3), asset_id: 'ast-hx405', reviewed: false },
    { id: 'vis-003', image_name: 'GT301_exhaust_thermal.ir', analysis_type: 'thermal', detected_items: 2, max_severity: 'moderate', timestamp: d(-2), asset_id: 'ast-gt301', reviewed: false },
    { id: 'vis-004', image_name: 'TK801_roof_drone.jpg', analysis_type: 'condition', detected_items: 4, max_severity: 'critical', timestamp: d(-1), asset_id: 'ast-tk801', reviewed: false },
    { id: 'vis-005', image_name: 'P102_nameplate.jpg', analysis_type: 'tagging', detected_items: 1, max_severity: 'minor', timestamp: d(-7), asset_id: 'ast-p102', reviewed: true },
];

export const MOCK_DRONE: DroneSurvey[] = [
    { id: 'drn-001', survey_name: 'Tank Farm Q1 Aerial', date: d(-10), area_covered_sqm: 45000, anomalies_found: 6, reviewed: true, asset_id: 'ast-tk801', site: 'Tank Farm Alpha' },
    { id: 'drn-002', survey_name: 'Platform Alpha Topside', date: d(-3), area_covered_sqm: 12000, anomalies_found: 3, reviewed: false, asset_id: 'ast-gt301', site: 'Platform Alpha' },
];

export const MOCK_DQ: DataQualityScore[] = [
    { entity_type: 'asset', total_records: 847, missing_fields_pct: 4.2, duplicate_count: 3, completeness_score: 94.1 },
    { entity_type: 'work_order', total_records: 2340, missing_fields_pct: 8.7, duplicate_count: 12, completeness_score: 86.3 },
    { entity_type: 'person', total_records: 186, missing_fields_pct: 2.1, duplicate_count: 1, completeness_score: 97.2 },
    { entity_type: 'inventory', total_records: 4520, missing_fields_pct: 11.3, duplicate_count: 45, completeness_score: 81.5 },
];

export const MOCK_VIOLATIONS: DataViolation[] = [
    { id: 'dv-001', entity_type: 'asset', record_id: 'AST-K601', record_name: 'Gas Compressor K-601', violation: 'Missing Criticality Ranking (mandatory per ISO 14224)', severity: 'error' },
    { id: 'dv-002', entity_type: 'work_order', record_id: 'WO-2024-105', record_name: 'Seal Replacement — P-102', violation: 'Closed without Failure Mode (TECO gate violated)', severity: 'error' },
    { id: 'dv-003', entity_type: 'work_order', record_id: 'WO-2024-098', record_name: 'Valve Overhaul — XV-401', violation: 'Missing Failure Cause code', severity: 'error' },
    { id: 'dv-004', entity_type: 'asset', record_id: 'AST-V301', record_name: 'Test Separator V-301', violation: 'No RBI assessment linked (API 580 compliance gap)', severity: 'warning' },
    { id: 'dv-005', entity_type: 'person', record_id: 'EMP-044', record_name: 'T. Williams', violation: 'BOSIET certification expired 15 days ago', severity: 'warning' },
    { id: 'dv-006', entity_type: 'inventory', record_id: 'INV-2201', record_name: 'Mechanical Seal Kit — P-102', violation: 'Reorder point not set for critical spare', severity: 'warning' },
    { id: 'dv-007', entity_type: 'work_order', record_id: 'WO-2024-112', record_name: 'PM — GT-301 Fuel Nozzle', violation: 'Assigned labour cost is $0 (rate setup missing)', severity: 'warning' },
];
