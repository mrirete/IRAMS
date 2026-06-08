/**
 * ErrorLogsPage.tsx — Enterprise Error Log Viewer
 *
 * Admin dashboard for viewing, filtering, searching, and resolving
 * application errors. Provides severity analytics, module-level
 * breakdown, and trend visualization.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    AlertTriangle, Bug, Filter, Search, RefreshCw, CheckCircle2,
    XCircle, Info, AlertOctagon, Clock, ChevronDown, ChevronUp,
    Eye, MessageSquare, Database, Shield, Upload, Cpu, Brain,
    Plug, FileWarning, BarChart3, TrendingUp, ArrowDownCircle,
    X
} from 'lucide-react';
import {
    errorLog,
    type ErrorLogEntry,
    type ErrorSeverity,
    type ErrorCategory
} from '../../eam/services/ErrorLogService';

// ── Constants ────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<ErrorSeverity, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
    critical: { label: 'Critical', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: <AlertOctagon size={14} /> },
    error: { label: 'Error', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', icon: <XCircle size={14} /> },
    warning: { label: 'Warning', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: <AlertTriangle size={14} /> },
    info: { label: 'Info', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', icon: <Info size={14} /> },
};

const CATEGORY_CONFIG: Record<ErrorCategory, { label: string; icon: React.ReactNode }> = {
    validation: { label: 'Validation', icon: <FileWarning size={13} /> },
    import: { label: 'Import', icon: <Upload size={13} /> },
    api: { label: 'API', icon: <Database size={13} /> },
    authentication: { label: 'Auth', icon: <Shield size={13} /> },
    permission: { label: 'Permission', icon: <Shield size={13} /> },
    business_rule: { label: 'Business Rule', icon: <AlertTriangle size={13} /> },
    integration: { label: 'Integration', icon: <Plug size={13} /> },
    ai: { label: 'AI Service', icon: <Brain size={13} /> },
    system: { label: 'System', icon: <Cpu size={13} /> },
};

// ── Component ────────────────────────────────────────────────

export const ErrorLogsPage: React.FC = () => {
    const [errors, setErrors] = useState<ErrorLogEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [resolveId, setResolveId] = useState<string | null>(null);
    const [resolveNote, setResolveNote] = useState('');
    const [stats, setStats] = useState<{
        totalErrors: number;
        unresolvedCount: number;
        bySeverity: Record<ErrorSeverity, number>;
        byCategory: Record<string, number>;
        byModule: Record<string, number>;
    } | null>(null);

    // Filters
    const [search, setSearch] = useState('');
    const [severity, setSeverity] = useState<ErrorSeverity | ''>('');
    const [category, setCategory] = useState<ErrorCategory | ''>('');
    const [module, setModule] = useState('');
    const [showResolved, setShowResolved] = useState(false);
    const [page, setPage] = useState(0);
    const PAGE_SIZE = 30;

    const loadErrors = useCallback(async () => {
        setLoading(true);
        const { data, total: t } = await errorLog.fetchErrors({
            severity: severity || undefined,
            category: category || undefined,
            module: module || undefined,
            isResolved: showResolved ? undefined : false,
            search: search || undefined,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        });
        setErrors(data);
        setTotal(t);
        setLoading(false);
    }, [severity, category, module, showResolved, search, page]);

    const loadStats = useCallback(async () => {
        const s = await errorLog.getStats(7);
        setStats(s);
    }, []);

    useEffect(() => { loadErrors(); }, [loadErrors]);
    useEffect(() => { loadStats(); }, [loadStats]);

    const handleResolve = async (id: string) => {
        const user = localStorage.getItem('ers_current_user');
        const username = user ? JSON.parse(user)?.username || 'admin' : 'admin';
        await errorLog.resolveError(id, username, resolveNote);
        setResolveId(null);
        setResolveNote('');
        loadErrors();
        loadStats();
    };

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <div className="h-full flex flex-col overflow-hidden bg-white rounded-xl border border-slate-200 shadow-sm">
            {/* ── Header ─────────────────────────────────────── */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg shadow-red-500/20">
                        <Bug size={22} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-900 tracking-tight">Error Logs</h1>
                        <p className="text-sm text-slate-500 font-medium">Application diagnostics & UX improvement tracker</p>
                    </div>
                </div>
                <button onClick={() => { loadErrors(); loadStats(); }} className="px-4 py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold flex items-center gap-2 transition-colors border border-slate-300 shadow-sm">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {/* ── Stats Bar ──────────────────────────────────── */}
            {stats && (
                <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/50 flex items-center gap-3 overflow-x-auto shrink-0">
                    <StatCard label="Total (7d)" value={stats.totalErrors} icon={<BarChart3 size={14} />} color="text-slate-800" />
                    <StatCard label="Unresolved" value={stats.unresolvedCount} icon={<AlertOctagon size={14} />} color="text-red-600" />
                    <StatCard label="Critical" value={stats.bySeverity.critical} icon={<AlertOctagon size={14} />} color="text-red-700" />
                    <StatCard label="Errors" value={stats.bySeverity.error} icon={<XCircle size={14} />} color="text-orange-600" />
                    <StatCard label="Warnings" value={stats.bySeverity.warning} icon={<AlertTriangle size={14} />} color="text-amber-600" />
                    <StatCard label="Info" value={stats.bySeverity.info} icon={<Info size={14} />} color="text-blue-600" />
                    <div className="w-px h-8 bg-slate-300 shrink-0" />
                    {/* Top module breakdown */}
                    {Object.entries(stats.byModule).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([mod, count]) => (
                        <button key={mod} onClick={() => setModule(mod)} className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-xs text-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap border border-slate-200 font-semibold shadow-sm">
                            <TrendingUp size={11} className="text-slate-400" />
                            <span className="capitalize">{mod}</span>
                            <span className="font-black text-slate-900">{count}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* ── Filter Bar ─────────────────────────────────── */}
            <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/30 flex items-center gap-3 flex-wrap shrink-0">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(0); }}
                        placeholder="Search error messages..."
                        className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 transition-all font-medium"
                    />
                </div>

                <select value={severity} onChange={e => { setSeverity(e.target.value as any); setPage(0); }}
                    className="py-2.5 px-3 text-sm min-w-[120px] bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold focus:outline-none focus:border-accent-cyan cursor-pointer">
                    <option value="">All Severity</option>
                    {Object.entries(SEVERITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>

                <select value={category} onChange={e => { setCategory(e.target.value as any); setPage(0); }}
                    className="py-2.5 px-3 text-sm min-w-[130px] bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold focus:outline-none focus:border-accent-cyan cursor-pointer">
                    <option value="">All Categories</option>
                    {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>

                <input value={module} onChange={e => { setModule(e.target.value); setPage(0); }}
                    placeholder="Module..."
                    className="py-2.5 px-3 text-sm w-28 bg-white border border-slate-300 rounded-lg text-slate-700 placeholder-slate-400 font-medium focus:outline-none focus:border-accent-cyan transition-all" />

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none font-semibold">
                    <input type="checkbox" checked={showResolved} onChange={e => { setShowResolved(e.target.checked); setPage(0); }}
                        className="rounded border-slate-300 bg-white text-accent-cyan focus:ring-accent-cyan w-4 h-4" />
                    Show resolved
                </label>

                {(severity || category || module || search) && (
                    <button onClick={() => { setSeverity(''); setCategory(''); setModule(''); setSearch(''); setPage(0); }}
                        className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1 font-semibold transition-colors">
                        <X size={12} /> Clear filters
                    </button>
                )}
            </div>

            {/* ── Error List ─────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-48">
                        <div className="w-8 h-8 border-2 border-accent-cyan border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : errors.length === 0 ? (
                    <div className="flex flex-col items-center justify-center mt-16 space-y-3">
                        <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center border border-emerald-200">
                            <CheckCircle2 size={28} className="text-emerald-500" />
                        </div>
                        <p className="text-lg font-bold text-slate-800">No errors found</p>
                        <p className="text-sm text-slate-500">All clear — no matching error logs.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {errors.map(err => {
                            const sev = SEVERITY_CONFIG[err.severity];
                            const cat = CATEGORY_CONFIG[err.category as ErrorCategory] || CATEGORY_CONFIG.system;
                            const isExpanded = expandedId === err.id;
                            const isResolving = resolveId === err.id;

                            return (
                                <div key={err.id || err.createdAt} className={`px-6 py-3.5 hover:bg-slate-50 transition-colors ${err.isResolved ? 'opacity-50' : ''}`}>
                                    {/* Row Header */}
                                    <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : (err.id || null))}>
                                        {/* Severity Badge */}
                                        <div className={`mt-0.5 shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border ${sev.bg} ${sev.border} ${sev.color}`}>
                                            {sev.icon} {sev.label}
                                        </div>

                                        {/* Message */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-slate-900 font-semibold leading-snug truncate">{err.message}</p>
                                            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                                                <span className="flex items-center gap-1 text-slate-600 font-medium">{cat.icon} {cat.label}</span>
                                                {err.module && <span className="capitalize text-slate-600 font-medium">📦 {err.module}</span>}
                                                {err.action && <span className="text-slate-400">→ {err.action}</span>}
                                                {err.userId && <span className="text-slate-600 font-medium">👤 {err.userId}</span>}
                                                <span className="flex items-center gap-1 text-slate-400"><Clock size={10} /> {formatTime(err.createdAt)}</span>
                                            </div>
                                        </div>

                                        {/* Status */}
                                        <div className="shrink-0 flex items-center gap-2">
                                            {err.isResolved && (
                                                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                                                    <CheckCircle2 size={10} /> Resolved
                                                </span>
                                            )}
                                            {isExpanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </div>
                                    </div>

                                    {/* Expanded Detail */}
                                    {isExpanded && (
                                        <div className="mt-3 ml-[80px] space-y-3">
                                            {/* Technical Detail */}
                                            {err.technicalDetail && (
                                                <div>
                                                    <p className="text-xs font-bold uppercase text-slate-500 mb-1.5 tracking-wide">Stack Trace / Detail</p>
                                                    <pre className="text-xs text-slate-800 bg-slate-900 text-orange-300 rounded-lg p-4 overflow-x-auto max-h-44 font-mono border border-slate-200 leading-relaxed">
                                                        {err.technicalDetail}
                                                    </pre>
                                                </div>
                                            )}

                                            {/* Input Snapshot */}
                                            {err.inputSnapshot && Object.keys(err.inputSnapshot).length > 0 && (
                                                <div>
                                                    <p className="text-xs font-bold uppercase text-slate-500 mb-1.5 tracking-wide">Input Snapshot</p>
                                                    <pre className="text-xs bg-slate-900 text-cyan-300 rounded-lg p-4 overflow-x-auto max-h-36 font-mono border border-slate-200 leading-relaxed">
                                                        {JSON.stringify(err.inputSnapshot, null, 2)}
                                                    </pre>
                                                </div>
                                            )}

                                            {/* Entity Info */}
                                            <div className="flex items-center gap-4 text-xs text-slate-500">
                                                {err.entityType && <span>Entity: <strong className="text-slate-800">{err.entityType}</strong></span>}
                                                {err.entityId && <span>ID: <code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono border border-slate-200">{err.entityId}</code></span>}
                                                {err.url && <span className="truncate max-w-xs">URL: <span className="text-slate-600">{err.url}</span></span>}
                                            </div>

                                            {/* Resolution */}
                                            {err.isResolved && (
                                                <div className="flex items-center gap-3 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                                                    <CheckCircle2 size={14} className="shrink-0" />
                                                    <span>Resolved by <strong className="text-emerald-800">{err.resolvedBy}</strong> {err.resolvedAt ? `on ${new Date(err.resolvedAt).toLocaleDateString()}` : ''}</span>
                                                    {err.resolutionNote && <span className="text-emerald-600">— {err.resolutionNote}</span>}
                                                </div>
                                            )}

                                            {/* Actions */}
                                            {!err.isResolved && err.id && (
                                                <div>
                                                    {isResolving ? (
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                value={resolveNote}
                                                                onChange={e => setResolveNote(e.target.value)}
                                                                placeholder="Resolution note (optional)..."
                                                                className="flex-1 py-2 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 transition-all"
                                                            />
                                                            <button onClick={() => handleResolve(err.id!)}
                                                                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors flex items-center gap-1.5 shadow-sm">
                                                                <CheckCircle2 size={14} /> Resolve
                                                            </button>
                                                            <button onClick={() => setResolveId(null)} className="text-sm text-slate-500 hover:text-slate-700 font-semibold transition-colors">Cancel</button>
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => setResolveId(err.id!)}
                                                            className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors flex items-center gap-1.5 border border-slate-300 shadow-sm">
                                                            <CheckCircle2 size={14} /> Mark Resolved
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Pagination ─────────────────────────────────── */}
            {totalPages > 1 && (
                <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-sm text-slate-500 shrink-0">
                    <span>Showing <strong className="text-slate-800">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}</strong> of <strong className="text-slate-800">{total}</strong></span>
                    <div className="flex items-center gap-2">
                        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                            className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-30 text-slate-700 transition-colors font-semibold border border-slate-300 shadow-sm">
                            Previous
                        </button>
                        <span className="text-slate-700 font-bold">Page {page + 1} of {totalPages}</span>
                        <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                            className="px-4 py-2 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-30 text-slate-700 transition-colors font-semibold border border-slate-300 shadow-sm">
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// ── Sub-Components ───────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
    return (
        <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-white border border-slate-200 shrink-0 shadow-sm">
            <span className={`${color}`}>{icon}</span>
            <div>
                <p className={`text-base font-black ${color}`}>{value}</p>
                <p className="text-[10px] text-slate-500 leading-none font-bold">{label}</p>
            </div>
        </div>
    );
}

function formatTime(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
}
