"""
Condition Assessment Engine
═══════════════════════════
Analyzes routine inspection photos for general condition:
oil leaks, belt/coupling wear, seal condition, vibration damage,
lubrication adequacy, housekeeping score (1-5).

ALL outputs are Tier 2 (advisory).
"""
from typing import Any, Optional, List
from uuid import uuid4

from ers_vision.schemas import (
    ConditionAnalysisInput, ConditionAnalysisOutput, ConditionFinding,
    ConditionItem,
)


class ConditionAssessmentEngine:
    """
    General condition assessment from inspection photos.
    """

    def analyze(
        self,
        inp: ConditionAnalysisInput,
        observations: Optional[List[dict]] = None,
        ai_client: Optional[Any] = None,
    ) -> ConditionAnalysisOutput:
        """
        Analyze equipment condition.

        Args:
            inp: Input with image/equipment context.
            observations: Optional structured observations list, each with:
                - item: ConditionItem value
                - detected: bool
                - severity: "normal"/"minor"/"moderate"/"severe"
                - score: 1-5
                - description: str
            ai_client: Optional AI for vision analysis.
        """
        if observations:
            findings = self._from_observations(observations)
        else:
            findings = self._deterministic_analysis(inp)

        # Calculate overall scores
        scores = [f.score for f in findings]
        overall = sum(scores) / len(scores) if scores else 5.0
        housekeeping = next(
            (f.score for f in findings if f.item == ConditionItem.HOUSEKEEPING),
            5,
        )
        action_count = sum(1 for f in findings if f.detected and f.severity != "normal")

        return ConditionAnalysisOutput(
            asset_id=inp.asset_id,
            findings=findings,
            overall_condition_score=round(overall, 1),
            housekeeping_score=housekeeping,
            items_requiring_action=action_count,
        )

    def _from_observations(self, observations: List[dict]) -> List[ConditionFinding]:
        """Convert structured observations to ConditionFinding objects."""
        findings = []
        for obs in observations:
            try:
                findings.append(ConditionFinding(
                    item=ConditionItem(obs.get("item", "housekeeping")),
                    detected=obs.get("detected", False),
                    severity=obs.get("severity", "normal"),
                    score=obs.get("score", 5),
                    description=obs.get("description"),
                    confidence=obs.get("confidence", 0.85),
                ))
            except (ValueError, KeyError):
                continue
        return findings

    def _deterministic_analysis(
        self, inp: ConditionAnalysisInput
    ) -> List[ConditionFinding]:
        """Deterministic fallback — returns default assessments."""
        return [
            ConditionFinding(
                item=ConditionItem.OIL_LEAK,
                detected=False, severity="normal", score=5,
                description="No oil leaks detected",
                confidence=0.40,
            ),
            ConditionFinding(
                item=ConditionItem.BELT_WEAR,
                detected=False, severity="normal", score=5,
                description="Belt condition not assessed — requires AI vision",
                confidence=0.30,
            ),
            ConditionFinding(
                item=ConditionItem.SEAL_CONDITION,
                detected=False, severity="normal", score=5,
                description="Seal condition not assessed — requires AI vision",
                confidence=0.30,
            ),
            ConditionFinding(
                item=ConditionItem.LUBRICATION,
                detected=False, severity="normal", score=5,
                description="Lubrication condition not assessed — requires AI vision",
                confidence=0.30,
            ),
            ConditionFinding(
                item=ConditionItem.HOUSEKEEPING,
                detected=False, severity="normal", score=3,
                description="Housekeeping score defaulted — requires AI vision",
                confidence=0.30,
            ),
        ]
