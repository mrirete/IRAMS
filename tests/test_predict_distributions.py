"""
Tests — ERS Predict Distributions & Sparse Data
═══════════════════════════════════════════════════
"""

import math
from uuid import uuid4

import pytest


class TestDistributionFitter:
    """Tests for distribution fitting."""

    def setup_method(self):
        from ers_predict.distributions.fitters import DistributionFitter
        self.fitter = DistributionFitter()

    def test_weibull_2p_fit(self):
        data = [500, 800, 1200, 600, 900, 1100, 750, 1000, 850, 950]
        fit = self.fitter.fit_weibull_2p(data)
        assert fit.parameters.get("beta") > 0
        assert fit.parameters.get("eta") > 0
        assert fit.aic != 0

    def test_lognormal_fit(self):
        data = [100, 200, 500, 150, 300, 800, 250, 400]
        fit = self.fitter.fit_lognormal(data)
        assert "mu" in fit.parameters
        assert "sigma" in fit.parameters

    def test_exponential_fit(self):
        data = [100, 200, 50, 300, 150, 80, 250]
        fit = self.fitter.fit_exponential(data)
        assert fit.parameters.get("lambda") > 0

    def test_fit_all_sorted_by_aic(self):
        data = [500, 800, 1200, 600, 900, 1100, 750, 1000, 850, 950]
        fits = self.fitter.fit_all(data)
        assert len(fits) == 5

        # Should be sorted by AIC (ascending)
        for i in range(len(fits) - 1):
            assert fits[i].aic <= fits[i + 1].aic

    def test_best_fit(self):
        data = [500, 800, 1200, 600, 900, 1100, 750, 1000]
        best = self.fitter.best_fit(data)
        assert best.distribution_type is not None


class TestGoodnessOfFit:
    """Tests for goodness-of-fit testing."""

    def setup_method(self):
        from ers_predict.distributions.fitters import DistributionFitter
        from ers_predict.distributions.goodness_of_fit import GoodnessOfFitTester
        self.fitter = DistributionFitter()
        self.tester = GoodnessOfFitTester()

    def test_gof_weibull(self):
        data = [500, 800, 1200, 600, 900, 1100, 750, 1000, 850, 950]
        fit = self.fitter.fit_weibull_2p(data)
        result = self.tester.test(data, fit)

        assert result.anderson_darling_statistic is not None
        assert result.ks_statistic is not None

    def test_probability_plot_data(self):
        data = [500, 800, 1200, 600, 900]
        fit = self.fitter.fit_weibull_2p(data)
        points = self.tester.probability_plot_data(data, fit)

        assert len(points) == 5
        assert all(p.observed > 0 for p in points)
        assert all(p.theoretical > 0 for p in points)

    def test_rank_fits(self):
        data = [500, 800, 1200, 600, 900, 1100, 750, 1000]
        fits = self.fitter.fit_all(data)
        ranked = self.tester.rank_fits(data, fits)

        assert len(ranked) == 5
        assert ranked[0].rank == 1


class TestPFInterval:
    """Tests for P-F interval calculator."""

    def setup_method(self):
        from ers_predict.distributions.fitters import DistributionFitter
        from ers_predict.distributions.pf_interval import PFIntervalCalculator
        self.fitter = DistributionFitter()
        self.calculator = PFIntervalCalculator()

    def test_pf_interval_calculation(self):
        data = [5000, 8000, 12000, 6000, 9000, 7500, 11000]
        fit = self.fitter.best_fit(data)

        result = self.calculator.calculate(
            asset_id=uuid4(),
            failure_mode="bearing_failure",
            distribution=fit,
            current_age_hours=3000,
        )

        assert result.pf_interval_days > 0
        assert result.optimal_inspection_interval > 0
        assert 0 <= result.current_position_pct <= 100
        assert result.rul_days >= 0
        assert len(result.confidence_bands) == 3  # 50%, 80%, 95%

    def test_safety_critical_shorter_interval(self):
        data = [5000, 8000, 12000, 6000, 9000]
        fit = self.fitter.best_fit(data)

        normal = self.calculator.calculate(uuid4(), "test", fit, 3000, is_safety_critical=False)
        safety = self.calculator.calculate(uuid4(), "test", fit, 3000, is_safety_critical=True)

        # Safety-critical uses P-F/3 vs P-F/2
        assert safety.optimal_inspection_interval < normal.optimal_inspection_interval


class TestBayesianUpdater:
    """Tests for Bayesian updating with industry priors."""

    def setup_method(self):
        from ers_predict.sparse.bayesian_updater import BayesianUpdater
        self.updater = BayesianUpdater()

    def test_get_known_prior(self):
        prior = self.updater.get_prior("pump", "seal_failure")
        assert prior.source == "OREDA/IEEE_493"
        assert prior.parameters.get("beta") > 0
        assert prior.parameters.get("eta") > 0

    def test_get_unknown_prior(self):
        prior = self.updater.get_prior("unknown_asset", "unknown_mode")
        assert prior.source == "uninformative"
        assert prior.confidence == 0.1

    def test_bayesian_update(self):
        prior = self.updater.get_prior("pump", "seal_failure")
        posterior = self.updater.update(prior, observed_failures=5, observed_hours=20000)

        assert posterior.observed_failures == 5
        assert posterior.observed_hours == 20000
        assert "beta" in posterior.posterior_parameters
        assert "eta" in posterior.posterior_parameters
        assert posterior.effective_sample_size > 0

    def test_convergence_increases_with_data(self):
        prior = self.updater.get_prior("pump", "general")
        post_few = self.updater.update(prior, 3, 10000)
        post_many = self.updater.update(prior, 50, 100000)

        assert post_many.convergence_to_data > post_few.convergence_to_data

    def test_should_use_prior(self):
        assert self.updater.should_use_prior(5) is True
        assert self.updater.should_use_prior(20) is False


class TestExpertElicitation:
    """Tests for expert elicitation processing."""

    def setup_method(self):
        from ers_predict.sparse.expert_elicitation import ExpertElicitationEngine
        self.engine = ExpertElicitationEngine()

    def test_process_elicitation(self):
        from ers_predict.schemas import ExpertElicitationInput
        elicitation = ExpertElicitationInput(
            expert_id=uuid4(),
            asset_class="pump",
            failure_mode="seal_failure",
            p10_hours=3000,
            p50_hours=8000,
            p90_hours=15000,
            confidence_in_estimate=0.7,
            years_experience=15,
        )
        result = self.engine.process_elicitation(elicitation)

        assert result.consistency_score > 0
        assert result.prior.parameters.get("eta") > 0
        assert result.derived_distribution.parameters.get("mu") is not None

    def test_aggregate_experts(self):
        from ers_predict.schemas import ExpertElicitationInput

        results = []
        for i in range(3):
            elicitation = ExpertElicitationInput(
                expert_id=uuid4(),
                asset_class="pump",
                failure_mode="bearing_failure",
                p10_hours=4000 + i * 500,
                p50_hours=10000 + i * 1000,
                p90_hours=20000 + i * 2000,
                confidence_in_estimate=0.6 + i * 0.1,
                years_experience=10 + i * 5,
            )
            results.append(self.engine.process_elicitation(elicitation))

        aggregate = self.engine.aggregate_experts(results)
        assert aggregate.source == "expert_aggregate"
        assert aggregate.sample_size == 3
        assert aggregate.confidence > results[0].prior.confidence
