"""
ERS Predict — FastAPI Router
═══════════════════════════════
API endpoints for prediction, digital twin, distributions,
and alert management.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query

from .schemas import (
    AlertSeverity,
    AssetHealthIndex,
    BayesianPosterior,
    ConfidenceBand,
    DistributionFit,
    DistributionType,
    ExpertElicitationInput,
    ExpertElicitationResult,
    FailurePrediction,
    FeatureVector,
    GovernanceTier,
    PFIntervalResult,
    PredictionAlert,
    RULEstimate,
    ScenarioInput,
    ScenarioOutput,
    SystemTopology,
    TwinState,
)
from .features.time_series import TimeSeriesFeatureExtractor
from .features.frequency import FrequencyFeatureExtractor
from .features.operational import OperationalContextExtractor
from .features.historical import HistoricalPatternMatcher
from .models.ensemble import PredictionEnsemble
from .sparse.bayesian_updater import BayesianUpdater
from .sparse.expert_elicitation import ExpertElicitationEngine
from .distributions.fitters import DistributionFitter
from .distributions.goodness_of_fit import GoodnessOfFitTester
from .distributions.pf_interval import PFIntervalCalculator
from .alerts.manager import AlertFatigueManager
from .twin.single_asset import AssetDigitalTwin
from .twin.system_twin import SystemDigitalTwin
from .twin.scenario_engine import ScenarioEngine
from .twin.calibration import CalibrationEngine
from .twin.degradation import DegradationModelEngine

router = APIRouter(prefix="/predict", tags=["ERS Predict"])

# ─── Singletons (production: dependency injection) ───
_ensembles: Dict[str, PredictionEnsemble] = {}
_twins: Dict[UUID, AssetDigitalTwin] = {}
_system_twins: Dict[UUID, SystemDigitalTwin] = {}
_bayesian = BayesianUpdater()
_expert_engine = ExpertElicitationEngine()
_dist_fitter = DistributionFitter()
_gof_tester = GoodnessOfFitTester()
_pf_calculator = PFIntervalCalculator()
_alert_manager = AlertFatigueManager()
_scenario_engine = ScenarioEngine()
_calibration_engine = CalibrationEngine()
_degradation_engine = DegradationModelEngine()


def _get_ensemble(asset_class: str) -> PredictionEnsemble:
    """Get or create an ensemble for the given asset class."""
    if asset_class not in _ensembles:
        _ensembles[asset_class] = PredictionEnsemble(asset_class)
    return _ensembles[asset_class]


def _get_twin(asset_id: UUID, asset_class: str = "default") -> AssetDigitalTwin:
    """Get or create a digital twin for the given asset."""
    if asset_id not in _twins:
        _twins[asset_id] = AssetDigitalTwin(asset_id, asset_class)
    return _twins[asset_id]


# ══════════════════════════════════════════════════════════
#  PREDICTION ENDPOINTS
# ══════════════════════════════════════════════════════════

@router.post("/health", response_model=AssetHealthIndex)
async def predict_health_index(
    features: FeatureVector,
    asset_class: str = Query("default", description="Asset class for model selection"),
    dqs_score: float = Query(100.0, ge=0, le=100, description="Data quality score"),
) -> AssetHealthIndex:
    """
    Predict asset health index using multi-model ensemble.

    - Combines XGBoost, LSTM Autoencoder, Weibull, and Physics-Informed models
    - Model agreement < 70% triggers HITL governance review
    - DQS-adjusted confidence
    """
    ensemble = _get_ensemble(asset_class)
    return ensemble.predict_health_index(features, dqs_score)


@router.post("/failure", response_model=FailurePrediction)
async def predict_failure(
    features: FeatureVector,
    failure_mode: str = Query("general", description="Failure mode to evaluate"),
    asset_class: str = Query("default"),
    asset_criticality: str = Query("B", regex="^[ABC]$", description="Asset criticality A/B/C"),
    dqs_score: float = Query(100.0, ge=0, le=100),
) -> FailurePrediction:
    """
    Predict failure probability at 7d, 30d, 90d horizons.

    - Risk Priority Number = Criticality × Severity
    - Includes recommended maintenance action
    """
    ensemble = _get_ensemble(asset_class)
    return ensemble.predict_failure(features, failure_mode, asset_criticality, dqs_score)


@router.post("/rul", response_model=RULEstimate)
async def predict_rul(
    features: FeatureVector,
    asset_class: str = Query("default"),
    failure_mode: str = Query("general"),
    dqs_score: float = Query(100.0, ge=0, le=100),
) -> RULEstimate:
    """
    Estimate remaining useful life (RUL) with confidence bands.

    - Based on Weibull survival model
    - Returns 50%, 80%, 95% confidence bands
    """
    ensemble = _get_ensemble(asset_class)
    return ensemble.predict_rul(features, failure_mode, dqs_score)


# ══════════════════════════════════════════════════════════
#  DISTRIBUTION ENDPOINTS
# ══════════════════════════════════════════════════════════

@router.post("/distributions/fit", response_model=List[DistributionFit])
async def fit_distributions(
    failure_times: List[float],
) -> List[DistributionFit]:
    """
    Fit failure time data to Weibull 2P/3P, lognormal, exponential, normal.
    Returns all fits sorted by AIC (best first).
    """
    if len(failure_times) < 3:
        raise HTTPException(status_code=422, detail="Need at least 3 failure time observations")
    return _dist_fitter.fit_all(failure_times)


@router.post("/distributions/pf-interval", response_model=PFIntervalResult)
async def calculate_pf_interval(
    asset_id: UUID,
    failure_mode: str,
    failure_times: List[float],
    current_age_hours: float = Query(0, ge=0),
    is_safety_critical: bool = False,
) -> PFIntervalResult:
    """
    Calculate P-F interval and optimal inspection interval (RCM compliant).

    - Safety-critical: Inspection = P-F / 3
    - Standard: Inspection = P-F / 2
    """
    if len(failure_times) < 3:
        raise HTTPException(status_code=422, detail="Need at least 3 failure observations")

    best_fit = _dist_fitter.best_fit(failure_times)
    return _pf_calculator.calculate(
        asset_id=asset_id,
        failure_mode=failure_mode,
        distribution=best_fit,
        current_age_hours=current_age_hours,
        is_safety_critical=is_safety_critical,
    )


# ══════════════════════════════════════════════════════════
#  BAYESIAN / SPARSE DATA ENDPOINTS
# ══════════════════════════════════════════════════════════

@router.get("/bayesian/prior")
async def get_bayesian_prior(
    asset_class: str = Query(..., description="Asset class (pump, compressor, turbine, etc.)"),
    failure_mode: str = Query("general"),
):
    """Retrieve OREDA/IEEE 493 industry prior for sparse data estimation."""
    prior = _bayesian.get_prior(asset_class, failure_mode)
    return prior


@router.post("/bayesian/update", response_model=BayesianPosterior)
async def bayesian_update(
    asset_class: str,
    failure_mode: str = "general",
    observed_failures: int = 0,
    observed_hours: float = 0.0,
) -> BayesianPosterior:
    """
    Update prior with observed failures to get posterior distribution.
    Transitions from prior-dominated to data-dominated at 15+ failures.
    """
    prior = _bayesian.get_prior(asset_class, failure_mode)
    return _bayesian.update(prior, observed_failures, observed_hours)


@router.post("/expert-elicitation", response_model=ExpertElicitationResult)
async def submit_expert_elicitation(
    elicitation: ExpertElicitationInput,
) -> ExpertElicitationResult:
    """Convert expert P10/P50/P90 estimates to statistical priors."""
    return _expert_engine.process_elicitation(elicitation)


# ══════════════════════════════════════════════════════════
#  ALERT MANAGEMENT ENDPOINTS
# ══════════════════════════════════════════════════════════

@router.post("/alerts/process", response_model=Optional[PredictionAlert])
async def process_alert(
    asset_id: UUID,
    alert_type: str,
    severity: AlertSeverity,
    title: str,
    description: str,
    confidence: float,
    value: float = 0.0,
    dqs_impact: float = 0.0,
) -> Optional[PredictionAlert]:
    """
    Process a candidate alert through fatigue management pipeline.

    - Applies correlation grouping, suppression timers, threshold checks
    - Returns None if alert is suppressed
    """
    return _alert_manager.process_alert(
        asset_id=asset_id,
        alert_type=alert_type,
        severity=severity,
        title=title,
        description=description,
        confidence=confidence,
        value=value,
        dqs_impact=dqs_impact,
    )


@router.get("/alerts/{asset_id}", response_model=List[PredictionAlert])
async def get_active_alerts(asset_id: UUID) -> List[PredictionAlert]:
    """Get all active (non-suppressed) alerts for an asset."""
    return _alert_manager.get_active_alerts(asset_id)


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: UUID, user_id: UUID):
    """Acknowledge an alert."""
    if not _alert_manager.acknowledge_alert(alert_id, user_id):
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "acknowledged"}


@router.post("/alerts/outcome")
async def record_alert_outcome(
    alert_type: str,
    was_true_positive: bool,
):
    """Record alert outcome for auto-threshold adjustment."""
    _alert_manager.record_outcome(alert_type, was_true_positive)
    return {"status": "recorded"}


# ══════════════════════════════════════════════════════════
#  DIGITAL TWIN ENDPOINTS
# ══════════════════════════════════════════════════════════

@router.post("/twin/update", response_model=TwinState)
async def update_twin(
    features: FeatureVector,
    asset_class: str = Query("default"),
) -> TwinState:
    """
    Update digital twin with new sensor data.

    Combines real-time readings with degradation models, maintenance
    history, and operating context to continuously simulate reliability.
    """
    twin = _get_twin(features.asset_id, asset_class)
    twin.update_from_features(features)
    return twin.get_state()


@router.get("/twin/{asset_id}", response_model=TwinState)
async def get_twin_state(
    asset_id: UUID,
    asset_class: str = Query("default"),
) -> TwinState:
    """Get current digital twin state for an asset."""
    twin = _get_twin(asset_id, asset_class)
    return twin.get_state()


@router.post("/twin/{asset_id}/calibrate")
async def calibrate_twin(
    asset_id: UUID,
    actual_health: float,
    asset_class: str = Query("default"),
):
    """
    Calibrate twin with actual observed health (from inspection/CM).
    Used to track and correct prediction drift.
    """
    twin = _get_twin(asset_id, asset_class)
    twin.update_from_inspection(actual_health)

    report = _calibration_engine.check_calibration(
        twin_id=twin.twin_id,
        asset_id=asset_id,
        predicted_health=twin.health_index,
        actual_health=actual_health,
    )
    return report


@router.post("/twin/scenario", response_model=ScenarioOutput)
async def run_scenario(
    asset_id: UUID,
    scenario: ScenarioInput,
    asset_class: str = Query("default"),
) -> ScenarioOutput:
    """
    Run a what-if scenario against the asset's digital twin.

    Compares current baseline vs proposed change using Monte Carlo
    simulation, projecting availability, cost, risk, and RUL impact.
    """
    twin = _get_twin(asset_id, asset_class)
    return _scenario_engine.run_scenario(twin, scenario)


@router.post("/twin/system", response_model=SystemTopology)
async def compute_system_reliability(
    unit_id: UUID,
    topology_config: Dict[str, Any],
) -> SystemTopology:
    """
    Compute system-level reliability from individual asset twins
    using RBD topology (series/parallel/k-of-n).
    """
    system_twin = SystemDigitalTwin(unit_id)

    # Register all known twins
    for twin in _twins.values():
        system_twin.register_twin(twin)

    system_twin.build_topology(topology_config)
    return system_twin.compute_system_reliability()


@router.get("/twin/system/{unit_id}/bottlenecks")
async def identify_bottlenecks(
    unit_id: UUID,
    top_n: int = Query(5, ge=1, le=20),
):
    """
    Identify bottleneck assets — those whose failure has
    disproportionate impact on system reliability.
    """
    system_twin = _system_twins.get(unit_id)
    if not system_twin:
        raise HTTPException(status_code=404, detail="System twin not found — compute system reliability first")
    return system_twin.identify_bottlenecks(top_n)
