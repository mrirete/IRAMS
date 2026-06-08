"""
FastAPI router for Authentication.

Endpoints:
    POST /api/v1/auth/login     -> Issues JWT
    POST /api/v1/auth/refresh   -> Refreshes JWT
    GET  /api/v1/auth/me        -> User profile info
    GET  /api/v1/auth/audit     -> (Admin) View audit trail
"""

from __future__ import annotations

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from .schemas import AuditLog, LoginRequest, RefreshRequest, Token, User, Role
from .service import (
    authenticate_ldap,
    authenticate_local_user,
    authenticate_saml,
    generate_user_tokens,
    get_user_by_username,
    get_audit_trail,
)
from .security import decode_token
from .dependencies import get_current_active_user
from .decorators import require_role

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """
    Standard OAuth2 token endpoint using x-www-form-urlencoded.
    Falls back to local authentication in this implementation.
    """
    req = LoginRequest(username=form_data.username, password=form_data.password, provider="local")
    
    # In a full deployment, this splits behavior based on environment/provider
    if req.provider == "saml":
        user = authenticate_saml(req)
    elif req.provider == "ldap":
        user = authenticate_ldap(req)
    else:
        user = authenticate_local_user(req)
        
    return generate_user_tokens(user)


@router.post("/refresh", response_model=Token)
async def refresh_token(req: RefreshRequest):
    """Consume a valid refresh token to issue a new access/refresh token pair."""
    try:
        payload = decode_token(req.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Provided token is not a refresh token"
            )
            
        username = payload.get("sub")
        user_data = get_user_by_username(username)
        if not user_data:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found"
            )
            
        return generate_user_tokens(User(**user_data))
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )


@router.get("/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    """Retrieve details about the currently authenticated user."""
    return current_user


@router.get("/audit", response_model=List[AuditLog])
async def read_audit_logs(current_user: User = Depends(get_current_active_user)):
    """
    Retrieve system audit logs.
    Restricted to Admins.
    We don't use @require_role(Role.ADMIN) here because of FastAPI's Depends behavior,
    so we check inline for simplicity in this endpoint.
    """
    if current_user.role != Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Role admin required."
        )
    return get_audit_trail()
