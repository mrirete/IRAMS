"""
FMEA Worksheet Engine
═════════════════════
Digital FMEA worksheets with RPN calculation,
AI-suggested failure modes, and action tracking.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from ers_analyze.schemas import (
    FMEAItemInput,
    FMEAItemRead,
    FMEAWorksheetCreate,
    FMEAWorksheetRead,
)


class FMEAWorksheetEngine:
    """
    FMEA (Failure Mode and Effects Analysis) worksheet management.

    Features:
    - RPN = Severity × Occurrence × Detection (1-10 each)
    - Risk categorization (high > 200, medium > 100, low)
    - Action tracking with status management
    - Summary statistics (max RPN, avg RPN, high-risk count)
    """

    # RPN thresholds
    HIGH_RISK_THRESHOLD = 200
    MEDIUM_RISK_THRESHOLD = 100

    def __init__(self):
        self._worksheets: Dict[UUID, FMEAWorksheetRead] = {}

    def create_worksheet(self, inp: FMEAWorksheetCreate) -> FMEAWorksheetRead:
        """Create a new FMEA worksheet."""
        ws_id = uuid4()
        ws = FMEAWorksheetRead(
            id=ws_id,
            asset_id=inp.asset_id,
            title=inp.title,
            fmea_type=inp.fmea_type,
            status="draft",
        )
        self._worksheets[ws_id] = ws
        return ws

    def add_item(
        self, worksheet_id: UUID, item: FMEAItemInput
    ) -> FMEAItemRead:
        """Add and item to a worksheet, computing RPN."""
        rpn = self.calculate_rpn(item.severity, item.occurrence, item.detection)

        fmea_item = FMEAItemRead(
            id=uuid4(),
            component=item.component,
            function=item.function,
            failure_mode=item.failure_mode,
            failure_effect=item.failure_effect,
            failure_cause=item.failure_cause,
            severity=item.severity,
            occurrence=item.occurrence,
            detection=item.detection,
            rpn=rpn,
            current_controls=item.current_controls,
            recommended_action=item.recommended_action,
            source="manual",
        )

        # Update worksheet if tracked
        if worksheet_id in self._worksheets:
            ws = self._worksheets[worksheet_id]
            ws.items.append(fmea_item)
            self._recalculate_summary(ws)

        return fmea_item

    def calculate_rpn(self, severity: int, occurrence: int, detection: int) -> int:
        """Calculate Risk Priority Number."""
        s = max(1, min(10, severity))
        o = max(1, min(10, occurrence))
        d = max(1, min(10, detection))
        return s * o * d

    def categorize_risk(self, rpn: int) -> str:
        """Categorize risk level from RPN."""
        if rpn >= self.HIGH_RISK_THRESHOLD:
            return "high"
        elif rpn >= self.MEDIUM_RISK_THRESHOLD:
            return "medium"
        return "low"

    def get_worksheet(self, worksheet_id: UUID) -> Optional[FMEAWorksheetRead]:
        """Get a worksheet by ID."""
        return self._worksheets.get(worksheet_id)

    def suggest_failure_modes_for_component(
        self, component: str, asset_class: str
    ) -> List[FMEAItemInput]:
        """
        Suggest common FMEA items for a component based on asset class.

        These are industry-standard suggestions (Tier 2 — requires approval).
        """
        # Common failure modes by component type
        suggestions_db: Dict[str, List[Dict]] = {
            "bearing": [
                {"failure_mode": "Bearing seizure", "failure_effect": "Shaft lockup, complete loss of function", "failure_cause": "Lubrication failure", "severity": 8, "occurrence": 4, "detection": 5},
                {"failure_mode": "Bearing spalling", "failure_effect": "Increased vibration, eventual seizure", "failure_cause": "Fatigue, contamination", "severity": 6, "occurrence": 5, "detection": 3},
                {"failure_mode": "Bearing cage failure", "failure_effect": "Catastrophic bearing failure", "failure_cause": "Material fatigue, overload", "severity": 9, "occurrence": 2, "detection": 4},
            ],
            "seal": [
                {"failure_mode": "Seal leakage", "failure_effect": "Product loss, environmental contamination", "failure_cause": "Wear, hardening, chemical attack", "severity": 6, "occurrence": 6, "detection": 3},
                {"failure_mode": "Seal blow-out", "failure_effect": "Major leakage, potential fire/safety hazard", "failure_cause": "Overpressure, material failure", "severity": 9, "occurrence": 2, "detection": 5},
            ],
            "impeller": [
                {"failure_mode": "Impeller erosion", "failure_effect": "Reduced flow/head, efficiency loss", "failure_cause": "Abrasive particles in process fluid", "severity": 5, "occurrence": 5, "detection": 4},
                {"failure_mode": "Impeller imbalance", "failure_effect": "Excessive vibration, bearing damage", "failure_cause": "Erosion, buildup, damage", "severity": 7, "occurrence": 3, "detection": 3},
            ],
            "motor": [
                {"failure_mode": "Winding insulation breakdown", "failure_effect": "Motor trip, loss of drive", "failure_cause": "Thermal aging, moisture ingress", "severity": 8, "occurrence": 3, "detection": 4},
                {"failure_mode": "Rotor bar cracking", "failure_effect": "Reduced torque, eventual trip", "failure_cause": "Thermal cycling, starting stress", "severity": 7, "occurrence": 2, "detection": 5},
            ],
            "valve": [
                {"failure_mode": "Valve seat erosion", "failure_effect": "Internal leakage, loss of isolation", "failure_cause": "Flow erosion, cavitation", "severity": 6, "occurrence": 5, "detection": 5},
                {"failure_mode": "Valve stem packing leak", "failure_effect": "External leakage, environmental issue", "failure_cause": "Wear, thermal cycling", "severity": 5, "occurrence": 6, "detection": 2},
            ],
        }

        component_lower = component.lower()
        suggestions = []

        # Find matching component type
        for key, modes in suggestions_db.items():
            if key in component_lower:
                for mode in modes:
                    suggestions.append(
                        FMEAItemInput(
                            component=component,
                            failure_mode=mode["failure_mode"],
                            failure_effect=mode.get("failure_effect"),
                            failure_cause=mode.get("failure_cause"),
                            severity=mode.get("severity", 5),
                            occurrence=mode.get("occurrence", 5),
                            detection=mode.get("detection", 5),
                        )
                    )

        # If no specific match, return generic
        if not suggestions:
            suggestions = [
                FMEAItemInput(
                    component=component,
                    failure_mode="General degradation / wear",
                    failure_effect="Reduced performance or function loss",
                    failure_cause="Normal wear and aging",
                    severity=5,
                    occurrence=5,
                    detection=5,
                ),
                FMEAItemInput(
                    component=component,
                    failure_mode="Structural failure / fracture",
                    failure_effect="Catastrophic loss of function",
                    failure_cause="Fatigue, material defect, overload",
                    severity=9,
                    occurrence=2,
                    detection=6,
                ),
            ]

        return suggestions

    def _recalculate_summary(self, ws: FMEAWorksheetRead) -> None:
        """Recalculate worksheet summary statistics."""
        if not ws.items:
            ws.max_rpn = 0
            ws.avg_rpn = 0.0
            ws.high_risk_count = 0
            return

        rpns = [item.rpn for item in ws.items]
        ws.max_rpn = max(rpns)
        ws.avg_rpn = sum(rpns) / len(rpns)
        ws.high_risk_count = sum(1 for r in rpns if r >= self.HIGH_RISK_THRESHOLD)
