-- 0071_sync_eam_schema.sql
-- ============================================================
-- FULL SCHEMA SYNC: EAM (ykjoksozyvjnxzpsqohp) → ERS (hacrebcfvyqdnjvilhqc)
--
-- This migration:
--   1. Updates 2 enums with missing values
--   2. Adds 43 missing columns to 7 existing tables
--   3. Creates 32 missing tables (dependency-ordered)
--   4. Adds FK constraints
--   5. Enables RLS + policies on all new tables
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- STEP 1: ENUM UPDATES
-- ═══════════════════════════════════════════════════════════

-- hierarchy_level: add ENTERPRISE, SUBUNIT, MAINTAINABLE_ITEM
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='ENTERPRISE' AND enumtypid='hierarchy_level'::regtype) THEN
    ALTER TYPE hierarchy_level ADD VALUE 'ENTERPRISE';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='SUBUNIT' AND enumtypid='hierarchy_level'::regtype) THEN
    ALTER TYPE hierarchy_level ADD VALUE 'SUBUNIT';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='MAINTAINABLE_ITEM' AND enumtypid='hierarchy_level'::regtype) THEN
    ALTER TYPE hierarchy_level ADD VALUE 'MAINTAINABLE_ITEM';
  END IF;
END $$;

-- wo_status: add PLAN, SCHEDULED, HOLD, REVIEW, COMP
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='PLAN' AND enumtypid='wo_status'::regtype) THEN
    ALTER TYPE wo_status ADD VALUE 'PLAN';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='SCHEDULED' AND enumtypid='wo_status'::regtype) THEN
    ALTER TYPE wo_status ADD VALUE 'SCHEDULED';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='HOLD' AND enumtypid='wo_status'::regtype) THEN
    ALTER TYPE wo_status ADD VALUE 'HOLD';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='REVIEW' AND enumtypid='wo_status'::regtype) THEN
    ALTER TYPE wo_status ADD VALUE 'REVIEW';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='COMP' AND enumtypid='wo_status'::regtype) THEN
    ALTER TYPE wo_status ADD VALUE 'COMP';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- STEP 2: ADD MISSING COLUMNS TO EXISTING TABLES
-- ═══════════════════════════════════════════════════════════

-- assets (missing: properties)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::jsonb;

-- budgets (missing: status, monthly_data)
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'DRAFT';
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS monthly_data JSONB DEFAULT '{}'::jsonb;

-- inventory_items (missing: 19 columns)
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS uom TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT FALSE;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::jsonb;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS comments TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost_center_id UUID;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS default_warranty_months INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS warranty_from_install BOOLEAN DEFAULT FALSE;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS is_capital_spare BOOLEAN DEFAULT FALSE;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS depreciation_method TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS salvage_value NUMERIC DEFAULT 0;

-- service_requests (missing: rejection_reason, rejected_by, rejected_at)
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS rejected_by UUID;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- work_orders (missing: 14 columns)
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cost_center TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS date_due_start DATE;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS cost_center_id UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::jsonb;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS total_actual_cost NUMERIC DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS frozen_total_cost NUMERIC DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS reviewed_by UUID;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS review_notes TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS est_duration INTEGER DEFAULT 0;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS scope TEXT;

-- asset_financials (missing: downtime_cost_per_hour, warranty_start_date, warranty_end_date)
ALTER TABLE asset_financials ADD COLUMN IF NOT EXISTS downtime_cost_per_hour NUMERIC DEFAULT 0;
ALTER TABLE asset_financials ADD COLUMN IF NOT EXISTS warranty_start_date DATE;
ALTER TABLE asset_financials ADD COLUMN IF NOT EXISTS warranty_end_date DATE;

-- asset_insurance (missing: end_date)
ALTER TABLE asset_insurance ADD COLUMN IF NOT EXISTS end_date DATE;

-- ═══════════════════════════════════════════════════════════
-- STEP 3: CREATE 32 MISSING TABLES (dependency-ordered)
-- ═══════════════════════════════════════════════════════════

-- ─── TIER 1: No FK deps on missing tables ─────────────────

CREATE TABLE IF NOT EXISTS entity_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT,
    size_bytes BIGINT,
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    bins JSONB DEFAULT '[]'::jsonb,
    code TEXT,
    address TEXT
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    entry TEXT NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_system BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS manufacturer_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES contacts(id),
    model_code TEXT NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    subject_template TEXT,
    body_template TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moc_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    moc_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    change_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    current_value TEXT,
    proposed_value TEXT,
    justification TEXT NOT NULL,
    risk_assessment TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    requested_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    implemented_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    review_notes TEXT,
    rejection_reason TEXT,
    approval_conditions TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    config_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id TEXT,
    channel TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    status TEXT DEFAULT 'SENT',
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL,
    event_trigger TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    severity TEXT NOT NULL,
    filters JSONB DEFAULT '[]'::jsonb,
    recipients JSONB DEFAULT '[]'::jsonb,
    channels JSONB DEFAULT '[]'::jsonb,
    escalation_timeout_minutes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id TEXT NOT NULL,
    recipient_role TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    module TEXT NOT NULL,
    entity_id TEXT,
    entity_type TEXT,
    entity_number TEXT,
    action_link TEXT,
    action_required BOOLEAN DEFAULT FALSE,
    escalation_level INTEGER DEFAULT 0,
    escalation_deadline TIMESTAMPTZ,
    parent_notification_id UUID,
    is_read BOOLEAN DEFAULT FALSE,
    is_acknowledged BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS organization_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    parent_id UUID,
    manager_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_code TEXT NOT NULL,
    status TEXT NOT NULL,
    supplier_id UUID,
    date_created DATE DEFAULT CURRENT_DATE,
    date_required DATE,
    tax_inclusive BOOLEAN DEFAULT TRUE,
    currency TEXT DEFAULT 'USD',
    created_by TEXT,
    authorized_by_id TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    supplier_contact_name TEXT,
    delivery_contact_id TEXT,
    invoice_contact_id TEXT,
    reference TEXT,
    comments TEXT,
    date_finished DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qualifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID NOT NULL REFERENCES contacts(id),
    name TEXT NOT NULL,
    type TEXT,
    date_achieved DATE,
    date_expires DATE,
    status TEXT DEFAULT 'Active',
    image_url TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reading_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID NOT NULL REFERENCES assets(id),
    reading_type_code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT,
    category TEXT,
    min_critical NUMERIC(10,2),
    min_warning NUMERIC(10,2),
    max_warning NUMERIC(10,2),
    max_critical NUMERIC(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recurring_work (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'ACTIVE',
    asset_id TEXT NOT NULL,
    schedule_type TEXT NOT NULL,
    frequency_interval INTEGER NOT NULL,
    frequency_unit TEXT NOT NULL,
    lead_time_days INTEGER DEFAULT 7,
    job_type TEXT NOT NULL,
    priority_code TEXT NOT NULL,
    est_duration INTEGER DEFAULT 0,
    est_downtime INTEGER DEFAULT 0,
    last_generated_date TIMESTAMPTZ,
    next_due_date TIMESTAMPTZ,
    active BOOLEAN DEFAULT TRUE,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    est_labor_cost NUMERIC(10,2) DEFAULT 0,
    est_material_cost NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reference_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    is_locked BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    properties JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    category_ref TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    color_code TEXT,
    sort_order INTEGER
);

CREATE TABLE IF NOT EXISTS task_library_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    estimated_duration_hours NUMERIC(10,2) DEFAULT 0,
    instructions JSONB DEFAULT '[]'::jsonb,
    safety_requirements JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    type TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    payment_terms TEXT,
    currency TEXT DEFAULT 'USD',
    hourly_rate NUMERIC(10,2),
    contact_details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TIER 2: FK to Tier 1 tables ──────────────────────────

CREATE TABLE IF NOT EXISTS inventory_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID NOT NULL REFERENCES inventory_items(id),
    location_id UUID NOT NULL REFERENCES inventory_locations(id),
    quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
    bin_location TEXT,
    min_level NUMERIC(10,2),
    max_level NUMERIC(10,2),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    reorder_qty NUMERIC DEFAULT 10,
    qty_on_order NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jsa_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id UUID NOT NULL REFERENCES work_orders(id),
    status TEXT NOT NULL,
    permits JSONB DEFAULT '[]'::jsonb,
    signoffs JSONB DEFAULT '[]'::jsonb,
    created_by UUID,
    authorized_by UUID,
    authorized_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS organization_unit_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_unit_id UUID NOT NULL REFERENCES organization_units(id),
    contact_id UUID NOT NULL REFERENCES contacts(id),
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reading_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    definition_id UUID NOT NULL REFERENCES reading_definitions(id),
    asset_id UUID NOT NULL REFERENCES assets(id),
    reading_type_code TEXT NOT NULL,
    reading_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reading_time TIME DEFAULT '00:00:00'::time,
    reading_value NUMERIC(10,2) NOT NULL,
    delta NUMERIC(10,2),
    entered_by TEXT,
    comments TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_alarm BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_library_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES task_library_items(id),
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    uploaded_by TEXT
);

CREATE TABLE IF NOT EXISTS task_library_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES task_library_items(id),
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
    quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS task_library_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES task_library_items(id),
    role_code TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    estimated_hours NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id UUID NOT NULL REFERENCES work_orders(id),
    sequence INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    est_hours NUMERIC(5,2) DEFAULT 0,
    est_start_date DATE,
    est_finish_date DATE,
    est_start_time TIME,
    est_finish_time TIME,
    actual_hours NUMERIC(5,2),
    actual_start_date DATE,
    actual_finish_date DATE,
    actual_start_time TIME,
    actual_finish_time TIME,
    instructions JSONB DEFAULT '[]'::jsonb,
    assigned_user_ids JSONB DEFAULT '[]'::jsonb,
    assigned_org_unit_ids JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    predecessor_task_id UUID
);

-- ─── TIER 3: FK to Tier 2 tables ──────────────────────────

CREATE TABLE IF NOT EXISTS jsa_hazards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jsa_id UUID NOT NULL REFERENCES jsa_assessments(id),
    hazard TEXT NOT NULL,
    risk_score TEXT NOT NULL,
    controls TEXT NOT NULL,
    task_ref_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS ptw_permits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jsa_id UUID NOT NULL REFERENCES jsa_assessments(id),
    permit_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    permit_number TEXT,
    description TEXT,
    safety_requirements JSONB DEFAULT '[]'::jsonb,
    ppe_requirements JSONB DEFAULT '[]'::jsonb,
    certificates_required JSONB DEFAULT '[]'::jsonb,
    environmental_conditions TEXT,
    validity_start TIMESTAMPTZ,
    validity_end TIMESTAMPTZ,
    permit_holder_id UUID,
    issuer_id UUID,
    receiver_id UUID,
    toolbox_talk_completed BOOLEAN DEFAULT FALSE,
    toolbox_talk_notes TEXT,
    return_notes TEXT,
    returned_at TIMESTAMPTZ,
    returned_by UUID,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS work_order_labor (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id UUID NOT NULL REFERENCES work_orders(id),
    contact_id UUID REFERENCES users(id),
    contact_type_code TEXT NOT NULL,
    date_worked DATE NOT NULL DEFAULT CURRENT_DATE,
    hours_worked NUMERIC(5,2) NOT NULL DEFAULT 0,
    rate_per_hour NUMERIC(10,2) DEFAULT 0,
    total_cost NUMERIC(10,2) DEFAULT 0,
    notes TEXT,
    job_task_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_order_parts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wo_id UUID NOT NULL REFERENCES work_orders(id),
    item_id UUID REFERENCES inventory_items(id),
    quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_cost NUMERIC(10,2) DEFAULT 0,
    total_cost NUMERIC(10,2) DEFAULT 0,
    notes TEXT,
    job_task_id UUID,
    is_planned BOOLEAN DEFAULT TRUE,
    date_used DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── TIER 4: FK to Tier 3 tables ──────────────────────────

CREATE TABLE IF NOT EXISTS ptw_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permit_id UUID NOT NULL REFERENCES ptw_permits(id),
    approver_id UUID,
    role TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT 'PENDING',
    comments TEXT,
    decided_at TIMESTAMPTZ,
    sequence INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS ptw_isolation_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permit_id UUID NOT NULL REFERENCES ptw_permits(id),
    tag_number TEXT NOT NULL,
    isolation_type TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'LOCK',
    normal_position TEXT DEFAULT 'OPEN',
    isolated_position TEXT DEFAULT 'CLOSED',
    isolated_by UUID,
    isolated_at TIMESTAMPTZ,
    verified_by UUID,
    verified_at TIMESTAMPTZ,
    de_isolated_by UUID,
    de_isolated_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'PENDING',
    sequence INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- ═══════════════════════════════════════════════════════════
-- STEP 4: DEFERRED FK CONSTRAINTS (self-references, etc.)
-- ═══════════════════════════════════════════════════════════

-- organization_units self-reference
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='organization_units_parent_id_fkey' AND table_name='organization_units') THEN
    ALTER TABLE organization_units ADD CONSTRAINT organization_units_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES organization_units(id);
  END IF;
END $$;

-- notifications self-reference
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='notifications_parent_notification_id_fkey' AND table_name='notifications') THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_parent_notification_id_fkey FOREIGN KEY (parent_notification_id) REFERENCES notifications(id);
  END IF;
END $$;

-- job_tasks self-reference (predecessor)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='job_tasks_predecessor_task_id_fkey' AND table_name='job_tasks') THEN
    ALTER TABLE job_tasks ADD CONSTRAINT job_tasks_predecessor_task_id_fkey FOREIGN KEY (predecessor_task_id) REFERENCES job_tasks(id);
  END IF;
END $$;

-- work_order_labor -> job_tasks FK
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='work_order_labor_job_task_id_fkey' AND table_name='work_order_labor') THEN
    ALTER TABLE work_order_labor ADD CONSTRAINT work_order_labor_job_task_id_fkey FOREIGN KEY (job_task_id) REFERENCES job_tasks(id);
  END IF;
END $$;

-- work_order_parts -> job_tasks FK
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name='work_order_parts_job_task_id_fkey' AND table_name='work_order_parts') THEN
    ALTER TABLE work_order_parts ADD CONSTRAINT work_order_parts_job_task_id_fkey FOREIGN KEY (job_task_id) REFERENCES job_tasks(id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════
-- STEP 5: ENABLE RLS + POLICIES ON ALL NEW TABLES
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY[
    'entity_files','inventory_locations','inventory_stock','job_tasks',
    'journal_entries','jsa_assessments','jsa_hazards','manufacturer_models',
    'message_templates','moc_requests','notification_channels','notification_logs',
    'notification_rules','notifications','organization_unit_members','organization_units',
    'ptw_approvals','ptw_isolation_points','ptw_permits','purchase_orders',
    'qualifications','reading_definitions','reading_logs','recurring_work',
    'reference_codes','task_library_files','task_library_inventory','task_library_items',
    'task_library_roles','vendors','work_order_labor','work_order_parts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'Enable all for authenticated'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "Enable all for authenticated" ON %I FOR ALL USING (auth.role() = ''authenticated'')',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════
