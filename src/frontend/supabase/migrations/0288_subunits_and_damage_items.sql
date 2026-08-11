-- 0288: ISO 14224 level 7 (subunit) + multi-damage items
--
-- Completes the equipment-subdivision taxonomy started in 0285/0287:
--   level 6 equipment unit  = the asset the WO points at
--   level 7 subunit         = THIS migration: SUBUNIT dictionary (ISO 14224
--                             Annex A style, scoped per asset class exactly
--                             like FAILURE_MODE's category_ref) + a
--                             subunit_code on the failure record
--   level 8/9 maintainable  = failed_bom_item_id / object_part (0287, via
--   item / part               the asset BOM)
--
-- Also adds wo_failure_items — the SAP notification-items analogue. One WO
-- can find several faults (seal AND bearing bad); wo_failure_data remains the
-- PRIMARY damage record (it drives the TECO gate and the reliability
-- engines), and additional findings land here as child rows instead of being
-- lost in prose.

-- ── 1. SUBUNIT dictionary (per asset class via category_ref) ───────────────
INSERT INTO public.reference_codes (category, code, description, is_locked, active, category_ref) VALUES
    -- General (all asset classes)
    ('SUBUNIT', 'STRUCTURE',        'Structure / body / casing',                         false, true, NULL),
    ('SUBUNIT', 'CTRL_MON',         'Control & monitoring',                              false, true, NULL),
    ('SUBUNIT', 'PWR_TRANS',        'Power transmission',                                false, true, NULL),
    ('SUBUNIT', 'MISC',             'Miscellaneous / unknown',                           false, true, NULL),
    -- Rotating equipment
    ('SUBUNIT', 'ROT_MAIN',         'Main rotating assembly (rotor/impeller/shaft)',     false, true, 'ROTATING'),
    ('SUBUNIT', 'ROT_PWR_TRANS',    'Power transmission (coupling, gearbox, belt)',      false, true, 'ROTATING'),
    ('SUBUNIT', 'ROT_LUBE',         'Lubrication system',                                false, true, 'ROTATING'),
    ('SUBUNIT', 'ROT_SEAL',         'Shaft seal system',                                 false, true, 'ROTATING'),
    ('SUBUNIT', 'ROT_COOLING',      'Cooling / heat exchange system',                    false, true, 'ROTATING'),
    ('SUBUNIT', 'ROT_CTRL_MON',     'Control & monitoring (instruments, protection)',    false, true, 'ROTATING'),
    ('SUBUNIT', 'ROT_SUPPORT',      'Support & foundation',                              false, true, 'ROTATING'),
    -- Electrical
    ('SUBUNIT', 'ELE_WINDINGS',     'Windings (stator/rotor)',                           false, true, 'ELECTRICAL'),
    ('SUBUNIT', 'ELE_EXCITATION',   'Excitation / magnetisation',                        false, true, 'ELECTRICAL'),
    ('SUBUNIT', 'ELE_PWR_SUPPLY',   'Power supply / converter',                          false, true, 'ELECTRICAL'),
    ('SUBUNIT', 'ELE_PROTECTION',   'Protection & switching',                            false, true, 'ELECTRICAL'),
    ('SUBUNIT', 'ELE_COOLING',      'Cooling system',                                    false, true, 'ELECTRICAL'),
    ('SUBUNIT', 'ELE_CTRL_MON',     'Control & monitoring',                              false, true, 'ELECTRICAL'),
    -- Static / pressure vessels
    ('SUBUNIT', 'STA_SHELL',        'Shell / pressure boundary',                         false, true, 'STATIC_PRESSURE'),
    ('SUBUNIT', 'STA_INTERNALS',    'Internals (trays, packing, baffles)',               false, true, 'STATIC_PRESSURE'),
    ('SUBUNIT', 'STA_NOZZLES',      'Nozzles & manways',                                 false, true, 'STATIC_PRESSURE'),
    ('SUBUNIT', 'STA_SUPPORTS',     'Supports & skirt',                                  false, true, 'STATIC_PRESSURE'),
    ('SUBUNIT', 'STA_EXTERNAL',     'External attachments (insulation, ladders)',        false, true, 'STATIC_PRESSURE'),
    -- Instrumentation
    ('SUBUNIT', 'INS_SENSOR',       'Sensing element',                                   false, true, 'INSTRUMENT'),
    ('SUBUNIT', 'INS_TRANSMITTER',  'Transmitter / electronics',                         false, true, 'INSTRUMENT'),
    ('SUBUNIT', 'INS_SIGNAL',       'Signal processing & communication',                 false, true, 'INSTRUMENT'),
    ('SUBUNIT', 'INS_ACTUATION',    'Actuator / positioner',                             false, true, 'INSTRUMENT'),
    ('SUBUNIT', 'INS_PROCESS_CONN', 'Process connection (impulse lines, manifolds)',     false, true, 'INSTRUMENT'),
    -- Piping
    ('SUBUNIT', 'PIP_BODY',         'Pipe body & fittings',                              false, true, 'PIPING'),
    ('SUBUNIT', 'PIP_JOINTS',       'Flanges, joints & gaskets',                         false, true, 'PIPING'),
    ('SUBUNIT', 'PIP_VALVES',       'In-line valves',                                    false, true, 'PIPING'),
    ('SUBUNIT', 'PIP_SUPPORTS',     'Supports & hangers',                                false, true, 'PIPING'),
    ('SUBUNIT', 'PIP_LINING',       'Coating / lining / insulation',                     false, true, 'PIPING'),
    -- Safety systems
    ('SUBUNIT', 'SAF_DETECTOR',     'Detector / sensing',                                false, true, 'SAFETY_SYSTEM'),
    ('SUBUNIT', 'SAF_LOGIC',        'Logic solver / control unit',                       false, true, 'SAFETY_SYSTEM'),
    ('SUBUNIT', 'SAF_FINAL',        'Final element (valve, relay, breaker)',             false, true, 'SAFETY_SYSTEM'),
    ('SUBUNIT', 'SAF_UTILITY',      'Power & utilities',                                 false, true, 'SAFETY_SYSTEM'),
    -- Heat transfer
    ('SUBUNIT', 'HTX_TUBES',        'Tube bundle / coils',                               false, true, 'HEAT_TRANSFER'),
    ('SUBUNIT', 'HTX_SHELL',        'Shell side / casing',                               false, true, 'HEAT_TRANSFER'),
    ('SUBUNIT', 'HTX_HEADERS',      'Headers / channels / covers',                       false, true, 'HEAT_TRANSFER'),
    ('SUBUNIT', 'HTX_AIR',          'Fans & drives (air-cooled)',                        false, true, 'HEAT_TRANSFER'),
    -- Structural
    ('SUBUNIT', 'STR_PRIMARY',      'Primary structure',                                 false, true, 'STRUCTURAL'),
    ('SUBUNIT', 'STR_CONNECTIONS',  'Connections & welds',                               false, true, 'STRUCTURAL'),
    ('SUBUNIT', 'STR_COATING',      'Coating & corrosion protection',                    false, true, 'STRUCTURAL')
ON CONFLICT (company_id, category, code) DO NOTHING;

-- ── 2. Subunit on the primary failure record ────────────────────────────────
ALTER TABLE public.wo_failure_data
    ADD COLUMN IF NOT EXISTS subunit_code text;

COMMENT ON COLUMN public.wo_failure_data.subunit_code
    IS 'ISO 14224 level-7 subunit the fault sat in (SUBUNIT dictionary, scoped per asset class). Rolls component failures up one level for Pareto.';

-- ── 3. Multi-damage items (SAP notification items analogue) ────────────────
CREATE TABLE IF NOT EXISTS public.wo_failure_items (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wo_id              uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
    seq                int  NOT NULL DEFAULT 1,
    subunit_code       text,
    object_part        text,
    failed_bom_item_id uuid REFERENCES public.asset_bom(id) ON DELETE SET NULL,
    failed_part_no     text,
    failure_mode_code  text,
    failure_cause_code text,
    comments           text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    company_id         uuid NOT NULL DEFAULT public.caller_company()
);

COMMENT ON TABLE public.wo_failure_items IS
    'Additional damage findings on a work order (SAP notification items). The PRIMARY damage record stays on wo_failure_data — it drives the TECO gate and the reliability engines; these are the "also found" faults that used to be lost in prose.';

CREATE INDEX IF NOT EXISTS wo_failure_items_wo_idx ON public.wo_failure_items (wo_id, seq);

-- Tenant policy HAND-WRITTEN: born after the 0261a policy sweep, which cannot
-- see new tables. Reads tenant-scoped; writes additionally need the
-- workOrders edit permission (same authority as editing the WO itself).
ALTER TABLE public.wo_failure_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wo_failure_items_read" ON public.wo_failure_items;
CREATE POLICY "wo_failure_items_read" ON public.wo_failure_items
    FOR SELECT TO authenticated
    USING (company_id = (SELECT public.caller_company()));
DROP POLICY IF EXISTS "wo_failure_items_write" ON public.wo_failure_items;
CREATE POLICY "wo_failure_items_write" ON public.wo_failure_items
    FOR ALL TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND public.caller_can('workOrders', 'edit'))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND public.caller_can('workOrders', 'edit'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wo_failure_items TO authenticated;
GRANT ALL ON public.wo_failure_items TO service_role;

-- ── 4. Catalog ──────────────────────────────────────────────────────────────
INSERT INTO public.semantic_catalog
  (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
VALUES
  ('wo_failure_data', 'subunit_code', 'Subunit',
   'ISO 14224 level-7 subunit the diagnosed fault sat in (lubrication system, shaft seal system, windings...). SUBUNIT dictionary scoped per asset class. Sits between the asset (level 6) and the failed BOM component (level 8/9).',
   ARRAY['work_management','reliability','iso14224'], 'Reliability Engineering',
   ARRAY['wo_failure_data','reference_codes'], 'ISO 14224'),
  ('wo_failure_items', NULL, 'Additional Damage Items',
   'Extra faults found on the same work order beyond the primary damage record (SAP notification items). Each carries its own subunit, component (BOM link), failure mode and cause. Reliability engines count the PRIMARY record; use this table to catch multi-fault events in deep dives.',
   ARRAY['work_management','reliability','iso14224'], 'Reliability Engineering',
   ARRAY['wo_failure_items','wo_failure_data','asset_bom'], 'ISO 14224')
ON CONFLICT DO NOTHING;
