"""
Connected Worker Engine
═══════════════════════
Manages digital work instructions, versioning, offline training sync,
and configurable digital inspections (with escalations).
"""
from typing import List, Dict, Optional, Any
from uuid import UUID, uuid4

from ers_people.schemas import (
    DigitalWorkInstruction, InstructionStep, InstructionStatus,
    DigitalInspectionForm, InspectionResult, InspectionFieldResult,
    ValidationRuleType, EscalationLevel
)

class ConnectedWorkerEngine:
    """Engine handling work instructions and field inspections."""

    def __init__(self):
        self._instructions: Dict[UUID, DigitalWorkInstruction] = {}
        self._forms: Dict[UUID, DigitalInspectionForm] = {}

    # ── Digital Instructions ───────────────────────────────

    def publish_instruction(
        self,
        title: str,
        steps: List[InstructionStep],
        author_id: UUID,
        approver_id: UUID
    ) -> DigitalWorkInstruction:
        """Creates and approves a new v1 instruction."""
        req = DigitalWorkInstruction(
            instruction_id=uuid4(),
            title=title,
            version=1,
            status=InstructionStatus.APPROVED,
            steps=steps,
            author_id=author_id,
            approved_by_id=approver_id
        )
        self._instructions[req.instruction_id] = req
        return req

    def process_inspection(
        self,
        form_id: UUID,
        technician_id: UUID,
        asset_id: UUID,
        field_inputs: Dict[str, Any]
    ) -> InspectionResult:
        """
        Processes a submitted inspection against form validation rules.
        Triggers escalations based on out-of-spec data.
        """
        form = self._forms.get(form_id)
        if not form:
            raise ValueError(f"Form {form_id} not found.")

        results: List[InspectionFieldResult] = []
        highest_escalation: Optional[EscalationLevel] = None
        overall_status = "PASS"

        for field in form.fields:
            val_input = field_inputs.get(field.field_id)
            passed = True
            
            # Simple validation stub
            if field.validation_type == ValidationRuleType.RANGE:
                min_val = field.validation_params.get("min", float('-inf'))
                max_val = field.validation_params.get("max", float('inf'))
                try:
                    num = float(val_input)
                    if num < min_val or num > max_val:
                        passed = False
                except (TypeError, ValueError):
                    passed = False

            elif field.validation_type == ValidationRuleType.EXACT_MATCH:
                target = field.validation_params.get("match")
                if str(val_input).lower() != str(target).lower():
                    passed = False

            elif field.validation_type == ValidationRuleType.PHOTO_REQUIRED:
                if not val_input: # Assumes None or empty string if no photo
                    passed = False

            requires_escalation = not passed
            if not passed:
                overall_status = "FAIL"
                if highest_escalation is None or self._escalation_rank(field.escalation_on_fail) > self._escalation_rank(highest_escalation):
                    highest_escalation = field.escalation_on_fail

            results.append(InspectionFieldResult(
                field_id=field.field_id,
                value=val_input,
                passed=passed,
                requires_escalation=requires_escalation
            ))

        if highest_escalation:
            overall_status = "ESCALATED"

        return InspectionResult(
            inspection_id=uuid4(),
            form_id=form_id,
            technician_id=technician_id,
            asset_id=asset_id,
            results=results,
            overall_status=overall_status,
            escalation_triggered=highest_escalation
        )

    def _escalation_rank(self, level: EscalationLevel) -> int:
        ranks = {
            EscalationLevel.WARNING: 1,
            EscalationLevel.SUPERVISOR_REVIEW: 2,
            EscalationLevel.WORK_STOPPAGE: 3
        }
        return ranks.get(level, 0)

    # ── Helpers for testing ────────────────────────────────
    def register_form(self, form: DigitalInspectionForm):
        self._forms[form.form_id] = form
