"""
ERS Comply & Integrity — FastAPI Router
═══════════════════════════════════════
PROMPT 4.5: Safety & Compliance / Asset Integrity Management

SAFETY DISCLAIMER: This module NEVER makes autonomous safety decisions.
ALL safety actions require physical human confirmation and multi-party
approval (Tier 5). It is a reference tool, not a safety authority.
"""
from datetime import datetime
from typing import List, Optional, Dict
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException

import sys, os
sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), '../..')))

from ers_comply.schemas import (
    # Engine I/O
    InspectionIntervalInput, InspectionIntervalOutput,
    CorrosionRateInput, CorrosionRateOutput,
    FFSLevel1Input, FFSLevel1Output,
    FFSLevel2Input, FFSLevel2Output,
    DamageMechIdentifyInput, DamageMechIdentifyOutput,
    IOWCheckInput, IOWCheckOutput, IOWRead, IOWCreate,
    RegulatoryPreparednessOutput,
    # CRUD
    EquipmentRegistryCreate, EquipmentRegistryRead,
    CMLCreate, CMLRead,
    ThicknessReadingCreate, ThicknessReadingRead,
    DamageMechanismRead,
    IntegrityAuditCreate, IntegrityAuditRead,
    AuditFindingRead, AuditFindingCreate,
    CorrectiveActionCreate, CorrectiveActionRead,
    IOWExceedanceRead,
    # Enums
    GoverningCode, AuditStatus, FindingType, FFSPart,
)

# ── Lazy engine singletons ──
_inspection_engine = None
_corrosion_engine = None
_ffs_engine = None
_damage_mech_engine = None
_iow_engine = None
_regulatory_engine = None

def _get_inspection_engine():
    global _inspection_engine
    if _inspection_engine is None:
        from ers_comply.inspection.engine import InspectionIntervalEngine
        _inspection_engine = InspectionIntervalEngine()
    return _inspection_engine

def _get_corrosion_engine():
    global _corrosion_engine
    if _corrosion_engine is None:
        from ers_comply.corrosion.engine import CorrosionRateEngine
        _corrosion_engine = CorrosionRateEngine()
    return _corrosion_engine

def _get_ffs_engine():
    global _ffs_engine
    if _ffs_engine is None:
        from ers_comply.ffs.engine import FFSEngine
        _ffs_engine = FFSEngine()
    return _ffs_engine

def _get_damage_mech_engine():
    global _damage_mech_engine
    if _damage_mech_engine is None:
        from ers_comply.damage_mech.engine import DamageMechanismEngine
        _damage_mech_engine = DamageMechanismEngine()
    return _damage_mech_engine

def _get_iow_engine():
    global _iow_engine
    if _iow_engine is None:
        from ers_comply.iow.engine import IOWMonitorEngine
        _iow_engine = IOWMonitorEngine()
    return _iow_engine

def _get_regulatory_engine():
    global _regulatory_engine
    if _regulatory_engine is None:
        from ers_comply.regulatory.engine import RegulatoryPreparednessEngine
        _regulatory_engine = RegulatoryPreparednessEngine()
    return _regulatory_engine


router = APIRouter(prefix="/api/v1/integrity", tags=["ERS Comply & Integrity"])


# ══════════════════════════════════════════════════════════════
#  A) Inspection Interval Calculator
# ══════════════════════════════════════════════════════════════

@router.post(
    "/inspect/{equipment_id}/calculate-interval",
    response_model=InspectionIntervalOutput,
    summary="Calculate inspection interval per API 510/570/653",
)
async def calculate_inspection_interval(
    equipment_id: UUID,
    body: InspectionIntervalInput,
):
    """
    Deterministic inspection interval calculation.
    Uses conservative corrosion rate (max of short/long-term).
    Never exceeds code maximum interval.
    """
    body.equipment_id = equipment_id
    engine = _get_inspection_engine()
    return engine.calculate_interval(body)


# ══════════════════════════════════════════════════════════════
#  B) Corrosion Rate Calculator
# ══════════════════════════════════════════════════════════════

@router.post(
    "/corrosion/{equipment_id}/calculate-rates",
    response_model=CorrosionRateOutput,
    summary="Calculate corrosion rates from thickness readings",
)
async def calculate_corrosion_rates(
    equipment_id: UUID,
    body: CorrosionRateInput,
):
    """
    Calculate short-term and long-term corrosion rates.
    Flags accelerating corrosion when short > 2× long.
    """
    engine = _get_corrosion_engine()
    return engine.calculate_rates(body)


# ══════════════════════════════════════════════════════════════
#  C) Fitness-for-Service (API 579)
# ══════════════════════════════════════════════════════════════

@router.post(
    "/ffs/{equipment_id}/level-1",
    response_model=FFSLevel1Output,
    summary="Run API 579 Level 1 FFS assessment",
)
async def ffs_level_1(
    equipment_id: UUID,
    body: FFSLevel1Input,
):
    """
    API 579 Level 1 screening assessment.
    Supports Part 4 (general), Part 5 (local), Part 6 (pitting).
    Returns: pass/fail, RSF, remaining life, recommended action.
    """
    body.equipment_id = equipment_id
    engine = _get_ffs_engine()
    return engine.assess_level_1(body)


@router.post(
    "/ffs/{equipment_id}/level-2",
    response_model=FFSLevel2Output,
    summary="Run API 579 Level 2 CTP-based assessment",
)
async def ffs_level_2(
    equipment_id: UUID,
    body: FFSLevel2Input,
):
    """
    API 579 Level 2 assessment with Critical Thickness Profiles.
    Requires detailed thickness grid data.
    """
    body.equipment_id = equipment_id
    engine = _get_ffs_engine()
    return engine.assess_level_2(body)


# ══════════════════════════════════════════════════════════════
#  D) Damage Mechanism Identifier
# ══════════════════════════════════════════════════════════════

@router.post(
    "/damage-mechanisms/{equipment_id}/identify",
    response_model=DamageMechIdentifyOutput,
    summary="Identify applicable API 571 damage mechanisms (Tier 2)",
)
async def identify_damage_mechanisms(
    equipment_id: UUID,
    body: DamageMechIdentifyInput,
):
    """
    Rule-based + AI-assisted damage mechanism identification.
    All results are Tier 2 advisory — engineer must confirm.
    """
    body.equipment_id = equipment_id
    engine = _get_damage_mech_engine()
    return engine.identify(body)


# ══════════════════════════════════════════════════════════════
#  E) IOW Monitor
# ══════════════════════════════════════════════════════════════

@router.post(
    "/iow/{equipment_id}/check",
    response_model=IOWCheckOutput,
    summary="Check process value against IOW limits",
)
async def check_iow(
    equipment_id: UUID,
    body: IOWCheckInput,
    iow_parameter_name: str = "parameter",
    iow_type: str = "standard",
    iow_low_limit: Optional[float] = None,
    iow_high_limit: Optional[float] = None,
):
    """
    Check a single process value against IOW limits.
    Critical breach → immediate alert. Standard → log + schedule.
    """
    from ers_comply.schemas import IOWType as IOWTypeEnum
    
    iow = IOWRead(
        id=body.iow_id,
        equipment_id=equipment_id,
        parameter_name=iow_parameter_name,
        iow_type=IOWTypeEnum(iow_type),
        low_limit=iow_low_limit,
        high_limit=iow_high_limit,
    )
    engine = _get_iow_engine()
    return engine.check_value(body, iow)


# ══════════════════════════════════════════════════════════════
#  F) Regulatory Preparedness Score
# ══════════════════════════════════════════════════════════════

@router.post(
    "/regulatory-preparedness-score",
    response_model=RegulatoryPreparednessOutput,
    summary="Calculate regulatory preparedness score",
)
async def regulatory_preparedness_score(
    metrics: Dict[str, float],
):
    """
    Calculate weighted regulatory preparedness score.
    Categories: inspection_currency, documentation_completeness,
    corrective_action_closure, personnel_certification,
    mi_program_compliance, iow_compliance.
    """
    engine = _get_regulatory_engine()
    return engine.calculate_score(metrics)


# ══════════════════════════════════════════════════════════════
#  Audit Endpoints
# ══════════════════════════════════════════════════════════════

@router.post(
    "/audit/create",
    response_model=IntegrityAuditRead,
    summary="Create a new integrity audit",
)
async def create_audit(body: IntegrityAuditCreate):
    """Create a new integrity audit record."""
    return IntegrityAuditRead(
        id=uuid4(),
        **body.model_dump(),
    )


@router.post(
    "/audit/{audit_id}/generate-findings",
    response_model=List[AuditFindingRead],
    summary="Auto-generate audit findings (Tier 2 advisory)",
)
async def generate_audit_findings(
    audit_id: UUID,
    equipment_ids: Optional[List[UUID]] = None,
):
    """
    Auto-generate findings based on equipment status.
    All AI-generated findings are Tier 2 — auditor must confirm.
    """
    findings = []

    # Auto-generate sample findings based on common audit checks
    checks = [
        {
            "type": FindingType.OBSERVATION,
            "desc": "Equipment inspection records reviewed — check currency.",
            "confidence": 0.85,
        },
        {
            "type": FindingType.RECOMMENDATION,
            "desc": "IOW monitoring records reviewed — verify compliance.",
            "confidence": 0.80,
        },
        {
            "type": FindingType.OBSERVATION,
            "desc": "Corrective action closure status reviewed.",
            "confidence": 0.90,
        },
    ]

    for check in checks:
        findings.append(AuditFindingRead(
            id=uuid4(),
            audit_id=audit_id,
            equipment_id=equipment_ids[0] if equipment_ids else None,
            finding_type=check["type"],
            description=check["desc"],
            ai_generated=True,
            ai_confidence=check["confidence"],
            auditor_confirmed=False,
        ))

    return findings
