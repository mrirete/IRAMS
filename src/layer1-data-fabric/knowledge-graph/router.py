"""
FastAPI router for the ERS Industrial Knowledge Graph.

Endpoints:
    GET  /api/v1/graph/asset/{id}/impact-network
    GET  /api/v1/graph/person/{id}/knowledge-dependency
    GET  /api/v1/graph/failure-mode/{id}/causation-chain
    GET  /api/v1/graph/samp-objective/{id}/asset-contributors
    POST /api/v1/graph/query   (Cypher passthrough for power users)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from .schemas import (
    CausationChainResponse,
    CypherQueryRequest,
    CypherQueryResponse,
    ImpactNetworkResponse,
    KnowledgeDependencyResponse,
    SAMPContributorsResponse,
)
from .service import (
    get_causation_chain,
    get_impact_network,
    get_knowledge_dependency,
    get_samp_contributors,
)
from .driver import run_cypher

logger = logging.getLogger("ers.knowledge_graph.router")
router = APIRouter(prefix="/api/v1/graph", tags=["Knowledge Graph"])


# ── Q1: Impact / Cascade Analysis ─────────────────────────────

@router.get(
    "/asset/{asset_id}/impact-network",
    response_model=ImpactNetworkResponse,
    summary="Cascade impact analysis",
    description=(
        "Traverses FEEDS edges from the given asset to show all "
        "downstream assets that would be affected by a failure. "
        "Example: 'Show all assets affected if lube oil system fails.'"
    ),
)
async def api_impact_network(asset_id: UUID, max_depth: int = 5) -> ImpactNetworkResponse:
    return await get_impact_network(asset_id, max_depth=max_depth)


# ── Q2: Knowledge Dependency ──────────────────────────────────

@router.get(
    "/person/{person_id}/knowledge-dependency",
    response_model=KnowledgeDependencyResponse,
    summary="Person knowledge-dependency analysis",
    description=(
        "Identifies assets that lose ALL institutional knowledge "
        "if the specified person leaves. Calculates a risk_score "
        "(0-100) indicating knowledge concentration risk. "
        "Example: 'Which assets lose all knowledge if Tech X retires?'"
    ),
)
async def api_knowledge_dependency(person_id: UUID) -> KnowledgeDependencyResponse:
    return await get_knowledge_dependency(person_id)


# ── Q3: Causation Chain ──────────────────────────────────────

@router.get(
    "/failure-mode/{fm_id}/causation-chain",
    response_model=CausationChainResponse,
    summary="Failure mode causation chain",
    description=(
        "Traces root causes of a failure mode and finds sibling "
        "failure modes that share the same root causes. "
        "Example: 'What failure modes share root cause with "
        "Pump 101A seal failure?'"
    ),
)
async def api_causation_chain(fm_id: UUID) -> CausationChainResponse:
    return await get_causation_chain(fm_id)


# ── Q4: SAMP Objective Contributors ──────────────────────────

@router.get(
    "/samp-objective/{clause_id}/asset-contributors",
    response_model=SAMPContributorsResponse,
    summary="SAMP objective / standard-clause contributors",
    description=(
        "Finds KPIs supporting a standard clause and the assets "
        "that contribute to those KPIs. Flags at-risk assets "
        "(health_index < 60). Example: 'Which SAMP objectives "
        "are at risk from assets in Unit 3?'"
    ),
)
async def api_samp_contributors(clause_id: UUID) -> SAMPContributorsResponse:
    return await get_samp_contributors(clause_id)


# ── Cypher Passthrough (power users) ─────────────────────────

@router.post(
    "/query",
    response_model=CypherQueryResponse,
    summary="Cypher passthrough query",
    description=(
        "Execute an arbitrary read-only Cypher query against the "
        "knowledge graph. Intended for reliability engineers and "
        "power users. Write operations are blocked."
    ),
)
async def api_cypher_query(body: CypherQueryRequest) -> CypherQueryResponse:
    # Safety: block mutations
    upper = body.query.strip().upper()
    blocked = ("CREATE", "MERGE", "DELETE", "SET ", "REMOVE", "DROP", "CALL db.", "CALL dbms.")
    for kw in blocked:
        if kw in upper:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Mutation keyword '{kw.strip()}' is not allowed via the passthrough endpoint. "
                       "Use the dedicated CRUD APIs for write operations.",
            )

    records = await run_cypher(body.query, body.parameters)
    return CypherQueryResponse(records=records, count=len(records))
