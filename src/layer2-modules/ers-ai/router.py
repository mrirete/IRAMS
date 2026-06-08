"""
ERS AI Router — Backend AI proxy endpoints.
═══════════════════════════════════════════

POST /api/v1/ai/chat       — Proxied Gemini chat (conversational)
POST /api/v1/ai/analyze    — Proxied Gemini structured analysis (JSON out)
POST /api/v1/ai/vision     — Multi-modal image analysis (Cap 2)
POST /api/v1/ai/query      — NL-to-SQL safe execution (Cap 8)
POST /api/v1/ai/oem/ingest — Ingest OEM manual for RAG (Cap 6)
POST /api/v1/ai/oem/search — RAG-powered OEM manual search (Cap 6)
GET  /api/v1/ai/audit-log  — Retrieve AI interaction history (admin only)
GET  /api/v1/ai/health     — AI subsystem health check

Security:
  - All endpoints require valid JWT (get_current_active_user)
  - API key NEVER sent to frontend
  - Per-user rate limiting (20 req/min)
  - Full audit trail to ers_ai_audit_log
"""

from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel, Field

from shared.auth.dependencies import get_current_active_user
from shared.auth.schemas import User

from .service import (
    call_gemini_proxy,
    call_gemini_vision,
    execute_safe_sql,
    GEMINI_API_KEY,
    RELANTERN_SYSTEM_INSTRUCTION,
)

logger = logging.getLogger("ers.ai.router")

router = APIRouter(
    prefix="/ai",
    tags=["AI Proxy"],
    responses={401: {"description": "Unauthorized"}},
)


# ── Request / Response Schemas ───────────────────────────────

class ChatRequest(BaseModel):
    """Chat-style AI request (conversational response)."""
    prompt: str = Field(..., max_length=10000, description="User prompt or question")
    module: str = Field("general", description="Originating EAM module (e.g. 'assets', 'work_orders')")
    context: Optional[str] = Field(None, max_length=8000, description="Additional context (asset data, etc.)")
    context_type: Optional[str] = Field(None, description="Type of context (e.g. 'asset_detail', 'wo_history')")
    temperature: float = Field(0.3, ge=0.0, le=1.0, description="Generation temperature")

class AnalyzeRequest(BaseModel):
    """Structured analysis request (JSON output)."""
    prompt: str = Field(..., max_length=15000, description="Analysis prompt with data context")
    module: str = Field("general", description="Originating EAM module")
    action_type: str = Field("analyze", description="Analysis type (e.g. 'rca', 'fmea', 'pm_eval')")
    context_type: Optional[str] = Field(None, description="Context type for audit trail")
    context_summary: Optional[str] = Field(None, max_length=500, description="Brief summary for audit")
    temperature: float = Field(0.3, ge=0.0, le=1.0, description="Generation temperature")

class VisionRequest(BaseModel):
    """Multi-modal vision analysis request."""
    image_base64: str = Field(..., description="Base64-encoded image data (JPEG/PNG/WEBP)")
    mime_type: Optional[str] = Field(None, description="Image MIME type (auto-detected if not provided)")
    prompt: str = Field(
        "Analyze this equipment image for defects, corrosion, leaks, or mechanical damage.",
        max_length=5000,
        description="Analysis instruction",
    )
    module: str = Field("vision", description="Originating module")
    asset_name: Optional[str] = Field(None, description="Asset name for context")
    asset_tag: Optional[str] = Field(None, description="Asset tag for context")
    asset_type: Optional[str] = Field(None, description="Equipment type for context")
    analysis_type: str = Field("general", description="Type: general, corrosion, thermal, mechanical, tagging")
    temperature: float = Field(0.3, ge=0.0, le=1.0, description="Generation temperature")

class SQLQueryRequest(BaseModel):
    """NL-to-SQL safe query execution request."""
    sql: str = Field(..., max_length=5000, description="SQL SELECT query to execute")

class OEMSearchRequest(BaseModel):
    """RAG-powered OEM manual search request."""
    query: str = Field(..., max_length=2000, description="Natural language search query")
    asset_tag: Optional[str] = Field(None, description="Filter by asset tag")
    equipment_class: Optional[str] = Field(None, description="Filter by equipment class")
    top_k: int = Field(5, ge=1, le=20, description="Number of results to return")

class AIResponse(BaseModel):
    """Standard AI proxy response."""
    text: str
    tokens_used: int
    duration_ms: int

class VisionFinding(BaseModel):
    """Single finding from vision analysis."""
    defect_type: str
    severity: str
    location: str
    confidence: float
    description: str
    suggested_failure_mode: Optional[str] = None
    suggested_failure_cause: Optional[str] = None
    rectification: Optional[str] = None

class VisionResponse(BaseModel):
    """Vision analysis response."""
    findings: List[VisionFinding]
    summary: str
    tokens_used: int
    duration_ms: int

class SQLQueryResponse(BaseModel):
    """Safe SQL execution response."""
    columns: List[str]
    rows: List[Any]
    row_count: int
    execution_time_ms: int

class OEMSearchResponse(BaseModel):
    """OEM manual search response."""
    answer: str
    sources: List[dict]
    safety_blocked: bool = False

class AuditLogEntry(BaseModel):
    """Single AI audit log entry."""
    id: str
    username: str
    module: str
    action_type: str
    context_type: Optional[str]
    context_summary: Optional[str]
    model_used: str
    tokens_used: int
    duration_ms: int
    created_at: str


# ── Endpoints ────────────────────────────────────────────────

@router.post("/chat", response_model=AIResponse, summary="AI Chat")
async def ai_chat(
    body: ChatRequest,
    request: Request,
    user: User = Depends(get_current_active_user),
):
    """
    Send a conversational prompt to the AI engine.
    Used by the Relantern sidebar and AskRelantern buttons.
    """
    full_prompt = body.prompt
    if body.context:
        full_prompt = f"Context:\n{body.context}\n\nUser Question:\n{body.prompt}"

    try:
        result = await call_gemini_proxy(
            full_prompt,
            user_id=str(user.id),
            username=user.username,
            module=body.module,
            action_type="chat",
            context_type=body.context_type,
            context_summary=body.context[:200] if body.context else None,
            temperature=body.temperature,
            ip_address=request.client.host if request.client else None,
        )
        return AIResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/analyze", response_model=AIResponse, summary="AI Structured Analysis")
async def ai_analyze(
    body: AnalyzeRequest,
    request: Request,
    user: User = Depends(get_current_active_user),
):
    """
    Send a structured analysis prompt to the AI engine.
    Response is expected to be JSON (parsed client-side).
    Used by AIAnalysisEngine methods (RCA, FMEA, PM eval, etc.)
    """
    system_instruction = (RELANTERN_SYSTEM_INSTRUCTION +
        "\n\nIMPORTANT: Always respond with valid JSON only. "
        "No markdown, no code fences, just raw JSON.")

    try:
        result = await call_gemini_proxy(
            body.prompt,
            user_id=str(user.id),
            username=user.username,
            module=body.module,
            action_type=body.action_type,
            context_type=body.context_type,
            context_summary=body.context_summary,
            temperature=body.temperature,
            system_instruction=system_instruction,
            ip_address=request.client.host if request.client else None,
        )
        return AIResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ── Cap 2: Multi-Modal Vision ────────────────────────────────

@router.post("/vision", response_model=AIResponse, summary="AI Vision Analysis")
async def ai_vision(
    body: VisionRequest,
    request: Request,
    user: User = Depends(get_current_active_user),
):
    """
    Analyze an equipment image for defects, corrosion, thermal anomalies, etc.
    Accepts base64-encoded image + optional asset context.
    HITL: Findings are suggestions — technician reviews before persisting.
    """
    # Build contextual prompt
    asset_ctx = ""
    if body.asset_name:
        asset_ctx = f"\nAsset: {body.asset_name}"
        if body.asset_tag:
            asset_ctx += f" (Tag: {body.asset_tag})"
        if body.asset_type:
            asset_ctx += f"\nEquipment Type: {body.asset_type}"

    full_prompt = f"""{body.prompt}
{asset_ctx}
Analysis Type: {body.analysis_type}

Identify ALL visible defects. For each defect provide:
- defect_type: corrosion, crack, leak, thermal_anomaly, vibration_damage, erosion, fouling, misalignment, missing_component, general_damage
- severity: minor, moderate, severe, critical
- location: describe the location in the image
- confidence: 0.0 to 1.0
- description: detailed description of the finding
- suggested_failure_mode: ISO 14224 failure mode code if applicable
- suggested_failure_cause: ISO 14224 failure cause if applicable
- rectification: recommended corrective action

Respond as JSON:
{{
  "findings": [{{...}}],
  "summary": "1-2 sentence overall assessment"
}}"""

    try:
        result = await call_gemini_vision(
            body.image_base64,
            full_prompt,
            user_id=str(user.id),
            username=user.username,
            module=body.module or "vision",
            action_type=f"vision_{body.analysis_type}",
            context_type="equipment_image",
            context_summary=f"Vision analysis ({body.analysis_type}) for {body.asset_name or 'unknown asset'}",
            temperature=body.temperature,
            ip_address=request.client.host if request.client else None,
        )
        return AIResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ── Cap 8: NL-to-SQL Safe Execution ─────────────────────────

@router.post("/query", response_model=SQLQueryResponse, summary="Safe SQL Query Execution")
async def ai_query(
    body: SQLQueryRequest,
    request: Request,
    user: User = Depends(get_current_active_user),
):
    """
    Execute a validated, read-only SQL query against the EAM database.
    Only SELECT queries against whitelisted tables are permitted.
    Full audit trail for every query executed.
    """
    try:
        result = await execute_safe_sql(
            body.sql,
            user_id=str(user.id),
            username=user.username,
            ip_address=request.client.host if request.client else None,
        )
        return SQLQueryResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ── Cap 6: OEM Manual Search ────────────────────────────────

@router.post("/oem/search", response_model=OEMSearchResponse, summary="OEM Manual RAG Search")
async def oem_search(
    body: OEMSearchRequest,
    request: Request,
    user: User = Depends(get_current_active_user),
):
    """
    RAG-powered search across ingested OEM equipment manuals.
    Returns AI-generated answer with source citations (document, page).
    """
    try:
        from .oem_ingest import oem_rag_engine

        rag_result = oem_rag_engine.query_oem(
            query=body.query,
            asset_tag=body.asset_tag,
            equipment_class=body.equipment_class,
            top_k=body.top_k,
        )

        # Audit log
        from .service import _log_ai_interaction
        _log_ai_interaction(
            user_id=str(user.id),
            username=user.username,
            module="oem_search",
            action_type="rag_search",
            query_text=body.query[:2000],
            response_text=rag_result.get("answer", "")[:5000],
            context_type="oem_manual",
            context_summary=f"OEM search: asset={body.asset_tag}, class={body.equipment_class}",
            model_used="rag+gemini",
            temperature=0.3,
            tokens_used=0,
            duration_ms=0,
            ip_address=request.client.host if request.client else None,
        )

        return OEMSearchResponse(
            answer=rag_result.get("answer", "No results found."),
            sources=rag_result.get("sources", []),
            safety_blocked=rag_result.get("safety_blocked", False),
        )
    except ImportError:
        return OEMSearchResponse(
            answer="OEM search module not available. Please check backend configuration.",
            sources=[],
        )
    except Exception as e:
        logger.error("OEM search failed: %s", e)
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/oem/ingest", summary="Ingest OEM Manual")
async def oem_ingest(
    file: UploadFile = File(..., description="OEM manual file (PDF, DOCX, TXT, XLSX)"),
    asset_tag: str = Form(None, description="Associated asset tag"),
    equipment_class: str = Form(None, description="Equipment class"),
    document_type: str = Form("oem_manual", description="Document type"),
    user: User = Depends(get_current_active_user),
):
    """
    Upload and ingest an OEM equipment manual for RAG-powered search.
    Supports PDF, DOCX, TXT, and XLSX formats.
    Chunks, embeds, and stores for future retrieval.
    """
    # RBAC check — only admin, reliability_engineer, planner
    allowed_roles = {"admin", "administrator", "reliability_engineer", "planner", "plant_manager"}
    if user.role.value not in allowed_roles:
        raise HTTPException(
            status_code=403,
            detail="Insufficient permissions to ingest OEM manuals"
        )

    try:
        from .oem_ingest import oem_rag_engine

        content = await file.read()
        filename = file.filename or "unknown"

        chunk_count = oem_rag_engine.ingest_file(
            file_bytes=content,
            filename=filename,
            asset_tag=asset_tag,
            equipment_class=equipment_class,
            document_type=document_type,
        )

        return {
            "status": "success",
            "filename": filename,
            "chunks_created": chunk_count,
            "message": f"Successfully ingested '{filename}' — {chunk_count} chunks indexed.",
        }
    except ImportError:
        raise HTTPException(status_code=503, detail="OEM ingestion module not available.")
    except Exception as e:
        logger.error("OEM ingestion failed for %s: %s", file.filename, e)
        raise HTTPException(status_code=500, detail=str(e))


# ── Audit Log & Health ───────────────────────────────────────

@router.get("/audit-log", summary="AI Audit Log (Admin)")
async def get_audit_log(
    limit: int = 50,
    offset: int = 0,
    module: Optional[str] = None,
    username: Optional[str] = None,
    user: User = Depends(get_current_active_user),
):
    """
    Retrieve AI interaction audit log.
    Restricted to users with 'admin' or 'reliability_engineer' roles.
    Full audit traceability per NIST/IEC 62443.
    """
    # RBAC check — admin and reliability engineers only
    allowed_roles = {"admin", "administrator", "reliability_engineer", "plant_manager"}
    if user.role.value not in allowed_roles and user.role.value != "admin":
        raise HTTPException(
            status_code=403,
            detail="Insufficient permissions to access AI audit log"
        )

    from .service import _get_supabase
    sb = _get_supabase()
    if sb is None:
        return {"entries": [], "total": 0, "message": "Audit logging not configured"}

    try:
        query = sb.table("ers_ai_audit_log").select("*", count="exact")
        if module:
            query = query.eq("module", module)
        if username:
            query = query.eq("username", username)
        query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

        result = query.execute()
        return {
            "entries": result.data or [],
            "total": result.count or 0,
        }
    except Exception as e:
        logger.error("Failed to retrieve audit log: %s", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve audit log")


@router.get("/health", summary="AI Health Check")
async def ai_health():
    """AI subsystem health and configuration status."""
    from .service import _get_supabase as _gs
    return {
        "status": "healthy" if GEMINI_API_KEY else "degraded",
        "api_key_configured": bool(GEMINI_API_KEY),
        "model": "gemini-2.0-flash",
        "audit_logging": _gs() is not None,
        "capabilities": {
            "chat": True,
            "analyze": True,
            "vision": True,
            "nl_to_sql": True,
            "oem_search": True,
        },
    }
