"""
Monte Carlo Simulation Engine — Numpy Vectorized
══════════════════════════════════════════════════
Single-asset and system-level reliability simulation.
10K–1M iterations, series/parallel/k-of-n topologies.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID, uuid4

import numpy as np

from ers_analyze.schemas import (
    MonteCarloComparison,
    MonteCarloResult,
    MonteCarloSingleInput,
    MonteCarloSystemInput,
    SparePartsDemand,
)


class MonteCarloEngine:
    """
    Numpy-vectorized Monte Carlo reliability simulation.

    Supports:
    - Single asset: life/failure/repair/PM cycles over N years
    - System-level: series/parallel/k-of-n from topology
    - Scenario comparison: baseline vs proposed
    """

    def __init__(self, seed: Optional[int] = None):
        self._rng = np.random.default_rng(seed)

    # ─── Single-Asset Simulation ─────────────────────────────

    def simulate_single(self, inp: MonteCarloSingleInput) -> MonteCarloResult:
        """
        Run single-asset Monte Carlo simulation.

        Generates N iterations of:
        failure_time → repair → (repeat over simulation_years)
        Optionally includes PM events.
        """
        n = inp.iterations
        sim_hours = inp.simulation_years * 8760

        # Generate failure-time samples for each iteration
        ttf_samples = self._sample_failure_times(
            inp.failure_distribution,
            inp.distribution_params,
            n,
            sim_hours,
        )

        # Simulate repair times
        repair_times = self._rng.normal(
            inp.repair_time_hours,
            inp.repair_time_std,
            size=n,
        )
        repair_times = np.clip(repair_times, 1.0, None)  # minimum 1h repair

        # Calculate metrics per iteration
        total_failures = np.zeros(n)
        total_downtime = np.zeros(n)
        total_cost = np.zeros(n)

        for i in range(n):
            times = ttf_samples[i]
            n_failures = 0
            downtime = 0.0
            cost = 0.0
            clock = 0.0

            for ttf in times:
                if clock + ttf > sim_hours:
                    break
                clock += ttf
                n_failures += 1
                repair = max(1.0, self._rng.normal(inp.repair_time_hours, inp.repair_time_std))
                downtime += repair
                cost += inp.failure_cost
                clock += repair

            # Add PM events
            if inp.pm_interval_hours and inp.pm_interval_hours > 0:
                n_pms = int(sim_hours / inp.pm_interval_hours)
                pm_downtime = n_pms * inp.pm_duration_hours
                downtime += pm_downtime
                cost += n_pms * inp.pm_cost

            total_failures[i] = n_failures
            total_downtime[i] = downtime
            total_cost[i] = cost

        # Calculate availability
        availability = (sim_hours - total_downtime) / sim_hours
        availability = np.clip(availability, 0.0, 1.0)

        # Calculate MTBF / MTTR
        mtbf_values = np.where(
            total_failures > 0,
            sim_hours / total_failures,
            sim_hours,
        )
        mttr_values = np.where(
            total_failures > 0,
            total_downtime / total_failures,
            0.0,
        )

        # Confidence interval
        ci_95 = (
            float(np.percentile(availability, 2.5)),
            float(np.percentile(availability, 97.5)),
        )

        return MonteCarloResult(
            asset_id=inp.asset_id,
            iterations=n,
            availability_mean=float(np.mean(availability)),
            availability_std=float(np.std(availability)),
            availability_ci_95=ci_95,
            mtbf_mean=float(np.mean(mtbf_values)),
            mtbf_std=float(np.std(mtbf_values)),
            mttr_mean=float(np.mean(mttr_values)),
            total_failures_mean=float(np.mean(total_failures)),
            total_cost_mean=float(np.mean(total_cost)),
            total_cost_std=float(np.std(total_cost)),
            percentiles={
                "p5": float(np.percentile(availability, 5)),
                "p25": float(np.percentile(availability, 25)),
                "p50": float(np.percentile(availability, 50)),
                "p75": float(np.percentile(availability, 75)),
                "p95": float(np.percentile(availability, 95)),
            },
        )

    # ─── System-Level Simulation ─────────────────────────────

    def simulate_system(self, inp: MonteCarloSystemInput) -> MonteCarloResult:
        """
        System-level Monte Carlo using topology structure.

        Topology format:
        {
            "type": "series" | "parallel" | "k_of_n",
            "k": 2,  (for k_of_n only)
            "children": [
                {"asset_idx": 0},  # leaf node
                {"type": "parallel", "children": [...]}  # nested
            ]
        }
        """
        n = inp.iterations
        sim_hours = inp.simulation_years * 8760

        # Simulate each asset independently
        asset_availabilities = []
        for asset_inp in inp.asset_params:
            result = self.simulate_single(asset_inp)
            # Generate per-iteration availability samples
            avail_samples = self._rng.normal(
                result.availability_mean,
                result.availability_std,
                size=n,
            )
            avail_samples = np.clip(avail_samples, 0.0, 1.0)
            asset_availabilities.append(avail_samples)

        if not asset_availabilities:
            return MonteCarloResult(
                unit_id=inp.unit_id,
                iterations=n,
                availability_mean=1.0,
                availability_std=0.0,
                availability_ci_95=(1.0, 1.0),
                mtbf_mean=sim_hours,
                mtbf_std=0.0,
                mttr_mean=0.0,
                total_failures_mean=0.0,
                total_cost_mean=0.0,
                total_cost_std=0.0,
            )

        # Calculate system availability using topology
        topology = inp.topology or {"type": "series"}
        system_avail = self._evaluate_topology(
            topology, asset_availabilities, n
        )

        ci_95 = (
            float(np.percentile(system_avail, 2.5)),
            float(np.percentile(system_avail, 97.5)),
        )

        # Aggregate costs
        total_costs = np.zeros(n)
        total_failures = np.zeros(n)
        for asset_inp in inp.asset_params:
            result = self.simulate_single(asset_inp)
            total_costs += self._rng.normal(
                result.total_cost_mean, result.total_cost_std, size=n
            )
            total_failures += self._rng.normal(
                result.total_failures_mean, max(1.0, result.total_failures_mean * 0.2), size=n
            )
        total_failures = np.clip(total_failures, 0, None)

        return MonteCarloResult(
            unit_id=inp.unit_id,
            iterations=n,
            availability_mean=float(np.mean(system_avail)),
            availability_std=float(np.std(system_avail)),
            availability_ci_95=ci_95,
            mtbf_mean=float(np.mean(sim_hours * system_avail)),
            mtbf_std=float(np.std(sim_hours * system_avail)),
            mttr_mean=float(np.mean(sim_hours * (1 - system_avail))),
            total_failures_mean=float(np.mean(total_failures)),
            total_cost_mean=float(np.mean(total_costs)),
            total_cost_std=float(np.std(total_costs)),
            percentiles={
                "p5": float(np.percentile(system_avail, 5)),
                "p50": float(np.percentile(system_avail, 50)),
                "p95": float(np.percentile(system_avail, 95)),
            },
        )

    # ─── Scenario Comparison ─────────────────────────────────

    def compare_scenarios(
        self,
        baseline: MonteCarloSingleInput,
        proposed: MonteCarloSingleInput,
    ) -> MonteCarloComparison:
        """Compare two scenarios (e.g., different PM intervals)."""
        base_result = self.simulate_single(baseline)
        prop_result = self.simulate_single(proposed)

        delta_avail = prop_result.availability_mean - base_result.availability_mean
        delta_cost = prop_result.total_cost_mean - base_result.total_cost_mean
        delta_mtbf = prop_result.mtbf_mean - base_result.mtbf_mean

        # Generate recommendation
        if delta_avail > 0.01 and delta_cost < 0:
            rec = "RECOMMENDED: Proposed scenario improves availability AND reduces cost."
        elif delta_avail > 0.01:
            rec = f"CONSIDER: Proposed scenario improves availability by {delta_avail:.2%} but increases cost by ${abs(delta_cost):,.0f}."
        elif delta_cost < 0:
            rec = f"CONSIDER: Proposed scenario reduces cost by ${abs(delta_cost):,.0f} with {abs(delta_avail):.2%} availability change."
        else:
            rec = "NOT RECOMMENDED: Proposed scenario does not improve availability or cost."

        return MonteCarloComparison(
            baseline=base_result,
            proposed=prop_result,
            delta_availability=delta_avail,
            delta_cost=delta_cost,
            delta_mtbf=delta_mtbf,
            recommendation=rec,
        )

    # ─── Internal Methods ────────────────────────────────────

    def _sample_failure_times(
        self,
        distribution: str,
        params: Dict[str, float],
        n_iterations: int,
        sim_hours: float,
    ) -> List[List[float]]:
        """Generate failure time samples for each iteration."""
        results = []

        # Estimate max failures per iteration for pre-allocation
        if distribution == "weibull":
            beta = params.get("beta", 2.0)
            eta = params.get("eta", 5000.0)
            avg_ttf = eta * math.gamma(1 + 1 / beta)
        elif distribution == "lognormal":
            mu = params.get("mu", 8.0)
            sigma = params.get("sigma", 0.5)
            avg_ttf = math.exp(mu + sigma ** 2 / 2)
        elif distribution == "exponential":
            lam = params.get("lambda", 0.001)
            avg_ttf = 1.0 / lam if lam > 0 else sim_hours
        else:
            avg_ttf = 5000.0

        max_failures = int(sim_hours / max(avg_ttf * 0.3, 1.0)) + 10

        for _ in range(n_iterations):
            ttfs = self._generate_ttf_batch(distribution, params, max_failures)
            results.append(ttfs.tolist())

        return results

    def _generate_ttf_batch(
        self,
        distribution: str,
        params: Dict[str, float],
        count: int,
    ) -> np.ndarray:
        """Generate a batch of time-to-failure values."""
        if distribution == "weibull":
            beta = params.get("beta", 2.0)
            eta = params.get("eta", 5000.0)
            # Weibull: T = eta * (-ln(U))^(1/beta)
            u = self._rng.random(count)
            return eta * (-np.log(1 - u)) ** (1.0 / beta)

        elif distribution == "lognormal":
            mu = params.get("mu", 8.0)
            sigma = params.get("sigma", 0.5)
            return self._rng.lognormal(mu, sigma, count)

        elif distribution == "exponential":
            lam = params.get("lambda", 0.001)
            return self._rng.exponential(1.0 / lam if lam > 0 else 5000.0, count)

        else:
            # Default: Weibull(2, 5000)
            u = self._rng.random(count)
            return 5000.0 * (-np.log(1 - u)) ** 0.5

    def _evaluate_topology(
        self,
        topology: Dict[str, Any],
        asset_avails: List[np.ndarray],
        n: int,
    ) -> np.ndarray:
        """Recursively evaluate system topology."""
        ttype = topology.get("type", "series")
        children = topology.get("children", [])

        if not children:
            # If no children defined, combine all assets in the given mode
            if ttype == "series":
                result = np.ones(n)
                for a in asset_avails:
                    result *= a
                return result
            elif ttype == "parallel":
                result = np.ones(n)
                for a in asset_avails:
                    result *= (1.0 - a)
                return 1.0 - result
            else:
                # k_of_n
                k = topology.get("k", 1)
                return self._k_of_n_availability(asset_avails, k, n)

        # Evaluate each child
        child_avails = []
        for child in children:
            if "asset_idx" in child:
                idx = child["asset_idx"]
                if idx < len(asset_avails):
                    child_avails.append(asset_avails[idx])
            else:
                # Nested topology
                child_avail = self._evaluate_topology(child, asset_avails, n)
                child_avails.append(child_avail)

        if not child_avails:
            return np.ones(n)

        if ttype == "series":
            result = np.ones(n)
            for ca in child_avails:
                result *= ca
            return result
        elif ttype == "parallel":
            result = np.ones(n)
            for ca in child_avails:
                result *= (1.0 - ca)
            return 1.0 - result
        else:
            # k_of_n
            k = topology.get("k", 1)
            return self._k_of_n_availability(child_avails, k, n)

    def _k_of_n_availability(
        self,
        avails: List[np.ndarray],
        k: int,
        n: int,
    ) -> np.ndarray:
        """Calculate k-of-n system availability via Monte Carlo."""
        total = len(avails)
        if k > total:
            return np.zeros(n)

        # For each iteration, count how many components are "up"
        # Component i is up if random() < availability_i
        result = np.zeros(n)
        for iteration in range(n):
            up_count = sum(
                1 for a in avails
                if self._rng.random() < a[iteration]
            )
            result[iteration] = 1.0 if up_count >= k else 0.0
        return result
