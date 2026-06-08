"""
ERS Sustain — FastAPI Router
════════════════════════════
Endpoints for Energy, Carbon, Circular Economy, and Climate Risk.
Aggregates ESG reporting metrics.
"""
from typing import List, Optional, Dict
from uuid import UUID
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ers_sustain.schemas import (
    CarbonCalculationResult, EnergyReading, EmissionFactor,
    EnergySourceType, RepairVsReplaceCarbon, EnergyDegradationResult,
    WasteRecord, CircularMetricsResult, ClimateVulnerabilityAssessment,
    ClimateRiskFactor, ESGDashboardMetrics
)
from ers_sustain.engines.carbon import CarbonCalculationEngine
from ers_sustain.engines.energy import EnergyDegradationEngine
from ers_sustain.engines.circular import CircularEconomyEngine
from ers_sustain.engines.climate import ClimateRiskEngine

router = APIRouter(prefix="/sustain", tags=["ERS Sustain"])

# ── Lazy singletons ────────────────────────────────────────
_carbon: Optional[CarbonCalculationEngine] = None
_energy: Optional[EnergyDegradationEngine] = None
_circular: Optional[CircularEconomyEngine] = None
_climate: Optional[ClimateRiskEngine] = None

def _get_carbon() -> CarbonCalculationEngine:
    global _carbon
    if not _carbon: _carbon = CarbonCalculationEngine()
    return _carbon

def _get_energy() -> EnergyDegradationEngine:
    global _energy
    if not _energy: _energy = EnergyDegradationEngine()
    return _energy

def _get_circular() -> CircularEconomyEngine:
    global _circular
    if not _circular: _circular = CircularEconomyEngine()
    return _circular

def _get_climate() -> ClimateRiskEngine:
    global _climate
    if not _climate: _climate = ClimateRiskEngine()
    return _climate

# ── Requests / Responses ───────────────────────────────────

class CalculateEmissionsRequest(BaseModel):
    asset_id: UUID
    readings: List[EnergyReading]
    start_date: datetime
    end_date: datetime

class RepairVsReplaceRequest(BaseModel):
    asset_id: UUID
    repair_embodied_carbon_kg: float
    repair_annual_emissions_kg: float
    replace_embodied_carbon_kg: float
    replace_annual_emissions_kg: float
    lifespan_years: int = 10

class DegradationRequest(BaseModel):
    asset_id: UUID
    baseline_readings: List[EnergyReading]
    current_readings: List[EnergyReading]


# ══════════════════════════════════════════════════════════════
#  ENDPOINTS
# ══════════════════════════════════════════════════════════════

@router.post("/carbon/calculate", response_model=CarbonCalculationResult)
async def calculate_carbon_emissions(req: CalculateEmissionsRequest):
    """Calculate Scope 1 and Scope 2 emissions from energy readings."""
    return _get_carbon().calculate_emissions(
        asset_id=req.asset_id,
        readings=req.readings,
        start_date=req.start_date,
        end_date=req.end_date
    )

@router.post("/carbon/repair-vs-replace", response_model=RepairVsReplaceCarbon)
async def repair_vs_replace(req: RepairVsReplaceRequest):
    """Compare carbon impact of repairing vs replacing an asset."""
    return _get_carbon().analyze_repair_vs_replace(
        asset_id=req.asset_id,
        repair_carbon_cost_kg=req.repair_embodied_carbon_kg,
        repair_annual_emissions_kg=req.repair_annual_emissions_kg,
        replace_embodied_carbon_kg=req.replace_embodied_carbon_kg,
        replace_annual_emissions_kg=req.replace_annual_emissions_kg,
        lifespan_years=req.lifespan_years
    )

@router.post("/energy/degradation", response_model=EnergyDegradationResult)
async def analyze_energy_degradation(req: DegradationRequest):
    """Track energy intensity to detect mechanical degradation (e.g. bearing failure)."""
    return _get_energy().analyze(
        asset_id=req.asset_id,
        baseline_readings=req.baseline_readings,
        current_readings=req.current_readings
    )

@router.post("/circular/metrics", response_model=CircularMetricsResult)
async def calculate_circular_metrics(records: List[WasteRecord], site_id: Optional[UUID] = None):
    """Aggregate waste and compute circularity index (% diverted from landfill)."""
    return _get_circular().calculate_circularity(records, site_id)

@router.post("/climate/assessment", response_model=ClimateVulnerabilityAssessment)
async def assess_climate_risk(
    asset_id: UUID,
    criticality: str,
    detected_risks: List[ClimateRiskFactor],
    elevation_meters: float = 10.0,
    temp_max_historical_c: float = 35.0
):
    """Evaluate an asset's vulnerability to extreme weather and climate risks."""
    return _get_climate().assess_risk(
        asset_id=asset_id,
        criticality=criticality,
        detected_risks=detected_risks,
        elevation_meters=elevation_meters,
        temp_max_historical_c=temp_max_historical_c
    )
