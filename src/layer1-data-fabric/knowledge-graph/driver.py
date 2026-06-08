"""
Neo4j driver / connection manager for the ERS Knowledge Graph.

All connections are pooled via the official neo4j Python driver.
Connection parameters are read from env vars:
    NEO4J_URI        (default: bolt://localhost:7687)
    NEO4J_USER       (default: neo4j)
    NEO4J_PASSWORD   (required)
    NEO4J_DATABASE   (default: neo4j)
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Dict, List, Optional

from neo4j import AsyncGraphDatabase, AsyncDriver, AsyncSession

logger = logging.getLogger("ers.knowledge_graph")

_driver: Optional[AsyncDriver] = None


def _get_env(key: str, default: Optional[str] = None) -> str:
    val = os.environ.get(key, default)
    if val is None:
        raise RuntimeError(f"Environment variable {key} is required")
    return val


async def init_driver() -> AsyncDriver:
    """Create and verify the async Neo4j driver singleton."""
    global _driver
    if _driver is not None:
        return _driver

    uri = _get_env("NEO4J_URI", "bolt://localhost:7687")
    user = _get_env("NEO4J_USER", "neo4j")
    password = _get_env("NEO4J_PASSWORD", "neo4j")

    _driver = AsyncGraphDatabase.driver(uri, auth=(user, password))
    await _driver.verify_connectivity()
    logger.info("Neo4j driver connected to %s", uri)
    return _driver


async def close_driver() -> None:
    global _driver
    if _driver:
        await _driver.close()
        _driver = None
        logger.info("Neo4j driver closed")


def get_driver() -> AsyncDriver:
    if _driver is None:
        raise RuntimeError("Neo4j driver not initialised — call init_driver() first")
    return _driver


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a transactional Neo4j session."""
    db = os.environ.get("NEO4J_DATABASE", "neo4j")
    driver = get_driver()
    session = driver.session(database=db)
    try:
        yield session
    finally:
        await session.close()


async def run_cypher(
    query: str,
    params: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Execute a Cypher query and return list-of-dict results."""
    async with get_session() as session:
        result = await session.run(query, parameters=params or {})
        records = [record.data() async for record in result]
        return records


# ── Schema bootstrap ───────────────────────────────────────────

CONSTRAINTS_AND_INDEXES = [
    # Uniqueness constraints
    "CREATE CONSTRAINT IF NOT EXISTS FOR (a:Asset) REQUIRE a.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (f:FailureMode) REQUIRE f.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (c:Cause) REQUIRE c.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (comp:Competency) REQUIRE comp.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (s:StandardClause) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (k:KPI) REQUIRE k.id IS UNIQUE",
    "CREATE CONSTRAINT IF NOT EXISTS FOR (d:Department) REQUIRE d.id IS UNIQUE",
    # Composite indexes for frequent lookups
    "CREATE INDEX IF NOT EXISTS FOR (a:Asset) ON (a.criticality)",
    "CREATE INDEX IF NOT EXISTS FOR (a:Asset) ON (a.location)",
    "CREATE INDEX IF NOT EXISTS FOR (k:KPI) ON (k.smrp_pillar)",
]


async def bootstrap_schema() -> None:
    """Ensure all constraints and indexes exist in Neo4j."""
    async with get_session() as session:
        for stmt in CONSTRAINTS_AND_INDEXES:
            await session.run(stmt)
    logger.info("Knowledge graph schema bootstrap complete (%d statements)", len(CONSTRAINTS_AND_INDEXES))
