-- ═══════════════════════════════════════════════════════════════
-- 0224 — Repair silently-failed migrations (LIVE BUG FIX)
--
-- The 2026-07-25 replay test proved that several migrations never
-- applied — not just on a replay, but on the origin database too.
-- They failed statement-by-statement years ago and nobody saw it,
-- because the Supabase SQL editor does not stop on error.
--
-- Verified missing on the origin project before writing this:
--   moddatetime extension ........ 0   (0026 depended on it)
--   update_modified_column() ..... 0   (0044 depended on it)
--   jsa_assessments/hazards triggers  0
--   contacts.default_role ........ 0   (0086 targeted it — see below)
--
-- Consequence: `updated_at` NEVER moved on six tables. Anything that
-- sorts or filters by it — "recently changed", sync watermarks,
-- optimistic-concurrency checks — has been reading the creation time.
--
-- 0026 and 0044 now define the trigger function themselves (no
-- extension dependency); this migration applies the same repair to
-- databases that already ran them. It also re-applies the columns
-- that 0025 and 0029 now skip when their dependency is missing, so a
-- database built by replaying history still ends up correct.
--
-- 0086 is NOT repaired: it targeted contacts.default_role, a column no
-- migration ever creates. It is superseded by 0158_manufacturer_master.
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. The trigger function both 0026 and 0044 assumed existed ──
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Attach the triggers that never got created ───────────────
-- Guarded per table: this migration must apply to a database built from
-- the baseline as well as one built by replaying history.
DO $$
DECLARE
    t TEXT;
    trg TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'jsa_assessments', 'jsa_hazards',
        'warranties', 'warranty_claims', 'asset_insurance', 'insurance_incidents'
    ] LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE '0224: %.updated_at trigger skipped — table absent', t;
            CONTINUE;
        END IF;
        -- Only tables that actually carry updated_at.
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = t AND column_name = 'updated_at'
        ) THEN
            RAISE NOTICE '0224: %  has no updated_at column — skipped', t;
            CONTINUE;
        END IF;

        trg := 'set_updated_at_' || t;
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg, t);
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_modified_column()',
            trg, t
        );
    END LOOP;
END $$;

-- ── 3. Re-apply what the now-guarded 0025 / 0029 skip on a replay ──
DO $$
BEGIN
    IF to_regclass('public.ers_rca_investigations') IS NOT NULL THEN
        ALTER TABLE ers_rca_investigations
            ADD COLUMN IF NOT EXISTS collaborators jsonb DEFAULT '[]'::jsonb;
    END IF;

    IF to_regclass('public.cost_centers') IS NOT NULL THEN
        ALTER TABLE work_orders     ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
        ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
        ALTER TABLE contacts        ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
        ALTER TABLE assets          ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);
    END IF;
END $$;

COMMIT;
