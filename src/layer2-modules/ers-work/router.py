"""
ERS Work — FastAPI Router
═════════════════════════
CRUD + endpoints for OR-Tools scheduling, Backlog Health,
WO enrichment, Parts Forecasting, and Turnaround building.
"""
from typing import List, Dict, Any, Optional
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ers_work.schemas import (
    WorkOrder, WorkType, WorkOrderPriority, WorkOrderStatus,
    ScheduleInput, ScheduleResult, WOContext, BacklogMetrics,
    PartsDemandForecast, TurnaroundScope
)
from ers_work.engines.scheduling import SchedulingEngine
from ers_work.engines.enrichment import EnrichmentEngine
from ers_work.engines.backlog import BacklogHealthEngine
from ers_work.engines.parts import PartsForecastingEngine
from ers_work.engines.turnaround import TurnaroundEngine

router = APIRouter(prefix="/work", tags=["ERS Work"])

# ── Lazy singletons ────────────────────────────────────────
_schedule_engine: Optional[SchedulingEngine] = None
_enrichment_engine: Optional[EnrichmentEngine] = None
_backlog_engine: Optional[BacklogHealthEngine] = None
_parts_engine: Optional[PartsForecastingEngine] = None
_turnaround_engine: Optional[TurnaroundEngine] = None

# In-memory WO DB
_MOCK_DB: Dict[UUID, WorkOrder] = {}

def _get_schedule() -> SchedulingEngine:
    global _schedule_engine
    if not _schedule_engine: _schedule_engine = SchedulingEngine()
    return _schedule_engine

def _get_enrichment() -> EnrichmentEngine:
    global _enrichment_engine
    if not _enrichment_engine: _enrichment_engine = EnrichmentEngine()
    return _enrichment_engine

def _get_backlog() -> BacklogHealthEngine:
    global _backlog_engine
    if not _backlog_engine: _backlog_engine = BacklogHealthEngine()
    return _backlog_engine

def _get_parts() -> PartsForecastingEngine:
    global _parts_engine
    if not _parts_engine: _parts_engine = PartsForecastingEngine()
    return _parts_engine

def _get_turnaround() -> TurnaroundEngine:
    global _turnaround_engine
    if not _turnaround_engine: _turnaround_engine = TurnaroundEngine()
    return _turnaround_engine


# ── Request Models ─────────────────────────────────────────

class CreateWORequest(BaseModel):
    title: str
    description: str
    asset_id: UUID
    type: WorkType
    priority: WorkOrderPriority
    estimated_duration_hours: float
    required_skills: List[str] = []

class BacklogHealthRequest(BaseModel):
    available_weekly_hours: float

class ForecastPartsRequest(BaseModel):
    current_inventory: Dict[str, Dict[str, Any]]
    historical_monthly_usage: Dict[str, float]
    horizon_days: int = 30
    iterations: int = 1000

class BuildTurnaroundRequest(BaseModel):
    name: str
    target_start: datetime
    target_end: datetime
    rbi_inspections: List[Dict[str, Any]] = []
    capital_renewals: List[Dict[str, Any]] = []


# ══════════════════════════════════════════════════════════════
#  WORK ORDER CRUD
# ══════════════════════════════════════════════════════════════

@router.post("/orders/", response_model=WorkOrder, status_code=status.HTTP_201_CREATED)
async def create_work_order(req: CreateWORequest):
    wo = WorkOrder(
        code=f"WO-{len(_MOCK_DB)+1000:04d}",
        title=req.title,
        description=req.description,
        asset_id=req.asset_id,
        type=req.type,
        priority=req.priority,
        estimated_duration_hours=req.estimated_duration_hours,
        required_skills=req.required_skills,
        status=WorkOrderStatus.REQUESTED
    )
    _MOCK_DB[wo.wo_id] = wo
    return wo

@router.get("/orders/{wo_id}", response_model=WorkOrder)
async def get_work_order(wo_id: UUID):
    wo = _MOCK_DB.get(wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    return wo

@router.get("/orders/", response_model=List[WorkOrder])
async def list_work_orders():
    return list(_MOCK_DB.values())


# ══════════════════════════════════════════════════════════════
#  SCHEDULING (OR-TOOLS)
# ══════════════════════════════════════════════════════════════

@router.post("/scheduling/optimize", response_model=ScheduleResult)
async def optimize_schedule(req: ScheduleInput):
    """Run Google OR-Tools CP-SAT solver."""
    return _get_schedule().optimize_schedule(req)


# ══════════════════════════════════════════════════════════════
#  ENRICHMENT
# ══════════════════════════════════════════════════════════════

@router.get("/enrich/{wo_id}", response_model=WOContext)
async def enrich_work_order(wo_id: UUID, asset_class: str = "PUMP"):
    wo = _MOCK_DB.get(wo_id)
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    return _get_enrichment().enrich_work_order(wo, asset_class)


# ══════════════════════════════════════════════════════════════
#  BACKLOG HEALTH (SMRP)
# ══════════════════════════════════════════════════════════════

@router.post("/backlog/health", response_model=BacklogMetrics)
async def analyze_backlog_health(req: BacklogHealthRequest):
    wos = list(_MOCK_DB.values())
    return _get_backlog().calculate_health(wos, req.available_weekly_hours)


# ══════════════════════════════════════════════════════════════
#  PARTS FORECASTING
# ══════════════════════════════════════════════════════════════

@router.post("/parts/forecast", response_model=PartsDemandForecast)
async def forecast_parts(req: ForecastPartsRequest):
    return _get_parts().forecast_demand(
        current_inventory=req.current_inventory,
        historical_monthly_usage=req.historical_monthly_usage,
        horizon_days=req.horizon_days,
        iterations=req.iterations
    )


# ══════════════════════════════════════════════════════════════
#  TURNAROUND SCOPING
# ══════════════════════════════════════════════════════════════

@router.post("/turnaround/build-scope", response_model=TurnaroundScope)
async def build_turnaround_scope(req: BuildTurnaroundRequest):
    # Auto-fetch deferred WOs from the local DB
    deferred = [w for w in _MOCK_DB.values() if w.status == WorkOrderStatus.DEFERRED]
    
    return _get_turnaround().build_scope(
        name=req.name,
        target_start=req.target_start,
        target_end=req.target_end,
        deferred_wos=deferred,
        rbi_inspections=req.rbi_inspections,
        capital_renewals=req.capital_renewals
    )
