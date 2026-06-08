"""
ERS Plan — Schemas
══════════════════
Pydantic models for Strategic Asset Management Planning (ISO 55002).
SAMP, Line-of-Sight, Decision Framework, Scenario Modelling,
Risk, Opportunity, and Capital Planning.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any, Tuple
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════
#  ENUMS
# ══════════════════════════════════════════════════════════════

class SAMPStatus(str, Enum):
    DRAFT = "draft"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    ACTIVE = "active"
    SUPERSEDED = "superseded"

class KPIDirection(str, Enum):
    HIGHER_IS_BETTER = "higher_is_better"
    LOWER_IS_BETTER = "lower_is_better"
    TARGET_BAND = "target_band"

class LOSLevel(str, Enum):
    BOARD = "board"
    DEPARTMENT = "department"
    ASSET_CLASS = "asset_class"
    ASSET = "asset"

class DecisionStatus(str, Enum):
    PENDING = "pending"
    EVALUATED = "evaluated"
    APPROVED = "approved"
    REJECTED = "rejected"
    IMPLEMENTED = "implemented"

class RiskLikelihood(int, Enum):
    RARE = 1
    UNLIKELY = 2
    POSSIBLE = 3
    LIKELY = 4
    ALMOST_CERTAIN = 5

class RiskConsequence(int, Enum):
    INSIGNIFICANT = 1
    MINOR = 2
    MODERATE = 3
    MAJOR = 4
    CATASTROPHIC = 5

class RiskCategory(str, Enum):
    SAFETY = "safety"
    ENVIRONMENTAL = "environmental"
    FINANCIAL = "financial"
    OPERATIONAL = "operational"
    REPUTATIONAL = "reputational"
    REGULATORY = "regulatory"

class MitigationStatus(str, Enum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    OVERDUE = "overdue"

class OpportunityComplexity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

class CapitalCategory(str, Enum):
    RENEWAL = "renewal"
    UPGRADE = "upgrade"
    EXPANSION = "expansion"
    COMPLIANCE = "compliance"
    DECOMMISSION = "decommission"


# ══════════════════════════════════════════════════════════════
#  SAMP & LINE-OF-SIGHT
# ══════════════════════════════════════════════════════════════

class KPIDefinition(BaseModel):
    """KPI with formula validation — supports safe expression parsing."""
    kpi_id: UUID = Field(default_factory=uuid4)
    name: str
    formula: str  # e.g., "mtbf / (mtbf + mttr) * 100"
    unit: str = "%"
    direction: KPIDirection = KPIDirection.HIGHER_IS_BETTER
    target_value: float
    warning_threshold: Optional[float] = None
    critical_threshold: Optional[float] = None
    variables: List[str] = Field(default_factory=list)  # Expected variable names

class StrategicObjective(BaseModel):
    objective_id: UUID = Field(default_factory=uuid4)
    title: str
    description: str
    owner_department: str
    kpis: List[KPIDefinition] = []
    weight: float = Field(ge=0.0, le=1.0, default=1.0)

class SAMPTemplate(BaseModel):
    samp_id: UUID = Field(default_factory=uuid4)
    title: str
    version: int = 1
    status: SAMPStatus = SAMPStatus.DRAFT
    planning_horizon_years: int = 5
    objectives: List[StrategicObjective] = []
    approved_by: Optional[UUID] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class LOSNode(BaseModel):
    """A node in the Line-of-Sight tree (Board → Department → Asset)."""
    node_id: UUID = Field(default_factory=uuid4)
    level: LOSLevel
    name: str
    parent_id: Optional[UUID] = None
    kpis: List[KPIDefinition] = []
    actual_values: Dict[str, float] = Field(default_factory=dict)

class LOSTree(BaseModel):
    """Full Line-of-Sight cascade from Board objectives to Asset KPIs."""
    samp_id: UUID
    nodes: List[LOSNode]


# ══════════════════════════════════════════════════════════════
#  DECISION FRAMEWORK (ISO 55002 Clause 4.5)
# ══════════════════════════════════════════════════════════════

class DecisionCriterion(BaseModel):
    """Configurable MCDA criterion with weight."""
    criterion_id: UUID = Field(default_factory=uuid4)
    name: str  # e.g., "Safety Impact", "NPV", "Environmental Risk"
    weight: float = Field(ge=0.0, le=1.0)
    scale_min: float = 0.0
    scale_max: float = 10.0

class DecisionOption(BaseModel):
    """An option being evaluated (e.g., 'Replace pump', 'Repair pump')."""
    option_id: UUID = Field(default_factory=uuid4)
    name: str
    description: str
    scores: Dict[UUID, float] = Field(default_factory=dict)  # criterion_id -> raw score

class MCDAResult(BaseModel):
    """Multi-Criteria Decision Analysis result."""
    option_id: UUID
    option_name: str
    weighted_score: float
    normalized_scores: Dict[str, float] = Field(default_factory=dict)  # criterion_name -> normalized score
    rank: int

class DecisionRecord(BaseModel):
    """Tier 4 immutable audit record for a strategic decision."""
    decision_id: UUID = Field(default_factory=uuid4)
    title: str
    context: str
    criteria: List[DecisionCriterion]
    options: List[DecisionOption]
    results: List[MCDAResult] = []
    selected_option_id: Optional[UUID] = None
    rationale: Optional[str] = None
    status: DecisionStatus = DecisionStatus.PENDING
    evaluated_by: Optional[UUID] = None
    approved_by: Optional[UUID] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    audit_trail: List[Dict[str, Any]] = Field(default_factory=list)


# ══════════════════════════════════════════════════════════════
#  SCENARIO MODELLING
# ══════════════════════════════════════════════════════════════

class ScenarioVariable(BaseModel):
    name: str
    distribution: str = "normal"  # "normal", "triangular", "uniform"
    params: Dict[str, float] = Field(default_factory=dict)  # mean, std, min, max, mode

class ScenarioInput(BaseModel):
    scenario_id: UUID = Field(default_factory=uuid4)
    name: str
    description: str
    variables: List[ScenarioVariable]
    iterations: int = Field(default=10000, ge=100, le=100000)

class MonteCarloResult(BaseModel):
    scenario_id: UUID
    scenario_name: str
    mean_npv: float
    p10_npv: float  # 10th percentile (pessimistic)
    p50_npv: float  # median
    p90_npv: float  # 90th percentile (optimistic)
    std_dev: float
    probability_of_loss: float  # % of iterations with negative NPV
    risk_exposure: float  # Expected loss magnitude
    availability_mean: Optional[float] = None

class ScenarioComparison(BaseModel):
    scenarios: List[MonteCarloResult]
    recommended_scenario_id: UUID
    recommendation_rationale: str


# ══════════════════════════════════════════════════════════════
#  RISK MODULE
# ══════════════════════════════════════════════════════════════

class MitigationAction(BaseModel):
    action_id: UUID = Field(default_factory=uuid4)
    description: str
    owner_id: Optional[UUID] = None
    due_date: Optional[datetime] = None
    status: MitigationStatus = MitigationStatus.PLANNED
    effectiveness_percent: float = Field(ge=0.0, le=100.0, default=0.0)

class RiskEntry(BaseModel):
    risk_id: UUID = Field(default_factory=uuid4)
    title: str
    description: str
    category: RiskCategory
    asset_id: Optional[UUID] = None
    likelihood: RiskLikelihood
    consequence: RiskConsequence
    inherent_risk_score: float = 0.0  # Computed: likelihood × consequence
    mitigations: List[MitigationAction] = []
    residual_likelihood: Optional[RiskLikelihood] = None
    residual_consequence: Optional[RiskConsequence] = None
    residual_risk_score: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)

class RiskHeatmapCell(BaseModel):
    likelihood: int
    consequence: int
    risk_ids: List[UUID]
    count: int
    color: str  # "green", "yellow", "orange", "red", "dark_red"

class RiskHeatmap(BaseModel):
    cells: List[RiskHeatmapCell]
    total_risks: int

class BowTieThreat(BaseModel):
    threat_id: UUID = Field(default_factory=uuid4)
    description: str
    preventive_controls: List[str]

class BowTieConsequence(BaseModel):
    consequence_id: UUID = Field(default_factory=uuid4)
    description: str
    mitigating_controls: List[str]

class BowTieModel(BaseModel):
    risk_id: UUID
    top_event: str  # The central event (e.g., "Loss of containment")
    threats: List[BowTieThreat]
    consequences: List[BowTieConsequence]


# ══════════════════════════════════════════════════════════════
#  OPPORTUNITY MODULE
# ══════════════════════════════════════════════════════════════

class OpportunityEntry(BaseModel):
    opportunity_id: UUID = Field(default_factory=uuid4)
    title: str
    description: str
    source: str = "ai_identified"  # "ai_identified", "manual", "audit_finding"
    linked_objective_id: Optional[UUID] = None
    estimated_annual_savings: float = 0.0
    implementation_cost: float = 0.0
    complexity: OpportunityComplexity = OpportunityComplexity.MEDIUM
    roi_percent: float = 0.0  # Computed
    strategic_alignment_score: float = Field(ge=0.0, le=10.0, default=0.0)
    ranked_score: float = 0.0  # Composite score for ranking

class RankedOpportunities(BaseModel):
    opportunities: List[OpportunityEntry]
    total_potential_savings: float


# ══════════════════════════════════════════════════════════════
#  CAPITAL PLANNING
# ══════════════════════════════════════════════════════════════

class RenewalCandidate(BaseModel):
    asset_id: UUID
    asset_name: str
    current_age_years: float
    expected_useful_life_years: float
    condition_score: float = Field(ge=0.0, le=100.0)
    annual_maintenance_cost: float
    replacement_cost: float
    criticality: str = "B"

class TCOResult(BaseModel):
    asset_id: UUID
    repair_tco: float
    replace_tco: float
    crossover_year: Optional[int] = None  # Year where replace becomes cheaper
    recommendation: str
    npv_savings: float

class CAPEXLineItem(BaseModel):
    asset_id: UUID
    asset_name: str
    category: CapitalCategory
    year: int
    amount: float
    justification: str

class CAPEXForecast(BaseModel):
    horizon_years: int
    line_items: List[CAPEXLineItem]
    annual_totals: Dict[int, float]
    total_capex: float
