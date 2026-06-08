"""
ERS Predict — P-F Interval Calculator
══════════════════════════════════════
Potential-failure to functional-failure interval analysis.
RUL with confidence bands at 50%, 80%, 95%.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from ..schemas import (
    ConfidenceBand,
    DistributionFit,
    DistributionType,
    PFIntervalResult,
)


class PFIntervalCalculator:
    """
    Calculates the P-F interval (time between detectable potential
    failure and functional failure) and optimal inspection interval.

    P-F Interval Theory (RCM):
        - P = Potential failure point (first detectable symptom)
        - F = Functional failure point (loss of function)
        - Inspection interval = P-F / 2 (or P-F / 3 for safety-critical)
    """

    def calculate(
        self,
        asset_id: UUID,
        failure_mode: str,
        distribution: DistributionFit,
        current_age_hours: float = 0.0,
        detection_threshold_pct: float = 10.0,
        is_safety_critical: bool = False,
    ) -> PFIntervalResult:
        """
        Calculate P-F interval and RUL from a failure distribution.

        Args:
            asset_id: Asset identifier.
            failure_mode: Failure mode name.
            distribution: Fitted failure distribution.
            current_age_hours: Current asset age/running hours.
            detection_threshold_pct: Cumulative failure probability at which
                potential failure becomes detectable (default 10%).
            is_safety_critical: If True, use P-F/3 instead of P-F/2.

        Returns:
            PFIntervalResult with P-F interval, optimal inspection,
            RUL, and confidence bands.
        """
        # Calculate P point (time at detection threshold)
        p_quantile = detection_threshold_pct / 100.0
        t_p = self._quantile(p_quantile, distribution)

        # Calculate F point (time at 63.2% failure for Weibull = eta)
        t_f = self._quantile(0.632, distribution)

        # P-F interval in hours, convert to days
        pf_interval_hours = max(t_f - t_p, 0.0)
        pf_interval_days = pf_interval_hours / 24.0

        # Optimal inspection interval
        divisor = 3.0 if is_safety_critical else 2.0
        optimal_interval = pf_interval_days / divisor

        # Current position on P-F curve (0% = healthy, 100% = failure)
        current_cdf = self._cdf(current_age_hours, distribution)
        position_pct = current_cdf * 100.0

        # RUL: time from current age to F point
        rul_hours = max(t_f - current_age_hours, 0.0)
        rul_days = rul_hours / 24.0

        # Confidence bands via quantile spread
        confidence_bands = self._compute_confidence_bands(
            current_age_hours, distribution
        )

        return PFIntervalResult(
            asset_id=asset_id,
            failure_mode=failure_mode,
            pf_interval_days=round(pf_interval_days, 2),
            optimal_inspection_interval=round(optimal_interval, 2),
            current_position_pct=round(position_pct, 2),
            rul_days=round(rul_days, 2),
            confidence_bands=confidence_bands,
            distribution_fit=distribution,
        )

    def _compute_confidence_bands(
        self,
        current_age_hours: float,
        distribution: DistributionFit,
    ) -> List[ConfidenceBand]:
        """Compute RUL confidence bands at 50%, 80%, 95%."""
        bands: List[ConfidenceBand] = []

        for pct, (lo_q, hi_q) in [
            (50, (0.25, 0.75)),
            (80, (0.10, 0.90)),
            (95, (0.025, 0.975)),
        ]:
            t_lo = self._quantile(hi_q, distribution)  # higher quantile = more time
            t_hi = self._quantile(lo_q, distribution)  # lower quantile = less time

            # RUL = remaining time from current
            rul_lo = max(t_hi - current_age_hours, 0.0) / 24.0
            rul_hi = max(t_lo - current_age_hours, 0.0) / 24.0
            rul_median = (rul_lo + rul_hi) / 2.0

            bands.append(ConfidenceBand(
                percentile=pct,
                lower_days=round(rul_lo, 2),
                upper_days=round(rul_hi, 2),
                median_days=round(rul_median, 2),
            ))

        return bands

    @staticmethod
    def _cdf(x: float, fit: DistributionFit) -> float:
        """CDF for supported distributions."""
        params = fit.parameters
        dt = fit.distribution_type

        if dt in (DistributionType.WEIBULL_2P, DistributionType.WEIBULL_3P):
            beta = params.get("beta", 1.5)
            eta = params.get("eta", 1.0)
            gamma = params.get("gamma", 0.0)
            t = max(x - gamma, 1e-10)
            return 1.0 - math.exp(-((t / eta) ** beta))

        elif dt == DistributionType.EXPONENTIAL:
            lam = params.get("lambda", 1.0)
            return 1.0 - math.exp(-lam * max(x, 0.0))

        elif dt == DistributionType.LOGNORMAL:
            mu = params.get("mu", 0.0)
            sigma = params.get("sigma", 1.0)
            if x <= 0:
                return 0.0
            z = (math.log(x) - mu) / max(sigma, 0.01)
            return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))

        elif dt == DistributionType.NORMAL:
            mu = params.get("mu", 0.0)
            sigma = params.get("sigma", 1.0)
            z = (x - mu) / max(sigma, 0.01)
            return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))

        return 0.5

    @staticmethod
    def _quantile(p: float, fit: DistributionFit) -> float:
        """Inverse CDF for supported distributions."""
        params = fit.parameters
        dt = fit.distribution_type
        p = max(0.001, min(0.999, p))

        if dt in (DistributionType.WEIBULL_2P, DistributionType.WEIBULL_3P):
            beta = params.get("beta", 1.5)
            eta = params.get("eta", 1.0)
            gamma = params.get("gamma", 0.0)
            return gamma + eta * (-math.log(1.0 - p)) ** (1.0 / beta)

        elif dt == DistributionType.EXPONENTIAL:
            lam = params.get("lambda", 1.0)
            return -math.log(1.0 - p) / max(lam, 1e-10)

        elif dt == DistributionType.LOGNORMAL:
            mu = params.get("mu", 0.0)
            sigma = params.get("sigma", 1.0)
            # Approximate inverse normal
            t = math.sqrt(-2.0 * math.log(min(p, 1.0 - p)))
            c0, c1, c2 = 2.515517, 0.802853, 0.010328
            d1, d2, d3 = 1.432788, 0.189269, 0.001308
            z = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t)
            if p < 0.5:
                z = -z
            return math.exp(mu + sigma * z)

        elif dt == DistributionType.NORMAL:
            mu = params.get("mu", 0.0)
            sigma = params.get("sigma", 1.0)
            t = math.sqrt(-2.0 * math.log(min(p, 1.0 - p)))
            c0, c1, c2 = 2.515517, 0.802853, 0.010328
            d1, d2, d3 = 1.432788, 0.189269, 0.001308
            z = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t)
            if p < 0.5:
                z = -z
            return mu + sigma * z

        return 0.0
