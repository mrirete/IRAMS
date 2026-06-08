import pytest
from datetime import datetime, timedelta
from uuid import uuid4

from ers_work.schemas import (
    WorkOrder, WorkOrderPriority, WorkOrderStatus, WorkType,
    ScheduleInput, ResourceAvailability,
    PartsDemandForecast, TurnaroundScope
)
from ers_work.engines.scheduling import SchedulingEngine
from ers_work.engines.enrichment import EnrichmentEngine
from ers_work.engines.backlog import BacklogHealthEngine
from ers_work.engines.parts import PartsForecastingEngine
from ers_work.engines.turnaround import TurnaroundEngine

class TestSchedulingEngine:
    def setup_method(self):
        self.engine = SchedulingEngine()

    def test_optimize_schedule_success(self):
        start_date = datetime.utcnow()
        wos = [
            WorkOrder(
                code="WO-001", title="Fix Pump A", description="...", asset_id=uuid4(),
                type=WorkType.CORRECTIVE, priority=WorkOrderPriority.HIGH,
                status=WorkOrderStatus.READY, estimated_duration_hours=4.0,
                required_skills=["Mechanical"]
            ),
            WorkOrder(
                code="WO-002", title="Inspect Valve B", description="...", asset_id=uuid4(),
                type=WorkType.PREVENTIVE, priority=WorkOrderPriority.MEDIUM,
                status=WorkOrderStatus.READY, estimated_duration_hours=2.0,
                required_skills=["Instrumentation"]
            )
        ]

        resources = [
            ResourceAvailability(
                technician_id=uuid4(), name="Tech Mech", skills=["Mechanical", "Basic"],
                available_hours_per_week=40.0, hourly_cost=50.0
            ),
            ResourceAvailability(
                technician_id=uuid4(), name="Tech Inst", skills=["Instrumentation", "Electrical"],
                available_hours_per_week=40.0, hourly_cost=65.0
            )
        ]

        req = ScheduleInput(start_date=start_date, horizon_days=7, work_orders=wos, resources=resources)
        res = self.engine.optimize_schedule(req)

        assert res.solver_status in ("OPTIMAL", "FEASIBLE")
        assert len(res.tasks) == 2
        assert res.total_scheduled_hours == 6.0
        
        # Verify skill matching was respected implicitly by checking who got what
        mech_task = next(t for t in res.tasks if t.wo_code == "WO-001")
        inst_task = next(t for t in res.tasks if t.wo_code == "WO-002")
        
        assert mech_task.assigned_technician_id == resources[0].technician_id
        assert inst_task.assigned_technician_id == resources[1].technician_id

class TestEnrichmentEngine:
    def setup_method(self):
        self.engine = EnrichmentEngine()

    def test_enrich_pump_work_order(self):
        wo = WorkOrder(
            code="WO-003", title="Pump Vibration", description="High vibration on motor and pump casing.", 
            asset_id=uuid4(), type=WorkType.PREDICTIVE, priority=WorkOrderPriority.HIGH,
            status=WorkOrderStatus.APPROVED, estimated_duration_hours=3.0
        )

        ctx = self.engine.enrich_work_order(wo, asset_class="PUMP")
        
        assert ctx.wo_id == wo.wo_id
        assert len(ctx.recommended_procedures) == 2
        # Should pick up safety advisory for "motor"
        assert any(sa.category == "Electrical" for sa in ctx.safety_advisories)
        
        # Should pick up failure patterns for Pump + vibration
        pattern_names = [p.pattern_name for p in ctx.failure_patterns]
        assert "Bearing Spalling" in pattern_names
        assert "Impeller Cavitation" in pattern_names

class TestBacklogHealthEngine:
    def setup_method(self):
        self.engine = BacklogHealthEngine()

    def test_srmp_metrics_calculation(self):
        wos = [
            WorkOrder(code="W1", title="1", description="", asset_id=uuid4(), type=WorkType.PREVENTIVE, priority=WorkOrderPriority.MEDIUM, status=WorkOrderStatus.COMPLETED, estimated_duration_hours=10.0),
            WorkOrder(code="W2", title="2", description="", asset_id=uuid4(), type=WorkType.CORRECTIVE, priority=WorkOrderPriority.EMERGENCY, status=WorkOrderStatus.COMPLETED, estimated_duration_hours=2.0),
            WorkOrder(code="W3", title="3", description="", asset_id=uuid4(), type=WorkType.CORRECTIVE, priority=WorkOrderPriority.HIGH, status=WorkOrderStatus.READY, estimated_duration_hours=40.0),
            WorkOrder(code="W4", title="4", description="", asset_id=uuid4(), type=WorkType.CORRECTIVE, priority=WorkOrderPriority.HIGH, status=WorkOrderStatus.READY, estimated_duration_hours=40.0)
        ]

        # Available weekly hours = 40 (so 80 hours ready = 2.0 weeks)
        res = self.engine.calculate_health(wos, available_weekly_hours=40.0)
        
        # Ready backlog: 80h / 40h/week = 2.0 weeks (GREEN)
        assert res.ready_backlog_weeks == 2.0
        assert res.ready_backlog_score == "green"
        
        # Executed hours = 12h
        # Planned = 10h (Preventive). Planned % = 10/12 * 100 = 83.3% (GREEN)
        assert res.planned_work_pct == 83.3
        assert res.planned_work_score == "green"
        
        # Emergency = 2h. Emergency % = 2/12 * 100 = 16.7% (RED)
        assert res.emergency_work_pct == 16.7
        assert res.emergency_work_score == "red"
        assert any("Emergency work answers for 16.7%" in n for n in res.notes)

class TestPartsForecastingEngine:
    def setup_method(self):
        self.engine = PartsForecastingEngine()

    def test_monte_carlo_stockout_risk(self):
        inventory = {
            "PART-1": {"name": "Seal", "qty": 10, "lead_time": 5},
            "PART-2": {"name": "Bearing", "qty": 2, "lead_time": 45}
        }
        usage = {
            "PART-1": 8.0,  # 8 per month
            "PART-2": 5.0   # 5 per month
        }

        # Forecast for 30 days (1 month). Needs: 8 and 5 respectively.
        res = self.engine.forecast_demand(inventory, usage, horizon_days=30, iterations=100)
        assert len(res.items) == 2
        
        # PART-2 has only 2 qty but expects 5 usage. Should be high risk.
        p_2 = next(i for i in res.items if i.part_id == "PART-2")
        assert p_2.stockout_risk_pct > 80.0
        assert "Order" in p_2.recommendation

class TestTurnaroundEngine:
    def setup_method(self):
        self.engine = TurnaroundEngine()

    def test_build_tar_scope(self):
        def_wo = WorkOrder(
            code="WO-TAR-1", title="Massive Internals Repair", description="...",
            asset_id=uuid4(), type=WorkType.TURNAROUND, priority=WorkOrderPriority.MEDIUM,
            status=WorkOrderStatus.DEFERRED, estimated_duration_hours=48.0
        )
        
        rbi = [{"rbi_id": uuid4(), "title": "C-101 Internal Insp", "asset_id": uuid4(), "estimated_hours": 24.0, "inspection_type": "INTERNAL"}]
        cap = [{"project_id": uuid4(), "asset_name": "Pump Skid 2", "asset_id": uuid4(), "estimated_hours": 120.0}]

        scope = self.engine.build_scope(
            name="Fall TAR 2026", target_start=datetime.utcnow(), target_end=datetime.utcnow() + timedelta(days=14),
            deferred_wos=[def_wo], rbi_inspections=rbi, capital_renewals=cap
        )

        assert len(scope.items) == 3
        assert scope.total_estimated_hours == 192.0 # 48 + 24 + 120
        # Critical path -> duration > 24h, INTERNAL FBI, and CAPS are all true here
        assert scope.critical_path_hours == 192.0
