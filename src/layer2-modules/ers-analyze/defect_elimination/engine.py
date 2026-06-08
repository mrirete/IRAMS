"""
Defect Elimination Engine — Uptime Elements 5 Sources
══════════════════════════════════════════════════════════
Campaign management: Identify → Investigate → Eliminate → Verify
5 defect sources: Design, Procurement, Installation, Operation, Maintenance.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from ers_analyze.schemas import (
    DefectEliminationCampaign,
    DefectEliminationSummary,
    DefectSource,
)


class DefectEliminationEngine:
    """
    Defect Elimination campaign management (Uptime Elements framework).

    Lifecycle:
    1. IDENTIFIED — defect pattern discovered (from Bad Actor or RCA)
    2. INVESTIGATING — root cause analysis in progress
    3. ELIMINATING — corrective action being implemented
    4. VERIFIED — fix confirmed effective
    5. CLOSED — campaign complete

    5 Sources of Defects (Uptime Elements):
    - Design: inherent design limitations
    - Procurement: quality issues in purchased materials
    - Installation: workmanship during installation/overhaul
    - Operation: operating outside design parameters
    - Maintenance: maintenance-induced failures
    """

    VALID_STATUSES = [
        "identified", "investigating", "eliminating", "verified", "closed"
    ]

    def __init__(self):
        self._campaigns: Dict[UUID, DefectEliminationCampaign] = {}

    def create_campaign(
        self,
        asset_id: UUID,
        asset_name: str,
        title: str,
        defect_source: DefectSource,
        problem_description: str,
        root_cause_ids: Optional[List[UUID]] = None,
        assigned_to: Optional[UUID] = None,
        target_completion: Optional[datetime] = None,
    ) -> DefectEliminationCampaign:
        """Create a new Defect Elimination campaign."""
        campaign = DefectEliminationCampaign(
            id=uuid4(),
            asset_id=asset_id,
            asset_name=asset_name,
            title=title,
            defect_source=defect_source,
            problem_description=problem_description,
            root_cause_ids=root_cause_ids or [],
            status="identified",
            assigned_to=assigned_to,
            target_completion=target_completion,
        )
        self._campaigns[campaign.id] = campaign
        return campaign

    def advance_status(
        self, campaign_id: UUID, new_status: str
    ) -> Optional[DefectEliminationCampaign]:
        """
        Advance a campaign's status.

        Validates transition:
        identified → investigating → eliminating → verified → closed
        """
        campaign = self._campaigns.get(campaign_id)
        if not campaign:
            return None

        current_idx = self.VALID_STATUSES.index(campaign.status)
        if new_status not in self.VALID_STATUSES:
            return None

        new_idx = self.VALID_STATUSES.index(new_status)
        if new_idx != current_idx + 1:
            return None  # can only advance one step

        campaign.status = new_status
        return campaign

    def record_savings(
        self, campaign_id: UUID, savings: float
    ) -> Optional[DefectEliminationCampaign]:
        """Record actual savings achieved by a DE campaign."""
        campaign = self._campaigns.get(campaign_id)
        if campaign:
            campaign.actual_savings += savings
        return campaign

    def get_campaign(self, campaign_id: UUID) -> Optional[DefectEliminationCampaign]:
        """Get a campaign by ID."""
        return self._campaigns.get(campaign_id)

    def get_summary(self) -> DefectEliminationSummary:
        """Get summary statistics across all campaigns."""
        source_counts = Counter(c.defect_source.value for c in self._campaigns.values())
        active = sum(
            1 for c in self._campaigns.values()
            if c.status not in ("verified", "closed")
        )
        completed = sum(
            1 for c in self._campaigns.values()
            if c.status in ("verified", "closed")
        )
        total_savings = sum(c.actual_savings for c in self._campaigns.values())

        # Find top defect source
        top_source = None
        if source_counts:
            top_source = source_counts.most_common(1)[0][0]

        return DefectEliminationSummary(
            source_breakdown=dict(source_counts),
            active_campaigns=active,
            completed_campaigns=completed,
            total_savings=total_savings,
            top_defect_source=top_source,
        )

    def get_campaigns_by_source(
        self, source: DefectSource
    ) -> List[DefectEliminationCampaign]:
        """Filter campaigns by defect source."""
        return [
            c for c in self._campaigns.values()
            if c.defect_source == source
        ]

    def get_active_campaigns(self) -> List[DefectEliminationCampaign]:
        """Get all active (non-closed) campaigns."""
        return [
            c for c in self._campaigns.values()
            if c.status not in ("verified", "closed")
        ]
