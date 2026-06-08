"""
ERS Data Quality Intelligence Engine
─────────────────────────────────────
Core differentiator vs SymphonyAI / C3.ai.

Every ingested record receives a composite DQS (0-100) from four
equally-weighted dimensions: Completeness, Accuracy, Timeliness,
Consistency.

Critical rule:
    When DQS < 60 the AI confidence for any recommendation that
    touches the affected data is reduced by  (60 − DQS) %.
    This propagates to Digital Twin health indices, Agent responses,
    and downstream analytics.
"""

from __future__ import annotations

import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

import yaml

from .schemas import (
    AIConfidenceAdjustment,
    DimensionScore,
    DQSResult,
    SystemDQSSummary,
)


# ── Configuration loader ────────────────────────────────────────

_CONFIG_PATH = Path(__file__).parent / "config.yaml"


def load_config(path: Path = _CONFIG_PATH) -> Dict[str, Any]:
    """Load and return the YAML scoring configuration."""
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


_config: Dict[str, Any] = load_config()


def reload_config(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Hot-reload config and optionally merge runtime overrides."""
    global _config
    _config = load_config()
    if overrides:
        _deep_merge(_config, overrides)
    return _config


def get_config() -> Dict[str, Any]:
    return _config


def _deep_merge(base: dict, override: dict) -> None:
    for key, val in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(val, dict):
            _deep_merge(base[key], val)
        else:
            base[key] = val


# ── Dimension scorers ───────────────────────────────────────────

def score_completeness(
    record: Dict[str, Any],
    record_type: str,
    config: Optional[Dict[str, Any]] = None,
) -> DimensionScore:
    """
    COMPLETENESS (25 %)
    Score = (filled / required) × 100
    """
    cfg = config or _config
    completeness_cfg = cfg.get("completeness", {})
    type_cfg = completeness_cfg.get(record_type, {})
    required_fields: List[str] = type_cfg.get("required_fields", [])

    if not required_fields:
        # No config → assume complete
        return DimensionScore(
            dimension="completeness",
            score=100.0,
            weight=cfg["weights"]["completeness"],
            weighted_score=100.0 * cfg["weights"]["completeness"],
            details={"message": f"No required fields configured for '{record_type}'"},
        )

    filled = sum(
        1
        for f in required_fields
        if record.get(f) is not None and record.get(f) != ""
    )
    total = len(required_fields)
    raw_score = (filled / total) * 100.0 if total > 0 else 100.0
    weight = cfg["weights"]["completeness"]

    return DimensionScore(
        dimension="completeness",
        score=round(raw_score, 2),
        weight=weight,
        weighted_score=round(raw_score * weight, 2),
        details={
            "filled": filled,
            "required": total,
            "missing_fields": [f for f in required_fields if not record.get(f)],
        },
    )


def score_accuracy(
    record: Dict[str, Any],
    asset_class: str,
    historical_values: Optional[Dict[str, List[float]]] = None,
    config: Optional[Dict[str, Any]] = None,
) -> DimensionScore:
    """
    ACCURACY (25 %)
    Two checks:
      1. Hard-range validation from config (immediate fail if outside).
      2. IQR outlier detection on historical data when available.
    Score = 100 − outlier_penalty
    """
    cfg = config or _config
    accuracy_cfg = cfg.get("accuracy", {})
    param_ranges = accuracy_cfg.get("parameter_ranges", {}).get(asset_class, {})
    iqr_multiplier: float = accuracy_cfg.get("iqr_multiplier", 1.5)
    penalty_per_outlier: float = accuracy_cfg.get("penalty_per_outlier", 25)
    max_penalty: float = accuracy_cfg.get("max_penalty", 100)

    total_penalty = 0.0
    outlier_details: List[Dict[str, Any]] = []

    for param, bounds in param_ranges.items():
        value = record.get(param)
        if value is None:
            continue

        # 1. Hard-range check
        lo = bounds.get("min")
        hi = bounds.get("max")
        if lo is not None and value < lo:
            total_penalty += penalty_per_outlier
            outlier_details.append(
                {"field": param, "value": value, "reason": f"below min ({lo})"}
            )
            continue
        if hi is not None and value > hi:
            total_penalty += penalty_per_outlier
            outlier_details.append(
                {"field": param, "value": value, "reason": f"above max ({hi})"}
            )
            continue

        # 2. IQR outlier check on history
        if historical_values and param in historical_values:
            hist = sorted(historical_values[param])
            if len(hist) >= 4:
                q1 = hist[len(hist) // 4]
                q3 = hist[3 * len(hist) // 4]
                iqr = q3 - q1
                lower_fence = q1 - iqr_multiplier * iqr
                upper_fence = q3 + iqr_multiplier * iqr
                if value < lower_fence or value > upper_fence:
                    total_penalty += penalty_per_outlier
                    outlier_details.append(
                        {
                            "field": param,
                            "value": value,
                            "reason": f"IQR outlier (fence {lower_fence:.2f}–{upper_fence:.2f})",
                        }
                    )

    total_penalty = min(total_penalty, max_penalty)
    raw_score = max(0.0, 100.0 - total_penalty)
    weight = cfg["weights"]["accuracy"]

    return DimensionScore(
        dimension="accuracy",
        score=round(raw_score, 2),
        weight=weight,
        weighted_score=round(raw_score * weight, 2),
        details={"outliers": outlier_details, "total_penalty": total_penalty},
    )


def score_timeliness(
    last_sync_at: Optional[datetime],
    source_type: str,
    config: Optional[Dict[str, Any]] = None,
) -> DimensionScore:
    """
    TIMELINESS (25 %)
    Score = max(0, 100 − ((age − expected) / expected × 50))
    """
    cfg = config or _config
    timeliness_cfg = cfg.get("timeliness", {})
    intervals = timeliness_cfg.get("expected_intervals_seconds", {})
    expected = intervals.get(source_type, timeliness_cfg.get("default_interval_seconds", 86400))

    now = datetime.now(tz=timezone.utc)

    if last_sync_at is None:
        # Never synced → worst score
        raw_score = 0.0
        age_seconds = float("inf")
    else:
        # Ensure timezone-aware comparison
        if last_sync_at.tzinfo is None:
            last_sync_at = last_sync_at.replace(tzinfo=timezone.utc)
        age_seconds = (now - last_sync_at).total_seconds()

        if age_seconds <= expected:
            raw_score = 100.0
        else:
            raw_score = max(0.0, 100.0 - ((age_seconds - expected) / expected * 50))

    weight = cfg["weights"]["timeliness"]

    return DimensionScore(
        dimension="timeliness",
        score=round(raw_score, 2),
        weight=weight,
        weighted_score=round(raw_score * weight, 2),
        details={
            "age_seconds": age_seconds if age_seconds != float("inf") else None,
            "expected_seconds": expected,
            "source_type": source_type,
        },
    )


def score_consistency(
    consistent_refs: int,
    total_refs: int,
    config: Optional[Dict[str, Any]] = None,
) -> DimensionScore:
    """
    CONSISTENCY (25 %)
    Score = (consistent_refs / total_refs) × 100
    """
    cfg = config or _config
    weight = cfg["weights"]["consistency"]

    if total_refs == 0:
        raw_score = 100.0  # nothing to check → assume consistent
    else:
        raw_score = (consistent_refs / total_refs) * 100.0

    return DimensionScore(
        dimension="consistency",
        score=round(raw_score, 2),
        weight=weight,
        weighted_score=round(raw_score * weight, 2),
        details={"consistent_refs": consistent_refs, "total_refs": total_refs},
    )


# ── Composite scoring ──────────────────────────────────────────

def compute_dqs(
    asset_id: UUID,
    record: Dict[str, Any],
    record_type: str,
    asset_class: str,
    last_sync_at: Optional[datetime],
    source_type: str,
    consistent_refs: int,
    total_refs: int,
    historical_values: Optional[Dict[str, List[float]]] = None,
    source_id: Optional[UUID] = None,
    config: Optional[Dict[str, Any]] = None,
) -> DQSResult:
    """Compute the full four-dimension DQS for a single record."""
    cfg = config or _config

    dims: List[DimensionScore] = [
        score_completeness(record, record_type, cfg),
        score_accuracy(record, asset_class, historical_values, cfg),
        score_timeliness(last_sync_at, source_type, cfg),
        score_consistency(consistent_refs, total_refs, cfg),
    ]

    composite = sum(d.weighted_score for d in dims)
    composite = round(min(100.0, max(0.0, composite)), 2)

    # AI confidence modifier
    threshold = cfg.get("ai_confidence_penalty", {}).get("threshold", 60)
    if composite < threshold:
        modifier = 1.0 - (threshold - composite) / 100.0
    else:
        modifier = 1.0

    return DQSResult(
        asset_id=asset_id,
        record_type=record_type,
        composite_score=composite,
        dimensions=dims,
        ai_confidence_modifier=round(modifier, 4),
        scored_at=datetime.now(tz=timezone.utc),
        source_id=source_id,
    )


# ── AI confidence propagation ──────────────────────────────────

def adjust_ai_confidence(
    original_confidence: float,
    dqs_result: DQSResult,
) -> AIConfidenceAdjustment:
    """Apply the DQS-driven penalty to any AI confidence value.

    Critical rule:
        When DQS < 60, reduce AI confidence by (60 − DQS) %.
    """
    adjusted = original_confidence * dqs_result.ai_confidence_modifier
    penalty = original_confidence - adjusted

    return AIConfidenceAdjustment(
        original_confidence=round(original_confidence, 4),
        dqs_score=dqs_result.composite_score,
        adjusted_confidence=round(adjusted, 4),
        penalty_applied=round(penalty, 4),
        asset_id=dqs_result.asset_id,
    )


# ── System-wide summary builder ────────────────────────────────

def build_system_summary(results: List[DQSResult]) -> SystemDQSSummary:
    """Aggregate individual DQS results into a system-wide summary."""
    if not results:
        return SystemDQSSummary(
            total_assets_scored=0,
            average_composite=0.0,
            dimension_averages={},
            below_threshold_count=0,
            distribution={"excellent": 0, "good": 0, "fair": 0, "poor": 0},
            scored_at=datetime.now(tz=timezone.utc),
        )

    composites = [r.composite_score for r in results]
    avg_composite = statistics.mean(composites)

    # Dimension averages
    dim_names = {d.dimension for r in results for d in r.dimensions}
    dim_avgs: Dict[str, float] = {}
    for name in dim_names:
        values = [
            d.score for r in results for d in r.dimensions if d.dimension == name
        ]
        dim_avgs[name] = round(statistics.mean(values), 2) if values else 0.0

    threshold = _config.get("ai_confidence_penalty", {}).get("threshold", 60)
    below = sum(1 for c in composites if c < threshold)

    dist = {"excellent": 0, "good": 0, "fair": 0, "poor": 0}
    for c in composites:
        if c >= 90:
            dist["excellent"] += 1
        elif c >= 75:
            dist["good"] += 1
        elif c >= 60:
            dist["fair"] += 1
        else:
            dist["poor"] += 1

    return SystemDQSSummary(
        total_assets_scored=len(results),
        average_composite=round(avg_composite, 2),
        dimension_averages=dim_avgs,
        below_threshold_count=below,
        distribution=dist,
        scored_at=datetime.now(tz=timezone.utc),
    )
