"""
RCA AI Pattern Detection
═════════════════════════
Cross-RCA pattern mining to identify recurring root causes
and suggest defect elimination campaigns.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Dict, List, Optional, Set
from uuid import UUID, uuid4

from ers_analyze.schemas import (
    GovernanceTier,
    RCAInvestigationRead,
    RCANodeType,
    RCAPatternMatch,
)


class RCAPatternDetector:
    """
    Cross-RCA pattern mining for recurring root causes.

    Analyzes completed RCA investigations to identify:
    - Recurring root causes across assets
    - Common failure patterns within asset classes
    - Trending root cause categories
    """

    # Common root cause keywords for clustering
    _CAUSE_CLUSTERS: Dict[str, List[str]] = {
        "lubrication": ["lubricat", "oil", "grease", "lube", "contaminat"],
        "vibration": ["vibrat", "imbalanc", "misalign", "resonan"],
        "corrosion": ["corros", "rust", "pitting", "eros", "oxidat"],
        "fatigue": ["fatigu", "crack", "fractur", "stress"],
        "operator_error": ["operator", "human error", "procedur", "training"],
        "design_deficiency": ["design", "undersiz", "specification", "material select"],
        "installation": ["install", "alignment", "torque", "fitment"],
        "overload": ["overload", "exceed", "capacity", "over-pressure"],
        "contamination": ["contaminat", "foreign", "debris", "dirt"],
        "thermal": ["thermal", "overheat", "temperatur", "cool"],
    }

    def detect_patterns(
        self,
        investigations: List[RCAInvestigationRead],
        min_frequency: int = 2,
    ) -> List[RCAPatternMatch]:
        """
        Detect recurring patterns across multiple RCA investigations.

        Returns patterns sorted by frequency (descending).
        """
        # Extract root causes from all investigations
        cause_inventory: Dict[str, List[Dict]] = defaultdict(list)

        for inv in investigations:
            root_causes = [
                n for n in inv.nodes
                if n.is_root_cause or n.node_type == RCANodeType.ROOT_CAUSE
            ]

            for rc in root_causes:
                cluster = self._classify_cause(rc.description)
                cause_inventory[cluster].append({
                    "investigation_id": inv.id,
                    "asset_id": inv.asset_id,
                    "description": rc.description,
                })

        # Filter by minimum frequency
        patterns: List[RCAPatternMatch] = []
        for cluster, occurrences in cause_inventory.items():
            if len(occurrences) < min_frequency:
                continue

            # Unique affected assets
            asset_ids = list({occ["asset_id"] for occ in occurrences})

            # Calculate confidence based on frequency and consistency
            confidence = self._calculate_pattern_confidence(
                frequency=len(occurrences),
                total_investigations=len(investigations),
            )

            # Generate recommended action
            action = self._generate_recommendation(cluster, len(occurrences))

            patterns.append(
                RCAPatternMatch(
                    pattern_id=uuid4(),
                    recurring_cause=self._cluster_to_description(cluster),
                    frequency=len(occurrences),
                    affected_asset_ids=asset_ids,
                    affected_asset_classes=[],  # would be populated from asset data
                    confidence=confidence,
                    recommended_action=action,
                    governance_tier=GovernanceTier.TIER_2_HUMAN_REVIEW,
                )
            )

        # Sort by frequency
        patterns.sort(key=lambda p: p.frequency, reverse=True)
        return patterns

    def _classify_cause(self, description: str) -> str:
        """Classify a root cause description into a cluster."""
        desc_lower = description.lower()

        for cluster, keywords in self._CAUSE_CLUSTERS.items():
            for kw in keywords:
                if kw in desc_lower:
                    return cluster

        return "other"

    def _calculate_pattern_confidence(
        self, frequency: int, total_investigations: int
    ) -> float:
        """Calculate confidence in a detected pattern."""
        if total_investigations == 0:
            return 0.3

        ratio = frequency / total_investigations

        # Scale: 2 matches → 0.4, 5+ → 0.7, 10+ → 0.85
        if frequency >= 10:
            base = 0.85
        elif frequency >= 5:
            base = 0.55 + (frequency - 5) * 0.06
        elif frequency >= 2:
            base = 0.35 + (frequency - 2) * 0.066
        else:
            base = 0.30

        return min(base + ratio * 0.05, 0.90)

    def _cluster_to_description(self, cluster: str) -> str:
        """Convert cluster name to readable description."""
        descriptions = {
            "lubrication": "Lubrication-related failures (contamination, inadequate lubrication)",
            "vibration": "Vibration-related failures (imbalance, misalignment)",
            "corrosion": "Corrosion/erosion mechanisms",
            "fatigue": "Fatigue/cracking (cyclic stress, material degradation)",
            "operator_error": "Operator/human error (procedures, training)",
            "design_deficiency": "Design deficiency (material selection, sizing)",
            "installation": "Installation quality issues (alignment, torque)",
            "overload": "Overload conditions (exceeding design limits)",
            "contamination": "Contamination (foreign material, debris)",
            "thermal": "Thermal issues (overheating, inadequate cooling)",
            "other": "Unclassified root causes",
        }
        return descriptions.get(cluster, f"Root cause cluster: {cluster}")

    def _generate_recommendation(self, cluster: str, frequency: int) -> str:
        """Generate a recommended action for a recurring pattern."""
        recommendations = {
            "lubrication": "Review lubrication program. Consider oil analysis, automatic lubrication systems, and contamination control.",
            "vibration": "Implement vibration monitoring program. Review alignment procedures and balancing criteria.",
            "corrosion": "Review material selection and corrosion protection. Consider cathodic protection or chemical inhibitors.",
            "fatigue": "Review operating load profiles. Consider design modifications or load reduction strategies.",
            "operator_error": "Review operating procedures and training programs. Consider automation of critical steps.",
            "design_deficiency": "Initiate design review. Consider Defect Elimination campaign for design-related failures.",
            "installation": "Review installation quality standards. Implement pre-commissioning checklists.",
            "overload": "Review operating limits and protection systems. Consider capacity upgrades.",
            "contamination": "Improve filtration and cleanliness standards. Review storage and handling procedures.",
            "thermal": "Review cooling systems and thermal protection. Consider heat exchangers or ventilation improvements.",
        }
        rec = recommendations.get(cluster, "Investigate and address recurring failure pattern.")
        return f"{rec} (Detected {frequency} times — Defect Elimination candidate)"
