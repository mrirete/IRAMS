"""
ERS Predict — What-If Scenario Engine
════════════════════════════════════════
Runs proposed changes through degradation models and Monte Carlo
simulation to project availability, failure probability, cost
impact, risk score, and sustainability impact.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from ..schemas import (
    GovernanceTier,
    ScenarioInput,
    ScenarioMetrics,
    ScenarioOutput,
)
from .single_asset import AssetDigitalTwin


class ScenarioEngine:
    """
    What-if scenario engine for the Reliability Digital Twin.

    Process:
        1. Take current twin state as baseline
        2. Apply proposed change (PM interval, operating param, strategy)
        3. Run degradation model under new conditions
        4. Execute Monte Carlo simulation for statistical confidence
        5. Compare baseline vs proposed with confidence intervals
    """

    def __init__(self, default_monte_carlo_runs: int = 1000):
        self.default_runs = default_monte_carlo_runs

    def run_scenario(
        self,
        twin: AssetDigitalTwin,
        scenario: ScenarioInput,
    ) -> ScenarioOutput:
        """
        Execute a what-if scenario against the digital twin.

        Args:
            twin: The asset's digital twin (current state).
            scenario: Proposed change configuration.

        Returns:
            ScenarioOutput with baseline vs projected metrics.
        """
        runs = scenario.monte_carlo_runs or self.default_runs

        # 1. Baseline metrics (current conditions projected 1 year)
        baseline = self._simulate(twin, scenario.parameters, is_baseline=True, runs=runs)

        # 2. Projected metrics (with proposed change)
        projected = self._simulate(twin, scenario.parameters, is_baseline=False, runs=runs)

        # 3. Delta calculation
        delta = self._compute_delta(baseline, projected)

        # 4. Recommendation
        recommendation = self._generate_recommendation(scenario, baseline, projected, delta)

        # Governance tier based on impact magnitude
        governance = GovernanceTier.TIER_3_STANDARD
        if abs(delta.get("availability_pct", 0)) > 5.0 or abs(delta.get("annual_cost", 0)) > 50000:
            governance = GovernanceTier.TIER_4_SUPERVISED

        return ScenarioOutput(
            scenario_name=scenario.scenario_name,
            baseline=baseline,
            projected=projected,
            delta=delta,
            recommendation=recommendation,
            governance_tier=governance,
        )

    def _simulate(
        self,
        twin: AssetDigitalTwin,
        params: Dict[str, Any],
        is_baseline: bool,
        runs: int,
    ) -> ScenarioMetrics:
        """Run Monte Carlo simulation for baseline or proposed scenario."""
        availability_results: List[float] = []
        failure_prob_results: List[float] = []
        cost_results: List[float] = []
        rul_results: List[float] = []

        for _ in range(runs):
            # Base health with random perturbation
            base_health = twin.health_index + random.gauss(0, 3.0)
            base_health = max(0, min(100, base_health))

            if is_baseline:
                # Current conditions projected forward
                daily_deg = self._estimate_degradation_rate(twin, params, is_baseline=True)
            else:
                # Modified conditions
                daily_deg = self._estimate_degradation_rate(twin, params, is_baseline=False)

            # Simulate 365 days
            health_at_year = base_health - (daily_deg * 365)
            health_at_year += random.gauss(0, 5.0)  # noise
            health_at_year = max(0, min(100, health_at_year))

            # Failure probability based on health
            fail_prob = max(0, (100 - health_at_year) / 100) ** 2
            fail_prob = max(0.0, min(1.0, fail_prob + random.gauss(0, 0.05)))

            # Availability: inverse of failure probability with PM uptime
            pm_downtime_pct = params.get("pm_downtime_pct", 2.0) if not is_baseline else 2.0
            availability = max(0, 100 - fail_prob * 20 - pm_downtime_pct)

            # Cost estimation
            pm_cost = params.get("annual_pm_cost", 5000) if not is_baseline else 5000
            failure_cost = params.get("failure_cost", 50000) * fail_prob
            total_cost = pm_cost + failure_cost

            # RUL estimation
            if daily_deg > 0:
                rul = health_at_year / daily_deg
            else:
                rul = 3650  # 10 years if no degradation

            availability_results.append(availability)
            failure_prob_results.append(fail_prob)
            cost_results.append(total_cost)
            rul_results.append(rul)

        # Compute statistics
        return ScenarioMetrics(
            availability_pct=round(self._mean(availability_results), 2),
            failure_probability_1y=round(self._mean(failure_prob_results), 4),
            annual_cost=round(self._mean(cost_results), 2),
            risk_score=round(self._mean(failure_prob_results) * 100, 2),
            sustainability_impact=round(
                self._mean(cost_results) * 0.001, 2  # rough CO2e proxy
            ),
            rul_days=round(self._mean(rul_results), 1),
            confidence_interval_50=self._percentile_interval(rul_results, 25, 75),
            confidence_interval_80=self._percentile_interval(rul_results, 10, 90),
            confidence_interval_95=self._percentile_interval(rul_results, 2.5, 97.5),
        )

    def _estimate_degradation_rate(
        self,
        twin: AssetDigitalTwin,
        params: Dict[str, Any],
        is_baseline: bool,
    ) -> float:
        """Estimate daily degradation rate under given conditions."""
        base_rate = 0.1  # default

        # From twin's existing rate
        if len(twin._predicted_history) >= 2:
            first = twin._predicted_history[0]
            last = twin._predicted_history[-1]
            days = (last[0] - first[0]).total_seconds() / 86400
            if days > 0:
                base_rate = max(0.01, (first[1] - last[1]) / days)

        if is_baseline:
            return base_rate

        # Apply scenario modifications
        change_type = params.get("change_type", "")

        if change_type == "pm_interval":
            current_interval = params.get("current_days", 90)
            proposed_interval = params.get("proposed_days", 60)
            if proposed_interval < current_interval:
                # More frequent PM → slower degradation
                ratio = proposed_interval / max(current_interval, 1)
                return base_rate * (0.5 + 0.5 * ratio)
            else:
                # Less frequent PM → faster degradation
                ratio = proposed_interval / max(current_interval, 1)
                return base_rate * ratio

        elif change_type == "operating_param":
            current_val = params.get("current", 100)
            proposed_val = params.get("proposed", 80)
            # Lower operating stress → slower degradation
            stress_ratio = proposed_val / max(current_val, 1)
            return base_rate * max(0.3, stress_ratio ** 1.5)

        elif change_type == "strategy":
            current_strat = params.get("current", "run_to_failure")
            proposed_strat = params.get("proposed", "condition_based")
            strategy_factors = {
                "run_to_failure": 1.0,
                "time_based": 0.7,
                "condition_based": 0.5,
                "predictive": 0.4,
            }
            factor = strategy_factors.get(proposed_strat, 0.7)
            return base_rate * factor

        return base_rate * 0.9  # default 10% improvement

    @staticmethod
    def _compute_delta(baseline: ScenarioMetrics, projected: ScenarioMetrics) -> Dict[str, float]:
        """Compute deltas between baseline and projected metrics."""
        return {
            "availability_pct": round(projected.availability_pct - baseline.availability_pct, 2),
            "failure_probability_1y": round(projected.failure_probability_1y - baseline.failure_probability_1y, 4),
            "annual_cost": round(projected.annual_cost - baseline.annual_cost, 2),
            "risk_score": round(projected.risk_score - baseline.risk_score, 2),
            "sustainability_impact": round(projected.sustainability_impact - baseline.sustainability_impact, 2),
            "rul_days": round(projected.rul_days - baseline.rul_days, 1),
        }

    @staticmethod
    def _generate_recommendation(
        scenario: ScenarioInput,
        baseline: ScenarioMetrics,
        projected: ScenarioMetrics,
        delta: Dict[str, float],
    ) -> str:
        """Generate human-readable recommendation from scenario results."""
        cost_change = delta.get("annual_cost", 0)
        avail_change = delta.get("availability_pct", 0)
        risk_change = delta.get("risk_score", 0)

        parts: List[str] = [f"Scenario: {scenario.scenario_name}"]

        if avail_change > 1.0:
            parts.append(f"Availability improves by {avail_change:.1f}%")
        elif avail_change < -1.0:
            parts.append(f"⚠ Availability drops by {abs(avail_change):.1f}%")

        if cost_change < -1000:
            parts.append(f"Annual cost savings: ${abs(cost_change):,.0f}")
        elif cost_change > 1000:
            parts.append(f"Annual cost increase: ${cost_change:,.0f}")

        if risk_change < -5:
            parts.append("Risk reduction — recommended")
        elif risk_change > 5:
            parts.append("⚠ Risk increase — additional review required")

        return " | ".join(parts)

    @staticmethod
    def _mean(values: List[float]) -> float:
        return sum(values) / max(len(values), 1)

    @staticmethod
    def _percentile_interval(
        values: List[float],
        lo_pct: float,
        hi_pct: float,
    ) -> tuple[float, float]:
        sorted_vals = sorted(values)
        n = len(sorted_vals)
        if n == 0:
            return (0.0, 0.0)
        lo_idx = max(0, int(n * lo_pct / 100))
        hi_idx = min(n - 1, int(n * hi_pct / 100))
        return (round(sorted_vals[lo_idx], 1), round(sorted_vals[hi_idx], 1))
