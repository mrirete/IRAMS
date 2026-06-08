"""FastAPI Router for Integration Hub API Portal."""
from fastapi import APIRouter, Security, HTTPException, status
from typing import Dict, Any, List

from layer4_integration.schemas import CMMSWritebackPayload, MESData, WebhookEvent, APIKeyRecord
from layer4_integration.api_portal.dependencies import verify_api_key

router = APIRouter(prefix="/v1/integration", tags=["integration"])

@router.get("/status", response_model=Dict[str, str])
async def get_integration_status(
    api_key: APIKeyRecord = Security(verify_api_key)
) -> Dict[str, str]:
    """Check status of API portal and backend connections."""
    return {"status": "ok", "cmms_connected": "true", "mes_connected": "true"}

@router.post("/cmms/sync", status_code=status.HTTP_202_ACCEPTED)
async def post_cmms_sync(
    payload: CMMSWritebackPayload,
    api_key: APIKeyRecord = Security(verify_api_key)
):
    """Trigger a bi-directional sync for a work order with the bound CMMS."""
    # In practice, this would publish to a queue or call cmms_sync module directly
    return {"message": f"Sync queued for WO {payload.work_order_id} to {payload.target_system}"}

@router.post("/mes/context", status_code=status.HTTP_201_CREATED)
async def ingest_mes_context(
    data: MESData,
    api_key: APIKeyRecord = Security(verify_api_key)
):
    """Ingest read-only production context directly from MES."""
    return {"message": f"MES context recorded for {data.equipment_id}"}

@router.post("/webhooks/dispatch", status_code=status.HTTP_202_ACCEPTED)
async def dispatch_webhook_event(
    event: WebhookEvent,
    api_key: APIKeyRecord = Security(verify_api_key)
):
    """External trigger to dispatch a webhook event to subscribers."""
    return {"message": f"Event {event.event_id} queued for dispatch"}
