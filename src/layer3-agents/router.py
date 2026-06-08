"""
Layer 3 — FastAPI Router
═════════════════════════
Endpoints for agent routing, multi-agent collaboration,
RAG queries, and M365 integration triggers.
"""
from typing import List, Dict, Any, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from layer3_agents.schemas import (
    IntentClassification, AgentRoute, AgentResponse,
    CollaborationPlan, RAGResponse,
    TeamsCardPayload, OutlookDigest, SharePointPublish, PowerBIPush
)
from layer3_agents.engines.router_engine import AgentRouterEngine
from layer3_agents.engines.rag import RAGEngine
from layer3_agents.engines.m365 import M365Engine

router = APIRouter(prefix="/agents", tags=["Layer 3 — Specialist Agents"])

# ── Lazy singletons ────────────────────────────────────────
_router_engine: Optional[AgentRouterEngine] = None
_rag_engine: Optional[RAGEngine] = None
_m365_engine: Optional[M365Engine] = None

def _get_router() -> AgentRouterEngine:
    global _router_engine
    if not _router_engine: _router_engine = AgentRouterEngine()
    return _router_engine

def _get_rag() -> RAGEngine:
    global _rag_engine
    if not _rag_engine: _rag_engine = RAGEngine()
    return _rag_engine

def _get_m365() -> M365Engine:
    global _m365_engine
    if not _m365_engine: _m365_engine = M365Engine()
    return _m365_engine


# ── Request Models ─────────────────────────────────────────

class QueryRequest(BaseModel):
    query: str
    context: Optional[Dict[str, Any]] = None

class IngestRequest(BaseModel):
    text: str
    source: str


# ══════════════════════════════════════════════════════════════
#  AGENT ROUTING (12.1)
# ══════════════════════════════════════════════════════════════

@router.post("/classify", response_model=IntentClassification)
async def classify_intent(req: QueryRequest):
    """Classify user intent and return ranked agent matches."""
    return _get_router().classify_intent(req.query)

@router.post("/route", response_model=AgentRoute)
async def route_query(req: QueryRequest):
    """Route to the single best-matching agent."""
    return _get_router().route(req.query)

@router.post("/execute", response_model=AgentResponse)
async def execute_query(req: QueryRequest):
    """Route and execute against the best-matching agent."""
    return _get_router().execute_single(req.query, req.context)

@router.post("/collaborate", response_model=List[AgentResponse])
async def collaborate(req: QueryRequest):
    """Execute a multi-agent collaboration for cross-domain queries."""
    return _get_router().execute_collaboration(req.query, req.context)

@router.post("/collaboration-plan", response_model=CollaborationPlan)
async def get_collaboration_plan(req: QueryRequest):
    """Preview the multi-agent collaboration plan without executing."""
    return _get_router().build_collaboration_plan(req.query)


# ══════════════════════════════════════════════════════════════
#  RAG (12.3)
# ══════════════════════════════════════════════════════════════

@router.post("/rag/ingest")
async def ingest_document(req: IngestRequest):
    """Ingest a document into the RAG vector store."""
    count = _get_rag().ingest_document(req.text, req.source)
    return {"status": "ingested", "chunks_created": count, "source": req.source}

@router.post("/rag/query", response_model=RAGResponse)
async def rag_query(req: QueryRequest):
    """Query the RAG pipeline with safety exclusion enforcement."""
    return _get_rag().query(req.query)


# ══════════════════════════════════════════════════════════════
#  M365 INTEGRATION (12.3)
# ══════════════════════════════════════════════════════════════

@router.post("/m365/teams/send")
async def send_teams_card(payload: TeamsCardPayload):
    return _get_m365().send_teams_card(payload)

@router.post("/m365/outlook/digest")
async def send_outlook_digest(digest: OutlookDigest):
    return _get_m365().send_outlook_kpi_digest(digest)

@router.post("/m365/sharepoint/publish")
async def publish_sharepoint(payload: SharePointPublish):
    return _get_m365().publish_to_sharepoint(payload)

@router.post("/m365/powerbi/push")
async def push_powerbi(payload: PowerBIPush):
    return _get_m365().push_to_powerbi(payload)
