"""Schemas for Layer 4 Integration Hub."""
from datetime import datetime
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field

# -----------------------------------------------------------------------------
# CMMS Write-back Mapping
# -----------------------------------------------------------------------------
class CMMSMapping(BaseModel):
    internal_field: str
    cmms_field: str
    transform_logic: Optional[str] = None
    
class CMMSWritebackPayload(BaseModel):
    work_order_id: str
    target_system: str = Field(description="e.g., SAP, Maximo")
    tier_3_approved_by: str = Field(description="Username of the approver (Human-in-the-Loop Tier 3)")
    tier_3_approved_at: datetime
    payload_data: Dict[str, Any]

# -----------------------------------------------------------------------------
# MES Data Exchange
# -----------------------------------------------------------------------------
class MESData(BaseModel):
    equipment_id: str
    timestamp: datetime
    run_hours: Optional[float] = None
    operational_status: Optional[str] = "RUNNING"
    production_yield: Optional[float] = None
    context_data: Dict[str, Any] = Field(default_factory=dict)

# -----------------------------------------------------------------------------
# Webhooks
# -----------------------------------------------------------------------------
class WebhookEvent(BaseModel):
    event_id: str
    event_type: str = Field(description="Event category: alert, wo_update, prediction, approval, twin_drift")
    timestamp: datetime
    payload: Dict[str, Any]

class WebhookSubscription(BaseModel):
    subscription_id: str
    target_url: str
    event_types: List[str]
    headers: Optional[Dict[str, str]] = None
    active: bool = True

# -----------------------------------------------------------------------------
# API Developer Portal
# -----------------------------------------------------------------------------
class APIKeyRecord(BaseModel):
    key_id: str
    hashed_key: str
    owner: str
    rate_limit_rpm: int = Field(default=60, description="Requests per minute rate limit")
    active: bool = True
    expires_at: Optional[datetime] = None
