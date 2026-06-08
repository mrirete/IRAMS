"""
Criticality Assessment — Semi-Quantitative Risk Matrix
═══════════════════════════════════════════════════════════
5×5 consequence-likelihood matrix (ISO 31000 aligned).
Feeds ERS Predict priority queue.
"""

from __future__ import annotations

from typing import Dict, List, Optional
from uuid import UUID

from ers_analyze.schemas import CriticalityInput, CriticalityResult


class CriticalityMatrix:
    """
    Semi-quantitative criticality assessment using a 5×5 risk matrix.

    Consequence dimensions (1-5 each):
    - Safety: personnel injury potential
    - Environmental: environmental impact
    - Production: production/revenue impact
    - Reputation: brand/regulatory impact
    - Financial: direct financial cost

    Likelihood (1-5): probability of occurrence

    Criticality Rank:
    - A (Safety Critical): risk_score >= 15 OR safety consequence >= 4
    - B (Important):       risk_score >= 8
    - C (Standard):        risk_score < 8

    Auto-defaults:
    - Turbines, compressors, generators → Criticality A
    """

    # Asset classes that auto-default to Criticality A
    AUTO_CRITICALITY_A: set = {
        "turbine", "compressor", "generator", "gas_turbine",
        "steam_turbine", "centrifugal_compressor", "reciprocating_compressor",
        "emergency_generator", "fire_pump", "safety_valve", "bop", "esdv",
    }

    # Risk matrix: (max_consequence, likelihood) → risk_score color
    RISK_DESCRIPTIONS: Dict[str, str] = {
        "extreme": "Extreme risk — immediate action required",
        "high": "High risk — senior management attention needed",
        "medium": "Medium risk — management responsibility specified",
        "low": "Low risk — manage by routine procedures",
    }

    def assess(
        self,
        inp: CriticalityInput,
        asset_class: Optional[str] = None,
    ) -> CriticalityResult:
        """
        Run criticality assessment.

        Args:
            inp: Assessment input with consequence scores and likelihood
            asset_class: Optional asset class for auto-defaults
        """
        # Calculate maximum consequence across all dimensions
        max_consequence = max(
            inp.consequence_safety,
            inp.consequence_environmental,
            inp.consequence_production,
            inp.consequence_reputation,
            inp.consequence_financial,
        )

        # Risk score = max consequence × likelihood
        risk_score = max_consequence * inp.likelihood

        # Determine criticality rank
        rank = self._determine_rank(
            risk_score=risk_score,
            safety_consequence=inp.consequence_safety,
            environmental_consequence=inp.consequence_environmental,
            asset_class=asset_class,
        )

        # Risk matrix cell
        cell = f"{max_consequence}-{inp.likelihood}"

        return CriticalityResult(
            asset_id=inp.asset_id,
            consequence_safety=inp.consequence_safety,
            consequence_environmental=inp.consequence_environmental,
            consequence_production=inp.consequence_production,
            consequence_reputation=inp.consequence_reputation,
            consequence_financial=inp.consequence_financial,
            likelihood=inp.likelihood,
            max_consequence=max_consequence,
            overall_risk_score=risk_score,
            criticality_rank=rank,
            risk_matrix_cell=cell,
        )

    def _determine_rank(
        self,
        risk_score: float,
        safety_consequence: int,
        environmental_consequence: int,
        asset_class: Optional[str] = None,
    ) -> str:
        """
        Determine criticality rank.

        Rules:
        1. Auto-Criticality A for specific asset classes (turbines, etc.)
        2. Criticality A if safety ≥ 4 or environmental ≥ 4
        3. Criticality A if risk_score ≥ 15
        4. Criticality B if risk_score ≥ 8
        5. Criticality C otherwise
        """
        # Rule 1: Auto-defaults
        if asset_class and asset_class.lower() in self.AUTO_CRITICALITY_A:
            return "A"

        # Rule 2: High safety or environmental consequence
        if safety_consequence >= 4 or environmental_consequence >= 4:
            return "A"

        # Rule 3-5: Risk score thresholds
        if risk_score >= 15:
            return "A"
        elif risk_score >= 8:
            return "B"
        else:
            return "C"

    def get_risk_level(self, max_consequence: int, likelihood: int) -> str:
        """Get risk level description from matrix position."""
        score = max_consequence * likelihood

        if score >= 20:
            return "extreme"
        elif score >= 12:
            return "high"
        elif score >= 6:
            return "medium"
        else:
            return "low"

    def batch_assess(
        self,
        assessments: List[Dict],
    ) -> List[CriticalityResult]:
        """
        Run criticality assessment for multiple assets.

        Args:
            assessments: List of {"input": CriticalityInput, "asset_class": str}
        """
        return [
            self.assess(
                inp=a["input"],
                asset_class=a.get("asset_class"),
            )
            for a in assessments
        ]
