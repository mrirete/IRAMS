"""
Capital Planning Engine
═══════════════════════
Renewal-vs-repair TCO analysis, CAPEX forecasting,
and NPV/IRR calculations for capital investment decisions.
"""
from typing import List, Dict
from uuid import UUID

from ers_plan.schemas import (
    RenewalCandidate, TCOResult, CAPEXLineItem,
    CAPEXForecast, CapitalCategory
)


class CapitalPlanningEngine:
    """Engine for TCO analysis and CAPEX forecasting."""

    def __init__(self, discount_rate: float = 0.08):
        self.discount_rate = discount_rate  # 8% default

    def analyze_renewal_vs_repair(
        self,
        candidate: RenewalCandidate,
        analysis_horizon_years: int = 10
    ) -> TCOResult:
        """
        Compares Total Cost of Ownership for repair (run-to-condition)
        versus replacement over the analysis horizon.
        """
        remaining_life = max(
            candidate.expected_useful_life_years - candidate.current_age_years, 1.0
        )

        # Repair TCO: Escalating maintenance costs as asset degrades
        # Assume 5% annual maintenance escalation after 70% of useful life
        repair_tco = 0.0
        escalation_threshold = candidate.expected_useful_life_years * 0.7
        for year in range(1, analysis_horizon_years + 1):
            age_at_year = candidate.current_age_years + year
            escalation = 1.0
            if age_at_year > escalation_threshold:
                years_past = age_at_year - escalation_threshold
                escalation = 1.0 + (0.05 * years_past)  # 5% per year past threshold

            annual_cost = candidate.annual_maintenance_cost * escalation
            # NPV discount
            repair_tco += annual_cost / ((1 + self.discount_rate) ** year)

        # Replace TCO: Upfront replacement + lower maintenance on new asset
        # New asset maintenance = 40% of current (industry benchmark for new vs aged)
        new_maint_rate = candidate.annual_maintenance_cost * 0.4
        replace_tco = candidate.replacement_cost
        for year in range(1, analysis_horizon_years + 1):
            replace_tco += new_maint_rate / ((1 + self.discount_rate) ** year)

        # Find crossover year (when cumulative repair > cumulative replace)
        crossover = None
        cum_repair = 0.0
        cum_replace = candidate.replacement_cost
        for year in range(1, analysis_horizon_years + 1):
            age_at_year = candidate.current_age_years + year
            escalation = 1.0
            if age_at_year > escalation_threshold:
                years_past = age_at_year - escalation_threshold
                escalation = 1.0 + (0.05 * years_past)

            cum_repair += candidate.annual_maintenance_cost * escalation
            cum_replace += new_maint_rate

            if cum_repair >= cum_replace and crossover is None:
                crossover = year

        npv_savings = repair_tco - replace_tco

        if npv_savings > 0:
            rec = (
                f"REPLACE: NPV savings of ${npv_savings:,.0f} over {analysis_horizon_years} years. "
                f"Crossover at year {crossover}." if crossover else
                f"REPLACE: NPV savings of ${npv_savings:,.0f} over {analysis_horizon_years} years."
            )
        else:
            rec = (
                f"REPAIR: Replacement costs ${abs(npv_savings):,.0f} more over {analysis_horizon_years} years. "
                f"Continue condition-based maintenance."
            )

        return TCOResult(
            asset_id=candidate.asset_id,
            repair_tco=round(repair_tco, 2),
            replace_tco=round(replace_tco, 2),
            crossover_year=crossover,
            recommendation=rec,
            npv_savings=round(npv_savings, 2)
        )

    def generate_capex_forecast(
        self,
        candidates: List[RenewalCandidate],
        horizon_years: int = 5
    ) -> CAPEXForecast:
        """
        Generates a multi-year CAPEX forecast prioritizing assets by
        criticality and remaining useful life proximity.
        """
        line_items: List[CAPEXLineItem] = []
        current_year = 2026  # Base year

        # Sort by urgency: closest to end-of-life first, then by criticality
        sorted_candidates = sorted(
            candidates,
            key=lambda c: (
                c.expected_useful_life_years - c.current_age_years,
                {"A": 0, "B": 1, "C": 2}.get(c.criticality, 3)
            )
        )

        for candidate in sorted_candidates:
            remaining = candidate.expected_useful_life_years - candidate.current_age_years
            # Schedule replacement in the year remaining life runs out (floor at year 1)
            target_year_offset = max(1, min(int(remaining), horizon_years))
            target_year = current_year + target_year_offset

            if target_year_offset <= horizon_years:
                line_items.append(CAPEXLineItem(
                    asset_id=candidate.asset_id,
                    asset_name=candidate.asset_name,
                    category=CapitalCategory.RENEWAL,
                    year=target_year,
                    amount=candidate.replacement_cost,
                    justification=(
                        f"End of useful life in {remaining:.1f} years. "
                        f"Criticality {candidate.criticality}. "
                        f"Condition score: {candidate.condition_score}/100."
                    )
                ))

        # Compute annual totals
        annual_totals: Dict[int, float] = {}
        for item in line_items:
            annual_totals[item.year] = annual_totals.get(item.year, 0.0) + item.amount

        return CAPEXForecast(
            horizon_years=horizon_years,
            line_items=line_items,
            annual_totals=annual_totals,
            total_capex=round(sum(annual_totals.values()), 2)
        )
