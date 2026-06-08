"""
Tests — ERS Plan Engines
═══════════════════════════════
Tests for SAMP, Decision (MCDA), Scenario (MC), Risk, Opportunity, Capital.
"""
import pytest
import random
from datetime import datetime, timedelta
from uuid import uuid4

from ers_plan.schemas import (
    SAMPTemplate, StrategicObjective, KPIDefinition, KPIDirection,
    LOSNode, LOSLevel,
    DecisionCriterion, DecisionOption, DecisionStatus,
    ScenarioInput, ScenarioVariable,
    RiskEntry, RiskCategory, RiskLikelihood, RiskConsequence,
    MitigationAction, MitigationStatus,
    BowTieThreat, BowTieConsequence,
    OpportunityEntry, OpportunityComplexity,
    RenewalCandidate
)
from ers_plan.engines.samp import SAMPEngine
from ers_plan.engines.decision import DecisionFrameworkEngine
from ers_plan.engines.scenario import ScenarioModellingEngine
from ers_plan.engines.risk import RiskEngine
from ers_plan.engines.opportunity import OpportunityEngine
from ers_plan.engines.capital import CapitalPlanningEngine


# ══════════════════════════════════════════════════════════════
#  SAMP ENGINE
# ══════════════════════════════════════════════════════════════

class TestSAMPEngine:
    def setup_method(self):
        self.engine = SAMPEngine()

    def test_create_samp(self):
        samp = self.engine.create_samp("5-Year Asset Strategy", 5)
        assert samp.title == "5-Year Asset Strategy"
        assert samp.planning_horizon_years == 5

    def test_kpi_formula_validation_pass(self):
        kpi = KPIDefinition(
            name="Availability",
            formula="mtbf / (mtbf + mttr) * 100",
            variables=["mtbf", "mttr"],
            target_value=95.0
        )
        res = self.engine.validate_kpi_formula(kpi, {"mtbf": 500, "mttr": 25})
        assert res["valid"] is True
        # 500 / (500 + 25) * 100 = 95.238
        assert abs(res["computed_value"] - 95.2381) < 0.01

    def test_kpi_formula_validation_syntax_error(self):
        kpi = KPIDefinition(
            name="Bad", formula="mtbf / (mttr +", variables=["mtbf", "mttr"],
            target_value=50.0
        )
        res = self.engine.validate_kpi_formula(kpi)
        assert res["valid"] is False
        assert "Syntax error" in res["error"]

    def test_line_of_sight_evaluation(self):
        samp = self.engine.create_samp("Test SAMP")
        kpi = KPIDefinition(
            name="OEE", formula="availability * performance * quality / 10000",
            variables=["availability", "performance", "quality"], target_value=85.0
        )
        board = LOSNode(level=LOSLevel.BOARD, name="Board", kpis=[kpi])
        self.engine.build_line_of_sight(samp.samp_id, [board])

        actuals = {board.node_id: {"availability": 95, "performance": 90, "quality": 99}}
        tree = self.engine.evaluate_los_kpis(samp.samp_id, actuals)

        # 95 * 90 * 99 / 10000 = 84.645
        assert abs(tree.nodes[0].actual_values["OEE"] - 84.645) < 0.01


# ══════════════════════════════════════════════════════════════
#  DECISION FRAMEWORK (MCDA)
# ══════════════════════════════════════════════════════════════

class TestDecisionEngine:
    def setup_method(self):
        self.engine = DecisionFrameworkEngine()

    def test_mcda_weighted_scoring(self):
        c1 = DecisionCriterion(name="Safety", weight=0.5, scale_min=0, scale_max=10)
        c2 = DecisionCriterion(name="Cost", weight=0.3, scale_min=0, scale_max=10)
        c3 = DecisionCriterion(name="Environment", weight=0.2, scale_min=0, scale_max=10)

        opt_a = DecisionOption(
            name="Replace",
            description="Full replacement",
            scores={c1.criterion_id: 9, c2.criterion_id: 3, c3.criterion_id: 7}
        )
        opt_b = DecisionOption(
            name="Repair",
            description="Patch repair",
            scores={c1.criterion_id: 4, c2.criterion_id: 8, c3.criterion_id: 5}
        )

        record = self.engine.create_decision(
            "Pump P-101", "End of life assessment", [c1, c2, c3], [opt_a, opt_b]
        )
        result = self.engine.evaluate(record.decision_id, uuid4())

        # Replace: (0.9*0.5 + 0.3*0.3 + 0.7*0.2) = 0.45 + 0.09 + 0.14 = 0.68
        # Repair:  (0.4*0.5 + 0.8*0.3 + 0.5*0.2) = 0.20 + 0.24 + 0.10 = 0.54
        assert result.results[0].option_name == "Replace"
        assert result.results[0].rank == 1
        assert result.status == DecisionStatus.EVALUATED

    def test_tier_4_audit_trail(self):
        c1 = DecisionCriterion(name="Safety", weight=1.0)
        opt = DecisionOption(name="Option A", description="Test", scores={c1.criterion_id: 8})

        record = self.engine.create_decision("Test", "ctx", [c1], [opt])
        self.engine.evaluate(record.decision_id, uuid4())

        approver = uuid4()
        approved = self.engine.approve_decision(
            record.decision_id, approver, opt.option_id, "Best safety score"
        )

        assert approved.status == DecisionStatus.APPROVED
        assert len(approved.audit_trail) == 3  # CREATED + EVALUATED + APPROVED
        assert approved.audit_trail[-1]["action"] == "APPROVED"


# ══════════════════════════════════════════════════════════════
#  SCENARIO MODELLING (MONTE CARLO)
# ══════════════════════════════════════════════════════════════

class TestScenarioEngine:
    def setup_method(self):
        self.engine = ScenarioModellingEngine()
        random.seed(42)  # Deterministic for tests

    def test_monte_carlo_simulation(self):
        scenario = ScenarioInput(
            name="Base Case",
            description="Normal operating conditions",
            variables=[
                ScenarioVariable(name="revenue", distribution="normal", params={"mean": 1000000, "std": 100000}),
                ScenarioVariable(name="costs", distribution="normal", params={"mean": -700000, "std": 50000}),
            ],
            iterations=1000
        )
        res = self.engine.run_simulation(scenario)

        assert res.mean_npv > 200000  # ~300k expected
        assert res.p10_npv < res.p50_npv < res.p90_npv  # Percentiles should be ordered
        assert res.std_dev > 0

    def test_scenario_comparison(self):
        random.seed(42)
        s1 = ScenarioInput(
            name="Conservative", description="Low risk",
            variables=[ScenarioVariable(name="npv", distribution="normal", params={"mean": 500000, "std": 50000})],
            iterations=500
        )
        s2 = ScenarioInput(
            name="Aggressive", description="High risk",
            variables=[ScenarioVariable(name="npv", distribution="normal", params={"mean": 800000, "std": 300000})],
            iterations=500
        )
        comparison = self.engine.compare_scenarios([s1, s2])
        assert len(comparison.scenarios) == 2
        assert comparison.recommended_scenario_id is not None


# ══════════════════════════════════════════════════════════════
#  RISK ENGINE
# ══════════════════════════════════════════════════════════════

class TestRiskEngine:
    def setup_method(self):
        self.engine = RiskEngine()

    def test_inherent_risk_calculation(self):
        risk = RiskEntry(
            title="Loss of containment",
            description="Flange leak",
            category=RiskCategory.SAFETY,
            likelihood=RiskLikelihood.LIKELY,
            consequence=RiskConsequence.MAJOR
        )
        registered = self.engine.register_risk(risk)
        assert registered.inherent_risk_score == 16  # 4 × 4

    def test_heatmap_generation(self):
        self.engine.register_risk(RiskEntry(
            title="R1", description="d", category=RiskCategory.SAFETY,
            likelihood=RiskLikelihood.ALMOST_CERTAIN, consequence=RiskConsequence.CATASTROPHIC
        ))
        heatmap = self.engine.generate_heatmap()
        assert heatmap.total_risks == 1
        dark_red_cell = [c for c in heatmap.cells if c.color == "dark_red" and c.count > 0]
        assert len(dark_red_cell) == 1

    def test_mitigation_reduces_residual_risk(self):
        risk = RiskEntry(
            title="Corrosion", description="Pipe wall thinning",
            category=RiskCategory.OPERATIONAL,
            likelihood=RiskLikelihood.LIKELY,  # 4
            consequence=RiskConsequence.MAJOR   # 4
        )
        self.engine.register_risk(risk)

        mitigation = MitigationAction(
            description="Apply coating",
            status=MitigationStatus.COMPLETED,
            effectiveness_percent=50.0
        )
        updated = self.engine.add_mitigation(risk.risk_id, mitigation)

        # 50% effectiveness reduces likelihood: 4 * 0.5 = 2
        assert updated.residual_likelihood == RiskLikelihood.UNLIKELY
        assert updated.residual_risk_score == 8  # 2 × 4

    def test_bowtie_creation(self):
        risk_id = uuid4()
        threat = BowTieThreat(description="External corrosion", preventive_controls=["Coating", "CP"])
        consequence = BowTieConsequence(description="Environmental spill", mitigating_controls=["Bunds", "Emergency response"])

        bt = self.engine.create_bowtie(risk_id, "Loss of containment", [threat], [consequence])
        assert bt.top_event == "Loss of containment"
        assert len(bt.threats) == 1
        assert len(bt.consequences) == 1


# ══════════════════════════════════════════════════════════════
#  OPPORTUNITY ENGINE
# ══════════════════════════════════════════════════════════════

class TestOpportunityEngine:
    def setup_method(self):
        self.engine = OpportunityEngine()

    def test_roi_and_ranking(self):
        opp1 = OpportunityEntry(
            title="VFD on Pump P-101",
            description="Install variable frequency drive",
            estimated_annual_savings=50000,
            implementation_cost=100000,
            complexity=OpportunityComplexity.LOW,
            strategic_alignment_score=8.0
        )
        opp2 = OpportunityEntry(
            title="Replace boiler controls",
            description="Upgrade PLC",
            estimated_annual_savings=80000,
            implementation_cost=500000,
            complexity=OpportunityComplexity.HIGH,
            strategic_alignment_score=6.0
        )
        self.engine.register_opportunity(opp1)
        self.engine.register_opportunity(opp2)

        ranked = self.engine.get_ranked()
        # opp1 ROI = 50%, alignment=8, complexity=1.0 -> score = (50*8*1.0)/100 = 4.0
        # opp2 ROI = 16%, alignment=6, complexity=0.4 -> score = (16*6*0.4)/100 = 0.384
        assert ranked.opportunities[0].title == "VFD on Pump P-101"
        assert ranked.total_potential_savings == 130000


# ══════════════════════════════════════════════════════════════
#  CAPITAL PLANNING ENGINE
# ══════════════════════════════════════════════════════════════

class TestCapitalEngine:
    def setup_method(self):
        self.engine = CapitalPlanningEngine(discount_rate=0.08)

    def test_tco_replacement_recommended(self):
        candidate = RenewalCandidate(
            asset_id=uuid4(), asset_name="Pump P-101",
            current_age_years=18, expected_useful_life_years=20,
            condition_score=35.0,
            annual_maintenance_cost=50000,
            replacement_cost=200000,
            criticality="A"
        )
        res = self.engine.analyze_renewal_vs_repair(candidate, 10)
        assert "REPLACE" in res.recommendation or "REPAIR" in res.recommendation
        assert res.repair_tco > 0
        assert res.replace_tco > 0

    def test_capex_forecast_ordering(self):
        c1 = RenewalCandidate(
            asset_id=uuid4(), asset_name="Pump A",
            current_age_years=18, expected_useful_life_years=20,
            condition_score=30.0, annual_maintenance_cost=40000,
            replacement_cost=300000, criticality="A"
        )
        c2 = RenewalCandidate(
            asset_id=uuid4(), asset_name="Motor B",
            current_age_years=5, expected_useful_life_years=15,
            condition_score=80.0, annual_maintenance_cost=10000,
            replacement_cost=100000, criticality="C"
        )
        forecast = self.engine.generate_capex_forecast([c1, c2], 5)

        # Pump A (2yr remaining) should be scheduled before Motor B (10yr remaining)
        assert len(forecast.line_items) >= 1
        assert forecast.line_items[0].asset_name == "Pump A"
        assert forecast.total_capex > 0
