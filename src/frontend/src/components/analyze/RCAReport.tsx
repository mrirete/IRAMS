/**
 * RCAReport — Printable ISO 55000-compliant RCA report
 * 
 * 7 sections: Executive Summary, Event Description, Evidence, Root Causes,
 * Corrective Actions, Barriers, Risk Assessment.
 */
import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, AlertTriangle, Shield, Tag } from 'lucide-react';
import {
    analyzeService, evidenceGradeDef, bestEvidenceGrade, nodeConfidence,
    type RCAInvestigation, type RCANode, type RCAEvidence,
    type RCACorrectiveAction, type RCABarrier, type RCANodeEvidenceLink,
} from '../../eam/services/AnalyzeService';

const RCAReport: React.FC = () => {
    const { investigationId } = useParams<{ investigationId: string }>();
    const navigate = useNavigate();
    const printRef = useRef<HTMLDivElement>(null);

    const [investigation, setInvestigation] = useState<RCAInvestigation | null>(null);
    const [nodes, setNodes] = useState<RCANode[]>([]);
    const [evidence, setEvidence] = useState<RCAEvidence[]>([]);
    const [actions, setActions] = useState<RCACorrectiveAction[]>([]);
    const [barriers, setBarriers] = useState<RCABarrier[]>([]);
    const [links, setLinks] = useState<RCANodeEvidenceLink[]>([]);
    const [loading, setLoading] = useState(true);

    React.useEffect(() => {
        if (!investigationId) return;
        loadData();
    }, [investigationId]);

    const loadData = async () => {
        if (!investigationId) return;
        setLoading(true);
        try {
            const invs = await analyzeService.getRCAInvestigations();
            const inv = invs.find(i => i.id === investigationId) || null;
            const [n, e, a, b, l] = await Promise.all([
                analyzeService.getRCANodes(investigationId),
                analyzeService.getRCAEvidence(investigationId),
                analyzeService.getRCACorrectiveActions(investigationId),
                analyzeService.getRCABarriers(investigationId),
                analyzeService.getNodeEvidenceLinks(investigationId),
            ]);
            setInvestigation(inv);
            setNodes(n);
            setEvidence(e);
            setActions(a);
            setBarriers(b);
            setLinks(l);
        } catch (err) {
            console.error('Failed to load RCA data:', err);
        }
        setLoading(false);
    };

    const handlePrint = () => window.print();

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: '#94a3b8' }}>
            Loading report...
        </div>
    );

    if (!investigation) return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: '#ef4444' }}>
            Investigation not found.
        </div>
    );

    const rootCauses = nodes.filter(n => n.is_root_cause);
    const physicalCauses = rootCauses.filter(n => n.cause_category === 'physical');
    const humanCauses = rootCauses.filter(n => n.cause_category === 'human');
    const latentCauses = rootCauses.filter(n => n.cause_category === 'latent');

    const styles = {
        page: {
            maxWidth: 900, margin: '0 auto', padding: '24px 32px',
            background: 'rgba(15, 23, 42, 0.95)', color: '#e2e8f0',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
        } as React.CSSProperties,
        section: {
            marginBottom: 32, paddingBottom: 24,
            borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
        } as React.CSSProperties,
        sectionTitle: {
            fontSize: 16, fontWeight: 700, color: '#e0e7ff', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8,
        } as React.CSSProperties,
        table: {
            width: '100%', borderCollapse: 'collapse' as const, fontSize: 12,
        },
        th: {
            textAlign: 'left' as const, padding: '8px 10px',
            background: 'rgba(30, 41, 59, 0.8)', color: '#94a3b8',
            borderBottom: '1px solid #334155', fontWeight: 600, fontSize: 11,
        },
        td: {
            padding: '8px 10px', borderBottom: '1px solid rgba(51, 65, 85, 0.3)',
            color: '#cbd5e1', fontSize: 12,
        },
    };

    return (
        <>
            {/* Print-specific styles */}
            <style>{`
                @media print {
                    body { background: #fff !important; }
                    .no-print { display: none !important; }
                    .print-content { color: #000 !important; background: #fff !important; }
                    .print-content * { color: #000 !important; border-color: #ccc !important; }
                    .print-content table th { background: #f3f4f6 !important; }
                }
            `}</style>

            {/* Toolbar */}
            <div className="no-print" style={{
                position: 'sticky', top: 0, zIndex: 10,
                background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(8px)',
                borderBottom: '1px solid rgba(99, 102, 241, 0.2)',
                padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <button onClick={() => navigate(-1)} style={{
                    background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                }}>
                    <ArrowLeft size={16} /> Back to Investigation
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={handlePrint} style={{
                        background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)',
                        color: '#818cf8', padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                        fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                        <Printer size={13} /> Print / PDF
                    </button>
                </div>
            </div>

            {/* Report Content */}
            <div ref={printRef} className="print-content" style={styles.page}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{ fontSize: 10, color: '#94a3b8', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 4 }}>
                        ISO 55000 Compliant
                    </div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, color: '#e0e7ff', margin: '8px 0' }}>
                        Root Cause Analysis Report
                    </h1>
                    <div style={{ fontSize: 14, color: '#94a3b8' }}>
                        {investigation.title}
                    </div>
                    <div style={{
                        display: 'inline-flex', gap: 16, marginTop: 12, fontSize: 11, color: '#64748b',
                        background: 'rgba(30, 41, 59, 0.5)', padding: '6px 16px', borderRadius: 8,
                    }}>
                        <span>ID: {investigation.id.substring(0, 8)}</span>
                        <span>Status: {(investigation.status || 'draft').toUpperCase()}</span>
                        <span>Category: {investigation.rca_category || 'N/A'}</span>
                        <span>Created: {new Date(investigation.created_at).toLocaleDateString()}</span>
                    </div>
                </div>

                {/* 1. Executive Summary */}
                <div style={styles.section}>
                    <div style={styles.sectionTitle}>
                        <span style={{ background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>1</span>
                        Executive Summary
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.7, color: '#cbd5e1' }}>
                        <p>
                            This Root Cause Analysis was initiated for <strong>{investigation.title}</strong> affecting
                            asset <strong>{investigation.asset_id || 'N/A'}</strong> categorized as
                            <strong> {investigation.rca_category || 'asset_failure'}</strong>. The investigation identified{' '}
                            <strong>{rootCauses.length} root cause(s)</strong> ({physicalCauses.length} physical,{' '}
                            {humanCauses.length} human, {latentCauses.length} latent) and{' '}
                            <strong>{actions.length} corrective action(s)</strong> have been proposed.
                        </p>
                    </div>
                </div>

                {/* 2. Event Description */}
                <div style={styles.section}>
                    <div style={styles.sectionTitle}>
                        <span style={{ background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>2</span>
                        Event Description
                    </div>
                    <table style={styles.table}>
                        <tbody>
                            {[
                                ['Problem Statement', investigation.problem_statement || investigation.title],
                                ['What', investigation.event_what || 'Not documented'],
                                ['When', investigation.event_date || 'Not documented'],
                                ['Where', investigation.event_location || 'Not documented'],
                                ['How', investigation.event_how || 'Not documented'],
                                ['Methodology', investigation.method?.toUpperCase() || 'PROACT'],
                            ].map(([label, value]) => (
                                <tr key={label as string}>
                                    <td style={{ ...styles.td, fontWeight: 600, width: 160, color: '#94a3b8' }}>{label}</td>
                                    <td style={styles.td}>{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* 3. Evidence */}
                <div style={styles.section}>
                    <div style={styles.sectionTitle}>
                        <span style={{ background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>3</span>
                        Evidence Collected ({evidence.length})
                    </div>
                    {evidence.length > 0 ? (
                        <table style={styles.table}>
                            <thead>
                                <tr>
                                    <th style={styles.th}>Type</th>
                                    <th style={styles.th}>Title</th>
                                    <th style={styles.th}>Data Quality</th>
                                    <th style={styles.th}>Source</th>
                                    <th style={styles.th}>Collected</th>
                                </tr>
                            </thead>
                            <tbody>
                                {evidence.map(ev => {
                                    const grade = evidenceGradeDef(ev.quality_grade);
                                    return (
                                        <tr key={ev.id}>
                                            <td style={styles.td}>
                                                <span style={{
                                                    background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8',
                                                    fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                                }}>
                                                    {ev.evidence_type}
                                                </span>
                                            </td>
                                            <td style={styles.td}>{ev.title}</td>
                                            <td style={styles.td}>
                                                <span style={{
                                                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                                                    textTransform: 'uppercase',
                                                    background: grade ? `${grade.color}26` : 'rgba(148,163,184,0.15)',
                                                    color: grade ? grade.color : '#94a3b8',
                                                }}>
                                                    {grade?.label ?? 'Ungraded'}
                                                </span>
                                            </td>
                                            <td style={styles.td}>{(ev as any).source || 'Field'}</td>
                                            <td style={styles.td}>{new Date(ev.created_at).toLocaleDateString()}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    ) : (
                        <p style={{ color: '#64748b', fontSize: 12 }}>No evidence collected.</p>
                    )}
                </div>

                {/* 4. Root Causes */}
                <div style={styles.section}>
                    <div style={styles.sectionTitle}>
                        <span style={{ background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>4</span>
                        Root Causes ({rootCauses.length})
                    </div>
                    {rootCauses.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {rootCauses.map((rc, i) => (
                                <div key={rc.id} style={{
                                    background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)',
                                    borderRadius: 8, padding: 12,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <span style={{
                                            background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5',
                                            fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                        }}>
                                            RC-{i + 1}
                                        </span>
                                        <span style={{
                                            background: rc.cause_category === 'physical' ? '#3b82f622' : rc.cause_category === 'human' ? '#f59e0b22' : '#ef444422',
                                            color: rc.cause_category === 'physical' ? '#93c5fd' : rc.cause_category === 'human' ? '#fcd34d' : '#fca5a5',
                                            fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                        }}>
                                            {rc.cause_category?.toUpperCase()}
                                        </span>
                                        {rc.cause_code && (
                                            <span style={{ fontSize: 9, color: '#64748b' }}>
                                                <Tag size={9} style={{ display: 'inline', marginRight: 2 }} />
                                                ISO 14224: {rc.cause_code}
                                            </span>
                                        )}
                                        {/* Confidence from cited evidence grades */}
                                        {(() => {
                                            const conf = nodeConfidence(rc.id, evidence, links);
                                            return (
                                                <span style={{
                                                    marginLeft: 'auto', fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                                                    padding: '2px 8px', borderRadius: 10,
                                                    background: `${conf.color}26`, color: conf.color,
                                                }}>
                                                    {conf.label} · {conf.score}%
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    <p style={{ fontSize: 13, color: '#e2e8f0', margin: 0, lineHeight: 1.5 }}>
                                        {rc.description}
                                    </p>
                                    {/* Supporting evidence — what makes this claim defendable at review */}
                                    {(() => {
                                        const own = links.filter(l => l.node_id === rc.id);
                                        const byId = new Map(evidence.map(e => [e.id, e]));
                                        const cited = own
                                            .map(l => ({ link: l, ev: byId.get(l.evidence_id) }))
                                            .filter(x => x.ev) as { link: RCANodeEvidenceLink; ev: RCAEvidence }[];
                                        const supporting = cited.filter(x => x.link.relation === 'supports');
                                        const best = bestEvidenceGrade(supporting.map(x => x.ev));
                                        if (cited.length === 0) return (
                                            <p style={{ fontSize: 10, color: '#fbbf24', margin: '6px 0 0', fontWeight: 600 }}>
                                                ⚠ No evidence cited — this conclusion is an assumption.
                                            </p>
                                        );
                                        return (
                                            <div style={{ marginTop: 8 }}>
                                                <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                                                    Supporting evidence ({supporting.length}{best ? ` · best grade: ${best.label}` : ''})
                                                </div>
                                                {cited.map(({ link, ev }) => {
                                                    const grade = evidenceGradeDef(ev.quality_grade);
                                                    return (
                                                        <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#cbd5e1', padding: '2px 0' }}>
                                                            <span style={{
                                                                fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', flexShrink: 0,
                                                                padding: '1px 5px', borderRadius: 3,
                                                                background: link.relation === 'refutes' ? 'rgba(239,68,68,0.2)' : (grade ? `${grade.color}26` : 'rgba(148,163,184,0.15)'),
                                                                color: link.relation === 'refutes' ? '#fca5a5' : (grade?.color ?? '#94a3b8'),
                                                            }}>
                                                                {link.relation === 'refutes' ? 'refutes' : (grade?.label.split(' ')[0] ?? 'ungraded')}
                                                            </span>
                                                            {ev.title}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p style={{ color: '#64748b', fontSize: 12 }}>No root causes identified yet.</p>
                    )}
                </div>

                {/* 5. Corrective Actions */}
                <div style={styles.section}>
                    <div style={styles.sectionTitle}>
                        <span style={{ background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>5</span>
                        Corrective Actions ({actions.length})
                    </div>
                    {actions.length > 0 ? (
                        <table style={styles.table}>
                            <thead>
                                <tr>
                                    <th style={styles.th}>Action</th>
                                    <th style={styles.th}>Type</th>
                                    <th style={styles.th}>Status</th>
                                    <th style={styles.th}>Owner</th>
                                    <th style={styles.th}>Due Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {actions.map(action => (
                                    <tr key={action.id}>
                                        <td style={styles.td}>{action.action_description}</td>
                                        <td style={styles.td}>
                                            <span style={{
                                                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                                background: action.action_type === 'immediate' ? '#ef444422' : action.action_type === 'short_term' ? '#f59e0b22' : '#22c55e22',
                                                color: action.action_type === 'immediate' ? '#fca5a5' : action.action_type === 'short_term' ? '#fcd34d' : '#86efac',
                                            }}>
                                                {action.action_type}
                                            </span>
                                        </td>
                                        <td style={styles.td}>
                                            <span style={{
                                                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                                                background: action.status === 'completed' ? '#22c55e22' : '#f59e0b22',
                                                color: action.status === 'completed' ? '#86efac' : '#fcd34d',
                                            }}>
                                                {action.status}
                                            </span>
                                        </td>
                                        <td style={styles.td}>{action.assigned_to || 'Unassigned'}</td>
                                        <td style={styles.td}>
                                            {action.due_date ? new Date(action.due_date).toLocaleDateString() : 'Not set'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p style={{ color: '#64748b', fontSize: 12 }}>No corrective actions defined.</p>
                    )}
                </div>

                {/* 6. Barriers */}
                <div style={styles.section}>
                    <div style={styles.sectionTitle}>
                        <span style={{ background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>6</span>
                        Barriers ({barriers.length})
                    </div>
                    {barriers.length > 0 ? (
                        <table style={styles.table}>
                            <thead>
                                <tr>
                                    <th style={styles.th}>Barrier</th>
                                    <th style={styles.th}>Type</th>
                                    <th style={styles.th}>Effectiveness</th>
                                </tr>
                            </thead>
                            <tbody>
                                {barriers.map(barrier => (
                                    <tr key={barrier.id}>
                                        <td style={styles.td}>{barrier.description}</td>
                                        <td style={styles.td}>{barrier.barrier_type}</td>
                                        <td style={styles.td}>{barrier.assessment || 'N/A'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <p style={{ color: '#64748b', fontSize: 12 }}>No barriers documented.</p>
                    )}
                </div>

                {/* 7. Risk Assessment */}
                <div style={styles.section}>
                    <div style={styles.sectionTitle}>
                        <span style={{ background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4 }}>7</span>
                        Risk Assessment
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div style={{ background: 'rgba(30, 41, 59, 0.5)', borderRadius: 8, padding: 14 }}>
                            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>WITHOUT CORRECTIVE ACTIONS</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <AlertTriangle size={16} color="#ef4444" />
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#fca5a5' }}>
                                    {investigation.rca_category === 'safety' ? 'EXTREME' :
                                        investigation.rca_category === 'production' ? 'HIGH' : 'MODERATE'} RISK
                                </span>
                            </div>
                            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', lineHeight: 1.4 }}>
                                Without implementing the proposed corrective actions, the identified root causes
                                remain active and recurrence is expected.
                            </p>
                        </div>
                        <div style={{ background: 'rgba(30, 41, 59, 0.5)', borderRadius: 8, padding: 14 }}>
                            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>WITH CORRECTIVE ACTIONS</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Shield size={16} color="#22c55e" />
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#86efac' }}>
                                    CONTROLLED
                                </span>
                            </div>
                            <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', lineHeight: 1.4 }}>
                                Full implementation of {actions.length} corrective action(s) and {barriers.length} barrier(s)
                                will mitigate the identified root causes and prevent recurrence.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{ textAlign: 'center', fontSize: 10, color: '#475569', marginTop: 32, paddingTop: 16, borderTop: '1px solid #1e293b' }}>
                    <p>Generated by NEXUS EAM — Root Cause Analysis Module</p>
                    <p>Compliant with ISO 55000:2014, ISO 14224:2016, PROACT RCA Methodology</p>
                    <p>Report Date: {new Date().toLocaleDateString()} | Classification: INTERNAL</p>
                </div>
            </div>
        </>
    );
};

export default RCAReport;
