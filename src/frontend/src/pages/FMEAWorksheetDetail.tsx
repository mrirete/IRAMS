import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Save, Plus, Trash2, ShieldAlert, AlertTriangle, Sparkles,
    Download, ChevronUp, ChevronDown, Loader2, Check, FileText, Target, X,
} from 'lucide-react';
import analyzeService from '../eam/services/AnalyzeService';
import type { FMEAWorksheet, FMEAItem } from '../eam/services/AnalyzeService';
import { supabase } from '../eam/lib/supabase';
import { DatabaseService } from '../eam/services/DatabaseService';
import { MOCK_DICTIONARIES } from '../eam/constants';
import type { DictionaryEntry } from '../eam/types';

// ── Helpers ──────────────────────────────────────────────────
const STATUS_WORKFLOW: FMEAWorksheet['status'][] = ['draft', 'active', 'review', 'closed'];

// Group label mapping for failure mode asset classes (ISO 14224)
const FM_GROUP_LABELS: Record<string, string> = {
    'ROTATING': '⚙️ Rotating Equipment',
    'STATIC_PRESSURE': '🏗️ Static / Pressure Vessels',
    'ELECTRICAL': '⚡ Electrical',
    'INSTRUMENT': '📊 Instrumentation',
    'PIPING': '🔩 Piping',
    'SAFETY_SYSTEM': '🛡️ Safety Systems',
    'HEAT_TRANSFER': '🌡️ Heat Transfer',
    'STRUCTURAL': '🏛️ Structural / Civil',
};

// ── SearchableSelect (Grouped dropdown for ISO 14224 failure codes) ────
const FMEASearchableSelect: React.FC<{
    value: string;
    onChange: (val: string) => void;
    options: { id: string; code: string; description: string; categoryRef?: string }[];
    placeholder: string;
    groupKey?: string;
}> = ({ value, onChange, options, placeholder, groupKey }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const [highlightIdx, setHighlightIdx] = useState(-1);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearch('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const filtered = options.filter(o => {
        if (!search) return true;
        const q = search.toLowerCase();
        return o.code.toLowerCase().includes(q) || o.description.toLowerCase().includes(q);
    });

    const renderItems = useMemo(() => {
        if (!groupKey) return filtered.map(o => ({ type: 'item' as const, option: o }));
        const general = filtered.filter(o => !(o as any)[groupKey]);
        const grouped = new Map<string, typeof filtered>();
        filtered.forEach(o => {
            const gv = (o as any)[groupKey];
            if (!gv) return;
            if (!grouped.has(gv)) grouped.set(gv, []);
            grouped.get(gv)!.push(o);
        });
        const items: { type: 'header' | 'item'; label?: string; option?: typeof filtered[0] }[] = [];
        if (general.length > 0) {
            items.push({ type: 'header', label: '🔧 General (All Assets)' });
            general.forEach(o => items.push({ type: 'item', option: o }));
        }
        grouped.forEach((opts, key) => {
            items.push({ type: 'header', label: FM_GROUP_LABELS[key] || key });
            opts.forEach(o => items.push({ type: 'item', option: o }));
        });
        return items;
    }, [filtered, groupKey]);

    const selectableItems = renderItems.filter(i => i.type === 'item');
    useEffect(() => { setHighlightIdx(-1); }, [filtered.length, search]);

    useEffect(() => {
        if (highlightIdx >= 0 && listRef.current) {
            let domIdx = 0, selIdx = 0;
            for (const item of renderItems) {
                if (item.type === 'item') { if (selIdx === highlightIdx) break; selIdx++; }
                domIdx++;
            }
            const el = listRef.current.children[domIdx] as HTMLElement;
            el?.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightIdx, renderItems]);

    const select = (code: string) => { onChange(code); setIsOpen(false); setSearch(''); };
    const selectedLabel = value
        ? (() => { const o = options.find(o => o.code === value); return o ? `${o.code} - ${o.description}` : value; })()
        : '';

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) { if (e.key === 'ArrowDown' || e.key === 'Enter') { setIsOpen(true); e.preventDefault(); } return; }
        if (e.key === 'ArrowDown') { setHighlightIdx(i => Math.min(i + 1, selectableItems.length - 1)); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { setHighlightIdx(i => Math.max(i - 1, 0)); e.preventDefault(); }
        else if (e.key === 'Enter' && highlightIdx >= 0 && selectableItems[highlightIdx]?.option) { select(selectableItems[highlightIdx].option!.code); e.preventDefault(); }
        else if (e.key === 'Escape') { setIsOpen(false); setSearch(''); }
    };

    return (
        <div ref={containerRef} className="relative">
            <div
                className={`w-full p-1.5 border rounded text-xs bg-white flex items-center gap-1 cursor-pointer transition-colors ${isOpen ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-300 hover:border-slate-400'}`}
                onClick={() => { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            >
                {isOpen ? (
                    <input ref={inputRef} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={handleKeyDown}
                        className="flex-1 outline-none bg-transparent text-xs placeholder:text-slate-400" placeholder="Search..." autoFocus />
                ) : (
                    <span className={`flex-1 truncate ${selectedLabel ? 'text-slate-800' : 'text-slate-400'}`}>
                        {selectedLabel || placeholder}
                    </span>
                )}
                <ChevronDown size={12} className={`text-slate-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
            {isOpen && (
                <ul ref={listRef} className="absolute z-50 left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-xs">
                    {value && (
                        <li className="px-3 py-1.5 text-slate-400 hover:bg-slate-50 cursor-pointer border-b border-slate-100 italic"
                            onClick={() => select('')}>Clear selection</li>
                    )}
                    {selectableItems.length === 0 ? (
                        <li className="px-3 py-3 text-center text-slate-400 italic">No results for "{search}"</li>
                    ) : (
                        renderItems.map((item, idx) => {
                            if (item.type === 'header') {
                                return (
                                    <li key={`hdr-${idx}`} className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase bg-slate-50 border-y border-slate-100 tracking-wide select-none sticky top-0">
                                        {item.label}
                                    </li>
                                );
                            }
                            const o = item.option!;
                            const selIdx = selectableItems.indexOf(item);
                            return (
                                <li key={o.id}
                                    className={`px-3 py-1.5 cursor-pointer transition-colors ${o.code === value ? 'bg-blue-50 text-blue-700 font-semibold' : ''} ${selIdx === highlightIdx ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                    onClick={() => select(o.code)} onMouseEnter={() => setHighlightIdx(selIdx)}
                                >
                                    <span className="font-medium">{o.code}</span>
                                    <span className="text-slate-500"> — {o.description}</span>
                                </li>
                            );
                        })
                    )}
                </ul>
            )}
        </div>
    );
};
const STATUS_COLORS: Record<string, string> = {
    draft: 'bg-slate-100/50 text-brand-300 border-slate-300',
    active: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    review: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    closed: 'bg-green-500/10 text-green-400 border-green-500/20',
};

function rpnColor(rpn: number): string {
    if (rpn >= 200) return 'text-red-400 bg-red-500/10 border-red-500/20';
    if (rpn >= 100) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-green-400 bg-green-500/10 border-green-500/20';
}

function rpnBg(rpn: number): string {
    if (rpn >= 200) return 'bg-red-500/5';
    if (rpn >= 100) return 'bg-amber-500/5';
    return '';
}

const EMPTY_ITEM = {
    component: '',
    function: '',
    failure_mode: '',
    failure_effect: '',
    failure_cause: '',
    severity: 5,
    occurrence: 5,
    detection: 5,
    current_controls: '',
    recommended_action: '',
    action_status: 'open' as const,
};

// ── Component ────────────────────────────────────────────────
const FMEAWorksheetDetail: React.FC = () => {
    const { worksheetId } = useParams<{ worksheetId: string }>();
    const navigate = useNavigate();

    // State
    const [worksheet, setWorksheet] = useState<FMEAWorksheet | null>(null);
    const [items, setItems] = useState<FMEAItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<FMEAItem>>({});
    const [showAddRow, setShowAddRow] = useState(false);
    const [newItem, setNewItem] = useState({ ...EMPTY_ITEM });
    const [assetName, setAssetName] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([]);

    // DE Task creation from FMEA row
    const [deModalItem, setDeModalItem] = useState<FMEAItem | null>(null);
    const [deForm, setDeForm] = useState({
        title: '', rootCauseSummary: '', proposedSolution: '',
        priority: 'high' as 'critical' | 'high' | 'medium' | 'low',
        annualCost: 0, estimatedSavings: 0, implementationCost: 0, paybackMonths: 6,
    });
    const [deCreating, setDeCreating] = useState(false);

    // Derived: failure modes & causes from reference_codes
    const failureModes = useMemo(() => dictionaries.filter(d => d.type === 'FAILURE_MODE' && d.active), [dictionaries]);
    const failureCauses = useMemo(() => dictionaries.filter(d => d.type === 'FAILURE_CAUSE' && d.active), [dictionaries]);

    // ── Fetch ─────────────────────────────────────────────────
    const fetchData = useCallback(async () => {
        if (!worksheetId) return;
        setLoading(true);
        try {
            // Fetch all worksheets and find ours
            const worksheets = await analyzeService.getFMEAWorksheets();
            const ws = worksheets.find(w => w.id === worksheetId) || null;
            setWorksheet(ws);

            // Fetch items
            const itemsData = await analyzeService.getFMEAItems(worksheetId);
            setItems(itemsData);

            // Fetch asset name
            if (ws?.asset_id) {
                const { data } = await supabase.from('assets').select('tag, name').eq('id', ws.asset_id).single();
                if (data) setAssetName(`${data.tag} — ${data.name}`);
            }
        } catch (e) {
            console.error('[FMEADetail] fetch error:', e);
        } finally {
            setLoading(false);
        }
    }, [worksheetId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Load dictionaries (failure modes / causes) from Supabase reference_codes
    useEffect(() => {
        (async () => {
            try {
                const dbDicts = await DatabaseService.getInstance().getDictionaries();
                setDictionaries(dbDicts.length > 0 ? dbDicts : MOCK_DICTIONARIES);
            } catch (e) {
                console.warn('[FMEADetail] Dict load fallback to mock:', e);
                setDictionaries(MOCK_DICTIONARIES);
            }
        })();
    }, []);

    // ── RPN Stats ─────────────────────────────────────────────
    const stats = useMemo(() => {
        const rpns = items.map(i => (i.severity || 1) * (i.occurrence || 1) * (i.detection || 1));
        return {
            count: items.length,
            maxRpn: rpns.length > 0 ? Math.max(...rpns) : 0,
            avgRpn: rpns.length > 0 ? Math.round(rpns.reduce((a, b) => a + b, 0) / rpns.length) : 0,
            highRisk: rpns.filter(r => r >= 200).length,
            medRisk: rpns.filter(r => r >= 100 && r < 200).length,
        };
    }, [items]);

    // ── Inline editing ────────────────────────────────────────
    const startEdit = (item: FMEAItem) => {
        setEditingItemId(item.id);
        setEditForm({ ...item });
    };

    const cancelEdit = () => {
        setEditingItemId(null);
        setEditForm({});
    };

    const saveEdit = async () => {
        if (!editingItemId) return;
        setSaving(true);
        try {
            await analyzeService.updateFMEAItem(editingItemId, editForm);
            await refreshWorksheetStats();
            await fetchData();
            setEditingItemId(null);
            showSuccess('Item updated');
        } catch (e) {
            console.error('[FMEADetail] save error:', e);
        } finally {
            setSaving(false);
        }
    };

    // ── Add item ──────────────────────────────────────────────
    const addItem = async () => {
        if (!worksheetId || !newItem.component || !newItem.failure_mode) return;
        setSaving(true);
        try {
            await analyzeService.createFMEAItem({
                worksheet_id: worksheetId,
                component: newItem.component,
                function: newItem.function,
                failure_mode: newItem.failure_mode,
                failure_effect: newItem.failure_effect || null,
                failure_cause: newItem.failure_cause || null,
                severity: newItem.severity,
                occurrence: newItem.occurrence,
                detection: newItem.detection,
                current_controls: newItem.current_controls || null,
                recommended_action: newItem.recommended_action || null,
                action_status: newItem.action_status,
            });
            await refreshWorksheetStats();
            await fetchData();
            setNewItem({ ...EMPTY_ITEM });
            setShowAddRow(false);
            showSuccess('Item added');
        } catch (e) {
            console.error('[FMEADetail] add error:', e);
        } finally {
            setSaving(false);
        }
    };

    // ── Delete item ───────────────────────────────────────────
    const deleteItem = async (id: string) => {
        setSaving(true);
        try {
            await analyzeService.deleteFMEAItem(id);
            await refreshWorksheetStats();
            await fetchData();
            showSuccess('Item deleted');
        } catch (e) {
            console.error('[FMEADetail] delete error:', e);
        } finally {
            setSaving(false);
        }
    };

    // ── Status change ─────────────────────────────────────────
    const changeStatus = async (status: FMEAWorksheet['status']) => {
        if (!worksheetId || !status) return;
        setSaving(true);
        try {
            await analyzeService.updateFMEAWorksheet(worksheetId, { status });
            await fetchData();
            showSuccess(`Status → ${status}`);
        } catch (e) {
            console.error('[FMEADetail] status change error:', e);
        } finally {
            setSaving(false);
        }
    };

    // ── Refresh worksheet aggregate stats ─────────────────────
    const refreshWorksheetStats = async () => {
        if (!worksheetId) return;
        const freshItems = await analyzeService.getFMEAItems(worksheetId);
        const rpns = freshItems.map(i => (i.severity || 1) * (i.occurrence || 1) * (i.detection || 1));
        await analyzeService.updateFMEAWorksheet(worksheetId, {
            max_rpn: rpns.length > 0 ? Math.max(...rpns) : 0,
            avg_rpn: rpns.length > 0 ? Math.round(rpns.reduce((a, b) => a + b, 0) / rpns.length) : 0,
            high_risk_count: rpns.filter(r => r >= 200).length,
        } as Partial<FMEAWorksheet>);
    };

    // ── Export CSV ─────────────────────────────────────────────
    const exportCSV = () => {
        const headers = 'Component,Function,Failure Mode,Failure Cause,Failure Effect,S,O,D,RPN,Controls,Recommended Action,Status';
        const rows = items.map(i =>
            `"${i.component}","${i.function}","${i.failure_mode}","${i.failure_cause || ''}","${i.failure_effect || ''}",${i.severity},${i.occurrence},${i.detection},${(i.severity || 1) * (i.occurrence || 1) * (i.detection || 1)},"${i.current_controls || ''}","${i.recommended_action || ''}","${i.action_status}"`
        );
        const csv = [headers, ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `FMEA_${worksheet?.title || 'worksheet'}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const showSuccess = (msg: string) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(''), 2000);
    };

    // ── Open DE modal from FMEA item ──────────────────────────
    const openDEFromItem = (item: FMEAItem) => {
        const rpn = (item.severity || 1) * (item.occurrence || 1) * (item.detection || 1);
        const fmLabel = failureModes.find(f => f.code === item.failure_mode);
        const fcLabel = failureCauses.find(f => f.code === item.failure_cause);
        setDeForm({
            title: `DE: ${item.component} — ${item.failure_mode}${fmLabel ? ` (${fmLabel.description})` : ''}`,
            rootCauseSummary: `FMEA-identified failure mode on component "${item.component}".\n\nFailure Mode: ${item.failure_mode}${fmLabel ? ` — ${fmLabel.description}` : ''}\nFailure Cause: ${item.failure_cause || 'N/A'}${fcLabel ? ` — ${fcLabel.description}` : ''}\nFailure Effect: ${item.failure_effect || 'N/A'}\nRPN: ${rpn} (S=${item.severity} × O=${item.occurrence} × D=${item.detection})`,
            proposedSolution: item.recommended_action || '',
            priority: rpn >= 200 ? 'critical' : rpn >= 100 ? 'high' : 'medium',
            annualCost: 0, estimatedSavings: 0, implementationCost: 0, paybackMonths: 6,
        });
        setDeModalItem(item);
    };

    const handleCreateDEFromFMEA = async () => {
        if (!deModalItem || !worksheet) return;
        setDeCreating(true);
        try {
            const result = await analyzeService.createDETask({
                asset_id: worksheet.asset_id || null,
                asset_name: assetName || worksheet.asset_id || 'Unknown Asset',
                title: deForm.title,
                status: 'identified',
                priority: deForm.priority,
                annual_cost: deForm.annualCost,
                estimated_savings: deForm.estimatedSavings,
                implementation_cost: deForm.implementationCost,
                payback_months: deForm.paybackMonths,
                root_cause_summary: deForm.rootCauseSummary,
                proposed_solution: deForm.proposedSolution,
                rca_id: null,
                created_by: null,
            });
            if (result) {
                showSuccess(`DE Task created: ${result.title}`);
                setDeModalItem(null);
            }
        } catch (e) {
            console.error('[FMEA→DE] Error creating DE task:', e);
        } finally {
            setDeCreating(false);
        }
    };

    // ── Loading ───────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="animate-spin text-accent-cyan mr-3" size={24} />
                <span className="text-slate-500">Loading FMEA worksheet…</span>
            </div>
        );
    }

    if (!worksheet) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
                <ShieldAlert className="text-slate-400" size={48} />
                <p className="text-slate-500">Worksheet not found.</p>
                <button onClick={() => navigate('/analyze')} className="text-accent-cyan text-sm hover:underline">← Back to Analyze</button>
            </div>
        );
    }

    const currentStatusIndex = STATUS_WORKFLOW.indexOf(worksheet.status);
    const nextStatus = currentStatusIndex < STATUS_WORKFLOW.length - 1 ? STATUS_WORKFLOW[currentStatusIndex + 1] : null;

    return (
        <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
            {/* ── Header ──────────────────────────────────────── */}
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate('/analyze')} className="p-2 bg-brand-800 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 hover:text-brand-200">
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-xl font-bold text-slate-800">{worksheet.title || 'Untitled FMEA'}</h1>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${STATUS_COLORS[worksheet.status || 'draft']}`}>
                                {(worksheet.status || 'draft').replace('_', ' ')}
                            </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                            Type: <span className="uppercase text-slate-500">{worksheet.fmea_type || 'equipment'}</span>
                            {assetName && <> · Asset: <span className="text-slate-500">{assetName}</span></>}
                            · Created: {new Date(worksheet.created_at).toLocaleDateString()}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {successMsg && (
                        <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-3 py-1.5 rounded-lg border border-green-500/20 animate-in fade-in duration-200">
                            <Check size={12} /> {successMsg}
                        </span>
                    )}
                    <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 bg-brand-800 text-brand-300 hover:text-slate-800 border border-slate-200 rounded-lg text-xs font-medium transition-colors">
                        <Download size={14} /> Export CSV
                    </button>
                    {nextStatus && (
                        <button onClick={() => changeStatus(nextStatus)} disabled={saving}
                            className="flex items-center gap-1.5 px-4 py-2 bg-accent-cyan text-brand-900 rounded-lg text-xs font-bold hover:bg-cyan-400 transition-colors disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="animate-spin" size={14} /> : <FileText size={14} />}
                            Advance to {nextStatus}
                        </button>
                    )}
                </div>
            </div>

            {/* ── Status Progress ──────────────────────────────── */}
            <div className="flex items-center gap-1">
                {STATUS_WORKFLOW.map((s, i) => (
                    <React.Fragment key={s}>
                        <button
                            onClick={() => s && changeStatus(s)}
                            disabled={saving}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${i <= currentStatusIndex
                                ? 'bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30'
                                : 'bg-brand-800 text-slate-400 border-slate-200 hover:border-slate-300'
                                }`}
                        >{s}</button>
                        {i < STATUS_WORKFLOW.length - 1 && (
                            <div className={`h-0.5 w-6 rounded ${i < currentStatusIndex ? 'bg-accent-cyan/40' : 'bg-slate-100'}`} />
                        )}
                    </React.Fragment>
                ))}
            </div>

            {/* ── Summary Cards ────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Items</p>
                    <p className="text-2xl font-bold text-slate-800 mt-1">{stats.count}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Max RPN</p>
                    <p className={`text-2xl font-bold mt-1 ${stats.maxRpn >= 200 ? 'text-red-400' : stats.maxRpn >= 100 ? 'text-amber-400' : 'text-green-400'}`}>{stats.maxRpn}</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 text-center">
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Avg RPN</p>
                    <p className="text-2xl font-bold text-accent-cyan mt-1">{stats.avgRpn}</p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
                    <p className="text-[10px] text-red-400 uppercase tracking-wider font-semibold">High Risk</p>
                    <p className="text-2xl font-bold text-red-400 mt-1">{stats.highRisk}</p>
                </div>
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-center">
                    <p className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold">Medium Risk</p>
                    <p className="text-2xl font-bold text-amber-400 mt-1">{stats.medRisk}</p>
                </div>
            </div>

            {/* ── FMEA Items Table ─────────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <ShieldAlert className="text-yellow-500" size={18} />
                        <h3 className="text-sm font-semibold text-slate-800">Failure Modes & Effects</h3>
                    </div>
                    <button
                        onClick={() => setShowAddRow(!showAddRow)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 rounded-lg text-xs font-medium transition-colors"
                    >
                        {showAddRow ? <ChevronUp size={14} /> : <Plus size={14} />}
                        {showAddRow ? 'Cancel' : 'Add Item'}
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 text-slate-500 text-[10px] uppercase tracking-wider">
                                <th className="px-3 py-3 text-left">Component</th>
                                <th className="px-3 py-3 text-left">Function</th>
                                <th className="px-3 py-3 text-left">Failure Mode</th>
                                <th className="px-3 py-3 text-left">Failure Cause</th>
                                <th className="px-3 py-3 text-left">Failure Effect</th>
                                <th className="px-2 py-3 text-center w-12" title="Severity">S</th>
                                <th className="px-2 py-3 text-center w-12" title="Occurrence">O</th>
                                <th className="px-2 py-3 text-center w-12" title="Detection">D</th>
                                <th className="px-3 py-3 text-center w-16">RPN</th>
                                <th className="px-3 py-3 text-left">Controls</th>
                                <th className="px-3 py-3 text-left">Recommended Action</th>
                                <th className="px-3 py-3 text-center w-16">Status</th>
                                <th className="px-2 py-3 text-center w-20">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* ── Add Row ─────────── */}
                            {showAddRow && (
                                <tr className="border-b border-accent-cyan/20 bg-accent-cyan/5">
                                    <td className="px-2 py-2"><input value={newItem.component} onChange={e => setNewItem(p => ({ ...p, component: e.target.value }))} placeholder="Component" className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                    <td className="px-2 py-2"><input value={newItem.function} onChange={e => setNewItem(p => ({ ...p, function: e.target.value }))} placeholder="Function" className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                    <td className="px-2 py-2">
                                        <FMEASearchableSelect
                                            value={newItem.failure_mode}
                                            onChange={val => setNewItem(p => ({ ...p, failure_mode: val }))}
                                            options={failureModes}
                                            placeholder="-- Select Mode --"
                                            groupKey="categoryRef"
                                        />
                                    </td>
                                    <td className="px-2 py-2">
                                        {failureCauses.length > 0 ? (
                                            <select value={newItem.failure_cause} onChange={e => setNewItem(p => ({ ...p, failure_cause: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500">
                                                <option value="">— Select Cause —</option>
                                                {failureCauses.map(fc => <option key={fc.code} value={fc.code}>{fc.code} — {fc.description}</option>)}
                                            </select>
                                        ) : (
                                            <input value={newItem.failure_cause} onChange={e => setNewItem(p => ({ ...p, failure_cause: e.target.value }))} placeholder="Cause" className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" />
                                        )}
                                    </td>
                                    <td className="px-2 py-2"><input value={newItem.failure_effect} onChange={e => setNewItem(p => ({ ...p, failure_effect: e.target.value }))} placeholder="Effect" className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                    <td className="px-1 py-2"><input type="number" min={1} max={10} value={newItem.severity} onChange={e => setNewItem(p => ({ ...p, severity: +e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-1 py-1.5 text-xs text-center text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                    <td className="px-1 py-2"><input type="number" min={1} max={10} value={newItem.occurrence} onChange={e => setNewItem(p => ({ ...p, occurrence: +e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-1 py-1.5 text-xs text-center text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                    <td className="px-1 py-2"><input type="number" min={1} max={10} value={newItem.detection} onChange={e => setNewItem(p => ({ ...p, detection: +e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-1 py-1.5 text-xs text-center text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                    <td className="px-2 py-2 text-center">
                                        <span className={`inline-flex px-2 py-1 rounded text-xs font-bold border ${rpnColor(newItem.severity * newItem.occurrence * newItem.detection)}`}>
                                            {newItem.severity * newItem.occurrence * newItem.detection}
                                        </span>
                                    </td>
                                    <td className="px-2 py-2"><input value={newItem.current_controls} onChange={e => setNewItem(p => ({ ...p, current_controls: e.target.value }))} placeholder="Controls" className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                    <td className="px-2 py-2"><input value={newItem.recommended_action} onChange={e => setNewItem(p => ({ ...p, recommended_action: e.target.value }))} placeholder="Action" className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                    <td className="px-2 py-2">
                                        <select value={newItem.action_status} onChange={e => setNewItem(p => ({ ...p, action_status: e.target.value as any }))} className="w-full bg-slate-50 border border-slate-300 rounded px-1 py-1.5 text-[10px] text-brand-200 focus:outline-none focus:border-relantern-500">
                                            <option value="open">Open</option>
                                            <option value="in_progress">In Progress</option>
                                            <option value="closed">Closed</option>
                                            <option value="deferred">Deferred</option>
                                        </select>
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                        <button onClick={addItem} disabled={saving || !newItem.component || !newItem.failure_mode}
                                            className="p-1.5 bg-accent-cyan text-brand-900 rounded hover:bg-cyan-400 disabled:opacity-50 transition-colors"
                                        ><Save size={14} /></button>
                                    </td>
                                </tr>
                            )}

                            {/* ── Existing Items ───── */}
                            {items.length === 0 && !showAddRow ? (
                                <tr>
                                    <td colSpan={13} className="py-16 text-center">
                                        <AlertTriangle className="mx-auto mb-3 text-slate-400 opacity-40" size={32} />
                                        <p className="text-slate-400 text-sm mb-3">No failure modes added yet.</p>
                                        <button onClick={() => setShowAddRow(true)} className="inline-flex items-center gap-1.5 px-4 py-2 bg-accent-cyan text-brand-900 rounded-lg text-xs font-bold hover:bg-cyan-400 transition-colors">
                                            <Plus size={14} /> Add First Item
                                        </button>
                                    </td>
                                </tr>
                            ) : items.map(item => {
                                const itemRpn = (item.severity || 1) * (item.occurrence || 1) * (item.detection || 1);
                                const isEditing = editingItemId === item.id;

                                return (
                                    <tr key={item.id} className={`group border-b border-slate-200/50 hover:bg-slate-50 transition-colors ${rpnBg(itemRpn)} ${isEditing ? 'ring-1 ring-accent-cyan/30' : ''}`}>
                                        {isEditing ? (
                                            <>
                                                <td className="px-2 py-2"><input value={editForm.component || ''} onChange={e => setEditForm(p => ({ ...p, component: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                                <td className="px-2 py-2"><input value={editForm.function || ''} onChange={e => setEditForm(p => ({ ...p, function: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                                <td className="px-2 py-2">
                                                    <FMEASearchableSelect
                                                        value={editForm.failure_mode || ''}
                                                        onChange={val => setEditForm(p => ({ ...p, failure_mode: val }))}
                                                        options={failureModes}
                                                        placeholder="-- Select Mode --"
                                                        groupKey="categoryRef"
                                                    />
                                                </td>
                                                <td className="px-2 py-2">
                                                    {failureCauses.length > 0 ? (
                                                        <select value={editForm.failure_cause || ''} onChange={e => setEditForm(p => ({ ...p, failure_cause: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500">
                                                            <option value="">— Select Cause —</option>
                                                            {failureCauses.map(fc => <option key={fc.code} value={fc.code}>{fc.code} — {fc.description}</option>)}
                                                        </select>
                                                    ) : (
                                                        <input value={editForm.failure_cause || ''} onChange={e => setEditForm(p => ({ ...p, failure_cause: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" />
                                                    )}
                                                </td>
                                                <td className="px-2 py-2"><input value={editForm.failure_effect || ''} onChange={e => setEditForm(p => ({ ...p, failure_effect: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                                <td className="px-1 py-2"><input type="number" min={1} max={10} value={editForm.severity || 1} onChange={e => setEditForm(p => ({ ...p, severity: +e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-1 py-1.5 text-xs text-center text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                                <td className="px-1 py-2"><input type="number" min={1} max={10} value={editForm.occurrence || 1} onChange={e => setEditForm(p => ({ ...p, occurrence: +e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-1 py-1.5 text-xs text-center text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                                <td className="px-1 py-2"><input type="number" min={1} max={10} value={editForm.detection || 1} onChange={e => setEditForm(p => ({ ...p, detection: +e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-1 py-1.5 text-xs text-center text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                                <td className="px-2 py-2 text-center">
                                                    <span className={`inline-flex px-2 py-1 rounded text-xs font-bold border ${rpnColor((editForm.severity || 1) * (editForm.occurrence || 1) * (editForm.detection || 1))}`}>
                                                        {(editForm.severity || 1) * (editForm.occurrence || 1) * (editForm.detection || 1)}
                                                    </span>
                                                </td>
                                                <td className="px-2 py-2"><input value={editForm.current_controls || ''} onChange={e => setEditForm(p => ({ ...p, current_controls: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                                <td className="px-2 py-2"><input value={editForm.recommended_action || ''} onChange={e => setEditForm(p => ({ ...p, recommended_action: e.target.value }))} className="w-full bg-slate-50 border border-slate-300 rounded px-2 py-1.5 text-xs text-brand-200 focus:outline-none focus:border-relantern-500" /></td>
                                                <td className="px-2 py-2">
                                                    <select value={editForm.action_status || 'open'} onChange={e => setEditForm(p => ({ ...p, action_status: e.target.value as any }))} className="w-full bg-slate-50 border border-slate-300 rounded px-1 py-1.5 text-[10px] text-brand-200 focus:outline-none focus:border-relantern-500">
                                                        <option value="open">Open</option>
                                                        <option value="in_progress">In Progress</option>
                                                        <option value="closed">Closed</option>
                                                        <option value="deferred">Deferred</option>
                                                    </select>
                                                </td>
                                                <td className="px-2 py-2">
                                                    <div className="flex items-center gap-1 justify-center">
                                                        <button onClick={saveEdit} disabled={saving} className="p-1 bg-accent-cyan text-brand-900 rounded hover:bg-cyan-400 disabled:opacity-50"><Save size={12} /></button>
                                                        <button onClick={cancelEdit} className="p-1 bg-slate-100 text-slate-500 rounded hover:bg-brand-600 text-xs">✕</button>
                                                    </div>
                                                </td>
                                            </>
                                        ) : (
                                            <>
                                                <td className="px-3 py-3 text-brand-200 font-medium text-xs">{item.component}</td>
                                                <td className="px-3 py-3 text-brand-300 text-xs">{item.function}</td>
                                                <td className="px-3 py-3 text-brand-200 text-xs font-medium" title={(() => { const fm = failureModes.find(f => f.code === item.failure_mode); return fm ? fm.description : ''; })()}>
                                                    {item.failure_mode}
                                                    {(() => { const fm = failureModes.find(f => f.code === item.failure_mode); return fm ? <span className="text-slate-400 font-normal ml-1">— {fm.description}</span> : null; })()}
                                                </td>
                                                <td className="px-3 py-3 text-slate-500 text-xs">
                                                    {item.failure_cause
                                                        ? (() => { const fc = failureCauses.find(f => f.code === item.failure_cause); return fc ? `${item.failure_cause} — ${fc.description}` : item.failure_cause; })()
                                                        : '—'}
                                                </td>
                                                <td className="px-3 py-3 text-slate-500 text-xs">{item.failure_effect || '—'}</td>
                                                <td className="px-2 py-3 text-center text-brand-300 font-mono text-xs">{item.severity}</td>
                                                <td className="px-2 py-3 text-center text-brand-300 font-mono text-xs">{item.occurrence}</td>
                                                <td className="px-2 py-3 text-center text-brand-300 font-mono text-xs">{item.detection}</td>
                                                <td className="px-2 py-3 text-center">
                                                    <span className={`inline-flex px-2 py-1 rounded text-xs font-bold border ${rpnColor(itemRpn)}`}>{itemRpn}</span>
                                                </td>
                                                <td className="px-3 py-3 text-slate-500 text-xs max-w-[120px] truncate">{item.current_controls || '—'}</td>
                                                <td className="px-3 py-3 text-accent-cyan text-xs max-w-[120px] truncate">{item.recommended_action || '—'}</td>
                                                <td className="px-2 py-3 text-center">
                                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${item.action_status === 'closed' ? 'bg-green-500/10 text-green-400'
                                                        : item.action_status === 'in_progress' ? 'bg-blue-500/10 text-blue-400'
                                                            : 'bg-slate-100/50 text-slate-500'
                                                        }`}>{(item.action_status || 'open').replace('_', ' ')}</span>
                                                </td>
                                                <td className="px-2 py-3">
                                                    <div className="flex items-center gap-1 justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => startEdit(item)} className="p-1 bg-slate-100 text-brand-300 rounded hover:bg-brand-600 hover:text-slate-800 transition-colors" title="Edit item"><Sparkles size={12} /></button>
                                                        {itemRpn >= 100 ? (
                                                            <button onClick={() => openDEFromItem(item)}
                                                                className="p-1 bg-red-50 text-red-500 rounded hover:bg-red-100 transition-colors animate-pulse"
                                                                title={`Create DE Task (RPN ${itemRpn} exceeds threshold)`}>
                                                                <Target size={12} />
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => openDEFromItem(item)}
                                                                className="p-1 bg-slate-100 text-slate-400 rounded hover:bg-amber-50 hover:text-amber-600 transition-colors"
                                                                title="Create DE Task from this failure mode">
                                                                <Target size={12} />
                                                            </button>
                                                        )}
                                                        <button onClick={() => deleteItem(item.id)} className="p-1 bg-slate-100 text-red-400 rounded hover:bg-red-500/20 transition-colors"><Trash2 size={12} /></button>
                                                    </div>
                                                </td>
                                            </>
                                        )}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── DE Task Creation Modal (from FMEA row) ──────── */}
            {deModalItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 animate-in zoom-in duration-200">
                        <div className="flex items-center gap-3 mb-5">
                            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
                                <Target size={20} className="text-amber-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-base font-bold text-slate-800">Spawn Defect Elimination Task</h3>
                                <p className="text-xs text-slate-500">Create a DE initiative from FMEA failure mode (RPN {(deModalItem.severity || 1) * (deModalItem.occurrence || 1) * (deModalItem.detection || 1)})</p>
                            </div>
                            <button onClick={() => setDeModalItem(null)}
                                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        {/* High RPN alert */}
                        {(deModalItem.severity || 1) * (deModalItem.occurrence || 1) * (deModalItem.detection || 1) >= 200 && (
                            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 mb-4">
                                <AlertTriangle size={16} className="text-red-500 flex-shrink-0" />
                                <span className="text-xs text-red-700 font-medium">
                                    Critical RPN detected. Per ISO 55000 risk-based prioritization, this failure mode requires immediate defect elimination action.
                                </span>
                            </div>
                        )}

                        <div className="space-y-4">
                            {/* Title */}
                            <div>
                                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">DE Task Title</label>
                                <input type="text" value={deForm.title}
                                    onChange={e => setDeForm(p => ({ ...p, title: e.target.value }))}
                                    className="w-full mt-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500" />
                            </div>
                            {/* Root Cause */}
                            <div>
                                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Root Cause Summary (from FMEA)</label>
                                <textarea value={deForm.rootCauseSummary}
                                    onChange={e => setDeForm(p => ({ ...p, rootCauseSummary: e.target.value }))}
                                    rows={4}
                                    className="w-full mt-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-vertical leading-relaxed" />
                            </div>
                            {/* Proposed Solution */}
                            <div>
                                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Proposed Solution</label>
                                <textarea value={deForm.proposedSolution}
                                    onChange={e => setDeForm(p => ({ ...p, proposedSolution: e.target.value }))}
                                    rows={2} placeholder="From FMEA recommended action..."
                                    className="w-full mt-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-vertical" />
                            </div>
                            {/* Priority */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Priority</label>
                                    <select value={deForm.priority}
                                        onChange={e => setDeForm(p => ({ ...p, priority: e.target.value as any }))}
                                        className="w-full mt-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800">
                                        <option value="critical">Critical</option>
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Payback (months)</label>
                                    <input type="number" min={1} value={deForm.paybackMonths}
                                        onChange={e => setDeForm(p => ({ ...p, paybackMonths: Number(e.target.value) }))}
                                        className="w-full mt-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800" />
                                </div>
                            </div>
                            {/* Financial */}
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Annual Cost ($)</label>
                                    <input type="number" min={0} value={deForm.annualCost}
                                        onChange={e => setDeForm(p => ({ ...p, annualCost: Number(e.target.value) }))}
                                        className="w-full mt-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Est. Savings ($)</label>
                                    <input type="number" min={0} value={deForm.estimatedSavings}
                                        onChange={e => setDeForm(p => ({ ...p, estimatedSavings: Number(e.target.value) }))}
                                        className="w-full mt-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Impl. Cost ($)</label>
                                    <input type="number" min={0} value={deForm.implementationCost}
                                        onChange={e => setDeForm(p => ({ ...p, implementationCost: Number(e.target.value) }))}
                                        className="w-full mt-1.5 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800" />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <button onClick={() => setDeModalItem(null)}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                                Cancel
                            </button>
                            <button onClick={handleCreateDEFromFMEA} disabled={deCreating || !deForm.title}
                                className="px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-lg disabled:opacity-50 transition-all flex items-center gap-2">
                                {deCreating ? <Loader2 className="animate-spin" size={14} /> : <Target size={14} />}
                                Create DE Task
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FMEAWorksheetDetail;
