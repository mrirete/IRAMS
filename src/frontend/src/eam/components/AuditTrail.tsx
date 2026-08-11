import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Clock, User, Filter, ChevronDown, ChevronRight, RefreshCw, Search, Loader2 } from 'lucide-react';

interface AuditLogEntry {
    id: string;
    table_name: string;
    record_id: string;
    action: 'INSERT' | 'UPDATE' | 'DELETE';
    changed_by: string | null;
    timestamp: string;
    changes: {
        old?: Record<string, any>;
        new?: Record<string, any>;
    };
}

interface AuditTrailProps {
    /** Filter to a specific entity */
    entityId?: string;
    /** Filter to a specific table */
    tableName?: string;
    /** Max entries to show */
    limit?: number;
    /** Compact mode for embedding in tabs */
    compact?: boolean;
}

const ACTION_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    INSERT: { bg: 'bg-green-50', text: 'text-green-700', label: 'Created' },
    UPDATE: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Updated' },
    DELETE: { bg: 'bg-red-50', text: 'text-red-700', label: 'Deleted' },
};

const TABLE_LABELS: Record<string, string> = {
    work_orders: 'Work Order',
    assets: 'Asset',
    service_requests: 'Service Request',
    inventory_items: 'Inventory Item',
    contacts: 'Contact',
    dictionaries: 'Dictionary',
    purchase_orders: 'Purchase Order',
    recurring_work: 'Recurring Work',
    moc_requests: 'MoC Request',
    cost_centers: 'Cost Center',
    budgets: 'Budget',
    warranties: 'Warranty',
    warranty_claims: 'Warranty Claim',
};

/** Formats a field name from snake_case to Title Case */
const formatField = (field: string): string =>
    field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Filters out noise fields that change on every update */
const NOISE_FIELDS = new Set(['updated_at', 'created_at', 'timestamp']);

export const AuditTrail: React.FC<AuditTrailProps> = ({
    entityId,
    tableName,
    limit = 50,
    compact = false,
}) => {
    const [logs, setLogs] = useState<AuditLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');
    const [filterAction, setFilterAction] = useState<string>('ALL');

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('audit_logs')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(limit);

            if (entityId) {
                query = query.eq('record_id', entityId);
            }
            if (tableName) {
                query = query.eq('table_name', tableName);
            }

            const { data, error } = await query;
            if (error) throw error;
            setLogs((data || []) as AuditLogEntry[]);
        } catch (err) {
            console.error('Failed to load audit logs:', err);
        } finally {
            setLoading(false);
        }
    }, [entityId, tableName, limit]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const toggleExpand = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Filter logs
    const filteredLogs = logs.filter(log => {
        if (filterAction !== 'ALL' && log.action !== filterAction) return false;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            return (
                log.table_name.toLowerCase().includes(term) ||
                log.record_id.toLowerCase().includes(term) ||
                log.action.toLowerCase().includes(term) ||
                JSON.stringify(log.changes).toLowerCase().includes(term)
            );
        }
        return true;
    });

    /** Render the diff of old vs new values */
    const renderChanges = (log: AuditLogEntry) => {
        const { old: oldVal, new: newVal } = log.changes;

        if (log.action === 'INSERT' && newVal) {
            return (
                <div className="space-y-1">
                    {Object.entries(newVal)
                        .filter(([key]) => !NOISE_FIELDS.has(key))
                        .slice(0, 12)
                        .map(([key, val]) => (
                            <div key={key} className="flex gap-2 text-xs">
                                <span className="text-slate-500 min-w-[120px]">{formatField(key)}:</span>
                                <span className="text-green-700 font-mono truncate">
                                    {typeof val === 'object' ? JSON.stringify(val).slice(0, 80) : String(val ?? '—')}
                                </span>
                            </div>
                        ))}
                </div>
            );
        }

        if (log.action === 'UPDATE' && oldVal && newVal) {
            const changedKeys = Object.keys(newVal).filter(
                key => !NOISE_FIELDS.has(key) && JSON.stringify(oldVal[key]) !== JSON.stringify(newVal[key])
            );

            if (changedKeys.length === 0) {
                return <p className="text-xs text-slate-400 italic">No substantive changes</p>;
            }

            return (
                <div className="space-y-2">
                    {changedKeys.slice(0, 10).map(key => (
                        <div key={key} className="text-xs">
                            <span className="text-slate-600 font-medium">{formatField(key)}</span>
                            <div className="flex gap-2 mt-0.5 ml-3">
                                <span className="text-red-600 line-through font-mono truncate max-w-[200px]">
                                    {typeof oldVal[key] === 'object' ? JSON.stringify(oldVal[key]).slice(0, 60) : String(oldVal[key] ?? '—')}
                                </span>
                                <span className="text-slate-400">→</span>
                                <span className="text-green-700 font-mono truncate max-w-[200px]">
                                    {typeof newVal[key] === 'object' ? JSON.stringify(newVal[key]).slice(0, 60) : String(newVal[key] ?? '—')}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            );
        }

        if (log.action === 'DELETE' && oldVal) {
            return (
                <div className="space-y-1">
                    {Object.entries(oldVal)
                        .filter(([key]) => !NOISE_FIELDS.has(key))
                        .slice(0, 8)
                        .map(([key, val]) => (
                            <div key={key} className="flex gap-2 text-xs">
                                <span className="text-slate-500 min-w-[120px]">{formatField(key)}:</span>
                                <span className="text-red-600 line-through font-mono truncate">
                                    {typeof val === 'object' ? JSON.stringify(val).slice(0, 80) : String(val ?? '—')}
                                </span>
                            </div>
                        ))}
                </div>
            );
        }

        return <p className="text-xs text-slate-400 italic">No change data available</p>;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-blue-600" />
                <span className="ml-2 text-slate-500 text-sm">Loading audit trail...</span>
            </div>
        );
    }

    return (
        <div className={compact ? '' : 'bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden'}>
            {/* Header */}
            {!compact && (
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center flex-wrap gap-3">
                    <div>
                        <h3 className="font-semibold text-slate-900">Audit Trail</h3>
                        <p className="text-xs text-slate-400">{filteredLogs.length} entries • NIST/IEC 62443 compliant</p>
                    </div>
                    <div className="flex gap-2 items-center">
                        {/* Search */}
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                        </div>
                        {/* Action Filter */}
                        <select
                            value={filterAction}
                            onChange={e => setFilterAction(e.target.value)}
                            className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                        >
                            <option value="ALL">All Actions</option>
                            <option value="INSERT">Created</option>
                            <option value="UPDATE">Updated</option>
                            <option value="DELETE">Deleted</option>
                        </select>
                        <button
                            onClick={fetchLogs}
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="Refresh"
                        >
                            <RefreshCw size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Compact header */}
            {compact && (
                <div className="flex justify-between items-center mb-3">
                    <p className="text-xs text-slate-400">{filteredLogs.length} change records</p>
                    <button onClick={fetchLogs} className="text-xs text-blue-600 hover:text-blue-800">
                        <RefreshCw size={12} />
                    </button>
                </div>
            )}

            {/* Entries */}
            <div className={`divide-y divide-slate-100 ${compact ? '' : 'max-h-[600px] overflow-y-auto'}`}>
                {filteredLogs.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">
                        No audit logs found{entityId ? ' for this entity' : ''}.
                    </div>
                ) : (
                    filteredLogs.map(log => {
                        const isExpanded = expandedIds.has(log.id);
                        const actionInfo = ACTION_COLORS[log.action] || ACTION_COLORS.UPDATE;

                        return (
                            <div key={log.id} className="hover:bg-slate-50/50 transition">
                                {/* Row Header */}
                                <button
                                    onClick={() => toggleExpand(log.id)}
                                    className="w-full px-4 py-3 flex items-center gap-3 text-left"
                                >
                                    <div className="flex-shrink-0">
                                        {isExpanded ? (
                                            <ChevronDown size={14} className="text-slate-400" />
                                        ) : (
                                            <ChevronRight size={14} className="text-slate-400" />
                                        )}
                                    </div>

                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${actionInfo.bg} ${actionInfo.text}`}>
                                        {actionInfo.label}
                                    </span>

                                    <span className="text-sm font-medium text-slate-900">
                                        {TABLE_LABELS[log.table_name] || log.table_name}
                                    </span>

                                    <span className="text-xs text-slate-400 font-mono truncate max-w-[120px]">
                                        {log.record_id.slice(0, 8)}…
                                    </span>

                                    <span className="ml-auto flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap">
                                        <Clock size={12} />
                                        {new Date(log.timestamp).toLocaleString()}
                                    </span>
                                </button>

                                {/* Expanded Details */}
                                {isExpanded && (
                                    <div className="px-4 pb-3 pl-12">
                                        <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                                            {renderChanges(log)}
                                            <div className="mt-2 pt-2 border-t border-slate-100 flex gap-4 text-xs text-slate-400">
                                                <span className="flex items-center gap-1">
                                                    <User size={11} />
                                                    {/* 0172 stamps the JWT email into changes.actor_email — far more useful than a UUID prefix */}
                                                    {(log.changes as any)?.actor_email || (log.changed_by ? log.changed_by.slice(0, 8) + '…' : 'System')}
                                                </span>
                                                <span>Record: {log.record_id}</span>
                                                <span>Table: {log.table_name}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};
