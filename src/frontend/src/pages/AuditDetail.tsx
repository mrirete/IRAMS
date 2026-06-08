import React, { useState, useMemo } from 'react';
import { ArrowLeft, Users, ClipboardList, AlertTriangle, CheckCircle, Play, Award, ChevronDown, ChevronRight, Plus, X, Download, Sparkles, Loader2 } from 'lucide-react';
import { MATURITY_LEVELS } from '../types/audit';
import type { AuditResponse, AuditFindingType, FindingSeverity, ParticipantRole, AuditAIRecommendation } from '../types/audit';

type Tab = 'assessment' | 'team' | 'findings' | 'results';

export const AuditDetail: React.FC<{ ctx: any; onBack: () => void }> = ({ ctx, onBack }) => {
    const { selectedAudit: audit, responses, sectionScores, submitResponse, calculateScores, addParticipant, removeParticipant, createFinding, updateStatus, runAIAnalysis, exportPDF, aiLoading } = ctx;
    const [tab, setTab] = useState<Tab>('assessment');
    const [expandedSec, setExpandedSec] = useState<string | null>(null);
    const [showAddTeam, setShowAddTeam] = useState(false);
    const [showAddFinding, setShowAddFinding] = useState(false);

    // Team form
    const [tf, setTf] = useState({ full_name: '', company: '', email: '', mobile: '', job_title: '', participant_role: 'auditor' as ParticipantRole, certifications: [] as string[] });
    // Finding form
    const [ff, setFf] = useState({ finding_type: 'observation' as AuditFindingType, severity: 'medium' as FindingSeverity, description: '', standard_reference: '', evidence: '' });

    if (!audit) return null;

    const template = audit.template;
    const sections = template?.sections || [];
    const responseMap = useMemo(() => new Map(responses.map((r: AuditResponse) => [r.question_id, r])), [responses]);

    const getMaturityColor = (score: number) => MATURITY_LEVELS[Math.min(Math.round(score), 5)]?.color || '#94a3b8';

    const handleScore = async (questionId: string, sectionId: string, score: number) => {
        await submitResponse({
            audit_id: audit.id, question_id: questionId, section_id: sectionId,
            maturity_score: score, compliance_answer: null, evidence_notes: '', evidence_attachments: [],
        });
    };

    const handleAddTeam = async () => {
        if (!tf.full_name || !tf.email) return;
        await addParticipant({ ...tf, audit_id: audit.id, contact_id: null, signed_off: false, signed_at: null });
        setTf({ full_name: '', company: '', email: '', mobile: '', job_title: '', participant_role: 'auditor', certifications: [] });
        setShowAddTeam(false);
    };

    const handleAddFinding = async () => {
        if (!ff.description) return;
        await createFinding({ audit_id: audit.id, finding_number: `F-${Date.now().toString(36).toUpperCase()}`, ...ff, status: 'open', raised_by: 'current_user' });
        setFf({ finding_type: 'observation', severity: 'medium', description: '', standard_reference: '', evidence: '' });
        setShowAddFinding(false);
    };

    const TABS: { key: Tab; label: string; icon: any; count?: number }[] = [
        { key: 'assessment', label: 'Assessment', icon: ClipboardList, count: sections.length },
        { key: 'team', label: 'Team', icon: Users, count: audit.participants?.length || 0 },
        { key: 'findings', label: 'Findings', icon: AlertTriangle, count: audit.total_findings },
        { key: 'results', label: 'Results', icon: Award },
    ];

    return (
        <div className="space-y-4 pb-20">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button onClick={onBack} className="p-2 text-slate-500 hover:text-brand-200 hover:bg-slate-100 rounded-lg"><ArrowLeft size={20} /></button>
                <div className="flex-1">
                    <h1 className="text-xl font-bold text-slate-800 tracking-tight">{audit.audit_number}</h1>
                    <p className="text-xs text-slate-400">{template?.name || audit.scope} · <span className="capitalize">{audit.status.replace(/_/g, ' ')}</span></p>
                </div>
                <div className="flex gap-2">
                    <button onClick={exportPDF} className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg flex items-center gap-1.5 hover:bg-slate-200"><Download size={14} />PDF Report</button>
                    {sectionScores.length > 0 && <button onClick={() => runAIAnalysis(audit.id)} disabled={aiLoading} className="px-3 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-50">{aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{aiLoading ? 'Analyzing…' : 'AI Analysis'}</button>}
                    {audit.status === 'planned' && <button onClick={() => updateStatus(audit.id, 'in_progress')} className="px-3 py-2 bg-accent-cyan text-white text-xs font-bold rounded-lg flex items-center gap-1.5"><Play size={14} />Start</button>}
                    {audit.status === 'in_progress' && <button onClick={() => calculateScores(audit.id)} className="px-3 py-2 bg-purple-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"><Award size={14} />Calculate Maturity</button>}
                    {audit.status === 'in_progress' && <button onClick={() => updateStatus(audit.id, 'completed')} className="px-3 py-2 bg-green-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"><CheckCircle size={14} />Complete</button>}
                </div>
            </div>

            {/* Maturity Banner */}
            {audit.overall_maturity != null && (
                <div className="bg-gradient-to-r from-brand-800 to-brand-600 rounded-xl p-5 flex items-center justify-between">
                    <div>
                        <p className="text-brand-400 text-xs uppercase font-bold tracking-wider">Overall Maturity Score (IAM 0–5)</p>
                        <div className="flex items-end gap-3 mt-1">
                            <span className="text-4xl font-black text-white">{audit.overall_maturity.toFixed(1)}</span>
                            <span className="text-lg font-bold mb-1" style={{ color: getMaturityColor(audit.overall_maturity) }}>{MATURITY_LEVELS[Math.min(Math.round(audit.overall_maturity), 5)]?.label}</span>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-brand-400 text-xs uppercase font-bold">Compliance</p>
                        <span className="text-3xl font-black text-white">{audit.overall_compliance_pct || 0}%</span>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-colors ${tab === t.key ? 'bg-brand-800 text-white' : 'text-slate-500 hover:text-brand-200 hover:bg-slate-50'}`}>
                        <t.icon size={14} />{t.label}{t.count != null && <span className={`ml-1 px-1.5 py-0.5 text-[10px] rounded-full ${tab === t.key ? 'bg-white/20' : 'bg-slate-100'}`}>{t.count}</span>}
                    </button>
                ))}
            </div>

            {/* TAB: Assessment */}
            {tab === 'assessment' && (
                <div className="space-y-2">
                    {!template ? <div className="bg-white border rounded-lg p-8 text-center text-slate-400 text-sm">No template linked. Attach a template to enable maturity assessment.</div> : (
                        sections.map((sec: any) => (
                            <div key={sec.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                                <button onClick={() => setExpandedSec(expandedSec === sec.id ? null : sec.id)} className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        {expandedSec === sec.id ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                                        <span className="text-xs font-mono font-bold text-accent-cyan">{sec.code}</span>
                                        <span className="text-sm font-semibold text-slate-800">{sec.title}</span>
                                        <span className="text-[10px] text-slate-400">({(sec.questions || []).length} questions)</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {(() => { const answered = (sec.questions || []).filter((q: any) => responseMap.has(q.id)).length; const total = (sec.questions || []).length; return (<><div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-accent-cyan rounded-full transition-all" style={{ width: `${total > 0 ? (answered / total) * 100 : 0}%` }} /></div><span className="text-[10px] text-slate-400 font-mono">{answered}/{total}</span></>); })()}
                                    </div>
                                </button>
                                {expandedSec === sec.id && (
                                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                                        {(sec.questions || []).map((q: any) => {
                                            const resp = responseMap.get(q.id);
                                            return (
                                                <div key={q.id} className="px-5 py-4">
                                                    <div className="flex items-start gap-3">
                                                        <span className="text-[10px] font-mono font-bold text-brand-400 bg-brand-800/30 px-1.5 py-0.5 rounded mt-0.5 shrink-0">{q.code}</span>
                                                        <div className="flex-1">
                                                            <p className="text-sm text-slate-800 leading-relaxed">{q.question_text}</p>
                                                            {q.guidance_notes && <p className="text-xs text-slate-400 mt-1 italic">Guidance: {q.guidance_notes}</p>}
                                                        </div>
                                                    </div>
                                                    {/* Maturity Scoring Buttons */}
                                                    <div className="flex gap-1.5 mt-3 ml-8">
                                                        {MATURITY_LEVELS.map(level => (
                                                            <button key={level.value} onClick={() => handleScore(q.id, sec.id, level.value)}
                                                                title={`${level.value} — ${level.label}: ${level.description}`}
                                                                className={`w-10 h-10 rounded-lg text-sm font-bold border-2 transition-all ${resp?.maturity_score === level.value
                                                                    ? 'scale-110 shadow-lg text-white' : 'bg-white text-slate-400 border-slate-200 hover:border-current hover:scale-105'}`}
                                                                style={resp?.maturity_score === level.value ? { backgroundColor: level.color, borderColor: level.color } : { ['--tw-border-opacity' as any]: 1 }}>
                                                                {level.value}
                                                            </button>
                                                        ))}
                                                        <span className="text-[10px] text-slate-400 self-center ml-2">{resp?.maturity_score != null ? MATURITY_LEVELS[resp.maturity_score]?.label : 'Not scored'}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* TAB: Team */}
            {tab === 'team' && (
                <div className="space-y-3">
                    <div className="flex justify-between items-center"><h3 className="text-sm font-bold text-slate-800">Audit Participants</h3><button onClick={() => setShowAddTeam(true)} className="px-3 py-1.5 bg-accent-cyan/10 text-accent-cyan text-xs font-bold rounded-lg hover:bg-accent-cyan/20"><Plus size={14} className="inline mr-1" />Add</button></div>
                    {(audit.participants || []).length === 0 ? <div className="bg-white border rounded-lg p-8 text-center text-slate-400 text-sm">No team registered.</div> : (
                        <div className="grid gap-2">
                            {audit.participants.map((p: any) => (
                                <div key={p.id} className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-full bg-brand-800/40 text-brand-200 flex items-center justify-center text-sm font-bold">{p.full_name?.charAt(0)}</div>
                                        <div><p className="text-sm font-semibold text-slate-800">{p.full_name}</p><p className="text-xs text-slate-400">{p.company} · {p.email}</p></div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 text-[10px] font-bold bg-brand-800/30 text-brand-200 rounded capitalize">{p.participant_role.replace(/_/g, ' ')}</span>
                                        {p.certifications?.length > 0 && <span className="text-[10px] text-accent-cyan font-bold">{p.certifications.join(', ')}</span>}
                                        <button onClick={() => removeParticipant(p.id)} className="p-1 text-red-400 hover:text-red-600 rounded"><X size={14} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {showAddTeam && (
                        <div className="bg-white border-2 border-accent-cyan/30 rounded-lg p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <input value={tf.full_name} onChange={e => setTf(f => ({ ...f, full_name: e.target.value }))} placeholder="Full Name *" className="input-field" />
                                <input value={tf.company} onChange={e => setTf(f => ({ ...f, company: e.target.value }))} placeholder="Company" className="input-field" />
                                <input type="email" value={tf.email} onChange={e => setTf(f => ({ ...f, email: e.target.value }))} placeholder="Email *" className="input-field" />
                                <input value={tf.mobile} onChange={e => setTf(f => ({ ...f, mobile: e.target.value }))} placeholder="Mobile" className="input-field" />
                                <input value={tf.job_title} onChange={e => setTf(f => ({ ...f, job_title: e.target.value }))} placeholder="Job Title" className="input-field" />
                                <select value={tf.participant_role} onChange={e => setTf(f => ({ ...f, participant_role: e.target.value as ParticipantRole }))} className="input-field">{['lead_auditor', 'auditor', 'auditee', 'observer', 'subject_matter_expert'].map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select>
                            </div>
                            <div className="flex gap-2"><button onClick={handleAddTeam} className="px-4 py-2 bg-accent-cyan text-white text-xs font-bold rounded-lg">Save</button><button onClick={() => setShowAddTeam(false)} className="px-4 py-2 text-slate-500 text-xs">Cancel</button></div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB: Findings */}
            {tab === 'findings' && (
                <div className="space-y-3">
                    <div className="flex justify-between items-center"><h3 className="text-sm font-bold text-slate-800">Audit Findings</h3><button onClick={() => setShowAddFinding(true)} className="px-3 py-1.5 bg-orange-500/10 text-orange-500 text-xs font-bold rounded-lg hover:bg-orange-500/20"><Plus size={14} className="inline mr-1" />Raise Finding</button></div>
                    {(audit.findings || []).length === 0 ? <div className="bg-white border rounded-lg p-8 text-center text-slate-400 text-sm">No findings recorded.</div> : (
                        <div className="space-y-2">
                            {audit.findings.map((f: any) => (
                                <div key={f.id} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-mono font-bold text-slate-500">{f.finding_number}</span>
                                            <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${f.severity === 'critical' ? 'bg-red-500/10 text-red-500' : f.severity === 'high' ? 'bg-orange-500/10 text-orange-500' : 'bg-yellow-500/10 text-yellow-600'}`}>{f.severity.toUpperCase()}</span>
                                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-500 rounded capitalize">{f.finding_type.replace(/_/g, ' ')}</span>
                                        </div>
                                        <span className={`text-xs font-bold capitalize ${f.status === 'open' ? 'text-orange-500' : f.status === 'closed' ? 'text-green-500' : 'text-blue-500'}`}>{f.status}</span>
                                    </div>
                                    <p className="text-sm text-slate-700 mt-2">{f.description}</p>
                                    {f.standard_reference && <p className="text-xs text-slate-400 mt-1">Ref: {f.standard_reference}</p>}
                                </div>
                            ))}
                        </div>
                    )}
                    {showAddFinding && (
                        <div className="bg-white border-2 border-orange-400/30 rounded-lg p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <select value={ff.finding_type} onChange={e => setFf(f => ({ ...f, finding_type: e.target.value as AuditFindingType }))} className="input-field">
                                    {['major_nc', 'minor_nc', 'observation', 'opportunity', 'positive_practice'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                                </select>
                                <select value={ff.severity} onChange={e => setFf(f => ({ ...f, severity: e.target.value as FindingSeverity }))} className="input-field">
                                    {['critical', 'high', 'medium', 'low'].map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <textarea value={ff.description} onChange={e => setFf(f => ({ ...f, description: e.target.value }))} placeholder="Finding description…" rows={3} className="input-field resize-none w-full" />
                            <input value={ff.standard_reference} onChange={e => setFf(f => ({ ...f, standard_reference: e.target.value }))} placeholder="Standard reference (e.g. ISO 55001 Clause 8.1)" className="input-field w-full" />
                            <div className="flex gap-2"><button onClick={handleAddFinding} className="px-4 py-2 bg-orange-500 text-white text-xs font-bold rounded-lg">Raise Finding</button><button onClick={() => setShowAddFinding(false)} className="px-4 py-2 text-slate-500 text-xs">Cancel</button></div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB: Results */}
            {tab === 'results' && (
                <div className="space-y-4">
                    {sectionScores.length === 0 && audit.overall_maturity == null ? (
                        <div className="bg-white border rounded-lg p-8 text-center"><Award size={40} className="mx-auto text-slate-300 mb-3" /><p className="text-slate-400 text-sm">Complete the assessment and click "Calculate Maturity" to see results.</p></div>
                    ) : (
                        <>
                            {/* Section Breakdown Bar Chart */}
                            <div className="bg-white border border-slate-200 rounded-lg p-5">
                                <h3 className="text-sm font-bold text-slate-800 mb-4">Section Maturity Breakdown</h3>
                                <div className="space-y-3">
                                    {sectionScores.map((s: any) => (
                                        <div key={s.section_id}>
                                            <div className="flex justify-between text-xs mb-1"><span className="text-slate-600 font-medium">{s.section_code} — {s.section_title}</span><span className="font-mono font-bold" style={{ color: getMaturityColor(s.average_maturity) }}>{s.average_maturity.toFixed(1)} / 5</span></div>
                                            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(s.average_maturity / 5) * 100}%`, backgroundColor: getMaturityColor(s.average_maturity) }} />
                                            </div>
                                            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5"><span>{s.questions_answered}/{s.total_questions} answered</span><span>{s.compliance_pct}% compliant</span></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* Maturity Legend */}
                            <div className="bg-white border border-slate-200 rounded-lg p-5">
                                <h3 className="text-sm font-bold text-slate-800 mb-3">IAM Maturity Scale Reference</h3>
                                <div className="grid grid-cols-3 gap-2">
                                    {MATURITY_LEVELS.map(l => (
                                        <div key={l.value} className="flex items-center gap-2 p-2 rounded-lg" style={{ backgroundColor: `${l.color}10` }}>
                                            <div className="w-7 h-7 rounded-md flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: l.color }}>{l.value}</div>
                                            <div><p className="text-xs font-bold text-slate-700">{l.label}</p><p className="text-[10px] text-slate-500">{l.description}</p></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {/* AI Summary */}
                            {audit.ai_summary && (
                                <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-5">
                                    <h3 className="text-sm font-bold text-purple-800 mb-2 flex items-center gap-2">🤖 Relantern AI Analysis</h3>
                                    <p className="text-sm text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">{audit.ai_summary}</p>
                                </div>
                            )}
                            {/* AI Recommendations — Service Proposals */}
                            {audit.ai_recommendations && audit.ai_recommendations.length > 0 && (
                                <div className="bg-white border border-slate-200 rounded-lg p-5">
                                    <h3 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2"><Sparkles size={14} className="text-purple-500" />Gap Analysis & Service Proposals</h3>
                                    <p className="text-[10px] text-slate-400 mb-4">Identified improvement opportunities with recommended service offerings</p>
                                    <div className="space-y-3">
                                        {(audit.ai_recommendations as AuditAIRecommendation[]).map((rec, i) => (
                                            <div key={i} className="border border-slate-100 rounded-lg p-4 hover:border-purple-200 transition-colors">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded text-white ${rec.priority === 'critical' ? 'bg-red-500' : rec.priority === 'high' ? 'bg-orange-500' : rec.priority === 'medium' ? 'bg-yellow-500' : 'bg-green-500'}`}>{rec.priority.toUpperCase()}</span>
                                                        <span className="text-xs font-mono text-slate-400">{rec.clause}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-xs">
                                                        <span className="font-mono text-red-400">{rec.current_score}</span>
                                                        <span className="text-slate-300">→</span>
                                                        <span className="font-mono text-green-500">{rec.target_score}</span>
                                                    </div>
                                                </div>
                                                <p className="text-sm font-semibold text-slate-800 mb-1">{rec.gap}</p>
                                                <p className="text-xs text-slate-600 mb-2">{rec.recommendation}</p>
                                                {rec.service_offering && (
                                                    <div className="flex items-center gap-2 bg-accent-cyan/5 border border-accent-cyan/20 rounded-md px-3 py-2">
                                                        <span className="text-[10px] font-bold text-accent-cyan uppercase tracking-wider">Recommended Service:</span>
                                                        <span className="text-xs font-semibold text-slate-700">{rec.service_offering}</span>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
