-- 0352 — RCM Phase 2: a shipped breakdown library, whole-study templates
-- spooled onto similar assets, and typed items promoted into the register.
--
--   (1) Library: one breakdown template per ISO 14224 equipment class, scope
--       'library' (company_id NULL, visible to every tenant, never editable by
--       one). Subunits and maintainable items follow ISO 14224:2016 Annex A;
--       a tenant's own template for the same class is offered first.
--   (2) ers_rcm_study_templates — a whole study (breakdown, functions, modes
--       with pins and effects, decisions with consequence/strategy/task/interval
--       as defaults) saved by class/type. "Apply to similar assets" creates one
--       study per asset, marked derived + unreviewed.
--   (3) ers_rcm_studies.derived_from_template_id / template_review_status —
--       a derived study cannot be approved until the facilitator confirms the
--       per-asset review (operating context, consequences). rcm_source gains
--       'template'.
--   (4) rcm_promote_items_to_register(study) — typed items become child assets
--       and BOM lines under the study's register asset; the items and their
--       modes gain the register links.
BEGIN;

-- ── (1) shipped library ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rcm_seed_library_breakdown(p_class text, p_name text, p_items jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ers_rcm_breakdown_templates t WHERE t.scope = 'library' AND t.asset_class = p_class AND t.name = p_name) THEN
    INSERT INTO public.ers_rcm_breakdown_templates (name, asset_class, asset_type_code, items, scope, company_id)
    VALUES (p_name, p_class, NULL, p_items, 'library', NULL);
  END IF;
END;
$$;

-- helper: subunit key s<n>, items i<n>; parent_key names the subunit
SELECT public.rcm_seed_library_breakdown('PUMP', 'ISO 14224 — Pump (Table A.6)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Power transmission","critical":false},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Gearbox / variable drive","critical":false},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Bearing (power transmission)","critical":false},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Seal (power transmission)","critical":false},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Coupling to driver","critical":true},
 {"key":"i5","parent_key":"s1","kind":"component","name":"Coupling to driven unit","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Pump unit","critical":true},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Support","critical":false},
 {"key":"i7","parent_key":"s2","kind":"component","name":"Casing","critical":true},
 {"key":"i8","parent_key":"s2","kind":"component","name":"Impeller","critical":true},
 {"key":"i9","parent_key":"s2","kind":"component","name":"Shaft","critical":true},
 {"key":"i10","parent_key":"s2","kind":"component","name":"Radial bearing","critical":true},
 {"key":"i11","parent_key":"s2","kind":"component","name":"Thrust bearing","critical":true},
 {"key":"i12","parent_key":"s2","kind":"component","name":"Seal (mechanical / packing)","critical":true},
 {"key":"i13","parent_key":"s2","kind":"component","name":"Cylinder liner / piston / diaphragm (PD pumps)","critical":false},
 {"key":"i14","parent_key":"s2","kind":"component","name":"Valves (PD pumps)","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":false},
 {"key":"i15","parent_key":"s3","kind":"component","name":"Control unit","critical":false},
 {"key":"i16","parent_key":"s3","kind":"component","name":"Actuating device","critical":false},
 {"key":"i17","parent_key":"s3","kind":"component","name":"Sensors (monitoring)","critical":false},
 {"key":"i18","parent_key":"s3","kind":"component","name":"Wiring","critical":false},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Lubrication system","critical":false},
 {"key":"i19","parent_key":"s4","kind":"component","name":"Reservoir with heating","critical":false},
 {"key":"i20","parent_key":"s4","kind":"component","name":"Lube oil pump with motor","critical":false},
 {"key":"i21","parent_key":"s4","kind":"component","name":"Lube oil filter","critical":false},
 {"key":"i22","parent_key":"s4","kind":"component","name":"Lube oil cooler","critical":false},
 {"key":"i23","parent_key":"s4","kind":"component","name":"Lube oil valves and piping","critical":false},
 {"key":"s5","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i24","parent_key":"s5","kind":"component","name":"Purge air","critical":false},
 {"key":"i25","parent_key":"s5","kind":"component","name":"Cooling / heating system","critical":false},
 {"key":"i26","parent_key":"s5","kind":"component","name":"Suction filter / strainer","critical":false},
 {"key":"i27","parent_key":"s5","kind":"component","name":"Pulsation damper","critical":false},
 {"key":"i28","parent_key":"s5","kind":"component","name":"Flange joints and piping","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('COMPRESSOR', 'ISO 14224 — Compressor (Table A.3)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Power transmission","critical":false},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Gearbox / variable drive","critical":false},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Bearing (power transmission)","critical":false},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Coupling to driver","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Coupling to driven unit","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Compressor unit","critical":true},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Casing","critical":true},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Rotor with impellers / blades","critical":true},
 {"key":"i7","parent_key":"s2","kind":"component","name":"Shaft","critical":true},
 {"key":"i8","parent_key":"s2","kind":"component","name":"Radial bearing","critical":true},
 {"key":"i9","parent_key":"s2","kind":"component","name":"Thrust bearing","critical":true},
 {"key":"i10","parent_key":"s2","kind":"component","name":"Shaft seal (dry gas / oil / labyrinth)","critical":true},
 {"key":"i11","parent_key":"s2","kind":"component","name":"Internal seals / diaphragms","critical":false},
 {"key":"i12","parent_key":"s2","kind":"component","name":"Cylinder liner, piston, valves (reciprocating)","critical":false},
 {"key":"i13","parent_key":"s2","kind":"component","name":"Balance drum / piston","critical":false},
 {"key":"i14","parent_key":"s2","kind":"component","name":"Antisurge valve and recycle","critical":true},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":false},
 {"key":"i15","parent_key":"s3","kind":"component","name":"Control unit","critical":false},
 {"key":"i16","parent_key":"s3","kind":"component","name":"Actuating device","critical":false},
 {"key":"i17","parent_key":"s3","kind":"component","name":"Sensors (vibration, temperature, pressure)","critical":false},
 {"key":"i18","parent_key":"s3","kind":"component","name":"Wiring and instrument cabling","critical":false},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Lubrication system","critical":true},
 {"key":"i19","parent_key":"s4","kind":"component","name":"Reservoir with heating","critical":false},
 {"key":"i20","parent_key":"s4","kind":"component","name":"Lube oil pump with motor","critical":true},
 {"key":"i21","parent_key":"s4","kind":"component","name":"Lube oil filter","critical":false},
 {"key":"i22","parent_key":"s4","kind":"component","name":"Lube oil cooler","critical":false},
 {"key":"i23","parent_key":"s4","kind":"component","name":"Lube oil valves and piping","critical":false},
 {"key":"s5","parent_key":null,"kind":"subunit","name":"Shaft seal system","critical":true},
 {"key":"i24","parent_key":"s5","kind":"component","name":"Seal gas panel / conditioning","critical":true},
 {"key":"i25","parent_key":"s5","kind":"component","name":"Seal oil pump / reservoir (wet seals)","critical":false},
 {"key":"i26","parent_key":"s5","kind":"component","name":"Seal gas filter","critical":false},
 {"key":"i27","parent_key":"s5","kind":"component","name":"Seal vent / drain","critical":false},
 {"key":"s6","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i28","parent_key":"s6","kind":"component","name":"Intercooler / aftercooler","critical":false},
 {"key":"i29","parent_key":"s6","kind":"component","name":"Suction filter / silencer","critical":false},
 {"key":"i30","parent_key":"s6","kind":"component","name":"Pulsation damper (reciprocating)","critical":false},
 {"key":"i31","parent_key":"s6","kind":"component","name":"Flange joints and process piping","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('GAS_TURBINE', 'ISO 14224 — Gas turbine (Table A.5)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Starting system","critical":false},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Starting unit / motor","critical":false},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Starting energy (battery / air / hydraulic)","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Air intake","critical":false},
 {"key":"i3","parent_key":"s2","kind":"component","name":"Inlet filter","critical":false},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Inlet guide vanes","critical":false},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Anti-icing / inlet cooling","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Compressor section","critical":true},
 {"key":"i6","parent_key":"s3","kind":"component","name":"Compressor rotor / blades","critical":true},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Compressor stator / casing","critical":true},
 {"key":"i8","parent_key":"s3","kind":"component","name":"Bleed valves","critical":false},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Combustion system","critical":true},
 {"key":"i9","parent_key":"s4","kind":"component","name":"Combustion liner","critical":true},
 {"key":"i10","parent_key":"s4","kind":"component","name":"Fuel nozzles / burners","critical":true},
 {"key":"i11","parent_key":"s4","kind":"component","name":"Transition pieces","critical":true},
 {"key":"i12","parent_key":"s4","kind":"component","name":"Ignition system","critical":false},
 {"key":"s5","parent_key":null,"kind":"subunit","name":"Turbine section","critical":true},
 {"key":"i13","parent_key":"s5","kind":"component","name":"HP turbine blades / nozzles","critical":true},
 {"key":"i14","parent_key":"s5","kind":"component","name":"Power turbine blades / nozzles","critical":true},
 {"key":"i15","parent_key":"s5","kind":"component","name":"Turbine rotor / discs / shaft","critical":true},
 {"key":"i16","parent_key":"s5","kind":"component","name":"Bearings (radial / thrust)","critical":true},
 {"key":"i17","parent_key":"s5","kind":"component","name":"Seals","critical":false},
 {"key":"s6","parent_key":null,"kind":"subunit","name":"Exhaust","critical":false},
 {"key":"i18","parent_key":"s6","kind":"component","name":"Exhaust diffuser / duct","critical":false},
 {"key":"i19","parent_key":"s6","kind":"component","name":"Silencer","critical":false},
 {"key":"s7","parent_key":null,"kind":"subunit","name":"Fuel system","critical":true},
 {"key":"i20","parent_key":"s7","kind":"component","name":"Fuel gas / liquid skid","critical":true},
 {"key":"i21","parent_key":"s7","kind":"component","name":"Fuel control valve","critical":true},
 {"key":"i22","parent_key":"s7","kind":"component","name":"Fuel filters","critical":false},
 {"key":"s8","parent_key":null,"kind":"subunit","name":"Lubrication system","critical":true},
 {"key":"i23","parent_key":"s8","kind":"component","name":"Lube oil pumps (main / auxiliary / emergency)","critical":true},
 {"key":"i24","parent_key":"s8","kind":"component","name":"Lube oil reservoir, filters, coolers","critical":false},
 {"key":"s9","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":true},
 {"key":"i25","parent_key":"s9","kind":"component","name":"Control unit / governor","critical":true},
 {"key":"i26","parent_key":"s9","kind":"component","name":"Sensors (speed, vibration, temperature)","critical":false},
 {"key":"i27","parent_key":"s9","kind":"component","name":"Actuating devices","critical":false},
 {"key":"s10","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i28","parent_key":"s10","kind":"component","name":"Enclosure, fire & gas, ventilation","critical":false},
 {"key":"i29","parent_key":"s10","kind":"component","name":"Washing system","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('STEAM_TURBINE', 'ISO 14224 — Steam turbine (Table A.11)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Turbine unit","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Rotor / blades","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Casing / diaphragms","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Bearings (radial / thrust)","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Gland seals","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Steam admission and exhaust","critical":true},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Trip and throttle valve","critical":true},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Governor / control valves","critical":true},
 {"key":"i7","parent_key":"s2","kind":"component","name":"Condenser / exhaust","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Lubrication system","critical":true},
 {"key":"i8","parent_key":"s3","kind":"component","name":"Lube oil pumps, reservoir, filters, coolers","critical":true},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":true},
 {"key":"i9","parent_key":"s4","kind":"component","name":"Governor / control unit","critical":true},
 {"key":"i10","parent_key":"s4","kind":"component","name":"Overspeed protection","critical":true},
 {"key":"i11","parent_key":"s4","kind":"component","name":"Sensors","critical":false},
 {"key":"s5","parent_key":null,"kind":"subunit","name":"Power transmission","critical":false},
 {"key":"i12","parent_key":"s5","kind":"component","name":"Gearbox","critical":false},
 {"key":"i13","parent_key":"s5","kind":"component","name":"Couplings","critical":true}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('COMBUSTION_ENGINE', 'ISO 14224 — Combustion engine (Table A.2)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Engine unit","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Cylinders, pistons, liners","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Crankshaft and bearings","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Cylinder heads and valves","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Turbocharger","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Fuel system","critical":true},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Fuel pumps / injectors","critical":true},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Fuel filters and piping","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Cooling system","critical":true},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Coolant pump, radiator, thermostat","critical":true},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Lubrication system","critical":true},
 {"key":"i8","parent_key":"s4","kind":"component","name":"Oil pump, filter, cooler","critical":true},
 {"key":"s5","parent_key":null,"kind":"subunit","name":"Starting system","critical":false},
 {"key":"i9","parent_key":"s5","kind":"component","name":"Starter motor / air starter, batteries","critical":false},
 {"key":"s6","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":true},
 {"key":"i10","parent_key":"s6","kind":"component","name":"Governor / control unit","critical":true},
 {"key":"i11","parent_key":"s6","kind":"component","name":"Sensors and wiring","critical":false},
 {"key":"s7","parent_key":null,"kind":"subunit","name":"Exhaust and air intake","critical":false},
 {"key":"i12","parent_key":"s7","kind":"component","name":"Air filter, exhaust manifold, silencer","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('ELECTRIC_MOTOR', 'ISO 14224 — Electric motor (Table A.4)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Electric motor unit","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Stator (winding, insulation)","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Rotor","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Radial bearing","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Thrust bearing","critical":false},
 {"key":"i5","parent_key":"s1","kind":"component","name":"Terminal box / connections","critical":true},
 {"key":"i6","parent_key":"s1","kind":"component","name":"Slip rings / brushes (if fitted)","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Cooling","critical":false},
 {"key":"i7","parent_key":"s2","kind":"component","name":"Fan / cooler / heat exchanger","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Lubrication","critical":false},
 {"key":"i8","parent_key":"s3","kind":"component","name":"Grease / oil supply","critical":false},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":false},
 {"key":"i9","parent_key":"s4","kind":"component","name":"Sensors (winding RTD, vibration)","critical":false},
 {"key":"i10","parent_key":"s4","kind":"component","name":"Space heater","critical":false},
 {"key":"s5","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i11","parent_key":"s5","kind":"component","name":"Coupling / drive end","critical":true},
 {"key":"i12","parent_key":"s5","kind":"component","name":"Base frame / supports","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('ELECTRIC_GENERATOR', 'ISO 14224 — Electric generator (Table A.4)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Generator unit","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Stator (winding, insulation)","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Rotor / field winding","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Bearings","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Exciter / AVR","critical":true},
 {"key":"i5","parent_key":"s1","kind":"component","name":"Slip rings / brushes","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Cooling","critical":false},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Air / water cooler","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":true},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Protection relays","critical":true},
 {"key":"i8","parent_key":"s3","kind":"component","name":"Synchronising / control unit","critical":true},
 {"key":"i9","parent_key":"s3","kind":"component","name":"Sensors","critical":false},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i10","parent_key":"s4","kind":"component","name":"Coupling","critical":true},
 {"key":"i11","parent_key":"s4","kind":"component","name":"Terminal box / busbar","critical":true}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('FAN_BLOWER', 'Fan / blower — standard breakdown', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Fan unit","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Impeller / blades","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Shaft","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Bearings","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Casing / housing","critical":false},
 {"key":"i5","parent_key":"s1","kind":"component","name":"Dampers / vanes","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Power transmission","critical":false},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Belt drive / coupling","critical":true},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":false},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Sensors and control","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('GEARBOX', 'Gearbox — standard breakdown', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Gear unit","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Gear wheels / pinions","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Shafts","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Bearings","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Seals","critical":false},
 {"key":"i5","parent_key":"s1","kind":"component","name":"Housing","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Lubrication system","critical":true},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Oil pump, filter, cooler","critical":true},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":false},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Sensors (vibration, temperature)","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('HEAT_EXCHANGER', 'ISO 14224 — Heat exchanger (Table A.9)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"External","critical":false},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Shell / body","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Support / structure","critical":false},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Nozzles and flanges","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Gaskets / bolting","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Internal","critical":true},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Tube bundle / plates","critical":true},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Tube sheets / baffles","critical":true},
 {"key":"i7","parent_key":"s2","kind":"component","name":"Channel / floating head","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":false},
 {"key":"i8","parent_key":"s3","kind":"component","name":"Sensors (temperature, pressure)","critical":false},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i9","parent_key":"s4","kind":"component","name":"Fans / louvres (air-cooled)","critical":false},
 {"key":"i10","parent_key":"s4","kind":"component","name":"Insulation / cladding","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('PRESSURE_VESSEL', 'ISO 14224 — Vessel (Table A.16)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"External","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Shell / heads","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Nozzles and flanges","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Support / skirt","critical":false},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Manways / gaskets / bolting","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Internal","critical":false},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Trays / packing / demister","critical":false},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Internal lining / cladding","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":true},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Level, pressure, temperature instruments","critical":true},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i8","parent_key":"s4","kind":"component","name":"Insulation / fireproofing","critical":false},
 {"key":"i9","parent_key":"s4","kind":"component","name":"Relief / safety devices","critical":true}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('STORAGE_TANK', 'ISO 14224 — Storage tank (Table A.13)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"External","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Shell / bottom / roof","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Nozzles and manways","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Foundation / bund","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Internal","critical":false},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Floating roof / seals","critical":false},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Heating coils / mixers","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":true},
 {"key":"i6","parent_key":"s3","kind":"component","name":"Level gauging / overfill protection","critical":true},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i7","parent_key":"s4","kind":"component","name":"Vents / PVRV / flame arrestor","critical":true},
 {"key":"i8","parent_key":"s4","kind":"component","name":"Cathodic protection / coating","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('HEATER_BOILER', 'ISO 14224 — Heater / boiler (Table A.8)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Firing system","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Burners","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Fuel valves / burner management","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Ignition / flame detection","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Heat transfer","critical":true},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Radiant / convection tubes","critical":true},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Refractory / casing","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Air and flue gas","critical":false},
 {"key":"i6","parent_key":"s3","kind":"component","name":"Forced / induced draft fans, dampers","critical":false},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Stack / air preheater","critical":false},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":true},
 {"key":"i8","parent_key":"s4","kind":"component","name":"Combustion control / safety system","critical":true},
 {"key":"i9","parent_key":"s4","kind":"component","name":"Sensors (tube skin, O2, draft)","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('PIPING', 'ISO 14224 — Piping (Table A.10)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Pipe","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Pipe wall / fittings / bends","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Flanges / gaskets / bolting","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Welds","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Supports","critical":false},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Pipe supports / hangers / expansion joints","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Protection","critical":false},
 {"key":"i5","parent_key":"s3","kind":"component","name":"Insulation / coating / CP","critical":false},
 {"key":"s4","parent_key":null,"kind":"subunit","name":"Inline items","critical":false},
 {"key":"i6","parent_key":"s4","kind":"component","name":"Manual valves / strainers / drains","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('VALVE', 'ISO 14224 — Valve (Table A.15)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Valve body","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Body / bonnet","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Seat / ball / disc / gate","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Stem","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Packing / seals / gaskets","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Actuator","critical":false},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Handwheel / gear operator","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Miscellaneous","critical":false},
 {"key":"i6","parent_key":"s3","kind":"component","name":"Flanges / bolting","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('CONTROL_VALVE', 'ISO 14224 — Control valve (Table A.15)', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Valve","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Body / bonnet","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Trim (plug, seat, cage)","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Stem / packing","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Actuator","critical":true},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Actuator (pneumatic / hydraulic / electric)","critical":true},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Positioner","critical":true},
 {"key":"i6","parent_key":"s2","kind":"component","name":"Solenoid / air supply / filter regulator","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":false},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Position feedback / limit switches","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('SAFETY_VALVE', 'Pressure safety / relief valve — standard breakdown', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Valve","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Body / nozzle / disc","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Spring / bellows / pilot","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Guide / stem / seals","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Installation","critical":false},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Inlet / outlet piping and isolation","critical":false},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Rupture disc (if fitted)","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('ESD_VALVE', 'Shutdown valve (ESDV / BDV) — standard breakdown', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Valve","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Body / ball or gate / seats","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Stem / packing","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Actuator","critical":true},
 {"key":"i3","parent_key":"s2","kind":"component","name":"Actuator (spring-return)","critical":true},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Solenoid valve / quick exhaust","critical":true},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Hydraulic / pneumatic supply","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Control and monitoring","critical":true},
 {"key":"i6","parent_key":"s3","kind":"component","name":"Limit switches / partial-stroke test","critical":true}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('TRANSFORMER', 'Transformer — standard breakdown', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Transformer unit","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Windings / core","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Bushings","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Tap changer","critical":true},
 {"key":"i4","parent_key":"s1","kind":"component","name":"Tank / oil / conservator","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Cooling","critical":false},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Radiators / fans / pumps","critical":false},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Protection and monitoring","critical":true},
 {"key":"i6","parent_key":"s3","kind":"component","name":"Buchholz / pressure relief / temperature","critical":true},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Protection relays","critical":true}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('SWITCHGEAR', 'Switchgear / MCC — standard breakdown', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Switching devices","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Circuit breakers","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Contactors / starters","critical":true},
 {"key":"i3","parent_key":"s1","kind":"component","name":"Isolators / fuses","critical":false},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Busbars and connections","critical":true},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Busbars / insulators","critical":true},
 {"key":"i5","parent_key":"s2","kind":"component","name":"Cable terminations","critical":true},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Protection and control","critical":true},
 {"key":"i6","parent_key":"s3","kind":"component","name":"Protection relays / trip units","critical":true},
 {"key":"i7","parent_key":"s3","kind":"component","name":"Auxiliary supplies / heaters","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('PROCESS_SENSOR', 'Process sensor / transmitter — standard breakdown', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Sensing element","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Element / probe / diaphragm","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Process connection / impulse line / thermowell","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Transmitter","critical":true},
 {"key":"i3","parent_key":"s2","kind":"component","name":"Electronics / housing","critical":true},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Signal cable / junction box","critical":false}
]'::jsonb);

SELECT public.rcm_seed_library_breakdown('CRANE', 'Crane — standard breakdown', '[
 {"key":"s1","parent_key":null,"kind":"subunit","name":"Structure","critical":true},
 {"key":"i1","parent_key":"s1","kind":"component","name":"Boom / jib / girder","critical":true},
 {"key":"i2","parent_key":"s1","kind":"component","name":"Slew ring / bearing","critical":true},
 {"key":"s2","parent_key":null,"kind":"subunit","name":"Hoisting","critical":true},
 {"key":"i3","parent_key":"s2","kind":"component","name":"Winch / wire rope / hook","critical":true},
 {"key":"i4","parent_key":"s2","kind":"component","name":"Brakes","critical":true},
 {"key":"s3","parent_key":null,"kind":"subunit","name":"Power and control","critical":true},
 {"key":"i5","parent_key":"s3","kind":"component","name":"Hydraulic / electric drive","critical":true},
 {"key":"i6","parent_key":"s3","kind":"component","name":"Safe load indicator / limit switches","critical":true}
]'::jsonb);

DROP FUNCTION public.rcm_seed_library_breakdown(text, text, jsonb);

-- ── (2) whole-study templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ers_rcm_study_templates (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL,
    asset_class      text,
    asset_type_code  text,
    payload          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {items:[...], functions:[{..., failure_modes:[{..., item_key, decision:{...}}]}]}
    scope            text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('tenant', 'library')),
    from_study_id    uuid,
    version          int  NOT NULL DEFAULT 1,
    created_by       uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    company_id       uuid
);
CREATE INDEX IF NOT EXISTS idx_ers_rcm_study_templates_class ON public.ers_rcm_study_templates(asset_class, asset_type_code);
COMMENT ON TABLE public.ers_rcm_study_templates IS '0352: a whole RCM study (breakdown, worksheet, decisions as defaults) saved by ISO 14224 class/type and spooled onto similar assets.';
DROP TRIGGER IF EXISTS set_rcm_study_templates_updated_at ON public.ers_rcm_study_templates;
CREATE TRIGGER set_rcm_study_templates_updated_at BEFORE UPDATE ON public.ers_rcm_study_templates FOR EACH ROW EXECUTE FUNCTION public.update_rcm_updated_at();
DROP TRIGGER IF EXISTS trg_rcm_study_template_stamp ON public.ers_rcm_study_templates;
CREATE TRIGGER trg_rcm_study_template_stamp BEFORE INSERT ON public.ers_rcm_study_templates FOR EACH ROW EXECUTE FUNCTION public.rcm_template_stamp();
ALTER TABLE public.ers_rcm_study_templates ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ers_rcm_study_templates' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.ers_rcm_study_templates', p.policyname);
  END LOOP;
  CREATE POLICY rcm_select_ers_rcm_study_templates ON public.ers_rcm_study_templates FOR SELECT TO authenticated
    USING (company_id IS NULL OR company_id = (SELECT public.caller_company()));
  CREATE POLICY rcm_insert_ers_rcm_study_templates ON public.ers_rcm_study_templates FOR INSERT TO authenticated
    WITH CHECK (scope = 'tenant' AND (public.is_admin() OR public.caller_can('reliability', 'edit') OR public.caller_can('reliability', 'create')));
  CREATE POLICY rcm_update_ers_rcm_study_templates ON public.ers_rcm_study_templates FOR UPDATE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (public.is_admin() OR public.caller_can('reliability', 'edit')))
    WITH CHECK (company_id = (SELECT public.caller_company()) AND scope = 'tenant');
  CREATE POLICY rcm_delete_ers_rcm_study_templates ON public.ers_rcm_study_templates FOR DELETE TO authenticated
    USING (company_id = (SELECT public.caller_company()) AND (public.is_admin() OR public.caller_can('reliability', 'edit')));
END $$;

-- ── (3) derived studies ─────────────────────────────────────────────────────
ALTER TABLE public.ers_rcm_studies
    ADD COLUMN IF NOT EXISTS derived_from_template_id uuid REFERENCES public.ers_rcm_study_templates(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS template_review_status text CHECK (template_review_status IN ('unreviewed', 'reviewed'));
ALTER TABLE public.ers_rcm_studies DROP CONSTRAINT IF EXISTS ers_rcm_studies_rcm_source_check;
ALTER TABLE public.ers_rcm_studies ADD CONSTRAINT ers_rcm_studies_rcm_source_check CHECK (rcm_source = ANY (ARRAY['new'::text, 'imported_fmea'::text, 'ai_generated'::text, 'template'::text]));
COMMENT ON COLUMN public.ers_rcm_studies.template_review_status IS '0352: a derived study stays unreviewed until the facilitator confirms the operating context and every consequence for THIS asset; approval refuses until reviewed.';

CREATE OR REPLACE FUNCTION public.rcm_study_approval_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_modes int; v_unclassified int; v_unstrategised int;
BEGIN
  -- An approver who is not an editor may touch the sign-off columns only.
  IF NOT public.rcm_can_edit(NEW.id) THEN
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
       OR NEW.operating_context IS DISTINCT FROM OLD.operating_context OR NEW.study_type IS DISTINCT FROM OLD.study_type
       OR NEW.facilitator IS DISTINCT FROM OLD.facilitator OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.collaborators IS DISTINCT FROM OLD.collaborators OR NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot
       OR NEW.criticality_rank IS DISTINCT FROM OLD.criticality_rank OR NEW.rcm_source IS DISTINCT FROM OLD.rcm_source
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'RCM_EDIT_DENIED: a reviewer may approve or reopen the study, not edit it'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Entering approved: the right person, every question answered, and a derived study reviewed for THIS asset.
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    IF NOT public.rcm_can_approve(NEW.id) THEN
      RAISE EXCEPTION 'RCM_APPROVE_DENIED: approval needs the study facilitator, a reviewer on its team, or an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.derived_from_template_id IS NOT NULL AND coalesce(NEW.template_review_status, 'unreviewed') <> 'reviewed' THEN
      RAISE EXCEPTION 'RCM_APPROVE_DENIED: this study was spooled from a template — confirm the operating context and each consequence for this asset (Overview → Confirm review) before approving'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT count(m.id),
           count(m.id) FILTER (WHERE coalesce(d.consequence_code, '') = ''),
           count(m.id) FILTER (WHERE coalesce(d.recommended_strategy_code, '') = '')
      INTO v_modes, v_unclassified, v_unstrategised
      FROM public.ers_rcm_functions f
      JOIN public.ers_rcm_failure_modes m ON m.function_id = f.id
      LEFT JOIN public.ers_rcm_decisions d ON d.failure_mode_id = m.id
     WHERE f.study_id = NEW.id;
    IF coalesce(v_modes, 0) = 0 THEN
      RAISE EXCEPTION 'RCM_APPROVE_DENIED: a worksheet with at least one function and failure mode is needed before approval'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_unclassified > 0 OR v_unstrategised > 0 THEN
      RAISE EXCEPTION 'RCM_APPROVE_DENIED: % failure mode(s) without a consequence class (Q5) and % without a strategy (Q6-Q7)', v_unclassified, v_unstrategised
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.approved_at := coalesce(NEW.approved_at, now());
    NEW.approved_by := coalesce(nullif(NEW.approved_by, ''), auth.jwt() ->> 'email', 'approver');
    NEW.approved_by_user_id := auth.uid();
  END IF;

  -- Leaving approved (other than closing) is a revision: the right person, and a bump.
  IF OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
    IF NOT public.rcm_can_approve(NEW.id) THEN
      RAISE EXCEPTION 'RCM_REOPEN_DENIED: reopening an approved study needs the study facilitator, a reviewer on its team, or an administrator'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.status <> 'closed' THEN
      IF coalesce(NEW.revision, 1) <= coalesce(OLD.revision, 1) THEN
        NEW.revision := coalesce(OLD.revision, 1) + 1;
      END IF;
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
      NEW.approved_by_user_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── (4) typed items → the register ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rcm_promote_items_to_register(p_study uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record; it record; v_parent uuid; v_tag text; v_base text; v_n int; v_asset uuid; v_bom uuid;
  n_assets int := 0; n_bom int := 0; v_crit public.assets.criticality%TYPE; v_status text;
BEGIN
  SELECT st.id, st.asset_id, st.company_id, st.status INTO s FROM public.ers_rcm_studies st WHERE st.id = p_study;
  IF s.id IS NULL THEN RAISE EXCEPTION 'RCM_PROMOTE_DENIED: study not found' USING ERRCODE = 'no_data_found'; END IF;
  IF NOT (public.is_admin() OR public.caller_can('assets', 'create') OR public.caller_can('assets', 'edit')) OR NOT public.rcm_can_edit(p_study) THEN
    RAISE EXCEPTION 'RCM_PROMOTE_DENIED: promoting items into the register needs assets.create and the right to edit this study' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF s.asset_id IS NULL OR s.asset_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'RCM_PROMOTE_DENIED: link the study to a register asset first — a manual tag has nothing to hang children on' USING ERRCODE = 'check_violation';
  END IF;
  IF s.status = 'approved' THEN
    RAISE EXCEPTION 'RCM_PROMOTE_DENIED: the study is approved — Revise it first (the items gain register links)' USING ERRCODE = 'check_violation';
  END IF;
  v_asset := s.asset_id::uuid;
  SELECT a.tag, a.criticality, a.status_code INTO v_base, v_crit, v_status FROM public.assets a WHERE a.id = v_asset;

  -- components and subunits: parents before children (depth by walking parent_item_id)
  FOR it IN
    WITH RECURSIVE tree AS (
      SELECT i.*, 1 AS depth FROM public.ers_rcm_study_items i WHERE i.study_id = p_study AND i.kind <> 'part' AND i.parent_item_id IS NULL
      UNION ALL
      SELECT i.*, t.depth + 1 FROM public.ers_rcm_study_items i JOIN tree t ON i.parent_item_id = t.id WHERE i.kind <> 'part' AND t.depth < 6
    )
    SELECT * FROM tree ORDER BY depth, sort_order
  LOOP
    IF it.asset_id IS NOT NULL THEN CONTINUE; END IF;
    SELECT p.asset_id INTO v_parent FROM public.ers_rcm_study_items p WHERE p.id = it.parent_item_id;
    v_parent := coalesce(v_parent, v_asset);
    v_tag := coalesce(nullif(trim(it.tag), ''), regexp_replace(upper(it.name), '[^A-Z0-9]+', '-', 'g'));
    v_tag := left(regexp_replace(v_tag, '^-+|-+$', '', 'g'), 24);
    IF left(v_tag, length(v_base) + 1) <> v_base || '-' THEN v_tag := v_base || '-' || v_tag; END IF;
    v_n := 0;
    WHILE EXISTS (SELECT 1 FROM public.assets a WHERE a.company_id = s.company_id AND a.tag = v_tag || CASE WHEN v_n > 0 THEN '-' || v_n ELSE '' END) LOOP v_n := v_n + 1; END LOOP;
    IF v_n > 0 THEN v_tag := v_tag || '-' || v_n; END IF;
    INSERT INTO public.assets (tag, name, parent_id, hierarchy_level, criticality, status_code, company_id)
    VALUES (v_tag, it.name, v_parent, CASE WHEN it.kind = 'subunit' THEN 'SUBUNIT' ELSE 'COMPONENT' END, CASE WHEN it.critical THEN v_crit ELSE NULL END, coalesce(v_status, 'ACTIVE'), s.company_id)
    RETURNING id INTO v_parent;
    UPDATE public.ers_rcm_study_items SET asset_id = v_parent, tag = coalesce(tag, v_tag) WHERE id = it.id;
    UPDATE public.ers_rcm_failure_modes SET component_asset_id = v_parent WHERE study_item_id = it.id AND component_asset_id IS NULL;
    n_assets := n_assets + 1;
  END LOOP;

  -- parts: BOM lines on the study asset
  FOR it IN SELECT * FROM public.ers_rcm_study_items i WHERE i.study_id = p_study AND i.kind = 'part' AND i.bom_item_id IS NULL ORDER BY sort_order LOOP
    INSERT INTO public.asset_bom (asset_id, inventory_item_id, part_number, description, quantity, uom, is_critical, replacement_interval_days, company_id)
    VALUES (v_asset, it.inventory_item_id, it.tag, it.name, coalesce(it.qty, 1), coalesce(it.uom, 'EA'), it.critical, it.replacement_interval_days, s.company_id)
    RETURNING id INTO v_bom;
    UPDATE public.ers_rcm_study_items SET bom_item_id = v_bom WHERE id = it.id;
    UPDATE public.ers_rcm_failure_modes SET bom_item_id = v_bom WHERE study_item_id = it.id AND bom_item_id IS NULL;
    n_bom := n_bom + 1;
  END LOOP;
  RETURN jsonb_build_object('assets', n_assets, 'bom_lines', n_bom);
END;
$$;
GRANT EXECUTE ON FUNCTION public.rcm_promote_items_to_register(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
