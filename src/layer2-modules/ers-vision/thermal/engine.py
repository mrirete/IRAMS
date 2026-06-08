"""
Thermal Analysis Engine
═══════════════════════
Analyzes IR images for thermal anomalies: hot spots, bearing anomalies,
refractory degradation, insulation failures, steam traps, HX fouling.

ALL outputs are Tier 2 (advisory).
"""
from typing import Any, Optional, List, Dict
from uuid import uuid4

from ers_vision.schemas import (
    ThermalAnalysisInput, ThermalAnalysisOutput, ThermalAnomaly,
    ThermalAnomalyType, ThermalSeverity,
)

# Temperature differential thresholds (°F)
ALARM_THRESHOLDS: Dict[ThermalAnomalyType, Dict[str, float]] = {
    ThermalAnomalyType.HOT_SPOT_ELECTRICAL: {
        "caution": 18.0, "warning": 36.0, "alarm": 70.0, "critical": 120.0,
    },
    ThermalAnomalyType.BEARING_ANOMALY: {
        "caution": 15.0, "warning": 30.0, "alarm": 50.0, "critical": 80.0,
    },
    ThermalAnomalyType.REFRACTORY_DEGRADATION: {
        "caution": 50.0, "warning": 100.0, "alarm": 200.0, "critical": 350.0,
    },
    ThermalAnomalyType.INSULATION_FAILURE: {
        "caution": 20.0, "warning": 40.0, "alarm": 80.0, "critical": 150.0,
    },
    ThermalAnomalyType.STEAM_TRAP_MALFUNCTION: {
        "caution": 10.0, "warning": 30.0, "alarm": 60.0, "critical": 100.0,
    },
    ThermalAnomalyType.HX_FOULING: {
        "caution": 15.0, "warning": 30.0, "alarm": 50.0, "critical": 80.0,
    },
}

_SEVERITY_ORDER = {
    ThermalSeverity.NORMAL: 0,
    ThermalSeverity.CAUTION: 1,
    ThermalSeverity.WARNING: 2,
    ThermalSeverity.ALARM: 3,
    ThermalSeverity.CRITICAL: 4,
}


class ThermalAnalysisEngine:
    """
    IR image thermal analysis engine.

    Classifies thermal anomalies by type and severity using
    industry-standard temperature differential thresholds.
    """

    def analyze(
        self,
        inp: ThermalAnalysisInput,
        thermal_readings: Optional[List[Dict[str, Any]]] = None,
        ai_client: Optional[Any] = None,
    ) -> ThermalAnalysisOutput:
        """
        Analyze thermal data.

        Args:
            inp: Analysis input with image/equipment context.
            thermal_readings: List of temperature measurement dicts with
                keys: type, temperature, reference_temperature, location
            ai_client: Optional AI client for vision analysis.
        """
        if thermal_readings:
            anomalies = self._analyze_readings(inp, thermal_readings)
        else:
            anomalies = self._deterministic_analysis(inp)

        max_temp = max((a.temperature_measured for a in anomalies), default=0.0)
        max_diff = max((a.temperature_differential for a in anomalies), default=0.0)

        overall_sev = max(
            (a.severity for a in anomalies),
            key=lambda s: _SEVERITY_ORDER.get(s, 0),
        ) if anomalies else ThermalSeverity.NORMAL

        return ThermalAnalysisOutput(
            asset_id=inp.asset_id,
            anomalies=anomalies,
            max_temperature=max_temp,
            max_differential=max_diff,
            overall_severity=overall_sev,
            requires_immediate_review=overall_sev == ThermalSeverity.CRITICAL,
        )

    def _analyze_readings(
        self,
        inp: ThermalAnalysisInput,
        readings: List[Dict[str, Any]],
    ) -> List[ThermalAnomaly]:
        """Analyze explicit temperature readings against thresholds."""
        anomalies = []
        ambient = inp.ambient_temperature or 70.0

        for reading in readings:
            anomaly_type_str = reading.get("type", "hot_spot_electrical")
            try:
                anomaly_type = ThermalAnomalyType(anomaly_type_str)
            except ValueError:
                anomaly_type = ThermalAnomalyType.HOT_SPOT_ELECTRICAL

            temp = float(reading.get("temperature", ambient))
            ref = float(reading.get("reference_temperature", ambient))
            diff = abs(temp - ref)

            severity = self._classify_severity(anomaly_type, diff)
            thresholds = ALARM_THRESHOLDS.get(anomaly_type, {})
            alarm = thresholds.get("alarm", 70.0)

            if severity != ThermalSeverity.NORMAL:
                anomalies.append(ThermalAnomaly(
                    anomaly_type=anomaly_type,
                    severity=severity,
                    temperature_measured=temp,
                    temperature_reference=ref,
                    temperature_differential=diff,
                    alarm_threshold=alarm,
                    location_description=reading.get("location", ""),
                    confidence=0.85,
                ))

        return anomalies

    def _deterministic_analysis(
        self, inp: ThermalAnalysisInput
    ) -> List[ThermalAnomaly]:
        """Deterministic fallback based on equipment type."""
        anomalies = []
        equip = (inp.equipment_type or "").lower()
        ambient = inp.ambient_temperature or 70.0

        if "motor" in equip or "electrical" in equip or "switchgear" in equip:
            anomalies.append(ThermalAnomaly(
                anomaly_type=ThermalAnomalyType.HOT_SPOT_ELECTRICAL,
                severity=ThermalSeverity.NORMAL,
                temperature_measured=ambient + 10,
                temperature_reference=ambient,
                temperature_differential=10.0,
                alarm_threshold=70.0,
                location_description="Electrical connections",
                confidence=0.40,
            ))

        if "bearing" in equip or "pump" in equip or "fan" in equip:
            anomalies.append(ThermalAnomaly(
                anomaly_type=ThermalAnomalyType.BEARING_ANOMALY,
                severity=ThermalSeverity.NORMAL,
                temperature_measured=ambient + 8,
                temperature_reference=ambient,
                temperature_differential=8.0,
                alarm_threshold=50.0,
                location_description="Bearing housing",
                confidence=0.40,
            ))

        if not anomalies:
            anomalies.append(ThermalAnomaly(
                anomaly_type=ThermalAnomalyType.NORMAL,
                severity=ThermalSeverity.NORMAL,
                temperature_measured=ambient,
                temperature_reference=ambient,
                temperature_differential=0.0,
                alarm_threshold=70.0,
                confidence=0.40,
            ))

        return anomalies

    @staticmethod
    def _classify_severity(
        anomaly_type: ThermalAnomalyType, diff: float
    ) -> ThermalSeverity:
        """Classify severity based on temperature differential."""
        thresholds = ALARM_THRESHOLDS.get(anomaly_type, {})
        if diff >= thresholds.get("critical", 999):
            return ThermalSeverity.CRITICAL
        elif diff >= thresholds.get("alarm", 999):
            return ThermalSeverity.ALARM
        elif diff >= thresholds.get("warning", 999):
            return ThermalSeverity.WARNING
        elif diff >= thresholds.get("caution", 999):
            return ThermalSeverity.CAUTION
        return ThermalSeverity.NORMAL
