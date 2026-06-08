"""
ERS Analyze — FastAPI Router
═════════════════════════════
~25 endpoints covering RCM, Monte Carlo, FMEA, RCA,
Criticality, Bad Actor, and Defect Elimination.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query

from ers_analyze.schemas import (
    AIFailureModeSuggestion,
    BadActorCriteria,
    BadActorReportOutput,
    CriticalityInput,
    CriticalityResult,
    DefectEliminationCampaign,
    DefectEliminationSummary,
    DefectSource,
    FMEAItemInput,
    FMEAItemRead,
    FMEAWorksheetCreate,
    FMEAWorksheetRead,
    FishboneCategory,
    MonteCarloComparison,
    MonteCarloResult,
    MonteCarloSingleInput,
    MonteCarloSystemInput,
    RCAInvestigationCreate,
    RCAInvestigationRead,
    RCAMethod,
    RCANodeInput,
    RCANodeRead,
    RCAPatternMatch,
    RCMAnalysisCreate,
    RCMAnalysisRead,
    RCMDecisionTreeInput,
    RCMFunctionInput,
    RCMTaskOutput,
    SparePartsDemand,
    OEEInput,
    OEEResult,
    OEETrendPoint,
    OEETrendAnalysis,
)

# Lazy-initialize engines (singletons)
_rcm_engine = None
_rcm_ai = None
_mc_engine = None
_spare_parts = None
_fmea_engine = None
_rca_engine = None
_rca_patterns = None
_criticality = None
_bad_actor = None
_de_engine = None
_oee_calculator = None


def _get_rcm_engine():
    global _rcm_engine
    if _rcm_engine is None:
        from ers_analyze.rcm.engine import RCMDecisionTreeEngine
        _rcm_engine = RCMDecisionTreeEngine()
    return _rcm_engine


def _get_rcm_ai():
    global _rcm_ai
    if _rcm_ai is None:
        from ers_analyze.rcm.ai_suggest import RCMAIFailureModeSuggestor
        _rcm_ai = RCMAIFailureModeSuggestor()
    return _rcm_ai


def _get_mc_engine():
    global _mc_engine
    if _mc_engine is None:
        from ers_analyze.monte_carlo.engine import MonteCarloEngine
        _mc_engine = MonteCarloEngine()
    return _mc_engine


def _get_spare_parts():
    global _spare_parts
    if _spare_parts is None:
        from ers_analyze.monte_carlo.spare_parts import SparePartsForecast
        _spare_parts = SparePartsForecast()
    return _spare_parts


def _get_fmea_engine():
    global _fmea_engine
    if _fmea_engine is None:
        from ers_analyze.fmea.worksheet import FMEAWorksheetEngine
        _fmea_engine = FMEAWorksheetEngine()
    return _fmea_engine


def _get_rca_engine():
    global _rca_engine
    if _rca_engine is None:
        from ers_analyze.rca.engine import RCAEngine
        _rca_engine = RCAEngine()
    return _rca_engine


def _get_rca_patterns():
    global _rca_patterns
    if _rca_patterns is None:
        from ers_analyze.rca.ai_patterns import RCAPatternDetector
        _rca_patterns = RCAPatternDetector()
    return _rca_patterns


def _get_criticality():
    global _criticality
    if _criticality is None:
        from ers_analyze.criticality.matrix import CriticalityMatrix
        _criticality = CriticalityMatrix()
    return _criticality


def _get_bad_actor():
    global _bad_actor
    if _bad_actor is None:
        from ers_analyze.bad_actor.analyzer import BadActorAnalyzer
        _bad_actor = BadActorAnalyzer()
    return _bad_actor


def _get_de_engine():
    global _de_engine
    if _de_engine is None:
        from ers_analyze.defect_elimination.engine import DefectEliminationEngine
        _de_engine = DefectEliminationEngine()
    return _de_engine


def _get_oee_calculator():
    global _oee_calculator
    if _oee_calculator is None:
        from ers_analyze.oee.calculator import OEECalculator
        _oee_calculator = OEECalculator()
    return _oee_calculator


router = APIRouter(prefix="/analyze", tags=["ERS Analyze"])

# In-memory stores (would be replaced by database in production)
_rcm_analyses: Dict[UUID, RCMAnalysisRead] = {}


# ═══════════════════════════════════════════════════════════════
#  RCM ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/rcm", response_model=RCMAnalysisRead)
async def create_rcm_analysis(inp: RCMAnalysisCreate):
    """Create a new RCM analysis study."""
    analysis = RCMAnalysisRead(
        id=uuid4(),
        asset_id=inp.asset_id,
        title=inp.title,
        description=inp.description,
        operating_context=inp.operating_context,
    )
    _rcm_analyses[analysis.id] = analysis
    return analysis


@router.get("/rcm/{analysis_id}", response_model=RCMAnalysisRead)
async def get_rcm_analysis(analysis_id: UUID):
    """Get a complete RCM analysis with full hierarchy."""
    analysis = _rcm_analyses.get(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="RCM analysis not found")
    return analysis


@router.post("/rcm/{analysis_id}/functions")
async def add_rcm_function(analysis_id: UUID, inp: RCMFunctionInput):
    """Add an equipment function to an RCM analysis."""
    analysis = _rcm_analyses.get(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="RCM analysis not found")

    from ers_analyze.schemas import RCMFunctionRead
    func = RCMFunctionRead(
        id=uuid4(),
        function_number=inp.function_number,
        description=inp.description,
        performance_standard=inp.performance_standard,
    )
    analysis.functions.append(func)
    return func


@router.post(
    "/rcm/{analysis_id}/suggest-failure-modes",
    response_model=List[AIFailureModeSuggestion],
)
async def suggest_failure_modes(
    analysis_id: UUID,
    asset_class: str = Query(..., description="Asset class for ISO 14224 lookup"),
):
    """
    AI-suggested failure modes from WO history (Tier 2 governance).
    Engineer review required before approval.
    """
    analysis = _rcm_analyses.get(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="RCM analysis not found")

    ai = _get_rcm_ai()
    # In production: fetch WO history from database
    suggestions = ai.suggest_failure_modes(
        asset_class=asset_class,
        wo_history=[],  # placeholder — would be populated from DB
    )
    return suggestions


@router.post(
    "/rcm/{analysis_id}/run-decision-tree",
    response_model=RCMTaskOutput,
)
async def run_decision_tree(analysis_id: UUID, inp: RCMDecisionTreeInput):
    """Run the SAE JA1011 deterministic decision tree for task selection."""
    engine = _get_rcm_engine()
    return engine.run_decision_tree(inp)


@router.post("/rcm/{analysis_id}/approve", response_model=RCMAnalysisRead)
async def approve_rcm_analysis(analysis_id: UUID, approved_by: UUID = Query(...)):
    """Approve an RCM analysis (Tier 3 governance)."""
    analysis = _rcm_analyses.get(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="RCM analysis not found")
    analysis.status = "approved"
    analysis.governance_tier = 3
    return analysis


# ═══════════════════════════════════════════════════════════════
#  MONTE CARLO ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/monte-carlo/single", response_model=MonteCarloResult)
async def monte_carlo_single(inp: MonteCarloSingleInput):
    """Run single-asset Monte Carlo simulation (10K-1M iterations)."""
    engine = _get_mc_engine()
    return engine.simulate_single(inp)


@router.post("/monte-carlo/system", response_model=MonteCarloResult)
async def monte_carlo_system(inp: MonteCarloSystemInput):
    """Run system-level Monte Carlo with series/parallel/k-of-n topology."""
    engine = _get_mc_engine()
    return engine.simulate_system(inp)


@router.post("/monte-carlo/compare", response_model=MonteCarloComparison)
async def monte_carlo_compare(
    baseline: MonteCarloSingleInput,
    proposed: MonteCarloSingleInput,
):
    """Compare two Monte Carlo scenarios (baseline vs proposed)."""
    engine = _get_mc_engine()
    return engine.compare_scenarios(baseline, proposed)


@router.post("/monte-carlo/spare-parts", response_model=SparePartsDemand)
async def forecast_spare_parts(
    asset_id: UUID = Query(...),
    failure_rate_per_year: float = Query(...),
    lead_time_days: float = Query(14.0),
    service_level: float = Query(0.95),
):
    """Forecast spare parts demand for an asset."""
    engine = _get_spare_parts()
    return engine.forecast_demand(
        asset_id=asset_id,
        failure_rate_per_year=failure_rate_per_year,
        lead_time_days=lead_time_days,
        service_level=service_level,
    )


# ═══════════════════════════════════════════════════════════════
#  FMEA ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/fmea", response_model=FMEAWorksheetRead)
async def create_fmea(inp: FMEAWorksheetCreate):
    """Create a new FMEA worksheet."""
    engine = _get_fmea_engine()
    return engine.create_worksheet(inp)


@router.get("/fmea/{worksheet_id}", response_model=FMEAWorksheetRead)
async def get_fmea(worksheet_id: UUID):
    """Get a complete FMEA worksheet with items."""
    engine = _get_fmea_engine()
    ws = engine.get_worksheet(worksheet_id)
    if not ws:
        raise HTTPException(status_code=404, detail="FMEA worksheet not found")
    return ws


@router.post("/fmea/{worksheet_id}/items", response_model=FMEAItemRead)
async def add_fmea_item(worksheet_id: UUID, item: FMEAItemInput):
    """Add an item to an FMEA worksheet (auto-calculates RPN)."""
    engine = _get_fmea_engine()
    return engine.add_item(worksheet_id, item)


@router.post(
    "/fmea/{worksheet_id}/suggest-modes",
    response_model=List[FMEAItemInput],
)
async def suggest_fmea_modes(
    worksheet_id: UUID,
    component: str = Query(...),
    asset_class: str = Query("generic"),
):
    """Suggest common failure modes for a component (Tier 2)."""
    engine = _get_fmea_engine()
    return engine.suggest_failure_modes_for_component(component, asset_class)


# ═══════════════════════════════════════════════════════════════
#  RCA ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/rca", response_model=RCAInvestigationRead)
async def create_rca(inp: RCAInvestigationCreate):
    """Create a new RCA investigation."""
    engine = _get_rca_engine()
    return engine.create_investigation(inp)


@router.get("/rca/{investigation_id}", response_model=RCAInvestigationRead)
async def get_rca(investigation_id: UUID):
    """Get a complete RCA investigation with tree structure."""
    engine = _get_rca_engine()
    inv = engine.get_investigation(investigation_id)
    if not inv:
        raise HTTPException(status_code=404, detail="RCA investigation not found")
    return inv


@router.post("/rca/{investigation_id}/nodes", response_model=RCANodeRead)
async def add_rca_node(investigation_id: UUID, node: RCANodeInput):
    """Add a cause node to an RCA investigation."""
    engine = _get_rca_engine()
    return engine.add_node(investigation_id, node)


@router.post(
    "/rca/{investigation_id}/detect-patterns",
    response_model=List[RCAPatternMatch],
)
async def detect_rca_patterns(investigation_id: UUID):
    """Detect recurring patterns across RCA investigations (Tier 2)."""
    rca = _get_rca_engine()
    detector = _get_rca_patterns()

    # Gather all investigations for pattern mining
    inv = rca.get_investigation(investigation_id)
    if not inv:
        raise HTTPException(status_code=404, detail="RCA investigation not found")

    # In production: fetch all investigations from DB
    all_investigations = [inv]  # placeholder
    return detector.detect_patterns(all_investigations)


# ═══════════════════════════════════════════════════════════════
#  CRITICALITY ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/criticality", response_model=CriticalityResult)
async def assess_criticality(
    inp: CriticalityInput,
    asset_class: Optional[str] = Query(None),
):
    """Run semi-quantitative criticality assessment."""
    engine = _get_criticality()
    return engine.assess(inp, asset_class=asset_class)


@router.get("/criticality/{asset_id}", response_model=CriticalityResult)
async def get_criticality(asset_id: UUID):
    """Get the latest criticality assessment for an asset."""
    # In production: fetch from DB
    raise HTTPException(
        status_code=404,
        detail="Criticality assessment not found (not yet persisted)",
    )


# ═══════════════════════════════════════════════════════════════
#  BAD ACTOR ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/bad-actors/generate", response_model=BadActorReportOutput)
async def generate_bad_actor_report(
    period: str = Query(..., description="Report period, e.g. '2026-01'"),
    criteria: BadActorCriteria = Query(BadActorCriteria.COST),
    asset_data: List[Dict[str, Any]] = [],
):
    """Generate a monthly bad actor Pareto report."""
    engine = _get_bad_actor()
    return engine.generate_report(
        period=period,
        criteria=criteria,
        asset_data=asset_data,
    )


@router.get("/bad-actors/latest", response_model=BadActorReportOutput)
async def get_latest_bad_actor_report():
    """Get the most recent bad actor report."""
    # In production: fetch from DB
    raise HTTPException(
        status_code=404,
        detail="No bad actor reports generated yet",
    )


# ═══════════════════════════════════════════════════════════════
#  DEFECT ELIMINATION ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/defect-elimination", response_model=DefectEliminationCampaign)
async def create_de_campaign(
    asset_id: UUID = Query(...),
    asset_name: str = Query(...),
    title: str = Query(...),
    defect_source: DefectSource = Query(...),
    problem_description: str = Query(""),
):
    """Create a Defect Elimination campaign."""
    engine = _get_de_engine()
    return engine.create_campaign(
        asset_id=asset_id,
        asset_name=asset_name,
        title=title,
        defect_source=defect_source,
        problem_description=problem_description,
    )


@router.get(
    "/defect-elimination/{campaign_id}",
    response_model=DefectEliminationCampaign,
)
async def get_de_campaign(campaign_id: UUID):
    """Get a Defect Elimination campaign by ID."""
    engine = _get_de_engine()
    campaign = engine.get_campaign(campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="DE campaign not found")
    return campaign


@router.get(
    "/defect-elimination/summary",
    response_model=DefectEliminationSummary,
)
async def get_de_summary():
    """Get summary of all Defect Elimination campaigns."""
    engine = _get_de_engine()
    return engine.get_summary()


# ═══════════════════════════════════════════════════════════════
#  OEE ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/oee", response_model=OEEResult)
async def calculate_oee(inp: OEEInput):
    """Calculate single Overall Equipment Effectiveness (OEE) metrics."""
    calc = _get_oee_calculator()
    return calc.calculate_oee(inp)


@router.post("/oee/batch", response_model=List[OEEResult])
async def calculate_batch_oee(inputs: List[OEEInput]):
    """Calculate OEE metrics for a batch of assets or production periods."""
    calc = _get_oee_calculator()
    return calc.calculate_batch_oee(inputs)


@router.post("/oee/trends", response_model=OEETrendAnalysis)
async def analyze_oee_trends(history: List[OEEResult]):
    """Analyze historical OEE trends (average and direction/status)."""
    if not history:
        raise HTTPException(status_code=400, detail="History data cannot be empty")
    calc = _get_oee_calculator()
    try:
        return calc.analyze_trends(history)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/oee/compare", response_model=List[OEEResult])
async def compare_asset_oee(assets: List[OEEResult]):
    """Rank a collection of assets based on their OEE score (descending)."""
    calc = _get_oee_calculator()
    return calc.compare_assets(assets)
