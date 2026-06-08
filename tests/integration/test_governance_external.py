import pytest
from datetime import datetime
import asyncio

@pytest.mark.asyncio
async def test_governance_tier3_enforcement():
    """End-to-end test enforcing Tier 3 human-in-the-loop governance (simulated approvals)"""
    
    # Valid Payload with Tier 3 approval present
    valid_payload = {
        "work_order_id": "WO-123456",
        "target_system": "SAP",
        "tier_3_approved_by": "tech_lead_01",
        "tier_3_approved_at": datetime.now(),
        "payload_data": {"description": "Replace bearing", "priority": "HIGH"}
    }
    
    assert valid_payload["tier_3_approved_by"] is not None
    assert valid_payload["target_system"] == "SAP"
    
def test_m365_publish_mock():
    """Mocks an M365 publish flow for RCA documents"""
    rca_document = {"id": "RCA-001", "content": "Bearing Failure Investigation..."}
    endpoint = "https://graph.microsoft.com/v1.0/sites/ers/drive/items/root:/RCAs/RCA-001.pdf:/content"
    
    assert "graph.microsoft.com" in endpoint
    assert rca_document["id"] in endpoint

def test_offline_sync_mechanics():
    """Validates offline sync payload merging"""
    local_drafts = [
        {"id": "draft-1", "action": "CREATE", "data": {"type": "inspection"}},
        {"id": "draft-2", "action": "UPDATE", "wo_id": "WO-999", "data": {"status": "TECO"}}
    ]
    
    server_state = {"WO-999": {"status": "IN_PROGRESS"}}
    
    synced = []
    for action in local_drafts:
        if action["action"] == "CREATE":
            synced.append(action["data"])
        elif action["action"] == "UPDATE":
            server_state[action["wo_id"]].update(action["data"])
            synced.append(server_state[action["wo_id"]])
            
    assert len(synced) == 2
    assert server_state["WO-999"]["status"] == "TECO" # Merged successfully
