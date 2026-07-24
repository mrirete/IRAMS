/**
 * LogicTreeDiagram.tsx — Interactive Logic Tree Analysis (LTA)
 *
 * The daily workhorse for maintenance engineers doing Root Cause Failure Analysis.
 * Forces structured thinking: Physical Root → Human Root → Latent/Systemic Root.
 *
 * Data model mapping (ers_rca_nodes):
 *   Branch header   → node_type='category', cause_category='physical'|'human'|'latent'
 *   Cause under it  → node_type='why'|'root_cause', parent_id=<branch_node_id>
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Plus, Trash2, Target, Check, X, Edit3, AlertCircle, AlertTriangle, ShieldAlert } from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { RCANode, RCAEvidence, RCANodeEvidenceLink } from '../../eam/services/AnalyzeService';
import NodeEvidenceChip from './NodeEvidenceChip';

// ── Branch Definitions ──────────────────────────────────────
const LOGIC_BRANCHES = [
    {
        key: 'physical',
        label: 'Physical Root Causes',
        subtitle: 'What component/mechanism failed?',
        question: 'What physically broke, wore out, corroded, cracked, or failed?',
        color: '#ef4444',
        bgLight: '#fef2f2',
        borderLight: '#fecaca',
        icon: '🔴',
        examples: 'Bearing seizure, seal face cracking, corrosion pitting, fatigue fracture',
    },
    {
        key: 'human',
        label: 'Human Root Causes',
        subtitle: 'What human action/inaction allowed this?',
        question: 'Why did someone do (or not do) something that led to the physical failure?',
        color: '#f59e0b',
        bgLight: '#fffbeb',
        borderLight: '#fde68a',
        icon: '🟡',
        examples: 'Wrong lubricant used, torque spec not followed, inspection skipped, alarm ignored',
    },
    {
        key: 'latent',
        label: 'Latent / Systemic Root Causes',
        subtitle: 'What management system deficiency allowed this?',
        question: 'What organizational policy, procedure, training, or design gap enabled the human error?',
        color: '#8b5cf6',
        bgLight: '#f5f3ff',
        borderLight: '#ddd6fe',
        icon: '🟣',
        examples: 'No lubrication procedure, inadequate training program, no competency verification, flawed MOC process',
    },
] as const;

// ── Props ───────────────────────────────────────────────────
interface LogicTreeDiagramProps {
    investigationId: string;
    problemStatement: string;
    nodes: RCANode[];
    setNodes: React.Dispatch<React.SetStateAction<RCANode[]>>;
    saving?: boolean;
    /** Evidence pool + citations (0217). When present, each cause row gets an
     *  evidence chip; absent, the list renders as before. */
    evidence?: RCAEvidence[];
    setEvidence?: React.Dispatch<React.SetStateAction<RCAEvidence[]>>;
    links?: RCANodeEvidenceLink[];
    setLinks?: React.Dispatch<React.SetStateAction<RCANodeEvidenceLink[]>>;
}

// ── Component ───────────────────────────────────────────────
const LogicTreeDiagram: React.FC<LogicTreeDiagramProps> = ({
    investigationId,
    problemStatement,
    nodes,
    setNodes,
    saving: _saving = false,
    evidence, setEvidence, links, setLinks,
}) => {
    const [addingTo, setAddingTo] = useState<string | null>(null);
    const [newCauseText, setNewCauseText] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [busyOp, setBusyOp] = useState(false);

    // ── Auto-initialize branch headers on first load ────────
    useEffect(() => {
        // Check specifically for logic tree category nodes (not just any nodes)
        const logicCatNodes = nodes.filter(
            n => n.node_type === 'category' &&
            ['physical', 'human', 'latent'].includes(n.cause_category || '') 
        );
        // Also check by description fallback (in case cause_category wasn't set)
        const logicCatByDesc = nodes.filter(
            n => n.node_type === 'category' &&
            ['physical', 'human', 'latent'].includes(n.description)
        );
        const hasLogicBranches = logicCatNodes.length >= 3 || logicCatByDesc.length >= 3;
        
        if (!hasLogicBranches) {
            (async () => {
                const created: RCANode[] = [];
                for (const branch of LOGIC_BRANCHES) {
                    // Check if this specific branch already exists
                    const exists = nodes.find(
                        n => n.node_type === 'category' &&
                        (n.cause_category === branch.key || n.description === branch.key)
                    );
                    if (exists) continue;
                    
                    const node = await analyzeService.createRCANode({
                        investigation_id: investigationId,
                        parent_id: null,
                        node_type: 'category',
                        description: branch.key,
                        depth: 0,
                        is_root_cause: false,
                        cause_category: branch.key as any,
                        cause_code: null,
                        evidence_notes: null,
                    });
                    if (node) created.push(node);
                }
                if (created.length > 0) {
                    setNodes(prev => [...prev, ...created]);
                }
            })();
        }
    }, [investigationId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Organize nodes by branch ────────────────────────────
    const branchMap = useMemo(() => {
        const map: Record<string, { catNode: RCANode; causes: RCANode[] }> = {};
        const catNodes = nodes.filter(n => n.node_type === 'category');
        catNodes.forEach(cn => {
            const branchKey = cn.cause_category || cn.description;
            map[branchKey] = {
                catNode: cn,
                causes: nodes.filter(n =>
                    n.parent_id === cn.id &&
                    (n.node_type === 'why' || n.node_type === 'root_cause' || n.node_type === 'contributing_factor')
                ),
            };
        });
        return map;
    }, [nodes]);

    const rootCauseNodes = useMemo(() => nodes.filter(n => n.is_root_cause), [nodes]);

    // ── Completeness Check ──────────────────────────────────
    const branchCompleteness = useMemo(() => {
        return LOGIC_BRANCHES.map(b => {
            const data = branchMap[b.key];
            const hasCauses = (data?.causes.length ?? 0) > 0;
            const hasRoot = data?.causes.some(c => c.is_root_cause) ?? false;
            return { key: b.key, hasCauses, hasRoot };
        });
    }, [branchMap]);

    const allBranchesHaveCauses = branchCompleteness.every(b => b.hasCauses);

    // ── Add cause to a branch ───────────────────────────────
    const handleAddCause = useCallback(async (branchKey: string) => {
        if (!newCauseText.trim() || busyOp) return;
        const data = branchMap[branchKey];
        if (!data) return;
        setBusyOp(true);
        try {
            const node = await analyzeService.createRCANode({
                investigation_id: investigationId,
                parent_id: data.catNode.id,
                node_type: 'why',
                description: newCauseText.trim(),
                depth: 1,
                is_root_cause: false,
                cause_category: branchKey as any,
                cause_code: null,
                evidence_notes: null,
            });
            if (node) setNodes(prev => [...prev, node]);
            setNewCauseText('');
            setAddingTo(null);
        } finally {
            setBusyOp(false);
        }
    }, [newCauseText, busyOp, branchMap, investigationId, setNodes]);

    // ── Edit cause ──────────────────────────────────────────
    const handleSaveEdit = useCallback(async (nodeId: string) => {
        if (!editText.trim() || busyOp) return;
        setBusyOp(true);
        try {
            const updated = await analyzeService.updateRCANode(nodeId, { description: editText.trim() });
            if (updated) {
                setNodes(prev => prev.map(n =>
                    n.id === nodeId ? { ...n, description: editText.trim() } : n
                ));
            }
            setEditingId(null);
            setEditText('');
        } finally {
            setBusyOp(false);
        }
    }, [editText, busyOp, setNodes]);

    // ── Delete cause ────────────────────────────────────────
    const handleDelete = useCallback(async (nodeId: string) => {
        setBusyOp(true);
        try {
            await analyzeService.deleteRCANode(nodeId);
            setNodes(prev => prev.filter(n => n.id !== nodeId));
            setDeletingId(null);
        } finally {
            setBusyOp(false);
        }
    }, [setNodes]);

    // ── Toggle root cause ───────────────────────────────────
    const handleToggleRoot = useCallback(async (node: RCANode) => {
        setBusyOp(true);
        try {
            if (node.is_root_cause) {
                await analyzeService.updateRCANode(node.id, { is_root_cause: false, node_type: 'why' });
                setNodes(prev => prev.map(n =>
                    n.id === node.id ? { ...n, is_root_cause: false, node_type: 'why' } : n
                ));
            } else {
                await analyzeService.updateRCANode(node.id, { is_root_cause: true, node_type: 'root_cause' });
                setNodes(prev => prev.map(n =>
                    n.id === node.id ? { ...n, is_root_cause: true, node_type: 'root_cause' } : n
                ));
                // Update investigation summary
                const rootSummary = [...rootCauseNodes.filter(r => r.id !== node.id), node]
                    .map(n => n.description).join('; ');
                await analyzeService.updateRCAInvestigation(investigationId, {
                    root_cause_summary: rootSummary, status: 'in_progress',
                });
            }
        } finally {
            setBusyOp(false);
        }
    }, [rootCauseNodes, investigationId, setNodes]);

    // ── Get branch config ───────────────────────────────────
    const getBranchConfig = (key: string) =>
        LOGIC_BRANCHES.find(b => b.key === key) ?? LOGIC_BRANCHES[0];

    // ═════════════════════════════════════════════════════════
    //  RENDER
    // ═════════════════════════════════════════════════════════
    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-2.5 pb-2">
                <ShieldAlert size={16} className="text-blue-600" />
                <span className="text-xs font-extrabold text-blue-800 uppercase tracking-wider">
                    Logic Tree Analysis (LTA)
                </span>
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[10px] font-bold text-slate-400">
                    {nodes.filter(n => n.node_type !== 'category').length} causes identified
                </span>
            </div>

            {/* Failure Event (Top Node) */}
            <div className="flex justify-center mb-2">
                <div className="flex items-center gap-3 px-5 py-3 bg-gradient-to-r from-rose-50 to-amber-50 border-2 border-rose-300 rounded-xl max-w-xl shadow-sm">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0 animate-pulse" />
                    <div>
                        <div className="text-[9px] font-extrabold text-rose-700 uppercase tracking-wider">
                            Failure Event
                        </div>
                        <div className="text-sm font-bold text-rose-900 leading-snug">
                            {problemStatement || 'Problem statement not defined'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Connecting line from top */}
            <div className="flex justify-center">
                <div className="w-0.5 h-6 bg-gradient-to-b from-rose-300 to-slate-200" />
            </div>

            {/* Completeness Validation Banner */}
            {!allBranchesHaveCauses && nodes.filter(n => n.node_type !== 'category').length > 0 && (
                <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs">
                    <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <span className="font-bold text-amber-800">Incomplete Analysis: </span>
                        <span className="text-amber-700">
                            A Logic Tree requires causes at <strong>every layer</strong>. 
                            Don't stop at the physical cause — drill into the human error and the systemic deficiency that allowed it.
                        </span>
                    </div>
                </div>
            )}

            {/* Three Branches */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {LOGIC_BRANCHES.map((branch, branchIdx) => {
                    const data = branchMap[branch.key];
                    const causes = data?.causes ?? [];
                    const isAdding = addingTo === branch.key;
                    const completeness = branchCompleteness.find(b => b.key === branch.key);

                    return (
                        <div
                            key={branch.key}
                            className="flex flex-col border rounded-xl overflow-hidden transition-all"
                            style={{
                                borderColor: causes.length > 0 ? branch.color + '40' : '#e2e8f0',
                                background: causes.length > 0 ? branch.bgLight : '#ffffff',
                            }}
                        >
                            {/* Branch Header */}
                            <div
                                className="p-3 border-b flex items-center justify-between gap-2"
                                style={{
                                    borderBottomColor: branch.color + '25',
                                    borderLeft: `4px solid ${branch.color}`,
                                }}
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base">{branch.icon}</span>
                                        <span className="text-xs font-extrabold" style={{ color: branch.color }}>
                                            {branch.label}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 font-medium mt-0.5 leading-snug">
                                        {branch.subtitle}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {completeness?.hasCauses && (
                                        <span className="w-5 h-5 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center">
                                            <Check size={10} className="text-emerald-600" strokeWidth={3} />
                                        </span>
                                    )}
                                    <button
                                        onClick={() => { setAddingTo(isAdding ? null : branch.key); setNewCauseText(''); }}
                                        className="px-2 py-1 text-[10px] font-bold rounded-md border cursor-pointer transition-colors flex items-center gap-1"
                                        style={{
                                            background: isAdding ? '#f1f5f9' : branch.color + '10',
                                            color: isAdding ? '#64748b' : branch.color,
                                            borderColor: isAdding ? '#e2e8f0' : branch.color + '30',
                                        }}
                                    >
                                        {isAdding ? <><X size={9} /> Cancel</> : <><Plus size={9} /> Add</>}
                                    </button>
                                </div>
                            </div>

                            {/* Guiding Question */}
                            {causes.length === 0 && !isAdding && (
                                <div className="p-3 text-[11px] text-slate-400 italic leading-relaxed">
                                    <span className="font-semibold text-slate-500 not-italic block mb-1">Ask yourself:</span>
                                    {branch.question}
                                    <div className="mt-2 text-[10px] text-slate-300">
                                        <span className="font-semibold text-slate-400">Examples: </span>
                                        {branch.examples}
                                    </div>
                                </div>
                            )}

                            {/* Inline Add Form */}
                            {isAdding && (
                                <div className="p-3 border-b" style={{ borderBottomColor: branch.color + '15' }}>
                                    <div className="text-[10px] font-bold text-slate-500 mb-1.5">{branch.question}</div>
                                    <div className="flex gap-2">
                                        <input
                                            value={newCauseText}
                                            onChange={(e) => setNewCauseText(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleAddCause(branch.key);
                                                if (e.key === 'Escape') { setAddingTo(null); setNewCauseText(''); }
                                            }}
                                            placeholder={`Describe ${branch.label.toLowerCase().replace(' root causes', '')} cause…`}
                                            autoFocus
                                            className="flex-1 px-3 py-2 text-xs bg-white border rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 transition-all shadow-sm"
                                            style={{
                                                borderColor: branch.color + '40',
                                                // @ts-ignore
                                                '--tw-ring-color': branch.color + '20',
                                            }}
                                        />
                                        <button
                                            onClick={() => handleAddCause(branch.key)}
                                            disabled={!newCauseText.trim() || busyOp}
                                            className="px-3 py-2 text-xs font-bold text-white rounded-lg cursor-pointer disabled:opacity-50 transition-colors shrink-0"
                                            style={{ background: branch.color }}
                                        >
                                            <Check size={12} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Cause List */}
                            <div className="flex-1 p-2 space-y-1.5">
                                {causes.map(cause => {
                                    const isEditing = editingId === cause.id;
                                    const isDeleting = deletingId === cause.id;
                                    const isRoot = cause.is_root_cause;

                                    return (
                                        <div
                                            key={cause.id}
                                            className="flex items-start gap-2 p-2.5 rounded-lg border transition-all"
                                            style={{
                                                background: isRoot ? branch.bgLight : '#ffffff',
                                                borderColor: isRoot ? branch.color + '50' : '#e2e8f0',
                                                borderLeftWidth: 3,
                                                borderLeftColor: isRoot ? branch.color : branch.color + '30',
                                            }}
                                        >
                                            {/* Dot */}
                                            <div
                                                className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                                                style={{
                                                    background: isRoot ? branch.color : branch.color + '60',
                                                    boxShadow: isRoot ? `0 0 6px ${branch.color}50` : 'none',
                                                }}
                                            />

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                {isEditing ? (
                                                    <div className="flex gap-1.5">
                                                        <input
                                                            value={editText}
                                                            onChange={(e) => setEditText(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') handleSaveEdit(cause.id);
                                                                if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
                                                            }}
                                                            autoFocus
                                                            className="flex-1 px-2 py-1 text-xs border rounded text-slate-800 focus:outline-none"
                                                            style={{ borderColor: branch.color }}
                                                        />
                                                        <button onClick={() => handleSaveEdit(cause.id)} disabled={busyOp}
                                                            className="px-2 py-1 text-white rounded text-[10px] font-bold cursor-pointer"
                                                            style={{ background: branch.color }}><Check size={10} /></button>
                                                        <button onClick={() => { setEditingId(null); setEditText(''); }}
                                                            className="px-2 py-1 bg-slate-100 text-slate-500 border border-slate-200 rounded text-[10px] cursor-pointer">
                                                            <X size={10} /></button>
                                                    </div>
                                                ) : isDeleting ? (
                                                    <div className="flex items-center gap-2">
                                                        <AlertCircle size={11} className="text-rose-600" />
                                                        <span className="text-[11px] text-rose-800 flex-1">Delete?</span>
                                                        <button onClick={() => handleDelete(cause.id)} disabled={busyOp}
                                                            className="px-2 py-0.5 bg-rose-500 text-white rounded text-[10px] font-bold cursor-pointer">Yes</button>
                                                        <button onClick={() => setDeletingId(null)}
                                                            className="px-2 py-0.5 bg-slate-100 text-slate-500 border border-slate-200 rounded text-[10px] cursor-pointer">No</button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-start gap-1">
                                                        <span
                                                            onClick={() => { setEditingId(cause.id); setEditText(cause.description); }}
                                                            className="text-xs leading-relaxed cursor-pointer flex-1"
                                                            style={{
                                                                color: isRoot ? branch.color : '#334155',
                                                                fontWeight: isRoot ? 600 : 400,
                                                            }}
                                                            title="Click to edit"
                                                        >
                                                            {isRoot && <span className="text-[10px] mr-1">★</span>}
                                                            {cause.description}
                                                        </span>
                                                        {isRoot && (
                                                            <span className="text-[8px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 uppercase tracking-wider"
                                                                style={{
                                                                    background: branch.bgLight,
                                                                    color: branch.color,
                                                                    borderColor: branch.borderLight,
                                                                }}>Root</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            {!isEditing && !isDeleting && (
                                                <div className="flex gap-0.5 items-center shrink-0 mt-0.5">
                                                    {evidence && links && setLinks && setEvidence && (
                                                        <NodeEvidenceChip
                                                            investigationId={investigationId}
                                                            nodeId={cause.id}
                                                            evidence={evidence}
                                                            links={links}
                                                            setLinks={setLinks}
                                                            setEvidence={setEvidence}
                                                        />
                                                    )}
                                                    <button onClick={() => handleToggleRoot(cause)} disabled={busyOp}
                                                        className="p-1 rounded transition-colors cursor-pointer"
                                                        style={{ color: isRoot ? branch.color : '#d4d4d8' }}
                                                        title={isRoot ? 'Unmark Root Cause' : 'Mark as Root Cause'}>
                                                        <Target size={11} />
                                                    </button>
                                                    <button onClick={() => { setEditingId(cause.id); setEditText(cause.description); }}
                                                        className="p-1 text-slate-300 hover:text-slate-500 cursor-pointer" title="Edit">
                                                        <Edit3 size={10} />
                                                    </button>
                                                    <button onClick={() => setDeletingId(cause.id)}
                                                        className="p-1 text-slate-300 hover:text-rose-500 cursor-pointer" title="Delete">
                                                        <Trash2 size={10} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Branch Footer — count */}
                            <div className="px-3 py-2 border-t text-[10px] font-semibold flex items-center justify-between"
                                style={{ borderTopColor: '#f1f5f9', color: '#94a3b8' }}>
                                <span>{causes.length} cause{causes.length !== 1 ? 's' : ''}</span>
                                {causes.some(c => c.is_root_cause) && (
                                    <span style={{ color: branch.color }} className="font-extrabold">Root cause identified</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Root Cause Summary Strip */}
            {rootCauseNodes.length > 0 && (
                <div className="flex items-start gap-2.5 p-3.5 bg-gradient-to-r from-rose-50 via-amber-50 to-blue-50 border border-rose-200/60 rounded-xl mt-2">
                    <Target size={14} className="text-rose-600 shrink-0 mt-0.5" />
                    <div>
                        <div className="text-[10px] font-extrabold text-rose-700 uppercase tracking-wider mb-1">
                            Root Cause Summary ({rootCauseNodes.length} identified)
                        </div>
                        <div className="space-y-1">
                            {rootCauseNodes.map(rc => {
                                const branchConfig = getBranchConfig(rc.cause_category || 'physical');
                                return (
                                    <div key={rc.id} className="flex items-center gap-2 text-xs">
                                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded border uppercase tracking-wider"
                                            style={{
                                                background: branchConfig.bgLight,
                                                color: branchConfig.color,
                                                borderColor: branchConfig.borderLight,
                                            }}>
                                            {branchConfig.key}
                                        </span>
                                        <span className="font-semibold text-slate-800">{rc.description}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Corrective Action Layer Hint */}
            {rootCauseNodes.length > 0 && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                    <span className="font-bold">💡 Next Step: </span>
                    Formulate corrective actions for <strong>each cause layer</strong>. 
                    Physical fixes alone will not prevent recurrence — address human and systemic deficiencies too.
                </div>
            )}
        </div>
    );
};

export default LogicTreeDiagram;
