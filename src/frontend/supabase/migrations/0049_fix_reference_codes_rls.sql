-- Enable RLS on reference_codes
ALTER TABLE reference_codes ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (for now, to unblock seeding and admin)
-- ideally this should be tighter (e.g. only admins can write)
CREATE POLICY "Allow all operations for authenticated users" 
ON reference_codes 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- Allow read access for everyone (including anon if needed for public pages, though mostly auth is required)
CREATE POLICY "Allow read access for all users" 
ON reference_codes 
FOR SELECT 
TO public 
USING (true);
