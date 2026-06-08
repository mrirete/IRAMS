"""
Historical Comparison Engine
═══════════════════════════
Side-by-side image comparison over time.
Quantifies degradation progression to calibrate RBI models.

ALL outputs are Tier 2 (advisory).
"""
from datetime import datetime
from typing import Any, Optional, List, Dict
from uuid import uuid4

from ers_vision.schemas import (
    ComparisonInput, ComparisonOutput, DegradationMetric,
)


class HistoricalComparisonEngine:
    """
    Compares baseline and current inspection images to
    quantify degradation and generate RBI calibration data.
    """

    def compare(
        self,
        inp: ComparisonInput,
        baseline_metrics: Optional[Dict[str, float]] = None,
        current_metrics: Optional[Dict[str, float]] = None,
        ai_client: Optional[Any] = None,
    ) -> ComparisonOutput:
        """
        Compare baseline vs current images.

        Args:
            inp: Comparison input with image data and dates.
            baseline_metrics: Pre-extracted metrics from baseline image.
            current_metrics: Pre-extracted metrics from current image.
            ai_client: Optional AI for vision-based comparison.
        """
        elapsed = 0
        if inp.baseline_date and inp.current_date:
            elapsed = (inp.current_date - inp.baseline_date).days

        # Calculate degradation metrics
        if baseline_metrics and current_metrics:
            metrics = self._calculate_metrics(
                baseline_metrics, current_metrics, elapsed
            )
        else:
            metrics = self._deterministic_comparison(inp, elapsed)

        # Overall trend
        trends = [m.trend for m in metrics]
        if any(t == "degrading" for t in trends):
            overall = "degrading"
        elif all(t == "improving" for t in trends):
            overall = "improving"
        else:
            overall = "stable"

        # Degradation rate per year
        deg_rate = None
        if elapsed > 0:
            area_changes = [
                m for m in metrics if "area" in m.metric_name.lower()
            ]
            if area_changes:
                avg_change = sum(m.change_absolute for m in area_changes) / len(area_changes)
                deg_rate = round((avg_change / elapsed) * 365, 4)

        # RBI calibration data
        rbi_data = None
        if metrics and elapsed > 365:
            rbi_data = {
                "elapsed_days": elapsed,
                "elapsed_years": round(elapsed / 365, 2),
                "metrics": [m.model_dump() for m in metrics],
                "degradation_rate_annual": deg_rate,
                "calibration_date": datetime.utcnow().isoformat(),
                "recommendation": (
                    "Use degradation rate to adjust RBI inspection interval. "
                    "Higher rate → shorter interval."
                ),
            }

        return ComparisonOutput(
            asset_id=inp.asset_id,
            baseline_date=inp.baseline_date,
            current_date=inp.current_date,
            elapsed_days=elapsed,
            degradation_metrics=metrics,
            overall_trend=overall,
            degradation_rate_per_year=deg_rate,
            rbi_calibration_data=rbi_data,
        )

    def _calculate_metrics(
        self,
        baseline: Dict[str, float],
        current: Dict[str, float],
        elapsed_days: int,
    ) -> List[DegradationMetric]:
        """Calculate degradation metrics from numeric measurements."""
        metrics = []
        all_keys = set(baseline.keys()) | set(current.keys())

        for key in sorted(all_keys):
            bval = baseline.get(key, 0.0)
            cval = current.get(key, 0.0)
            change_abs = cval - bval
            change_pct = ((cval - bval) / bval * 100) if bval != 0 else 0.0

            # Determine trend (positive change = degrading for area/damage metrics)
            if abs(change_pct) < 5:
                trend = "stable"
            elif change_abs > 0:
                trend = "degrading"
            else:
                trend = "improving"

            # RBI calibration factor
            rbi_factor = None
            if elapsed_days > 0 and abs(change_abs) > 0:
                annual_rate = (abs(change_abs) / elapsed_days) * 365
                rbi_factor = round(annual_rate, 4)

            metrics.append(DegradationMetric(
                metric_name=key,
                baseline_value=bval,
                current_value=cval,
                change_absolute=round(change_abs, 4),
                change_percent=round(change_pct, 2),
                trend=trend,
                rbi_calibration_factor=rbi_factor,
            ))

        return metrics

    def _deterministic_comparison(
        self, inp: ComparisonInput, elapsed_days: int
    ) -> List[DegradationMetric]:
        """Deterministic fallback when no metrics provided."""
        # Return placeholder metrics requiring AI for actual values
        return [
            DegradationMetric(
                metric_name="corrosion_area_percent",
                baseline_value=0.0,
                current_value=0.0,
                change_absolute=0.0,
                change_percent=0.0,
                trend="stable",
                rbi_calibration_factor=None,
            ),
            DegradationMetric(
                metric_name="surface_roughness_index",
                baseline_value=0.0,
                current_value=0.0,
                change_absolute=0.0,
                change_percent=0.0,
                trend="stable",
                rbi_calibration_factor=None,
            ),
        ]
