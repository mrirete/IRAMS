"""
Asset Integrity Auditor Agent — Tool Bindings
══════════════════════════════════════════════
Wraps ERS Comply engines as callable tools for agent use.
"""
import sys
import os
from typing import Dict, Any, List, Optional
from uuid import UUID
from datetime import datetime

# Ensure eds-comply is importable
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../../layer2-modules')))

from ers_comply.inspection.engine import InspectionIntervalEngine
from ers_comply.corrosion.engine import CorrosionRateEngine
from ers_comply.ffs.engine import FFSEngine
from ers_comply.damage_mech.engine import DamageMechanismEngine
from ers_comply.iow.engine import IOWMonitorEngine
from ers_comply.regulatory.engine import RegulatoryPreparednessEngine
from ers_comply.audit.engine import AuditEngine
from ers_comply.schemas import (
    InspectionIntervalInput, CorrosionRateInput,
    FFSLevel1Input, FFSLevel2Input,
    DamageMechIdentifyInput,
    IOWCheckInput, IOWRead,
    GoverningCode, FFSPart, IOWType,
)
from ers_comply.audit.schemas import AuditScopeInput


class IntegrityAgentTools:
    """
    Tool bindings for the Asset Integrity Auditor Agent.
    Each method wraps an ERS Comply engine and returns
    serializable results for the agent.
    """

    def __init__(self):
        self._inspection = InspectionIntervalEngine()
        self._corrosion = CorrosionRateEngine()
        self._ffs = FFSEngine()
        self._damage_mech = DamageMechanismEngine()
        self._iow = IOWMonitorEngine()
        self._regulatory = RegulatoryPreparednessEngine()
        self._audit = AuditEngine()

    def calculate_inspection_interval(self, **kwargs) -> Dict[str, Any]:
        """Calculate inspection interval per API 510/570/653.
        Returns remaining life, next due date, and any warnings."""
        inp = InspectionIntervalInput(**kwargs)
        result = self._inspection.calculate_interval(inp)
        return result.model_dump(mode="json")

    def calculate_corrosion_rates(self, **kwargs) -> Dict[str, Any]:
        """Calculate short-term and long-term corrosion rates.
        Flags accelerating corrosion when short > 2× long-term."""
        inp = CorrosionRateInput(**kwargs)
        result = self._corrosion.calculate_rates(inp)
        return result.model_dump(mode="json")

    def run_ffs_level_1(self, **kwargs) -> Dict[str, Any]:
        """Run API 579 Level 1 FFS screening assessment.
        Returns pass/fail, RSF, remaining life, recommended action.
        GOVERNANCE: Tier 5 — requires qualified engineer sign-off."""
        inp = FFSLevel1Input(**kwargs)
        result = self._ffs.assess_level_1(inp)
        return result.model_dump(mode="json")

    def run_ffs_level_2(self, **kwargs) -> Dict[str, Any]:
        """Run API 579 Level 2 CTP-based assessment.
        GOVERNANCE: Tier 5 — requires qualified engineer sign-off."""
        inp = FFSLevel2Input(**kwargs)
        result = self._ffs.assess_level_2(inp)
        return result.model_dump(mode="json")

    def identify_damage_mechanisms(self, **kwargs) -> Dict[str, Any]:
        """Identify applicable API 571 damage mechanisms.
        GOVERNANCE: Tier 2 — advisory, engineer must confirm."""
        inp = DamageMechIdentifyInput(**kwargs)
        result = self._damage_mech.identify(inp)
        return result.model_dump(mode="json")

    def check_iow_status(self, **kwargs) -> Dict[str, Any]:
        """Check current process value against IOW limits.
        Returns in_range status, deviation, and required action."""
        iow_data = kwargs.pop("iow", {})
        check_inp = IOWCheckInput(**kwargs)
        iow = IOWRead(**iow_data)
        result = self._iow.check_value(check_inp, iow)
        return result.model_dump(mode="json")

    def calculate_regulatory_preparedness(self, metrics: Dict[str, float]) -> Dict[str, Any]:
        """Calculate regulatory preparedness score.
        Returns overall score, grade (A-F), and recommendations."""
        result = self._regulatory.calculate_score(metrics)
        return result.model_dump(mode="json")

    def compile_audit_package(
        self, scope: Dict, equipment_data: List[Dict]
    ) -> Dict[str, Any]:
        """Compile audit data package for equipment in scope."""
        scope_input = AuditScopeInput(**scope)
        result = self._audit.compile_data_package(scope_input, equipment_data)
        return result.model_dump(mode="json")

    def generate_audit_findings(
        self, audit_id: str, **kwargs
    ) -> Dict[str, Any]:
        """Generate AI audit findings (DRAFT — Tier 2).
        All findings must be reviewed by qualified auditor."""
        result = self._audit.generate_ai_findings(UUID(audit_id), **kwargs)
        return result.model_dump(mode="json")

    def detect_cross_audit_patterns(
        self, audit_ids: List[str]
    ) -> Dict[str, Any]:
        """Detect systemic patterns across 3+ audits.
        >30% recurrence = systemic issue."""
        uuids = [UUID(aid) for aid in audit_ids]
        result = self._audit.detect_cross_audit_patterns(uuids)
        return result.model_dump(mode="json")

    def generate_audit_report(
        self, audit_id: str, **kwargs
    ) -> Dict[str, Any]:
        """Generate complete audit report with findings,
        corrective actions, and trending."""
        result = self._audit.generate_report(UUID(audit_id), **kwargs)
        return result.model_dump(mode="json")

    def get_all_tools(self) -> Dict[str, Any]:
        """Return all tool handlers as a dict for agent registration."""
        return {
            "calculate_inspection_interval": self.calculate_inspection_interval,
            "calculate_corrosion_rates": self.calculate_corrosion_rates,
            "run_ffs_level_1": self.run_ffs_level_1,
            "run_ffs_level_2": self.run_ffs_level_2,
            "identify_damage_mechanisms": self.identify_damage_mechanisms,
            "check_iow_status": self.check_iow_status,
            "calculate_regulatory_preparedness": self.calculate_regulatory_preparedness,
            "compile_audit_package": self.compile_audit_package,
            "generate_audit_findings": self.generate_audit_findings,
            "detect_cross_audit_patterns": self.detect_cross_audit_patterns,
            "generate_audit_report": self.generate_audit_report,
        }
