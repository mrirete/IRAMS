"""initial schema

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-02-20 09:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '001_initial_schema'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    # --- Data Fabric ---
    op.create_table('assets',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('external_id', sa.String(), index=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.Text()),
        sa.Column('asset_class', sa.String()),
        sa.Column('criticality_rank', sa.Enum('A', 'B', 'C', name='criticality_enum')),
        sa.Column('parent_asset_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assets.id'), nullable=True),
        sa.Column('source_system', sa.String()),
        sa.Column('taxonomy_code', sa.String()),
        sa.Column('location', sa.String()),
        sa.Column('lat', sa.Float()),
        sa.Column('lon', sa.Float()),
        sa.Column('commissioning_date', sa.DateTime(timezone=True)),
        sa.Column('design_life_years', sa.Integer()),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True))
    )

    op.create_table('asset_hierarchy',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('parent_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assets.id')),
        sa.Column('child_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assets.id')),
        sa.Column('relationship_type', sa.Enum('contains', 'feeds', 'serves', 'protects', name='hierarchy_rel_enum')),
        sa.Column('source', sa.Enum('manual', 'pid_parser', 'cmms_sync', 'knowledge_graph', name='hierarchy_source_enum')),
        sa.Column('confidence', sa.Float()),
        sa.Column('validated_by', postgresql.UUID(as_uuid=True)),
        sa.Column('validated_at', sa.DateTime(timezone=True))
    )

    op.create_table('data_sources',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('source_type', sa.Enum('cmms', 'historian', 'scada', 'iot', 'erp', 'file', 'mes', name='datasource_type_enum')),
        sa.Column('connection_config', postgresql.JSONB(astext_type=sa.Text())),
        sa.Column('status', sa.Enum('active', 'error', 'disabled', name='datasource_status_enum')),
        sa.Column('last_sync_at', sa.DateTime(timezone=True)),
        sa.Column('sync_interval_seconds', sa.Integer())
    )

    op.create_table('data_quality_scores',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('asset_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assets.id')),
        sa.Column('source_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('data_sources.id')),
        sa.Column('record_type', sa.String()),
        sa.Column('completeness', sa.Float()),
        sa.Column('accuracy', sa.Float()),
        sa.Column('timeliness', sa.Float()),
        sa.Column('consistency', sa.Float()),
        sa.Column('composite', sa.Float()),
        sa.Column('scored_at', sa.DateTime(timezone=True))
    )
    op.create_index('ix_dqs_asset_scored_at', 'data_quality_scores', ['asset_id', 'scored_at'])

    op.create_table('audit_trail',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('action', sa.Enum('create', 'update', 'delete', 'approve', 'reject', 'execute', name='audit_action_enum')),
        sa.Column('actor_id', postgresql.UUID(as_uuid=True)),
        sa.Column('actor_type', sa.Enum('user', 'system', 'ai_agent', name='actor_type_enum')),
        sa.Column('governance_tier', sa.Integer()),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text())),
        sa.Column('ai_confidence', sa.Float()),
        sa.Column('ai_model', sa.String()),
        sa.Column('ai_rationale', sa.Text()),
        sa.Column('ip_address', sa.String()),
        sa.Column('timestamp', sa.DateTime(timezone=True), index=True)
    )

    op.create_table('knowledge_graph_nodes',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('node_type', sa.Enum('asset', 'failure_mode', 'cause', 'effect', 'person', 'competency', 'standard_clause', 'kpi', 'department', name='kg_node_type_enum')),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('properties', postgresql.JSONB(astext_type=sa.Text())),
        sa.Column('source_module', sa.String()),
        sa.Column('created_at', sa.DateTime(timezone=True))
    )

    op.create_table('knowledge_graph_edges',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('source_node_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('knowledge_graph_nodes.id')),
        sa.Column('target_node_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('knowledge_graph_nodes.id')),
        sa.Column('edge_type', sa.Enum('causes', 'affects', 'maintains', 'owns', 'measures', 'cascades', 'requires_competency', 'serves_stakeholder', name='kg_edge_type_enum')),
        sa.Column('weight', sa.Float()),
        sa.Column('properties', postgresql.JSONB(astext_type=sa.Text()))
    )
    op.create_index('ix_kg_edges_source_target', 'knowledge_graph_edges', ['source_node_id', 'target_node_id'])

    op.create_table('digital_twin_state',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('asset_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assets.id')),
        sa.Column('twin_type', sa.Enum('single_asset', 'system', name='twin_type_enum')),
        sa.Column('health_index', sa.Float()),
        sa.Column('degradation_model', postgresql.JSONB(astext_type=sa.Text())),
        sa.Column('last_calibrated_at', sa.DateTime(timezone=True)),
        sa.Column('calibration_drift', sa.Float()),
        sa.Column('state_snapshot', postgresql.JSONB(astext_type=sa.Text())),
        sa.Column('updated_at', sa.DateTime(timezone=True))
    )

    # --- AIM ---
    op.create_table('equipment_registry',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('asset_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('assets.id')),
        sa.Column('governing_code', sa.Enum('api_510', 'api_570', 'api_653', 'asme_b31_3', name='governing_code_enum')),
        sa.Column('national_board_number', sa.String()),
        sa.Column('design_pressure', sa.Float()),
        sa.Column('design_temperature', sa.Float()),
        sa.Column('mdmt', sa.Float()),
        sa.Column('mawp', sa.Float()),
        sa.Column('material_spec', sa.String()),
        sa.Column('material_grade', sa.String()),
        sa.Column('corrosion_allowance', sa.Float()),
        sa.Column('nominal_thickness', sa.Float()),
        sa.Column('installation_date', sa.DateTime(timezone=True)),
        sa.Column('last_internal_inspection', sa.DateTime(timezone=True)),
        sa.Column('last_external', sa.DateTime(timezone=True)),
        sa.Column('next_inspection_due', sa.DateTime(timezone=True), index=True),
        sa.Column('rbi_assessment_id', postgresql.UUID(as_uuid=True)),
        sa.Column('created_at', sa.DateTime(timezone=True)),
        sa.Column('updated_at', sa.DateTime(timezone=True))
    )

    op.create_table('condition_monitoring_locations',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('equipment_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('equipment_registry.id')),
        sa.Column('cml_number', sa.String(), nullable=False),
        sa.Column('location_description', sa.Text()),
        sa.Column('component_type', sa.Enum('shell', 'head', 'nozzle', 'piping_elbow', 'piping_straight', 'piping_tee', 'weld', 'tank_shell_course', 'tank_floor', 'tank_roof', name='component_type_enum')),
        sa.Column('nominal_thickness', sa.Float()),
        sa.Column('retirement_thickness', sa.Float()),
        sa.Column('min_required_thickness', sa.Float()),
        sa.Column('corrosion_loop_id', postgresql.UUID(as_uuid=True))
    )

    op.create_table('thickness_readings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('cml_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('condition_monitoring_locations.id')),
        sa.Column('reading_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('measured_thickness', sa.Float(), nullable=False),
        sa.Column('method', sa.Enum('ut_contact', 'ut_compression', 'ut_shear', 'paut', 'scan', name='ut_method_enum')),
        sa.Column('inspector_id', postgresql.UUID(as_uuid=True)),
        sa.Column('inspector_cert_verified', sa.Boolean()),
        sa.Column('notes', sa.Text())
    )
    op.create_index('ix_thickness_readings_cml_date', 'thickness_readings', ['cml_id', 'reading_date'])

    op.create_table('corrosion_rates',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('cml_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('condition_monitoring_locations.id')),
        sa.Column('calculated_date', sa.DateTime(timezone=True)),
        sa.Column('short_term_rate', sa.Float()),
        sa.Column('long_term_rate', sa.Float()),
        sa.Column('max_observed_rate', sa.Float()),
        sa.Column('remaining_life_years', sa.Float()),
        sa.Column('rate_type', sa.Enum('general', 'localized', 'pitting', name='corrosion_rate_type_enum'))
    )

    op.create_table('damage_mechanisms',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('equipment_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('equipment_registry.id')),
        sa.Column('api_571_code', sa.String()),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('status', sa.Enum('active', 'susceptible', 'latent', 'not_applicable', name='damage_mech_status_enum')),
        sa.Column('confidence', sa.Float()),
        sa.Column('source', sa.Enum('ai_suggested', 'engineer_confirmed', 'historical', name='damage_mech_source_enum')),
        sa.Column('reviewed_by', postgresql.UUID(as_uuid=True)),
        sa.Column('reviewed_at', sa.DateTime(timezone=True))
    )

    op.create_table('ffs_assessments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('equipment_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('equipment_registry.id')),
        sa.Column('api_579_part', sa.String()),
        sa.Column('damage_type', sa.String()),
        sa.Column('assessment_level', sa.Enum('level_1', 'level_2', 'level_3', name='ffs_level_enum')),
        sa.Column('status', sa.Enum('in_progress', 'passed', 'failed', 'remediation_required', 'monitoring', name='ffs_status_enum')),
        sa.Column('rsf_calculated', sa.Float()),
        sa.Column('mawp_derated', sa.Float()),
        sa.Column('remaining_life', sa.Float()),
        sa.Column('assessor_id', postgresql.UUID(as_uuid=True)),
        sa.Column('reviewer_id', postgresql.UUID(as_uuid=True)),
        sa.Column('approved_at', sa.DateTime(timezone=True)),
        sa.Column('governance_tier', sa.Integer())
    )

    op.create_table('integrity_operating_windows',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('equipment_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('equipment_registry.id')),
        sa.Column('parameter_name', sa.String(), nullable=False),
        sa.Column('parameter_tag', sa.String()),
        sa.Column('iow_type', sa.Enum('critical', 'standard', 'informational', name='iow_type_enum')),
        sa.Column('low_limit', sa.Float()),
        sa.Column('high_limit', sa.Float()),
        sa.Column('unit', sa.String()),
        sa.Column('linked_damage_mech', postgresql.UUID(as_uuid=True), sa.ForeignKey('damage_mechanisms.id')),
        sa.Column('monitoring_active', sa.Boolean())
    )

    op.create_table('iow_exceedances',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('iow_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('integrity_operating_windows.id')),
        sa.Column('start_time', sa.DateTime(timezone=True), index=True),
        sa.Column('end_time', sa.DateTime(timezone=True)),
        sa.Column('duration_min', sa.Float()),
        sa.Column('max_deviation', sa.Float()),
        sa.Column('acknowledged_by', postgresql.UUID(as_uuid=True)),
        sa.Column('action_taken', sa.Text())
    )

    op.create_table('integrity_audits',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('audit_type', sa.Enum('routine', 'turnaround', 'regulatory', 'incident', 'management', name='audit_type_enum')),
        sa.Column('scope_description', sa.Text()),
        sa.Column('auditor_id', postgresql.UUID(as_uuid=True)),
        sa.Column('start_date', sa.DateTime(timezone=True)),
        sa.Column('end_date', sa.DateTime(timezone=True)),
        sa.Column('status', sa.Enum('planned', 'in_progress', 'completed', 'closed', name='audit_status_enum')),
        sa.Column('regulatory_preparedness_score', sa.Float())
    )

    op.create_table('audit_findings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('audit_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('integrity_audits.id')),
        sa.Column('equipment_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('equipment_registry.id'), nullable=True),
        sa.Column('finding_type', sa.Enum('observation', 'recommendation', 'non_conformance', 'critical', name='finding_type_enum'), index=True),
        sa.Column('description', sa.Text()),
        sa.Column('evidence_refs', postgresql.JSONB(astext_type=sa.Text())),
        sa.Column('ai_generated', sa.Boolean()),
        sa.Column('ai_confidence', sa.Float()),
        sa.Column('auditor_confirmed', sa.Boolean()),
        sa.Column('corrective_action_id', postgresql.UUID(as_uuid=True))
    )

    op.create_table('corrective_actions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('finding_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('audit_findings.id')),
        sa.Column('description', sa.Text()),
        sa.Column('owner_id', postgresql.UUID(as_uuid=True)),
        sa.Column('due_date', sa.DateTime(timezone=True)),
        sa.Column('priority', sa.Enum('immediate', 'high', 'medium', 'low', name='ca_priority_enum')),
        sa.Column('status', sa.Enum('open', 'in_progress', 'completed', 'verified', 'overdue', name='ca_status_enum')),
        sa.Column('work_order_id', postgresql.UUID(as_uuid=True)),
        sa.Column('verified_by', postgresql.UUID(as_uuid=True)),
        sa.Column('validated_at', sa.DateTime(timezone=True))
    )

def downgrade() -> None:
    # Drop AIM
    op.drop_table('corrective_actions')
    op.drop_table('audit_findings')
    op.drop_table('integrity_audits')
    op.drop_table('iow_exceedances')
    op.drop_table('integrity_operating_windows')
    op.drop_table('ffs_assessments')
    op.drop_table('damage_mechanisms')
    op.drop_table('corrosion_rates')
    op.drop_table('thickness_readings')
    op.drop_table('condition_monitoring_locations')
    op.drop_table('equipment_registry')

    # Drop Data Fabric
    op.drop_table('digital_twin_state')
    op.drop_table('knowledge_graph_edges')
    op.drop_table('knowledge_graph_nodes')
    op.drop_table('audit_trail')
    op.drop_table('data_quality_scores')
    op.drop_table('data_sources')
    op.drop_table('asset_hierarchy')
    op.drop_table('assets')

    # Drop Enums
    sa.Enum(name='ca_status_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='ca_priority_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='finding_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='audit_status_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='audit_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='iow_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='ffs_status_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='ffs_level_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='damage_mech_source_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='damage_mech_status_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='corrosion_rate_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='ut_method_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='component_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='governing_code_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='twin_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='kg_edge_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='kg_node_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='actor_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='audit_action_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='datasource_status_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='datasource_type_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='hierarchy_source_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='hierarchy_rel_enum').drop(op.get_bind(), checkfirst=True)
    sa.Enum(name='criticality_enum').drop(op.get_bind(), checkfirst=True)
