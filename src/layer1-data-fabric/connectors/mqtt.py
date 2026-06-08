"""
MQTT Connector via aiomqtt.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Dict
import json

import aiomqtt
from aiomqtt.error import MqttError

from .base import BaseConnector
from .schemas import MQTTConfig


class MQTTConnector(BaseConnector):
    def __init__(self, config: MQTTConfig):
        super().__init__(config)
        self.config: MQTTConfig = config
        self.client: aiomqtt.Client | None = None
        self._message_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        self._listener_task: asyncio.Task | None = None

    async def connect(self) -> None:
        self.client = aiomqtt.Client(
            hostname=self.config.broker_url,
            port=self.config.port,
            username=self.config.username,
            password=self.config.password,
            client_id=self.config.client_id,
        )
        await self.client.connect()
        # Start background listener
        self._listener_task = asyncio.create_task(self._listen())

    async def _listen(self) -> None:
        try:
            await self.client.subscribe(self.config.topic, qos=self.config.qos)
            async for message in self.client.messages:
                try:
                    payload = json.loads(message.payload.decode())
                    await self._message_queue.put({
                        "topic": message.topic.value,
                        "payload": payload,
                    })
                except json.JSONDecodeError:
                    self.logger.warning("Failed to decode MQTT message payload on topic %s", message.topic)
        except MqttError as e:
            self.logger.error("MQTT listener failed: %s", e)

    async def disconnect(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
        if self.client:
            await self.client.disconnect()
            self.client = None

    async def test_connection(self) -> bool:
        try:
            # Temporary single connection for test
            async with aiomqtt.Client(
                hostname=self.config.broker_url,
                port=self.config.port,
                username=self.config.username,
                password=self.config.password,
                timeout=5.0,
            ) as client:
                return True
        except Exception as e:
            self.logger.error("MQTT Connection failed: %s", e)
            return False

    async def get_schema(self) -> Dict[str, Any]:
        return {"source": "mqtt_stream"}

    async def get_field_mapping(self) -> Dict[str, str]:
        return {}

    async def sync_full(self) -> AsyncGenerator[Dict[str, Any], None]:
        # MQTT is continuous. Yield whatever is in queue.
        if not self.client:
            await self.connect()
        
        while not self._message_queue.empty():
            msg = await self._message_queue.get()
            yield msg

    async def sync_incremental(self) -> AsyncGenerator[Dict[str, Any], None]:
        # Streams are naturally incremental
        async for r in self.sync_full():
            yield r
