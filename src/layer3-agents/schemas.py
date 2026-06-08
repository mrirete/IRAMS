"""
Layer 3 — Specialist Agent System Schemas
═════════════════════════════════════════
Models for Intent Classification, Agent Routing, Multi-Agent
Collaboration, RAG pipelines, and M365 integration.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════
#  AGENT IDENTITY
# ══════════════════════════════════════════════════════════════

class AgentDomain(str, Enum):
    RELIABILITY_ANALYST = "reliability_analyst"
    PREDICTIVE_MAINTENANCE = "predictive_maintenance"
    STRATEGIC_ASSET = "strategic_asset"
    WORK_INTELLIGENCE = "work_intelligence"
    COMPLIANCE_SAFETY = "compliance_safety"
    ASSET_INTEGRITY_AUDITOR = "asset_integrity_auditor"
    INSPECTION_VISION = "inspection_vision"
    SUSTAINABILITY = "sustainability"
    KNOWLEDGE_PEOPLE = "knowledge_people"

class GovernanceTier(int, Enum):
    """Tier 1 = fully autonomous, Tier 5 = engineer sign-off mandatory."""
    TIER_1 = 1
    TIER_2 = 2
    TIER_3 = 3
    TIER_4 = 4
    TIER_5 = 5


# ══════════════════════════════════════════════════════════════
#  INTENT CLASSIFICATION & ROUTING
# ══════════════════════════════════════════════════════════════

class IntentClassification(BaseModel):
    query: str
    matched_agents: List[Dict[str, Any]]  # [{domain, score, matched_keywords}]
    primary_agent: AgentDomain
    requires_collaboration: bool = False
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class AgentRoute(BaseModel):
    route_id: UUID = Field(default_factory=uuid4)
    query: str
    target_agent: AgentDomain
    confidence: float
    matched_keywords: List[str]

class CollaborationStep(BaseModel):
    order: int
    agent: AgentDomain
    sub_query: str
    depends_on: Optional[int] = None

class CollaborationPlan(BaseModel):
    plan_id: UUID = Field(default_factory=uuid4)
    original_query: str
    steps: List[CollaborationStep]
    agents_involved: List[AgentDomain]


# ══════════════════════════════════════════════════════════════
#  AGENT RESPONSE
# ══════════════════════════════════════════════════════════════

class AgentResponse(BaseModel):
    agent: AgentDomain
    query: str
    answer: str
    confidence: float
    tier_used: GovernanceTier
    sources: List[str] = Field(default_factory=list)
    requires_human_approval: bool = False
    safety_flags: List[str] = Field(default_factory=list)


# ══════════════════════════════════════════════════════════════
#  RAG (Retrieval-Augmented Generation)
# ══════════════════════════════════════════════════════════════

class DocumentChunk(BaseModel):
    chunk_id: UUID = Field(default_factory=uuid4)
    source_document: str
    chunk_index: int
    text: str
    token_count: int
    embedding: Optional[List[float]] = None

class RAGSearchResult(BaseModel):
    chunk: DocumentChunk
    similarity_score: float

class RAGResponse(BaseModel):
    query: str
    answer: str
    sources: List[Dict[str, Any]]  # [{document, chunk_index, score, excerpt}]
    safety_blocked: bool = False
    safety_reason: Optional[str] = None


# ══════════════════════════════════════════════════════════════
#  M365 INTEGRATION
# ══════════════════════════════════════════════════════════════

class TeamsCardPayload(BaseModel):
    channel_id: str
    title: str
    body: str
    actions: List[Dict[str, str]] = Field(default_factory=list)
    requires_approval: bool = False

class OutlookDigest(BaseModel):
    recipients: List[str]
    subject: str
    metrics: Dict[str, Any]
    period: str  # "weekly" | "monthly"

class SharePointPublish(BaseModel):
    site_id: str
    library: str
    document_name: str
    content: bytes = b""
    metadata: Dict[str, str] = Field(default_factory=dict)

class PowerBIPush(BaseModel):
    dataset_id: str
    table_name: str
    rows: List[Dict[str, Any]]
