"""
pytest suite for the ERS Data Quality Intelligence engine.

Scenarios:
  1. All-missing record  →  Completeness = 0, Composite very low
  2. Impossible values   →  Accuracy penalized heavily
  3. Stale data          →  Timeliness degrades toward 0
  4. Cross-mismatch      →  Consistency drops proportionally
  5. AI confidence penalty propagation when DQS < 60
  6. Perfect record      →  Composite = 100
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

# conftest.py registers the alias "layer1_data_fabric_quality_engine"
# so we can import from the hyphenated layer1-data-fabric directory.
from layer1_data_fabric_quality_engine import (
    score_completeness,
    score_accuracy,
    score_timeliness,
    score_consistency,
    compute_dqs,
    adjust_ai_confidence,
    build_system_summary,
    load_config,
)

# ── Fixtures ────────────────────────────────────────────────────

ASSET_ID = uuid4()
CFG = load_config()


# ── 1. Completeness: all-missing → 0 ───────────────────────────

class TestCompleteness:

    def test_all_missing_fields(self):
        """WO with every required field empty → score 0."""
        record = {}
        dim = score_completeness(record, "work_order", CFG)
        assert dim.score == 0.0
        assert len(dim.details["missing_fields"]) == 7  # 7 required WO fields

    def test_all_present_fields(self):
        """WO with all required fields filled → score 100."""
        record = {
            "equipment_id": "EQ-001",
            "failure_mode": "Bearing failure",
            "cause_code": "WEAR",
            "action_taken": "Replaced bearing",
            "labor_hours": 4.5,
            "parts_used": "BRG-2205",
            "completion_date": "2026-02-01",
        }
        dim = score_completeness(record, "work_order", CFG)
        assert dim.score == 100.0
        assert dim.details["missing_fields"] == []

    def test_partial_fields(self):
        """3 of 7 fields filled → ~42.86."""
        record = {
            "equipment_id": "EQ-001",
            "failure_mode": "Leak",
            "labor_hours": 2,
        }
        dim = score_completeness(record, "work_order", CFG)
        expected = round((3 / 7) * 100, 2)
        assert dim.score == expected

    def test_unknown_record_type(self):
        """Unknown record_type → no config → score 100 (nothing to validate)."""
        dim = score_completeness({}, "unknown_type", CFG)
        assert dim.score == 100.0


# ── 2. Accuracy: impossible values ─────────────────────────────

class TestAccuracy:

    def test_impossible_high_pressure(self):
        """Design pressure 99999 for a Pump exceeds max (2000) → penalized."""
        record = {"design_pressure": 99999}
        dim = score_accuracy(record, "Pump", config=CFG)
        assert dim.score < 100.0
        assert any(o["field"] == "design_pressure" for o in dim.details["outliers"])

    def test_impossible_negative_pressure(self):
        """Negative design pressure for Pump below min (10) → penalized."""
        record = {"design_pressure": -5}
        dim = score_accuracy(record, "Pump", config=CFG)
        assert dim.score < 100.0

    def test_valid_values(self):
        """All within range → score 100."""
        record = {"design_pressure": 150, "design_temperature": 350}
        dim = score_accuracy(record, "Pump", config=CFG)
        assert dim.score == 100.0

    def test_iqr_outlier(self):
        """A value that is an IQR outlier → penalized."""
        record = {"design_pressure": 500}
        history = {"design_pressure": [100, 105, 110, 115, 120, 125, 130, 135]}
        dim = score_accuracy(record, "Pump", historical_values=history, config=CFG)
        assert dim.score < 100.0

    def test_unknown_asset_class(self):
        """Unknown asset class → no ranges → score 100."""
        record = {"design_pressure": 999999}
        dim = score_accuracy(record, "Alien Spacecraft", config=CFG)
        assert dim.score == 100.0


# ── 3. Timeliness: stale data ──────────────────────────────────

class TestTimeliness:

    def test_fresh_data(self):
        """Synced 10 seconds ago vs 86400s expected → 100."""
        recent = datetime.now(tz=timezone.utc) - timedelta(seconds=10)
        dim = score_timeliness(recent, "cmms", CFG)
        assert dim.score == 100.0

    def test_stale_data(self):
        """Synced 10 days ago vs 24h expected → heavily degraded."""
        old = datetime.now(tz=timezone.utc) - timedelta(days=10)
        dim = score_timeliness(old, "cmms", CFG)
        assert dim.score < 50.0

    def test_never_synced(self):
        """None timestamp → score 0."""
        dim = score_timeliness(None, "cmms", CFG)
        assert dim.score == 0.0

    def test_exactly_at_expected(self):
        """Synced exactly at expected interval → 100."""
        exact = datetime.now(tz=timezone.utc) - timedelta(seconds=86400)
        dim = score_timeliness(exact, "cmms", CFG)
        assert dim.score == 100.0


# ── 4. Consistency: cross-mismatch ─────────────────────────────

class TestConsistency:

    def test_all_consistent(self):
        """5/5 refs match → 100."""
        dim = score_consistency(5, 5, CFG)
        assert dim.score == 100.0

    def test_all_mismatched(self):
        """0/5 refs match → 0."""
        dim = score_consistency(0, 5, CFG)
        assert dim.score == 0.0

    def test_partial_mismatch(self):
        """3/5 → 60."""
        dim = score_consistency(3, 5, CFG)
        assert dim.score == 60.0

    def test_no_refs(self):
        """0/0 → 100 (vacuously true)."""
        dim = score_consistency(0, 0, CFG)
        assert dim.score == 100.0


# ── 5. Composite DQS & AI confidence penalty ──────────────────

class TestCompositeDQS:

    def test_perfect_record(self):
        """Fully complete, accurate, fresh, consistent → composite ≈ 100."""
        record = {
            "equipment_id": "EQ-001",
            "failure_mode": "Leak",
            "cause_code": "CORR",
            "action_taken": "Repaired",
            "labor_hours": 3,
            "parts_used": "GASKET-01",
            "completion_date": "2026-01-15",
            "design_pressure": 150,
            "design_temperature": 200,
        }
        result = compute_dqs(
            asset_id=ASSET_ID,
            record=record,
            record_type="work_order",
            asset_class="Pump",
            last_sync_at=datetime.now(tz=timezone.utc),
            source_type="cmms",
            consistent_refs=5,
            total_refs=5,
            config=CFG,
        )
        assert result.composite_score >= 95.0
        assert result.ai_confidence_modifier == 1.0

    def test_terrible_record_triggers_penalty(self):
        """All-missing, stale, inconsistent → low DQS, modifier < 1."""
        result = compute_dqs(
            asset_id=ASSET_ID,
            record={},
            record_type="work_order",
            asset_class="Pump",
            last_sync_at=None,
            source_type="cmms",
            consistent_refs=0,
            total_refs=5,
            config=CFG,
        )
        assert result.composite_score < 60.0
        assert result.ai_confidence_modifier < 1.0

    def test_ai_confidence_propagation(self):
        """Downstream module gets reduced confidence."""
        result = compute_dqs(
            asset_id=ASSET_ID,
            record={},
            record_type="work_order",
            asset_class="Pump",
            last_sync_at=None,
            source_type="cmms",
            consistent_refs=0,
            total_refs=5,
            config=CFG,
        )
        adj = adjust_ai_confidence(0.92, result)
        assert adj.adjusted_confidence < 0.92
        assert adj.penalty_applied > 0


# ── 6. System summary ─────────────────────────────────────────

class TestSystemSummary:

    def test_empty_summary(self):
        summary = build_system_summary([])
        assert summary.total_assets_scored == 0

    def test_populated_summary(self):
        results = []
        for _ in range(10):
            r = compute_dqs(
                asset_id=uuid4(),
                record={
                    "equipment_id": "x",
                    "failure_mode": "y",
                    "cause_code": "z",
                    "action_taken": "a",
                    "labor_hours": 1,
                    "parts_used": "p",
                    "completion_date": "2026-01-01",
                },
                record_type="work_order",
                asset_class="Pump",
                last_sync_at=datetime.now(tz=timezone.utc),
                source_type="cmms",
                consistent_refs=5,
                total_refs=5,
                config=CFG,
            )
            results.append(r)

        summary = build_system_summary(results)
        assert summary.total_assets_scored == 10
        assert summary.average_composite > 0
        assert "completeness" in summary.dimension_averages
