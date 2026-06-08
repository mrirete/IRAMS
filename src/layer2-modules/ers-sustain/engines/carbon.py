"""
Carbon Calculation Engine
═════════════════════════
Calculates Scope 1 & 2 emissions based on energy consumption.
Models carbon impact of maintenance decisions (Repair vs. Replace).
"""
from datetime import datetime
from typing import List, Dict, Optional
from uuid import UUID, uuid4

from ers_sustain.schemas import (
    CarbonCalculationResult, EnergyReading, EmissionFactor,
    EnergySourceType, RepairVsReplaceCarbon
)

# Default standard emission factors (kg CO2e per unit)
DEFAULT_FACTORS: Dict[EnergySourceType, EmissionFactor] = {
    EnergySourceType.ELECTRICITY_GRID: EmissionFactor(
        source_type=EnergySourceType.ELECTRICITY_GRID, kg_co2e_per_unit=0.4, uom="kWh"
    ),
    EnergySourceType.NATURAL_GAS: EmissionFactor(
        source_type=EnergySourceType.NATURAL_GAS, kg_co2e_per_unit=53.06, uom="mmBtu"
    ),
    EnergySourceType.DIESEL: EmissionFactor(
        source_type=EnergySourceType.DIESEL, kg_co2e_per_unit=2.68, uom="liters"
    ),
    EnergySourceType.FLARE: EmissionFactor(
        source_type=EnergySourceType.FLARE, kg_co2e_per_unit=2.0, uom="m3"
    ),
    EnergySourceType.ELECTRICITY_RENEWABLE: EmissionFactor(
        source_type=EnergySourceType.ELECTRICITY_RENEWABLE, kg_co2e_per_unit=0.0, uom="kWh"
    ),
}


class CarbonCalculationEngine:
    """Engine for Scope 1/2 emissions and lifecycle carbon modeling."""

    def calculate_emissions(
        self,
        asset_id: UUID,
        readings: List[EnergyReading],
        start_date: datetime,
        end_date: datetime,
        custom_factors: Optional[Dict[EnergySourceType, EmissionFactor]] = None
    ) -> CarbonCalculationResult:
        """
        Calculate Scope 1 and Scope 2 emissions for a given set of readings
        over a specific time period.
        """
        factors = custom_factors or DEFAULT_FACTORS
        
        scope_1 = 0.0
        scope_2 = 0.0
        breakdown: Dict[str, float] = {}

        # Filter readings to date range
        valid_readings = [r for r in readings if start_date <= r.timestamp <= end_date]

        for r in valid_readings:
            factor = factors.get(r.source_type)
            if not factor:
                continue

            # Calculate emissions for this reading
            emissions_kg = r.consumption_value * factor.kg_co2e_per_unit

            # Categorize Scope 1 vs 2
            # Scope 2 = Indirect (Purchased Electricity)
            # Scope 1 = Direct (Combustion, Flaring)
            if r.source_type in (
                EnergySourceType.ELECTRICITY_GRID, 
                EnergySourceType.ELECTRICITY_RENEWABLE
            ):
                scope_2 += emissions_kg
            else:
                scope_1 += emissions_kg

            # Add to breakdown
            source_key = r.source_type.value
            breakdown[source_key] = breakdown.get(source_key, 0.0) + emissions_kg

        return CarbonCalculationResult(
            asset_id=asset_id,
            start_date=start_date,
            end_date=end_date,
            scope_1_emissions_kg=round(scope_1, 2),
            scope_2_emissions_kg=round(scope_2, 2),
            total_emissions_kg=round(scope_1 + scope_2, 2),
            sources_breakdown={k: round(v, 2) for k, v in breakdown.items()}
        )

    def analyze_repair_vs_replace(
        self,
        asset_id: UUID,
        repair_carbon_cost_kg: float,
        repair_annual_emissions_kg: float,
        replace_embodied_carbon_kg: float,
        replace_annual_emissions_kg: float,
        lifespan_years: int = 10
    ) -> RepairVsReplaceCarbon:
        """
        Calculates the carbon payback period and lifetime savings
        when deciding between repairing an existing asset vs replacing it.
        """
        annual_savings = repair_annual_emissions_kg - replace_annual_emissions_kg
        embodied_cost_diff = replace_embodied_carbon_kg - repair_carbon_cost_kg

        payback_years = 0.0
        lifetime_savings = 0.0
        
        if annual_savings > 0:
            payback_years = embodied_cost_diff / annual_savings
            lifetime_savings = (annual_savings * lifespan_years) - embodied_cost_diff
        elif annual_savings < 0:
            payback_years = float('inf') # Never pays back
            lifetime_savings = (annual_savings * lifespan_years) - embodied_cost_diff

        if lifetime_savings > 0 and payback_years <= lifespan_years:
            recommendation = (
                f"REPLACE: Carbon payback within {round(payback_years, 1)} years. "
                f"Saves {round(lifetime_savings, 0)} kg CO2e over {lifespan_years} years."
            )
        else:
            recommendation = (
                f"REPAIR: Replacement embodies too much carbon. "
                f"Deficit of {abs(round(lifetime_savings, 0))} kg CO2e over {lifespan_years} years."
            )

        return RepairVsReplaceCarbon(
            asset_id=asset_id,
            repair_embodied_carbon_kg=repair_carbon_cost_kg,
            repair_annual_operating_emissions_kg=repair_annual_emissions_kg,
            replace_embodied_carbon_kg=replace_embodied_carbon_kg,
            replace_annual_operating_emissions_kg=replace_annual_emissions_kg,
            payback_period_years=round(payback_years, 2) if payback_years != float('inf') else -1.0,
            lifetime_carbon_savings_replacement_kg=round(lifetime_savings, 2),
            recommendation=recommendation
        )
