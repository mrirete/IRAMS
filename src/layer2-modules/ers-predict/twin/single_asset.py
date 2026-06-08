"""
ERS Predict — Single Asset Digital Twin
═══════════════════════════════════════
Combines real-time sensor data, failure distribution parameters,
maintenance history, and operating context to continuously
simulate current reliability state and project health trajectory.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from ..schemas import (
    DegradationModelConfig,
    FeatureVector,
    GovernanceTier,
    OperationalContext,
    TwinHealthProjection,
    TwinState,
)


class AssetDigitalTwin:
    """
    Single asset digital twin maintaining a continuously-updated
    reliability state model.

    Combines:
        - Real-time sensor readings (current health snapshot)
        - Weibull failure distribution parameters (statistical RUL)
        - Maintenance history (PM effectiveness, reliability growth)
        - Operating context (load, temperature, running hours)
        - Degradation models (physics-informed wear/corrosion/fatigue)

    Outputs:
        - Current health index
        - Projected health trajectory with confidence bands
        - Calibration quality score
    """

    def __init__(
        self,
        asset_id: UUID,
        asset_class: str = "default",
        twin_id: UUID | None = None,
    ):
        self.asset_id = asset_id
        self.asset_class = asset_class
        self.twin_id = twin_id or uuid4()

        # State
        self.health_index: float = 100.0
        self.degradation_models: List[DegradationModelConfig] = []
        self.failure_distributions: Dict[str, Dict[str, float]] = {}
        self.sensor_summary: Dict[str, float] = {}
        self.operating_context: Optional[OperationalContext] = None

        # Calibration tracking
        self.last_calibrated_at: Optional[datetime] = None
        self.calibration_quality: float = 100.0
        self.calibration_drift: float = 0.0
        self._predicted_history: List[tuple[datetime, float]] = []
        self._actual_history: List[tuple[datetime, float]] = []

    def update_from_features(self, features: FeatureVector) -> TwinState:
        """
        Update twin state from a fresh feature vector.

        This is the primary entry point — called whenever new
        sensor data arrives.
        """
        now = datetime.now(tz=timezone.utc)

        # Update sensor summary
        for ts in features.time_series:
            w1h = next((w for w in ts.windows if w.window_name == "1h"), None)
            if w1h and w1h.sample_count > 0:
                self.sensor_summary[ts.tag] = w1h.mean

        # Update operating context
        self.operating_context = features.operational

        # Compute base health from feature vector
        base_health = self._compute_health_from_sensors(features)

        # Apply degradation model adjustments
        degradation_penalty = self._apply_degradation_models()

        # Blend: 60% sensor-driven, 40% degradation model
        self.health_index = max(
            0.0,
            min(100.0, base_health * 0.6 + (100.0 - degradation_penalty) * 0.4),
        )

        # Record for calibration tracking
        self._predicted_history.append((now, self.health_index))

        # Project future health
        projection = self._project_trajectory(now)

        return self.get_state()

    def update_from_inspection(
        self,
        actual_health: float,
        inspection_time: datetime | None = None,
    ) -> None:
        """
        Update twin with actual observed health (from inspection or failure).
        This is used for calibration.
        """
        now = inspection_time or datetime.now(tz=timezone.utc)
        self._actual_history.append((now, actual_health))

        # Recalibrate drift
        self._recalibrate()

    def set_degradation_models(
        self,
        models: List[DegradationModelConfig],
    ) -> None:
        """Set the degradation model configurations for this twin."""
        self.degradation_models = models

    def set_failure_distributions(
        self,
        distributions: Dict[str, Dict[str, float]],
    ) -> None:
        """Set failure distribution parameters (e.g., from Weibull fitting)."""
        self.failure_distributions = distributions

    def get_state(self) -> TwinState:
        """Return the current twin state as a schema."""
        now = datetime.now(tz=timezone.utc)
        projection = self._project_trajectory(now)

        return TwinState(
            asset_id=self.asset_id,
            twin_id=self.twin_id,
            health_index=round(self.health_index, 2),
            degradation_models=self.degradation_models,
            health_projection=projection,
            last_calibrated_at=self.last_calibrated_at,
            calibration_quality=round(self.calibration_quality, 2),
            calibration_drift=round(self.calibration_drift, 4),
            failure_distributions=self.failure_distributions,
            operating_context=self.operating_context,
            sensor_summary=self.sensor_summary,
            updated_at=now,
        )

    # ── Internal methods ──

    def _compute_health_from_sensors(self, features: FeatureVector) -> float:
        """Derive health index from sensor readings."""
        health = 100.0
        penalties = 0.0

        for ts in features.time_series:
            # Use 1h window for real-time health
            w1h = next((w for w in ts.windows if w.window_name == "1h"), None)
            if w1h and w1h.sample_count > 0:
                # High RMS indicates vibration/stress
                if w1h.rms > 5.0:
                    penalties += min((w1h.rms - 5.0) * 2.0, 20.0)
                # High std indicates instability
                if w1h.std > 3.0:
                    penalties += min((w1h.std - 3.0) * 1.5, 10.0)

        # Frequency features (vibration health)
        for ff in features.frequency:
            if ff.crest_factor > 5.0:
                penalties += min((ff.crest_factor - 5.0) * 4.0, 15.0)

        # Operating context
        if features.operational:
            ctx = features.operational
            if ctx.load_factor > 1.1:
                penalties += (ctx.load_factor - 1.1) * 10.0
            if ctx.hours_since_last_pm > 4000:
                penalties += min((ctx.hours_since_last_pm - 4000) / 500, 10.0)

        # Historical patterns
        if features.historical_patterns:
            best = max(features.historical_patterns, key=lambda p: p.similarity_score)
            if best.similarity_score > 0.8:
                penalties += best.similarity_score * 15.0

        return max(0.0, health - penalties)

    def _apply_degradation_models(self) -> float:
        """Sum degradation penalties from physics-informed models."""
        total_damage = 0.0
        for model in self.degradation_models:
            total_damage += model.current_damage_pct
        # Cap total damage at 100%
        return min(total_damage, 100.0)

    def _project_trajectory(
        self,
        now: datetime,
        horizon_days: int = 90,
        step_days: int = 7,
    ) -> List[TwinHealthProjection]:
        """Project health index forward with confidence bands."""
        # Estimate daily degradation rate from recent trend
        daily_rate = self._estimate_daily_degradation()

        projections: List[TwinHealthProjection] = []
        for d in range(step_days, horizon_days + 1, step_days):
            projected = self.health_index - (daily_rate * d)
            projected = max(0.0, min(100.0, projected))

            # Confidence bands widen with time
            uncertainty = d * 0.3  # grows linearly
            lower = max(0.0, projected - uncertainty)
            upper = min(100.0, projected + uncertainty)

            projections.append(TwinHealthProjection(
                days_ahead=d,
                health_index=round(projected, 2),
                confidence_lower=round(lower, 2),
                confidence_upper=round(upper, 2),
            ))

        return projections

    def _estimate_daily_degradation(self) -> float:
        """Estimate daily degradation rate from history or degradation models."""
        # From predicted history
        if len(self._predicted_history) >= 2:
            earliest = self._predicted_history[0]
            latest = self._predicted_history[-1]
            days = (latest[0] - earliest[0]).total_seconds() / 86400.0
            if days > 0:
                rate = (earliest[1] - latest[1]) / days
                return max(0.0, rate)

        # Fallback: estimate from degradation models
        if self.degradation_models:
            avg_damage_pct = sum(m.current_damage_pct for m in self.degradation_models) / len(self.degradation_models)
            # Assume remaining damage accrues over remaining design life
            return max(0.01, avg_damage_pct / 365.0)

        return 0.1  # default conservative degradation

    def _recalibrate(self) -> None:
        """Recalibrate twin against actual observations."""
        if not self._actual_history or not self._predicted_history:
            return

        # Find corresponding predictions for each actual reading
        errors: List[float] = []
        for actual_time, actual_val in self._actual_history[-10:]:
            # Find nearest predicted value
            nearest = min(
                self._predicted_history,
                key=lambda p: abs((p[0] - actual_time).total_seconds()),
            )
            pred_val = nearest[1]
            errors.append(abs(pred_val - actual_val))

        if errors:
            mean_error = sum(errors) / len(errors)
            self.calibration_drift = mean_error
            self.calibration_quality = max(0.0, 100.0 - mean_error * 2.0)
            self.last_calibrated_at = datetime.now(tz=timezone.utc)
