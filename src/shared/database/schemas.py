from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

# --- Base Schema ---
class ERSBaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

# --- ER v2.0 Data Fabric Schemas ---

class AssetBase(ERSBaseSchema):
    external_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    asset_class: Optional[str] = None
    criticality_rank: Optional[str] = Field(None, description="A, B, or C")
    parent_asset_id: Optional[UUID] = None
    source_system: Optional[str] = None
    taxonomy_code: Optional[str] = Field(None, description="ISO 14224 code")
    location: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    commissioning_date: Optional[datetime] = None
    design_life_years: Optional[int] = None

class AssetCreate(AssetBase):
    pass

class AssetRead(AssetBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

class AssetHierarchyRead(ERSBaseSchema):
    id: UUID
    parent_id: Optional[UUID] = None
    child_id: Optional[UUID] = None
    relationship_type: Optional[str] = None
    source: Optional[str] = None
    confidence: Optional[float] = None
    validated_by: Optional[UUID] = None
    validated_at: Optional[datetime] = None

class DataQualityScoreRead(ERSBaseSchema):
    id: UUID
    asset_id: Optional[UUID] = None
    source_id: Optional[UUID] = None
    record_type: Optional[str] = None
    completeness: Optional[float] = None
    accuracy: Optional[float] = None
    timeliness: Optional[float] = None
    consistency: Optional[float] = None
    composite: Optional[float] = None
    scored_at: datetime

class AuditTrailBase(ERSBaseSchema):
    entity_type: str
    entity_id: UUID
    action: str
    actor_id: Optional[UUID] = None
    actor_type: str
    governance_tier: Optional[int] = Field(None, ge=1, le=5)
    details: Optional[Dict[str, Any]] = None
    ai_confidence: Optional[float] = None
    ai_model: Optional[str] = None
    ai_rationale: Optional[str] = None
    ip_address: Optional[str] = None

class AuditTrailCreate(AuditTrailBase):
    pass

class AuditTrailRead(AuditTrailBase):
    id: UUID
    timestamp: datetime

class DigitalTwinStateRead(ERSBaseSchema):
    id: UUID
    asset_id: Optional[UUID] = None
    twin_type: Optional[str] = None
    health_index: Optional[float] = None
    degradation_model: Optional[Dict[str, Any]] = None
    last_calibrated_at: Optional[datetime] = None
    calibration_drift: Optional[float] = None
    state_snapshot: Optional[Dict[str, Any]] = None
    updated_at: datetime

# --- Asset Integrity Management Schemas ---

class EquipmentRegistryBase(ERSBaseSchema):
    asset_id: Optional[UUID] = None
    governing_code: Optional[str] = None
    national_board_number: Optional[str] = None
    design_pressure: Optional[float] = None
    design_temperature: Optional[float] = None
    mdmt: Optional[float] = None
    mawp: Optional[float] = None
    material_spec: Optional[str] = None
    material_grade: Optional[str] = None
    corrosion_allowance: Optional[float] = None
    nominal_thickness: Optional[float] = None
    installation_date: Optional[datetime] = None
    last_internal_inspection: Optional[datetime] = None
    last_external: Optional[datetime] = None
    next_inspection_due: Optional[datetime] = None
    rbi_assessment_id: Optional[UUID] = None

class EquipmentRegistryRead(EquipmentRegistryBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

class ThicknessReadingBase(ERSBaseSchema):
    cml_id: Optional[UUID] = None
    reading_date: datetime
    measured_thickness: float
    method: Optional[str] = None
    inspector_id: Optional[UUID] = None
    inspector_cert_verified: Optional[bool] = False
    notes: Optional[str] = None

class ThicknessReadingCreate(ThicknessReadingBase):
    pass

class ThicknessReadingRead(ThicknessReadingBase):
    id: UUID

class CorrosionRateRead(ERSBaseSchema):
    id: UUID
    cml_id: Optional[UUID] = None
    calculated_date: datetime
    short_term_rate: Optional[float] = None
    long_term_rate: Optional[float] = None
    max_observed_rate: Optional[float] = None
    remaining_life_years: Optional[float] = None
    rate_type: Optional[str] = None

class FFSAssessmentRead(ERSBaseSchema):
    id: UUID
    equipment_id: Optional[UUID] = None
    api_579_part: Optional[str] = None
    damage_type: Optional[str] = None
    assessment_level: Optional[str] = None
    status: Optional[str] = None
    rsf_calculated: Optional[float] = None
    mawp_derated: Optional[float] = None
    remaining_life: Optional[float] = None
    assessor_id: Optional[UUID] = None
    reviewer_id: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    governance_tier: Optional[int] = 5

class IOWExceedanceRead(ERSBaseSchema):
    id: UUID
    iow_id: Optional[UUID] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    duration_min: Optional[float] = None
    max_deviation: Optional[float] = None
    acknowledged_by: Optional[UUID] = None
    action_taken: Optional[str] = None

class AuditFindingRead(ERSBaseSchema):
    id: UUID
    audit_id: Optional[UUID] = None
    equipment_id: Optional[UUID] = None
    finding_type: Optional[str] = None
    description: Optional[str] = None
    evidence_refs: Optional[Dict[str, Any]] = None
    ai_generated: Optional[bool] = False
    ai_confidence: Optional[float] = None
    auditor_confirmed: Optional[bool] = None
    corrective_action_id: Optional[UUID] = None

# --- ERS Predict Schemas (PROMPT 4.1A / 4.1B) ---

class SensorReadingCreate(ERSBaseSchema):
    asset_id: UUID
    tag: str
    value: float
    unit: Optional[str] = None
    quality: Optional[float] = 100.0
    timestamp: datetime

class SensorReadingRead(SensorReadingCreate):
    id: UUID

class FailureEventCreate(ERSBaseSchema):
    asset_id: UUID
    failure_mode: str
    failure_cause: Optional[str] = None
    severity: Optional[str] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    downtime_hours: Optional[float] = None
    cost: Optional[float] = None
    work_order_id: Optional[UUID] = None
    sensor_signature: Optional[Dict[str, Any]] = None

class FailureEventRead(FailureEventCreate):
    id: UUID
    created_at: datetime

class PredictionResultRead(ERSBaseSchema):
    id: UUID
    asset_id: UUID
    model_name: str
    prediction_type: Optional[str] = None
    value: float
    confidence: Optional[float] = None
    dqs_impact: Optional[float] = None
    governance_tier: Optional[int] = 3
    ensemble_agreement: Optional[float] = None
    feature_importance: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    predicted_at: datetime

class ModelRegistryRead(ERSBaseSchema):
    id: UUID
    asset_class: str
    model_type: Optional[str] = None
    version: int
    accuracy_metrics: Optional[Dict[str, Any]] = None
    ensemble_weight: Optional[float] = 0.25
    is_active: bool
    trained_at: datetime
    training_samples: Optional[int] = None

class AlertRecordRead(ERSBaseSchema):
    id: UUID
    asset_id: UUID
    prediction_id: Optional[UUID] = None
    alert_type: Optional[str] = None
    severity: Optional[str] = None
    title: str
    description: Optional[str] = None
    suppressed: bool = False
    correlation_group_id: Optional[UUID] = None
    status: Optional[str] = "created"
    governance_tier: Optional[int] = 3
    created_at: datetime

class DegradationCurveRead(ERSBaseSchema):
    id: UUID
    asset_id: UUID
    mechanism: Optional[str] = None
    model_type: Optional[str] = None
    parameters: Dict[str, Any]
    oem_baseline: Optional[Dict[str, Any]] = None
    calibrated_parameters: Optional[Dict[str, Any]] = None
    calibrated_at: Optional[datetime] = None
    calibration_quality: Optional[float] = None
    remaining_useful_pct: Optional[float] = None

class ScenarioResultRead(ERSBaseSchema):
    id: UUID
    twin_id: UUID
    scenario_name: str
    scenario_config: Dict[str, Any]
    baseline_metrics: Dict[str, Any]
    projected_metrics: Dict[str, Any]
    monte_carlo_runs: int = 1000
    confidence_intervals: Optional[Dict[str, Any]] = None
    recommendation: Optional[str] = None
    created_by: Optional[UUID] = None
    created_at: datetime

class SystemTwinConfigRead(ERSBaseSchema):
    id: UUID
    unit_id: UUID
    topology_type: Optional[str] = None
    topology_config: Dict[str, Any]
    system_reliability: Optional[float] = None
    bottleneck_cache: Optional[Dict[str, Any]] = None
    last_computed_at: Optional[datetime] = None
    updated_at: datetime

