/**
 * ERS Phase 2 — Core Intelligence Types
 * Maps to backend Pydantic schemas in ers-predict, ers-analyze, and layer1-data-fabric/knowledge-graph
 */

// ---------------------------------------------------------
//  ERS Predict
// ---------------------------------------------------------

export type GovernanceTier = 1 | 2 | 3 | 4 | 5;

export interface TwinHealthProjection {
    days_ahead: number;
    health_index: number;
    confidence_lower: number;
    confidence_upper: number;
}

export interface DegradationModelConfig {
    mechanism: string;
    model_type: string;
    parameters: Record<string, number>;
    current_damage_pct: number;
    projected_failure_date: string | null;
}

export interface TwinState {
    asset_id: string;
    twin_id: string;
    health_index: number;
    degradation_models: DegradationModelConfig[];
    health_projection: TwinHealthProjection[];
    last_calibrated_at: string | null;
    calibration_quality: number;
    calibration_drift: number;
    sensor_summary: Record<string, number>;
    updated_at: string;
}

export interface ConfidenceBand {
    percentile: number;
    lower_days: number;
    upper_days: number;
    median_days: number;
}

export interface RULEstimate {
    asset_id: string;
    rul_days: number;
    confidence: number;
    confidence_bands: ConfidenceBand[];
    distribution_type: string;
    dqs_impact: number;
    governance_tier: GovernanceTier;
    computed_at: string;
}

export interface PredictionAlert {
    alert_id: string;
    asset_id: string;
    alert_type: string;
    severity: 'emergency' | 'high' | 'medium' | 'low' | 'info';
    title: string;
    description: string;
    confidence: number;
    dqs_impact: number;
    governance_tier: GovernanceTier;
    created_at: string;
}

export interface SystemTopologyNode {
    asset_id: string;
    asset_name: string;
    reliability: number;
    health_index: number;
    is_bottleneck: boolean;
    children: SystemTopologyNode[];
    connection_type: 'series' | 'parallel' | 'k_of_n';
}

// ---------------------------------------------------------
//  ERS Analyze
// ---------------------------------------------------------

export interface BadActorAsset {
    asset_id: string;
    asset_name: string;
    rank: number;
    metric_value: number;
    metric_unit: string;
    pct_of_total: number;
    cumulative_pct: number;
    trend: 'improving' | 'stable' | 'worsening';
    previous_rank: number | null;
}

export interface BadActorReportOutput {
    report_period: string;
    criteria: 'cost' | 'downtime' | 'wo_frequency';
    top_assets: BadActorAsset[];
    total_assets_analyzed: number;
    pareto_threshold_pct: number;
    top_5_pct_of_total: number;
    generated_at: string;
}

export interface FMEAItemRead {
    id: string;
    component: string;
    function: string | null;
    failure_mode: string;
    failure_effect: string | null;
    failure_cause: string | null;
    severity: number;
    occurrence: number;
    detection: number;
    rpn: number;
    current_controls: string | null;
    recommended_action: string | null;
    action_status: string;
}

export interface FMEAWorksheetRead {
    id: string;
    asset_id: string;
    title: string;
    fmea_type: string;
    status: string;
    items: FMEAItemRead[];
    max_rpn: number;
    avg_rpn: number;
    high_risk_count: number;
    created_at: string;
}

export interface RCANodeRead {
    id: string;
    parent_id: string | null;
    node_type: string;
    description: string;
    depth: number;
    is_root_cause: boolean;
    children: RCANodeRead[];
}

export interface RCAInvestigationRead {
    id: string;
    asset_id: string;
    title: string;
    method: 'five_why' | 'fishbone' | 'fta' | 'barrier';
    status: string;
    problem_statement: string;
    root_cause_summary: string | null;
    root_causes: RCANodeRead[];
    nodes: RCANodeRead[]; // Flat list
    created_at: string;
}

export interface MonteCarloResult {
    iterations: number;
    availability_mean: number;
    mtbf_mean: number;
    total_cost_mean: number;
}

export interface MonteCarloComparison {
    baseline: MonteCarloResult;
    proposed: MonteCarloResult;
    delta_availability: number;
    delta_cost: number;
    delta_mtbf: number;
    recommendation: string;
}

export interface RCAPatternMatch {
    pattern_id: string;
    recurring_cause: string;
    frequency: number;
    confidence: number;
    recommended_action: string;
    governance_tier: GovernanceTier;
}

// ---------------------------------------------------------
//  Scenario & What-If
// ---------------------------------------------------------

export interface ScenarioInput {
    scenario_name: string;
    pm_interval_days: number;
    load_factor: number;
    temp_delta_c: number;
    strategy: 'current_pm' | 'rcm' | 'cbm' | 'rtf';
}

export interface ScenarioMetrics {
    availability_pct: number;
    mtbf_days: number;
    annual_cost_usd: number;
    failure_probability_1yr: number;
    confidence_interval: [number, number];
}

export interface ScenarioOutput {
    scenario: ScenarioInput;
    baseline: ScenarioMetrics;
    projected: ScenarioMetrics;
    delta: {
        availability: number;
        mtbf: number;
        cost: number;
        failure_prob: number;
    };
    recommendation: string;
    governance_tier: GovernanceTier;
    monte_carlo_runs: number;
}

// ---------------------------------------------------------
//  Sensor Trends (sparklines)
// ---------------------------------------------------------

export interface SensorTrend {
    tag: string;
    current: number;
    unit: string;
    readings: number[];       // last 24 readings
    trend: 'rising' | 'falling' | 'stable';
    alarm_high?: number;
    alarm_low?: number;
}

// ---------------------------------------------------------
//  Fleet Health
// ---------------------------------------------------------

export interface FleetAssetHealth {
    asset_id: string;
    asset_name: string;
    unit: string;
    criticality: 'A' | 'B' | 'C';
    health_index: number;
    rul_days: number;
    trend: 'improving' | 'stable' | 'degrading';
    active_alerts: number;
}

// ---------------------------------------------------------
//  Knowledge Graph
// ---------------------------------------------------------

export interface GraphNode {
    id: string;
    label: 'Asset' | 'FailureMode' | 'Cause' | 'Person' | 'Competency' | 'StandardClause' | 'KPI' | 'Department';
    name?: string;
    description?: string;
    group?: number;
    [key: string]: any;
}

export interface GraphLink {
    source: string; // source node id
    target: string; // target node id
    type: 'EXPERIENCES' | 'CAUSED_BY' | 'MAINTAINS' | 'FEEDS' | 'HAS_COMPETENCY' | 'OWNS' | 'ALSO_AFFECTS';
    [key: string]: any;
}

export interface ImpactNetworkResponse {
    root_asset: GraphNode;
    directly_fed_assets: GraphNode[];
    cascade_depth: number;
    total_impacted: number;
    paths: any[];
}
