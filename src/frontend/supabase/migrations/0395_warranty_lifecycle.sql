-- ════════════════════════════════════════════════════════════════════════════
-- 0395 — Warranty & insurance lifecycle (P1 of the FinOps audit, after 0394)
--
-- ── 1. The OEM warrantor is the manufacturer, not a vendor ──────────────────
-- warranties.vendor_id → vendors was the only provider reference, and 0158
-- moved manufacturers out of vendors into their own master. So "GE Vernova's
-- standard warranty" on a GE turbine could not be recorded without re-creating
-- GE as a vendor — the duplicate 0158 removed. manufacturer_id is added
-- beside vendor_id: an OEM warranty carries the manufacturer (pre-filled from
-- the asset) and optionally the vendor the claim is filed with; an extended
-- warranty or service contract carries the vendor. Both may be null on legacy
-- rows; nothing here rewrites them.
--
-- ── 2. Nothing ever expired ─────────────────────────────────────────────────
-- No trigger, cron or client path changed warranties.status or
-- asset_insurance.status: 'ACTIVE' forever, the list badge and the Overview
-- (which computes by date) disagreeing, checkWarrantyStatus filtering by date
-- to work around it, and reminder_days / renewal_reminder_days never read.
-- ers_finops_lifecycle_sweep() runs nightly:
--   • warranties past end_date, or with max_hours reached → EXPIRED
--   • insurance past coverage_end → EXPIRED
--   • warranty current_hours follows the asset's hour meter (RUNHOURS-type
--     readings) where one exists: hours since the warranty started. Where no
--     meter exists the WO-completion path (labour hours) keeps accruing as
--     before — that is an approximation, and the meter wins when present.
--   • one WARRANTY_EXPIRING / INSURANCE_RENEWAL notification per row inside
--     its reminder window, to the tenant's finance-facing roles, deduped
--     against the notifications table so a nightly run does not nag.
--
-- ── 3. replace_equipment() left the old unit's warranty on the new unit ─────
-- A physical swap keeps the position (tag, history) and moves the object
-- identity on (Gen+1, new serial). The OEM warranty was tied to the serial
-- that just left the plant; it now closes (VOIDED) as part of the swap and
-- the count is returned so the UI can say so. Insurance and cost basis are
-- deliberately left as they are — a policy usually covers the position and a
-- like-for-like swap is a repair, not a disposal; those are finance decisions
-- the result now surfaces for the user rather than makes silently.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Provider ──────────────────────────────────────────────────────────────
ALTER TABLE public.warranties
    ADD COLUMN IF NOT EXISTS manufacturer_id uuid REFERENCES public.manufacturers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_warranties_manufacturer_id ON public.warranties (manufacturer_id);
COMMENT ON COLUMN public.warranties.manufacturer_id IS
    'The OEM standing behind the warranty (0395). vendor_id remains the party a claim is filed with (distributor, EPC, service company).';

-- ── 2. Lifecycle sweep ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ers_finops_lifecycle_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    n_w_expired int := 0;
    n_i_expired int := 0;
    n_hours     int := 0;
    n_w_notif   int := 0;
    n_i_notif   int := 0;
    r           record;
    u           record;
BEGIN
    -- 2a. Hour meters → warranty counters. Latest reading of an hour-type
    -- definition on the asset, minus the reading in force when the warranty
    -- started (last reading on/before start_date, else the first after it).
    FOR r IN
        WITH meter AS (
            SELECT l.asset_id, l.reading_value, l.reading_date, l.created_at
              FROM public.reading_logs l
              JOIN public.reading_definitions d ON d.id = l.definition_id
             WHERE COALESCE(l.is_active, true)
               AND upper(COALESCE(d.reading_type_code, '')) IN ('RUNHOURS', 'RUN_HOURS', 'RUNTIME', 'OPERATING_HOURS', 'HOUR_METER', 'HOURMETER')
        ),
        latest AS (
            SELECT DISTINCT ON (asset_id) asset_id, reading_value AS now_value
              FROM meter ORDER BY asset_id, reading_date DESC, created_at DESC
        )
        SELECT w.id, w.current_hours, w.start_date, w.asset_id, lt.now_value,
               COALESCE(
                 (SELECT m.reading_value FROM meter m WHERE m.asset_id = w.asset_id AND m.reading_date <= w.start_date ORDER BY m.reading_date DESC, m.created_at DESC LIMIT 1),
                 (SELECT m.reading_value FROM meter m WHERE m.asset_id = w.asset_id AND m.reading_date >  w.start_date ORDER BY m.reading_date ASC,  m.created_at ASC  LIMIT 1)
               ) AS base_value
          FROM public.warranties w
          JOIN latest lt ON lt.asset_id = w.asset_id
         WHERE w.status = 'ACTIVE' AND COALESCE(w.max_hours, 0) > 0
    LOOP
        IF r.base_value IS NOT NULL AND r.now_value IS NOT NULL THEN
            UPDATE public.warranties
               SET current_hours = GREATEST(0, r.now_value - r.base_value), updated_at = now()
             WHERE id = r.id
               AND current_hours IS DISTINCT FROM GREATEST(0, r.now_value - r.base_value);
            IF FOUND THEN n_hours := n_hours + 1; END IF;
        END IF;
    END LOOP;

    -- 2b. Expiry.
    UPDATE public.warranties
       SET status = 'EXPIRED', updated_at = now()
     WHERE status = 'ACTIVE'
       AND ((end_date IS NOT NULL AND end_date < CURRENT_DATE)
         OR (COALESCE(max_hours, 0) > 0 AND COALESCE(current_hours, 0) >= max_hours));
    GET DIAGNOSTICS n_w_expired = ROW_COUNT;

    UPDATE public.asset_insurance
       SET status = 'EXPIRED', updated_at = now()
     WHERE status = 'ACTIVE' AND coverage_end IS NOT NULL AND coverage_end < CURRENT_DATE;
    GET DIAGNOSTICS n_i_expired = ROW_COUNT;

    -- 2c. Reminders. One per row per window: skip when a notification of the
    -- same type for the same entity exists within the reminder window.
    FOR r IN
        SELECT w.id, w.company_id, w.end_date, COALESCE(w.reminder_days, 30) AS days,
               a.tag, a.name AS asset_name, COALESCE(w.warranty_number, '') AS wno
          FROM public.warranties w
          JOIN public.assets a ON a.id = w.asset_id
         WHERE w.status = 'ACTIVE'
           AND w.end_date IS NOT NULL
           AND w.end_date >= CURRENT_DATE
           AND w.end_date <= CURRENT_DATE + COALESCE(w.reminder_days, 30)
           AND NOT EXISTS (
                 SELECT 1 FROM public.notifications n
                  WHERE n.notification_type = 'WARRANTY_EXPIRING'
                    AND n.entity_id = w.id::text
                    AND n.created_at >= CURRENT_DATE - COALESCE(w.reminder_days, 30))
    LOOP
        FOR u IN
            SELECT id FROM public.users
             WHERE company_id = r.company_id
               AND COALESCE(status, 'active') = 'active'
               AND roles ?| ARRAY['FINANCE', 'MANAGER', 'ASSET_MANAGER']
             LIMIT 25
        LOOP
            INSERT INTO public.notifications
                (recipient_id, title, message, severity, notification_type, module,
                 entity_id, entity_type, entity_number, action_link, action_required, company_id)
            VALUES
                (u.id::text,
                 'Warranty expiring: ' || r.tag,
                 left(r.asset_name, 120) || ' — warranty' || CASE WHEN r.wno <> '' THEN ' ' || r.wno ELSE '' END ||
                     ' ends ' || to_char(r.end_date, 'DD Mon YYYY') || ' (' || (r.end_date - CURRENT_DATE) || ' days). Claim open defects before it lapses.',
                 'WARNING', 'WARRANTY_EXPIRING', 'finops',
                 r.id::text, 'WARRANTY', NULLIF(r.wno, ''), '/finops?tab=warranties', true, r.company_id);
            n_w_notif := n_w_notif + 1;
        END LOOP;
    END LOOP;

    FOR r IN
        SELECT p.id, p.company_id, p.coverage_end, COALESCE(p.renewal_reminder_days, 30) AS days,
               a.tag, a.name AS asset_name, p.policy_number, p.insurer_name
          FROM public.asset_insurance p
          JOIN public.assets a ON a.id = p.asset_id
         WHERE p.status = 'ACTIVE'
           AND p.coverage_end IS NOT NULL
           AND p.coverage_end >= CURRENT_DATE
           AND p.coverage_end <= CURRENT_DATE + COALESCE(p.renewal_reminder_days, 30)
           AND NOT EXISTS (
                 SELECT 1 FROM public.notifications n
                  WHERE n.notification_type = 'INSURANCE_RENEWAL'
                    AND n.entity_id = p.id::text
                    AND n.created_at >= CURRENT_DATE - COALESCE(p.renewal_reminder_days, 30))
    LOOP
        FOR u IN
            SELECT id FROM public.users
             WHERE company_id = r.company_id
               AND COALESCE(status, 'active') = 'active'
               AND roles ?| ARRAY['FINANCE', 'MANAGER', 'ASSET_MANAGER']
             LIMIT 25
        LOOP
            INSERT INTO public.notifications
                (recipient_id, title, message, severity, notification_type, module,
                 entity_id, entity_type, entity_number, action_link, action_required, company_id)
            VALUES
                (u.id::text,
                 'Insurance renewal due: ' || r.tag,
                 left(r.asset_name, 120) || ' — ' || COALESCE(r.insurer_name, 'policy') || ' ' || COALESCE(r.policy_number, '') ||
                     ' ends ' || to_char(r.coverage_end, 'DD Mon YYYY') || ' (' || (r.coverage_end - CURRENT_DATE) || ' days).',
                 'WARNING', 'INSURANCE_RENEWAL', 'finops',
                 r.id::text, 'INSURANCE', r.policy_number, '/finops?tab=insurance', true, r.company_id);
            n_i_notif := n_i_notif + 1;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'warranties_expired', n_w_expired, 'insurance_expired', n_i_expired,
        'warranty_hours_updated', n_hours,
        'warranty_reminders', n_w_notif, 'insurance_reminders', n_i_notif);
END $$;
REVOKE ALL ON FUNCTION public.ers_finops_lifecycle_sweep() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ers_finops_lifecycle_sweep() TO service_role;
COMMENT ON FUNCTION public.ers_finops_lifecycle_sweep() IS
    'Nightly: expire warranties (date or hours) and insurance, follow hour meters into warranty counters, raise WARRANTY_EXPIRING / INSURANCE_RENEWAL reminders (deduped). All tenants; runs from pg_cron (0395).';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        RAISE NOTICE '0395: pg_cron absent — finops-lifecycle-sweep not registered on this project.';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finops-lifecycle-sweep') THEN
        PERFORM cron.unschedule('finops-lifecycle-sweep');
    END IF;
    PERFORM cron.schedule('finops-lifecycle-sweep', '20 2 * * *',
                          'SELECT public.ers_finops_lifecycle_sweep()');
END $$;

-- ── 3. A swap closes the outgoing unit's OEM warranty ───────────────────────
CREATE OR REPLACE FUNCTION public.replace_equipment(
  p_asset_id             uuid,
  p_new_equipment_number text DEFAULT NULL,
  p_reason               text DEFAULT NULL,
  p_new_serial_number    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER            -- caller's RLS/write gates decide, not this function
SET search_path = public
AS $$
DECLARE
  a assets%ROWTYPE;
  new_en  text;
  new_gen int;
  n_oem   int := 0;
  n_ins   int := 0;
  capd    boolean := false;
BEGIN
  SELECT * INTO a FROM assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found (or not visible to you)';
  END IF;
  IF a.hierarchy_level NOT IN ('EQUIPMENT', 'COMPONENT') THEN
    RAISE EXCEPTION 'replace_equipment() applies to equipment-class assets only — % is a %', a.tag, a.hierarchy_level;
  END IF;

  new_en := NULLIF(btrim(COALESCE(p_new_equipment_number, '')), '');
  IF new_en IS NULL THEN
    new_en := public.issue_equipment_number(a.company_id);
  END IF;
  IF new_en IS NOT DISTINCT FROM a.equipment_number THEN
    RAISE EXCEPTION 'New equipment number equals the current one — nothing was replaced';
  END IF;

  new_gen := COALESCE(a.equipment_generation, 1) + 1;

  -- The position (tag, history, hierarchy) stays; the object identity moves on.
  -- The outgoing unit's serial is archived in the log, not left on the row —
  -- a serial describes the physical unit, and that unit just left the plant.
  UPDATE assets SET
    equipment_number     = new_en,
    equipment_generation = new_gen,
    serial_number        = NULLIF(btrim(COALESCE(p_new_serial_number, '')), '')
  WHERE id = p_asset_id;

  INSERT INTO asset_replacements
    (company_id, asset_id, from_equipment_number, to_equipment_number,
     from_generation, to_generation, from_serial_number, reason, replaced_by)
  VALUES
    (a.company_id, a.id, a.equipment_number, new_en,
     COALESCE(a.equipment_generation, 1), new_gen, a.serial_number,
     NULLIF(btrim(COALESCE(p_reason, '')), ''), auth.uid());

  -- The OEM warranty followed the serial that just left (0395). SECURITY
  -- INVOKER: if the caller may not update warranties, RLS filters this to
  -- zero rows and the returned count says so — the swap itself still stands.
  UPDATE warranties
     SET status = 'VOIDED',
         updated_at = now(),
         coverage_scope = left(COALESCE(coverage_scope, '') ||
             CASE WHEN COALESCE(coverage_scope, '') <> '' THEN ' ' ELSE '' END ||
             '[Closed ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || ': unit ' || COALESCE(a.equipment_number, '?') ||
             CASE WHEN a.serial_number IS NOT NULL THEN ' s/n ' || a.serial_number ELSE '' END || ' replaced]', 2000)
   WHERE asset_id = p_asset_id AND status = 'ACTIVE' AND warranty_type = 'OEM';
  GET DIAGNOSTICS n_oem = ROW_COUNT;

  SELECT COUNT(*) INTO n_ins FROM asset_insurance WHERE asset_id = p_asset_id AND status = 'ACTIVE';
  SELECT EXISTS (SELECT 1 FROM asset_financials WHERE asset_id = p_asset_id) INTO capd;

  RETURN jsonb_build_object(
    'equipment_number', new_en,
    'equipment_generation', new_gen,
    'previous_equipment_number', a.equipment_number,
    'oem_warranties_closed', n_oem,
    'insurance_policies_active', n_ins,
    'capitalized', capd
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.replace_equipment(uuid, text, text, text) TO authenticated;

COMMIT;

-- VERIFY
--   SELECT column_name FROM information_schema.columns WHERE table_name='warranties' AND column_name='manufacturer_id';
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'finops-lifecycle-sweep';   -- 20 2 * * *
--   SELECT public.ers_finops_lifecycle_sweep();   -- as service role: jsonb counts, no error
