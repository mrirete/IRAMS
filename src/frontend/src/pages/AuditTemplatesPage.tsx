/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUDIT TEMPLATES PAGE
 *  ISO 55001:2024 — Reusable Audit Checklists & Assessment Templates
 *  
 *  Pre-configured templates for different audit types:
 *  - ISO 55001 Full Assessment
 *  - PSM/SEMS Compliance  
 *  - Mechanical Integrity
 *  - Environmental Management
 *  - Custom templates
 * ═══════════════════════════════════════════════════════════════════════
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    FileText, Search, Copy,
    ChevronRight, ChevronDown, Clock, CheckCircle, Star,
    ClipboardCheck, Shield, Wrench, Leaf, Settings, Lock,
    Download, Tag, ListChecks, PlayCircle
} from 'lucide-react';
import { PreviewBanner } from '../components/common/PreviewBanner';

// ─── Template Types ──────────────────────────────────────────
interface AuditTemplate {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    version: string;
    status: 'active' | 'draft' | 'archived';
    isoReference: string;
    sections: number;
    questions: number;
    estimatedDuration: string;
    lastModified: string;
    createdBy: string;
    usageCount: number;
    isSystem: boolean;
    sectionNames: string[];
    sampleQuestions: string[];
}

type TemplateCategory = 'iso55001' | 'psm' | 'mechanical_integrity' | 'environmental' | 'custom';

interface CategoryStyle {
    label: string;
    icon: React.ReactNode;
    color: string;
    bg: string;
    border: string;        // left accent border
    gradient: string;      // subtle header tint
    ring: string;          // expanded state ring
    iconBg: string;        // icon background gradient
    accentBar: string;     // progress bar color
}

const CATEGORY_CONFIG: Record<TemplateCategory, CategoryStyle> = {
    iso55001: {
        label: 'ISO 55001', icon: <ClipboardCheck size={20} />,
        color: 'text-blue-600', bg: 'bg-blue-50',
        border: 'border-l-blue-500', gradient: 'from-blue-50/80 via-white to-white',
        ring: 'ring-blue-300 shadow-blue-500/10', iconBg: 'bg-gradient-to-br from-blue-500 to-blue-600',
        accentBar: 'bg-blue-500',
    },
    psm: {
        label: 'PSM / SEMS', icon: <Shield size={20} />,
        color: 'text-red-600', bg: 'bg-red-50',
        border: 'border-l-red-500', gradient: 'from-red-50/80 via-white to-white',
        ring: 'ring-red-300 shadow-red-500/10', iconBg: 'bg-gradient-to-br from-red-500 to-rose-600',
        accentBar: 'bg-red-500',
    },
    mechanical_integrity: {
        label: 'Mechanical Integrity', icon: <Wrench size={20} />,
        color: 'text-amber-600', bg: 'bg-amber-50',
        border: 'border-l-amber-500', gradient: 'from-amber-50/80 via-white to-white',
        ring: 'ring-amber-300 shadow-amber-500/10', iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
        accentBar: 'bg-amber-500',
    },
    environmental: {
        label: 'Environmental', icon: <Leaf size={20} />,
        color: 'text-emerald-600', bg: 'bg-emerald-50',
        border: 'border-l-emerald-500', gradient: 'from-emerald-50/80 via-white to-white',
        ring: 'ring-emerald-300 shadow-emerald-500/10', iconBg: 'bg-gradient-to-br from-emerald-500 to-primary-600',
        accentBar: 'bg-emerald-500',
    },
    custom: {
        label: 'Custom', icon: <Settings size={20} />,
        color: 'text-slate-600', bg: 'bg-slate-50',
        border: 'border-l-slate-400', gradient: 'from-slate-50/80 via-white to-white',
        ring: 'ring-slate-300 shadow-slate-500/10', iconBg: 'bg-gradient-to-br from-slate-500 to-slate-700',
        accentBar: 'bg-slate-500',
    },
};

// ─── Seed Data ───────────────────────────────────────────────
const SEED_TEMPLATES: AuditTemplate[] = [
    {
        id: 'TPL-001', name: 'ISO 55001:2024 Full Assessment', description: 'Comprehensive 7-step audit against the full ISO 55000:2024 series including ISO 55010 (Financial), 55011 (Regulatory), 55012 (Competence), and 55013 (Data).',
        category: 'iso55001', version: '3.2', status: 'active', isoReference: 'ISO 55001:2024 §4–§10',
        sections: 7, questions: 142, estimatedDuration: '3–5 days', lastModified: '2026-04-15', createdBy: 'System', usageCount: 24, isSystem: true,
        sectionNames: ['§4 Context','§5 Leadership','§6 Planning','§7 Support','§8 Operation','§9 Evaluation','§10 Improvement'],
        sampleQuestions: ['Has the organisation determined external/internal issues relevant to AM?','Is there a documented AM policy endorsed by top management?','Are AM objectives established and aligned to the SAMP?'],
    },
    {
        id: 'TPL-002', name: 'Process Safety Management (PSM)', description: 'OSHA 29 CFR 1910.119 / API RP 75 compliance audit for high-hazard facilities. Covers all 14 PSM elements.',
        category: 'psm', version: '2.1', status: 'active', isoReference: 'OSHA PSM, API RP 75',
        sections: 14, questions: 98, estimatedDuration: '2–3 days', lastModified: '2026-03-20', createdBy: 'System', usageCount: 11, isSystem: true,
        sectionNames: ['Employee Participation','Process Safety Info','PHA','Operating Procedures','Training','Contractors','Pre-Startup Review','MI','Hot Work','MoC','Incident Investigation','Emergency Planning','Compliance Audits','Trade Secrets'],
        sampleQuestions: ['Is there a written plan of action for employee participation?','Are P&IDs current and accurate?','Has a PHA been conducted for each covered process?'],
    },
    {
        id: 'TPL-003', name: 'Mechanical Integrity Program Audit', description: 'API 510/570/653 and API 580/581 RBI program compliance. Covers fixed equipment, piping, and pressure relief devices.',
        category: 'mechanical_integrity', version: '1.4', status: 'active', isoReference: 'API 510/570/653, API 580',
        sections: 6, questions: 78, estimatedDuration: '1–2 days', lastModified: '2026-02-10', createdBy: 'System', usageCount: 8, isSystem: true,
        sectionNames: ['Pressure Vessels','Piping Systems','Relief Devices','Rotating Equipment','Electrical','Instrumentation'],
        sampleQuestions: ['Are inspection intervals determined using RBI methodology?','Is there a documented corrosion management programme?','Are all PSV test records current?'],
    },
    {
        id: 'TPL-004', name: 'Environmental Compliance Screening', description: 'Quick-screen environmental management system against ISO 14001 and local regulatory requirements.',
        category: 'environmental', version: '1.0', status: 'draft', isoReference: 'ISO 14001:2015',
        sections: 4, questions: 45, estimatedDuration: '4 hours', lastModified: '2026-04-28', createdBy: 'Admin', usageCount: 0, isSystem: false,
        sectionNames: ['Environmental Policy','Aspects & Impacts','Legal Compliance','Monitoring & Measurement'],
        sampleQuestions: ['Is there a documented environmental policy?','Have significant environmental aspects been identified?','Are emission monitoring records maintained?'],
    },
    {
        id: 'TPL-005', name: 'Operator Rounds — Turnaround Readiness', description: 'Pre-turnaround readiness checklist for operations and maintenance teams. Covers isolation verification, permit status, and equipment handover.',
        category: 'custom', version: '1.1', status: 'active', isoReference: 'Internal SOP',
        sections: 3, questions: 32, estimatedDuration: '2 hours', lastModified: '2026-05-01', createdBy: 'K.Syrus', usageCount: 5, isSystem: false,
        sectionNames: ['Isolation Verification','Permit Status','Equipment Handover'],
        sampleQuestions: ['Have all isolations been verified by an authorised person?','Are all required permits in place and displayed?','Has equipment been formally handed over to maintenance?'],
    },
];

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export const AuditTemplatesPage: React.FC = () => {
    const navigate = useNavigate();
    const [templates, setTemplates] = useState<AuditTemplate[]>(SEED_TEMPLATES);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('');
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const filtered = templates.filter(t => {
        const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
        const matchCat = !categoryFilter || t.category === categoryFilter;
        return matchSearch && matchCat;
    });

    const statusCounts = {
        active: templates.filter(t => t.status === 'active').length,
        draft: templates.filter(t => t.status === 'draft').length,
        archived: templates.filter(t => t.status === 'archived').length,
    };

    // ─── Action Handlers ─────────────────────────────────────

    /** Start Audit: navigate to Assessments with template context */
    const handleStartAudit = useCallback((template: AuditTemplate) => {
        navigate('/audits', {
            state: {
                action: 'start_from_template',
                templateId: template.id,
                templateName: template.name,
                isoReference: template.isoReference,
                category: template.category,
                sections: template.sectionNames,
                estimatedDuration: template.estimatedDuration,
            }
        });
    }, [navigate]);

    /** Duplicate: clone template into local state with new ID */
    const handleDuplicate = useCallback((template: AuditTemplate) => {
        const nextNum = templates.length + 1;
        const cloned: AuditTemplate = {
            ...template,
            id: `TPL-${String(nextNum).padStart(3, '0')}`,
            name: `${template.name} (Copy)`,
            version: '1.0',
            status: 'draft',
            isSystem: false,
            usageCount: 0,
            lastModified: new Date().toISOString().slice(0, 10),
            createdBy: 'Current User',
        };
        setTemplates(prev => [...prev, cloned]);
        setExpandedId(cloned.id);
    }, [templates.length]);

    /** Export: download template definition as JSON */
    const handleExport = useCallback((template: AuditTemplate) => {
        const payload = JSON.stringify(template, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${template.id}_${template.name.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, []);

    return (
        <div className="h-full overflow-y-auto p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">Audit Templates</h1>
                    <p className="text-sm text-slate-500 mt-1">Reusable checklists & assessment frameworks — ISO 55001, PSM, MI, Custom</p>
                </div>
            </div>

            <div className="mb-6">
                <PreviewBanner message="Preview — templates are built-in presets; duplicated or edited templates are not saved yet. Start Audit works and launches a real assessment." />
            </div>

            {/* KPI Bar */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                <KpiCard label="Total Templates" value={templates.length} color="#6366f1" />
                <KpiCard label="Active" value={statusCounts.active} color="#22c55e" />
                <KpiCard label="Draft" value={statusCounts.draft} color="#f59e0b" />
                <KpiCard label="System" value={templates.filter(t => t.isSystem).length} color="#8b5cf6" />
                <KpiCard label="Total Questions" value={templates.reduce((s, t) => s + t.questions, 0)} color="#06b6d4" />
            </div>

            {/* Filters */}
            <div className="flex gap-3 mb-4">
                <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search templates..."
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

            {/* Template Cards */}
            {filtered.length === 0 ? (
                <div className="text-center py-20">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <FileText size={28} className="text-slate-300" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-600 mb-2">No templates found</h3>
                    <p className="text-sm text-slate-400">Create your first audit template or adjust filters</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(t => {
                        const cat = CATEGORY_CONFIG[t.category];
                        const isExpanded = expandedId === t.id;
                        // Coverage density bar — questions per section
                        const maxQuestions = 200; // scale reference
                        const coveragePct = Math.min(100, Math.round((t.questions / maxQuestions) * 100));

                        return (
                            <div
                                key={t.id}
                                className={`border border-l-4 ${cat.border} rounded-xl transition-all group overflow-hidden ${
                                    isExpanded
                                        ? `ring-1 ${cat.ring} shadow-lg`
                                        : 'border-slate-200 hover:shadow-md hover:border-slate-300'
                                }`}
                            >
                                {/* ── Clickable Header with category gradient tint ── */}
                                <div
                                    className={`flex items-start justify-between p-5 cursor-pointer bg-gradient-to-r ${cat.gradient}`}
                                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                                >
                                    <div className="flex items-start gap-4 flex-1 min-w-0">
                                        {/* Large gradient icon */}
                                        <div className={`w-12 h-12 rounded-xl ${cat.iconBg} flex items-center justify-center shrink-0 text-white shadow-md`}>
                                            {cat.icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                <h3 className="text-sm font-bold text-slate-800">{t.name}</h3>
                                                {t.isSystem && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 flex items-center gap-0.5">
                                                        <Lock size={8} /> SYSTEM
                                                    </span>
                                                )}
                                                <StatusPill status={t.status} />
                                            </div>
                                            <p className="text-xs text-slate-500 line-clamp-2 mb-3">{t.description}</p>

                                            {/* ── Metric chips row ── */}
                                            <div className="flex items-center gap-3 text-[11px] flex-wrap">
                                                <span className={`${cat.bg} ${cat.color} px-2 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wide`}>
                                                    {cat.label}
                                                </span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                                                    <Tag size={10} /> v{t.version}
                                                </span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                                                    <ListChecks size={10} /> {t.sections} sections
                                                </span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                                                    <FileText size={10} /> {t.questions} questions
                                                </span>
                                                <span className="flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                                                    <Clock size={10} /> {t.estimatedDuration}
                                                </span>
                                            </div>

                                            {/* ── Coverage bar ── */}
                                            <div className="mt-3 flex items-center gap-2">
                                                <span className="text-[10px] text-slate-400 font-medium w-16 shrink-0">Coverage</span>
                                                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full ${cat.accentBar} rounded-full transition-all duration-500`}
                                                        style={{ width: `${coveragePct}%` }}
                                                    />
                                                </div>
                                                <span className="text-[10px] text-slate-400 font-bold">{t.questions}q</span>
                                                <span className="text-[10px] text-slate-300 mx-1">·</span>
                                                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                                    <Star size={9} className={cat.color} /> Used {t.usageCount}×
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── Hover action icons ── */}
                                    <div className="flex items-center gap-2 ml-3">
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                            <button onClick={() => handleStartAudit(t)} className={`p-2 rounded-lg hover:${cat.bg} text-slate-400 ${cat.color.replace('text-', 'hover:text-')} transition-colors`} title="Start Audit">
                                                <PlayCircle size={16} />
                                            </button>
                                            <button onClick={() => handleDuplicate(t)} className="p-2 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors" title="Duplicate">
                                                <Copy size={16} />
                                            </button>
                                            <button onClick={() => handleExport(t)} className="p-2 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors" title="Export">
                                                <Download size={16} />
                                            </button>
                                        </div>
                                        {isExpanded
                                            ? <ChevronDown size={16} className={cat.color} />
                                            : <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                                        }
                                    </div>
                                </div>

                                {/* ── Expandable Detail Panel ── */}
                                {isExpanded && (
                                    <div className={`border-t px-5 pb-5 bg-gradient-to-b ${cat.gradient}`} style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                                            {/* Sections */}
                                            <div>
                                                <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${cat.color}`}>
                                                    <ListChecks size={13} /> Sections ({t.sectionNames.length})
                                                </h4>
                                                <div className="space-y-1.5">
                                                    {t.sectionNames.map((s, i) => (
                                                        <div key={i} className="flex items-center gap-2 text-sm text-slate-700 py-1.5 px-2.5 rounded-lg hover:bg-white/80 transition-colors">
                                                            <span className={`w-6 h-6 rounded-lg ${cat.bg} ${cat.color} text-[10px] font-bold flex items-center justify-center shrink-0`}>{i + 1}</span>
                                                            {s}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            {/* Sample Questions */}
                                            <div>
                                                <h4 className={`text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5 ${cat.color}`}>
                                                    <FileText size={13} /> Sample Questions
                                                </h4>
                                                <div className="space-y-2">
                                                    {t.sampleQuestions.map((q, i) => (
                                                        <div key={i} className={`text-sm text-slate-600 ${cat.bg} border border-slate-100 rounded-lg p-3 flex gap-2`}>
                                                            <CheckCircle size={14} className={`${cat.color} shrink-0 mt-0.5`} />
                                                            <span>{q}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        {/* Action Bar */}
                                        <div className="flex items-center gap-3 mt-5 pt-4 border-t border-slate-200/60">
                                            <button onClick={() => handleStartAudit(t)} className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold rounded-lg text-sm flex items-center gap-2 hover:shadow-lg hover:scale-[1.02] transition-all">
                                                <PlayCircle size={16} /> Start Audit
                                            </button>
                                            <button onClick={() => handleDuplicate(t)} className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-2 transition-colors">
                                                <Copy size={14} /> Duplicate
                                            </button>
                                            <button onClick={() => handleExport(t)} className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 flex items-center gap-2 transition-colors">
                                                <Download size={14} /> Export
                                            </button>
                                            <div className="flex-1" />
                                            <span className="text-[11px] text-slate-400">
                                                {t.isoReference} · Modified {t.lastModified} by {t.createdBy}
                                            </span>
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

function StatusPill({ status }: { status: string }) {
    const styles: Record<string, string> = {
        active: 'bg-green-100 text-green-700',
        draft: 'bg-amber-100 text-amber-700',
        archived: 'bg-slate-100 text-slate-500',
    };
    return (
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase ${styles[status] || 'bg-slate-100 text-slate-500'}`}>
            {status}
        </span>
    );
}
