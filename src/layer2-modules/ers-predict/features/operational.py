"""
ERS Predict — Operational Context Extractor
═════════════════════════════════════════════
Derives operational context features: hours since PM, load factor,
ambient temperature delta, running hours, start-stop cycles.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..schemas import OperationalContext


class OperationalContextExtractor:
    """
    Computes operational context features from maintenance
    history, operating parameters, and design specs.

    Usage:
        extractor = OperationalContextExtractor()
        ctx = extractor.extract(
            last_pm_date=datetime(2025, 1, 15),
            running_hours=42000,
            rated_capacity=100.0,
            actual_output=85.0,
            design_temp_c=25.0,
            ambient_temp_c=38.0,
            start_stop_log=[...],
        )
    """

    def extract(
        self,
        last_pm_date: Optional[datetime] = None,
        running_hours: float = 0.0,
        rated_capacity: float = 1.0,
        actual_output: float = 0.0,
        design_temp_c: float = 25.0,
        ambient_temp_c: float = 25.0,
        start_stop_log: Optional[List[Dict[str, Any]]] = None,
        reference_time: Optional[datetime] = None,
    ) -> OperationalContext:
        """
        Build operational context from available data.

        Args:
            last_pm_date: Date of most recent preventive maintenance.
            running_hours: Total running hours on the asset.
            rated_capacity: Design rated output capacity.
            actual_output: Current actual output.
            design_temp_c: Design ambient temperature (°C).
            ambient_temp_c: Current ambient temperature (°C).
            start_stop_log: List of start/stop events (dicts with 'type' and 'timestamp').
            reference_time: Current time reference. Defaults to now.

        Returns:
            OperationalContext with all derived features.
        """
        now = reference_time or datetime.now(tz=timezone.utc)

        # Hours since last PM
        hours_since_pm = 0.0
        if last_pm_date:
            delta = now - last_pm_date
            hours_since_pm = max(0.0, delta.total_seconds() / 3600.0)

        # Load factor
        load_factor = 0.0
        if rated_capacity > 0:
            load_factor = min(actual_output / rated_capacity, 2.0)  # cap at 200%

        # Ambient temperature delta from design
        temp_delta = ambient_temp_c - design_temp_c

        # Start-stop cycle count (last 30 days)
        start_stop_cycles = 0
        if start_stop_log:
            thirty_days_ago = now - __import__("datetime").timedelta(days=30)
            for event in start_stop_log:
                ts = event.get("timestamp")
                if ts and isinstance(ts, datetime) and ts >= thirty_days_ago:
                    if event.get("type") == "start":
                        start_stop_cycles += 1

        # Operating regime classification
        operating_regime = self._classify_regime(load_factor, temp_delta)

        return OperationalContext(
            hours_since_last_pm=round(hours_since_pm, 2),
            load_factor=round(load_factor, 4),
            ambient_temp_delta=round(temp_delta, 2),
            running_hours=running_hours,
            start_stop_cycles=start_stop_cycles,
            operating_regime=operating_regime,
        )

    @staticmethod
    def _classify_regime(load_factor: float, temp_delta: float) -> str:
        """Classify operating regime based on load and temperature."""
        if load_factor > 1.1 or temp_delta > 15:
            return "overload"
        elif load_factor < 0.1:
            return "standby"
        elif load_factor > 0.9 or temp_delta > 10:
            return "high_stress"
        return "normal"
