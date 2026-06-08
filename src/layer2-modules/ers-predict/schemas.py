"""
ERS Predict — Module Schemas
═══════════════════════════════
Pydantic schemas for feature engineering, prediction outputs,
digital twin state, distributions, and calibration.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ERSPredictBase(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# ═══════════════════════════════════════════════════════════════
#  ENUMS
# ═══════════════════════════════════════════════════════════════

class PredictionType(str, Enum):
    HEALTH_INDEX = "health_index"
    FAILURE_PROBABILITY = "failure_probability"
    RUL = "rul"
    ANOMALY_SCORE = "anomaly_score"


class GovernanceTier(int, Enum):
    """Governance tiers for AI predictions (ISO 55000 aligned)."""
    TIER_1_AUTO = 1        # Fully automated, low risk
    TIER_2_HUMAN_REVIEW = 2  # Human review required (model disagreement)
    TIER_3_STANDARD = 3    # Standard confidence
    TIER_4_SUPERVISED = 4  # Supervised by reliability engineer
    TIER_5_LOCKED = 5      # Critical/safety — requires engineering sign-off


class DegradationMechanism(str, Enum):
    FATIGUE_ACCUMULATION = "fatigue_accumulation"
    CORROSION_RATE = "corrosion_rate"
    BEARING_WEAR = "bearing_wear"
    INSULATION_DEGRADATION = "insulation_degradation"
    EROSION = "erosion"


class DistributionType(str, Enum):
    WEIBULL_2P = "weibull_2p"
    WEIBULL_3P = "weibull_3p"
    LOGNORMAL = "lognormal"
    EXPONENTIAL = "exponential"
    NORMAL = "normal"
    MIXED_WEIBULL = "mixed_weibull"


class AlertSeverity(str, Enum):
    EMERGENCY = "emergency"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


# ═══════════════════════════════════════════════════════════════
#  FEATURE SCHEMAS
# ═══════════════════════════════════════════════════════════════

class WindowStats(ERSPredictBase):
    """Statistics computed over a single time window."""
    window_name: str  # "1h", "8h", "24h", "7d", "30d"
    mean: float = 0.0
    std: float = 0.0
    min_val: float = 0.0
    max_val: float = 0.0
    kurtosis: float = 0.0
    rms: float = 0.0
    sample_count: int = 0


class TimeSeriesFeatures(ERSPredictBase):
    """Rolling statistics across multiple time windows."""
    tag: str
    windows: List[WindowStats] = []
    trend_slope: float = 0.0  # linear trend
    change_rate: float = 0.0  # rate of change


class FrequencyFeatures(ERSPredictBase):
    """FFT-derived features for vibration analysis."""
    tag: str
    dominant_frequency_hz: float = 0.0
    peak_amplitude: float = 0.0
    spectral_energy: float = 0.0
    harmonic_ratios: List[float] = []
    energy_bands: Dict[str, float] = {}  # {"low": 0.1, "mid": 0.5, "high": 0.4}
    crest_factor: float = 0.0


class OperationalContext(ERSPredictBase):
    """Operating context features relative to design conditions."""
    hours_since_last_pm: float = 0.0
    load_factor: float = 1.0  # actual / rated capacity
    ambient_temp_delta: float = 0.0  # actual - design temp
    running_hours: float = 0.0
    start_stop_cycles: int = 0
    operating_regime: str = "normal"  # "normal", "overload", "standby"


class HistoricalPattern(ERSPredictBase):
    """Similarity match to known pre-failure signatures."""
    matched_failure_mode: str
    similarity_score: float = 0.0  # 0-1
    days_before_failure: float = 0.0  # how many days before failure the pattern occurred
    source_asset_id: Optional[UUID] = None
    source_failure_event_id: Optional[UUID] = None


class FeatureVector(ERSPredictBase):
    """Complete feature vector combining all extractors."""
    asset_id: UUID
    computed_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))
    time_series: List[TimeSeriesFeatures] = []
    frequency: List[FrequencyFeatures] = []
    operational: Optional[OperationalContext] = None
    historical_patterns: List[HistoricalPattern] = []
    data_quality_score: float = 100.0  # DQS composite


# ═══════════════════════════════════════════════════════════════
#  PREDICTION OUTPUT SCHEMAS
# ═══════════════════════════════════════════════════════════════

class AssetHealthIndex(ERSPredictBase):
    """Asset Health Index (0-100) with governance metadata."""
    asset_id: UUID
    health_index: float = Field(..., ge=0, le=100)
    confidence: float = Field(..., ge=0, le=1)
    dqs_impact: float = Field(0.0, description="DQS-driven confidence penalty")
    governance_tier: GovernanceTier = GovernanceTier.TIER_3_STANDARD
    contributing_factors: Dict[str, float] = {}  # feature importances
    trend: str = "stable"  # "improving", "stable", "degrading", "critical"
    model_agreement: float = 1.0  # 0-1 ensemble agreement
    computed_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class FailurePrediction(ERSPredictBase):
    """Failure probability prediction with temporal horizon."""
    asset_id: UUID
    failure_mode: str
    probability_7d: float = Field(0.0, ge=0, le=1)
    probability_30d: float = Field(0.0, ge=0, le=1)
    probability_90d: float = Field(0.0, ge=0, le=1)
    confidence: float = Field(..., ge=0, le=1)
    dqs_impact: float = 0.0
    governance_tier: GovernanceTier = GovernanceTier.TIER_3_STANDARD
    risk_priority_number: float = 0.0  # Criticality × Severity
    recommended_action: Optional[str] = None
    computed_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class ConfidenceBand(ERSPredictBase):
    """Confidence interval for RUL projection."""
    percentile: int  # 50, 80, 95
    lower_days: float
    upper_days: float
    median_days: float


class RULEstimate(ERSPredictBase):
    """Remaining Useful Life with confidence bands."""
    asset_id: UUID
    rul_days: float
    confidence: float = Field(..., ge=0, le=1)
    confidence_bands: List[ConfidenceBand] = []
    distribution_type: DistributionType = DistributionType.WEIBULL_2P
    distribution_params: Dict[str, float] = {}
    dqs_impact: float = 0.0
    governance_tier: GovernanceTier = GovernanceTier.TIER_3_STANDARD
    pf_interval_days: Optional[float] = None
    computed_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class PredictionAlert(ERSPredictBase):
    """Alert generated from prediction with fatigue management metadata."""
    alert_id: UUID
    asset_id: UUID
    alert_type: str  # anomaly, threshold_breach, trend_deviation, etc.
    severity: AlertSeverity
    title: str
    description: str
    confidence: float = Field(..., ge=0, le=1)
    dqs_impact: float = 0.0
    governance_tier: GovernanceTier = GovernanceTier.TIER_3_STANDARD
    suppressed: bool = False
    correlation_group_id: Optional[UUID] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


# ═══════════════════════════════════════════════════════════════
#  DIGITAL TWIN SCHEMAS
# ═══════════════════════════════════════════════════════════════

class DegradationModelConfig(ERSPredictBase):
    """Configuration for a specific degradation mechanism model."""
    mechanism: DegradationMechanism
    model_type: str  # "miners_rule", "linear", "power_law", "arrhenius", "l10"
    parameters: Dict[str, float] = {}
    oem_baseline: Optional[Dict[str, float]] = None
    current_damage_pct: float = 0.0  # 0-100
    projected_failure_date: Optional[datetime] = None


class TwinHealthProjection(ERSPredictBase):
    """Projected health trajectory point."""
    days_ahead: int
    health_index: float
    confidence_lower: float
    confidence_upper: float


class TwinState(ERSPredictBase):
    """Complete digital twin state for a single asset."""
    asset_id: UUID
    twin_id: UUID
    health_index: float = Field(..., ge=0, le=100)
    degradation_models: List[DegradationModelConfig] = []
    health_projection: List[TwinHealthProjection] = []
    last_calibrated_at: Optional[datetime] = None
    calibration_quality: float = Field(0.0, ge=0, le=100)
    calibration_drift: float = 0.0
    failure_distributions: Dict[str, Dict[str, float]] = {}  # mode -> params
    operating_context: Optional[OperationalContext] = None
    sensor_summary: Dict[str, float] = {}  # tag -> latest value
    updated_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class ScenarioInput(ERSPredictBase):
    """What-if scenario configuration."""
    scenario_name: str
    change_type: str = ""  # "pm_interval", "operating_param", "strategy", "part_substitution"
    parameters: Dict[str, Any] = {}
    # Examples:
    #   pm_interval: {"current_days": 90, "proposed_days": 60}
    #   operating_param: {"parameter": "speed_rpm", "current": 3600, "proposed": 3000}
    #   strategy: {"current": "run_to_failure", "proposed": "condition_based"}
    monte_carlo_runs: int = 1000


class ScenarioMetrics(ERSPredictBase):
    """Projected metrics for a scenario."""
    availability_pct: float = 0.0
    failure_probability_1y: float = 0.0
    annual_cost: float = 0.0
    risk_score: float = 0.0
    sustainability_impact: float = 0.0  # CO2e reduction/increase
    rul_days: float = 0.0
    confidence_interval_50: Tuple[float, float] = (0.0, 0.0)
    confidence_interval_80: Tuple[float, float] = (0.0, 0.0)
    confidence_interval_95: Tuple[float, float] = (0.0, 0.0)


class ScenarioOutput(ERSPredictBase):
    """What-if scenario comparison result."""
    scenario_name: str
    baseline: ScenarioMetrics
    projected: ScenarioMetrics
    delta: Dict[str, float] = {}
    recommendation: str = ""
    governance_tier: GovernanceTier = GovernanceTier.TIER_3_STANDARD


class SystemTopologyNode(ERSPredictBase):
    """Node in the system-level reliability block diagram."""
    asset_id: UUID
    asset_name: str
    reliability: float = 1.0
    health_index: float = 100.0
    is_bottleneck: bool = False
    children: List[SystemTopologyNode] = []
    connection_type: str = "series"  # "series", "parallel", "k_of_n"
    k_required: Optional[int] = None
    n_total: Optional[int] = None


class SystemTopology(ERSPredictBase):
    """Complete system-level twin topology."""
    unit_id: UUID
    unit_name: str
    system_reliability: float
    topology: SystemTopologyNode
    computed_at: datetime = Field(default_factory=lambda: datetime.now(tz=timezone.utc))


class BottleneckAsset(ERSPredictBase):
    """Asset identified as a bottleneck in the system twin."""
    asset_id: UUID
    asset_name: str
    health_index: float
    system_impact_pct: float  # how much system reliability drops if this fails
    failure_probability_30d: float
    rank: int
    recommended_action: str = ""


class CalibrationReport(ERSPredictBase):
    """Calibration status for a digital twin."""
    twin_id: UUID
    asset_id: UUID
    calibration_quality: float = Field(..., ge=0, le=100)
    drift_score: float = 0.0  # observed - predicted divergence
    last_calibrated_at: Optional[datetime] = None
    data_points_since_calibration: int = 0
    needs_recalibration: bool = False
    recalibration_reason: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
#  DISTRIBUTION SCHEMAS
# ═══════════════════════════════════════════════════════════════

class DistributionFit(ERSPredictBase):
    """Fitted distribution parameters."""
    distribution_type: DistributionType
    parameters: Dict[str, float] = {}
    # Weibull 2P: {"beta": 2.5, "eta": 5000}
    # Weibull 3P: {"beta": 2.5, "eta": 5000, "gamma": 100}
    # Lognormal: {"mu": 7.8, "sigma": 0.5}
    # Exponential: {"lambda": 0.001}
    # Normal: {"mu": 5000, "sigma": 500}
    log_likelihood: float = 0.0
    aic: float = 0.0
    bic: float = 0.0


class GoodnessOfFitResult(ERSPredictBase):
    """Goodness-of-fit test results."""
    distribution_type: DistributionType
    anderson_darling_statistic: Optional[float] = None
    anderson_darling_p_value: Optional[float] = None
    ks_statistic: Optional[float] = None
    ks_p_value: Optional[float] = None
    is_good_fit: bool = False
    rank: int = 0  # 1 = best fit


class ProbabilityPlotPoint(ERSPredictBase):
    """Data point for a probability plot."""
    observed: float
    theoretical: float
    rank: int


class PFIntervalResult(ERSPredictBase):
    """P-F interval calculation result."""
    asset_id: UUID
    failure_mode: str
    pf_interval_days: float
    optimal_inspection_interval: float  # pf_interval / 2 or / 3
    current_position_pct: float = 0.0  # where on P-F curve (0=healthy, 100=failure)
    rul_days: float = 0.0
    confidence_bands: List[ConfidenceBand] = []
    distribution_fit: Optional[DistributionFit] = None


# ═══════════════════════════════════════════════════════════════
#  SPARSE DATA SCHEMAS
# ═══════════════════════════════════════════════════════════════

class BayesianPrior(ERSPredictBase):
    """Industry prior distribution for Bayesian updating."""
    source: str  # "OREDA", "IEEE_493", "expert"
    distribution_type: DistributionType
    parameters: Dict[str, float] = {}
    failure_mode: str
    asset_class: str
    sample_size: int = 0
    confidence: float = 0.5


class BayesianPosterior(ERSPredictBase):
    """Updated posterior after incorporating observed data."""
    prior: BayesianPrior
    observed_failures: int = 0
    observed_hours: float = 0.0
    posterior_parameters: Dict[str, float] = {}
    effective_sample_size: float = 0.0
    convergence_to_data: float = 0.0  # 0=prior dominated, 1=data dominated


class ExpertElicitationInput(ERSPredictBase):
    """Expert judgement for Bayesian prior elicitation."""
    expert_id: UUID
    asset_class: str
    failure_mode: str
    p10_hours: float  # 10th percentile estimate
    p50_hours: float  # median estimate
    p90_hours: float  # 90th percentile estimate
    confidence_in_estimate: float = Field(..., ge=0, le=1)
    rationale: str = ""
    years_experience: int = 0


class ExpertElicitationResult(ERSPredictBase):
    """Result of converting expert estimates to distribution priors."""
    expert_id: UUID
    derived_distribution: DistributionFit
    prior: BayesianPrior
    consistency_score: float = 0.0  # how self-consistent the estimates are
