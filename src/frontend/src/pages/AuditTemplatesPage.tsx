/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ASSESSMENT SCOPES (Audit Templates)
 *  ISO 55001:2024 §9.2 — what an assessment is scoped against
 *
 *  Honest contract (presentation-readiness assessment, 2026-09-03):
 *  every assessment runs the SAME engine — the 36-question maturity checklist
 *  plus the 21-document readiness check (AuditWizard). A scope presets the
 *  objective and the standard it is framed against, and carries a clause-
 *  level question bank the assessor uses as reference during the maturity step.
 *  The banks are the real files in eam/data/audit-templates — counts below
 *  are derived from them, not typed in.
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FileText,
    ChevronDown, CheckCircle,
    ClipboardCheck, Shield, Wrench, Lock,
    Download, Tag, ListChecks, PlayCircle, Info,
} from 'lucide-react';
import { PreviewBanner } from '../components/common/PreviewBanner';
import { AssessPage, AssessHeader, StatStrip, ASSESS_PRIMARY_BTN, ASSESS_SECONDARY_BTN, onActivate } from '../components/audit/AssessLayout';
import { ISO55001_TEMPLATE, ISO55001_SECTIONS } from '../eam/data/audit-templates/iso55001';
import { PSM14_TEMPLATE, PSM14_SECTIONS } from '../eam/data/audit-templates/psm14';
import { API_RBI_TEMPLATE, API_RBI_SECTIONS } from '../eam/data/audit-templates/apiRbi';
import { MATURITY_QUESTIONS } from '../eam/services/MaturityQuestionBank';
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

const ENGINE_QUESTIONS = MATURITY_QUESTIONS.length;
const ENGINE_DOCUMENTS = DEFAULT_DOCUMENTS.length;            // 21

// ─── Page ────────────────────────────────────────────────────
export const AuditTemplatesPage: React.FC = () => {
    const navigate = useNavigate();
    // Three built-in scopes fit on one screen — no search or category filter.
    const [expandedId, setExpandedId] = useState<string | null>(null);

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
        <AssessPage>
            <AssessHeader
                title="Assessment Scopes"
                subtitle="What an assessment is framed against — ISO 55001, PSM, Mechanical Integrity"
            />

            <PreviewBanner message={`Every assessment runs the same engine: the ${ENGINE_QUESTIONS}-question maturity checklist and the ${ENGINE_DOCUMENTS}-document readiness check. A scope presets the objective and standard, and its clause-level question bank is the assessor's reference during the maturity step. Custom scopes are on the roadmap.`} />

            <StatStrip stats={[
                { key: 'scopes', label: 'Scopes', value: SCOPES.length },
                { key: 'ref', label: 'Reference questions', value: totalQuestions, tone: 'sky' },
                { key: 'engine', label: 'Engine questions', value: ENGINE_QUESTIONS, tone: 'violet' },
                { key: 'docs', label: 'Readiness documents', value: ENGINE_DOCUMENTS, tone: 'green' },
            ]} />

            {/* Scope Cards */}
            <div className="space-y-3">
                    {SCOPES.map(t => {
                        const cat = CATEGORY_CONFIG[t.category];
                        const isExpanded = expandedId === t.id;
                        const toggle = () => setExpandedId(isExpanded ? null : t.id);
                        return (
                            <div
                                key={t.id}
                                className={`bg-white border border-l-4 ${cat.border} rounded-xl transition-all overflow-hidden ${
                                    isExpanded ? `ring-1 ${cat.ring} shadow-lg` : 'border-slate-200 hover:shadow-sm hover:border-slate-300'
                                }`}
                            >
                                <div
                                    role="button"
                                    tabIndex={0}
                                    aria-expanded={isExpanded}
                                    className={`flex items-start gap-3 sm:gap-4 px-4 sm:px-5 py-4 cursor-pointer bg-gradient-to-r ${cat.gradient} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300`}
                                    onClick={toggle}
                                    onKeyDown={onActivate(toggle)}
                                >
                                        <div className={`hidden sm:flex w-11 h-11 rounded-xl ${cat.iconBg} items-center justify-center shrink-0 text-white shadow-sm`}>
                                            {cat.icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <h3 className="text-[15px] font-bold text-slate-800">{t.name}</h3>
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex items-center gap-0.5">
                                                    <Lock size={9} /> Built-in
                                                </span>
                                            </div>
                                            <p className="text-sm text-slate-500 line-clamp-2 mb-3">{t.description}</p>

                                            <div className="flex items-center gap-2 text-[11px] flex-wrap">
                                                <span className={`${cat.bg} ${cat.color} px-2 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wide`}>{cat.label}</span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg"><Tag size={10} /> v{t.version}</span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg"><ListChecks size={10} /> {t.sections.length} sections</span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg"><FileText size={10} /> {t.questionCount} reference questions · {t.mandatoryCount} mandatory</span>
                                                <span className="flex items-center gap-1 text-slate-400"><Info size={10} /> {t.isoReference}</span>
                                            </div>
                                        </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            onClick={e => { e.stopPropagation(); handleStart(t); }}
                                            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:border-primary-300 hover:text-primary-700 transition-colors"
                                            title="Start an assessment with this scope"
                                        >
                                            <PlayCircle size={14} /> Start
                                        </button>
                                        <ChevronDown size={18} className={`transition-transform ${isExpanded ? `rotate-180 ${cat.color}` : 'text-slate-400'}`} />
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="border-t border-slate-100 px-4 sm:px-5 pb-5 bg-white">
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
                                                    <FileText size={13} /> Sample reference questions
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
                                        <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t border-slate-100">
                                            <button onClick={() => handleStart(t)} className={ASSESS_PRIMARY_BTN}>
                                                <PlayCircle size={16} /> Start assessment with this scope
                                            </button>
                                            <button onClick={() => handleExport(t)} className={ASSESS_SECONDARY_BTN}>
                                                <Download size={14} /> Export question bank
                                            </button>
                                            <span className="sm:ml-auto text-[11px] text-slate-400">{t.isoReference} · v{t.version}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
            </div>
        </AssessPage>
    );
};
