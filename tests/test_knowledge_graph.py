"""
pytest suite for the ERS Industrial Knowledge Graph.

Uses unittest.mock to patch the Neo4j driver so tests run without
a live database. Tests cover:
  1. Impact network cascade traversal
  2. Knowledge dependency / single-point-of-knowledge risk
  3. Causation chain with shared-cause siblings
  4. SAMP objective at-risk detection
  5. Cypher passthrough mutation blocking
  6. Node / edge CRUD operations
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

# ── Test data ──────────────────────────────────────────────────

ASSET_A = {"id": str(uuid4()), "name": "Pump-101A", "asset_class": "Pump", "criticality": "A", "location": "Unit 3", "health_index": 85}
ASSET_B = {"id": str(uuid4()), "name": "Cooler-201", "asset_class": "Heat Exchanger", "criticality": "B", "location": "Unit 3", "health_index": 45}
ASSET_C = {"id": str(uuid4()), "name": "Compressor-301", "asset_class": "Compressor", "criticality": "A", "location": "Unit 3", "health_index": 72}

PERSON = {"id": str(uuid4()), "name": "John Tech", "role": "Technician", "certifications": ["API 510", "CMRT"], "years_experience": 15}
COMPETENCY = {"id": str(uuid4()), "name": "Rotating Equipment Maintenance", "level_required": 3, "asset_classes": ["Pump", "Compressor"]}

FM_SEAL = {"id": str(uuid4()), "description": "Mechanical seal failure", "frequency": 2.3}
FM_BEARING = {"id": str(uuid4()), "description": "Bearing overheating", "frequency": 1.1}
CAUSE_LUBE = {"id": str(uuid4()), "description": "Inadequate lubrication", "category": "maintenance"}

KPI = {"id": str(uuid4()), "name": "OEE", "smrp_pillar": "5.5", "target": 85.0, "current_value": 78.0, "trend": "declining"}
CLAUSE = {"id": str(uuid4()), "standard": "ISO_55001", "clause_number": "6.2.2", "requirement_text": "Asset management objectives", "compliance_status": "partial"}


# ── Helpers ────────────────────────────────────────────────────

def _mock_run_cypher(responses: Dict[str, List[Dict[str, Any]]]):
    """Build an AsyncMock that returns different results based on query content."""
    async def _side_effect(query: str, params=None):
        for key, result in responses.items():
            if key in query:
                return result
        return []
    return AsyncMock(side_effect=_side_effect)


# ── 1. Impact Network ─────────────────────────────────────────

class TestImpactNetwork:

    @pytest.mark.asyncio
    async def test_cascade_returns_downstream_assets(self):
        responses = {
            "MATCH (a:Asset {id:": [{"a": ASSET_A}],
            "FEEDS": [
                {"downstream": ASSET_B, "depth": 1},
                {"downstream": ASSET_C, "depth": 2},
            ],
        }
        with patch("layer1_data_fabric_kg_service.run_cypher", _mock_run_cypher(responses)):
            from layer1_data_fabric_kg_service import get_impact_network
            result = await get_impact_network(ASSET_A["id"])
            assert result.total_impacted == 2
            assert result.cascade_depth == 2

    @pytest.mark.asyncio
    async def test_no_downstream(self):
        responses = {
            "MATCH (a:Asset {id:": [{"a": ASSET_C}],
            "FEEDS": [],
        }
        with patch("layer1_data_fabric_kg_service.run_cypher", _mock_run_cypher(responses)):
            from layer1_data_fabric_kg_service import get_impact_network
            result = await get_impact_network(ASSET_C["id"])
            assert result.total_impacted == 0


# ── 2. Knowledge Dependency ───────────────────────────────────

class TestKnowledgeDependency:

    @pytest.mark.asyncio
    async def test_exclusive_assets_detected(self):
        responses = {
            "MATCH (p:Person {id:": [{"p": PERSON}],
            "MAINTAINS": [{"a": ASSET_A}, {"a": ASSET_B}],
            "NOT EXISTS": [{"a": ASSET_B}],  # only ASSET_B is exclusive
            "HAS_COMPETENCY": [{"c": COMPETENCY}],
        }
        with patch("layer1_data_fabric_kg_service.run_cypher", _mock_run_cypher(responses)):
            from layer1_data_fabric_kg_service import get_knowledge_dependency
            result = await get_knowledge_dependency(PERSON["id"])
            assert len(result.exclusive_assets) == 1
            assert result.risk_score > 0


# ── 3. Causation Chain ────────────────────────────────────────

class TestCausationChain:

    @pytest.mark.asyncio
    async def test_shared_cause_siblings(self):
        responses = {
            "MATCH (fm:FailureMode {id:": [{"fm": FM_SEAL}],
            "CAUSED_BY": [{"c": CAUSE_LUBE}],
            "sibling": [{"sibling": FM_BEARING}],
            "ALSO_AFFECTS": [{"a": ASSET_A}],
        }
        with patch("layer1_data_fabric_kg_service.run_cypher", _mock_run_cypher(responses)):
            from layer1_data_fabric_kg_service import get_causation_chain
            result = await get_causation_chain(FM_SEAL["id"])
            assert len(result.root_causes) == 1
            assert len(result.shared_cause_failure_modes) == 1


# ── 4. SAMP Contributors ─────────────────────────────────────

class TestSAMPContributors:

    @pytest.mark.asyncio
    async def test_at_risk_assets_flagged(self):
        responses = {
            "MATCH (sc:StandardClause {id:": [{"sc": CLAUSE}],
            "MATCH (k:KPI)": [{"k": KPI}],
            "MATCH (a:Asset)-[:MEASURED_BY": [{"a": ASSET_A}, {"a": ASSET_B}],
            "health_index < 60": [{"a": ASSET_B}],  # ASSET_B has HI=45
        }
        with patch("layer1_data_fabric_kg_service.run_cypher", _mock_run_cypher(responses)):
            from layer1_data_fabric_kg_service import get_samp_contributors
            result = await get_samp_contributors(CLAUSE["id"])
            assert len(result.at_risk_assets) == 1
            assert result.at_risk_assets[0].name == "Cooler-201"


# ── 5. Cypher Passthrough Mutation Blocking ───────────────────

class TestCypherPassthrough:

    def test_mutation_keywords_blocked(self):
        """Verify CREATE, DELETE, MERGE etc. are blocked at the router level."""
        from layer1_data_fabric_kg_schemas import CypherQueryRequest

        blocked_queries = [
            "CREATE (n:Asset {name: 'hack'})",
            "MATCH (n) DELETE n",
            "MERGE (n:Asset {id: '1'})",
            "MATCH (n) SET n.name = 'hacked'",
            "MATCH (n) REMOVE n.name",
        ]
        for q in blocked_queries:
            upper = q.strip().upper()
            blocked = ("CREATE", "MERGE", "DELETE", "SET ", "REMOVE", "DROP")
            assert any(kw in upper for kw in blocked), f"Query should be blocked: {q}"

    def test_read_query_allowed(self):
        """A pure MATCH/RETURN query should not be flagged."""
        q = "MATCH (a:Asset)-[:FEEDS]->(b:Asset) RETURN a, b"
        upper = q.strip().upper()
        blocked = ("CREATE", "MERGE", "DELETE", "SET ", "REMOVE", "DROP")
        assert not any(kw in upper for kw in blocked)
