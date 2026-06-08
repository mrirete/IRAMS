"""
Inventory Management Engine
════════════════════════════
EOQ calculation, reorder-point detection, ABC Pareto classification,
and storeroom valuation.  All monetary values in USD.
"""
import math
from typing import List, Dict

from ers_work.schemas import (
    InventoryItem, ABCClass, StockStatus,
    InventoryValuation, EOQResult,
)


class InventoryEngine:
    """Core calculations for inventory analytics."""

    # ── EOQ ──────────────────────────────────────────────────
    def calculate_eoq(self, item: InventoryItem) -> EOQResult:
        """
        Wilson EOQ formula:
            EOQ = sqrt(2·D·S / H)
        where D = annual demand, S = ordering cost, H = holding cost per unit.
        """
        D = item.annual_usage_qty
        S = item.ordering_cost_usd
        H = item.unit_cost_usd * item.holding_cost_pct

        if D <= 0 or S <= 0 or H <= 0:
            eoq = 0
            total_annual = 0.0
        else:
            eoq = max(1, int(round(math.sqrt((2 * D * S) / H))))
            # Optimal total annual cost = sqrt(2·D·S·H)
            total_annual = round(math.sqrt(2 * D * S * H), 2)

        # Simple reorder point: daily demand × lead time
        daily = D / 365.0 if D > 0 else 0
        rop = max(0, int(math.ceil(daily * item.lead_time_days)))

        return EOQResult(
            item_id=item.item_id,
            part_number=item.part_number,
            eoq_qty=eoq,
            annual_demand=D,
            ordering_cost_usd=S,
            holding_cost_usd=round(H, 2),
            total_annual_cost_usd=total_annual,
            reorder_point=rop,
        )

    # ── Reorder-Point Checker ────────────────────────────────
    def check_reorder_points(
        self, items: List[InventoryItem]
    ) -> List[InventoryItem]:
        """Return items whose qty_on_hand ≤ reorder_point."""
        alerts: List[InventoryItem] = []
        for it in items:
            if it.qty_on_hand <= it.reorder_point:
                alerts.append(it)
        return alerts

    # ── ABC Classification ───────────────────────────────────
    def classify_abc(
        self, items: List[InventoryItem]
    ) -> Dict[str, List[InventoryItem]]:
        """
        Pareto classification based on annual spend
        (annual_usage_qty × unit_cost_usd).
        A = top 80 % of spend, B = next 15 %, C = remaining 5 %.
        Returns dict keyed by "A", "B", "C".
        """
        spend = [
            (it, it.annual_usage_qty * it.unit_cost_usd) for it in items
        ]
        spend.sort(key=lambda x: x[1], reverse=True)

        total_spend = sum(s for _, s in spend)
        if total_spend == 0:
            return {"A": [], "B": [], "C": list(items)}

        cumulative = 0.0
        result: Dict[str, List[InventoryItem]] = {"A": [], "B": [], "C": []}

        for it, s in spend:
            cumulative += s
            pct = cumulative / total_spend
            if pct <= 0.80:
                it.abc_class = ABCClass.A
                result["A"].append(it)
            elif pct <= 0.95:
                it.abc_class = ABCClass.B
                result["B"].append(it)
            else:
                it.abc_class = ABCClass.C
                result["C"].append(it)

        return result

    # ── Storeroom Valuation ──────────────────────────────────
    def calculate_valuation(
        self, items: List[InventoryItem], storeroom_id, storeroom_name: str
    ) -> InventoryValuation:
        """Aggregated value summary for one storeroom."""
        filtered = [it for it in items if it.storeroom_id == storeroom_id]

        abc_vals: Dict[str, float] = {"A": 0.0, "B": 0.0, "C": 0.0}
        total_qty = 0
        total_val = 0.0

        for it in filtered:
            val = it.qty_on_hand * it.unit_cost_usd
            total_qty += it.qty_on_hand
            total_val += val
            abc_vals[it.abc_class.value] = abc_vals.get(it.abc_class.value, 0) + val

        return InventoryValuation(
            storeroom_id=storeroom_id,
            storeroom_name=storeroom_name,
            total_items=len(filtered),
            total_qty=total_qty,
            total_value_usd=round(total_val, 2),
            abc_breakdown={k: round(v, 2) for k, v in abc_vals.items()},
        )
