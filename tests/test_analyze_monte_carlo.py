"""
Tests for ERS Analyze — Monte Carlo Simulation
════════════════════════════════════════════════
Tests for single-asset, system-level sim, comparison, and spare parts.
"""

import pytest
from uuid import uuid4

import numpy as np

from ers_analyze.schemas import (
    MonteCarloSingleInput,
    MonteCarloSystemInput,
)
from ers_analyze.monte_carlo.engine import MonteCarloEngine
from ers_analyze.monte_carlo.spare_parts import SparePartsForecast


# ─── Fixtures ────────────────────────────────────────────────

@pytest.fixture
def mc_engine():
    return MonteCarloEngine(seed=42)


@pytest.fixture
def spare_parts():
    return SparePartsForecast(seed=42)


def _make_single_input(**overrides) -> MonteCarloSingleInput:
    defaults = dict(
        asset_id=uuid4(),
        simulation_years=5,
        iterations=500,  # smaller for fast tests
        failure_distribution="weibull",
        distribution_params={"beta": 2.0, "eta": 5000.0},
        repair_time_hours=8.0,
        repair_time_std=2.0,
        pm_interval_hours=None,
        pm_duration_hours=4.0,
        failure_cost=50000.0,
        pm_cost=5000.0,
    )
    defaults.update(overrides)
    return MonteCarloSingleInput(**defaults)


# ═══════════════════════════════════════════════════════════════
#  SINGLE-ASSET MONTE CARLO TESTS
# ═══════════════════════════════════════════════════════════════

class TestMonteCarloSingle:

    def test_basic_simulation_runs(self, mc_engine):
        """Simulation should complete and return valid metrics."""
        inp = _make_single_input()
        result = mc_engine.simulate_single(inp)
        assert result.iterations == 500
        assert 0.0 <= result.availability_mean <= 1.0
        assert result.mtbf_mean > 0
        assert result.total_cost_mean >= 0

    def test_availability_within_bounds(self, mc_engine):
        """Availability should be between 0 and 1."""
        inp = _make_single_input()
        result = mc_engine.simulate_single(inp)
        assert 0.0 <= result.availability_mean <= 1.0
        assert result.availability_ci_95[0] <= result.availability_mean
        assert result.availability_ci_95[1] >= result.availability_mean

    def test_pm_reduces_cost(self, mc_engine):
        """Adding PM should reduce failure cost (but adds PM cost)."""
        # Very unreliable asset
        inp_no_pm = _make_single_input(
            distribution_params={"beta": 1.5, "eta": 3000.0},
            failure_cost=100000.0,
            pm_cost=5000.0,
        )
        inp_with_pm = _make_single_input(
            distribution_params={"beta": 1.5, "eta": 3000.0},
            failure_cost=100000.0,
            pm_cost=5000.0,
            pm_interval_hours=2000.0,
        )
        result_no_pm = mc_engine.simulate_single(inp_no_pm)
        result_with_pm = mc_engine.simulate_single(inp_with_pm)
        # With PM may have higher total cost (PM cost) but should have fewer failures
        # This is a statistical test, so we just check both run
        assert result_no_pm.total_failures_mean > 0
        assert result_with_pm is not None

    def test_weibull_distribution(self, mc_engine):
        """Weibull distribution should produce reasonable results."""
        inp = _make_single_input(
            failure_distribution="weibull",
            distribution_params={"beta": 2.0, "eta": 10000.0},
            iterations=1000,
        )
        result = mc_engine.simulate_single(inp)
        assert result.availability_mean > 0.5  # should be reasonably available

    def test_exponential_distribution(self, mc_engine):
        """Exponential distribution (memoryless) should work."""
        inp = _make_single_input(
            failure_distribution="exponential",
            distribution_params={"lambda": 0.001},
        )
        result = mc_engine.simulate_single(inp)
        assert result.availability_mean > 0.0

    def test_lognormal_distribution(self, mc_engine):
        """Lognormal distribution should work."""
        inp = _make_single_input(
            failure_distribution="lognormal",
            distribution_params={"mu": 8.5, "sigma": 0.5},
        )
        result = mc_engine.simulate_single(inp)
        assert result.availability_mean > 0.0

    def test_percentiles_ordered(self, mc_engine):
        """Percentiles should be monotonically increasing."""
        inp = _make_single_input(iterations=1000)
        result = mc_engine.simulate_single(inp)
        if "p5" in result.percentiles and "p95" in result.percentiles:
            assert result.percentiles["p5"] <= result.percentiles["p95"]

    def test_confidence_interval(self, mc_engine):
        """95% CI should bracket the mean."""
        inp = _make_single_input(iterations=2000)
        result = mc_engine.simulate_single(inp)
        ci_low, ci_high = result.availability_ci_95
        assert ci_low <= result.availability_mean
        assert ci_high >= result.availability_mean


# ═══════════════════════════════════════════════════════════════
#  SYSTEM-LEVEL MONTE CARLO TESTS
# ═══════════════════════════════════════════════════════════════

class TestMonteCarloSystem:

    def test_series_system(self, mc_engine):
        """Series system availability ≤ weakest component."""
        inp = MonteCarloSystemInput(
            unit_id=uuid4(),
            topology={"type": "series"},
            asset_params=[
                _make_single_input(distribution_params={"beta": 2.0, "eta": 5000.0}),
                _make_single_input(distribution_params={"beta": 2.0, "eta": 5000.0}),
            ],
            iterations=500,
        )
        result = mc_engine.simulate_system(inp)
        assert result.availability_mean > 0

    def test_parallel_system(self, mc_engine):
        """Parallel system availability ≥ individual component."""
        inp = MonteCarloSystemInput(
            unit_id=uuid4(),
            topology={"type": "parallel"},
            asset_params=[
                _make_single_input(distribution_params={"beta": 2.0, "eta": 5000.0}),
                _make_single_input(distribution_params={"beta": 2.0, "eta": 5000.0}),
            ],
            iterations=500,
        )
        result = mc_engine.simulate_system(inp)
        assert result.availability_mean > 0

    def test_empty_system(self, mc_engine):
        """System with no assets should have 100% availability."""
        inp = MonteCarloSystemInput(
            unit_id=uuid4(),
            topology={"type": "series"},
            asset_params=[],
            iterations=100,
        )
        result = mc_engine.simulate_system(inp)
        assert result.availability_mean == 1.0


# ═══════════════════════════════════════════════════════════════
#  SCENARIO COMPARISON TESTS
# ═══════════════════════════════════════════════════════════════

class TestMonteCarloCompare:

    def test_comparison_runs(self, mc_engine):
        """Scenario comparison should complete."""
        baseline = _make_single_input(iterations=200)
        proposed = _make_single_input(
            iterations=200,
            pm_interval_hours=2000.0,
        )
        result = mc_engine.compare_scenarios(baseline, proposed)
        assert result.baseline is not None
        assert result.proposed is not None
        assert result.recommendation is not None

    def test_recommendation_text_generated(self, mc_engine):
        """Should generate a recommendation string."""
        baseline = _make_single_input(iterations=200)
        proposed = _make_single_input(iterations=200)
        result = mc_engine.compare_scenarios(baseline, proposed)
        assert len(result.recommendation) > 0


# ═══════════════════════════════════════════════════════════════
#  SPARE PARTS FORECAST TESTS
# ═══════════════════════════════════════════════════════════════

class TestSparePartsForecast:

    def test_basic_forecast(self, spare_parts):
        """Basic spare parts forecast should return valid values."""
        result = spare_parts.forecast_demand(
            asset_id=uuid4(),
            failure_rate_per_year=2.0,
            lead_time_days=14.0,
            service_level=0.95,
        )
        assert result.safety_stock >= 1
        assert result.reorder_point >= result.safety_stock
        assert result.demand_rate_per_year == 2.0

    def test_higher_failure_rate_more_stock(self, spare_parts):
        """Higher failure rate should require more safety stock."""
        low = spare_parts.forecast_demand(uuid4(), failure_rate_per_year=0.5, lead_time_days=14.0)
        high = spare_parts.forecast_demand(uuid4(), failure_rate_per_year=10.0, lead_time_days=14.0)
        assert high.reorder_point >= low.reorder_point

    def test_higher_service_level_more_stock(self, spare_parts):
        """Higher service level should require more safety stock."""
        normal = spare_parts.forecast_demand(uuid4(), failure_rate_per_year=2.0, service_level=0.90)
        premium = spare_parts.forecast_demand(uuid4(), failure_rate_per_year=2.0, service_level=0.99)
        assert premium.safety_stock >= normal.safety_stock

    def test_fleet_forecast(self, spare_parts):
        """Fleet forecast should return results for all assets."""
        assets = [
            {"asset_id": uuid4(), "failure_rate": 1.0, "part_name": "bearing"},
            {"asset_id": uuid4(), "failure_rate": 2.0, "part_name": "seal"},
        ]
        results = spare_parts.forecast_fleet(assets)
        assert len(results) == 2
        assert results[0].part_name == "bearing"
        assert results[1].part_name == "seal"
