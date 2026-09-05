// ─────────────────────────────────────────────────────────────────────────────
// ISO 14224 Annex A class-specific design & operating parameters.
//
// Table 5 of ISO 14224 lists the equipment data every record should carry
// (design capacity, rated power, operating mode, environment…) and each A.2.x
// class table names the parameters that matter for THAT class — a pump is
// described by flow, head, speed, power, NPSH; a motor by kW, voltage, speed,
// enclosure. These templates put those rows in front of the user the moment
// a class is chosen, each with a Design (nameplate/rated) value, a Normal
// operating value and an optional Max operating value.
//
// RCM lives on the gap between them: a pump run at 55 % of rated flow sits
// off its BEP and fails differently from one at 100 %; a motor at 105 % load
// is a thermal-ageing problem. Pure data, no I/O. Every ISO class MUST have
// at least one design+operating row (operatingContext.test.ts enforces it).
// ─────────────────────────────────────────────────────────────────────────────

export interface ParameterTemplate {
  key: string;
  label: string;
  unit: string;
  /** 'both' = design AND operating values expected; 'design' = nameplate only (e.g. design pressure, IP rating) */
  kind: 'both' | 'design';
  /** free text parameters (fluid, material) */
  text?: boolean;
}

const P = (key: string, label: string, unit: string, kind: 'both' | 'design' = 'both', text = false): ParameterTemplate =>
  ({ key, label, unit, kind, ...(text ? { text } : {}) });

// Shared blocks
const FLUID       = P('fluid', 'Fluid / medium handled', '', 'design', true);
const DESIGN_P    = P('design_pressure', 'Design pressure', 'barg', 'design');
const DESIGN_T    = P('design_temperature', 'Design temperature', '°C', 'design');
const OP_P        = P('operating_pressure', 'Operating pressure', 'barg');
const OP_T        = P('operating_temperature', 'Operating temperature', '°C');
const RATED_POWER = P('rated_power', 'Rated / absorbed power', 'kW');
const SPEED       = P('speed', 'Speed', 'rpm');
const MATERIAL    = P('material', 'Material of construction', '', 'design', true);

export const CLASS_PARAMETERS: Record<string, ParameterTemplate[]> = {
  PUMP: [
    P('flow', 'Flow rate', 'm³/h'), P('head', 'Differential head', 'm'), SPEED, RATED_POWER,
    P('suction_pressure', 'Suction pressure', 'barg'), P('discharge_pressure', 'Discharge pressure', 'barg'),
    P('npsh', 'NPSH required / available', 'm'), DESIGN_P, DESIGN_T, OP_T, FLUID, P('seal_type', 'Seal type / plan', '', 'design', true),
  ],
  COMPRESSOR: [
    P('flow', 'Flow / capacity', 'Nm³/h'), P('suction_pressure', 'Suction pressure', 'barg'), P('discharge_pressure', 'Discharge pressure', 'barg'),
    SPEED, RATED_POWER, P('stages', 'Number of stages', '', 'design'), P('gas', 'Gas handled / MW', '', 'design', true), DESIGN_T, OP_T,
  ],
  GAS_TURBINE: [
    P('power', 'ISO / site rated power', 'MW'), P('exhaust_temperature', 'Exhaust temperature', '°C'), SPEED,
    P('fuel', 'Fuel', '', 'design', true), P('heat_rate', 'Heat rate', 'kJ/kWh'), P('firing_hours', 'Equivalent operating hours', 'h'),
  ],
  STEAM_TURBINE: [
    P('power', 'Rated power', 'MW'), P('inlet_pressure', 'Steam inlet pressure', 'barg'), P('inlet_temperature', 'Steam inlet temperature', '°C'),
    P('exhaust_pressure', 'Exhaust pressure', 'bara'), SPEED,
  ],
  TURBOEXPANDER: [P('flow', 'Flow', 'Nm³/h'), P('inlet_pressure', 'Inlet pressure', 'barg'), P('outlet_pressure', 'Outlet pressure', 'barg'), SPEED, RATED_POWER],
  COMBUSTION_ENGINE: [P('power', 'Rated power', 'kW'), SPEED, P('fuel', 'Fuel', '', 'design', true), P('load', 'Load', '%')],
  ELECTRIC_MOTOR: [
    RATED_POWER, P('voltage', 'Rated voltage', 'V', 'design'), P('current', 'Current (FLA / running)', 'A'), SPEED,
    P('frequency', 'Frequency', 'Hz', 'design'), P('load', 'Load', '%'), P('ambient_temperature', 'Ambient temperature', '°C'),
    P('ip_rating', 'Enclosure / IP rating', '', 'design', true), P('insulation_class', 'Insulation class', '', 'design', true), P('ex_rating', 'Ex / hazardous-area rating', '', 'design', true),
  ],
  ELECTRIC_GENERATOR: [P('power', 'Rated power', 'MVA'), P('voltage', 'Rated voltage', 'kV', 'design'), P('current', 'Current', 'A'), SPEED, P('power_factor', 'Power factor', ''), P('load', 'Load', '%')],
  FAN_BLOWER: [P('flow', 'Flow', 'm³/h'), P('static_pressure', 'Static pressure', 'Pa'), SPEED, RATED_POWER, OP_T],
  GEARBOX: [P('power', 'Rated power', 'kW'), P('ratio', 'Gear ratio', '', 'design'), P('input_speed', 'Input speed', 'rpm'), P('output_speed', 'Output speed', 'rpm'), P('oil_temperature', 'Oil temperature', '°C')],
  AGITATOR_MIXER: [RATED_POWER, SPEED, P('volume', 'Vessel volume', 'm³', 'design'), P('viscosity', 'Fluid viscosity', 'cP'), FLUID],
  CONVEYOR: [P('capacity', 'Capacity', 't/h'), P('belt_speed', 'Belt / chain speed', 'm/s'), RATED_POWER, P('length', 'Length', 'm', 'design')],

  HEAT_EXCHANGER: [
    P('duty', 'Heat duty', 'kW'), P('shell_design_pressure', 'Shell-side design pressure', 'barg', 'design'), P('tube_design_pressure', 'Tube-side design pressure', 'barg', 'design'),
    P('shell_temperature', 'Shell-side temperature', '°C'), P('tube_temperature', 'Tube-side temperature', '°C'),
    P('shell_flow', 'Shell-side flow', 'm³/h'), P('tube_flow', 'Tube-side flow', 'm³/h'),
    P('shell_fluid', 'Shell-side fluid', '', 'design', true), P('tube_fluid', 'Tube-side fluid', '', 'design', true), MATERIAL,
  ],
  HEATER_BOILER: [P('duty', 'Heat duty', 'MW'), P('steam_rate', 'Steam / process rate', 't/h'), P('outlet_temperature', 'Outlet temperature', '°C'), DESIGN_P, OP_P, P('fuel', 'Fuel', '', 'design', true)],
  PRESSURE_VESSEL: [DESIGN_P, DESIGN_T, OP_P, OP_T, P('volume', 'Volume', 'm³', 'design'), P('mawp', 'MAWP', 'barg', 'design'), FLUID, MATERIAL, P('corrosion_allowance', 'Corrosion allowance', 'mm', 'design')],
  STORAGE_TANK: [P('capacity', 'Capacity', 'm³', 'design'), P('level', 'Operating level', '%'), DESIGN_P, OP_T, P('product', 'Product stored', '', 'design', true), MATERIAL],
  PIPING: [P('size', 'Nominal size', 'DN', 'design'), P('pressure_class', 'Pressure class / rating', '', 'design', true), DESIGN_P, DESIGN_T, OP_P, OP_T, P('velocity', 'Flow velocity', 'm/s'), FLUID, MATERIAL],
  VALVE: [P('size', 'Nominal size', 'DN', 'design'), P('pressure_class', 'Pressure class', '', 'design', true), P('differential_pressure', 'Differential pressure', 'bar'), OP_T, P('cycles', 'Operating cycles', '/year'), FLUID, P('actuation', 'Actuation', '', 'design', true)],
  FILTER_STRAINER: [P('flow', 'Flow', 'm³/h'), P('differential_pressure', 'Differential pressure (clean / dirty)', 'bar'), P('micron', 'Filtration rating', 'µm', 'design'), DESIGN_P, FLUID],

  TRANSFORMER: [P('rating', 'Rated power', 'MVA'), P('hv', 'HV voltage', 'kV', 'design'), P('lv', 'LV voltage', 'kV', 'design'), P('load', 'Load', '%'), P('impedance', 'Impedance', '%', 'design'), P('oil_temperature', 'Top-oil temperature', '°C'), P('cooling', 'Cooling class (ONAN/ONAF…)', '', 'design', true)],
  SWITCHGEAR: [P('voltage', 'Rated voltage', 'kV', 'design'), P('current', 'Rated / operating current', 'A'), P('fault_level', 'Short-circuit rating', 'kA', 'design'), P('ambient_temperature', 'Ambient temperature', '°C')],
  UPS: [P('rating', 'Rated power', 'kVA'), P('load', 'Load', '%'), P('autonomy', 'Battery autonomy', 'min', 'design'), P('dc_voltage', 'DC voltage', 'V', 'design')],
  FREQUENCY_CONVERTER: [RATED_POWER, P('voltage', 'Rated voltage', 'V', 'design'), P('current', 'Current', 'A'), P('load', 'Load', '%'), P('ambient_temperature', 'Ambient / panel temperature', '°C')],
  POWER_CABLE: [P('voltage', 'Rated voltage', 'kV', 'design'), P('current', 'Current', 'A'), P('length', 'Length', 'm', 'design'), P('conductor', 'Conductor size / material', '', 'design', true)],

  CONTROL_LOGIC_UNIT: [P('io_count', 'I/O count', '', 'design'), P('cpu_load', 'CPU load', '%'), P('sil', 'SIL level', '', 'design', true), P('ambient_temperature', 'Ambient temperature', '°C')],
  PROCESS_SENSOR: [P('range', 'Measuring range', '', 'design', true), P('operating_value', 'Normal process value', ''), P('accuracy', 'Accuracy', '%', 'design'), DESIGN_P, DESIGN_T, P('sil', 'SIL level', '', 'design', true)],
  ANALYSER: [P('range', 'Measuring range', '', 'design', true), P('sample_temperature', 'Sample temperature', '°C'), P('sample_pressure', 'Sample pressure', 'barg'), P('accuracy', 'Accuracy', '%', 'design')],
  CONTROL_VALVE: [P('size', 'Nominal size', 'DN', 'design'), P('cv', 'Cv / Kv', ''), P('differential_pressure', 'Differential pressure', 'bar'), P('travel', 'Valve opening', '%'), OP_T, FLUID, P('actuation', 'Actuator type', '', 'design', true)],
  FIRE_GAS_DETECTOR: [P('range', 'Detection range / alarm setpoint', '', 'design', true), P('coverage', 'Coverage', 'm', 'design'), P('sil', 'SIL level', '', 'design', true), P('ambient_temperature', 'Ambient temperature', '°C')],
  SAFETY_VALVE: [P('set_pressure', 'Set pressure', 'barg', 'design'), OP_P, P('capacity', 'Relieving capacity', 'kg/h', 'design'), P('size', 'Inlet / outlet size', '', 'design', true), FLUID],
  ESD_VALVE: [P('size', 'Nominal size', 'DN', 'design'), P('pressure_class', 'Pressure class', '', 'design', true), P('closing_time', 'Closing time', 's'), P('leakage_class', 'Leakage class', '', 'design', true), P('sil', 'SIL level', '', 'design', true), FLUID],
  DELUGE_NOZZLE: [P('flow', 'Design flow', 'l/min', 'design'), P('pressure', 'Supply pressure', 'barg'), P('coverage', 'Coverage area', 'm²', 'design')],

  STRUCTURE: [P('load', 'Design / actual load', 't'), P('height', 'Height', 'm', 'design'), MATERIAL, P('coating', 'Coating / corrosion protection', '', 'design', true)],
  CIVIL: [P('area', 'Area', 'm²', 'design'), P('load', 'Design / actual load', 'kN/m²')],
  CRANE: [P('swl', 'Safe working load', 't', 'design'), P('lift', 'Typical lift', 't'), P('radius', 'Radius / span', 'm', 'design'), P('lifts', 'Lifts per year', '/year')],
  WINCH_HOIST: [P('swl', 'Safe working load', 't', 'design'), P('line_speed', 'Line speed', 'm/min'), RATED_POWER],
  VEHICLE: [P('payload', 'Payload / capacity', 't', 'design'), P('hours', 'Operating hours', 'h/year'), P('distance', 'Distance', 'km/year')],
  HVAC: [P('cooling_capacity', 'Cooling / heating capacity', 'kW'), P('airflow', 'Airflow', 'm³/h'), RATED_POWER, P('supply_temperature', 'Supply air temperature', '°C')],
  COOLING_TOWER: [P('duty', 'Heat rejection', 'kW'), P('water_flow', 'Water flow', 'm³/h'), P('approach', 'Approach temperature', '°C'), RATED_POWER],
};

/** Category fallback when the class has no table (or is an "Other" class). */
export const CATEGORY_PARAMETERS: Record<string, ParameterTemplate[]> = {
  ROTATING: [RATED_POWER, SPEED, P('capacity', 'Capacity / throughput', ''), OP_T, DESIGN_P, FLUID],
  STATIC: [DESIGN_P, DESIGN_T, OP_P, OP_T, FLUID, MATERIAL],
  ELECTRICAL: [P('rating', 'Rated power', 'kVA'), P('voltage', 'Rated voltage', 'V', 'design'), P('current', 'Current', 'A'), P('load', 'Load', '%')],
  INSTRUMENTATION: [P('range', 'Measuring range / setpoint', '', 'design', true), P('operating_value', 'Normal process value', ''), P('sil', 'SIL level', '', 'design', true)],
  STRUCTURAL: [P('load', 'Design load', 't', 'design'), MATERIAL],
  MOBILE: [P('swl', 'Safe working load / capacity', 't', 'design'), P('hours', 'Operating hours', 'h/year')],
  UTILITY: [RATED_POWER, P('capacity', 'Capacity', '')],
};

export const GENERIC_PARAMETERS: ParameterTemplate[] = [RATED_POWER, P('capacity', 'Design capacity', ''), DESIGN_P, DESIGN_T, OP_T];

/** The template rows for an asset, most specific first: class → category → generic. */
export function parameterTemplateFor(classCode?: string | null, categoryCode?: string | null): ParameterTemplate[] {
  const cls = (classCode || '').toUpperCase();
  if (cls && CLASS_PARAMETERS[cls]) return CLASS_PARAMETERS[cls];
  const cat = (categoryCode || '').toUpperCase();
  if (cat && CATEGORY_PARAMETERS[cat]) return CATEGORY_PARAMETERS[cat];
  return GENERIC_PARAMETERS;
}
