-- Create 'assets' bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: Allow public read access to assets
CREATE POLICY "Asset images are publicly accessible"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'assets' );

-- Policy: Allow authenticated users to upload to assets
CREATE POLICY "Anyone can upload an asset image"
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'assets' AND auth.role() = 'authenticated' );

-- Policy: Allow authenticated users to update asset images
CREATE POLICY "Anyone can update an asset image"
  ON storage.objects FOR UPDATE
  WITH CHECK ( bucket_id = 'assets' AND auth.role() = 'authenticated' );
