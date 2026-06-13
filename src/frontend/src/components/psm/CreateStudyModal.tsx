/**
 * CreateStudyModal — Standardised PSM Study Creation Workflow
 *
 * Follows international best practices:
 *   OSHA 1910.119, IEC 61882, IEC 61511, IEC 61508,
 *   IEC 62502, ISO 31000, CCPS/Shell, API 752/753
 *
 * Creates a properly populated PSMStudy record with methodology,
 * scope, team, asset context, and study-type-specific metadata.
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    X, ChevronRight, ChevronLeft, Search, CheckCircle,
    Users, FileText, Shield, Target, Calendar, Info,
    AlertTriangle, Plus, Trash2,
} from 'lucide-react';
import { useAssetContext } from '../../contexts/AssetContext';
import psmService from '../../eam/services/PSMService';
import type { PSMStudy, PSMStudyType, PSMStudyTeamMember } from '../../types/safety';

// ═══════════════════════════════════════════════════════════════
//  Configuration per study type
// ═══════════════════════════════════════════════════════════════

interface StudyTypeConfig {
    label: string;
    standard: string;
    standardFull: string;
    description: string;
    icon: React.ReactNode;
    defaultMethodology: string;
    methodologies: string[];
    requiredFields: string[];
    metadataFields: { key: string; label: string; type: 'text' | 'select' | 'number' | 'textarea'; options?: string[]; placeholder?: string; tooltip?: string }[];
    teamRoles: string[];
    color: string;
}

const STUDY_TYPE_CONFIG: Record<PSMStudyType, StudyTypeConfig> = {
    hazop: {
        label: 'HAZOP Study',
        standard: 'IEC 61882',
        standardFull: 'IEC 61882:2016 — Hazard and Operability Studies',
        description: 'Systematic examination of process deviations using guide words applied to process parameters.',
        icon: <AlertTriangle size={16} />,
        defaultMethodology: 'Full HAZOP (Guide Word)',
        methodologies: ['Full HAZOP (Guide Word)', 'Modified HAZOP', 'Software HAZOP', 'Procedure HAZOP', 'Human HAZOP'],
        requiredFields: ['title', 'asset', 'facilitator', 'scope'],
        metadataFields: [
            { key: 'drawing_ref', label: 'P&ID / Drawing Reference', type: 'text', placeholder: 'e.g. DWG-P&ID-001 Rev.3', tooltip: 'Reference to process piping & instrumentation diagrams' },
            { key: 'process_description', label: 'Process Description', type: 'textarea', placeholder: 'Brief description of the process section under study', tooltip: 'Per IEC 61882 Cl.6.3 — describe the system design intent' },
            { key: 'design_conditions', label: 'Design Conditions', type: 'text', placeholder: 'e.g. 150°C, 25 barg, H₂S service', tooltip: 'Operating envelope and hazardous materials present' },
            { key: 'node_strategy', label: 'Node Definition Strategy', type: 'select', options: ['By P&ID section', 'By equipment', 'By operating step', 'By line number'], tooltip: 'How nodes will be defined per IEC 61882 Cl.6.4' },
        ],
        teamRoles: ['Study Leader', 'Scribe', 'Process Engineer', 'Operations Rep', 'Instrumentation Engineer', 'Mechanical Engineer', 'Safety Engineer', 'Project Engineer'],
        color: 'from-amber-500 to-orange-500',
    },
    pha: {
        label: 'Process Hazard Analysis',
        standard: 'OSHA 1910.119(e)',
        standardFull: 'OSHA 1910.119(e) — Process Hazard Analysis',
        description: 'Systematic hazard identification using What-If or Checklist analysis appropriate for the process complexity.',
        icon: <Shield size={16} />,
        defaultMethodology: 'What-If',
        methodologies: ['What-If', 'Checklist', 'What-If / Checklist', 'Failure Modes & Effects', 'Fault Tree Analysis'],
        requiredFields: ['title', 'asset', 'facilitator', 'scope'],
        metadataFields: [
            { key: 'pha_scope', label: 'PHA Scope Boundary', type: 'textarea', placeholder: 'Define system boundaries and interfaces included in this analysis', tooltip: 'Per OSHA 1910.119(e)(1) — identify hazards of the process' },
            { key: 'previous_pha_ref', label: 'Previous PHA Reference', type: 'text', placeholder: 'e.g. PHA-2021-045', tooltip: 'Reference to previous PHA study for revalidation tracking (5-yr cycle per OSHA)' },
            { key: 'process_chemicals', label: 'Highly Hazardous Chemicals', type: 'textarea', placeholder: 'List HHCs present and threshold quantities', tooltip: 'Per OSHA 1910.119(a)(1) — Appendix A chemicals' },
            { key: 'revalidation_required', label: 'Revalidation Type', type: 'select', options: ['Initial study', 'Revalidation (5-year)', 'MOC-triggered revalidation', 'Incident-triggered review'], tooltip: 'Per OSHA 1910.119(e)(6) — shall be updated and revalidated every 5 years' },
        ],
        teamRoles: ['Team Leader', 'Scribe', 'Process Engineer', 'Operations Supervisor', 'Maintenance Rep', 'Safety Representative', 'Subject Matter Expert'],
        color: 'from-blue-500 to-blue-500',
    },
    lopa: {
        label: 'Layer of Protection Analysis',
        standard: 'IEC 61511 / CCPS',
        standardFull: 'IEC 61511:2016 — Functional Safety: Safety Instrumented Systems for the Process Industry',
        description: 'Semi-quantitative risk assessment evaluating independent protection layers against process hazard scenarios.',
        icon: <Target size={16} />,
        defaultMethodology: 'CCPS LOPA',
        methodologies: ['CCPS LOPA', 'Modified LOPA', 'Simplified LOPA'],
        requiredFields: ['title', 'asset', 'facilitator', 'scope'],
        metadataFields: [
            { key: 'risk_criteria', label: 'Corporate Risk Criteria', type: 'text', placeholder: 'e.g. Individual risk < 1E-4/yr, Societal risk ALARP', tooltip: 'Tolerable risk criteria used for gap calculation' },
            { key: 'target_mitigated_freq', label: 'Target Mitigated Frequency (/yr)', type: 'number', placeholder: 'e.g. 0.0001', tooltip: 'Per CCPS LOPA — frequency target for the consequence category' },
            { key: 'linked_pha_ref', label: 'Linked PHA / HAZOP Reference', type: 'text', placeholder: 'e.g. HAZOP-2024-012, Scenario 3.2', tooltip: 'Scenarios should originate from a PHA or HAZOP per IEC 61511 Cl.8.2' },
            { key: 'consequence_categories', label: 'Consequence Endpoints', type: 'select', options: ['Safety (fatality)', 'Safety (injury)', 'Environmental', 'Financial', 'Reputation'], tooltip: 'Worst credible consequence category per CCPS methodology' },
        ],
        teamRoles: ['LOPA Facilitator', 'Scribe', 'Process Safety Engineer', 'SIS Engineer', 'Operations Rep', 'Reliability Engineer'],
        color: 'from-teal-500 to-cyan-500',
    },
    bowtie: {
        label: 'Bow-Tie Analysis',
        standard: 'CCPS / Shell',
        standardFull: 'CCPS Guidelines for Risk-Based Process Safety / Shell Bow-Tie Methodology',
        description: 'Visual risk assessment mapping threats through barriers to a top event and consequences through recovery barriers.',
        icon: <Target size={16} />,
        defaultMethodology: 'Shell Bow-Tie',
        methodologies: ['Shell Bow-Tie', 'CCPS Bow-Tie', 'CGE Bow-Tie'],
        requiredFields: ['title', 'asset', 'facilitator', 'scope'],
        metadataFields: [
            { key: 'top_event', label: 'Top Event Description', type: 'text', placeholder: 'e.g. Loss of Containment — Flammable Gas Release', tooltip: 'The central hazardous event that barriers prevent/mitigate' },
            { key: 'hazard_description', label: 'Hazard Description', type: 'textarea', placeholder: 'Describe the hazard (material, energy, condition)', tooltip: 'The source of potential harm or damage' },
            { key: 'barrier_standard', label: 'Barrier Assessment Standard', type: 'select', options: ['Barrier effectiveness only', 'Barrier + escalation factors', 'Full degradation assessment'], tooltip: 'Level of detail for barrier effectiveness assessment' },
        ],
        teamRoles: ['Facilitator', 'Scribe', 'Process Safety Engineer', 'Operations Rep', 'Maintenance Rep', 'HSE Manager'],
        color: 'from-blue-500 to-pink-500',
    },
    fta: {
        label: 'Fault Tree Analysis',
        standard: 'IEC 61025',
        standardFull: 'IEC 61025:2006 — Fault Tree Analysis',
        description: 'Top-down deductive analysis identifying combinations of basic events leading to an undesired top event.',
        icon: <AlertTriangle size={16} />,
        defaultMethodology: 'Quantitative FTA',
        methodologies: ['Qualitative FTA', 'Quantitative FTA', 'Computer-aided FTA'],
        requiredFields: ['title', 'asset', 'facilitator', 'scope'],
        metadataFields: [
            { key: 'top_event', label: 'Top Event', type: 'text', placeholder: 'e.g. Complete loss of cooling water supply', tooltip: 'The undesired event at the top of the fault tree' },
            { key: 'system_boundary', label: 'System Boundary', type: 'textarea', placeholder: 'Define the system boundary and exclusions', tooltip: 'Per IEC 61025 Cl.5 — clear boundary definition prevents scope creep' },
            { key: 'data_source', label: 'Failure Rate Data Source', type: 'select', options: ['OREDA', 'IEEE 493', 'Plant-specific data', 'Expert judgement', 'Combined'], tooltip: 'Source of basic event failure rates for quantification' },
        ],
        teamRoles: ['FTA Analyst', 'Process Engineer', 'Reliability Engineer', 'Instrumentation Engineer', 'Safety Engineer'],
        color: 'from-red-500 to-rose-500',
    },
    eta: {
        label: 'Event Tree Analysis',
        standard: 'IEC 62502',
        standardFull: 'IEC 62502:2010 — Analysis Techniques for Dependability — Event Tree Analysis',
        description: 'Forward-looking inductive analysis tracing an initiating event through safety function success/failure branches.',
        icon: <Target size={16} />,
        defaultMethodology: 'Quantitative ETA',
        methodologies: ['Qualitative ETA', 'Quantitative ETA', 'Linked ETA-FTA'],
        requiredFields: ['title', 'asset', 'facilitator', 'scope'],
        metadataFields: [
            { key: 'initiating_event', label: 'Initiating Event', type: 'text', placeholder: 'e.g. Gas leak from flange failure', tooltip: 'The initial event that begins the accident sequence per IEC 62502' },
            { key: 'ie_frequency', label: 'Initiating Event Frequency (/yr)', type: 'number', placeholder: 'e.g. 0.1', tooltip: 'Annual frequency of the initiating event from reliability data' },
            { key: 'safety_functions', label: 'Safety Functions to Model', type: 'textarea', placeholder: 'List safety functions: Gas Detection, ESD, Blowdown, Deluge', tooltip: 'Per IEC 62502 — each becomes a branch point in the tree' },
        ],
        teamRoles: ['ETA Analyst', 'Process Safety Engineer', 'SIS Engineer', 'Reliability Engineer', 'Operations Rep'],
        color: 'from-emerald-500 to-green-500',
    },
    sil: {
        label: 'SIL Assessment',
        standard: 'IEC 61508/61511',
        standardFull: 'IEC 61508:2010 / IEC 61511:2016 — Functional Safety of Safety Instrumented Systems',
        description: 'Determination and verification of Safety Integrity Level requirements for Safety Instrumented Functions.',
        icon: <Shield size={16} />,
        defaultMethodology: 'Risk Graph (IEC 61511)',
        methodologies: ['Risk Graph (IEC 61511)', 'Risk Matrix', 'LOPA-based SIL', 'Calibrated Risk Graph'],
        requiredFields: ['title', 'asset', 'facilitator', 'scope'],
        metadataFields: [
            { key: 'sil_determination_method', label: 'SIL Determination Method', type: 'select', options: ['Risk Graph', 'Risk Matrix', 'LOPA', 'Calibrated Risk Graph', 'Layer Matrix'], tooltip: 'Per IEC 61511 Cl.8.2.4 — method for determining target SIL' },
            { key: 'demand_mode_default', label: 'Default Demand Mode', type: 'select', options: ['Low demand', 'High demand', 'Continuous'], tooltip: 'Per IEC 61511 Cl.3.2 — affects PFD/PFH requirements' },
            { key: 'verification_standard', label: 'Verification Standard', type: 'select', options: ['ISA TR 84.00.02', 'IEC 61508-6', 'PDS Method', 'Exida exSILentia'], tooltip: 'Standard used for SIL verification calculations' },
            { key: 'proof_test_philosophy', label: 'Proof Test Philosophy', type: 'textarea', placeholder: 'Describe proof test strategy: intervals, partial stroke, online testing', tooltip: 'Per IEC 61511 Cl.16.3 — proof testing requirements' },
        ],
        teamRoles: ['SIL Facilitator', 'SIS Engineer', 'Process Safety Engineer', 'Process Engineer', 'Operations Rep', 'Maintenance Rep'],
        color: 'from-blue-500 to-blue-500',
    },
    pssr: {
        label: 'Pre-Startup Safety Review',
        standard: 'OSHA 1910.119(i)',
        standardFull: 'OSHA 1910.119(i) — Pre-Startup Safety Review',
        description: 'Systematic review confirming that equipment is safe to start up and all safety requirements have been met.',
        icon: <CheckCircle size={16} />,
        defaultMethodology: 'OSHA PSSR Checklist',
        methodologies: ['OSHA PSSR Checklist', 'API RP 750 PSSR', 'Custom PSSR Checklist'],
        requiredFields: ['title', 'asset', 'facilitator', 'scope'],
        metadataFields: [
            { key: 'startup_type', label: 'Startup Type', type: 'select', options: ['New installation', 'Modified facility (MOC)', 'Post-turnaround restart', 'Post-emergency restart', 'Recommissioning'], tooltip: 'Type of startup determines checklist scope per OSHA 1910.119(i)' },
            { key: 'moc_reference', label: 'MOC / Project Reference', type: 'text', placeholder: 'e.g. MOC-2024-087 or PRJ-2024-14', tooltip: 'Link to Management of Change or Project authorization' },
            { key: 'target_startup_date', label: 'Target Startup Date', type: 'text', placeholder: 'YYYY-MM-DD', tooltip: 'Planned date – PSSR must be completed before startup' },
            { key: 'init_standard_checklist', label: 'Auto-Initialize Checklist', type: 'select', options: ['Yes — standard 25-item checklist', 'No — custom items only'], tooltip: 'Pre-populate with industry standard PSSR checklist items per OSHA/API' },
        ],
        teamRoles: ['PSSR Leader', 'Operations Manager', 'Process Engineer', 'Maintenance Supervisor', 'HSE Representative', 'Construction Lead', 'Commissioning Lead'],
        color: 'from-sky-500 to-blue-500',
    },
};

const TAXONOMY_BADGES: Record<string, { label: string; color: string }> = {
    site:      { label: 'SITE',    color: 'bg-blue-100 text-blue-700 border-blue-200' },
    unit:      { label: 'UNIT',    color: 'bg-blue-100 text-blue-700 border-blue-200' },
    system:    { label: 'SYSTEM',  color: 'bg-blue-100 text-blue-700 border-blue-200' },
    equipment: { label: 'EQUIP',   color: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
    subunit:   { label: 'SUBUNIT', color: 'bg-teal-100 text-teal-700 border-teal-200' },
    component: { label: 'COMP',    color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    location:  { label: 'LOC',     color: 'bg-amber-100 text-amber-700 border-amber-200' },
};

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

interface CreateStudyModalProps {
    isOpen: boolean;
    studyType: PSMStudyType;
    onClose: () => void;
    onCreated: (study: PSMStudy) => void;
}

export const CreateStudyModal: React.FC<CreateStudyModalProps> = ({
    isOpen, studyType, onClose, onCreated,
}) => {
    const config = STUDY_TYPE_CONFIG[studyType];
    const { assets: allAssets } = useAssetContext();

    // ── Form State ────────────────────────────────────────────
    const [step, setStep] = useState(1); // 1 = Study Info, 2 = Team & Scope, 3 = Type-Specific, 4 = Review
    const [title, setTitle] = useState('');
    const [assetId, setAssetId] = useState('');
    const [assetTag, setAssetTag] = useState('');
    const [assetName, setAssetName] = useState('');
    const [facilitator, setFacilitator] = useState('');
    const [methodology, setMethodology] = useState(config.defaultMethodology);
    const [scopeDescription, setScopeDescription] = useState('');
    const [studyDate, setStudyDate] = useState(new Date().toISOString().slice(0, 10));
    const [nextReview, setNextReview] = useState('');
    const [teamMembers, setTeamMembers] = useState<PSMStudyTeamMember[]>([]);
    const [metadata, setMetadata] = useState<Record<string, any>>({});
    const [assetSearch, setAssetSearch] = useState('');
    const [showAssetDropdown, setShowAssetDropdown] = useState(false);
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState(false);

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setTitle('');
            setAssetId('');
            setAssetTag('');
            setAssetName('');
            setFacilitator('');
            setMethodology(config.defaultMethodology);
            setScopeDescription('');
            setStudyDate(new Date().toISOString().slice(0, 10));
            setNextReview('');
            setTeamMembers([]);
            setMetadata({});
            setAssetSearch('');
            setShowAssetDropdown(false);
            setCreating(false);
            setCreated(false);
        }
    }, [isOpen, config.defaultMethodology]);

    // ── Asset Picker ──────────────────────────────────────────
    const hierarchyAssets = useMemo(() =>
        allAssets.map(a => ({
            id: a.id,
            tag: a.tag || '',
            name: a.name || '',
            taxonomy_level: (a as any).taxonomy_level || 'equipment',
            criticality: (a as any).criticality || 'C',
        })).sort((a, b) => a.tag.localeCompare(b.tag)),
    [allAssets]);

    const filteredAssets = useMemo(() => {
        if (!assetSearch.trim()) return hierarchyAssets.slice(0, 30);
        const q = assetSearch.toLowerCase();
        return hierarchyAssets.filter(a =>
            a.tag.toLowerCase().includes(q) ||
            a.name.toLowerCase().includes(q) ||
            a.taxonomy_level.toLowerCase().includes(q)
        ).slice(0, 30);
    }, [hierarchyAssets, assetSearch]);

    // ── Team members ──────────────────────────────────────────
    const addTeamMember = useCallback(() => {
        setTeamMembers(prev => [...prev, { name: '', role: config.teamRoles[0] || '', company: '' }]);
    }, [config.teamRoles]);

    const updateTeamMember = useCallback((idx: number, field: keyof PSMStudyTeamMember, value: string) => {
        setTeamMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
    }, []);

    const removeTeamMember = useCallback((idx: number) => {
        setTeamMembers(prev => prev.filter((_, i) => i !== idx));
    }, []);

    // ── Validation ────────────────────────────────────────────
    const step1Valid = title.trim().length > 0 && assetId.length > 0;
    const step2Valid = facilitator.trim().length > 0 && scopeDescription.trim().length > 0;

    // ── Create ────────────────────────────────────────────────
    const handleCreate = useCallback(async () => {
        setCreating(true);
        try {
            const study = await psmService.createStudy({
                study_type: studyType,
                title: title.trim(),
                asset_id: assetId,
                asset_tag: assetTag,
                asset_name: assetName,
                status: 'draft',
                facilitator: facilitator.trim(),
                team_members: teamMembers.filter(m => m.name.trim()),
                methodology,
                standard_ref: config.standard,
                scope_description: scopeDescription.trim(),
                study_date: studyDate || null,
                next_review: nextReview || null,
                metadata,
            });

            if (study) {
                // Auto-init PSSR checklist if requested
                if (studyType === 'pssr' && metadata.init_standard_checklist === 'Yes — standard 25-item checklist') {
                    await psmService.initPSSRChecklist(study.id);
                }
                setCreated(true);
                setTimeout(() => {
                    onCreated(study);
                    onClose();
                }, 1500);
            } else {
                setCreating(false);
                alert('Failed to create study. Please check database connection.');
            }
        } catch (err) {
            console.error('[CreateStudyModal]', err);
            setCreating(false);
            alert('Error creating study. See console for details.');
        }
    }, [studyType, title, assetId, assetTag, assetName, facilitator, teamMembers, methodology, config.standard, scopeDescription, studyDate, nextReview, metadata, onCreated, onClose]);

    if (!isOpen) return null;

    const totalSteps = 4;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
             onClick={() => !creating && !created && onClose()}>
            <div className="bg-white rounded-2xl w-full max-w-2xl mx-4 shadow-2xl max-h-[92vh] overflow-hidden flex flex-col"
                 onClick={e => e.stopPropagation()}>

                {/* ── Header ──────────────────────────────────────── */}
                <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl bg-gradient-to-br ${config.color} text-white`}>
                            {config.icon}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">New {config.label}</h2>
                            <p className="text-[10px] text-slate-500 font-mono">{config.standardFull}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* ── Progress Bar ─────────────────────────────────── */}
                {!created && (
                    <div className="px-5 pt-4 pb-2 shrink-0">
                        <div className="flex items-center gap-1">
                            {[
                                { num: 1, label: 'Study Info' },
                                { num: 2, label: 'Team & Scope' },
                                { num: 3, label: `${config.label.split(' ')[0]} Details` },
                                { num: 4, label: 'Review' },
                            ].map((s, i) => (
                                <React.Fragment key={s.num}>
                                    <button
                                        onClick={() => s.num <= step && setStep(s.num)}
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                                            s.num === step ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' :
                                            s.num < step ? 'bg-emerald-50 text-emerald-600' :
                                            'bg-slate-50 text-slate-400'
                                        }`}
                                    >
                                        {s.num < step ? <CheckCircle size={12} /> : <span className="w-4 h-4 rounded-full bg-current/10 flex items-center justify-center text-[9px]">{s.num}</span>}
                                        <span className="hidden sm:inline">{s.label}</span>
                                    </button>
                                    {i < 3 && <ChevronRight size={12} className="text-slate-300 shrink-0" />}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Body (scrollable) ───────────────────────────── */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                    {created ? (
                        /* Success state */
                        <div className="py-12 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-300">
                            <div className="p-4 bg-emerald-50 rounded-2xl text-emerald-500 ring-4 ring-emerald-100">
                                <CheckCircle size={40} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">{config.label} Created</h3>
                            <p className="text-sm text-slate-500">Opening your new study…</p>
                        </div>
                    ) : step === 1 ? (
                        /* ─── Step 1: Study Information ─────────────── */
                        <div className="space-y-4">
                            {/* Standard badge */}
                            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                <div>
                                    <p className="text-xs text-slate-600">{config.description}</p>
                                    <p className="text-[10px] text-slate-400 mt-1 font-mono">{config.standardFull}</p>
                                </div>
                            </div>

                            {/* Title */}
                            <div>
                                <label className="text-xs text-slate-500 font-medium mb-1.5 block">Study Title *</label>
                                <input
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    placeholder={`e.g. ${studyType === 'hazop' ? 'Gas Compression Unit HAZOP' : studyType === 'lopa' ? 'H₂S Release LOPA — Amine Unit' : studyType === 'pssr' ? 'Turbine T-201 Post-MOC PSSR' : `${config.label} — [Process Unit]`}`}
                                    className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
                                />
                            </div>

                            {/* Methodology */}
                            <div>
                                <label className="text-xs text-slate-500 font-medium mb-1.5 block">Methodology</label>
                                <select
                                    value={methodology}
                                    onChange={e => setMethodology(e.target.value)}
                                    className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
                                >
                                    {config.methodologies.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>

                            {/* Asset Picker */}
                            <div className="relative">
                                <label className="text-xs text-slate-500 font-medium mb-1.5 block">
                                    Target Asset / System *
                                    <span className="text-[10px] text-slate-400 ml-2 font-normal">Equipment or System under study</span>
                                </label>
                                {assetId ? (
                                    <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-4 py-2.5">
                                        {(() => {
                                            const sel = hierarchyAssets.find(a => a.id === assetId);
                                            const badge = TAXONOMY_BADGES[sel?.taxonomy_level || 'equipment'];
                                            return sel ? (
                                                <>
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge?.color || ''}`}>{badge?.label || 'ASSET'}</span>
                                                    <span className="text-sm text-slate-700 font-medium truncate">{sel.tag}</span>
                                                    <span className="text-xs text-slate-400 truncate">— {sel.name}</span>
                                                    {sel.criticality && (
                                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ml-auto ${
                                                            sel.criticality === 'A' ? 'bg-red-100 text-red-700 border-red-200' :
                                                            sel.criticality === 'B' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                                            'bg-slate-100 text-slate-600 border-slate-200'
                                                        }`}>Crit {sel.criticality}</span>
                                                    )}
                                                </>
                                            ) : <span className="text-sm text-slate-500">Unknown asset</span>;
                                        })()}
                                        <button className="ml-2 p-1 text-slate-400 hover:text-red-500 transition-colors"
                                                onClick={() => { setAssetId(''); setAssetTag(''); setAssetName(''); setShowAssetDropdown(true); }}>
                                            <X size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            value={assetSearch}
                                            onChange={e => { setAssetSearch(e.target.value); setShowAssetDropdown(true); }}
                                            onFocus={() => setShowAssetDropdown(true)}
                                            placeholder="Search by tag, name, or level…"
                                            className="w-full border border-slate-200 rounded-lg pl-9 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400"
                                        />
                                    </div>
                                )}
                                {showAssetDropdown && !assetId && (
                                    <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto">
                                        {filteredAssets.length === 0 && <div className="p-3 text-xs text-slate-400 text-center">No assets found</div>}
                                        {filteredAssets.map(a => {
                                            const badge = TAXONOMY_BADGES[a.taxonomy_level] || TAXONOMY_BADGES.equipment;
                                            return (
                                                <button key={a.id}
                                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-teal-50 transition-colors text-left"
                                                        onClick={() => {
                                                            setAssetId(a.id); setAssetTag(a.tag); setAssetName(a.name);
                                                            setShowAssetDropdown(false); setAssetSearch('');
                                                        }}>
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${badge.color}`}>{badge.label}</span>
                                                    <span className="text-sm text-slate-700 font-medium truncate">{a.tag}</span>
                                                    <span className="text-xs text-slate-400 truncate">— {a.name}</span>
                                                </button>
                                            );
                                        })}
                                        {filteredAssets.length >= 30 && (
                                            <div className="p-2 text-[10px] text-slate-400 text-center border-t border-slate-100">Showing first 30 — type to narrow</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Dates */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs text-slate-500 font-medium mb-1.5 block">Study Date</label>
                                    <input type="date" value={studyDate} onChange={e => setStudyDate(e.target.value)}
                                           className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400" />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 font-medium mb-1.5 block">Next Review Date</label>
                                    <input type="date" value={nextReview} onChange={e => setNextReview(e.target.value)}
                                           className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400" />
                                </div>
                            </div>
                        </div>
                    ) : step === 2 ? (
                        /* ─── Step 2: Team & Scope ─────────────────── */
                        <div className="space-y-4">
                            {/* Facilitator */}
                            <div>
                                <label className="text-xs text-slate-500 font-medium mb-1.5 block">
                                    Study Facilitator / Leader *
                                    <span className="text-[10px] text-slate-400 ml-2 font-normal">Must be competent per {config.standard}</span>
                                </label>
                                <input value={facilitator} onChange={e => setFacilitator(e.target.value)}
                                       placeholder="e.g. Jane Smith — Senior Process Safety Engineer"
                                       className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400" />
                            </div>

                            {/* Scope */}
                            <div>
                                <label className="text-xs text-slate-500 font-medium mb-1.5 block">Scope Description *</label>
                                <textarea value={scopeDescription} onChange={e => setScopeDescription(e.target.value)}
                                          rows={3}
                                          placeholder={`Define the scope and boundaries of this ${config.label}. Include system boundaries, operating modes, and any exclusions.`}
                                          className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400" />
                            </div>

                            {/* Team Members */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                                        <Users size={12} />
                                        Study Team
                                        <span className="text-[10px] text-slate-400 font-normal">— multidisciplinary team required</span>
                                    </label>
                                    <button onClick={addTeamMember}
                                            className="flex items-center gap-1 text-[11px] font-medium text-teal-600 hover:text-teal-700 transition-colors">
                                        <Plus size={12} /> Add Member
                                    </button>
                                </div>

                                {teamMembers.length === 0 ? (
                                    <div className="p-4 border border-dashed border-slate-200 rounded-xl text-center">
                                        <p className="text-xs text-slate-400">No team members added yet. Click "Add Member" to build the team.</p>
                                        <p className="text-[10px] text-slate-400 mt-1">Recommended roles: {config.teamRoles.slice(0, 4).join(', ')}</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {teamMembers.map((member, idx) => (
                                            <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-100">
                                                <input value={member.name} onChange={e => updateTeamMember(idx, 'name', e.target.value)}
                                                       placeholder="Full Name"
                                                       className="flex-1 min-w-0 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400/30" />
                                                <select value={member.role} onChange={e => updateTeamMember(idx, 'role', e.target.value)}
                                                        className="bg-white border border-slate-200 rounded-md px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-400/30">
                                                    {config.teamRoles.map(r => <option key={r} value={r}>{r}</option>)}
                                                    <option value="Other">Other</option>
                                                </select>
                                                <input value={member.company || ''} onChange={e => updateTeamMember(idx, 'company', e.target.value)}
                                                       placeholder="Company"
                                                       className="w-28 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400/30" />
                                                <button onClick={() => removeTeamMember(idx)}
                                                        className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : step === 3 ? (
                        /* ─── Step 3: Type-Specific Metadata ───────── */
                        <div className="space-y-4">
                            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <FileText size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-slate-600">
                                    These fields are specific to <strong>{config.label}</strong> per <strong>{config.standard}</strong>.
                                    Complete as applicable to ensure compliance.
                                </p>
                            </div>

                            {config.metadataFields.map(field => (
                                <div key={field.key}>
                                    <label className="text-xs text-slate-500 font-medium mb-1.5 flex items-center gap-1.5">
                                        {field.label}
                                        {field.tooltip && (
                                            <span className="relative group">
                                                <Info size={10} className="text-slate-400 cursor-help" />
                                                <span className="absolute left-5 -top-1 w-64 bg-slate-800 text-white text-[10px] px-2.5 py-1.5 rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30 shadow-lg">
                                                    {field.tooltip}
                                                </span>
                                            </span>
                                        )}
                                    </label>
                                    {field.type === 'textarea' ? (
                                        <textarea value={metadata[field.key] || ''} onChange={e => setMetadata(m => ({ ...m, [field.key]: e.target.value }))}
                                                  rows={2} placeholder={field.placeholder}
                                                  className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400" />
                                    ) : field.type === 'select' ? (
                                        <select value={metadata[field.key] || ''} onChange={e => setMetadata(m => ({ ...m, [field.key]: e.target.value }))}
                                                className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400">
                                            <option value="">— Select —</option>
                                            {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    ) : (
                                        <input type={field.type === 'number' ? 'number' : 'text'}
                                               value={metadata[field.key] || ''} onChange={e => setMetadata(m => ({ ...m, [field.key]: field.type === 'number' ? parseFloat(e.target.value) || '' : e.target.value }))}
                                               placeholder={field.placeholder}
                                               className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30 focus:border-teal-400" />
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* ─── Step 4: Review ───────────────────────── */
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <CheckCircle size={14} className="text-emerald-500" />
                                Review & Create
                            </h3>

                            <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
                                {/* Study info */}
                                <div className="p-3">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Study</p>
                                    <p className="text-sm font-semibold text-slate-800">{title}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold bg-gradient-to-r ${config.color} text-white`}>{config.label}</span>
                                        <span className="text-[10px] text-slate-500 font-mono">{config.standard}</span>
                                        <span className="text-[10px] text-slate-400">| {methodology}</span>
                                    </div>
                                </div>

                                {/* Asset */}
                                <div className="p-3">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Target Asset</p>
                                    <p className="text-sm text-slate-700"><span className="font-mono font-bold">{assetTag}</span> — {assetName}</p>
                                </div>

                                {/* Facilitator & Team */}
                                <div className="p-3">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Team</p>
                                    <p className="text-sm text-slate-700">Facilitator: <strong>{facilitator}</strong></p>
                                    {teamMembers.filter(m => m.name.trim()).length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {teamMembers.filter(m => m.name.trim()).map((m, i) => (
                                                <span key={i} className="text-[10px] bg-white border border-slate-200 rounded-full px-2 py-0.5 text-slate-600">
                                                    {m.name} <span className="text-slate-400">({m.role})</span>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Scope */}
                                <div className="p-3">
                                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Scope</p>
                                    <p className="text-xs text-slate-600">{scopeDescription}</p>
                                </div>

                                {/* Dates */}
                                <div className="p-3 flex gap-6">
                                    <div>
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-0.5">Study Date</p>
                                        <p className="text-xs text-slate-700">{studyDate || '—'}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-0.5">Next Review</p>
                                        <p className="text-xs text-slate-700">{nextReview || '—'}</p>
                                    </div>
                                </div>

                                {/* Type-specific metadata */}
                                {Object.keys(metadata).filter(k => metadata[k]).length > 0 && (
                                    <div className="p-3">
                                        <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">{config.label.split(' ')[0]} Details</p>
                                        <div className="space-y-1">
                                            {config.metadataFields.filter(f => metadata[f.key]).map(f => (
                                                <div key={f.key} className="flex gap-2">
                                                    <span className="text-[10px] text-slate-400 shrink-0 w-32">{f.label}:</span>
                                                    <span className="text-[10px] text-slate-700">{metadata[f.key]}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Footer (navigation buttons) ─────────────────── */}
                {!created && (
                    <div className="p-4 border-t border-slate-100 flex items-center justify-between shrink-0">
                        <div>
                            {step > 1 && (
                                <button onClick={() => setStep(s => s - 1)}
                                        className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">
                                    <ChevronLeft size={14} /> Back
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400">Step {step} of {totalSteps}</span>
                            {step < totalSteps ? (
                                <button
                                    onClick={() => setStep(s => s + 1)}
                                    disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
                                    className="flex items-center gap-1 px-4 py-2 bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-medium rounded-lg text-xs hover:shadow-md hover:shadow-teal-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Next <ChevronRight size={14} />
                                </button>
                            ) : (
                                <button
                                    onClick={handleCreate}
                                    disabled={creating}
                                    className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-teal-500 to-cyan-500 text-white font-bold rounded-lg text-xs hover:shadow-lg hover:shadow-teal-500/20 transition-all disabled:opacity-60"
                                >
                                    {creating ? (
                                        <><span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" /> Creating…</>
                                    ) : (
                                        <><CheckCircle size={14} /> Create {config.label}</>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CreateStudyModal;
