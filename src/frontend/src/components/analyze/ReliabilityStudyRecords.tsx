/**
 * Reliability Study Records — consolidated, dated register of every saved
 * modelling study across all types (RAM/MTBF, Weibull, Monte Carlo, Spares…)
 * and all assets. Unlike the per-tab "Saved Analyses" panel, this is the
 * single browseable history with search, type filter, and date sort.
 *
 * Snapshots: studies sharing a lineage (root_id) are collapsed to their latest
 * version in the list; opening a record shows the full version timeline so runs
 * can be compared/trended over time. "Load to edit" hands the selected version
 * back to the calculator via onLoad.
 */
import React, { useMemo, useState } from 'react';
import {
    History, Search, Clock, X, ChevronDown, ChevronUp, FolderOpen, ArrowUpDown, User, Layers,
} from 'lucide-react';
import { Button } from '../../eam/components/ui';
import type { ReliabilityAnalysis, ReliabilityAnalysisType } from '../../eam/services/AnalyzeService';

const TYPE_LABELS: Record<string, string> = {
    mtbf: 'RAM / MTBF',
    weibull: 'Weibull',
    montecarlo: 'Monte Carlo',
    spares: 'Spares Demand',
    availability: 'Availability',
    maintainability: 'Maintainability',
};

const lineageOf = (a: ReliabilityAnalysis) => a.root_id || a.id;

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString();

// Render an inputs/results value compactly for the read-only detail view.
function fmtValue(v: any): string {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : Number(v.toFixed(4)).toString();
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

function KeyValueGrid({ data }: { data: Record<string, any> }) {
    const entries = Object.entries(data || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (entries.length === 0) return <p className="text-xs text-slate-400 italic">None recorded</p>;
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {entries.map(([k, v]) => (
                <div key={k} className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400 truncate">{k}</div>
                    <div className="text-sm text-slate-700 font-medium break-words">{fmtValue(v)}</div>
                </div>
            ))}
        </div>
    );
}

// ─── Read-only detail modal with version timeline ─────────────
function StudyDetail({ versions, onClose, onLoad }: {
    versions: ReliabilityAnalysis[]; // all versions of one lineage, newest first
    onClose: () => void;
    onLoad: (a: ReliabilityAnalysis) => void;
}) {
    // Default to the latest version
    const [selectedId, setSelectedId] = useState(versions[0]?.id);
    const study = versions.find(v => v.id === selectedId) || versions[0];
    const hasHistory = versions.length > 1;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col animate-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 bg-primary-50 text-primary-700 rounded text-[10px] font-bold uppercase">{TYPE_LABELS[study.analysis_type] || study.analysis_type}</span>
                            {study.asset_tag && <span className="text-[11px] font-mono text-slate-500">{study.asset_tag}</span>}
                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-semibold">v{study.version}{hasHistory ? ` of ${versions.length}` : ''}</span>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 mt-1 truncate">{study.title}</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg shrink-0"><X size={18} /></button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-5 overflow-y-auto">
                    {/* Version timeline */}
                    {hasHistory && (
                        <div>
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1.5"><Layers size={12} /> Version history</h4>
                            <div className="border border-slate-200 rounded-lg divide-y divide-slate-50 max-h-40 overflow-y-auto">
                                {versions.map(v => (
                                    <button
                                        key={v.id}
                                        onClick={() => setSelectedId(v.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-2 text-left text-xs transition-colors ${v.id === selectedId ? 'bg-primary-50' : 'hover:bg-slate-50'}`}
                                    >
                                        <span className={`px-1.5 py-0.5 rounded font-bold shrink-0 ${v.id === selectedId ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-500'}`}>v{v.version}</span>
                                        <span className="text-slate-500 shrink-0" title={fmtDateTime(v.created_at)}><Clock size={10} className="inline mr-1" />{fmtDate(v.created_at)}</span>
                                        {v.created_by && <span className="text-slate-400 truncate">· {v.created_by}</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Meta */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
                        <span title={fmtDateTime(study.created_at)}><Clock size={11} className="inline mr-1" />Created {fmtDate(study.created_at)}</span>
                        {study.created_by && <span><User size={11} className="inline mr-1" />{study.created_by}</span>}
                        {study.asset_name && <span className="text-slate-400">{study.asset_name}</span>}
                    </div>

                    {study.notes && (
                        <div>
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-1.5">Notes</h4>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 border border-slate-100">{study.notes}</p>
                        </div>
                    )}

                    <div>
                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Results</h4>
                        <div className="bg-emerald-50/40 rounded-lg p-3 border border-emerald-100">
                            <KeyValueGrid data={study.results} />
                        </div>
                    </div>

                    <div>
                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Inputs</h4>
                        <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                            <KeyValueGrid data={study.inputs} />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Close</button>
                    <Button size="sm" variant="cta" leftIcon={<FolderOpen size={14} />} onClick={() => { onLoad(study); onClose(); }}>
                        Load v{study.version} to edit
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ─── Main register panel ──────────────────────────────────────
export function StudyRecordsPanel({ analyses, loading, onLoad }: {
    analyses: ReliabilityAnalysis[];      // ALL versions across all lineages
    loading: boolean;
    onLoad: (a: ReliabilityAnalysis) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | ReliabilityAnalysisType>('all');
    const [newestFirst, setNewestFirst] = useState(true);
    const [detailRoot, setDetailRoot] = useState<string | null>(null);

    // Group all versions by lineage → { latest, versions[] }
    const lineages = useMemo(() => {
        const map = new Map<string, ReliabilityAnalysis[]>();
        for (const a of analyses) {
            const key = lineageOf(a);
            (map.get(key) ?? map.set(key, []).get(key)!).push(a);
        }
        return Array.from(map.entries()).map(([root, versions]) => {
            const sorted = [...versions].sort((a, b) => (b.version || 1) - (a.version || 1));
            return { root, latest: sorted[0], versions: sorted };
        });
    }, [analyses]);

    const presentTypes = useMemo(
        () => Array.from(new Set(lineages.map(l => l.latest.analysis_type))),
        [lineages],
    );

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        return lineages
            .filter(l => typeFilter === 'all' || l.latest.analysis_type === typeFilter)
            .filter(l => {
                if (!q) return true;
                const a = l.latest;
                return a.title.toLowerCase().includes(q)
                    || (a.asset_tag || '').toLowerCase().includes(q)
                    || (a.asset_name || '').toLowerCase().includes(q)
                    || (a.created_by || '').toLowerCase().includes(q);
            })
            .sort((a, b) => {
                const da = new Date(a.latest.created_at).getTime();
                const db = new Date(b.latest.created_at).getTime();
                return newestFirst ? db - da : da - db;
            });
    }, [lineages, search, typeFilter, newestFirst]);

    const detailVersions = detailRoot ? (lineages.find(l => l.root === detailRoot)?.versions ?? null) : null;

    return (
        <div className="bg-white border border-slate-200 rounded-card shadow-card overflow-hidden">
            <button onClick={() => setExpanded(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <History size={16} className="text-primary-500" />
                    Study Records
                    <span className="text-xs font-normal text-slate-400">({lineages.length})</span>
                </div>
                {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>

            {expanded && (
                <div className="border-t border-slate-100">
                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-50/60 border-b border-slate-100">
                        <div className="relative flex-1 min-w-[180px]">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search by title, asset, or author…"
                                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none"
                            />
                        </div>
                        <select
                            value={typeFilter}
                            onChange={e => setTypeFilter(e.target.value as any)}
                            className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:border-primary-500"
                        >
                            <option value="all">All types</option>
                            {presentTypes.map(t => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
                        </select>
                        <button
                            onClick={() => setNewestFirst(v => !v)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors"
                            title="Toggle date sort"
                        >
                            <ArrowUpDown size={13} className="text-slate-400" />
                            {newestFirst ? 'Newest' : 'Oldest'}
                        </button>
                    </div>

                    {/* List */}
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                        {loading ? (
                            <div className="px-4 py-8 text-center text-xs text-slate-400 animate-pulse">Loading study records…</div>
                        ) : filtered.length === 0 ? (
                            <div className="px-4 py-8 text-center text-xs text-slate-400">
                                {lineages.length === 0
                                    ? 'No studies saved yet. Run a calculation and hit Save to start the record.'
                                    : 'No studies match your filters.'}
                            </div>
                        ) : filtered.map(({ root, latest, versions }) => (
                            <button
                                key={root}
                                onClick={() => setDetailRoot(root)}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 truncate">{latest.title}</p>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 mt-0.5">
                                        <span className="px-1.5 py-0.5 bg-slate-100 rounded font-medium uppercase">{TYPE_LABELS[latest.analysis_type] || latest.analysis_type}</span>
                                        {latest.asset_tag && <span className="font-mono">{latest.asset_tag}</span>}
                                        <span title={fmtDateTime(latest.created_at)}><Clock size={9} className="inline" /> {fmtDate(latest.created_at)}</span>
                                        {latest.created_by && <span>· by {latest.created_by}</span>}
                                        {versions.length > 1 && (
                                            <span className="px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded font-semibold flex items-center gap-1">
                                                <Layers size={9} /> {versions.length} versions
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <ChevronDown size={14} className="-rotate-90 text-slate-300 shrink-0" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {detailVersions && <StudyDetail versions={detailVersions} onClose={() => setDetailRoot(null)} onLoad={onLoad} />}
        </div>
    );
}

export default StudyRecordsPanel;
