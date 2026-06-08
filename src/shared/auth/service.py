"""
Auth Service.
Handles local login, token refresh, external provider stubs, and audit logging.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status

from .schemas import AuditLog, Role, Token, User, LoginRequest
from .security import create_access_token, create_refresh_token, verify_password

logger = logging.getLogger("ers.auth.service")


# ── In-Memory Stub Database ──────────────────────────────────
# Mocks user records for development.

_users_db = {
    "admin": {
        "id": "11111111-1111-1111-1111-111111111111",
        "username": "admin",
        "email": "admin@ers.internal",
        "full_name": "System Administrator",
        "role": Role.ADMIN,
        "is_active": True,
        "hashed_password": "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW", # "password"
        "departments": ["IT", "Management"],
    },
    "tech1": {
        "id": "22222222-2222-2222-2222-222222222222",
        "username": "tech1",
        "email": "tech1@ers.internal",
        "full_name": "Field Technician",
        "role": Role.TECHNICIAN,
        "is_active": True,
        "hashed_password": "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",
        "departments": ["Maintenance"],
    },
    "planner1": {
        "id": "33333333-3333-3333-3333-333333333333",
        "username": "planner1",
        "email": "planner1@ers.internal",
        "full_name": "Maintenance Planner",
        "role": Role.PLANNER,
        "is_active": True,
        "hashed_password": "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW",
        "departments": ["Planning"],
    },
}

_audit_logs: list[AuditLog] = []


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    return _users_db.get(username)


def authenticate_local_user(req: LoginRequest) -> User:
    """Local database fallback authentication."""
    user_data = get_user_by_username(req.username)
    if not user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    
    if not verify_password(req.password, user_data["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
        
    if not user_data["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )

    return User(**user_data)


def authenticate_saml(req: LoginRequest) -> User:
    """Stub for Enterprise SAML 2.0 integration."""
    logger.info("SAML authentication stub called for %s", req.username)
    # 1. Decode SAML Assertion
    # 2. Validate Signature & Issuer
    # 3. Map Groups to ERS Roles
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="SAML identity provider not configured",
    )


def authenticate_ldap(req: LoginRequest) -> User:
    """Stub for LDAP / Active Directory integration."""
    logger.info("LDAP authentication stub called for %s", req.username)
    # 1. Bind to LDAP server
    # 2. Search user
    # 3. Authenticate with credentials
    # 4. Map AD memberOf to Roles
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="LDAP provider not configured",
    )


def generate_user_tokens(user: User) -> Token:
    """Issue a new JWT access and refresh token pair."""
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value}
    )
    refresh_token = create_refresh_token(
        data={"sub": user.username}
    )
    
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=1800,  # 30 minutes
    )


async def write_audit_log(
    user_id: UUID, 
    username: str, 
    action: str, 
    entity_type: str, 
    entity_id: str, 
    governance_tier: int, 
    changes: Dict[str, Any],
) -> None:
    """
    Immutable audit trail appending.
    Complies with strict EAM governance requirements.
    """
    log = AuditLog(
        audit_id=uuid4(),
        timestamp=datetime.now(tz=timezone.utc),
        user_id=user_id,
        username=username,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        governance_tier=governance_tier,
        changes=changes,
        ip_address=None # Would capture from Request context in real app
    )
    _audit_logs.append(log)
    logger.info(
        "AUDIT: User %s performed %s on %s:%s (Tier %s)", 
        username, action, entity_type, entity_id, governance_tier
    )

def get_audit_trail() -> list[AuditLog]:
    return _audit_logs
