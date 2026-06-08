"""
Tests — ERS Predict Digital Twin
══════════════════════════════════
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from ers_predict.schemas import (
    DegradationMechanism,
    DegradationModelConfig,
    FeatureVector,
    FrequencyFeatures,
    OperationalContext,
    ScenarioInput,
    TimeSeriesFeatures,
    WindowStats,
)


def _make_twin_features(health_pct: float = 85.0) -> FeatureVector:
    """Helper to create features for twin testing."""
    rms = (100 - health_pct) / 10.0
    return FeatureVector(
        asset_id=uuid4(),
        time_series=[
            TimeSeriesFeatures(
                tag="VIB_DE",
                windows=[
                    WindowStats(window_name="1h", mean=rms, std=0.5,
                                min_val=rms - 0.5, max_val=rms + 0.5,
                                kurtosis=0.3, rms=rms, sample_count=60),
                    WindowStats(window_name="24h", mean=rms, std=0.8,
                                min_val=rms - 1, max_val=rms + 1,
                                kurtosis=0.5, rms=rms, sample_count=1440),
                ],
                trend_slope=-0.01,
                change_rate=-0.001,
            ),
        ],
        frequency=[
            FrequencyFeatures(
                tag="VIB_DE",
                dominant_frequency_hz=60.0,
                peak_amplitude=0.3,
                spectral_energy=2.0,
                crest_factor=3.0,
            ),
        ],
        operational=OperationalContext(
            hours_since_last_pm=1000,
            load_factor=0.85,
            ambient_temp_delta=5.0,
            running_hours=20000,
            start_stop_cycles=100,
            operating_regime="normal",
        ),
        historical_patterns=[],
        data_quality_score=95.0,
    )


class TestAssetDigitalTwin:
    """Tests for single asset digital twin."""

    def setup_method(self):
        from ers_predict.twin.single_asset import AssetDigitalTwin
        self.asset_id = uuid4()
        self.twin = AssetDigitalTwin(self.asset_id, "pump")

    def test_initial_state(self):
        state = self.twin.get_state()
        assert state.asset_id == self.asset_id
        assert state.health_index == 100.0
        assert state.calibration_quality == 100.0

    def test_update_from_features(self):
        features = _make_twin_features(85.0)
        features.asset_id = self.asset_id
        self.twin.update_from_features(features)

        state = self.twin.get_state()
        assert 0 <= state.health_index <= 100
        assert state.updated_at is not None

    def test_health_projection(self):
        features = _make_twin_features(80.0)
        features.asset_id = self.asset_id
        self.twin.update_from_features(features)

        state = self.twin.get_state()
        assert len(state.health_projection) > 0

        for proj in state.health_projection:
            assert proj.days_ahead > 0
            assert proj.confidence_lower <= proj.health_index <= proj.confidence_upper

    def test_calibration_from_inspection(self):
        features = _make_twin_features(80.0)
        features.asset_id = self.asset_id
        self.twin.update_from_features(features)

        # Calibrate with actual observation
        self.twin.update_from_inspection(75.0)
        assert self.twin.last_calibrated_at is not None

    def test_set_degradation_models(self):
        models = [
            DegradationModelConfig(
                mechanism=DegradationMechanism.BEARING_WEAR,
                model_type="l10_life",
                parameters={"dynamic_capacity_kn": 50.0, "life_exponent": 3.0},
                current_damage_pct=25.0,
            ),
        ]
        self.twin.set_degradation_models(models)
        assert len(self.twin.degradation_models) == 1


class TestDegradationModels:
    """Tests for physics-informed degradation models."""

    def setup_method(self):
        from ers_predict.twin.degradation import DegradationModelEngine
        self.engine = DegradationModelEngine()

    def test_fatigue_miners_rule(self):
        result = self.engine.compute(
            DegradationMechanism.FATIGUE_ACCUMULATION,
            {"design_cycles": 1e7, "sn_exponent": 3.0},
            {"actual_cycles": 5e6, "stress_ratio": 1.0},
        )
        assert result.current_damage_pct == pytest.approx(50.0, abs=0.1)

    def test_fatigue_overloaded(self):
        result = self.engine.compute(
            DegradationMechanism.FATIGUE_ACCUMULATION,
            {"design_cycles": 1e7, "sn_exponent": 3.0},
            {"actual_cycles": 5e6, "stress_ratio": 1.5},
        )
        # Overloaded should have higher damage
        assert result.current_damage_pct > 50.0

    def test_corrosion_linear(self):
        result = self.engine.compute(
            DegradationMechanism.CORROSION_RATE,
            {"corrosion_rate_mmpy": 0.1, "initial_thickness_mm": 10.0,
             "min_thickness_mm": 3.0, "corrosion_model": 0},
            {"years_in_service": 35},
        )
        # 35 years × 0.1 mm/yr = 3.5mm loss → 3.5/7 = 50%
        assert result.current_damage_pct == pytest.approx(50.0, abs=1.0)

    def test_bearing_l10(self):
        result = self.engine.compute(
            DegradationMechanism.BEARING_WEAR,
            {"dynamic_capacity_kn": 50.0, "life_exponent": 3.0},
            {"equivalent_load_kn": 20.0, "speed_rpm": 3600, "running_hours": 10000},
        )
        assert 0 <= result.current_damage_pct <= 100

    def test_insulation_arrhenius(self):
        result = self.engine.compute(
            DegradationMechanism.INSULATION_DEGRADATION,
            {"reference_life_hours": 100000, "reference_temp_c": 105,
             "activation_energy_ev": 1.0},
            {"winding_temp_c": 90, "running_hours": 50000},
        )
        assert 0 <= result.current_damage_pct <= 100

    def test_erosion(self):
        result = self.engine.compute(
            DegradationMechanism.EROSION,
            {"design_velocity_ms": 10.0, "velocity_exponent": 2.5,
             "initial_thickness_mm": 10.0, "min_thickness_mm": 3.0,
             "base_erosion_rate_mmpy": 0.05},
            {"actual_velocity_ms": 12.0, "years_in_service": 10},
        )
        assert 0 <= result.current_damage_pct <= 100


class TestScenarioEngine:
    """Tests for what-if scenario engine."""

    def setup_method(self):
        from ers_predict.twin.scenario_engine import ScenarioEngine
        from ers_predict.twin.single_asset import AssetDigitalTwin

        self.asset_id = uuid4()
        self.twin = AssetDigitalTwin(self.asset_id, "pump")
        features = _make_twin_features(75.0)
        features.asset_id = self.asset_id
        self.twin.update_from_features(features)

        self.engine = ScenarioEngine(default_monte_carlo_runs=100)

    def test_pm_interval_scenario(self):
        scenario = ScenarioInput(
            scenario_name="Reduce PM interval",
            parameters={
                "change_type": "pm_interval",
                "current_days": 90,
                "proposed_days": 30,
                "annual_pm_cost": 8000,
                "failure_cost": 50000,
            },
        )
        result = self.engine.run_scenario(self.twin, scenario)

        assert result.scenario_name == "Reduce PM interval"
        assert result.baseline is not None
        assert result.projected is not None
        assert "availability_pct" in result.delta
        assert result.recommendation is not None

    def test_strategy_change_scenario(self):
        scenario = ScenarioInput(
            scenario_name="Switch to CBM",
            parameters={
                "change_type": "strategy",
                "current": "time_based",
                "proposed": "condition_based",
                "annual_pm_cost": 6000,
                "failure_cost": 50000,
            },
        )
        result = self.engine.run_scenario(self.twin, scenario)
        assert result.projected.failure_probability_1y <= result.baseline.failure_probability_1y + 0.3


class TestSystemTwin:
    """Tests for system-level digital twin."""

    def setup_method(self):
        from ers_predict.twin.single_asset import AssetDigitalTwin
        from ers_predict.twin.system_twin import SystemDigitalTwin

        self.unit_id = uuid4()
        self.system = SystemDigitalTwin(self.unit_id, "Gas Compression Unit")

        # Create 3 asset twins
        self.asset_ids = [uuid4() for _ in range(3)]
        for i, aid in enumerate(self.asset_ids):
            twin = AssetDigitalTwin(aid, "compressor")
            twin.health_index = 90.0 - i * 10  # 90, 80, 70
            self.system.register_twin(twin)

    def test_series_reliability(self):
        self.system.build_topology({
            "asset_id": str(self.unit_id),
            "name": "System",
            "type": "series",
            "children": [
                {"asset_id": str(self.asset_ids[0]), "name": "Comp A", "type": "series", "children": []},
                {"asset_id": str(self.asset_ids[1]), "name": "Comp B", "type": "series", "children": []},
                {"asset_id": str(self.asset_ids[2]), "name": "Comp C", "type": "series", "children": []},
            ],
        })
        result = self.system.compute_system_reliability()

        # Series: R = R1 × R2 × R3 = 0.9 × 0.8 × 0.7 = 0.504
        assert result.system_reliability == pytest.approx(0.504, abs=0.01)

    def test_parallel_reliability(self):
        self.system.build_topology({
            "asset_id": str(self.unit_id),
            "name": "System",
            "type": "parallel",
            "children": [
                {"asset_id": str(self.asset_ids[0]), "name": "Comp A", "type": "series", "children": []},
                {"asset_id": str(self.asset_ids[1]), "name": "Comp B", "type": "series", "children": []},
            ],
        })
        result = self.system.compute_system_reliability()

        # Parallel: R = 1 - (1-0.9)(1-0.8) = 1 - 0.02 = 0.98
        assert result.system_reliability == pytest.approx(0.98, abs=0.01)

    def test_bottleneck_identification(self):
        self.system.build_topology({
            "asset_id": str(self.unit_id),
            "name": "System",
            "type": "series",
            "children": [
                {"asset_id": str(self.asset_ids[0]), "name": "Comp A", "type": "series", "children": []},
                {"asset_id": str(self.asset_ids[1]), "name": "Comp B", "type": "series", "children": []},
                {"asset_id": str(self.asset_ids[2]), "name": "Comp C", "type": "series", "children": []},
            ],
        })
        self.system.compute_system_reliability()

        bottlenecks = self.system.identify_bottlenecks(top_n=3)
        assert len(bottlenecks) > 0
        assert bottlenecks[0].rank == 1
        assert bottlenecks[0].system_impact_pct > 0


class TestCalibrationEngine:
    """Tests for calibration engine."""

    def setup_method(self):
        from ers_predict.twin.calibration import CalibrationEngine
        self.engine = CalibrationEngine()

    def test_good_calibration(self):
        twin_id = uuid4()
        asset_id = uuid4()
        report = self.engine.check_calibration(twin_id, asset_id, 80.0, 82.0)

        assert report.calibration_quality > 90
        assert report.drift_score < 5
        assert not report.needs_recalibration

    def test_poor_calibration(self):
        twin_id = uuid4()
        asset_id = uuid4()

        # Submit many drifting observations
        for i in range(25):
            self.engine.check_calibration(twin_id, asset_id, 80.0, 50.0)

        report = self.engine.check_calibration(twin_id, asset_id, 80.0, 50.0)
        assert report.drift_score > 20
        assert report.needs_recalibration

    def test_auto_recalibrate(self):
        twin_id = uuid4()
        asset_id = uuid4()
        corrections = self.engine.auto_recalibrate(
            twin_id, asset_id,
            [80, 78, 76, 74, 72],
            [75, 73, 71, 69, 67],
        )
        assert "bias_correction" in corrections
        assert "scale_correction" in corrections
        assert corrections["bias_correction"] < 0  # predicted higher than actual


class TestAlertFatigueManager:
    """Tests for alert fatigue management."""

    def setup_method(self):
        from ers_predict.alerts.manager import AlertFatigueManager
        from ers_predict.schemas import AlertSeverity
        self.manager = AlertFatigueManager()
        self.AlertSeverity = AlertSeverity

    def test_process_alert(self):
        asset_id = uuid4()
        alert = self.manager.process_alert(
            asset_id=asset_id,
            alert_type="anomaly",
            severity=self.AlertSeverity.HIGH,
            title="High vibration detected",
            description="Vibration exceeds threshold",
            confidence=0.85,
            value=65.0,
        )
        assert alert is not None
        assert alert.asset_id == asset_id

    def test_suppression(self):
        asset_id = uuid4()
        # First alert should go through
        alert1 = self.manager.process_alert(
            asset_id, "anomaly", self.AlertSeverity.HIGH,
            "Alert 1", "Desc", 0.8, value=60.0,
        )
        assert alert1 is not None

        # Second alert within suppression window should be suppressed
        alert2 = self.manager.process_alert(
            asset_id, "anomaly", self.AlertSeverity.HIGH,
            "Alert 2", "Desc", 0.8, value=60.0,
        )
        assert alert2 is None

    def test_below_threshold_suppressed(self):
        asset_id = uuid4()
        alert = self.manager.process_alert(
            asset_id, "anomaly", self.AlertSeverity.LOW,
            "Low alert", "Desc", 0.5, value=10.0,
        )
        # Value 10 is below default threshold of 50
        assert alert is None

    def test_record_outcome(self):
        # Should not raise
        self.manager.record_outcome("anomaly", was_true_positive=True)
        self.manager.record_outcome("anomaly", was_true_positive=False)

    def test_get_active_alerts(self):
        asset_id = uuid4()
        self.manager.process_alert(
            asset_id, "anomaly", self.AlertSeverity.HIGH,
            "Test", "Desc", 0.85, value=60.0,
        )
        alerts = self.manager.get_active_alerts(asset_id)
        assert len(alerts) >= 1
