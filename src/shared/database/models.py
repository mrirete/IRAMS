from datetime import datetime
import uuid
from sqlalchemy import (
    Column, String, JSON, Integer, Float, Boolean, ForeignKey, 
    DateTime, Enum as SQLEnum, Index, Text
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

# --- ER v2.0 Data Fabric (PROMPT 3.1) ---

class Asset(Base):
    __tablename__ = 'assets'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_id = Column(String, index=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    asset_class = Column(String)
    criticality_rank = Column(SQLEnum('A', 'B', 'C', name='criticality_enum'))
    parent_asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=True)
    source_system = Column(String)
    taxonomy_code = Column(String) # ISO 14224
    location = Column(String)
    lat = Column(Float)
    lon = Column(Float)
    commissioning_date = Column(DateTime(timezone=True))
    design_life_years = Column(Integer)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    parent = relationship('Asset', remote_side=[id])

class AssetHierarchy(Base):
    __tablename__ = 'asset_hierarchy'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'))
    child_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'))
    relationship_type = Column(SQLEnum('contains', 'feeds', 'serves', 'protects', name='hierarchy_rel_enum'))
    source = Column(SQLEnum('manual', 'pid_parser', 'cmms_sync', 'knowledge_graph', name='hierarchy_source_enum'))
    confidence = Column(Float) # 0-1
    validated_by = Column(UUID(as_uuid=True))
    validated_at = Column(DateTime(timezone=True))

class DataSource(Base):
    __tablename__ = 'data_sources'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    source_type = Column(SQLEnum('cmms', 'historian', 'scada', 'iot', 'erp', 'file', 'mes', name='datasource_type_enum'))
    connection_config = Column(JSONB)
    status = Column(SQLEnum('active', 'error', 'disabled', name='datasource_status_enum'))
    last_sync_at = Column(DateTime(timezone=True))
    sync_interval_seconds = Column(Integer)

class DataQualityScore(Base):
    __tablename__ = 'data_quality_scores'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'))
    source_id = Column(UUID(as_uuid=True), ForeignKey('data_sources.id'))
    record_type = Column(String)
    completeness = Column(Float) # 0-100
    accuracy = Column(Float)
    timeliness = Column(Float)
    consistency = Column(Float)
    composite = Column(Float) # calculated
    scored_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (Index('ix_dqs_asset_scored_at', 'asset_id', 'scored_at'),)

class AuditTrail(Base):
    __tablename__ = 'audit_trail'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type = Column(String, nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    action = Column(SQLEnum('create', 'update', 'delete', 'approve', 'reject', 'execute', name='audit_action_enum'))
    actor_id = Column(UUID(as_uuid=True))
    actor_type = Column(SQLEnum('user', 'system', 'ai_agent', name='actor_type_enum'))
    governance_tier = Column(Integer) # 1-5
    details = Column(JSONB)
    ai_confidence = Column(Float)
    ai_model = Column(String)
    ai_rationale = Column(Text)
    ip_address = Column(String)
    timestamp = Column(DateTime(timezone=True), default=datetime.utcnow, index=True)

class KnowledgeGraphNode(Base):
    __tablename__ = 'knowledge_graph_nodes'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    node_type = Column(SQLEnum('asset', 'failure_mode', 'cause', 'effect', 'person', 'competency', 'standard_clause', 'kpi', 'department', name='kg_node_type_enum'))
    label = Column(String, nullable=False)
    properties = Column(JSONB)
    source_module = Column(String)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class KnowledgeGraphEdge(Base):
    __tablename__ = 'knowledge_graph_edges'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey('knowledge_graph_nodes.id'))
    target_node_id = Column(UUID(as_uuid=True), ForeignKey('knowledge_graph_nodes.id'))
    edge_type = Column(SQLEnum('causes', 'affects', 'maintains', 'owns', 'measures', 'cascades', 'requires_competency', 'serves_stakeholder', name='kg_edge_type_enum'))
    weight = Column(Float)
    properties = Column(JSONB)

    __table_args__ = (
        Index('ix_kg_edges_source_target', 'source_node_id', 'target_node_id'),
    )

class DigitalTwinState(Base):
    __tablename__ = 'digital_twin_state'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'))
    twin_type = Column(SQLEnum('single_asset', 'system', name='twin_type_enum'))
    health_index = Column(Float) # 0-100
    degradation_model = Column(JSONB)
    last_calibrated_at = Column(DateTime(timezone=True))
    calibration_drift = Column(Float)
    state_snapshot = Column(JSONB)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

# --- ERS Predict — Prediction Engine & Digital Twin (PROMPT 4.1A / 4.1B) ---

class SensorReading(Base):
    """Time-series sensor data ingested from historian/SCADA/IoT."""
    __tablename__ = 'sensor_readings'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    tag = Column(String, nullable=False, index=True)  # e.g. "VIB_DE", "TEMP_BEARING"
    value = Column(Float, nullable=False)
    unit = Column(String)
    quality = Column(Float, default=100.0)  # 0-100 OPC quality
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)

    __table_args__ = (
        Index('ix_sensor_asset_tag_ts', 'asset_id', 'tag', 'timestamp'),
    )

class FailureEvent(Base):
    """Historical failure records for reliability analysis."""
    __tablename__ = 'failure_events'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    failure_mode = Column(String, nullable=False)
    failure_cause = Column(String)
    severity = Column(SQLEnum('critical', 'major', 'minor', 'incidental', name='failure_severity_enum'))
    started_at = Column(DateTime(timezone=True), nullable=False)
    ended_at = Column(DateTime(timezone=True))
    downtime_hours = Column(Float)
    cost = Column(Float)
    work_order_id = Column(UUID(as_uuid=True))  # link to ERS Work
    sensor_signature = Column(JSONB)  # pre-failure sensor snapshot for pattern matching
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        Index('ix_failure_asset_time', 'asset_id', 'started_at'),
    )

class PredictionResult(Base):
    """ML prediction outputs with governance metadata."""
    __tablename__ = 'prediction_results'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    model_name = Column(String, nullable=False)  # "xgboost", "ensemble", etc.
    prediction_type = Column(SQLEnum('health_index', 'failure_probability', 'rul', 'anomaly_score', name='prediction_type_enum'))
    value = Column(Float, nullable=False)
    confidence = Column(Float)  # 0-1
    dqs_impact = Column(Float)  # DQS-adjusted confidence penalty
    governance_tier = Column(Integer, default=3)  # 1-5; Tier 2 = human review
    ensemble_agreement = Column(Float)  # 0-1 model agreement
    feature_importance = Column(JSONB)  # top contributing features
    metadata = Column(JSONB)  # extra context (confidence bands, etc.)
    predicted_at = Column(DateTime(timezone=True), default=datetime.utcnow, index=True)

    __table_args__ = (
        Index('ix_prediction_asset_type', 'asset_id', 'prediction_type'),
    )

class ModelRegistry(Base):
    """Trained model versions and accuracy tracking."""
    __tablename__ = 'model_registry'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_class = Column(String, nullable=False, index=True)  # "pump", "compressor"
    model_type = Column(SQLEnum('xgboost', 'lstm_autoencoder', 'weibull_survival', 'physics_informed', name='model_type_enum'))
    version = Column(Integer, default=1)
    weights_path = Column(String)  # S3/GCS path or local
    accuracy_metrics = Column(JSONB)  # {"mae": 0.1, "rmse": 0.2, "precision": 0.85}
    ensemble_weight = Column(Float, default=0.25)
    is_active = Column(Boolean, default=True)
    trained_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    training_samples = Column(Integer)
    hyperparameters = Column(JSONB)

class AlertRecord(Base):
    """Prediction-driven alerts with fatigue management."""
    __tablename__ = 'alert_records'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    prediction_id = Column(UUID(as_uuid=True), ForeignKey('prediction_results.id'))
    alert_type = Column(SQLEnum('anomaly', 'threshold_breach', 'trend_deviation', 'rul_critical', 'pattern_match', name='alert_type_enum'))
    severity = Column(SQLEnum('emergency', 'high', 'medium', 'low', 'info', name='alert_severity_enum'))
    title = Column(String, nullable=False)
    description = Column(Text)
    suppressed = Column(Boolean, default=False)
    suppressed_until = Column(DateTime(timezone=True))
    correlation_group_id = Column(UUID(as_uuid=True))  # groups related alerts
    status = Column(SQLEnum('created', 'active', 'acknowledged', 'resolved', 'suppressed', name='alert_status_enum'), default='created')
    acknowledged_by = Column(UUID(as_uuid=True))
    acknowledged_at = Column(DateTime(timezone=True))
    governance_tier = Column(Integer, default=3)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, index=True)

    __table_args__ = (
        Index('ix_alert_asset_status', 'asset_id', 'status'),
    )

class DegradationCurve(Base):
    """Physics-informed degradation models per asset+mechanism."""
    __tablename__ = 'degradation_curves'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    mechanism = Column(SQLEnum(
        'fatigue_accumulation', 'corrosion_rate', 'bearing_wear',
        'insulation_degradation', 'erosion', name='degradation_mechanism_enum'
    ))
    model_type = Column(String)  # "miners_rule", "linear", "power_law", "arrhenius", etc.
    parameters = Column(JSONB, nullable=False)  # model-specific params
    oem_baseline = Column(JSONB)  # manufacturer's original curve
    calibrated_parameters = Column(JSONB)  # data-adjusted params
    calibrated_at = Column(DateTime(timezone=True))
    calibration_quality = Column(Float)  # 0-100
    remaining_useful_pct = Column(Float)  # current degradation %

class ScenarioResult(Base):
    """What-if scenario comparison results."""
    __tablename__ = 'scenario_results'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    twin_id = Column(UUID(as_uuid=True), ForeignKey('digital_twin_state.id'), nullable=False)
    scenario_name = Column(String, nullable=False)
    scenario_config = Column(JSONB, nullable=False)  # proposed changes
    baseline_metrics = Column(JSONB, nullable=False)  # current state projections
    projected_metrics = Column(JSONB, nullable=False)  # after-change projections
    monte_carlo_runs = Column(Integer, default=1000)
    confidence_intervals = Column(JSONB)  # {"50": [...], "80": [...], "95": [...]}
    recommendation = Column(Text)
    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class SystemTwinConfig(Base):
    """System-level digital twin topology and bottleneck cache."""
    __tablename__ = 'system_twin_configs'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    unit_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    topology_type = Column(SQLEnum('series', 'parallel', 'k_of_n', 'complex', name='topology_type_enum'))
    topology_config = Column(JSONB, nullable=False)  # RBD structure
    system_reliability = Column(Float)  # current calculated value
    bottleneck_cache = Column(JSONB)  # ranked bottleneck assets
    last_computed_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

# --- Asset Integrity Management (PROMPT A.1) ---

class EquipmentRegistry(Base):
    __tablename__ = 'equipment_registry'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'))
    governing_code = Column(SQLEnum('api_510', 'api_570', 'api_653', 'asme_b31_3', name='governing_code_enum'))
    national_board_number = Column(String)
    design_pressure = Column(Float)
    design_temperature = Column(Float)
    mdmt = Column(Float)
    mawp = Column(Float)
    material_spec = Column(String)
    material_grade = Column(String)
    corrosion_allowance = Column(Float)
    nominal_thickness = Column(Float)
    installation_date = Column(DateTime(timezone=True))
    last_internal_inspection = Column(DateTime(timezone=True))
    last_external = Column(DateTime(timezone=True))
    next_inspection_due = Column(DateTime(timezone=True), index=True)
    rbi_assessment_id = Column(UUID(as_uuid=True)) # nullable fk placeholder
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

class ConditionMonitoringLocation(Base):
    __tablename__ = 'condition_monitoring_locations'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    equipment_id = Column(UUID(as_uuid=True), ForeignKey('equipment_registry.id'))
    cml_number = Column(String, nullable=False)
    location_description = Column(Text)
    component_type = Column(SQLEnum('shell', 'head', 'nozzle', 'piping_elbow', 'piping_straight', 'piping_tee', 'weld', 'tank_shell_course', 'tank_floor', 'tank_roof', name='component_type_enum'))
    nominal_thickness = Column(Float)
    retirement_thickness = Column(Float)
    min_required_thickness = Column(Float)
    corrosion_loop_id = Column(UUID(as_uuid=True)) # nullable fk placeholder

class ThicknessReading(Base):
    __tablename__ = 'thickness_readings'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cml_id = Column(UUID(as_uuid=True), ForeignKey('condition_monitoring_locations.id'))
    reading_date = Column(DateTime(timezone=True), nullable=False)
    measured_thickness = Column(Float, nullable=False)
    method = Column(SQLEnum('ut_contact', 'ut_compression', 'ut_shear', 'paut', 'scan', name='ut_method_enum'))
    inspector_id = Column(UUID(as_uuid=True))
    inspector_cert_verified = Column(Boolean, default=False)
    notes = Column(Text)

    __table_args__ = (
        Index('ix_thickness_readings_cml_date', 'cml_id', 'reading_date'),
    )

class CorrosionRate(Base):
    __tablename__ = 'corrosion_rates'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cml_id = Column(UUID(as_uuid=True), ForeignKey('condition_monitoring_locations.id'))
    calculated_date = Column(DateTime(timezone=True), default=datetime.utcnow)
    short_term_rate = Column(Float)
    long_term_rate = Column(Float)
    max_observed_rate = Column(Float)
    remaining_life_years = Column(Float)
    rate_type = Column(SQLEnum('general', 'localized', 'pitting', name='corrosion_rate_type_enum'))

class DamageMechanism(Base):
    __tablename__ = 'damage_mechanisms'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    equipment_id = Column(UUID(as_uuid=True), ForeignKey('equipment_registry.id'))
    api_571_code = Column(String)
    name = Column(String, nullable=False)
    status = Column(SQLEnum('active', 'susceptible', 'latent', 'not_applicable', name='damage_mech_status_enum'))
    confidence = Column(Float)
    source = Column(SQLEnum('ai_suggested', 'engineer_confirmed', 'historical', name='damage_mech_source_enum'))
    reviewed_by = Column(UUID(as_uuid=True))
    reviewed_at = Column(DateTime(timezone=True))

class FFSAssessment(Base):
    __tablename__ = 'ffs_assessments'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    equipment_id = Column(UUID(as_uuid=True), ForeignKey('equipment_registry.id'))
    api_579_part = Column(String)
    damage_type = Column(String)
    assessment_level = Column(SQLEnum('level_1', 'level_2', 'level_3', name='ffs_level_enum'))
    status = Column(SQLEnum('in_progress', 'passed', 'failed', 'remediation_required', 'monitoring', name='ffs_status_enum'))
    rsf_calculated = Column(Float)
    mawp_derated = Column(Float)
    remaining_life = Column(Float)
    assessor_id = Column(UUID(as_uuid=True))
    reviewer_id = Column(UUID(as_uuid=True))
    approved_at = Column(DateTime(timezone=True))
    governance_tier = Column(Integer, default=5)

class IntegrityOperatingWindow(Base):
    __tablename__ = 'integrity_operating_windows'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    equipment_id = Column(UUID(as_uuid=True), ForeignKey('equipment_registry.id'))
    parameter_name = Column(String, nullable=False)
    parameter_tag = Column(String) # DCS tag
    iow_type = Column(SQLEnum('critical', 'standard', 'informational', name='iow_type_enum'))
    low_limit = Column(Float)
    high_limit = Column(Float)
    unit = Column(String)
    linked_damage_mech = Column(UUID(as_uuid=True), ForeignKey('damage_mechanisms.id'))
    monitoring_active = Column(Boolean, default=True)

class IOWExceedance(Base):
    __tablename__ = 'iow_exceedances'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    iow_id = Column(UUID(as_uuid=True), ForeignKey('integrity_operating_windows.id'))
    start_time = Column(DateTime(timezone=True), index=True)
    end_time = Column(DateTime(timezone=True))
    duration_min = Column(Float)
    max_deviation = Column(Float)
    acknowledged_by = Column(UUID(as_uuid=True))
    action_taken = Column(Text)

class IntegrityAudit(Base):
    __tablename__ = 'integrity_audits'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    audit_type = Column(SQLEnum('routine', 'turnaround', 'regulatory', 'incident', 'management', name='audit_type_enum'))
    scope_description = Column(Text)
    auditor_id = Column(UUID(as_uuid=True))
    start_date = Column(DateTime(timezone=True))
    end_date = Column(DateTime(timezone=True))
    status = Column(SQLEnum('planned', 'in_progress', 'completed', 'closed', name='audit_status_enum'))
    regulatory_preparedness_score = Column(Float)

class AuditFinding(Base):
    __tablename__ = 'audit_findings'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    audit_id = Column(UUID(as_uuid=True), ForeignKey('integrity_audits.id'))
    equipment_id = Column(UUID(as_uuid=True), ForeignKey('equipment_registry.id'), nullable=True)
    finding_type = Column(SQLEnum('observation', 'recommendation', 'non_conformance', 'critical', name='finding_type_enum'), index=True) # indexed by severity conceptually
    description = Column(Text)
    evidence_refs = Column(JSONB)
    ai_generated = Column(Boolean, default=False)
    ai_confidence = Column(Float)
    auditor_confirmed = Column(Boolean)
    corrective_action_id = Column(UUID(as_uuid=True)) # populated later or loosely coupled

class CorrectiveAction(Base):
    __tablename__ = 'corrective_actions'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    finding_id = Column(UUID(as_uuid=True), ForeignKey('audit_findings.id'))
    description = Column(Text)
    owner_id = Column(UUID(as_uuid=True))
    due_date = Column(DateTime(timezone=True))
    priority = Column(SQLEnum('immediate', 'high', 'medium', 'low', name='ca_priority_enum'))
    status = Column(SQLEnum('open', 'in_progress', 'completed', 'verified', 'overdue', name='ca_status_enum'))
    work_order_id = Column(UUID(as_uuid=True)) # link to ERS Work module
    verified_by = Column(UUID(as_uuid=True))
    verified_at = Column(DateTime(timezone=True))

# --- ERS Analyze — Reliability Engineering Suite (PROMPT 4.2) ---

class RCMAnalysis(Base):
    """Top-level RCM study (SAE JA1011/JA1012)."""
    __tablename__ = 'rcm_analyses'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text)
    operating_context = Column(Text)
    status = Column(SQLEnum('draft', 'in_progress', 'review', 'approved', 'superseded', name='rcm_status_enum'), default='draft')
    governance_tier = Column(Integer, default=3)
    facilitator_id = Column(UUID(as_uuid=True))
    approved_by = Column(UUID(as_uuid=True))
    approved_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

class RCMFunction(Base):
    """Equipment function within an RCM study (SAE JA1011 §5)."""
    __tablename__ = 'rcm_functions'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_id = Column(UUID(as_uuid=True), ForeignKey('rcm_analyses.id'), nullable=False)
    function_number = Column(Integer, nullable=False)
    description = Column(Text, nullable=False)
    performance_standard = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class RCMFunctionalFailure(Base):
    """Way a function can fail (loss/degradation of capability)."""
    __tablename__ = 'rcm_functional_failures'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    function_id = Column(UUID(as_uuid=True), ForeignKey('rcm_functions.id'), nullable=False)
    failure_code = Column(String, nullable=False)  # e.g., "FF-1A"
    description = Column(Text, nullable=False)

class RCMFailureMode(Base):
    """Individual failure mode within a functional failure."""
    __tablename__ = 'rcm_failure_modes'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    functional_failure_id = Column(UUID(as_uuid=True), ForeignKey('rcm_functional_failures.id'), nullable=False)
    mode_code = Column(String, nullable=False)  # e.g., "FM-1A-01"
    description = Column(Text, nullable=False)
    source = Column(SQLEnum('historical', 'ai_suggested', 'expert', 'oem', name='fm_source_enum'), default='expert')
    ai_confidence = Column(Float)
    iso14224_code = Column(String)  # ISO 14224 failure mode taxonomy
    approved = Column(Boolean, default=False)
    approved_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class RCMFailureEffect(Base):
    """Effect of a failure mode (local + system + consequence)."""
    __tablename__ = 'rcm_failure_effects'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    failure_mode_id = Column(UUID(as_uuid=True), ForeignKey('rcm_failure_modes.id'), nullable=False)
    local_effect = Column(Text, nullable=False)
    system_effect = Column(Text)
    consequence_class = Column(SQLEnum(
        'safety_health', 'environmental', 'operational', 'non_operational', 'hidden_safety',
        'hidden_environmental', 'hidden_operational', name='consequence_class_enum'
    ))
    hidden_failure = Column(Boolean, default=False)
    detection_method = Column(Text)
    mttr_hours = Column(Float)
    downtime_cost_per_hour = Column(Float)

class RCMTask(Base):
    """Maintenance task selected via JA1011 decision tree."""
    __tablename__ = 'rcm_tasks'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    failure_mode_id = Column(UUID(as_uuid=True), ForeignKey('rcm_failure_modes.id'), nullable=False)
    task_type = Column(SQLEnum(
        'on_condition', 'scheduled_restoration', 'scheduled_discard',
        'failure_finding', 'redesign', 'run_to_failure', name='rcm_task_type_enum'
    ), nullable=False)
    description = Column(Text, nullable=False)
    interval_days = Column(Float)
    interval_hours = Column(Float)
    initial_interval = Column(Float)  # for new/unproven equipment
    technically_feasible = Column(Boolean, default=True)
    worth_doing = Column(Boolean, default=True)
    decision_path = Column(JSONB)  # trace through JA1011 decision tree
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

class FMEAWorksheet(Base):
    """FMEA study header."""
    __tablename__ = 'fmea_worksheets'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    title = Column(String, nullable=False)
    fmea_type = Column(SQLEnum('design', 'process', 'system', name='fmea_type_enum'), default='system')
    status = Column(SQLEnum('draft', 'in_progress', 'review', 'approved', name='fmea_status_enum'), default='draft')
    prepared_by = Column(UUID(as_uuid=True))
    approved_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

class FMEAItem(Base):
    """Individual row in FMEA worksheet."""
    __tablename__ = 'fmea_items'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worksheet_id = Column(UUID(as_uuid=True), ForeignKey('fmea_worksheets.id'), nullable=False)
    component = Column(String, nullable=False)
    function = Column(Text)
    failure_mode = Column(Text, nullable=False)
    failure_effect = Column(Text)
    failure_cause = Column(Text)
    severity = Column(Integer, default=1)     # 1-10
    occurrence = Column(Integer, default=1)   # 1-10
    detection = Column(Integer, default=1)    # 1-10
    rpn = Column(Integer, default=1)          # S × O × D
    current_controls = Column(Text)
    recommended_action = Column(Text)
    action_owner = Column(UUID(as_uuid=True))
    action_due = Column(DateTime(timezone=True))
    action_status = Column(SQLEnum('open', 'in_progress', 'completed', 'verified', name='fmea_action_status_enum'), default='open')
    source = Column(SQLEnum('manual', 'ai_suggested', 'historical', name='fmea_item_source_enum'), default='manual')
    ai_confidence = Column(Float)

class RCAInvestigation(Base):
    """Root cause analysis investigation header."""
    __tablename__ = 'rca_investigations'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    failure_event_id = Column(UUID(as_uuid=True), ForeignKey('failure_events.id'))
    title = Column(String, nullable=False)
    method = Column(SQLEnum('five_why', 'fishbone', 'fta', 'barrier', name='rca_method_enum'), nullable=False)
    status = Column(SQLEnum('open', 'in_progress', 'review', 'closed', name='rca_status_enum'), default='open')
    problem_statement = Column(Text, nullable=False)
    root_cause_summary = Column(Text)
    investigator_id = Column(UUID(as_uuid=True))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    closed_at = Column(DateTime(timezone=True))

class RCANode(Base):
    """Node in RCA tree (5-Why chain, Fishbone branch, FTA gate)."""
    __tablename__ = 'rca_nodes'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    investigation_id = Column(UUID(as_uuid=True), ForeignKey('rca_investigations.id'), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey('rca_nodes.id'), nullable=True)
    node_type = Column(SQLEnum(
        'problem', 'why', 'cause', 'root_cause',                    # 5-Why
        'category', 'sub_cause',                                     # Fishbone
        'top_event', 'gate_and', 'gate_or', 'basic_event',          # FTA
        'barrier_failed', 'barrier_absent', 'barrier_effective',      # Barrier
        name='rca_node_type_enum'
    ), nullable=False)
    description = Column(Text, nullable=False)
    depth = Column(Integer, default=0)
    probability = Column(Float)  # for FTA gates
    fishbone_category = Column(SQLEnum(
        'man', 'machine', 'method', 'material', 'measurement', 'environment',
        name='fishbone_category_enum'
    ))
    evidence = Column(Text)
    is_root_cause = Column(Boolean, default=False)

class CriticalityAssessment(Base):
    """Semi-quantitative criticality assessment result."""
    __tablename__ = 'criticality_assessments'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.id'), nullable=False)
    consequence_safety = Column(Integer, default=1)       # 1-5
    consequence_environmental = Column(Integer, default=1) # 1-5
    consequence_production = Column(Integer, default=1)    # 1-5
    consequence_reputation = Column(Integer, default=1)    # 1-5
    consequence_financial = Column(Integer, default=1)     # 1-5
    likelihood = Column(Integer, default=1)                # 1-5
    overall_risk_score = Column(Float)                     # computed
    criticality_rank = Column(SQLEnum('A', 'B', 'C', name='crit_rank_enum'))
    assessed_by = Column(UUID(as_uuid=True))
    assessed_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    rationale = Column(Text)

    __table_args__ = (
        Index('ix_criticality_asset', 'asset_id'),
    )

class BadActorReport(Base):
    """Monthly bad actor Pareto analysis snapshot."""
    __tablename__ = 'bad_actor_reports'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_period = Column(String, nullable=False)  # "2026-01" format
    site_id = Column(UUID(as_uuid=True))
    ranking_criteria = Column(SQLEnum('cost', 'downtime', 'wo_frequency', name='bad_actor_criteria_enum'))
    top_assets = Column(JSONB, nullable=False)  # [{asset_id, rank, metric_value, trend}]
    total_assets_analyzed = Column(Integer)
    pareto_threshold_pct = Column(Float, default=80.0)
    de_campaign_drafted = Column(Boolean, default=False)
    generated_at = Column(DateTime(timezone=True), default=datetime.utcnow)
