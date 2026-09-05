-- ============================================================================
-- 0317 — ISO 14224 hierarchy numbering, equipment taxonomy, operating context
--
-- Four findings from the RCM operating-context review (2026-09-05):
--
--  A. HIERARCHY LEVEL NUMBERS were one short of ISO 14224:2016 Table 3. The
--     code default and the GLOBAL hierarchy_config row put Equipment at L5 and
--     Component at L6; the standard is Installation L3, Plant/Unit L4,
--     Section/System L5, EQUIPMENT UNIT L6, Subunit L7, Component L8, Part L9
--     — and the failure taxonomy (0285/0288) was already built on L6/L7. This
--     renumbers every saved config (global and any tenant copy), adds the
--     optional SUBUNIT level under EQUIPMENT, and leaves labels/rules alone.
--
--  B. THE CATEGORY → CLASS → TYPE CASCADE was broken and inverted. Live
--     reference_codes pointed Type at Category (so the Type picker was empty
--     for every class but one), the "class" rows were ISO *types* (Centrifugal
--     Pump) and the "type" rows ISO *classes* (Pump). This seeds the ISO 14224
--     Annex A taxonomy as GLOBAL rows (company_id NULL — tenant-shadowable per
--     0267): 8 categories → 47 classes (Table A.4) → 179 types (A.2.x), every
--     tier with an "Other". Each class carries properties.failureScope, the
--     vocabulary FAILURE_MODE (0285) and SUBUNIT (0288) rows are scoped by, so
--     the work-order pickers can filter by class again. Generated from
--     src/lib/iso14224Taxonomy.ts by scripts/gen-iso14224-seed.mjs; the test
--     iso14224Taxonomy.test.ts asserts this file carries every code.
--     Legacy global rows that clash in meaning are DEACTIVATED, never deleted.
--
--  C. REGISTER DATA: 15 assets carried a LEVEL code (AREA, SYSTEM, SITE…) in
--     asset_type_code — placement, not a type — and the 3 real types used the
--     legacy vocabulary (MOTOR, PUMP). Cleared / remapped onto the ISO codes.
--
--  D. OPERATING CONTEXT had nowhere to live. assets.operating_context (JSONB)
--     holds ISO 14224 §7 / Table 5 operating data plus the Annex A design vs
--     operating parameter table (shape: src/lib/operatingContext.ts).
--     ers_rcm_studies.context_snapshot records what an RCM study assumed
--     (SAE JA1011 §5.1 — the operating context is part of the analysis record).
--
-- Idempotent. Additive except for the data fixes in C, which are reversible
-- from the audit trail (assets have an audit trigger).
-- ============================================================================

BEGIN;

-- ── A. Hierarchy levels → ISO 14224 Table 3 numbering ───────────────────────
DO $$
DECLARE
    r        record;
    lvl      jsonb;
    out_lvls jsonb;
    has_sub  boolean;
    iso      int;
BEGIN
    FOR r IN SELECT id, company_id, levels FROM public.hierarchy_config LOOP
        out_lvls := '[]'::jsonb;
        has_sub  := false;
        FOR lvl IN SELECT * FROM jsonb_array_elements(r.levels) LOOP
            iso := CASE upper(lvl->>'code')
                     WHEN 'SITE'      THEN 3
                     WHEN 'AREA'      THEN 4
                     WHEN 'UNIT'      THEN 4
                     WHEN 'SYSTEM'    THEN 5
                     WHEN 'SUBSYSTEM' THEN 5
                     WHEN 'EQUIPMENT' THEN 6
                     WHEN 'SUBUNIT'   THEN 7
                     WHEN 'COMPONENT' THEN 8
                     ELSE NULL END;
            IF iso IS NOT NULL THEN
                lvl := jsonb_set(lvl, '{isoLevel}', to_jsonb(iso), true);
            END IF;
            IF upper(lvl->>'code') = 'EQUIPMENT'
               AND NOT (COALESCE(lvl->'allowedChildCodes', '[]'::jsonb) ? 'SUBUNIT') THEN
                lvl := jsonb_set(lvl, '{allowedChildCodes}',
                                 COALESCE(lvl->'allowedChildCodes', '[]'::jsonb) || '["SUBUNIT"]'::jsonb, true);
            END IF;
            IF upper(lvl->>'code') = 'SUBUNIT' THEN has_sub := true; END IF;
            out_lvls := out_lvls || jsonb_build_array(lvl);
        END LOOP;
        IF NOT has_sub THEN
            out_lvls := out_lvls || jsonb_build_array(jsonb_build_object(
                'code', 'SUBUNIT', 'isoLevel', 7, 'label', 'Subunit',
                'objectClass', 'EQUIPMENT', 'numbering', 'EQ', 'criticality', 'optional',
                'showEquipmentFields', true, 'allowedChildCodes', jsonb_build_array('COMPONENT')));
        END IF;
        UPDATE public.hierarchy_config SET levels = out_lvls, updated_at = now() WHERE id = r.id;
    END LOOP;
END $$;

-- ── B. ISO 14224 Annex A taxonomy (global rows) ─────────────────────────────
-- B.1 legacy global rows whose MEANING clashes with the ISO tiers → inactive.
--     (PRESSURE_VESSEL / STORAGE_TANK / HEAT_EXCHANGER keep their code and are
--     upserted in place below; the codes of ISO *types* that were filed as
--     classes, and the level codes filed as types, go inactive.)
UPDATE public.reference_codes
   SET active = false, updated_at = now(),
       properties = COALESCE(properties, '{}'::jsonb) || '{"retiredBy":"0317","retiredReason":"ISO 14224 taxonomy: this was an equipment TYPE filed as a class"}'::jsonb
 WHERE company_id IS NULL AND category = 'ASSET_CLASS'
   AND code IN ('CENTRIFUGAL_PUMP','RECIPROCATING_PUMP','SCREW_COMPRESSOR','RECIPROCATING_COMPRESSOR','GATE_VALVE','BALL_VALVE');

UPDATE public.reference_codes
   SET active = false, updated_at = now(),
       properties = COALESCE(properties, '{}'::jsonb) || '{"retiredBy":"0317","retiredReason":"ISO 14224 taxonomy: hierarchy LEVELS are not equipment types; legacy class words moved to ASSET_CLASS"}'::jsonb
 WHERE company_id IS NULL AND category = 'ASSET_TYPE'
   AND code IN ('SITE','AREA','UNIT','SYSTEM','SUBSYSTEM','EQUIPMENT','COMPONENT',
                'PUMP','MOTOR','VALVE','TANK','COMPRESSOR','FAN','CONVEYOR');

-- A user-added global type with no parent: file it under the mobile "Other" class.
UPDATE public.reference_codes
   SET category_ref = 'VEHICLE',
       properties = COALESCE(properties, '{}'::jsonb) || '{"categoryRef":"VEHICLE"}'::jsonb,
       updated_at = now()
 WHERE company_id IS NULL AND category = 'ASSET_TYPE' AND code = 'CHASSIS'
   AND COALESCE(properties->>'categoryRef', category_ref) IS NULL;

-- B.2 the taxonomy. GENERATED — do not hand-edit (scripts/gen-iso14224-seed.mjs).
INSERT INTO public.reference_codes (category, code, description, category_ref, properties, is_locked, active)
SELECT v.category, v.code, v.description, v.category_ref, v.properties, false, true
FROM (VALUES
    ('ASSET_CATEGORY', 'ROTATING', 'Rotating equipment', NULL, '{"source":"ISO 14224:2016 Table A.1","iso":"Rotating equipment"}'::jsonb),
    ('ASSET_CATEGORY', 'STATIC', 'Mechanical (static) equipment', NULL, '{"source":"ISO 14224:2016 Table A.1","iso":"Mechanical equipment"}'::jsonb),
    ('ASSET_CATEGORY', 'ELECTRICAL', 'Electrical equipment', NULL, '{"source":"ISO 14224:2016 Table A.1","iso":"Electrical equipment"}'::jsonb),
    ('ASSET_CATEGORY', 'INSTRUMENTATION', 'Safety & control (instrumentation)', NULL, '{"source":"ISO 14224:2016 Table A.1","iso":"Safety and control equipment"}'::jsonb),
    ('ASSET_CATEGORY', 'STRUCTURAL', 'Structural & civil', NULL, '{"source":"ISO 14224:2016 Table A.1","iso":"Structures (Annex A.2.7)"}'::jsonb),
    ('ASSET_CATEGORY', 'MOBILE', 'Mobile & lifting equipment', NULL, '{"source":"ISO 14224:2016 Table A.1","iso":"Lifting equipment / vehicles"}'::jsonb),
    ('ASSET_CATEGORY', 'UTILITY', 'Utilities & HVAC', NULL, '{"source":"ISO 14224:2016 Table A.1","iso":"Utilities"}'::jsonb),
    ('ASSET_CATEGORY', 'OTHER', 'Other / unclassified', NULL, '{"source":"ISO 14224:2016 Table A.1","iso":"Not in ISO 14224 Table A.1"}'::jsonb),
    ('ASSET_CLASS', 'PUMP', 'Pump', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING","isoRef":"A.2.4.6"}'::jsonb),
    ('ASSET_CLASS', 'COMPRESSOR', 'Compressor', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING","isoRef":"A.2.4.2"}'::jsonb),
    ('ASSET_CLASS', 'GAS_TURBINE', 'Gas turbine', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING","isoRef":"A.2.4.5"}'::jsonb),
    ('ASSET_CLASS', 'STEAM_TURBINE', 'Steam turbine', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING","isoRef":"A.2.4.7"}'::jsonb),
    ('ASSET_CLASS', 'TURBOEXPANDER', 'Turboexpander', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING","isoRef":"A.2.4.8"}'::jsonb),
    ('ASSET_CLASS', 'COMBUSTION_ENGINE', 'Combustion engine (diesel/gas)', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING","isoRef":"A.2.4.1"}'::jsonb),
    ('ASSET_CLASS', 'ELECTRIC_MOTOR', 'Electric motor', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ELECTRICAL","isoRef":"A.2.4.4"}'::jsonb),
    ('ASSET_CLASS', 'ELECTRIC_GENERATOR', 'Electric generator', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ELECTRICAL","isoRef":"A.2.4.3"}'::jsonb),
    ('ASSET_CLASS', 'FAN_BLOWER', 'Fan / blower', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING"}'::jsonb),
    ('ASSET_CLASS', 'GEARBOX', 'Gearbox / power transmission', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING"}'::jsonb),
    ('ASSET_CLASS', 'AGITATOR_MIXER', 'Agitator / mixer', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING"}'::jsonb),
    ('ASSET_CLASS', 'CONVEYOR', 'Conveyor', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING","failureScope":"ROTATING"}'::jsonb),
    ('ASSET_CLASS', 'HEAT_EXCHANGER', 'Heat exchanger', 'STATIC', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STATIC","failureScope":"HEAT_TRANSFER","isoRef":"A.2.5.2"}'::jsonb),
    ('ASSET_CLASS', 'HEATER_BOILER', 'Heater / boiler', 'STATIC', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STATIC","failureScope":"HEAT_TRANSFER","isoRef":"A.2.5.3"}'::jsonb),
    ('ASSET_CLASS', 'PRESSURE_VESSEL', 'Pressure vessel / column', 'STATIC', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STATIC","failureScope":"STATIC_PRESSURE","isoRef":"A.2.5.6"}'::jsonb),
    ('ASSET_CLASS', 'STORAGE_TANK', 'Storage tank', 'STATIC', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STATIC","failureScope":"STATIC_PRESSURE","isoRef":"A.2.5.7"}'::jsonb),
    ('ASSET_CLASS', 'PIPING', 'Piping / pipeline', 'STATIC', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STATIC","failureScope":"PIPING","isoRef":"A.2.5.5"}'::jsonb),
    ('ASSET_CLASS', 'VALVE', 'Valve (manual / isolation)', 'STATIC', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STATIC","failureScope":"STATIC_PRESSURE","isoRef":"A.2.5.8"}'::jsonb),
    ('ASSET_CLASS', 'FILTER_STRAINER', 'Filter / strainer', 'STATIC', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STATIC","failureScope":"STATIC_PRESSURE","isoRef":"A.2.5.1"}'::jsonb),
    ('ASSET_CLASS', 'TRANSFORMER', 'Transformer', 'ELECTRICAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ELECTRICAL","failureScope":"ELECTRICAL","isoRef":"A.2.3.4"}'::jsonb),
    ('ASSET_CLASS', 'SWITCHGEAR', 'Switchgear / MCC', 'ELECTRICAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ELECTRICAL","failureScope":"ELECTRICAL","isoRef":"A.2.3.3"}'::jsonb),
    ('ASSET_CLASS', 'UPS', 'UPS / DC power system', 'ELECTRICAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ELECTRICAL","failureScope":"ELECTRICAL","isoRef":"A.2.3.1"}'::jsonb),
    ('ASSET_CLASS', 'FREQUENCY_CONVERTER', 'Frequency converter / VSD', 'ELECTRICAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ELECTRICAL","failureScope":"ELECTRICAL","isoRef":"A.2.3.2"}'::jsonb),
    ('ASSET_CLASS', 'POWER_CABLE', 'Power cable', 'ELECTRICAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ELECTRICAL","failureScope":"ELECTRICAL"}'::jsonb),
    ('ASSET_CLASS', 'CONTROL_LOGIC_UNIT', 'Control logic unit (PLC/DCS/SIS)', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION","failureScope":"INSTRUMENT","isoRef":"A.2.6.1"}'::jsonb),
    ('ASSET_CLASS', 'PROCESS_SENSOR', 'Process sensor / transmitter', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION","failureScope":"INSTRUMENT","isoRef":"A.2.6.3"}'::jsonb),
    ('ASSET_CLASS', 'ANALYSER', 'Analyser', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION","failureScope":"INSTRUMENT"}'::jsonb),
    ('ASSET_CLASS', 'CONTROL_VALVE', 'Control valve / choke', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION","failureScope":"INSTRUMENT","isoRef":"A.2.6.5"}'::jsonb),
    ('ASSET_CLASS', 'FIRE_GAS_DETECTOR', 'Fire & gas detector', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION","failureScope":"SAFETY_SYSTEM","isoRef":"A.2.6.2"}'::jsonb),
    ('ASSET_CLASS', 'SAFETY_VALVE', 'Pressure safety / relief valve', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION","failureScope":"SAFETY_SYSTEM","isoRef":"A.2.6.5"}'::jsonb),
    ('ASSET_CLASS', 'ESD_VALVE', 'Shutdown valve (ESDV / BDV)', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION","failureScope":"SAFETY_SYSTEM","isoRef":"A.2.6.5"}'::jsonb),
    ('ASSET_CLASS', 'DELUGE_NOZZLE', 'Fire-fighting nozzle / deluge', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION","failureScope":"SAFETY_SYSTEM","isoRef":"A.2.6.4"}'::jsonb),
    ('ASSET_CLASS', 'STRUCTURE', 'Steel structure / support', 'STRUCTURAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STRUCTURAL","failureScope":"STRUCTURAL"}'::jsonb),
    ('ASSET_CLASS', 'CIVIL', 'Civil / building / foundation', 'STRUCTURAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STRUCTURAL","failureScope":"STRUCTURAL"}'::jsonb),
    ('ASSET_CLASS', 'CRANE', 'Crane', 'MOBILE', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"MOBILE","isoRef":"A.2.5.4"}'::jsonb),
    ('ASSET_CLASS', 'WINCH_HOIST', 'Winch / hoist', 'MOBILE', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"MOBILE","isoRef":"A.2.5.9"}'::jsonb),
    ('ASSET_CLASS', 'VEHICLE', 'Vehicle / mobile plant', 'MOBILE', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"MOBILE"}'::jsonb),
    ('ASSET_CLASS', 'HVAC', 'HVAC', 'UTILITY', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"UTILITY"}'::jsonb),
    ('ASSET_CLASS', 'COOLING_TOWER', 'Cooling tower', 'UTILITY', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"UTILITY","failureScope":"HEAT_TRANSFER"}'::jsonb),
    ('ASSET_CLASS', 'ROTATING_OTHER', 'Other rotating equipment', 'ROTATING', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ROTATING"}'::jsonb),
    ('ASSET_CLASS', 'STATIC_OTHER', 'Other mechanical (static) equipment', 'STATIC', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STATIC"}'::jsonb),
    ('ASSET_CLASS', 'ELECTRICAL_OTHER', 'Other electrical equipment', 'ELECTRICAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"ELECTRICAL"}'::jsonb),
    ('ASSET_CLASS', 'INSTRUMENTATION_OTHER', 'Other safety & control (instrumentation)', 'INSTRUMENTATION', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"INSTRUMENTATION"}'::jsonb),
    ('ASSET_CLASS', 'STRUCTURAL_OTHER', 'Other structural & civil', 'STRUCTURAL', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"STRUCTURAL"}'::jsonb),
    ('ASSET_CLASS', 'MOBILE_OTHER', 'Other mobile & lifting equipment', 'MOBILE', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"MOBILE"}'::jsonb),
    ('ASSET_CLASS', 'UTILITY_OTHER', 'Other utilities & hvac', 'UTILITY', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"UTILITY"}'::jsonb),
    ('ASSET_CLASS', 'OTHER_CLASS', 'Unclassified equipment', 'OTHER', '{"source":"ISO 14224:2016 Table A.4","categoryRef":"OTHER"}'::jsonb),
    ('ASSET_TYPE', 'PUMP_CENTRIFUGAL', 'Centrifugal', 'PUMP', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PUMP"}'::jsonb),
    ('ASSET_TYPE', 'PUMP_RECIPROCATING', 'Reciprocating', 'PUMP', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PUMP"}'::jsonb),
    ('ASSET_TYPE', 'PUMP_ROTARY', 'Rotary (screw / gear / lobe)', 'PUMP', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PUMP"}'::jsonb),
    ('ASSET_TYPE', 'PUMP_OTHER', 'Other pump', 'PUMP', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PUMP"}'::jsonb),
    ('ASSET_TYPE', 'COMPRESSOR_CENTRIFUGAL', 'Centrifugal', 'COMPRESSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COMPRESSOR"}'::jsonb),
    ('ASSET_TYPE', 'COMPRESSOR_RECIPROCATING', 'Reciprocating', 'COMPRESSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COMPRESSOR"}'::jsonb),
    ('ASSET_TYPE', 'COMPRESSOR_SCREW', 'Screw', 'COMPRESSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COMPRESSOR"}'::jsonb),
    ('ASSET_TYPE', 'COMPRESSOR_AXIAL', 'Axial', 'COMPRESSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COMPRESSOR"}'::jsonb),
    ('ASSET_TYPE', 'COMPRESSOR_OTHER', 'Other compressor', 'COMPRESSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COMPRESSOR"}'::jsonb),
    ('ASSET_TYPE', 'GAS_TURBINE_HEAVY_DUTY', 'Industrial heavy-duty', 'GAS_TURBINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"GAS_TURBINE"}'::jsonb),
    ('ASSET_TYPE', 'GAS_TURBINE_AERODERIVATIVE', 'Aero-derivative', 'GAS_TURBINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"GAS_TURBINE"}'::jsonb),
    ('ASSET_TYPE', 'GAS_TURBINE_OTHER', 'Other gas turbine', 'GAS_TURBINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"GAS_TURBINE"}'::jsonb),
    ('ASSET_TYPE', 'STEAM_TURBINE_BACKPRESSURE', 'Back-pressure', 'STEAM_TURBINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STEAM_TURBINE"}'::jsonb),
    ('ASSET_TYPE', 'STEAM_TURBINE_CONDENSING', 'Condensing', 'STEAM_TURBINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STEAM_TURBINE"}'::jsonb),
    ('ASSET_TYPE', 'STEAM_TURBINE_OTHER', 'Other steam turbine', 'STEAM_TURBINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STEAM_TURBINE"}'::jsonb),
    ('ASSET_TYPE', 'TURBOEXPANDER_CENTRIFUGAL', 'Centrifugal (radial)', 'TURBOEXPANDER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"TURBOEXPANDER"}'::jsonb),
    ('ASSET_TYPE', 'TURBOEXPANDER_AXIAL', 'Axial', 'TURBOEXPANDER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"TURBOEXPANDER"}'::jsonb),
    ('ASSET_TYPE', 'TURBOEXPANDER_OTHER', 'Other turboexpander', 'TURBOEXPANDER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"TURBOEXPANDER"}'::jsonb),
    ('ASSET_TYPE', 'COMBUSTION_ENGINE_DIESEL', 'Diesel engine', 'COMBUSTION_ENGINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COMBUSTION_ENGINE"}'::jsonb),
    ('ASSET_TYPE', 'COMBUSTION_ENGINE_GAS', 'Gas engine', 'COMBUSTION_ENGINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COMBUSTION_ENGINE"}'::jsonb),
    ('ASSET_TYPE', 'COMBUSTION_ENGINE_OTHER', 'Other combustion engine (diesel/gas)', 'COMBUSTION_ENGINE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COMBUSTION_ENGINE"}'::jsonb),
    ('ASSET_TYPE', 'ELECTRIC_MOTOR_AC_INDUCTION', 'AC induction', 'ELECTRIC_MOTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ELECTRIC_MOTOR"}'::jsonb),
    ('ASSET_TYPE', 'ELECTRIC_MOTOR_AC_SYNCHRONOUS', 'AC synchronous', 'ELECTRIC_MOTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ELECTRIC_MOTOR"}'::jsonb),
    ('ASSET_TYPE', 'ELECTRIC_MOTOR_DC', 'DC', 'ELECTRIC_MOTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ELECTRIC_MOTOR"}'::jsonb),
    ('ASSET_TYPE', 'ELECTRIC_MOTOR_OTHER', 'Other electric motor', 'ELECTRIC_MOTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ELECTRIC_MOTOR"}'::jsonb),
    ('ASSET_TYPE', 'ELECTRIC_GENERATOR_GAS_TURBINE_DRIVEN', 'Gas-turbine driven', 'ELECTRIC_GENERATOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ELECTRIC_GENERATOR"}'::jsonb),
    ('ASSET_TYPE', 'ELECTRIC_GENERATOR_STEAM_TURBINE_DRIVEN', 'Steam-turbine driven', 'ELECTRIC_GENERATOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ELECTRIC_GENERATOR"}'::jsonb),
    ('ASSET_TYPE', 'ELECTRIC_GENERATOR_ENGINE_DRIVEN', 'Engine driven (diesel / gas)', 'ELECTRIC_GENERATOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ELECTRIC_GENERATOR"}'::jsonb),
    ('ASSET_TYPE', 'ELECTRIC_GENERATOR_OTHER', 'Other electric generator', 'ELECTRIC_GENERATOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ELECTRIC_GENERATOR"}'::jsonb),
    ('ASSET_TYPE', 'FAN_BLOWER_CENTRIFUGAL', 'Centrifugal', 'FAN_BLOWER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FAN_BLOWER"}'::jsonb),
    ('ASSET_TYPE', 'FAN_BLOWER_AXIAL', 'Axial', 'FAN_BLOWER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FAN_BLOWER"}'::jsonb),
    ('ASSET_TYPE', 'FAN_BLOWER_POSITIVE_DISPLACEMENT', 'Positive displacement', 'FAN_BLOWER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FAN_BLOWER"}'::jsonb),
    ('ASSET_TYPE', 'FAN_BLOWER_OTHER', 'Other fan / blower', 'FAN_BLOWER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FAN_BLOWER"}'::jsonb),
    ('ASSET_TYPE', 'GEARBOX_PARALLEL_SHAFT', 'Parallel shaft', 'GEARBOX', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"GEARBOX"}'::jsonb),
    ('ASSET_TYPE', 'GEARBOX_EPICYCLIC', 'Epicyclic / planetary', 'GEARBOX', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"GEARBOX"}'::jsonb),
    ('ASSET_TYPE', 'GEARBOX_WORM', 'Worm', 'GEARBOX', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"GEARBOX"}'::jsonb),
    ('ASSET_TYPE', 'GEARBOX_OTHER', 'Other gearbox / power transmission', 'GEARBOX', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"GEARBOX"}'::jsonb),
    ('ASSET_TYPE', 'AGITATOR_MIXER_TOP_ENTRY', 'Top entry', 'AGITATOR_MIXER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"AGITATOR_MIXER"}'::jsonb),
    ('ASSET_TYPE', 'AGITATOR_MIXER_SIDE_ENTRY', 'Side entry', 'AGITATOR_MIXER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"AGITATOR_MIXER"}'::jsonb),
    ('ASSET_TYPE', 'AGITATOR_MIXER_STATIC', 'Static mixer', 'AGITATOR_MIXER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"AGITATOR_MIXER"}'::jsonb),
    ('ASSET_TYPE', 'AGITATOR_MIXER_OTHER', 'Other agitator / mixer', 'AGITATOR_MIXER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"AGITATOR_MIXER"}'::jsonb),
    ('ASSET_TYPE', 'CONVEYOR_BELT', 'Belt', 'CONVEYOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONVEYOR"}'::jsonb),
    ('ASSET_TYPE', 'CONVEYOR_SCREW', 'Screw', 'CONVEYOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONVEYOR"}'::jsonb),
    ('ASSET_TYPE', 'CONVEYOR_BUCKET', 'Bucket elevator', 'CONVEYOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONVEYOR"}'::jsonb),
    ('ASSET_TYPE', 'CONVEYOR_CHAIN', 'Chain', 'CONVEYOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONVEYOR"}'::jsonb),
    ('ASSET_TYPE', 'CONVEYOR_OTHER', 'Other conveyor', 'CONVEYOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONVEYOR"}'::jsonb),
    ('ASSET_TYPE', 'HEAT_EXCHANGER_SHELL_TUBE', 'Shell & tube', 'HEAT_EXCHANGER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEAT_EXCHANGER"}'::jsonb),
    ('ASSET_TYPE', 'HEAT_EXCHANGER_PLATE', 'Plate', 'HEAT_EXCHANGER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEAT_EXCHANGER"}'::jsonb),
    ('ASSET_TYPE', 'HEAT_EXCHANGER_AIR_COOLED', 'Air-cooled (fin-fan)', 'HEAT_EXCHANGER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEAT_EXCHANGER"}'::jsonb),
    ('ASSET_TYPE', 'HEAT_EXCHANGER_DOUBLE_PIPE', 'Double pipe', 'HEAT_EXCHANGER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEAT_EXCHANGER"}'::jsonb),
    ('ASSET_TYPE', 'HEAT_EXCHANGER_PRINTED_CIRCUIT', 'Printed circuit', 'HEAT_EXCHANGER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEAT_EXCHANGER"}'::jsonb),
    ('ASSET_TYPE', 'HEAT_EXCHANGER_SPIRAL', 'Spiral', 'HEAT_EXCHANGER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEAT_EXCHANGER"}'::jsonb),
    ('ASSET_TYPE', 'HEAT_EXCHANGER_OTHER', 'Other heat exchanger', 'HEAT_EXCHANGER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEAT_EXCHANGER"}'::jsonb),
    ('ASSET_TYPE', 'HEATER_BOILER_FIRED_HEATER', 'Fired heater', 'HEATER_BOILER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEATER_BOILER"}'::jsonb),
    ('ASSET_TYPE', 'HEATER_BOILER_WATER_TUBE', 'Water-tube boiler', 'HEATER_BOILER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEATER_BOILER"}'::jsonb),
    ('ASSET_TYPE', 'HEATER_BOILER_FIRE_TUBE', 'Fire-tube boiler', 'HEATER_BOILER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEATER_BOILER"}'::jsonb),
    ('ASSET_TYPE', 'HEATER_BOILER_HRSG', 'Heat-recovery steam generator', 'HEATER_BOILER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEATER_BOILER"}'::jsonb),
    ('ASSET_TYPE', 'HEATER_BOILER_ELECTRIC', 'Electric heater', 'HEATER_BOILER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEATER_BOILER"}'::jsonb),
    ('ASSET_TYPE', 'HEATER_BOILER_OTHER', 'Other heater / boiler', 'HEATER_BOILER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HEATER_BOILER"}'::jsonb),
    ('ASSET_TYPE', 'PRESSURE_VESSEL_SEPARATOR', 'Separator', 'PRESSURE_VESSEL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PRESSURE_VESSEL"}'::jsonb),
    ('ASSET_TYPE', 'PRESSURE_VESSEL_SCRUBBER', 'Scrubber / knock-out drum', 'PRESSURE_VESSEL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PRESSURE_VESSEL"}'::jsonb),
    ('ASSET_TYPE', 'PRESSURE_VESSEL_COLUMN', 'Column / tower', 'PRESSURE_VESSEL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PRESSURE_VESSEL"}'::jsonb),
    ('ASSET_TYPE', 'PRESSURE_VESSEL_REACTOR', 'Reactor', 'PRESSURE_VESSEL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PRESSURE_VESSEL"}'::jsonb),
    ('ASSET_TYPE', 'PRESSURE_VESSEL_DRUM', 'Drum / accumulator', 'PRESSURE_VESSEL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PRESSURE_VESSEL"}'::jsonb),
    ('ASSET_TYPE', 'PRESSURE_VESSEL_CONTACTOR', 'Contactor', 'PRESSURE_VESSEL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PRESSURE_VESSEL"}'::jsonb),
    ('ASSET_TYPE', 'PRESSURE_VESSEL_COALESCER', 'Coalescer', 'PRESSURE_VESSEL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PRESSURE_VESSEL"}'::jsonb),
    ('ASSET_TYPE', 'PRESSURE_VESSEL_OTHER', 'Other pressure vessel / column', 'PRESSURE_VESSEL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PRESSURE_VESSEL"}'::jsonb),
    ('ASSET_TYPE', 'STORAGE_TANK_FIXED_ROOF', 'Fixed roof', 'STORAGE_TANK', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STORAGE_TANK"}'::jsonb),
    ('ASSET_TYPE', 'STORAGE_TANK_FLOATING_ROOF', 'Floating roof', 'STORAGE_TANK', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STORAGE_TANK"}'::jsonb),
    ('ASSET_TYPE', 'STORAGE_TANK_SPHERE', 'Sphere', 'STORAGE_TANK', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STORAGE_TANK"}'::jsonb),
    ('ASSET_TYPE', 'STORAGE_TANK_BULLET', 'Horizontal bullet', 'STORAGE_TANK', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STORAGE_TANK"}'::jsonb),
    ('ASSET_TYPE', 'STORAGE_TANK_OTHER', 'Other storage tank', 'STORAGE_TANK', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STORAGE_TANK"}'::jsonb),
    ('ASSET_TYPE', 'PIPING_PROCESS', 'Process piping', 'PIPING', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PIPING"}'::jsonb),
    ('ASSET_TYPE', 'PIPING_UTILITY', 'Utility piping', 'PIPING', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PIPING"}'::jsonb),
    ('ASSET_TYPE', 'PIPING_PIPELINE', 'Pipeline', 'PIPING', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PIPING"}'::jsonb),
    ('ASSET_TYPE', 'PIPING_FLEXIBLE', 'Flexible hose / riser', 'PIPING', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PIPING"}'::jsonb),
    ('ASSET_TYPE', 'PIPING_OTHER', 'Other piping / pipeline', 'PIPING', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PIPING"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_BALL', 'Ball', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_GATE', 'Gate', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_GLOBE', 'Globe', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_BUTTERFLY', 'Butterfly', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_CHECK', 'Check / non-return', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_PLUG', 'Plug', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_NEEDLE', 'Needle', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_DIAPHRAGM', 'Diaphragm', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'VALVE_OTHER', 'Other valve (manual / isolation)', 'VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VALVE"}'::jsonb),
    ('ASSET_TYPE', 'FILTER_STRAINER_CARTRIDGE', 'Cartridge filter', 'FILTER_STRAINER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FILTER_STRAINER"}'::jsonb),
    ('ASSET_TYPE', 'FILTER_STRAINER_BASKET', 'Basket strainer', 'FILTER_STRAINER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FILTER_STRAINER"}'::jsonb),
    ('ASSET_TYPE', 'FILTER_STRAINER_BAG', 'Bag filter', 'FILTER_STRAINER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FILTER_STRAINER"}'::jsonb),
    ('ASSET_TYPE', 'FILTER_STRAINER_COALESCING', 'Coalescing filter', 'FILTER_STRAINER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FILTER_STRAINER"}'::jsonb),
    ('ASSET_TYPE', 'FILTER_STRAINER_OTHER', 'Other filter / strainer', 'FILTER_STRAINER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FILTER_STRAINER"}'::jsonb),
    ('ASSET_TYPE', 'TRANSFORMER_POWER', 'Power transformer', 'TRANSFORMER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"TRANSFORMER"}'::jsonb),
    ('ASSET_TYPE', 'TRANSFORMER_DISTRIBUTION', 'Distribution transformer', 'TRANSFORMER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"TRANSFORMER"}'::jsonb),
    ('ASSET_TYPE', 'TRANSFORMER_INSTRUMENT', 'Instrument transformer (CT/VT)', 'TRANSFORMER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"TRANSFORMER"}'::jsonb),
    ('ASSET_TYPE', 'TRANSFORMER_OTHER', 'Other transformer', 'TRANSFORMER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"TRANSFORMER"}'::jsonb),
    ('ASSET_TYPE', 'SWITCHGEAR_LV', 'Low voltage', 'SWITCHGEAR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SWITCHGEAR"}'::jsonb),
    ('ASSET_TYPE', 'SWITCHGEAR_MV', 'Medium voltage', 'SWITCHGEAR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SWITCHGEAR"}'::jsonb),
    ('ASSET_TYPE', 'SWITCHGEAR_HV', 'High voltage', 'SWITCHGEAR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SWITCHGEAR"}'::jsonb),
    ('ASSET_TYPE', 'SWITCHGEAR_MCC', 'Motor control centre', 'SWITCHGEAR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SWITCHGEAR"}'::jsonb),
    ('ASSET_TYPE', 'SWITCHGEAR_OTHER', 'Other switchgear / mcc', 'SWITCHGEAR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SWITCHGEAR"}'::jsonb),
    ('ASSET_TYPE', 'UPS_STATIC', 'Static UPS', 'UPS', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"UPS"}'::jsonb),
    ('ASSET_TYPE', 'UPS_ROTARY', 'Rotary UPS', 'UPS', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"UPS"}'::jsonb),
    ('ASSET_TYPE', 'UPS_DC_SYSTEM', 'DC system / battery charger', 'UPS', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"UPS"}'::jsonb),
    ('ASSET_TYPE', 'UPS_OTHER', 'Other ups / dc power system', 'UPS', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"UPS"}'::jsonb),
    ('ASSET_TYPE', 'FREQUENCY_CONVERTER_LV_VSD', 'LV variable-speed drive', 'FREQUENCY_CONVERTER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FREQUENCY_CONVERTER"}'::jsonb),
    ('ASSET_TYPE', 'FREQUENCY_CONVERTER_MV_VSD', 'MV variable-speed drive', 'FREQUENCY_CONVERTER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FREQUENCY_CONVERTER"}'::jsonb),
    ('ASSET_TYPE', 'FREQUENCY_CONVERTER_SOFT_STARTER', 'Soft starter', 'FREQUENCY_CONVERTER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FREQUENCY_CONVERTER"}'::jsonb),
    ('ASSET_TYPE', 'FREQUENCY_CONVERTER_OTHER', 'Other frequency converter / vsd', 'FREQUENCY_CONVERTER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FREQUENCY_CONVERTER"}'::jsonb),
    ('ASSET_TYPE', 'POWER_CABLE_HV', 'High voltage', 'POWER_CABLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"POWER_CABLE"}'::jsonb),
    ('ASSET_TYPE', 'POWER_CABLE_MV', 'Medium voltage', 'POWER_CABLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"POWER_CABLE"}'::jsonb),
    ('ASSET_TYPE', 'POWER_CABLE_LV', 'Low voltage', 'POWER_CABLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"POWER_CABLE"}'::jsonb),
    ('ASSET_TYPE', 'POWER_CABLE_OTHER', 'Other power cable', 'POWER_CABLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"POWER_CABLE"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_LOGIC_UNIT_PLC', 'PLC', 'CONTROL_LOGIC_UNIT', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_LOGIC_UNIT"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_LOGIC_UNIT_DCS', 'DCS', 'CONTROL_LOGIC_UNIT', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_LOGIC_UNIT"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_LOGIC_UNIT_SIS', 'Safety logic solver (SIS)', 'CONTROL_LOGIC_UNIT', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_LOGIC_UNIT"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_LOGIC_UNIT_RTU', 'RTU', 'CONTROL_LOGIC_UNIT', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_LOGIC_UNIT"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_LOGIC_UNIT_OTHER', 'Other control logic unit (plc/dcs/sis)', 'CONTROL_LOGIC_UNIT', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_LOGIC_UNIT"}'::jsonb),
    ('ASSET_TYPE', 'PROCESS_SENSOR_PRESSURE', 'Pressure', 'PROCESS_SENSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PROCESS_SENSOR"}'::jsonb),
    ('ASSET_TYPE', 'PROCESS_SENSOR_TEMPERATURE', 'Temperature', 'PROCESS_SENSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PROCESS_SENSOR"}'::jsonb),
    ('ASSET_TYPE', 'PROCESS_SENSOR_FLOW', 'Flow', 'PROCESS_SENSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PROCESS_SENSOR"}'::jsonb),
    ('ASSET_TYPE', 'PROCESS_SENSOR_LEVEL', 'Level', 'PROCESS_SENSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PROCESS_SENSOR"}'::jsonb),
    ('ASSET_TYPE', 'PROCESS_SENSOR_VIBRATION', 'Vibration', 'PROCESS_SENSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PROCESS_SENSOR"}'::jsonb),
    ('ASSET_TYPE', 'PROCESS_SENSOR_OTHER', 'Other process sensor / transmitter', 'PROCESS_SENSOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"PROCESS_SENSOR"}'::jsonb),
    ('ASSET_TYPE', 'ANALYSER_GAS_CHROMATOGRAPH', 'Gas chromatograph', 'ANALYSER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ANALYSER"}'::jsonb),
    ('ASSET_TYPE', 'ANALYSER_MOISTURE', 'Moisture / dew point', 'ANALYSER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ANALYSER"}'::jsonb),
    ('ASSET_TYPE', 'ANALYSER_OXYGEN', 'Oxygen', 'ANALYSER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ANALYSER"}'::jsonb),
    ('ASSET_TYPE', 'ANALYSER_PH_CONDUCTIVITY', 'pH / conductivity', 'ANALYSER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ANALYSER"}'::jsonb),
    ('ASSET_TYPE', 'ANALYSER_OTHER', 'Other analyser', 'ANALYSER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ANALYSER"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_VALVE_GLOBE', 'Globe control valve', 'CONTROL_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_VALVE_BUTTERFLY', 'Butterfly control valve', 'CONTROL_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_VALVE_BALL', 'Ball control valve', 'CONTROL_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_VALVE_CHOKE', 'Choke valve', 'CONTROL_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'CONTROL_VALVE_OTHER', 'Other control valve / choke', 'CONTROL_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CONTROL_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'FIRE_GAS_DETECTOR_FLAMMABLE_GAS', 'Flammable gas', 'FIRE_GAS_DETECTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FIRE_GAS_DETECTOR"}'::jsonb),
    ('ASSET_TYPE', 'FIRE_GAS_DETECTOR_TOXIC_GAS', 'Toxic gas', 'FIRE_GAS_DETECTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FIRE_GAS_DETECTOR"}'::jsonb),
    ('ASSET_TYPE', 'FIRE_GAS_DETECTOR_FLAME', 'Flame', 'FIRE_GAS_DETECTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FIRE_GAS_DETECTOR"}'::jsonb),
    ('ASSET_TYPE', 'FIRE_GAS_DETECTOR_SMOKE', 'Smoke', 'FIRE_GAS_DETECTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FIRE_GAS_DETECTOR"}'::jsonb),
    ('ASSET_TYPE', 'FIRE_GAS_DETECTOR_HEAT', 'Heat', 'FIRE_GAS_DETECTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FIRE_GAS_DETECTOR"}'::jsonb),
    ('ASSET_TYPE', 'FIRE_GAS_DETECTOR_OTHER', 'Other fire & gas detector', 'FIRE_GAS_DETECTOR', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"FIRE_GAS_DETECTOR"}'::jsonb),
    ('ASSET_TYPE', 'SAFETY_VALVE_SPRING_PSV', 'Spring-loaded PSV', 'SAFETY_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SAFETY_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'SAFETY_VALVE_PILOT_PSV', 'Pilot-operated PSV', 'SAFETY_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SAFETY_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'SAFETY_VALVE_RUPTURE_DISC', 'Rupture disc', 'SAFETY_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SAFETY_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'SAFETY_VALVE_VACUUM_RELIEF', 'Vacuum / pressure-vacuum relief', 'SAFETY_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SAFETY_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'SAFETY_VALVE_OTHER', 'Other pressure safety / relief valve', 'SAFETY_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"SAFETY_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'ESD_VALVE_ESDV', 'Emergency shutdown valve', 'ESD_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ESD_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'ESD_VALVE_BDV', 'Blowdown valve', 'ESD_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ESD_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'ESD_VALVE_SSIV', 'Subsea isolation valve', 'ESD_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ESD_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'ESD_VALVE_OTHER', 'Other shutdown valve (esdv / bdv)', 'ESD_VALVE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"ESD_VALVE"}'::jsonb),
    ('ASSET_TYPE', 'DELUGE_NOZZLE_DELUGE', 'Deluge', 'DELUGE_NOZZLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"DELUGE_NOZZLE"}'::jsonb),
    ('ASSET_TYPE', 'DELUGE_NOZZLE_SPRINKLER', 'Sprinkler', 'DELUGE_NOZZLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"DELUGE_NOZZLE"}'::jsonb),
    ('ASSET_TYPE', 'DELUGE_NOZZLE_WATER_MIST', 'Water mist', 'DELUGE_NOZZLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"DELUGE_NOZZLE"}'::jsonb),
    ('ASSET_TYPE', 'DELUGE_NOZZLE_FOAM', 'Foam', 'DELUGE_NOZZLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"DELUGE_NOZZLE"}'::jsonb),
    ('ASSET_TYPE', 'DELUGE_NOZZLE_OTHER', 'Other fire-fighting nozzle / deluge', 'DELUGE_NOZZLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"DELUGE_NOZZLE"}'::jsonb),
    ('ASSET_TYPE', 'STRUCTURE_STEEL', 'Steel structure', 'STRUCTURE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STRUCTURE"}'::jsonb),
    ('ASSET_TYPE', 'STRUCTURE_PIPE_RACK', 'Pipe rack', 'STRUCTURE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STRUCTURE"}'::jsonb),
    ('ASSET_TYPE', 'STRUCTURE_PLATFORM', 'Platform / deck', 'STRUCTURE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STRUCTURE"}'::jsonb),
    ('ASSET_TYPE', 'STRUCTURE_OTHER', 'Other steel structure / support', 'STRUCTURE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"STRUCTURE"}'::jsonb),
    ('ASSET_TYPE', 'CIVIL_BUILDING', 'Building', 'CIVIL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CIVIL"}'::jsonb),
    ('ASSET_TYPE', 'CIVIL_FOUNDATION', 'Foundation', 'CIVIL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CIVIL"}'::jsonb),
    ('ASSET_TYPE', 'CIVIL_ROAD', 'Road / paving', 'CIVIL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CIVIL"}'::jsonb),
    ('ASSET_TYPE', 'CIVIL_OTHER', 'Other civil / building / foundation', 'CIVIL', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CIVIL"}'::jsonb),
    ('ASSET_TYPE', 'CRANE_OVERHEAD', 'Overhead / gantry', 'CRANE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CRANE"}'::jsonb),
    ('ASSET_TYPE', 'CRANE_PEDESTAL', 'Pedestal', 'CRANE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CRANE"}'::jsonb),
    ('ASSET_TYPE', 'CRANE_MOBILE', 'Mobile crane', 'CRANE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CRANE"}'::jsonb),
    ('ASSET_TYPE', 'CRANE_OTHER', 'Other crane', 'CRANE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"CRANE"}'::jsonb),
    ('ASSET_TYPE', 'WINCH_HOIST_HOIST', 'Electric hoist', 'WINCH_HOIST', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"WINCH_HOIST"}'::jsonb),
    ('ASSET_TYPE', 'WINCH_HOIST_WINCH', 'Winch', 'WINCH_HOIST', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"WINCH_HOIST"}'::jsonb),
    ('ASSET_TYPE', 'WINCH_HOIST_OTHER', 'Other winch / hoist', 'WINCH_HOIST', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"WINCH_HOIST"}'::jsonb),
    ('ASSET_TYPE', 'VEHICLE_FORKLIFT', 'Forklift', 'VEHICLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VEHICLE"}'::jsonb),
    ('ASSET_TYPE', 'VEHICLE_TRUCK', 'Truck', 'VEHICLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VEHICLE"}'::jsonb),
    ('ASSET_TYPE', 'VEHICLE_LIGHT', 'Light vehicle', 'VEHICLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VEHICLE"}'::jsonb),
    ('ASSET_TYPE', 'VEHICLE_OTHER', 'Other vehicle / mobile plant', 'VEHICLE', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"VEHICLE"}'::jsonb),
    ('ASSET_TYPE', 'HVAC_AHU', 'Air-handling unit', 'HVAC', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HVAC"}'::jsonb),
    ('ASSET_TYPE', 'HVAC_CHILLER', 'Chiller', 'HVAC', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HVAC"}'::jsonb),
    ('ASSET_TYPE', 'HVAC_PACKAGED', 'Packaged / split unit', 'HVAC', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HVAC"}'::jsonb),
    ('ASSET_TYPE', 'HVAC_OTHER', 'Other hvac', 'HVAC', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"HVAC"}'::jsonb),
    ('ASSET_TYPE', 'COOLING_TOWER_INDUCED_DRAFT', 'Induced draft', 'COOLING_TOWER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COOLING_TOWER"}'::jsonb),
    ('ASSET_TYPE', 'COOLING_TOWER_FORCED_DRAFT', 'Forced draft', 'COOLING_TOWER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COOLING_TOWER"}'::jsonb),
    ('ASSET_TYPE', 'COOLING_TOWER_OTHER', 'Other cooling tower', 'COOLING_TOWER', '{"source":"ISO 14224:2016 Annex A.2","categoryRef":"COOLING_TOWER"}'::jsonb)
) AS v(category, code, description, category_ref, properties)
ON CONFLICT (company_id, category, code) DO UPDATE
  SET description  = EXCLUDED.description,
      category_ref = EXCLUDED.category_ref,
      properties   = COALESCE(public.reference_codes.properties, '{}'::jsonb) || EXCLUDED.properties,
      active       = true,
      updated_at   = now();
-- 8 categories, 47 classes, 179 types

-- ── C. Register data ────────────────────────────────────────────────────────
-- C.1 level codes are placement, not a type
UPDATE public.assets
   SET asset_type_code = NULL, updated_at = now()
 WHERE upper(asset_type_code) IN ('SITE','AREA','UNIT','SYSTEM','SUBSYSTEM','EQUIPMENT','SUBUNIT','COMPONENT');

-- C.2 legacy words in asset_class / asset_type_code → ISO category/class/type
--     (mirror of LEGACY_CLASS_MAP in src/lib/iso14224Taxonomy.ts)
WITH legacy(old_code, category, cls, typ) AS (VALUES
    ('PUMP',                     'ROTATING',        'PUMP',               NULL),
    ('MOTOR',                    'ROTATING',        'ELECTRIC_MOTOR',     NULL),
    ('COMPRESSOR',               'ROTATING',        'COMPRESSOR',         NULL),
    ('FAN',                      'ROTATING',        'FAN_BLOWER',         NULL),
    ('CONVEYOR',                 'ROTATING',        'CONVEYOR',           NULL),
    ('TURBINE',                  'ROTATING',        'GAS_TURBINE',        NULL),
    ('VALVE',                    'STATIC',          'VALVE',              NULL),
    ('TANK',                     'STATIC',          'STORAGE_TANK',       NULL),
    ('VESSEL',                   'STATIC',          'PRESSURE_VESSEL',    NULL),
    ('EXCHANGER',                'STATIC',          'HEAT_EXCHANGER',     NULL),
    ('CENTRIFUGAL_PUMP',         'ROTATING',        'PUMP',               'PUMP_CENTRIFUGAL'),
    ('RECIPROCATING_PUMP',       'ROTATING',        'PUMP',               'PUMP_RECIPROCATING'),
    ('SCREW_COMPRESSOR',         'ROTATING',        'COMPRESSOR',         'COMPRESSOR_SCREW'),
    ('RECIPROCATING_COMPRESSOR', 'ROTATING',        'COMPRESSOR',         'COMPRESSOR_RECIPROCATING'),
    ('CENTRIFUGAL_COMPRESSOR',   'ROTATING',        'COMPRESSOR',         'COMPRESSOR_CENTRIFUGAL'),
    ('GATE_VALVE',               'STATIC',          'VALVE',              'VALVE_GATE'),
    ('BALL_VALVE',               'STATIC',          'VALVE',              'VALVE_BALL'),
    ('GENERATOR',                'ROTATING',        'ELECTRIC_GENERATOR', NULL),
    ('VSD',                      'ELECTRICAL',      'FREQUENCY_CONVERTER',NULL),
    ('PSV',                      'INSTRUMENTATION', 'SAFETY_VALVE',       NULL),
    ('ESD',                      'INSTRUMENTATION', 'ESD_VALVE',          NULL),
    ('FIRE_GAS',                 'INSTRUMENTATION', 'FIRE_GAS_DETECTOR',  NULL),
    ('GAS_DETECTOR',             'INSTRUMENTATION', 'FIRE_GAS_DETECTOR',  'FIRE_GAS_DETECTOR_FLAMMABLE_GAS'),
    ('FIRE_DETECTOR',            'INSTRUMENTATION', 'FIRE_GAS_DETECTOR',  'FIRE_GAS_DETECTOR_FLAME')
)
UPDATE public.assets a
   SET asset_category  = COALESCE(NULLIF(a.asset_category, ''), l.category),
       asset_class     = l.cls,
       asset_type_code = COALESCE(l.typ, CASE WHEN upper(a.asset_type_code) = l.old_code THEN NULL ELSE a.asset_type_code END),
       updated_at      = now()
  FROM legacy l
 WHERE upper(COALESCE(a.asset_class, '')) = l.old_code
    OR (COALESCE(a.asset_class, '') = '' AND upper(COALESCE(a.asset_type_code, '')) = l.old_code);

-- ── D. Operating context ────────────────────────────────────────────────────
ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS operating_context jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.assets.operating_context IS
    'ISO 14224 §7 / Table 5 operating data (mode, utilisation, hours/starts per year, redundancy, environment[], service_medium, duty_description) plus Annex A class-specific parameters [{key,label,unit,design,operating,max,kind,custom}]. Shape: src/lib/operatingContext.ts. Read by RCM (snapshotted onto the study) and the Reliability Specialist prompts. updated_at inside the JSON is the edit stamp the RCM study compares against.';

ALTER TABLE public.ers_rcm_studies
    ADD COLUMN IF NOT EXISTS context_snapshot jsonb;
COMMENT ON COLUMN public.ers_rcm_studies.context_snapshot IS
    'The asset operating context this study was analysed against (SAE JA1011 §5.1) — {taken_at, asset_updated_at, classification{category,cls,type}, context}. Taken when the study is created or "refreshed from register"; the Overview warns when the asset''s context has moved on.';

-- ── E. Catalogue (WHERE NOT EXISTS rather than ON CONFLICT: the live unique
--       index expression carries a mis-encoded middle dot — see runbook) ─────
INSERT INTO public.semantic_catalog (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
SELECT 'assets', 'operating_context', 'Operating context',
       'ISO 14224 operating data and Annex A design-vs-operating parameters for the asset: mode (continuous/standby/…), utilisation, redundancy, environment, service medium, duty narrative, and a parameter table with design (nameplate), normal operating and max values. Operating above design is the derating signal RCM and Predict read. Empty {} until the register is filled.',
       ARRAY['assets','context','iso14224','rcm','design'], 'Reliability Engineering', ARRAY['assets'], 'ISO 14224:2016 §7, Annex A'
WHERE NOT EXISTS (SELECT 1 FROM public.semantic_catalog WHERE object_name = 'assets' AND column_name = 'operating_context');

INSERT INTO public.semantic_catalog (object_name, column_name, title, description, tags, owner, source_tables, iso_standard)
SELECT 'ers_rcm_studies', 'context_snapshot', 'Operating context snapshot',
       'What the RCM study assumed about the asset when it was analysed: a copy of assets.operating_context plus the classification, with the time it was taken. Differences from the live asset context mean the study may need review.',
       ARRAY['rcm','context','iso14224','ja1011'], 'Reliability Engineering', ARRAY['ers_rcm_studies','assets'], 'SAE JA1011 §5.1'
WHERE NOT EXISTS (SELECT 1 FROM public.semantic_catalog WHERE object_name = 'ers_rcm_studies' AND column_name = 'context_snapshot');

-- ── prove ───────────────────────────────────────────────────────────────────
DO $$
DECLARE n_cat int; n_cls int; n_typ int; n_lvl int; n_bad int; n_eq int;
BEGIN
    SELECT count(*) INTO n_cat FROM public.reference_codes WHERE company_id IS NULL AND category = 'ASSET_CATEGORY' AND active;
    SELECT count(*) INTO n_cls FROM public.reference_codes WHERE company_id IS NULL AND category = 'ASSET_CLASS'    AND active;
    SELECT count(*) INTO n_typ FROM public.reference_codes WHERE company_id IS NULL AND category = 'ASSET_TYPE'     AND active;
    IF n_cat < 8 OR n_cls < 47 OR n_typ < 179 THEN
        RAISE EXCEPTION 'ISO 14224 taxonomy incomplete: % categories, % classes, % types', n_cat, n_cls, n_typ;
    END IF;
    -- every active class/type has a parent that exists and is active
    SELECT count(*) INTO n_bad
      FROM public.reference_codes c
     WHERE c.company_id IS NULL AND c.active AND c.category IN ('ASSET_CLASS','ASSET_TYPE')
       AND NOT EXISTS (SELECT 1 FROM public.reference_codes p
                        WHERE p.company_id IS NULL AND p.active
                          AND p.category = CASE c.category WHEN 'ASSET_CLASS' THEN 'ASSET_CATEGORY' ELSE 'ASSET_CLASS' END
                          AND p.code = COALESCE(c.properties->>'categoryRef', c.category_ref));
    IF n_bad > 0 THEN RAISE EXCEPTION '% active taxonomy rows point at a missing/inactive parent', n_bad; END IF;
    -- no level codes left in asset_type_code
    SELECT count(*) INTO n_bad FROM public.assets WHERE upper(asset_type_code) IN ('SITE','AREA','UNIT','SYSTEM','SUBSYSTEM','EQUIPMENT','SUBUNIT','COMPONENT');
    IF n_bad > 0 THEN RAISE EXCEPTION '% assets still carry a level code as their type', n_bad; END IF;
    -- every saved hierarchy config has Equipment at ISO L6
    SELECT count(*) INTO n_lvl FROM public.hierarchy_config;
    SELECT count(*) INTO n_eq
      FROM public.hierarchy_config h, jsonb_array_elements(h.levels) l
     WHERE upper(l->>'code') = 'EQUIPMENT' AND (l->>'isoLevel')::int = 6;
    IF n_lvl > 0 AND n_eq <> n_lvl THEN RAISE EXCEPTION 'hierarchy_config: % of % rows have EQUIPMENT at ISO level 6', n_eq, n_lvl; END IF;
    PERFORM 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'operating_context';
    IF NOT FOUND THEN RAISE EXCEPTION 'assets.operating_context missing'; END IF;
    RAISE NOTICE '0317 ok: % categories / % classes / % types; % hierarchy config rows renumbered', n_cat, n_cls, n_typ, n_lvl;
END $$;

COMMIT;

-- VERIFY (after apply):
--   SELECT code, (l->>'isoLevel') FROM public.hierarchy_config h, jsonb_array_elements(h.levels) l, LATERAL (SELECT l->>'code' code) c;
--   SELECT category, count(*) FROM public.reference_codes WHERE company_id IS NULL AND active AND category LIKE 'ASSET_%' GROUP BY 1;
--   SELECT tag, asset_category, asset_class, asset_type_code FROM public.assets WHERE asset_class IS NOT NULL;
