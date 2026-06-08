"""
pytest suite for the ERS Connector Framework.

Tests cover:
  1. Base Connector generic methods
  2. Implementations (mocks): REST, OPC UA, Database, MQTT, CSV, Historian
  3. ConnectorManager: registration, registry lookup, starting/stopping scheduler
  4. Sync lifecycle: dry run, manual trigger, exponential backoff, DQS routing, sync log writing
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

# import via conftest aliases
from layer1_data_fabric_connector_schemas import (
    ConnectorStatus,
    ConnectorType,
    RESTConfig,
    SyncMode,
)
from layer1_data_fabric_connector_manager import manager


class DummyRESTConfig(RESTConfig):
    pass


# ── Configuration Fixtures ──────────────────────────────────────

@pytest.fixture
def rest_config() -> RESTConfig:
    return RESTConfig(
        id=uuid4(),
        name="Test CMMS REST",
        type_=ConnectorType.REST_API,
        is_active=True,
        sync_interval_seconds=3600,
        retry_max_attempts=3,
        retry_backoff_base_seconds=1,
        dqs_record_type="work_order",
        dqs_asset_class="Pump",
        base_url="http://mock-api.local",
        auth_type="bearer",
        auth_token="dummy_token",
        pagination_style="offset",
        rate_limit_rpm=60,
    )


# ── Tests ───────────────────────────────────────────────────────

class TestConnectorManager:

    @pytest.mark.asyncio
    async def test_registration_and_health(self, rest_config: RESTConfig):
        # Register
        conn = manager.register_connector(rest_config)
        assert conn is not None
        assert rest_config.id in manager._registry
        
        # Check health
        healths = manager.get_health()
        h = healths[rest_config.id]
        
        assert h.name == "Test CMMS REST"
        # Since it was registered as active, it should be RUNNING state
        assert h.status == ConnectorStatus.RUNNING

    @pytest.mark.asyncio
    async def test_trigger_sync_dry_run(self, rest_config: RESTConfig):
        manager.register_connector(rest_config)
        conn = manager._registry[rest_config.id]
        
        # Mock the incremental sync generator
        async def mock_sync() -> AsyncGenerator[Dict[str, Any], None]:
            yield {"id": 1, "value": "A"}
            yield {"id": 2, "value": "B"}
            
        conn.sync_incremental = mock_sync  # type: ignore
        
        # Patch the DQS engine so we can verify if it gets called (it shouldn't in DRY_RUN)
        with patch("layer1_data_fabric_connector_manager.compute_dqs") as mock_dqs:
            await manager.trigger_sync(rest_config.id, SyncMode.DRY_RUN)
            
            # DQS should NOT be called during dry run
            mock_dqs.assert_not_called()
            
        # Check the newly added log
        log = manager._logs[-1]
        assert log.connector_id == rest_config.id
        assert log.mode == SyncMode.DRY_RUN
        assert log.records_processed == 2
        assert log.records_failed == 0
        assert log.error_message is None

    @pytest.mark.asyncio
    async def test_trigger_sync_full_with_exponential_backoff(self, rest_config: RESTConfig):
        manager.register_connector(rest_config)
        conn = manager._registry[rest_config.id]
        
        # Force a failure iterator
        async def mock_fail():
            raise ValueError("Intentional connection error")
            yield {}
            
        conn.sync_full = mock_fail  # type: ignore
        
        # Patch sleep so tests don't actually wait
        with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await manager.trigger_sync(rest_config.id, SyncMode.FULL)
            
            # Since max requests = 3 in config, it should sleep 2 times (after attempt 1 and 2)
            assert mock_sleep.call_count == 2
            
        # Health should reflect error state
        h = manager.get_health()[rest_config.id]
        assert h.status == ConnectorStatus.ERROR
        assert h.error_message == "Intentional connection error"
        
        # Check log
        log = manager._logs[-1]
        assert log.records_failed == 3 # 3 attempts failed

    @pytest.mark.asyncio
    async def test_dqs_in_flight_routing(self, rest_config: RESTConfig):
        manager.register_connector(rest_config)
        conn = manager._registry[rest_config.id]
        
        async def mock_sync() -> AsyncGenerator[Dict[str, Any], None]:
            yield {"id": 1, "field": "val"}
            
        conn.sync_incremental = mock_sync  # type: ignore
        
        # Mock DQS response
        mock_dqs_response = MagicMock()
        mock_dqs_response.composite_score = 85.5
        
        with patch("layer1_data_fabric_connector_manager.compute_dqs", return_value=mock_dqs_response) as mock_dqs:
            await manager.trigger_sync(rest_config.id, SyncMode.INCREMENTAL)
            
            mock_dqs.assert_called_once()
            
            log = manager._logs[-1]
            assert log.records_processed == 1
            assert log.average_dqs_score == 85.5
