"""
OPC UA Connector using asyncua.
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Dict

from asyncua import Client
from asyncua.ua import UaError

from .base import BaseConnector
from .schemas import OPCUAConfig


class OPCUAConnector(BaseConnector):
    def __init__(self, config: OPCUAConfig):
        super().__init__(config)
        self.config: OPCUAConfig = config
        self.client: Client | None = None

    async def connect(self) -> None:
        self.client = Client(url=self.config.endpoint_url)
        if self.config.username:
            self.client.set_user(self.config.username)
        if self.config.password:
            self.client.set_password(self.config.password)
        await self.client.connect()

    async def disconnect(self) -> None:
        if self.client:
            await self.client.disconnect()
            self.client = None

    async def test_connection(self) -> bool:
        try:
            if not self.client:
                await self.connect()
            node = self.client.get_node(self.config.root_node_id)
            await node.read_browse_name()
            return True
        except Exception as e:
            self.logger.error("OPC UA Connection failed: %s", e)
            return False

    async def get_schema(self) -> Dict[str, Any]:
        """Browse node tree to build schema dynamically."""
        if not self.client:
            await self.connect()
        # Simplified stub
        return {"nodes_mapped": 0}

    async def get_field_mapping(self) -> Dict[str, str]:
        return {}

    async def sync_full(self) -> AsyncGenerator[Dict[str, Any], None]:
        # Typical OPC UA is pub/sub or specific poll. Full sync reads all mapped nodes.
        if not self.client:
            await self.connect()
        # Stub: yielding a dummy node reading
        root = self.client.get_node(self.config.root_node_id)
        val = await root.read_value()
        yield {"node_id": self.config.root_node_id, "value": val}

    async def sync_incremental(self) -> AsyncGenerator[Dict[str, Any], None]:
        # Historical read implementation goes here
        async for r in self.sync_full():
            yield r
