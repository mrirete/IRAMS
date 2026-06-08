"""Tests for Layer 4 Integration Hub."""
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from fastapi import FastAPI, Depends

from layer4_integration.schemas import CMMSMapping, CMMSWritebackPayload, WebhookSubscription, WebhookEvent, APIKeyRecord
from layer4_integration.cmms_writeback.sync_service import CMMSSyncService
from layer4_integration.api_portal.router import router
from layer4_integration.webhooks.dispatcher import WebhookDispatcher

# Mock App setup
app = FastAPI()
app.include_router(router)
client = TestClient(app)

def test_cmms_payload_transformation():
    mappings = [
        CMMSMapping(internal_field="status", cmms_field="WO_STATUS"),
        CMMSMapping(internal_field="priority", cmms_field="WO_PRIORITY"),
    ]
    service = CMMSSyncService(mappings=mappings)
    
    internal_data = {
        "status": "APPROVED",
        "priority": "HIGH",
        "unmapped_field": "ignore_me"
    }
    
    transformed = service._transform_payload(internal_data)
    
    assert "WO_STATUS" in transformed
    assert transformed["WO_STATUS"] == "APPROVED"
    assert "WO_PRIORITY" in transformed
    assert transformed["WO_PRIORITY"] == "HIGH"
    assert "unmapped_field" not in transformed

def test_cmms_writeback_validation():
    # Test valid Tier 3 signature parsing using Pydantic
    payload = CMMSWritebackPayload(
        work_order_id="WO-101",
        target_system="SAP",
        tier_3_approved_by="jdoe_admin",
        tier_3_approved_at=datetime.now(timezone.utc),
        payload_data={"status": "CLOSED"}
    )
    assert payload.target_system == "SAP"

def test_webhook_dispatcher():
    import asyncio
    async def run_test():
        subs = [
            WebhookSubscription(
                subscription_id="sub1",
                target_url="http://mock-url.local",
                event_types=["alert", "wo_update"]
            )
        ]
        dispatcher = WebhookDispatcher(subscriptions=subs)
        
        event = WebhookEvent(
            event_id="evt_123",
            event_type="alert",
            timestamp=datetime.now(timezone.utc),
            payload={"message": "High Vibration"}
        )
        
        event_mismatch = WebhookEvent(
            event_id="evt_124",
            event_type="twin_drift",
            timestamp=datetime.now(timezone.utc),
            payload={}
        )
        
        result = await dispatcher._dispatch_to_subscriber(subs[0], event_mismatch)
        assert result is False
        
        await dispatcher.close()
        
    asyncio.run(run_test())

def test_api_portal_auth_rejected():
    response = client.get("/v1/integration/status", headers={"X-API-Key": "invalid_key"})
    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid or inactive API Key"

def test_api_portal_auth_accepted():
    response = client.get("/v1/integration/status", headers={"X-API-Key": "test-dev-key"})
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

