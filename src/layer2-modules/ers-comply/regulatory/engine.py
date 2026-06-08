"""
Regulatory Preparedness Score Calculator
════════════════════════════════════════
Weighted score: inspection currency (20%), documentation completeness (20%),
corrective action closure (15%), personnel certification (15%),
MI program compliance (15%), IOW compliance (15%).

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
from datetime import datetime
from typing import Dict, List, Optional

import sys, os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../..')))

from ers_comply.schemas import (
    RegulatoryPreparednessOutput, RegulatorySubScore
)


# ── Weights per PROMPT 4.5 ──
WEIGHTS = {
    "inspection_currency": 0.20,
    "documentation_completeness": 0.20,
    "corrective_action_closure": 0.15,
    "personnel_certification": 0.15,
    "mi_program_compliance": 0.15,
    "iow_compliance": 0.15,
}


class RegulatoryPreparednessEngine:
    """
    Regulatory preparedness score calculator.

    Each sub-score is 0–100. The composite is a weighted sum.
    Grade: A (>=90), B (>=80), C (>=70), D (>=60), F (<60).
    """

    def calculate_score(
        self, metrics: Dict[str, float]
    ) -> RegulatoryPreparednessOutput:
        """
        Calculate regulatory preparedness score.

        Args:
            metrics: Dict mapping category names to raw scores (0–100).
                     Keys must match WEIGHTS keys.
        """
        sub_scores: List[RegulatorySubScore] = []
        total_weighted = 0.0

        for category, weight in WEIGHTS.items():
            raw = min(100.0, max(0.0, metrics.get(category, 0.0)))
            weighted = raw * weight
            total_weighted += weighted

            sub_scores.append(RegulatorySubScore(
                category=category,
                score=round(raw, 1),
                weight=weight,
                weighted_score=round(weighted, 2),
                details=self._get_details(category, raw),
            ))

        overall = round(total_weighted, 1)
        grade = self._get_grade(overall)
        recommendations = self._generate_recommendations(sub_scores)

        return RegulatoryPreparednessOutput(
            overall_score=overall,
            grade=grade,
            sub_scores=sub_scores,
            recommendations=recommendations,
        )

    def calculate_inspection_currency(
        self,
        total_equipment: int,
        equipment_current: int,
        equipment_overdue: int,
    ) -> float:
        """
        Inspection currency sub-score.

        Score = (current / total) * 100, penalized for overdue.
        """
        if total_equipment <= 0:
            return 100.0
        base = (equipment_current / total_equipment) * 100
        # Penalty: each overdue item reduces score by 5 points (capped)
        penalty = min(30, equipment_overdue * 5)
        return max(0.0, base - penalty)

    def calculate_ca_closure(
        self,
        total_actions: int,
        closed_actions: int,
        overdue_actions: int,
    ) -> float:
        """
        Corrective action closure sub-score.

        Score = (closed / total) * 100, penalized heavily for overdue.
        """
        if total_actions <= 0:
            return 100.0
        base = (closed_actions / total_actions) * 100
        penalty = min(40, overdue_actions * 10)
        return max(0.0, base - penalty)

    def calculate_iow_compliance(
        self,
        total_iows: int,
        iows_in_range: int,
        critical_breaches: int,
    ) -> float:
        """
        IOW compliance sub-score.

        Score = (in_range / total) * 100, critical breaches penalized heavily.
        """
        if total_iows <= 0:
            return 100.0
        base = (iows_in_range / total_iows) * 100
        penalty = min(50, critical_breaches * 20)
        return max(0.0, base - penalty)

    @staticmethod
    def _get_grade(score: float) -> str:
        """Convert score to letter grade."""
        if score >= 90:
            return "A"
        elif score >= 80:
            return "B"
        elif score >= 70:
            return "C"
        elif score >= 60:
            return "D"
        return "F"

    @staticmethod
    def _get_details(category: str, score: float) -> str:
        """Generate details string for a sub-score."""
        descriptions = {
            "inspection_currency": "Equipment with current inspections vs total registered",
            "documentation_completeness": "Required documents present and up-to-date",
            "corrective_action_closure": "Audit findings with completed corrective actions",
            "personnel_certification": "Inspectors and engineers with valid certifications",
            "mi_program_compliance": "Mechanical integrity program element compliance",
            "iow_compliance": "IOW parameters operating within defined limits",
        }
        desc = descriptions.get(category, category)
        if score >= 90:
            return f"{desc} — Excellent"
        elif score >= 70:
            return f"{desc} — Acceptable"
        elif score >= 50:
            return f"{desc} — Needs improvement"
        return f"{desc} — Critical gap"

    @staticmethod
    def _generate_recommendations(
        sub_scores: List[RegulatorySubScore]
    ) -> List[str]:
        """Generate actionable recommendations for low-scoring areas."""
        recs = []
        for ss in sub_scores:
            if ss.score < 60:
                recs.append(
                    f"CRITICAL: {ss.category.replace('_', ' ').title()} "
                    f"scored {ss.score:.0f}/100 — requires immediate action."
                )
            elif ss.score < 80:
                recs.append(
                    f"IMPROVE: {ss.category.replace('_', ' ').title()} "
                    f"scored {ss.score:.0f}/100 — improvement plan recommended."
                )
        return recs
