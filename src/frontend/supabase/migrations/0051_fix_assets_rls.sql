-- Allow anonymous read access to assets for development
-- (The app currently uses the anon key without user auth)
DO $$
BEGIN
  -- Drop existing restrictive policy if it exists
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'assets' AND policyname = 'Enable read for anon'
  ) THEN
    DROP POLICY "Enable read for anon" ON assets;
  END IF;
END $$;

CREATE POLICY "Enable read for anon"
  ON assets FOR SELECT
  USING (true);

-- Also allow insert/update for anon during dev
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'assets' AND policyname = 'Enable write for anon'
  ) THEN
    DROP POLICY "Enable write for anon" ON assets;
  END IF;
END $$;

CREATE POLICY "Enable write for anon"
  ON assets FOR ALL
  USING (true)
  WITH CHECK (true);
