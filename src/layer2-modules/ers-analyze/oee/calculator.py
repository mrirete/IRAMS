"""
OEE Calculator — Overall Equipment Effectiveness Engine
═══════════════════════════════════════════════════════
Availability, Performance, and Quality calculations conforming to standard
industrial reliability metrics. Accounts for speed capping and equivalent loss hours.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List
from uuid import UUID

from ers_analyze.schemas import (
    OEEInput,
    OEEResult,
    OEETrendAnalysis,
    OEETrendPoint,
)


class OEECalculator:
    """
    Core engine for computing Overall Equipment Effectiveness (OEE) and loss hours.

    Formulas:
    - Uptime = Planned Time - Downtime
    - Availability = Uptime / Planned Time
    - Performance = Total Units / (Ideal Rate * Uptime) (Capped at 1.0 for OEE product)
    - Quality = Good Units / Total Units
    - OEE = Availability * Performance * Quality
    """

    def calculate_oee(self, inp: OEEInput) -> OEEResult:
        """
        Calculate OEE, sub-metrics, and equivalent loss hours for an asset.

        Args:
            inp: OEE calculation parameters
        """
        # Ensure planned time is positive and validate boundaries
        planned_time = max(0.0, inp.planned_production_time_hours)
        downtime = max(0.0, inp.downtime_hours)
        
        if downtime > planned_time:
            downtime = planned_time

        uptime = planned_time - downtime

        # 1. Availability
        if planned_time <= 0.0:
            availability = 0.0
        else:
            availability = max(0.0, min(1.0, uptime / planned_time))

        # 2. Performance (with capacity capping)
        ideal_rate = max(0.0, inp.ideal_rate)
        total_produced = max(0.0, inp.total_units_produced)
        
        if uptime <= 0.0 or ideal_rate <= 0.0:
            raw_performance = 0.0
            performance = 0.0
        else:
            raw_performance = total_produced / (ideal_rate * uptime)
            # Cap OEE Performance multiplicand at 1.0 to prevent masking other losses
            performance = max(0.0, min(1.0, raw_performance))

        # 3. Quality
        good_produced = max(0.0, inp.good_units_produced)
        if good_produced > total_produced:
            good_produced = total_produced

        rejected_produced = max(0.0, total_produced - good_produced)

        if total_produced <= 0.0:
            # If nothing was produced, there are no quality losses.
            quality = 1.0
        else:
            quality = max(0.0, min(1.0, good_produced / total_produced))

        # 4. Overall OEE
        oee = availability * performance * quality

        # 5. Equivalent Loss Hours
        availability_loss_hours = downtime
        performance_loss_hours = uptime * (1.0 - performance)
        quality_loss_equivalent_hours = uptime * performance * (1.0 - quality)
        
        total_loss = (
            availability_loss_hours
            + performance_loss_hours
            + quality_loss_equivalent_hours
        )

        return OEEResult(
            asset_id=inp.asset_id,
            planned_production_time_hours=planned_time,
            downtime_hours=downtime,
            uptime_hours=uptime,
            ideal_rate=ideal_rate,
            total_units_produced=total_produced,
            good_units_produced=good_produced,
            rejected_units_produced=rejected_produced,
            availability=availability,
            performance=performance,
            raw_performance=raw_performance,
            quality=quality,
            oee=oee,
            availability_loss_hours=availability_loss_hours,
            performance_loss_hours=performance_loss_hours,
            quality_loss_equivalent_hours=quality_loss_equivalent_hours,
            total_loss_hours=total_loss,
            recorded_at=inp.recorded_at or datetime.now(tz=timezone.utc),
        )

    def calculate_batch_oee(self, inputs: List[OEEInput]) -> List[OEEResult]:
        """Calculate OEE for multiple inputs."""
        return [self.calculate_oee(inp) for inp in inputs]

    def analyze_trends(self, history: List[OEEResult]) -> OEETrendAnalysis:
        """
        Analyze OEE metrics over a chronological sequence of points.

        Args:
            history: List of historical OEEResults
        """
        if not history:
            raise ValueError("History list cannot be empty")

        # Get asset ID from the first item
        asset_id = history[0].asset_id

        # Sort history chronologically by recorded_at
        sorted_history = sorted(history, key=lambda r: r.recorded_at)

        # Sums for averages
        total_planned = sum(r.planned_production_time_hours for r in sorted_history)
        total_downtime = sum(r.downtime_hours for r in sorted_history)
        total_good = sum(r.good_units_produced for r in sorted_history)
        total_units = sum(r.total_units_produced for r in sorted_history)

        n = len(sorted_history)
        avg_oee = sum(r.oee for r in sorted_history) / n
        avg_avail = sum(r.availability for r in sorted_history) / n
        avg_perf = sum(r.performance for r in sorted_history) / n
        avg_qual = sum(r.quality for r in sorted_history) / n

        # Trend status: compare second half vs first half of history
        trend_status = "stable"
        if n >= 2:
            mid = n // 2
            first_half = sorted_history[:mid]
            second_half = sorted_history[mid:]
            
            avg_oee_first = sum(r.oee for r in first_half) / len(first_half)
            avg_oee_second = sum(r.oee for r in second_half) / len(second_half)
            
            delta = avg_oee_second - avg_oee_first
            if delta > 0.01:
                trend_status = "improving"
            elif delta < -0.01:
                trend_status = "worsening"

        # Build trend points
        trend_points = [
            OEETrendPoint(
                recorded_at=r.recorded_at,
                oee=r.oee,
                availability=r.availability,
                performance=r.performance,
                quality=r.quality,
            )
            for r in sorted_history
        ]

        return OEETrendAnalysis(
            asset_id=asset_id,
            average_oee=avg_oee,
            average_availability=avg_avail,
            average_performance=avg_perf,
            average_quality=avg_qual,
            total_planned_hours=total_planned,
            total_downtime_hours=total_downtime,
            total_good_units=total_good,
            total_units=total_units,
            trend_status=trend_status,
            history=trend_points,
        )

    def compare_assets(self, assets: List[OEEResult]) -> List[OEEResult]:
        """
        Rank a collection of assets based on their OEE score (descending).

        Args:
            assets: List of computed OEEResults
        """
        return sorted(assets, key=lambda r: (r.oee, r.availability, r.performance), reverse=True)
