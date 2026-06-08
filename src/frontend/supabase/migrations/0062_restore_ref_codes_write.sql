-- Restore write access for authenticated users on reference_codes
-- (Was removed in 0061 when fixing public read access)

-- Re-create the policy that allows authenticated users to do everything (Insert, Update, Delete)
CREATE POLICY "Enable all for authenticated" ON "public"."reference_codes"
AS PERMISSIVE FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
