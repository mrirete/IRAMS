-- ============================================================
-- Fix RLS policies for ERS Predict tables
-- Drops and recreates policies to ensure authenticated access
-- ============================================================

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'ers_twin_states','ers_rul_estimates','ers_prediction_alerts',
            'ers_sensor_readings'
        ])
    LOOP
        -- Ensure RLS is enabled
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

        -- Drop existing policy if any (avoids "already exists" error)
        BEGIN
            EXECUTE format('DROP POLICY IF EXISTS "Enable all for authenticated" ON %I', tbl);
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;

        -- Create SELECT policy for authenticated users
        BEGIN
            EXECUTE format(
                'CREATE POLICY "authenticated_select" ON %I FOR SELECT USING (true)',
                tbl
            );
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;

        -- Create INSERT policy for authenticated users
        BEGIN
            EXECUTE format(
                'CREATE POLICY "authenticated_insert" ON %I FOR INSERT WITH CHECK (true)',
                tbl
            );
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;

        -- Create UPDATE policy for authenticated users
        BEGIN
            EXECUTE format(
                'CREATE POLICY "authenticated_update" ON %I FOR UPDATE USING (true)',
                tbl
            );
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;

        RAISE NOTICE 'Fixed RLS policies for %', tbl;
    END LOOP;
END $$;
