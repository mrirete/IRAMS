-- Enable read access for everyone on reference_codes
DROP POLICY IF EXISTS "Enable all for authenticated" ON reference_codes;
CREATE POLICY "Enable read access for all" ON reference_codes FOR SELECT USING (true);
