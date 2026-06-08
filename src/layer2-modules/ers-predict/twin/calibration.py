"""
ERS Predict — Twin Calibration Engine
══════════════════════════════════════
Auto-recalibrates digital twins when new failure/inspection/CM
data arrives. Tracks calibration drift and quality.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from ..schemas import CalibrationReport

logger = logging.getLogger("ers.predict.calibration")

# Thresholds for calibration alerts
DRIFT_WARNING_THRESHOLD = 10.0   # health index points
DRIFT_CRITICAL_THRESHOLD = 20.0
RECALIBRATION_INTERVAL_DAYS = 30


class CalibrationEngine:
    """
    Manages calibration of digital twins by comparing predicted
    health with actual observations (inspections, failures, CM data).

    Tracks:
        - Calibration quality score (0-100)
        - Drift (predicted vs actual divergence)
        - Recalibration triggers
    """

    def __init__(self):
        # Asset ID → calibration history
        self.calibration_history: Dict[UUID, List[Dict[str, Any]]] = {}

    def check_calibration(
        self,
        twin_id: UUID,
        asset_id: UUID,
        predicted_health: float,
        actual_health: float,
        observation_time: datetime | None = None,
    ) -> CalibrationReport:
        """
        Check calibration by comparing prediction against actual observation.

        Args:
            twin_id: The digital twin identifier.
            asset_id: The asset identifier.
            predicted_health: Twin's predicted health index.
            actual_health: Observed actual health (from inspection, etc.).
            observation_time: When the observation was made.

        Returns:
            CalibrationReport with quality score and drift.
        """
        now = observation_time or datetime.now(tz=timezone.utc)
        drift = abs(predicted_health - actual_health)

        # Record observation
        history = self.calibration_history.setdefault(asset_id, [])
        history.append({
            "time": now,
            "predicted": predicted_health,
            "actual": actual_health,
            "drift": drift,
        })

        # Compute calibration quality from recent history
        recent = history[-20:]  # last 20 observations
        drifts = [h["drift"] for h in recent]
        mean_drift = sum(drifts) / max(len(drifts), 1)

        # Quality score: 100 at 0 drift, 0 at 50+ drift
        quality = max(0.0, 100.0 - mean_drift * 2.0)

        # Check if recalibration needed
        needs_recal = False
        reason = None

        if mean_drift > DRIFT_CRITICAL_THRESHOLD:
            needs_recal = True
            reason = f"Critical drift ({mean_drift:.1f} points) — twin significantly diverges from reality"
            logger.warning("Twin %s: CRITICAL calibration drift %.1f", twin_id, mean_drift)
        elif mean_drift > DRIFT_WARNING_THRESHOLD:
            needs_recal = True
            reason = f"Warning drift ({mean_drift:.1f} points) — recalibration recommended"
            logger.info("Twin %s: calibration drift warning %.1f", twin_id, mean_drift)
        elif len(history) > 0:
            # Check staleness
            last_time = history[-1]["time"]
            days_since = (now - last_time).total_seconds() / 86400
            if days_since > RECALIBRATION_INTERVAL_DAYS:
                needs_recal = True
                reason = f"Stale calibration ({days_since:.0f} days since last check)"

        # Data points since last calibration
        data_points = len(recent)

        return CalibrationReport(
            twin_id=twin_id,
            asset_id=asset_id,
            calibration_quality=round(quality, 2),
            drift_score=round(mean_drift, 4),
            last_calibrated_at=now,
            data_points_since_calibration=data_points,
            needs_recalibration=needs_recal,
            recalibration_reason=reason,
        )

    def auto_recalibrate(
        self,
        twin_id: UUID,
        asset_id: UUID,
        predicted_values: List[float],
        actual_values: List[float],
    ) -> Dict[str, float]:
        """
        Compute recalibration adjustment factors.

        Returns correction factors to apply to the twin's models:
            - bias_correction: additive offset
            - scale_correction: multiplicative factor
            - trend_correction: slope adjustment
        """
        if not predicted_values or not actual_values:
            return {"bias_correction": 0.0, "scale_correction": 1.0, "trend_correction": 0.0}

        n = min(len(predicted_values), len(actual_values))
        preds = predicted_values[:n]
        actuals = actual_values[:n]

        # Bias: mean difference
        errors = [a - p for p, a in zip(preds, actuals)]
        bias = sum(errors) / n

        # Scale: ratio of std devs
        pred_mean = sum(preds) / n
        act_mean = sum(actuals) / n
        pred_std = (sum((p - pred_mean) ** 2 for p in preds) / max(n - 1, 1)) ** 0.5
        act_std = (sum((a - act_mean) ** 2 for a in actuals) / max(n - 1, 1)) ** 0.5
        scale = act_std / max(pred_std, 0.01) if pred_std > 0 else 1.0

        # Trend: difference in slopes
        if n >= 3:
            pred_slope = (preds[-1] - preds[0]) / max(n - 1, 1)
            act_slope = (actuals[-1] - actuals[0]) / max(n - 1, 1)
            trend = act_slope - pred_slope
        else:
            trend = 0.0

        corrections = {
            "bias_correction": round(bias, 4),
            "scale_correction": round(max(0.5, min(2.0, scale)), 4),
            "trend_correction": round(trend, 6),
        }

        logger.info(
            "Recalibrated twin %s (asset %s): bias=%.2f, scale=%.3f, trend=%.4f",
            twin_id, asset_id, bias, scale, trend,
        )

        return corrections

    def get_calibration_summary(
        self,
        asset_id: UUID,
    ) -> Dict[str, Any]:
        """Get calibration summary for an asset."""
        history = self.calibration_history.get(asset_id, [])
        if not history:
            return {"status": "uncalibrated", "data_points": 0}

        recent = history[-20:]
        drifts = [h["drift"] for h in recent]
        mean_drift = sum(drifts) / len(drifts)

        return {
            "status": "calibrated" if mean_drift < DRIFT_WARNING_THRESHOLD else "needs_recalibration",
            "data_points": len(history),
            "mean_drift": round(mean_drift, 2),
            "latest_drift": round(drifts[-1], 2) if drifts else 0.0,
            "quality_score": round(max(0.0, 100.0 - mean_drift * 2.0), 2),
            "last_checked": history[-1]["time"].isoformat() if history else None,
        }
