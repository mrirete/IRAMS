"""
Tests — Damage Mechanism, IOW Monitor, & Regulatory Preparedness
═══════════════════════════════════════════════════════════════════
Tests for remaining ERS Comply engines.
"""
import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from ers_comply.damage_mech.engine import DamageMechanismEngine
from ers_comply.iow.engine import IOWMonitorEngine
from ers_comply.regulatory.engine import RegulatoryPreparednessEngine
from ers_comply.schemas import (
    DamageMechIdentifyInput, IOWCheckInput, IOWRead, IOWType,
)


# ═══════════════════════════════════════════════════════════
#  Damage Mechanism Identifier
# ═══════════════════════════════════════════════════════════

class TestDamageMechanism:
    """Tests for API 571 damage mechanism identification."""

    def setup_method(self):
        self.engine = DamageMechanismEngine()
        self.equip_id = uuid4()

    def test_identifies_h2s_sulfidation(self):
        """High-temp H2S service triggers sulfidation."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-516 Gr 70",
            process_fluid="sour crude oil",
            operating_temperature=550.0,
            operating_pressure=300.0,
            h2s_content=500.0,
        )
        result = self.engine.identify(inp)
        mechanisms = [m.name for m in result.mechanisms]
        assert "Sulfidation (High-Temp H₂S Corrosion)" in mechanisms

    def test_identifies_htha(self):
        """High H2 + high temp triggers HTHA."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-516 Gr 70",
            process_fluid="hydrogen reformer",
            operating_temperature=600.0,
            operating_pressure=1500.0,
            h2_partial_pressure=500.0,
        )
        result = self.engine.identify(inp)
        mechanisms = [m.name for m in result.mechanisms]
        assert "High Temperature Hydrogen Attack (HTHA)" in mechanisms

    def test_identifies_cui(self):
        """CUI-susceptible temperature range detected."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-516 Gr 70",
            process_fluid="steam condensate",
            operating_temperature=200.0,
            operating_pressure=50.0,
        )
        result = self.engine.identify(inp)
        mechanisms = [m.name for m in result.mechanisms]
        assert "Corrosion Under Insulation (CUI)" in mechanisms

    def test_identifies_caustic_scc(self):
        """Caustic SCC at high concentration and temperature."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-516 Gr 70",
            process_fluid="caustic soda",
            operating_temperature=200.0,
            operating_pressure=50.0,
            caustic_concentration=15.0,
        )
        result = self.engine.identify(inp)
        mechanisms = [m.name for m in result.mechanisms]
        assert "Caustic Stress Corrosion Cracking (Caustic SCC)" in mechanisms
        assert "Caustic Corrosion" in mechanisms

    def test_identifies_chloride_scc(self):
        """Chloride SCC in austenitic SS at temp."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-240 Type 304 Stainless Steel",
            process_fluid="cooling water",
            operating_temperature=250.0,
            operating_pressure=100.0,
            chloride_content=50.0,
        )
        result = self.engine.identify(inp)
        mechanisms = [m.name for m in result.mechanisms]
        assert "Chloride Stress Corrosion Cracking (Cl-SCC)" in mechanisms

    def test_tier_2_governance(self):
        """All results are Tier 2 advisory."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-516 Gr 70",
            process_fluid="crude oil",
            operating_temperature=400.0,
            operating_pressure=200.0,
        )
        result = self.engine.identify(inp)
        assert result.governance_tier == 2
        assert result.requires_engineer_confirmation is True
        assert "Tier 2" in result.safety_disclaimer

    def test_confidence_scores(self):
        """Each mechanism has a confidence score between 0 and 1."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-516 Gr 70",
            process_fluid="crude oil",
            operating_temperature=400.0,
            operating_pressure=200.0,
            h2s_content=100.0,
        )
        result = self.engine.identify(inp)
        for mech in result.mechanisms:
            assert 0 < mech.confidence <= 1.0

    def test_sorted_by_likelihood(self):
        """Results sorted by likelihood (high first)."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-516 Gr 70",
            process_fluid="sour crude",
            operating_temperature=500.0,
            operating_pressure=300.0,
            h2s_content=200.0,
        )
        result = self.engine.identify(inp)
        if len(result.mechanisms) >= 2:
            order = {"high": 0, "medium": 1, "low": 2}
            for i in range(len(result.mechanisms) - 1):
                a = order.get(result.mechanisms[i].likelihood, 3)
                b = order.get(result.mechanisms[i + 1].likelihood, 3)
                assert a <= b

    def test_co2_corrosion(self):
        """CO2 content triggers sweet corrosion."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-106 Gr B",
            process_fluid="wet natural gas",
            operating_temperature=150.0,
            operating_pressure=800.0,
            co2_content=5.0,
        )
        result = self.engine.identify(inp)
        mechanisms = [m.name for m in result.mechanisms]
        assert "CO2 Corrosion (Sweet Corrosion)" in mechanisms

    def test_wet_h2s_cracking(self):
        """Wet H2S at low temp triggers HIC/SOHIC/SSC."""
        inp = DamageMechIdentifyInput(
            equipment_id=self.equip_id,
            material_spec="SA-516 Gr 70",
            process_fluid="sour water",
            operating_temperature=150.0,
            operating_pressure=100.0,
            h2s_content=200.0,
        )
        result = self.engine.identify(inp)
        mechanisms = [m.name for m in result.mechanisms]
        assert "Wet H₂S Cracking (HIC/SOHIC/SSC)" in mechanisms


# ═══════════════════════════════════════════════════════════
#  IOW Monitor
# ═══════════════════════════════════════════════════════════

class TestIOWMonitor:
    """Tests for Integrity Operating Window monitor."""

    def setup_method(self):
        self.engine = IOWMonitorEngine()
        self.iow_id = uuid4()
        self.equip_id = uuid4()

    def _make_iow(self, low=100.0, high=200.0, iow_type=IOWType.STANDARD):
        return IOWRead(
            id=self.iow_id,
            equipment_id=self.equip_id,
            parameter_name="Temperature",
            iow_type=iow_type,
            low_limit=low,
            high_limit=high,
            unit="°F",
        )

    def test_value_in_range(self):
        """Value within limits → in_range = True."""
        iow = self._make_iow()
        check = IOWCheckInput(iow_id=self.iow_id, current_value=150.0)
        result = self.engine.check_value(check, iow)
        assert result.in_range is True
        assert result.breach_type is None
        assert result.action_required == "none"

    def test_high_breach(self):
        """Value above high limit → high breach."""
        iow = self._make_iow()
        check = IOWCheckInput(iow_id=self.iow_id, current_value=250.0)
        result = self.engine.check_value(check, iow)
        assert result.in_range is False
        assert result.breach_type == "high"
        assert result.deviation == pytest.approx(50.0, abs=0.1)

    def test_low_breach(self):
        """Value below low limit → low breach."""
        iow = self._make_iow()
        check = IOWCheckInput(iow_id=self.iow_id, current_value=50.0)
        result = self.engine.check_value(check, iow)
        assert result.in_range is False
        assert result.breach_type == "low"
        assert result.deviation == pytest.approx(50.0, abs=0.1)

    def test_critical_iow_immediate_alert(self):
        """Critical IOW breach → immediate alert action."""
        iow = self._make_iow(iow_type=IOWType.CRITICAL)
        check = IOWCheckInput(iow_id=self.iow_id, current_value=250.0)
        result = self.engine.check_value(check, iow)
        assert result.action_required == "immediate_alert"

    def test_standard_iow_log_and_schedule(self):
        """Standard IOW breach → log and schedule action."""
        iow = self._make_iow(iow_type=IOWType.STANDARD)
        check = IOWCheckInput(iow_id=self.iow_id, current_value=250.0)
        result = self.engine.check_value(check, iow)
        assert result.action_required == "log_and_schedule"

    def test_informational_iow_log_only(self):
        """Informational IOW breach → log only."""
        iow = self._make_iow(iow_type=IOWType.INFORMATIONAL)
        check = IOWCheckInput(iow_id=self.iow_id, current_value=250.0)
        result = self.engine.check_value(check, iow)
        assert result.action_required == "log_only"

    def test_cumulative_exceedance_tracking(self):
        """Breach → return to range → cumulative tracked."""
        self.engine.reset_tracking()
        iow = self._make_iow()
        t1 = datetime(2026, 1, 1, 10, 0, 0)
        t2 = datetime(2026, 1, 1, 10, 30, 0)  # 30 min later

        # Start breach
        check1 = IOWCheckInput(iow_id=self.iow_id, current_value=250.0, timestamp=t1)
        self.engine.check_value(check1, iow)

        # Return to range → cumulative = 30 min
        check2 = IOWCheckInput(iow_id=self.iow_id, current_value=150.0, timestamp=t2)
        result = self.engine.check_value(check2, iow)
        assert result.cumulative_exceedance_min == pytest.approx(30.0, abs=0.1)

    def test_active_breaches(self):
        """Active breaches tracked."""
        self.engine.reset_tracking()
        iow = self._make_iow()
        check = IOWCheckInput(iow_id=self.iow_id, current_value=250.0)
        self.engine.check_value(check, iow)
        assert self.iow_id in self.engine.get_active_breaches()


# ═══════════════════════════════════════════════════════════
#  Regulatory Preparedness Score
# ═══════════════════════════════════════════════════════════

class TestRegulatoryPreparedness:
    """Tests for regulatory preparedness scoring."""

    def setup_method(self):
        self.engine = RegulatoryPreparednessEngine()

    def test_perfect_score(self):
        """All 100s → overall = 100, grade A."""
        metrics = {
            "inspection_currency": 100,
            "documentation_completeness": 100,
            "corrective_action_closure": 100,
            "personnel_certification": 100,
            "mi_program_compliance": 100,
            "iow_compliance": 100,
        }
        result = self.engine.calculate_score(metrics)
        assert result.overall_score == 100.0
        assert result.grade == "A"
        assert len(result.sub_scores) == 6

    def test_failing_score(self):
        """All 40s → grade F."""
        metrics = {k: 40.0 for k in [
            "inspection_currency", "documentation_completeness",
            "corrective_action_closure", "personnel_certification",
            "mi_program_compliance", "iow_compliance",
        ]}
        result = self.engine.calculate_score(metrics)
        assert result.overall_score == pytest.approx(40.0, abs=0.1)
        assert result.grade == "F"

    def test_weighted_calculation(self):
        """Weights applied correctly."""
        metrics = {
            "inspection_currency": 100,        # 0.20 × 100 = 20
            "documentation_completeness": 50,   # 0.20 × 50  = 10
            "corrective_action_closure": 100,   # 0.15 × 100 = 15
            "personnel_certification": 100,     # 0.15 × 100 = 15
            "mi_program_compliance": 100,       # 0.15 × 100 = 15
            "iow_compliance": 0,                # 0.15 × 0   = 0
        }
        result = self.engine.calculate_score(metrics)
        expected = 20 + 10 + 15 + 15 + 15 + 0
        assert result.overall_score == pytest.approx(expected, abs=0.5)

    def test_grade_boundaries(self):
        """Grade boundaries: A≥90, B≥80, C≥70, D≥60, F<60."""
        assert self.engine._get_grade(95) == "A"
        assert self.engine._get_grade(85) == "B"
        assert self.engine._get_grade(75) == "C"
        assert self.engine._get_grade(65) == "D"
        assert self.engine._get_grade(55) == "F"

    def test_recommendations_for_low_scores(self):
        """Recommendations generated for scores < 80."""
        metrics = {
            "inspection_currency": 45,
            "documentation_completeness": 90,
            "corrective_action_closure": 70,
            "personnel_certification": 90,
            "mi_program_compliance": 90,
            "iow_compliance": 90,
        }
        result = self.engine.calculate_score(metrics)
        assert any("CRITICAL" in r for r in result.recommendations)
        assert any("IMPROVE" in r for r in result.recommendations)

    def test_clamped_to_0_100(self):
        """Scores clamped to 0–100 range."""
        metrics = {
            "inspection_currency": 150,  # over 100
            "documentation_completeness": -20,  # below 0
            "corrective_action_closure": 80,
            "personnel_certification": 80,
            "mi_program_compliance": 80,
            "iow_compliance": 80,
        }
        result = self.engine.calculate_score(metrics)
        for ss in result.sub_scores:
            assert 0 <= ss.score <= 100

    def test_inspection_currency_sub_score(self):
        """Inspection currency calculation with overdue penalty."""
        score = self.engine.calculate_inspection_currency(
            total_equipment=100,
            equipment_current=90,
            equipment_overdue=3,
        )
        # base = 90%, penalty = 3 × 5 = 15
        assert score == pytest.approx(75.0, abs=1.0)

    def test_ca_closure_sub_score(self):
        """Corrective action closure with overdue penalty."""
        score = self.engine.calculate_ca_closure(
            total_actions=20,
            closed_actions=15,
            overdue_actions=2,
        )
        # base = 75%, penalty = 2 × 10 = 20
        assert score == pytest.approx(55.0, abs=1.0)

    def test_iow_compliance_sub_score(self):
        """IOW compliance with critical breach penalty."""
        score = self.engine.calculate_iow_compliance(
            total_iows=50,
            iows_in_range=48,
            critical_breaches=1,
        )
        # base = 96%, penalty = 1 × 20 = 20
        assert score == pytest.approx(76.0, abs=1.0)

    def test_missing_metrics_default_to_zero(self):
        """Missing metrics default to 0."""
        result = self.engine.calculate_score({})
        assert result.overall_score == 0.0
        assert result.grade == "F"
