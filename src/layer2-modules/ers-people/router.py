"""
ERS People v2.0 — FastAPI Router
════════════════════════════════
Endpoints for Knowledge Management, Connected Worker, and Competency tracking.
"""
from typing import List, Dict, Optional, Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ers_people.schemas import (
    RawKnowledgeCapture, TaggedArticle, KnowledgeRiskAssessment,
    DigitalWorkInstruction, InstructionStep, InstructionStatus,
    DigitalInspectionForm, InspectionResult, InspectionFieldResult,
    TechnicianCompetencyProfile, RoleCompetencyRequirement,
    CompetencyGap, StakeholderImpactReport
)
from ers_people.engines.knowledge import KnowledgeManagementEngine
from ers_people.engines.connected_worker import ConnectedWorkerEngine
from ers_people.engines.competency import CompetencyEngine

router = APIRouter(prefix="/people", tags=["ERS People"])

# ── Lazy singletons ────────────────────────────────────────
_knowledge: Optional[KnowledgeManagementEngine] = None
_worker: Optional[ConnectedWorkerEngine] = None
_competency: Optional[CompetencyEngine] = None

def _get_knowledge() -> KnowledgeManagementEngine:
    global _knowledge
    if not _knowledge: _knowledge = KnowledgeManagementEngine()
    return _knowledge

def _get_worker() -> ConnectedWorkerEngine:
    global _worker
    if not _worker: _worker = ConnectedWorkerEngine()
    return _worker

def _get_competency() -> CompetencyEngine:
    global _competency
    if not _competency: _competency = CompetencyEngine()
    return _competency

# ── Requests / Responses ───────────────────────────────────

class ExpertRiskRequest(BaseModel):
    asset_id: UUID
    criticality: str
    work_order_history: List[Dict[str, Any]]

class PublishInstructionRequest(BaseModel):
    title: str
    steps: List[InstructionStep]
    author_id: UUID
    approver_id: UUID

class SubmitInspectionRequest(BaseModel):
    form_id: UUID
    technician_id: UUID
    asset_id: UUID
    field_inputs: Dict[str, Any]

class CompetencyAnalysisRequest(BaseModel):
    profiles: List[TechnicianCompetencyProfile]
    roles: Dict[str, RoleCompetencyRequirement]
    tech_to_role_map: Dict[UUID, str]


# ══════════════════════════════════════════════════════════════
#  KNOWLEDGE MANAGEMENT
# ══════════════════════════════════════════════════════════════

@router.post("/knowledge/capture", response_model=TaggedArticle)
async def process_knowledge_capture(capture: RawKnowledgeCapture):
    """Processes field notes/voice/video into structured summaries (Claude Opus 4.6)."""
    # In production, we inject ai_client here
    return _get_knowledge().process_capture(capture)

@router.post("/knowledge/expert-risk", response_model=KnowledgeRiskAssessment)
async def assess_expert_risk(req: ExpertRiskRequest):
    """Evaluates single-point-of-failure risk if an asset relies on <2 technicians."""
    return _get_knowledge().assess_expert_risk(
        asset_id=req.asset_id,
        criticality=req.criticality,
        work_order_history=req.work_order_history
    )

@router.get("/knowledge/search", response_model=List[TaggedArticle])
async def semantic_search(query: str):
    """RAG semantic search across the knowledge base."""
    return _get_knowledge().semantic_search(query)


# ══════════════════════════════════════════════════════════════
#  CONNECTED WORKER
# ══════════════════════════════════════════════════════════════

@router.post("/worker/instructions/publish", response_model=DigitalWorkInstruction)
async def publish_instruction(req: PublishInstructionRequest):
    """Publishes a new digital work instruction."""
    return _get_worker().publish_instruction(
        title=req.title,
        steps=req.steps,
        author_id=req.author_id,
        approver_id=req.approver_id
    )

@router.post("/worker/inspections/submit", response_model=InspectionResult)
async def submit_inspection(req: SubmitInspectionRequest):
    """Submits inspection findings and triggers escalations if out-of-spec."""
    try:
        return _get_worker().process_inspection(
            form_id=req.form_id,
            technician_id=req.technician_id,
            asset_id=req.asset_id,
            field_inputs=req.field_inputs
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# ══════════════════════════════════════════════════════════════
#  COMPETENCY (ISO 55012)
# ══════════════════════════════════════════════════════════════

@router.post("/competency/gap-analysis", response_model=List[CompetencyGap])
async def perform_gap_analysis(req: CompetencyAnalysisRequest):
    """Analyzes technician profiles against role requirements to find gaps."""
    return _get_competency().perform_gap_analysis(
        profiles=req.profiles,
        roles=req.roles,
        tech_to_role_map=req.tech_to_role_map
    )

@router.post("/competency/stakeholder-report", response_model=StakeholderImpactReport)
async def generate_stakeholder_report(req: CompetencyAnalysisRequest):
    """Generates ISO 55012:2024 compliance report for boards/stakeholders."""
    engine = _get_competency()
    gaps = engine.perform_gap_analysis(req.profiles, req.roles, req.tech_to_role_map)
    return engine.generate_stakeholder_report(req.profiles, gaps)
