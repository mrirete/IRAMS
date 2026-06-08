"""
ERS Predict — Base Model Interface
═══════════════════════════════════
Abstract base class for all prediction models in the ensemble.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from ..schemas import FeatureVector


class BasePredictionModel(ABC):
    """
    Abstract base for ERS Predict ensemble members.

    All models must implement:
        - train(): Learn from historical data
        - predict(): Generate a prediction from features
        - get_accuracy(): Return current accuracy metrics
        - get_name(): Return model identifier
    """

    def __init__(self, asset_class: str, model_version: int = 1):
        self.asset_class = asset_class
        self.model_version = model_version
        self.is_trained = False
        self.trained_at: Optional[datetime] = None
        self.accuracy_metrics: Dict[str, float] = {}
        self.training_samples: int = 0

    @abstractmethod
    def train(
        self,
        features: List[FeatureVector],
        targets: List[float],
        **kwargs: Any,
    ) -> Dict[str, float]:
        """
        Train the model on historical feature vectors and target values.

        Args:
            features: List of feature vectors.
            targets: List of target values (health index, RUL, etc.).

        Returns:
            Dictionary of training metrics (loss, accuracy, etc.).
        """
        ...

    @abstractmethod
    def predict(
        self,
        features: FeatureVector,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """
        Generate prediction from a feature vector.

        Args:
            features: Current feature vector for one asset.

        Returns:
            Dict with keys: "value", "confidence", "metadata"
        """
        ...

    def get_accuracy(self) -> Dict[str, float]:
        """Return current accuracy metrics from latest evaluation."""
        return self.accuracy_metrics

    @abstractmethod
    def get_name(self) -> str:
        """Return the model type name."""
        ...

    def save(self, path: str) -> str:
        """Serialize model to path. Returns the path."""
        # Production: implement with joblib/torch.save/etc.
        return path

    def load(self, path: str) -> None:
        """Load model from path."""
        # Production: implement with joblib/torch.load/etc.
        self.is_trained = True
