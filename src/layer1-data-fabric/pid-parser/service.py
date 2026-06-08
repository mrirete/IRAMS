"""
P&ID Parser — Job orchestrator & review queue.
Manages the full lifecycle: upload → preprocess → extract → review → commit.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from .schemas import (
    CommitRequest,
    CommitResponse,
    ExtractedEquipment,
    JobStatus,
    PageExtractionResult,
    PIDJob,
    ReviewItem,
    ReviewStatus,
)
from .graph_builder import build_graph_from_results

logger = logging.getLogger("ers.pid_parser.service")

# ── In-memory stores (swap for DB in production) ─────────────

_jobs: Dict[UUID, PIDJob] = {}
_review_queue: Dict[UUID, ReviewItem] = {}

REVIEW_CONFIDENCE_THRESHOLD = 0.85


# ── Job Management ───────────────────────────────────────────

def create_job(filename: str, created_by: Optional[str] = None) -> PIDJob:
    """Create a new parsing job."""
    now = datetime.now(tz=timezone.utc)
    job = PIDJob(
        job_id=uuid4(),
        filename=filename,
        status=JobStatus.QUEUED,
        created_at=now,
        updated_at=now,
        created_by=created_by,
    )
    _jobs[job.job_id] = job
    logger.info("Created P&ID job %s for file %s", job.job_id, filename)
    return job


def get_job(job_id: UUID) -> Optional[PIDJob]:
    return _jobs.get(job_id)


def list_jobs() -> List[PIDJob]:
    return list(_jobs.values())


# ── Processing Pipeline ─────────────────────────────────────

def process_job(job_id: UUID, pages_b64: List[str]) -> PIDJob:
    """
    Run the full extraction pipeline (synchronous wrapper).
    In production, this would be a Celery/ARQ background task.
    """
    job = _jobs.get(job_id)
    if not job:
        raise ValueError(f"Job {job_id} not found")

    job.status = JobStatus.PREPROCESSING
    job.total_pages = len(pages_b64)
    job.updated_at = datetime.now(tz=timezone.utc)

    # ── Extract ───────────────────────────────────────────────
    job.status = JobStatus.EXTRACTING
    job.updated_at = datetime.now(tz=timezone.utc)

    from .vision import extract_all_pages
    results = extract_all_pages(pages_b64)
    job.pages = results

    # ── Aggregate stats ───────────────────────────────────────
    total_eq = 0
    total_conn = 0
    review_count = 0

    for page in results:
        job.pages_processed += 1
        total_eq += len(page.equipment)
        for eq in page.equipment:
            total_conn += len(eq.connections_in) + len(eq.connections_out)
            # Flag low-confidence items for review
            if eq.confidence < REVIEW_CONFIDENCE_THRESHOLD:
                review_id = uuid4()
                _review_queue[review_id] = ReviewItem(
                    review_id=review_id,
                    job_id=job_id,
                    equipment=eq,
                )
                review_count += 1

    job.total_equipment = total_eq
    job.total_connections = total_conn
    job.items_needing_review = review_count

    if review_count > 0:
        job.status = JobStatus.REVIEW_REQUIRED
    else:
        job.status = JobStatus.COMPLETED

    job.updated_at = datetime.now(tz=timezone.utc)
    logger.info(
        "Job %s extracted %d equipment, %d connections, %d needing review",
        job_id, total_eq, total_conn, review_count,
    )
    return job


# ── Review Queue ─────────────────────────────────────────────

def get_review_items(job_id: UUID) -> List[ReviewItem]:
    return [r for r in _review_queue.values() if r.job_id == job_id]


def approve_review_item(
    review_id: UUID,
    reviewer: str,
    corrected: Optional[ExtractedEquipment] = None,
    notes: Optional[str] = None,
) -> ReviewItem:
    item = _review_queue.get(review_id)
    if not item:
        raise ValueError(f"Review item {review_id} not found")

    item.reviewer = reviewer
    item.reviewer_notes = notes
    if corrected:
        item.corrected_equipment = corrected
        item.review_status = ReviewStatus.MODIFIED
    else:
        item.review_status = ReviewStatus.APPROVED
    return item


def reject_review_item(review_id: UUID, reviewer: str, notes: str) -> ReviewItem:
    item = _review_queue.get(review_id)
    if not item:
        raise ValueError(f"Review item {review_id} not found")
    item.reviewer = reviewer
    item.reviewer_notes = notes
    item.review_status = ReviewStatus.REJECTED
    return item


def all_reviews_resolved(job_id: UUID) -> bool:
    items = get_review_items(job_id)
    return all(i.review_status != ReviewStatus.PENDING for i in items)


# ── Graph Commit (Tier 3 — HITL Required) ───────────────────

async def commit_to_graph(request: CommitRequest) -> CommitResponse:
    """
    Commit approved extraction results to the Knowledge Graph.
    
    GOVERNANCE: This is a Tier 3 action.
    NOTHING commits without human approval.
    """
    job = _jobs.get(request.job_id)
    if not job:
        raise ValueError(f"Job {request.job_id} not found")

    # Guard: all reviews must be resolved before commit
    if not all_reviews_resolved(request.job_id):
        pending = [r for r in get_review_items(request.job_id) if r.review_status == ReviewStatus.PENDING]
        raise ValueError(
            f"Cannot commit: {len(pending)} review items still pending. "
            "All low-confidence extractions must be reviewed before commit."
        )

    # Apply corrections from review
    corrected_pages = _apply_corrections(job)

    # Build graph
    nodes, edges = await build_graph_from_results(corrected_pages, request.job_id)

    job.status = JobStatus.COMMITTED
    job.updated_at = datetime.now(tz=timezone.utc)

    logger.info(
        "Job %s committed by %s: %d nodes, %d edges (Governance Tier 3)",
        request.job_id, request.approved_by, nodes, edges,
    )

    return CommitResponse(
        job_id=request.job_id,
        nodes_created=nodes,
        edges_created=edges,
        committed_at=datetime.now(tz=timezone.utc),
        committed_by=request.approved_by,
        governance_tier=3,
    )


def _apply_corrections(job: PIDJob) -> List[PageExtractionResult]:
    """Replace low-confidence items with reviewer-corrected versions."""
    corrections: Dict[str, ExtractedEquipment] = {}
    for item in get_review_items(job.job_id):
        if item.review_status == ReviewStatus.MODIFIED and item.corrected_equipment:
            corrections[item.equipment.tag] = item.corrected_equipment
        elif item.review_status == ReviewStatus.REJECTED:
            corrections[item.equipment.tag] = None  # type: ignore  # Will be filtered

    corrected_pages = []
    for page in job.pages:
        corrected_eq = []
        for eq in page.equipment:
            if eq.tag in corrections:
                replacement = corrections[eq.tag]
                if replacement is not None:
                    corrected_eq.append(replacement)
                # If None (rejected), skip it entirely
            else:
                corrected_eq.append(eq)
        corrected_pages.append(
            PageExtractionResult(
                page_number=page.page_number,
                equipment=corrected_eq,
                low_confidence_count=page.low_confidence_count,
                processing_time_seconds=page.processing_time_seconds,
            )
        )
    return corrected_pages
