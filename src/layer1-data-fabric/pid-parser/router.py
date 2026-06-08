"""
FastAPI router for the P&ID Parser module.

Endpoints:
    POST /api/v1/pid/upload              → Start extraction job
    GET  /api/v1/pid/job/{id}/status     → Job status
    GET  /api/v1/pid/job/{id}/results    → Extraction results + review items
    POST /api/v1/pid/hierarchy/commit    → Commit to Knowledge Graph (Tier 3)
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from .schemas import (
    CommitRequest,
    CommitResponse,
    JobStatus,
    PIDJob,
    ReviewItem,
)
from .service import (
    commit_to_graph,
    create_job,
    get_job,
    get_review_items,
    process_job,
)
from .preprocessor import preprocess_pdf

logger = logging.getLogger("ers.pid_parser.router")
router = APIRouter(prefix="/api/v1/pid", tags=["P&ID Parser"])


# ── POST /upload ─────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=PIDJob,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Upload a P&ID PDF for extraction",
    description=(
        "Accepts a PDF file, pre-processes each page, sends to Claude "
        "Opus 4.6 vision for structured extraction, and flags items with "
        "confidence < 0.85 for engineering review."
    ),
)
async def upload_pid(file: UploadFile = File(...)) -> PIDJob:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF files are supported.",
        )

    # Save upload to temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name

    try:
        job = create_job(filename=file.filename)
        pages_b64 = preprocess_pdf(tmp_path)
        result = process_job(job.job_id, pages_b64)
        return result
    except Exception as e:
        logger.error("P&ID upload processing failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Processing failed: {str(e)}",
        )
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ── GET /job/{id}/status ─────────────────────────────────────

@router.get(
    "/job/{job_id}/status",
    response_model=PIDJob,
    summary="Get job status",
    description="Returns the current status, page counts, and review counts for a parsing job.",
)
async def get_job_status(job_id: UUID) -> PIDJob:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return job


# ── GET /job/{id}/results ────────────────────────────────────

@router.get(
    "/job/{job_id}/results",
    summary="Get full extraction results",
    description=(
        "Returns detailed extraction results including all equipment, "
        "connections, and items flagged for engineering review."
    ),
)
async def get_job_results(job_id: UUID) -> Dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    reviews = get_review_items(job_id)

    return {
        "job": job.model_dump(),
        "review_items": [r.model_dump() for r in reviews],
        "review_pending_count": sum(1 for r in reviews if r.review_status == "pending"),
    }


# ── POST /hierarchy/commit ──────────────────────────────────

@router.post(
    "/hierarchy/commit",
    response_model=CommitResponse,
    summary="Commit extraction to Knowledge Graph",
    description=(
        "Commits approved extraction data to the Neo4j Knowledge Graph. "
        "This is a GOVERNANCE TIER 3 action — requires human approval. "
        "All review items must be resolved before commit is allowed."
    ),
)
async def commit_hierarchy(request: CommitRequest) -> CommitResponse:
    job = get_job(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {request.job_id} not found")

    if job.status == JobStatus.COMMITTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This job has already been committed.",
        )

    try:
        return await commit_to_graph(request)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )
