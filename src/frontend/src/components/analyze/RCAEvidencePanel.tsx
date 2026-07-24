/**
 * RCAEvidencePanel.tsx — Step 2: Collect Evidence & Data
 *
 * Inline evidence creation and data collection for RCA investigations.
 * Aligned with domain.md Step 2: "Collect Data/Evidence"
 *
 * Evidence types: note, photo, document, interview, sensor_data, timeline
 * Data collection checklist per domain.md:
 *   - What proof do we have that the problem exists?
 *   - What sequence of events leads to the problem?
 *   - How long has the problem existed?
 *   - What is the impact of the problem?
 */
import React, { useState, useCallback } from 'react';
import {
    FileText, Camera, MessageSquare, Activity, Clock,
    Plus, X, Trash2, Upload,
    ChevronDown, ChevronRight,
} from 'lucide-react';
import analyzeService, { EVIDENCE_GRADES, evidenceGradeDef } from '../../eam/services/AnalyzeService';
import type { RCAEvidence, EvidenceQualityGrade } from '../../eam/services/AnalyzeService';

// ── Evidence type configuration ─────────────────────────────
// Keys must match the DB CHECK on ers_rca_evidence.evidence_type —
// 'timeline' and 'interview' used to violate it and every add failed silently.
const EVIDENCE_TYPES = [
    { key: 'note',           label: 'Note',        icon: <MessageSquare size={12} />, color: '#d97706', bg: '#fef3c7' },
    { key: 'photo',          label: 'Photo',       icon: <Camera size={12} />,        color: '#1d4ed8', bg: '#dbeafe' },
    { key: 'document',       label: 'Document',    icon: <FileText size={12} />,      color: '#7c3aed', bg: '#f3e8ff' },
    { key: 'interview',      label: 'Interview',   icon: <MessageSquare size={12} />, color: '#059669', bg: '#d1fae5' },
    { key: 'sensor_data',    label: 'Sensor Data', icon: <Activity size={12} />,      color: '#dc2626', bg: '#fee2e2' },
    { key: 'timeline_event', label: 'Timeline',    icon: <Clock size={12} />,         color: '#6366f1', bg: '#e0e7ff' },
] as const;

/** Small colored pill showing an item's data-quality grade (gray "Ungraded" when null). */
export const EvidenceGradeBadge: React.FC<{ grade: EvidenceQualityGrade | null | undefined; size?: number }> = ({ grade, size = 9 }) => {
    const def = evidenceGradeDef(grade);
    return (
        <span style={{
            fontSize: size, fontWeight: 700, textTransform: 'uppercase',
            padding: '2px 6px', borderRadius: 3, flexShrink: 0,
            background: def?.bg ?? '#f1f5f9', color: def?.color ?? '#94a3b8',
        }}>
            {def?.label ?? 'Ungraded'}
        </span>
    );
};

// ── Data collection checklist (domain.md Step 2) ────────────
const CHECKLIST_ITEMS = [
    { id: 'proof',    question: 'What proof do we have that the problem exists?' },
    { id: 'sequence', question: 'What sequence of events leads to the problem?' },
    { id: 'duration', question: 'How long has the problem existed?' },
    { id: 'impact',   question: 'What is the impact of the problem?' },
];

// ── Props ────────────────────────────────────────────────────
interface RCAEvidencePanelProps {
    investigationId: string;
    evidence: RCAEvidence[];
    setEvidence: React.Dispatch<React.SetStateAction<RCAEvidence[]>>;
}

// ── Component ────────────────────────────────────────────────
const RCAEvidencePanel: React.FC<RCAEvidencePanelProps> = ({
    investigationId,
    evidence,
    setEvidence,
}) => {
    const [showAddForm, setShowAddForm] = useState(false);
    const [newType, setNewType] = useState<string>('note');
    const [newGrade, setNewGrade] = useState<EvidenceQualityGrade | null>(null);
    const [newTitle, setNewTitle] = useState('');
    const [newContent, setNewContent] = useState('');
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showChecklist, setShowChecklist] = useState(true);
    const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

    const typeConfig = EVIDENCE_TYPES.find(t => t.key === newType) || EVIDENCE_TYPES[0];

    // ── Add evidence ────────────────────────────────────────
    const handleAdd = useCallback(async () => {
        if (!newTitle.trim()) return;
        setCreating(true);
        try {
            const result = await analyzeService.addRCAEvidence({
                investigation_id: investigationId,
                evidence_type: newType as any,
                title: newTitle.trim(),
                content: newContent.trim() || null,
                linked_entity_id: null,
                event_timestamp: new Date().toISOString(),
                uploaded_by: null,
                quality_grade: newGrade,
            });
            if (result) {
                setEvidence(prev => [...prev, result]);
                setNewTitle('');
                setNewContent('');
                setNewGrade(null);
                setShowAddForm(false);
            }
        } catch (err) {
            console.error('[RCAEvidencePanel] Create error:', err);
        }
        setCreating(false);
    }, [investigationId, newType, newGrade, newTitle, newContent, setEvidence]);

    // ── Delete evidence ─────────────────────────────────────
    const handleDelete = useCallback(async (id: string) => {
        try {
            await analyzeService.deleteRCAEvidence(id);
            setEvidence(prev => prev.filter(e => e.id !== id));
            setDeletingId(null);
        } catch (err) {
            console.error('[RCAEvidencePanel] Delete error:', err);
        }
    }, [setEvidence]);

    const toggleCheckItem = (id: string) => {
        setCheckedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    return (
        <div style={{ padding: '16px 20px' }}>
            {/* ── Data Collection Checklist ── */}
            <div style={{
                background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
                marginBottom: 16, overflow: 'hidden',
            }}>
                <button
                    onClick={() => setShowChecklist(!showChecklist)}
                    style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer',
                    }}
                >
                    {showChecklist ? <ChevronDown size={14} color="#6366f1" /> : <ChevronRight size={14} color="#6366f1" />}
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Data Collection Checklist
                    </span>
                    <span style={{
                        fontSize: 10, marginLeft: 'auto', padding: '2px 8px', borderRadius: 10,
                        background: checkedItems.size === CHECKLIST_ITEMS.length ? '#dcfce7' : '#f1f5f9',
                        color: checkedItems.size === CHECKLIST_ITEMS.length ? '#16a34a' : '#94a3b8',
                        fontWeight: 600,
                    }}>
                        {checkedItems.size}/{CHECKLIST_ITEMS.length}
                    </span>
                </button>
                {showChecklist && (
                    <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {CHECKLIST_ITEMS.map(item => {
                            const checked = checkedItems.has(item.id);
                            return (
                                <label key={item.id} style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px',
                                    background: checked ? '#f0fdf4' : '#f8fafc', borderRadius: 6, cursor: 'pointer',
                                    border: `1px solid ${checked ? '#bbf7d0' : '#e2e8f0'}`,
                                    transition: 'all 0.15s',
                                }}>
                                    <input
                                        type="checkbox" checked={checked}
                                        onChange={() => toggleCheckItem(item.id)}
                                        style={{ marginTop: 2, accentColor: '#22c55e' }}
                                    />
                                    <span style={{
                                        fontSize: 12, color: checked ? '#15803d' : '#475569', lineHeight: 1.5,
                                        textDecoration: checked ? 'line-through' : 'none',
                                    }}>
                                        {item.question}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Evidence List ── */}
            <div style={{
                background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
                padding: 16,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <FileText size={14} color="#6366f1" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Evidence & Observations
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {/* Quality mix — the ladder at a glance */}
                        {EVIDENCE_GRADES.map(g => {
                            const n = evidence.filter(e => e.quality_grade === g.value).length;
                            return n > 0 ? (
                                <span key={g.value} title={g.label}
                                    style={{ fontSize: 10, fontWeight: 700, color: g.color, background: g.bg, padding: '1px 6px', borderRadius: 8 }}>
                                    {g.label.split(' ')[0]} · {n}
                                </span>
                            ) : null;
                        })}
                        {evidence.some(e => !e.quality_grade) && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', background: '#f1f5f9', padding: '1px 6px', borderRadius: 8 }}>
                                {evidence.filter(e => !e.quality_grade).length} ungraded
                            </span>
                        )}
                        {evidence.length} items
                    </span>
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px',
                            background: showAddForm ? '#f1f5f9' : '#6366f115', color: showAddForm ? '#64748b' : '#6366f1',
                            border: `1px solid ${showAddForm ? '#e2e8f0' : '#6366f130'}`,
                            borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}
                    >
                        {showAddForm ? <><X size={10} /> Cancel</> : <><Plus size={10} /> Add</>}
                    </button>
                </div>

                {/* Add form */}
                {showAddForm && (
                    <div style={{
                        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                        padding: 12, marginBottom: 12,
                    }}>
                        {/* Type selector */}
                        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
                            {EVIDENCE_TYPES.map(t => (
                                <button key={t.key}
                                    onClick={() => setNewType(t.key)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        padding: '4px 10px', fontSize: 10, fontWeight: 600,
                                        background: newType === t.key ? t.bg : '#fff',
                                        color: newType === t.key ? t.color : '#94a3b8',
                                        border: `1px solid ${newType === t.key ? t.color + '40' : '#e2e8f0'}`,
                                        borderRadius: 6, cursor: 'pointer',
                                    }}
                                >
                                    {t.icon} {t.label}
                                </button>
                            ))}
                        </div>
                        {/* Data-quality ladder — grade what this datum actually is.
                            Facts at the top, hearsay at the bottom; ungraded items
                            never count toward completing the Collect step. */}
                        <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
                                Data Quality — target for facts
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {EVIDENCE_GRADES.map(g => {
                                    const selected = newGrade === g.value;
                                    return (
                                        <button key={g.value}
                                            onClick={() => setNewGrade(selected ? null : g.value)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 8,
                                                padding: '5px 10px', textAlign: 'left',
                                                background: selected ? g.bg : '#fff',
                                                border: `1px solid ${selected ? g.color + '60' : '#e2e8f0'}`,
                                                borderRadius: 6, cursor: 'pointer',
                                            }}
                                        >
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, flexShrink: 0, opacity: selected ? 1 : 0.45 }} />
                                            <span style={{ fontSize: 11, fontWeight: 700, color: selected ? g.color : '#475569', minWidth: 92 }}>{g.label}</span>
                                            <span style={{ fontSize: 10, color: selected ? g.color : '#94a3b8', lineHeight: 1.3 }}>{g.caption}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <input
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            placeholder={`${typeConfig.label} title...`}
                            style={{
                                width: '100%', padding: '8px 10px', fontSize: 13,
                                border: `1px solid ${typeConfig.color}40`, borderRadius: 6,
                                color: '#1e293b', background: '#fff', marginBottom: 8,
                                boxSizing: 'border-box',
                            }}
                            autoFocus
                        />
                        <textarea
                            value={newContent}
                            onChange={e => setNewContent(e.target.value)}
                            placeholder="Description / notes (optional)..."
                            rows={3}
                            style={{
                                width: '100%', padding: '8px 10px', fontSize: 12,
                                border: '1px solid #e2e8f0', borderRadius: 6,
                                color: '#1e293b', background: '#fff', resize: 'vertical',
                                boxSizing: 'border-box', lineHeight: 1.6, marginBottom: 8,
                            }}
                        />
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button onClick={() => setShowAddForm(false)}
                                style={{ padding: '6px 12px', fontSize: 11, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}>
                                Cancel
                            </button>
                            <button onClick={handleAdd} disabled={!newTitle.trim() || creating}
                                style={{
                                    padding: '6px 14px', fontSize: 11, fontWeight: 600,
                                    background: typeConfig.color, color: '#fff', border: 'none', borderRadius: 6,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                    opacity: (!newTitle.trim() || creating) ? 0.5 : 1,
                                }}>
                                <Plus size={11} /> {creating ? 'Adding...' : 'Add Evidence'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Evidence items */}
                {evidence.length === 0 && !showAddForm && (
                    <div style={{ textAlign: 'center', padding: '20px 0', color: '#cbd5e1' }}>
                        <Upload size={20} style={{ margin: '0 auto 6px', display: 'block', opacity: 0.5 }} />
                        <p style={{ fontSize: 12, margin: 0 }}>No evidence collected yet</p>
                        <p style={{ fontSize: 11, margin: '4px 0 0', color: '#94a3b8' }}>
                            Add notes, photos, documents, or sensor data
                        </p>
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {evidence.map(ev => {
                        const config = EVIDENCE_TYPES.find(t => t.key === ev.evidence_type) || EVIDENCE_TYPES[0];
                        const isDeleting = deletingId === ev.id;

                        return (
                            <div key={ev.id} style={{
                                display: 'flex', gap: 8, alignItems: 'flex-start',
                                padding: '8px 10px', background: '#f8fafc', borderRadius: 6,
                                border: '1px solid #e2e8f0',
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, marginTop: 2, alignItems: 'flex-start' }}>
                                    <span style={{
                                        fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                                        padding: '2px 6px', borderRadius: 3,
                                        background: config.bg, color: config.color,
                                    }}>
                                        {config.label}
                                    </span>
                                    <EvidenceGradeBadge grade={ev.quality_grade} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, color: '#334155', fontWeight: 500 }}>{ev.title}</div>
                                    {(ev as any).content && (
                                        <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0 0', lineHeight: 1.4 }}>
                                            {(ev as any).content}
                                        </p>
                                    )}
                                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                                        {ev.event_timestamp ? new Date(ev.event_timestamp).toLocaleString() : ''}
                                        {ev.uploaded_by && ` · ${ev.uploaded_by}`}
                                    </div>
                                </div>
                                {isDeleting ? (
                                    <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                                        <button onClick={() => handleDelete(ev.id)}
                                            style={{ padding: '2px 8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                                            Yes
                                        </button>
                                        <button onClick={() => setDeletingId(null)}
                                            style={{ padding: '2px 8px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>
                                            No
                                        </button>
                                    </div>
                                ) : (
                                    <button onClick={() => setDeletingId(ev.id)}
                                        style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 2, flexShrink: 0 }}
                                        title="Delete">
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default RCAEvidencePanel;
