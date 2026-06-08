"""
ERS Predict — Distribution Fitters
═══════════════════════════════════
Failure distribution fitting: Weibull 2P/3P, lognormal,
exponential, normal, mixed Weibull. MLE-based estimation.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from ..schemas import DistributionFit, DistributionType


class DistributionFitter:
    """
    Fits failure time data to candidate distributions and returns
    fitted parameters with log-likelihood, AIC, and BIC.

    Usage:
        fitter = DistributionFitter()
        fits = fitter.fit_all(failure_times)
        best = fitter.best_fit(failure_times)
    """

    def fit_weibull_2p(self, data: List[float]) -> DistributionFit:
        """Fit 2-parameter Weibull: f(t) = (β/η)(t/η)^(β-1) exp(-(t/η)^β)."""
        data = [d for d in data if d > 0]
        if len(data) < 2:
            return DistributionFit(distribution_type=DistributionType.WEIBULL_2P)

        beta, eta = self._mle_weibull_2p(data)
        ll = self._weibull_log_likelihood(data, beta, eta)
        n = len(data)
        k = 2  # parameters
        aic = 2 * k - 2 * ll
        bic = k * math.log(n) - 2 * ll

        return DistributionFit(
            distribution_type=DistributionType.WEIBULL_2P,
            parameters={"beta": round(beta, 4), "eta": round(eta, 2)},
            log_likelihood=round(ll, 4),
            aic=round(aic, 4),
            bic=round(bic, 4),
        )

    def fit_weibull_3p(self, data: List[float]) -> DistributionFit:
        """Fit 3-parameter Weibull with location parameter gamma."""
        data = [d for d in data if d > 0]
        if len(data) < 3:
            return DistributionFit(distribution_type=DistributionType.WEIBULL_3P)

        # Estimate gamma as fraction of minimum
        gamma = min(data) * 0.5
        shifted = [d - gamma for d in data if d - gamma > 0]
        if len(shifted) < 2:
            gamma = 0.0
            shifted = data

        beta, eta = self._mle_weibull_2p(shifted)
        ll = self._weibull_log_likelihood(shifted, beta, eta)
        n = len(data)
        k = 3
        aic = 2 * k - 2 * ll
        bic = k * math.log(n) - 2 * ll

        return DistributionFit(
            distribution_type=DistributionType.WEIBULL_3P,
            parameters={"beta": round(beta, 4), "eta": round(eta, 2), "gamma": round(gamma, 2)},
            log_likelihood=round(ll, 4),
            aic=round(aic, 4),
            bic=round(bic, 4),
        )

    def fit_lognormal(self, data: List[float]) -> DistributionFit:
        """Fit lognormal distribution: ln(X) ~ N(mu, sigma²)."""
        data = [d for d in data if d > 0]
        if len(data) < 2:
            return DistributionFit(distribution_type=DistributionType.LOGNORMAL)

        ln_data = [math.log(d) for d in data]
        n = len(ln_data)
        mu = sum(ln_data) / n
        sigma = math.sqrt(sum((x - mu) ** 2 for x in ln_data) / max(n - 1, 1))

        # Log-likelihood
        ll = -n / 2 * math.log(2 * math.pi) - n * math.log(max(sigma, 0.01))
        ll -= sum((x - mu) ** 2 for x in ln_data) / (2 * max(sigma ** 2, 0.001))
        ll -= sum(ln_data)  # Jacobian term

        k = 2
        aic = 2 * k - 2 * ll
        bic = k * math.log(n) - 2 * ll

        return DistributionFit(
            distribution_type=DistributionType.LOGNORMAL,
            parameters={"mu": round(mu, 4), "sigma": round(max(sigma, 0.01), 4)},
            log_likelihood=round(ll, 4),
            aic=round(aic, 4),
            bic=round(bic, 4),
        )

    def fit_exponential(self, data: List[float]) -> DistributionFit:
        """Fit exponential distribution: f(t) = λ exp(-λt)."""
        data = [d for d in data if d > 0]
        if not data:
            return DistributionFit(distribution_type=DistributionType.EXPONENTIAL)

        n = len(data)
        mean = sum(data) / n
        lam = 1.0 / max(mean, 0.01)

        ll = n * math.log(lam) - lam * sum(data)
        k = 1
        aic = 2 * k - 2 * ll
        bic = k * math.log(max(n, 1)) - 2 * ll

        return DistributionFit(
            distribution_type=DistributionType.EXPONENTIAL,
            parameters={"lambda": round(lam, 8)},
            log_likelihood=round(ll, 4),
            aic=round(aic, 4),
            bic=round(bic, 4),
        )

    def fit_normal(self, data: List[float]) -> DistributionFit:
        """Fit normal distribution."""
        if len(data) < 2:
            return DistributionFit(distribution_type=DistributionType.NORMAL)

        n = len(data)
        mu = sum(data) / n
        sigma = math.sqrt(sum((x - mu) ** 2 for x in data) / max(n - 1, 1))

        ll = -n / 2 * math.log(2 * math.pi) - n * math.log(max(sigma, 0.01))
        ll -= sum((x - mu) ** 2 for x in data) / (2 * max(sigma ** 2, 0.001))

        k = 2
        aic = 2 * k - 2 * ll
        bic = k * math.log(n) - 2 * ll

        return DistributionFit(
            distribution_type=DistributionType.NORMAL,
            parameters={"mu": round(mu, 4), "sigma": round(max(sigma, 0.01), 4)},
            log_likelihood=round(ll, 4),
            aic=round(aic, 4),
            bic=round(bic, 4),
        )

    def fit_all(self, data: List[float]) -> List[DistributionFit]:
        """Fit all candidate distributions and return sorted by AIC."""
        fits = [
            self.fit_weibull_2p(data),
            self.fit_weibull_3p(data),
            self.fit_lognormal(data),
            self.fit_exponential(data),
            self.fit_normal(data),
        ]
        return sorted(fits, key=lambda f: f.aic)

    def best_fit(self, data: List[float]) -> DistributionFit:
        """Return the best-fitting distribution by AIC."""
        fits = self.fit_all(data)
        return fits[0] if fits else DistributionFit(distribution_type=DistributionType.WEIBULL_2P)

    # --- Internal helpers ---

    @staticmethod
    def _mle_weibull_2p(data: List[float]) -> Tuple[float, float]:
        """Simplified MLE for Weibull 2P using method of moments."""
        n = len(data)
        if n < 2:
            return 1.5, sum(data) / max(n, 1)

        ln_data = [math.log(max(d, 0.01)) for d in data]
        mean_ln = sum(ln_data) / n
        var_ln = sum((x - mean_ln) ** 2 for x in ln_data) / max(n - 1, 1)
        std_ln = math.sqrt(var_ln) if var_ln > 0 else 1.0

        beta = math.pi / (math.sqrt(6.0) * max(std_ln, 0.01))
        beta = max(0.5, min(10.0, beta))

        eta = math.exp(mean_ln + 0.5772 / beta)
        eta = max(eta, 1.0)

        return beta, eta

    @staticmethod
    def _weibull_log_likelihood(data: List[float], beta: float, eta: float) -> float:
        """Compute Weibull 2P log-likelihood."""
        n = len(data)
        if n == 0 or beta <= 0 or eta <= 0:
            return -float("inf")

        ll = n * math.log(beta / eta)
        ll += (beta - 1) * sum(math.log(max(d / eta, 1e-10)) for d in data)
        ll -= sum((d / eta) ** beta for d in data)
        return ll
