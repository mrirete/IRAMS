"""
Tests — Inventory & BOM Engines
════════════════════════════════
Tests for InventoryEngine (EOQ, reorder, ABC, valuation)
and BOMEngine (assembly tree, where-used, cost, spare coverage).
"""
import pytest
from uuid import uuid4

from ers_work.schemas import (
    InventoryItem, BOMEntry, ABCClass,
    InventoryCategory, StockStatus,
)
from ers_work.engines.inventory import InventoryEngine
from ers_work.engines.bom import BOMEngine


# ── Shared fixtures ──────────────────────────────────────────

STORE_ID = uuid4()
ASSET_A = uuid4()
ASSET_B = uuid4()


def _make_item(**overrides) -> InventoryItem:
    defaults = dict(
        part_number="PN-001",
        description="Test Part",
        category=InventoryCategory.SPARE_PART,
        storeroom_id=STORE_ID,
        qty_on_hand=50,
        min_qty=5,
        max_qty=100,
        reorder_point=10,
        unit_cost_usd=120.00,
        lead_time_days=14,
        annual_usage_qty=200,
        ordering_cost_usd=30.0,
        holding_cost_pct=0.25,
    )
    defaults.update(overrides)
    return InventoryItem(**defaults)


# ══════════════════════════════════════════════════════════════
#  INVENTORY ENGINE
# ══════════════════════════════════════════════════════════════

class TestInventoryEngine:
    def setup_method(self):
        self.engine = InventoryEngine()

    # ── EOQ ──────────────────────────────────────────────────
    def test_eoq_standard(self):
        item = _make_item(
            annual_usage_qty=1200,
            ordering_cost_usd=50.0,
            unit_cost_usd=25.0,
            holding_cost_pct=0.20,
            lead_time_days=7,
        )
        res = self.engine.calculate_eoq(item)

        # EOQ = sqrt(2 * 1200 * 50 / (25 * 0.20)) = sqrt(120000/5) = sqrt(24000) ≈ 155
        assert res.eoq_qty == 155
        assert res.annual_demand == 1200
        assert res.ordering_cost_usd == 50.0
        assert res.holding_cost_usd == 5.0  # 25 * 0.20
        assert res.reorder_point == 23  # ceil(1200/365 * 7) = ceil(23.01) = 24? let me check: 1200/365=3.2876.. * 7 = 23.01 => ceil = 24
        # Actually 1200/365 ≈ 3.2877, * 7 = 23.014, ceil = 24
        # Wait – let me recalculate. The code does ceil(daily * lead_time_days).
        # daily = 1200/365 = 3.28767...
        # daily * 7 = 23.0137...
        # ceil(23.0137) = 24
        assert res.reorder_point == 24

    def test_eoq_zero_demand(self):
        item = _make_item(annual_usage_qty=0)
        res = self.engine.calculate_eoq(item)
        assert res.eoq_qty == 0
        assert res.reorder_point == 0

    # ── Reorder Point Detection ──────────────────────────────
    def test_reorder_alerts(self):
        items = [
            _make_item(part_number="PN-LOW", qty_on_hand=5, reorder_point=10),
            _make_item(part_number="PN-OK", qty_on_hand=50, reorder_point=10),
            _make_item(part_number="PN-EXACT", qty_on_hand=10, reorder_point=10),
        ]
        alerts = self.engine.check_reorder_points(items)
        pns = [a.part_number for a in alerts]
        assert "PN-LOW" in pns
        assert "PN-EXACT" in pns  # at reorder point → flagged
        assert "PN-OK" not in pns

    # ── ABC Classification ───────────────────────────────────
    def test_abc_classification(self):
        items = [
            _make_item(part_number="HIGH", annual_usage_qty=1000, unit_cost_usd=500.0),
            _make_item(part_number="MED", annual_usage_qty=200, unit_cost_usd=100.0),
            _make_item(part_number="LOW", annual_usage_qty=50, unit_cost_usd=10.0),
        ]
        result = self.engine.classify_abc(items)
        # HIGH spend = 500_000, MED = 20_000, LOW = 500. Total = 520_500
        # HIGH = 96 % → A
        assert any(i.part_number == "HIGH" for i in result["A"])
        # MED ≈ 99.9 % cumulative → B
        assert any(i.part_number == "MED" for i in result["B"])
        # LOW → C
        assert any(i.part_number == "LOW" for i in result["C"])

    def test_abc_empty(self):
        result = self.engine.classify_abc([])
        assert result == {"A": [], "B": [], "C": []}

    # ── Valuation ────────────────────────────────────────────
    def test_valuation(self):
        items = [
            _make_item(qty_on_hand=10, unit_cost_usd=100.0, abc_class=ABCClass.A),
            _make_item(part_number="PN-002", qty_on_hand=20, unit_cost_usd=50.0, abc_class=ABCClass.B),
        ]
        val = self.engine.calculate_valuation(items, STORE_ID, "Main Store")
        assert val.total_items == 2
        assert val.total_qty == 30
        assert val.total_value_usd == 2000.0  # 10*100 + 20*50
        assert val.abc_breakdown["A"] == 1000.0
        assert val.abc_breakdown["B"] == 1000.0


# ══════════════════════════════════════════════════════════════
#  BOM ENGINE
# ══════════════════════════════════════════════════════════════

class TestBOMEngine:
    def setup_method(self):
        self.engine = BOMEngine()
        self.item_1 = uuid4()
        self.item_2 = uuid4()
        self.item_3 = uuid4()

        self.bom = [
            BOMEntry(
                asset_id=ASSET_A, item_id=self.item_1,
                part_number="BRG-6205", description="DE Bearing",
                qty_required=2, unit_cost_usd=85.00, criticality_flag=True,
                replacement_interval_days=365,
            ),
            BOMEntry(
                asset_id=ASSET_A, item_id=self.item_2,
                part_number="SEAL-TC", description="Mechanical Seal",
                qty_required=1, unit_cost_usd=1250.00, criticality_flag=True,
            ),
            BOMEntry(
                asset_id=ASSET_B, item_id=self.item_1,
                part_number="BRG-6205", description="DE Bearing",
                qty_required=4, unit_cost_usd=85.00,
            ),
        ]

    # ── Assembly Tree ────────────────────────────────────────
    def test_assembly_tree(self):
        tree = self.engine.build_assembly_tree(self.bom, ASSET_A)
        assert tree["total_components"] == 2
        assert tree["total_cost_usd"] == round(2 * 85.0 + 1 * 1250.0, 2)

    # ── Where-Used ───────────────────────────────────────────
    def test_where_used(self):
        refs = self.engine.where_used(self.bom, self.item_1)
        assert len(refs) == 2  # used in ASSET_A and ASSET_B
        asset_ids = {r["asset_id"] for r in refs}
        assert str(ASSET_A) in asset_ids
        assert str(ASSET_B) in asset_ids

    def test_where_used_none(self):
        refs = self.engine.where_used(self.bom, uuid4())
        assert refs == []

    # ── BOM Cost ─────────────────────────────────────────────
    def test_bom_cost(self):
        cost = self.engine.calculate_bom_cost(self.bom, ASSET_A)
        assert cost == round(2 * 85.0 + 1 * 1250.0, 2)

    # ── Spare Coverage ───────────────────────────────────────
    def test_spare_coverage_ok(self):
        inv = [
            _make_item(item_id=self.item_1, qty_on_hand=10),
            _make_item(item_id=self.item_2, qty_on_hand=5),
        ]
        # Override item_id so they match BOM
        inv[0].item_id = self.item_1
        inv[1].item_id = self.item_2

        shortfalls = self.engine.check_spare_coverage(self.bom, inv)
        # item_1 & item_2 have enough qty for both ASSET_A and ASSET_B
        assert len(shortfalls) == 0

    def test_spare_coverage_shortfall(self):
        inv = [
            _make_item(item_id=self.item_1, qty_on_hand=1),  # needs 2+4=6, only 1
        ]
        inv[0].item_id = self.item_1

        shortfalls = self.engine.check_spare_coverage(self.bom, inv)
        # item_2 is missing entirely, item_1 is short for both BOM lines
        # BOM line ASSET_A/item_1 needs 2, has 1 → shortfall
        # BOM line ASSET_A/item_2 is MISSING
        # BOM line ASSET_B/item_1 needs 4, has 1 → shortfall
        assert len(shortfalls) == 3
        missing = [s for s in shortfalls if s["status"] == "MISSING"]
        assert len(missing) == 1  # item_2 missing
