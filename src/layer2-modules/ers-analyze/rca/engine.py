"""
RCA Engine — Multi-Method Root Cause Analysis
═══════════════════════════════════════════════
5-Why, Fishbone (Ishikawa), Fault Tree Analysis (FTA),
and Barrier Analysis with probability propagation.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Set
from uuid import UUID, uuid4

from ers_analyze.schemas import (
    FishboneCategory,
    RCAInvestigationCreate,
    RCAInvestigationRead,
    RCAMethod,
    RCANodeInput,
    RCANodeRead,
    RCANodeType,
)


class RCAEngine:
    """
    Multi-method Root Cause Analysis engine.

    Supports:
    - 5-Why: Linear cause chain up to 5 levels
    - Fishbone: 6M categories (Man, Machine, Method, Material, Measurement, Environment)
    - FTA: AND/OR gate tree with probability propagation
    - Barrier: Identify failed, absent, and effective barriers
    """

    def __init__(self):
        self._investigations: Dict[UUID, RCAInvestigationRead] = {}
        self._nodes: Dict[UUID, RCANodeRead] = {}  # all nodes by ID
        self._inv_nodes: Dict[UUID, List[UUID]] = defaultdict(list)  # inv_id → [node_ids]

    def create_investigation(
        self, inp: RCAInvestigationCreate
    ) -> RCAInvestigationRead:
        """Create a new RCA investigation."""
        inv_id = uuid4()

        # Create root node based on method
        root_type = {
            RCAMethod.FIVE_WHY: RCANodeType.PROBLEM,
            RCAMethod.FISHBONE: RCANodeType.PROBLEM,
            RCAMethod.FTA: RCANodeType.TOP_EVENT,
            RCAMethod.BARRIER: RCANodeType.PROBLEM,
        }.get(inp.method, RCANodeType.PROBLEM)

        root_node = RCANodeRead(
            id=uuid4(),
            parent_id=None,
            node_type=root_type,
            description=inp.problem_statement,
            depth=0,
        )

        self._nodes[root_node.id] = root_node
        self._inv_nodes[inv_id].append(root_node.id)

        investigation = RCAInvestigationRead(
            id=inv_id,
            asset_id=inp.asset_id,
            title=inp.title,
            method=inp.method,
            problem_statement=inp.problem_statement,
            nodes=[root_node],
        )
        self._investigations[inv_id] = investigation
        return investigation

    def add_node(
        self, investigation_id: UUID, node_input: RCANodeInput
    ) -> RCANodeRead:
        """Add a node to an investigation."""
        parent_depth = 0
        if node_input.parent_id and node_input.parent_id in self._nodes:
            parent_depth = self._nodes[node_input.parent_id].depth

        node = RCANodeRead(
            id=uuid4(),
            parent_id=node_input.parent_id,
            node_type=node_input.node_type,
            description=node_input.description,
            depth=parent_depth + 1,
            probability=node_input.probability,
            fishbone_category=node_input.fishbone_category,
            evidence=node_input.evidence,
            is_root_cause=node_input.is_root_cause,
        )

        self._nodes[node.id] = node
        self._inv_nodes[investigation_id].append(node.id)

        # Attach to parent's children
        if node_input.parent_id and node_input.parent_id in self._nodes:
            self._nodes[node_input.parent_id].children.append(node)

        # Update investigation node list
        if investigation_id in self._investigations:
            inv = self._investigations[investigation_id]
            inv.nodes.append(node)
            if node.is_root_cause:
                inv.root_causes.append(node)

        return node

    def get_investigation(self, investigation_id: UUID) -> Optional[RCAInvestigationRead]:
        """Get a complete investigation."""
        return self._investigations.get(investigation_id)

    # ─── 5-Why Specific Methods ──────────────────────────────

    def build_five_why_chain(
        self,
        investigation_id: UUID,
        causes: List[str],
        evidence: Optional[List[str]] = None,
    ) -> List[RCANodeRead]:
        """
        Build a complete 5-Why chain from a list of cause descriptions.

        Returns the created nodes.
        """
        inv = self._investigations.get(investigation_id)
        if not inv or not inv.nodes:
            return []

        root = inv.nodes[0]
        parent_id = root.id
        nodes = []

        for i, cause_desc in enumerate(causes):
            is_root = (i == len(causes) - 1)  # last one is root cause
            node_type = RCANodeType.ROOT_CAUSE if is_root else RCANodeType.WHY

            node = self.add_node(
                investigation_id,
                RCANodeInput(
                    parent_id=parent_id,
                    node_type=node_type,
                    description=cause_desc,
                    evidence=evidence[i] if evidence and i < len(evidence) else None,
                    is_root_cause=is_root,
                ),
            )
            nodes.append(node)
            parent_id = node.id

        return nodes

    # ─── Fishbone Specific Methods ───────────────────────────

    def build_fishbone(
        self,
        investigation_id: UUID,
        causes_by_category: Dict[FishboneCategory, List[str]],
    ) -> Dict[str, List[RCANodeRead]]:
        """
        Build a Fishbone (Ishikawa) diagram from categorized causes.

        Returns nodes grouped by category.
        """
        inv = self._investigations.get(investigation_id)
        if not inv or not inv.nodes:
            return {}

        root = inv.nodes[0]
        result: Dict[str, List[RCANodeRead]] = {}

        for category, causes in causes_by_category.items():
            # Create category node
            cat_node = self.add_node(
                investigation_id,
                RCANodeInput(
                    parent_id=root.id,
                    node_type=RCANodeType.CATEGORY,
                    description=f"Category: {category.value}",
                    fishbone_category=category,
                ),
            )

            cat_causes = []
            for cause_desc in causes:
                cause_node = self.add_node(
                    investigation_id,
                    RCANodeInput(
                        parent_id=cat_node.id,
                        node_type=RCANodeType.SUB_CAUSE,
                        description=cause_desc,
                        fishbone_category=category,
                    ),
                )
                cat_causes.append(cause_node)

            result[category.value] = cat_causes

        return result

    # ─── FTA Specific Methods ────────────────────────────────

    def calculate_fta_probability(self, investigation_id: UUID) -> float:
        """
        Calculate top event probability using FTA gate logic.

        AND gate: P(A ∩ B) = P(A) × P(B)
        OR gate:  P(A ∪ B) = 1 - (1-P(A)) × (1-P(B))
        """
        inv = self._investigations.get(investigation_id)
        if not inv or not inv.nodes:
            return 0.0

        root = inv.nodes[0]
        return self._propagate_probability(root)

    def _propagate_probability(self, node: RCANodeRead) -> float:
        """Recursively propagate probability through FTA gates."""
        # Leaf node: use assigned probability
        if not node.children:
            return node.probability or 0.5  # default 50% for unassigned

        child_probs = [self._propagate_probability(c) for c in node.children]

        if node.node_type == RCANodeType.GATE_AND:
            # AND: product of all children
            result = 1.0
            for p in child_probs:
                result *= p
            return result
        elif node.node_type == RCANodeType.GATE_OR:
            # OR: 1 - product of (1-p) for all children
            result = 1.0
            for p in child_probs:
                result *= (1.0 - p)
            return 1.0 - result
        else:
            # For other nodes (top_event, problem), treat as OR gate
            result = 1.0
            for p in child_probs:
                result *= (1.0 - p)
            return 1.0 - result

    # ─── Barrier Analysis Methods ────────────────────────────

    def summarize_barriers(
        self, investigation_id: UUID
    ) -> Dict[str, List[RCANodeRead]]:
        """
        Summarize barriers by status (failed, absent, effective).
        """
        node_ids = self._inv_nodes.get(investigation_id, [])
        barriers: Dict[str, List[RCANodeRead]] = {
            "failed": [],
            "absent": [],
            "effective": [],
        }

        for nid in node_ids:
            node = self._nodes.get(nid)
            if not node:
                continue
            if node.node_type == RCANodeType.BARRIER_FAILED:
                barriers["failed"].append(node)
            elif node.node_type == RCANodeType.BARRIER_ABSENT:
                barriers["absent"].append(node)
            elif node.node_type == RCANodeType.BARRIER_EFFECTIVE:
                barriers["effective"].append(node)

        return barriers
