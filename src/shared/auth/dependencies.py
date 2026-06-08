"""
FastAPI Dependencies for Auth.
Extracts JWT from Request header, validates, and resolves the current user.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from .schemas import User, Role
from .security import SECRET_KEY, ALGORITHM
from .service import get_user_by_username

# OAuth2 scheme declaration. The tokenUrl matches our login endpoint.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    """
    Dependency intended for all protected endpoints.
    Verifies JWT signature, expiration, and loads the user object.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
            
        token_type: str = payload.get("type", "access")
        if token_type != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Provided token is a refresh token, access token expected."
            )
            
    except JWTError:
        raise credentials_exception
        
    user_data = get_user_by_username(username)
    if user_data is None:
        raise credentials_exception
        
    return User(**user_data)


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user
