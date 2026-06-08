"""
Pydantic v2 schemas for Authentication and RBAC.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Role(str, Enum):
    VIEWER = "viewer"
    TECHNICIAN = "technician"
    PLANNER = "planner"
    ENGINEER = "engineer"
    SUPERVISOR = "supervisor"
    MANAGER = "manager"
    SAFETY_OFFICER = "safety_officer"
    ADMIN = "admin"


# Role to Governance Tier mapping mapping
ROLE_MAX_TIER = {
    Role.VIEWER: 1,
    Role.TECHNICIAN: 2,
    Role.PLANNER: 3,
    Role.ENGINEER: 3,
    Role.SUPERVISOR: 3,
    Role.MANAGER: 4,
    Role.SAFETY_OFFICER: 5,
    Role.ADMIN: 5,  # Approves everything
}

# Role hierarchy: higher index inherits lower capabilities
_ROLE_ORDER = [
    Role.VIEWER,
    Role.TECHNICIAN,
    Role.PLANNER,
    Role.ENGINEER,
    Role.SUPERVISOR,
    Role.MANAGER,
    Role.SAFETY_OFFICER,
    Role.ADMIN,
]

def role_inherits(user_role: Role, required_role: Role) -> bool:
    """Check if user_role encompasses the required_role logically.
    Note: Real implementation might have a matrix rather than strict linear,
    but we use a simplified linear/matrix approach here.
    """
    if user_role == Role.ADMIN:
        return True
    
    # Specific specialized roles matrix
    hierarchy = {
        Role.VIEWER: [Role.VIEWER],
        Role.TECHNICIAN: [Role.VIEWER, Role.TECHNICIAN],
        Role.PLANNER: [Role.VIEWER, Role.TECHNICIAN, Role.PLANNER],
        Role.ENGINEER: [Role.VIEWER, Role.TECHNICIAN, Role.PLANNER, Role.ENGINEER],
        Role.SUPERVISOR: [Role.VIEWER, Role.TECHNICIAN, Role.PLANNER, Role.ENGINEER, Role.SUPERVISOR],
        Role.MANAGER: [Role.VIEWER, Role.TECHNICIAN, Role.PLANNER, Role.ENGINEER, Role.SUPERVISOR, Role.MANAGER],
        Role.SAFETY_OFFICER: [Role.VIEWER, Role.SAFETY_OFFICER], # Safety is parallel
    }
    
    return required_role in hierarchy.get(user_role, [])


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenPayload(BaseModel):
    sub: str  # username or id
    role: Role
    exp: int


class LoginRequest(BaseModel):
    username: str
    password: str
    provider: str = "local"  # local, ldap, saml, oauth2


class RefreshRequest(BaseModel):
    refresh_token: str


class User(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID
    username: str
    email: str
    full_name: str
    role: Role
    is_active: bool = True
    mfa_enabled: bool = False
    departments: List[str] = Field(default_factory=list)


class AuditLog(BaseModel):
    """Immutable audit trail entry."""
    audit_id: UUID
    timestamp: datetime
    user_id: UUID
    username: str
    action: str
    entity_type: str
    entity_id: str
    governance_tier: int
    changes: Dict[str, Any]
    ip_address: Optional[str] = None
