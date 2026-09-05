// ─────────────────────────────────────────────────────────────────────────────
// ISO 14224:2016 equipment taxonomy — the SINGLE SOURCE for the register's
// Category → Class → Type cascade.
//
// Three sources used to disagree (0027 seed, the constants.ts mock, the live
// reference_codes rows), the live rows pointed Type at Category instead of
// Class, and the "class" rows were really ISO *types* (Centrifugal Pump) while
// the "type" rows were ISO *classes* (Pump). This file is what migration 0317
// seeds into reference_codes (global rows, tenant-shadowable per 0267), what
// the mock dictionary in constants.ts is generated from, and what Predict's
// class resolution reads — so they cannot drift again.
//
// Tiers (ISO 14224 Annex A):
//   ASSET_CATEGORY  — Table A.1 equipment category (Rotating, Mechanical/Static,
//                     Electrical, Safety & control…). Codes kept compatible
//                     with the live register (ROTATING, STATIC, ELECTRICAL,
//                     INSTRUMENTATION) because assets already carry them.
//   ASSET_CLASS     — Table A.4 equipment class (Pump, Compressor, Gas turbine,
//                     Heat exchanger, Transformer, Fire & gas detector…).
//                     Carries `failureScope`: the vocabulary the FAILURE_MODE
//                     and SUBUNIT reference rows are scoped by (0285/0288), so
//                     the work-order pickers can filter by class again.
//   ASSET_TYPE      — the per-class equipment type tables (A.2.x): Pump →
//                     Centrifugal / Reciprocating / Rotary, and so on.
//
// Every category and every class ends in an "Other" child so a register that
// does not find its equipment is never forced into a wrong code; the Admin
// dictionary manager lets a tenant add a proper code beside these.
// Tests: iso14224Taxonomy.test.ts (integrity + migration parity).
// ─────────────────────────────────────────────────────────────────────────────

export type FailureScope =
  | 'ROTATING' | 'STATIC_PRESSURE' | 'HEAT_TRANSFER' | 'PIPING'
  | 'STRUCTURAL' | 'ELECTRICAL' | 'INSTRUMENT' | 'SAFETY_SYSTEM';

export type PredictClass = 'rotating' | 'static' | 'electrical' | 'instrument' | 'other';

export interface TaxonomyCategory {
  code: string;
  label: string;
  /** ISO 14224 Table A.1 wording */
  iso: string;
  predict: PredictClass;
}

export interface TaxonomyClass {
  code: string;
  label: string;
  category: string;
  /** Failure-mode / subunit scope group (0285/0288 category_ref vocabulary). null = general codes only */
  failureScope: FailureScope | null;
  /** ISO 14224 Annex A clause, where one exists */
  isoRef?: string;
}

export interface TaxonomyType {
  code: string;
  label: string;
  cls: string;
}

export const OTHER_SUFFIX = '_OTHER';

export const CATEGORIES: TaxonomyCategory[] = [
  { code: 'ROTATING',        label: 'Rotating equipment',                 iso: 'Rotating equipment',            predict: 'rotating' },
  { code: 'STATIC',          label: 'Mechanical (static) equipment',      iso: 'Mechanical equipment',          predict: 'static' },
  { code: 'ELECTRICAL',      label: 'Electrical equipment',               iso: 'Electrical equipment',          predict: 'electrical' },
  { code: 'INSTRUMENTATION', label: 'Safety & control (instrumentation)', iso: 'Safety and control equipment',  predict: 'instrument' },
  { code: 'STRUCTURAL',      label: 'Structural & civil',                 iso: 'Structures (Annex A.2.7)',      predict: 'other' },
  { code: 'MOBILE',          label: 'Mobile & lifting equipment',         iso: 'Lifting equipment / vehicles',  predict: 'other' },
  { code: 'UTILITY',         label: 'Utilities & HVAC',                   iso: 'Utilities',                     predict: 'other' },
  { code: 'OTHER',           label: 'Other / unclassified',               iso: 'Not in ISO 14224 Table A.1',    predict: 'other' },
];

// Classes — one entry per ISO 14224 Table A.4 equipment class that a plant
// register actually needs, plus the common non-ISO ones (gearbox, fan, HVAC).
const CLASS_ROWS: Array<[string, string, string, FailureScope | null, string?]> = [
  // ── Rotating (A.2.4) ──
  ['PUMP',               'Pump',                          'ROTATING', 'ROTATING',      'A.2.4.6'],
  ['COMPRESSOR',         'Compressor',                    'ROTATING', 'ROTATING',      'A.2.4.2'],
  ['GAS_TURBINE',        'Gas turbine',                   'ROTATING', 'ROTATING',      'A.2.4.5'],
  ['STEAM_TURBINE',      'Steam turbine',                 'ROTATING', 'ROTATING',      'A.2.4.7'],
  ['TURBOEXPANDER',      'Turboexpander',                 'ROTATING', 'ROTATING',      'A.2.4.8'],
  ['COMBUSTION_ENGINE',  'Combustion engine (diesel/gas)', 'ROTATING', 'ROTATING',     'A.2.4.1'],
  ['ELECTRIC_MOTOR',     'Electric motor',                'ROTATING', 'ELECTRICAL',    'A.2.4.4'],
  ['ELECTRIC_GENERATOR', 'Electric generator',            'ROTATING', 'ELECTRICAL',    'A.2.4.3'],
  ['FAN_BLOWER',         'Fan / blower',                  'ROTATING', 'ROTATING'],
  ['GEARBOX',            'Gearbox / power transmission',  'ROTATING', 'ROTATING'],
  ['AGITATOR_MIXER',     'Agitator / mixer',              'ROTATING', 'ROTATING'],
  ['CONVEYOR',           'Conveyor',                      'ROTATING', 'ROTATING'],
  // ── Mechanical / static (A.2.5) ──
  ['HEAT_EXCHANGER',     'Heat exchanger',                'STATIC',   'HEAT_TRANSFER',   'A.2.5.2'],
  ['HEATER_BOILER',      'Heater / boiler',               'STATIC',   'HEAT_TRANSFER',   'A.2.5.3'],
  ['PRESSURE_VESSEL',    'Pressure vessel / column',      'STATIC',   'STATIC_PRESSURE', 'A.2.5.6'],
  ['STORAGE_TANK',       'Storage tank',                  'STATIC',   'STATIC_PRESSURE', 'A.2.5.7'],
  ['PIPING',             'Piping / pipeline',             'STATIC',   'PIPING',          'A.2.5.5'],
  ['VALVE',              'Valve (manual / isolation)',    'STATIC',   'STATIC_PRESSURE', 'A.2.5.8'],
  ['FILTER_STRAINER',    'Filter / strainer',             'STATIC',   'STATIC_PRESSURE', 'A.2.5.1'],
  // ── Electrical (A.2.3) ──
  ['TRANSFORMER',        'Transformer',                   'ELECTRICAL', 'ELECTRICAL',  'A.2.3.4'],
  ['SWITCHGEAR',         'Switchgear / MCC',              'ELECTRICAL', 'ELECTRICAL',  'A.2.3.3'],
  ['UPS',                'UPS / DC power system',         'ELECTRICAL', 'ELECTRICAL',  'A.2.3.1'],
  ['FREQUENCY_CONVERTER','Frequency converter / VSD',     'ELECTRICAL', 'ELECTRICAL',  'A.2.3.2'],
  ['POWER_CABLE',        'Power cable',                   'ELECTRICAL', 'ELECTRICAL'],
  // ── Safety & control (A.2.6) ──
  ['CONTROL_LOGIC_UNIT', 'Control logic unit (PLC/DCS/SIS)', 'INSTRUMENTATION', 'INSTRUMENT',    'A.2.6.1'],
  ['PROCESS_SENSOR',     'Process sensor / transmitter',  'INSTRUMENTATION', 'INSTRUMENT',       'A.2.6.3'],
  ['ANALYSER',           'Analyser',                      'INSTRUMENTATION', 'INSTRUMENT'],
  ['CONTROL_VALVE',      'Control valve / choke',         'INSTRUMENTATION', 'INSTRUMENT',       'A.2.6.5'],
  ['FIRE_GAS_DETECTOR',  'Fire & gas detector',           'INSTRUMENTATION', 'SAFETY_SYSTEM',    'A.2.6.2'],
  ['SAFETY_VALVE',       'Pressure safety / relief valve', 'INSTRUMENTATION', 'SAFETY_SYSTEM',   'A.2.6.5'],
  ['ESD_VALVE',          'Shutdown valve (ESDV / BDV)',   'INSTRUMENTATION', 'SAFETY_SYSTEM',    'A.2.6.5'],
  ['DELUGE_NOZZLE',      'Fire-fighting nozzle / deluge', 'INSTRUMENTATION', 'SAFETY_SYSTEM',    'A.2.6.4'],
  // ── Structural ──
  ['STRUCTURE',          'Steel structure / support',     'STRUCTURAL', 'STRUCTURAL'],
  ['CIVIL',              'Civil / building / foundation', 'STRUCTURAL', 'STRUCTURAL'],
  // ── Mobile & lifting ──
  ['CRANE',              'Crane',                         'MOBILE', null, 'A.2.5.4'],
  ['WINCH_HOIST',        'Winch / hoist',                 'MOBILE', null, 'A.2.5.9'],
  ['VEHICLE',            'Vehicle / mobile plant',        'MOBILE', null],
  // ── Utilities ──
  ['HVAC',               'HVAC',                          'UTILITY', null],
  ['COOLING_TOWER',      'Cooling tower',                 'UTILITY', 'HEAT_TRANSFER'],
];

const TYPE_ROWS: Record<string, Array<[string, string]>> = {
  PUMP:               [['CENTRIFUGAL', 'Centrifugal'], ['RECIPROCATING', 'Reciprocating'], ['ROTARY', 'Rotary (screw / gear / lobe)']],
  COMPRESSOR:         [['CENTRIFUGAL', 'Centrifugal'], ['RECIPROCATING', 'Reciprocating'], ['SCREW', 'Screw'], ['AXIAL', 'Axial']],
  GAS_TURBINE:        [['HEAVY_DUTY', 'Industrial heavy-duty'], ['AERODERIVATIVE', 'Aero-derivative']],
  STEAM_TURBINE:      [['BACKPRESSURE', 'Back-pressure'], ['CONDENSING', 'Condensing']],
  TURBOEXPANDER:      [['CENTRIFUGAL', 'Centrifugal (radial)'], ['AXIAL', 'Axial']],
  COMBUSTION_ENGINE:  [['DIESEL', 'Diesel engine'], ['GAS', 'Gas engine']],
  ELECTRIC_MOTOR:     [['AC_INDUCTION', 'AC induction'], ['AC_SYNCHRONOUS', 'AC synchronous'], ['DC', 'DC']],
  ELECTRIC_GENERATOR: [['GAS_TURBINE_DRIVEN', 'Gas-turbine driven'], ['STEAM_TURBINE_DRIVEN', 'Steam-turbine driven'], ['ENGINE_DRIVEN', 'Engine driven (diesel / gas)']],
  FAN_BLOWER:         [['CENTRIFUGAL', 'Centrifugal'], ['AXIAL', 'Axial'], ['POSITIVE_DISPLACEMENT', 'Positive displacement']],
  GEARBOX:            [['PARALLEL_SHAFT', 'Parallel shaft'], ['EPICYCLIC', 'Epicyclic / planetary'], ['WORM', 'Worm']],
  AGITATOR_MIXER:     [['TOP_ENTRY', 'Top entry'], ['SIDE_ENTRY', 'Side entry'], ['STATIC', 'Static mixer']],
  CONVEYOR:           [['BELT', 'Belt'], ['SCREW', 'Screw'], ['BUCKET', 'Bucket elevator'], ['CHAIN', 'Chain']],
  HEAT_EXCHANGER:     [['SHELL_TUBE', 'Shell & tube'], ['PLATE', 'Plate'], ['AIR_COOLED', 'Air-cooled (fin-fan)'], ['DOUBLE_PIPE', 'Double pipe'], ['PRINTED_CIRCUIT', 'Printed circuit'], ['SPIRAL', 'Spiral']],
  HEATER_BOILER:      [['FIRED_HEATER', 'Fired heater'], ['WATER_TUBE', 'Water-tube boiler'], ['FIRE_TUBE', 'Fire-tube boiler'], ['HRSG', 'Heat-recovery steam generator'], ['ELECTRIC', 'Electric heater']],
  PRESSURE_VESSEL:    [['SEPARATOR', 'Separator'], ['SCRUBBER', 'Scrubber / knock-out drum'], ['COLUMN', 'Column / tower'], ['REACTOR', 'Reactor'], ['DRUM', 'Drum / accumulator'], ['CONTACTOR', 'Contactor'], ['COALESCER', 'Coalescer']],
  STORAGE_TANK:       [['FIXED_ROOF', 'Fixed roof'], ['FLOATING_ROOF', 'Floating roof'], ['SPHERE', 'Sphere'], ['BULLET', 'Horizontal bullet']],
  PIPING:             [['PROCESS', 'Process piping'], ['UTILITY', 'Utility piping'], ['PIPELINE', 'Pipeline'], ['FLEXIBLE', 'Flexible hose / riser']],
  VALVE:              [['BALL', 'Ball'], ['GATE', 'Gate'], ['GLOBE', 'Globe'], ['BUTTERFLY', 'Butterfly'], ['CHECK', 'Check / non-return'], ['PLUG', 'Plug'], ['NEEDLE', 'Needle'], ['DIAPHRAGM', 'Diaphragm']],
  FILTER_STRAINER:    [['CARTRIDGE', 'Cartridge filter'], ['BASKET', 'Basket strainer'], ['BAG', 'Bag filter'], ['COALESCING', 'Coalescing filter']],
  TRANSFORMER:        [['POWER', 'Power transformer'], ['DISTRIBUTION', 'Distribution transformer'], ['INSTRUMENT', 'Instrument transformer (CT/VT)']],
  SWITCHGEAR:         [['LV', 'Low voltage'], ['MV', 'Medium voltage'], ['HV', 'High voltage'], ['MCC', 'Motor control centre']],
  UPS:                [['STATIC', 'Static UPS'], ['ROTARY', 'Rotary UPS'], ['DC_SYSTEM', 'DC system / battery charger']],
  FREQUENCY_CONVERTER:[['LV_VSD', 'LV variable-speed drive'], ['MV_VSD', 'MV variable-speed drive'], ['SOFT_STARTER', 'Soft starter']],
  POWER_CABLE:        [['HV', 'High voltage'], ['MV', 'Medium voltage'], ['LV', 'Low voltage']],
  CONTROL_LOGIC_UNIT: [['PLC', 'PLC'], ['DCS', 'DCS'], ['SIS', 'Safety logic solver (SIS)'], ['RTU', 'RTU']],
  PROCESS_SENSOR:     [['PRESSURE', 'Pressure'], ['TEMPERATURE', 'Temperature'], ['FLOW', 'Flow'], ['LEVEL', 'Level'], ['VIBRATION', 'Vibration']],
  ANALYSER:           [['GAS_CHROMATOGRAPH', 'Gas chromatograph'], ['MOISTURE', 'Moisture / dew point'], ['OXYGEN', 'Oxygen'], ['PH_CONDUCTIVITY', 'pH / conductivity']],
  CONTROL_VALVE:      [['GLOBE', 'Globe control valve'], ['BUTTERFLY', 'Butterfly control valve'], ['BALL', 'Ball control valve'], ['CHOKE', 'Choke valve']],
  FIRE_GAS_DETECTOR:  [['FLAMMABLE_GAS', 'Flammable gas'], ['TOXIC_GAS', 'Toxic gas'], ['FLAME', 'Flame'], ['SMOKE', 'Smoke'], ['HEAT', 'Heat']],
  SAFETY_VALVE:       [['SPRING_PSV', 'Spring-loaded PSV'], ['PILOT_PSV', 'Pilot-operated PSV'], ['RUPTURE_DISC', 'Rupture disc'], ['VACUUM_RELIEF', 'Vacuum / pressure-vacuum relief']],
  ESD_VALVE:          [['ESDV', 'Emergency shutdown valve'], ['BDV', 'Blowdown valve'], ['SSIV', 'Subsea isolation valve']],
  DELUGE_NOZZLE:      [['DELUGE', 'Deluge'], ['SPRINKLER', 'Sprinkler'], ['WATER_MIST', 'Water mist'], ['FOAM', 'Foam']],
  STRUCTURE:          [['STEEL', 'Steel structure'], ['PIPE_RACK', 'Pipe rack'], ['PLATFORM', 'Platform / deck']],
  CIVIL:              [['BUILDING', 'Building'], ['FOUNDATION', 'Foundation'], ['ROAD', 'Road / paving']],
  CRANE:              [['OVERHEAD', 'Overhead / gantry'], ['PEDESTAL', 'Pedestal'], ['MOBILE', 'Mobile crane']],
  WINCH_HOIST:        [['HOIST', 'Electric hoist'], ['WINCH', 'Winch']],
  VEHICLE:            [['FORKLIFT', 'Forklift'], ['TRUCK', 'Truck'], ['LIGHT', 'Light vehicle']],
  HVAC:               [['AHU', 'Air-handling unit'], ['CHILLER', 'Chiller'], ['PACKAGED', 'Packaged / split unit']],
  COOLING_TOWER:      [['INDUCED_DRAFT', 'Induced draft'], ['FORCED_DRAFT', 'Forced draft']],
};

const isoClasses: TaxonomyClass[] = CLASS_ROWS.map(([code, label, category, failureScope, isoRef]) => ({
  code, label, category, failureScope, ...(isoRef ? { isoRef } : {}),
}));

/** One "Other" class per category (OTHER category gets a single generic one). */
const otherClasses: TaxonomyClass[] = CATEGORIES.map(c => ({
  code: c.code === 'OTHER' ? 'OTHER_CLASS' : `${c.code}${OTHER_SUFFIX}`,
  label: c.code === 'OTHER' ? 'Unclassified equipment' : `Other ${c.label.toLowerCase()}`,
  category: c.code,
  failureScope: null,
}));

export const CLASSES: TaxonomyClass[] = [...isoClasses, ...otherClasses];

export const TYPES: TaxonomyType[] = isoClasses.flatMap(cls => [
  ...(TYPE_ROWS[cls.code] || []).map(([suffix, label]) => ({ code: `${cls.code}_${suffix}`, label, cls: cls.code })),
  { code: `${cls.code}${OTHER_SUFFIX}`, label: `Other ${cls.label.toLowerCase()}`, cls: cls.code },
]);

// ── Lookups ──────────────────────────────────────────────────────────────────
const categoryByCode = new Map(CATEGORIES.map(c => [c.code, c]));
const classByCode = new Map(CLASSES.map(c => [c.code, c]));
const typeByCode = new Map(TYPES.map(t => [t.code, t]));

export function getCategory(code?: string | null): TaxonomyCategory | undefined { return code ? categoryByCode.get(code.toUpperCase()) : undefined; }
export function getClass(code?: string | null): TaxonomyClass | undefined { return code ? classByCode.get(code.toUpperCase()) : undefined; }
export function getType(code?: string | null): TaxonomyType | undefined { return code ? typeByCode.get(code.toUpperCase()) : undefined; }
export function isOtherCode(code?: string | null): boolean { return !!code && (code.endsWith(OTHER_SUFFIX) || code === 'OTHER_CLASS' || code === 'OTHER'); }

export function classesOf(category: string): TaxonomyClass[] { return CLASSES.filter(c => c.category === category); }
export function typesOf(cls: string): TaxonomyType[] { return TYPES.filter(t => t.cls === cls); }

/** Legacy codes still found on assets/rows → the ISO class they mean. */
export const LEGACY_CLASS_MAP: Record<string, { category: string; cls: string; type?: string }> = {
  PUMP:                     { category: 'ROTATING', cls: 'PUMP' },
  MOTOR:                    { category: 'ROTATING', cls: 'ELECTRIC_MOTOR' },
  COMPRESSOR:               { category: 'ROTATING', cls: 'COMPRESSOR' },
  FAN:                      { category: 'ROTATING', cls: 'FAN_BLOWER' },
  CONVEYOR:                 { category: 'ROTATING', cls: 'CONVEYOR' },
  TURBINE:                  { category: 'ROTATING', cls: 'GAS_TURBINE' },
  VALVE:                    { category: 'STATIC',   cls: 'VALVE' },
  TANK:                     { category: 'STATIC',   cls: 'STORAGE_TANK' },
  VESSEL:                   { category: 'STATIC',   cls: 'PRESSURE_VESSEL' },
  EXCHANGER:                { category: 'STATIC',   cls: 'HEAT_EXCHANGER' },
  CENTRIFUGAL_PUMP:         { category: 'ROTATING', cls: 'PUMP',            type: 'PUMP_CENTRIFUGAL' },
  RECIPROCATING_PUMP:       { category: 'ROTATING', cls: 'PUMP',            type: 'PUMP_RECIPROCATING' },
  SCREW_COMPRESSOR:         { category: 'ROTATING', cls: 'COMPRESSOR',      type: 'COMPRESSOR_SCREW' },
  RECIPROCATING_COMPRESSOR: { category: 'ROTATING', cls: 'COMPRESSOR',      type: 'COMPRESSOR_RECIPROCATING' },
  CENTRIFUGAL_COMPRESSOR:   { category: 'ROTATING', cls: 'COMPRESSOR',      type: 'COMPRESSOR_CENTRIFUGAL' },
  PRESSURE_VESSEL:          { category: 'STATIC',   cls: 'PRESSURE_VESSEL' },
  STORAGE_TANK:             { category: 'STATIC',   cls: 'STORAGE_TANK' },
  HEAT_EXCHANGER:           { category: 'STATIC',   cls: 'HEAT_EXCHANGER' },
  GATE_VALVE:               { category: 'STATIC',   cls: 'VALVE',           type: 'VALVE_GATE' },
  BALL_VALVE:               { category: 'STATIC',   cls: 'VALVE',           type: 'VALVE_BALL' },
  ELECTRIC_MOTOR:           { category: 'ROTATING', cls: 'ELECTRIC_MOTOR' },
  GENERATOR:                { category: 'ROTATING', cls: 'ELECTRIC_GENERATOR' },
  TRANSFORMER:              { category: 'ELECTRICAL', cls: 'TRANSFORMER' },
  SWITCHGEAR:               { category: 'ELECTRICAL', cls: 'SWITCHGEAR' },
  VSD:                      { category: 'ELECTRICAL', cls: 'FREQUENCY_CONVERTER' },
  CONTROL_VALVE:            { category: 'INSTRUMENTATION', cls: 'CONTROL_VALVE' },
  PSV:                      { category: 'INSTRUMENTATION', cls: 'SAFETY_VALVE' },
  ESD:                      { category: 'INSTRUMENTATION', cls: 'ESD_VALVE' },
  FIRE_GAS:                 { category: 'INSTRUMENTATION', cls: 'FIRE_GAS_DETECTOR' },
  GAS_DETECTOR:             { category: 'INSTRUMENTATION', cls: 'FIRE_GAS_DETECTOR', type: 'FIRE_GAS_DETECTOR_FLAMMABLE_GAS' },
  FIRE_DETECTOR:            { category: 'INSTRUMENTATION', cls: 'FIRE_GAS_DETECTOR', type: 'FIRE_GAS_DETECTOR_FLAME' },
};

/** Category-level fallback for the failure-mode / subunit scope. */
const CATEGORY_SCOPE: Record<string, FailureScope> = {
  ROTATING: 'ROTATING', STATIC: 'STATIC_PRESSURE', ELECTRICAL: 'ELECTRICAL', INSTRUMENTATION: 'INSTRUMENT', STRUCTURAL: 'STRUCTURAL',
};

export interface ClassifiedLike {
  assetCategory?: string | null; assetClass?: string | null; assetType?: string | null;
  asset_category?: string | null; asset_class?: string | null; asset_type_code?: string | null;
}

/**
 * The scope group a work order's failure-mode and subunit pickers filter by.
 * Resolves the ISO class first, then legacy codes, then the category; returns
 * '' (no filter, general codes only) when nothing is known.
 */
export function failureScopeFor(a: ClassifiedLike | null | undefined): string {
  if (!a) return '';
  const clsCode = (a.assetClass || a.asset_class || '').toUpperCase();
  const typeCode = (a.assetType || a.asset_type_code || '').toUpperCase();
  const catCode = (a.assetCategory || a.asset_category || '').toUpperCase();
  const cls = getClass(clsCode) || getClass(LEGACY_CLASS_MAP[clsCode]?.cls) || getClass(LEGACY_CLASS_MAP[typeCode]?.cls) || getClass(getType(typeCode)?.cls);
  if (cls?.failureScope) return cls.failureScope;
  const cat = cls?.category || catCode;
  return CATEGORY_SCOPE[cat] || '';
}

/** Predict's coarse class for an asset, from the declared taxonomy. */
export function predictClassFor(a: ClassifiedLike | null | undefined): { cls: PredictClass; note: string } | null {
  if (!a) return null;
  const clsCode = (a.assetClass || a.asset_class || '').toUpperCase();
  const typeCode = (a.assetType || a.asset_type_code || '').toUpperCase();
  const catCode = (a.assetCategory || a.asset_category || '').toUpperCase();
  const cls = getClass(clsCode) || getClass(LEGACY_CLASS_MAP[clsCode]?.cls) || getClass(LEGACY_CLASS_MAP[typeCode]?.cls) || getClass(getType(typeCode)?.cls);
  if (cls) {
    // Motors and generators are ISO "rotating" but Predict scores their windings like electrical gear.
    if (cls.failureScope === 'ELECTRICAL' && cls.category === 'ROTATING') return { cls: 'electrical', note: `asset_class=${cls.code}` };
    const cat = getCategory(cls.category);
    if (cat && cat.predict !== 'other') return { cls: cat.predict, note: `asset_class=${cls.code}` };
    if (cls.failureScope) return { cls: scopeToPredict(cls.failureScope), note: `asset_class=${cls.code}` };
    return null;
  }
  const cat = getCategory(catCode);
  if (cat && cat.predict !== 'other') return { cls: cat.predict, note: `asset_category=${cat.code}` };
  return null;
}

function scopeToPredict(s: FailureScope): PredictClass {
  switch (s) {
    case 'ROTATING': return 'rotating';
    case 'STATIC_PRESSURE': case 'HEAT_TRANSFER': case 'PIPING': return 'static';
    case 'ELECTRICAL': return 'electrical';
    case 'INSTRUMENT': case 'SAFETY_SYSTEM': return 'instrument';
    default: return 'other';
  }
}

// ── Dictionary rows (the shape DatabaseService.getDictionaries returns) ──────
export interface TaxonomyDictionaryRow {
  id: string;
  type: 'ASSET_CATEGORY' | 'ASSET_CLASS' | 'ASSET_TYPE';
  code: string;
  description: string;
  active: true;
  categoryRef?: string;
  failureScope?: string;
}

/** The whole taxonomy as dictionary rows — the mock in constants.ts is built from this. */
export function taxonomyDictionaryRows(): TaxonomyDictionaryRow[] {
  return [
    ...CATEGORIES.map((c, i) => ({ id: `iso-cat-${i + 1}`, type: 'ASSET_CATEGORY' as const, code: c.code, description: c.label, active: true as const })),
    ...CLASSES.map((c, i) => ({ id: `iso-cls-${i + 1}`, type: 'ASSET_CLASS' as const, code: c.code, description: c.label, active: true as const, categoryRef: c.category, ...(c.failureScope ? { failureScope: c.failureScope } : {}) })),
    ...TYPES.map((t, i) => ({ id: `iso-typ-${i + 1}`, type: 'ASSET_TYPE' as const, code: t.code, description: t.label, active: true as const, categoryRef: t.cls })),
  ];
}
