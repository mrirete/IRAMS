"""
Tests — Fitness-for-Service Engine (API 579)
═════════════════════════════════════════════
Tests for Level 1 (Parts 4, 5, 6) and Level 2 assessments.
"""
import pytest
from uuid import uuid4

from ers_comply.ffs.engine import FFSEngine
from ers_comply.schemas import (
    FFSLevel1Input, FFSLevel2Input, FFSPart, FFSStatus
)


class TestFFSLevel1General:
    """Tests for API 579 Level 1 Part 4 — General Metal Loss."""

    def setup_method(self):
        self.engine = FFSEngine()
        self.equip_id = uuid4()

    def _base_input(self, readings=None, **overrides):
        defaults = dict(
            equipment_id=self.equip_id,
            api_579_part=FFSPart.PART_4,
            design_pressure=150.0,
            design_temperature=350.0,
            nominal_thickness=0.500,
            allowable_stress=20000.0,
            weld_joint_efficiency=1.0,
            inside_diameter=48.0,
            thickness_readings=readings or [0.45, 0.46, 0.44, 0.47, 0.45],
            future_corrosion_allowance=0.05,
            corrosion_rate=0.010,
        )
        defaults.update(overrides)
        return FFSLevel1Input(**defaults)

    def test_passing_assessment(self):
        """Healthy equipment passes Level 1."""
        inp = self._base_input()
        result = self.engine.assess_level_1(inp)
        assert result.overall_pass is True
        assert result.status == FFSStatus.PASSED or result.status == FFSStatus.MONITORING
        assert result.rsf > 0.9
        assert result.t_min > 0

    def test_t_min_calculation(self):
        """t_min calculated per ASME VIII UG-27."""
        inp = self._base_input()
        result = self.engine.assess_level_1(inp)
        # t_min = (P * R) / (S * E - 0.6 * P)
        # = (150 * 24) / (20000 * 1.0 - 0.6 * 150)
        # = 3600 / 19910 ≈ 0.1808
        assert result.t_min == pytest.approx(0.1808, abs=0.001)

    def test_average_and_minimum_thickness(self):
        """t_am and t_mm calculated from readings."""
        readings = [0.40, 0.42, 0.38, 0.41, 0.39]
        inp = self._base_input(readings=readings)
        result = self.engine.assess_level_1(inp)
        assert result.t_am == pytest.approx(0.40, abs=0.001)
        assert result.t_mm == pytest.approx(0.38, abs=0.001)

    def test_failing_assessment_thin_wall(self):
        """Severely thinned equipment fails Level 1."""
        readings = [0.18, 0.19, 0.17, 0.20, 0.18]
        inp = self._base_input(readings=readings)
        result = self.engine.assess_level_1(inp)
        assert result.overall_pass is False
        assert result.status in (FFSStatus.FAILED, FFSStatus.REMEDIATION_REQUIRED)

    def test_rsf_calculation(self):
        """RSF = t_am / t_min."""
        inp = self._base_input()
        result = self.engine.assess_level_1(inp)
        expected_rsf = result.t_am / result.t_min
        assert result.rsf == pytest.approx(expected_rsf, abs=0.01)

    def test_remaining_life_at_rate(self):
        """Remaining life calculated from corrosion rate."""
        inp = self._base_input(corrosion_rate=0.020)
        result = self.engine.assess_level_1(inp)
        assert result.remaining_life_years > 0
        assert result.remaining_life_years < 999

    def test_no_readings_fails(self):
        """Empty readings → fail."""
        inp = FFSLevel1Input(
            equipment_id=self.equip_id,
            design_pressure=150.0,
            design_temperature=350.0,
            nominal_thickness=0.500,
            allowable_stress=20000.0,
            inside_diameter=48.0,
            thickness_readings=[],
            future_corrosion_allowance=0.05,
            corrosion_rate=0.010,
        )
        result = self.engine.assess_level_1(inp)
        assert result.overall_pass is False

    def test_mawp_derated_calculated(self):
        """MAWP derated value is calculated."""
        inp = self._base_input()
        result = self.engine.assess_level_1(inp)
        assert result.mawp_derated is not None
        assert result.mawp_derated > 0

    def test_safety_disclaimer_present(self):
        """Safety disclaimer always present."""
        inp = self._base_input()
        result = self.engine.assess_level_1(inp)
        assert "Tier 5" in result.safety_disclaimer

    def test_governance_tier_5(self):
        """Governance tier is always 5."""
        inp = self._base_input()
        result = self.engine.assess_level_1(inp)
        assert result.governance_tier == 5


class TestFFSLevel1Local:
    """Tests for API 579 Level 1 Part 5 — Local Metal Loss."""

    def setup_method(self):
        self.engine = FFSEngine()
        self.equip_id = uuid4()

    def test_local_loss_assessment(self):
        """Local metal loss uses t_mm for RSF."""
        inp = FFSLevel1Input(
            equipment_id=self.equip_id,
            api_579_part=FFSPart.PART_5,
            design_pressure=150.0,
            design_temperature=350.0,
            nominal_thickness=0.500,
            allowable_stress=20000.0,
            inside_diameter=48.0,
            thickness_readings=[0.45, 0.45, 0.30, 0.45, 0.45],  # local thin area
            future_corrosion_allowance=0.05,
            corrosion_rate=0.010,
        )
        result = self.engine.assess_level_1(inp)
        assert result.api_579_part == FFSPart.PART_5
        assert result.t_mm == pytest.approx(0.30, abs=0.001)


class TestFFSLevel1Pitting:
    """Tests for API 579 Level 1 Part 6 — Pitting."""

    def setup_method(self):
        self.engine = FFSEngine()
        self.equip_id = uuid4()

    def test_pitting_assessment(self):
        """Pitting assessment uses pit depth."""
        inp = FFSLevel1Input(
            equipment_id=self.equip_id,
            api_579_part=FFSPart.PART_6,
            design_pressure=150.0,
            design_temperature=350.0,
            nominal_thickness=0.500,
            allowable_stress=20000.0,
            inside_diameter=48.0,
            thickness_readings=[0.48, 0.47, 0.35, 0.49, 0.46],  # deep pit
            future_corrosion_allowance=0.05,
            corrosion_rate=0.005,
        )
        result = self.engine.assess_level_1(inp)
        assert result.api_579_part == FFSPart.PART_6


class TestFFSLevel2:
    """Tests for API 579 Level 2 — CTP Assessment."""

    def setup_method(self):
        self.engine = FFSEngine()
        self.equip_id = uuid4()

    def test_level_2_passing_grid(self):
        """Uniform thickness grid passes."""
        grid = [
            [0.45, 0.46, 0.44, 0.45],
            [0.44, 0.45, 0.43, 0.44],
            [0.46, 0.45, 0.45, 0.46],
        ]
        inp = FFSLevel2Input(
            equipment_id=self.equip_id,
            design_pressure=150.0,
            design_temperature=350.0,
            nominal_thickness=0.500,
            allowable_stress=20000.0,
            inside_diameter=48.0,
            thickness_grid=grid,
            grid_spacing_circ=3.0,
            grid_spacing_long=6.0,
            future_corrosion_allowance=0.05,
            corrosion_rate=0.010,
        )
        result = self.engine.assess_level_2(inp)
        assert result.overall_pass is True
        assert result.rsf_overall >= 0.9
        assert len(result.critical_thickness_profiles) > 0

    def test_level_2_failing_grid(self):
        """Grid with severe thinning fails."""
        grid = [
            [0.20, 0.19, 0.18, 0.20],
            [0.19, 0.18, 0.17, 0.19],
            [0.20, 0.19, 0.18, 0.20],
        ]
        inp = FFSLevel2Input(
            equipment_id=self.equip_id,
            design_pressure=150.0,
            design_temperature=350.0,
            nominal_thickness=0.500,
            allowable_stress=20000.0,
            inside_diameter=48.0,
            thickness_grid=grid,
            grid_spacing_circ=3.0,
            grid_spacing_long=6.0,
            future_corrosion_allowance=0.05,
        )
        result = self.engine.assess_level_2(inp)
        assert result.overall_pass is False
        assert result.rsf_overall < 0.9

    def test_level_2_circ_and_long_profiles(self):
        """Both circumferential and longitudinal profiles generated."""
        grid = [
            [0.45, 0.44],
            [0.43, 0.42],
        ]
        inp = FFSLevel2Input(
            equipment_id=self.equip_id,
            design_pressure=150.0,
            design_temperature=350.0,
            nominal_thickness=0.500,
            allowable_stress=20000.0,
            inside_diameter=48.0,
            thickness_grid=grid,
            grid_spacing_circ=3.0,
            grid_spacing_long=6.0,
        )
        result = self.engine.assess_level_2(inp)
        circ = [p for p in result.critical_thickness_profiles if p["direction"] == "circumferential"]
        long = [p for p in result.critical_thickness_profiles if p["direction"] == "longitudinal"]
        assert len(circ) == 2  # 2 rows
        assert len(long) == 2  # 2 columns

    def test_level_2_empty_grid(self):
        """Empty grid returns pass with warning."""
        inp = FFSLevel2Input(
            equipment_id=self.equip_id,
            design_pressure=150.0,
            design_temperature=350.0,
            nominal_thickness=0.500,
            allowable_stress=20000.0,
            inside_diameter=48.0,
            thickness_grid=[],
            grid_spacing_circ=3.0,
            grid_spacing_long=6.0,
        )
        result = self.engine.assess_level_2(inp)
        assert result.overall_pass is True
        assert "No grid data" in result.recommended_action
