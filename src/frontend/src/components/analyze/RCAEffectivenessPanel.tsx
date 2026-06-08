/**
 * RCAEffectivenessPanel.tsx — Step 6: Track & Verify Effectiveness
 *
 * Implements the continuous improvement loop from domain.md Step 6:
 *   - Set effectiveness review date
 *   - Record before/after metrics
 *   - Determine if solution was effective
 *   - Trigger re-investigation if not effective
 */
import React, { useState, useCallback } from 'react';
import {
    BarChart3, CheckCircle, XCircle, AlertTriangle,
    TrendingUp, TrendingDown, Clock,
    RefreshCw, Target, ArrowRight,
} from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';

// ── Props ────────────────────────────────────────────────────
interface RCAEffectivenessPanelProps {
    investigationId: string;
    rca: any;
    onRefresh?: () => void;
    onCreateFollowUp?: () => void;
}

// ── Component ────────────────────────────────────────────────
const RCAEffectivenessPanel: React.FC<RCAEffectivenessPanelProps> = ({
    investigationId,
    rca,
    onRefresh,
    onCreateFollowUp,
}) => {
    const effectivenessStatus = rca?.effectiveness_status || 'pending';
    const effectivenessDue = rca?.effectiveness_due || null;
    const [newDueDate, setNewDueDate] = useState(effectivenessDue || '');
    const [saving, setSaving] = useState(false);
    const [outcome, setOutcome] = useState<'effective' | 'partial' | 'ineffective' | ''>('');
    const [outcomeNotes, setOutcomeNotes] = useState('');
    const [showOutcomeForm, setShowOutcomeForm] = useState(false);

    // ── Save due date ────────────────────────────────────────
    const handleSetDueDate = useCallback(async () => {
        if (!newDueDate) return;
        setSaving(true);
        try {
            await analyzeService.updateRCAInvestigation(investigationId, {
                effectiveness_due: new Date(newDueDate).toISOString(),
                effectiveness_status: 'pending',
            });
            onRefresh?.();
        } catch (err) { console.error('[Effectiveness] Due date error:', err); }
        setSaving(false);
    }, [investigationId, newDueDate, onRefresh]);

    // ── Submit outcome ──────────────────────────────────────
    const handleSubmitOutcome = useCallback(async () => {
        if (!outcome) return;
        setSaving(true);
        try {
            await analyzeService.updateRCAInvestigation(investigationId, {
                effectiveness_status: outcome as any,
            });
            onRefresh?.();
            setShowOutcomeForm(false);
        } catch (err) { console.error('[Effectiveness] Outcome error:', err); }
        setSaving(false);
    }, [investigationId, outcome, onRefresh]);

    const isOverdue = effectivenessDue && new Date(effectivenessDue) < new Date() && effectivenessStatus === 'pending';
    const daysUntilDue = effectivenessDue
        ? Math.ceil((new Date(effectivenessDue).getTime() - Date.now()) / 86400000)
        : null;

    return (
        <div style={{ padding: '16px 20px' }}>
            {/* ── Guidance ── */}
            <div style={{
                display: 'flex', gap: 10, padding: '10px 14px', marginBottom: 16,
                background: '#fdf4ff', border: '1px solid #f0abfc', borderRadius: 8,
            }}>
                <RefreshCw size={14} color="#a855f7" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12, color: '#7e22ce', lineHeight: 1.6 }}>
                    <strong>domain.md Step 6:</strong> If a solution has not been effective, the team revisits
                    the RCA — this is the <strong>continuous improvement loop</strong>.
                </div>
            </div>

            {/* ── Status Card ── */}
            <div style={{
                background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
                padding: 16, marginBottom: 16,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <BarChart3 size={14} color="#ec4899" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#9d174d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Effectiveness Review
                    </span>
                    <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                        marginLeft: 'auto',
                        background: effectivenessStatus === 'effective' ? '#dcfce7'
                            : effectivenessStatus === 'ineffective' ? '#fef2f2'
                            : effectivenessStatus === 'partial' ? '#fef3c7'
                            : isOverdue ? '#fef2f2' : '#f1f5f9',
                        color: effectivenessStatus === 'effective' ? '#16a34a'
                            : effectivenessStatus === 'ineffective' ? '#dc2626'
                            : effectivenessStatus === 'partial' ? '#d97706'
                            : isOverdue ? '#dc2626' : '#94a3b8',
                    }}>
                        {effectivenessStatus === 'effective' ? '✓ Effective'
                            : effectivenessStatus === 'ineffective' ? '✗ Not Effective'
                            : effectivenessStatus === 'partial' ? '◐ Partially Effective'
                            : isOverdue ? '! Overdue' : 'Pending'}
                    </span>
                </div>

                {/* Due date setting */}
                {effectivenessStatus === 'pending' && (
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                            Review Due Date
                        </label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            <input type="date" value={newDueDate}
                                onChange={e => setNewDueDate(e.target.value)}
                                style={{
                                    flex: 1, padding: '7px 10px', fontSize: 12,
                                    border: `1px solid ${isOverdue ? '#fecaca' : '#e2e8f0'}`,
                                    borderRadius: 6, color: '#1e293b', background: '#f8fafc',
                                    boxSizing: 'border-box',
                                }}
                            />
                            <button onClick={handleSetDueDate} disabled={!newDueDate || saving}
                                style={{
                                    padding: '7px 14px', fontSize: 11, fontWeight: 600,
                                    background: '#ec4899', color: '#fff', border: 'none',
                                    borderRadius: 6, cursor: 'pointer',
                                    opacity: (!newDueDate || saving) ? 0.5 : 1,
                                }}>
                                {saving ? 'Saving...' : effectivenessDue ? 'Update' : 'Set Date'}
                            </button>
                        </div>
                        {daysUntilDue !== null && effectivenessDue && (
                            <div style={{
                                fontSize: 11, marginTop: 6,
                                color: isOverdue ? '#dc2626' : daysUntilDue <= 7 ? '#d97706' : '#64748b',
                                display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                                <Clock size={10} />
                                {isOverdue
                                    ? `Overdue by ${Math.abs(daysUntilDue)} days`
                                    : daysUntilDue === 0 ? 'Due today'
                                    : `${daysUntilDue} days until review`}
                            </div>
                        )}
                    </div>
                )}

                {/* Outcome recording */}
                {effectivenessStatus === 'pending' && effectivenessDue && (
                    <>
                        {!showOutcomeForm ? (
                            <button onClick={() => setShowOutcomeForm(true)}
                                style={{
                                    width: '100%', padding: '10px', fontSize: 12, fontWeight: 600,
                                    background: '#fdf4ff', color: '#a855f7', border: '1.5px solid #e9d5ff',
                                    borderRadius: 8, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                }}>
                                <Target size={13} /> Record Effectiveness Outcome
                            </button>
                        ) : (
                            <div style={{
                                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
                                padding: 12,
                            }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                                    Was the corrective action effective?
                                </div>
                                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                                    {[ 
                                        { key: 'effective', label: 'Effective', icon: <CheckCircle size={12} />, color: '#16a34a', bg: '#dcfce7' },
                                        { key: 'partial', label: 'Partial', icon: <AlertTriangle size={12} />, color: '#d97706', bg: '#fef3c7' },
                                        { key: 'ineffective', label: 'Not Effective', icon: <XCircle size={12} />, color: '#dc2626', bg: '#fef2f2' },
                                    ].map(opt => (
                                        <button key={opt.key}
                                            onClick={() => setOutcome(opt.key as any)}
                                            style={{
                                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                gap: 4, padding: '8px 10px', fontSize: 11, fontWeight: 600,
                                                background: outcome === opt.key ? opt.bg : '#fff',
                                                color: outcome === opt.key ? opt.color : '#94a3b8',
                                                border: `1.5px solid ${outcome === opt.key ? opt.color + '50' : '#e2e8f0'}`,
                                                borderRadius: 6, cursor: 'pointer',
                                            }}
                                        >
                                            {opt.icon} {opt.label}
                                        </button>
                                    ))}
                                </div>
                                <textarea
                                    value={outcomeNotes}
                                    onChange={e => setOutcomeNotes(e.target.value)}
                                    placeholder="Describe the outcome and any observations..."
                                    rows={2}
                                    style={{
                                        width: '100%', padding: '8px 10px', fontSize: 12,
                                        border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b',
                                        background: '#fff', resize: 'vertical', boxSizing: 'border-box',
                                        lineHeight: 1.6, marginBottom: 10,
                                    }}
                                />
                                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                    <button onClick={() => { setShowOutcomeForm(false); setOutcome(''); }}
                                        style={{ padding: '6px 12px', fontSize: 11, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' }}>
                                        Cancel
                                    </button>
                                    <button onClick={handleSubmitOutcome} disabled={!outcome || saving}
                                        style={{
                                            padding: '6px 14px', fontSize: 11, fontWeight: 600,
                                            background: '#ec4899', color: '#fff', border: 'none', borderRadius: 6,
                                            cursor: 'pointer', opacity: (!outcome || saving) ? 0.5 : 1,
                                        }}>
                                        {saving ? 'Saving...' : 'Submit Outcome'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* Result display for completed reviews */}
                {effectivenessStatus !== 'pending' && (
                    <div style={{
                        padding: '14px', borderRadius: 8, marginTop: 8,
                        background: effectivenessStatus === 'effective' ? '#f0fdf4'
                            : effectivenessStatus === 'partial' ? '#fffbeb'
                            : '#fef2f2',
                        border: `1px solid ${effectivenessStatus === 'effective' ? '#bbf7d0'
                            : effectivenessStatus === 'partial' ? '#fde68a'
                            : '#fecaca'}`,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            {effectivenessStatus === 'effective'
                                ? <TrendingUp size={14} color="#16a34a" />
                                : effectivenessStatus === 'partial'
                                ? <AlertTriangle size={14} color="#d97706" />
                                : <TrendingDown size={14} color="#dc2626" />}
                            <span style={{
                                fontSize: 13, fontWeight: 700,
                                color: effectivenessStatus === 'effective' ? '#16a34a'
                                    : effectivenessStatus === 'partial' ? '#d97706' : '#dc2626',
                            }}>
                                {effectivenessStatus === 'effective' ? 'Solution was effective ✓'
                                    : effectivenessStatus === 'partial' ? 'Partially effective — monitor'
                                    : 'Not effective — re-investigation recommended'}
                            </span>
                        </div>

                        {/* Re-investigate button for ineffective/partial */}
                        {(effectivenessStatus === 'ineffective' || effectivenessStatus === 'partial') && onCreateFollowUp && (
                            <button onClick={onCreateFollowUp}
                                style={{
                                    marginTop: 10, width: '100%', padding: '10px',
                                    fontSize: 12, fontWeight: 600,
                                    background: '#dc2626', color: '#fff', border: 'none',
                                    borderRadius: 8, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                }}>
                                <RefreshCw size={13} /> Create Follow-Up Investigation
                                <ArrowRight size={13} />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default RCAEffectivenessPanel;
