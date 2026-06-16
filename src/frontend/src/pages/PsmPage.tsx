/**
 * PsmPage — Process Safety Management Analysis Hub
 *
 * 5-division tabbed shell:
 *   1. Compliance Dashboard (OSHA 1910.119 tracker)
 *   2. Hazard Analysis       (PHA + HAZOP + PSSR)
 *   3. Risk Quantification   (LOPA + Bow-Tie + FTA + ETA)
 *   4. SIL Lifecycle          (SIL Assessment + Verification)
 *   5. Risk Register          (ISO 31000 + heatmap)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ShieldCheck, AlertTriangle, FileText, Clock,
    Target, Layers, Activity, BarChart3, Plus,
    ChevronRight, Search, Filter, GitBranch, Bot,
} from 'lucide-react';
import { useSafety } from '../hooks/useSafety';
import psmService from '../eam/services/PSMService';
import type { PSMStudy, PSMStudyType } from '../types/safety';

// Tool components
import PHAWorksheet from '../components/psm/PHAWorksheet';
import HAZOPWorksheet from '../components/psm/HAZOPWorksheet';
import LOPAWorksheet from '../components/psm/LOPAWorksheet';
import BowTieDiagram from '../components/psm/BowTieDiagram';
import PSSRChecklist from '../components/psm/PSSRChecklist';
import SILAssessmentPanel from '../components/psm/SILAssessment';
import EventTree from '../components/psm/EventTree';
import RiskRegister from '../components/psm/RiskRegister';
import CreateStudyModal from '../components/psm/CreateStudyModal';
import PSMAdvisor from '../components/psm/PSMAdvisor';
import { getPersona } from '../components/psm/PSMAdvisorPrompts';

// ═══════════════════════════════════════════════════════════════
//  Division Definitions
// ═══════════════════════════════════════════════════════════════

type Division = 'compliance' | 'hazard_analysis' | 'risk_quantification' | 'sil_lifecycle' | 'risk_register';

const DIVISIONS: { id: Division; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'compliance',          label: 'Compliance',          icon: <ShieldCheck size={16} />,    desc: 'OSHA 1910.119 — 14-element compliance tracking' },
    { id: 'hazard_analysis',     label: 'Hazard Analysis',     icon: <AlertTriangle size={16} />,  desc: 'PHA, HAZOP & PSSR — systematic hazard identification' },
    { id: 'risk_quantification', label: 'Risk Quantification', icon: <Layers size={16} />,         desc: 'LOPA, Bow-Tie, FTA, ETA — quantitative risk assessment' },
    { id: 'sil_lifecycle',       label: 'SIL Lifecycle',       icon: <Activity size={16} />,       desc: 'IEC 61508/61511 — SIL determination & verification' },
    { id: 'risk_register',       label: 'Risk Register',       icon: <BarChart3 size={16} />,      desc: 'ISO 31000 — master risk log & consequence modelling' },
];

// ═══════════════════════════════════════════════════════════════
//  KPI Card
// ═══════════════════════════════════════════════════════════════

function Kpi({ label, value, icon: Icon, color = 'text-blue-500', bg = 'bg-blue-50' }: {
    label: string; value: string | number; icon: React.FC<any>; color?: string; bg?: string;
}) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
            <div className={`p-2.5 rounded-lg ${bg}`}>
                <Icon size={20} className={color} />
            </div>
            <div>
                <p className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">{label}</p>
                <h3 className="text-xl font-bold text-slate-800 tracking-tight">{value}</h3>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Study List Panel (shared across divisions)
// ═══════════════════════════════════════════════════════════════

function StudyListPanel({ studies, studyType, onSelect, onNew, selectedId }: {
    studies: PSMStudy[];
    studyType: PSMStudyType;
    onSelect: (study: PSMStudy) => void;
    onNew: () => void;
    selectedId: string | null;
}) {
    const [search, setSearch] = useState('');
    const filtered = studies.filter(s =>
        s.study_type === studyType &&
        (s.title.toLowerCase().includes(search.toLowerCase()) ||
         s.asset_name?.toLowerCase().includes(search.toLowerCase()))
    );

    const statusColors: Record<string, string> = {
        draft: 'bg-slate-100 text-slate-600',
        in_progress: 'bg-blue-50 text-blue-600',
        review: 'bg-amber-50 text-amber-600',
        approved: 'bg-emerald-50 text-emerald-600',
        closed: 'bg-slate-100 text-slate-400',
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                    <FileText size={14} className="text-slate-400" />
                    <span className="text-sm font-semibold text-slate-700">Studies</span>
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium">{filtered.length}</span>
                </div>
                <button
                    onClick={onNew}
                    className="flex items-center gap-1 text-xs font-medium text-white bg-gradient-to-r from-primary-500 to-primary-500 px-3 py-1.5 rounded-lg hover:shadow-md hover:shadow-primary-500/20 transition-all"
                >
                    <Plus size={12} /> New
                </button>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-slate-50">
                <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search studies..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400"
                    />
                </div>
            </div>

            {/* List */}
            <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-50">
                {filtered.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                        No {studyType.toUpperCase()} studies yet. Click "New" to start.
                    </div>
                ) : (
                    filtered.map(study => (
                        <button
                            key={study.id}
                            onClick={() => onSelect(study)}
                            className={`w-full text-left p-3 hover:bg-slate-50 transition-colors flex items-center gap-3 ${
                                selectedId === study.id ? 'bg-primary-50/50 border-l-2 border-primary-500' : ''
                            }`}
                        >
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-700 truncate">{study.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    {study.asset_tag && (
                                        <span className="text-[10px] text-slate-400 font-mono">{study.asset_tag}</span>
                                    )}
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColors[study.status] || ''}`}>
                                        {study.status.replace('_', ' ')}
                                    </span>
                                </div>
                            </div>
                            <ChevronRight size={14} className="text-slate-300 shrink-0" />
                        </button>
                    ))
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Compliance Dashboard (existing 14-element grid, refined)
// ═══════════════════════════════════════════════════════════════

function ComplianceDashboard() {
    const { psmElements, summary } = useSafety();

    const complianceColor = (pct: number) => {
        if (pct >= 90) return 'bg-emerald-500';
        if (pct >= 75) return 'bg-amber-500';
        if (pct >= 60) return 'bg-orange-500';
        return 'bg-red-500';
    };

    return (
        <div className="space-y-5">
            {/* KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Kpi label="PSM Score" value={`${summary.psm_overall_pct}%`} icon={ShieldCheck}
                     color={summary.psm_overall_pct >= 80 ? 'text-emerald-500' : 'text-amber-500'}
                     bg={summary.psm_overall_pct >= 80 ? 'bg-emerald-50' : 'bg-amber-50'} />
                <Kpi label="MOC Open" value={summary.moc_open} icon={AlertTriangle} color="text-orange-500" bg="bg-orange-50" />
                <Kpi label="PHA Overdue" value={psmElements.filter(e => e.element_name.includes('PHA') && new Date(e.next_review_due) < new Date()).length}
                     icon={Clock} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Elements" value={psmElements.length} icon={FileText} color="text-blue-500" bg="bg-blue-50" />
                <Kpi label="Findings" value={psmElements.reduce((a, e) => a + e.open_findings, 0)}
                     icon={AlertTriangle} color="text-amber-500" bg="bg-amber-50" />
            </div>

            {/* 14-Element Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {psmElements.map(e => {
                    const isOverdue = new Date(e.next_review_due) < new Date();
                    return (
                        <div key={e.id} className={`bg-white border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow ${
                            isOverdue ? 'border-red-300 bg-red-50/30' : 'border-slate-200'
                        }`}>
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <h3 className="text-slate-800 font-semibold text-sm">{e.element_name}</h3>
                                    <p className="text-slate-400 text-[10px] font-mono mt-0.5">{e.osha_reference}</p>
                                </div>
                                <span className={`text-xl font-bold font-mono ${
                                    e.compliance_pct >= 90 ? 'text-emerald-500' :
                                    e.compliance_pct >= 75 ? 'text-amber-500' : 'text-red-500'
                                }`}>{e.compliance_pct}%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1.5 mb-2">
                                <div className={`h-1.5 rounded-full transition-all ${complianceColor(e.compliance_pct)}`}
                                     style={{ width: `${e.compliance_pct}%` }} />
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>Owner: <span className="text-slate-600 font-medium">{e.owner}</span></span>
                                <span>Findings: <span className={e.open_findings > 0 ? 'text-amber-500 font-semibold' : 'text-slate-500'}>{e.open_findings}</span></span>
                                <span className={isOverdue ? 'text-red-500 font-semibold' : ''}>
                                    Due: {new Date(e.next_review_due).toLocaleDateString()}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════

export const PsmPage: React.FC = () => {
    const [activeDivision, setActiveDivision] = useState<Division>('compliance');
    const [studies, setStudies] = useState<PSMStudy[]>([]);
    const [selectedStudy, setSelectedStudy] = useState<PSMStudy | null>(null);
    const [hazardSubTab, setHazardSubTab] = useState<'pha' | 'hazop' | 'pssr'>('hazop');
    const [riskSubTab, setRiskSubTab] = useState<'lopa' | 'bowtie' | 'eta'>('lopa');
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [createModalType, setCreateModalType] = useState<PSMStudyType>('hazop');
    const [advisorOpen, setAdvisorOpen] = useState(false);
    const persona = useMemo(
        () => getPersona(selectedStudy?.study_type || (activeDivision !== 'compliance' ? activeDivision : null)),
        [selectedStudy?.study_type, activeDivision]
    );

    // Fetch studies
    const fetchStudies = useCallback(async () => {
        const data = await psmService.getStudies();
        setStudies(data);
    }, []);

    useEffect(() => { fetchStudies(); }, [fetchStudies]);

    const handleNewStudy = useCallback((type: PSMStudyType) => {
        setCreateModalType(type);
        setCreateModalOpen(true);
    }, []);

    const handleStudyCreated = useCallback((study: PSMStudy) => {
        setStudies(prev => [study, ...prev]);
        setSelectedStudy(study);
        setCreateModalOpen(false);
    }, []);

    const handleRefresh = useCallback(async () => {
        await fetchStudies();
    }, [fetchStudies]);

    // Map risk sub-tab to study type
    const riskStudyType: PSMStudyType = riskSubTab === 'bowtie' ? 'bowtie' : riskSubTab === 'eta' ? 'eta' : 'lopa';

    return (
        <div className="space-y-5 animate-in fade-in duration-500 pb-20">
            {/* ── Header ── */}
            <div>
                <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Process Safety Management</h1>
                <p className="text-slate-500 text-sm mt-1">
                    Systematic hazard identification, risk quantification & barrier management
                </p>
            </div>

            {/* ── Division Tabs ── */}
            <div className="flex gap-1 bg-white/80 backdrop-blur-sm p-1 rounded-xl border border-slate-200/60 shadow-sm overflow-x-auto">
                {DIVISIONS.map(div => (
                    <button
                        key={div.id}
                        onClick={() => { setActiveDivision(div.id); setSelectedStudy(null); }}
                        className={`group flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-250 whitespace-nowrap ${
                            activeDivision === div.id
                                ? 'bg-gradient-to-r from-primary-500 to-primary-500 text-white shadow-md shadow-primary-500/20'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                    >
                        <span className={`transition-colors ${activeDivision === div.id ? 'text-white/90' : 'text-slate-400 group-hover:text-primary-500'}`}>
                            {div.icon}
                        </span>
                        <span>{div.label}</span>
                    </button>
                ))}
            </div>

            {/* Division description */}
            <div className="flex items-center gap-2 px-1">
                <div className="w-1 h-3.5 rounded-full bg-gradient-to-b from-primary-400 to-primary-400" />
                <p className="text-xs text-slate-500">
                    {DIVISIONS.find(d => d.id === activeDivision)?.desc}
                </p>
            </div>

            {/* ═══ COMPLIANCE ═══════════════════════════════════ */}
            {activeDivision === 'compliance' && <ComplianceDashboard />}

            {/* ═══ HAZARD ANALYSIS ══════════════════════════════ */}
            {activeDivision === 'hazard_analysis' && (
                <div className="space-y-4">
                    {/* Sub-tabs */}
                    <div className="flex gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200/50">
                        {[
                            { id: 'hazop' as const, label: 'HAZOP', std: 'IEC 61882' },
                            { id: 'pha' as const, label: 'PHA (What-If)', std: 'OSHA 1910.119(e)' },
                            { id: 'pssr' as const, label: 'PSSR', std: 'OSHA 1910.119(i)' },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setHazardSubTab(tab.id); setSelectedStudy(null); }}
                                className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all ${
                                    hazardSubTab === tab.id
                                        ? 'bg-white text-primary-700 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                {tab.label}
                                <span className="text-[9px] text-slate-400 ml-1.5">{tab.std}</span>
                            </button>
                        ))}
                    </div>

                    {/* Content area */}
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
                        {/* Study list */}
                        <StudyListPanel
                            studies={studies}
                            studyType={hazardSubTab}
                            onSelect={setSelectedStudy}
                            onNew={() => handleNewStudy(hazardSubTab)}
                            selectedId={selectedStudy?.id || null}
                        />

                        {/* Tool panel */}
                        <div>
                            {!selectedStudy ? (
                                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
                                    <Target size={32} className="text-slate-300 mx-auto mb-3" />
                                    <p className="text-sm text-slate-500">Select a study from the left, or create a new one</p>
                                </div>
                            ) : hazardSubTab === 'hazop' ? (
                                <HAZOPWorksheet study={selectedStudy} onRefresh={handleRefresh} />
                            ) : hazardSubTab === 'pha' ? (
                                <PHAWorksheet study={selectedStudy} onRefresh={handleRefresh} />
                            ) : (
                                <PSSRChecklist study={selectedStudy} onRefresh={handleRefresh} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ RISK QUANTIFICATION ══════════════════════════ */}
            {activeDivision === 'risk_quantification' && (
                <div className="space-y-4">
                    {/* Sub-tabs */}
                    <div className="flex gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200/50">
                        {[
                            { id: 'lopa' as const, label: 'LOPA', std: 'IEC 61511 / ISA 84' },
                            { id: 'bowtie' as const, label: 'Bow-Tie', std: 'CCPS / Shell' },
                            { id: 'eta' as const, label: 'Event Tree', std: 'IEC 62502' },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setRiskSubTab(tab.id); setSelectedStudy(null); }}
                                className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all ${
                                    riskSubTab === tab.id
                                        ? 'bg-white text-primary-700 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                {tab.label}
                                <span className="text-[9px] text-slate-400 ml-1.5">{tab.std}</span>
                            </button>
                        ))}
                    </div>

                    {/* Content area */}
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
                        <StudyListPanel
                            studies={studies}
                            studyType={riskStudyType}
                            onSelect={setSelectedStudy}
                            onNew={() => handleNewStudy(riskStudyType)}
                            selectedId={selectedStudy?.id || null}
                        />

                        <div>
                            {!selectedStudy ? (
                                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
                                    <Target size={32} className="text-slate-300 mx-auto mb-3" />
                                    <p className="text-sm text-slate-500">Select a study from the left, or create a new one</p>
                                </div>
                            ) : riskSubTab === 'lopa' ? (
                                <LOPAWorksheet study={selectedStudy} onRefresh={handleRefresh} />
                            ) : riskSubTab === 'bowtie' ? (
                                <BowTieDiagram study={selectedStudy} onRefresh={handleRefresh} />
                            ) : (
                                <EventTree study={selectedStudy} onRefresh={handleRefresh} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ SIL LIFECYCLE ════════════════════════════════ */}
            {activeDivision === 'sil_lifecycle' && (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
                        <StudyListPanel
                            studies={studies}
                            studyType="sil"
                            onSelect={setSelectedStudy}
                            onNew={() => handleNewStudy('sil')}
                            selectedId={selectedStudy?.id || null}
                        />

                        <div>
                            {!selectedStudy ? (
                                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center">
                                    <Target size={32} className="text-slate-300 mx-auto mb-3" />
                                    <p className="text-sm text-slate-500">Select a SIL study, or create a new one</p>
                                </div>
                            ) : (
                                <SILAssessmentPanel study={selectedStudy} onRefresh={handleRefresh} />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ RISK REGISTER ════════════════════════════════ */}
            {activeDivision === 'risk_register' && (
                <RiskRegister />
            )}

            {/* ── Create Study Modal ── */}
            <CreateStudyModal
                isOpen={createModalOpen}
                studyType={createModalType}
                onClose={() => setCreateModalOpen(false)}
                onCreated={handleStudyCreated}
            />

            {/* ── Floating AI Advisor Button ── */}
            <button
                onClick={() => setAdvisorOpen(true)}
                className={`fixed bottom-6 right-6 z-40 flex items-center gap-2 px-5 py-3 ${persona.fabGradient} text-white rounded-full shadow-lg ${persona.fabShadow} hover:shadow-xl transition-all duration-300 group`}
                title={`Ask ${persona.title}`}
            >
                <Bot size={18} className="group-hover:animate-pulse" />
                <span className="text-sm font-semibold">Ask {persona.badge} Specialist</span>
            </button>

            {/* ── AI Advisor Panel ── */}
            <PSMAdvisor
                isOpen={advisorOpen}
                onClose={() => setAdvisorOpen(false)}
                study={selectedStudy}
                itemsSummary={selectedStudy ? `Study: ${selectedStudy.title}\nType: ${selectedStudy.study_type}\nStatus: ${selectedStudy.status}` : ''}
                itemCount={0}
                divisionLabel={DIVISIONS.find(d => d.id === activeDivision)?.label || ''}
            />
        </div>
    );
};

export default PsmPage;
