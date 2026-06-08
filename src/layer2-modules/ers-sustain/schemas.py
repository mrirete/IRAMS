"""
ERS Sustain Module — Schemas
════════════════════════════
Pydantic models and enums for energy tracking, carbon emissions (Scope 1/2),
circular economy metrics, climate risk, and ESG dashboarding.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ══════════════════════════════════════════════════════════════
#  ENUMS
# ══════════════════════════════════════════════════════════════

class EnergySourceType(str, Enum):
    ELECTRICITY_GRID = "electricity_grid"
    ELECTRICITY_RENEWABLE = "electricity_renewable"
    NATURAL_GAS = "natural_gas"
    DIESEL = "diesel"
    FLARE = "flare"
    STEAM = "steam"

class ClimateRiskFactor(str, Enum):
    FLOODING = "flooding"
    HURRICANE_TYPHOON = "hurricane_typhoon"
    EXTREME_HEAT = "extreme_heat"
    FREEZING = "freezing"
    WILDFIRE = "wildfire"
    WATER_SCARCITY = "water_scarcity"

class WasteCategory(str, Enum):
    HAZARDOUS_SOLID = "hazardous_solid"
    HAZARDOUS_LIQUID = "hazardous_liquid"
    NON_HAZARDOUS_SOLID = "non_hazardous_solid"
    NON_HAZARDOUS_LIQUID = "non_hazardous_liquid"
    E_WASTE = "e_waste"
    SCRAP_METAL = "scrap_metal"

class WasteDisposition(str, Enum):
    RECYCLED = "recycled"
    RECLAIMED = "reclaimed"
    INCINERATED = "incinerated"
    LANDFILL = "landfill"
    STORED = "stored"


# ══════════════════════════════════════════════════════════════
#  ENERGY & DEGRADATION
# ══════════════════════════════════════════════════════════════

class EnergyReading(BaseModel):
    """A single energy consumption reading."""
    asset_id: UUID
    timestamp: datetime
    source_type: EnergySourceType
    consumption_value: float  # Value in the given uom
    uom: str                  # e.g., kWh, mmBtu, liters
    operating_hours: Optional[float] = None
    output_produced: Optional[float] = None  # Valid for assessing energy efficiency (e.g. m3 pumped)

class EnergyDegradationResult(BaseModel):
    """Result of analyzing an asset's energy efficiency over time."""
    asset_id: UUID
    baseline_efficiency: float
    current_efficiency: float
    degradation_percent: float
    implied_condition_issue: Optional[str] = Field(
        None, description="E.g., '+15% power → potential bearing failure'"
    )
    recommended_action: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)


# ══════════════════════════════════════════════════════════════
#  CARBON (SCOPE 1 & 2)
# ══════════════════════════════════════════════════════════════

class EmissionFactor(BaseModel):
    """Conversion factor for energy -> CO2e emissions."""
    source_type: EnergySourceType
    kg_co2e_per_unit: float
    uom: str
    region: Optional[str] = None

class CarbonCalculationResult(BaseModel):
    """Standardized carbon calculation for a specific time period."""
    asset_id: UUID
    start_date: datetime
    end_date: datetime
    scope_1_emissions_kg: float = 0.0
    scope_2_emissions_kg: float = 0.0
    total_emissions_kg: float = 0.0
    sources_breakdown: Dict[str, float] = Field(
        default_factory=dict, description="kg CO2e per source"
    )

class RepairVsReplaceCarbon(BaseModel):
    """Carbon assessment comparing repairing vs replacing an asset."""
    asset_id: UUID
    repair_embodied_carbon_kg: float
    repair_annual_operating_emissions_kg: float
    replace_embodied_carbon_kg: float    # New asset creation/transport
    replace_annual_operating_emissions_kg: float  # Presumed more efficient
    payback_period_years: float = Field(
        ..., description="Years until replacement carbon is 'paid back' via efficiency"
    )
    lifetime_carbon_savings_replacement_kg: float
    recommendation: str


# ══════════════════════════════════════════════════════════════
#  CIRCULAR ECONOMY
# ══════════════════════════════════════════════════════════════

class WasteRecord(BaseModel):
    """Record of waste generated during work execution."""
    work_order_id: Optional[UUID] = None
    asset_id: Optional[UUID] = None
    category: WasteCategory
    quantity: float
    uom: str  # kg, liters
    disposition: WasteDisposition
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class CircularMetricsResult(BaseModel):
    """Aggregated circular economy metrics."""
    site_id: Optional[UUID] = None
    total_waste_kg: float = 0.0
    recycled_reclaimed_kg: float = 0.0
    circularity_index_percent: float = Field(
        0.0, description="Percentage of waste diverted from landfill/incineration"
    )
    breakdown_by_category: Dict[str, float] = Field(default_factory=dict)


# ══════════════════════════════════════════════════════════════
#  CLIMATE RISK
# ══════════════════════════════════════════════════════════════

class ClimateVulnerabilityAssessment(BaseModel):
    """Asset vulnerability assessment against climate factors."""
    asset_id: UUID
    criticality: str  # A, B, C
    risk_factors: List[ClimateRiskFactor]
    vulnerability_score: float = Field(
        ..., ge=0.0, le=100.0, description="0 = No Risk, 100 = Highly Vulnerable"
    )
    mitigation_recommendations: List[str]


# ══════════════════════════════════════════════════════════════
#  ESG DASHBOARD
# ══════════════════════════════════════════════════════════════

class ESGDashboardMetrics(BaseModel):
    """Board-ready ESG aggregated metrics."""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    scope_1_ytd_mt: float  # Metric Tons
    scope_2_ytd_mt: float
    total_carbon_intensity: float = Field(
        ..., description="MT CO2e per unit of production/revenue"
    )
    circularity_ytd_percent: float
    assets_at_climate_risk_percent: float
    energy_degradation_alerts_active: int
    top_carbon_offender_assets: List[UUID]
