"""
Tests for ERS Analyze — Bad Actor and Defect Elimination
═════════════════════════════════════════════════════════════
Tests for Pareto analysis, trend tracking, DE campaigns.
"""

import pytest
from uuid import uuid4

from ers_analyze.schemas import (
    BadActorCriteria,
    DefectSource,
)
from ers_analyze.bad_actor.analyzer import BadActorAnalyzer
from ers_analyze.defect_elimination.engine import DefectEliminationEngine


# ─── Fixtures ────────────────────────────────────────────────

@pytest.fixture
def bad_actor():
    return BadActorAnalyzer()


@pytest.fixture
def de_engine():
    return DefectEliminationEngine()


def _make_asset_data(n: int = 10):
    """Generate mock asset data for Pareto analysis."""
    return [
        {
            "asset_id": uuid4(),
            "asset_name": f"Pump P-{100 + i}",
            "cost": 50000 * (n - i),  # descending cost
            "downtime_hours": 100 * (n - i),
            "wo_count": 20 * (n - i),
            "previous_rank": i + 2 if i < 5 else None,
        }
        for i in range(n)
    ]


# ═══════════════════════════════════════════════════════════════
#  BAD ACTOR TESTS
# ═══════════════════════════════════════════════════════════════

class TestBadActorAnalyzer:

    def test_generate_report_by_cost(self, bad_actor):
        """Should rank assets by cost (descending)."""
        data = _make_asset_data(10)
        report = bad_actor.generate_report(
            period="2026-01",
            criteria=BadActorCriteria.COST,
            asset_data=data,
        )
        assert report.report_period == "2026-01"
        assert report.criteria == BadActorCriteria.COST
        assert len(report.top_assets) == 5
        assert report.top_assets[0].rank == 1
        assert report.top_assets[0].metric_value > report.top_assets[1].metric_value

    def test_generate_report_by_downtime(self, bad_actor):
        """Should rank assets by downtime."""
        data = _make_asset_data(10)
        report = bad_actor.generate_report(
            period="2026-01",
            criteria=BadActorCriteria.DOWNTIME,
            asset_data=data,
        )
        assert report.criteria == BadActorCriteria.DOWNTIME
        assert report.top_assets[0].metric_unit == "hours"

    def test_cumulative_percentage(self, bad_actor):
        """Cumulative percentage should be monotonically increasing."""
        data = _make_asset_data(10)
        report = bad_actor.generate_report(
            period="2026-01",
            criteria=BadActorCriteria.COST,
            asset_data=data,
        )
        for i in range(1, len(report.top_assets)):
            assert report.top_assets[i].cumulative_pct >= report.top_assets[i-1].cumulative_pct

    def test_trend_detection(self, bad_actor):
        """Should detect worsening trend (rank went up)."""
        data = _make_asset_data(10)
        report = bad_actor.generate_report(
            period="2026-01",
            criteria=BadActorCriteria.COST,
            asset_data=data,
        )
        # First asset has previous_rank=2 but now rank=1 → worsening
        assert report.top_assets[0].trend == "worsening"

    def test_empty_data(self, bad_actor):
        """Should handle empty data gracefully."""
        report = bad_actor.generate_report(
            period="2026-01",
            criteria=BadActorCriteria.COST,
            asset_data=[],
        )
        assert len(report.top_assets) == 0
        assert report.total_assets_analyzed == 0

    def test_auto_draft_de_campaigns(self, bad_actor):
        """Should auto-draft DE campaigns for top actors."""
        data = _make_asset_data(10)
        report = bad_actor.generate_report(
            period="2026-01",
            criteria=BadActorCriteria.COST,
            asset_data=data,
        )
        campaigns = bad_actor.auto_draft_de_campaigns(report, max_campaigns=3)
        assert len(campaigns) == 3
        assert all(c.status == "identified" for c in campaigns)
        assert all(c.defect_source is not None for c in campaigns)

    def test_top_n_configurable(self, bad_actor):
        """Should respect configurable top_n."""
        data = _make_asset_data(20)
        report = bad_actor.generate_report(
            period="2026-01",
            criteria=BadActorCriteria.COST,
            asset_data=data,
            top_n=10,
        )
        assert len(report.top_assets) == 10


# ═══════════════════════════════════════════════════════════════
#  DEFECT ELIMINATION TESTS
# ═══════════════════════════════════════════════════════════════

class TestDefectElimination:

    def test_create_campaign(self, de_engine):
        """Should create a campaign with identified status."""
        campaign = de_engine.create_campaign(
            asset_id=uuid4(),
            asset_name="Pump P-101A",
            title="Bearing failure elimination",
            defect_source=DefectSource.MAINTENANCE,
            problem_description="Recurring bearing failures due to improper lubrication.",
        )
        assert campaign.status == "identified"
        assert campaign.defect_source == DefectSource.MAINTENANCE

    def test_advance_status(self, de_engine):
        """Should advance status one step at a time."""
        campaign = de_engine.create_campaign(
            asset_id=uuid4(),
            asset_name="Test",
            title="Test DE",
            defect_source=DefectSource.DESIGN,
            problem_description="Test problem.",
        )
        # identified → investigating
        result = de_engine.advance_status(campaign.id, "investigating")
        assert result.status == "investigating"

        # investigating → eliminating
        result = de_engine.advance_status(campaign.id, "eliminating")
        assert result.status == "eliminating"

        # eliminating → verified
        result = de_engine.advance_status(campaign.id, "verified")
        assert result.status == "verified"

        # verified → closed
        result = de_engine.advance_status(campaign.id, "closed")
        assert result.status == "closed"

    def test_cannot_skip_status(self, de_engine):
        """Should not allow skipping status steps."""
        campaign = de_engine.create_campaign(
            asset_id=uuid4(),
            asset_name="Test",
            title="Test DE",
            defect_source=DefectSource.OPERATION,
            problem_description="Test.",
        )
        # Try to skip from identified → eliminating (should fail)
        result = de_engine.advance_status(campaign.id, "eliminating")
        assert result is None

    def test_record_savings(self, de_engine):
        """Should accumulate savings."""
        campaign = de_engine.create_campaign(
            asset_id=uuid4(),
            asset_name="Test",
            title="Savings Test",
            defect_source=DefectSource.PROCUREMENT,
            problem_description="Test.",
        )
        de_engine.record_savings(campaign.id, 10000.0)
        de_engine.record_savings(campaign.id, 5000.0)
        result = de_engine.get_campaign(campaign.id)
        assert result.actual_savings == 15000.0

    def test_summary_statistics(self, de_engine):
        """Summary should track campaigns by source."""
        de_engine.create_campaign(
            asset_id=uuid4(), asset_name="A", title="DE1",
            defect_source=DefectSource.DESIGN, problem_description="P1",
        )
        de_engine.create_campaign(
            asset_id=uuid4(), asset_name="B", title="DE2",
            defect_source=DefectSource.DESIGN, problem_description="P2",
        )
        de_engine.create_campaign(
            asset_id=uuid4(), asset_name="C", title="DE3",
            defect_source=DefectSource.MAINTENANCE, problem_description="P3",
        )

        summary = de_engine.get_summary()
        assert summary.active_campaigns == 3
        assert summary.source_breakdown["design"] == 2
        assert summary.source_breakdown["maintenance"] == 1
        assert summary.top_defect_source == "design"

    def test_filter_by_source(self, de_engine):
        """Should filter campaigns by defect source."""
        de_engine.create_campaign(
            asset_id=uuid4(), asset_name="A", title="DE1",
            defect_source=DefectSource.INSTALLATION, problem_description="P1",
        )
        de_engine.create_campaign(
            asset_id=uuid4(), asset_name="B", title="DE2",
            defect_source=DefectSource.OPERATION, problem_description="P2",
        )

        install = de_engine.get_campaigns_by_source(DefectSource.INSTALLATION)
        assert len(install) == 1

    def test_get_active_campaigns(self, de_engine):
        """Should return only non-closed campaigns."""
        c1 = de_engine.create_campaign(
            asset_id=uuid4(), asset_name="A", title="DE1",
            defect_source=DefectSource.DESIGN, problem_description="P1",
        )
        c2 = de_engine.create_campaign(
            asset_id=uuid4(), asset_name="B", title="DE2",
            defect_source=DefectSource.DESIGN, problem_description="P2",
        )
        # Close c2
        de_engine.advance_status(c2.id, "investigating")
        de_engine.advance_status(c2.id, "eliminating")
        de_engine.advance_status(c2.id, "verified")
        de_engine.advance_status(c2.id, "closed")

        active = de_engine.get_active_campaigns()
        assert len(active) == 1
        assert active[0].id == c1.id

    def test_all_five_defect_sources(self, de_engine):
        """All 5 Uptime Elements defect sources should be valid."""
        for source in DefectSource:
            campaign = de_engine.create_campaign(
                asset_id=uuid4(), asset_name=f"Test-{source.value}",
                title=f"DE-{source.value}",
                defect_source=source,
                problem_description=f"Testing {source.value} source.",
            )
            assert campaign.defect_source == source
