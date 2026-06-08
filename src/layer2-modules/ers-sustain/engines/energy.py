"""
Energy Degradation Engine
═════════════════════════
Analyzes energy consumption telemetry to detect mechanical degradation
(using energy inefficiency as a proxy for mechanical condition).
"""
from typing import List, Optional
from uuid import UUID

from ers_sustain.schemas import EnergyReading, EnergyDegradationResult


class EnergyDegradationEngine:
    """Engine for tracking energy intensity and degrading condition."""

    def analyze(
        self,
        asset_id: UUID,
        baseline_readings: List[EnergyReading],
        current_readings: List[EnergyReading]
    ) -> EnergyDegradationResult:
        """
        Compares baseline efficiency (e.g., energy per unit of output or hour)
        against current efficiency to detect degradation.
        """
        baseline_eff = self._calculate_efficiency(baseline_readings)
        current_eff = self._calculate_efficiency(current_readings)

        # Handle zero division / lack of data
        if baseline_eff <= 0 or current_eff <= 0:
            return EnergyDegradationResult(
                asset_id=asset_id,
                baseline_efficiency=0.0,
                current_efficiency=0.0,
                degradation_percent=0.0,
                confidence=0.0
            )

        # Degradation: if current requires MORE energy than baseline, efficiency is worse.
        # Percentage difference: (Current - Baseline) / Baseline * 100
        degradation_pct = ((current_eff - baseline_eff) / baseline_eff) * 100.0

        issue = None
        action = "Monitor efficiency trend."
        confidence = 0.5 + min((len(current_readings) / 100), 0.4) # Max 0.9 depending on sample size

        if degradation_pct >= 15.0:
            issue = f"+{round(degradation_pct, 1)}% power draw indicates severe mechanical drag/friction."
            action = "Schedule immediate vibration analysis and check bearings/seals."
            confidence = min(confidence + 0.1, 0.95)
        elif degradation_pct >= 5.0:
            issue = f"+{round(degradation_pct, 1)}% power draw indicates emerging mechanical inefficiency."
            action = "Inspect lubrication and alignment during next PM workflow."

        return EnergyDegradationResult(
            asset_id=asset_id,
            baseline_efficiency=round(baseline_eff, 4),
            current_efficiency=round(current_eff, 4),
            degradation_percent=round(degradation_pct, 2),
            implied_condition_issue=issue,
            recommended_action=action,
            confidence=round(confidence, 2)
        )

    def _calculate_efficiency(self, readings: List[EnergyReading]) -> float:
        """Calculate average energy intensity (Consumption / Output or Hours)."""
        if not readings:
            return 0.0
            
        total_consumption = sum(r.consumption_value for r in readings)
        
        # Prefer output produced for efficiency, fallback to operating hours
        total_output = sum(r.output_produced for r in readings if r.output_produced is not None)
        if total_output > 0:
            return total_consumption / total_output
            
        total_hours = sum(r.operating_hours for r in readings if r.operating_hours is not None)
        if total_hours > 0:
            return total_consumption / total_hours
            
        return 0.0 # Cannot calculate meaningful efficiency without a denominator
