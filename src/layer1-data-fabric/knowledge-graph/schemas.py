"""
Pydantic v2 schemas for the ERS Industrial Knowledge Graph.

Ontology aligned to ISO 55001:2024 with Uptime Elements cause categories.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ── Enums ──────────────────────────────────────────────────────

class CauseCategory(str, Enum):
    """Uptime Elements 5 cause sources."""
    DESIGN = "design"
    PROCUREMENT = "procurement"
    INSTALLATION = "installation"
    OPERATION = "operation"
    MAINTENANCE = "maintenance"


class FlowType(str, Enum):
    PROCESS = "process"
    UTILITY = "utility"
    INSTRUMENT = "instrument"


class AccountabilityType(str, Enum):
    OWNER = "owner"
    MAINTAINER = "maintainer"
    OPERATOR = "operator"


# ── Node schemas ───────────────────────────────────────────────

class _NodeBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID


class AssetNode(_NodeBase):
    name: str
    asset_class: Optional[str] = None
    criticality: Optional[str] = None
    location: Optional[str] = None
    health_index: Optional[float] = Field(None, ge=0, le=100)


class FailureModeNode(_NodeBase):
    description: str
    frequency: Optional[float] = None
    distribution_params: Optional[Dict[str, Any]] = None


class CauseNode(_NodeBase):
    description: str
    category: CauseCategory


class PersonNode(_NodeBase):
    name: str
    role: Optional[str] = None
    certifications: List[str] = Field(default_factory=list)
    years_experience: Optional[float] = None


class CompetencyNode(_NodeBase):
    name: str
    level_required: Optional[int] = None
    asset_classes: List[str] = Field(default_factory=list)


class StandardClauseNode(_NodeBase):
    standard: str = "ISO_55001"
    clause_number: str
    requirement_text: Optional[str] = None
    compliance_status: Optional[str] = None


class KPINode(_NodeBase):
    name: str
    smrp_pillar: Optional[str] = None
    target: Optional[float] = None
    current_value: Optional[float] = None
    trend: Optional[str] = None


class DepartmentNode(_NodeBase):
    name: str
    samp_objectives: List[str] = Field(default_factory=list)


# ── Edge schemas ───────────────────────────────────────────────

class _EdgeBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    source_id: UUID
    target_id: UUID


class ExperiencesEdge(_EdgeBase):
    """Asset -[EXPERIENCES]-> FailureMode"""
    frequency: Optional[float] = None
    last_occurrence: Optional[datetime] = None


class CausedByEdge(_EdgeBase):
    """FailureMode -[CAUSED_BY]-> Cause"""
    probability: Optional[float] = None


class AlsoAffectsEdge(_EdgeBase):
    """Cause -[ALSO_AFFECTS]-> Asset"""
    propagation_path: Optional[str] = None


class MaintainsEdge(_EdgeBase):
    """Person -[MAINTAINS]-> Asset"""
    experience_level: Optional[str] = None
    last_worked: Optional[datetime] = None


class HasCompetencyEdge(_EdgeBase):
    """Person -[HAS_COMPETENCY]-> Competency"""
    current_level: Optional[int] = None


class RequiresCompetencyEdge(_EdgeBase):
    """Asset -[REQUIRES_COMPETENCY]-> Competency"""
    min_level: Optional[int] = None


class FeedsEdge(_EdgeBase):
    """Asset -[FEEDS]-> Asset"""
    flow_type: Optional[FlowType] = None


class MeasuredByEdge(_EdgeBase):
    """Asset -[MEASURED_BY]-> KPI"""
    contribution_weight: Optional[float] = None


class SupportsEdge(_EdgeBase):
    """KPI -[SUPPORTS]-> StandardClause"""
    alignment_score: Optional[float] = None


class OwnsEdge(_EdgeBase):
    """Department -[OWNS]-> Asset"""
    accountability_type: Optional[AccountabilityType] = None


# ── Query response schemas ─────────────────────────────────────

class ImpactNetworkResponse(BaseModel):
    """Response for /graph/asset/{id}/impact-network"""
    root_asset: AssetNode
    directly_fed_assets: List[AssetNode] = Field(default_factory=list)
    cascade_depth: int = 0
    total_impacted: int = 0
    paths: List[Dict[str, Any]] = Field(default_factory=list)


class KnowledgeDependencyResponse(BaseModel):
    """Response for /graph/person/{id}/knowledge-dependency"""
    person: PersonNode
    maintained_assets: List[AssetNode] = Field(default_factory=list)
    exclusive_assets: List[AssetNode] = Field(
        default_factory=list,
        description="Assets where this person is the ONLY maintainer",
    )
    competencies: List[CompetencyNode] = Field(default_factory=list)
    risk_score: float = Field(
        default=0.0,
        description="0-100 score indicating knowledge concentration risk",
    )


class CausationChainResponse(BaseModel):
    """Response for /graph/failure-mode/{id}/causation-chain"""
    failure_mode: FailureModeNode
    root_causes: List[CauseNode] = Field(default_factory=list)
    shared_cause_failure_modes: List[FailureModeNode] = Field(default_factory=list)
    affected_assets: List[AssetNode] = Field(default_factory=list)


class SAMPContributorsResponse(BaseModel):
    """Response for /graph/samp-objective/{id}/asset-contributors"""
    standard_clause: Optional[StandardClauseNode] = None
    supporting_kpis: List[KPINode] = Field(default_factory=list)
    contributing_assets: List[AssetNode] = Field(default_factory=list)
    at_risk_assets: List[AssetNode] = Field(
        default_factory=list,
        description="Assets with health_index < 60 threatening the objective",
    )


class CypherQueryRequest(BaseModel):
    """POST body for /graph/query Cypher passthrough."""
    query: str
    parameters: Optional[Dict[str, Any]] = None


class CypherQueryResponse(BaseModel):
    records: List[Dict[str, Any]]
    count: int
