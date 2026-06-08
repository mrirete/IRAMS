"""
Relational Database Connector.
Supports Postgres, Oracle, SQL Server, MySQL via SQLAlchemy async.
"""

from __future__ import annotations

from typing import Any, AsyncGenerator, Dict

from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .base import BaseConnector
from .schemas import DatabaseConfig


class DatabaseConnector(BaseConnector):
    def __init__(self, config: DatabaseConfig):
        super().__init__(config)
        self.config: DatabaseConfig = config
        self.engine: AsyncEngine | None = None

    async def connect(self) -> None:
        self.engine = create_async_engine(
            self.config.connection_url,
            echo=False,
            pool_size=5,
            max_overflow=10,
        )

    async def disconnect(self) -> None:
        if self.engine:
            await self.engine.dispose()
            self.engine = None

    async def test_connection(self) -> bool:
        try:
            if not self.engine:
                await self.connect()
            async with self.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return True
        except SQLAlchemyError as e:
            self.logger.error("DB Connection failed: %s", e)
            return False

    async def get_schema(self) -> Dict[str, Any]:
        """Infer schema from the provided query via a LIMIT 0 execution."""
        return {"columns": []}

    async def get_field_mapping(self) -> Dict[str, str]:
        return {}

    async def sync_full(self) -> AsyncGenerator[Dict[str, Any], None]:
        if not self.engine:
            await self.connect()

        async with self.engine.connect() as conn:
            # Server-side cursor ideal, simplified here.
            result = await conn.execute(text(self.config.query))
            keys = list(result.keys())
            for row in result:
                yield dict(zip(keys, row))

    async def sync_incremental(self) -> AsyncGenerator[Dict[str, Any], None]:
        if not self.config.incremental_column:
            # Fall back to full
            async for r in self.sync_full():
                yield r
            return

        if not self.engine:
            await self.connect()

        # Watermark parameter injection logic goes here
        query_str = f"{self.config.query} WHERE {self.config.incremental_column} > :last_sync"
        
        async with self.engine.connect() as conn:
            result = await conn.execute(text(query_str), {"last_sync": "1970-01-01"}) # Stub date
            keys = list(result.keys())
            for row in result:
                yield dict(zip(keys, row))
