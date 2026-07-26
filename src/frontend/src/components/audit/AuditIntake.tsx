/**
 * AuditIntake.tsx — Step 1: Intake & Scope Definition
 *
 * Collects assessor registration, audit scope, organizational context
 * (ISO 55001 §4: Context of the Organization), and ISO 55000:2024
 * series alignment assessment (ISO 55010/55011/55012/55013).
 *
 * This data contextualizes all subsequent steps so the AI can
 * align findings, recommendations, and roadmap to the organization's
 * vision, mission, and strategic objectives.
 */

import React, { useState, useEffect } from 'react';
import { ClipboardList, Building2, Target, ShieldCheck, Library, ArrowRight, ChevronDown, ChevronUp, User, AtSign, Mail, Phone, MapPin, Factory, Boxes, FileText, Eye, AlertTriangle, DollarSign, BookOpen, Users, Database, Scale, Plus, X, Lightbulb, Check, Search } from 'lucide-react';
import type { AuditIntakeData, ISOSeriesAlignment } from '../../eam/services/AuditTypes';
import { INDUSTRY_OPTIONS, ASSET_CLASS_OPTIONS, EMPTY_INTAKE, ISO_ALIGNMENT_OPTIONS, COUNTRY_CODES, INDUSTRY_RISK_MAP, INDUSTRY_OPPORTUNITY_MAP } from '../../eam/services/AuditTypes';
import { useAuth } from '../../eam/contexts/AuthContext';
import { DatabaseService } from '../../eam/services/DatabaseService';

interface Props {
    initialData?: AuditIntakeData;
    onComplete: (data: AuditIntakeData) => void;
}

type SectionKey = 'assessor' | 'scope' | 'context' | 'iso_series';

// Section accent colors
const SECTION_COLORS: Record<SectionKey, { accent: string; iconBg: string }> = {
    assessor: { accent: '#3b82f6', iconBg: '#eff6ff' },
    scope: { accent: '#f59e0b', iconBg: '#fffbeb' },
    context: { accent: '#8b5cf6', iconBg: '#f5f3ff' },
    iso_series: { accent: '#991b1b', iconBg: '#fef2f2' },
};

/** Generate username from first + last name: first initial + '.' + lowercase last name */
function generateUsername(firstName: string, lastName: string): string {
    const first = firstName.trim();
    const last = lastName.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!first || !last) return '';
    return `${first[0].toLowerCase()}.${last}`;
}

export const AuditIntake: React.FC<Props> = ({ initialData, onComplete }) => {
    const [form, setForm] = useState<AuditIntakeData>(initialData || { ...EMPTY_INTAKE });
    const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(new Set(['assessor']));
    const [customRisk, setCustomRisk] = useState('');
    const [customOpportunity, setCustomOpportunity] = useState('');
    const [autoFilled, setAutoFilled] = useState(false);

    // ─── Preloaded Sites from Asset Module ─────────────
    const [preloadedSites, setPreloadedSites] = useState<{ id: string; name: string; tag: string }[]>([]);
    const [siteMode, setSiteMode] = useState<'select' | 'manual'>('select');
    const [sitesLoading, setSitesLoading] = useState(true);

    useEffect(() => {
        const loadSites = async () => {
            try {
                const db = DatabaseService.getInstance();
                const assets = await db.getAssets();
                // Filter for SITE-level hierarchy assets (ISO 14224 L2)
                const sites = assets
                    .filter((a: any) => a.category === 'Site' || a.category === 'SITE')
                    .map((a: any) => ({ id: a.id, name: a.name, tag: a.tag || '' }));
                setPreloadedSites(sites);
                // If no sites in Asset Module, default to manual mode
                if (sites.length === 0) setSiteMode('manual');
            } catch (e) {
                console.warn('[AuditIntake] Could not load preloaded sites:', e);
                setSiteMode('manual');
            } finally {
                setSitesLoading(false);
            }
        };
        loadSites();
    }, []);

    // ─── Auth context: auto-fill from logged-in user ─────────────
    const { profile } = useAuth();

    useEffect(() => {
        // Only auto-fill if we have a profile AND form is still empty (new assessment)
        if (profile && !autoFilled && !initialData?.firstName) {
            const profileName = profile.fullName || profile.username || '';
            const [pFirstName, ...pLastParts] = profileName.split(/\s+/);
            const pLastName = pLastParts.join(' ');
            const pUsername = profile.username || '';
            const pEmail = profile.email || '';

            setForm(prev => {
                const firstName = pFirstName || prev.firstName;
                const lastName = pLastName || prev.lastName;
                const autoUser = prev.autoUsername
                    ? generateUsername(firstName, lastName)
                    : prev.username;

                return {
                    ...prev,
                    firstName,
                    lastName,
                    fullName: `${firstName} ${lastName}`.trim(),
                    username: pUsername || autoUser,
                    autoUsername: !pUsername, // If they have a system username, don't auto-generate
                    email: pEmail || prev.email,
                    jobTitle: profile.roleLabel || prev.jobTitle,
                };
            });
            setAutoFilled(true);
        }
    }, [profile, autoFilled, initialData]);

    const set = (key: keyof AuditIntakeData, value: any) =>
        setForm(prev => ({ ...prev, [key]: value }));

    /** Update first or last name and recompute fullName + auto-username */
    const setName = (field: 'firstName' | 'lastName', value: string) => {
        setForm(prev => {
            const firstName = field === 'firstName' ? value : prev.firstName;
            const lastName = field === 'lastName' ? value : prev.lastName;
            const fullName = `${firstName} ${lastName}`.trim();
            const username = prev.autoUsername
                ? generateUsername(firstName, lastName)
                : prev.username;
            return { ...prev, [field]: value, fullName, username };
        });
    };

    /** Toggle auto-username: if enabling, regenerate; if disabling, keep current */
    const toggleAutoUsername = () => {
        setForm(prev => {
            const newAuto = !prev.autoUsername;
            const username = newAuto
                ? generateUsername(prev.firstName, prev.lastName)
                : prev.username;
            return { ...prev, autoUsername: newAuto, username };
        });
    };

    const toggleRisk = (risk: string) => {
        setForm(prev => {
            const current = prev.keyRisks;
            const next = current.includes(risk)
                ? current.filter(r => r !== risk)
                : [...current, risk];
            return { ...prev, keyRisks: next };
        });
    };

    const toggleOpportunity = (opp: string) => {
        setForm(prev => {
            const current = prev.keyOpportunities;
            const next = current.includes(opp)
                ? current.filter(o => o !== opp)
                : [...current, opp];
            return { ...prev, keyOpportunities: next };
        });
    };

    const setIso = (key: keyof ISOSeriesAlignment, value: string) =>
        setForm(prev => ({ ...prev, isoAlignment: { ...prev.isoAlignment, [key]: value } }));

    const toggleSection = (key: SectionKey) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const canSubmit = form.firstName && form.lastName && form.company && form.email && form.mobile && form.siteName && form.industrySector;

    return (
        <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
            {/* Header */}
            <div className="text-center mb-2">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-primary-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
                    <ClipboardList size={24} className="text-white" />
                </div>
                <h2 className="text-2xl font-black text-slate-800">Step 1 — Intake & Scope</h2>
                <p className="text-sm text-slate-500 mt-1">Assessor registration, audit scope, organizational context & ISO 55000 series alignment</p>
            </div>

            {/* ─── Section A: Assessor Registration ──────────── */}
            <SectionCard
                sectionKey="assessor"
                title="Assessor Registration"
                subtitle="Who is conducting this audit?"
                icon={<Building2 size={16} className="text-blue-500" />}
                expanded={expandedSections.has('assessor')}
                onToggle={() => toggleSection('assessor')}
            >
                {autoFilled && (
                    <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200/80">
                        <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                            <Check size={11} className="text-emerald-600" />
                        </div>
                        <p className="text-[11px] text-emerald-700">
                            <strong>Auto-populated</strong> from your login profile. Review and edit as needed.
                        </p>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    {/* Row 1: First Name / Last Name */}
                    <Field label="First Name" required accentColor="#3b82f6" icon={<User size={11} />}>
                        <input value={form.firstName} onChange={e => setName('firstName', e.target.value)} placeholder="John" className="input-field" />
                    </Field>
                    <Field label="Last Name" required accentColor="#3b82f6" icon={<User size={11} />}>
                        <input value={form.lastName} onChange={e => setName('lastName', e.target.value)} placeholder="Martinez" className="input-field" />
                    </Field>

                    {/* Row 2: Username with auto-generate toggle */}
                    <div className="col-span-2">
                        <div className="grid grid-cols-2 gap-x-5">
                            <Field label="Username" accentColor="#3b82f6" icon={<AtSign size={11} />}>
                                <input
                                    value={form.username}
                                    onChange={e => {
                                        if (!form.autoUsername) {
                                            set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''));
                                        }
                                    }}
                                    placeholder="j.martinez"
                                    className={`input-field ${form.autoUsername ? 'bg-slate-50 text-slate-500' : ''}`}
                                    readOnly={form.autoUsername}
                                />
                                <p className="text-[10px] text-slate-400 mt-0.5">System login ID — used for EAM access upon full adoption</p>
                            </Field>
                            <div className="flex items-end pb-1">
                                <label className="flex items-center gap-2.5 cursor-pointer py-2.5 px-3 rounded-lg hover:bg-blue-50/60 transition-colors select-none">
                                    <div
                                        className={`w-4.5 h-4.5 rounded border-2 flex items-center justify-center transition-all ${
                                            form.autoUsername
                                                ? 'bg-blue-500 border-blue-500'
                                                : 'border-slate-300 bg-white'
                                        }`}
                                        style={{ width: 18, height: 18 }}
                                        onClick={toggleAutoUsername}
                                    >
                                        {form.autoUsername && <Check size={11} className="text-white" />}
                                    </div>
                                    <div onClick={toggleAutoUsername}>
                                        <span className="text-xs font-medium text-slate-700">Auto-generate username</span>
                                        <p className="text-[10px] text-slate-400 mt-0">First initial + last name (e.g., j.martinez)</p>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Row 3: Job Title / Company */}
                    <Field label="Job Title" accentColor="#3b82f6" icon={<FileText size={11} />}>
                        <input value={form.jobTitle} onChange={e => set('jobTitle', e.target.value)} placeholder="Reliability Engineer" className="input-field" />
                    </Field>

                    <Field label="Company / Organization" required accentColor="#3b82f6" icon={<Building2 size={11} />}>
                        <input value={form.company} onChange={e => set('company', e.target.value)} placeholder="Acme Energy Ltd" className="input-field" />
                    </Field>
                    <Field label="Email" required accentColor="#3b82f6" icon={<Mail size={11} />}>
                        <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="j.martinez@acme.com" className="input-field" />
                    </Field>

                    {/* Row 4: Contact — Country Code + Mobile composite */}
                    <Field label="Mobile" required accentColor="#3b82f6" icon={<Phone size={11} />}>
                        <div className="flex gap-0">
                            <select
                                value={form.mobileCountryCode}
                                onChange={e => set('mobileCountryCode', e.target.value)}
                                className="input-field !rounded-r-none !border-r-0 shrink-0"
                                style={{ width: 110, minWidth: 110, fontSize: 11 }}
                                title="Country dialling code"
                            >
                                {COUNTRY_CODES.map(cc => (
                                    <option key={cc.iso3} value={cc.iso3}>{cc.iso3} {cc.code}</option>
                                ))}
                            </select>
                            <input
                                type="tel"
                                value={form.mobile}
                                onChange={e => {
                                    // Allow only digits, spaces, and dashes
                                    const cleaned = e.target.value.replace(/[^\d\s-]/g, '');
                                    set('mobile', cleaned);
                                }}
                                placeholder="555 012 3456"
                                className="input-field !rounded-l-none flex-1"
                                maxLength={15}
                            />
                        </div>
                    </Field>

                    {/* Row 4b: Location — Smart picker with preloaded Asset Module sites */}
                    <Field label="Site / Location" required accentColor="#3b82f6" icon={<MapPin size={11} />}>
                        {sitesLoading ? (
                            <div className="input-field bg-slate-50 flex items-center gap-2 text-slate-400">
                                <div className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                                <span className="text-xs">Loading locations...</span>
                            </div>
                        ) : preloadedSites.length > 0 && siteMode === 'select' ? (
                            <div className="space-y-1.5">
                                <select
                                    value={form.siteName}
                                    onChange={e => {
                                        if (e.target.value === '__OTHER__') {
                                            setSiteMode('manual');
                                            set('siteName', '');
                                        } else {
                                            set('siteName', e.target.value);
                                        }
                                    }}
                                    className="input-field"
                                >
                                    <option value="">Select a site...</option>
                                    {preloadedSites.map(s => (
                                        <option key={s.id} value={s.name}>
                                            {s.tag ? `${s.tag} — ${s.name}` : s.name}
                                        </option>
                                    ))}
                                    <option value="__OTHER__">✏️ Other — Type manually</option>
                                </select>
                                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                    <Search size={9} className="text-blue-400" />
                                    {preloadedSites.length} site{preloadedSites.length !== 1 ? 's' : ''} loaded from Asset Register
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                <input
                                    value={form.siteName}
                                    onChange={e => set('siteName', e.target.value)}
                                    placeholder="Houston Refinery"
                                    className="input-field"
                                />
                                {preloadedSites.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => { setSiteMode('select'); set('siteName', ''); }}
                                        className="text-[10px] text-blue-500 hover:text-blue-700 transition-colors flex items-center gap-1"
                                    >
                                        <MapPin size={9} /> Select from Asset Register instead
                                    </button>
                                )}
                            </div>
                        )}
                    </Field>

                    {/* Row 5: Classification */}
                    <Field label="Industry Sector" required accentColor="#3b82f6" icon={<Factory size={11} />}>
                        <select value={form.industrySector} onChange={e => {
                            const newIndustry = e.target.value;
                            const newRisks = INDUSTRY_RISK_MAP[newIndustry] || INDUSTRY_RISK_MAP['Other'];
                            const newOpps = INDUSTRY_OPPORTUNITY_MAP[newIndustry] || INDUSTRY_OPPORTUNITY_MAP['Other'];
                            setForm(prev => ({
                                ...prev,
                                industrySector: newIndustry,
                                keyRisks: prev.keyRisks.filter(r => newRisks.includes(r)),
                                keyOpportunities: prev.keyOpportunities.filter(o => newOpps.includes(o)),
                            }));
                        }} className="input-field">
                            {INDUSTRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </Field>
                    <Field label="Asset Class" accentColor="#3b82f6" icon={<Boxes size={11} />}>
                        <select value={form.assetClass} onChange={e => set('assetClass', e.target.value)} className="input-field">
                            {ASSET_CLASS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </Field>
                </div>
            </SectionCard>

            <SectionCard
                sectionKey="scope"
                title="Risks & Opportunities"
                subtitle="ISO 55001:2024 §6.1 — Actions to address risks and opportunities"
                icon={<Target size={16} className="text-amber-500" />}
                expanded={expandedSections.has('scope')}
                onToggle={() => toggleSection('scope')}
                badge="ISO §6.1"
            >
                <div className="space-y-5">
                    <Field label="Reporting Line" accentColor="#f59e0b" icon={<Users size={11} />}>
                        <input value={form.reportingLine} onChange={e => set('reportingLine', e.target.value)} placeholder="VP Operations, Site Manager" className="input-field" />
                    </Field>

                    {/* ── Risks ── */}
                    <Field label={`Risks — ${form.industrySector}`} accentColor="#ef4444" icon={<AlertTriangle size={11} />}>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-1">
                            {(INDUSTRY_RISK_MAP[form.industrySector] || INDUSTRY_RISK_MAP['Other']).map(risk => (
                                <label key={risk} className="flex items-start gap-2 cursor-pointer py-1 px-2 rounded-lg hover:bg-red-50/60 transition-colors">
                                    <input type="checkbox" checked={form.keyRisks.includes(risk)} onChange={() => toggleRisk(risk)}
                                        className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-red-500 focus:ring-red-400 shrink-0" />
                                    <span className={`text-xs leading-snug transition-colors ${form.keyRisks.includes(risk) ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>{risk}</span>
                                </label>
                            ))}
                        </div>
                        {/* Custom risk tags */}
                        {form.keyRisks.filter(r => !(INDUSTRY_RISK_MAP[form.industrySector] || INDUSTRY_RISK_MAP['Other']).includes(r)).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {form.keyRisks.filter(r => !(INDUSTRY_RISK_MAP[form.industrySector] || INDUSTRY_RISK_MAP['Other']).includes(r)).map(r => (
                                    <span key={r} className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                                        {r}
                                        <button type="button" onClick={() => toggleRisk(r)} className="hover:text-red-900 transition-colors"><X size={10} /></button>
                                    </span>
                                ))}
                            </div>
                        )}
                        {/* Other risk free-text */}
                        <div className="mt-2 flex items-center gap-2">
                            <input type="text" value={customRisk} onChange={e => setCustomRisk(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && customRisk.trim()) { e.preventDefault(); if (!form.keyRisks.includes(customRisk.trim())) toggleRisk(customRisk.trim()); setCustomRisk(''); } }}
                                placeholder="Other risk not listed..." className="input-field flex-1 !py-1.5 text-xs" />
                            <button type="button" disabled={!customRisk.trim()} onClick={() => { if (customRisk.trim() && !form.keyRisks.includes(customRisk.trim())) toggleRisk(customRisk.trim()); setCustomRisk(''); }}
                                className="shrink-0 w-7 h-7 rounded-lg bg-red-100 hover:bg-red-200 text-red-600 flex items-center justify-center disabled:opacity-30 transition-colors" title="Add custom risk">
                                <Plus size={14} />
                            </button>
                        </div>
                        {form.keyRisks.length > 0 && (
                            <div className="mt-1.5"><span className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{form.keyRisks.length} risk{form.keyRisks.length !== 1 ? 's' : ''} identified</span></div>
                        )}
                    </Field>

                    {/* ── Opportunities ── */}
                    <Field label={`Opportunities — ${form.industrySector}`} accentColor="#059669" icon={<Lightbulb size={11} />}>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-1">
                            {(INDUSTRY_OPPORTUNITY_MAP[form.industrySector] || INDUSTRY_OPPORTUNITY_MAP['Other']).map(opp => (
                                <label key={opp} className="flex items-start gap-2 cursor-pointer py-1 px-2 rounded-lg hover:bg-emerald-50/60 transition-colors">
                                    <input type="checkbox" checked={form.keyOpportunities.includes(opp)} onChange={() => toggleOpportunity(opp)}
                                        className="mt-0.5 w-3.5 h-3.5 rounded border-slate-300 text-emerald-500 focus:ring-emerald-400 shrink-0" />
                                    <span className={`text-xs leading-snug transition-colors ${form.keyOpportunities.includes(opp) ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>{opp}</span>
                                </label>
                            ))}
                        </div>
                        {/* Custom opportunity tags */}
                        {form.keyOpportunities.filter(o => !(INDUSTRY_OPPORTUNITY_MAP[form.industrySector] || INDUSTRY_OPPORTUNITY_MAP['Other']).includes(o)).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {form.keyOpportunities.filter(o => !(INDUSTRY_OPPORTUNITY_MAP[form.industrySector] || INDUSTRY_OPPORTUNITY_MAP['Other']).includes(o)).map(o => (
                                    <span key={o} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                        {o}
                                        <button type="button" onClick={() => toggleOpportunity(o)} className="hover:text-emerald-900 transition-colors"><X size={10} /></button>
                                    </span>
                                ))}
                            </div>
                        )}
                        {/* Other opportunity free-text */}
                        <div className="mt-2 flex items-center gap-2">
                            <input type="text" value={customOpportunity} onChange={e => setCustomOpportunity(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && customOpportunity.trim()) { e.preventDefault(); if (!form.keyOpportunities.includes(customOpportunity.trim())) toggleOpportunity(customOpportunity.trim()); setCustomOpportunity(''); } }}
                                placeholder="Other opportunity not listed..." className="input-field flex-1 !py-1.5 text-xs" />
                            <button type="button" disabled={!customOpportunity.trim()} onClick={() => { if (customOpportunity.trim() && !form.keyOpportunities.includes(customOpportunity.trim())) toggleOpportunity(customOpportunity.trim()); setCustomOpportunity(''); }}
                                className="shrink-0 w-7 h-7 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-600 flex items-center justify-center disabled:opacity-30 transition-colors" title="Add custom opportunity">
                                <Plus size={14} />
                            </button>
                        </div>
                        {form.keyOpportunities.length > 0 && (
                            <div className="mt-1.5"><span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{form.keyOpportunities.length} opportunit{form.keyOpportunities.length !== 1 ? 'ies' : 'y'} identified</span></div>
                        )}
                    </Field>
                </div>

                <div className="mt-4 flex items-start gap-2.5 p-3 rounded-xl bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-100/80">
                    <div className="w-5 h-5 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Eye size={10} className="text-amber-600" />
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                        <strong className="text-amber-700">Audit Objectives</strong> are automatically synthesized by Relantern AI based on your risks, opportunities,
                        organizational context, and assessment findings — ensuring ISO 55001-aligned, context-specific objectives.
                    </p>
                </div>
            </SectionCard>

            {/* ─── Section C: Organizational Context (ISO 55001 §4) ── */}
            <SectionCard
                sectionKey="context"
                title="Organizational Context"
                subtitle="ISO 55001:2024 §4 — Understanding the organization and its context"
                icon={<ShieldCheck size={16} className="text-blue-500" />}
                expanded={expandedSections.has('context')}
                onToggle={() => toggleSection('context')}
                badge="ISO 55001 §4"
            >
                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-blue-50 border border-blue-100/80">
                        <div className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                            <BookOpen size={12} className="text-blue-500" />
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            <strong className="text-blue-700">Why this matters:</strong> The AI assessor uses your organization's vision, mission, and strategic objectives
                            to contextualize all findings and recommendations. Outcomes are aligned to what the organization is trying to achieve,
                            not generic best practices. This is the foundation of ISO 55001:2024's emphasis on <em className="text-blue-600 font-semibold">value realization</em>.
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                        <Field label="Organization Vision" accentColor="#8b5cf6" icon={<Eye size={11} />}>
                            <textarea value={form.orgVision} onChange={e => set('orgVision', e.target.value)}
                                placeholder="e.g., To be the safest and most reliable operator in the basin..."
                                rows={2} className="input-field resize-none" />
                        </Field>
                        <Field label="Organization Mission" accentColor="#8b5cf6" icon={<Target size={11} />}>
                            <textarea value={form.orgMission} onChange={e => set('orgMission', e.target.value)}
                                placeholder="e.g., Deliver safe, sustainable energy production through operational excellence..."
                                rows={2} className="input-field resize-none" />
                        </Field>
                    </div>
                    <Field label="Strategic Objectives" accentColor="#8b5cf6" icon={<ClipboardList size={11} />}>
                        <textarea value={form.orgStrategicObjectives} onChange={e => set('orgStrategicObjectives', e.target.value)}
                            placeholder="e.g., Reduce unplanned downtime by 30%, achieve zero process safety Tier 1 events, extend asset life by 5 years..."
                            rows={2} className="input-field resize-none" />
                    </Field>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                        <Field label="Asset Management Policy" accentColor="#8b5cf6" icon={<FileText size={11} />}>
                            <select value={form.orgAMPolicy} onChange={e => set('orgAMPolicy', e.target.value)} className="input-field">
                                <option value="">Select...</option>
                                <option value="Formal AM policy exists, endorsed by leadership">Formal — Leadership endorsed</option>
                                <option value="Policy exists but not actively communicated">Exists — Not communicated</option>
                                <option value="Informal / undocumented">Informal / Undocumented</option>
                                <option value="No AM policy exists">No AM Policy</option>
                            </select>
                        </Field>
                        <Field label="Strategic AM Plan (SAMP)" accentColor="#8b5cf6" icon={<Scale size={11} />}>
                            <select value={form.orgSAMP} onChange={e => set('orgSAMP', e.target.value)} className="input-field">
                                <option value="">Select...</option>
                                <option value="SAMP exists, aligned to strategy, reviewed annually">Exists — Aligned & Reviewed</option>
                                <option value="SAMP exists but outdated or not linked to strategy">Exists — Outdated / Unlinked</option>
                                <option value="Informal maintenance plans only">Maintenance plans only</option>
                                <option value="No SAMP exists">No SAMP</option>
                            </select>
                        </Field>
                        <Field label="Roles & Authorities" accentColor="#8b5cf6" icon={<Users size={11} />}>
                            <select value={form.orgRolesAuthorities} onChange={e => set('orgRolesAuthorities', e.target.value)} className="input-field">
                                <option value="">Select...</option>
                                <option value="RACI defined for all AM functions">RACI defined — All functions</option>
                                <option value="Roles defined but not consistently applied">Defined — Not consistently applied</option>
                                <option value="Informal role assignments">Informal assignments</option>
                                <option value="No formal RACI or role definitions">No formal definitions</option>
                            </select>
                        </Field>
                        <Field label="Risk-Based Decision Making" accentColor="#8b5cf6" icon={<AlertTriangle size={11} />}>
                            <select value={form.orgRiskFramework} onChange={e => set('orgRiskFramework', e.target.value)} className="input-field">
                                <option value="">Select...</option>
                                <option value="Risk framework integrated into AM decision-making">Integrated into decision-making</option>
                                <option value="Risk assessments done but not linked to AM">Done — Not linked to AM</option>
                                <option value="Ad-hoc risk assessments">Ad-hoc assessments</option>
                                <option value="No structured risk framework">No framework</option>
                            </select>
                        </Field>
                    </div>
                    <Field label="Budget Alignment with Asset Criticality" accentColor="#8b5cf6" icon={<DollarSign size={11} />}>
                        <select value={form.orgBudgetAlignment} onChange={e => set('orgBudgetAlignment', e.target.value)} className="input-field">
                            <option value="">Select...</option>
                            <option value="Budget explicitly linked to criticality ranking">Linked to criticality</option>
                            <option value="Budget considers criticality informally">Informally considered</option>
                            <option value="Budget is flat / historical-based">Flat / Historical</option>
                            <option value="Budget is reactive / unplanned">Reactive / Unplanned</option>
                        </select>
                    </Field>
                </div>
            </SectionCard>

            {/* ─── Section D: ISO 55000 Series Alignment ───────────── */}
            <SectionCard
                sectionKey="iso_series"
                title="ISO 55000 Series Alignment"
                subtitle="Companion standards assessment — Financial, People, Data & Policy"
                icon={<Library size={16} className="text-red-700" />}
                expanded={expandedSections.has('iso_series')}
                onToggle={() => toggleSection('iso_series')}
                badge="55010 · 55011 · 55012 · 55013"
            >
                <div className="space-y-6">
                    <div className="flex items-start gap-3 p-3.5 rounded-xl bg-gradient-to-r from-red-50 to-orange-50 border border-red-100/80">
                        <div className="w-6 h-6 rounded-lg bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                            <Library size={12} className="text-red-700" />
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed">
                            <strong className="text-red-800">ISO 55000:2024 Series:</strong> The 2024 update expanded the family to <strong>7 standards</strong>.
                            Beyond the core trilogy (55000/55001/55002), the companion standards address critical organizational capabilities:
                            <em className="text-red-700 font-semibold"> financial alignment</em> (55010), <em className="text-red-700 font-semibold">regulatory awareness</em> (55011),
                            <em className="text-red-700 font-semibold"> people & competence</em> (55012), and <em className="text-red-700 font-semibold">data governance</em> (55013).
                        </p>
                    </div>

                    {/* ISO 55010 */}
                    <ISOGroupCard standard="ISO 55010" title="Financial & Non-Financial Alignment" description="Bridges financial and technical functions — asset register alignment, CAPEX planning, performance metrics" accent="#b45309">
                        <div className="space-y-3">
                            <Field label="Financial-Technical Function Alignment" accentColor="#b45309" icon={<DollarSign size={11} />}>
                                <select value={form.isoAlignment.iso55010_financial_alignment} onChange={e => setIso('iso55010_financial_alignment', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55010_financial_alignment.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                            <Field label="Technical vs. Financial Asset Register" accentColor="#b45309" icon={<Database size={11} />}>
                                <select value={form.isoAlignment.iso55010_register_alignment} onChange={e => setIso('iso55010_register_alignment', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55010_register_alignment.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                            <Field label="CAPEX Integration with Asset Lifecycle" accentColor="#b45309" icon={<Scale size={11} />}>
                                <select value={form.isoAlignment.iso55010_capex_integration} onChange={e => setIso('iso55010_capex_integration', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55010_capex_integration.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                        </div>
                    </ISOGroupCard>

                    {/* ISO 55011 */}
                    <ISOGroupCard standard="ISO 55011" title="Regulatory & Policy Awareness" description="Regulatory obligation mapping, industry standards engagement, enabling environment" accent="#0369a1">
                        <div className="space-y-3">
                            <Field label="Regulatory Obligation Mapping" accentColor="#0369a1" icon={<FileText size={11} />}>
                                <select value={form.isoAlignment.iso55011_regulatory_mapping} onChange={e => setIso('iso55011_regulatory_mapping', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55011_regulatory_mapping.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                            <Field label="Industry Policy / Standards Engagement" accentColor="#0369a1" icon={<BookOpen size={11} />}>
                                <select value={form.isoAlignment.iso55011_policy_engagement} onChange={e => setIso('iso55011_policy_engagement', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55011_policy_engagement.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                        </div>
                    </ISOGroupCard>

                    {/* ISO 55012 */}
                    <ISOGroupCard standard="ISO 55012" title="People Involvement & Competence" description="Competence frameworks aligned to SAMP, cultural factors, leadership engagement" accent="#059669">
                        <div className="space-y-3">
                            <Field label="Competence Framework for AM Roles" accentColor="#059669" icon={<Users size={11} />}>
                                <select value={form.isoAlignment.iso55012_competence_framework} onChange={e => setIso('iso55012_competence_framework', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55012_competence_framework.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                            <Field label="Human & Cultural Factors Assessment" accentColor="#059669" icon={<ShieldCheck size={11} />}>
                                <select value={form.isoAlignment.iso55012_cultural_factors} onChange={e => setIso('iso55012_cultural_factors', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55012_cultural_factors.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                            <Field label="Outsourced / Contractor Competence" accentColor="#059669" icon={<Factory size={11} />}>
                                <select value={form.isoAlignment.iso55012_outsourced_competence} onChange={e => setIso('iso55012_outsourced_competence', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55012_outsourced_competence.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                        </div>
                    </ISOGroupCard>

                    {/* ISO 55013 */}
                    <ISOGroupCard standard="ISO 55013" title="Data for Asset Management" description="Data governance (EDM model), data quality management, data lifecycle, asset data vs. data assets" accent="#7c3aed">
                        <div className="space-y-3">
                            <Field label="Data Governance Structure" accentColor="#7c3aed" icon={<Database size={11} />}>
                                <select value={form.isoAlignment.iso55013_data_governance} onChange={e => setIso('iso55013_data_governance', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55013_data_governance.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                            <Field label="Data Quality Management" accentColor="#7c3aed" icon={<ShieldCheck size={11} />}>
                                <select value={form.isoAlignment.iso55013_data_quality} onChange={e => setIso('iso55013_data_quality', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55013_data_quality.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                            <Field label="Data Asset Distinction" accentColor="#7c3aed" icon={<Boxes size={11} />}>
                                <select value={form.isoAlignment.iso55013_data_asset_distinction} onChange={e => setIso('iso55013_data_asset_distinction', e.target.value)} className="input-field">
                                    <option value="">Select current state...</option>
                                    {ISO_ALIGNMENT_OPTIONS.iso55013_data_asset_distinction.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </Field>
                        </div>
                    </ISOGroupCard>
                </div>
            </SectionCard>

            {/* Submit */}
            <div className="flex justify-end pt-2">
                <button
                    onClick={() => canSubmit && onComplete(form)}
                    disabled={!canSubmit}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-primary-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg disabled:opacity-40 transition-all flex items-center gap-2 hover:scale-[1.02]"
                >
                    Proceed to Document Review <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};

// ─── Shared Widgets ──────────────────────────────

function SectionCard({ sectionKey, title, subtitle, icon, expanded, onToggle, badge, children }: {
    sectionKey: SectionKey; title: string; subtitle: string; icon: React.ReactNode; expanded: boolean;
    onToggle: () => void; badge?: string; children: React.ReactNode;
}) {
    const colors = SECTION_COLORS[sectionKey];
    return (
        <div
            className="audit-section-card"
            data-expanded={expanded}
            style={{ '--section-accent': colors.accent } as React.CSSProperties}
        >
            <button onClick={onToggle} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                <div className="flex items-center gap-3">
                    <div className="audit-section-icon" style={{ '--icon-bg': colors.iconBg } as React.CSSProperties}>
                        {icon}
                    </div>
                    <div className="text-left">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-slate-800">{title}</h3>
                            {badge && <span className="audit-iso-badge">{badge}</span>}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>
                    </div>
                </div>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${expanded ? 'bg-slate-200/80 rotate-0' : 'bg-slate-100 rotate-0'}`}>
                    {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-400" />}
                </div>
            </button>
            {expanded && (
                <div className="px-6 pb-6 border-t border-slate-100/80 pt-5">
                    {children}
                </div>
            )}
        </div>
    );
}

function ISOGroupCard({ standard, title, description, accent, children }: {
    standard: string; title: string; description: string; accent: string; children: React.ReactNode;
}) {
    return (
        <div className="audit-iso-group" style={{ '--iso-accent': accent } as React.CSSProperties}>
            <div className="flex items-center gap-2.5 mb-2 pt-1">
                <span className="audit-iso-badge">{standard}</span>
                <span className="text-sm font-bold text-slate-700">{title}</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">{description}</p>
            {children}
        </div>
    );
}

function Field({ label, required, accentColor, icon, children }: {
    label: string; required?: boolean; accentColor?: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
    return (
        <div>
            <div className="audit-field-label" style={{ '--section-accent': accentColor } as React.CSSProperties}>
                <span className="label-dot" />
                {icon && <span className="text-slate-400">{icon}</span>}
                <span>{label}</span>
                {required && <span className="label-required">*</span>}
            </div>
            {children}
        </div>
    );
}
