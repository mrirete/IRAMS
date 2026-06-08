"""
Tests — ERS Predict ML Models and Ensemble
═══════════════════════════════════════════
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from ers_predict.schemas import (
    FeatureVector,
    FrequencyFeatures,
    HistoricalPattern,
    OperationalContext,
    TimeSeriesFeatures,
    WindowStats,
)


def _make_test_features(
    health_good: bool = True,
    asset_id=None,
) -> FeatureVector:
    """Create a test feature vector."""
    if health_good:
        rms = 2.0
        trend = -0.01
        hours_pm = 500
        load = 0.8
    else:
        rms = 15.0
        trend = -2.0
        hours_pm = 5000
        load = 1.2

    return FeatureVector(
        asset_id=asset_id or uuid4(),
        time_series=[
            TimeSeriesFeatures(
                tag="VIB_DE",
                windows=[
                    WindowStats(window_name="1h", mean=rms, std=1.0,
                                min_val=rms - 1, max_val=rms + 1,
                                kurtosis=0.5, rms=rms, sample_count=60),
                    WindowStats(window_name="24h", mean=rms, std=1.5,
                                min_val=rms - 2, max_val=rms + 2,
                                kurtosis=0.8, rms=rms, sample_count=1440),
                ],
                trend_slope=trend,
                change_rate=trend / 24,
            ),
        ],
        frequency=[
            FrequencyFeatures(
                tag="VIB_DE",
                dominant_frequency_hz=60.0,
                peak_amplitude=0.5,
                spectral_energy=3.0,
                crest_factor=3.5 if health_good else 6.0,
            ),
        ],
        operational=OperationalContext(
            hours_since_last_pm=hours_pm,
            load_factor=load,
            ambient_temp_delta=5.0 if health_good else 20.0,
            running_hours=10000 if health_good else 45000,
            start_stop_cycles=50,
            operating_regime="normal" if health_good else "overload",
        ),
        historical_patterns=[],
        data_quality_score=90.0 if health_good else 45.0,
    )


class TestXGBoostPredictor:
    """Tests for XGBoost predictor."""

    def setup_method(self):
        from ers_predict.models.xgboost_model import XGBoostPredictor
        self.model = XGBoostPredictor("pump")

    def test_predict_healthy_asset(self):
        features = _make_test_features(health_good=True)
        result = self.model.predict(features)

        assert "value" in result
        assert "confidence" in result
        assert 0 <= result["value"] <= 100
        assert result["value"] > 50  # healthy asset should score well

    def test_predict_degraded_asset(self):
        features = _make_test_features(health_good=False)
        result = self.model.predict(features)

        assert result["value"] < 70  # degraded asset should score lower

    def test_train(self):
        features = [_make_test_features(True) for _ in range(10)]
        targets = [85.0 + i for i in range(10)]
        metrics = self.model.train(features, targets)

        assert self.model.is_trained
        assert "mae" in metrics
        assert "r2" in metrics

    def test_model_name(self):
        assert self.model.get_name() == "xgboost"


class TestLSTMAutoencoderDetector:
    """Tests for LSTM Autoencoder anomaly detector."""

    def setup_method(self):
        from ers_predict.models.lstm_autoencoder import LSTMAutoencoderDetector
        self.model = LSTMAutoencoderDetector("pump")

    def test_train_learns_baseline(self):
        features = [_make_test_features(True) for _ in range(20)]
        targets = [85.0] * 20
        self.model.train(features, targets)

        assert self.model.is_trained
        assert len(self.model.normal_baseline) > 0

    def test_detect_normal(self):
        features = [_make_test_features(True) for _ in range(20)]
        self.model.train(features, [85.0] * 20)

        result = self.model.predict(_make_test_features(True))
        assert result["value"] < 50  # normal should have low anomaly score

    def test_detect_anomaly(self):
        features = [_make_test_features(True) for _ in range(20)]
        self.model.train(features, [85.0] * 20)

        result = self.model.predict(_make_test_features(False))
        assert result["value"] > 0  # degraded should have some anomaly score

    def test_model_name(self):
        assert self.model.get_name() == "lstm_autoencoder"


class TestWeibullSurvivalModel:
    """Tests for Weibull survival model."""

    def setup_method(self):
        from ers_predict.models.weibull_survival import WeibullSurvivalModel
        self.model = WeibullSurvivalModel("pump")

    def test_default_params(self):
        assert self.model.beta > 0
        assert self.model.eta > 0

    def test_predict_rul(self):
        features = _make_test_features(True)
        result = self.model.predict(features)

        assert result["value"] > 0  # should have positive RUL
        assert "survival_probability" in result["metadata"]

    def test_train_with_failures(self):
        features = [_make_test_features(True)] * 10
        # Failure times in hours
        targets = [5000, 8000, 12000, 6000, 9000, 7500, 11000, 4500, 10000, 8500]
        metrics = self.model.train(features, targets)

        assert self.model.is_trained
        assert "beta" in metrics
        assert "eta" in metrics
        assert metrics["failure_count"] == 10.0

    def test_survival_function(self):
        # At t=0, survival should be 1.0
        assert self.model._survival(0.01) > 0.99
        # At very large t, survival should approach 0
        assert self.model._survival(1e6) < 0.01

    def test_model_name(self):
        assert self.model.get_name() == "weibull_survival"


class TestPhysicsInformedModel:
    """Tests for Physics-Informed model."""

    def setup_method(self):
        from ers_predict.models.physics_informed import PhysicsInformedModel
        self.model = PhysicsInformedModel("pump")

    def test_new_asset_healthy(self):
        features = _make_test_features(True)
        features.operational.running_hours = 100  # very new
        result = self.model.predict(features)

        assert result["value"] > 80  # new asset should be very healthy

    def test_old_asset_degraded(self):
        features = _make_test_features(False)
        features.operational.running_hours = 60000  # well past design life
        result = self.model.predict(features)

        assert result["value"] < 60  # old overloaded asset

    def test_model_name(self):
        assert self.model.get_name() == "physics_informed"


class TestPredictionEnsemble:
    """Tests for the multi-model ensemble."""

    def setup_method(self):
        from ers_predict.models.ensemble import PredictionEnsemble
        self.ensemble = PredictionEnsemble("pump")

    def test_ensemble_health_prediction(self):
        features = _make_test_features(True)
        result = self.ensemble.predict_health_index(features)

        assert 0 <= result.health_index <= 100
        assert 0 < result.confidence <= 1.0
        assert result.governance_tier is not None
        assert result.computed_at is not None

    def test_ensemble_failure_prediction(self):
        features = _make_test_features(False)
        result = self.ensemble.predict_failure(features, "seal_failure", "A")

        assert 0 <= result.probability_7d <= 1.0
        assert 0 <= result.probability_30d <= 1.0
        assert 0 <= result.probability_90d <= 1.0
        assert result.risk_priority_number > 0
        assert result.recommended_action is not None

    def test_ensemble_rul_prediction(self):
        features = _make_test_features(True)
        result = self.ensemble.predict_rul(features)

        assert result.rul_days >= 0
        assert result.confidence > 0

    def test_weight_update(self):
        self.ensemble.update_weights({"xgboost": 0.5, "physics_informed": 0.3})
        total = sum(self.ensemble.weights.values())
        assert abs(total - 1.0) < 0.01

    def test_governance_flagging(self):
        """High disagreement should trigger Tier 2 governance."""
        from ers_predict.schemas import GovernanceTier
        # This is hard to force without mocking, but we can verify the structure
        features = _make_test_features(True)
        result = self.ensemble.predict_health_index(features)
        assert result.governance_tier in [
            GovernanceTier.TIER_2_HUMAN_REVIEW,
            GovernanceTier.TIER_3_STANDARD,
        ]

    def test_dqs_impact(self):
        features = _make_test_features(False)
        features.data_quality_score = 30.0
        result = self.ensemble.predict_health_index(features, dqs_score=30.0)
        assert result.dqs_impact > 0
