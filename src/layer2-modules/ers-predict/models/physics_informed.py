"""
ERS Predict — Physics-Informed Model
═════════════════════════════════════
OEM degradation curves combined with observed data adjustments.
Uses manufacturer specifications as baseline, refines with real data.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..schemas import FeatureVector
from .base import BasePredictionModel


# OEM spec curves by asset class (typical L10 life, design hours, etc.)
DEFAULT_OEM_SPECS: Dict[str, Dict[str, float]] = {
    "pump": {"design_life_hours": 40000, "rated_efficiency": 0.85, "degradation_rate": 0.002},
    "compressor": {"design_life_hours": 60000, "rated_efficiency": 0.90, "degradation_rate": 0.0015},
    "turbine": {"design_life_hours": 80000, "rated_efficiency": 0.92, "degradation_rate": 0.001},
    "motor": {"design_life_hours": 50000, "rated_efficiency": 0.88, "degradation_rate": 0.0018},
    "heat_exchanger": {"design_life_hours": 100000, "rated_efficiency": 0.80, "degradation_rate": 0.0008},
    "valve": {"design_life_hours": 30000, "rated_efficiency": 1.0, "degradation_rate": 0.003},
    "bearing": {"design_life_hours": 25000, "rated_efficiency": 1.0, "degradation_rate": 0.004},
    "default": {"design_life_hours": 40000, "rated_efficiency": 0.85, "degradation_rate": 0.002},
}


class PhysicsInformedModel(BasePredictionModel):
    """
    Physics-informed degradation model using OEM specifications
    combined with operating data adjustments.

    Degradation formula:
        D(t) = base_rate × load_factor^α × temp_factor^β × age_factor
    Health = 100 × (1 - D/D_failure)
    """

    def __init__(self, asset_class: str, model_version: int = 1):
        super().__init__(asset_class, model_version)
        specs = DEFAULT_OEM_SPECS.get(asset_class.lower(), DEFAULT_OEM_SPECS["default"])
        self.design_life = specs["design_life_hours"]
        self.base_degradation_rate = specs["degradation_rate"]
        self.rated_efficiency = specs["rated_efficiency"]

        # Calibration factors (learn from data)
        self.load_exponent: float = 2.0   # α: higher load → faster degradation
        self.temp_exponent: float = 1.5   # β: higher temp → faster degradation
        self.calibration_factor: float = 1.0  # overall correction from observed data

    def get_name(self) -> str:
        return "physics_informed"

    def train(
        self,
        features: List[FeatureVector],
        targets: List[float],
        **kwargs: Any,
    ) -> Dict[str, float]:
        """
        Calibrate physics model against observed degradation.

        Args:
            targets: Observed health index values at given operating hours.
        """
        self.training_samples = len(features)
        self.is_trained = True
        self.trained_at = datetime.now(tz=timezone.utc)

        if not features or not targets:
            self.accuracy_metrics = {"calibration_factor": 1.0, "training_samples": 0.0}
            return self.accuracy_metrics

        # Compare predicted vs observed health to calibrate
        errors: List[float] = []
        for fv, observed_health in zip(features, targets):
            predicted = self._raw_predict(fv)
            errors.append(observed_health - predicted)

        if errors:
            mean_error = sum(errors) / len(errors)
            # Adjust calibration factor to reduce systematic bias
            self.calibration_factor *= (1.0 + mean_error / 100.0)
            self.calibration_factor = max(0.5, min(2.0, self.calibration_factor))

        mae = sum(abs(e) for e in errors) / max(len(errors), 1)
        self.accuracy_metrics = {
            "mae": round(mae, 4),
            "calibration_factor": round(self.calibration_factor, 4),
            "training_samples": float(self.training_samples),
        }
        return self.accuracy_metrics

    def predict(
        self,
        features: FeatureVector,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """
        Predict health using physics-based degradation model.
        """
        health = self._raw_predict(features)

        # Confidence based on operating hours coverage
        operating_ratio = 0.0
        if features.operational:
            operating_ratio = features.operational.running_hours / self.design_life

        confidence = 0.6  # physics models have moderate baseline confidence
        if self.is_trained:
            confidence += 0.15
        if 0.1 < operating_ratio < 0.9:
            confidence += 0.1  # mid-life is most predictable

        return {
            "value": round(max(0.0, min(100.0, health)), 2),
            "confidence": round(min(confidence, 0.95), 4),
            "metadata": {
                "degradation_pct": round(100.0 - health, 2),
                "design_life_hours": self.design_life,
                "calibration_factor": self.calibration_factor,
                "operating_ratio": round(operating_ratio, 4),
                "model": self.get_name(),
            },
        }

    def _raw_predict(self, features: FeatureVector) -> float:
        """Core physics-based health calculation."""
        hours = 0.0
        load_factor = 1.0
        temp_factor = 1.0

        if features.operational:
            hours = features.operational.running_hours
            load_factor = max(features.operational.load_factor, 0.1)

            # Temperature acceleration factor (Arrhenius-like)
            temp_delta = features.operational.ambient_temp_delta
            if temp_delta > 0:
                temp_factor = 1.0 + temp_delta / 50.0
            else:
                temp_factor = max(0.5, 1.0 + temp_delta / 100.0)

        # Cumulative degradation
        effective_hours = hours * (load_factor ** self.load_exponent) * (temp_factor ** self.temp_exponent)
        degradation = self.base_degradation_rate * effective_hours * self.calibration_factor

        # Cap degradation at 100%
        degradation_pct = min(degradation * 100.0, 100.0)

        return 100.0 - degradation_pct
