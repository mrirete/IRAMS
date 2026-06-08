"""Pydantic v2 schemas for the Data Quality Intelligence engine."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DimensionScore(BaseModel):
    """Score for a single DQS dimension."""
    model_config = ConfigDict(from_attributes=True)

    dimension: str
    score: float = Field(..., ge=0, le=100)
    weight: float
    weighted_score: float
    details: Dict[str, Any] = Field(default_factory=dict)


class DQSResult(BaseModel):
    """Complete Data Quality Score for an asset or record."""
    model_config = ConfigDict(from_attributes=True)

    asset_id: UUID
    record_type: Optional[str] = None
    composite_score: float = Field(..., ge=0, le=100)
    dimensions: List[DimensionScore]
    ai_confidence_modifier: float = Field(
        default=1.0,
        description="Multiplier applied to AI confidence when DQS < 60. "
                    "e.g. DQS=45 → modifier = 1 - (60-45)/100 = 0.85"
    )
    scored_at: datetime
    source_id: Optional[UUID] = None


class SystemDQSSummary(BaseModel):
    """Aggregate DQS summary across the entire system."""
    total_assets_scored: int
    average_composite: float
    dimension_averages: Dict[str, float]
    below_threshold_count: int = Field(
        description="Number of assets with DQS < 60 (AI penalty zone)"
    )
    distribution: Dict[str, int] = Field(
        description="Buckets: excellent(90-100), good(75-89), fair(60-74), poor(<60)"
    )
    scored_at: datetime


class ScoringConfigUpdate(BaseModel):
    """Payload for POST /api/v1/quality/config."""
    weights: Optional[Dict[str, float]] = None
    completeness: Optional[Dict[str, Any]] = None
    accuracy: Optional[Dict[str, Any]] = None
    timeliness: Optional[Dict[str, Any]] = None
    consistency: Optional[Dict[str, Any]] = None


class AIConfidenceAdjustment(BaseModel):
    """Returned to downstream modules (Digital Twin, Agents) so they
    can adjust their own confidence outputs."""
    original_confidence: float
    dqs_score: float
    adjusted_confidence: float
    penalty_applied: float
    asset_id: UUID
