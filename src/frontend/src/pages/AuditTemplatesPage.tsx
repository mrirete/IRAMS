/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ASSESSMENT SCOPES (Audit Templates)
 *  ISO 55001:2024 §9.2 — what an assessment is scoped against
 *
 *  Honest contract (presentation-readiness assessment, 2026-09-03):
 *  every assessment runs the SAME engine — the 30-question 6M checklist
 *  plus the 21-document readiness check (AuditWizard). A scope presets the
 *  objective and the standard it is framed against, and carries a clause-
 *  level question bank the assessor uses as reference during the 6M step.
 *  The banks are the real files in eam/data/audit-templates — counts below
 *  are derived from them, not typed in.
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FileText, Search,
    ChevronRight, ChevronDown, CheckCircle,
    ClipboardCheck, Shield, Wrench, Lock,
    Download, Tag, ListChecks, PlayCircle, Info,
} from 'lucide-react';
import { PreviewBanner } from '../components/common/PreviewBanner';
import { ISO55001_TEMPLATE, ISO55001_SECTIONS } from '../eam/data/audit-templates/iso55001';
import { PSM14_TEMPLATE, PSM14_SECTIONS } from '../eam/data/audit-templates/psm14';
import { API_RBI_TEMPLATE, API_RBI_SECTIONS } from '../eam/data/audit-templates/apiRbi';
import { SIXM_ASSESSMENT_QUESTIONS } from '../eam/services/SixMQuestionBank';
import { DEFAULT_DOCUMENTS } from '../eam/services/AuditTypes';

// ─── Types ───────────────────────────────────────────────────
type TemplateCategory = 'iso55001' | 'psm' | 'mechanical_integrity';

interface BankSection {
    section: { code: string; title: string; standard_clause?: string; description?: string };
    questions: { code: string; question_text: string; guidance_notes?: string; evidence_expected?: string; is_mandatory?: boolean }[];
}

interface AssessmentScope {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    version: string;
    isoReference: string;
    sections: BankSection[];
    questionCount: number;
    mandatoryCount: number;
}

interface CategoryStyle {
    label: string;
    icon: React.ReactNode;
    color: string;
    bg: string;
    border: string;
    gradient: string;
    ring: string;
    iconBg: string;
}

const CATEGORY_CONFIG: Record<TemplateCategory, CategoryStyle> = {
    iso55001: {
        label: 'ISO 55001', icon: <ClipboardCheck size={20} />,
        color: 'text-blue-600', bg: 'bg-blue-50',
        border: 'border-l-blue-500', gradient: 'from-blue-50/80 via-white to-white',
        ring: 'ring-blue-300 shadow-blue-500/10', iconBg: 'bg-gradient-to-br from-blue-500 to-blue-600',
    },
    psm: {
        label: 'PSM / SEMS', icon: <Shield size={20} />,
        color: 'text-red-600', bg: 'bg-red-50',
        border: 'border-l-red-500', gradient: 'from-red-50/80 via-white to-white',
        ring: 'ring-red-300 shadow-red-500/10', iconBg: 'bg-gradient-to-br from-red-500 to-rose-600',
    },
    mechanical_integrity: {
        label: 'Mechanical Integrity', icon: <Wrench size={20} />,
        color: 'text-amber-600', bg: 'bg-amber-50',
        border: 'border-l-amber-500', gradient: 'from-amber-50/80 via-white to-white',
        ring: 'ring-amber-300 shadow-amber-500/10', iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
    },
};

// ─── Scopes derived from the real question banks ─────────────
function scopeFrom(id: string, category: TemplateCategory, tpl: { name: string; description: string; standard_reference: string; version: string }, sections: readonly BankSection[]): AssessmentScope {
    const qs = sections.flatMap(s => s.questions);
    return {
        id, category,
        name: tpl.name,
        description: tpl.description,
        version: tpl.version,
        isoReference: tpl.standard_reference,
        sections: sections as BankSection[],
        questionCount: qs.length,
        mandatoryCount: qs.filter(q => q.is_mandatory).length,
    };
}

const SCOPES: AssessmentScope[] = [
    scopeFrom('ISO55001-2024', 'iso55001', ISO55001_TEMPLATE, ISO55001_SECTIONS as unknown as BankSection[]),
    scopeFrom('PSM-14', 'psm', PSM14_TEMPLATE, PSM14_SECTIONS as unknown as BankSection[]),
    scopeFrom('API-RBI', 'mechanical_integrity', API_RBI_TEMPLATE, API_RBI_SECTIONS as unknown as BankSection[]),
];

const ENGINE_QUESTIONS = SIXM_ASSESSMENT_QUESTIONS.length;   // 30
const ENGINE_DOCUMENTS = DEFAULT_DOCUMENTS.length;            // 21

// ─── Page ────────────────────────────────────────────────────
export const AuditTemplatesPage: React.FC = () => {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const filtered = useMemo(() => SCOPES.filter(t => {
        const q = search.toLowerCase();
        const matchSearch = !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.isoReference.toLowerCase().includes(q);
        const matchCat = !categoryFilter || t.category === categoryFilter;
        return matchSearch && matchCat;
    }), [search, categoryFilter]);

    /** Start an assessment framed by this scope: presets objective + reference on the intake. */
    const handleStart = useCallback((scope: AssessmentScope) => {
        navigate('/audits', {
            state: {
                action: 'start_from_template',
                templateId: scope.id,
                templateName: scope.name,
                isoReference: scope.isoReference,
                category: scope.category,
                sections: scope.sections.map(s => s.section.title),
            },
        });
    }, [navigate]);

    /** Export the clause-level question bank as JSON (for offline use / auditors). */
    const handleExport = useCallback((scope: AssessmentScope) => {
        const payload = JSON.stringify({ id: scope.id, name: scope.name, standard: scope.isoReference, version: scope.version, sections: scope.sections }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${scope.id}_question_bank.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    const totalQuestions = SCOPES.reduce((s, t) => s + t.questionCount, 0);

    return (
        <div className="h-full overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Assessment Scopes</h1>
                    <p className="text-sm text-slate-500 mt-1">What an assessment is framed against — ISO 55001, PSM, Mechanical Integrity</p>
                </div>
            </div>

            <div className="mb-6">
                <PreviewBanner message={`Every assessment runs the same engine: the ${ENGINE_QUESTIONS}-question 6M checklist and the ${ENGINE_DOCUMENTS}-document readiness check. A scope presets the objective and standard, and its clause-level question bank is the assessor's reference during the 6M step. Custom scopes are on the roadmap.`} />
            </div>

            {/* KPI Bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <KpiCard label="Scopes" value={SCOPES.length} color="#6366f1" />
                <KpiCard label="Reference questions" value={totalQuestions} color="#06b6d4" />
                <KpiCard label="Engine questions (6M)" value={ENGINE_QUESTIONS} color="#8b5cf6" />
                <KpiCard label="Readiness documents" value={ENGINE_DOCUMENTS} color="#22c55e" />
            </div>

            {/* Filters */}
            <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search scopes..."
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
                    />
                </div>
                <select
                    value={categoryFilter}
                    onChange={e => setCategoryFilter(e.target.value)}
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-700"
                >
                    <option value="">All Categories</option>
                    {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                    ))}
                </select>
            </div>

            {/* Scope Cards */}
            {filtered.length === 0 ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <FileText size={28} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-600 mb-2">No scopes match</h3>
                    <p className="text-sm text-slate-400">Adjust the search or category filter</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(t => {
                        const cat = CATEGORY_CONFIG[t.category];
                        const isExpanded = expandedId === t.id;
                        return (
                            <div
                                key={t.id}
                                className={`border border-l-4 ${cat.border} rounded-xl transition-all group overflow-hidden ${
                                    isExpanded ? `ring-1 ${cat.ring} shadow-lg` : 'border-slate-200 hover:shadow-md hover:border-slate-300'
                                }`}
                            >
                                <div
                                    className={`flex items-start justify-between p-5 cursor-pointer bg-gradient-to-r ${cat.gradient}`}
                                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                                >
                                    <div className="flex items-start gap-4 flex-1 min-w-0">
                                        <div className={`w-12 h-12 rounded-xl ${cat.iconBg} flex items-center justify-center shrink-0 text-white shadow-md`}>
                                            {cat.icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <h3 className="text-sm font-bold text-slate-800">{t.name}</h3>
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 flex items-center gap-0.5">
                                                    <Lock size={8} /> BUILT-IN
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 line-clamp-2 mb-3">{t.description}</p>

                                            <div className="flex items-center gap-3 text-[11px] flex-wrap">
                                                <span className={`${cat.bg} ${cat.color} px-2 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wide`}>{cat.label}</span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg"><Tag size={10} /> v{t.version}</span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg"><ListChecks size={10} /> {t.sections.length} sections</span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg"><FileText size={10} /> {t.questionCount} reference questions · {t.mandatoryCount} mandatory</span>
                                                <span className="flex items-center gap-1 text-slate-400"><Info size={10} /> {t.isoReference}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 ml-3">
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => handleStart(t)} className={`p-2 rounded-lg hover:${cat.bg} text-slate-400 ${cat.color.replace('text-', 'hover:text-')} transition-colors`} title="Start an assessment with this scope">
                                                <PlayCircle size={16} />
                                            </button>
                                            <button onClick={() => handleExport(t)} className="p-2 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors" title="Export question bank (JSON)">
                                                <Download size={16} />
                                            </button>
                                        </div>
                                        {isExpanded
                                            ? <ChevronDown size={16} className={cat.color} />
                                            : <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                                        }
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className={`border-t px-5 pb-5 bg-gradient-to-b ${cat.gradient}`} style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                            <div>
                                                <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${cat.color}`}>
                                                    <ListChecks size={13} /> Sections ({t.sections.length})
                                                </h4>
                                                <div className="space-y-1.5">
                                                    {t.sections.map((s, i) => (
                                                        <div key={s.section.code} className="flex items-center gap-2 text-sm text-slate-700 py-1.5 px-2.5 rounded-lg hover:bg-white/80 transition-colors">
                                                            <span className={`w-6 h-6 rounded-lg ${cat.bg} ${cat.color} text-[10px] font-bold flex items-center justify-center shrink-0`}>{i + 1}</span>
                                                            <span className="flex-1 min-w-0 truncate">{s.section.title}</span>
                                                            <span className="text-[10px] text-slate-400 shrink-0">{s.questions.length} q</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${cat.color}`}>
                                                    <FileText size={13} /> Reference questions (first of each section)
                                                </h4>
                                                <div className="space-y-2">
                                                    {t.sections.slice(0, 5).map(s => s.questions[0]).filter(Boolean).map(q => (
                                                        <div key={q.code} className={`text-sm text-slate-600 ${cat.bg} border border-slate-100 rounded-lg p-3 flex gap-2`}>
                                                            <CheckCircle size={14} className={`${cat.color} shrink-0 mt-0.5`} />
                                                            <span><span className="font-mono text-[10px] text-slate-400 mr-1">{q.code}</span>{q.question_text}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-200/60">
                                            <button onClick={() => handleStart(t)} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-lg text-sm flex items-center gap-2 hover:shadow-lg hover:scale-[1.02] transition-all">
                                                <PlayCircle size={16} /> Start assessment with this scope
                                            </button>
                                            <button onClick={() => handleExport(t)} className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-2 transition-colors">
                                                <Download size={14} /> Export question bank
                                            </button>
                                            <div className="flex-1" />
                                            <span className="text-[11px] text-slate-400">{t.isoReference} · v{t.version}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ─── Shared Widgets ──────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: string | number; color: string }) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-black mt-1" style={{ color }}>{value}</p>
        </div>
    );
}
