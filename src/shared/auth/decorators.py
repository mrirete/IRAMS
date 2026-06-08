"""
Auth and Governance Decorators.

These wrap FastAPI endpoints or internal service functions to enforce
RBAC and Governance Tier approvals, and automatically write to the audit trail.
"""

from __future__ import annotations

import functools
import inspect
from datetime import datetime, timezone
from typing import Any, Callable, Dict
from uuid import uuid4

from fastapi import HTTPException, status, Request

from .schemas import ROLE_MAX_TIER, Role, role_inherits
from .service import write_audit_log


def require_role(min_role: Role):
    """
    Decorator to ensure the current user inherits the required role.
    Assumes the wrapped function has a 'current_user' kwarg injected by FastAPI.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            user = kwargs.get("current_user")
            if not user:
                # If wrapped around a non-endpoint without injection, try to find it
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required",
                )
            
            if not role_inherits(user.role, min_role):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Role {min_role.value} or higher required. User has {user.role.value}.",
                )
            
            # Execute original function
            if inspect.iscoroutinefunction(func):
                return await func(*args, **kwargs)
            else:
                return func(*args, **kwargs)
        return wrapper
    return decorator


def audit(tier: int = 1, entity_type: str = "generic"):
    """
    Decorator to automatically write an audit trail for state changes.
    Intercepts the response and extracts 'id' or uses kwargs.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            user = kwargs.get("current_user")
            
            # Execute original function first
            if inspect.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                result = func(*args, **kwargs)
                
            # Try to figure out entity ID
            entity_id = "unknown"
            if isinstance(result, dict) and "id" in result:
                entity_id = str(result["id"])
            elif hasattr(result, "id"):
                entity_id = str(result.id)
            elif "id" in kwargs:
                entity_id = str(kwargs["id"])

            if user:
                await write_audit_log(
                    user_id=user.id,
                    username=user.username,
                    action=func.__name__,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    governance_tier=tier,
                    changes={"payload": "Data payload hidden in generic interceptor"},
                )
            return result
        return wrapper
    return decorator


def require_governance_approval(tier: int):
    """
    Decorator enforcing that the user's role satisfies the governance tier.
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            user = kwargs.get("current_user")
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required",
                )
                
            user_tier = ROLE_MAX_TIER.get(user.role, 1)
            if user_tier < tier:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"Action requires Governance Tier {tier}. "
                        f"Your role ({user.role.value}) is Tier {user_tier}."
                    )
                )
            
            if inspect.iscoroutinefunction(func):
                return await func(*args, **kwargs)
            else:
                return func(*args, **kwargs)
        return wrapper
    return decorator
