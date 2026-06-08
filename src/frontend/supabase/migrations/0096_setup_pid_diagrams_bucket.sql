-- Create 'pid-diagrams' bucket for P&ID background images
INSERT INTO storage.buckets (id, name, public)
VALUES ('pid-diagrams', 'pid-diagrams', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to READ objects
CREATE POLICY "Allow public read on pid-diagrams"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'pid-diagrams' );

-- Allow authenticated users to INSERT objects
CREATE POLICY "Allow authenticated insert on pid-diagrams"
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'pid-diagrams' AND auth.role() = 'authenticated' );

-- Allow authenticated users to UPDATE objects
CREATE POLICY "Allow authenticated update on pid-diagrams"
  ON storage.objects FOR UPDATE
  WITH CHECK ( bucket_id = 'pid-diagrams' AND auth.role() = 'authenticated' );
