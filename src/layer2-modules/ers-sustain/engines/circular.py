"""
Circular Economy Engine
═══════════════════════
Tracks waste streams, reclamation, recycling, and calculates circularity indices
for the ESG dashboard and compliance reporting.
"""
from typing import List, Optional
from uuid import UUID

from ers_sustain.schemas import (
    WasteRecord, CircularMetricsResult, WasteDisposition
)


class CircularEconomyEngine:
    """Engine for aggregating and analyzing waste and recycling data."""

    def calculate_circularity(
        self,
        records: List[WasteRecord],
        site_id: Optional[UUID] = None
    ) -> CircularMetricsResult:
        """
        Aggregate waste generated and calculate the percentage that is
        diverted from landfills/incineration (recycled or reclaimed).
        """
        total_kg = 0.0
        diverted_kg = 0.0
        breakdown = {}

        for r in records:
            # Assuming normalization to KG is done before passing to engine or implicitly handled
            qty = r.quantity 
            total_kg += qty
            
            # Track diverted waste (Circular)
            if r.disposition in (WasteDisposition.RECYCLED, WasteDisposition.RECLAIMED):
                diverted_kg += qty
                
            # Breakdown by category
            cat_key = r.category.value
            breakdown[cat_key] = breakdown.get(cat_key, 0.0) + qty

        circularity_index = 0.0
        if total_kg > 0:
            circularity_index = (diverted_kg / total_kg) * 100.0

        return CircularMetricsResult(
            site_id=site_id,
            total_waste_kg=round(total_kg, 2),
            recycled_reclaimed_kg=round(diverted_kg, 2),
            circularity_index_percent=round(circularity_index, 2),
            breakdown_by_category={k: round(v, 2) for k, v in breakdown.items()}
        )
