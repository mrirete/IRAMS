"""
ERS Analyze — Module Schemas
══════════════════════════════
Pydantic schemas for RCM, Monte Carlo, FMEA, RCA,
Criticality, Bad Actor, and Defect Elimination.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ERSAnalyzeBase(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ═══════════════════════════════════════════════════════════════
#  ENUMS
# ═══════════════════════════════════════════════════════════════

class RCMStatus(str, Enum):
    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    APPROVED = "approved"
    SUPERSEDED = "superseded"


class FailureModeSource(str, Enum):
    HISTORICAL = "historical"
    AI_SUGGESTED = "ai_suggested"
    EXPERT = "expert"
    OEM = "oem"


class ConsequenceClass(str, Enum):
    SAFETY_HEALTH = "safety_health"
    ENVIRONMENTAL = "environmental"
    OPERATIONAL = "operational"
    NON_OPERATIONAL = "non_operational"
    HIDDEN_SAFETY = "hidden_safety"
    HIDDEN_ENVIRONMENTAL = "hidden_environmental"
    HIDDEN_OPERATIONAL = "hidden_operational"


class RCMTaskType(str, Enum):
    ON_CONDITION = "on_condition"             # CBM
    SCHEDULED_RESTORATION = "scheduled_restoration"  # TBM
    SCHEDULED_DISCARD = "scheduled_discard"   # TBM
    FAILURE_FINDING = "failure_finding"
    REDESIGN = "redesign"
    RUN_TO_FAILURE = "run_to_failure"


class RCAMethod(str, Enum):
    FIVE_WHY = "five_why"
    FISHBONE = "fishbone"
    FTA = "fta"
    BARRIER = "barrier"


class RCANodeType(str, Enum):
    # 5-Why
    PROBLEM = "problem"
    WHY = "why"
    CAUSE = "cause"
    ROOT_CAUSE = "root_cause"
    # Fishbone
    CATEGORY = "category"
    SUB_CAUSE = "sub_cause"
    # FTA
    TOP_EVENT = "top_event"
    GATE_AND = "gate_and"
    GATE_OR = "gate_or"
    BASIC_EVENT = "basic_event"
    # Barrier
    BARRIER_FAILED = "barrier_failed"
    BARRIER_ABSENT = "barrier_absent"
    BARRIER_EFFECTIVE = "barrier_effective"


class FishboneCategory(str, Enum):
    MAN = "man"
    MACHINE = "machine"
    METHOD = "method"
    MATERIAL = "material"
    MEASUREMENT = "measurement"
    ENVIRONMENT = "environment"


class GovernanceTier(int, Enum):
    TIER_1_AUTO = 1
    TIER_2_HUMAN_REVIEW = 2
    TIER_3_STANDARD = 3
    TIER_4_SUPERVISED = 4
    TIER_5_LOCKED = 5


class DefectSource(str, Enum):
    """Uptime Elements 5 sources of defects."""
    DESIGN = "design"
    PROCUREMENT = "procurement"
    INSTALLATION = "installation"
    OPERATION = "operation"
    MAINTENANCE = "maintenance"


class BadActorCriteria(str, Enum):
    COST = "cost"
    DOWNTIME = "downtime"
    WO_FREQUENCY = "wo_frequency"


# ═══════════════════════════════════════════════════════════════
#  RCM SCHEMAS
# ═══════════════════════════════════════════════════════════════

class RCMFunctionInput(ERSAnalyzeBase):
    """Input for adding an equipment function."""
    function_number: int
    description: str
    performance_standard: Optional[str] = None


class RCMFunctionalFailureInput(ERSAnalyzeBase):
    """Input for adding a functional failure."""
    failure_code: str
    description: str


class RCMFailureModeInput(ERSAnalyzeBase):
    """Input for adding a failure mode."""
    mode_code: str
    description: str
    source: FailureModeSource = FailureModeSource.EXPERT
    iso14224_code: Optional[str] = None


class RCMFailureEffectInput(ERSAnalyzeBase):
    """Input for failure effect."""
    local_effect: str
    system_effect: Optional[str] = None
    consequence_class: Optional[ConsequenceClass] = None
    hidden_failure: bool = False
    detection_method: Optional[str] = None
    mttr_hours: Optional[float] = None
    downtime_cost_per_hour: Optional[float] = None


class RCMAnalysisCreate(ERSAnalyzeBase):
    """Create a new RCM Analysis."""
    asset_id: UUID
    title: str
    description: Optional[str] = None
    operating_context: Optional[str] = None
    facilitator_id: Optional[UUID] = None


class RCMTaskOutput(ERSAnalyzeBase):
    """RCM task selected by the decision tree."""
    task_type: RCMTaskType
    description: str
    interval_days: Optional[float] = None
    interval_hours: Optional[float] = None
    technically_feasible: bool = True
    worth_doing: bool = True
    decision_path: List[str] = []


class RCMFailureModeRead(ERSAnalyzeBase):
    """Complete failure mode with effect and suggested task."""
    id: UUID
    mode_code: str
    description: str
    source: FailureModeSource
    iso14224_code: Optional[str] = None
    ai_confidence: Optional[float] = None
    approved: bool = False
    effect: Optional[RCMFailureEffectInput] = None
    task: Optional[RCMTaskOutput] = None


class RCMFunctionalFailureRead(ERSAnalyzeBase):
    """Functional failure with all its failure modes."""
    id: UUID
    failure_code: str
    description: str
    failure_modes: List[RCMFailureModeRead] = []


class RCMFunctionRead(ERSAnalyzeBase):
    """Equipment function with all its functional failures."""
    id: UUID
    function_number: int
    description: str
    performance_standard: Optional[str] = None
    functional_failures: List[RCMFunctionalFailureRead] = []


class RCMAnalysisRead(ERSAnalyzeBase):
    """Complete RCM analysis with full hierarchy."""
    id: UUID
    asset_id: UUID
    title: str
    description: Optional[str] = None
    operating_context: Optional[str] = None
    status: RCMStatus = RCMStatus.DRAFT
    governance_tier: int = 3
    functions: List[RCMFunctionRead] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class AIFailureModeSuggestion(ERSAnalyzeBase):
    """AI-suggested failure mode from WO history (Tier 2 governance)."""
    description: str
    source: FailureModeSource = FailureModeSource.AI_SUGGESTED
    iso14224_code: Optional[str] = None
    confidence: float = Field(..., ge=0, le=1)
    evidence_wo_ids: List[str] = []
    evidence_snippets: List[str] = []
    governance_tier: GovernanceTier = GovernanceTier.TIER_2_HUMAN_REVIEW


class RCMDecisionTreeInput(ERSAnalyzeBase):
    """Input to the JA1011 decision tree."""
    failure_mode_id: UUID
    consequence_class: ConsequenceClass
    hidden_failure: bool = False
    has_condition_indicator: bool = False
    has_age_reliability_relationship: bool = False
    pf_interval_days: Optional[float] = None
    failure_rate_per_year: Optional[float] = None
    mttr_hours: float = 4.0


# ═══════════════════════════════════════════════════════════════
#  MONTE CARLO SCHEMAS
# ═══════════════════════════════════════════════════════════════

class MonteCarloSingleInput(ERSAnalyzeBase):
    """Input for single-asset Monte Carlo simulation."""
    asset_id: UUID
    simulation_years: int = 10
    iterations: int = 10000
    failure_distribution: str = "weibull"  # "weibull", "lognormal", "exponential"
    distribution_params: Dict[str, float] = {}  # {"beta": 2.5, "eta": 5000}
    repair_time_hours: float = 8.0
    repair_time_std: float = 2.0
    pm_interval_hours: Optional[float] = None
    pm_duration_hours: float = 4.0
    failure_cost: float = 50000.0
    pm_cost: float = 5000.0


class MonteCarloSystemInput(ERSAnalyzeBase):
    """Input for system-level Monte Carlo simulation."""
    unit_id: UUID
    topology: Dict[str, Any] = {}  # RBD structure from Knowledge Graph
    asset_params: List[MonteCarloSingleInput] = []
    simulation_years: int = 10
    iterations: int = 10000


class MonteCarloResult(ERSAnalyzeBase):
    """Result of Monte Carlo simulation."""
    asset_id: Optional[UUID] = None
    unit_id: Optional[UUID] = None
    iterations: int
    availability_mean: float
    availability_std: float
    availability_ci_95: Tuple[float, float]
    mtbf_mean: float
    mtbf_std: float
    mttr_mean: float
    total_failures_mean: float
    total_cost_mean: float
    total_cost_std: float
    spare_parts_demand: Dict[str, float] = {}
    percentiles: Dict[str, float] = {}  # {"p5": ..., "p50": ..., "p95": ...}
    computed_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class MonteCarloComparison(ERSAnalyzeBase):
    """Comparison of two Monte Carlo scenarios."""
    baseline: MonteCarloResult
    proposed: MonteCarloResult
    delta_availability: float
    delta_cost: float
    delta_mtbf: float
    recommendation: str


class SparePartsDemand(ERSAnalyzeBase):
    """Spare parts demand forecast from Monte Carlo."""
    asset_id: UUID
    part_name: str = "generic"
    demand_rate_per_year: float
    safety_stock: int
    reorder_point: int
    service_level_target: float = 0.95
    lead_time_days: float = 14.0


# ═══════════════════════════════════════════════════════════════
#  FMEA SCHEMAS
# ═══════════════════════════════════════════════════════════════

class FMEAItemInput(ERSAnalyzeBase):
    """Input for adding an FMEA row."""
    component: str
    function: Optional[str] = None
    failure_mode: str
    failure_effect: Optional[str] = None
    failure_cause: Optional[str] = None
    severity: int = Field(1, ge=1, le=10)
    occurrence: int = Field(1, ge=1, le=10)
    detection: int = Field(1, ge=1, le=10)
    current_controls: Optional[str] = None
    recommended_action: Optional[str] = None
    action_owner: Optional[UUID] = None
    action_due: Optional[datetime] = None


class FMEAItemRead(ERSAnalyzeBase):
    """FMEA row with computed RPN."""
    id: UUID
    component: str
    function: Optional[str] = None
    failure_mode: str
    failure_effect: Optional[str] = None
    failure_cause: Optional[str] = None
    severity: int
    occurrence: int
    detection: int
    rpn: int
    current_controls: Optional[str] = None
    recommended_action: Optional[str] = None
    source: str = "manual"
    ai_confidence: Optional[float] = None
    action_status: str = "open"


class FMEAWorksheetCreate(ERSAnalyzeBase):
    """Create a new FMEA worksheet."""
    asset_id: UUID
    title: str
    fmea_type: str = "system"
    prepared_by: Optional[UUID] = None


class FMEAWorksheetRead(ERSAnalyzeBase):
    """Complete FMEA worksheet with items."""
    id: UUID
    asset_id: UUID
    title: str
    fmea_type: str
    status: str = "draft"
    items: List[FMEAItemRead] = []
    max_rpn: int = 0
    avg_rpn: float = 0.0
    high_risk_count: int = 0  # items with RPN > 200
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


# ═══════════════════════════════════════════════════════════════
#  RCA SCHEMAS
# ═══════════════════════════════════════════════════════════════

class RCANodeInput(ERSAnalyzeBase):
    """Input for adding an RCA node."""
    parent_id: Optional[UUID] = None
    node_type: RCANodeType
    description: str
    probability: Optional[float] = None
    fishbone_category: Optional[FishboneCategory] = None
    evidence: Optional[str] = None
    is_root_cause: bool = False


class RCANodeRead(ERSAnalyzeBase):
    """RCA node with children."""
    id: UUID
    parent_id: Optional[UUID] = None
    node_type: RCANodeType
    description: str
    depth: int = 0
    probability: Optional[float] = None
    fishbone_category: Optional[FishboneCategory] = None
    evidence: Optional[str] = None
    is_root_cause: bool = False
    children: List[RCANodeRead] = []


class RCAInvestigationCreate(ERSAnalyzeBase):
    """Create a new RCA investigation."""
    asset_id: UUID
    failure_event_id: Optional[UUID] = None
    title: str
    method: RCAMethod
    problem_statement: str
    investigator_id: Optional[UUID] = None


class RCAInvestigationRead(ERSAnalyzeBase):
    """Complete RCA investigation with tree."""
    id: UUID
    asset_id: UUID
    title: str
    method: RCAMethod
    status: str = "open"
    problem_statement: str
    root_cause_summary: Optional[str] = None
    root_causes: List[RCANodeRead] = []
    nodes: List[RCANodeRead] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class RCAPatternMatch(ERSAnalyzeBase):
    """AI-detected pattern across multiple RCA investigations."""
    pattern_id: UUID
    recurring_cause: str
    frequency: int
    affected_asset_ids: List[UUID] = []
    affected_asset_classes: List[str] = []
    confidence: float
    recommended_action: str
    governance_tier: GovernanceTier = GovernanceTier.TIER_2_HUMAN_REVIEW


# ═══════════════════════════════════════════════════════════════
#  CRITICALITY SCHEMAS
# ═══════════════════════════════════════════════════════════════

class CriticalityInput(ERSAnalyzeBase):
    """Input for criticality assessment."""
    asset_id: UUID
    consequence_safety: int = Field(1, ge=1, le=5)
    consequence_environmental: int = Field(1, ge=1, le=5)
    consequence_production: int = Field(1, ge=1, le=5)
    consequence_reputation: int = Field(1, ge=1, le=5)
    consequence_financial: int = Field(1, ge=1, le=5)
    likelihood: int = Field(1, ge=1, le=5)
    assessed_by: Optional[UUID] = None
    rationale: Optional[str] = None


class CriticalityResult(ERSAnalyzeBase):
    """Criticality assessment result."""
    asset_id: UUID
    consequence_safety: int
    consequence_environmental: int
    consequence_production: int
    consequence_reputation: int
    consequence_financial: int
    likelihood: int
    max_consequence: int
    overall_risk_score: float
    criticality_rank: str  # A, B, C
    risk_matrix_cell: str  # e.g., "4-3" (consequence-likelihood)
    assessed_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


# ═══════════════════════════════════════════════════════════════
#  BAD ACTOR SCHEMAS
# ═══════════════════════════════════════════════════════════════

class BadActorAsset(ERSAnalyzeBase):
    """Single asset in bad actor ranking."""
    asset_id: UUID
    asset_name: str
    rank: int
    metric_value: float
    metric_unit: str  # "$", "hours", "count"
    pct_of_total: float
    cumulative_pct: float
    trend: str = "stable"  # "improving", "stable", "worsening"
    previous_rank: Optional[int] = None


class BadActorReportOutput(ERSAnalyzeBase):
    """Monthly bad actor Pareto analysis."""
    report_period: str
    criteria: BadActorCriteria
    top_assets: List[BadActorAsset] = []
    total_assets_analyzed: int = 0
    pareto_threshold_pct: float = 80.0
    top_5_pct_of_total: float = 0.0
    de_campaigns_drafted: int = 0
    generated_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


# ═══════════════════════════════════════════════════════════════
#  DEFECT ELIMINATION SCHEMAS
# ═══════════════════════════════════════════════════════════════

class DefectEliminationCampaign(ERSAnalyzeBase):
    """Defect elimination campaign (Uptime Elements framework)."""
    id: UUID
    asset_id: UUID
    asset_name: str
    title: str
    defect_source: DefectSource
    problem_description: str
    root_cause_ids: List[UUID] = []  # links to RCA investigations
    status: str = "identified"  # identified, investigating, eliminating, verified, closed
    assigned_to: Optional[UUID] = None
    target_completion: Optional[datetime] = None
    actual_savings: float = 0.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class DefectEliminationSummary(ERSAnalyzeBase):
    """Summary of defect elimination by source."""
    source_breakdown: Dict[str, int] = {}  # {source: count}
    active_campaigns: int = 0
    completed_campaigns: int = 0
    total_savings: float = 0.0
    top_defect_source: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
#  OEE SCHEMAS
# ═══════════════════════════════════════════════════════════════

class OEEInput(ERSAnalyzeBase):
    """Input for calculating Overall Equipment Effectiveness (OEE)."""
    asset_id: UUID
    planned_production_time_hours: float = Field(..., ge=0)
    downtime_hours: float = Field(..., ge=0)
    ideal_rate: float = Field(..., ge=0, description="Design flow rate or speed in units/hour")
    total_units_produced: float = Field(..., ge=0)
    good_units_produced: float = Field(..., ge=0)
    recorded_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class OEEResult(ERSAnalyzeBase):
    """Result of OEE calculation including sub-metrics and equivalent loss hours."""
    asset_id: UUID
    planned_production_time_hours: float
    downtime_hours: float
    uptime_hours: float
    ideal_rate: float
    total_units_produced: float
    good_units_produced: float
    rejected_units_produced: float
    availability: float = Field(..., ge=0.0, le=1.0)
    performance: float = Field(..., ge=0.0, le=1.0)
    raw_performance: float = Field(..., ge=0.0)
    quality: float = Field(..., ge=0.0, le=1.0)
    oee: float = Field(..., ge=0.0, le=1.0)
    availability_loss_hours: float
    performance_loss_hours: float
    quality_loss_equivalent_hours: float
    total_loss_hours: float
    recorded_at: datetime


class OEETrendPoint(ERSAnalyzeBase):
    """A single snapshot of OEE metrics in time."""
    recorded_at: datetime
    oee: float
    availability: float
    performance: float
    quality: float


class OEETrendAnalysis(ERSAnalyzeBase):
    """Time-series OEE trend summary."""
    asset_id: UUID
    average_oee: float
    average_availability: float
    average_performance: float
    average_quality: float
    total_planned_hours: float
    total_downtime_hours: float
    total_good_units: float
    total_units: float
    trend_status: str  # "improving", "stable", "worsening"
    history: List[OEETrendPoint] = []

