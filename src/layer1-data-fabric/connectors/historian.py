"""
OSIsoft PI Historian Connector wrapper.
Assumes REST API exposure via PI Web API or similar.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Dict

import httpx

from .base import BaseConnector
from .schemas import HistorianConfig


class HistorianConnector(BaseConnector):
    def __init__(self, config: HistorianConfig):
        super().__init__(config)
        self.config: HistorianConfig = config
        self.client: httpx.AsyncClient | None = None

    async def connect(self) -> None:
        self.client = httpx.AsyncClient(
            base_url=self.config.api_url,
            auth=(self.config.username, self.config.password),
            timeout=30.0,
            verify=False, # Often internal self-signed certs
        )

    async def disconnect(self) -> None:
        if self.client:
            await self.client.aclose()
            self.client = None

    async def test_connection(self) -> bool:
        if not self.client:
            await self.connect()
        try:
            # Query the root data server
            resp = await self.client.get("/dataservers")
            return resp.status_code < 400
        except Exception as e:
            self.logger.error("PI Historian Connection failed: %s", e)
            return False

    async def get_schema(self) -> Dict[str, Any]:
        """Fetch AF Elements or DataServer Points under the given prefix."""
        return {"tags_found": 0}

    async def get_field_mapping(self) -> Dict[str, str]:
        return {}

    async def sync_full(self) -> AsyncGenerator[Dict[str, Any], None]:
        # Typically not done on a historian. Real scenario uses incremental.
        # Stub yielding a sample point:
        yield {"tag": f"{self.config.tag_prefix}Pump1_Flow", "value": 1500, "timestamp": "2026-02-20T10:00:00Z"}

    async def sync_incremental(self) -> AsyncGenerator[Dict[str, Any], None]:
        if not self.client:
            await self.connect()
        # Simulated PI Web API call for /recorded values since last sync
        yield {"tag": f"{self.config.tag_prefix}Pump1_Flow", "value": 1505, "timestamp": "2026-02-20T10:05:00Z"}
