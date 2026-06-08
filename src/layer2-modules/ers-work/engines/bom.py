"""
BOM (Bill of Materials) Engine
══════════════════════════════
Recursive assembly tree builder, reverse where-used lookup,
BOM cost roll-up, and spare-coverage checking.
All monetary values in USD.
"""
from typing import List, Dict, Any, Optional
from uuid import UUID

from ers_work.schemas import BOMEntry, InventoryItem, StockStatus


class BOMEngine:
    """Analytics layer over BOM + inventory data."""

    # ── Assembly Tree ────────────────────────────────────────
    def build_assembly_tree(
        self,
        bom_entries: List[BOMEntry],
        root_asset_id: UUID,
    ) -> Dict[str, Any]:
        """
        Build a nested tree of components for a given root asset.
        Returns a dict:
            {
                "asset_id": ...,
                "children": [
                    {"bom_id": ..., "part_number": ..., "qty_required": ..., ...},
                    ...
                ],
                "total_components": int,
                "total_cost_usd": float,
            }
        """
        children = [
            {
                "bom_id": str(e.bom_id),
                "item_id": str(e.item_id),
                "part_number": e.part_number,
                "description": e.description,
                "qty_required": e.qty_required,
                "criticality_flag": e.criticality_flag,
                "replacement_interval_days": e.replacement_interval_days,
                "unit_cost_usd": e.unit_cost_usd,
                "line_cost_usd": round(e.qty_required * e.unit_cost_usd, 2),
            }
            for e in bom_entries
            if e.asset_id == root_asset_id
        ]

        total_cost = sum(c["line_cost_usd"] for c in children)

        return {
            "asset_id": str(root_asset_id),
            "children": children,
            "total_components": len(children),
            "total_cost_usd": round(total_cost, 2),
        }

    # ── Where-Used (Reverse Lookup) ──────────────────────────
    def where_used(
        self,
        bom_entries: List[BOMEntry],
        item_id: UUID,
    ) -> List[Dict[str, Any]]:
        """
        Given a part (item_id), return all assets that reference it
        in their BOM.
        """
        return [
            {
                "asset_id": str(e.asset_id),
                "bom_id": str(e.bom_id),
                "qty_required": e.qty_required,
                "criticality_flag": e.criticality_flag,
            }
            for e in bom_entries
            if e.item_id == item_id
        ]

    # ── BOM Cost Roll-Up ─────────────────────────────────────
    def calculate_bom_cost(
        self,
        bom_entries: List[BOMEntry],
        asset_id: UUID,
    ) -> float:
        """Total replacement cost (USD) for all BOM lines on an asset."""
        return round(
            sum(
                e.qty_required * e.unit_cost_usd
                for e in bom_entries
                if e.asset_id == asset_id
            ),
            2,
        )

    # ── Spare Coverage Check ─────────────────────────────────
    def check_spare_coverage(
        self,
        bom_entries: List[BOMEntry],
        inventory: List[InventoryItem],
    ) -> List[Dict[str, Any]]:
        """
        For each BOM line, verify the matching inventory item has
        sufficient stock.  Returns a list of shortfall records.
        """
        inv_map: Dict[UUID, InventoryItem] = {
            it.item_id: it for it in inventory
        }

        shortfalls: List[Dict[str, Any]] = []
        for e in bom_entries:
            inv = inv_map.get(e.item_id)
            if inv is None:
                shortfalls.append({
                    "bom_id": str(e.bom_id),
                    "asset_id": str(e.asset_id),
                    "part_number": e.part_number,
                    "qty_required": e.qty_required,
                    "qty_on_hand": 0,
                    "shortfall": e.qty_required,
                    "status": "MISSING",
                })
            elif inv.qty_on_hand < e.qty_required:
                shortfalls.append({
                    "bom_id": str(e.bom_id),
                    "asset_id": str(e.asset_id),
                    "part_number": e.part_number,
                    "qty_required": e.qty_required,
                    "qty_on_hand": inv.qty_on_hand,
                    "shortfall": e.qty_required - inv.qty_on_hand,
                    "status": inv.stock_status.value,
                })

        return shortfalls
