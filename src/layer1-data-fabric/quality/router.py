"""
FastAPI router for the ERS Data Quality Intelligence engine.

Endpoints:
    GET  /api/v1/quality/asset/{id}/score   → DQSResult
    GET  /api/v1/quality/system/summary     → SystemDQSSummary
    POST /api/v1/quality/config             → updated config
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from .engine import (
    compute_dqs,
    build_system_summary,
    get_config,
    reload_config,
)
from .schemas import DQSResult, ScoringConfigUpdate, SystemDQSSummary

logger = logging.getLogger("ers.quality")
router = APIRouter(prefix="/api/v1/quality", tags=["Data Quality"])


# ── In-memory store (swap for DB session in production) ─────────

_scored_cache: Dict[UUID, DQSResult] = {}


def _resolve_asset_record(asset_id: UUID) -> Dict[str, Any]:
    """Stub: in production, query the DB for the asset's latest record."""
    # Returns a placeholder that will be replaced by real DB lookup
    return {
        "equipment_id": str(asset_id),
        "name": "Stub Asset",
        "asset_class": "Pump",
        "criticality_rank": "A",
        "taxonomy_code": "ISO-14224-PUMP",
        "location": "Unit 1",
    }


def _resolve_asset_class(asset_id: UUID) -> str:
    """Stub: returns asset_class for the given asset ID."""
    return "Pump"


def _resolve_sync_info(asset_id: UUID) -> tuple[Optional[datetime], str]:
    """Stub: resolve last sync timestamp and source type."""
    return datetime.now(tz=timezone.utc), "cmms"


def _resolve_consistency(asset_id: UUID) -> tuple[int, int]:
    """Stub: returns (consistent_refs, total_refs)."""
    return 1, 1


# ── GET /asset/{id}/score ──────────────────────────────────────

@router.get(
    "/asset/{asset_id}/score",
    response_model=DQSResult,
    summary="Score a single asset",
    description=(
        "Computes a real-time Data Quality Score for the specified "
        "asset across Completeness, Accuracy, Timeliness, and "
        "Consistency dimensions."
    ),
)
async def get_asset_dqs(asset_id: UUID) -> DQSResult:
    record = _resolve_asset_record(asset_id)
    asset_class = _resolve_asset_class(asset_id)
    last_sync, source_type = _resolve_sync_info(asset_id)
    c_refs, t_refs = _resolve_consistency(asset_id)

    result = compute_dqs(
        asset_id=asset_id,
        record=record,
        record_type="asset",
        asset_class=asset_class,
        last_sync_at=last_sync,
        source_type=source_type,
        consistent_refs=c_refs,
        total_refs=t_refs,
    )

    _scored_cache[asset_id] = result
    return result


# ── GET /system/summary ────────────────────────────────────────

@router.get(
    "/system/summary",
    response_model=SystemDQSSummary,
    summary="System-wide DQS summary",
    description="Aggregate quality distribution across all scored assets.",
)
async def get_system_summary() -> SystemDQSSummary:
    results = list(_scored_cache.values())
    return build_system_summary(results)


# ── POST /config ───────────────────────────────────────────────

@router.post(
    "/config",
    summary="Update scoring configuration",
    description="Merge overrides into the DQS YAML config at runtime.",
)
async def update_config(payload: ScoringConfigUpdate) -> Dict[str, Any]:
    overrides = payload.model_dump(exclude_none=True)
    if not overrides:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No configuration overrides provided.",
        )
    updated = reload_config(overrides)
    logger.info("DQS config updated at runtime: %s", list(overrides.keys()))
    return {"status": "ok", "updated_keys": list(overrides.keys())}
