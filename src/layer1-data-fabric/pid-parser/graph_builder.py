"""
P&ID → Neo4j Knowledge Graph builder.
Converts extracted equipment + connections into graph nodes and FEEDS edges.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Tuple
from uuid import UUID, uuid4

from .schemas import ExtractedEquipment, PageExtractionResult

logger = logging.getLogger("ers.pid_parser.graph_builder")


# ── Lazy import of Knowledge Graph driver ────────────────────

def _run_cypher(query: str, params: dict | None = None):
    """Proxy to the KG driver — async call wrapper for sync context."""
    import asyncio
    # Import from sibling module in the data fabric
    try:
        from importlib import import_module
        mod = import_module("layer1-data-fabric.knowledge-graph.driver")
        return asyncio.get_event_loop().run_until_complete(mod.run_cypher(query, params))
    except Exception:
        # Fallback for when the driver isn't available (tests / dry run)
        logger.warning("Neo4j driver unavailable — graph operations skipped")
        return []


async def build_graph_from_results(
    pages: List[PageExtractionResult],
    job_id: UUID,
) -> Tuple[int, int]:
    """
    Create Asset nodes and FEEDS edges in Neo4j from extraction results.

    Returns:
        (nodes_created, edges_created) counts.
    """
    # Deduplicate tags across pages
    tag_map: Dict[str, ExtractedEquipment] = {}
    for page in pages:
        for eq in page.equipment:
            # Keep highest confidence version of a tag
            if eq.tag not in tag_map or eq.confidence > tag_map[eq.tag].confidence:
                tag_map[eq.tag] = eq

    nodes_created = 0
    edges_created = 0

    # Try async import
    try:
        import sys, os
        sys.path.insert(0, os.path.realpath(os.path.join(os.path.dirname(__file__), "..")))
        from importlib.util import spec_from_file_location, module_from_spec
        kg_driver_path = os.path.join(os.path.dirname(__file__), "..", "knowledge-graph", "driver.py")
        
        if os.path.exists(kg_driver_path):
            spec = spec_from_file_location("kg_driver", kg_driver_path)
            kg_driver = module_from_spec(spec)
            spec.loader.exec_module(kg_driver)
            run_cypher = kg_driver.run_cypher
        else:
            raise ImportError("KG driver not found")
    except Exception:
        logger.warning("Neo4j driver not available — returning dry-run counts")
        return len(tag_map), sum(
            len(eq.connections_out) for eq in tag_map.values()
        )

    # ── Create Asset nodes ────────────────────────────────────
    for tag, eq in tag_map.items():
        node_id = str(uuid4())
        await run_cypher(
            """
            MERGE (a:Asset {tag: $tag})
            SET a.id = $id,
                a.name = $tag,
                a.asset_class = $type,
                a.pid_source_job = $job_id,
                a.pid_confidence = $confidence,
                a.description = $description
            """,
            {
                "tag": tag,
                "id": node_id,
                "type": eq.type_.value if hasattr(eq.type_, 'value') else str(eq.type_),
                "job_id": str(job_id),
                "confidence": eq.confidence,
                "description": eq.description or "",
            },
        )
        nodes_created += 1

    # ── Create FEEDS edges ────────────────────────────────────
    for tag, eq in tag_map.items():
        for conn in eq.connections_out:
            await run_cypher(
                """
                MATCH (a:Asset {tag: $src_tag}), (b:Asset {tag: $tgt_tag})
                MERGE (a)-[r:FEEDS]->(b)
                SET r.flow_type = $flow_type,
                    r.line_number = $line_number,
                    r.pid_source_job = $job_id
                """,
                {
                    "src_tag": tag,
                    "tgt_tag": conn.target_tag,
                    "flow_type": conn.flow_type,
                    "line_number": conn.line_number or "",
                    "job_id": str(job_id),
                },
            )
            edges_created += 1

    logger.info(
        "Graph built for job %s: %d nodes, %d edges",
        job_id, nodes_created, edges_created,
    )
    return nodes_created, edges_created
