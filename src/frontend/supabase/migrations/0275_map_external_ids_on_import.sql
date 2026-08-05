-- ═══════════════════════════════════════════════════════════════
-- 0275 — An import already knows their ids. Stop throwing them away.
--
-- `erp_object_map` (0250) is the identity layer every ERP sync needs before
-- it can move a document: which of their records is which of ours. It has
-- been inert since it was created, because nothing populates it.
--
-- Meanwhile the Migration Center reads a SAP PM or Maximo export that
-- carries their equipment numbers, uses them to match a row, and discards
-- them. So an integration that starts later opens with a reconciliation
-- project against the very data we just loaded — matching on name, which
-- breaks the first time somebody renames a vendor and re-creates duplicates
-- on every run.
--
-- Capturing the mapping at import time costs one call and removes that
-- entire first phase.
--
-- WHY AN RPC AND NOT A DIRECT INSERT. erp_object_map is integration state,
-- not user data: 0250 gave it read to `authenticated` and writes to
-- `service_role` only. Loosening that so the browser can write it would
-- hand every user the ability to re-point another record's identity. A
-- SECURITY DEFINER function keeps the table shut and exposes exactly one
-- safe operation.
--
-- TENANT SAFETY, following the rule 0261 cost us: the company is derived
-- from THE ENTITY BEING MAPPED, never from the caller's claim, and rows
-- belonging to another tenant are skipped rather than mapped. A caller who
-- passes someone else's uuid gets nothing back, not an error and not a
-- mapping.
--
-- Idempotent by design — an import re-run maps the same pairs to the same
-- rows. Re-mapping an entity updates its key; a key already claimed by a
-- DIFFERENT entity in the same tenant is skipped, because that is a genuine
-- ambiguity in their data and silently re-pointing it would be worse than
-- leaving it for someone to look at.
--
-- Rollback: DROP FUNCTION public.ers_map_external_ids(text, text, jsonb);
-- ═══════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.ers_map_external_ids(
    p_entity_type TEXT,
    p_system      TEXT,
    -- [{"entity_id": "<uuid>", "external_key": "EQ-1001"}, …]
    p_pairs       JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller UUID;
    v_n      INT := 0;
BEGIN
    IF p_pairs IS NULL OR jsonb_typeof(p_pairs) <> 'array' OR jsonb_array_length(p_pairs) = 0 THEN
        RETURN 0;
    END IF;
    IF COALESCE(btrim(p_system), '') = '' THEN
        RAISE EXCEPTION 'ers_map_external_ids: a system name is required';
    END IF;

    BEGIN v_caller := public.caller_company(); EXCEPTION WHEN OTHERS THEN v_caller := NULL; END;

    -- One branch per entity type rather than dynamic SQL: the set of
    -- mappable objects is small, fixed and worth reading.
    IF p_entity_type = 'asset' THEN
        WITH input AS (
            SELECT x.entity_id, btrim(x.external_key) AS external_key
            FROM jsonb_to_recordset(p_pairs) AS x(entity_id UUID, external_key TEXT)
            WHERE COALESCE(btrim(x.external_key), '') <> ''
        ),
        resolved AS (
            SELECT a.company_id, i.entity_id, i.external_key
            FROM input i
            JOIN public.assets a ON a.id = i.entity_id
            -- Someone else's record is skipped, not mapped and not an error.
            WHERE (v_caller IS NULL OR a.company_id = v_caller)
        )
        INSERT INTO public.erp_object_map
            (company_id, system, entity_type, entity_id, external_key, ownership)
        SELECT r.company_id, p_system, 'asset', r.entity_id, r.external_key, 'EXTERNAL'
        FROM resolved r
        -- The key is already claimed by a different record here: a real
        -- ambiguity in their export, left visible rather than re-pointed.
        WHERE NOT EXISTS (
            SELECT 1 FROM public.erp_object_map m
             WHERE m.company_id IS NOT DISTINCT FROM r.company_id
               AND m.system = p_system AND m.entity_type = 'asset'
               AND m.external_key = r.external_key
               AND m.entity_id <> r.entity_id)
        ON CONFLICT (company_id, system, entity_type, entity_id) DO UPDATE
            SET external_key = EXCLUDED.external_key,
                updated_at   = NOW();
        GET DIAGNOSTICS v_n = ROW_COUNT;

    ELSIF p_entity_type = 'inventory_item' THEN
        WITH input AS (
            SELECT x.entity_id, btrim(x.external_key) AS external_key
            FROM jsonb_to_recordset(p_pairs) AS x(entity_id UUID, external_key TEXT)
            WHERE COALESCE(btrim(x.external_key), '') <> ''
        ),
        resolved AS (
            SELECT i2.company_id, i.entity_id, i.external_key
            FROM input i
            JOIN public.inventory_items i2 ON i2.id = i.entity_id
            WHERE (v_caller IS NULL OR i2.company_id = v_caller)
        )
        INSERT INTO public.erp_object_map
            (company_id, system, entity_type, entity_id, external_key, ownership)
        SELECT r.company_id, p_system, 'inventory_item', r.entity_id, r.external_key, 'EXTERNAL'
        FROM resolved r
        WHERE NOT EXISTS (
            SELECT 1 FROM public.erp_object_map m
             WHERE m.company_id IS NOT DISTINCT FROM r.company_id
               AND m.system = p_system AND m.entity_type = 'inventory_item'
               AND m.external_key = r.external_key
               AND m.entity_id <> r.entity_id)
        ON CONFLICT (company_id, system, entity_type, entity_id) DO UPDATE
            SET external_key = EXCLUDED.external_key,
                updated_at   = NOW();
        GET DIAGNOSTICS v_n = ROW_COUNT;

    ELSIF p_entity_type = 'vendor' THEN
        WITH input AS (
            SELECT x.entity_id, btrim(x.external_key) AS external_key
            FROM jsonb_to_recordset(p_pairs) AS x(entity_id UUID, external_key TEXT)
            WHERE COALESCE(btrim(x.external_key), '') <> ''
        ),
        resolved AS (
            SELECT v.company_id, i.entity_id, i.external_key
            FROM input i
            JOIN public.vendors v ON v.id = i.entity_id
            WHERE (v_caller IS NULL OR v.company_id = v_caller)
        )
        INSERT INTO public.erp_object_map
            (company_id, system, entity_type, entity_id, external_key, ownership)
        SELECT r.company_id, p_system, 'vendor', r.entity_id, r.external_key, 'EXTERNAL'
        FROM resolved r
        WHERE NOT EXISTS (
            SELECT 1 FROM public.erp_object_map m
             WHERE m.company_id IS NOT DISTINCT FROM r.company_id
               AND m.system = p_system AND m.entity_type = 'vendor'
               AND m.external_key = r.external_key
               AND m.entity_id <> r.entity_id)
        ON CONFLICT (company_id, system, entity_type, entity_id) DO UPDATE
            SET external_key = EXCLUDED.external_key,
                updated_at   = NOW();
        GET DIAGNOSTICS v_n = ROW_COUNT;

    ELSE
        RAISE EXCEPTION 'ers_map_external_ids: % is not a mappable entity type here', p_entity_type;
    END IF;

    RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.ers_map_external_ids(TEXT, TEXT, JSONB) IS
    'Record which external record each of ours is, from an import that already carries their ids. Company derived from the entity, never the caller; other tenants'' rows are skipped. Idempotent. Returns the number of mappings written.';

GRANT EXECUTE ON FUNCTION public.ers_map_external_ids(TEXT, TEXT, JSONB) TO authenticated, service_role;

COMMIT;
