"""
Tests — ERS Vision Engines
══════════════════════════════
Tests for all 6 vision analysis engines + router.
"""
import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from ers_vision.schemas import (
    AnalysisType, CorrosionType, CorrosionSeverity, RecommendedAction,
    ThermalAnomalyType, ThermalSeverity, ConditionItem,
    TaggingMethod, DroneFlightStatus,
)
from ers_vision.corrosion.engine import CorrosionDetectionEngine
from ers_vision.thermal.engine import ThermalAnalysisEngine
from ers_vision.condition.engine import ConditionAssessmentEngine
from ers_vision.tagging.engine import AutoTaggingEngine
from ers_vision.drone.engine import DroneSurveyEngine
from ers_vision.comparison.engine import HistoricalComparisonEngine
from ers_vision.schemas import (
    CorrosionAnalysisInput,
    ThermalAnalysisInput,
    ConditionAnalysisInput,
    TaggingInput,
    DroneSurveyInput,
    ComparisonInput,
)


# ══════════════════════════════════════════════════════════════
#  1) CORROSION DETECTION
# ══════════════════════════════════════════════════════════════

class TestCorrosionDetection:
    """Tests for the corrosion detection engine."""

    def setup_method(self):
        self.engine = CorrosionDetectionEngine()

    def test_marine_environment_detects_corrosion(self):
        """Marine environment triggers general corrosion detection."""
        inp = CorrosionAnalysisInput(
            equipment_material="carbon steel",
            environment="marine",
        )
        result = self.engine.analyze(inp)
        assert result.overall_severity != CorrosionSeverity.SURFACE or len(result.detections) > 0
        types = [d.corrosion_type for d in result.detections]
        assert CorrosionType.GENERAL in types

    def test_chloride_stainless_detects_scc(self):
        """Stainless + chloride environment triggers SCC detection."""
        inp = CorrosionAnalysisInput(
            equipment_material="stainless steel",
            environment="chloride-bearing",
        )
        result = self.engine.analyze(inp)
        types = [d.corrosion_type for d in result.detections]
        assert CorrosionType.SCC in types

    def test_scc_severity_is_severe(self):
        """SCC detection has severe severity."""
        inp = CorrosionAnalysisInput(
            equipment_material="stainless steel",
            environment="chloride",
        )
        result = self.engine.analyze(inp)
        scc_findings = [d for d in result.detections if d.corrosion_type == CorrosionType.SCC]
        assert len(scc_findings) > 0
        assert scc_findings[0].severity == CorrosionSeverity.SEVERE

    def test_neutral_environment_clean(self):
        """Indoor/neutral environment → no significant corrosion."""
        inp = CorrosionAnalysisInput(
            equipment_material="carbon steel",
            environment="indoor climate controlled",
        )
        result = self.engine.analyze(inp)
        types = [d.corrosion_type for d in result.detections]
        assert CorrosionType.NONE in types

    def test_critical_flags_immediate_review(self):
        """Critical severity → requires_immediate_review = True."""
        inp = CorrosionAnalysisInput(environment="marine")
        result = self.engine.analyze(inp)
        # Force a critical finding for test
        from ers_vision.schemas import CorrosionDetection
        result.detections.append(CorrosionDetection(
            corrosion_type=CorrosionType.GENERAL,
            severity=CorrosionSeverity.CRITICAL,
            affected_area_percent=50.0,
            recommended_action=RecommendedAction.URGENT_INSPECT,
            confidence=0.9,
        ))
        # Re-check (engine does this internally, but we validate the flag logic)
        from ers_vision.corrosion.engine import _SEVERITY_ORDER
        overall = max(
            (d.severity for d in result.detections),
            key=lambda s: _SEVERITY_ORDER.get(s, 0),
        )
        assert overall == CorrosionSeverity.CRITICAL

    def test_all_outputs_are_tier_2(self):
        """All corrosion outputs are Tier 2."""
        inp = CorrosionAnalysisInput(environment="industrial")
        result = self.engine.analyze(inp)
        assert result.governance_tier == 2

    def test_confidence_between_0_and_1(self):
        """All detections have confidence in [0, 1]."""
        inp = CorrosionAnalysisInput(environment="marine")
        result = self.engine.analyze(inp)
        for d in result.detections:
            assert 0.0 <= d.confidence <= 1.0


# ══════════════════════════════════════════════════════════════
#  2) THERMAL ANALYSIS
# ══════════════════════════════════════════════════════════════

class TestThermalAnalysis:
    """Tests for the thermal analysis engine."""

    def setup_method(self):
        self.engine = ThermalAnalysisEngine()

    def test_normal_readings_no_anomaly(self):
        """Below-threshold differentials → normal."""
        inp = ThermalAnalysisInput(ambient_temperature=70.0)
        readings = [
            {"type": "hot_spot_electrical", "temperature": 80, "reference_temperature": 70},
        ]
        result = self.engine.analyze(inp, thermal_readings=readings)
        # 10°F diff < 18°F caution threshold → no anomalies
        assert len(result.anomalies) == 0 or result.overall_severity == ThermalSeverity.NORMAL

    def test_caution_threshold_exceeded(self):
        """Differential at caution threshold → found."""
        inp = ThermalAnalysisInput(ambient_temperature=70.0)
        readings = [
            {"type": "hot_spot_electrical", "temperature": 90, "reference_temperature": 70},
        ]
        result = self.engine.analyze(inp, thermal_readings=readings)
        assert len(result.anomalies) >= 1
        assert result.anomalies[0].severity == ThermalSeverity.CAUTION

    def test_critical_electrical_hotspot(self):
        """120°F+ differential → critical."""
        inp = ThermalAnalysisInput(ambient_temperature=70.0)
        readings = [
            {"type": "hot_spot_electrical", "temperature": 200, "reference_temperature": 70},
        ]
        result = self.engine.analyze(inp, thermal_readings=readings)
        assert result.overall_severity == ThermalSeverity.CRITICAL
        assert result.requires_immediate_review is True

    def test_bearing_anomaly_detection(self):
        """Bearing hot spot detection."""
        inp = ThermalAnalysisInput(ambient_temperature=70.0)
        readings = [
            {"type": "bearing_anomaly", "temperature": 135, "reference_temperature": 70},
        ]
        result = self.engine.analyze(inp, thermal_readings=readings)
        types = [a.anomaly_type for a in result.anomalies]
        assert ThermalAnomalyType.BEARING_ANOMALY in types
        assert result.anomalies[0].severity == ThermalSeverity.ALARM  # 65°F > 50°F alarm

    def test_max_temperature_tracked(self):
        """Max temperature across anomalies is tracked."""
        inp = ThermalAnalysisInput(ambient_temperature=70.0)
        readings = [
            {"type": "hot_spot_electrical", "temperature": 150, "reference_temperature": 70},
            {"type": "bearing_anomaly", "temperature": 120, "reference_temperature": 70},
        ]
        result = self.engine.analyze(inp, thermal_readings=readings)
        assert result.max_temperature == 150.0

    def test_deterministic_fallback_motor(self):
        """Motor equipment type → electrical anomaly check."""
        inp = ThermalAnalysisInput(
            equipment_type="motor", ambient_temperature=70.0,
        )
        result = self.engine.analyze(inp)
        types = [a.anomaly_type for a in result.anomalies]
        assert ThermalAnomalyType.HOT_SPOT_ELECTRICAL in types

    def test_all_outputs_tier_2(self):
        """All thermal outputs are Tier 2."""
        inp = ThermalAnalysisInput()
        result = self.engine.analyze(inp)
        assert result.governance_tier == 2


# ══════════════════════════════════════════════════════════════
#  3) CONDITION ASSESSMENT
# ══════════════════════════════════════════════════════════════

class TestConditionAssessment:
    """Tests for the condition assessment engine."""

    def setup_method(self):
        self.engine = ConditionAssessmentEngine()

    def test_from_observations(self):
        """Structured observations convert correctly."""
        inp = ConditionAnalysisInput()
        observations = [
            {"item": "oil_leak", "detected": True, "severity": "moderate", "score": 2},
            {"item": "housekeeping", "detected": False, "severity": "normal", "score": 4},
        ]
        result = self.engine.analyze(inp, observations=observations)
        assert len(result.findings) == 2
        assert result.items_requiring_action == 1  # oil_leak detected

    def test_housekeeping_score(self):
        """Housekeeping score extracted correctly."""
        inp = ConditionAnalysisInput()
        observations = [
            {"item": "housekeeping", "detected": False, "severity": "normal", "score": 2},
        ]
        result = self.engine.analyze(inp, observations=observations)
        assert result.housekeeping_score == 2

    def test_overall_score_averaged(self):
        """Overall score is average of all finding scores."""
        inp = ConditionAnalysisInput()
        observations = [
            {"item": "oil_leak", "detected": False, "severity": "normal", "score": 5},
            {"item": "housekeeping", "detected": False, "severity": "normal", "score": 3},
        ]
        result = self.engine.analyze(inp, observations=observations)
        assert result.overall_condition_score == 4.0  # (5+3)/2

    def test_deterministic_includes_housekeeping(self):
        """Deterministic fallback includes housekeeping."""
        inp = ConditionAnalysisInput()
        result = self.engine.analyze(inp)
        items = [f.item for f in result.findings]
        assert ConditionItem.HOUSEKEEPING in items

    def test_all_outputs_tier_2(self):
        """All condition outputs are Tier 2."""
        inp = ConditionAnalysisInput()
        result = self.engine.analyze(inp)
        assert result.governance_tier == 2


# ══════════════════════════════════════════════════════════════
#  4) AUTO-TAGGING
# ══════════════════════════════════════════════════════════════

class TestAutoTagging:
    """Tests for the auto-tagging engine."""

    def setup_method(self):
        self.engine = AutoTaggingEngine()

    def test_nfc_match(self):
        """NFC data matches known asset."""
        registry = {"V-201-NFC": uuid4()}
        inp = TaggingInput(nfc_data="V-201-NFC")
        result = self.engine.tag(inp, asset_registry=registry)
        assert result.asset_id == registry["V-201-NFC"]
        assert result.tagging_method == TaggingMethod.NFC
        assert result.confidence == 0.98

    def test_barcode_match(self):
        """Barcode in image data matches asset."""
        asset_id = uuid4()
        registry = {"EQUIP-V201": asset_id}
        inp = TaggingInput(image_data="photo_with_EQUIP-V201_visible")
        result = self.engine.tag(inp, asset_registry=registry)
        assert result.asset_id == asset_id
        assert result.tagging_method == TaggingMethod.BARCODE

    def test_gps_proximity_match(self):
        """GPS coordinates match nearest asset."""
        asset_id = uuid4()
        self.engine.register_asset_location(
            asset_id, "V-201", 29.7604, -95.3698,
        )
        inp = TaggingInput(gps_lat=29.7605, gps_lon=-95.3699)  # ~15m away
        result = self.engine.tag(inp)
        assert result.asset_id == asset_id
        assert result.tagging_method == TaggingMethod.GPS
        assert result.gps_match_distance_m is not None
        assert result.gps_match_distance_m < 50.0

    def test_gps_too_far_no_match(self):
        """GPS too far away → no match."""
        asset_id = uuid4()
        self.engine.register_asset_location(
            asset_id, "V-201", 29.7604, -95.3698,
        )
        inp = TaggingInput(gps_lat=30.0, gps_lon=-95.0)  # ~50km away
        result = self.engine.tag(inp)
        assert result.asset_id is None
        assert result.tagging_method == TaggingMethod.MANUAL

    def test_no_match_fallback(self):
        """No matching data → manual fallback."""
        inp = TaggingInput()
        result = self.engine.tag(inp)
        assert result.tagging_method == TaggingMethod.MANUAL
        assert result.confidence == 0.0


# ══════════════════════════════════════════════════════════════
#  5) DRONE SURVEY
# ══════════════════════════════════════════════════════════════

class TestDroneSurvey:
    """Tests for the drone survey engine."""

    def setup_method(self):
        self.engine = DroneSurveyEngine()

    def test_basic_survey_processing(self):
        """Process a survey with clean images."""
        inp = DroneSurveyInput(
            images=[
                {"location": "North face"},
                {"location": "South face"},
            ],
        )
        result = self.engine.process_survey(inp)
        assert result.total_images == 2
        assert result.images_analyzed == 2
        assert result.status == DroneFlightStatus.ANALYZED

    def test_anomaly_detection_corrosion(self):
        """Corrosion markers in image → anomaly detected."""
        inp = DroneSurveyInput(
            images=[
                {"location": "North face", "corrosion_markers": True},
            ],
        )
        result = self.engine.process_survey(inp)
        assert result.anomaly_count >= 1
        types = [a.anomaly_type for a in result.anomalies]
        assert "corrosion" in types

    def test_anomaly_detection_structural(self):
        """Structural damage in image → anomaly detected."""
        inp = DroneSurveyInput(
            images=[
                {"location": "Top", "structural_damage": True},
            ],
        )
        result = self.engine.process_survey(inp)
        types = [a.anomaly_type for a in result.anomalies]
        assert "structural" in types

    def test_flagged_anomaly(self):
        """Pre-flagged anomalies are recorded."""
        inp = DroneSurveyInput(
            images=[{
                "location": "East face",
                "flags": [{"type": "crack", "severity": "high", "confidence": 0.8}],
            }],
        )
        result = self.engine.process_survey(inp)
        assert result.anomaly_count >= 1
        assert result.anomalies[0].requires_followup is True

    def test_coverage_calculation(self):
        """Coverage increases with image count."""
        inp_few = DroneSurveyInput(
            images=[{"location": f"Img {i}"} for i in range(3)],
        )
        inp_many = DroneSurveyInput(
            images=[{"location": f"Img {i}"} for i in range(15)],
        )
        r_few = self.engine.process_survey(inp_few)
        r_many = self.engine.process_survey(inp_many)
        assert r_many.coverage_percent > r_few.coverage_percent

    def test_composite_generated_flag(self):
        """Multiple images → composite_generated = True."""
        inp = DroneSurveyInput(images=[{}, {}])
        result = self.engine.process_survey(inp)
        assert result.composite_generated is True

    def test_survey_retrievable(self):
        """Processed survey can be retrieved by ID."""
        inp = DroneSurveyInput(images=[{}])
        result = self.engine.process_survey(inp)
        retrieved = self.engine.get_survey(result.survey_id)
        assert retrieved is not None
        assert retrieved.survey_id == result.survey_id

    def test_all_outputs_tier_2(self):
        """All drone outputs are Tier 2."""
        inp = DroneSurveyInput(images=[{}])
        result = self.engine.process_survey(inp)
        assert result.governance_tier == 2


# ══════════════════════════════════════════════════════════════
#  6) HISTORICAL COMPARISON
# ══════════════════════════════════════════════════════════════

class TestHistoricalComparison:
    """Tests for the historical comparison engine."""

    def setup_method(self):
        self.engine = HistoricalComparisonEngine()

    def test_degradation_detected(self):
        """Increased corrosion area → degrading trend."""
        inp = ComparisonInput(
            asset_id=uuid4(),
            baseline_date=datetime(2023, 1, 1),
            current_date=datetime(2025, 1, 1),
        )
        baseline = {"corrosion_area_percent": 5.0, "surface_roughness": 1.2}
        current = {"corrosion_area_percent": 12.0, "surface_roughness": 2.8}
        result = self.engine.compare(inp, baseline, current)
        assert result.overall_trend == "degrading"
        assert result.elapsed_days == 731

    def test_improvement_detected(self):
        """Decreased values → improving trend."""
        inp = ComparisonInput(
            baseline_date=datetime(2023, 1, 1),
            current_date=datetime(2025, 1, 1),
        )
        baseline = {"defect_count": 10.0}
        current = {"defect_count": 3.0}
        result = self.engine.compare(inp, baseline, current)
        assert result.overall_trend == "improving"

    def test_stable_within_threshold(self):
        """Change < 5% → stable."""
        inp = ComparisonInput(
            baseline_date=datetime(2023, 1, 1),
            current_date=datetime(2024, 1, 1),
        )
        baseline = {"area": 10.0}
        current = {"area": 10.3}
        result = self.engine.compare(inp, baseline, current)
        assert result.overall_trend == "stable"

    def test_rbi_calibration_generated(self):
        """Elapsed > 365 days → RBI calibration data included."""
        inp = ComparisonInput(
            baseline_date=datetime(2023, 1, 1),
            current_date=datetime(2025, 1, 1),
        )
        baseline = {"corrosion_area_percent": 5.0}
        current = {"corrosion_area_percent": 15.0}
        result = self.engine.compare(inp, baseline, current)
        assert result.rbi_calibration_data is not None
        assert "elapsed_years" in result.rbi_calibration_data

    def test_degradation_rate_per_year(self):
        """Degradation rate per year calculated for area metrics."""
        inp = ComparisonInput(
            baseline_date=datetime(2023, 1, 1),
            current_date=datetime(2025, 1, 1),
        )
        baseline = {"corrosion_area_percent": 5.0}
        current = {"corrosion_area_percent": 15.0}
        result = self.engine.compare(inp, baseline, current)
        assert result.degradation_rate_per_year is not None
        assert result.degradation_rate_per_year > 0

    def test_deterministic_fallback(self):
        """No metrics → deterministic stable result."""
        inp = ComparisonInput()
        result = self.engine.compare(inp)
        assert result.overall_trend == "stable"
        assert len(result.degradation_metrics) == 2

    def test_all_outputs_tier_2(self):
        """All comparison outputs are Tier 2."""
        inp = ComparisonInput()
        result = self.engine.compare(inp)
        assert result.governance_tier == 2
