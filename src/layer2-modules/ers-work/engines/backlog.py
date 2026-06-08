"""
Backlog Health Engine (SMRP Pillar 5)
═════════════════════════════════════
Calculates standard maintenance KPIs covering backlog sizing, 
planned work compliance, and emergency reactivity rates.
"""
from typing import List
from datetime import datetime

from ers_work.schemas import WorkOrder, WorkOrderStatus, WorkOrderPriority, WorkType, BacklogMetrics, MetricScore

class BacklogHealthEngine:
    """"Engine computing SMRP standard backlog health metrics."""

    def calculate_health(
        self, 
        wos: List[WorkOrder], 
        available_weekly_hours: float
    ) -> BacklogMetrics:
        """
        Calculates Key Performance Indicators (KPIs) based on current outstanding work.
        Requires available_weekly_hours to determine "Weeks of Backlog".
        """
        notes = []
        
        # ── 1. Ready Backlog Weeks ──
        # Goal: ~2 to 4 weeks. (Under 2 = overstaffed/starved, Over 4 = understaffed/failing)
        ready_hours = sum(
            wo.estimated_duration_hours for wo in wos 
            if wo.status in (WorkOrderStatus.READY, WorkOrderStatus.APPROVED)
        )
        
        ready_weeks = 0.0
        if available_weekly_hours > 0:
            ready_weeks = ready_hours / available_weekly_hours
            
        ready_score = MetricScore.GREEN
        if ready_weeks < 2.0 or ready_weeks > 5.0:
            ready_score = MetricScore.AMBER
        if ready_weeks < 1.0 or ready_weeks > 8.0:
            ready_score = MetricScore.RED
            
        if ready_score == MetricScore.RED:
            notes.append(f"CRITICAL: Ready backlog is {ready_weeks:.1f} weeks. Target is 2-4 weeks.")


        # ── 2. Planned Work % ──
        # Goal: > 80%
        # Considered planned if it was requested > 48h before start, or is Preventive/Predictive.
        # Here we approximate by checking WorkType and non-emergency priorities.
        total_executed_or_active_hours = sum(
            wo.estimated_duration_hours for wo in wos 
            if wo.status in (WorkOrderStatus.COMPLETED, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.SCHEDULED, WorkOrderStatus.CLOSED)
        )
        
        planned_hours = sum(
            wo.estimated_duration_hours for wo in wos 
            if wo.status in (WorkOrderStatus.COMPLETED, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.SCHEDULED, WorkOrderStatus.CLOSED)
            and wo.type in (WorkType.PREVENTIVE, WorkType.PREDICTIVE, WorkType.CONDITION_BASED, WorkType.PROJECT_CAPITAL)
            and wo.priority != WorkOrderPriority.EMERGENCY
        )
        
        planned_pct = 0.0
        if total_executed_or_active_hours > 0:
            planned_pct = (planned_hours / total_executed_or_active_hours) * 100.0
            
        planned_score = MetricScore.GREEN
        if planned_pct < 80.0:
            planned_score = MetricScore.AMBER
        if planned_pct < 60.0:
            planned_score = MetricScore.RED
            

        # ── 3. Emergency Work % ──
        # Goal: < 5%
        emergency_hours = sum(
            wo.estimated_duration_hours for wo in wos 
            if wo.status in (WorkOrderStatus.COMPLETED, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.SCHEDULED, WorkOrderStatus.CLOSED)
            and wo.priority == WorkOrderPriority.EMERGENCY
        )
        
        emergency_pct = 0.0
        if total_executed_or_active_hours > 0:
            emergency_pct = (emergency_hours / total_executed_or_active_hours) * 100.0
            
        emergency_score = MetricScore.GREEN
        if emergency_pct >= 5.0:
            emergency_score = MetricScore.AMBER
        if emergency_pct >= 10.0:
            emergency_score = MetricScore.RED
            
        if emergency_score == MetricScore.RED:
            notes.append(f"CRITICAL: Reactivity is high. Emergency work answers for {emergency_pct:.1f}% of man-hours (Target <5%).")

        return BacklogMetrics(
            ready_backlog_weeks=round(ready_weeks, 2),
            ready_backlog_score=ready_score,
            planned_work_pct=round(planned_pct, 1),
            planned_work_score=planned_score,
            emergency_work_pct=round(emergency_pct, 1),
            emergency_work_score=emergency_score,
            schedule_compliance_pct=0.0,  # Stubbed for pure WIP analysis
            schedule_compliance_score=MetricScore.AMBER,
            notes=notes
        )
