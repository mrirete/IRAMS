-- 0281 — Storage buckets go private, and tenant-scoped.
--
-- THE HOLE: all four buckets carried `public = true`. A public bucket serves
-- every object over an unauthenticated URL — no JWT, no RLS, no session. The
-- SELECT policies written in 0028/0084/0096 were decorative for reads: they
-- also granted to the `public` role (no TO clause), and `public = true`
-- bypasses storage RLS on the read path regardless. So plant P&ID diagrams,
-- work-order documents, JSA sign-off signatures and employee photographs were
-- readable by anyone holding — or guessing — a URL. Object names are
-- `Date.now()` + a short base36 suffix, not UUIDs, so guessing is not absurd.
--
-- Mapped to: ISO 27001 A.8.3 / A.5.15 / A.8.12, SOC 2 CC6.1 / CC6.6 / C1.1,
-- GDPR Art. 32 and Art. 25 ("by default"). The avatars bucket made it a live
-- personal-data exposure, not merely an audit-readiness gap.
--
-- WHY THIS IS NOT JUST `TO authenticated`
--   Storage was written when this was a single-tenant product. It is not any
--   more: 0258-0279 put several tenants in one database, and /signup mints new
--   ones unattended. Closing the anonymous hole with a bare
--   `TO authenticated` policy would have swapped an anonymous leak for a
--   cross-tenant one — any signed-up user reading any other company's P&IDs.
--   So objects are addressed `<company_id>/<file>` and the policies carry the
--   same tenant conjunct every table policy carries since 0270:
--       (SELECT public.caller_company())
--   caller_company() returns NULL when the JWT claim is absent, and NULL
--   compares false, so every policy below fails closed.
--
-- LEGACY OBJECTS: everything uploaded before this migration sits at the bucket
-- root with no tenant folder. Storage objects cannot be moved with SQL (the
-- name column is the object key; renaming the row alone desyncs it from the
-- backing store), so root-level objects stay put and are readable only by the
-- origin tenant — the same rule 0276 applied to the 809 orphan rows it found.
-- storage_origin_company() below is that tenant.
--
-- WHAT ELSE CHANGES
--   1. `work-order-docs` gets created here. It was made by hand in the
--      dashboard and had NO migration and NO policies at all — the least
--      governed bucket held the most sensitive objects (JSA signatures).
--   2. All four buckets flip to `public = false`.
--   3. Every legacy storage policy is dropped by name and replaced. Permissive
--      policies OR together (the trap 0186 documented for reference_codes and
--      0240 re-found as orphan policies), so the old ones must go, not merely
--      be shadowed.
--   4. Stored public URLs are rewritten to `bucket/path` form.
--   5. A visibility audit view, so a bucket cannot silently go public again.
--
-- READ PATH AFTER THIS: the client calls createSignedUrl(). Signed URLs
-- expire, so they can never be persisted — src/lib/storageUrl.ts normalises
-- whatever is in the column (legacy public URL, bare path, data: URI or
-- external link) and signs on demand. That resolver tolerates un-migrated
-- values, which is why the backfill below only touches scalar columns and
-- leaves JSONB/array-embedded URLs (jsa_assessments.signoffs,
-- audit_findings.evidence_attachments, job_tasks procedure media) to be
-- normalised at read time.
--
-- ROLLBACK: UPDATE storage.buckets SET public = true WHERE id IN (...);
-- The path-form values in the columns keep working either way — the resolver
-- handles both — so a rollback is visibility-only and needs no data restore.
--
-- Atomic.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Ensure every bucket the app writes to actually exists as a migration.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars',        'avatars',         false),
  ('assets',         'assets',          false),
  ('pid-diagrams',   'pid-diagrams',    false),
  ('work-order-docs','work-order-docs', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Close the read hole.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
   SET public = false
 WHERE id IN ('avatars', 'assets', 'pid-diagrams', 'work-order-docs');

-- ---------------------------------------------------------------------------
-- 3. Who owns the un-foldered objects.
--
-- The origin tenant is the oldest company row — the same identification 0276
-- used when it back-stamped orphaned rows. STABLE, not IMMUTABLE: it reads a
-- table. SECURITY DEFINER so a tenant that cannot see other companies' rows
-- can still evaluate the comparison.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_origin_company()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.companies ORDER BY created_at, id LIMIT 1
$$;

COMMENT ON FUNCTION public.storage_origin_company() IS
    '0281: the tenant that owns pre-0281 root-level storage objects (no tenant folder in the key). Same identification rule as 0276 used for orphaned rows.';

REVOKE ALL ON FUNCTION public.storage_origin_company() FROM public;
GRANT EXECUTE ON FUNCTION public.storage_origin_company() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Canonical, tenant-scoped object policies.
--
-- Drop EVERY policy on storage.objects that references one of our buckets,
-- by name, including any created by hand in the dashboard for
-- work-order-docs. Anything we do not recognise is left alone (Supabase's own
-- internal policies, other buckets).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  p record;
  ours text[] := ARRAY['avatars', 'assets', 'pid-diagrams', 'work-order-docs'];
BEGIN
  FOR p IN
    SELECT policyname,
           COALESCE(qual, '') || ' ' || COALESCE(with_check, '') AS body
      FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename  = 'objects'
  LOOP
    IF EXISTS (SELECT 1 FROM unnest(ours) b WHERE p.body LIKE '%''' || b || '''%') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p.policyname);
    END IF;
  END LOOP;
END $$;

-- The tenant test, as one expression:
--   · foldered object → first path segment must be the caller's company
--   · root object     → caller must belong to the origin tenant
-- caller_company() is NULL without the claim, so both arms fail closed.
CREATE OR REPLACE FUNCTION public.storage_object_is_callers(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN (SELECT public.caller_company()) IS NULL THEN false
        WHEN position('/' in object_name) > 0
            THEN split_part(object_name, '/', 1) = (SELECT public.caller_company())::text
        ELSE (SELECT public.caller_company()) = (SELECT public.storage_origin_company())
    END
$$;

COMMENT ON FUNCTION public.storage_object_is_callers(text) IS
    '0281: tenant conjunct for storage.objects. Objects are keyed <company_id>/<file>; pre-0281 root-level objects belong to storage_origin_company(). Fails closed on a missing JWT claim.';

REVOKE ALL ON FUNCTION public.storage_object_is_callers(text) FROM public;
GRANT EXECUTE ON FUNCTION public.storage_object_is_callers(text) TO authenticated;

CREATE POLICY storage_tenant_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = ANY (ARRAY['avatars', 'assets', 'pid-diagrams', 'work-order-docs'])
    AND (SELECT public.storage_object_is_callers(name))
  );

-- INSERT deliberately requires the tenant folder: a client that has not been
-- updated to prefix the path writes to the root and is refused, loudly, rather
-- than quietly creating an object nobody but the origin tenant can read.
CREATE POLICY storage_tenant_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = ANY (ARRAY['avatars', 'assets', 'pid-diagrams', 'work-order-docs'])
    AND position('/' in name) > 0
    AND split_part(name, '/', 1) = (SELECT public.caller_company())::text
  );

-- UPDATE needs USING as well as WITH CHECK. The originals set only WITH CHECK,
-- which left USING defaulting to false — updates silently matched no row. The
-- JSA upload path in DatabaseService documents working around exactly that
-- ("the bucket's RLS allows INSERT but 403s an overwrite").
CREATE POLICY storage_tenant_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = ANY (ARRAY['avatars', 'assets', 'pid-diagrams', 'work-order-docs'])
    AND (SELECT public.storage_object_is_callers(name))
  )
  WITH CHECK (
    bucket_id = ANY (ARRAY['avatars', 'assets', 'pid-diagrams', 'work-order-docs'])
    AND (SELECT public.storage_object_is_callers(name))
  );

-- DELETE: the app removes superseded avatars and JSA signatures on replace.
CREATE POLICY storage_tenant_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = ANY (ARRAY['avatars', 'assets', 'pid-diagrams', 'work-order-docs'])
    AND (SELECT public.storage_object_is_callers(name))
  );

-- ---------------------------------------------------------------------------
-- 5. Rewrite persisted public URLs to `bucket/path`.
--
-- A stored value looks like
--   https://<ref>.supabase.co/storage/v1/object/public/assets/asset_17..._x.jpg
-- and we want
--   assets/asset_17..._x.jpg
-- Project-ref agnostic so this runs identically on every tenant project.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.storage_url_to_path(u text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN u IS NULL THEN NULL
    -- Only rewrite our own public object URLs. data: URIs, already-signed
    -- URLs and third-party links pass through untouched.
    WHEN u ~ '^https?://[^/]+/storage/v1/object/public/'
      THEN regexp_replace(u, '^https?://[^/]+/storage/v1/object/public/', '')
    ELSE u
  END;
$$;

COMMENT ON FUNCTION public.storage_url_to_path(text) IS
  '0281: normalises a legacy public storage URL to bucket/path. Non-storage values pass through.';

UPDATE public.contacts
   SET image_url = public.storage_url_to_path(image_url)
 WHERE image_url LIKE '%/storage/v1/object/public/%';

UPDATE public.assets
   SET image_url = public.storage_url_to_path(image_url)
 WHERE image_url LIKE '%/storage/v1/object/public/%';

UPDATE public.inventory_items
   SET image_url = public.storage_url_to_path(image_url)
 WHERE image_url LIKE '%/storage/v1/object/public/%';

UPDATE public.qualifications
   SET image_url = public.storage_url_to_path(image_url)
 WHERE image_url LIKE '%/storage/v1/object/public/%';

UPDATE public.entity_files
   SET url = public.storage_url_to_path(url)
 WHERE url LIKE '%/storage/v1/object/public/%';

-- ers_pid_configurations arrived after several tenant projects were cut;
-- guard so this migration is safe on every one of them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'ers_pid_configurations'
       AND column_name  = 'background_image'
  ) THEN
    EXECUTE $q$
      UPDATE public.ers_pid_configurations
         SET background_image = public.storage_url_to_path(background_image)
       WHERE background_image LIKE '%/storage/v1/object/public/%'
    $q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. The control that outlives the fix.
--
-- A patched bucket with no process behind it reads as luck to an auditor.
-- This view is the recurring artefact: it must return zero rows. Wire it into
-- the nightly job or query it during an access review — either way it is
-- sampleable evidence for ISO A.8.3 and SOC 2 CC6.1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.storage_bucket_visibility_audit AS
SELECT id            AS bucket_id,
       name          AS bucket_name,
       public        AS is_public,
       created_at,
       'PUBLIC BUCKET — objects readable without authentication' AS finding
  FROM storage.buckets
 WHERE public IS TRUE;

COMMENT ON VIEW public.storage_bucket_visibility_audit IS
  '0281: must return zero rows. Any row is an unauthenticated data exposure (ISO A.8.3, SOC 2 CC6.1, GDPR Art. 32).';

REVOKE ALL ON public.storage_bucket_visibility_audit FROM anon;
GRANT SELECT ON public.storage_bucket_visibility_audit TO authenticated;

COMMIT;
