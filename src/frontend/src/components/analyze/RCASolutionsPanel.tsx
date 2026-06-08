/**
 * RCASolutionsPanel.tsx — Step 4: Develop Solutions & Recommendations
 *
 * Enhanced corrective actions with cause-type classification:
 *   - Physical causes (equipment/material related)
 *   - Human causes (procedural/training/fatigue)
 *   - Organizational causes (process/management/culture)
 *
 * Aligned with domain.md Step 4: "Develop solutions and recommendations"
 */
import React, { useState, useCallback } from 'react';
import {
    Plus, X, Trash2, User, Calendar,
    AlertTriangle, Settings, Building2,
    ChevronDown, ChevronRight,
} from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { RCACorrectiveAction } from '../../eam/services/AnalyzeService';

// ── Cause-type classification (domain.md Step 4) ────────────
const CAUSE_TYPES = [
    { key: 'physical',       label: 'Physical',       icon: <Settings size={11} />,   color: '#dc2626', bg: '#fef2f2', desc: 'Equipment, material, or environmental related' },
    { key: 'human',          label: 'Human',          icon: <User size={11} />,       color: '#d97706', bg: '#fffbeb', desc: 'Procedural, training, or human error' },
    { key: 'organizational', label: 'Organizational', icon: <Building2 size={11} />,  color: '#6366f1', bg: '#eef2ff', desc: 'Management, process, or cultural' },
];

const ACTION_STATUSES = [
    { key: 'recommended', label: 'Recommended', color: '#94a3b8' },
    { key: 'approved',    label: 'Approved',    color: '#3b82f6' },
    { key: 'in_progress', label: 'In Progress', color: '#d97706' },
    { key: 'completed',   label: 'Completed',   color: '#22c55e' },
    { key: 'rejected',    label: 'Rejected',    color: '#ef4444' },
];

// ── Props ────────────────────────────────────────────────────
interface RCASolutionsPanelProps {
    investigationId: string;
    actions: RCACorrectiveAction[];
    setActions: React.Dispatch<React.SetStateAction<RCACorrectiveAction[]>>;
}

// ── Component ────────────────────────────────────────────────
const RCASolutionsPanel: React.FC<RCASolutionsPanelProps> = ({
    investigationId,
    actions,
    setActions,
}) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [creating, setCreating] = useState(false);
    const [draft, setDraft] = useState({
        action_description: '',
        cause_type: 'physical' as string,
        assigned_to: '',
        due_date: '',
        risk_notes: '',
        success_metric: '',
    });
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['physical', 'human', 'organizational']));

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    // ── Add action ──────────────────────────────────────────
    const handleAdd = useCallback(async () => {
        if (!draft.action_description.trim()) return;
        setCreating(true);
        try {
            const result = await analyzeService.addRCACorrectiveAction({
                investigation_id: investigationId,
                cause_node_id: null,
                cause_category: draft.cause_type === 'physical' ? 'physical' : draft.cause_type === 'human' ? 'human' : 'latent',
                action_description: draft.action_description.trim(),
                action_type: draft.cause_type as any,
                assigned_to: draft.assigned_to.trim() || null,
                due_date: draft.due_date || null,
                status: 'open' as any,
                requires_moc: false,
                completion_date: null,
                completion_notes: null,
                risk_of_not_acting: null,
                work_order_id: null,
            });
            if (result) {
                setActions(prev => [...prev, result]);
                setDraft({
                    action_description: '', cause_type: 'physical',
                    assigned_to: '', due_date: '', risk_notes: '', success_metric: '',
                });
                setShowAddForm(false);
            }
        } catch (err) {
            console.error('[RCASolutionsPanel] Create error:', err);
        }
        setCreating(false);
    }, [investigationId, draft, setActions]);

    // ── Update action status ────────────────────────────────
    const handleStatusChange = useCallback(async (actionId: string, newStatus: string) => {
        try {
            await analyzeService.updateRCACorrectiveAction(actionId, { status: newStatus as any });
            setActions(prev => prev.map(a =>
                a.id === actionId ? { ...a, status: newStatus as any } : a
            ));
        } catch (err) { console.error('[RCASolutionsPanel] Status update error:', err); }
    }, [setActions]);

    // ── Delete action ───────────────────────────────────────
    const handleDelete = useCallback(async (id: string) => {
        try {
            await analyzeService.deleteRCACorrectiveAction(id);  // added to service
            setActions(prev => prev.filter(a => a.id !== id));
            setDeletingId(null);
        } catch (err) { console.error('[RCASolutionsPanel] Delete error:', err); }
    }, [setActions]);

    // ── Group actions by cause type ─────────────────────────
    const groupedActions = CAUSE_TYPES.map(ct => ({
        ...ct,
        items: actions.filter(a => (a as any).action_type === ct.key),
    }));
    const uncategorized = actions.filter(a => !CAUSE_TYPES.some(ct => ct.key === (a as any).action_type));

    return (
        <div style={{ padding: '16px 20px' }}>
            {/* ── Guidance card ── */}
            <div style={{
                display: 'flex', gap: 10, padding: '10px 14px', marginBottom: 16,
                background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
            }}>
                <AlertTriangle size={14} color="#16a34a" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12, color: '#15803d', lineHeight: 1.6 }}>
                    <strong>domain.md Step 4:</strong> Group root causes into <strong>Physical</strong>, <strong>Human</strong>,
                    and <strong>Organizational</strong> categories, then develop targeted corrective actions for each.
                </div>
            </div>

            {/* ── Add action button ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '6px 14px', fontSize: 11, fontWeight: 600,
                        background: showAddForm ? '#f1f5f9' : '#059669',
                        color: showAddForm ? '#64748b' : '#fff',
                        border: 'none', borderRadius: 6, cursor: 'pointer',
                    }}
                >
                    {showAddForm ? <><X size={10} /> Cancel</> : <><Plus size={10} /> Add Action</>}
                </button>
            </div>

            {/* ── Add form ── */}
            {showAddForm && (
                <div style={{
                    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
                    padding: 14, marginBottom: 16,
                }}>
                    {/* Cause type selector */}
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase' }}>
                        Cause Type
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                        {CAUSE_TYPES.map(ct => (
                            <button key={ct.key}
                                onClick={() => setDraft(d => ({ ...d, cause_type: ct.key }))}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    padding: '6px 12px', fontSize: 11, fontWeight: 600,
                                    background: draft.cause_type === ct.key ? ct.bg : '#f8fafc',
                                    color: draft.cause_type === ct.key ? ct.color : '#94a3b8',
                                    border: `1.5px solid ${draft.cause_type === ct.key ? ct.color + '50' : '#e2e8f0'}`,
                                    borderRadius: 8, cursor: 'pointer', flex: 1,
                                }}
                            >
                                {ct.icon} {ct.label}
                            </button>
                        ))}
                    </div>

                    {/* Action description */}
                    <textarea
                        value={draft.action_description}
                        onChange={e => setDraft(d => ({ ...d, action_description: e.target.value }))}
                        placeholder="Describe the corrective action..."
                        rows={2}
                        style={{
                            width: '100%', padding: '8px 10px', fontSize: 13,
                            border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b',
                            background: '#f8fafc', resize: 'vertical', boxSizing: 'border-box',
                            lineHeight: 1.6, marginBottom: 10,
                        }}
                        autoFocus
                    />

                    {/* Assignee + Due date */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                        <div>
                            <label style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>ASSIGNED TO</label>
                            <input value={draft.assigned_to}
                                onChange={e => setDraft(d => ({ ...d, assigned_to: e.target.value }))}
                                placeholder="Name or role..."
                                style={{
                                    width: '100%', padding: '6px 10px', fontSize: 12,
                                    border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b',
                                    background: '#f8fafc', marginTop: 3, boxSizing: 'border-box',
                                }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>DUE DATE</label>
                            <input type="date" value={draft.due_date}
                                onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))}
                                style={{
                                    width: '100%', padding: '6px 10px', fontSize: 12,
                                    border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b',
                                    background: '#f8fafc', marginTop: 3, boxSizing: 'border-box',
                                }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => setShowAddForm(false)}
                            style={{ padding: '6px 12px', fontSize: 11, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}>
                            Cancel
                        </button>
                        <button onClick={handleAdd} disabled={!draft.action_description.trim() || creating}
                            style={{
                                padding: '6px 14px', fontSize: 11, fontWeight: 600,
                                background: '#059669', color: '#fff', border: 'none', borderRadius: 6,
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                opacity: (!draft.action_description.trim() || creating) ? 0.5 : 1,
                            }}>
                            <Plus size={11} /> {creating ? 'Adding...' : 'Add Action'}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Grouped actions ── */}
            {groupedActions.map(group => {
                const hasItems = group.items.length > 0;
                const isExpanded = expandedGroups.has(group.key);

                return (
                    <div key={group.key} style={{
                        background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
                        marginBottom: 8, overflow: 'hidden',
                    }}>
                        <button
                            onClick={() => toggleGroup(group.key)}
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 14px', background: hasItems ? group.bg : '#f8fafc',
                                border: 'none', cursor: 'pointer',
                            }}
                        >
                            {isExpanded ? <ChevronDown size={12} color={group.color} /> : <ChevronRight size={12} color={group.color} />}
                            <span style={{ color: group.color }}>{group.icon}</span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: group.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {group.label} Causes
                            </span>
                            <span style={{
                                fontSize: 10, marginLeft: 'auto', padding: '1px 7px', borderRadius: 10,
                                background: hasItems ? group.color + '20' : '#f1f5f9',
                                color: hasItems ? group.color : '#cbd5e1',
                                fontWeight: 600,
                            }}>
                                {group.items.length}
                            </span>
                        </button>
                        {isExpanded && hasItems && (
                            <div style={{ padding: '4px 10px 10px' }}>
                                {group.items.map(action => {
                                    const sts = ACTION_STATUSES.find(s => s.key === action.status) || ACTION_STATUSES[0];
                                    const isDeleting = deletingId === action.id;

                                    return (
                                        <div key={action.id} style={{
                                            display: 'flex', gap: 8, alignItems: 'flex-start',
                                            padding: '8px 10px', background: '#f8fafc', borderRadius: 6,
                                            border: '1px solid #e2e8f0', marginTop: 4,
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>
                                                    {action.action_description}
                                                </div>
                                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                                                    {action.assigned_to && (
                                                        <span style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                            <User size={10} /> {action.assigned_to}
                                                        </span>
                                                    )}
                                                    {action.due_date && (
                                                        <span style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                            <Calendar size={10} /> {new Date(action.due_date).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                    <select
                                                        value={action.status}
                                                        onChange={e => handleStatusChange(action.id, e.target.value)}
                                                        style={{
                                                            fontSize: 10, fontWeight: 600, color: sts.color,
                                                            background: sts.color + '15', border: `1px solid ${sts.color}30`,
                                                            borderRadius: 4, padding: '1px 6px', cursor: 'pointer',
                                                            marginLeft: 'auto',
                                                        }}
                                                    >
                                                        {ACTION_STATUSES.map(s => (
                                                            <option key={s.key} value={s.key}>{s.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                            {isDeleting ? (
                                                <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                                                    <button onClick={() => handleDelete(action.id)} style={{ padding: '2px 8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Del</button>
                                                    <button onClick={() => setDeletingId(null)} style={{ padding: '2px 8px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>No</button>
                                                </div>
                                            ) : (
                                                <button onClick={() => setDeletingId(action.id)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 2, flexShrink: 0 }} title="Delete">
                                                    <Trash2 size={12} />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {isExpanded && !hasItems && (
                            <div style={{ padding: '10px 14px', fontSize: 11, color: '#cbd5e1', textAlign: 'center' }}>
                                No {group.label.toLowerCase()} cause actions yet
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Uncategorized actions (legacy) */}
            {uncategorized.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '10px 14px', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Other Actions</span>
                    {uncategorized.map(action => (
                        <div key={action.id} style={{ padding: '6px 0', fontSize: 12, color: '#475569', borderTop: '1px solid #f1f5f9', marginTop: 4 }}>
                            {action.action_description}
                            {action.assigned_to && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 6 }}>— {action.assigned_to}</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default RCASolutionsPanel;
