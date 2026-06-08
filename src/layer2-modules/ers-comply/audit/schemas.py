"""
Audit Engine — Schemas
══════════════════════
I/O models for audit scope, data packages, AI findings,
cross-audit pattern analysis, and report generation.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────

class AuditScopeType(str, Enum):
    UNIT = "unit"
    EQUIPMENT_TYPE = "equipment_type"
    CUSTOM_LIST = "custom_list"

class FindingSeverity(str, Enum):
    OBSERVATION = "observation"
    RECOMMENDATION = "recommendation"
    NON_CONFORMANCE = "non_conformance"
    CRITICAL = "critical"

class PatternSeverity(str, Enum):
    SYSTEMIC = "systemic"       # >30% recurrence
    RECURRING = "recurring"     # 10-30% recurrence
    ISOLATED = "isolated"       # <10%


# ── Audit Scope ───────────────────────────────────────────

class AuditScopeInput(BaseModel):
    """Define what equipment is in scope for an audit."""
    scope_type: AuditScopeType
    # For UNIT scope: filter by unit/area
    unit_name: Optional[str] = None
    # For EQUIPMENT_TYPE scope: filter by class
    equipment_type: Optional[str] = None  # e.g. "Pressure Vessel"
    # For CUSTOM_LIST scope: explicit equipment IDs
    equipment_ids: Optional[List[UUID]] = None
    # Audit metadata
    audit_type: str = "routine"
    auditor_name: Optional[str] = None
    scope_description: Optional[str] = None

    class Config:
        from_attributes = True


# ── Equipment Data Package ────────────────────────────────

class EquipmentDataPackage(BaseModel):
    """Compiled data for a single equipment item."""
    equipment_id: UUID
    equipment_name: str
    equipment_class: str
    governing_code: Optional[str] = None
    # Inspection status
    last_internal_inspection: Optional[datetime] = None
    last_external_inspection: Optional[datetime] = None
    next_inspection_due: Optional[datetime] = None
    inspection_overdue: bool = False
    # Thickness data
    cml_count: int = 0
    latest_readings: List[Dict[str, Any]] = []
    # Corrosion
    corrosion_rates: List[Dict[str, Any]] = []
    max_corrosion_rate: float = 0.0
    acceleration_detected: bool = False
    # Damage mechanisms
    active_damage_mechanisms: List[Dict[str, Any]] = []
    # FFS
    ffs_assessments: List[Dict[str, Any]] = []
    has_failed_ffs: bool = False
    # IOW
    iow_exceedances: List[Dict[str, Any]] = []
    critical_iow_breaches: int = 0
    # Material & design
    material_spec: Optional[str] = None
    design_pressure: Optional[float] = None
    design_temperature: Optional[float] = None
    nominal_thickness: Optional[float] = None
    retirement_thickness: Optional[float] = None

    class Config:
        from_attributes = True


class AuditDataPackage(BaseModel):
    """Full data package for an audit scope."""
    audit_id: UUID
    scope: AuditScopeInput
    equipment_packages: List[EquipmentDataPackage] = []
    compiled_at: datetime = Field(default_factory=datetime.utcnow)
    total_equipment: int = 0
    equipment_overdue: int = 0
    critical_findings_preview: int = 0

    class Config:
        from_attributes = True


# ── AI Finding ────────────────────────────────────────────

class AIFinding(BaseModel):
    """Single AI-generated finding (DRAFT — Tier 2)."""
    finding_id: Optional[UUID] = None
    equipment_id: UUID
    equipment_name: str
    severity: FindingSeverity
    description: str
    standard_reference: str          # e.g. "API 510 §6.4.2"
    evidence: str                    # specific data that triggered it
    recommended_action: str
    ai_confidence: float = 0.0      # 0-1
    auditor_accepted: Optional[bool] = None  # None = not yet reviewed
    auditor_notes: Optional[str] = None
    governance_tier: int = 2

    class Config:
        from_attributes = True


class AIFindingsOutput(BaseModel):
    """Output from AI finding generation."""
    audit_id: UUID
    findings: List[AIFinding] = []
    total_findings: int = 0
    by_severity: Dict[str, int] = {}
    governance_tier: int = 2
    safety_disclaimer: str = (
        "All AI-generated findings are DRAFT (Tier 2). "
        "Each finding MUST be reviewed and accepted or rejected "
        "by a qualified auditor before inclusion in the audit report."
    )

    class Config:
        from_attributes = True


# ── Cross-Audit Pattern Detection ─────────────────────────

class AuditPattern(BaseModel):
    """A detected pattern across multiple audits."""
    pattern_description: str
    finding_severity: FindingSeverity
    recurrence_rate: float           # 0-1 (>0.3 = systemic)
    pattern_severity: PatternSeverity
    affected_equipment_count: int
    affected_equipment_ids: List[UUID] = []
    first_seen_audit_id: Optional[UUID] = None
    occurrences: int = 0
    total_audits_checked: int = 0
    recommended_action: str = ""

    class Config:
        from_attributes = True


class PatternAnalysisOutput(BaseModel):
    """Output from cross-audit pattern detection."""
    audits_analyzed: int
    patterns: List[AuditPattern] = []
    systemic_count: int = 0
    recurring_count: int = 0
    recommendations: List[str] = []

    class Config:
        from_attributes = True


# ── Audit Report ──────────────────────────────────────────

class AuditReportSection(BaseModel):
    """A section of the audit report."""
    title: str
    content: str
    data: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class AuditReport(BaseModel):
    """Complete audit report."""
    audit_id: UUID
    title: str
    audit_type: str
    scope_description: str
    auditor_name: Optional[str] = None
    audit_date: datetime = Field(default_factory=datetime.utcnow)
    # Summary stats
    total_equipment_audited: int = 0
    total_findings: int = 0
    findings_by_severity: Dict[str, int] = {}
    # Sections
    executive_summary: str = ""
    sections: List[AuditReportSection] = []
    # Findings
    findings: List[AIFinding] = []
    # Corrective action plan
    corrective_actions: List[Dict[str, Any]] = []
    # Trending
    trend_vs_previous: Optional[Dict[str, Any]] = None
    # Pattern analysis
    systemic_patterns: List[AuditPattern] = []
    # Score
    regulatory_preparedness_score: Optional[float] = None

    class Config:
        from_attributes = True
