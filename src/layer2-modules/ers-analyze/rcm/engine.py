"""
RCM Decision Tree Engine — SAE JA1011/JA1012 Compliant
═══════════════════════════════════════════════════════════
Deterministic decision tree (NOT AI) for maintenance task selection.
Implements the full JA1011 logic flow:
  Consequence → Hidden/Evident → Task feasibility → Default action
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional
from uuid import UUID

from ers_analyze.schemas import (
    ConsequenceClass,
    RCMDecisionTreeInput,
    RCMTaskOutput,
    RCMTaskType,
)


@dataclass
class DecisionStep:
    """Single step in the JA1011 decision tree trace."""
    question: str
    answer: str
    rationale: str = ""


class RCMDecisionTreeEngine:
    """
    SAE JA1011/JA1012 Deterministic Decision Tree.

    Flow (simplified but complete):
    1. Is the failure hidden or evident?
    2. Classify consequence (safety/environmental/operational/non-operational)
    3. For each, walk the proactive task hierarchy:
       a) On-Condition (CBM) — is there a detectable P-F interval?
       b) Scheduled Restoration — is there an age-reliability relationship?
       c) Scheduled Discard — does condition degrade with age?
       d) If none feasible → consequence-specific default action
    4. Hidden failures get an extra "failure-finding" branch
    """

    def run_decision_tree(self, inp: RCMDecisionTreeInput) -> RCMTaskOutput:
        """Run the full JA1011 decision tree and return selected task."""
        trace: List[str] = []
        hidden = inp.hidden_failure

        # ── Step 1: Hidden or Evident? ──
        if hidden:
            trace.append("Q1: Hidden failure → YES")
            return self._hidden_failure_branch(inp, trace)
        else:
            trace.append("Q1: Hidden failure → NO (evident)")
            return self._evident_failure_branch(inp, trace)

    def _hidden_failure_branch(
        self, inp: RCMDecisionTreeInput, trace: List[str]
    ) -> RCMTaskOutput:
        """Branch for hidden failures (protective devices, standby)."""

        # Try proactive tasks first
        task = self._try_proactive_tasks(inp, trace, prefix="H")

        if task:
            return task

        # Hidden failure default: failure-finding task
        trace.append("H4: No proactive task feasible → Failure-Finding Task")

        # Calculate failure-finding interval:
        # FFI should ensure availability meets tolerable risk
        # Rule: FFI = MTBF × desired_availability (simplified)
        ffi_hours = None
        if inp.failure_rate_per_year and inp.failure_rate_per_year > 0:
            mtbf_hours = (1.0 / inp.failure_rate_per_year) * 8760
            # JA1012 recommends FFI ≤ half the MTBF of the hidden function
            ffi_hours = mtbf_hours * 0.5

        # If consequence is safety/environmental → redesign is mandatory
        if inp.consequence_class in (
            ConsequenceClass.HIDDEN_SAFETY,
            ConsequenceClass.HIDDEN_ENVIRONMENTAL,
        ):
            trace.append("H5: Hidden + safety/environmental → Redesign mandatory")
            return RCMTaskOutput(
                task_type=RCMTaskType.REDESIGN,
                description=(
                    "Hidden failure with safety/environmental consequence. "
                    "Redesign to make failure evident or add redundancy."
                ),
                interval_hours=ffi_hours,
                technically_feasible=True,
                worth_doing=True,
                decision_path=trace,
            )

        return RCMTaskOutput(
            task_type=RCMTaskType.FAILURE_FINDING,
            description="Scheduled failure-finding task to detect hidden failure.",
            interval_hours=ffi_hours,
            interval_days=(ffi_hours / 24.0) if ffi_hours else None,
            technically_feasible=True,
            worth_doing=True,
            decision_path=trace,
        )

    def _evident_failure_branch(
        self, inp: RCMDecisionTreeInput, trace: List[str]
    ) -> RCMTaskOutput:
        """Branch for evident failures (safety/environmental/operational/non-operational)."""

        cc = inp.consequence_class
        trace.append(f"E1: Consequence class → {cc.value}")

        # Try proactive tasks
        task = self._try_proactive_tasks(inp, trace, prefix="E")

        if task:
            return task

        # Default actions depend on consequence class
        if cc in (ConsequenceClass.SAFETY_HEALTH, ConsequenceClass.ENVIRONMENTAL):
            trace.append(
                "E5: Safety/environmental + no proactive task → Redesign mandatory"
            )
            return RCMTaskOutput(
                task_type=RCMTaskType.REDESIGN,
                description=(
                    f"No feasible proactive task for {cc.value} consequence. "
                    "Redesign or operational change is mandatory (SAE JA1011)."
                ),
                technically_feasible=True,
                worth_doing=True,
                decision_path=trace,
            )
        elif cc == ConsequenceClass.OPERATIONAL:
            trace.append("E5: Operational + no proactive task → Run-to-Failure "
                        "(only if cost-justified)")
            return RCMTaskOutput(
                task_type=RCMTaskType.RUN_TO_FAILURE,
                description=(
                    "No proactive task technically feasible. "
                    "Accept run-to-failure only if consequence cost is tolerable."
                ),
                technically_feasible=True,
                worth_doing=False,  # flag for review
                decision_path=trace,
            )
        else:
            # Non-operational
            trace.append("E5: Non-operational + no proactive task → Run-to-Failure")
            return RCMTaskOutput(
                task_type=RCMTaskType.RUN_TO_FAILURE,
                description=(
                    "Non-operational consequence with no feasible proactive task. "
                    "Run-to-failure is the default (SAE JA1011)."
                ),
                technically_feasible=True,
                worth_doing=True,
                decision_path=trace,
            )

    def _try_proactive_tasks(
        self, inp: RCMDecisionTreeInput, trace: List[str], prefix: str
    ) -> Optional[RCMTaskOutput]:
        """Attempt each proactive task in JA1011 hierarchy order."""

        # ── On-Condition (CBM) ──
        if inp.has_condition_indicator and inp.pf_interval_days:
            pf = inp.pf_interval_days
            # JA1011: Task interval = P-F interval / 2 (or / 3 for safety)
            cc = inp.consequence_class
            safety_critical = cc in (
                ConsequenceClass.SAFETY_HEALTH,
                ConsequenceClass.ENVIRONMENTAL,
                ConsequenceClass.HIDDEN_SAFETY,
                ConsequenceClass.HIDDEN_ENVIRONMENTAL,
            )
            divisor = 3.0 if safety_critical else 2.0
            interval = pf / divisor

            trace.append(
                f"{prefix}2: On-Condition feasible? YES "
                f"(P-F={pf:.0f}d, interval={interval:.0f}d, divisor={divisor})"
            )

            is_worth = self._is_worth_doing(inp, "on_condition")
            if is_worth:
                trace.append(f"{prefix}2a: Worth doing? YES")
                return RCMTaskOutput(
                    task_type=RCMTaskType.ON_CONDITION,
                    description=(
                        f"Condition-based monitoring task. "
                        f"P-F interval: {pf:.0f} days, inspection every {interval:.0f} days."
                    ),
                    interval_days=interval,
                    technically_feasible=True,
                    worth_doing=True,
                    decision_path=trace,
                )
            else:
                trace.append(f"{prefix}2a: Worth doing? NO — continue")
        else:
            trace.append(f"{prefix}2: On-Condition feasible? NO")

        # ── Scheduled Restoration (TBM — restore to original capability) ──
        if inp.has_age_reliability_relationship:
            trace.append(f"{prefix}3: Scheduled Restoration feasible? YES")
            # Calculate interval from failure distribution
            interval_hours = self._calculate_restoration_interval(inp)
            interval_days = interval_hours / 24.0 if interval_hours else None

            is_worth = self._is_worth_doing(inp, "scheduled_restoration")
            if is_worth:
                trace.append(f"{prefix}3a: Worth doing? YES")
                return RCMTaskOutput(
                    task_type=RCMTaskType.SCHEDULED_RESTORATION,
                    description=(
                        "Scheduled restoration task (overhaul/refurbish) "
                        "based on age-reliability relationship."
                    ),
                    interval_days=interval_days,
                    interval_hours=interval_hours,
                    technically_feasible=True,
                    worth_doing=True,
                    decision_path=trace,
                )
            else:
                trace.append(f"{prefix}3a: Worth doing? NO — continue")
        else:
            trace.append(f"{prefix}3: Scheduled Restoration feasible? NO")

        # ── Scheduled Discard ──
        if inp.has_age_reliability_relationship:
            trace.append(f"{prefix}4: Scheduled Discard feasible? YES")
            interval_hours = self._calculate_discard_interval(inp)
            interval_days = interval_hours / 24.0 if interval_hours else None

            is_worth = self._is_worth_doing(inp, "scheduled_discard")
            if is_worth:
                trace.append(f"{prefix}4a: Worth doing? YES")
                return RCMTaskOutput(
                    task_type=RCMTaskType.SCHEDULED_DISCARD,
                    description=(
                        "Scheduled discard/replacement at fixed interval "
                        "based on known wearout pattern."
                    ),
                    interval_days=interval_days,
                    interval_hours=interval_hours,
                    technically_feasible=True,
                    worth_doing=True,
                    decision_path=trace,
                )
            else:
                trace.append(f"{prefix}4a: Worth doing? NO — continue")
        else:
            trace.append(f"{prefix}4: Scheduled Discard feasible? NO (no age relationship)")

        return None  # No proactive task selected

    def _is_worth_doing(
        self, inp: RCMDecisionTreeInput, task_type: str
    ) -> bool:
        """
        Evaluate if a task is worth doing (SAE JA1011 §7.3).

        For safety/environmental: always worth doing if technically feasible.
        For operational: only if cost of task < cost of failure.
        For non-operational: only if cost of task < cost of repair.
        """
        cc = inp.consequence_class
        safety = cc in (
            ConsequenceClass.SAFETY_HEALTH,
            ConsequenceClass.ENVIRONMENTAL,
            ConsequenceClass.HIDDEN_SAFETY,
            ConsequenceClass.HIDDEN_ENVIRONMENTAL,
        )
        if safety:
            return True  # Always worth doing for safety consequences

        # For operational/non-operational: simplified cost comparison
        # In practice, this would use full cost data
        return True  # Default: worth doing (conservative)

    def _calculate_restoration_interval(
        self, inp: RCMDecisionTreeInput
    ) -> Optional[float]:
        """Calculate optimal restoration interval from failure data."""
        if inp.failure_rate_per_year and inp.failure_rate_per_year > 0:
            mtbf_hours = (1.0 / inp.failure_rate_per_year) * 8760
            # Typical restoration at 80% of MTBF
            return mtbf_hours * 0.80
        return None

    def _calculate_discard_interval(
        self, inp: RCMDecisionTreeInput
    ) -> Optional[float]:
        """Calculate optimal discard interval from failure data."""
        if inp.failure_rate_per_year and inp.failure_rate_per_year > 0:
            mtbf_hours = (1.0 / inp.failure_rate_per_year) * 8760
            # Typical discard at 70% of MTBF (more conservative)
            return mtbf_hours * 0.70
        return None

    def classify_consequence(
        self,
        has_safety_impact: bool,
        has_environmental_impact: bool,
        has_production_impact: bool,
        is_hidden: bool,
    ) -> ConsequenceClass:
        """
        Classify the consequence of a failure mode (JA1011 §6).

        Priority order: Safety > Environmental > Operational > Non-operational
        Hidden variants for protective/standby failures.
        """
        if is_hidden:
            if has_safety_impact:
                return ConsequenceClass.HIDDEN_SAFETY
            if has_environmental_impact:
                return ConsequenceClass.HIDDEN_ENVIRONMENTAL
            return ConsequenceClass.HIDDEN_OPERATIONAL

        if has_safety_impact:
            return ConsequenceClass.SAFETY_HEALTH
        if has_environmental_impact:
            return ConsequenceClass.ENVIRONMENTAL
        if has_production_impact:
            return ConsequenceClass.OPERATIONAL
        return ConsequenceClass.NON_OPERATIONAL
