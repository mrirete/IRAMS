import React, { useState, useEffect } from 'react';
import {
    CheckCircle, AlertTriangle, FileText, X, ChevronDown, ShieldCheck, Shield, Info, PenTool,
    User as UserIcon
} from 'lucide-react';
import { WorkOrder, DictionaryEntry, JSAHazard as JobHazard } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useConfirm, usePrompt } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/DatabaseService';
import { DataMapper } from '../services/DataMapper';
import { aiEngine, type JSAHazardSuggestion } from '../services/AIAnalysisEngine';
import { SignaturePad } from './ui/SignaturePad';

// A freshly initialized JSA has no DB row yet — its id is empty (or a legacy
// "jsa-<timestamp>" placeholder) until the first debounced save round-trips.
// Permit queries hit a UUID column and 400 on anything else.
export const isRealJsaId = (id?: string): id is string =>
    !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// All three must sign before work starts; 3/3 signed = JSA AUTHORIZED.
const JSA_SIGNOFF_ROLES = ['Worker', 'Supervisor', 'HSE Officer'] as const;

export const JSATab: React.FC<{ job: WorkOrder; onUpdate: (u: Partial<WorkOrder>) => void; dictionaries: DictionaryEntry[] }> = ({ job, onUpdate, dictionaries }) => {
    const { user } = useAuth();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const promptModal = usePrompt();
    const [permits, setPermits] = useState<any[]>([]);
    const [showCreatePermit, setShowCreatePermit] = useState(false);
    const [expandedPermit, setExpandedPermit] = useState<string | null>(null);
    const [newPermit, setNewPermit] = useState<any>({
        permitType: 'GENERAL',
        description: job.description || '',
        ppeRequirements: [],
        safetyRequirements: [],
        environmentalConditions: '',
    });
    const [loadingPermits, setLoadingPermits] = useState(false);

    // --- Enhancement state ---
    const [aiSuggesting, setAiSuggesting] = useState(false);
    const [aiSuggestions, setAiSuggestions] = useState<JSAHazardSuggestion[]>([]);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [showTemplateSave, setShowTemplateSave] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [savedTemplates, setSavedTemplates] = useState<{ id?: string; name: string; hazards: any[] }[]>([]);

    // Load the team-shared template library (0209). Templates written by this
    // browser before the library existed are imported once from localStorage,
    // then the key is cleared — existing shared names win over stale copies.
    useEffect(() => {
        (async () => {
            const db = DatabaseService.getInstance();
            try {
                const stored = localStorage.getItem('jsa_templates');
                if (stored) {
                    await db.importJSATemplates(JSON.parse(stored), user?.id);
                    localStorage.removeItem('jsa_templates');
                }
            } catch { /* import failed (offline?) — keep localStorage for a later retry */ }
            try {
                setSavedTemplates(await db.getJSATemplates());
            } catch { /* library unavailable — picker will show empty */ }
        })();
    }, []);

    // Dictionary lookups
    const permitTypes = dictionaries.filter(d => d.type === 'PERMIT_TYPE' && d.active);
    const ptwStatuses = dictionaries.filter(d => d.type === 'PTW_STATUS' && d.active);
    const isolationTypes = dictionaries.filter(d => d.type === 'ISOLATION_TYPE' && d.active);
    const ppeTypes = dictionaries.filter(d => d.type === 'PPE_TYPE' && d.active);

    const getStatusDesc = (code: string) => ptwStatuses.find(s => s.code === code)?.description || code;
    const getPermitTypeDesc = (code: string) => permitTypes.find(p => p.code === code)?.description || code;
    const getIsolationTypeDesc = (code: string) => isolationTypes.find(i => i.code === code)?.description || code;
    const getPPEDesc = (code: string) => ppeTypes.find(p => p.code === code)?.description || code;

    // Load permits when JSA exists
    useEffect(() => {
        if (isRealJsaId(job.jsa?.id)) {
            loadPermits();
        }
    }, [job.jsa?.id]);

    const loadPermits = async () => {
        const jsaId = job.jsa?.id;
        if (!isRealJsaId(jsaId)) return;
        setLoadingPermits(true);
        try {
            const db = DatabaseService.getInstance();
            const data = await db.getPermitsByJSA(jsaId);
            setPermits(data);
        } catch (e) {
            console.error('Failed to load permits:', e);
        } finally {
            setLoadingPermits(false);
        }
    };

    // Initialize JSA if missing. An assessment may already exist server-side
    // (deep-link detail fetch still in flight, or another session created it) —
    // hydrate from the DB instead of starting a blank JSA whose next save
    // would wipe the stored hazards.
    const handleInitJSA = async () => {
        try {
            const existing = await DatabaseService.getInstance().getJSA(job.id);
            if (existing) {
                onUpdate({
                    jsa: {
                        id: existing.id,
                        status: existing.status || 'DRAFT',
                        hazards: (existing.hazards || []).map((h: any) => DataMapper.toUIJSAHazard(h)),
                        permits: existing.permits || [],
                        signoffs: existing.signoffs || [],
                    }
                });
                return;
            }
        } catch { /* no assessment yet — start fresh */ }
        // No real id until the first save round-trips; the permit actions
        // guard on isRealJsaId until then.
        onUpdate({ jsa: { id: '', status: 'DRAFT', permits: [], hazards: [], signoffs: [] } });
    };

    if (!job.jsa) {
        return (
            <div className="p-8 text-center text-slate-400">
                <p className="mb-4">No Job Safety Analysis initialized for this job.</p>
                <button
                    onClick={handleInitJSA}
                    className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-500"
                >
                    Init JSA
                </button>
            </div>
        );
    }

    const isAuthorized = job.jsa.status === 'AUTHORIZED';
    // Central gate for anything that mutates hazards. The 0210 restrictive
    // policy blocks these writes server-side anyway — catching it here tells
    // the user why, before the optimistic UI diverges from the DB.
    const guardAuthorized = (): boolean => {
        if (isAuthorized) {
            showToast('JSA is authorized — hazards are locked. Remove a sign-off to make changes.', 'warning');
            return true;
        }
        return false;
    };

    const addHazard = () => {
        if (guardAuthorized()) return;
        const newHazard: JobHazard = {
            id: crypto.randomUUID(), // stable — doubles as the DB row id (upsert)
            hazard: '',
            consequence: 1,
            likelihood: 1,
            riskScore: 1,
            riskLevel: 'Low',
            controlHierarchy: [],
            controls: ''
        };
        onUpdate({
            jsa: {
                ...job.jsa!,
                hazards: [...(job.jsa!.hazards || []), newHazard]
            } as any
        });
    };

    // --- Risk Matrix Constants ---
    const CONSEQUENCE_LABELS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];
    const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
    const WO_CONTROL_HIERARCHY = ['Elimination', 'Substitution', 'Engineering', 'Admin', 'PPE'] as const;
    const WO_RISK_COLORS: Record<string, string> = {
        Critical: 'border-red-500 bg-red-50',
        High: 'border-orange-400 bg-orange-50',
        Medium: 'border-amber-400 bg-amber-50',
        Low: 'border-green-400 bg-green-50',
    };
    const getWORiskLevel = (score: number): 'Critical' | 'High' | 'Medium' | 'Low' => {
        if (score >= 20) return 'Critical';
        if (score >= 15) return 'High';
        if (score >= 8) return 'Medium';
        return 'Low';
    };
    const cellColor = (c: number, l: number) => {
        const s = c * l;
        if (s >= 20) return 'bg-red-600 text-white';
        if (s >= 15) return 'bg-orange-500 text-white';
        if (s >= 8) return 'bg-amber-400 text-amber-900';
        if (s >= 4) return 'bg-yellow-300 text-yellow-900';
        return 'bg-green-400 text-green-900';
    };

    const updateHazard = (id: string, field: keyof JobHazard, value: any) => {
        if (guardAuthorized()) return;
        const newHazards = (job.jsa!.hazards || []).map(h => {
            if (h.id !== id) return h;
            const updated = { ...h, [field]: value };
            // Auto-compute INITIAL risk score when consequence or likelihood changes
            if (field === 'consequence' || field === 'likelihood') {
                const c = field === 'consequence' ? Number(value) : (h.consequence || 1);
                const l = field === 'likelihood' ? Number(value) : (h.likelihood || 1);
                (updated as any).riskScore = c * l;
                (updated as any).riskLevel = getWORiskLevel(c * l);
                (updated as any).signoffRequired = c * l >= 15;
            }
            // Auto-compute RESIDUAL risk score when residual consequence or likelihood changes
            if (field === 'residualConsequence' || field === 'residualLikelihood') {
                const rc = field === 'residualConsequence' ? Number(value) : ((h as any).residualConsequence || 1);
                const rl = field === 'residualLikelihood' ? Number(value) : ((h as any).residualLikelihood || 1);
                (updated as any).residualRiskScore = rc * rl;
                (updated as any).residualRiskLevel = getWORiskLevel(rc * rl);
            }
            return updated;
        });
        onUpdate({ jsa: { ...job.jsa!, hazards: newHazards } });
    };

    // --- AI Hazard Suggestions ---
    const handleAISuggest = async () => {
        setAiSuggesting(true);
        try {
            // Pull real asset context — the WO object only carries assetId, so
            // the prompt used to say "Not specified" for every asset field.
            let assetCtx: { assetName?: string; assetType?: string; equipmentClass?: string } = {};
            if (job.assetId) {
                try {
                    const assets = await DatabaseService.getInstance().getAssets();
                    const a: any = assets.find((x: any) => x.id === job.assetId);
                    if (a) {
                        assetCtx = {
                            assetName: [[a.tag, a.name].filter(Boolean).join(' — '),
                                [a.manufacturer, a.model].filter(Boolean).join(' ')].filter(Boolean).join(', '),
                            assetType: a.assetType || a.category || '',
                            equipmentClass: [a.assetClass || a.assetCategory, a.criticality ? `criticality ${a.criticality}` : '']
                                .filter(Boolean).join(', '),
                        };
                    }
                } catch { /* suggestions still work, just less specific */ }
            }
            const result = await aiEngine.suggestJSAHazards({
                workDescription: job.description || job.title || '',
                workType: job.type,
                ...assetCtx,
            });
            setAiSuggestions(result.hazards || []);
            if ((result.hazards || []).length === 0) {
                showToast('AI could not generate suggestions. Try editing the work description.', 'info');
            }
        } catch (e: any) {
            showToast('AI suggestion failed: ' + (e.message || 'Unknown error'), 'error');
        } finally {
            setAiSuggesting(false);
        }
    };

    const acceptSuggestion = (s: JSAHazardSuggestion) => {
        if (guardAuthorized()) return;
        const newHazard: JobHazard = {
            id: crypto.randomUUID(),
            hazard: s.hazard,
            consequence: s.consequence,
            likelihood: s.likelihood,
            riskScore: s.consequence * s.likelihood,
            riskLevel: getWORiskLevel(s.consequence * s.likelihood),
            controlHierarchy: s.controlHierarchy,
            controls: s.controls,
        };
        onUpdate({ jsa: { ...job.jsa!, hazards: [...(job.jsa!.hazards || []), newHazard] } });
        setAiSuggestions(prev => prev.filter(x => x !== s));
        showToast('Hazard accepted and added', 'success');
    };

    // --- JSA Template Library ---
    const handleSaveTemplate = async () => {
        if (!templateName.trim()) return;
        const name = templateName.trim();
        // Strip per-instance fields: ids regenerate on load, sign-offs don't travel.
        const hazards = (job.jsa!.hazards || []).map(h => {
            const { id: _id, signoffBy: _sb, signoffDate: _sd, taskRefId: _tr, ...rest } = h as any;
            return rest;
        });
        try {
            const db = DatabaseService.getInstance();
            await db.saveJSATemplate(name, hazards, user?.id);
            setSavedTemplates(await db.getJSATemplates());
            setShowTemplateSave(false);
            setTemplateName('');
            showToast(`Template "${name}" saved to the team library`, 'success');
        } catch (e: any) {
            showToast('Failed to save template: ' + (e.message || 'unknown error'), 'error');
        }
    };

    const handleLoadTemplate = (tpl: { name: string; hazards: any[] }) => {
        if (guardAuthorized()) return;
        const newHazards = tpl.hazards.map(h => ({
            ...h,
            id: crypto.randomUUID(),
            riskScore: (h.consequence || 1) * (h.likelihood || 1),
            riskLevel: getWORiskLevel((h.consequence || 1) * (h.likelihood || 1)),
        }));
        onUpdate({ jsa: { ...job.jsa!, hazards: [...(job.jsa!.hazards || []), ...newHazards], templateName: tpl.name } });
        setShowTemplatePicker(false);
        showToast(`Loaded ${newHazards.length} hazards from "${tpl.name}"`, 'success');
    };

    const handleDeleteTemplate = async (tpl: { id?: string; name: string }) => {
        // Shared library — deleting removes it for the whole team, so confirm.
        const ok = await confirm({
            title: 'Delete Template',
            message: `"${tpl.name}" will be removed from the team template library for everyone.`,
            variant: 'danger',
            confirmLabel: 'Delete',
        });
        if (!ok || !tpl.id) return;
        try {
            const db = DatabaseService.getInstance();
            await db.deleteJSATemplate(tpl.id);
            setSavedTemplates(await db.getJSATemplates());
        } catch (e: any) {
            showToast('Failed to delete template: ' + (e.message || 'unknown error'), 'error');
        }
    };

    // --- Digital Signature ---
    const handleSignoff = async (role: string, signatureDataUrl: string) => {
        // Signatures go to storage; the JSONB keeps only the URL. If the upload
        // fails (offline plant floor), fall back to the inline data URL so the
        // sign-off is never lost.
        let signatureRef = signatureDataUrl;
        if (signatureDataUrl.startsWith('data:')) {
            try {
                const prev = (job.jsa!.signoffs || []).find(s => s.role === role)?.signatureDataUrl;
                signatureRef = await DatabaseService.getInstance().uploadJSASignature(
                    job.id, role, signatureDataUrl, prev && prev.startsWith('http') ? prev : undefined);
            } catch { /* keep the data URL */ }
        }
        const signoffs = [...(job.jsa!.signoffs || [])];
        const existingIdx = signoffs.findIndex(s => s.role === role);
        if (signatureRef) {
            const entry = { userId: user?.id || '', role, signedAt: new Date().toISOString(), status: 'Signed' as const, signatureDataUrl: signatureRef };
            if (existingIdx >= 0) signoffs[existingIdx] = entry;
            else signoffs.push(entry);
        } else {
            if (existingIdx >= 0) signoffs[existingIdx] = { ...signoffs[existingIdx], status: 'Pending' as any, signatureDataUrl: '' };
        }
        // Authorization is derived, not a separate button: all three roles
        // signed → AUTHORIZED (hazards lock server-side per 0210); removing
        // any signature withdraws it.
        const allSigned = JSA_SIGNOFF_ROLES.every(r => signoffs.find(s => s.role === r)?.status === 'Signed');
        onUpdate({ jsa: { ...job.jsa!, signoffs, status: allSigned ? 'AUTHORIZED' : 'DRAFT' } });
        if (allSigned) showToast('All sign-offs captured — JSA authorized. Hazards are now locked.', 'success');
    };

    const toggleControl = (id: string, control: string) => {
        const h = (job.jsa!.hazards || []).find(h => h.id === id);
        if (!h) return;
        const current = (h as any).controlHierarchy || [];
        const next = current.includes(control)
            ? current.filter((c: string) => c !== control)
            : [...current, control];
        updateHazard(id, 'controlHierarchy' as keyof JobHazard, next);
    };

    const deleteHazard = async (id: string) => {
        if (guardAuthorized()) return;
        const ok = await confirm({
            title: 'Remove Hazard',
            message: 'This hazard entry and its risk assessment will be removed from the JSA.',
            variant: 'danger',
            confirmLabel: 'Remove',
        });
        if (ok) {
            onUpdate({ jsa: { ...job.jsa!, hazards: (job.jsa!.hazards || []).filter(h => h.id !== id) } });
        }
    };

    const handleCreatePermit = async () => {
        if (!user?.id) return;
        if (!isRealJsaId(job.jsa?.id)) {
            showToast('The JSA is still saving — try again in a few seconds.', 'info');
            return;
        }
        try {
            const db = DatabaseService.getInstance();
            const created = await db.createPermit(newPermit, job.jsa!.id, user.id);
            if (created) {
                showToast(`Permit ${created.permitNumber} created`, 'success');
                setShowCreatePermit(false);
                setNewPermit({ permitType: 'GENERAL', description: job.description || '', ppeRequirements: [], safetyRequirements: [], environmentalConditions: '' });
                await loadPermits();
            }
        } catch (e: any) {
            showToast('Failed to create permit: ' + e.message, 'error');
        }
    };

    const handlePermitStatusChange = async (permitId: string, newStatus: string) => {
        if (!user?.id) return;
        try {
            const db = DatabaseService.getInstance();
            await db.updatePermitStatus(permitId, newStatus, user.id);
            showToast(`Permit status updated to ${getStatusDesc(newStatus)}`, 'success');
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleApprovalDecision = async (approvalId: string, decision: 'APPROVED' | 'REJECTED') => {
        if (!user?.id) return;
        let comments = '';
        if (decision === 'REJECTED') {
            const result = await promptModal({
                title: 'Reject Permit Request',
                message: 'Please provide a mandatory reason for rejecting this permit request:',
                placeholder: 'Reason for rejection...',
                inputType: 'textarea',
                confirmLabel: 'Reject Permit',
                icon: <AlertTriangle size={20} className="text-red-600" />
            });
            if (!result || !result.trim()) return;
            comments = result.trim();
        }
        try {
            const db = DatabaseService.getInstance();
            await db.recordApprovalDecision(approvalId, decision, comments || '', user.id);
            showToast(`Approval ${decision.toLowerCase()}`, 'success');
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleIsolationAction = async (pointId: string, action: 'ISOLATED' | 'VERIFIED' | 'DE_ISOLATED') => {
        if (!user?.id) return;
        try {
            const db = DatabaseService.getInstance();
            await db.updateIsolationPointStatus(pointId, action, user.id);
            showToast(`Isolation point ${action.toLowerCase().replace('_', '-')}`, 'success');
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleReturnPermit = async (permitId: string) => {
        if (!user?.id) return;
        const notes = await promptModal({
            title: 'Return Work Permit',
            message: 'Enter return notes and confirm de-isolation completion:',
            placeholder: 'e.g. Work complete, area cleaned, de-isolation verified.',
            inputType: 'textarea',
            confirmLabel: 'Return Permit',
            icon: <ShieldCheck size={20} className="text-emerald-600" />
        });
        if (!notes || !notes.trim()) return;
        try {
            const db = DatabaseService.getInstance();
            await db.returnPermit(permitId, notes.trim(), user.id);
            showToast('Permit returned', 'success');
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleUpdatePermit = async (permitId: string, updates: any) => {
        try {
            const db = DatabaseService.getInstance();
            await db.updatePermit(permitId, updates);
            await loadPermits();
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const togglePPE = (code: string) => {
        setNewPermit((prev: any) => ({
            ...prev,
            ppeRequirements: prev.ppeRequirements.includes(code)
                ? prev.ppeRequirements.filter((c: string) => c !== code)
                : [...prev.ppeRequirements, code]
        }));
    };

    const getStatusColor = (status: string) => {
        const colors: Record<string, string> = {
            'DRAFT': 'bg-slate-100 text-slate-700',
            'PENDING': 'bg-amber-100 text-amber-800',
            'APPROVED': 'bg-blue-100 text-blue-700',
            'ISSUED': 'bg-blue-100 text-blue-700',
            'ACTIVE': 'bg-green-100 text-green-700',
            'SUSPENDED': 'bg-red-100 text-red-700',
            'RETURNED': 'bg-blue-100 text-blue-700',
            'CLOSED': 'bg-slate-200 text-slate-600',
            'REJECTED': 'bg-red-200 text-red-800'
        };
        return colors[status] || 'bg-slate-100 text-slate-700';
    };

    const getPermitTypeColor = (type: string) => {
        const colors: Record<string, string> = {
            'HOT_WORK': 'border-red-400 bg-red-50',
            'CONFINED_SPACE': 'border-amber-400 bg-amber-50',
            'ELECTRICAL': 'border-yellow-400 bg-yellow-50',
            'HEIGHT': 'border-blue-400 bg-blue-50',
            'CHEMICAL': 'border-blue-400 bg-blue-50',
            'RADIATION': 'border-pink-400 bg-pink-50',
            'EXCAVATION': 'border-orange-400 bg-orange-50',
        };
        return colors[type] || 'border-slate-300 bg-white';
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* ? Hazard Matrix � 5�5 Risk Matrix (ISO 31000 / ISO 45001) */}
            <details open className="group">
                <summary className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center cursor-pointer list-none">
                    <div className="flex items-center gap-3">
                        <Shield size={20} className="text-blue-600" />
                        <div>
                            <h3 className="font-bold text-slate-800">Job Safety Analysis (JSA)</h3>
                            <p className="text-xs text-slate-500">5�5 Risk Matrix � Hierarchy of Controls � ISO 31000 / ISO 45001</p>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{(job.jsa.hazards || []).length}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${isAuthorized ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {isAuthorized ? '🔒 AUTHORIZED' : job.jsa.status || 'DRAFT'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={(e) => { e.preventDefault(); handleAISuggest(); }}
                            disabled={aiSuggesting}
                            className="bg-gradient-to-r from-blue-500 to-blue-500 hover:from-blue-600 hover:to-blue-600 text-white px-3 py-1.5 rounded text-sm font-bold shadow-sm flex items-center gap-1.5 disabled:opacity-50 transition"
                        >
                            {aiSuggesting ? (
                                <><span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analyzing...</>
                            ) : (
                                <>✨ AI Suggest</>
                            )}
                        </button>
                        <button onClick={(e) => { e.preventDefault(); setShowTemplatePicker(true); }} className="bg-white border border-slate-300 hover:border-blue-400 text-slate-700 px-3 py-1.5 rounded text-sm font-bold shadow-sm flex items-center gap-1 hover:bg-blue-50 transition">
                            📋 Load Template
                        </button>
                        {(job.jsa.hazards || []).length > 0 && (
                            <button onClick={(e) => { e.preventDefault(); setShowTemplateSave(true); }} className="text-slate-500 hover:text-blue-600 px-2 py-1.5 rounded text-sm flex items-center gap-1 hover:bg-blue-50 transition" title="Save current hazards as template">
                                💾 Save
                            </button>
                        )}
                        <button onClick={(e) => { e.preventDefault(); addHazard(); }} className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded text-sm font-bold shadow-sm flex items-center gap-1">
                            + Hazard
                        </button>
                    </div>
                </summary>

                <div className="mt-2 space-y-4">
                    {/* Template Save Modal */}
                    {showTemplateSave && (
                        <div className="bg-white border-2 border-blue-200 rounded-lg p-4 flex items-end gap-3 animate-in fade-in">
                            <div className="flex-1">
                                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Save as JSA Template</label>
                                <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Hot Work - Compressor, Confined Space Entry" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500" autoFocus />
                            </div>
                            <button onClick={handleSaveTemplate} disabled={!templateName.trim()} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-primary-500 disabled:opacity-50 shadow-sm">Save</button>
                            <button onClick={() => { setShowTemplateSave(false); setTemplateName(''); }} className="px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                        </div>
                    )}

                    {/* Template Picker Modal */}
                    {showTemplatePicker && (
                        <div className="bg-white border-2 border-blue-200 rounded-lg p-4 space-y-3 animate-in fade-in">
                            <div className="flex justify-between items-center mb-1">
                                <h4 className="font-bold text-sm text-slate-800">📋 JSA Template Library</h4>
                                <button onClick={() => setShowTemplatePicker(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                            </div>
                            {savedTemplates.length === 0 ? (
                                <p className="text-sm text-slate-400 text-center py-4">No saved templates yet. Build a JSA and click "💾 Save" to create one.</p>
                            ) : (
                                <div className="space-y-2">
                                    {savedTemplates.map(tpl => (
                                        <div key={tpl.name} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-3 hover:bg-blue-50 transition group">
                                            <div>
                                                <p className="text-sm font-bold text-slate-800">{tpl.name}</p>
                                                <p className="text-[10px] text-slate-400">{tpl.hazards.length} hazard{tpl.hazards.length !== 1 ? 's' : ''}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => handleLoadTemplate(tpl)} className="px-3 py-1 text-xs font-bold bg-blue-600 text-white rounded hover:bg-primary-500 shadow-sm">Load</button>
                                                <button onClick={() => handleDeleteTemplate(tpl)} className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50">Delete</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* AI Suggestion Panel */}
                    {aiSuggestions.length > 0 && (
                        <div className="bg-gradient-to-br from-blue-50 to-blue-50 border-2 border-blue-200 rounded-lg p-4 space-y-3 animate-in fade-in">
                            <div className="flex justify-between items-center">
                                <h4 className="font-bold text-sm text-blue-800 flex items-center gap-2">✨ AI-Suggested Hazards <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-600">{aiSuggestions.length}</span></h4>
                                <button onClick={() => setAiSuggestions([])} className="text-xs text-slate-400 hover:text-slate-600">Dismiss All</button>
                            </div>
                            <p className="text-[10px] text-blue-600">⚠️ HITL: These are AI suggestions only. Review each hazard carefully before accepting.</p>
                            <div className="space-y-2">
                                {aiSuggestions.map((s, i) => {
                                    const sScore = s.consequence * s.likelihood;
                                    const sLevel = getWORiskLevel(sScore);
                                    return (
                                        <div key={i} className="bg-white rounded-lg p-3 border border-blue-200 flex gap-3">
                                            <div className="flex-1">
                                                <p className="text-sm font-bold text-slate-800">{s.hazard}</p>
                                                <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                                                    <span>C:{s.consequence} × L:{s.likelihood} = <strong className={sLevel === 'Critical' || sLevel === 'High' ? 'text-red-600' : sLevel === 'Medium' ? 'text-amber-600' : 'text-green-600'}>{sScore} {sLevel}</strong></span>
                                                    <span>Controls: {s.controlHierarchy.join(', ')}</span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-0.5 italic">{s.rationale}</p>
                                                {s.controls && <p className="text-[10px] text-slate-500 mt-1">💡 {s.controls}</p>}
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <button onClick={() => acceptSuggestion(s)} className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 shadow-sm">Accept</button>
                                                <button onClick={() => setAiSuggestions(prev => prev.filter(x => x !== s))} className="px-3 py-1 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 rounded">Dismiss</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 5×5 Risk Matrix Reference */}
                    <div className="bg-white border border-slate-200 rounded-lg p-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Risk Matrix Reference (Consequence × Likelihood)</h4>
                        <div className="overflow-x-auto">
                            <table className="text-[10px] w-full max-w-lg">
                                <thead>
                                    <tr>
                                        <th className="p-1 text-left text-slate-400">C↓ / L→</th>
                                        {LIKELIHOOD_LABELS.map((l, i) => (
                                            <th key={i} className="p-1 text-center font-bold text-slate-600">{i + 1}<br /><span className="font-normal text-slate-400">{l}</span></th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {CONSEQUENCE_LABELS.map((cl, ci) => (
                                        <tr key={ci}>
                                            <td className="p-1 font-bold text-slate-600">{ci + 1} <span className="font-normal text-slate-400">{cl}</span></td>
                                            {LIKELIHOOD_LABELS.map((_, li) => {
                                                const score = (ci + 1) * (li + 1);
                                                return (
                                                    <td key={li} className={`p-1 text-center font-bold rounded ${cellColor(ci + 1, li + 1)}`}>
                                                        {score}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Hazard Cards */}
                    <div className="space-y-4">
                        {(job.jsa.hazards || []).map((h, idx) => {
                            const score = typeof h.riskScore === 'number' ? h.riskScore : ((h as any).consequence || 1) * ((h as any).likelihood || 1);
                            const level = (h as any).riskLevel || getWORiskLevel(typeof score === 'number' ? score : 1);
                            return (
                                <div key={h.id} className={`bg-white border-2 rounded-lg p-5 hover:shadow-md transition ${WO_RISK_COLORS[level] || 'border-slate-200'}`}>
                                    <div className="flex items-start gap-4">
                                        <span className="font-mono text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded mt-1">{idx + 1}</span>
                                        <div className="flex-1 space-y-4">
                                            {/* Hazard Description */}
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Hazard Description</label>
                                                <input
                                                    type="text"
                                                    value={h.hazard}
                                                    onChange={(e) => updateHazard(h.id, 'hazard', e.target.value)}
                                                    placeholder="e.g. Working at height, confined space entry, H2S exposure..."
                                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                                                />
                                            </div>

                                            {/* Risk Matrix Selectors */}
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                <div>
                                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Consequence (1-5)</label>
                                                    <select
                                                        value={(h as any).consequence || 3}
                                                        onChange={(e) => updateHazard(h.id, 'consequence' as keyof JobHazard, Number(e.target.value))}
                                                        className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                                    >
                                                        {CONSEQUENCE_LABELS.map((label, i) => (
                                                            <option key={i} value={i + 1}>{i + 1} � {label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Likelihood (1-5)</label>
                                                    <select
                                                        value={(h as any).likelihood || 3}
                                                        onChange={(e) => updateHazard(h.id, 'likelihood' as keyof JobHazard, Number(e.target.value))}
                                                        className="w-full p-2 border border-slate-300 rounded-lg text-sm"
                                                    >
                                                        {LIKELIHOOD_LABELS.map((label, i) => (
                                                            <option key={i} value={i + 1}>{i + 1} � {label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Risk Score</label>
                                                    <div className={`flex items-center gap-2 p-2 rounded-lg border-2 font-bold text-lg ${WO_RISK_COLORS[level] || 'border-slate-300'}`}>
                                                        <span>{score}</span>
                                                        <span className="text-xs font-bold uppercase">{level}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Hierarchy of Controls (ISO 45001) */}
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-2 block">Hierarchy of Controls (ISO 45001)</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {WO_CONTROL_HIERARCHY.map((ctrl, i) => {
                                                        const active = ((h as any).controlHierarchy || []).includes(ctrl);
                                                        const colors = [
                                                            'bg-green-100 text-green-800 border-green-300',
                                                            'bg-primary-100 text-primary-800 border-primary-300',
                                                            'bg-blue-100 text-blue-800 border-blue-300',
                                                            'bg-blue-100 text-blue-800 border-blue-300',
                                                            'bg-orange-100 text-orange-800 border-orange-300',
                                                        ];
                                                        return (
                                                            <button
                                                                key={ctrl}
                                                                onClick={() => toggleControl(h.id, ctrl)}
                                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${active ? colors[i] + ' shadow-sm ring-2 ring-offset-1 ring-current/20' : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-300'
                                                                    }`}
                                                            >
                                                                {i + 1}. {ctrl}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-1">Most effective (1. Elimination) ? Least effective (5. PPE)</p>
                                            </div>

                                            {/* Controls Description */}
                                            <div>
                                                <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Controls / Precautions</label>
                                                <textarea
                                                    value={h.controls}
                                                    onChange={(e) => updateHazard(h.id, 'controls', e.target.value)}
                                                    placeholder="Describe the specific control measures, procedures, PPE requirements..."
                                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm h-20 resize-none focus:ring-2 focus:ring-primary-500"
                                                />
                                            </div>

                                            {/* ── RESIDUAL RISK (Post-Controls) ── */}
                                            <div className="bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg p-4">
                                                <label className="text-[10px] uppercase font-bold text-blue-600 mb-3 block flex items-center gap-1.5">↕ Residual Risk (Post-Controls)</label>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Residual Consequence</label>
                                                        <select
                                                            value={(h as any).residualConsequence || 1}
                                                            onChange={(e) => updateHazard(h.id, 'residualConsequence' as keyof JobHazard, Number(e.target.value))}
                                                            className="w-full p-2 border border-blue-200 rounded-lg text-sm bg-white"
                                                        >
                                                            {CONSEQUENCE_LABELS.map((label, i) => (
                                                                <option key={i} value={i + 1}>{i + 1} — {label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Residual Likelihood</label>
                                                        <select
                                                            value={(h as any).residualLikelihood || 1}
                                                            onChange={(e) => updateHazard(h.id, 'residualLikelihood' as keyof JobHazard, Number(e.target.value))}
                                                            className="w-full p-2 border border-blue-200 rounded-lg text-sm bg-white"
                                                        >
                                                            {LIKELIHOOD_LABELS.map((label, i) => (
                                                                <option key={i} value={i + 1}>{i + 1} — {label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Risk Reduction</label>
                                                        {(() => {
                                                            const residualScore = ((h as any).residualConsequence || 1) * ((h as any).residualLikelihood || 1);
                                                            const residualLevel = getWORiskLevel(residualScore);
                                                            const reduction = score > 0 ? Math.round(((score - residualScore) / score) * 100) : 0;
                                                            return (
                                                                <div className="flex items-center gap-2">
                                                                    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border-2 font-bold text-sm ${WO_RISK_COLORS[level]}`}>
                                                                        {score}
                                                                    </div>
                                                                    <span className="text-lg text-slate-400">→</span>
                                                                    <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border-2 font-bold text-sm ${WO_RISK_COLORS[residualLevel]}`}>
                                                                        {residualScore}
                                                                    </div>
                                                                    {reduction > 0 && (
                                                                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${reduction >= 50 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                                                            ↓{reduction}%
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Sign-off (mandatory for high risk) */}
                                            {(typeof score === 'number' ? score : 0) >= 15 && (
                                                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-3">
                                                    <AlertTriangle size={16} className="text-red-600 flex-shrink-0" />
                                                    <div className="flex-1">
                                                        <p className="text-xs font-bold text-red-800">High-Risk: Mandatory Sign-Off Required</p>
                                                        <p className="text-[10px] text-red-600">This hazard requires engineering review and sign-off before work commences.</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            value={(h as any).signoffBy || ''}
                                                            onChange={(e) => updateHazard(h.id, 'signoffBy' as keyof JobHazard, e.target.value)}
                                                            placeholder="Approved by..."
                                                            className="text-xs border border-red-300 rounded px-2 py-1 w-32"
                                                        />
                                                        {(h as any).signoffBy ? (
                                                            <CheckCircle size={16} className="text-green-600" />
                                                        ) : (
                                                            <AlertTriangle size={16} className="text-red-400" />
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => deleteHazard(h.id)}
                                            className="text-slate-300 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition mt-1"
                                            title="Remove hazard"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {(job.jsa.hazards || []).length === 0 && (
                            <div className="p-8 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50">
                                <AlertTriangle size={32} className="mx-auto mb-3 text-slate-300" />
                                <p className="text-slate-400 text-sm">No hazards identified yet. Click "+ Hazard" to start building the risk assessment.</p>
                            </div>
                        )}
                    </div>
                </div>
            </details>

            {/* ? Permit to Work */}
            <details open className="group">
                <summary className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center cursor-pointer list-none">
                    <div className="flex items-center gap-3">
                        <FileText size={20} className="text-blue-600" />
                        <h3 className="font-bold text-slate-800">Permits to Work</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{permits.length}</span>
                    </div>
                    <button onClick={(e) => { e.preventDefault(); if (!showCreatePermit) { setNewPermit((prev: any) => ({ ...prev, description: job.description || prev.description })); } setShowCreatePermit(!showCreatePermit); }} className="bg-primary-600 hover:bg-primary-500 text-white px-3 py-1.5 rounded text-sm font-bold shadow-sm">
                        + New Permit
                    </button>
                </summary>

                <div className="mt-2 space-y-3">
                    {/* Create Permit Form */}
                    {showCreatePermit && (
                        <div className="bg-white border-2 border-blue-200 rounded-lg p-5 space-y-4">
                            <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                <FileText size={16} className="text-blue-600" /> New Permit Request
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Permit Type</label>
                                    <select
                                        value={newPermit.permitType}
                                        onChange={e => setNewPermit({ ...newPermit, permitType: e.target.value })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-blue-500"
                                    >
                                        {permitTypes.map(pt => (
                                            <option key={pt.code} value={pt.code}>{pt.description}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Environmental Conditions</label>
                                    <input
                                        type="text"
                                        value={newPermit.environmentalConditions}
                                        onChange={e => setNewPermit({ ...newPermit, environmentalConditions: e.target.value })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                        placeholder="Weather, atmosphere, wind speed..."
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Scope of Work</label>
                                <textarea
                                    value={newPermit.description}
                                    onChange={e => setNewPermit({ ...newPermit, description: e.target.value })}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    rows={2}
                                    placeholder="Describe the work to be performed..."
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">PPE Requirements</label>
                                <div className="flex flex-wrap gap-2">
                                    {ppeTypes.map(ppe => (
                                        <button
                                            key={ppe.code}
                                            onClick={() => togglePPE(ppe.code)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${newPermit.ppeRequirements.includes(ppe.code)
                                                ? 'bg-blue-600 text-white border-blue-600'
                                                : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                                                }`}
                                        >
                                            {ppe.description}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                                <button onClick={() => setShowCreatePermit(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                                <button
                                    onClick={handleCreatePermit}
                                    disabled={!newPermit.description}
                                    className="px-4 py-2 text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 rounded-lg disabled:opacity-50 shadow-sm"
                                >
                                    Create Permit
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Permit Cards */}
                    {loadingPermits && <div className="text-center py-4 text-slate-400 text-sm">Loading permits...</div>}
                    {!loadingPermits && permits.length === 0 && !showCreatePermit && (
                        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-400 text-sm">
                            No permits created for this JSA. Click "+ New Permit" to start.
                        </div>
                    )}

                    {permits.map(permit => (
                        <div key={permit.id} className={`bg-white border-l-4 rounded-lg shadow-sm overflow-hidden ${getPermitTypeColor(permit.permitType)}`}>
                            {/* Permit Header */}
                            <div
                                className="p-4 flex justify-between items-center cursor-pointer hover:bg-slate-50/50 transition-colors"
                                onClick={() => setExpandedPermit(expandedPermit === permit.id ? null : permit.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800 text-sm">{permit.permitNumber}</span>
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getStatusColor(permit.status)}`}>
                                                {getStatusDesc(permit.status)}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-0.5">{getPermitTypeDesc(permit.permitType)} � {permit.description?.substring(0, 80) || 'No description'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Status transition buttons */}
                                    {permit.status === 'DRAFT' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'PENDING'); }}
                                            className="px-3 py-1 text-xs font-bold bg-amber-500 text-white rounded hover:bg-amber-600 shadow-sm"
                                        >
                                            Submit for Approval
                                        </button>
                                    )}
                                    {permit.status === 'APPROVED' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'ISSUED'); }}
                                            className="px-3 py-1 text-xs font-bold bg-blue-600 text-white rounded hover:bg-primary-500 shadow-sm"
                                        >
                                            Issue Permit
                                        </button>
                                    )}
                                    {permit.status === 'ISSUED' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'ACTIVE'); }}
                                            className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 shadow-sm"
                                        >
                                            Start Work
                                        </button>
                                    )}
                                    {permit.status === 'ACTIVE' && (
                                        <>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleReturnPermit(permit.id); }}
                                                className="px-3 py-1 text-xs font-bold bg-blue-600 text-white rounded hover:bg-primary-500 shadow-sm"
                                            >
                                                Return Permit
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'SUSPENDED'); }}
                                                className="px-3 py-1 text-xs font-bold bg-red-500 text-white rounded hover:bg-red-600 shadow-sm"
                                            >
                                                Suspend
                                            </button>
                                        </>
                                    )}
                                    {permit.status === 'RETURNED' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePermitStatusChange(permit.id, 'CLOSED'); }}
                                            className="px-3 py-1 text-xs font-bold bg-slate-600 text-white rounded hover:bg-slate-700 shadow-sm"
                                        >
                                            Close Permit
                                        </button>
                                    )}
                                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${expandedPermit === permit.id ? 'rotate-180' : ''}`} />
                                </div>
                            </div>

                            {/* Expanded Permit Detail */}
                            {expandedPermit === permit.id && (
                                <div className="border-t border-slate-200 divide-y divide-slate-100">
                                    {/* Permit Info */}
                                    <div className="p-4 bg-slate-50/30">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                            <div><span className="font-bold text-slate-500 uppercase block">Type</span>{getPermitTypeDesc(permit.permitType)}</div>
                                            <div><span className="font-bold text-slate-500 uppercase block">Validity Start</span>{permit.validityStart ? new Date(permit.validityStart).toLocaleString() : '�'}</div>
                                            <div><span className="font-bold text-slate-500 uppercase block">Validity End</span>{permit.validityEnd ? new Date(permit.validityEnd).toLocaleString() : '�'}</div>
                                            <div><span className="font-bold text-slate-500 uppercase block">Environment</span>{permit.environmentalConditions || '�'}</div>
                                        </div>
                                        {permit.ppeRequirements.length > 0 && (
                                            <div className="mt-3">
                                                <span className="font-bold text-slate-500 uppercase text-xs block mb-1">PPE Required</span>
                                                <div className="flex flex-wrap gap-1">
                                                    {permit.ppeRequirements.map((ppe: string) => (
                                                        <span key={ppe} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold">{getPPEDesc(ppe)}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* ? Isolation Plan (LOTO) */}
                                    <div className="p-4">
                                        <div className="flex justify-between items-center mb-3">
                                            <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2">
                                                <AlertTriangle size={14} className="text-amber-500" /> Isolation Plan (LOTO)
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100">{permit.isolationPoints?.length || 0}</span>
                                            </h4>
                                        </div>
                                        {(permit.isolationPoints || []).length > 0 ? (
                                            <table className="min-w-full text-xs">
                                                <thead className="bg-slate-50">
                                                    <tr>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Seq</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Tag</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Type</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Method</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-500 uppercase">Status</th>
                                                        <th className="px-3 py-2"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {permit.isolationPoints.map((pt: any) => (
                                                        <tr key={pt.id} className="hover:bg-slate-50">
                                                            <td className="px-3 py-2 text-slate-600">{pt.sequence}</td>
                                                            <td className="px-3 py-2 font-bold text-slate-800">{pt.tagNumber}</td>
                                                            <td className="px-3 py-2">{getIsolationTypeDesc(pt.isolationType)}</td>
                                                            <td className="px-3 py-2">{pt.method}</td>
                                                            <td className="px-3 py-2">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pt.status === 'VERIFIED' ? 'bg-green-100 text-green-700' :
                                                                    pt.status === 'ISOLATED' ? 'bg-amber-100 text-amber-700' :
                                                                        pt.status === 'DE_ISOLATED' ? 'bg-blue-100 text-blue-700' :
                                                                            'bg-slate-100 text-slate-600'
                                                                    }`}>{pt.status.replace('_', ' ')}</span>
                                                            </td>
                                                            <td className="px-3 py-2 text-right">
                                                                {pt.status === 'PENDING' && (
                                                                    <button onClick={() => handleIsolationAction(pt.id, 'ISOLATED')} className="text-amber-600 hover:text-amber-700 font-bold">Isolate</button>
                                                                )}
                                                                {pt.status === 'ISOLATED' && (
                                                                    <button onClick={() => handleIsolationAction(pt.id, 'VERIFIED')} className="text-green-600 hover:text-green-700 font-bold">Verify</button>
                                                                )}
                                                                {pt.status === 'VERIFIED' && permit.status === 'RETURNED' && (
                                                                    <button onClick={() => handleIsolationAction(pt.id, 'DE_ISOLATED')} className="text-blue-600 hover:text-blue-700 font-bold">De-Isolate</button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <p className="text-slate-400 text-sm text-center py-4">No isolation points defined.</p>
                                        )}
                                    </div>

                                    {/* ? Approval Workflow */}
                                    <div className="p-4">
                                        <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2 mb-3">
                                            <CheckCircle size={14} className="text-green-500" /> Approval Workflow
                                        </h4>
                                        <div className="space-y-2">
                                            {(permit.approvals || []).sort((a: any, b: any) => a.sequence - b.sequence).map((app: any) => (
                                                <div key={app.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${app.decision === 'APPROVED' ? 'bg-green-100 text-green-700' :
                                                            app.decision === 'REJECTED' ? 'bg-red-100 text-red-700' :
                                                                'bg-slate-200 text-slate-500'
                                                            }`}>
                                                            {app.sequence}
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-bold text-slate-800">{app.role.replace(/_/g, ' ')}</p>
                                                            <p className="text-[10px] text-slate-500">
                                                                {app.decision === 'PENDING' ? 'Awaiting decision' :
                                                                    `${app.decision} ${app.decidedAt ? ' � ' + new Date(app.decidedAt).toLocaleString() : ''}`}
                                                            </p>
                                                            {app.comments && <p className="text-[10px] text-slate-400 italic mt-0.5">{app.comments}</p>}
                                                        </div>
                                                    </div>
                                                    {app.decision === 'PENDING' && permit.status === 'PENDING' && (
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => handleApprovalDecision(app.id, 'APPROVED')}
                                                                className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700"
                                                            >
                                                                Approve
                                                            </button>
                                                            <button
                                                                onClick={() => handleApprovalDecision(app.id, 'REJECTED')}
                                                                className="px-3 py-1 text-xs font-bold bg-red-500 text-white rounded hover:bg-red-600"
                                                            >
                                                                Reject
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        {/* Auto-approve check */}
                                        {permit.status === 'PENDING' && (permit.approvals || []).every((a: any) => a.decision === 'APPROVED') && (
                                            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex justify-between items-center">
                                                <p className="text-xs text-green-800 font-bold">? All approvals received</p>
                                                <button
                                                    onClick={() => handlePermitStatusChange(permit.id, 'APPROVED')}
                                                    className="px-3 py-1 text-xs font-bold bg-green-600 text-white rounded hover:bg-green-700 shadow-sm"
                                                >
                                                    Mark as Approved
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* ? Toolbox Talk / Issuance */}
                                    {(permit.status === 'APPROVED' || permit.status === 'ISSUED' || permit.status === 'ACTIVE') && (
                                        <div className="p-4">
                                            <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2 mb-3">
                                                <UserIcon size={14} className="text-blue-500" /> Toolbox Talk & Issuance
                                            </h4>
                                            <div className="space-y-3">
                                                <div className="flex items-center gap-3">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={permit.toolboxTalkCompleted}
                                                            onChange={(e) => handleUpdatePermit(permit.id, { toolboxTalkCompleted: e.target.checked })}
                                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-primary-500"
                                                            disabled={permit.status !== 'APPROVED'}
                                                        />
                                                        <span className="text-sm font-bold text-slate-700">Toolbox Talk Completed</span>
                                                    </label>
                                                </div>
                                                <textarea
                                                    value={permit.toolboxTalkNotes || ''}
                                                    onChange={(e) => handleUpdatePermit(permit.id, { toolboxTalkNotes: e.target.value })}
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                                    rows={2}
                                                    placeholder="Toolbox talk topics, attendees, safety briefing notes..."
                                                    disabled={permit.status !== 'APPROVED'}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* ? Return / Closure */}
                                    {(permit.status === 'RETURNED' || permit.status === 'CLOSED') && (
                                        <div className="p-4 bg-blue-50/30">
                                            <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2 mb-3">
                                                <CheckCircle size={14} className="text-blue-500" /> Permit Return
                                            </h4>
                                            <div className="grid grid-cols-2 gap-4 text-xs">
                                                <div><span className="font-bold text-slate-500 uppercase block">Returned At</span>{permit.returnedAt ? new Date(permit.returnedAt).toLocaleString() : '�'}</div>
                                                <div><span className="font-bold text-slate-500 uppercase block">Return Notes</span>{permit.returnNotes || '�'}</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </details>

            {/* ── DIGITAL SIGN-OFF ── */}
            <details open className="group">
                <summary className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex justify-between items-center cursor-pointer list-none">
                    <div className="flex items-center gap-3">
                        <PenTool size={20} className="text-blue-600" />
                        <h3 className="font-bold text-slate-800">Digital Sign-offs</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            {(job.jsa.signoffs || []).filter(s => s.status === 'Signed').length}/{JSA_SIGNOFF_ROLES.length}
                        </span>
                    </div>
                </summary>
                <div className="mt-2 bg-white border border-slate-200 rounded-lg p-5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-4">All personnel must sign below before commencing work</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {JSA_SIGNOFF_ROLES.map(role => {
                            const signoff = (job.jsa!.signoffs || []).find(s => s.role === role);
                            const isSigned = signoff?.status === 'Signed' && signoff?.signatureDataUrl;
                            return (
                                <div key={role} className={`rounded-lg border-2 p-4 transition ${isSigned ? 'border-green-300 bg-green-50/30' : 'border-slate-200'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-bold text-slate-700">{role}</span>
                                        {isSigned && (
                                            <span className="flex items-center gap-1 text-[10px] text-green-600 font-bold">
                                                <CheckCircle size={12} /> Signed
                                            </span>
                                        )}
                                    </div>
                                    <SignaturePad
                                        label={isSigned ? undefined : `Sign as ${role}`}
                                        existingSignature={isSigned ? signoff?.signatureDataUrl : undefined}
                                        onCapture={(dataUrl) => handleSignoff(role, dataUrl)}
                                    />
                                    {isSigned && signoff?.signedAt && (
                                        <p className="text-[10px] text-slate-400 mt-1">{new Date(signoff.signedAt).toLocaleString()}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </details>

            <div className="bg-blue-50 p-3 rounded border border-blue-200 text-xs text-blue-800 flex gap-2">
                <Info size={16} />
                <p>Personnel must review and sign the JSA prior to commencing work. All permits require four-eyes approval.</p>
            </div>
        </div>
    );
};
