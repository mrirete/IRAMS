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
    History, Search, Clock, X, ChevronDown, ChevronUp, FolderOpen, ArrowUpDown, User, Layers, Wrench,
    FileText, CheckCircle2, Plus,
} from 'lucide-react';
import { Button } from '../../eam/components/ui';
import type { ReliabilityAnalysis, ReliabilityAnalysisType, ReliabilityStudy, ReliabilityStudyStatus } from '../../eam/services/AnalyzeService';

// ── Study lifecycle (0204) ────────────────────────────────────
const STATUS_META: Record<ReliabilityStudyStatus, { label: string; cls: string }> = {
    active:    { label: 'Active',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    in_review: { label: 'In Review', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    approved:  { label: 'Approved',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    archived:  { label: 'Archived',  cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};
const STATUS_ORDER: ReliabilityStudyStatus[] = ['active', 'in_review', 'approved', 'archived'];

// ── Findings / lifecycle modal — the study's deliverable ──────
function StudyGovernanceModal({ study, onClose, onSave }: {
    study: ReliabilityStudy;
    onClose: () => void;
    onSave: (updates: { status: ReliabilityStudyStatus; findings: string }) => Promise<boolean>;
}) {
    const [status, setStatus] = useState<ReliabilityStudyStatus>(study.status || 'active');
    const [findings, setFindings] = useState(study.findings || '');
    const [saving, setSaving] = useState(false);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg animate-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
                    <div className="min-w-0">
                        <h3 className="text-lg font-bold text-slate-800 truncate">{study.name}</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Study findings & lifecycle</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg shrink-0"><X size={18} /></button>
                </div>
                <div className="px-6 py-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Status</label>
                        <div className="flex flex-wrap gap-1.5">
                            {STATUS_ORDER.map(s => (
                                <button
                                    key={s}
                                    onClick={() => setStatus(s)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                                        status === s ? STATUS_META[s].cls + ' ring-2 ring-offset-1 ring-slate-300' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                                    }`}
                                >
                                    {STATUS_META[s].label}
                                </button>
                            ))}
                        </div>
                        {study.status === 'approved' && study.approved_by && (
                            <p className="text-[11px] text-emerald-600 mt-1.5 flex items-center gap-1">
                                <CheckCircle2 size={11} /> Approved by {study.approved_by}
                                {study.approved_at ? ` on ${fmtDate(study.approved_at)}` : ''}
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Findings & recommendations</label>
                        <textarea
                            value={findings}
                            onChange={e => setFindings(e.target.value)}
                            rows={6}
                            placeholder="What did this study conclude? Which failure pattern, which strategy, which actions were taken (PMs, spares levels, redesigns)…"
                            className="w-full p-3 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">The findings summary is the study's deliverable — what a reviewer reads before approving.</p>
                    </div>
                </div>
                <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                    <button
                        onClick={async () => {
                            setSaving(true);
                            const ok = await onSave({ status, findings });
                            setSaving(false);
                            if (ok) onClose();
                        }}
                        disabled={saving}
                        className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-primary-500 to-primary-500 rounded-lg shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}

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

                    {study.linked_pm_id && (
                        <div>
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-1.5">Linked PM program</h4>
                            <a
                                href={`/recurring-work?id=${study.linked_pm_id}`}
                                className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                                <Wrench size={14} /> {study.linked_pm_title || 'PM program'}
                            </a>
                        </div>
                    )}

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
export function StudyRecordsPanel({ analyses, studies, loading, onLoad, onUpdateStudy, onCreateStudy }: {
    analyses: ReliabilityAnalysis[];      // ALL versions across all lineages
    studies: ReliabilityStudy[];          // parent study containers
    loading: boolean;
    onLoad: (a: ReliabilityAnalysis) => void;
    /** Lifecycle updates (status transition, findings). Absent = read-only register. */
    onUpdateStudy?: (id: string, updates: { status: ReliabilityStudyStatus; findings: string }) => Promise<boolean>;
    /** Start a study container up-front (before any analysis run). Absent = no button. */
    onCreateStudy?: (name: string, description: string) => Promise<boolean>;
}) {
    const [expanded, setExpanded] = useState(true);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<'all' | ReliabilityAnalysisType>('all');
    const [newestFirst, setNewestFirst] = useState(true);
    const [detailRoot, setDetailRoot] = useState<string | null>(null);
    const [governStudy, setGovernStudy] = useState<ReliabilityStudy | null>(null);
    const [showNewStudy, setShowNewStudy] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [creating, setCreating] = useState(false);

    const handleCreate = async () => {
        if (!onCreateStudy || !newName.trim()) return;
        setCreating(true);
        const ok = await onCreateStudy(newName.trim(), newDesc.trim());
        setCreating(false);
        if (ok) {
            setShowNewStudy(false);
            setNewName('');
            setNewDesc('');
            setExpanded(true);
        }
    };

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

    // Group filtered lineages under their parent study (+ an "ungrouped" bucket)
    const studyById = useMemo(() => new Map(studies.map(s => [s.id, s])), [studies]);
    const sections = useMemo(() => {
        const byStudy = new Map<string, typeof filtered>();
        for (const l of filtered) {
            const key = (l.latest.study_id && studyById.has(l.latest.study_id)) ? l.latest.study_id : '__ungrouped__';
            const arr = byStudy.get(key) ?? byStudy.set(key, []).get(key)!;
            arr.push(l);
        }
        const studySections = studies
            .filter(s => byStudy.has(s.id))
            .map(s => ({ study: s, lineages: byStudy.get(s.id)! }));
        return { studySections, ungrouped: byStudy.get('__ungrouped__') ?? [] };
    }, [filtered, studies, studyById]);

    const isEmpty = sections.studySections.length === 0 && sections.ungrouped.length === 0;

    // Single lineage row (reused across study sections and the ungrouped bucket)
    const renderRow = ({ root, latest, versions }: typeof filtered[number]) => (
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
                    {latest.linked_pm_id && (
                        <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded font-semibold flex items-center gap-1" title={`Linked PM: ${latest.linked_pm_title || 'PM program'}`}>
                            <Wrench size={9} /> PM
                        </span>
                    )}
                </div>
            </div>
            <ChevronDown size={14} className="-rotate-90 text-slate-300 shrink-0" />
        </button>
    );

    return (
        <div className="bg-white border border-slate-200 rounded-card shadow-card overflow-hidden">
            <div className="flex items-center gap-2 pr-3">
                <button onClick={() => setExpanded(v => !v)} className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <History size={16} className="text-primary-500" />
                        Study Records
                        <span className="text-xs font-normal text-slate-400">({lineages.length})</span>
                    </div>
                    {expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </button>
                {onCreateStudy && (
                    <button
                        onClick={() => setShowNewStudy(true)}
                        title="Create a study container up-front — analyses saved later group under it"
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-primary-600 hover:bg-primary-500 rounded-lg shadow-sm transition-colors"
                    >
                        <Plus size={13} /> New study
                    </button>
                )}
            </div>

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

                    {/* List — grouped under parent studies, then an ungrouped bucket */}
                    <div className="max-h-80 overflow-y-auto">
                        {loading ? (
                            <div className="px-4 py-8 text-center text-xs text-slate-400 animate-pulse">Loading study records…</div>
                        ) : isEmpty ? (
                            <div className="px-4 py-8 text-center text-xs text-slate-400">
                                {lineages.length === 0
                                    ? 'No studies saved yet. Run a calculation and hit Save to start the record.'
                                    : 'No studies match your filters.'}
                            </div>
                        ) : (
                            <>
                                {sections.studySections.map(({ study, lineages: rows }) => {
                                    const meta = STATUS_META[study.status] || STATUS_META.active;
                                    return (
                                        <div key={study.id}>
                                            <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-50 border-y border-slate-100 sticky top-0 z-10">
                                                <FolderOpen size={13} className="text-primary-500 shrink-0" />
                                                <span className="text-xs font-bold text-slate-700 truncate">{study.name}</span>
                                                {study.asset_tag && <span className="text-[10px] font-mono text-slate-400">{study.asset_tag}</span>}
                                                {onUpdateStudy ? (
                                                    <button
                                                        onClick={() => setGovernStudy(study)}
                                                        title="Study lifecycle & findings"
                                                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 hover:opacity-80 transition-opacity ${meta.cls}`}
                                                    >
                                                        {meta.label}
                                                    </button>
                                                ) : (
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border shrink-0 ${meta.cls}`}>{meta.label}</span>
                                                )}
                                                {study.findings && (
                                                    <FileText size={11} className="text-slate-400 shrink-0" aria-label="Has findings summary" />
                                                )}
                                                <span className="text-[10px] text-slate-400 ml-auto shrink-0">{rows.length} {rows.length === 1 ? 'analysis' : 'analyses'}</span>
                                            </div>
                                            <div className="divide-y divide-slate-50">{rows.map(renderRow)}</div>
                                        </div>
                                    );
                                })}
                                {sections.ungrouped.length > 0 && (
                                    <div>
                                        {sections.studySections.length > 0 && (
                                            <div className="px-4 py-1.5 bg-slate-50 border-y border-slate-100 sticky top-0 z-10">
                                                <span className="text-xs font-bold text-slate-500">Ungrouped</span>
                                            </div>
                                        )}
                                        <div className="divide-y divide-slate-50">{sections.ungrouped.map(renderRow)}</div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {detailVersions && <StudyDetail versions={detailVersions} onClose={() => setDetailRoot(null)} onLoad={onLoad} />}
            {governStudy && onUpdateStudy && (
                <StudyGovernanceModal
                    study={governStudy}
                    onClose={() => setGovernStudy(null)}
                    onSave={updates => onUpdateStudy(governStudy.id, updates)}
                />
            )}

            {/* New Study — start the container up-front; analyses group under it on save */}
            {showNewStudy && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowNewStudy(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                            <h3 className="text-lg font-bold text-slate-800">New study</h3>
                            <button onClick={() => setShowNewStudy(false)} className="p-1 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
                        </div>
                        <div className="px-6 py-5 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Study name</label>
                                <input
                                    type="text" value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                    placeholder="e.g. GT-301 Reliability Review Q3 2026"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Scope / objective (optional)</label>
                                <textarea
                                    value={newDesc} onChange={e => setNewDesc(e.target.value)}
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                                    placeholder="What question is this study answering?"
                                />
                            </div>
                            <p className="text-[11px] text-slate-400">
                                Analyses you run afterwards can be saved into this study from any tool's Save dialog.
                            </p>
                        </div>
                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
                            <button onClick={() => setShowNewStudy(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                            <button
                                onClick={handleCreate}
                                disabled={!newName.trim() || creating}
                                className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-500 rounded-lg shadow-md transition-all disabled:opacity-50"
                            >
                                {creating ? 'Creating…' : 'Create study'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default StudyRecordsPanel;
