"""
Tests — Inspection Interval Calculator & Corrosion Rate Engine
══════════════════════════════════════════════════════════════
Tests for API 510/570/653 interval rules and corrosion rate calculation.
"""
import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from ers_comply.inspection.engine import InspectionIntervalEngine
from ers_comply.corrosion.engine import CorrosionRateEngine
from ers_comply.schemas import (
    InspectionIntervalInput, GoverningCode,
    CorrosionRateInput, ThicknessReadingCreate, UTMethod,
)


# ═══════════════════════════════════════════════════════════
#  Inspection Interval Calculator
# ═══════════════════════════════════════════════════════════

class TestInspectionInterval:
    """Tests for the inspection interval calculator."""

    def setup_method(self):
        self.engine = InspectionIntervalEngine()
        self.equip_id = uuid4()

    def test_basic_interval_calculation(self):
        """Standard interval: min(code_max, remaining_life / 2)."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            last_inspection_date=datetime(2024, 1, 1),
            current_thickness=0.400,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.010,
            corrosion_rate_long=0.008,
        )
        result = self.engine.calculate_interval(inp)
        # remaining_life = (0.400 - 0.250) / 0.010 = 15 years
        # half_life = 7.5
        # code_max = 10
        # interval = min(10, 7.5) = 7.5
        assert result.remaining_life_years == pytest.approx(15.0, abs=0.01)
        assert result.calculated_interval_years == pytest.approx(7.5, abs=0.01)
        assert result.corrosion_rate_used == 0.010
        assert result.next_inspection_due is not None

    def test_conservative_rate_selection(self):
        """Always uses max of short and long-term rates."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            current_thickness=0.400,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.005,
            corrosion_rate_long=0.015,  # long is higher
        )
        result = self.engine.calculate_interval(inp)
        assert result.corrosion_rate_used == 0.015

    def test_code_max_caps_interval(self):
        """Interval never exceeds code maximum."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            current_thickness=0.480,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.001,  # very low rate
            corrosion_rate_long=0.001,
        )
        result = self.engine.calculate_interval(inp)
        # remaining_life = 230 years, half = 115
        # capped at code_max = 10
        assert result.calculated_interval_years == 10.0

    def test_new_equipment_uses_code_max(self):
        """New equipment with no history uses code maximum interval."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_570,
            current_thickness=0.500,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            is_new_equipment=True,
        )
        result = self.engine.calculate_interval(inp)
        assert result.calculated_interval_years == 10.0
        assert "New equipment" in result.warnings[0]

    def test_zero_corrosion_rate_uses_code_max(self):
        """Zero corrosion rate uses code maximum."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_653,
            current_thickness=0.400,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.0,
            corrosion_rate_long=0.0,
        )
        result = self.engine.calculate_interval(inp)
        assert result.calculated_interval_years == 10.0

    def test_below_retirement_thickness_warning(self):
        """Warning when current thickness <= retirement thickness."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            current_thickness=0.240,  # below retirement
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.010,
            corrosion_rate_long=0.008,
        )
        result = self.engine.calculate_interval(inp)
        assert result.remaining_life_years == 0.0
        assert any("CRITICAL" in w for w in result.warnings)

    def test_rbi_extended_interval(self):
        """RBI can extend interval but never exceeds code max."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            current_thickness=0.400,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.010,
            corrosion_rate_long=0.008,
            rbi_extended=True,
            rbi_extended_interval_years=9.0,
        )
        result = self.engine.calculate_interval(inp)
        # half_life = 7.5, RBI wants 9 → capped at 7.5
        assert result.calculated_interval_years == pytest.approx(7.5, abs=0.01)

    def test_rbi_exceeds_code_max_warning(self):
        """Warning when RBI interval exceeds code max."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            current_thickness=0.480,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.001,
            corrosion_rate_long=0.001,
            rbi_extended=True,
            rbi_extended_interval_years=15.0,  # exceeds code max 10
        )
        result = self.engine.calculate_interval(inp)
        assert result.calculated_interval_years == 10.0
        assert any("exceeds code max" in w for w in result.warnings)

    def test_low_remaining_life_warning(self):
        """Warning when remaining life < 2 years."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            current_thickness=0.265,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.010,
            corrosion_rate_long=0.010,
        )
        result = self.engine.calculate_interval(inp)
        # remaining = (0.265 - 0.250) / 0.010 = 1.5 yr
        assert result.remaining_life_years == pytest.approx(1.5, abs=0.1)
        assert any("less than 2 years" in w for w in result.warnings)

    def test_safety_disclaimer_always_present(self):
        """Safety disclaimer is always included."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            current_thickness=0.400,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.010,
            corrosion_rate_long=0.008,
        )
        result = self.engine.calculate_interval(inp)
        assert "reference calculation" in result.safety_disclaimer
        assert "Tier 5" in result.safety_disclaimer

    def test_accelerating_corrosion_warning(self):
        """Warning when short-term > 2× long-term rate."""
        inp = InspectionIntervalInput(
            equipment_id=self.equip_id,
            governing_code=GoverningCode.API_510,
            current_thickness=0.400,
            nominal_thickness=0.500,
            retirement_thickness=0.250,
            corrosion_rate_short=0.025,
            corrosion_rate_long=0.010,
        )
        result = self.engine.calculate_interval(inp)
        assert any("Accelerating" in w for w in result.warnings)

    def test_all_governing_codes(self):
        """All governing codes produce valid results."""
        for code in GoverningCode:
            inp = InspectionIntervalInput(
                equipment_id=self.equip_id,
                governing_code=code,
                current_thickness=0.400,
                nominal_thickness=0.500,
                retirement_thickness=0.250,
                corrosion_rate_short=0.010,
                corrosion_rate_long=0.008,
            )
            result = self.engine.calculate_interval(inp)
            assert result.calculated_interval_years > 0


# ═══════════════════════════════════════════════════════════
#  Corrosion Rate Calculator
# ═══════════════════════════════════════════════════════════

class TestCorrosionRate:
    """Tests for the corrosion rate calculator."""

    def setup_method(self):
        self.engine = CorrosionRateEngine()
        self.cml_id = uuid4()

    def _make_reading(self, date, thickness):
        return ThicknessReadingCreate(
            cml_id=self.cml_id,
            reading_date=date,
            measured_thickness=thickness,
            method=UTMethod.UT_CONTACT,
        )

    def test_basic_rate_calculation(self):
        """Short-term and long-term rates calculated correctly."""
        install = datetime(2020, 1, 1)
        readings = [
            self._make_reading(datetime(2022, 1, 1), 0.470),
            self._make_reading(datetime(2024, 1, 1), 0.440),
        ]
        inp = CorrosionRateInput(
            cml_id=self.cml_id,
            readings=readings,
            nominal_thickness=0.500,
            installation_date=install,
        )
        result = self.engine.calculate_rates(inp)
        # short-term: (0.470 - 0.440) / 2 = 0.015
        # long-term: (0.500 - 0.440) / 4 = 0.015
        assert result.short_term_rate == pytest.approx(0.015, abs=0.002)
        assert result.long_term_rate == pytest.approx(0.015, abs=0.002)

    def test_acceleration_flag(self):
        """Flag when short-term > 2× long-term."""
        install = datetime(2010, 1, 1)
        readings = [
            self._make_reading(datetime(2022, 1, 1), 0.470),
            self._make_reading(datetime(2024, 1, 1), 0.400),  # rapid loss
        ]
        inp = CorrosionRateInput(
            cml_id=self.cml_id,
            readings=readings,
            nominal_thickness=0.500,
            installation_date=install,
        )
        result = self.engine.calculate_rates(inp)
        # short-term: (0.470 - 0.400) / 2 = 0.035
        # long-term: (0.500 - 0.400) / 14 ≈ 0.0071
        assert result.acceleration_flag is True
        assert result.acceleration_ratio > 2.0

    def test_no_acceleration_when_stable(self):
        """No flag when rates are stable."""
        install = datetime(2020, 1, 1)
        readings = [
            self._make_reading(datetime(2022, 1, 1), 0.480),
            self._make_reading(datetime(2024, 1, 1), 0.460),
        ]
        inp = CorrosionRateInput(
            cml_id=self.cml_id,
            readings=readings,
            nominal_thickness=0.500,
            installation_date=install,
        )
        result = self.engine.calculate_rates(inp)
        assert result.acceleration_flag is False

    def test_single_reading_defaults(self):
        """Single reading → short-term rate = 0."""
        readings = [
            self._make_reading(datetime(2024, 1, 1), 0.450),
        ]
        inp = CorrosionRateInput(
            cml_id=self.cml_id,
            readings=readings,
            nominal_thickness=0.500,
            installation_date=datetime(2020, 1, 1),
        )
        result = self.engine.calculate_rates(inp)
        assert result.short_term_rate == 0.0
        assert result.long_term_rate > 0

    def test_no_readings(self):
        """No readings → all zeros with warning."""
        inp = CorrosionRateInput(
            cml_id=self.cml_id,
            readings=[],
            nominal_thickness=0.500,
        )
        result = self.engine.calculate_rates(inp)
        assert result.short_term_rate == 0.0
        assert result.long_term_rate == 0.0
        assert len(result.warnings) > 0

    def test_measurement_uncertainty_warning(self):
        """Warning when change is within 2× UT uncertainty."""
        readings = [
            self._make_reading(datetime(2023, 1, 1), 0.450),
            self._make_reading(datetime(2024, 1, 1), 0.448),  # diff = 0.002
        ]
        inp = CorrosionRateInput(
            cml_id=self.cml_id,
            readings=readings,
            nominal_thickness=0.500,
            installation_date=datetime(2020, 1, 1),
            ut_uncertainty=0.005,
        )
        result = self.engine.calculate_rates(inp)
        assert any("uncertainty" in w.lower() for w in result.warnings)

    def test_conservative_max_rate(self):
        """max_observed_rate = max(short, long)."""
        install = datetime(2014, 1, 1)
        readings = [
            self._make_reading(datetime(2022, 1, 1), 0.430),
            self._make_reading(datetime(2024, 1, 1), 0.420),
        ]
        inp = CorrosionRateInput(
            cml_id=self.cml_id,
            readings=readings,
            nominal_thickness=0.500,
            installation_date=install,
        )
        result = self.engine.calculate_rates(inp)
        assert result.max_observed_rate == max(
            result.short_term_rate, result.long_term_rate
        )
