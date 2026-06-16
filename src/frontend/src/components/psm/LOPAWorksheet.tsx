/**
 * LOPAWorksheet — IEC 61511 Layer of Protection Analysis
 *
 * Scenario-based risk assessment:
 * Initiating Event → IPL stacking → Mitigated Frequency → SIL Determination
 */
import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, Edit3, Check, X, ChevronDown, ChevronRight,
    Shield, AlertTriangle, Calculator, Target, Layers,
} from 'lucide-react';
import psmService, { calcMitigatedFrequency, calcRequiredSIL } from '../../eam/services/PSMService';
import type { PSMStudy, LOPAScenario, IPL, LOPAConditionalModifiers } from '../../types/safety';
import SwissCheeseModel from './diagrams/SwissCheeseModel';

const IPL_TYPES: { value: string; label: string; typicalPFD: number }[] = [
    { value: 'bpcs',   label: 'BPCS',              typicalPFD: 0.1 },
    { value: 'alarm',  label: 'Operator + Alarm',   typicalPFD: 0.1 },
    { value: 'sis',    label: 'SIS (SIL 1)',         typicalPFD: 0.01 },
    { value: 'relief', label: 'Relief Valve',        typicalPFD: 0.01 },
    { value: 'dike',   label: 'Dike / Containment',  typicalPFD: 0.01 },
    { value: 'human',  label: 'Human Response',      typicalPFD: 0.1 },
    { value: 'other',  label: 'Other',               typicalPFD: 0.1 },
];

const SIL_COLORS: Record<number, string> = {
    0: 'bg-emerald-100 text-emerald-700',
    1: 'bg-blue-100 text-blue-700',
    2: 'bg-amber-100 text-amber-700',
    3: 'bg-orange-100 text-orange-700',
    4: 'bg-red-100 text-red-700',
};

// ═══════════════════════════════════════════════════════════════
//  IPL Editor
// ═══════════════════════════════════════════════════════════════

function IPLEditor({ ipls, onChange }: { ipls: IPL[]; onChange: (ipls: IPL[]) => void }) {
    const addIPL = () => {
        onChange([...ipls, { name: '', type: 'bpcs', pfd: 0.1, credit: 10, description: '' }]);
    };

    const updateIPL = (idx: number, updates: Partial<IPL>) => {
        const updated = [...ipls];
        updated[idx] = { ...updated[idx], ...updates };
        if (updates.pfd !== undefined) updated[idx].credit = Math.round(1 / updates.pfd);
        if (updates.type) {
            const ref = IPL_TYPES.find(t => t.value === updates.type);
            if (ref) { updated[idx].pfd = ref.typicalPFD; updated[idx].credit = Math.round(1 / ref.typicalPFD); }
        }
        onChange(updated);
    };

    const removeIPL = (idx: number) => {
        onChange(ipls.filter((_, i) => i !== idx));
    };

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase text-slate-500">Independent Protection Layers</span>
                <button onClick={addIPL} className="text-[10px] text-primary-600 hover:text-primary-700 flex items-center gap-0.5"><Plus size={10} /> Add IPL</button>
            </div>
            {ipls.map((ipl, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                    <select value={ipl.type} onChange={e => updateIPL(idx, { type: e.target.value as IPL['type'] })}
                        className="text-xs border border-slate-200 rounded px-1.5 py-1 w-32">
                        {IPL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <input value={ipl.name} onChange={e => updateIPL(idx, { name: e.target.value })}
                        className="text-xs border border-slate-200 rounded px-2 py-1 flex-1" placeholder="IPL name..." />
                    <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">PFD:</span>
                        <input type="number" step="0.001" value={ipl.pfd} onChange={e => updateIPL(idx, { pfd: parseFloat(e.target.value) || 0.1 })}
                            className="w-16 text-xs border border-slate-200 rounded px-1 py-1 text-center font-mono" />
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono w-12 text-center">×{ipl.credit}</span>
                    <button onClick={() => removeIPL(idx)} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
            ))}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Scenario Card
// ═══════════════════════════════════════════════════════════════

function ScenarioCard({ scenario, onUpdate, onDelete }: {
    scenario: LOPAScenario;
    onUpdate: (id: string, updates: Partial<LOPAScenario>) => void;
    onDelete: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(scenario);

    const recalc = (f: typeof form) => {
        if (f.ie_frequency && f.ipls.length > 0) {
            const mf = calcMitigatedFrequency(f.ie_frequency, f.ipls, f.conditional_modifiers);
            const gap = f.target_frequency ? mf - f.target_frequency : null;
            const sil = f.target_frequency ? calcRequiredSIL(mf, f.target_frequency) : null;
            return { ...f, mitigated_frequency: mf, risk_gap: gap, sil_required: sil };
        }
        return f;
    };

    const handleSave = () => {
        const calculated = recalc(form);
        onUpdate(scenario.id, calculated);
        setEditing(false);
    };

    const mitigatedFreq = scenario.mitigated_frequency;
    const silRequired = scenario.sil_required;

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50/50" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-blue-500">{scenario.scenario_number || '—'}</span>
                        <span className="text-sm font-medium text-slate-700">{scenario.description || 'Untitled Scenario'}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                        {scenario.ie_frequency != null && (
                            <span className="text-[10px] text-slate-400">IE: {scenario.ie_frequency.toExponential(1)}/yr</span>
                        )}
                        {mitigatedFreq != null && (
                            <span className="text-[10px] text-slate-400">Mitigated: <span className="font-mono font-bold text-slate-600">{mitigatedFreq.toExponential(2)}/yr</span></span>
                        )}
                        {silRequired != null && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${SIL_COLORS[silRequired] || ''}`}>
                                SIL {silRequired}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setForm(scenario); setEditing(true); setExpanded(true); }}
                        className="p-1 hover:bg-slate-100 rounded text-slate-400"><Edit3 size={14} /></button>
                    <button onClick={() => onDelete(scenario.id)}
                        className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
            </div>

            {/* Expanded content */}
            {expanded && (
                <div className="border-t border-slate-100 p-4 space-y-4">
                    {editing ? (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Scenario #</label>
                                    <input value={form.scenario_number || ''} onChange={e => setForm(f => ({ ...f, scenario_number: e.target.value }))}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="e.g. LOPA-001" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Severity Category</label>
                                    <input value={form.severity_category || ''} onChange={e => setForm(f => ({ ...f, severity_category: e.target.value }))}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="e.g. C4 - Major" />
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Scenario Description</label>
                                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 min-h-[50px]" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Initiating Event</label>
                                    <input value={form.initiating_event || ''} onChange={e => setForm(f => ({ ...f, initiating_event: e.target.value }))}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" placeholder="e.g. Pipe rupture" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">IE Frequency (events/yr)</label>
                                    <input type="number" step="0.0001" value={form.ie_frequency ?? ''} onChange={e => setForm(f => ({ ...f, ie_frequency: parseFloat(e.target.value) || null }))}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono" />
                                </div>
                            </div>
                            <IPLEditor ipls={form.ipls || []} onChange={ipls => setForm(f => ({ ...f, ipls }))} />
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Target Frequency (events/yr)</label>
                                    <input type="number" step="0.000001" value={form.target_frequency ?? ''} onChange={e => setForm(f => ({ ...f, target_frequency: parseFloat(e.target.value) || null }))}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-semibold uppercase text-slate-500 mb-1 block">Recommendations</label>
                                    <textarea value={form.recommendations || ''} onChange={e => setForm(f => ({ ...f, recommendations: e.target.value }))}
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 min-h-[40px]" />
                                </div>
                            </div>
                            {/* Live calculation preview */}
                            {form.ie_frequency && form.ipls.length > 0 && (
                                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                                    <div className="flex items-center gap-2 mb-2">
                                        <Calculator size={14} className="text-primary-500" />
                                        <span className="text-[10px] font-semibold uppercase text-slate-500">Live Calculation</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 text-xs">
                                        <div>
                                            <span className="text-slate-400">Mitigated Freq:</span>
                                            <span className="ml-1 font-mono font-bold text-slate-700">
                                                {calcMitigatedFrequency(form.ie_frequency, form.ipls, form.conditional_modifiers).toExponential(2)}/yr
                                            </span>
                                        </div>
                                        {form.target_frequency && (
                                            <>
                                                <div>
                                                    <span className="text-slate-400">Risk Gap:</span>
                                                    <span className="ml-1 font-mono font-bold text-slate-700">
                                                        {(calcMitigatedFrequency(form.ie_frequency, form.ipls, form.conditional_modifiers) - form.target_frequency).toExponential(2)}
                                                    </span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-400">Required SIL:</span>
                                                    <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${SIL_COLORS[calcRequiredSIL(
                                                        calcMitigatedFrequency(form.ie_frequency, form.ipls, form.conditional_modifiers),
                                                        form.target_frequency
                                                    )] || ''}`}>
                                                        SIL {calcRequiredSIL(
                                                            calcMitigatedFrequency(form.ie_frequency, form.ipls, form.conditional_modifiers),
                                                            form.target_frequency
                                                        )}
                                                    </span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                            <div className="flex justify-end gap-2">
                                <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
                                <button onClick={handleSave} className="text-xs px-3 py-1.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600">Save</button>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-3 text-xs">
                            {scenario.initiating_event && (
                                <div><span className="text-slate-400">Initiating Event:</span> <span className="text-slate-700">{scenario.initiating_event}</span></div>
                            )}
                            {scenario.ipls.length > 0 && (
                                <div>
                                    <span className="text-slate-400">IPLs ({scenario.ipls.length}):</span>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {scenario.ipls.map((ipl, i) => (
                                            <span key={i} className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded text-[10px]">
                                                {ipl.name || ipl.type.toUpperCase()} (PFD: {ipl.pfd})
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {scenario.recommendations && (
                                <div><span className="text-slate-400">Recommendations:</span> <span className="text-slate-600">{scenario.recommendations}</span></div>
                            )}
                            {/* Swiss Cheese Visualization */}
                            {scenario.ipls.length > 0 && (
                                <SwissCheeseModel scenario={scenario} />
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Main LOPA Worksheet
// ═══════════════════════════════════════════════════════════════

interface LOPAWorksheetProps {
    study: PSMStudy;
    onRefresh?: () => void;
}

const LOPAWorksheet: React.FC<LOPAWorksheetProps> = ({ study, onRefresh }) => {
    const [scenarios, setScenarios] = useState<LOPAScenario[]>([]);

    useEffect(() => {
        psmService.getLOPAScenarios(study.id).then(setScenarios);
    }, [study.id]);

    const handleAdd = async () => {
        const s = await psmService.createLOPAScenario({
            study_id: study.id,
            description: 'New Scenario',
            scenario_number: `LOPA-${String(scenarios.length + 1).padStart(3, '0')}`,
            ipls: [],
            conditional_modifiers: {},
            sort_order: scenarios.length,
        });
        if (s) setScenarios(prev => [...prev, s]);
    };

    const handleUpdate = async (id: string, updates: Partial<LOPAScenario>) => {
        const updated = await psmService.updateLOPAScenario(id, updates);
        if (updated) setScenarios(prev => prev.map(s => s.id === id ? updated : s));
    };

    const handleDelete = async (id: string) => {
        const ok = await psmService.deleteLOPAScenario(id);
        if (ok) setScenarios(prev => prev.filter(s => s.id !== id));
    };

    return (
        <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">{study.title}</h2>
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                            <Shield size={12} /> IEC 61511 / ISA 84 — Layer of Protection Analysis
                            <span className="text-slate-300">|</span>
                            {scenarios.length} scenarios
                        </p>
                    </div>
                    <button onClick={handleAdd}
                        className="flex items-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-primary-500 to-primary-500 px-3 py-1.5 rounded-lg hover:shadow-md transition-all">
                        <Plus size={12} /> Add Scenario
                    </button>
                </div>
            </div>

            {scenarios.map(s => (
                <ScenarioCard key={s.id} scenario={s} onUpdate={handleUpdate} onDelete={handleDelete} />
            ))}

            {scenarios.length === 0 && (
                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
                    <Target size={32} className="text-slate-300 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No LOPA scenarios. Click "Add Scenario" to begin.</p>
                    <p className="text-xs text-slate-400 mt-1">Each scenario assesses initiating events, IPLs, and calculates required SIL.</p>
                </div>
            )}
        </div>
    );
};

export default LOPAWorksheet;
