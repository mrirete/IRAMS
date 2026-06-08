"""
pytest suite for the ERS Auth, RBAC, and Governance module.

Tests cover:
  1. Login & Token generation (access & refresh)
  2. Token parsing and validation (expiry, signature)
  3. Role inheritance mapping
  4. Decorators: @require_role, @require_governance_approval
  5. Cross-role denial
  6. @audit decorator completeness
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch
import pytest
from fastapi import HTTPException

# Using conftest aliases
from shared_auth_schemas import Role, role_inherits, LoginRequest, RefreshRequest
from shared_auth_security import create_access_token, decode_token, verify_password, get_password_hash
from shared_auth_service import authenticate_local_user, generate_user_tokens, get_audit_trail
from shared_auth_decorators import require_role, require_governance_approval, audit
from shared_auth_dependencies import get_current_user


def test_password_hashing():
    plain = "hunter2"
    hashed = get_password_hash(plain)
    assert verify_password(plain, hashed)
    assert not verify_password("wrong", hashed)


class TestRolesAndGovernance:
    def test_role_inheritance_hierarchy(self):
        # Admin inherits everything
        assert role_inherits(Role.ADMIN, Role.VIEWER)
        assert role_inherits(Role.ADMIN, Role.MANAGER)
        
        # Planner hierarchy
        assert role_inherits(Role.PLANNER, Role.VIEWER)
        assert role_inherits(Role.PLANNER, Role.TECHNICIAN)
        assert role_inherits(Role.PLANNER, Role.PLANNER)
        
        # Cross-role denial
        assert not role_inherits(Role.TECHNICIAN, Role.PLANNER)
        assert not role_inherits(Role.PLANNER, Role.MANAGER)
        assert not role_inherits(Role.SAFETY_OFFICER, Role.PLANNER)

    @pytest.mark.asyncio
    async def test_require_role_decorator_allow(self):
        @require_role(Role.TECHNICIAN)
        def my_endpoint(current_user):
            return "success"
            
        class MockUser:
            role = Role.PLANNER # Planner inherits Technician
            
        assert my_endpoint(current_user=MockUser()) == "success"

    @pytest.mark.asyncio
    async def test_require_role_decorator_deny(self):
        @require_role(Role.MANAGER)
        def my_endpoint(current_user):
            return "success"
            
        class MockUser:
            role = Role.TECHNICIAN
            
        with pytest.raises(HTTPException) as exc:
            my_endpoint(current_user=MockUser())
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_require_governance_approval_tier(self):
        @require_governance_approval(tier=3)
        def gov_action(current_user):
            return "approved"
            
        class T2User:
            role = Role.TECHNICIAN
            
        class T3User:
            role = Role.PLANNER
            
        assert gov_action(current_user=T3User()) == "approved"
        
        with pytest.raises(HTTPException) as exc:
            gov_action(current_user=T2User())
        assert exc.value.status_code == 403


class TestLoginAndTokens:
    def test_local_login_success(self):
        req = LoginRequest(username="admin", password="password")
        user = authenticate_local_user(req)
        assert user.role == Role.ADMIN
        
        tokens = generate_user_tokens(user)
        assert tokens.access_token
        assert tokens.refresh_token

    def test_local_login_failure(self):
        req = LoginRequest(username="admin", password="wrongpassword")
        with pytest.raises(HTTPException) as exc:
            authenticate_local_user(req)
        assert exc.value.status_code == 401
        
    def test_token_expiration(self):
        # Create token expiring in the past
        past_delta = timedelta(minutes=-10)
        token = create_access_token({"sub": "admin"}, expires_delta=past_delta)
        
        with pytest.raises(ValueError, match="Invalid token"):
            decode_token(token)

    @pytest.mark.asyncio
    async def test_get_current_user_dependency(self):
        req = LoginRequest(username="tech1", password="password")
        user = authenticate_local_user(req)
        tokens = generate_user_tokens(user)
        
        fetched_user = await get_current_user(token=tokens.access_token)
        assert fetched_user.username == "tech1"
        assert fetched_user.role == Role.TECHNICIAN


class TestAuditLogging:
    @pytest.mark.asyncio
    async def test_audit_decorator_captures_action(self):
        @audit(tier=2, entity_type="work_order")
        def create_wo(data, current_user):
            return {"id": "wo-1234", "status": "draft"}
            
        class MockUser:
            id = "22222222-2222-2222-2222-222222222222"
            username = "tech1"
            
        # Get start count
        initial_logs = len(get_audit_trail())
        
        # Trigger
        result = create_wo({"desc": "Fix pump"}, current_user=MockUser())
        assert result["id"] == "wo-1234"
        
        # Verify log appended
        logs = get_audit_trail()
        assert len(logs) == initial_logs + 1
        
        last_log = logs[-1]
        assert last_log.username == "tech1"
        assert last_log.action == "create_wo"
        assert last_log.entity_type == "work_order"
        assert last_log.entity_id == "wo-1234"
        assert last_log.governance_tier == 2
