-- ─────────────────────────────────────────────────────────────────────────────
-- 0227 — give task_library_items the columns its own service already writes.
--
-- Why: DatabaseService.createLibraryTask has always inserted asset_class_codes,
-- version, is_locked and parent_task_id, and none of those columns exist. The
-- insert therefore throws on every attempt — which is why task_library_items
-- has zero rows. createNewVersion (clones with a -v{n} code), lockLibraryTask
-- and getLibraryTasksByAssetClass are all written against the same missing
-- columns, so the whole Task Library page is dead on arrival.
--
-- Adding the columns is the smaller fix: the UI, the types and the service all
-- already treat them as real. Removing them would delete working features
-- (versioning, MoC locking, asset-class applicability).
--
-- Also adds a unique index on code, so a job-plan import can upsert instead of
-- duplicating a task list every time it is re-run. Versions stay unique because
-- createNewVersion suffixes the code with -v2, -v3, …
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.task_library_items
    ADD COLUMN IF NOT EXISTS asset_class_codes text[] DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS version           integer DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_locked         boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS locked_at         timestamptz,
    ADD COLUMN IF NOT EXISTS locked_by         text,
    ADD COLUMN IF NOT EXISTS parent_task_id    uuid,
    -- Provenance, so an imported library can be identified later. Deliberately
    -- no FK: import_batches is admin-only and a non-admin import must still work.
    ADD COLUMN IF NOT EXISTS source_system     text;

-- Self-reference for the version chain (added separately so a re-run is safe).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'task_library_items_parent_task_id_fkey'
    ) THEN
        ALTER TABLE public.task_library_items
            ADD CONSTRAINT task_library_items_parent_task_id_fkey
            FOREIGN KEY (parent_task_id) REFERENCES public.task_library_items(id) ON DELETE SET NULL;
    END IF;
END $$;

-- One task list per code — the natural key an import can upsert on.
CREATE UNIQUE INDEX IF NOT EXISTS task_library_items_code_key
    ON public.task_library_items (code);

CREATE INDEX IF NOT EXISTS idx_task_library_items_asset_class
    ON public.task_library_items USING GIN (asset_class_codes);

-- The child tables' FKs had no delete rule, so deleting a task list with roles,
-- parts or files attached failed with a bare FK violation. Cascade them.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.conname, t.relname AS child
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_class p ON p.oid = c.confrelid
        WHERE p.relname = 'task_library_items'
          AND c.contype = 'f'
          AND c.confdeltype = 'a'                     -- NO ACTION
          AND t.relname IN ('task_library_roles', 'task_library_inventory', 'task_library_files')
    LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.child, r.conname);
        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (task_id) '
            'REFERENCES public.task_library_items(id) ON DELETE CASCADE',
            r.child, r.conname
        );
    END LOOP;
END $$;

COMMENT ON COLUMN public.task_library_items.asset_class_codes IS
    'Equipment classes this task list applies to (ISO 14224 class codes).';
COMMENT ON COLUMN public.task_library_items.source_system IS
    'Set when the task list arrived from a CMMS migration (sap_pm, maximo, …).';
