"""
FastAPI router for the ERS Connector framework.

Endpoints:
    GET  /api/v1/connectors/health
    POST /api/v1/connectors/register
    POST /api/v1/connectors/{id}/sync
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from .manager import manager
from .schemas import ConnectorHealth, RESTConfig, SyncMode

logger = logging.getLogger("ers.connectors.router")
router = APIRouter(prefix="/api/v1/connectors", tags=["Connectors"])


@router.get(
    "/health",
    response_model=List[ConnectorHealth],
    summary="Get health of all registered connectors",
    description="Returns the current status, last sync, next sync, and errors for all connectors.",
)
async def get_health() -> List[ConnectorHealth]:
    return list(manager.get_health().values())


@router.post(
    "/register/rest",
    summary="Register a new REST API connector",
    description="Instantiates and schedules a new REST API connector in the manager.",
)
async def register_rest(config: RESTConfig) -> ConnectorHealth:
    connector = manager.register_connector(config)
    # Test connection immediately
    passed = await connector.test_connection()
    if not passed:
        # Don't fail the registration, but mark it error
        h = manager._health[config.id]
        h.status = "error"
        h.error_message = "Initial connection test failed."
    return manager._health[config.id]


@router.post(
    "/{connector_id}/sync",
    summary="Trigger a manual sync",
    description="Forces a sync cycle (Full, Incremental, or Dry Run).",
)
async def trigger_sync(connector_id: UUID, mode: SyncMode = SyncMode.DRY_RUN) -> Dict[str, Any]:
    if connector_id not in manager._registry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Connector {connector_id} not found."
        )
    
    # Fire and forget if async not awaited here immediately (so API doesn't hang)
    # For testability we await it.
    await manager.trigger_sync(connector_id, mode)
    return {"status": "ok", "message": f"Sync {mode} completed for {connector_id}."}
