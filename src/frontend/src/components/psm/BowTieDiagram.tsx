/**
 * BowTieDiagram — CCPS / Shell Bow-Tie Methodology
 *
 * Visual barrier analysis:
 * Threats → Prevention Barriers → TOP EVENT → Mitigation Barriers → Consequences
 * With escalation factors and escalation barriers.
 */
import React, { useState, useEffect } from 'react';
import {
    Plus, Trash2, Edit3, Check, X, Shield, AlertTriangle,
    ArrowRight, ChevronDown, ChevronRight,
} from 'lucide-react';
import psmService from '../../eam/services/PSMService';
import type { PSMStudy, BowTieElement, BowTieElementType, BarrierType } from '../../types/safety';
import BowTieVisual from './diagrams/BowTieVisual';

const ELEMENT_STYLES: Record<BowTieElementType, { bg: string; border: string; text: string; label: string }> = {
    top_event:           { bg: 'bg-red-100',     border: 'border-red-400',    text: 'text-red-800',    label: 'Top Event' },
    threat:              { bg: 'bg-orange-50',   border: 'border-orange-300', text: 'text-orange-700', label: 'Threat' },
    consequence:         { bg: 'bg-blue-50',   border: 'border-blue-300', text: 'text-blue-700', label: 'Consequence' },
    prevention_barrier:  { bg: 'bg-blue-50',     border: 'border-blue-300',   text: 'text-blue-700',   label: 'Prevention Barrier' },
    mitigation_barrier:  { bg: 'bg-primary-50',     border: 'border-primary-300',   text: 'text-primary-700',   label: 'Mitigation Barrier' },
    escalation_factor:   { bg: 'bg-amber-50',    border: 'border-amber-300',  text: 'text-amber-700',  label: 'Escalation Factor' },
    escalation_barrier:  { bg: 'bg-green-50',    border: 'border-green-300',  text: 'text-green-700',  label: 'Escalation Barrier' },
};

// ═══════════════════════════════════════════════════════════════
//  Element Card
// ═══════════════════════════════════════════════════════════════

function ElementCard({ element, onUpdate, onDelete }: {
    element: BowTieElement;
    onUpdate: (id: string, updates: Partial<BowTieElement>) => void;
    onDelete: (id: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(element);
    const style = ELEMENT_STYLES[element.element_type];

    if (editing) {
        return (
            <div className={`border-2 ${style.border} ${style.bg} rounded-xl p-3 space-y-2`}>
                <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                    className="w-full text-sm font-semibold border border-slate-200 rounded px-2 py-1" placeholder="Label..." />
                <textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1 min-h-[40px]" placeholder="Description..." />
                {(element.element_type.includes('barrier')) && (
                    <div className="flex gap-2">
                        <select value={form.barrier_type || ''} onChange={e => setForm(f => ({ ...f, barrier_type: e.target.value as BarrierType }))}
                            className="text-xs border border-slate-200 rounded px-2 py-1 flex-1">
                            <option value="">Barrier type...</option>
                            <option value="hardware">Hardware</option>
                            <option value="procedural">Procedural</option>
                            <option value="human">Human</option>
                        </select>
                        <input type="number" step="0.001" value={form.pfd ?? ''} onChange={e => setForm(f => ({ ...f, pfd: parseFloat(e.target.value) || null }))}
                            className="w-20 text-xs border border-slate-200 rounded px-2 py-1 font-mono" placeholder="PFD" />
                    </div>
                )}
                <div className="flex justify-end gap-1">
                    <button onClick={() => { onUpdate(element.id, form); setEditing(false); }}
                        className="p-1 bg-emerald-100 text-emerald-600 rounded"><Check size={12} /></button>
                    <button onClick={() => setEditing(false)}
                        className="p-1 bg-red-100 text-red-500 rounded"><X size={12} /></button>
                </div>
            </div>
        );
    }

    return (
        <div className={`border-2 ${style.border} ${style.bg} rounded-xl p-3 group relative hover:shadow-md transition-shadow`}>
            <div className="flex items-center justify-between mb-1">
                <span className={`text-[9px] uppercase font-bold tracking-wider ${style.text} opacity-60`}>{style.label}</span>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setForm(element); setEditing(true); }}
                        className="p-0.5 hover:bg-white/50 rounded"><Edit3 size={10} className="text-slate-500" /></button>
                    <button onClick={() => onDelete(element.id)}
                        className="p-0.5 hover:bg-red-100 rounded"><Trash2 size={10} className="text-red-400" /></button>
                </div>
            </div>
            <p className={`text-sm font-semibold ${style.text}`}>{element.label}</p>
            {element.description && <p className="text-[10px] text-slate-500 mt-1">{element.description}</p>}
            {element.barrier_type && (
                <div className="flex items-center gap-2 mt-1">
                    <span className="text-[9px] bg-white/60 px-1.5 py-0.5 rounded text-slate-500">{element.barrier_type}</span>
                    {element.pfd != null && <span className="text-[9px] font-mono text-slate-400">PFD: {element.pfd}</span>}
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Main Bow-Tie Diagram
// ═══════════════════════════════════════════════════════════════

interface BowTieDiagramProps {
    study: PSMStudy;
    onRefresh?: () => void;
}

const BowTieDiagram: React.FC<BowTieDiagramProps> = ({ study, onRefresh }) => {
    const [elements, setElements] = useState<BowTieElement[]>([]);

    useEffect(() => {
        psmService.getBowTieElements(study.id).then(setElements);
    }, [study.id]);

    const addElement = async (type: BowTieElementType) => {
        const el = await psmService.createBowTieElement({
            study_id: study.id,
            element_type: type,
            label: `New ${ELEMENT_STYLES[type].label}`,
            sort_order: elements.filter(e => e.element_type === type).length,
        });
        if (el) setElements(prev => [...prev, el]);
    };

    const updateElement = async (id: string, updates: Partial<BowTieElement>) => {
        const updated = await psmService.updateBowTieElement(id, updates);
        if (updated) setElements(prev => prev.map(e => e.id === id ? updated : e));
    };

    const deleteElement = async (id: string) => {
        const ok = await psmService.deleteBowTieElement(id);
        if (ok) setElements(prev => prev.filter(e => e.id !== id));
    };

    const topEvent = elements.find(e => e.element_type === 'top_event');
    const threats = elements.filter(e => e.element_type === 'threat');
    const consequences = elements.filter(e => e.element_type === 'consequence');
    const preventionBarriers = elements.filter(e => e.element_type === 'prevention_barrier');
    const mitigationBarriers = elements.filter(e => e.element_type === 'mitigation_barrier');
    const escalationFactors = elements.filter(e => e.element_type === 'escalation_factor');
    const escalationBarriers = elements.filter(e => e.element_type === 'escalation_barrier');

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                <h2 className="text-lg font-bold text-slate-800">{study.title}</h2>
                <p className="text-xs text-slate-400 mt-0.5">CCPS / Shell — Bow-Tie Barrier Analysis</p>
            </div>

            {/* SVG Visualization */}
            {(topEvent || threats.length > 0 || consequences.length > 0) && (
                <BowTieVisual
                    topEvent={topEvent}
                    threats={threats}
                    consequences={consequences}
                    preventionBarriers={preventionBarriers}
                    mitigationBarriers={mitigationBarriers}
                    escalationFactors={escalationFactors}
                />
            )}

            {/* Bow-Tie Layout (editable cards) */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm overflow-x-auto">
                <div className="min-w-[900px]">
                    {/* Row labels + layout */}
                    <div className="grid grid-cols-[200px_150px_1fr_150px_200px] gap-3 items-start">
                        {/* Threats Column */}
                        <div className="space-y-2">
                            <div className="text-[10px] font-bold uppercase text-orange-500 tracking-wider text-center mb-2">Threats</div>
                            {threats.map(t => <ElementCard key={t.id} element={t} onUpdate={updateElement} onDelete={deleteElement} />)}
                            <button onClick={() => addElement('threat')}
                                className="w-full text-xs text-orange-500 hover:bg-orange-50 border border-dashed border-orange-300 rounded-lg py-2 flex items-center justify-center gap-1">
                                <Plus size={12} /> Threat
                            </button>
                        </div>

                        {/* Prevention Barriers */}
                        <div className="space-y-2">
                            <div className="text-[10px] font-bold uppercase text-blue-500 tracking-wider text-center mb-2">Prevention</div>
                            {preventionBarriers.map(b => <ElementCard key={b.id} element={b} onUpdate={updateElement} onDelete={deleteElement} />)}
                            <button onClick={() => addElement('prevention_barrier')}
                                className="w-full text-xs text-blue-500 hover:bg-blue-50 border border-dashed border-blue-300 rounded-lg py-2 flex items-center justify-center gap-1">
                                <Plus size={12} /> Barrier
                            </button>
                        </div>

                        {/* Top Event (center) */}
                        <div className="flex flex-col items-center justify-center">
                            <div className="text-[10px] font-bold uppercase text-red-500 tracking-wider mb-2">Top Event</div>
                            {topEvent ? (
                                <ElementCard element={topEvent} onUpdate={updateElement} onDelete={deleteElement} />
                            ) : (
                                <button onClick={() => addElement('top_event')}
                                    className="w-full text-xs text-red-500 hover:bg-red-50 border-2 border-dashed border-red-300 rounded-xl py-6 flex items-center justify-center gap-1 font-medium">
                                    <AlertTriangle size={16} /> Set Top Event
                                </button>
                            )}
                            {/* Escalation factors */}
                            {(escalationFactors.length > 0 || escalationBarriers.length > 0) && (
                                <div className="mt-4 space-y-2 w-full">
                                    <div className="text-[9px] font-bold uppercase text-amber-500 tracking-wider text-center">Escalation</div>
                                    {escalationFactors.map(ef => <ElementCard key={ef.id} element={ef} onUpdate={updateElement} onDelete={deleteElement} />)}
                                    {escalationBarriers.map(eb => <ElementCard key={eb.id} element={eb} onUpdate={updateElement} onDelete={deleteElement} />)}
                                </div>
                            )}
                            <div className="flex gap-1 mt-2">
                                <button onClick={() => addElement('escalation_factor')}
                                    className="text-[10px] text-amber-500 hover:bg-amber-50 px-2 py-1 rounded border border-dashed border-amber-300">+ Esc. Factor</button>
                                <button onClick={() => addElement('escalation_barrier')}
                                    className="text-[10px] text-green-500 hover:bg-green-50 px-2 py-1 rounded border border-dashed border-green-300">+ Esc. Barrier</button>
                            </div>
                        </div>

                        {/* Mitigation Barriers */}
                        <div className="space-y-2">
                            <div className="text-[10px] font-bold uppercase text-primary-500 tracking-wider text-center mb-2">Mitigation</div>
                            {mitigationBarriers.map(b => <ElementCard key={b.id} element={b} onUpdate={updateElement} onDelete={deleteElement} />)}
                            <button onClick={() => addElement('mitigation_barrier')}
                                className="w-full text-xs text-primary-500 hover:bg-primary-50 border border-dashed border-primary-300 rounded-lg py-2 flex items-center justify-center gap-1">
                                <Plus size={12} /> Barrier
                            </button>
                        </div>

                        {/* Consequences */}
                        <div className="space-y-2">
                            <div className="text-[10px] font-bold uppercase text-blue-500 tracking-wider text-center mb-2">Consequences</div>
                            {consequences.map(c => <ElementCard key={c.id} element={c} onUpdate={updateElement} onDelete={deleteElement} />)}
                            <button onClick={() => addElement('consequence')}
                                className="w-full text-xs text-blue-500 hover:bg-blue-50 border border-dashed border-blue-300 rounded-lg py-2 flex items-center justify-center gap-1">
                                <Plus size={12} /> Consequence
                            </button>
                        </div>
                    </div>

                    {/* Flow arrows */}
                    <div className="flex items-center justify-center gap-2 mt-4 text-slate-300">
                        <span className="text-xs">Threats</span>
                        <ArrowRight size={16} />
                        <span className="text-xs">Prevention</span>
                        <ArrowRight size={16} />
                        <span className="text-xs font-bold text-red-400">TOP EVENT</span>
                        <ArrowRight size={16} />
                        <span className="text-xs">Mitigation</span>
                        <ArrowRight size={16} />
                        <span className="text-xs">Consequences</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BowTieDiagram;
