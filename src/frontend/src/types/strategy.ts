// ═══════════════════════════════════════════════════════════════════════
//  Strategy & Governance Types — ers-sustain & ers-vision schema mirror
// ═══════════════════════════════════════════════════════════════════════

export type TrendDirection = 'improving' | 'stable' | 'declining';

export interface StrategicKPI {
    id: string;
    name: string;
    value: number;
    target: number;
    unit: string;
    trend: TrendDirection;
    period: string;
}

// ── Carbon (ers-sustain mirror) ──
export interface CarbonMetrics {
    asset_id: string;
    asset_name: string;
    scope1_tco2: number;
    scope2_tco2: number;
    total_tco2: number;
}

export interface RepairVsReplace {
    asset_id: string;
    asset_name: string;
    repair_cost: number;
    replace_cost: number;
    repair_carbon_kg: number;
    replace_carbon_kg: number;
    recommendation: 'repair' | 'replace';
}

// ── Circular Economy ──
export type WasteCategory = 'recycled' | 'reused' | 'landfill' | 'incinerated' | 'hazardous';

export interface WasteStream {
    category: WasteCategory;
    mass_tonnes: number;
    pct: number;
}

// ── Climate Risk (ers-sustain mirror) ──
export type RiskLevel = 'low' | 'moderate' | 'high' | 'extreme';

export interface ClimateRisk {
    asset_id: string;
    asset_name: string;
    risk_level: RiskLevel;
    risk_factors: string[];
    vulnerability_score: number; // 0-100
}

// ── Vision / CV ──
export type AnalysisType = 'corrosion' | 'thermal' | 'condition' | 'tagging';
export type VisionSeverity = 'minor' | 'moderate' | 'severe' | 'critical';

export interface VisionResult {
    id: string;
    image_name: string;
    analysis_type: AnalysisType;
    detected_items: number;
    max_severity: VisionSeverity;
    timestamp: string;
    asset_id: string;
    reviewed: boolean;
}

export interface DroneSurvey {
    id: string;
    survey_name: string;
    date: string;
    area_covered_sqm: number;
    anomalies_found: number;
    reviewed: boolean;
    asset_id?: string;   // Links to Asset Module hierarchy
    site?: string;       // Site/location from Asset Module
}

// ── Data Quality ──
export type EntityType = 'asset' | 'work_order' | 'person' | 'inventory';

export interface DataQualityScore {
    entity_type: EntityType;
    total_records: number;
    missing_fields_pct: number;
    duplicate_count: number;
    completeness_score: number;
}

export interface DataViolation {
    id: string;
    entity_type: EntityType;
    record_id: string;
    record_name: string;
    violation: string;
    severity: 'error' | 'warning';
}
