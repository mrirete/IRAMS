/**
 * NodeEvidenceChip — the evidence citation on a cause node.
 *
 * Every cause claim in an RCA (a why, a fishbone bone, a tree event) either
 * cites evidence or reads as "⚠ Assumed". The chip shows the count colored by
 * the BEST supporting grade on the data-quality ladder; clicking opens a
 * picker to link items from the investigation's evidence pool, or to capture
 * new evidence mid-analysis (the verify-opinions-with-facts loop) without
 * leaving the tool.
 *
 * Self-contained: calls analyzeService for link/unlink/create and reports
 * changes up through setLinks/setEvidence.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Link2, Plus, X } from 'lucide-react';
import analyzeService, {
    EVIDENCE_GRADES, bestEvidenceGrade,
} from '../../eam/services/AnalyzeService';
import type {
    RCAEvidence, RCANodeEvidenceLink, EvidenceQualityGrade,
} from '../../eam/services/AnalyzeService';

interface NodeEvidenceChipProps {
    investigationId: string;
    nodeId: string;
    evidence: RCAEvidence[];
    links: RCANodeEvidenceLink[];
    setLinks: React.Dispatch<React.SetStateAction<RCANodeEvidenceLink[]>>;
    setEvidence: React.Dispatch<React.SetStateAction<RCAEvidence[]>>;
}

/** Support summary for one node: linked items grouped by relation + best grade. */
export function nodeSupport(nodeId: string, evidence: RCAEvidence[], links: RCANodeEvidenceLink[]) {
    const own = links.filter(l => l.node_id === nodeId);
    const byId = new Map(evidence.map(e => [e.id, e]));
    const supports = own.filter(l => l.relation === 'supports').map(l => byId.get(l.evidence_id)).filter(Boolean) as RCAEvidence[];
    const refutes = own.filter(l => l.relation === 'refutes').map(l => byId.get(l.evidence_id)).filter(Boolean) as RCAEvidence[];
    return { links: own, supports, refutes, best: bestEvidenceGrade(supports) };
}

export const NodeEvidenceChip: React.FC<NodeEvidenceChipProps> = ({
    investigationId, nodeId, evidence, links, setLinks, setEvidence,
}) => {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [addingNew, setAddingNew] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newGrade, setNewGrade] = useState<EvidenceQualityGrade | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const { links: own, supports, refutes, best } = nodeSupport(nodeId, evidence, links);

    const toggleLink = async (ev: RCAEvidence) => {
        if (busy) return;
        setBusy(true);
        const existing = own.find(l => l.evidence_id === ev.id);
        if (existing) {
            if (await analyzeService.unlinkNodeEvidence(existing.id)) {
                setLinks(ls => ls.filter(l => l.id !== existing.id));
            }
        } else {
            const link = await analyzeService.linkNodeEvidence(nodeId, ev.id, 'supports');
            if (link) setLinks(ls => [...ls, link]);
        }
        setBusy(false);
    };

    const flipRelation = async (ev: RCAEvidence) => {
        if (busy) return;
        const existing = own.find(l => l.evidence_id === ev.id);
        if (!existing) return;
        setBusy(true);
        const next = existing.relation === 'supports' ? 'refutes' : 'supports';
        const link = await analyzeService.linkNodeEvidence(nodeId, ev.id, next);
        if (link) setLinks(ls => ls.map(l => (l.id === link.id || (l.node_id === nodeId && l.evidence_id === ev.id)) ? link : l));
        setBusy(false);
    };

    const addAndLink = async () => {
        if (!newTitle.trim() || busy) return;
        setBusy(true);
        const ev = await analyzeService.addRCAEvidence({
            investigation_id: investigationId, evidence_type: 'note',
            title: newTitle.trim(), content: null,
            linked_entity_id: null, event_timestamp: new Date().toISOString(),
            uploaded_by: null, quality_grade: newGrade,
        });
        if (ev) {
            setEvidence(es => [...es, ev]);
            const link = await analyzeService.linkNodeEvidence(nodeId, ev.id, 'supports');
            if (link) setLinks(ls => [...ls, link]);
            setNewTitle(''); setNewGrade(null); setAddingNew(false);
        }
        setBusy(false);
    };

    const chipColor = best?.color ?? '#d97706';
    const chipBg = best?.bg ?? '#fffbeb';
    const evidenced = supports.length > 0;

    return (
        <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
            <button
                onClick={() => setOpen(o => !o)}
                title={evidenced
                    ? `Supported by ${supports.length} item(s), best grade: ${best?.label ?? 'ungraded'}${refutes.length ? ` · ${refutes.length} refuting` : ''}`
                    : 'No evidence linked — this claim is assumed. Click to cite evidence.'}
                style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    padding: '2px 7px', borderRadius: 10, cursor: 'pointer',
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                    background: evidenced ? chipBg : '#fffbeb',
                    color: evidenced ? chipColor : '#b45309',
                    border: evidenced ? `1px solid ${chipColor}40` : '1px dashed #f59e0b80',
                }}
            >
                {evidenced ? <Link2 size={9} /> : <AlertTriangle size={9} />}
                {evidenced
                    ? `${supports.length}${refutes.length ? `/−${refutes.length}` : ''} ${best ? best.label.split(' ')[0] : 'evidence'}`
                    : 'Assumed'}
            </button>

            {open && (
                <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 60,
                    width: 300, maxWidth: '80vw', background: '#fff', borderRadius: 10,
                    border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
                    padding: 10,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Cite evidence
                        </span>
                        <button onClick={() => setOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}>
                            <X size={12} />
                        </button>
                    </div>

                    {evidence.length === 0 && !addingNew && (
                        <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 8px' }}>
                            No evidence collected yet — add the datum that backs this claim.
                        </p>
                    )}

                    <div style={{ maxHeight: 190, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                        {evidence.map(ev => {
                            const link = own.find(l => l.evidence_id === ev.id);
                            const gradeDef = EVIDENCE_GRADES.find(g => g.value === ev.quality_grade);
                            return (
                                <div key={ev.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px',
                                    borderRadius: 6, cursor: 'pointer',
                                    background: link ? (link.relation === 'refutes' ? '#fef2f2' : '#f0fdf4') : '#f8fafc',
                                    border: `1px solid ${link ? (link.relation === 'refutes' ? '#fecaca' : '#bbf7d0') : '#e2e8f0'}`,
                                }}>
                                    <input
                                        type="checkbox" checked={!!link} readOnly
                                        onClick={() => toggleLink(ev)}
                                        style={{ accentColor: '#22c55e', cursor: 'pointer', flexShrink: 0 }}
                                    />
                                    <div onClick={() => toggleLink(ev)} style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 11, color: '#334155', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {ev.title}
                                        </div>
                                        <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', color: gradeDef?.color ?? '#94a3b8' }}>
                                            {gradeDef?.label ?? 'ungraded'} · {ev.evidence_type}
                                        </span>
                                    </div>
                                    {link && (
                                        <button
                                            onClick={() => flipRelation(ev)}
                                            title="Flip between supports and refutes"
                                            style={{
                                                flexShrink: 0, padding: '1px 6px', borderRadius: 8, cursor: 'pointer',
                                                fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase',
                                                background: link.relation === 'refutes' ? '#fee2e2' : '#dcfce7',
                                                color: link.relation === 'refutes' ? '#b91c1c' : '#15803d',
                                                border: 'none',
                                            }}
                                        >
                                            {link.relation}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {addingNew ? (
                        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                            <input
                                value={newTitle}
                                onChange={e => setNewTitle(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') addAndLink(); }}
                                placeholder="What did you find / measure / observe?"
                                autoFocus
                                style={{
                                    width: '100%', padding: '6px 8px', fontSize: 12, boxSizing: 'border-box',
                                    border: '1px solid #e2e8f0', borderRadius: 6, color: '#1e293b', background: '#fff', marginBottom: 6,
                                }}
                            />
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
                                {EVIDENCE_GRADES.map(g => (
                                    <button key={g.value}
                                        onClick={() => setNewGrade(newGrade === g.value ? null : g.value)}
                                        title={g.caption}
                                        style={{
                                            padding: '2px 7px', fontSize: 9, fontWeight: 700, borderRadius: 8, cursor: 'pointer',
                                            background: newGrade === g.value ? g.bg : '#fff',
                                            color: newGrade === g.value ? g.color : '#94a3b8',
                                            border: `1px solid ${newGrade === g.value ? g.color + '60' : '#e2e8f0'}`,
                                        }}
                                    >
                                        {g.label.split(' ')[0]}
                                    </button>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                                <button onClick={() => { setAddingNew(false); setNewTitle(''); setNewGrade(null); }}
                                    style={{ padding: '4px 9px', fontSize: 10, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer' }}>
                                    Cancel
                                </button>
                                <button onClick={addAndLink} disabled={!newTitle.trim() || busy}
                                    style={{
                                        padding: '4px 10px', fontSize: 10, fontWeight: 700, color: '#fff',
                                        background: '#6366f1', border: 'none', borderRadius: 5, cursor: 'pointer',
                                        opacity: (!newTitle.trim() || busy) ? 0.5 : 1,
                                    }}>
                                    Add & cite
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setAddingNew(true)}
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, fontWeight: 700,
                                color: '#6366f1', background: '#eef2ff', border: '1px dashed #c7d2fe',
                            }}
                        >
                            <Plus size={11} /> New evidence found during analysis
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default NodeEvidenceChip;
