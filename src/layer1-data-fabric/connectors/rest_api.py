"""
REST API Connector Implementation.
Configurable auth, pagination, and rate limiting.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Dict

import httpx

from .base import BaseConnector
from .schemas import RESTConfig


class RESTConnector(BaseConnector):
    def __init__(self, config: RESTConfig):
        super().__init__(config)
        self.config: RESTConfig = config
        self.client: httpx.AsyncClient | None = None
        # Simple token bucket rate limiting delay
        self._delay_seconds = 60.0 / max(1, self.config.rate_limit_rpm)

    async def connect(self) -> None:
        headers = {}
        if self.config.auth_type == "bearer" and self.config.auth_token:
            headers["Authorization"] = f"Bearer {self.config.auth_token}"
        elif self.config.auth_type == "basic":
            auth = (self.config.auth_user, self.config.auth_pass) if self.config.auth_user else None
        
        self.client = httpx.AsyncClient(
            base_url=self.config.base_url,
            headers=headers,
            auth=auth if self.config.auth_type == "basic" else None,
            timeout=30.0,
        )

    async def disconnect(self) -> None:
        if self.client:
            await self.client.aclose()
            self.client = None

    async def test_connection(self) -> bool:
        if not self.client:
            await self.connect()
        try:
            # Assumes health check logic or base ping
            resp = await self.client.get("/")
            return resp.status_code < 400
        except Exception as e:
            self.logger.error("Connection test failed: %s", e)
            return False

    async def get_schema(self) -> Dict[str, Any]:
        return {"source": "rest_api", "schema": "dynamic"}

    async def get_field_mapping(self) -> Dict[str, str]:
        return {}  # To be configured via UX

    async def _fetch_paginated(self, path: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        if not self.client:
            await self.connect()

        offset = 0
        limit = 100
        has_more = True

        while has_more:
            await asyncio.sleep(self._delay_seconds)  # Apply rate limit
            current_params = params.copy()
            if self.config.pagination_style == "offset":
                current_params.update({"offset": offset, "limit": limit})
            
            resp = await self.client.get(path, params=current_params)
            resp.raise_for_status()
            data = resp.json()
            
            # Assuming array response or {"data": []}
            records = data.get("data", data) if isinstance(data, dict) else data
            
            if not records or not isinstance(records, list):
                has_more = False
                break
                
            for rec in records:
                yield rec
                
            offset += limit
            if len(records) < limit:
                has_more = False

    async def sync_full(self) -> AsyncGenerator[Dict[str, Any], None]:
        async for record in self._fetch_paginated("/records", {}):
            yield record

    async def sync_incremental(self) -> AsyncGenerator[Dict[str, Any], None]:
        # Typically requires a 'since' parameter saved in watermark 
        # (Stub implementation)
        params = {"updated_since": "last_run"}
        async for record in self._fetch_paginated("/records", params):
            yield record
