import React, { useState } from 'react';
import { Activity, AlertTriangle, Clock, RefreshCcw, Save, X } from 'lucide-react';
import { Asset } from '../../types';
import { Button } from '../ui';
import { resolveMachineClass, vibrationBands, isVibrationUnit, TEMPERATURE_BANDS, ISO20816_ZONES } from '../../../lib/predict/limitLibrary';

// ── Reading Point editor ─────────────────────────────────────────────────────
// A real measuring-point definition (SAP PM "measuring point" / Maximo "meter"):
// name, meter-vs-condition, engineering unit, and 4 alarm bands. These bands are
// what drive the condition alarms (R-4) and the Predict health engine.
//
// Shared by the Condition Data page and the asset drawer's Readings tab so a point
// created in either place is the same row, with the same bands, in the same table.

export interface NewReadingPoint {
    assetId: string;
    name: string;
    category: 'METER' | 'CONDITION';
    unit: string;
    minCritical?: number | null;
    minWarning?: number | null;
    maxWarning?: number | null;
    maxCritical?: number | null;
    monitoringFrequencyDays?: number | null;
    pfIntervalDays?: number | null;
    /** band provenance (0198): iso20816-<class> | template | learned | oem | manual */
    limitSource?: string | null;
}

// Common engineering units, grouped, for the reading-point unit picker. Techs
// pick from these; custom ones they add are remembered (localStorage).
const UNIT_GROUPS: { label: string; units: string[] }[] = [
    { label: 'Vibration', units: ['mm/s', 'µm', 'in/s', 'g'] },
    { label: 'Temperature', units: ['°C', '°F', 'K'] },
    { label: 'Pressure', units: ['bar', 'psi', 'kPa', 'MPa', 'mbar'] },
    { label: 'Flow', units: ['m³/h', 'L/min', 'L/s', 'GPM'] },
    { label: 'Rotation / Electrical', units: ['rpm', 'Hz', 'A', 'V', 'kW', 'kWh'] },
    { label: 'Level / Thickness', units: ['%', 'mm', 'm', 'in'] },
    { label: 'Oil analysis', units: ['cSt', 'ppm', 'TAN', 'TBN'] },
    { label: 'Meter / runtime', units: ['hours', 'days', 'km', 'miles', 'cycles', 'starts'] },
];
const ALL_PRESET_UNITS = new Set(UNIT_GROUPS.flatMap(g => g.units));

// One-tap templates that prefill a whole point (name/type/unit/bands) — the big
// time-saver for technicians configuring rounds. Vibration bands are NOT static:
// they resolve from the ISO 20816-3 machine class picked in the modal (the old
// universal 4.5/7.1 was the large-machine boundary applied to everything).
const QUICK_POINTS: { label: string; name: string; category: 'METER' | 'CONDITION'; unit: string; maxWarning?: string; maxCritical?: string; source?: string }[] = [
    { label: 'Vibration', name: 'Vibration', category: 'CONDITION', unit: 'mm/s', source: 'iso20816' },
    { label: 'Temperature', name: 'Temperature', category: 'CONDITION', unit: '°C', maxWarning: String(TEMPERATURE_BANDS.bearing.maxWarning), maxCritical: String(TEMPERATURE_BANDS.bearing.maxCritical), source: 'template' },
    { label: 'Pressure', name: 'Pressure', category: 'CONDITION', unit: 'bar' },
    { label: 'Oil level', name: 'Oil Level', category: 'CONDITION', unit: '%' },
    { label: 'Running hours', name: 'Running Hours', category: 'METER', unit: 'hours' },
];

export const AddReadingPointModal: React.FC<{
    asset: Asset | null;
    onClose: () => void;
    onCreate: (p: NewReadingPoint) => void | Promise<void>;
}> = ({ asset, onClose, onCreate }) => {
    const [name, setName] = useState('');
    const [category, setCategory] = useState<'METER' | 'CONDITION'>('CONDITION');
    const [unit, setUnit] = useState('');
    const [minCritical, setMinCritical] = useState('');
    const [minWarning, setMinWarning] = useState('');
    const [maxWarning, setMaxWarning] = useState('');
    const [maxCritical, setMaxCritical] = useState('');
    const [freq, setFreq] = useState('');   // monitoring interval (days) — '' = auto from criticality
    const [pf, setPf] = useState('');        // P-F interval (days)
    const [saving, setSaving] = useState(false);
    // Band provenance (1.5): the cited source of the current band values.
    // Hand-editing any band voids the citation → 'manual'.
    const [limitSource, setLimitSource] = useState<string | null>(null);
    // ISO 20816-3 machine class for vibration bands (size × mounting).
    const [over300kW, setOver300kW] = useState(false);
    const [flexMount, setFlexMount] = useState(false);
    const machineClass = resolveMachineClass(over300kW, flexMount);
    // Unit picker: preset dropdown + remembered custom units.
    const [customUnits, setCustomUnits] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem('readings.customUnits') || '[]'); } catch { return []; }
    });
    const [unitMode, setUnitMode] = useState<'pick' | 'custom'>('pick');

    if (!asset) return null;
    const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

    const rememberUnit = (u: string) => {
        const v = u.trim();
        if (!v || ALL_PRESET_UNITS.has(v) || customUnits.includes(v)) return;
        const next = [...customUnits, v];
        setCustomUnits(next);
        try { localStorage.setItem('readings.customUnits', JSON.stringify(next)); } catch { /* ignore */ }
    };

    const applyTemplate = (t: typeof QUICK_POINTS[number]) => {
        setName(t.name); setCategory(t.category); setUnit(t.unit); setUnitMode('pick');
        if (t.source === 'iso20816') {
            const b = vibrationBands(machineClass);
            setMaxWarning(String(b.maxWarning)); setMaxCritical(String(b.maxCritical));
            setLimitSource(b.source);
        } else {
            setMaxWarning(t.maxWarning ?? ''); setMaxCritical(t.maxCritical ?? '');
            setLimitSource(t.maxWarning || t.maxCritical ? (t.source ?? 'template') : null);
        }
        setMinWarning(''); setMinCritical('');
    };

    // Machine-class change re-cites ISO-sourced vibration bands in place.
    const applyMachineClass = (big: boolean, flex: boolean) => {
        setOver300kW(big); setFlexMount(flex);
        if (limitSource?.startsWith('iso20816') || (isVibrationUnit(unit) && !maxCritical)) {
            const b = vibrationBands(resolveMachineClass(big, flex));
            setMaxWarning(String(b.maxWarning)); setMaxCritical(String(b.maxCritical));
            setLimitSource(b.source);
        }
    };

    // Hand-edits void the citation.
    const editBand = (set: (v: string) => void) => (v: string) => { set(v); setLimitSource('manual'); };

    // Guard against crossed bands (min critical should be ≤ min warning ≤ max warning ≤ max critical).
    const bandOrderOk = (() => {
        const vals = [num(minCritical), num(minWarning), num(maxWarning), num(maxCritical)].filter(v => v != null) as number[];
        for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1]) return false;
        return true;
    })();
    const canSave = name.trim().length > 0 && bandOrderOk && !saving;

    const submit = async () => {
        if (!canSave) return;
        rememberUnit(unit); // any freshly-typed unit becomes a future option
        setSaving(true);
        await onCreate({
            assetId: asset.id, name, category, unit,
            minCritical: num(minCritical), minWarning: num(minWarning),
            maxWarning: num(maxWarning), maxCritical: num(maxCritical),
            monitoringFrequencyDays: freq ? Number(freq) : null,
            pfIntervalDays: pf.trim() ? Number(pf) : null,
            limitSource: [minCritical, minWarning, maxWarning, maxCritical].some(v => v.trim() !== '') ? (limitSource ?? 'manual') : null,
        });
        setSaving(false);
    };

    const ring = 'focus:ring-2 focus:ring-relantern-300 focus:border-relantern-400 outline-none';
    const bandInput = (label: string, tone: string, val: string, set: (v: string) => void) => (
        <label className="block">
            <span className={`text-[10px] font-bold uppercase tracking-wide ${tone}`}>{label}</span>
            <input type="number" value={val} onChange={e => set(e.target.value)} placeholder="—"
                className={`mt-1 w-full p-2 border border-slate-200 rounded-lg text-sm text-right ${ring}`} />
        </label>
    );

    const TypeCard = (val: 'CONDITION' | 'METER', icon: React.ReactNode, title: string, desc: string) => (
        <button onClick={() => setCategory(val)}
            className={`text-left p-2.5 rounded-xl border-2 transition ${category === val ? 'border-relantern-400 bg-relantern-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
            <div className={`flex items-center gap-1.5 font-bold text-sm ${category === val ? 'text-relantern-700' : 'text-slate-700'}`}>{icon} {title}</div>
            <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{desc}</div>
        </button>
    );

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-3 flex items-center gap-2 bg-gradient-to-r from-relantern-500 to-relantern-600 text-white flex-shrink-0">
                    <Activity size={18} />
                    <div className="min-w-0">
                        <h3 className="font-bold text-sm leading-tight">Add reading point</h3>
                        <p className="text-[11px] text-white/90 truncate">{asset.tag} · {asset.name}</p>
                    </div>
                    <button onClick={onClose} className="ml-auto text-white/80 hover:text-white"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    {/* Quick-start templates */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Quick start</label>
                        <div className="flex flex-wrap gap-1.5">
                            {QUICK_POINTS.map(t => (
                                <button key={t.label} onClick={() => applyTemplate(t)}
                                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-relantern-200 bg-relantern-50 text-relantern-700 hover:bg-relantern-100 transition">
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Point name</label>
                        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bearing Vibration (DE)"
                            className={`w-full p-2.5 border border-slate-300 rounded-lg text-sm ${ring}`} />
                    </div>

                    {/* Type — descriptive cards */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            {TypeCard('CONDITION', <Activity size={14} />, 'Condition', 'Spot value — vibration, temp, pressure')}
                            {TypeCard('METER', <Clock size={14} />, 'Meter', 'Cumulative — running hours, km, cycles')}
                        </div>
                    </div>

                    {/* Unit — dropdown of common units + remembered customs + add-your-own */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Unit</label>
                        <select
                            value={unitMode === 'custom' ? '__custom__' : unit}
                            onChange={e => {
                                if (e.target.value === '__custom__') { setUnitMode('custom'); setUnit(''); }
                                else { setUnit(e.target.value); setUnitMode('pick'); }
                            }}
                            className={`w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-white ${ring}`}
                        >
                            <option value="">Select unit…</option>
                            {UNIT_GROUPS.map(g => (
                                <optgroup key={g.label} label={g.label}>
                                    {g.units.map(u => <option key={u} value={u}>{u}</option>)}
                                </optgroup>
                            ))}
                            {customUnits.length > 0 && (
                                <optgroup label="Your units">
                                    {customUnits.map(u => <option key={u} value={u}>{u}</option>)}
                                </optgroup>
                            )}
                            <option value="__custom__">＋ Add custom unit…</option>
                        </select>
                        {unitMode === 'custom' && (
                            <div className="flex gap-2 mt-2">
                                <input autoFocus value={unit} onChange={e => setUnit(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' && unit.trim()) { rememberUnit(unit); setUnitMode('pick'); } }}
                                    placeholder="Type a unit, e.g. µS/cm"
                                    className={`flex-1 p-2 border border-slate-300 rounded-lg text-sm ${ring}`} />
                                <button onClick={() => { rememberUnit(unit); setUnitMode('pick'); }} disabled={!unit.trim()}
                                    className="px-3 py-2 text-sm font-semibold text-white bg-relantern-500 hover:bg-relantern-600 disabled:opacity-50 rounded-lg">Add</button>
                            </div>
                        )}
                    </div>

                    {/* Alarm bands */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Alarm bands {category === 'METER' && <span className="text-slate-400 normal-case font-normal">(optional for meters)</span>}</label>
                            <span className="text-[10px] text-slate-400">low → high</span>
                        </div>
                        {/* ISO 20816-3 machine class — shown for vibration points so the
                            suggested bands match the machine, not a universal number */}
                        {isVibrationUnit(unit) && (
                            <div className="flex flex-wrap items-center gap-2 mb-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">ISO 20816-3</span>
                                <div className="flex border border-slate-200 rounded-md overflow-hidden text-[11px]">
                                    <button onClick={() => applyMachineClass(false, flexMount)} className={`px-2 py-1 font-semibold transition ${!over300kW ? 'bg-relantern-50 text-relantern-700' : 'bg-white text-slate-500'}`}>≤ 300 kW</button>
                                    <button onClick={() => applyMachineClass(true, flexMount)} className={`px-2 py-1 font-semibold transition ${over300kW ? 'bg-relantern-50 text-relantern-700' : 'bg-white text-slate-500'}`}>&gt; 300 kW</button>
                                </div>
                                <div className="flex border border-slate-200 rounded-md overflow-hidden text-[11px]">
                                    <button onClick={() => applyMachineClass(over300kW, false)} className={`px-2 py-1 font-semibold transition ${!flexMount ? 'bg-relantern-50 text-relantern-700' : 'bg-white text-slate-500'}`}>Rigid</button>
                                    <button onClick={() => applyMachineClass(over300kW, true)} className={`px-2 py-1 font-semibold transition ${flexMount ? 'bg-relantern-50 text-relantern-700' : 'bg-white text-slate-500'}`}>Flexible</button>
                                </div>
                                <span className="text-[10px] text-slate-400">warn {ISO20816_ZONES[machineClass].bc} · crit {ISO20816_ZONES[machineClass].cd} mm/s</span>
                            </div>
                        )}
                        <div className="grid grid-cols-4 gap-2">
                            {bandInput('Min Crit', 'text-red-600', minCritical, editBand(setMinCritical))}
                            {bandInput('Min Warn', 'text-amber-600', minWarning, editBand(setMinWarning))}
                            {bandInput('Max Warn', 'text-amber-600', maxWarning, editBand(setMaxWarning))}
                            {bandInput('Max Crit', 'text-red-600', maxCritical, editBand(setMaxCritical))}
                        </div>
                        {!bandOrderOk && (
                            <p className="text-[11px] text-red-600 mt-1.5 flex items-center gap-1"><AlertTriangle size={12} /> Bands must increase left to right (min critical ≤ min warning ≤ max warning ≤ max critical).</p>
                        )}
                        {limitSource && limitSource !== 'manual' && (
                            <p className="text-[11px] text-relantern-700 mt-1.5">
                                Source: {limitSource.startsWith('iso20816') ? ISO20816_ZONES[machineClass].describe : 'class template (typical cited values)'} — editing a value marks it manual.
                            </p>
                        )}
                        <p className="text-[11px] text-slate-400 mt-1.5">A reading outside the warning band raises a warning alarm; outside critical raises a critical alarm and can auto-raise corrective work.</p>
                    </div>

                    {/* Per-point cadence (0176) */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Monitoring frequency</label>
                            <select value={freq} onChange={e => setFreq(e.target.value)}
                                className={`w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-white ${ring}`}>
                                <option value="">Auto (from criticality)</option>
                                <option value="1">Daily</option>
                                <option value="7">Weekly</option>
                                <option value="14">Fortnightly</option>
                                <option value="30">Monthly</option>
                                <option value="90">Quarterly</option>
                                <option value="180">Half-yearly</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">P-F interval (days)</label>
                            <input type="number" value={pf} onChange={e => setPf(e.target.value)} placeholder="optional"
                                className={`w-full p-2.5 border border-slate-300 rounded-lg text-sm ${ring}`} />
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-400 -mt-1">Frequency drives the rounds "due" list. With no explicit frequency, a P-F interval sets it to half the P-F (RCM); otherwise the asset criticality does.</p>
                </div>

                <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
                    <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                    <button onClick={submit} disabled={!canSave}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-relantern-500 hover:bg-relantern-600 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors">
                        {saving ? <RefreshCcw size={14} className="animate-spin" /> : <Save size={14} />} Add reading point
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddReadingPointModal;
