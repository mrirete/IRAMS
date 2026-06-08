"""
Work Order Enrichment Engine
════════════════════════════
Auto-appends context to Work Orders including historical similarities,
relevant safety advisories, and known failure patterns.
"""
from typing import List, Dict, Any
from uuid import UUID

from ers_work.schemas import WOContext, SafetyAdvisory, FailurePattern, WorkOrder

class EnrichmentEngine:
    """Engine for building highly contextualized views of Work Orders."""

    def __init__(self):
        # Mocks of enterprise databases for context enrichment
        self._safety_db = [
            SafetyAdvisory(category="Electrical", description="Verify zero energy state before breaching panel.", requires_loto=True, ppe_required=["Arc Flash Suit", "Insulated Gloves"]),
            SafetyAdvisory(category="Confined Space", description="Atmospheric testing required before entry.", requires_loto=False, ppe_required=["H2S Monitor", "Harness"]),
            SafetyAdvisory(category="Working at Heights", description="100% tie-off required above 4 feet.", requires_loto=False, ppe_required=["Fall Arrest Harness", "Twin Lanyard"])
        ]
        
        self._failure_db = [
            FailurePattern(pattern_name="Bearing Spalling", probability=0.85, suggested_remedy="Replace thrust bearing, check oil viscosity."),
            FailurePattern(pattern_name="Impeller Cavitation", probability=0.40, suggested_remedy="Inspect NPSH, check inlet screen for blockages."),
            FailurePattern(pattern_name="Seal Leakage", probability=0.60, suggested_remedy="Replace mechanical seal, align shaft.")
        ]

    def enrich_work_order(self, wo: WorkOrder, asset_class: str = "PUMP") -> WOContext:
        """
        Gathers contextual data for a given Work Order. 
        In production, this would use semantic graph searches against the Data Fabric.
        """
        # Determine Safety Advisories based on description semantics (Stub Logic)
        advisories: List[SafetyAdvisory] = []
        desc_lower = wo.description.lower()
        if "motor" in desc_lower or "panel" in desc_lower or "wire" in desc_lower:
            advisories.append(self._safety_db[0])
        if "tank" in desc_lower or "vessel" in desc_lower or "inside" in desc_lower:
            advisories.append(self._safety_db[1])
        if "roof" in desc_lower or "scaffold" in desc_lower or "climb" in desc_lower:
            advisories.append(self._safety_db[2])

        # Determine Failure Patterns
        # In prod: Compare WO text to FMEA dictionaries
        patterns = []
        if asset_class.upper() == "PUMP":
            patterns = [self._failure_db[0], self._failure_db[2]]
            if "vibration" in desc_lower or "noise" in desc_lower:
                patterns.append(self._failure_db[1])

        # Mock Historical Search
        history_mock = [
            {"historical_wo": "WO-2025-0105", "similarity_score": 0.92, "resolution": "Replaced seals."},
            {"historical_wo": "WO-2024-1122", "similarity_score": 0.88, "resolution": "Aligned coupling."}
        ]

        # Determine Parts Status
        # In prod: Query ERP/Inventory connector
        parts_status = "ALL_IN_STOCK" if len(wo.parts_required) < 3 else "PARTIAL"

        return WOContext(
            wo_id=wo.wo_id,
            historical_similar_wos=history_mock,
            recommended_procedures=[f"SOP-{asset_class}-01 Maintenance", f"JSA-{asset_class} Standard"],
            failure_patterns=patterns,
            safety_advisories=advisories,
            parts_availability_status=parts_status
        )
