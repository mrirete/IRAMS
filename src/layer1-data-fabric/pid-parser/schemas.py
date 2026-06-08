"""
Pydantic v2 schemas for the P&ID Parser module.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ── Enums ──────────────────────────────────────────────────────

class JobStatus(str, Enum):
    QUEUED = "queued"
    PREPROCESSING = "preprocessing"
    EXTRACTING = "extracting"
    REVIEW_REQUIRED = "review_required"
    COMPLETED = "completed"
    COMMITTED = "committed"
    FAILED = "failed"


class ReviewStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    MODIFIED = "modified"


class EquipmentType(str, Enum):
    PUMP = "pump"
    COMPRESSOR = "compressor"
    HEAT_EXCHANGER = "heat_exchanger"
    VESSEL = "vessel"
    TANK = "tank"
    VALVE = "valve"
    FILTER = "filter"
    REACTOR = "reactor"
    COLUMN = "column"
    TURBINE = "turbine"
    INSTRUMENT = "instrument"
    PIPE = "pipe"
    UNKNOWN = "unknown"


# ── Extraction Models ─────────────────────────────────────────

class ExtractedConnection(BaseModel):
    """A single pipe/signal connection between equipment items."""
    target_tag: str
    flow_type: str = "process"  # process, utility, instrument, signal
    line_number: Optional[str] = None
    pipe_spec: Optional[str] = None


class ExtractedEquipment(BaseModel):
    """Single equipment item extracted from a P&ID page."""
    model_config = ConfigDict(from_attributes=True)

    tag: str
    type_: EquipmentType = Field(alias="type", default=EquipmentType.UNKNOWN)
    description: Optional[str] = None
    connections_in: List[ExtractedConnection] = Field(default_factory=list)
    connections_out: List[ExtractedConnection] = Field(default_factory=list)
    confidence: float = Field(..., ge=0.0, le=1.0)
    page_number: int = 1
    bounding_box: Optional[Dict[str, float]] = None  # x, y, w, h normalised


class PageExtractionResult(BaseModel):
    """Result for a single P&ID page."""
    page_number: int
    equipment: List[ExtractedEquipment] = Field(default_factory=list)
    low_confidence_count: int = 0
    processing_time_seconds: float = 0.0
    raw_vision_response: Optional[str] = None


# ── Job Models ────────────────────────────────────────────────

class PIDJob(BaseModel):
    """Top-level parsing job tracking model."""
    model_config = ConfigDict(from_attributes=True)

    job_id: UUID
    filename: str
    status: JobStatus = JobStatus.QUEUED
    total_pages: int = 0
    pages_processed: int = 0
    created_at: datetime
    updated_at: datetime
    created_by: Optional[str] = None

    pages: List[PageExtractionResult] = Field(default_factory=list)

    # Aggregated stats
    total_equipment: int = 0
    total_connections: int = 0
    items_needing_review: int = 0


class ReviewItem(BaseModel):
    """An item flagged for engineering review (confidence < 0.85)."""
    review_id: UUID
    job_id: UUID
    equipment: ExtractedEquipment
    review_status: ReviewStatus = ReviewStatus.PENDING
    reviewer: Optional[str] = None
    reviewer_notes: Optional[str] = None
    corrected_equipment: Optional[ExtractedEquipment] = None


class CommitRequest(BaseModel):
    """Request payload for POST /hierarchy/commit."""
    job_id: UUID
    approved_by: str
    notes: Optional[str] = None


class CommitResponse(BaseModel):
    """Response after committing to the knowledge graph."""
    job_id: UUID
    nodes_created: int = 0
    edges_created: int = 0
    committed_at: datetime
    committed_by: str
    governance_tier: int = 3  # Always Tier 3 per spec
