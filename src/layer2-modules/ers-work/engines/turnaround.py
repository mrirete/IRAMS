"""
Turnaround Scope Builder Engine
═══════════════════════════════
Prepares mass outages by aggregating deferred maintenance,
predictive condition flags, RBI inspections, and capital renewals.
"""
from typing import List, Dict, Any
from datetime import datetime
from uuid import UUID, uuid4

from ers_work.schemas import (
    TurnaroundScope, ScopeItem, ScopeItemSource, WorkOrder, WorkOrderStatus
)


class TurnaroundEngine:
    """Engine for generating comprehensive Turnaround (TAR) Scopes."""

    def build_scope(
        self,
        name: str,
        target_start: datetime,
        target_end: datetime,
        deferred_wos: List[WorkOrder],
        rbi_inspections: List[Dict[str, Any]],
        capital_renewals: List[Dict[str, Any]]
    ) -> TurnaroundScope:
        """
        Aggregates items from multiple ERS domains into a single executable scope.
        In production, this would pull directly via cross-module API calls.
        """
        items: List[ScopeItem] = []
        
        # 1. Add Deferred Work Orders
        for wo in deferred_wos:
            if wo.status == WorkOrderStatus.DEFERRED:
                # Mark as critical path if duration is > 24 hours
                is_critical = wo.estimated_duration_hours >= 24.0
                
                items.append(ScopeItem(
                    source=ScopeItemSource.DEFERRED_WO,
                    source_ref_id=wo.wo_id,
                    title=f"Execute: {wo.title}",
                    asset_id=wo.asset_id,
                    estimated_hours=wo.estimated_duration_hours,
                    critical_path=is_critical
                ))

        # 2. Add Risk-Based Inspections (RBI)
        for rbi in rbi_inspections:
            # Mark as critical path if it's a major internal vessel inspection
            is_critical = "INTERNAL" in rbi.get("inspection_type", "").upper()
            
            items.append(ScopeItem(
                source=ScopeItemSource.RBI_INSPECTION,
                source_ref_id=rbi.get("rbi_id", uuid4()),
                title=f"RBI: {rbi.get('title', 'Routine Inspection')}",
                asset_id=rbi.get("asset_id", uuid4()),
                estimated_hours=rbi.get("estimated_hours", 8.0),
                critical_path=is_critical
            ))

        # 3. Add Capital Renewals (from ERS Plan)
        for proj in capital_renewals:
            items.append(ScopeItem(
                source=ScopeItemSource.CAPITAL_RENEWAL,
                source_ref_id=proj.get("project_id", uuid4()),
                title=f"CAPEX: Replace {proj.get('asset_name', 'Asset')}",
                asset_id=proj.get("asset_id", uuid4()),
                estimated_hours=proj.get("estimated_hours", 120.0),
                critical_path=True  # Capital renewals during TAR are almost always critical path
            ))

        # Calculate totals
        total_hours = sum(item.estimated_hours for item in items)
        critical_hours = sum(item.estimated_hours for item in items if item.critical_path)

        return TurnaroundScope(
            name=name,
            target_start_date=target_start,
            target_end_date=target_end,
            items=items,
            total_estimated_hours=round(total_hours, 1),
            critical_path_hours=round(critical_hours, 1)
        )
