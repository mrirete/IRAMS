"""
Tests for ERS Analyze — OEE Calculator and Router Endpoints
═══════════════════════════════════════════════════════════
Tests for Availability, Performance, Quality, Capping, Trend Analyses,
and FastAPI Router integration.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ers_analyze.oee.calculator import OEECalculator
from ers_analyze.schemas import OEEInput, OEEResult
from ers_analyze.router import router


# ─── Fixtures ────────────────────────────────────────────────

@pytest.fixture
def calculator():
    return OEECalculator()


@pytest.fixture
def api_client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ═══════════════════════════════════════════════════════════════
#  OEE CALCULATOR ENGINE TESTS
# ═══════════════════════════════════════════════════════════════

class TestOEECalculator:

    def test_perfect_run(self, calculator):
        """Should return 100% OEE (1.0) under perfect conditions."""
        asset_id = uuid4()
        inp = OEEInput(
            asset_id=asset_id,
            planned_production_time_hours=24.0,
            downtime_hours=0.0,
            ideal_rate=100.0,
            total_units_produced=2400.0,
            good_units_produced=2400.0,
        )
        res = calculator.calculate_oee(inp)
        
        assert res.asset_id == asset_id
        assert res.availability == 1.0
        assert res.performance == 1.0
        assert res.raw_performance == 1.0
        assert res.quality == 1.0
        assert res.oee == 1.0
        
        assert res.uptime_hours == 24.0
        assert res.rejected_units_produced == 0.0
        assert res.availability_loss_hours == 0.0
        assert res.performance_loss_hours == 0.0
        assert res.quality_loss_equivalent_hours == 0.0
        assert res.total_loss_hours == 0.0

    def test_normal_production_losses(self, calculator):
        """Should calculate correct sub-metrics and equivalent loss hours."""
        inp = OEEInput(
            asset_id=uuid4(),
            planned_production_time_hours=10.0,
            downtime_hours=2.0,  # Uptime = 8.0 hrs
            ideal_rate=50.0,     # Ideal total = 50 * 8 = 400 units
            total_units_produced=3200.0,  # Wait! Ideal units is 400, so let's produce 320 units
            # total_units_produced = 320, so performance = 320 / 400 = 80% (0.8)
            good_units_produced=288.0,    # Good units = 288, so quality = 288 / 320 = 90% (0.9)
        )
        # Reset total produced and good units for calculation:
        inp.total_units_produced = 320.0
        inp.good_units_produced = 288.0

        res = calculator.calculate_oee(inp)

        assert res.uptime_hours == 8.0
        assert res.availability == 0.8  # 8.0 / 10.0
        assert res.performance == 0.8   # 320.0 / (50.0 * 8.0)
        assert res.quality == 0.9       # 288.0 / 320.0
        
        # OEE = 0.8 * 0.8 * 0.9 = 0.576 (57.6%)
        assert pytest.approx(res.oee) == 0.576
        
        # Loss hours:
        # Availability loss = downtime = 2.0 hrs
        # Performance loss = 8.0 * (1.0 - 0.8) = 1.6 hrs
        # Quality loss = 8.0 * 0.8 * (1.0 - 0.9) = 0.64 hrs
        # Total loss = 2.0 + 1.6 + 0.64 = 4.24 hrs
        assert res.availability_loss_hours == 2.0
        assert pytest.approx(res.performance_loss_hours) == 1.6
        assert pytest.approx(res.quality_loss_equivalent_hours) == 0.64
        assert pytest.approx(res.total_loss_hours) == 4.24
        
        # Uptime * OEE = 10 * 0.576 = 5.76 productive hours
        # Productive hours + Total loss = 5.76 + 4.24 = 10.0 planned hours (perfect balance!)
        assert pytest.approx(res.oee * inp.planned_production_time_hours + res.total_loss_hours) == 10.0

    def test_over_speed_capping(self, calculator):
        """Should cap performance at 1.0 for OEE product, but preserve uncapped raw_performance."""
        inp = OEEInput(
            asset_id=uuid4(),
            planned_production_time_hours=10.0,
            downtime_hours=0.0,   # Uptime = 10.0 hrs
            ideal_rate=100.0,     # Ideal total = 10 * 100 = 1000 units
            total_units_produced=1200.0,  # 120% raw performance
            good_units_produced=1080.0,   # 1080 / 1200 = 90% quality
        )
        res = calculator.calculate_oee(inp)
        
        assert res.availability == 1.0
        assert res.raw_performance == 1.2
        assert res.performance == 1.0  # Capped at 1.0
        assert res.quality == 0.9
        assert res.oee == 0.9  # 1.0 * 1.0 * 0.9 = 0.9
        
        # Verify loss hours calculations are consistent with capped value:
        assert res.performance_loss_hours == 0.0  # Since performance is capped at 1.0
        assert pytest.approx(res.quality_loss_equivalent_hours) == 1.0  # 10.0 * 1.0 * (1.0 - 0.9) = 1.0 hr

    def test_edge_case_zero_planned_time(self, calculator):
        """Should handle planned time <= 0 gracefully without division by zero."""
        inp = OEEInput(
            asset_id=uuid4(),
            planned_production_time_hours=0.0,
            downtime_hours=0.0,
            ideal_rate=100.0,
            total_units_produced=0.0,
            good_units_produced=0.0,
        )
        res = calculator.calculate_oee(inp)
        assert res.availability == 0.0
        assert res.performance == 0.0
        assert res.oee == 0.0

    def test_edge_case_downtime_exceeds_planned(self, calculator):
        """Should clamp downtime to planned time and handle Uptime = 0."""
        inp = OEEInput(
            asset_id=uuid4(),
            planned_production_time_hours=10.0,
            downtime_hours=15.0,  # Exceeds planned time
            ideal_rate=100.0,
            total_units_produced=50.0,
            good_units_produced=50.0,
        )
        res = calculator.calculate_oee(inp)
        assert res.downtime_hours == 10.0
        assert res.uptime_hours == 0.0
        assert res.availability == 0.0
        assert res.performance == 0.0
        assert res.oee == 0.0
        assert res.availability_loss_hours == 10.0

    def test_edge_case_zero_production(self, calculator):
        """Should handle zero production count gracefully (Quality defaults to 1.0)."""
        inp = OEEInput(
            asset_id=uuid4(),
            planned_production_time_hours=10.0,
            downtime_hours=0.0,
            ideal_rate=100.0,
            total_units_produced=0.0,
            good_units_produced=0.0,
        )
        res = calculator.calculate_oee(inp)
        assert res.availability == 1.0
        assert res.performance == 0.0  # Zero performance since total count = 0
        assert res.quality == 1.0      # Zero units means no quality defects (defaults to 1.0)
        assert res.oee == 0.0

    def test_edge_case_good_exceeds_total(self, calculator):
        """Should clamp good units to total produced units."""
        inp = OEEInput(
            asset_id=uuid4(),
            planned_production_time_hours=10.0,
            downtime_hours=0.0,
            ideal_rate=10.0,
            total_units_produced=100.0,
            good_units_produced=120.0,  # Invalid: more good than total
        )
        res = calculator.calculate_oee(inp)
        assert res.good_units_produced == 100.0
        assert res.quality == 1.0

    def test_batch_calculation(self, calculator):
        """Should perform calculations across a list of OEE inputs."""
        inputs = [
            OEEInput(
                asset_id=uuid4(),
                planned_production_time_hours=10.0,
                downtime_hours=0.0,
                ideal_rate=10.0,
                total_units_produced=100.0,
                good_units_produced=100.0,
            ),
            OEEInput(
                asset_id=uuid4(),
                planned_production_time_hours=10.0,
                downtime_hours=5.0,
                ideal_rate=10.0,
                total_units_produced=50.0,
                good_units_produced=50.0,
            ),
        ]
        results = calculator.calculate_batch_oee(inputs)
        assert len(results) == 2
        assert results[0].oee == 1.0
        assert results[1].oee == 0.5  # Availability = 0.5, Perf = 1.0, Qual = 1.0

    def test_trend_analysis_improving(self, calculator):
        """Should analyze historical results and detect an improving trend."""
        asset_id = uuid4()
        now = datetime.now(tz=timezone.utc)
        
        # Simulate OEE over 4 shifts: 0.5 -> 0.6 -> 0.7 -> 0.8
        history = [
            calculator.calculate_oee(OEEInput(
                asset_id=asset_id,
                planned_production_time_hours=10.0, downtime_hours=5.0,
                ideal_rate=10.0, total_units_produced=50.0, good_units_produced=50.0,
                recorded_at=now - timedelta(days=3),
            )), # OEE = 0.5
            calculator.calculate_oee(OEEInput(
                asset_id=asset_id,
                planned_production_time_hours=10.0, downtime_hours=4.0,
                ideal_rate=10.0, total_units_produced=60.0, good_units_produced=60.0,
                recorded_at=now - timedelta(days=2),
            )), # OEE = 0.6
            calculator.calculate_oee(OEEInput(
                asset_id=asset_id,
                planned_production_time_hours=10.0, downtime_hours=3.0,
                ideal_rate=10.0, total_units_produced=70.0, good_units_produced=70.0,
                recorded_at=now - timedelta(days=1),
            )), # OEE = 0.7
            calculator.calculate_oee(OEEInput(
                asset_id=asset_id,
                planned_production_time_hours=10.0, downtime_hours=2.0,
                ideal_rate=10.0, total_units_produced=80.0, good_units_produced=80.0,
                recorded_at=now,
            )), # OEE = 0.8
        ]

        trend = calculator.analyze_trends(history)
        
        assert trend.asset_id == asset_id
        assert pytest.approx(trend.average_oee) == 0.65
        assert trend.trend_status == "improving"
        assert len(trend.history) == 4
        # Verify chronological order
        assert trend.history[0].recorded_at < trend.history[1].recorded_at

    def test_trend_analysis_worsening(self, calculator):
        """Should detect a worsening trend if OEE is declining."""
        asset_id = uuid4()
        now = datetime.now(tz=timezone.utc)
        
        # Simulate OEE over 4 shifts: 0.8 -> 0.7 -> 0.6 -> 0.5
        history = [
            calculator.calculate_oee(OEEInput(
                asset_id=asset_id,
                planned_production_time_hours=10.0, downtime_hours=2.0,
                ideal_rate=10.0, total_units_produced=80.0, good_units_produced=80.0,
                recorded_at=now - timedelta(days=3),
            )),
            calculator.calculate_oee(OEEInput(
                asset_id=asset_id,
                planned_production_time_hours=10.0, downtime_hours=3.0,
                ideal_rate=10.0, total_units_produced=70.0, good_units_produced=70.0,
                recorded_at=now - timedelta(days=2),
            )),
            calculator.calculate_oee(OEEInput(
                asset_id=asset_id,
                planned_production_time_hours=10.0, downtime_hours=4.0,
                ideal_rate=10.0, total_units_produced=60.0, good_units_produced=60.0,
                recorded_at=now - timedelta(days=1),
            )),
            calculator.calculate_oee(OEEInput(
                asset_id=asset_id,
                planned_production_time_hours=10.0, downtime_hours=5.0,
                ideal_rate=10.0, total_units_produced=50.0, good_units_produced=50.0,
                recorded_at=now,
            )),
        ]

        trend = calculator.analyze_trends(history)
        assert trend.trend_status == "worsening"

    def test_asset_comparison(self, calculator):
        """Should rank assets from highest OEE to lowest OEE."""
        a1 = calculator.calculate_oee(OEEInput(
            asset_id=uuid4(), planned_production_time_hours=10.0, downtime_hours=0.0,
            ideal_rate=10.0, total_units_produced=100.0, good_units_produced=100.0,
        )) # OEE = 1.0
        
        a2 = calculator.calculate_oee(OEEInput(
            asset_id=uuid4(), planned_production_time_hours=10.0, downtime_hours=5.0,
            ideal_rate=10.0, total_units_produced=50.0, good_units_produced=50.0,
        )) # OEE = 0.5

        a3 = calculator.calculate_oee(OEEInput(
            asset_id=uuid4(), planned_production_time_hours=10.0, downtime_hours=2.0,
            ideal_rate=10.0, total_units_produced=80.0, good_units_produced=80.0,
        )) # OEE = 0.8

        ranked = calculator.compare_assets([a2, a1, a3])
        
        assert len(ranked) == 3
        assert ranked[0].oee == 1.0
        assert ranked[1].oee == 0.8
        assert ranked[2].oee == 0.5


# ═══════════════════════════════════════════════════════════════
#  API ROUTER ENDPOINT TESTS
# ═══════════════════════════════════════════════════════════════

class TestOAEEEndpoints:

    def test_api_calculate_oee(self, api_client):
        """POST /oee should return a computed OEE result."""
        payload = {
            "asset_id": str(uuid4()),
            "planned_production_time_hours": 24.0,
            "downtime_hours": 4.0,
            "ideal_rate": 100.0,
            "total_units_produced": 1600.0,
            "good_units_produced": 1440.0,
        }
        response = api_client.post("/analyze/oee", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        # Availability = 20 / 24 = 0.8333333
        # Performance = 1600 / (100 * 20) = 0.8
        # Quality = 1440 / 1600 = 0.9
        # OEE = 0.83333 * 0.8 * 0.9 = 0.6
        assert pytest.approx(data["availability"]) == 20.0 / 24.0
        assert pytest.approx(data["performance"]) == 0.8
        assert pytest.approx(data["quality"]) == 0.9
        assert pytest.approx(data["oee"]) == 0.6

    def test_api_calculate_batch(self, api_client):
        """POST /oee/batch should return a list of computed OEE results."""
        payload = [
            {
                "asset_id": str(uuid4()),
                "planned_production_time_hours": 10.0,
                "downtime_hours": 0.0,
                "ideal_rate": 10.0,
                "total_units_produced": 100.0,
                "good_units_produced": 100.0,
            },
            {
                "asset_id": str(uuid4()),
                "planned_production_time_hours": 10.0,
                "downtime_hours": 5.0,
                "ideal_rate": 10.0,
                "total_units_produced": 50.0,
                "good_units_produced": 50.0,
            }
        ]
        response = api_client.post("/analyze/oee/batch", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["oee"] == 1.0
        assert data[1]["oee"] == 0.5

    def test_api_analyze_trends(self, api_client):
        """POST /oee/trends should return a valid trend analysis summary."""
        asset_id = str(uuid4())
        history_payload = [
            {
                "asset_id": asset_id,
                "planned_production_time_hours": 10.0,
                "downtime_hours": 5.0,
                "ideal_rate": 10.0,
                "total_units_produced": 50.0,
                "good_units_produced": 50.0,
                "uptime_hours": 5.0,
                "rejected_units_produced": 0.0,
                "availability": 0.5,
                "performance": 1.0,
                "raw_performance": 1.0,
                "quality": 1.0,
                "oee": 0.5,
                "availability_loss_hours": 5.0,
                "performance_loss_hours": 0.0,
                "quality_loss_equivalent_hours": 0.0,
                "total_loss_hours": 5.0,
                "recorded_at": (datetime.now(tz=timezone.utc) - timedelta(days=2)).isoformat(),
            },
            {
                "asset_id": asset_id,
                "planned_production_time_hours": 10.0,
                "downtime_hours": 2.0,
                "ideal_rate": 10.0,
                "total_units_produced": 80.0,
                "good_units_produced": 80.0,
                "uptime_hours": 8.0,
                "rejected_units_produced": 0.0,
                "availability": 0.8,
                "performance": 1.0,
                "raw_performance": 1.0,
                "quality": 1.0,
                "oee": 0.8,
                "availability_loss_hours": 2.0,
                "performance_loss_hours": 0.0,
                "quality_loss_equivalent_hours": 0.0,
                "total_loss_hours": 2.0,
                "recorded_at": datetime.now(tz=timezone.utc).isoformat(),
            }
        ]
        response = api_client.post("/analyze/oee/trends", json=history_payload)
        assert response.status_code == 200
        data = response.json()
        
        assert data["asset_id"] == asset_id
        assert data["average_oee"] == 0.65
        assert data["trend_status"] == "improving"
        assert len(data["history"]) == 2

    def test_api_compare_assets(self, api_client):
        """POST /oee/compare should rank assets by OEE score."""
        payload = [
            {
                "asset_id": str(uuid4()),
                "planned_production_time_hours": 10.0,
                "downtime_hours": 5.0,
                "ideal_rate": 10.0,
                "total_units_produced": 50.0,
                "good_units_produced": 50.0,
                "uptime_hours": 5.0,
                "rejected_units_produced": 0.0,
                "availability": 0.5,
                "performance": 1.0,
                "raw_performance": 1.0,
                "quality": 1.0,
                "oee": 0.5,
                "availability_loss_hours": 5.0,
                "performance_loss_hours": 0.0,
                "quality_loss_equivalent_hours": 0.0,
                "total_loss_hours": 5.0,
                "recorded_at": datetime.now(tz=timezone.utc).isoformat(),
            },
            {
                "asset_id": str(uuid4()),
                "planned_production_time_hours": 10.0,
                "downtime_hours": 0.0,
                "ideal_rate": 10.0,
                "total_units_produced": 100.0,
                "good_units_produced": 100.0,
                "uptime_hours": 10.0,
                "rejected_units_produced": 0.0,
                "availability": 1.0,
                "performance": 1.0,
                "raw_performance": 1.0,
                "quality": 1.0,
                "oee": 1.0,
                "availability_loss_hours": 0.0,
                "performance_loss_hours": 0.0,
                "quality_loss_equivalent_hours": 0.0,
                "total_loss_hours": 0.0,
                "recorded_at": datetime.now(tz=timezone.utc).isoformat(),
            }
        ]
        response = api_client.post("/analyze/oee/compare", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        assert len(data) == 2
        # Highest OEE first
        assert data[0]["oee"] == 1.0
        assert data[1]["oee"] == 0.5
