"""
Bad Actor Analyzer — Pareto Analysis + Trend Tracking
══════════════════════════════════════════════════════════
Monthly automated Top 5 ranking by cost, downtime, or WO frequency.
Auto-drafts Defect Elimination campaigns for top actors.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from ers_analyze.schemas import (
    BadActorAsset,
    BadActorCriteria,
    BadActorReportOutput,
    DefectEliminationCampaign,
    DefectSource,
)


class BadActorAnalyzer:
    """
    Automated Pareto analysis for identifying worst-performing assets.

    Driven by user-specified rules:
    - Monthly automated "Top 5 Bad Actors"
    - Criteria: cost, downtime, WO frequency
    - Generates Defect Elimination tasks for top actors
    """

    def __init__(self):
        self._reports: Dict[str, BadActorReportOutput] = {}

    def generate_report(
        self,
        period: str,
        criteria: BadActorCriteria,
        asset_data: List[Dict[str, Any]],
        top_n: int = 5,
        pareto_threshold: float = 80.0,
    ) -> BadActorReportOutput:
        """
        Generate a bad actor Pareto report.

        Args:
            period: Report period string (e.g., "2026-01")
            criteria: Ranking criteria (cost, downtime, wo_frequency)
            asset_data: List of dicts with:
                - asset_id: UUID
                - asset_name: str
                - cost: float (total maintenance cost)
                - downtime_hours: float
                - wo_count: int
                - previous_rank: Optional[int]
            top_n: Number of top bad actors to highlight
            pareto_threshold: Pareto threshold percentage
        """
        if not asset_data:
            return BadActorReportOutput(
                report_period=period,
                criteria=criteria,
            )

        # Select metric based on criteria
        metric_key = {
            BadActorCriteria.COST: "cost",
            BadActorCriteria.DOWNTIME: "downtime_hours",
            BadActorCriteria.WO_FREQUENCY: "wo_count",
        }[criteria]

        metric_unit = {
            BadActorCriteria.COST: "$",
            BadActorCriteria.DOWNTIME: "hours",
            BadActorCriteria.WO_FREQUENCY: "count",
        }[criteria]

        # Sort descending by selected metric
        sorted_assets = sorted(
            asset_data,
            key=lambda a: a.get(metric_key, 0),
            reverse=True,
        )

        # Calculate total
        total_metric = sum(a.get(metric_key, 0) for a in sorted_assets)

        # Build ranked list with cumulative percentage
        ranked: List[BadActorAsset] = []
        cumulative = 0.0

        for rank, asset in enumerate(sorted_assets[:top_n], 1):
            metric_val = asset.get(metric_key, 0)
            pct = (metric_val / total_metric * 100.0) if total_metric > 0 else 0.0
            cumulative += pct

            # Determine trend
            prev_rank = asset.get("previous_rank")
            trend = self._determine_trend(rank, prev_rank)

            ranked.append(
                BadActorAsset(
                    asset_id=asset["asset_id"],
                    asset_name=asset.get("asset_name", "Unknown"),
                    rank=rank,
                    metric_value=metric_val,
                    metric_unit=metric_unit,
                    pct_of_total=pct,
                    cumulative_pct=cumulative,
                    trend=trend,
                    previous_rank=prev_rank,
                )
            )

        # Top 5 contribution
        top5_pct = cumulative if len(ranked) >= top_n else cumulative

        report = BadActorReportOutput(
            report_period=period,
            criteria=criteria,
            top_assets=ranked,
            total_assets_analyzed=len(asset_data),
            pareto_threshold_pct=pareto_threshold,
            top_5_pct_of_total=top5_pct,
        )

        self._reports[f"{period}_{criteria.value}"] = report
        return report

    def auto_draft_de_campaigns(
        self,
        report: BadActorReportOutput,
        max_campaigns: int = 3,
    ) -> List[DefectEliminationCampaign]:
        """
        Auto-draft Defect Elimination campaigns for top bad actors.

        Only creates campaigns for assets exceeding the Pareto threshold
        or in top 3 positions.
        """
        campaigns: List[DefectEliminationCampaign] = []

        for asset in report.top_assets[:max_campaigns]:
            # Infer likely defect source from trend
            source = self._infer_defect_source(asset)

            campaign = DefectEliminationCampaign(
                id=uuid4(),
                asset_id=asset.asset_id,
                asset_name=asset.asset_name,
                title=(
                    f"DE Campaign: {asset.asset_name} — "
                    f"Bad Actor #{asset.rank} ({report.criteria.value}: "
                    f"{asset.metric_value:,.0f} {asset.metric_unit})"
                ),
                defect_source=source,
                problem_description=(
                    f"Asset ranked #{asset.rank} in {report.report_period} "
                    f"for {report.criteria.value}. "
                    f"Contributes {asset.pct_of_total:.1f}% of total. "
                    f"Trend: {asset.trend}."
                ),
                status="identified",
            )
            campaigns.append(campaign)

        return campaigns

    def _determine_trend(
        self, current_rank: int, previous_rank: Optional[int]
    ) -> str:
        """Determine trend from rank change."""
        if previous_rank is None:
            return "stable"  # no history
        if current_rank < previous_rank:
            return "worsening"  # moved up in bad actor list
        elif current_rank > previous_rank:
            return "improving"  # moved down
        return "stable"

    def _infer_defect_source(self, asset: BadActorAsset) -> DefectSource:
        """
        Infer most likely defect source from bad actor characteristics.

        This is a heuristic — actual determination requires RCA.
        """
        if asset.trend == "worsening":
            return DefectSource.OPERATION  # operating conditions degrading
        if asset.rank == 1:
            return DefectSource.DESIGN  # perennial worst → likely design issue
        return DefectSource.MAINTENANCE  # default assumption
