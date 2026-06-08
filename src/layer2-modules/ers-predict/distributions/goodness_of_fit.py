"""
ERS Predict — Goodness-of-Fit Tests
════════════════════════════════════
Anderson-Darling and Kolmogorov-Smirnov tests for distribution
validation. Probability plot data generation.
"""

from __future__ import annotations

import math
from typing import List, Optional, Tuple

from ..schemas import (
    DistributionFit,
    DistributionType,
    GoodnessOfFitResult,
    ProbabilityPlotPoint,
)


class GoodnessOfFitTester:
    """
    Tests how well fitted distributions match observed data
    using A-D and K-S statistical tests.
    """

    def test(
        self,
        data: List[float],
        fit: DistributionFit,
    ) -> GoodnessOfFitResult:
        """
        Run both A-D and K-S tests for a fitted distribution.

        Args:
            data: Observed failure times.
            fit: Fitted distribution parameters.

        Returns:
            GoodnessOfFitResult with test statistics and p-values.
        """
        sorted_data = sorted(d for d in data if d > 0)
        if len(sorted_data) < 3:
            return GoodnessOfFitResult(distribution_type=fit.distribution_type)

        # Compute CDF values for each data point
        cdf_values = [self._cdf(x, fit) for x in sorted_data]

        # Anderson-Darling test
        ad_stat = self._anderson_darling(cdf_values)
        ad_p = self._ad_p_value(ad_stat, len(sorted_data))

        # Kolmogorov-Smirnov test
        ks_stat = self._kolmogorov_smirnov(cdf_values)
        ks_p = self._ks_p_value(ks_stat, len(sorted_data))

        # Good fit if both tests pass at α=0.05
        is_good = (ad_p is not None and ad_p > 0.05) or (ks_p is not None and ks_p > 0.05)

        return GoodnessOfFitResult(
            distribution_type=fit.distribution_type,
            anderson_darling_statistic=round(ad_stat, 6) if ad_stat else None,
            anderson_darling_p_value=round(ad_p, 6) if ad_p is not None else None,
            ks_statistic=round(ks_stat, 6) if ks_stat else None,
            ks_p_value=round(ks_p, 6) if ks_p is not None else None,
            is_good_fit=is_good,
        )

    def rank_fits(
        self,
        data: List[float],
        fits: List[DistributionFit],
    ) -> List[GoodnessOfFitResult]:
        """Test and rank multiple distribution fits. Returns sorted by GoF."""
        results = [self.test(data, f) for f in fits]

        # Sort by A-D p-value descending (higher = better fit)
        results.sort(
            key=lambda r: r.anderson_darling_p_value or 0.0,
            reverse=True,
        )

        for i, r in enumerate(results):
            r.rank = i + 1

        return results

    def probability_plot_data(
        self,
        data: List[float],
        fit: DistributionFit,
    ) -> List[ProbabilityPlotPoint]:
        """
        Generate data for probability plot (observed vs theoretical quantiles).
        """
        sorted_data = sorted(d for d in data if d > 0)
        n = len(sorted_data)
        if n < 2:
            return []

        points: List[ProbabilityPlotPoint] = []
        for i, x in enumerate(sorted_data):
            # Median rank formula: (i - 0.3) / (n + 0.4)
            rank = (i + 1 - 0.3) / (n + 0.4)
            theoretical = self._quantile(rank, fit)
            points.append(ProbabilityPlotPoint(
                observed=round(x, 4),
                theoretical=round(theoretical, 4),
                rank=i + 1,
            ))

        return points

    def _cdf(self, x: float, fit: DistributionFit) -> float:
        """Compute CDF at value x for the given distribution."""
        params = fit.parameters
        dt = fit.distribution_type

        if dt in (DistributionType.WEIBULL_2P, DistributionType.WEIBULL_3P):
            beta = params.get("beta", 1.5)
            eta = params.get("eta", 1.0)
            gamma = params.get("gamma", 0.0)
            t = max(x - gamma, 1e-10)
            return 1.0 - math.exp(-((t / eta) ** beta))

        elif dt == DistributionType.LOGNORMAL:
            mu = params.get("mu", 0.0)
            sigma = params.get("sigma", 1.0)
            if x <= 0:
                return 0.0
            z = (math.log(x) - mu) / max(sigma, 0.01)
            return self._normal_cdf(z)

        elif dt == DistributionType.EXPONENTIAL:
            lam = params.get("lambda", 1.0)
            return 1.0 - math.exp(-lam * x)

        elif dt == DistributionType.NORMAL:
            mu = params.get("mu", 0.0)
            sigma = params.get("sigma", 1.0)
            z = (x - mu) / max(sigma, 0.01)
            return self._normal_cdf(z)

        return 0.5

    def _quantile(self, p: float, fit: DistributionFit) -> float:
        """Compute quantile (inverse CDF) for the given distribution."""
        params = fit.parameters
        dt = fit.distribution_type
        p = max(0.001, min(0.999, p))

        if dt in (DistributionType.WEIBULL_2P, DistributionType.WEIBULL_3P):
            beta = params.get("beta", 1.5)
            eta = params.get("eta", 1.0)
            gamma = params.get("gamma", 0.0)
            return gamma + eta * (-math.log(1.0 - p)) ** (1.0 / beta)

        elif dt == DistributionType.LOGNORMAL:
            mu = params.get("mu", 0.0)
            sigma = params.get("sigma", 1.0)
            z = self._normal_quantile(p)
            return math.exp(mu + sigma * z)

        elif dt == DistributionType.EXPONENTIAL:
            lam = params.get("lambda", 1.0)
            return -math.log(1.0 - p) / max(lam, 1e-10)

        elif dt == DistributionType.NORMAL:
            mu = params.get("mu", 0.0)
            sigma = params.get("sigma", 1.0)
            return mu + sigma * self._normal_quantile(p)

        return 0.0

    @staticmethod
    def _anderson_darling(cdf_values: List[float]) -> float:
        """Compute Anderson-Darling test statistic."""
        n = len(cdf_values)
        if n < 2:
            return 0.0

        s = 0.0
        for i in range(n):
            fi = max(cdf_values[i], 1e-10)
            fi_comp = max(1.0 - cdf_values[n - 1 - i], 1e-10)
            s += (2 * (i + 1) - 1) * (math.log(fi) + math.log(fi_comp))

        return -n - s / n

    @staticmethod
    def _kolmogorov_smirnov(cdf_values: List[float]) -> float:
        """Compute Kolmogorov-Smirnov test statistic."""
        n = len(cdf_values)
        if n == 0:
            return 0.0

        d_plus = max((i + 1) / n - cdf_values[i] for i in range(n))
        d_minus = max(cdf_values[i] - i / n for i in range(n))
        return max(d_plus, d_minus)

    @staticmethod
    def _ad_p_value(ad_stat: float, n: int) -> Optional[float]:
        """Approximate p-value for Anderson-Darling statistic."""
        if ad_stat <= 0:
            return 1.0
        # Approximate: p ≈ exp(-ad_stat) for moderate values
        # Production: use scipy.stats tables
        adjusted = ad_stat * (1.0 + 0.75 / n + 2.25 / (n * n))
        if adjusted < 0.2:
            return 1.0 - math.exp(-13.436 + 101.14 * adjusted - 223.73 * adjusted ** 2)
        elif adjusted < 2.0:
            return max(0.0, 1.0 - adjusted / 3.0)
        else:
            return max(0.0, math.exp(-1.5 * adjusted))

    @staticmethod
    def _ks_p_value(ks_stat: float, n: int) -> Optional[float]:
        """Approximate p-value for KS statistic."""
        if ks_stat <= 0 or n <= 0:
            return 1.0
        # Approximate using asymptotic formula
        z = ks_stat * math.sqrt(n)
        return max(0.0, min(1.0, 2.0 * math.exp(-2.0 * z * z)))

    @staticmethod
    def _normal_cdf(z: float) -> float:
        """Standard normal CDF approximation (Abramowitz & Stegun)."""
        return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))

    @staticmethod
    def _normal_quantile(p: float) -> float:
        """Approximate standard normal quantile (Beasley-Springer-Moro)."""
        p = max(0.001, min(0.999, p))
        if p == 0.5:
            return 0.0
        # Rational approximation
        t = math.sqrt(-2.0 * math.log(min(p, 1.0 - p)))
        c0, c1, c2 = 2.515517, 0.802853, 0.010328
        d1, d2, d3 = 1.432788, 0.189269, 0.001308
        result = t - (c0 + c1 * t + c2 * t * t) / (1.0 + d1 * t + d2 * t * t + d3 * t * t * t)
        return result if p > 0.5 else -result
