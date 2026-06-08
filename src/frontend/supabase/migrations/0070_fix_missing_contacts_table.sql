-- 0070_fix_missing_contacts_table.sql
-- ============================================================
-- FIX: Create 'public.contacts' table if it does not exist.
--
-- ROOT CAUSE: The trigger 'handle_new_user()' (0002_auto_link_users.sql)
-- queries 'public.contacts' on every auth.users INSERT. If the table
-- was never created, Supabase returns:
--   "Could not find the table 'public.contacts' in the schema cache"
--
-- This migration consolidates columns from:
--   0001_create_contacts.sql (base table)
--   0003_add_permission_flags.sql (can_login, can_submit_requests, etc.)
--   0003_contact_expansion.sql (custom_fields, labor_rules)
--   0020_create_org_structure.sql (organization_unit_id)
--   0029_add_contact_parent_id.sql (parent_id + re-ensure columns)
-- ============================================================

-- 1. Create contacts table (IF NOT EXISTS to be idempotent)
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),

    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,

    email TEXT,
    phone TEXT,
    mobile TEXT,

    title TEXT,

    -- Organization
    company_name TEXT,
    department TEXT,
    cost_center TEXT,

    -- Attributes
    is_active BOOLEAN DEFAULT TRUE,
    is_vendor BOOLEAN DEFAULT FALSE,
    is_employee BOOLEAN DEFAULT TRUE,

    -- Roles (Array of Dictionary Codes)
    roles TEXT[] DEFAULT '{}',

    -- Financials for Labor
    hourly_rate NUMERIC(10, 2) DEFAULT 0,
    currency TEXT DEFAULT 'USD',

    address JSONB,
    billing_address JSONB,

    image_url TEXT,
    comments TEXT,

    -- Permission flags (from 0003_add_permission_flags)
    can_login BOOLEAN DEFAULT FALSE,
    can_submit_requests BOOLEAN DEFAULT FALSE,
    can_log_time BOOLEAN DEFAULT FALSE,
    has_qualifications BOOLEAN DEFAULT FALSE,

    -- JSONB extensions (from 0003_contact_expansion)
    custom_fields JSONB DEFAULT '{}',
    labor_rules JSONB DEFAULT '{}',

    -- Hierarchy (from 0029_add_contact_parent_id)
    parent_id UUID,  -- Self-referencing FK added after table creation

    -- Org Unit link (from 0020_create_org_structure)
    organization_unit_id UUID,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Add self-reference FK for parent_id (safe with IF NOT EXISTS pattern)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'contacts_parent_id_fkey'
        AND table_name = 'contacts'
    ) THEN
        ALTER TABLE contacts
        ADD CONSTRAINT contacts_parent_id_fkey
        FOREIGN KEY (parent_id) REFERENCES contacts(id);
    END IF;
END $$;

-- 3. Add Org Unit FK (only if organization_units table exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'organization_units'
    ) THEN
        -- Drop existing constraint if any
        ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_organization_unit_id_fkey;
        -- Add with ON DELETE SET NULL
        ALTER TABLE contacts
        ADD CONSTRAINT contacts_organization_unit_id_fkey
        FOREIGN KEY (organization_unit_id)
        REFERENCES organization_units(id)
        ON DELETE SET NULL;
    END IF;
END $$;

-- 4. Add cost_center_id FK (only if cost_centers table exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'cost_centers'
    ) THEN
        ALTER TABLE contacts
        ADD COLUMN IF NOT EXISTS cost_center_id UUID;

        -- Add FK only if not already present
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'contacts_cost_center_id_fkey'
            AND table_name = 'contacts'
        ) THEN
            ALTER TABLE contacts
            ADD CONSTRAINT contacts_cost_center_id_fkey
            FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id);
        END IF;
    END IF;
END $$;

-- 5. Enable RLS
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS Policy (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'contacts' AND policyname = 'Enable all for authenticated'
    ) THEN
        CREATE POLICY "Enable all for authenticated" ON contacts
        FOR ALL USING (auth.role() = 'authenticated');
    END IF;
END $$;

-- 7. Create Audit Trigger (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'audit_contacts_changes'
    ) THEN
        CREATE TRIGGER audit_contacts_changes
        AFTER INSERT OR UPDATE OR DELETE ON contacts
        FOR EACH ROW EXECUTE FUNCTION log_audit_event();
    END IF;
END $$;

-- 8. Re-create the handle_new_user trigger function to be robust
-- This version won't fail if contacts table has no matching email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  linked_contact_id UUID;
  user_role text[];
  contact_username text;
BEGIN
  -- 1. Try to find a pre-seeded contact by email
  BEGIN
    SELECT id, roles INTO linked_contact_id, user_role
    FROM public.contacts
    WHERE email = NEW.email
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    linked_contact_id := NULL;
    user_role := NULL;
  END;

  -- 2. Derive username from email (everything before @)
  contact_username := split_part(NEW.email, '@', 1);

  -- 3. Insert into public.users (ON CONFLICT to prevent duplicates)
  INSERT INTO public.users (id, username, email, contact_id, status, roles)
  VALUES (
    NEW.id,
    contact_username,
    NEW.email,
    linked_contact_id,
    'active',
    to_jsonb(COALESCE(user_role, ARRAY['TECHNICIAN']))
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Re-create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
