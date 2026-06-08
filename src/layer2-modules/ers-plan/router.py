"""
ERS Plan — FastAPI Router
═════════════════════════
CRUD + specialized endpoints for strategic asset management planning.
"""
from typing import List, Optional, Dict, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ers_plan.schemas import (
    SAMPTemplate, StrategicObjective, KPIDefinition, LOSNode, LOSTree,
    DecisionCriterion, DecisionOption, DecisionRecord, MCDAResult,
    ScenarioInput, ScenarioComparison, MonteCarloResult,
    RiskEntry, RiskHeatmap, BowTieThreat, BowTieConsequence, BowTieModel,
    MitigationAction,
    OpportunityEntry, RankedOpportunities,
    RenewalCandidate, TCOResult, CAPEXForecast
)
from ers_plan.engines.samp import SAMPEngine
from ers_plan.engines.decision import DecisionFrameworkEngine
from ers_plan.engines.scenario import ScenarioModellingEngine
from ers_plan.engines.risk import RiskEngine
from ers_plan.engines.opportunity import OpportunityEngine
from ers_plan.engines.capital import CapitalPlanningEngine

router = APIRouter(prefix="/plan", tags=["ERS Plan"])

# ── Lazy singletons ────────────────────────────────────────
_samp: Optional[SAMPEngine] = None
_decision: Optional[DecisionFrameworkEngine] = None
_scenario: Optional[ScenarioModellingEngine] = None
_risk: Optional[RiskEngine] = None
_opportunity: Optional[OpportunityEngine] = None
_capital: Optional[CapitalPlanningEngine] = None

def _get_samp() -> SAMPEngine:
    global _samp
    if not _samp: _samp = SAMPEngine()
    return _samp

def _get_decision() -> DecisionFrameworkEngine:
    global _decision
    if not _decision: _decision = DecisionFrameworkEngine()
    return _decision

def _get_scenario() -> ScenarioModellingEngine:
    global _scenario
    if not _scenario: _scenario = ScenarioModellingEngine()
    return _scenario

def _get_risk() -> RiskEngine:
    global _risk
    if not _risk: _risk = RiskEngine()
    return _risk

def _get_opportunity() -> OpportunityEngine:
    global _opportunity
    if not _opportunity: _opportunity = OpportunityEngine()
    return _opportunity

def _get_capital() -> CapitalPlanningEngine:
    global _capital
    if not _capital: _capital = CapitalPlanningEngine()
    return _capital

# ── Request models ─────────────────────────────────────────

class CreateSAMPRequest(BaseModel):
    title: str
    horizon_years: int = 5

class ApproveSAMPRequest(BaseModel):
    approver_id: UUID

class ValidateKPIRequest(BaseModel):
    kpi: KPIDefinition
    test_values: Optional[Dict[str, float]] = None

class LOSBuildRequest(BaseModel):
    nodes: List[LOSNode]

class LOSEvalRequest(BaseModel):
    actuals: Dict[UUID, Dict[str, float]]

class CreateDecisionRequest(BaseModel):
    title: str
    context: str
    criteria: List[DecisionCriterion]
    options: List[DecisionOption]

class EvaluateDecisionRequest(BaseModel):
    evaluator_id: UUID

class ApproveDecisionRequest(BaseModel):
    approver_id: UUID
    selected_option_id: UUID
    rationale: str

class CreateBowTieRequest(BaseModel):
    top_event: str
    threats: List[BowTieThreat]
    consequences: List[BowTieConsequence]

class CAPEXForecastRequest(BaseModel):
    candidates: List[RenewalCandidate]
    horizon_years: int = 5

# ══════════════════════════════════════════════════════════════
#  SAMP ENDPOINTS
# ══════════════════════════════════════════════════════════════

@router.post("/samp/", response_model=SAMPTemplate)
async def create_samp(req: CreateSAMPRequest):
    return _get_samp().create_samp(req.title, req.horizon_years)

@router.get("/samp/{samp_id}", response_model=SAMPTemplate)
async def get_samp(samp_id: UUID):
    samp = _get_samp().get_samp(samp_id)
    if not samp:
        raise HTTPException(status_code=404, detail="SAMP not found")
    return samp

@router.post("/samp/{samp_id}/objectives", response_model=SAMPTemplate)
async def add_objective(samp_id: UUID, objective: StrategicObjective):
    try:
        return _get_samp().add_objective(samp_id, objective)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/samp/{samp_id}/approve", response_model=SAMPTemplate)
async def approve_samp(samp_id: UUID, req: ApproveSAMPRequest):
    try:
        return _get_samp().approve_samp(samp_id, req.approver_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/samp/validate-kpi")
async def validate_kpi(req: ValidateKPIRequest):
    return _get_samp().validate_kpi_formula(req.kpi, req.test_values)

@router.post("/samp/{samp_id}/line-of-sight", response_model=LOSTree)
async def build_los(samp_id: UUID, req: LOSBuildRequest):
    return _get_samp().build_line_of_sight(samp_id, req.nodes)

@router.get("/samp/{samp_id}/line-of-sight", response_model=LOSTree)
async def get_los(samp_id: UUID):
    tree = _get_samp().get_line_of_sight(samp_id)
    if not tree:
        raise HTTPException(status_code=404, detail="No LoS tree for this SAMP")
    return tree

@router.post("/samp/{samp_id}/line-of-sight/evaluate", response_model=LOSTree)
async def evaluate_los(samp_id: UUID, req: LOSEvalRequest):
    try:
        return _get_samp().evaluate_los_kpis(samp_id, req.actuals)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ══════════════════════════════════════════════════════════════
#  DECISION FRAMEWORK
# ══════════════════════════════════════════════════════════════

@router.post("/decisions/", response_model=DecisionRecord)
async def create_decision(req: CreateDecisionRequest):
    return _get_decision().create_decision(req.title, req.context, req.criteria, req.options)

@router.post("/decisions/{decision_id}/evaluate", response_model=DecisionRecord)
async def evaluate_decision(decision_id: UUID, req: EvaluateDecisionRequest):
    try:
        return _get_decision().evaluate(decision_id, req.evaluator_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/decisions/{decision_id}/approve", response_model=DecisionRecord)
async def approve_decision(decision_id: UUID, req: ApproveDecisionRequest):
    try:
        return _get_decision().approve_decision(
            decision_id, req.approver_id, req.selected_option_id, req.rationale
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ══════════════════════════════════════════════════════════════
#  SCENARIO MODELLING
# ══════════════════════════════════════════════════════════════

@router.post("/scenarios/run", response_model=MonteCarloResult)
async def run_scenario(scenario: ScenarioInput):
    return _get_scenario().run_simulation(scenario)

@router.post("/scenarios/compare", response_model=ScenarioComparison)
async def compare_scenarios(scenarios: List[ScenarioInput]):
    return _get_scenario().compare_scenarios(scenarios)


# ══════════════════════════════════════════════════════════════
#  RISK MODULE
# ══════════════════════════════════════════════════════════════

@router.post("/risks/", response_model=RiskEntry)
async def register_risk(risk: RiskEntry):
    return _get_risk().register_risk(risk)

@router.get("/risks/{risk_id}", response_model=RiskEntry)
async def get_risk(risk_id: UUID):
    risk = _get_risk().get_risk(risk_id)
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    return risk

@router.post("/risks/{risk_id}/mitigations", response_model=RiskEntry)
async def add_mitigation(risk_id: UUID, mitigation: MitigationAction):
    try:
        return _get_risk().add_mitigation(risk_id, mitigation)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.get("/risks/heatmap/", response_model=RiskHeatmap)
async def get_heatmap(use_residual: bool = False):
    return _get_risk().generate_heatmap(use_residual)

@router.post("/risks/{risk_id}/bowtie", response_model=BowTieModel)
async def create_bowtie(risk_id: UUID, req: CreateBowTieRequest):
    return _get_risk().create_bowtie(risk_id, req.top_event, req.threats, req.consequences)


# ══════════════════════════════════════════════════════════════
#  OPPORTUNITY MODULE
# ══════════════════════════════════════════════════════════════

@router.post("/opportunities/", response_model=OpportunityEntry)
async def register_opportunity(opp: OpportunityEntry):
    return _get_opportunity().register_opportunity(opp)

@router.get("/opportunities/ranked", response_model=RankedOpportunities)
async def get_ranked_opportunities(top_n: int = 10):
    return _get_opportunity().get_ranked(top_n)


# ══════════════════════════════════════════════════════════════
#  CAPITAL PLANNING
# ══════════════════════════════════════════════════════════════

@router.post("/capital/tco", response_model=TCOResult)
async def analyze_tco(candidate: RenewalCandidate, horizon_years: int = 10):
    return _get_capital().analyze_renewal_vs_repair(candidate, horizon_years)

@router.post("/capital/forecast", response_model=CAPEXForecast)
async def capex_forecast(req: CAPEXForecastRequest):
    return _get_capital().generate_capex_forecast(req.candidates, req.horizon_years)
