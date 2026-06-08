"""
ERS People v2.0 — Schemas
═════════════════════════
Pydantic models and Enums for Knowledge Management, Connected Worker, 
and ISO 55012:2024 Competency features.
"""
from datetime import datetime, timedelta
from enum import Enum
from typing import List, Optional, Dict, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ══════════════════════════════════════════════════════════════
#  ENUMS
# ══════════════════════════════════════════════════════════════

class MediaFormat(str, Enum):
    AUDIO_WHISPER = "audio_whisper"
    VIDEO_ANNOTATION = "video_annotation"
    STRUCTURED_FORM = "structured_form"

class InstructionStatus(str, Enum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    ARCHIVED = "archived"

class ValidationRuleType(str, Enum):
    RANGE = "range"
    EXACT_MATCH = "exact_match"
    REGEX = "regex"
    PHOTO_REQUIRED = "photo_required"

class EscalationLevel(str, Enum):
    WARNING = "warning"
    SUPERVISOR_REVIEW = "supervisor_review"
    WORK_STOPPAGE = "work_stoppage"

class SkillLevel(int, Enum):
    NOVICE = 1        # Requires constant supervision
    INTERMEDIATE = 2  # Requires occasional supervision
    PROFICIENT = 3    # Works independently
    EXPERT = 4        # Can teach/troubleshoot


# ══════════════════════════════════════════════════════════════
#  KNOWLEDGE MANAGEMENT
# ══════════════════════════════════════════════════════════════

class RawKnowledgeCapture(BaseModel):
    """Raw input from field technicians (voice, video, text)."""
    technician_id: UUID
    asset_id: Optional[UUID] = None
    media_format: MediaFormat
    raw_content: str  # Base64 string for audio/video, or JSON string for form
    captured_at: datetime = Field(default_factory=datetime.utcnow)

class TaggedArticle(BaseModel):
    """AI-summarized, structured knowledge article."""
    article_id: UUID
    title: str
    summary: str
    asset_class: Optional[str] = None
    related_asset_ids: List[UUID] = []
    tags: List[str] = []
    source_technicians: List[UUID]
    confidence_score: float = Field(ge=0.0, le=1.0)
    created_at: datetime

class KnowledgeRiskAssessment(BaseModel):
    """Flags single-point-of-failure risks if <2 techs know a critical asset."""
    asset_id: UUID
    criticality: str
    expert_technician_ids: List[UUID]
    risk_level: str  # "HIGH", "MEDIUM", "LOW"
    recommendation: str


# ══════════════════════════════════════════════════════════════
#  CONNECTED WORKER (INSTRUCTIONS & INSPECTIONS)
# ══════════════════════════════════════════════════════════════

class InstructionStep(BaseModel):
    step_number: int
    title: str
    content: str
    media_urls: List[str] = []
    safety_alerts: List[str] = []
    requires_sign_off: bool = False

class DigitalWorkInstruction(BaseModel):
    instruction_id: UUID
    title: str
    version: int
    status: InstructionStatus
    steps: List[InstructionStep]
    author_id: UUID
    approved_by_id: Optional[UUID] = None

class InspectionField(BaseModel):
    field_id: str
    label: str
    field_type: str  # "number", "text", "pass_fail", "photo"
    validation_type: Optional[ValidationRuleType] = None
    validation_params: Dict[str, Any] = Field(default_factory=dict)
    escalation_on_fail: EscalationLevel

class DigitalInspectionForm(BaseModel):
    form_id: UUID
    title: str
    asset_class: str
    fields: List[InspectionField]

class InspectionFieldResult(BaseModel):
    field_id: str
    value: Any
    passed: bool
    requires_escalation: bool

class InspectionResult(BaseModel):
    inspection_id: UUID
    form_id: UUID
    technician_id: UUID
    asset_id: UUID
    results: List[InspectionFieldResult]
    overall_status: str  # "PASS", "FAIL", "ESCALATED"
    escalation_triggered: Optional[EscalationLevel] = None


# ══════════════════════════════════════════════════════════════
#  COMPETENCY (ISO 55012:2024)
# ══════════════════════════════════════════════════════════════

class Certification(BaseModel):
    cert_id: UUID
    name: str  # e.g., "CMRP", "CRL", "Electrician Journeyman"
    issued_date: datetime
    expiry_date: Optional[datetime] = None
    issuing_body: str

class TechnicianCompetencyProfile(BaseModel):
    technician_id: UUID
    certifications: List[Certification]
    skills: Dict[str, SkillLevel] = Field(
        default_factory=dict, description="skill_name -> SkillLevel"
    )

class CompetencyGap(BaseModel):
    technician_id: UUID
    skill_required: str
    current_level: SkillLevel
    required_level: SkillLevel
    is_critical_safety_gap: bool

class RoleCompetencyRequirement(BaseModel):
    role_id: str
    required_skills: Dict[str, SkillLevel]
    required_certifications: List[str]

class StakeholderImpactReport(BaseModel):
    """ISO 55012:2024 Clause 4.2 compliance report."""
    total_technicians: int
    fully_competent_percent: float
    critical_safety_gaps_count: int
    expiring_certifications_next_90_days: int
    gaps_by_skill: Dict[str, int]
    recommendation: str
