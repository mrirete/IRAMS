"""
Scenario Modelling Engine
═════════════════════════
Monte Carlo simulation for what-if capital and maintenance scenarios.
Compares NPV, risk exposure, and asset availability across strategies.
"""
import random
import math
from typing import List, Dict, Optional
from uuid import UUID

from ers_plan.schemas import (
    ScenarioInput, ScenarioVariable, MonteCarloResult, ScenarioComparison
)


class ScenarioModellingEngine:
    """Engine for Monte Carlo what-if analysis."""

    def run_simulation(self, scenario: ScenarioInput) -> MonteCarloResult:
        """
        Runs Monte Carlo simulation based on defined variable distributions.
        Computes NPV distribution statistics.
        """
        npv_samples = []

        for _ in range(scenario.iterations):
            sample_values = {}
            for var in scenario.variables:
                sample_values[var.name] = self._sample(var)

            # NPV is the sum of all sampled cash flow variables
            # In production, this connects to a configurable financial model.
            npv = sum(sample_values.values())
            npv_samples.append(npv)

        npv_samples.sort()
        n = len(npv_samples)

        mean_npv = sum(npv_samples) / n
        std_dev = math.sqrt(sum((x - mean_npv) ** 2 for x in npv_samples) / n)

        p10 = npv_samples[int(n * 0.10)]
        p50 = npv_samples[int(n * 0.50)]
        p90 = npv_samples[int(n * 0.90)]

        losses = [x for x in npv_samples if x < 0]
        prob_loss = (len(losses) / n) * 100.0
        risk_exposure = abs(sum(losses) / n) if losses else 0.0

        return MonteCarloResult(
            scenario_id=scenario.scenario_id,
            scenario_name=scenario.name,
            mean_npv=round(mean_npv, 2),
            p10_npv=round(p10, 2),
            p50_npv=round(p50, 2),
            p90_npv=round(p90, 2),
            std_dev=round(std_dev, 2),
            probability_of_loss=round(prob_loss, 2),
            risk_exposure=round(risk_exposure, 2)
        )

    def compare_scenarios(self, scenarios: List[ScenarioInput]) -> ScenarioComparison:
        """Runs multiple simulations and recommends the best scenario."""
        results = [self.run_simulation(s) for s in scenarios]

        # Recommend scenario with highest risk-adjusted return
        # Score = mean_npv - (0.5 × risk_exposure)
        scored = [(r, r.mean_npv - 0.5 * r.risk_exposure) for r in results]
        scored.sort(key=lambda x: x[1], reverse=True)

        best = scored[0][0]
        rationale = (
            f"'{best.scenario_name}' offers the best risk-adjusted return. "
            f"Mean NPV: ${best.mean_npv:,.0f}, P(Loss): {best.probability_of_loss}%, "
            f"Risk Exposure: ${best.risk_exposure:,.0f}."
        )

        return ScenarioComparison(
            scenarios=results,
            recommended_scenario_id=best.scenario_id,
            recommendation_rationale=rationale
        )

    def _sample(self, var: ScenarioVariable) -> float:
        """Samples from the specified distribution."""
        p = var.params

        if var.distribution == "normal":
            return random.gauss(p.get("mean", 0), p.get("std", 1))

        elif var.distribution == "triangular":
            return random.triangular(
                p.get("min", 0),
                p.get("max", 1),
                p.get("mode", 0.5)
            )

        elif var.distribution == "uniform":
            return random.uniform(p.get("min", 0), p.get("max", 1))

        else:
            return p.get("mean", 0)
