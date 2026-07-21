import React, { useMemo, useState } from 'react';
import { Ruler, AlertTriangle, Clock, CheckCircle, Plus, X, MapPin, Calculator } from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';
import { useAssetLookup } from '../hooks/useAssetLookup';
import {
    requiredThicknessVesselMm, requiredThicknessPipeMm,
    mawpVesselMPa, mawpPipeMPa, isPipingComponent,
} from '../eam/utils/integrityCalcs';
import type { ThicknessReading, UTMethod, CML, ComponentType, TminBasis } from '../types/integrity';

const COMPONENT_TYPES: ComponentType[] = ['shell', 'head', 'nozzle', 'piping_elbow', 'piping_straight', 'piping_tee', 'weld', 'tank_shell_course', 'tank_floor', 'tank_roof'];

const EMPTY_CML_FORM = {
    asset_id: '', cml_number: '', component_type: 'shell' as ComponentType, orientation: '',
    nominal_thickness_mm: '', tmin_manual: '',
    basis: 'manual' as 'manual' | 'calculated',
    design_pressure_mpa: '', allowable_stress_mpa: '', joint_efficiency: '1.0',
    dimension_mm: '', y_coefficient: '0.4', corrosion_allowance_mm: '',
};

export const ThicknessDataPage: React.FC = () => {
    const { cmls, readings, assessments, summary, addReading, addCML } = useIntegrity();
    const { assetOptions } = useAssetLookup();
    const [showNew, setShowNew] = useState(false);
    const [showNewCml, setShowNewCml] = useState(false);
    const [cmlForm, setCmlForm] = useState(EMPTY_CML_FORM);
    const today = new Date().toISOString().slice(0, 10);
    const [form, setForm] = useState({ cml_id: '', measured_thickness_mm: '', ut_method: 'ut_contact' as UTMethod, technician: '', reading_date: today });

    const handleSubmit = () => {
        if (!form.cml_id || !form.measured_thickness_mm || !form.technician || !form.reading_date) return;
        const r: ThicknessReading = { id: `r-${Date.now()}`, cml_id: form.cml_id, reading_date: new Date(form.reading_date).toISOString(), measured_thickness_mm: parseFloat(form.measured_thickness_mm), ut_method: form.ut_method, technician: form.technician };
        addReading(r);
        setForm({ cml_id: '', measured_thickness_mm: '', ut_method: 'ut_contact', technician: '', reading_date: today });
        setShowNew(false);
    };

    // ── New-CML derived numbers (live preview while the form is filled) ──
    const piping = isPipingComponent(cmlForm.component_type);
    const cmlCalc = useMemo(() => {
        const p = parseFloat(cmlForm.design_pressure_mpa);
        const s = parseFloat(cmlForm.allowable_stress_mpa);
        const e = parseFloat(cmlForm.joint_efficiency);
        const dim = parseFloat(cmlForm.dimension_mm);
        const y = parseFloat(cmlForm.y_coefficient) || 0.4;
        const nominal = parseFloat(cmlForm.nominal_thickness_mm);
        if ([p, s, e, dim].some(v => !Number.isFinite(v))) return null;
        const tmin = piping
            ? requiredThicknessPipeMm(p, dim, s, e, y)
            : requiredThicknessVesselMm(p, dim, s, e);
        if (tmin === null) return null;
        const mawp = Number.isFinite(nominal)
            ? (piping ? mawpPipeMPa(nominal, dim, s, e, y) : mawpVesselMPa(nominal, dim, s, e))
            : null;
        return { tmin, mawp };
    }, [cmlForm, piping]);

    const effectiveTmin = cmlForm.basis === 'calculated'
        ? cmlCalc?.tmin ?? null
        : (Number.isFinite(parseFloat(cmlForm.tmin_manual)) ? parseFloat(cmlForm.tmin_manual) : null);

    const cmlFormValid = !!cmlForm.asset_id && !!cmlForm.cml_number.trim()
        && Number.isFinite(parseFloat(cmlForm.nominal_thickness_mm)) && effectiveTmin !== null;

    const handleCreateCml = () => {
        if (!cmlFormValid || effectiveTmin === null) return;
        const calculated = cmlForm.basis === 'calculated';
        const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
        const c: CML = {
            id: `cml-${Date.now()}`,
            asset_id: cmlForm.asset_id,
            cml_number: cmlForm.cml_number.trim(),
            component_type: cmlForm.component_type,
            nominal_thickness_mm: parseFloat(cmlForm.nominal_thickness_mm),
            tmin_mm: parseFloat(effectiveTmin.toFixed(3)),
            orientation: cmlForm.orientation.trim() || '—',
            tmin_basis: (calculated ? (piping ? 'b31_3' : 'asme_viii') : 'manual') as TminBasis,
            design_pressure_mpa: calculated ? num(cmlForm.design_pressure_mpa) : null,
            allowable_stress_mpa: calculated ? num(cmlForm.allowable_stress_mpa) : null,
            joint_efficiency: calculated ? num(cmlForm.joint_efficiency) : null,
            inside_radius_mm: calculated && !piping ? num(cmlForm.dimension_mm) : null,
            outside_diameter_mm: calculated && piping ? num(cmlForm.dimension_mm) : null,
            y_coefficient: calculated && piping ? num(cmlForm.y_coefficient) : null,
            corrosion_allowance_mm: num(cmlForm.corrosion_allowance_mm),
        };
        addCML(c);
        setCmlForm(EMPTY_CML_FORM);
        setShowNewCml(false);
    };

    // Remaining life comes from the shared API-510 assessment engine (controlling
    // rate = max(ST, LT)) so this page agrees with Corrosion Rates to the digit.
    const augmented = readings.map(r => {
        const cml = cmls.find(c => c.id === r.cml_id);
        const delta = cml ? r.measured_thickness_mm - cml.tmin_mm : 0;
        const remainingLife = assessments.get(r.cml_id)?.remaining_life_years ?? null;
        return { ...r, cml, delta, remainingLife };
    }).sort((a, b) => a.delta - b.delta);

    return (
        <div className="space-y-6 pb-20">
            <div className="flex justify-between items-center">
                <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Thickness Data</h1><p className="text-slate-500 text-sm mt-1">Ultrasonic thickness readings, T-min monitoring, and retirement forecasting</p></div>
                <div className="flex gap-2">
                    <button onClick={() => setShowNewCml(true)} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors flex items-center"><MapPin size={16} className="mr-2" />New CML</button>
                    <button onClick={() => setShowNew(true)} className="btn-primary"><Plus size={16} className="mr-2" />New Reading</button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Total CMLs" value={summary.total_cmls} icon={Ruler} />
                <Kpi label="Readings (Recent)" value={readings.length} icon={CheckCircle} color="text-emerald-500" bg="bg-emerald-50" />
                <Kpi label="Below T-min" value={summary.cmls_below_tmin} icon={AlertTriangle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Avg Rate" value={`${summary.avg_corrosion_rate} mm/yr`} icon={Clock} />
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-5 py-4">CML</th><th className="px-5 py-4">Component</th><th className="px-5 py-4 text-right">Nominal</th><th className="px-5 py-4 text-right">Measured</th><th className="px-5 py-4 text-right">T-min</th><th className="px-5 py-4 text-right">Δ (Margin)</th><th className="px-5 py-4">UT Method</th><th className="px-5 py-4">Date</th><th className="px-5 py-4">Technician</th><th className="px-5 py-4 text-right">Est. Life</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {augmented.map(r => {
                            const deltaColor = r.delta < 0 ? 'text-red-600 font-bold' : r.delta < 2 ? 'text-amber-600' : 'text-emerald-600';
                            return (
                                <tr key={r.id} className={`hover:bg-slate-50 transition-colors ${r.delta < 0 ? 'bg-red-50/50' : ''}`}>
                                    <td className="px-5 py-4 font-mono text-slate-700 text-xs">{r.cml?.cml_number || r.cml_id}</td>
                                    <td className="px-5 py-4 text-slate-600 capitalize text-xs">{r.cml?.component_type.replace(/_/g, ' ') || '—'}</td>
                                    <td className="px-5 py-4 text-right font-mono text-slate-500">{r.cml?.nominal_thickness_mm.toFixed(1)}</td>
                                    <td className="px-5 py-4 text-right font-mono text-slate-800 font-medium">{r.measured_thickness_mm.toFixed(1)}</td>
                                    <td className="px-5 py-4 text-right font-mono text-slate-500">{r.cml?.tmin_mm.toFixed(1)}</td>
                                    <td className={`px-5 py-4 text-right font-mono ${deltaColor}`}>{r.delta >= 0 ? '+' : ''}{r.delta.toFixed(1)}</td>
                                    <td className="px-5 py-4"><span className="px-2 py-1 text-[10px] bg-slate-100 text-slate-600 rounded uppercase font-medium">{r.ut_method.replace(/_/g, ' ')}</span></td>
                                    <td className="px-5 py-4 font-mono text-xs text-slate-500">{new Date(r.reading_date).toLocaleDateString()}</td>
                                    <td className="px-5 py-4 text-slate-600 text-xs">{r.technician}</td>
                                    <td className="px-5 py-4 text-right font-mono text-slate-700">{r.remainingLife !== null ? `${r.remainingLife.toFixed(1)} yrs` : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="p-2 bg-primary-50 rounded-lg text-primary-600"><Ruler size={20} /></div><div><h2 className="text-lg font-bold text-slate-800">New UT Reading</h2><p className="text-xs text-slate-500 mt-0.5">Record an ultrasonic thickness measurement</p></div></div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">CML Location</label>
                                <select value={form.cml_id} onChange={e => setForm(f => ({ ...f, cml_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                    <option value="">Select CML…</option>
                                    {cmls.map(c => <option key={c.id} value={c.id}>{c.cml_number} — {c.component_type.replace(/_/g, ' ')} ({c.orientation})</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Measured Thickness (mm)</label>
                                    <input type="number" step="0.1" value={form.measured_thickness_mm} onChange={e => setForm(f => ({ ...f, measured_thickness_mm: e.target.value }))} placeholder="e.g. 10.4" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">UT Method</label>
                                    <select value={form.ut_method} onChange={e => setForm(f => ({ ...f, ut_method: e.target.value as UTMethod }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500">
                                        <option value="ut_contact">UT Contact</option><option value="ut_compression">UT Compression</option><option value="paut">PAUT</option><option value="scan">Scan</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Reading Date</label>
                                    <input type="date" value={form.reading_date} max={today} onChange={e => setForm(f => ({ ...f, reading_date: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Technician</label>
                                    <input type="text" value={form.technician} onChange={e => setForm(f => ({ ...f, technician: e.target.value }))} placeholder="e.g. D. Chen" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.cml_id || !form.measured_thickness_mm || !form.technician || !form.reading_date} className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Record Reading</button>
                        </div>
                    </div>
                </div>
            )}
            {showNewCml && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNewCml(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl mx-4 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-primary-50 rounded-lg text-primary-600"><MapPin size={20} /></div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">New Condition Monitoring Location</h2>
                                    <p className="text-xs text-slate-500 mt-0.5">t-min from pressure design (ASME VIII / B31.3) or manual entry</p>
                                </div>
                            </div>
                            <button onClick={() => setShowNewCml(false)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Asset</label>
                                <select value={cmlForm.asset_id} onChange={e => setCmlForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500">
                                    <option value="">Select asset…</option>
                                    {assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">CML Number</label>
                                    <input type="text" value={cmlForm.cml_number} onChange={e => setCmlForm(f => ({ ...f, cml_number: e.target.value }))} placeholder="e.g. CML-V205-04" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Component</label>
                                    <select value={cmlForm.component_type} onChange={e => setCmlForm(f => ({ ...f, component_type: e.target.value as ComponentType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500">
                                        {COMPONENT_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Nominal Thickness (mm)</label>
                                    <input type="number" step="0.1" value={cmlForm.nominal_thickness_mm} onChange={e => setCmlForm(f => ({ ...f, nominal_thickness_mm: e.target.value }))} placeholder="e.g. 12.7" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                </div>
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Orientation / Location</label>
                                    <input type="text" value={cmlForm.orientation} onChange={e => setCmlForm(f => ({ ...f, orientation: e.target.value }))} placeholder="e.g. 6 o'clock" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                </div>
                            </div>

                            {/* T-min basis */}
                            <div>
                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">T-min Basis</label>
                                <div className="flex gap-2">
                                    <button onClick={() => setCmlForm(f => ({ ...f, basis: 'calculated' }))} className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${cmlForm.basis === 'calculated' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                        <Calculator size={13} /> Calculated ({piping ? 'ASME B31.3' : 'ASME VIII Div 1'})
                                    </button>
                                    <button onClick={() => setCmlForm(f => ({ ...f, basis: 'manual' }))} className={`flex-1 px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${cmlForm.basis === 'manual' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                                        Manual
                                    </button>
                                </div>
                            </div>

                            {cmlForm.basis === 'manual' ? (
                                <div><label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">Minimum Thickness t-min (mm)</label>
                                    <input type="number" step="0.01" value={cmlForm.tmin_manual} onChange={e => setCmlForm(f => ({ ...f, tmin_manual: e.target.value }))} placeholder="e.g. 6.35" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div><label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Design P (MPa)</label>
                                            <input type="number" step="0.01" value={cmlForm.design_pressure_mpa} onChange={e => setCmlForm(f => ({ ...f, design_pressure_mpa: e.target.value }))} placeholder="e.g. 2.5" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                        </div>
                                        <div><label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Allowable S (MPa)</label>
                                            <input type="number" step="1" value={cmlForm.allowable_stress_mpa} onChange={e => setCmlForm(f => ({ ...f, allowable_stress_mpa: e.target.value }))} placeholder="e.g. 138" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                        </div>
                                        <div><label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Joint Eff. E</label>
                                            <input type="number" step="0.05" min="0" max="1" value={cmlForm.joint_efficiency} onChange={e => setCmlForm(f => ({ ...f, joint_efficiency: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div><label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">{piping ? 'Outside Ø (mm)' : 'Inside Radius (mm)'}</label>
                                            <input type="number" step="1" value={cmlForm.dimension_mm} onChange={e => setCmlForm(f => ({ ...f, dimension_mm: e.target.value }))} placeholder={piping ? 'e.g. 168.3' : 'e.g. 900'} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                        </div>
                                        {piping && (
                                            <div><label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Y Coeff.</label>
                                                <input type="number" step="0.1" value={cmlForm.y_coefficient} onChange={e => setCmlForm(f => ({ ...f, y_coefficient: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                            </div>
                                        )}
                                        <div><label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">Corr. Allow. (mm)</label>
                                            <input type="number" step="0.1" value={cmlForm.corrosion_allowance_mm} onChange={e => setCmlForm(f => ({ ...f, corrosion_allowance_mm: e.target.value }))} placeholder="e.g. 3.0" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:border-primary-500" />
                                        </div>
                                    </div>

                                    {/* Live result */}
                                    <div className={`rounded-lg border p-4 ${cmlCalc ? 'bg-emerald-50/60 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                                        {cmlCalc ? (
                                            <div className="grid grid-cols-3 gap-3 text-center">
                                                <div>
                                                    <p className="text-[10px] text-slate-500 uppercase font-semibold">Required t-min</p>
                                                    <p className="text-lg font-bold text-slate-800 font-mono">{cmlCalc.tmin.toFixed(2)} <span className="text-xs font-normal">mm</span></p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-500 uppercase font-semibold">MAWP @ nominal</p>
                                                    <p className="text-lg font-bold text-slate-800 font-mono">{cmlCalc.mawp !== null ? `${cmlCalc.mawp.toFixed(2)}` : '—'} <span className="text-xs font-normal">MPa</span></p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-500 uppercase font-semibold">Margin @ nominal</p>
                                                    <p className={`text-lg font-bold font-mono ${Number.isFinite(parseFloat(cmlForm.nominal_thickness_mm)) && parseFloat(cmlForm.nominal_thickness_mm) - cmlCalc.tmin < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                        {Number.isFinite(parseFloat(cmlForm.nominal_thickness_mm)) ? `${(parseFloat(cmlForm.nominal_thickness_mm) - cmlCalc.tmin >= 0 ? '+' : '')}${(parseFloat(cmlForm.nominal_thickness_mm) - cmlCalc.tmin).toFixed(2)}` : '—'} <span className="text-xs font-normal">mm</span>
                                                    </p>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-500 text-center">Enter design pressure, stress, efficiency and {piping ? 'outside diameter' : 'inside radius'} — t-min and MAWP compute live. Out-of-validity inputs (e.g. P &gt; 0.385·S·E) show no result.</p>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="p-6 border-t border-slate-200 flex justify-end space-x-3">
                            <button onClick={() => setShowNewCml(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">Cancel</button>
                            <button onClick={handleCreateCml} disabled={!cmlFormValid} className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Create CML</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-blue-50' }: any) {
    return (<div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className={`p-3 rounded-lg ${bg} ${color} mr-4`}><Icon size={24} /></div><div><p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p><h3 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h3></div></div>);
}
