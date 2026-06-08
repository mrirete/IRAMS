"""
Tests — ERS Sustain Engines
══════════════════════════════
Tests for Carbon, Energy, Circularity, and Climate engines.
"""
import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from ers_sustain.schemas import (
    EnergyReading, EnergySourceType, EmissionFactor,
    WasteRecord, WasteCategory, WasteDisposition, ClimateRiskFactor
)
from ers_sustain.engines.carbon import CarbonCalculationEngine
from ers_sustain.engines.energy import EnergyDegradationEngine
from ers_sustain.engines.circular import CircularEconomyEngine
from ers_sustain.engines.climate import ClimateRiskEngine

# ══════════════════════════════════════════════════════════════
#  CARBON ENGINE
# ══════════════════════════════════════════════════════════════

class TestCarbonEngine:
    def setup_method(self):
        self.engine = CarbonCalculationEngine()
        self.asset_id = uuid4()
        self.now = datetime.utcnow()

    def test_scope_1_and_2_emissions_calculation(self):
        readings = [
            EnergyReading(
                asset_id=self.asset_id, timestamp=self.now,
                source_type=EnergySourceType.ELECTRICITY_GRID,
                consumption_value=100.0, uom="kWh"
            ),
            EnergyReading(
                asset_id=self.asset_id, timestamp=self.now,
                source_type=EnergySourceType.DIESEL,
                consumption_value=50.0, uom="liters"
            )
        ]
        res = self.engine.calculate_emissions(
            self.asset_id, readings, 
            self.now - timedelta(days=1), self.now + timedelta(days=1)
        )
        
        # Grid (Scope 2): 100 * 0.4 = 40.0 kg
        # Diesel (Scope 1): 50 * 2.68 = 134.0 kg
        assert res.scope_2_emissions_kg == 40.0
        assert res.scope_1_emissions_kg == 134.0
        assert res.total_emissions_kg == 174.0

    def test_repair_vs_replace_payback_favorable(self):
        res = self.engine.analyze_repair_vs_replace(
            asset_id=self.asset_id,
            repair_carbon_cost_kg=50.0,
            repair_annual_emissions_kg=1000.0,
            replace_embodied_carbon_kg=2000.0,
            replace_annual_emissions_kg=500.0,
            lifespan_years=10
        )
        # Replacing saves 500kg/year. Costs (2000-50) = 1950kg extra upfront.
        # Payback = 1950 / 500 = 3.9 years
        assert res.payback_period_years == 3.9
        assert "REPLACE" in res.recommendation

    def test_repair_vs_replace_never_pays_back(self):
        res = self.engine.analyze_repair_vs_replace(
            asset_id=self.asset_id,
            repair_carbon_cost_kg=100.0,
            repair_annual_emissions_kg=800.0,
            replace_embodied_carbon_kg=5000.0,
            replace_annual_emissions_kg=700.0,
            lifespan_years=10
        )
        # Replacing saves 100kg/year. Costs (5000-100) = 4900kg extra upfront.
        # 4900 / 100 = 49 > 10 years
        assert "REPAIR" in res.recommendation


# ══════════════════════════════════════════════════════════════
#  ENERGY DEGRADATION ENGINE
# ══════════════════════════════════════════════════════════════

class TestEnergyEngine:
    def setup_method(self):
        self.engine = EnergyDegradationEngine()
        self.asset_id = uuid4()
        self.now = datetime.utcnow()

    def test_degradation_detected(self):
        baseline = [
            EnergyReading(
                asset_id=self.asset_id, timestamp=self.now,
                source_type=EnergySourceType.ELECTRICITY_GRID,
                consumption_value=100.0, uom="kWh", output_produced=10.0 # eff = 10
            ) 
        ]
        current = [
            EnergyReading(
                asset_id=self.asset_id, timestamp=self.now,
                source_type=EnergySourceType.ELECTRICITY_GRID,
                consumption_value=120.0, uom="kWh", output_produced=10.0 # eff = 12
            ) 
        ]
        res = self.engine.analyze(self.asset_id, baseline, current)
        
        # (12 - 10) / 10 = 0.20 -> 20% degradation
        assert res.degradation_percent == 20.0
        assert "drag/friction" in res.implied_condition_issue
        assert "immediate vibration analysis" in res.recommended_action

    def test_stable_efficiency(self):
        baseline = [
            EnergyReading(
                asset_id=self.asset_id, timestamp=self.now,
                source_type=EnergySourceType.ELECTRICITY_GRID,
                consumption_value=50.0, uom="kWh", operating_hours=5.0 # eff = 10
            ) 
        ]
        current = [
            EnergyReading(
                asset_id=self.asset_id, timestamp=self.now,
                source_type=EnergySourceType.ELECTRICITY_GRID,
                consumption_value=102.0, uom="kWh", operating_hours=10.0 # eff = 10.2
            ) 
        ]
        res = self.engine.analyze(self.asset_id, baseline, current)
        assert res.degradation_percent == 2.0
        assert res.implied_condition_issue is None


# ══════════════════════════════════════════════════════════════
#  CIRCULAR ECONOMY ENGINE
# ══════════════════════════════════════════════════════════════

class TestCircularEngine:
    def setup_method(self):
        self.engine = CircularEconomyEngine()

    def test_circularity_index(self):
        r1 = WasteRecord(category=WasteCategory.SCRAP_METAL, quantity=500.0, uom="kg", disposition=WasteDisposition.RECYCLED)
        r2 = WasteRecord(category=WasteCategory.HAZARDOUS_LIQUID, quantity=300.0, uom="kg", disposition=WasteDisposition.INCINERATED)
        r3 = WasteRecord(category=WasteCategory.E_WASTE, quantity=200.0, uom="kg", disposition=WasteDisposition.RECLAIMED)

        res = self.engine.calculate_circularity([r1, r2, r3])
        
        assert res.total_waste_kg == 1000.0
        assert res.recycled_reclaimed_kg == 700.0
        assert res.circularity_index_percent == 70.0


# ══════════════════════════════════════════════════════════════
#  CLIMATE RISK ENGINE
# ══════════════════════════════════════════════════════════════

class TestClimateEngine:
    def setup_method(self):
        self.engine = ClimateRiskEngine()

    def test_high_criticality_flood_risk(self):
        res = self.engine.assess_risk(
            asset_id=uuid4(),
            criticality="A",
            detected_risks=[ClimateRiskFactor.FLOODING],
            elevation_meters=2.0 # Low elevation
        )
        # Base flood penalty < 5m = 40.0. Criticality A multiplier = 1.5. 40 * 1.5 = 60.0
        assert res.vulnerability_score == 60.0
        assert any("flood barriers" in r.lower() for r in res.mitigation_recommendations)

    def test_multiple_risks_capped_at_100(self):
        res = self.engine.assess_risk(
            asset_id=uuid4(),
            criticality="A",
            detected_risks=[
                ClimateRiskFactor.FLOODING,
                ClimateRiskFactor.HURRICANE_TYPHOON,
                ClimateRiskFactor.EXTREME_HEAT,
                ClimateRiskFactor.WILDFIRE
            ],
            elevation_meters=1.0,
            temp_max_historical_c=50.0
        )
        assert res.vulnerability_score == 100.0, "Score should not exceed 100.0"

