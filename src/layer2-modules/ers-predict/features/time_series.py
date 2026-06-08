"""
ERS Predict — Time-Series Feature Extractor
════════════════════════════════════════════
Rolling statistics (mean/std/min/max/kurtosis/RMS) over
configurable time windows: 1h, 8h, 24h, 7d, 30d.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

from ..schemas import TimeSeriesFeatures, WindowStats


# Window definitions in seconds
WINDOWS: Dict[str, int] = {
    "1h": 3600,
    "8h": 28800,
    "24h": 86400,
    "7d": 604800,
    "30d": 2592000,
}


class TimeSeriesFeatureExtractor:
    """
    Computes rolling statistics from time-series sensor data.

    Usage:
        extractor = TimeSeriesFeatureExtractor()
        features = extractor.extract("VIB_DE", readings)
    """

    def __init__(self, windows: Dict[str, int] | None = None):
        self.windows = windows or WINDOWS

    def extract(
        self,
        tag: str,
        readings: List[Tuple[datetime, float]],
        reference_time: datetime | None = None,
    ) -> TimeSeriesFeatures:
        """
        Extract rolling stats for each window.

        Args:
            tag: Sensor tag name.
            readings: List of (timestamp, value) tuples, sorted newest-first.
            reference_time: Anchor point for windows. Defaults to latest reading.

        Returns:
            TimeSeriesFeatures with all window stats.
        """
        if not readings:
            return TimeSeriesFeatures(tag=tag, windows=[], trend_slope=0.0, change_rate=0.0)

        # Sort by timestamp descending (most recent first)
        sorted_readings = sorted(readings, key=lambda r: r[0], reverse=True)
        ref = reference_time or sorted_readings[0][0]

        window_stats: List[WindowStats] = []
        for name, secs in self.windows.items():
            cutoff = ref - timedelta(seconds=secs)
            values = [v for ts, v in sorted_readings if ts >= cutoff]
            stats = self._compute_stats(name, values)
            window_stats.append(stats)

        # Trend: linear slope of all values over time
        trend_slope = self._compute_trend(sorted_readings)
        # Change rate: (latest - earliest) / time_span
        change_rate = self._compute_change_rate(sorted_readings)

        return TimeSeriesFeatures(
            tag=tag,
            windows=window_stats,
            trend_slope=trend_slope,
            change_rate=change_rate,
        )

    @staticmethod
    def _compute_stats(window_name: str, values: List[float]) -> WindowStats:
        """Compute mean, std, min, max, kurtosis, RMS over a set of values."""
        n = len(values)
        if n == 0:
            return WindowStats(window_name=window_name, sample_count=0)

        mean = sum(values) / n
        variance = sum((v - mean) ** 2 for v in values) / max(n, 1)
        std = math.sqrt(variance)
        min_val = min(values)
        max_val = max(values)

        # RMS
        rms = math.sqrt(sum(v ** 2 for v in values) / n)

        # Kurtosis (excess kurtosis, Fisher's definition)
        if std > 0 and n > 3:
            m4 = sum((v - mean) ** 4 for v in values) / n
            kurtosis = (m4 / (std ** 4)) - 3.0
        else:
            kurtosis = 0.0

        return WindowStats(
            window_name=window_name,
            mean=round(mean, 6),
            std=round(std, 6),
            min_val=round(min_val, 6),
            max_val=round(max_val, 6),
            kurtosis=round(kurtosis, 6),
            rms=round(rms, 6),
            sample_count=n,
        )

    @staticmethod
    def _compute_trend(readings: List[Tuple[datetime, float]]) -> float:
        """Linear regression slope (value per hour)."""
        n = len(readings)
        if n < 2:
            return 0.0

        # Use hours since earliest as x-axis
        t0 = readings[-1][0]
        xs = [(r[0] - t0).total_seconds() / 3600.0 for r in readings]
        ys = [r[1] for r in readings]

        x_mean = sum(xs) / n
        y_mean = sum(ys) / n

        numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
        denominator = sum((x - x_mean) ** 2 for x in xs)

        if denominator == 0:
            return 0.0
        return round(numerator / denominator, 8)

    @staticmethod
    def _compute_change_rate(readings: List[Tuple[datetime, float]]) -> float:
        """Rate of change: (latest - earliest) / hours span."""
        if len(readings) < 2:
            return 0.0

        latest = readings[0]
        earliest = readings[-1]
        hours = (latest[0] - earliest[0]).total_seconds() / 3600.0

        if hours == 0:
            return 0.0
        return round((latest[1] - earliest[1]) / hours, 8)
