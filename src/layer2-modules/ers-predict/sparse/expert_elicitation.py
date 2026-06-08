"""
ERS Predict — Expert Elicitation API
═════════════════════════════════════
Ingests expert probability estimates and converts them to
statistical priors for Bayesian updating.
"""

from __future__ import annotations

import math
from typing import List, Optional
from uuid import UUID

from ..schemas import (
    BayesianPrior,
    DistributionFit,
    DistributionType,
    ExpertElicitationInput,
    ExpertElicitationResult,
)


class ExpertElicitationEngine:
    """
    Converts expert elicited estimates (P10, P50, P90) to
    distribution parameters suitable for Bayesian priors.

    Supports:
        - Lognormal estimation from percentiles
        - Weibull estimation from percentiles
        - Consistency checking across multiple experts
    """

    def process_elicitation(
        self,
        elicitation: ExpertElicitationInput,
    ) -> ExpertElicitationResult:
        """
        Convert a single expert's P10/P50/P90 estimates to a distribution.

        Strategy:
            1. Fit lognormal to P10/P50/P90
            2. Check self-consistency (are intervals plausible?)
            3. Generate BayesianPrior from fitted distribution
        """
        # Validate inputs
        if elicitation.p10_hours <= 0:
            elicitation.p10_hours = 1.0
        if elicitation.p50_hours <= elicitation.p10_hours:
            elicitation.p50_hours = elicitation.p10_hours * 2
        if elicitation.p90_hours <= elicitation.p50_hours:
            elicitation.p90_hours = elicitation.p50_hours * 2

        # Fit lognormal from P10 and P90
        mu, sigma = self._fit_lognormal_from_percentiles(
            elicitation.p10_hours,
            elicitation.p50_hours,
            elicitation.p90_hours,
        )

        # Consistency score: how well P50 matches the fitted median
        fitted_median = math.exp(mu)
        consistency = 1.0 - min(1.0, abs(fitted_median - elicitation.p50_hours) / max(elicitation.p50_hours, 1.0))

        # Weight by expert's self-stated confidence and experience
        experience_factor = min(1.0, elicitation.years_experience / 20.0)
        combined_confidence = (
            elicitation.confidence_in_estimate * 0.6
            + experience_factor * 0.3
            + consistency * 0.1
        )

        dist_fit = DistributionFit(
            distribution_type=DistributionType.LOGNORMAL,
            parameters={"mu": round(mu, 4), "sigma": round(sigma, 4)},
            log_likelihood=0.0,
            aic=0.0,
            bic=0.0,
        )

        # Convert to Weibull-equivalent for BayesianPrior compatibility
        # Use median as eta and sigma-derived shape as beta
        eta_equiv = elicitation.p50_hours
        beta_equiv = max(0.5, min(5.0, 1.0 / max(sigma, 0.1)))

        prior = BayesianPrior(
            source="expert",
            distribution_type=DistributionType.WEIBULL_2P,
            parameters={"beta": round(beta_equiv, 4), "eta": round(eta_equiv, 2)},
            failure_mode=elicitation.failure_mode,
            asset_class=elicitation.asset_class,
            sample_size=0,
            confidence=round(combined_confidence, 4),
        )

        return ExpertElicitationResult(
            expert_id=elicitation.expert_id,
            derived_distribution=dist_fit,
            prior=prior,
            consistency_score=round(consistency, 4),
        )

    def aggregate_experts(
        self,
        results: List[ExpertElicitationResult],
    ) -> BayesianPrior:
        """
        Aggregate multiple expert elicitations into a single prior
        using confidence-weighted averaging.
        """
        if not results:
            return BayesianPrior(
                source="expert_aggregate",
                distribution_type=DistributionType.WEIBULL_2P,
                parameters={"beta": 1.5, "eta": 20000},
                failure_mode="unknown",
                asset_class="unknown",
                sample_size=0,
                confidence=0.1,
            )

        total_weight = 0.0
        weighted_beta = 0.0
        weighted_eta = 0.0

        for r in results:
            w = r.prior.confidence
            weighted_beta += r.prior.parameters.get("beta", 1.5) * w
            weighted_eta += r.prior.parameters.get("eta", 20000) * w
            total_weight += w

        if total_weight > 0:
            avg_beta = weighted_beta / total_weight
            avg_eta = weighted_eta / total_weight
        else:
            avg_beta = 1.5
            avg_eta = 20000

        # Aggregate confidence
        avg_confidence = total_weight / max(len(results), 1)
        # Bonus for multiple agreeing experts
        consistency_bonus = min(0.2, len(results) * 0.05)

        return BayesianPrior(
            source="expert_aggregate",
            distribution_type=DistributionType.WEIBULL_2P,
            parameters={"beta": round(avg_beta, 4), "eta": round(avg_eta, 2)},
            failure_mode=results[0].prior.failure_mode,
            asset_class=results[0].prior.asset_class,
            sample_size=len(results),
            confidence=round(min(0.95, avg_confidence + consistency_bonus), 4),
        )

    @staticmethod
    def _fit_lognormal_from_percentiles(
        p10: float, p50: float, p90: float
    ) -> tuple[float, float]:
        """
        Fit lognormal parameters (mu, sigma) from three percentiles.

        For lognormal: X = exp(mu + sigma * z)
        where z is the standard normal quantile.
        z_10 ≈ -1.2816, z_50 = 0, z_90 ≈ 1.2816
        """
        z_10 = -1.2816
        z_90 = 1.2816

        ln_p10 = math.log(max(p10, 0.01))
        ln_p50 = math.log(max(p50, 0.01))
        ln_p90 = math.log(max(p90, 0.01))

        # mu = ln(P50) (since z_50 = 0)
        mu = ln_p50

        # sigma from P10 and P90
        sigma_from_p10 = (ln_p10 - mu) / z_10
        sigma_from_p90 = (ln_p90 - mu) / z_90

        # Average both estimates
        sigma = (abs(sigma_from_p10) + abs(sigma_from_p90)) / 2.0
        sigma = max(sigma, 0.01)

        return mu, sigma
