/**
 * ConversationalPlannerModal — AI Work Planning (Phase 5, Cap 1)
 * ══════════════════════════════════════════════════════════════
 *
 * "Plan a pump overhaul for P-101" → Full WO draft with:
 *   Tasks, BOM, Labour, Isolation, JSA, Permits
 *
 * HITL: AI generates a DRAFT — user reviews, edits, then "Create Work Order".
 * The draft auto-populates the WO form but remains fully editable.
 *
 * Standards: ISO 55000, ISO 14224, SAE JA1011, ISO 45001
 */

import React, { useState, useCallback } from 'react';
import { aiEngine } from '../../services/AIAnalysisEngine';
import type { WorkPlanDraft } from '../../services/AIAnalysisEngine';

// ── Styles ──────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        animation: 'cpOverlayIn 0.2s ease',
    },
    modal: {
        width: '100%', maxWidth: 920,
        maxHeight: '90vh', overflow: 'hidden',
        borderRadius: 20,
        background: 'linear-gradient(180deg, #0f0f1e 0%, #111128 100%)',
        border: '1px solid rgba(139, 92, 246, 0.2)',
        boxShadow: '0 30px 80px rgba(0, 0, 0, 0.5), 0 0 60px rgba(139, 92, 246, 0.08)',
        display: 'flex', flexDirection: 'column' as const,
        animation: 'cpModalIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    },
    header: {
        padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    },
    title: {
        fontSize: 18, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 10,
    },
    closeBtn: {
        background: 'rgba(255, 255, 255, 0.06)', border: 'none', color: '#94a3b8',
        width: 32, height: 32, borderRadius: 8, cursor: 'pointer', fontSize: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s',
    },
    body: {
        flex: 1, overflowY: 'auto' as const, padding: '24px',
    },
    inputSection: {
        marginBottom: 24,
    },
    label: {
        fontSize: 12, fontWeight: 600, color: '#8b5cf6', textTransform: 'uppercase' as const,
        letterSpacing: 0.8, marginBottom: 8, display: 'block',
    },
    textarea: {
        width: '100%', minHeight: 80, padding: '14px 16px', borderRadius: 12,
        background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#e2e8f0', fontSize: 14, fontFamily: '"Inter", sans-serif',
        resize: 'vertical' as const, outline: 'none', transition: 'border-color 0.2s',
        lineHeight: 1.6,
    },
    input: {
        width: '100%', padding: '10px 14px', borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)',
        color: '#e2e8f0', fontSize: 13, fontFamily: '"Inter", sans-serif',
        outline: 'none', transition: 'border-color 0.2s',
    },
    row: {
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16,
    },
    generateBtn: {
        width: '100%', padding: '14px 24px', borderRadius: 12, border: 'none',
        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
        color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'all 0.3s', marginTop: 8,
    },
    generateBtnDisabled: {
        opacity: 0.5, cursor: 'not-allowed',
    },
    hitlBanner: {
        padding: '12px 16px', borderRadius: 10,
        background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.25)',
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20,
        fontSize: 12, fontWeight: 600, color: '#fbbf24',
    },
    tabs: {
        display: 'flex', gap: 2, marginBottom: 16,
        background: 'rgba(255, 255, 255, 0.03)', borderRadius: 10, padding: 3,
    },
    tab: {
        flex: 1, padding: '8px 12px', borderRadius: 8, border: 'none',
        background: 'transparent', color: '#94a3b8', fontSize: 12, fontWeight: 600,
        cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center' as const,
    },
    tabActive: {
        background: 'rgba(139, 92, 246, 0.15)', color: '#c4b5fd',
    },
    sectionTitle: {
        fontSize: 13, fontWeight: 700, color: '#c4b5fd', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 8,
    },
    table: {
        width: '100%', borderCollapse: 'collapse' as const, fontSize: 12,
    },
    th: {
        textAlign: 'left' as const, padding: '8px 10px', fontWeight: 600,
        color: '#94a3b8', borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5,
    },
    td: {
        padding: '8px 10px', color: '#cbd5e1', borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    },
    badge: {
        display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 10,
        fontWeight: 700, textTransform: 'uppercase' as const,
    },
    summaryCard: {
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20,
    },
    summaryItem: {
        padding: '12px 14px', borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)',
        textAlign: 'center' as const,
    },
    summaryLabel: { fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
    summaryValue: { fontSize: 18, fontWeight: 700, color: '#f1f5f9', marginTop: 4 },
    footer: {
        padding: '16px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
    createBtn: {
        padding: '10px 24px', borderRadius: 10, border: 'none',
        background: 'linear-gradient(135deg, #10b981, #059669)',
        color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.3s',
    },
    cancelBtn: {
        padding: '10px 18px', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.1)',
        background: 'transparent', color: '#94a3b8', fontSize: 13, cursor: 'pointer',
    },
};

// ── Priority/Severity Colours ───────────────────────────────

const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
    emergency: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
    urgent: { bg: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24' },
    routine: { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' },
};

const RISK_COLORS: Record<string, { bg: string; color: string }> = {
    High: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
    Medium: { bg: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24' },
    Low: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' },
};

type TabKey = 'tasks' | 'bom' | 'labour' | 'isolation' | 'jsa';

// ── Component ───────────────────────────────────────────────

interface ConversationalPlannerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreateWorkOrder?: (draft: WorkPlanDraft) => void;
    assetName?: string;
    assetTag?: string;
    assetCriticality?: string;
    assetType?: string;
    equipmentClass?: string;
}

const ConversationalPlannerModal: React.FC<ConversationalPlannerModalProps> = ({
    isOpen,
    onClose,
    onCreateWorkOrder,
    assetName = '',
    assetTag = '',
    assetCriticality = 'B',
    assetType = '',
    equipmentClass = '',
}) => {
    const [request, setRequest] = useState('');
    const [inputAssetName, setInputAssetName] = useState(assetName);
    const [inputAssetTag, setInputAssetTag] = useState(assetTag);
    const [isGenerating, setIsGenerating] = useState(false);
    const [draft, setDraft] = useState<WorkPlanDraft | null>(null);
    const [activeTab, setActiveTab] = useState<TabKey>('tasks');

    const handleGenerate = useCallback(async () => {
        if (!request.trim()) return;
        setIsGenerating(true);
        setDraft(null);
        try {
            const result = await aiEngine.planWorkOrder({
                naturalLanguageRequest: request,
                assetName: inputAssetName || undefined,
                assetTag: inputAssetTag || undefined,
                assetCriticality,
                assetType: assetType || undefined,
                equipmentClass: equipmentClass || undefined,
            });
            setDraft(result);
        } catch (error) {
            console.error('[ConversationalPlanner] Generation failed:', error);
        } finally {
            setIsGenerating(false);
        }
    }, [request, inputAssetName, inputAssetTag, assetCriticality, assetType, equipmentClass]);

    const handleCreate = useCallback(() => {
        if (draft && onCreateWorkOrder) {
            onCreateWorkOrder(draft);
            onClose();
        }
    }, [draft, onCreateWorkOrder, onClose]);

    if (!isOpen) return null;

    const pri = draft ? PRIORITY_COLORS[draft.priority] || PRIORITY_COLORS.routine : PRIORITY_COLORS.routine;

    return (
        <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <style>{`
                @keyframes cpOverlayIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes cpModalIn { from { opacity: 0; transform: scale(0.95) translateY(20px); } to { opacity: 1; transform: scale(1) translateY(0); } }
                @keyframes cpPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
            `}</style>
            <div style={S.modal}>
                {/* Header */}
                <div style={S.header}>
                    <div style={S.title}>
                        <span style={{ fontSize: 22 }}>🧠</span>
                        <span>Conversational Work Planner</span>
                        <span style={{ ...S.badge, background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', fontSize: 9 }}>
                            AI POWERED
                        </span>
                    </div>
                    <button style={S.closeBtn} onClick={onClose} title="Close">✕</button>
                </div>

                {/* Body */}
                <div style={S.body}>
                    {!draft ? (
                        /* ── Input Phase ───────────────────── */
                        <>
                            <div style={S.inputSection}>
                                <label style={S.label}>What work do you need planned?</label>
                                <textarea
                                    style={S.textarea}
                                    placeholder='e.g. "Plan a pump overhaul for P-101" or "Schedule valve replacement for V-204 with confined space entry"'
                                    value={request}
                                    onChange={(e) => setRequest(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
                                    }}
                                    autoFocus
                                />
                            </div>
                            <div style={S.row}>
                                <div>
                                    <label style={S.label}>Asset Name</label>
                                    <input
                                        style={S.input}
                                        placeholder="e.g. Centrifugal Pump P-101"
                                        value={inputAssetName}
                                        onChange={(e) => setInputAssetName(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label style={S.label}>Asset Tag</label>
                                    <input
                                        style={S.input}
                                        placeholder="e.g. P-101"
                                        value={inputAssetTag}
                                        onChange={(e) => setInputAssetTag(e.target.value)}
                                    />
                                </div>
                            </div>
                            <button
                                style={{
                                    ...S.generateBtn,
                                    ...((!request.trim() || isGenerating) ? S.generateBtnDisabled : {}),
                                }}
                                onClick={handleGenerate}
                                disabled={!request.trim() || isGenerating}
                            >
                                {isGenerating ? (
                                    <>
                                        <span style={{ animation: 'cpPulse 1.5s ease-in-out infinite' }}>🧠</span>
                                        Generating Work Plan…
                                    </>
                                ) : (
                                    <>✨ Generate AI Work Plan</>
                                )}
                            </button>
                        </>
                    ) : (
                        /* ── Result Phase ──────────────────── */
                        <>
                            {/* HITL Banner */}
                            <div style={S.hitlBanner}>
                                <span style={{ fontSize: 16 }}>⚠️</span>
                                <span>AI DRAFT — Review all fields before creating the Work Order. Relantern AI advises, humans decide.</span>
                            </div>

                            {/* Summary Cards */}
                            <div style={S.summaryCard}>
                                <div style={S.summaryItem}>
                                    <div style={S.summaryLabel}>Work Type</div>
                                    <div style={S.summaryValue}>{draft.workType}</div>
                                </div>
                                <div style={S.summaryItem}>
                                    <div style={S.summaryLabel}>Priority</div>
                                    <div style={{ ...S.summaryValue, color: pri.color }}>{draft.priority}</div>
                                </div>
                                <div style={S.summaryItem}>
                                    <div style={S.summaryLabel}>Duration</div>
                                    <div style={S.summaryValue}>{draft.estimatedDuration}h</div>
                                </div>
                                <div style={S.summaryItem}>
                                    <div style={S.summaryLabel}>Est. Cost</div>
                                    <div style={S.summaryValue}>${draft.estimatedCost.toLocaleString()}</div>
                                </div>
                            </div>

                            {/* Title & Description */}
                            <div style={{ marginBottom: 16 }}>
                                <div style={S.sectionTitle}>📋 {draft.title}</div>
                                <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>{draft.description}</p>
                            </div>

                            {/* Tabs */}
                            <div style={S.tabs}>
                                {([
                                    ['tasks', `📝 Tasks (${draft.tasks.length})`],
                                    ['bom', `🔧 BOM (${draft.billOfMaterials.length})`],
                                    ['labour', `👷 Labour (${draft.labourRequirements.length})`],
                                    ['isolation', `🔒 Isolation (${draft.isolationRequirements.length})`],
                                    ['jsa', `⚠️ JSA (${draft.jsaHazards.length})`],
                                ] as [TabKey, string][]).map(([key, label]) => (
                                    <button
                                        key={key}
                                        style={{ ...S.tab, ...(activeTab === key ? S.tabActive : {}) }}
                                        onClick={() => setActiveTab(key)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            {activeTab === 'tasks' && (
                                <table style={S.table}>
                                    <thead>
                                        <tr>
                                            <th style={S.th}>#</th>
                                            <th style={S.th}>Task Description</th>
                                            <th style={S.th}>Craft</th>
                                            <th style={S.th}>Hours</th>
                                            <th style={S.th}>Safety</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {draft.tasks.map((task) => (
                                            <tr key={task.sequence}>
                                                <td style={S.td}>{task.sequence}</td>
                                                <td style={S.td}>{task.description}</td>
                                                <td style={S.td}>{task.craft}</td>
                                                <td style={S.td}>{task.estHours}h</td>
                                                <td style={S.td}>{task.safetyNote || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}

                            {activeTab === 'bom' && (
                                <table style={S.table}>
                                    <thead>
                                        <tr>
                                            <th style={S.th}>Part #</th>
                                            <th style={S.th}>Description</th>
                                            <th style={S.th}>Qty</th>
                                            <th style={S.th}>Unit Cost</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {draft.billOfMaterials.length === 0 ? (
                                            <tr><td style={{ ...S.td, fontStyle: 'italic', color: '#64748b' }} colSpan={4}>No materials identified</td></tr>
                                        ) : draft.billOfMaterials.map((item, i) => (
                                            <tr key={i}>
                                                <td style={{ ...S.td, fontFamily: 'monospace' }}>{item.partNumber}</td>
                                                <td style={S.td}>{item.description}</td>
                                                <td style={S.td}>{item.qty}</td>
                                                <td style={S.td}>{item.unitCost ? `$${item.unitCost.toFixed(2)}` : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}

                            {activeTab === 'labour' && (
                                <table style={S.table}>
                                    <thead>
                                        <tr>
                                            <th style={S.th}>Craft / Trade</th>
                                            <th style={S.th}>Headcount</th>
                                            <th style={S.th}>Hours</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {draft.labourRequirements.map((lr, i) => (
                                            <tr key={i}>
                                                <td style={S.td}>{lr.craft}</td>
                                                <td style={S.td}>{lr.headcount}</td>
                                                <td style={S.td}>{lr.hours}h</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}

                            {activeTab === 'isolation' && (
                                <table style={S.table}>
                                    <thead>
                                        <tr>
                                            <th style={S.th}>Type</th>
                                            <th style={S.th}>Isolation Point</th>
                                            <th style={S.th}>Method</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {draft.isolationRequirements.length === 0 ? (
                                            <tr><td style={{ ...S.td, fontStyle: 'italic', color: '#64748b' }} colSpan={3}>No isolation requirements identified</td></tr>
                                        ) : draft.isolationRequirements.map((iso, i) => (
                                            <tr key={i}>
                                                <td style={S.td}>{iso.isolationType}</td>
                                                <td style={S.td}>{iso.isolationPoint}</td>
                                                <td style={S.td}>{iso.method}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}

                            {activeTab === 'jsa' && (
                                <table style={S.table}>
                                    <thead>
                                        <tr>
                                            <th style={S.th}>Hazard</th>
                                            <th style={S.th}>Controls</th>
                                            <th style={S.th}>Risk</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {draft.jsaHazards.length === 0 ? (
                                            <tr><td style={{ ...S.td, fontStyle: 'italic', color: '#64748b' }} colSpan={3}>No hazards identified</td></tr>
                                        ) : draft.jsaHazards.map((jsa, i) => {
                                            const rc = RISK_COLORS[jsa.riskLevel] || RISK_COLORS.Medium;
                                            return (
                                                <tr key={i}>
                                                    <td style={S.td}>{jsa.hazard}</td>
                                                    <td style={S.td}>{jsa.controls}</td>
                                                    <td style={S.td}>
                                                        <span style={{ ...S.badge, background: rc.bg, color: rc.color }}>
                                                            {jsa.riskLevel}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}

                            {/* Permits */}
                            {draft.permitRequirements.length > 0 && (
                                <div style={{ marginTop: 16 }}>
                                    <div style={S.sectionTitle}>📄 Permit Requirements</div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
                                        {draft.permitRequirements.map((p, i) => (
                                            <span key={i} style={{ ...S.badge, background: 'rgba(251, 146, 60, 0.12)', color: '#fb923c', padding: '4px 10px', fontSize: 11 }}>
                                                {p}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* AI Confidence */}
                            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#64748b' }}>
                                <span>AI Confidence: {(draft.aiConfidence * 100).toFixed(0)}%</span>
                                <span>•</span>
                                <span>{draft.rpnRationale}</span>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                {draft && (
                    <div style={S.footer}>
                        <button style={S.cancelBtn} onClick={() => setDraft(null)}>
                            ← Back to Planning
                        </button>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button style={S.cancelBtn} onClick={onClose}>Cancel</button>
                            <button style={S.createBtn} onClick={handleCreate}>
                                ✅ Create Work Order
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ConversationalPlannerModal;
