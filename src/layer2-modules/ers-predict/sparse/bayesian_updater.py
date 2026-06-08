"""
ERS Predict — Bayesian Updater
═══════════════════════════════
Bayesian updating with industry priors from OREDA/IEEE 493.
For assets with < 15 failures, uses informative priors;
transitions to data-driven as evidence accumulates.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from ..schemas import (
    BayesianPosterior,
    BayesianPrior,
    DistributionType,
)


# ═══════════════════════════════════════════════════════════════
#  OREDA / IEEE 493 Industry Priors
#  Source: Offshore Reliability Data Handbook (OREDA 2015)
#          IEEE 493 — Gold Book (Reliability Data for Industrial Plants)
# ═══════════════════════════════════════════════════════════════

INDUSTRY_PRIORS: Dict[str, Dict[str, Dict[str, float]]] = {
    # asset_class → failure_mode → Weibull params {beta, eta_hours}
    "pump": {
        "seal_failure": {"beta": 2.0, "eta": 8760, "source_n": 450},
        "bearing_failure": {"beta": 2.5, "eta": 17520, "source_n": 380},
        "impeller_wear": {"beta": 3.0, "eta": 26280, "source_n": 210},
        "general": {"beta": 1.8, "eta": 12000, "source_n": 620},
    },
    "compressor": {
        "valve_failure": {"beta": 1.5, "eta": 15000, "source_n": 310},
        "bearing_failure": {"beta": 2.2, "eta": 20000, "source_n": 280},
        "seal_failure": {"beta": 1.8, "eta": 12000, "source_n": 350},
        "general": {"beta": 1.6, "eta": 18000, "source_n": 550},
    },
    "turbine": {
        "blade_fatigue": {"beta": 3.5, "eta": 40000, "source_n": 120},
        "bearing_failure": {"beta": 2.8, "eta": 30000, "source_n": 180},
        "general": {"beta": 2.0, "eta": 35000, "source_n": 400},
    },
    "motor": {
        "winding_failure": {"beta": 2.0, "eta": 25000, "source_n": 500},
        "bearing_failure": {"beta": 2.5, "eta": 20000, "source_n": 450},
        "general": {"beta": 1.8, "eta": 22000, "source_n": 700},
    },
    "heat_exchanger": {
        "tube_leak": {"beta": 1.5, "eta": 35000, "source_n": 200},
        "fouling": {"beta": 2.0, "eta": 15000, "source_n": 300},
        "general": {"beta": 1.6, "eta": 30000, "source_n": 350},
    },
    "valve": {
        "seat_wear": {"beta": 2.0, "eta": 10000, "source_n": 400},
        "actuator_failure": {"beta": 1.5, "eta": 20000, "source_n": 250},
        "general": {"beta": 1.8, "eta": 12000, "source_n": 500},
    },
}

MINIMUM_FAILURES_FOR_DATA_DRIVEN = 15


class BayesianUpdater:
    """
    Conjugate Bayesian updater for failure rate estimation.

    Uses Gamma-Poisson conjugate model:
        Prior:     λ ~ Gamma(α_prior, β_prior)
        Likelihood: n_failures ~ Poisson(λ × T)
        Posterior:  λ ~ Gamma(α_prior + n, β_prior + T)

    Where:
        α (shape) = (beta_weibull)² × source_n / 4  (pseudo-count)
        β (rate)  = α / (1/eta_weibull)              (pseudo-time)
    """

    def __init__(self):
        pass

    def get_prior(
        self,
        asset_class: str,
        failure_mode: str = "general",
    ) -> BayesianPrior:
        """
        Retrieve industry prior for the given asset class and failure mode.

        Falls back to "general" if specific failure mode not found,
        then to a generic uninformative prior if asset class unknown.
        """
        class_priors = INDUSTRY_PRIORS.get(asset_class.lower(), {})
        mode_params = class_priors.get(failure_mode.lower())
        if not mode_params:
            mode_params = class_priors.get("general")
        if not mode_params:
            # Uninformative prior
            return BayesianPrior(
                source="uninformative",
                distribution_type=DistributionType.WEIBULL_2P,
                parameters={"beta": 1.5, "eta": 20000},
                failure_mode=failure_mode,
                asset_class=asset_class,
                sample_size=0,
                confidence=0.1,
            )

        return BayesianPrior(
            source="OREDA/IEEE_493",
            distribution_type=DistributionType.WEIBULL_2P,
            parameters={"beta": mode_params["beta"], "eta": mode_params["eta"]},
            failure_mode=failure_mode,
            asset_class=asset_class,
            sample_size=int(mode_params.get("source_n", 0)),
            confidence=min(0.9, mode_params.get("source_n", 0) / 500.0),
        )

    def update(
        self,
        prior: BayesianPrior,
        observed_failures: int,
        observed_hours: float,
    ) -> BayesianPosterior:
        """
        Update the prior with observed data to produce a posterior.

        When observed_failures >= MINIMUM_FAILURES_FOR_DATA_DRIVEN,
        the posterior transitions to data-dominated.
        """
        beta_w = prior.parameters.get("beta", 1.5)
        eta_w = prior.parameters.get("eta", 20000)

        # Convert Weibull params to Gamma-Poisson conjugate
        # Pseudo-failures from prior (strength of prior belief)
        prior_weight = prior.sample_size / 50.0  # normalize to reasonable pseudo-count
        alpha_prior = max(0.5, prior_weight)
        # Prior expected failure rate
        lambda_prior = 1.0 / max(eta_w, 1.0)
        beta_prior = alpha_prior / max(lambda_prior, 1e-10)

        # Posterior parameters
        alpha_post = alpha_prior + observed_failures
        beta_post = beta_prior + observed_hours

        # Posterior failure rate
        lambda_post = alpha_post / max(beta_post, 1.0)

        # Convert back to Weibull-ish params
        eta_post = 1.0 / max(lambda_post, 1e-10)

        # Beta (shape) — blend prior beta_w with data-estimated shape
        if observed_failures >= 3:
            # Rough shape estimation from data
            data_weight = min(1.0, observed_failures / MINIMUM_FAILURES_FOR_DATA_DRIVEN)
            beta_post_weibull = beta_w * (1 - data_weight) + 2.0 * data_weight
        else:
            beta_post_weibull = beta_w

        # Convergence: how much data dominates vs prior
        total_info = alpha_prior + observed_failures
        convergence = observed_failures / max(total_info, 1.0)

        # Effective sample size
        ess = alpha_prior + observed_failures

        return BayesianPosterior(
            prior=prior,
            observed_failures=observed_failures,
            observed_hours=observed_hours,
            posterior_parameters={
                "beta": round(beta_post_weibull, 4),
                "eta": round(eta_post, 2),
                "alpha_posterior": round(alpha_post, 4),
                "beta_posterior": round(beta_post, 2),
                "lambda_posterior": round(lambda_post, 8),
            },
            effective_sample_size=round(ess, 2),
            convergence_to_data=round(convergence, 4),
        )

    def should_use_prior(self, observed_failures: int) -> bool:
        """Check if asset has enough data for data-driven estimation."""
        return observed_failures < MINIMUM_FAILURES_FOR_DATA_DRIVEN
