"""
ERS Work — Schemas
══════════════════
Pydantic models for Work Management, Scheduling (OR-Tools),
Work Order Enrichment, Backlog Health (SMRP), Parts Demand,
and Turnaround Scoping.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

# ══════════════════════════════════════════════════════════════
#  ENUMS
# ══════════════════════════════════════════════════════════════

class WorkOrderStatus(str, Enum):
    DRAFT = "draft"
    REQUESTED = "requested"
    APPROVED = "approved"
    READY = "ready"
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CLOSED = "closed"
    DEFERRED = "deferred"
    CANCELLED = "cancelled"

class WorkOrderPriority(int, Enum):
    EMERGENCY = 1   # Immediate response
    URGENT = 2      # Next 24-48 hours
    HIGH = 3        # Within current week
    MEDIUM = 4      # Within current month
    LOW = 5         # As resources permit

class WorkType(str, Enum):
    CORRECTIVE = "corrective"
    PREVENTIVE = "preventive"
    PREDICTIVE = "predictive"
    CONDITION_BASED = "condition_based"
    PROJECT_CAPITAL = "project_capital"
    TURNAROUND = "turnaround"
    SAFETY = "safety"


# ══════════════════════════════════════════════════════════════
#  WORK ORDERS
# ══════════════════════════════════════════════════════════════

class WorkOrder(BaseModel):
    wo_id: UUID = Field(default_factory=uuid4)
    code: str
    title: str
    description: str
    asset_id: UUID
    type: WorkType
    priority: WorkOrderPriority
    status: WorkOrderStatus = WorkOrderStatus.DRAFT
    
    # Timing constraints
    requested_date: datetime = Field(default_factory=datetime.utcnow)
    required_by_date: Optional[datetime] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    
    # Requirements
    estimated_duration_hours: float
    required_skills: List[str] = Field(default_factory=list)
    parts_required: Dict[str, int] = Field(default_factory=dict)  # part_id -> qty
    dependencies: List[UUID] = Field(default_factory=list)  # wo_ids that must precede this
    
    # Assignments
    assigned_technician_id: Optional[UUID] = None


# ══════════════════════════════════════════════════════════════
#  SCHEDULING (OR-TOOLS)
# ══════════════════════════════════════════════════════════════

class ResourceAvailability(BaseModel):
    technician_id: UUID
    name: str
    skills: List[str]
    available_hours_per_week: float
    hourly_cost: float = 50.0
    shift_start_hour: int = 8  # e.g. 8 AM
    shift_end_hour: int = 17   # e.g. 5 PM

class ScheduleInput(BaseModel):
    start_date: datetime
    horizon_days: int = 7
    work_orders: List[WorkOrder]
    resources: List[ResourceAvailability]
    # Constraints & Weights
    maximize_priority_weight: float = 100.0
    minimize_travel_weight: float = 10.0
    minimize_overtime_weight: float = 50.0

class OptimizedTask(BaseModel):
    wo_id: UUID
    wo_code: str
    assigned_technician_id: UUID
    technician_name: str
    scheduled_start: datetime
    scheduled_end: datetime
    estimated_hours: float

class ScheduleResult(BaseModel):
    schedule_id: UUID = Field(default_factory=uuid4)
    start_date: datetime
    end_date: datetime
    tasks: List[OptimizedTask]
    unassigned_wos: List[UUID]
    total_scheduled_hours: float
    resource_utilization: Dict[UUID, float]  # tech_id -> utilization %
    solver_status: str  # "OPTIMAL", "FEASIBLE", "INFEASIBLE", etc.
    explanation: str


# ══════════════════════════════════════════════════════════════
#  WO ENRICHMENT
# ══════════════════════════════════════════════════════════════

class SafetyAdvisory(BaseModel):
    category: str
    description: str
    requires_loto: bool = False
    ppe_required: List[str] = Field(default_factory=list)

class FailurePattern(BaseModel):
    pattern_name: str
    probability: float
    suggested_remedy: str

class WOContext(BaseModel):
    wo_id: UUID
    historical_similar_wos: List[Dict[str, Any]]
    recommended_procedures: List[str]
    failure_patterns: List[FailurePattern]
    safety_advisories: List[SafetyAdvisory]
    parts_availability_status: str  # "ALL_IN_STOCK", "PARTIAL", "OUT_OF_STOCK"


# ══════════════════════════════════════════════════════════════
#  BACKLOG HEALTH (SMRP PILLAR 5)
# ══════════════════════════════════════════════════════════════

class MetricScore(str, Enum):
    GREEN = "green"    # On target
    AMBER = "amber"    # Warning
    RED = "red"        # Critical / Off target

class BacklogMetrics(BaseModel):
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    # Total weeks of work ready to execute (Target: 2-4 weeks)
    ready_backlog_weeks: float
    ready_backlog_score: MetricScore
    
    # % of man-hours spent on planned vs reactive work (Target: >80%)
    planned_work_pct: float
    planned_work_score: MetricScore
    
    # % of man-hours spent on emergency work (Target: <5%)
    emergency_work_pct: float
    emergency_work_score: MetricScore
    
    # % of scheduled work completed on time (Target: >90%)
    schedule_compliance_pct: float
    schedule_compliance_score: MetricScore
    
    notes: List[str] = Field(default_factory=list)


# ══════════════════════════════════════════════════════════════
#  PARTS DEMAND FORECASTING
# ══════════════════════════════════════════════════════════════

class PartForecastItem(BaseModel):
    part_id: str
    part_name: str
    current_stock: int
    predicted_demand_qty: float
    p90_demand_qty: int  # 90th percentile from Monte Carlo
    lead_time_days: int
    stockout_risk_pct: float
    recommendation: str

class PartsDemandForecast(BaseModel):
    horizon_days: int
    items: List[PartForecastItem]
    high_risk_stockouts: int


# ══════════════════════════════════════════════════════════════
#  TURNAROUND SCOPE BUILDER
# ══════════════════════════════════════════════════════════════

class ScopeItemSource(str, Enum):
    DEFERRED_WO = "deferred_wo"
    PREDICTIVE_ANOMALY = "predictive_anomaly"
    RBI_INSPECTION = "rbi_inspection"
    CAPITAL_RENEWAL = "capital_renewal"

class ScopeItem(BaseModel):
    item_id: UUID = Field(default_factory=uuid4)
    source: ScopeItemSource
    source_ref_id: UUID
    title: str
    asset_id: UUID
    estimated_hours: float
    critical_path: bool = False

class TurnaroundScope(BaseModel):
    tar_id: UUID = Field(default_factory=uuid4)
    name: str
    target_start_date: datetime
    target_end_date: datetime
    items: List[ScopeItem]
    total_estimated_hours: float
    critical_path_hours: float


# ══════════════════════════════════════════════════════════════
#  INVENTORY & BOM (SMRP Pillar 4 — Materials Management)
# ══════════════════════════════════════════════════════════════

class ABCClass(str, Enum):
    """Pareto inventory classification."""
    A = "A"  # ~20 % of SKUs, ~80 % of spend
    B = "B"  # ~30 % of SKUs, ~15 % of spend
    C = "C"  # ~50 % of SKUs, ~5 % of spend

class InventoryCategory(str, Enum):
    SPARE_PART = "spare_part"
    CONSUMABLE = "consumable"
    ROTABLE = "rotable"           # repairable / exchange pool
    CAPITAL_SPARE = "capital_spare"
    SAFETY_STOCK = "safety_stock"  # insurance spares

class StockStatus(str, Enum):
    IN_STOCK = "in_stock"
    LOW_STOCK = "low_stock"
    OUT_OF_STOCK = "out_of_stock"
    ON_ORDER = "on_order"
    DISCONTINUED = "discontinued"

class TransactionType(str, Enum):
    RECEIPT = "receipt"
    ISSUE = "issue"
    RETURN = "return"
    ADJUSTMENT = "adjustment"
    TRANSFER = "transfer"
    CYCLE_COUNT = "cycle_count"


class InventoryItem(BaseModel):
    """A single stockable part / material."""
    item_id: UUID = Field(default_factory=uuid4)
    part_number: str
    description: str
    category: InventoryCategory
    abc_class: ABCClass = ABCClass.C
    storeroom_id: UUID
    qty_on_hand: int = 0
    min_qty: int = 0
    max_qty: int = 0
    reorder_point: int = 0
    unit_cost_usd: float = 0.0           # USD
    unit_of_measure: str = "each"
    lead_time_days: int = 0
    linked_asset_ids: List[UUID] = Field(default_factory=list)
    criticality_flag: bool = False        # True for safety-critical spares
    supplier_name: Optional[str] = None
    supplier_part_number: Optional[str] = None
    stock_status: StockStatus = StockStatus.IN_STOCK
    annual_usage_qty: float = 0.0         # for EOQ calc
    ordering_cost_usd: float = 25.0       # USD — cost per purchase order
    holding_cost_pct: float = 0.25        # % of unit cost per year


class BOMEntry(BaseModel):
    """Links an inventory item to a parent asset (Equipment / Sub-unit)."""
    bom_id: UUID = Field(default_factory=uuid4)
    asset_id: UUID                        # parent asset this part belongs to
    item_id: UUID                         # FK -> InventoryItem
    part_number: str
    description: str
    qty_required: int = 1
    criticality_flag: bool = False
    replacement_interval_days: Optional[int] = None  # recommended swap interval
    unit_cost_usd: float = 0.0            # snapshot cost in USD


class Storeroom(BaseModel):
    """Physical warehouse / crib location."""
    storeroom_id: UUID = Field(default_factory=uuid4)
    name: str
    site: str
    manager: Optional[str] = None
    item_count: int = 0
    total_value_usd: float = 0.0          # USD


class InventoryTransaction(BaseModel):
    """Immutable ledger entry for every material movement."""
    txn_id: UUID = Field(default_factory=uuid4)
    item_id: UUID
    storeroom_id: UUID
    txn_type: TransactionType
    qty: int
    unit_cost_usd: float = 0.0            # USD at time of transaction
    total_cost_usd: float = 0.0           # USD
    reference: Optional[str] = None       # WO number or PO number
    performed_by: str = "system"
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class CycleCountEntry(BaseModel):
    """Cycle‑count variance record."""
    count_id: UUID = Field(default_factory=uuid4)
    item_id: UUID
    storeroom_id: UUID
    expected_qty: int
    actual_qty: int
    variance: int = 0                     # actual - expected
    variance_pct: float = 0.0
    resolution: str = ""                  # adjustment / investigation note
    counted_by: str = "system"
    counted_at: datetime = Field(default_factory=datetime.utcnow)


class InventoryValuation(BaseModel):
    """Storeroom‑level valuation summary."""
    storeroom_id: UUID
    storeroom_name: str
    total_items: int
    total_qty: int
    total_value_usd: float                # USD
    abc_breakdown: Dict[str, float]        # {"A": value, "B": value, "C": value}


class EOQResult(BaseModel):
    """Economic Order Quantity calculation result."""
    item_id: UUID
    part_number: str
    eoq_qty: int
    annual_demand: float
    ordering_cost_usd: float              # USD
    holding_cost_usd: float               # USD per unit per year
    total_annual_cost_usd: float           # USD (optimal)
    reorder_point: int
