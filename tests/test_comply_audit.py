"""
Tests — Audit Engine
═══════════════════════
Tests for data package compilation, deterministic finding generation,
cross-audit pattern detection, and report generation.
"""
import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from ers_comply.audit.engine import AuditEngine
from ers_comply.audit.schemas import (
    AuditScopeInput, AuditScopeType, FindingSeverity,
    PatternSeverity,
)


class TestAuditDataPackage:
    """Tests for audit data package compilation."""

    def setup_method(self):
        self.engine = AuditEngine()

    def _make_equipment(self, **overrides):
        defaults = {
            "id": uuid4(),
            "name": "Vessel V-201",
            "asset_class": "Pressure Vessel",
            "governing_code": "api_510",
            "next_inspection_due": datetime(2025, 1, 1),  # past due
            "last_internal_inspection": datetime(2020, 1, 1),
            "cml_count": 4,
            "thickness_readings": [
                {"cml_id": str(uuid4()), "measured_thickness": 0.4}
            ],
            "corrosion_rates": [
                {"max_observed_rate": 0.012, "acceleration_flag": False}
            ],
            "damage_mechanisms": [],
            "ffs_assessments": [],
            "iow_exceedances": [],
            "material_spec": "SA-516 Gr 70",
            "design_pressure": 150.0,
            "design_temperature": 350.0,
            "nominal_thickness": 0.500,
        }
        defaults.update(overrides)
        return defaults

    def test_compile_basic_package(self):
        """Compile a package with a single equipment item."""
        scope = AuditScopeInput(
            scope_type=AuditScopeType.CUSTOM_LIST,
            equipment_ids=[uuid4()],
        )
        equip = [self._make_equipment()]
        result = self.engine.compile_data_package(scope, equip)

        assert result.total_equipment == 1
        assert len(result.equipment_packages) == 1
        assert result.audit_id is not None

    def test_overdue_detection(self):
        """Equipment past due date is flagged."""
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        equip = [self._make_equipment(
            next_inspection_due=datetime(2020, 1, 1),  # past due
        )]
        result = self.engine.compile_data_package(scope, equip)
        assert result.equipment_overdue == 1
        assert result.equipment_packages[0].inspection_overdue is True

    def test_not_overdue(self):
        """Future due date is not flagged."""
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        equip = [self._make_equipment(
            next_inspection_due=datetime(2030, 1, 1),
        )]
        result = self.engine.compile_data_package(scope, equip)
        assert result.equipment_overdue == 0

    def test_failed_ffs_detected(self):
        """Failed FFS triggers critical preview."""
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        equip = [self._make_equipment(
            ffs_assessments=[{"status": "failed"}],
            next_inspection_due=datetime(2030, 1, 1),
        )]
        result = self.engine.compile_data_package(scope, equip)
        assert result.critical_findings_preview >= 1
        assert result.equipment_packages[0].has_failed_ffs is True

    def test_critical_iow_breaches(self):
        """Critical IOW breaches counted."""
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        equip = [self._make_equipment(
            iow_exceedances=[
                {"iow_type": "critical"},
                {"iow_type": "standard"},
                {"iow_type": "critical"},
            ],
            next_inspection_due=datetime(2030, 1, 1),
        )]
        result = self.engine.compile_data_package(scope, equip)
        assert result.equipment_packages[0].critical_iow_breaches == 2

    def test_multi_equipment_package(self):
        """Multiple equipment items compiled."""
        scope = AuditScopeInput(
            scope_type=AuditScopeType.EQUIPMENT_TYPE,
            equipment_type="Pressure Vessel",
        )
        equip = [
            self._make_equipment(name=f"V-{200+i}", next_inspection_due=datetime(2030, 1, 1))
            for i in range(5)
        ]
        result = self.engine.compile_data_package(scope, equip)
        assert result.total_equipment == 5


class TestAIFindingGeneration:
    """Tests for deterministic finding generation."""

    def setup_method(self):
        self.engine = AuditEngine()

    def _setup_audit(self, equip_overrides=None):
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        defaults = {
            "id": uuid4(),
            "name": "Vessel V-201",
            "asset_class": "Pressure Vessel",
            "governing_code": "api_510",
            "next_inspection_due": datetime(2020, 1, 1),
            "cml_count": 2,
            "thickness_readings": [{"measured_thickness": 0.4}],
            "corrosion_rates": [{"max_observed_rate": 0.01, "acceleration_flag": False}],
            "damage_mechanisms": [],
            "ffs_assessments": [],
            "iow_exceedances": [],
        }
        if equip_overrides:
            defaults.update(equip_overrides)
        pkg = self.engine.compile_data_package(scope, [defaults])
        return pkg

    def test_overdue_generates_non_conformance(self):
        """Overdue inspection → non_conformance finding."""
        pkg = self._setup_audit()
        result = self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)
        assert result.total_findings > 0
        severities = [f.severity for f in result.findings]
        assert FindingSeverity.NON_CONFORMANCE in severities

    def test_accelerating_corrosion_finding(self):
        """Acceleration flag → recommendation finding."""
        pkg = self._setup_audit(equip_overrides={
            "corrosion_rates": [{"max_observed_rate": 0.03, "acceleration_flag": True}],
            "next_inspection_due": datetime(2030, 1, 1),
        })
        result = self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)
        descs = [f.description for f in result.findings]
        assert any("accelerat" in d.lower() for d in descs)

    def test_failed_ffs_critical_finding(self):
        """Failed FFS → critical finding."""
        pkg = self._setup_audit(equip_overrides={
            "ffs_assessments": [{"status": "failed"}],
            "next_inspection_due": datetime(2030, 1, 1),
        })
        result = self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)
        severities = [f.severity for f in result.findings]
        assert FindingSeverity.CRITICAL in severities

    def test_all_findings_are_tier_2(self):
        """All AI findings are governance Tier 2."""
        pkg = self._setup_audit()
        result = self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)
        assert result.governance_tier == 2
        for f in result.findings:
            assert f.governance_tier == 2

    def test_severity_count_matches(self):
        """by_severity counts match actual findings."""
        pkg = self._setup_audit()
        result = self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)
        total_from_counts = sum(result.by_severity.values())
        assert total_from_counts == result.total_findings

    def test_finding_has_required_fields(self):
        """Each finding has description, standard_reference, evidence, action."""
        pkg = self._setup_audit()
        result = self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)
        for f in result.findings:
            assert f.description
            assert f.standard_reference
            assert f.evidence
            assert f.recommended_action
            assert f.ai_confidence > 0


class TestCrossAuditPatterns:
    """Tests for cross-audit pattern detection."""

    def setup_method(self):
        self.engine = AuditEngine()

    def test_minimum_3_audits_required(self):
        """Pattern detection requires at least 3 audits."""
        result = self.engine.detect_cross_audit_patterns([uuid4(), uuid4()])
        assert result.audits_analyzed == 2
        assert len(result.patterns) == 0
        assert any("3 audits" in r for r in result.recommendations)

    def test_systemic_pattern_detected(self):
        """Same finding in >30% of audits → systemic."""
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        audit_ids = []

        # Create 4 audits with the same overdue finding
        for i in range(4):
            equip = {
                "id": uuid4(),
                "name": f"V-{200+i}",
                "asset_class": "Pressure Vessel",
                "governing_code": "api_510",
                "next_inspection_due": datetime(2020, 1, 1),
                "cml_count": 2,
                "thickness_readings": [],
                "corrosion_rates": [],
                "damage_mechanisms": [],
                "ffs_assessments": [],
                "iow_exceedances": [],
            }
            pkg = self.engine.compile_data_package(scope, [equip])
            self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)
            audit_ids.append(pkg.audit_id)

        result = self.engine.detect_cross_audit_patterns(audit_ids)
        assert result.audits_analyzed == 4
        # At least one systemic pattern (overdue appears in all 4)
        assert result.systemic_count >= 1

    def test_no_patterns_on_empty_findings(self):
        """No findings → no patterns."""
        audit_ids = [uuid4(), uuid4(), uuid4()]
        # These audit IDs have no stored findings
        result = self.engine.detect_cross_audit_patterns(audit_ids)
        assert len(result.patterns) == 0


class TestAuditReport:
    """Tests for audit report generation."""

    def setup_method(self):
        self.engine = AuditEngine()

    def test_basic_report_generation(self):
        """Generate report from audit data."""
        scope = AuditScopeInput(
            scope_type=AuditScopeType.UNIT,
            auditor_name="John Smith",
        )
        equip = [{
            "id": uuid4(), "name": "V-201",
            "asset_class": "Pressure Vessel",
            "governing_code": "api_510",
            "next_inspection_due": datetime(2020, 1, 1),
            "cml_count": 2,
            "thickness_readings": [{"measured_thickness": 0.4}],
            "corrosion_rates": [{"max_observed_rate": 0.01, "acceleration_flag": False}],
            "damage_mechanisms": [],
            "ffs_assessments": [],
            "iow_exceedances": [],
        }]
        pkg = self.engine.compile_data_package(scope, equip)
        self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)

        report = self.engine.generate_report(pkg.audit_id)
        assert report.audit_id == pkg.audit_id
        assert report.total_equipment_audited == 1
        assert report.total_findings > 0
        assert report.executive_summary
        assert len(report.sections) > 0
        assert report.auditor_name == "John Smith"

    def test_report_has_corrective_actions(self):
        """Report includes corrective action plan."""
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        equip = [{
            "id": uuid4(), "name": "V-201",
            "asset_class": "Pressure Vessel",
            "governing_code": "api_510",
            "next_inspection_due": datetime(2020, 1, 1),
            "cml_count": 0, "thickness_readings": [],
            "corrosion_rates": [], "damage_mechanisms": [],
            "ffs_assessments": [{"status": "failed"}],
            "iow_exceedances": [],
        }]
        pkg = self.engine.compile_data_package(scope, equip)
        self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)

        report = self.engine.generate_report(pkg.audit_id)
        assert len(report.corrective_actions) > 0

    def test_report_trending(self):
        """Report includes trend comparison with previous audit."""
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        equip = [{
            "id": uuid4(), "name": "V-201",
            "asset_class": "Pressure Vessel",
            "governing_code": "api_510",
            "next_inspection_due": datetime(2020, 1, 1),
            "cml_count": 2, "thickness_readings": [],
            "corrosion_rates": [], "damage_mechanisms": [],
            "ffs_assessments": [], "iow_exceedances": [],
        }]
        pkg = self.engine.compile_data_package(scope, equip)
        self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)

        report = self.engine.generate_report(
            pkg.audit_id, previous_audit_findings_count=10,
        )
        assert report.trend_vs_previous is not None
        assert report.trend_vs_previous["previous_findings"] == 10

    def test_executive_summary_mentions_criticals(self):
        """Executive summary highlights critical findings."""
        scope = AuditScopeInput(scope_type=AuditScopeType.UNIT)
        equip = [{
            "id": uuid4(), "name": "V-201",
            "asset_class": "Pressure Vessel",
            "governing_code": "api_510",
            "next_inspection_due": datetime(2030, 1, 1),
            "cml_count": 0, "thickness_readings": [],
            "corrosion_rates": [], "damage_mechanisms": [],
            "ffs_assessments": [{"status": "failed"}],
            "iow_exceedances": [],
        }]
        pkg = self.engine.compile_data_package(scope, equip)
        self.engine.generate_ai_findings(pkg.audit_id, data_package=pkg)

        report = self.engine.generate_report(pkg.audit_id)
        assert "CRITICAL" in report.executive_summary or "critical" in report.executive_summary
