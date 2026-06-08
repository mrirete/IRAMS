import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Search, Wrench, FileText, Loader2, AlertTriangle, CheckCircle, Clock, DollarSign } from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { EAMWorkOrder } from '../../eam/services/AnalyzeService';

/* ═══════════════════════════════════════════════════════════════════
 *  WO Picker Modal — Select a Work Order to import into RCA
 * ═══════════════════════════════════════════════════════════════════ */

export interface WOPickerResult {
    wo_id: string;
    wo_number: string;
    title: string;
    description: string;
    failure_mode: string | null;
    failure_cause: string | null;
    event_date: string;
    cost: number;
}

interface WOPickerModalProps {
    assetId: string;
    onSelect: (wo: WOPickerResult) => void;
    onClose: () => void;
}

type FilterMode = 'all' | 'cm' | 'pm' | 'closed';

// ── Utilities ──────────────────────────────────────────────────

function fmtDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtCost(v: number): string {
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    CM: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
    BM: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
    EM: { bg: '#fdf2f8', text: '#c026d3', border: '#f5d0fe' },
    PM: { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    OPEN: { bg: '#eff6ff', text: '#2563eb' },
    WIP: { bg: '#fffbeb', text: '#d97706' },
    TECO: { bg: '#ecfdf5', text: '#059669' },
    CLOSED: { bg: '#f8fafc', text: '#64748b' },
    CANCELLED: { bg: '#fef2f2', text: '#dc2626' },
};

// ── Component ──────────────────────────────────────────────────

export default function WOPickerModal({ assetId, onSelect, onClose }: WOPickerModalProps) {
    const [workOrders, setWorkOrders] = useState<EAMWorkOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<FilterMode>('all');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Load WOs on mount
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        analyzeService.getAssetWorkOrders(assetId).then(wos => {
            if (!cancelled) { setWorkOrders(wos); setLoading(false); }
        }).catch(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [assetId]);

    // Close on Escape
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onClose]);

    // Filter + search
    const filtered = useMemo(() => {
        let list = workOrders;
        if (filter === 'cm') list = list.filter(w => ['CM', 'BM', 'EM'].includes(w.type));
        else if (filter === 'pm') list = list.filter(w => ['PM', 'PREVENTIVE'].includes(w.type));
        else if (filter === 'closed') list = list.filter(w => ['TECO', 'CLOSED'].includes(w.status));
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(w =>
                w.wo_number.toLowerCase().includes(q) ||
                w.title.toLowerCase().includes(q) ||
                w.description.toLowerCase().includes(q) ||
                (w.failure_mode || '').toLowerCase().includes(q)
            );
        }
        return list;
    }, [workOrders, filter, search]);

    const handleSelect = useCallback((wo: EAMWorkOrder) => {
        onSelect({
            wo_id: wo.id,
            wo_number: wo.wo_number,
            title: wo.title,
            description: wo.description,
            failure_mode: wo.failure_mode,
            failure_cause: wo.failure_cause,
            event_date: wo.created_at,
            cost: wo.total_cost,
        });
    }, [onSelect]);

    const filters: { key: FilterMode; label: string }[] = [
        { key: 'all', label: `All (${workOrders.length})` },
        { key: 'cm', label: `CM/BM/EM (${workOrders.filter(w => ['CM', 'BM', 'EM'].includes(w.type)).length})` },
        { key: 'pm', label: `PM (${workOrders.filter(w => ['PM', 'PREVENTIVE'].includes(w.type)).length})` },
        { key: 'closed', label: `Closed (${workOrders.filter(w => ['TECO', 'CLOSED'].includes(w.status)).length})` },
    ];

    return (
        <>
            <style>{`
                @keyframes wo-picker-fade { from { opacity: 0; } to { opacity: 1; } }
                @keyframes wo-picker-slide { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
            `}</style>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: 'fixed', inset: 0, zIndex: 60,
                    background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
                    animation: 'wo-picker-fade 0.2s ease-out forwards',
                }}
            />
            {/* Modal */}
            <div style={{
                position: 'fixed', zIndex: 61,
                top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: 'min(560px, calc(100vw - 32px))',
                maxHeight: 'min(680px, calc(100vh - 48px))',
                background: '#ffffff', borderRadius: 16,
                boxShadow: '0 20px 60px rgba(0,0,0,0.2), 0 4px 16px rgba(0,0,0,0.1)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                animation: 'wo-picker-slide 0.25s cubic-bezier(0.16,1,0.3,1) forwards',
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px 16px', borderBottom: '1px solid #e2e8f0',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Select Triggering Work Order</div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                            Choose a work order to import as the RCA problem source
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            width: 32, height: 32, borderRadius: 8, border: 'none',
                            background: '#f1f5f9', cursor: 'pointer', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', color: '#64748b',
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Search */}
                <div style={{ padding: '12px 24px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 10,
                        padding: '8px 12px', transition: 'border-color 0.2s',
                    }}>
                        <Search size={15} color="#94a3b8" />
                        <input
                            type="text" value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search by WO#, title, or failure mode..."
                            style={{
                                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                                fontSize: 13, color: '#0f172a',
                            }}
                        />
                    </div>
                </div>

                {/* Filters */}
                <div style={{ padding: '8px 24px 4px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {filters.map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            style={{
                                padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                                border: filter === f.key ? '1.5px solid #3b82f6' : '1.5px solid #e2e8f0',
                                background: filter === f.key ? '#eff6ff' : '#fff',
                                color: filter === f.key ? '#2563eb' : '#64748b',
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px 24px 16px' }}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, color: '#94a3b8', gap: 8 }}>
                            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                            <span style={{ fontSize: 13 }}>Loading work orders...</span>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 48 }}>
                            <div style={{
                                width: 48, height: 48, borderRadius: '50%', background: '#f1f5f9',
                                margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <FileText size={20} color="#94a3b8" />
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>
                                {workOrders.length === 0 ? 'No work orders found' : 'No matching results'}
                            </div>
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>
                                {workOrders.length === 0 ? 'This asset has no recorded work orders' : 'Try adjusting your search or filters'}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {filtered.map(wo => {
                                const tc = TYPE_COLORS[wo.type] || { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' };
                                const sc = STATUS_COLORS[wo.status] || { bg: '#f8fafc', text: '#64748b' };
                                const isExpanded = expandedId === wo.id;
                                return (
                                    <div key={wo.id} style={{
                                        border: '1.5px solid #e2e8f0', borderRadius: 12,
                                        overflow: 'hidden', transition: 'all 0.15s',
                                        boxShadow: isExpanded ? '0 4px 16px rgba(0,0,0,0.06)' : 'none',
                                    }}>
                                        {/* Card header — clickable to expand */}
                                        <div
                                            onClick={() => setExpandedId(isExpanded ? null : wo.id)}
                                            style={{
                                                padding: '12px 16px', cursor: 'pointer',
                                                background: isExpanded ? '#fafbfc' : '#fff',
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                                {/* Type badge */}
                                                <span style={{
                                                    padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800,
                                                    background: tc.bg, color: tc.text, border: `1px solid ${tc.border}`,
                                                }}>{wo.type}</span>
                                                {/* WO Number */}
                                                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a', fontSize: 13 }}>
                                                    {wo.wo_number}
                                                </span>
                                                {/* Status */}
                                                <span style={{
                                                    marginLeft: 'auto', padding: '2px 8px', borderRadius: 6,
                                                    fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.text,
                                                }}>{wo.status}</span>
                                            </div>
                                            <div style={{
                                                fontSize: 13, color: '#334155', fontWeight: 500,
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }}>
                                                {wo.title || wo.description || '—'}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    <Clock size={11} /> {fmtDate(wo.created_at)}
                                                </span>
                                                {wo.total_cost > 0 && (
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                        <DollarSign size={11} /> {fmtCost(wo.total_cost)}
                                                    </span>
                                                )}
                                                {wo.failure_mode && (
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#dc2626' }}>
                                                        <AlertTriangle size={11} /> {wo.failure_mode}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Expanded detail */}
                                        {isExpanded && (
                                            <div style={{
                                                padding: '12px 16px', borderTop: '1px solid #f1f5f9',
                                                background: '#f8fafc',
                                            }}>
                                                {wo.description && (
                                                    <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6, marginBottom: 10 }}>
                                                        {wo.description}
                                                    </div>
                                                )}
                                                {(wo.failure_mode || wo.failure_cause || wo.remedy) && (
                                                    <div style={{
                                                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                                                        background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
                                                        padding: 10, marginBottom: 10,
                                                    }}>
                                                        {wo.failure_mode && (
                                                            <div><div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 2 }}>Mode</div><div style={{ fontSize: 12, color: '#7f1d1d' }}>{wo.failure_mode}</div></div>
                                                        )}
                                                        {wo.failure_cause && (
                                                            <div><div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 2 }}>Cause</div><div style={{ fontSize: 12, color: '#7f1d1d' }}>{wo.failure_cause}</div></div>
                                                        )}
                                                        {wo.remedy && (
                                                            <div style={{ gridColumn: '1/-1' }}><div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 2 }}>Remedy</div><div style={{ fontSize: 12, color: '#7f1d1d' }}>{wo.remedy}</div></div>
                                                        )}
                                                    </div>
                                                )}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleSelect(wo); }}
                                                    style={{
                                                        width: '100%', padding: '10px 16px',
                                                        background: 'linear-gradient(135deg, #0891b2, #0284c7)',
                                                        color: '#fff', border: 'none', borderRadius: 10,
                                                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                                        boxShadow: '0 4px 14px rgba(8,145,178,0.3)',
                                                        transition: 'all 0.15s',
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(8,145,178,0.4)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(8,145,178,0.3)'; }}
                                                >
                                                    <CheckCircle size={14} />
                                                    Select as Trigger WO
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
