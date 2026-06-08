"""
Opportunity Module Engine
═════════════════════════
AI-identified improvements ranked by ROI × strategic alignment,
factored by implementation complexity.
"""
from typing import Dict, List, Optional
from uuid import UUID

from ers_plan.schemas import (
    OpportunityEntry, OpportunityComplexity, RankedOpportunities
)

# Complexity discount factors (higher complexity = reduced ranking score)
_COMPLEXITY_FACTOR = {
    OpportunityComplexity.LOW: 1.0,
    OpportunityComplexity.MEDIUM: 0.7,
    OpportunityComplexity.HIGH: 0.4,
}


class OpportunityEngine:
    """Engine for ranking improvement opportunities by ROI and strategic alignment."""

    def __init__(self):
        self._opportunities: Dict[UUID, OpportunityEntry] = {}

    def register_opportunity(self, opp: OpportunityEntry) -> OpportunityEntry:
        """Registers and scores an opportunity."""
        # Calculate ROI
        if opp.implementation_cost > 0:
            opp.roi_percent = round(
                (opp.estimated_annual_savings / opp.implementation_cost) * 100.0, 2
            )
        else:
            opp.roi_percent = float('inf') if opp.estimated_annual_savings > 0 else 0.0

        # Composite ranked score = (ROI% × alignment × complexity_factor) / 100
        complexity_mult = _COMPLEXITY_FACTOR.get(opp.complexity, 0.5)
        alignment = opp.strategic_alignment_score if opp.strategic_alignment_score > 0 else 1.0

        if opp.roi_percent == float('inf'):
            opp.ranked_score = alignment * complexity_mult * 100.0
        else:
            opp.ranked_score = round(
                (opp.roi_percent * alignment * complexity_mult) / 100.0, 2
            )

        self._opportunities[opp.opportunity_id] = opp
        return opp

    def get_ranked(self, top_n: int = 10) -> RankedOpportunities:
        """Returns opportunities ranked by composite score descending."""
        ranked = sorted(
            self._opportunities.values(),
            key=lambda o: o.ranked_score,
            reverse=True
        )[:top_n]

        total_savings = sum(o.estimated_annual_savings for o in ranked)

        return RankedOpportunities(
            opportunities=ranked,
            total_potential_savings=round(total_savings, 2)
        )
