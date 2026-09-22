-- 0388 — an imported SAP key says what kind of object it is.
--
-- 0275 records the equipment numbers a SAP or Maximo export carries, so an
-- integration built later starts already mapped. 0383 then made the map
-- type-aware: equipment 1000 and functional location 1000 are different
-- objects, and the live link looks assets up by EQUI / IFLOT. A row 0275
-- wrote has external_type NULL — never found inbound, and outbound its
-- parent link is lost. Nothing on production is affected yet (no asset
-- maps exist), but the next Migration Center import would create exactly
-- that row.
--
-- The type is derived from the asset's own level, so no caller can get it
-- wrong: EQUIPMENT and COMPONENT are SAP equipment, everything above is a
-- functional location — the same rule as lib/erpLink/masterData.ts
-- objectTypeOf(). The inventory_item and vendor branches are unchanged.
-- Existing NULL-typed asset rows are backfilled the same way (idempotent).

CREATE OR REPLACE FUNCTION public.ers_map_external_ids(p_entity_type text, p_system text, p_pairs jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
            SELECT a.company_id, i.entity_id, i.external_key,
                   -- SAP's own object type, from the level: the live link keys on it (0383).
                   CASE WHEN upper(coalesce(a.hierarchy_level, '')) IN ('EQUIPMENT', 'COMPONENT') THEN 'EQUI' ELSE 'IFLOT' END AS external_type
            FROM input i
            JOIN public.assets a ON a.id = i.entity_id
            -- Someone else's record is skipped, not mapped and not an error.
            WHERE (v_caller IS NULL OR a.company_id = v_caller)
        )
        INSERT INTO public.erp_object_map
            (company_id, system, entity_type, entity_id, external_key, external_type, ownership)
        SELECT r.company_id, p_system, 'asset', r.entity_id, r.external_key, r.external_type, 'EXTERNAL'
        FROM resolved r
        -- The key is already claimed by a different record of the same type
        -- here: a real ambiguity in their export, left visible rather than
        -- re-pointed.
        WHERE NOT EXISTS (
            SELECT 1 FROM public.erp_object_map m
             WHERE m.company_id IS NOT DISTINCT FROM r.company_id
               AND m.system = p_system AND m.entity_type = 'asset'
               AND m.external_type IS NOT DISTINCT FROM r.external_type
               AND m.external_key = r.external_key
               AND m.entity_id <> r.entity_id)
        ON CONFLICT (company_id, system, entity_type, entity_id) DO UPDATE
            SET external_key  = EXCLUDED.external_key,
                external_type = EXCLUDED.external_type,
                updated_at    = NOW();
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
$function$;

-- Rows 0275 wrote before the type existed: give them the type their asset's level implies.
UPDATE public.erp_object_map m
   SET external_type = CASE WHEN upper(coalesce(a.hierarchy_level, '')) IN ('EQUIPMENT', 'COMPONENT') THEN 'EQUI' ELSE 'IFLOT' END
  FROM public.assets a
 WHERE m.entity_type = 'asset' AND m.external_type IS NULL AND a.id = m.entity_id;

-- VERIFY (after apply):
--   SELECT count(*) FROM public.erp_object_map WHERE entity_type = 'asset' AND external_type IS NULL;   -- 0
