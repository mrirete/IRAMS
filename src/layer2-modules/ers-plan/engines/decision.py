"""
Decision Framework Engine (ISO 55002 Clause 4.5)
═════════════════════════════════════════════════
Multi-Criteria Decision Analysis (MCDA) with weighted scoring.
Immutable Tier 4 decision records with full audit trail.
"""
from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from ers_plan.schemas import (
    DecisionCriterion, DecisionOption, MCDAResult,
    DecisionRecord, DecisionStatus
)


class DecisionFrameworkEngine:
    """Engine for ISO 55002 Clause 4.5 decision-making with MCDA."""

    def __init__(self):
        self._records: Dict[UUID, DecisionRecord] = {}

    def create_decision(
        self,
        title: str,
        context: str,
        criteria: List[DecisionCriterion],
        options: List[DecisionOption]
    ) -> DecisionRecord:
        """Creates a new decision record with criteria and options."""
        record = DecisionRecord(
            title=title,
            context=context,
            criteria=criteria,
            options=options,
            audit_trail=[{
                "action": "CREATED",
                "timestamp": datetime.utcnow().isoformat(),
                "detail": f"Decision '{title}' created with {len(criteria)} criteria and {len(options)} options."
            }]
        )
        self._records[record.decision_id] = record
        return record

    def evaluate(self, decision_id: UUID, evaluator_id: UUID) -> DecisionRecord:
        """
        Performs MCDA evaluation: Normalize scores, apply weights, rank options.
        Weighted Additive Model (SAW): Score = Σ(weight_i × normalized_score_i)
        """
        record = self._records.get(decision_id)
        if not record:
            raise ValueError(f"Decision {decision_id} not found")

        criteria_by_id = {c.criterion_id: c for c in record.criteria}

        # Normalize weights so they sum to 1.0
        total_weight = sum(c.weight for c in record.criteria)
        if total_weight <= 0:
            raise ValueError("Criteria weights must sum to > 0")

        normalized_weights = {c.criterion_id: c.weight / total_weight for c in record.criteria}

        # Calculate weighted scores for each option
        results: List[MCDAResult] = []
        for option in record.options:
            weighted_score = 0.0
            norm_scores: Dict[str, float] = {}

            for criterion in record.criteria:
                raw = option.scores.get(criterion.criterion_id, 0.0)
                # Normalize to 0-1 range based on criterion scale
                scale_range = criterion.scale_max - criterion.scale_min
                if scale_range > 0:
                    normalized = (raw - criterion.scale_min) / scale_range
                else:
                    normalized = 0.0
                normalized = max(0.0, min(1.0, normalized))  # Clamp

                weight = normalized_weights[criterion.criterion_id]
                weighted_score += normalized * weight
                norm_scores[criterion.name] = round(normalized, 4)

            results.append(MCDAResult(
                option_id=option.option_id,
                option_name=option.name,
                weighted_score=round(weighted_score, 4),
                normalized_scores=norm_scores,
                rank=0  # Set after sorting
            ))

        # Sort by weighted score descending and assign ranks
        results.sort(key=lambda r: r.weighted_score, reverse=True)
        for i, r in enumerate(results):
            r.rank = i + 1

        record.results = results
        record.status = DecisionStatus.EVALUATED
        record.evaluated_by = evaluator_id
        record.audit_trail.append({
            "action": "EVALUATED",
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": str(evaluator_id),
            "detail": f"MCDA scoring completed. Top option: '{results[0].option_name}' (score: {results[0].weighted_score})"
        })

        return record

    def approve_decision(
        self,
        decision_id: UUID,
        approver_id: UUID,
        selected_option_id: UUID,
        rationale: str
    ) -> DecisionRecord:
        """Tier 4 approval — locks the decision with full audit trail."""
        record = self._records.get(decision_id)
        if not record:
            raise ValueError(f"Decision {decision_id} not found")
        if record.status != DecisionStatus.EVALUATED:
            raise ValueError("Decision must be evaluated before approval")

        record.selected_option_id = selected_option_id
        record.rationale = rationale
        record.approved_by = approver_id
        record.status = DecisionStatus.APPROVED
        record.audit_trail.append({
            "action": "APPROVED",
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": str(approver_id),
            "detail": f"Selected option: {selected_option_id}. Rationale: {rationale}"
        })

        return record

    def get_decision(self, decision_id: UUID) -> Optional[DecisionRecord]:
        return self._records.get(decision_id)
