"""
ERS Predict — Weibull Survival Model
═════════════════════════════════════
Time-to-failure estimation using Weibull survival analysis.
Supports right-censored data and parametric survival curves.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..schemas import FeatureVector
from .base import BasePredictionModel


class WeibullSurvivalModel(BasePredictionModel):
    """
    Parametric survival model using Weibull distribution for
    time-to-failure estimation.

    Key parameters:
        beta (shape): β < 1 = infant mortality, β = 1 = random, β > 1 = wear-out
        eta (scale): Characteristic life (63.2% failure probability)

    Production: Enhance with lifelines or reliability libraries.
    """

    def __init__(self, asset_class: str, model_version: int = 1):
        super().__init__(asset_class, model_version)
        # Default Weibull params (wear-out failure pattern)
        self.beta: float = 2.5   # shape
        self.eta: float = 5000.0  # scale (hours)
        self.gamma: float = 0.0  # location (3P Weibull)

    def get_name(self) -> str:
        return "weibull_survival"

    def train(
        self,
        features: List[FeatureVector],
        targets: List[float],
        **kwargs: Any,
    ) -> Dict[str, float]:
        """
        Fit Weibull parameters from failure time data.

        Args:
            features: Feature vectors (used for operating hours context).
            targets: Time-to-failure values in hours (0 = censored/no failure).
        """
        self.training_samples = len(targets)
        self.is_trained = True
        self.trained_at = datetime.now(tz=timezone.utc)

        # Filter actual failure times (non-zero = observed failures)
        failure_times = [t for t in targets if t > 0]

        if len(failure_times) >= 3:
            # MLE estimation of Weibull parameters (simplified)
            self.beta, self.eta = self._mle_weibull(failure_times)
        elif failure_times:
            # Too few data points — use median-based estimation
            failure_times.sort()
            median_ttf = failure_times[len(failure_times) // 2]
            self.eta = median_ttf / (math.log(2) ** (1.0 / self.beta))

        self.accuracy_metrics = {
            "beta": self.beta,
            "eta": self.eta,
            "failure_count": float(len(failure_times)),
            "censored_count": float(len(targets) - len(failure_times)),
            "training_samples": float(self.training_samples),
        }
        return self.accuracy_metrics

    def predict(
        self,
        features: FeatureVector,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """
        Predict remaining useful life from current operating hours.

        Returns:
            value: RUL in days
            confidence: Based on parameter uncertainty
            metadata: Distribution params, survival probability
        """
        # Current operating hours from context
        current_hours = 0.0
        if features.operational:
            current_hours = features.operational.running_hours

        # Survival function: R(t) = exp(-((t-gamma)/eta)^beta)
        t = max(current_hours - self.gamma, 0.01)
        survival_prob = self._survival(t)

        # Conditional RUL: E[T-t | T>t]
        rul_hours = self._conditional_rul(t)
        rul_days = rul_hours / 24.0

        # Confidence bands
        rul_50_lower = rul_hours * 0.7 / 24.0
        rul_50_upper = rul_hours * 1.3 / 24.0
        rul_80_lower = rul_hours * 0.5 / 24.0
        rul_80_upper = rul_hours * 1.6 / 24.0
        rul_95_lower = rul_hours * 0.3 / 24.0
        rul_95_upper = rul_hours * 2.0 / 24.0

        # Confidence based on survival probability and data availability
        confidence = 0.5
        if self.is_trained and self.training_samples > 10:
            confidence = 0.7
        if self.training_samples > 50:
            confidence += 0.15
        confidence = min(0.95, confidence)

        return {
            "value": round(rul_days, 2),
            "confidence": round(confidence, 4),
            "metadata": {
                "beta": self.beta,
                "eta": self.eta,
                "gamma": self.gamma,
                "current_hours": current_hours,
                "survival_probability": round(survival_prob, 4),
                "failure_probability": round(1.0 - survival_prob, 4),
                "confidence_bands": {
                    "50": [round(rul_50_lower, 1), round(rul_50_upper, 1)],
                    "80": [round(rul_80_lower, 1), round(rul_80_upper, 1)],
                    "95": [round(rul_95_lower, 1), round(rul_95_upper, 1)],
                },
                "model": self.get_name(),
            },
        }

    def _survival(self, t: float) -> float:
        """Weibull survival function R(t)."""
        if t <= 0 or self.eta <= 0:
            return 1.0
        return math.exp(-((t / self.eta) ** self.beta))

    def _hazard(self, t: float) -> float:
        """Weibull hazard function h(t) = (beta/eta) * (t/eta)^(beta-1)."""
        if t <= 0 or self.eta <= 0:
            return 0.0
        return (self.beta / self.eta) * ((t / self.eta) ** (self.beta - 1))

    def _conditional_rul(self, current_t: float, steps: int = 100) -> float:
        """
        Estimate conditional RUL: E[T-t | T>t] using numerical integration.
        """
        r_current = self._survival(current_t)
        if r_current <= 0.001:
            return 0.0

        # Integrate survival function from current_t to a reasonable horizon
        max_horizon = self.eta * 3.0
        dt = (max_horizon - current_t) / steps

        integral = 0.0
        for i in range(steps):
            t_i = current_t + (i + 0.5) * dt
            integral += self._survival(t_i) * dt

        return integral / r_current

    @staticmethod
    def _mle_weibull(failure_times: List[float]) -> tuple[float, float]:
        """
        Simplified MLE for Weibull 2P parameters.
        Production: Use scipy.stats.weibull_min.fit() or reliability library.
        """
        n = len(failure_times)
        if n < 2:
            return 2.5, sum(failure_times) / max(n, 1)

        # Initial beta estimate using median rank regression
        sorted_times = sorted(failure_times)
        ln_times = [math.log(max(t, 0.01)) for t in sorted_times]

        # Simple method of moments approximation
        mean_ln = sum(ln_times) / n
        var_ln = sum((x - mean_ln) ** 2 for x in ln_times) / max(n - 1, 1)
        std_ln = math.sqrt(var_ln) if var_ln > 0 else 1.0

        # Beta ≈ pi / (sqrt(6) * std(ln(t)))
        beta = math.pi / (math.sqrt(6.0) * max(std_ln, 0.01))
        beta = max(0.5, min(beta, 10.0))  # clamp

        # Eta from beta
        eta = math.exp(mean_ln + 0.5772 / beta)  # Euler-Mascheroni constant
        eta = max(eta, 1.0)

        return round(beta, 4), round(eta, 2)
