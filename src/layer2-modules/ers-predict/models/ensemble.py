"""
ERS Predict — Prediction Ensemble
══════════════════════════════════
Weighted ensemble combining XGBoost, LSTM Autoencoder,
Weibull Survival, and Physics-Informed models.

Key rules:
  - Weights per asset_class, updated weekly on rolling accuracy
  - Model agreement < 70% → flag governance_tier=2 (human review)
  - DQS adjustment applied to final confidence
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from ..schemas import (
    AssetHealthIndex,
    FailurePrediction,
    FeatureVector,
    GovernanceTier,
    RULEstimate,
    ConfidenceBand,
)
from .base import BasePredictionModel
from .xgboost_model import XGBoostPredictor
from .lstm_autoencoder import LSTMAutoencoderDetector
from .weibull_survival import WeibullSurvivalModel
from .physics_informed import PhysicsInformedModel

logger = logging.getLogger("ers.predict.ensemble")

# Default ensemble weights per model
DEFAULT_WEIGHTS = {
    "xgboost": 0.35,
    "lstm_autoencoder": 0.20,
    "weibull_survival": 0.25,
    "physics_informed": 0.20,
}

# Agreement threshold below which human review is triggered
AGREEMENT_THRESHOLD = 0.70


class PredictionEnsemble:
    """
    Multi-model ensemble per asset_class.

    Orchestrates predictions from all four models, applies weighted
    averaging, checks model agreement, and flags governance tier.
    """

    def __init__(
        self,
        asset_class: str,
        weights: Dict[str, float] | None = None,
    ):
        self.asset_class = asset_class
        self.weights = weights or DEFAULT_WEIGHTS.copy()

        # Initialize all sub-models
        self.models: Dict[str, BasePredictionModel] = {
            "xgboost": XGBoostPredictor(asset_class),
            "lstm_autoencoder": LSTMAutoencoderDetector(asset_class),
            "weibull_survival": WeibullSurvivalModel(asset_class),
            "physics_informed": PhysicsInformedModel(asset_class),
        }

    def train_all(
        self,
        features: List[FeatureVector],
        targets: List[float],
        **kwargs: Any,
    ) -> Dict[str, Dict[str, float]]:
        """Train all models on the same dataset."""
        results: Dict[str, Dict[str, float]] = {}
        for name, model in self.models.items():
            try:
                metrics = model.train(features, targets, **kwargs)
                results[name] = metrics
                logger.info("Trained %s: %s", name, metrics)
            except Exception as e:
                logger.error("Failed to train %s: %s", name, e)
                results[name] = {"error": 1.0}
        return results

    def predict_health_index(
        self,
        features: FeatureVector,
        dqs_score: float = 100.0,
    ) -> AssetHealthIndex:
        """
        Generate ensemble health index prediction.

        Args:
            features: Feature vector for a single asset.
            dqs_score: Data quality score for DQS impact calculation.

        Returns:
            AssetHealthIndex with confidence, DQS impact, and governance tier.
        """
        predictions: Dict[str, Dict[str, Any]] = {}
        for name, model in self.models.items():
            try:
                pred = model.predict(features)
                predictions[name] = pred
            except Exception as e:
                logger.warning("Model %s failed: %s", name, e)

        if not predictions:
            return AssetHealthIndex(
                asset_id=features.asset_id,
                health_index=50.0,
                confidence=0.1,
                governance_tier=GovernanceTier.TIER_2_HUMAN_REVIEW,
                computed_at=datetime.now(tz=timezone.utc),
            )

        # Weighted average
        weighted_sum = 0.0
        weight_total = 0.0
        values: List[float] = []

        for name, pred in predictions.items():
            w = self.weights.get(name, 0.25)
            val = pred.get("value", 50.0)
            weighted_sum += val * w
            weight_total += w
            values.append(val)

        health_index = weighted_sum / max(weight_total, 0.01)

        # Model agreement: 1 - (std / mean_range)
        agreement = self._compute_agreement(values)

        # Weighted confidence
        weighted_conf = sum(
            predictions[n].get("confidence", 0.5) * self.weights.get(n, 0.25)
            for n in predictions
        ) / max(weight_total, 0.01)

        # DQS impact
        dqs_impact = 0.0
        if dqs_score < 60:
            dqs_impact = (60 - dqs_score) / 100.0
            weighted_conf *= (1.0 - dqs_impact)

        # Governance tier based on agreement
        governance_tier = GovernanceTier.TIER_3_STANDARD
        if agreement < AGREEMENT_THRESHOLD:
            governance_tier = GovernanceTier.TIER_2_HUMAN_REVIEW
            logger.warning(
                "Model agreement %.2f%% < 70%% for asset %s — flagging Tier 2 review",
                agreement * 100,
                features.asset_id,
            )

        # Feature importances (from XGBoost if available)
        contributing_factors: Dict[str, float] = {}
        xgb_pred = predictions.get("xgboost", {})
        meta = xgb_pred.get("metadata", {})
        if "feature_importance" in meta:
            contributing_factors = meta["feature_importance"]

        # Trend classification
        trend = "stable"
        if health_index < 30:
            trend = "critical"
        elif health_index < 60:
            trend = "degrading"
        elif health_index > 90:
            trend = "improving"

        return AssetHealthIndex(
            asset_id=features.asset_id,
            health_index=round(health_index, 2),
            confidence=round(max(0.05, min(0.99, weighted_conf)), 4),
            dqs_impact=round(dqs_impact, 4),
            governance_tier=governance_tier,
            contributing_factors=contributing_factors,
            trend=trend,
            model_agreement=round(agreement, 4),
            computed_at=datetime.now(tz=timezone.utc),
        )

    def predict_rul(
        self,
        features: FeatureVector,
        failure_mode: str = "general",
        dqs_score: float = 100.0,
    ) -> RULEstimate:
        """Generate RUL estimate from Weibull survival model."""
        weibull = self.models.get("weibull_survival")
        if not weibull:
            from ..schemas import DistributionType
            return RULEstimate(
                asset_id=features.asset_id,
                rul_days=0.0,
                confidence=0.1,
                distribution_type=DistributionType.WEIBULL_2P,
                computed_at=datetime.now(tz=timezone.utc),
            )

        pred = weibull.predict(features)
        meta = pred.get("metadata", {})

        # Build confidence bands
        bands_data = meta.get("confidence_bands", {})
        confidence_bands = []
        for pct_str, vals in bands_data.items():
            if len(vals) == 2:
                median = (vals[0] + vals[1]) / 2.0
                confidence_bands.append(ConfidenceBand(
                    percentile=int(pct_str),
                    lower_days=vals[0],
                    upper_days=vals[1],
                    median_days=median,
                ))

        # DQS impact
        dqs_impact = 0.0
        confidence = pred.get("confidence", 0.5)
        if dqs_score < 60:
            dqs_impact = (60 - dqs_score) / 100.0
            confidence *= (1.0 - dqs_impact)

        from ..schemas import DistributionType
        return RULEstimate(
            asset_id=features.asset_id,
            rul_days=pred.get("value", 0.0),
            confidence=round(max(0.05, confidence), 4),
            confidence_bands=confidence_bands,
            distribution_type=DistributionType.WEIBULL_2P,
            distribution_params={
                "beta": meta.get("beta", 2.5),
                "eta": meta.get("eta", 5000.0),
            },
            dqs_impact=round(dqs_impact, 4),
            governance_tier=GovernanceTier.TIER_3_STANDARD,
            computed_at=datetime.now(tz=timezone.utc),
        )

    def predict_failure(
        self,
        features: FeatureVector,
        failure_mode: str = "general",
        asset_criticality: str = "B",
        dqs_score: float = 100.0,
    ) -> FailurePrediction:
        """Generate failure probability prediction."""
        health = self.predict_health_index(features, dqs_score)

        # Convert health index to failure probabilities
        inv_health = (100.0 - health.health_index) / 100.0
        p_7d = min(1.0, inv_health ** 2 * 0.3)
        p_30d = min(1.0, inv_health ** 1.5 * 0.5)
        p_90d = min(1.0, inv_health * 0.8)

        # Risk Priority Number: Criticality × Severity
        crit_map = {"A": 5, "B": 3, "C": 1}
        crit_score = crit_map.get(asset_criticality, 3)
        severity = max(1, int(inv_health * 5))
        rpn = crit_score * severity

        # Recommended action based on RPN
        action = "Monitor"
        if rpn >= 20:
            action = "Immediate intervention required — schedule emergency WO"
        elif rpn >= 12:
            action = "Schedule priority maintenance within 7 days"
        elif rpn >= 6:
            action = "Plan maintenance within next PM cycle"

        return FailurePrediction(
            asset_id=features.asset_id,
            failure_mode=failure_mode,
            probability_7d=round(p_7d, 4),
            probability_30d=round(p_30d, 4),
            probability_90d=round(p_90d, 4),
            confidence=health.confidence,
            dqs_impact=health.dqs_impact,
            governance_tier=health.governance_tier,
            risk_priority_number=float(rpn),
            recommended_action=action,
            computed_at=datetime.now(tz=timezone.utc),
        )

    def update_weights(self, new_weights: Dict[str, float]) -> None:
        """Update ensemble weights (called weekly from scheduler)."""
        for name, weight in new_weights.items():
            if name in self.weights:
                self.weights[name] = max(0.05, min(0.60, weight))

        # Normalize to sum to 1.0
        total = sum(self.weights.values())
        if total > 0:
            self.weights = {k: v / total for k, v in self.weights.items()}

        logger.info("Ensemble weights updated: %s", self.weights)

    @staticmethod
    def _compute_agreement(values: List[float]) -> float:
        """
        Compute model agreement as 1 - normalized std deviation.
        Agreement = 1.0 means all models agree perfectly.
        """
        if len(values) < 2:
            return 1.0

        mean = sum(values) / len(values)
        if mean == 0:
            return 1.0

        variance = sum((v - mean) ** 2 for v in values) / len(values)
        std = variance ** 0.5

        # Normalize std to 0-1 range (std/mean, capped)
        cv = std / max(abs(mean), 1.0)
        return max(0.0, min(1.0, 1.0 - cv))
