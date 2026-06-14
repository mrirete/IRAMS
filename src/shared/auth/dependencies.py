"""
FastAPI Dependencies for Auth.
Extracts JWT from Request header, validates, and resolves the current user.
Supports THREE JWT validation strategies (tried in order):
  1. Internal HS256 JWT (legacy backend auth)
  2. Supabase JWT decode via SUPABASE_JWT_SECRET (if configured)
  3. Supabase Auth API call — validate token by calling /auth/v1/user (bulletproof fallback)
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

# ── Supabase Configuration ──────────────────────────────────
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://hacrebcfvyqdnjvilhqc.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def _try_decode_supabase_jwt(token: str) -> dict | None:
    """
    Strategy 2: Decode Supabase JWT using the project's JWT secret (HS256).
    Returns the payload dict on success, None on failure.
    """
    if not SUPABASE_JWT_SECRET:
        return None
    try:
        payload = jwt.decode(
            token, SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        return payload
    except JWTError as e:
        logger.debug("Supabase JWT secret decode failed: %s", e)
        return None


def _try_supabase_api_verify(token: str) -> dict | None:
    """
    Strategy 3: Validate the Supabase access token by calling Supabase's
    /auth/v1/user endpoint. The token itself is the credential — if Supabase
    returns user data, the token is valid.
    
    This is the bulletproof fallback: no JWT secret needed, no copy-paste errors.
    """
    import urllib.request
    import json

    url = f"{SUPABASE_URL}/auth/v1/user"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("apikey", SUPABASE_SERVICE_KEY or _get_anon_key())

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 200:
                user_data = json.loads(resp.read().decode())
                # Map to the same format as JWT payload
                return {
                    "sub": user_data.get("id", ""),
                    "email": user_data.get("email", ""),
                    "role": user_data.get("role", "authenticated"),
                    "aud": user_data.get("aud", "authenticated"),
                }
    except Exception as e:
        logger.debug("Supabase API verify failed: %s", e)
    
    return None


def _get_anon_key() -> str:
    """Get the Supabase anon key from env, used as apikey header for auth calls."""
    return os.environ.get(
        "SUPABASE_ANON_KEY",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0"
    )


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    """
    Dependency for all protected endpoints.
    Strategy chain:
      1. Try internal JWT decode (legacy backend auth)
      2. Try Supabase JWT decode via secret (if SUPABASE_JWT_SECRET is set)
      3. Try Supabase Auth API call (bulletproof fallback — no secret needed)
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
    
    # ── Strategy 2: Supabase JWT (via secret) ────────────────
    supabase_payload = _try_decode_supabase_jwt(token)
    
    # ── Strategy 3: Supabase API verify (no secret needed) ───
    if not supabase_payload:
        logger.info("JWT secret decode failed or not configured, trying Supabase API verify...")
        supabase_payload = _try_supabase_api_verify(token)
    
    if supabase_payload:
        # Extract user info from Supabase JWT/API claims
        sub = supabase_payload.get("sub", "")
        email = supabase_payload.get("email", "")
        role_claim = supabase_payload.get("role", "authenticated")
        
        if not sub:
            raise credentials_exception
        
        # Derive username from email (matches AuthContext.tsx pattern)
        username = email.split("@")[0] if email else sub[:8]
        
        # Map Supabase role to ERS Role
        role_map = {
            "service_role": Role.ADMIN,
            "authenticated": Role.TECHNICIAN,
            "anon": Role.VIEWER,
        }
        ers_role = role_map.get(role_claim, Role.TECHNICIAN)
        
        logger.info("Supabase auth OK: user=%s email=%s role=%s", username, email, ers_role.value)
        
        return User(
            id=sub,
            username=username,
            email=email,
            full_name=email.split("@")[0] if email else username,
            role=ers_role,
            is_active=True,
            departments=["*"],
        )
    
    # All three strategies failed
    logger.warning("All auth strategies failed for token: %s...", token[:20])
    raise credentials_exception


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


