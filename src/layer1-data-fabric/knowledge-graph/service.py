"""
ERS Industrial Knowledge Graph — Service Layer
───────────────────────────────────────────────
Implements the four strategic graph queries plus CRUD for
nodes/edges and auto-population from upstream ERS modules.

All Cypher queries are parameterised to prevent injection.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from .driver import run_cypher
from .schemas import (
    AssetNode,
    CausationChainResponse,
    CauseNode,
    CompetencyNode,
    FailureModeNode,
    ImpactNetworkResponse,
    KnowledgeDependencyResponse,
    KPINode,
    PersonNode,
    SAMPContributorsResponse,
    StandardClauseNode,
)

logger = logging.getLogger("ers.knowledge_graph.service")


# ═══════════════════════════════════════════════════════════════
#  NODE CRUD
# ═══════════════════════════════════════════════════════════════

async def upsert_node(label: str, node_id: UUID, properties: Dict[str, Any]) -> Dict[str, Any]:
    """MERGE a node by id and SET properties (upsert)."""
    props = {k: v for k, v in properties.items() if v is not None}
    props["id"] = str(node_id)
    cypher = (
        f"MERGE (n:{label} {{id: $id}}) "
        "SET n += $props "
        "RETURN n"
    )
    records = await run_cypher(cypher, {"id": str(node_id), "props": props})
    return records[0] if records else {}


async def delete_node(label: str, node_id: UUID) -> int:
    """DETACH DELETE a node and all its relationships."""
    cypher = f"MATCH (n:{label} {{id: $id}}) DETACH DELETE n RETURN count(n) as deleted"
    records = await run_cypher(cypher, {"id": str(node_id)})
    return records[0].get("deleted", 0) if records else 0


# ═══════════════════════════════════════════════════════════════
#  EDGE CRUD
# ═══════════════════════════════════════════════════════════════

async def upsert_edge(
    source_label: str,
    source_id: UUID,
    target_label: str,
    target_id: UUID,
    edge_type: str,
    properties: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """MERGE a relationship between two nodes."""
    props = {k: v for k, v in (properties or {}).items() if v is not None}
    cypher = (
        f"MATCH (a:{source_label} {{id: $src}}), (b:{target_label} {{id: $tgt}}) "
        f"MERGE (a)-[r:{edge_type}]->(b) "
        "SET r += $props "
        "RETURN type(r) as rel_type, properties(r) as props"
    )
    records = await run_cypher(cypher, {"src": str(source_id), "tgt": str(target_id), "props": props})
    return records[0] if records else {}


# ═══════════════════════════════════════════════════════════════
#  STRATEGIC QUERY 1 — Impact Network (cascade analysis)
#  "Show all assets affected if lube oil system fails"
# ═══════════════════════════════════════════════════════════════

async def get_impact_network(asset_id: UUID, max_depth: int = 5) -> ImpactNetworkResponse:
    """Traverse FEEDS edges outward to find all downstream assets."""
    # Get root
    root_records = await run_cypher(
        "MATCH (a:Asset {id: $id}) RETURN a", {"id": str(asset_id)}
    )
    if not root_records:
        return ImpactNetworkResponse(
            root_asset=AssetNode(id=asset_id, name="(not found)"),
            cascade_depth=0,
            total_impacted=0,
        )
    root_data = root_records[0]["a"]
    root_asset = AssetNode(**root_data)

    # Variable-length path traversal
    cascade_cypher = """
        MATCH path = (start:Asset {id: $id})-[:FEEDS*1..%d]->(downstream:Asset)
        RETURN downstream, length(path) AS depth
        ORDER BY depth
    """ % max_depth

    cascade = await run_cypher(cascade_cypher, {"id": str(asset_id)})

    seen_ids = set()
    downstream_assets: List[AssetNode] = []
    max_d = 0
    paths: List[Dict[str, Any]] = []

    for rec in cascade:
        node = rec["downstream"]
        depth = rec["depth"]
        nid = node.get("id")
        if nid and nid not in seen_ids:
            seen_ids.add(nid)
            downstream_assets.append(AssetNode(**node))
            paths.append({"asset_id": nid, "depth": depth})
        if depth > max_d:
            max_d = depth

    return ImpactNetworkResponse(
        root_asset=root_asset,
        directly_fed_assets=downstream_assets,
        cascade_depth=max_d,
        total_impacted=len(downstream_assets),
        paths=paths,
    )


# ═══════════════════════════════════════════════════════════════
#  STRATEGIC QUERY 2 — Knowledge Dependency
#  "Which assets lose all institutional knowledge if Tech X retires"
# ═══════════════════════════════════════════════════════════════

async def get_knowledge_dependency(person_id: UUID) -> KnowledgeDependencyResponse:
    """Find assets solely dependent on a single person's knowledge."""
    # Person node
    p_records = await run_cypher(
        "MATCH (p:Person {id: $id}) RETURN p", {"id": str(person_id)}
    )
    if not p_records:
        return KnowledgeDependencyResponse(
            person=PersonNode(id=person_id, name="(not found)"),
        )
    person = PersonNode(**p_records[0]["p"])

    # All assets maintained by this person
    maintained_cypher = """
        MATCH (p:Person {id: $id})-[:MAINTAINS]->(a:Asset)
        RETURN a
    """
    maintained = await run_cypher(maintained_cypher, {"id": str(person_id)})
    maintained_assets = [AssetNode(**r["a"]) for r in maintained]

    # Exclusive assets: where no OTHER person maintains them
    exclusive_cypher = """
        MATCH (p:Person {id: $id})-[:MAINTAINS]->(a:Asset)
        WHERE NOT EXISTS {
            MATCH (other:Person)-[:MAINTAINS]->(a)
            WHERE other.id <> $id
        }
        RETURN a
    """
    exclusive = await run_cypher(exclusive_cypher, {"id": str(person_id)})
    exclusive_assets = [AssetNode(**r["a"]) for r in exclusive]

    # Competencies
    comp_cypher = """
        MATCH (p:Person {id: $id})-[:HAS_COMPETENCY]->(c:Competency)
        RETURN c
    """
    comps = await run_cypher(comp_cypher, {"id": str(person_id)})
    competencies = [CompetencyNode(**r["c"]) for r in comps]

    # Risk score = (exclusive / maintained) * 100  (higher = worse)
    risk = (len(exclusive_assets) / len(maintained_assets) * 100) if maintained_assets else 0.0

    return KnowledgeDependencyResponse(
        person=person,
        maintained_assets=maintained_assets,
        exclusive_assets=exclusive_assets,
        competencies=competencies,
        risk_score=round(risk, 2),
    )


# ═══════════════════════════════════════════════════════════════
#  STRATEGIC QUERY 3 — Causation Chain
#  "What failure modes share root cause with Pump 101A seal failure"
# ═══════════════════════════════════════════════════════════════

async def get_causation_chain(failure_mode_id: UUID) -> CausationChainResponse:
    """Trace causes of a failure mode and find siblings sharing root causes."""
    fm_records = await run_cypher(
        "MATCH (fm:FailureMode {id: $id}) RETURN fm", {"id": str(failure_mode_id)}
    )
    if not fm_records:
        return CausationChainResponse(
            failure_mode=FailureModeNode(id=failure_mode_id, description="(not found)"),
        )
    fm = FailureModeNode(**fm_records[0]["fm"])

    # Root causes
    cause_cypher = """
        MATCH (fm:FailureMode {id: $id})-[:CAUSED_BY]->(c:Cause)
        RETURN c
    """
    causes = await run_cypher(cause_cypher, {"id": str(failure_mode_id)})
    root_causes = [CauseNode(**r["c"]) for r in causes]

    # Sibling failure modes that share the same causes
    sibling_cypher = """
        MATCH (fm:FailureMode {id: $id})-[:CAUSED_BY]->(c:Cause)<-[:CAUSED_BY]-(sibling:FailureMode)
        WHERE sibling.id <> $id
        RETURN DISTINCT sibling
    """
    siblings = await run_cypher(sibling_cypher, {"id": str(failure_mode_id)})
    shared = [FailureModeNode(**r["sibling"]) for r in siblings]

    # Assets experiencing either this FM or siblings
    affected_cypher = """
        MATCH (fm:FailureMode {id: $id})-[:CAUSED_BY]->(c:Cause)-[:ALSO_AFFECTS]->(a:Asset)
        RETURN DISTINCT a
    """
    affected = await run_cypher(affected_cypher, {"id": str(failure_mode_id)})
    affected_assets = [AssetNode(**r["a"]) for r in affected]

    return CausationChainResponse(
        failure_mode=fm,
        root_causes=root_causes,
        shared_cause_failure_modes=shared,
        affected_assets=affected_assets,
    )


# ═══════════════════════════════════════════════════════════════
#  STRATEGIC QUERY 4 — SAMP Objective Contributors
#  "Which SAMP objectives are at risk from assets in Unit 3"
# ═══════════════════════════════════════════════════════════════

async def get_samp_contributors(clause_id: UUID) -> SAMPContributorsResponse:
    """Find KPIs supporting a standard clause and assets contributing to them."""
    sc_records = await run_cypher(
        "MATCH (sc:StandardClause {id: $id}) RETURN sc", {"id": str(clause_id)}
    )
    clause = StandardClauseNode(**sc_records[0]["sc"]) if sc_records else None

    # KPIs supporting this clause
    kpi_cypher = """
        MATCH (k:KPI)-[:SUPPORTS]->(sc:StandardClause {id: $id})
        RETURN k
    """
    kpis = await run_cypher(kpi_cypher, {"id": str(clause_id)})
    supporting_kpis = [KPINode(**r["k"]) for r in kpis]

    # Assets measured by those KPIs
    asset_cypher = """
        MATCH (a:Asset)-[:MEASURED_BY]->(k:KPI)-[:SUPPORTS]->(sc:StandardClause {id: $id})
        RETURN DISTINCT a
    """
    assets = await run_cypher(asset_cypher, {"id": str(clause_id)})
    contributing = [AssetNode(**r["a"]) for r in assets]

    # At-risk: health_index < 60
    at_risk_cypher = """
        MATCH (a:Asset)-[:MEASURED_BY]->(k:KPI)-[:SUPPORTS]->(sc:StandardClause {id: $id})
        WHERE a.health_index < 60
        RETURN DISTINCT a
    """
    at_risk = await run_cypher(at_risk_cypher, {"id": str(clause_id)})
    at_risk_assets = [AssetNode(**r["a"]) for r in at_risk]

    return SAMPContributorsResponse(
        standard_clause=clause,
        supporting_kpis=supporting_kpis,
        contributing_assets=contributing,
        at_risk_assets=at_risk_assets,
    )


# ═══════════════════════════════════════════════════════════════
#  AUTO-POPULATION FROM UPSTREAM MODULES
# ═══════════════════════════════════════════════════════════════

async def populate_from_work_order(wo: Dict[str, Any]) -> None:
    """
    Source: CMMS work orders
    Creates: FailureMode + Cause nodes, EXPERIENCES + CAUSED_BY edges.
    """
    asset_id = wo.get("equipment_id")
    fm_desc = wo.get("failure_mode")
    cause_desc = wo.get("cause_code")
    cause_cat = wo.get("cause_category", "maintenance")

    if not asset_id or not fm_desc:
        return

    fm_id = uuid4()
    await upsert_node("FailureMode", fm_id, {"description": fm_desc})
    await upsert_edge("Asset", UUID(asset_id), "FailureMode", fm_id, "EXPERIENCES", {
        "last_occurrence": datetime.now(tz=timezone.utc).isoformat()
    })

    if cause_desc:
        cause_id = uuid4()
        await upsert_node("Cause", cause_id, {"description": cause_desc, "category": cause_cat})
        await upsert_edge("FailureMode", fm_id, "Cause", cause_id, "CAUSED_BY")

    logger.info("Graph populated from WO: asset=%s, fm=%s", asset_id, fm_desc)


async def populate_from_asset_hierarchy(parent_id: UUID, child_id: UUID, flow_type: str = "process") -> None:
    """
    Source: Data Fabric MDM / P&ID parser
    Creates: Asset -[FEEDS]-> Asset edges.
    """
    await upsert_edge("Asset", parent_id, "Asset", child_id, "FEEDS", {"flow_type": flow_type})
    logger.info("Graph edge: %s -[FEEDS %s]-> %s", parent_id, flow_type, child_id)


async def populate_from_competency(
    person_id: UUID,
    competency_id: UUID,
    current_level: int,
) -> None:
    """
    Source: ERS People competency data
    Creates: Person -[HAS_COMPETENCY]-> Competency edges.
    """
    await upsert_edge("Person", person_id, "Competency", competency_id, "HAS_COMPETENCY", {
        "current_level": current_level,
    })


async def populate_from_samp(
    department_id: UUID,
    kpi_id: UUID,
    clause_id: UUID,
    asset_ids: List[UUID],
) -> None:
    """
    Source: ERS Plan SAMP objectives
    Creates: Department -[OWNS]-> Asset, Asset -[MEASURED_BY]-> KPI,
             KPI -[SUPPORTS]-> StandardClause.
    """
    for aid in asset_ids:
        await upsert_edge("Department", department_id, "Asset", aid, "OWNS")
        await upsert_edge("Asset", aid, "KPI", kpi_id, "MEASURED_BY")
    await upsert_edge("KPI", kpi_id, "StandardClause", clause_id, "SUPPORTS")
    logger.info("SAMP graph populated: dept=%s, kpi=%s, clause=%s", department_id, kpi_id, clause_id)
