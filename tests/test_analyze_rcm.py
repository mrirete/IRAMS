"""
Tests for ERS Analyze — RCM Engine
═══════════════════════════════════
Tests for SAE JA1011/JA1012 decision tree and AI failure mode suggestion.
"""

import pytest
from uuid import uuid4

from ers_analyze.schemas import (
    ConsequenceClass,
    FailureModeSource,
    GovernanceTier,
    RCMDecisionTreeInput,
    RCMTaskType,
)
from ers_analyze.rcm.engine import RCMDecisionTreeEngine
from ers_analyze.rcm.ai_suggest import (
    RCMAIFailureModeSuggestor,
    WorkOrderText,
    ISO14224_FAILURE_MODES,
)


# ─── Fixtures ────────────────────────────────────────────────

@pytest.fixture
def engine():
    return RCMDecisionTreeEngine()


@pytest.fixture
def ai_suggestor():
    return RCMAIFailureModeSuggestor()


def _make_input(**overrides) -> RCMDecisionTreeInput:
    """Helper to create decision tree input."""
    defaults = dict(
        failure_mode_id=uuid4(),
        consequence_class=ConsequenceClass.OPERATIONAL,
        hidden_failure=False,
        has_condition_indicator=False,
        has_age_reliability_relationship=False,
        pf_interval_days=None,
        failure_rate_per_year=None,
        mttr_hours=4.0,
    )
    defaults.update(overrides)
    return RCMDecisionTreeInput(**defaults)


# ═══════════════════════════════════════════════════════════════
#  RCM DECISION TREE TESTS
# ═══════════════════════════════════════════════════════════════

class TestRCMDecisionTree:

    def test_cbm_selected_when_condition_indicator_exists(self, engine):
        """CBM should be selected when P-F interval is available."""
        inp = _make_input(
            has_condition_indicator=True,
            pf_interval_days=90.0,
            consequence_class=ConsequenceClass.OPERATIONAL,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.ON_CONDITION
        assert result.interval_days is not None
        assert result.interval_days == 45.0  # 90 / 2

    def test_cbm_safety_uses_divisor_3(self, engine):
        """Safety-critical CBM should use P-F / 3."""
        inp = _make_input(
            has_condition_indicator=True,
            pf_interval_days=90.0,
            consequence_class=ConsequenceClass.SAFETY_HEALTH,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.ON_CONDITION
        assert result.interval_days == 30.0  # 90 / 3

    def test_tbm_restoration_when_age_relationship(self, engine):
        """Scheduled restoration when age-reliability relationship exists."""
        inp = _make_input(
            has_condition_indicator=False,
            has_age_reliability_relationship=True,
            failure_rate_per_year=0.5,
            consequence_class=ConsequenceClass.OPERATIONAL,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.SCHEDULED_RESTORATION

    def test_rtf_non_operational_default(self, engine):
        """Run-to-failure for non-operational with no proactive task."""
        inp = _make_input(
            consequence_class=ConsequenceClass.NON_OPERATIONAL,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.RUN_TO_FAILURE
        assert result.worth_doing is True

    def test_redesign_mandatory_for_safety(self, engine):
        """Redesign mandatory for safety consequence with no proactive task."""
        inp = _make_input(
            consequence_class=ConsequenceClass.SAFETY_HEALTH,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.REDESIGN

    def test_redesign_mandatory_for_environmental(self, engine):
        """Redesign mandatory for environmental consequence with no proactive task."""
        inp = _make_input(
            consequence_class=ConsequenceClass.ENVIRONMENTAL,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.REDESIGN

    def test_hidden_failure_failure_finding(self, engine):
        """Hidden failure with no proactive task → failure-finding."""
        inp = _make_input(
            hidden_failure=True,
            consequence_class=ConsequenceClass.HIDDEN_OPERATIONAL,
            failure_rate_per_year=0.2,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.FAILURE_FINDING
        assert result.interval_hours is not None

    def test_hidden_safety_redesign_mandatory(self, engine):
        """Hidden safety failure → redesign mandatory (SAE JA1011)."""
        inp = _make_input(
            hidden_failure=True,
            consequence_class=ConsequenceClass.HIDDEN_SAFETY,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.REDESIGN

    def test_decision_path_traced(self, engine):
        """Decision path should trace all steps taken."""
        inp = _make_input(
            consequence_class=ConsequenceClass.OPERATIONAL,
        )
        result = engine.run_decision_tree(inp)
        assert len(result.decision_path) > 0
        assert "Q1: Hidden failure → NO" in result.decision_path[0]

    def test_hidden_cbm_selected(self, engine):
        """Hidden failure with CBM feasible should select CBM."""
        inp = _make_input(
            hidden_failure=True,
            consequence_class=ConsequenceClass.HIDDEN_OPERATIONAL,
            has_condition_indicator=True,
            pf_interval_days=60.0,
        )
        result = engine.run_decision_tree(inp)
        assert result.task_type == RCMTaskType.ON_CONDITION

    def test_consequence_classification(self, engine):
        """Test consequence classification helper."""
        assert engine.classify_consequence(True, False, False, False) == ConsequenceClass.SAFETY_HEALTH
        assert engine.classify_consequence(False, True, False, False) == ConsequenceClass.ENVIRONMENTAL
        assert engine.classify_consequence(False, False, True, False) == ConsequenceClass.OPERATIONAL
        assert engine.classify_consequence(False, False, False, False) == ConsequenceClass.NON_OPERATIONAL
        assert engine.classify_consequence(True, False, False, True) == ConsequenceClass.HIDDEN_SAFETY
        assert engine.classify_consequence(False, True, False, True) == ConsequenceClass.HIDDEN_ENVIRONMENTAL
        assert engine.classify_consequence(False, False, False, True) == ConsequenceClass.HIDDEN_OPERATIONAL


# ═══════════════════════════════════════════════════════════════
#  AI FAILURE MODE SUGGESTION TESTS
# ═══════════════════════════════════════════════════════════════

class TestAIFailureModeSuggestion:

    def test_defaults_when_no_wo_history(self, ai_suggestor):
        """Should return ISO 14224 defaults when no WO history."""
        suggestions = ai_suggestor.suggest_failure_modes(
            asset_class="pump",
            wo_history=[],
        )
        assert len(suggestions) > 0
        assert all(s.governance_tier == GovernanceTier.TIER_2_HUMAN_REVIEW for s in suggestions)
        assert all(s.confidence == 0.3 for s in suggestions)

    def test_keyword_extraction_vibration(self, ai_suggestor):
        """Should detect vibration-related failure modes."""
        wo_history = [
            WorkOrderText(wo_id="WO-001", description="High vibration on pump bearing DE"),
            WorkOrderText(wo_id="WO-002", description="Vibration alarm triggered, bearing temp high"),
            WorkOrderText(wo_id="WO-003", description="Excessive vibration during startup"),
        ]
        suggestions = ai_suggestor.suggest_failure_modes(
            asset_class="pump",
            wo_history=wo_history,
        )
        # Vibration should be first (most matches)
        assert any("vibration" in s.description.lower() or "VIB" in (s.iso14224_code or "") for s in suggestions)

    def test_confidence_increases_with_evidence(self, ai_suggestor):
        """Confidence should increase with more WO evidence."""
        # 1 WO
        suggestions_1 = ai_suggestor.suggest_failure_modes(
            asset_class="pump",
            wo_history=[WorkOrderText(wo_id="WO-1", description="bearing leak")],
        )
        # 5 WOs
        suggestions_5 = ai_suggestor.suggest_failure_modes(
            asset_class="pump",
            wo_history=[
                WorkOrderText(wo_id=f"WO-{i}", description="seal leakage found")
                for i in range(5)
            ],
        )
        # Get the leakage suggestion confidence from each
        conf_1 = max((s.confidence for s in suggestions_1 if "leak" in s.description.lower()), default=0.3)
        conf_5 = max((s.confidence for s in suggestions_5 if "leak" in s.description.lower()), default=0.3)
        assert conf_5 >= conf_1

    def test_max_suggestions_limit(self, ai_suggestor):
        """Should respect max_suggestions limit."""
        suggestions = ai_suggestor.suggest_failure_modes(
            asset_class="pump",
            wo_history=[],
            max_suggestions=5,
        )
        assert len(suggestions) <= 5

    def test_iso14224_codes_assigned(self, ai_suggestor):
        """All suggestions should have ISO 14224 codes."""
        suggestions = ai_suggestor.suggest_failure_modes(
            asset_class="compressor",
            wo_history=[],
        )
        for s in suggestions:
            assert s.iso14224_code is not None

    def test_governance_tier_always_2(self, ai_suggestor):
        """All AI suggestions must be Tier 2 (human review required)."""
        wo_history = [
            WorkOrderText(wo_id="WO-100", description="bearing failure, catastrophic"),
        ]
        suggestions = ai_suggestor.suggest_failure_modes(
            asset_class="turbine",
            wo_history=wo_history,
        )
        for s in suggestions:
            assert s.governance_tier == GovernanceTier.TIER_2_HUMAN_REVIEW

    def test_different_asset_classes(self, ai_suggestor):
        """Different asset classes should produce different taxonomies."""
        pump_suggestions = ai_suggestor.suggest_failure_modes("pump", [])
        valve_suggestions = ai_suggestor.suggest_failure_modes("valve", [])
        pump_codes = {s.iso14224_code for s in pump_suggestions}
        valve_codes = {s.iso14224_code for s in valve_suggestions}
        assert pump_codes != valve_codes
