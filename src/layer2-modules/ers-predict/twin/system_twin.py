"""
ERS Predict — System-Level Digital Twin
═══════════════════════════════════════
Composes individual asset twins using Knowledge Graph topology
(Asset-FEEDS-Asset edges). Supports series/parallel/k-of-n
reliability block diagrams and bottleneck identification.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from ..schemas import (
    BottleneckAsset,
    SystemTopology,
    SystemTopologyNode,
)
from .single_asset import AssetDigitalTwin


class SystemDigitalTwin:
    """
    System-level twin composing individual asset twins into a
    reliability block diagram (RBD) for system availability
    calculation and bottleneck identification.
    """

    def __init__(self, unit_id: UUID, unit_name: str = "System"):
        self.unit_id = unit_id
        self.unit_name = unit_name
        self.asset_twins: Dict[UUID, AssetDigitalTwin] = {}
        self.topology: Optional[SystemTopologyNode] = None

    def register_twin(self, twin: AssetDigitalTwin) -> None:
        """Register an individual asset twin for inclusion in the system."""
        self.asset_twins[twin.asset_id] = twin

    def build_topology(self, topology_config: Dict[str, Any]) -> SystemTopologyNode:
        """
        Build RBD topology from configuration.

        Config format:
        {
            "asset_id": "uuid",
            "name": "Main Pump",
            "type": "series",  # series, parallel, k_of_n
            "k": 2,  # only for k_of_n
            "children": [
                {"asset_id": "uuid2", "name": "Sub A", "type": "series", "children": []},
                {"asset_id": "uuid3", "name": "Sub B", "type": "parallel", "children": []}
            ]
        }
        """
        self.topology = self._build_node(topology_config)
        return self.topology

    def compute_system_reliability(self) -> SystemTopology:
        """
        Compute system reliability from individual twin health indices
        through the RBD topology.
        """
        if not self.topology:
            return SystemTopology(
                unit_id=self.unit_id,
                unit_name=self.unit_name,
                system_reliability=0.0,
                topology=SystemTopologyNode(
                    asset_id=self.unit_id,
                    asset_name=self.unit_name,
                ),
                computed_at=datetime.now(tz=timezone.utc),
            )

        # Compute reliability bottom-up
        self._compute_node_reliability(self.topology)

        return SystemTopology(
            unit_id=self.unit_id,
            unit_name=self.unit_name,
            system_reliability=round(self.topology.reliability, 6),
            topology=self.topology,
            computed_at=datetime.now(tz=timezone.utc),
        )

    def identify_bottlenecks(self, top_n: int = 5) -> List[BottleneckAsset]:
        """
        Identify bottleneck assets — those whose degradation has
        disproportionate impact on system reliability.

        Method: Remove each asset (set R=0) and measure system
        reliability drop. Rank by impact.
        """
        if not self.topology:
            return []

        # Baseline system reliability
        self._compute_node_reliability(self.topology)
        baseline = self.topology.reliability

        impacts: List[BottleneckAsset] = []

        for asset_id, twin in self.asset_twins.items():
            # Save original health
            original_health = twin.health_index

            # Simulate failure (health = 0)
            twin.health_index = 0.0
            self._compute_node_reliability(self.topology)
            degraded = self.topology.reliability

            # Restore
            twin.health_index = original_health

            # Impact = how much system reliability drops
            impact_pct = max(0.0, (baseline - degraded) * 100.0)

            # Failure probability from health
            fail_prob = max(0.0, (100 - twin.health_index) / 100) ** 2

            impacts.append(BottleneckAsset(
                asset_id=asset_id,
                asset_name=twin.asset_class,
                health_index=round(twin.health_index, 2),
                system_impact_pct=round(impact_pct, 2),
                failure_probability_30d=round(fail_prob * 0.5, 4),
                rank=0,
                recommended_action=self._bottleneck_action(twin.health_index, impact_pct),
            ))

        # Restore baseline computation
        self._compute_node_reliability(self.topology)

        # Sort by impact (highest first)
        impacts.sort(key=lambda x: x.system_impact_pct, reverse=True)
        for i, b in enumerate(impacts[:top_n]):
            b.rank = i + 1

        return impacts[:top_n]

    # ── Internal methods ──

    def _build_node(self, config: Dict[str, Any]) -> SystemTopologyNode:
        """Recursively build topology tree."""
        asset_id_str = config.get("asset_id", "")
        try:
            asset_id = UUID(asset_id_str) if asset_id_str else self.unit_id
        except ValueError:
            asset_id = self.unit_id

        twin = self.asset_twins.get(asset_id)
        health = twin.health_index if twin else 100.0

        children = [
            self._build_node(child_config)
            for child_config in config.get("children", [])
        ]

        conn_type = config.get("type", "series")
        k = config.get("k")
        n = len(children) if children else None

        return SystemTopologyNode(
            asset_id=asset_id,
            asset_name=config.get("name", "Unknown"),
            reliability=health / 100.0,
            health_index=health,
            is_bottleneck=False,
            children=children,
            connection_type=conn_type,
            k_required=k,
            n_total=n,
        )

    def _compute_node_reliability(self, node: SystemTopologyNode) -> float:
        """
        Recursively compute reliability through the RBD.

        Series: R_sys = R1 × R2 × ... × Rn
        Parallel: R_sys = 1 - (1-R1)(1-R2)...(1-Rn)
        k-of-n: R_sys = Σ C(n,k) R^k (1-R)^(n-k) for j>=k
        """
        # Leaf node: use asset health as reliability
        if not node.children:
            twin = self.asset_twins.get(node.asset_id)
            if twin:
                node.health_index = twin.health_index
                node.reliability = twin.health_index / 100.0
            return node.reliability

        # Compute children first
        child_reliabilities = [
            self._compute_node_reliability(child)
            for child in node.children
        ]

        if node.connection_type == "parallel":
            # R_sys = 1 - Π(1 - R_i)
            unreliability = 1.0
            for r in child_reliabilities:
                unreliability *= (1.0 - r)
            node.reliability = 1.0 - unreliability

        elif node.connection_type == "k_of_n":
            k = node.k_required or 1
            n = len(child_reliabilities)
            node.reliability = self._k_of_n_reliability(child_reliabilities, k)

        else:  # series (default)
            # R_sys = Π R_i
            r = 1.0
            for ri in child_reliabilities:
                r *= ri
            node.reliability = r

        node.health_index = node.reliability * 100.0
        return node.reliability

    @staticmethod
    def _k_of_n_reliability(reliabilities: List[float], k: int) -> float:
        """
        Calculate k-of-n system reliability (at least k of n must work).
        Assumes identical components for simplification.
        Uses average reliability for binomial calculation.
        """
        n = len(reliabilities)
        if k > n:
            return 0.0
        if k <= 0:
            return 1.0

        avg_r = sum(reliabilities) / n if n > 0 else 0.0

        # Binomial: P(X >= k) = Σ C(n,j) r^j (1-r)^(n-j) for j=k..n
        system_r = 0.0
        for j in range(k, n + 1):
            comb = _binomial_coeff(n, j)
            system_r += comb * (avg_r ** j) * ((1 - avg_r) ** (n - j))

        return max(0.0, min(1.0, system_r))

    @staticmethod
    def _bottleneck_action(health: float, impact: float) -> str:
        """Generate action recommendation for a bottleneck asset."""
        if health < 30 and impact > 20:
            return "CRITICAL — Immediate intervention. Schedule emergency maintenance."
        elif health < 50 and impact > 10:
            return "Schedule priority maintenance within 7 days."
        elif health < 70 and impact > 5:
            return "Plan maintenance in next PM cycle. Consider redundancy."
        elif impact > 15:
            return "High system dependency — evaluate adding standby equipment."
        return "Monitor — no immediate action required."


def _binomial_coeff(n: int, k: int) -> int:
    """Calculate binomial coefficient C(n, k)."""
    if k < 0 or k > n:
        return 0
    if k == 0 or k == n:
        return 1
    k = min(k, n - k)
    result = 1
    for i in range(k):
        result = result * (n - i) // (i + 1)
    return result
