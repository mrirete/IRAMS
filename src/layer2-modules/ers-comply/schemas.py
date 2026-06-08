"""
ERS Comply & Integrity — Pydantic Schemas
══════════════════════════════════════════
PROMPT 4.5: Safety & Compliance / Asset Integrity Management

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
from datetime import datetime
from enum import Enum
from typing import Optional, List, Any, Dict, Tuple
from uuid import UUID
from pydantic import BaseModel, Field

# ══════════════════════════════════════════════════════════════
#  Enums
# ══════════════════════════════════════════════════════════════

class GoverningCode(str, Enum):
    API_510 = "api_510"
    API_570 = "api_570"
    API_653 = "api_653"
    ASME_B31_3 = "asme_b31_3"

class ComponentType(str, Enum):
    SHELL = "shell"
    HEAD = "head"
    NOZZLE = "nozzle"
    PIPING_ELBOW = "piping_elbow"
    PIPING_STRAIGHT = "piping_straight"
    PIPING_TEE = "piping_tee"
    WELD = "weld"
    TANK_SHELL_COURSE = "tank_shell_course"
    TANK_FLOOR = "tank_floor"
    TANK_ROOF = "tank_roof"

class UTMethod(str, Enum):
    UT_CONTACT = "ut_contact"
    UT_COMPRESSION = "ut_compression"
    UT_SHEAR = "ut_shear"
    PAUT = "paut"
    SCAN = "scan"

class CorrosionRateType(str, Enum):
    GENERAL = "general"
    LOCALIZED = "localized"
    PITTING = "pitting"

class DamageMechStatus(str, Enum):
    ACTIVE = "active"
    SUSCEPTIBLE = "susceptible"
    LATENT = "latent"
    NOT_APPLICABLE = "not_applicable"

class DamageMechSource(str, Enum):
    AI_SUGGESTED = "ai_suggested"
    ENGINEER_CONFIRMED = "engineer_confirmed"
    HISTORICAL = "historical"

class FFSLevel(str, Enum):
    LEVEL_1 = "level_1"
    LEVEL_2 = "level_2"
    LEVEL_3 = "level_3"

class FFSStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"
    REMEDIATION_REQUIRED = "remediation_required"
    MONITORING = "monitoring"

class FFSPart(str, Enum):
    """API 579 Parts for FFS assessment."""
    PART_4 = "part_4"   # General metal loss
    PART_5 = "part_5"   # Local metal loss
    PART_6 = "part_6"   # Pitting

class IOWType(str, Enum):
    CRITICAL = "critical"
    STANDARD = "standard"
    INFORMATIONAL = "informational"

class AuditType(str, Enum):
    ROUTINE = "routine"
    TURNAROUND = "turnaround"
    REGULATORY = "regulatory"
    INCIDENT = "incident"
    MANAGEMENT = "management"

class AuditStatus(str, Enum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CLOSED = "closed"

class FindingType(str, Enum):
    OBSERVATION = "observation"
    RECOMMENDATION = "recommendation"
    NON_CONFORMANCE = "non_conformance"
    CRITICAL = "critical"

class CAPriority(str, Enum):
    IMMEDIATE = "immediate"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class CAStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    VERIFIED = "verified"
    OVERDUE = "overdue"


# ══════════════════════════════════════════════════════════════
#  Base
# ══════════════════════════════════════════════════════════════

class ERSComplyBase(BaseModel):
    """Base schema with common config."""
    class Config:
        from_attributes = True

# ══════════════════════════════════════════════════════════════
#  CRUD Schemas (DB-backed entities)
# ══════════════════════════════════════════════════════════════

# --- Equipment Registry ---
class EquipmentRegistryBase(ERSComplyBase):
    asset_id: UUID
    governing_code: GoverningCode
    national_board_number: Optional[str] = None
    design_pressure: Optional[float] = None
    design_temperature: Optional[float] = None
    mdmt: Optional[float] = None
    mawp: Optional[float] = None
    material_spec: Optional[str] = None
    material_grade: Optional[str] = None
    corrosion_allowance: Optional[float] = None
    nominal_thickness: Optional[float] = None
    installation_date: Optional[datetime] = None
    last_internal_inspection: Optional[datetime] = None
    last_external: Optional[datetime] = None
    next_inspection_due: Optional[datetime] = None
    rbi_assessment_id: Optional[UUID] = None

class EquipmentRegistryCreate(EquipmentRegistryBase):
    pass

class EquipmentRegistryRead(EquipmentRegistryBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

# --- Condition Monitoring Location (CML) ---
class CMLBase(ERSComplyBase):
    equipment_id: UUID
    cml_number: str
    location_description: Optional[str] = None
    component_type: ComponentType
    nominal_thickness: Optional[float] = None
    retirement_thickness: Optional[float] = None
    min_required_thickness: Optional[float] = None
    corrosion_loop_id: Optional[UUID] = None

class CMLCreate(CMLBase):
    pass

class CMLRead(CMLBase):
    id: UUID

# --- Thickness Reading ---
class ThicknessReadingBase(ERSComplyBase):
    cml_id: UUID
    reading_date: datetime
    measured_thickness: float
    method: UTMethod
    inspector_id: Optional[UUID] = None
    inspector_cert_verified: bool = False
    notes: Optional[str] = None

class ThicknessReadingCreate(ThicknessReadingBase):
    pass

class ThicknessReadingRead(ThicknessReadingBase):
    id: UUID

# --- Corrosion Rate ---
class CorrosionRateBase(ERSComplyBase):
    cml_id: UUID
    short_term_rate: Optional[float] = None
    long_term_rate: Optional[float] = None
    max_observed_rate: Optional[float] = None
    remaining_life_years: Optional[float] = None
    rate_type: CorrosionRateType

class CorrosionRateCreate(CorrosionRateBase):
    pass

class CorrosionRateRead(CorrosionRateBase):
    id: UUID
    calculated_date: datetime

# --- Damage Mechanism ---
class DamageMechanismBase(ERSComplyBase):
    equipment_id: UUID
    api_571_code: Optional[str] = None
    name: str
    status: DamageMechStatus
    confidence: Optional[float] = None
    source: DamageMechSource
    reviewed_by: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None

class DamageMechanismCreate(DamageMechanismBase):
    pass

class DamageMechanismRead(DamageMechanismBase):
    id: UUID

# --- FFS Assessment ---
class FFSAssessmentBase(ERSComplyBase):
    equipment_id: UUID
    api_579_part: Optional[str] = None
    damage_type: Optional[str] = None
    assessment_level: FFSLevel
    status: FFSStatus
    rsf_calculated: Optional[float] = None
    mawp_derated: Optional[float] = None
    remaining_life: Optional[float] = None
    assessor_id: Optional[UUID] = None
    reviewer_id: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    governance_tier: int = 5

class FFSAssessmentCreate(FFSAssessmentBase):
    pass

class FFSAssessmentRead(FFSAssessmentBase):
    id: UUID

# --- Integrity Operating Window (IOW) ---
class IOWBase(ERSComplyBase):
    equipment_id: UUID
    parameter_name: str
    parameter_tag: Optional[str] = None
    iow_type: IOWType
    low_limit: Optional[float] = None
    high_limit: Optional[float] = None
    unit: Optional[str] = None
    linked_damage_mech: Optional[UUID] = None
    monitoring_active: bool = True

class IOWCreate(IOWBase):
    pass

class IOWRead(IOWBase):
    id: UUID

# --- IOW Exceedance ---
class IOWExceedanceBase(ERSComplyBase):
    iow_id: UUID
    start_time: datetime
    end_time: Optional[datetime] = None
    duration_min: Optional[float] = None
    max_deviation: Optional[float] = None
    acknowledged_by: Optional[UUID] = None
    action_taken: Optional[str] = None

class IOWExceedanceCreate(IOWExceedanceBase):
    pass

class IOWExceedanceRead(IOWExceedanceBase):
    id: UUID

# --- Integrity Audit ---
class IntegrityAuditBase(ERSComplyBase):
    audit_type: AuditType
    scope_description: Optional[str] = None
    auditor_id: Optional[UUID] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    status: AuditStatus
    regulatory_preparedness_score: Optional[float] = None

class IntegrityAuditCreate(IntegrityAuditBase):
    pass

class IntegrityAuditRead(IntegrityAuditBase):
    id: UUID

# --- Audit Finding ---
class AuditFindingBase(ERSComplyBase):
    audit_id: UUID
    equipment_id: Optional[UUID] = None
    finding_type: FindingType
    description: Optional[str] = None
    evidence_refs: Optional[Any] = None
    ai_generated: bool = False
    ai_confidence: Optional[float] = None
    auditor_confirmed: Optional[bool] = None
    corrective_action_id: Optional[UUID] = None

class AuditFindingCreate(AuditFindingBase):
    pass

class AuditFindingRead(AuditFindingBase):
    id: UUID

# --- Corrective Action ---
class CorrectiveActionBase(ERSComplyBase):
    finding_id: UUID
    description: Optional[str] = None
    owner_id: Optional[UUID] = None
    due_date: Optional[datetime] = None
    priority: CAPriority
    status: CAStatus
    work_order_id: Optional[UUID] = None
    verified_by: Optional[UUID] = None
    verified_at: Optional[datetime] = None

class CorrectiveActionCreate(CorrectiveActionBase):
    pass

class CorrectiveActionRead(CorrectiveActionBase):
    id: UUID


# ══════════════════════════════════════════════════════════════
#  ENGINE I/O SCHEMAS
# ══════════════════════════════════════════════════════════════

# ── A) Inspection Interval Calculator ─────────────────────────

class InspectionIntervalInput(ERSComplyBase):
    """Input for API 510/570/653 inspection interval calculation."""
    equipment_id: UUID
    governing_code: GoverningCode
    last_inspection_date: Optional[datetime] = None
    current_thickness: float
    nominal_thickness: float
    retirement_thickness: float
    corrosion_rate_short: float = 0.0  # in/yr
    corrosion_rate_long: float = 0.0   # in/yr
    rbi_extended: bool = False
    rbi_extended_interval_years: Optional[float] = None
    is_new_equipment: bool = False

class InspectionIntervalOutput(ERSComplyBase):
    """Output of inspection interval calculation."""
    equipment_id: UUID
    governing_code: GoverningCode
    corrosion_rate_used: float          # max(short, long) conservative
    remaining_life_years: float
    code_max_interval_years: float
    calculated_interval_years: float     # min(code_max, RL/2)
    next_inspection_due: Optional[datetime] = None
    warnings: List[str] = []
    calculation_method: str = "deterministic"
    safety_disclaimer: str = (
        "This is a reference calculation only. ALL inspection scheduling "
        "decisions require qualified inspector review and approval (Tier 5)."
    )


# ── B) Corrosion Rate Calculator ──────────────────────────────

class CorrosionRateInput(ERSComplyBase):
    """Input for corrosion rate calculation."""
    cml_id: UUID
    readings: List[ThicknessReadingCreate]  # at least 2
    nominal_thickness: float
    installation_date: Optional[datetime] = None
    ut_uncertainty: float = 0.005  # inches

class CorrosionRateOutput(ERSComplyBase):
    """Output of corrosion rate calculation."""
    cml_id: UUID
    short_term_rate: float     # in/yr from last 2 readings
    long_term_rate: float      # in/yr from nominal → latest
    max_observed_rate: float   # max of short/long (conservative)
    remaining_life_years: float
    acceleration_flag: bool    # short > 2× long
    acceleration_ratio: float  # short / long
    measurement_uncertainty: float
    rate_type: CorrosionRateType
    warnings: List[str] = []


# ── C) Fitness-for-Service (API 579) ─────────────────────────

class FFSLevel1Input(ERSComplyBase):
    """Input for API 579 Level 1 assessment (Part 4/5/6)."""
    equipment_id: UUID
    api_579_part: FFSPart = FFSPart.PART_4
    # Equipment data
    design_pressure: float        # psig
    design_temperature: float     # °F
    nominal_thickness: float      # inches
    # Material
    allowable_stress: float       # psi (S from ASME code)
    weld_joint_efficiency: float = 1.0  # E
    inside_diameter: float = 0.0  # inches (for cylindrical)
    # Measurements
    thickness_readings: List[float]  # all CML readings
    # Corrosion
    future_corrosion_allowance: float = 0.0  # FCA (inches)
    corrosion_rate: float = 0.0  # in/yr for remaining life calc

class FFSLevel1Output(ERSComplyBase):
    """Output of API 579 Level 1 assessment."""
    equipment_id: UUID
    api_579_part: FFSPart
    # Calculated values
    t_min: float                 # minimum required thickness (ASME)
    t_am: float                  # average measured thickness
    t_mm: float                  # minimum measured thickness
    t_nom: float                 # nominal thickness
    # Acceptance checks
    average_check_pass: bool     # t_am >= FCA + t_min
    minimum_check_pass: bool     # t_mm >= max(0.5*t_nom, FCA + t_min - 0.05)
    overall_pass: bool
    # Results
    rsf: float                   # Remaining Strength Factor
    rsf_allowable: float = 0.9  # per API 579
    remaining_life_years: float
    mawp_derated: Optional[float] = None
    # Recommendation
    status: FFSStatus
    recommended_action: str
    governance_tier: int = 5
    safety_disclaimer: str = (
        "This is a reference calculation only. FFS decisions require "
        "qualified API 579 practitioner review (Tier 5)."
    )

class FFSLevel2Input(ERSComplyBase):
    """Input for API 579 Level 2 assessment (CTP-based)."""
    equipment_id: UUID
    api_579_part: FFSPart = FFSPart.PART_4
    design_pressure: float
    design_temperature: float
    nominal_thickness: float
    allowable_stress: float
    weld_joint_efficiency: float = 1.0
    inside_diameter: float = 0.0
    # Detailed grid
    thickness_grid: List[List[float]]  # 2D grid: rows × columns
    grid_spacing_circ: float           # circumferential spacing (inches)
    grid_spacing_long: float           # longitudinal spacing (inches)
    future_corrosion_allowance: float = 0.0
    corrosion_rate: float = 0.0

class FFSLevel2Output(ERSComplyBase):
    """Output of API 579 Level 2 assessment."""
    equipment_id: UUID
    api_579_part: FFSPart
    t_min: float
    # CTP analysis
    critical_thickness_profiles: List[Dict[str, Any]]
    rsf_circ: float             # RSF from circumferential profiles
    rsf_long: float             # RSF from longitudinal profiles
    rsf_overall: float          # min of circ and long
    rsf_allowable: float = 0.9
    overall_pass: bool
    remaining_life_years: float
    status: FFSStatus
    recommended_action: str
    governance_tier: int = 5
    safety_disclaimer: str = (
        "Level 2 FFS assessment. Requires qualified API 579 practitioner "
        "review and approval before any operational decisions (Tier 5)."
    )


# ── D) Damage Mechanism Identifier ────────────────────────────

class DamageMechIdentifyInput(ERSComplyBase):
    """Input for AI-assisted API 571 damage mechanism identification."""
    equipment_id: UUID
    material_spec: str          # e.g. "SA-516 Gr 70"
    process_fluid: str          # e.g. "crude oil", "amine"
    operating_temperature: float  # °F
    operating_pressure: float     # psig
    h2_partial_pressure: Optional[float] = None   # psi
    h2s_content: Optional[float] = None           # ppm or mol%
    caustic_concentration: Optional[float] = None  # wt%
    chloride_content: Optional[float] = None       # ppm
    co2_content: Optional[float] = None            # mol%
    ph: Optional[float] = None
    additional_context: Optional[str] = None

class DamageMechSuggestion(ERSComplyBase):
    """Single damage mechanism suggestion."""
    api_571_code: str
    name: str
    api_571_section: str
    likelihood: str              # high / medium / low
    rationale: str
    recommended_inspection: str
    recommended_interval: str
    confidence: float            # 0-1

class DamageMechIdentifyOutput(ERSComplyBase):
    """Output of damage mechanism identification."""
    equipment_id: UUID
    mechanisms: List[DamageMechSuggestion] = []
    governance_tier: int = 2     # Advisory only — Tier 2
    requires_engineer_confirmation: bool = True
    safety_disclaimer: str = (
        "AI-generated suggestions (Tier 2). A qualified corrosion/materials "
        "engineer MUST review and confirm all damage mechanisms before "
        "they are used for inspection planning."
    )


# ── E) IOW Monitor ────────────────────────────────────────────

class IOWCheckInput(ERSComplyBase):
    """Input for IOW limit check."""
    iow_id: UUID
    current_value: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class IOWCheckOutput(ERSComplyBase):
    """Output of IOW limit check."""
    iow_id: UUID
    parameter_name: str
    iow_type: IOWType
    current_value: float
    low_limit: Optional[float] = None
    high_limit: Optional[float] = None
    in_range: bool
    deviation: float = 0.0      # how far out-of-range
    breach_type: Optional[str] = None  # "low" / "high" / None
    action_required: str = "none"
    cumulative_exceedance_min: float = 0.0


# ── F) Regulatory Preparedness ────────────────────────────────

class RegulatorySubScore(ERSComplyBase):
    """Individual component of regulatory preparedness."""
    category: str
    score: float        # 0-100
    weight: float       # decimal
    weighted_score: float
    details: str = ""

class RegulatoryPreparednessOutput(ERSComplyBase):
    """Weighted regulatory preparedness score."""
    overall_score: float  # 0-100
    grade: str            # A/B/C/D/F
    sub_scores: List[RegulatorySubScore] = []
    recommendations: List[str] = []
    assessed_at: datetime = Field(default_factory=datetime.utcnow)
