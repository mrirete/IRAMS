/**
 * AdminActivityPage.tsx — Admin Activity & Audit Trail Dashboard
 * ══════════════════════════════════════════════════════════════
 * SUPER_ADMIN-exclusive page providing full visibility into all
 * administrative actions across the platform.
 * 
 * Reads from the `audit_logs` table (DB triggers capture Who/What/When/Where).
 * Compliant with: ISO 55000, NIST 800-53 (AU-2/AU-3), IEC 62443.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Shield, Search, RefreshCw, Filter, Clock, User, Database,
    ChevronDown, ChevronUp, AlertTriangle, Activity, Eye,
    UserCog, Trash2, Edit3, PlusCircle, Lock, Unlock,
    Calendar, ArrowDownCircle, X, AlertOctagon, FileText,
    BarChart3, Users
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';

// ── Types ────────────────────────────────────────────────────

interface AuditLogEntry {
    id: string;
    table_name: string;
    record_id: string;
    action: 'INSERT' | 'UPDATE' | 'DELETE';
    changed_by: string | null;
    timestamp: string;
    changes: Record<string, any>;
}

interface AuditStats {
    total: number;
    inserts: number;
    updates: number;
    deletes: number;
    uniqueUsers: number;
    uniqueTables: number;
    privilegedActions: number;
}

// ── Constants ────────────────────────────────────────────────

/** Tables whose mutations are considered "privileged" (high-risk admin actions) */
const PRIVILEGED_TABLES = new Set([
    'users', 'contacts', 'reference_codes', 'assets', 
    'audit_templates', 'organization_units'
]);

/** Tables that should be highlighted as security-sensitive */
const SECURITY_TABLES = new Set(['users', 'contacts', 'reference_codes']);

const ACTION_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
    INSERT: { label: 'Created', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: <PlusCircle size={12} /> },
    UPDATE: { label: 'Modified', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', icon: <Edit3 size={12} /> },
    DELETE: { label: 'Deleted', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: <Trash2 size={12} /> },
};

const TABLE_LABELS: Record<string, string> = {
    users: 'Users',
    contacts: 'Contacts & Roles',
    assets: 'Assets',
    work_orders: 'Work Orders',
    reference_codes: 'Dictionaries',
    inventory_items: 'Inventory',
    audit_assessments: 'Audit Assessments',
    audit_templates: 'Audit Templates',
    audit_template_sections: 'Audit Sections',
    audit_template_questions: 'Audit Questions',
    organization_units: 'Organization Units',
    ers_rcm_decisions: 'RCM Decisions',
    ers_rcm_failure_modes: 'RCM Failure Modes',
    ers_rcm_functions: 'RCM Functions',
    dictionaries: 'Dictionaries (Legacy)',
};

const PAGE_SIZE = 40;

// ── Component ────────────────────────────────────────────────

export const AdminActivityPage: React.FC = () => {
    const [entries, setEntries] = useState<AuditLogEntry[]>([]);
    const [stats, setStats] = useState<AuditStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [userMap, setUserMap] = useState<Map<string, string>>(new Map());

    // Filters
    const [search, setSearch] = useState('');
    const [filterTable, setFilterTable] = useState('');
    const [filterAction, setFilterAction] = useState('');
    const [filterUser, setFilterUser] = useState('');
    const [filterPrivileged, setFilterPrivileged] = useState(false);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);

    // ── Load User Map (UUID → username) ──────────────────────
    useEffect(() => {
        const loadUsers = async () => {
            const { data } = await supabase.from('users').select('id, username');
            if (data) {
                const map = new Map<string, string>();
                data.forEach((u: any) => map.set(u.id, u.username));
                setUserMap(map);
            }
        };
        loadUsers();
    }, []);

    // ── Load Audit Entries ───────────────────────────────────
    const loadEntries = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('audit_logs')
                .select('*', { count: 'exact' })
                .order('timestamp', { ascending: false })
                .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

            if (filterTable) query = query.eq('table_name', filterTable);
            if (filterAction) query = query.eq('action', filterAction);
            if (filterUser) query = query.eq('changed_by', filterUser);
            if (dateFrom) query = query.gte('timestamp', dateFrom + 'T00:00:00Z');
            if (dateTo) query = query.lte('timestamp', dateTo + 'T23:59:59Z');

            const { data, count, error } = await query;
            if (error) throw error;

            let filtered = data || [];

            // Client-side filtering for privileged actions and search
            if (filterPrivileged) {
                filtered = filtered.filter(e => PRIVILEGED_TABLES.has(e.table_name));
            }

            if (search) {
                const s = search.toLowerCase();
                filtered = filtered.filter(e =>
                    e.table_name.toLowerCase().includes(s) ||
                    e.record_id.toLowerCase().includes(s) ||
                    JSON.stringify(e.changes).toLowerCase().includes(s) ||
                    (userMap.get(e.changed_by || '') || '').toLowerCase().includes(s)
                );
            }

            setEntries(filtered);
            setTotalCount(count || 0);
        } catch (err) {
            console.error('[AdminActivity] Failed to load audit logs:', err);
        } finally {
            setLoading(false);
        }
    }, [page, filterTable, filterAction, filterUser, filterPrivileged, dateFrom, dateTo, search, userMap]);

    // ── Load Stats ───────────────────────────────────────────
    const loadStats = useCallback(async () => {
        try {
            const { data, error } = await supabase.from('audit_logs').select('action, table_name, changed_by');
            if (error || !data) return;

            const stats: AuditStats = {
                total: data.length,
                inserts: data.filter(e => e.action === 'INSERT').length,
                updates: data.filter(e => e.action === 'UPDATE').length,
                deletes: data.filter(e => e.action === 'DELETE').length,
                uniqueUsers: new Set(data.map(e => e.changed_by).filter(Boolean)).size,
                uniqueTables: new Set(data.map(e => e.table_name)).size,
                privilegedActions: data.filter(e => PRIVILEGED_TABLES.has(e.table_name)).length,
            };
            setStats(stats);
        } catch (err) {
            console.error('[AdminActivity] Failed to load stats:', err);
        }
    }, []);

    useEffect(() => { loadEntries(); }, [loadEntries]);
    useEffect(() => { loadStats(); }, [loadStats]);

    // ── Unique values for filter dropdowns ────────────────────
    const uniqueTables = useMemo(() => {
        const tables = new Set(entries.map(e => e.table_name));
        return Array.from(tables).sort();
    }, [entries]);

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    const clearFilters = () => {
        setSearch(''); setFilterTable(''); setFilterAction(''); setFilterUser('');
        setFilterPrivileged(false); setDateFrom(''); setDateTo(''); setPage(0);
    };

    const hasFilters = search || filterTable || filterAction || filterUser || filterPrivileged || dateFrom || dateTo;

    // ── Render ───────────────────────────────────────────────
    return (
        <div className="h-full flex flex-col overflow-hidden bg-white rounded-xl border border-slate-200 shadow-sm">
            {/* ── Header ─────────────────────────────────────── */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/25">
                        <Shield size={22} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-900 tracking-tight">Admin Activity Log</h1>
                        <p className="text-sm text-slate-500 font-medium">
                            Full audit trail — Who changed What, When, and Where
                            <span className="ml-2 text-blue-600 font-bold text-[10px] uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">Super Admin Only</span>
                        </p>
                    </div>
                </div>
                <button onClick={() => { loadEntries(); loadStats(); }}
                    className="px-4 py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold flex items-center gap-2 transition-colors border border-slate-300 shadow-sm">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
            </div>

            {/* ── Stats Banner ────────────────────────────────── */}
            {stats && (
                <div className="px-6 py-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/30 flex items-center gap-3 overflow-x-auto shrink-0">
                    <StatCard label="Total Events" value={stats.total} icon={<BarChart3 size={14} />} color="text-slate-800" />
                    <StatCard label="Creates" value={stats.inserts} icon={<PlusCircle size={14} />} color="text-emerald-600" />
                    <StatCard label="Updates" value={stats.updates} icon={<Edit3 size={14} />} color="text-blue-600" />
                    <StatCard label="Deletes" value={stats.deletes} icon={<Trash2 size={14} />} color="text-red-600" />
                    <div className="w-px h-8 bg-slate-300 shrink-0" />
                    <StatCard label="Active Users" value={stats.uniqueUsers} icon={<Users size={14} />} color="text-blue-600" />
                    <StatCard label="Tables Affected" value={stats.uniqueTables} icon={<Database size={14} />} color="text-amber-600" />
                    <StatCard label="Privileged Actions" value={stats.privilegedActions} icon={<AlertOctagon size={14} />} color="text-red-700" />
                </div>
            )}

            {/* ── Filter Bar ─────────────────────────────────── */}
            <div className="px-6 py-3 border-b border-slate-200 bg-slate-50/30 flex items-center gap-3 flex-wrap shrink-0">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => { setSearch(e.target.value); setPage(0); }}
                        placeholder="Search changes, users, record IDs..."
                        className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-primary-500/20 transition-all font-medium"
                    />
                </div>

                <select value={filterTable} onChange={e => { setFilterTable(e.target.value); setPage(0); }}
                    className="py-2.5 px-3 text-sm min-w-[140px] bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold focus:outline-none focus:border-blue-500 cursor-pointer">
                    <option value="">All Tables</option>
                    {uniqueTables.map(t => <option key={t} value={t}>{TABLE_LABELS[t] || t}</option>)}
                </select>

                <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(0); }}
                    className="py-2.5 px-3 text-sm min-w-[120px] bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold focus:outline-none focus:border-blue-500 cursor-pointer">
                    <option value="">All Actions</option>
                    <option value="INSERT">Created</option>
                    <option value="UPDATE">Modified</option>
                    <option value="DELETE">Deleted</option>
                </select>

                <select value={filterUser} onChange={e => { setFilterUser(e.target.value); setPage(0); }}
                    className="py-2.5 px-3 text-sm min-w-[140px] bg-white border border-slate-300 rounded-lg text-slate-700 font-semibold focus:outline-none focus:border-blue-500 cursor-pointer">
                    <option value="">All Users</option>
                    {Array.from(userMap.entries()).map(([id, name]) => (
                        <option key={id} value={id}>{name}</option>
                    ))}
                </select>

                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0); }}
                    className="py-2.5 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-700 font-medium focus:outline-none focus:border-blue-500 cursor-pointer" />
                <span className="text-xs text-slate-400 font-medium">to</span>
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0); }}
                    className="py-2.5 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-700 font-medium focus:outline-none focus:border-blue-500 cursor-pointer" />

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none font-semibold whitespace-nowrap">
                    <input type="checkbox" checked={filterPrivileged} onChange={e => { setFilterPrivileged(e.target.checked); setPage(0); }}
                        className="rounded border-slate-300 bg-white text-blue-600 focus:ring-primary-500 w-4 h-4" />
                    <AlertTriangle size={13} className="text-amber-500" /> Privileged only
                </label>

                {hasFilters && (
                    <button onClick={clearFilters}
                        className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1 font-semibold transition-colors">
                        <X size={12} /> Clear
                    </button>
                )}
            </div>

            {/* ── Audit Log List ──────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center h-48">
                        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center mt-16 space-y-3">
                        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                            <Activity size={28} className="text-slate-400" />
                        </div>
                        <p className="text-lg font-bold text-slate-800">No activity found</p>
                        <p className="text-sm text-slate-500">Adjust your filters to see audit entries.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {entries.map(entry => {
                            const actionCfg = ACTION_CONFIG[entry.action] || ACTION_CONFIG.UPDATE;
                            const isExpanded = expandedId === entry.id;
                            const isPrivileged = PRIVILEGED_TABLES.has(entry.table_name);
                            const isSecurity = SECURITY_TABLES.has(entry.table_name);
                            const username = entry.changed_by ? (userMap.get(entry.changed_by) || entry.changed_by.substring(0, 8) + '...') : 'System';
                            const tableLabel = TABLE_LABELS[entry.table_name] || entry.table_name;

                            return (
                                <div key={entry.id} className={`px-6 py-3.5 hover:bg-slate-50/80 transition-colors ${isSecurity ? 'border-l-3 border-l-blue-400' : ''}`}>
                                    <div className="flex items-start gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : entry.id)}>
                                        {/* Action Badge */}
                                        <div className={`mt-0.5 shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border ${actionCfg.bg} ${actionCfg.border} ${actionCfg.color}`}>
                                            {actionCfg.icon} {actionCfg.label}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-slate-900 font-semibold leading-snug">
                                                <span className="text-slate-700">{tableLabel}</span>
                                                {isPrivileged && (
                                                    <span className="ml-2 inline-flex items-center gap-0.5 text-[9px] font-black text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 uppercase tracking-wide">
                                                        <AlertTriangle size={9} /> Privileged
                                                    </span>
                                                )}
                                            </p>
                                            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                                                <span className="flex items-center gap-1 text-slate-600 font-medium">
                                                    <User size={11} /> {username}
                                                </span>
                                                <span className="flex items-center gap-1 text-slate-400">
                                                    <Database size={10} /> {entry.table_name}
                                                </span>
                                                <span className="text-slate-400 font-mono text-[10px]">
                                                    ID: {entry.record_id.substring(0, 8)}...
                                                </span>
                                                <span className="flex items-center gap-1 text-slate-400">
                                                    <Clock size={10} /> {formatTimestamp(entry.timestamp)}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Expand Toggle */}
                                        <div className="shrink-0">
                                            {isExpanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </div>
                                    </div>

                                    {/* Expanded Diff View */}
                                    {isExpanded && (
                                        <div className="mt-3 ml-[80px] space-y-3">
                                            <div>
                                                <p className="text-xs font-bold uppercase text-slate-500 mb-1.5 tracking-wide flex items-center gap-1.5">
                                                    <FileText size={11} /> Change Details
                                                </p>
                                                <ChangesDiff changes={entry.changes} action={entry.action} />
                                            </div>

                                            <div className="flex items-center gap-4 text-xs text-slate-500">
                                                <span>Full Record ID: <code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono border border-slate-200">{entry.record_id}</code></span>
                                                <span>Table: <strong className="text-slate-800">{entry.table_name}</strong></span>
                                                <span>Exact Time: <strong className="text-slate-800">{new Date(entry.timestamp).toLocaleString()}</strong></span>
                                                {entry.changed_by && (
                                                    <span>Auth UID: <code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-mono border border-slate-200">{entry.changed_by}</code></span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Pagination ──────────────────────────────────── */}
            {totalPages > 1 && (
                <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-sm text-slate-500 shrink-0">
                    <span>Showing <strong className="text-slate-800">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)}</strong> of <strong className="text-slate-800">{totalCount}</strong></span>
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
            <span className={color}>{icon}</span>
            <div>
                <p className={`text-base font-black ${color}`}>{value.toLocaleString()}</p>
                <p className="text-[10px] text-slate-500 leading-none font-bold">{label}</p>
            </div>
        </div>
    );
}

/** Renders a diff-style view of the changes JSONB */
function ChangesDiff({ changes, action }: { changes: Record<string, any>; action: string }) {
    if (!changes || Object.keys(changes).length === 0) {
        return <p className="text-xs text-slate-400 italic">No change data recorded.</p>;
    }

    // For INSERT, changes might be the full record
    if (action === 'INSERT') {
        return (
            <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto max-h-60 border border-slate-200">
                <pre className="text-xs text-emerald-400 font-mono leading-relaxed whitespace-pre-wrap">
                    {Object.entries(changes).map(([key, val]) => (
                        <div key={key}>
                            <span className="text-slate-500">+ </span>
                            <span className="text-cyan-400">{key}</span>
                            <span className="text-slate-500">: </span>
                            <span className="text-emerald-300">{formatValue(val)}</span>
                        </div>
                    ))}
                </pre>
            </div>
        );
    }

    // For DELETE, show what was removed
    if (action === 'DELETE') {
        return (
            <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto max-h-60 border border-slate-200">
                <pre className="text-xs text-red-400 font-mono leading-relaxed whitespace-pre-wrap">
                    {Object.entries(changes).map(([key, val]) => (
                        <div key={key}>
                            <span className="text-slate-500">- </span>
                            <span className="text-cyan-400">{key}</span>
                            <span className="text-slate-500">: </span>
                            <span className="text-red-300">{formatValue(val)}</span>
                        </div>
                    ))}
                </pre>
            </div>
        );
    }

    // For UPDATE, show old → new diff
    return (
        <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto max-h-60 border border-slate-200">
            <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap">
                {Object.entries(changes).map(([key, val]) => {
                    // If changes has {field: {old: ..., new: ...}} structure
                    if (val && typeof val === 'object' && 'old' in val && 'new' in val) {
                        return (
                            <div key={key} className="mb-1">
                                <span className="text-cyan-400">{key}</span>
                                <span className="text-slate-500">:</span>
                                {'\n'}
                                <span className="text-red-400">  - {formatValue(val.old)}</span>
                                {'\n'}
                                <span className="text-emerald-400">  + {formatValue(val.new)}</span>
                            </div>
                        );
                    }
                    // Simple key-value change
                    return (
                        <div key={key}>
                            <span className="text-amber-400">~ </span>
                            <span className="text-cyan-400">{key}</span>
                            <span className="text-slate-500">: </span>
                            <span className="text-amber-300">{formatValue(val)}</span>
                        </div>
                    );
                })}
            </pre>
        </div>
    );
}

function formatValue(val: any): string {
    if (val === null || val === undefined) return 'null';
    if (typeof val === 'object') {
        try {
            return JSON.stringify(val, null, 2);
        } catch {
            return String(val);
        }
    }
    return String(val);
}

function formatTimestamp(iso: string): string {
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
