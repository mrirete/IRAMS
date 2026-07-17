/**
 * Equipment-class resolution for the Predict engine (Phase 2 — class-aware
 * health). A static heat exchanger must not be judged like a pump.
 *
 * Resolution order:
 *  1. DECLARED — the register's classification dictionary codes
 *     (assets.asset_class / asset_category / asset_type_code), when set.
 *  2. INFERRED — keyword match on name+tag (most registers ship with these
 *     columns empty; "Discharge Cooler E-605" is still obviously static).
 *  3. DEFAULT — 'other' (generic scoring), shown as such — never a silent guess.
 *
 * The basis is surfaced in the UI so users know whether the class was
 * declared or inferred, and can correct it in the register.
 */

export type PredictEquipmentClass = 'rotating' | 'static' | 'electrical' | 'instrument' | 'other';

export interface ClassResolution {
    cls: PredictEquipmentClass;
    basis: 'declared' | 'inferred' | 'default';
    /** what the resolution was based on, e.g. 'asset_class=ROTATING' or 'name contains "cooler"' */
    note: string;
}

/** Dictionary codes (eam ASSET_CLASS / ASSET_CATEGORY / ASSET_TYPE) → predict class. */
const DECLARED_MAP: Record<string, PredictEquipmentClass> = {
    // categories
    ROTATING: 'rotating', STATIC: 'static', ELECTRICAL: 'electrical', INSTRUMENT: 'instrument',
    // classes (constants.ts ASSET_CLASS dictionary)
    STATIC_PRESSURE: 'static', HEAT_TRANSFER: 'static', PROCESS_PIPING: 'static',
    MOTORS_DRIVES: 'rotating', GENERATORS: 'rotating', CENTRIFUGAL_PUMP: 'rotating',
    POWER_DISTRIBUTION: 'electrical',
    PROCESS_CONTROL: 'instrument', ANALYZERS: 'instrument', FIRE_GAS: 'instrument', ESD: 'instrument', PSV: 'instrument',
    // common type codes
    PUMP: 'rotating', COMPRESSOR: 'rotating', TURBINE: 'rotating', FAN: 'rotating', MOTOR: 'rotating',
    VESSEL: 'static', EXCHANGER: 'static', TANK: 'static', PIPING: 'static', VALVE: 'static',
};

// Keyword inference. ROTATING is checked FIRST: "Boiler Feed Pump" and
// "Condenser Pump" are pumps, even though 'boiler'/'condenser' are static words.
const ROTATING_WORDS = ['pump', 'motor', 'compressor', 'turbine', 'fan', 'blower', 'gearbox', 'gear box', 'agitator', 'mixer', 'centrifuge', 'generator', 'conveyor', 'bearing', 'impeller', 'rotor', 'shaft', 'coupling', 'gas seal', 'mech seal', 'mechanical seal', 'screw', 'expander'];
const STATIC_WORDS = ['exchanger', 'cooler', 'condenser', 'heater', 'boiler', 'vessel', 'drum', 'tank', 'column', 'tower', 'separator', 'reactor', 'filter', 'strainer', 'pipe', 'piping', 'pipeline', 'valve', 'silo', 'stack', 'scrubber', 'economizer', 'reboiler', 'accumulator', 'hx-'];
const ELECTRICAL_WORDS = ['transformer', 'switchgear', 'mcc', 'ups', 'vfd', 'vsd', 'busbar', 'breaker', 'inverter', 'rectifier', 'battery', 'panel board', 'distribution board'];
const INSTRUMENT_WORDS = ['transmitter', 'analyzer', 'analyser', 'sensor', 'gauge', 'plc', 'dcs', 'detector', 'instrument', 'actuator', 'positioner'];

export function resolveEquipmentClass(asset: {
    name?: string | null; tag?: string | null;
    assetClass?: string | null; assetCategory?: string | null; assetType?: string | null;
} | null | undefined): ClassResolution {
    if (!asset) return { cls: 'other', basis: 'default', note: 'no asset context' };

    // 1. Declared classification (most specific field first)
    for (const [field, value] of [
        ['asset_class', asset.assetClass], ['asset_type', asset.assetType], ['asset_category', asset.assetCategory],
    ] as const) {
        const code = (value || '').toUpperCase().trim();
        if (code && DECLARED_MAP[code]) {
            return { cls: DECLARED_MAP[code], basis: 'declared', note: `${field}=${code}` };
        }
    }

    // 2. Keyword inference on name + tag
    const hay = `${asset.name || ''} ${asset.tag || ''}`.toLowerCase();
    const hit = (words: string[]) => words.find(w => hay.includes(w));
    let w: string | undefined;
    if ((w = hit(ROTATING_WORDS))) return { cls: 'rotating', basis: 'inferred', note: `name contains "${w}"` };
    if ((w = hit(STATIC_WORDS))) return { cls: 'static', basis: 'inferred', note: `name contains "${w}"` };
    if ((w = hit(ELECTRICAL_WORDS))) return { cls: 'electrical', basis: 'inferred', note: `name contains "${w}"` };
    if ((w = hit(INSTRUMENT_WORDS))) return { cls: 'instrument', basis: 'inferred', note: `name contains "${w}"` };

    // 3. Honest default
    return { cls: 'other', basis: 'default', note: 'no classification declared and none inferable from the name — set Asset Class in the register' };
}
