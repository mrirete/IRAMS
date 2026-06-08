"""
Spare Parts Demand Forecasting — Monte Carlo Based
════════════════════════════════════════════════════
Poisson demand model from failure rate × lead time.
Safety stock calculation for target service levels.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional
from uuid import UUID

import numpy as np

from ers_analyze.schemas import SparePartsDemand


class SparePartsForecast:
    """
    Spare parts demand forecasting from reliability data.

    Uses:
    - Poisson demand model: λ = failure_rate × lead_time
    - Safety stock: based on target service level (Z-score)
    - Reorder point: expected demand during LT + safety stock
    """

    # Z-scores for common service levels
    Z_SCORES: Dict[float, float] = {
        0.90: 1.282,
        0.95: 1.645,
        0.975: 1.960,
        0.99: 2.326,
        0.999: 3.090,
    }

    def __init__(self, seed: Optional[int] = None):
        self._rng = np.random.default_rng(seed)

    def forecast_demand(
        self,
        asset_id: UUID,
        failure_rate_per_year: float,
        lead_time_days: float = 14.0,
        service_level: float = 0.95,
        part_name: str = "generic",
    ) -> SparePartsDemand:
        """
        Forecast spare parts demand for a single asset.

        Args:
            asset_id: Asset identifier
            failure_rate_per_year: Expected failures per year
            lead_time_days: Supplier lead time in days
            service_level: Target service level (0.90-0.999)
            part_name: Name/identifier of the spare part
        """
        # Convert failure rate to demand rate during lead time
        lead_time_years = lead_time_days / 365.0
        demand_during_lt = failure_rate_per_year * lead_time_years

        # Poisson model: demand ~Poisson(λ) where λ = failure_rate × lead_time
        # Standard deviation for Poisson = √λ
        demand_std = math.sqrt(max(demand_during_lt, 0.01))

        # Z-score for service level
        z = self._get_z_score(service_level)

        # Safety stock = Z × σ (rounded up)
        safety_stock = math.ceil(z * demand_std)
        safety_stock = max(safety_stock, 1)  # minimum 1

        # Reorder point = expected demand during LT + safety stock
        reorder_point = math.ceil(demand_during_lt) + safety_stock

        return SparePartsDemand(
            asset_id=asset_id,
            part_name=part_name,
            demand_rate_per_year=failure_rate_per_year,
            safety_stock=safety_stock,
            reorder_point=reorder_point,
            service_level_target=service_level,
            lead_time_days=lead_time_days,
        )

    def forecast_fleet(
        self,
        assets: List[Dict],
        lead_time_days: float = 14.0,
        service_level: float = 0.95,
    ) -> List[SparePartsDemand]:
        """
        Forecast demand across a fleet of similar assets.

        Args:
            assets: List of {"asset_id": UUID, "failure_rate": float, "part_name": str}
            lead_time_days: Common supplier lead time
            service_level: Target service level
        """
        return [
            self.forecast_demand(
                asset_id=a["asset_id"],
                failure_rate_per_year=a["failure_rate"],
                lead_time_days=lead_time_days,
                service_level=service_level,
                part_name=a.get("part_name", "generic"),
            )
            for a in assets
        ]

    def _get_z_score(self, service_level: float) -> float:
        """Get Z-score for the given service level."""
        # Exact match
        if service_level in self.Z_SCORES:
            return self.Z_SCORES[service_level]

        # Find closest
        levels = sorted(self.Z_SCORES.keys())
        for i, level in enumerate(levels):
            if service_level <= level:
                return self.Z_SCORES[level]
        return self.Z_SCORES[levels[-1]]
