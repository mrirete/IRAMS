"""
FastAPI Dependencies for Auth.
Extracts JWT from Request header, validates, and resolves the current user.
Supports DUAL JWT strategies:
  1. Internal HS256 JWT (legacy backend auth)
  2. Supabase JWT (frontend Supabase Auth — production path)
"""

from __future__ import annotations

import logging
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from .schemas import User, Role
from .security import SECRET_KEY, ALGORITHM
from .service import get_user_by_username

logger = logging.getLogger("ers.auth.dependencies")

# OAuth2 scheme declaration. The tokenUrl matches our login endpoint.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# ── Supabase JWT Configuration ──────────────────────────────
# Supabase signs JWTs with the project's JWT secret (HS256).
# Set SUPABASE_JWT_SECRET in Railway environment variables.
# Fallback: use the Supabase anon key for basic verification.
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")


def _try_decode_supabase_jwt(token: str) -> dict | None:
    """
    Attempt to decode a Supabase-issued JWT.
    Returns the payload dict on success, None on failure.
    """
    if not SUPABASE_JWT_SECRET:
        return None
    try:
        payload = jwt.decode(
            token, SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},  # Supabase JWTs use 'authenticated' audience
        )
        return payload
    except JWTError:
        return None


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    """
    Dependency for all protected endpoints.
    Strategy:
      1. Try internal JWT decode (legacy backend auth)
      2. Fall back to Supabase JWT decode (production frontend auth)
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # ── Strategy 1: Internal JWT ─────────────────────────────
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise JWTError("Missing sub claim")
            
        token_type: str = payload.get("type", "access")
        if token_type != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Provided token is a refresh token, access token expected."
            )
        
        user_data = get_user_by_username(username)
        if user_data is None:
            raise JWTError("User not found in internal DB")
            
        return User(**user_data)
        
    except (JWTError, HTTPException):
        pass  # Fall through to Strategy 2
    
    # ── Strategy 2: Supabase JWT ─────────────────────────────
    supabase_payload = _try_decode_supabase_jwt(token)
    if supabase_payload:
        # Extract user info from Supabase JWT claims
        sub = supabase_payload.get("sub", "")  # Supabase user UUID
        email = supabase_payload.get("email", "")
        role_claim = supabase_payload.get("role", "authenticated")
        
        if not sub:
            raise credentials_exception
        
        # Derive username from email (matches AuthContext.tsx pattern)
        username = email.split("@")[0] if email else sub[:8]
        
        # Map Supabase role to ERS Role (default to TECHNICIAN for authenticated users)
        role_map = {
            "service_role": Role.ADMIN,
            "authenticated": Role.TECHNICIAN,
            "anon": Role.VIEWER,
        }
        ers_role = role_map.get(role_claim, Role.TECHNICIAN)
        
        logger.info("Supabase JWT auth: user=%s email=%s role=%s", username, email, ers_role.value)
        
        return User(
            id=sub,
            username=username,
            email=email,
            full_name=email.split("@")[0] if email else username,
            role=ers_role,
            is_active=True,
            departments=["*"],  # Supabase users get global scope (scoped by RLS)
        )
    
    # Both strategies failed
    raise credentials_exception


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

