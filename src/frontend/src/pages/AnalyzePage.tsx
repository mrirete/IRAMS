import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
    Target, GitMerge, Cpu,
    Plus, Download, Zap, X, ArrowRight, Gauge,
} from 'lucide-react';
import { useIntelligence } from '../hooks/useIntelligence';
import { supabase } from '../eam/lib/supabase';
import type { Asset, CriticalityRank } from '../types/assets';

// ── Division wrappers ────────────────────────────────────────
import DefectEliminationDivision from '../components/analyze/DefectEliminationDivision';

// ── Standalone RCA (no wrapper needed) ───────────────────────
import RCATab from '../components/analyze/RCATab';
import type { IncomingWOPayload } from '../components/analyze/RCATab';

// ── OEE Tab ──────────────────────────────────────────────────
import { OEETab } from '../components/analyze/OEETab';

// ── Shared modals ────────────────────────────────────────────
import NewAssessmentModal from '../components/analyze/NewAssessmentModal';
import ReliabilitySpecialist from '../components/analyze/ReliabilitySpecialist';

// ── Services ─────────────────────────────────────────────────
import analyzeService from '../eam/services/AnalyzeService';
import type { ParetoResult, StudyCollaborator } from '../eam/services/AnalyzeService';
import { type DefectEliminationTask } from '../components/analyze/DefectEliminationPanel';

// ── Types ────────────────────────────────────────────────────
type Division = 'rca' | 'defect_elimination' | 'oee';
type ParetoCriteria = 'cost' | 'downtime' | 'wo_frequency';
type AssessmentType = 'fmea' | 'rca' | 'criticality' | 'bad_actor';

// ── Division Tabs ────────────────────────────────────────────
const DIVISIONS: { id: Division; label: string; icon: React.ReactNode; description: string }[] = [
    { id: 'rca', label: 'Root Cause Analysis', icon: <GitMerge size={16} />, description: 'Formal failure investigations — 5-Why, Fishbone, Fault Tree · problem type determines the tool' },
    { id: 'defect_elimination', label: 'Defect Elimination', icon: <Target size={16} />, description: 'Identify bad actors → detect patterns → eliminate chronic defects to prevent reoccurrence' },
    { id: 'oee', label: 'OEE Analysis', icon: <Gauge size={16} />, description: 'Overall Equipment Effectiveness — Availability, Performance, Quality, and equivalent capacity loss hours' },
];

// ═════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═════════════════════════════════════════════════════════════
// ── Criticality helpers ──────────────────────────────────
const CRIT_COLORS: Record<CriticalityRank, { bg: string; text: string; border: string }> = {
    A: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
    B: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
    C: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
    D: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
    E: { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-200' },
};
const CRIT_LABELS: Record<CriticalityRank, string> = { A: 'Safety Critical', B: 'Production Critical', C: 'Standard', D: 'Low Impact', E: 'Run-to-Failure' };

export const AnalyzePage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    // ── Asset context from query params ───────────────────────
    const assetIdFromUrl = searchParams.get('asset') || '';
    const tabFromUrl = (searchParams.get('tab') || searchParams.get('division')) as Division | null;

    const [contextAsset, setContextAsset] = useState<Asset | null>(null);
    const [assetLoading, setAssetLoading] = useState(false);

    // Fetch real asset from Supabase when asset ID is in URL
    useEffect(() => {
        if (!assetIdFromUrl) { setContextAsset(null); return; }
        let cancelled = false;
        setAssetLoading(true);
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('assets')
                    .select('*')
                    .eq('id', assetIdFromUrl)
                    .single();
                if (cancelled) return;
                if (error || !data) {
                    console.warn('[AnalyzePage] Asset not found in DB:', assetIdFromUrl, error?.message);
                    setContextAsset(null);
                } else {
                    // Map DB row (snake_case) → Asset type
                    const statusMap: Record<string, Asset['status']> = {
                        OPERATING: 'operating', STANDBY: 'standby',
                        UNDER_MAINTENANCE: 'under_maintenance', DECOMMISSIONED: 'decommissioned',
                        MOTHBALLED: 'mothballed',
                    };
                    const levelMap: Record<string, Asset['taxonomy_level']> = {
                        ENTERPRISE: 'enterprise', SITE: 'site', UNIT: 'unit',
                        SYSTEM: 'system', EQUIPMENT: 'equipment', SUBUNIT: 'subunit', COMPONENT: 'component',
                    };
                    const props = data.properties || {};
                    const mapped: Asset = {
                        id: data.id,
                        tag: data.tag || '',
                        name: data.name || '',
                        description: data.description || props.description || '',
                        taxonomy_level: levelMap[(data.hierarchy_level || '').toUpperCase()] || 'equipment',
                        parent_id: data.parent_id || null,
                        site: props.site || data.site || '',
                        unit: props.unit || '',
                        system: props.system || '',
                        functional_location: props.functional_location || data.functional_location || '',
                        equipment_type: props.equipment_type || 'mechanical',
                        equipment_class: props.equipment_class || 'other',
                        equipment_category: props.equipment_category || data.model || '',
                        criticality: (data.criticality || 'C') as CriticalityRank,
                        criticality_method: props.criticality_method || 'manual',
                        status: statusMap[(data.status_code || '').toUpperCase()] || 'operating',
                        maintenance_strategy: props.maintenance_strategy || 'not_assigned',
                        design_data: props.design_data,
                        operating_context: props.operating_context,
                        install_date: data.install_date || data.created_at || new Date().toISOString(),
                        warranty_expiry: props.warranty_expiry || null,
                        last_overhaul: props.last_overhaul || null,
                        condition_rating: props.condition_rating || 3,
                        health_index: props.health_index ?? 0,
                        rul_days: props.rul_days ?? null,
                        risk_priority: props.risk_priority || { rpn: 0, consequence: 1, probability: 1, detectability: 1 },
                        running_hours: props.running_hours ?? 0,
                        mtbf_days: props.mtbf_days ?? null,
                        mttr_hours: props.mttr_hours ?? null,
                        failure_count_ytd: props.failure_count_ytd ?? 0,
                        wo_count_ytd: props.wo_count_ytd ?? 0,
                        cost_ytd: props.cost_ytd ?? 0,
                        manufacturer: data.manufacturer || '',
                        model: data.model || '',
                        serial_number: data.serial_number || '',
                        children_count: props.children_count ?? 0,
                    };
                    setContextAsset(mapped);
                }
            } catch (err) {
                console.error('[AnalyzePage] Error fetching asset:', err);
                if (!cancelled) setContextAsset(null);
            } finally {
                if (!cancelled) setAssetLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [assetIdFromUrl]);

    // ── Division state ────────────────────────────────────────
    const [activeDivision, setActiveDivision] = useState<Division>(
        tabFromUrl && DIVISIONS.some(d => d.id === tabFromUrl) ? tabFromUrl : 'rca'
    );

    // Sync tab from URL on mount / param change
    useEffect(() => {
        if (tabFromUrl && DIVISIONS.some(d => d.id === tabFromUrl)) {
            setActiveDivision(tabFromUrl);
        }
    }, [tabFromUrl]);

    const clearAssetContext = useCallback(() => {
        searchParams.delete('asset');
        searchParams.delete('tab');
        setSearchParams(searchParams, { replace: true });
    }, [searchParams, setSearchParams]);

    // ── Pareto data + criteria (bubbled up from ParetoAnalysisTab) ──
    const [paretoData, setParetoData] = useState<ParetoResult[]>([]);
    const [paretoCriteria, setParetoCriteria] = useState<ParetoCriteria>('cost');

    // ── RCA expand/collapse ───────────────────────────────────
    const [expandedRca, setExpandedRca] = useState<string | null>(null);

    // ── Incoming WO → RCA navigation ─────────────────────────
    useEffect(() => {
        const state = location.state as { raiseRCA?: IncomingWOPayload } | null;
        if (state?.raiseRCA) {
            // Navigate directly to the new RCA page with WO data spooled
            navigate('/analyze/rca/new', {
                state: {
                    title: `RCA: ${state.raiseRCA.title || 'Work Order Failure'}`,
                    asset_id: state.raiseRCA.asset_id,
                    description: state.raiseRCA.description,
                    incomingWO: state.raiseRCA
                }
            });
        }
    }, [location.state, navigate]);

    // ── New Analysis — opens the assessment modal with the right type ─
    const handleNewAnalysis = useCallback(() => {
        const typeMap: Record<Division, AssessmentType> = {
            rca: 'rca',
            oee: 'fmea',
            defect_elimination: 'bad_actor',
        };
        setModalInitialType(typeMap[activeDivision] || 'fmea');
        setShowNewAssessment(true);
    }, [activeDivision]);

    // ── Modal state ───────────────────────────────────────────
    const [showNewAssessment, setShowNewAssessment] = useState(false);
    const [modalInitialType, setModalInitialType] = useState<AssessmentType>('fmea');
    const [modalInitialAssetId, setModalInitialAssetId] = useState(assetIdFromUrl);
    const [modalInitialTitle, setModalInitialTitle] = useState('');
    const [modalInitialTargetLevel, setModalInitialTargetLevel] = useState('');
    const [modalInitialDescription, setModalInitialDescription] = useState('');

    // Keep modal asset in sync with URL
    useEffect(() => {
        setModalInitialAssetId(assetIdFromUrl);
    }, [assetIdFromUrl]);

    // ── Intelligence data (FMEA, RCA lists) ───────────────────
    const { loading, fmeaWorksheets, rcas, refetchAnalyze } = useIntelligence(assetIdFromUrl, paretoCriteria);

    // ── Triggers ──────────────────────────────────────────────
    const [triggers, setTriggers] = useState<{ asset_id: string; asset_name: string; trigger: string; value: number; threshold: number }[]>([]);

    // ── Defect Elimination tasks ──────────────────────────────
    const [deTasks, setDeTasks] = useState<DefectEliminationTask[]>([]);

    // ── Callback: ParetoAnalysisTab bubbles up its data + criteria ──
    const handleParetoDataChange = useCallback((data: ParetoResult[], criteria: ParetoCriteria) => {
        setParetoData(data);
        setParetoCriteria(criteria);
    }, []);

    // ── Load triggers on mount ───────────────────────────────
    useEffect(() => {
        analyzeService.checkTriggers().then(setTriggers).catch(console.error);
    }, []);

    // ── Load DE tasks from Supabase ─────────────────────────
    const refreshDETasks = useCallback(() => {
        analyzeService.getDETasks().then(tasks => {
            setDeTasks(tasks.map(t => ({
                id: t.id, assetId: t.asset_id ?? '', assetName: t.asset_name,
                title: t.title, status: t.status, priority: t.priority,
                annualCost: Number(t.annual_cost), estimatedSavings: Number(t.estimated_savings),
                implementationCost: Number(t.implementation_cost), paybackMonths: Number(t.payback_months),
                rootCauseSummary: t.root_cause_summary, proposedSolution: t.proposed_solution,
                rcaId: t.rca_id ?? undefined, collaborators: t.collaborators ?? [], createdAt: t.created_at,
            })));
        }).catch(err => {
            console.error('[AnalyzePage] Failed to load DE tasks:', err);
            setDeTasks([]);
        });
    }, []);

    useEffect(() => {
        refreshDETasks();
    }, [refreshDETasks]);

    // ── Handlers ──────────────────────────────────────────────
    const handleExportCSV = useCallback(() => {
        if (paretoData.length === 0) return;
        const rows = ['Rank,Tag,Asset Name,Criticality,Metric Value,Unit,Event Count,% of Total,Cumulative %'];
        paretoData.forEach(d => {
            rows.push(`${d.rank},"${d.asset_tag}","${d.asset_name}",${d.criticality},${d.metric_value},${d.metric_unit},${d.event_count},${d.pct_of_total},${d.cumulative_pct}`);
        });
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `pareto_${paretoCriteria}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click(); URL.revokeObjectURL(url);
    }, [paretoData, paretoCriteria]);

    const openNewAnalysis = useCallback((type: AssessmentType, opts?: {
        assetId?: string; title?: string; targetLevel?: string; description?: string;
    }) => {
        setModalInitialType(type);
        setModalInitialAssetId(opts?.assetId || '');
        setModalInitialTitle(opts?.title || '');
        setModalInitialTargetLevel(opts?.targetLevel || '');
        setModalInitialDescription(opts?.description || '');
        setShowNewAssessment(true);
    }, []);

    const handleInitiateRCA = useCallback((asset: ParetoResult) => {
        openNewAnalysis('rca', {
            assetId: asset.asset_id,
            title: `RCA: ${asset.asset_tag} Bad Actor`,
            targetLevel: asset.hierarchy_level || 'equipment',
            description: `Initiated from Pareto analysis — #${asset.rank} bad actor by ${paretoCriteria}`,
        });
    }, [paretoCriteria, openNewAnalysis]);

    const handleCreateFMEA = useCallback((asset: ParetoResult) => {
        openNewAnalysis('fmea', {
            assetId: asset.asset_id,
            title: `FMEA: ${asset.asset_tag}`,
            targetLevel: asset.hierarchy_level || 'equipment',
            description: `FMEA initiated from Pareto analysis`,
        });
    }, [openNewAnalysis]);

    const handleCreateDETask = useCallback(async (task: Omit<DefectEliminationTask, 'id' | 'createdAt'>) => {
        const saved = await analyzeService.createDETask({
            asset_id: task.assetId || null,
            asset_name: task.assetName, title: task.title,
            status: task.status, priority: task.priority,
            annual_cost: task.annualCost, estimated_savings: task.estimatedSavings,
            implementation_cost: task.implementationCost, payback_months: task.paybackMonths,
            root_cause_summary: task.rootCauseSummary, proposed_solution: task.proposedSolution,
            rca_id: task.rcaId || null, created_by: null,
        });
        if (saved) {
            setDeTasks(prev => [...prev, {
                id: saved.id, assetId: saved.asset_id ?? '', assetName: saved.asset_name,
                title: saved.title, status: saved.status, priority: saved.priority,
                annualCost: Number(saved.annual_cost), estimatedSavings: Number(saved.estimated_savings),
                implementationCost: Number(saved.implementation_cost), paybackMonths: Number(saved.payback_months),
                rootCauseSummary: saved.root_cause_summary, proposedSolution: saved.proposed_solution,
                rcaId: saved.rca_id ?? undefined, createdAt: saved.created_at,
            }]);
        }
    }, []);

    const handleUpdateDETaskStatus = useCallback(async (taskId: string, status: DefectEliminationTask['status']) => {
        await analyzeService.updateDETask(taskId, { status });
        setDeTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
    }, []);

    const handleEditDETask = useCallback(async (taskId: string, updates: Partial<DefectEliminationTask>) => {
        await analyzeService.updateDETask(taskId, {
            title: updates.title,
            status: updates.status,
            priority: updates.priority,
            root_cause_summary: updates.rootCauseSummary,
            proposed_solution: updates.proposedSolution,
            // Persist financial fields
            ...(updates.annualCost !== undefined && { annual_cost: updates.annualCost }),
            ...(updates.estimatedSavings !== undefined && { estimated_savings: updates.estimatedSavings }),
            ...(updates.implementationCost !== undefined && { implementation_cost: updates.implementationCost }),
            ...(updates.paybackMonths !== undefined && { payback_months: updates.paybackMonths }),
        });
        setDeTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    }, []);

    const handleDeleteDETask = useCallback(async (taskId: string) => {
        await analyzeService.deleteDETask(taskId);
        setDeTasks(prev => prev.filter(t => t.id !== taskId));
    }, []);

    // ── Linked Work Orders for DE tasks ───────────────────────
    const [deLinkedWOs, setDeLinkedWOs] = useState<Record<string, { id: string; wo_number: string; title: string; status: string; type: string; created_at: string }[]>>({});

    const handleGenerateWO = useCallback(async (taskId: string, woData: {
        title: string; description: string; type: string; priority: string;
        asset_id: string | null; due_date?: string;
    }) => {
        const result = await analyzeService.generateWOFromDE(taskId, {
            ...woData,
            priority_code: woData.priority,
            created_by: '00000000-0000-0000-0000-000000000000',
        });
        if (result) {
            // Refresh linked WOs for this task
            const wos = await analyzeService.getLinkedWOs(taskId);
            setDeLinkedWOs(prev => ({ ...prev, [taskId]: wos }));
        }
    }, []);

    // Load linked WOs when DE tasks load
    useEffect(() => {
        if (deTasks.length > 0) {
            Promise.all(
                deTasks.map(t => analyzeService.getLinkedWOs(t.id).then(wos => [t.id, wos] as const))
            ).then(results => {
                const map: Record<string, any[]> = {};
                results.forEach(([id, wos]) => { if (wos.length > 0) map[id] = wos; });
                setDeLinkedWOs(map);
            }).catch(console.error);
        }
    }, [deTasks]);

    const handleDEUpdateCollaborators = useCallback(async (taskId: string, collaborators: StudyCollaborator[]) => {
        // Optimistic update
        setDeTasks(prev => prev.map(t => t.id === taskId ? { ...t, collaborators } : t));
        // Persist to Supabase
        try {
            await analyzeService.updateDETask(taskId, { collaborators } as any);
        } catch (e) {
            console.error('Failed to update DE task collaborators:', e);
        }
    }, []);

    const handleCreatePMFromDE = useCallback(async (taskId: string, pmData: {
        code: string; description: string; asset_id: string; schedule_type: string;
        frequency_interval: number; frequency_unit: string; work_type: string; estimated_hours: number;
    }) => {
        try {
            const result = await analyzeService.createPMFromDE(taskId, {
                ...pmData,
                created_by: '00000000-0000-0000-0000-000000000000',
            });
            if (result) {
                console.log(`[DE→PM] Created PM ${result.pm_id} from DE task ${taskId}`);
                // Optionally advance DE task to 'verified' status
                await analyzeService.updateDETask(taskId, { status: 'verified' });
                setDeTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'verified' } : t));
            }
        } catch (e) {
            console.error('Failed to create PM from DE task:', e);
        }
    }, []);

    // ── Skeleton ──────────────────────────────────────────────
    if (loading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="h-8 w-72 bg-slate-50 rounded" />
                <div className="h-4 w-96 bg-slate-50 rounded" />
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => <div key={i} className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 h-24" />)}
                </div>
                <div className="bg-white border border-slate-200 rounded-xl h-80" />
            </div>
        );
    }

    // ═════════════════════════════════════════════════════════
    //  RENDER
    // ═════════════════════════════════════════════════════════
    return (
        <div className="space-y-5 animate-in fade-in duration-500">
            {/* ── Asset Context Bar (shown when navigated from Asset detail) ── */}
            {assetLoading && assetIdFromUrl && (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 animate-pulse">
                    <div className="w-10 h-10 bg-slate-200 rounded-lg" />
                    <div className="flex-1 space-y-2">
                        <div className="h-4 w-48 bg-slate-200 rounded" />
                        <div className="h-3 w-72 bg-slate-200 rounded" />
                    </div>
                </div>
            )}
            {contextAsset && (
                <div className={`rounded-xl border-2 ${CRIT_COLORS[contextAsset.criticality].border} bg-white shadow-sm overflow-hidden animate-in slide-in-from-top duration-300`}>
                    {/* Row 1: Identity */}
                    <div className={`flex items-center gap-3 p-3 ${CRIT_COLORS[contextAsset.criticality].bg}`}>
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${contextAsset.criticality === 'A' ? 'bg-red-100' : contextAsset.criticality === 'B' ? 'bg-amber-100' : 'bg-slate-100'}`}>
                            <Cpu size={20} className={CRIT_COLORS[contextAsset.criticality].text} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-slate-800">{contextAsset.tag || 'N/A'}</span>
                                <span className="text-xs text-slate-500 truncate">— {contextAsset.name}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${CRIT_COLORS[contextAsset.criticality].text} ${CRIT_COLORS[contextAsset.criticality].bg} border ${CRIT_COLORS[contextAsset.criticality].border}`}>
                                    Crit {contextAsset.criticality} — {CRIT_LABELS[contextAsset.criticality]}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${contextAsset.status === 'operating' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                                    contextAsset.status === 'under_maintenance' ? 'bg-orange-50 text-orange-600 border border-orange-200' :
                                        contextAsset.status === 'standby' ? 'bg-blue-50 text-blue-600 border border-blue-200' :
                                            'bg-gray-50 text-gray-500 border border-gray-200'
                                    }`}>{(contextAsset.status || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400 flex-wrap">
                                {contextAsset.manufacturer && <span>🏭 {contextAsset.manufacturer} {contextAsset.model && `· ${contextAsset.model}`}</span>}
                                {contextAsset.serial_number && <span>🔖 S/N: {contextAsset.serial_number}</span>}
                                {contextAsset.equipment_type && <span>⚙️ {contextAsset.equipment_type}</span>}
                                {contextAsset.site && <span>📍 {contextAsset.site}</span>}
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                onClick={() => navigate(`/assets?id=${contextAsset.id}`)}
                                className="px-2 py-1 text-[10px] bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
                            >← Back to Asset</button>
                            <button
                                onClick={clearAssetContext}
                                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-white rounded transition-colors"
                                title="Clear asset context"
                            ><X size={14} /></button>
                        </div>
                    </div>
                    {/* Row 2: KPIs */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-slate-100 border-t border-slate-200">
                        {[
                            { label: 'Health Index', value: contextAsset.health_index ? `${contextAsset.health_index.toFixed(1)}%` : '—', color: (contextAsset.health_index ?? 0) >= 80 ? 'text-emerald-600' : (contextAsset.health_index ?? 0) >= 60 ? 'text-amber-600' : 'text-red-600' },
                            { label: 'RUL', value: contextAsset.rul_days != null ? `${contextAsset.rul_days}d` : '—', color: (contextAsset.rul_days ?? 999) > 90 ? 'text-emerald-600' : (contextAsset.rul_days ?? 999) > 30 ? 'text-amber-600' : 'text-red-600' },
                            { label: 'Running Hours', value: contextAsset.running_hours ? contextAsset.running_hours.toLocaleString() : '—', color: 'text-slate-700' },
                            { label: 'MTBF', value: contextAsset.mtbf_days != null ? `${contextAsset.mtbf_days}d` : '—', color: 'text-slate-700' },
                            { label: 'Failures YTD', value: String(contextAsset.failure_count_ytd || 0), color: (contextAsset.failure_count_ytd || 0) > 3 ? 'text-red-600' : 'text-slate-700' },
                            { label: 'Cost YTD', value: contextAsset.cost_ytd ? `$${(contextAsset.cost_ytd / 1000).toFixed(0)}k` : '—', color: (contextAsset.cost_ytd || 0) > 100000 ? 'text-red-600' : 'text-slate-700' },
                        ].map(kpi => (
                            <div key={kpi.label} className="bg-white px-3 py-2 text-center">
                                <div className={`text-sm font-semibold ${kpi.color}`}>{kpi.value}</div>
                                <div className="text-[9px] text-slate-400 uppercase tracking-wider">{kpi.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Page Header ─────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-blue-500 to-blue-600" />
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 font-sans tracking-tight">Analyze &amp; Investigate</h1>
                    </div>
                    <p className="text-slate-500 text-xs sm:text-sm mt-1.5 ml-4">Root cause analysis &amp; defect elimination — Pareto → RCA → DE · ISO 55000</p>
                </div>
                <div className="flex gap-2 shrink-0">
                    <button
                        onClick={() => navigate('/reliability-modelling')}
                        className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs sm:text-sm transition-all border border-slate-200 shadow-sm hover:shadow"
                        title="Open Reliability Modelling — RBD, RAM, Weibull, Spares"
                    >
                        <Cpu size={15} /> Modelling
                    </button>
                    <button onClick={handleExportCSV} className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs sm:text-sm transition-all border border-slate-200 shadow-sm hover:shadow">
                        <Download size={15} /> <span className="hidden xs:inline">Export</span> CSV
                    </button>
                    <button
                        onClick={handleNewAnalysis}
                        className="flex items-center gap-2 px-4 sm:px-5 py-2 bg-gradient-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white font-semibold rounded-xl text-xs sm:text-sm transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30"
                    >
                        <Plus size={15} /> New Analysis
                    </button>
                </div>
            </div>

            {/* ── Division Tab Bar (primary tools) ─────────────── */}
            <div className="-mx-1 px-1" style={{ overflow: 'visible' }}>
                <div className="flex gap-1.5 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-1.5 rounded-2xl border border-slate-200/80 shadow-sm min-w-max backdrop-blur-sm">
                    {DIVISIONS.map(div => (
                        <div key={div.id} style={{ position: 'relative' }}
                            onMouseEnter={e => {
                                const tip = e.currentTarget.querySelector('[data-tooltip]') as HTMLElement;
                                if (tip) tip.style.opacity = '1';
                            }}
                            onMouseLeave={e => {
                                const tip = e.currentTarget.querySelector('[data-tooltip]') as HTMLElement;
                                if (tip) tip.style.opacity = '0';
                            }}
                        >
                            <button
                                onClick={() => setActiveDivision(div.id)}
                                className={`relative flex items-center gap-2.5 px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-300 whitespace-nowrap ${activeDivision === div.id
                                    ? 'bg-gradient-to-r from-blue-600 to-blue-600 text-white shadow-lg shadow-blue-500/25 scale-[1.02]'
                                    : 'text-slate-500 hover:text-slate-800 hover:bg-white hover:shadow-md'
                                    }`}
                            >
                                <span className={`transition-colors duration-300 ${activeDivision === div.id ? 'text-white/90' : 'text-slate-400'}`}>{div.icon}</span>
                                <span>{div.label}</span>
                                {activeDivision === div.id && (
                                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-1 bg-white/30 rounded-full" />
                                )}
                            </button>
                            {/* Tooltip — appears ABOVE the button to avoid overflow clipping */}
                            <div data-tooltip style={{
                                position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                                bottom: '100%', marginBottom: 10,
                                zIndex: 50, pointerEvents: 'none',
                                opacity: 0, transition: 'opacity 0.2s ease',
                            }}>
                                <div style={{
                                    background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                                    border: '1px solid #334155',
                                    borderRadius: 12,
                                    padding: '12px 16px',
                                    maxWidth: 300,
                                    minWidth: 200,
                                    boxShadow: '0 12px 40px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.25)',
                                    position: 'relative' as const,
                                }}>
                                    <div style={{ fontSize: 12, fontWeight: 500, color: '#e2e8f0', lineHeight: 1.6 }}>
                                        {div.description}
                                    </div>
                                    {/* Arrow pointing DOWN */}
                                    <div style={{
                                        position: 'absolute' as const, bottom: -6, left: '50%', transform: 'translateX(-50%) rotate(45deg)',
                                        width: 10, height: 10,
                                        background: '#1e293b', borderRight: '1px solid #334155', borderBottom: '1px solid #334155',
                                    }} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>


            {/* ── Main Content + Reliability Specialist sidebar ── */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {/* Left: Active Division Content (3/4) */}
                <div className="lg:col-span-3 min-w-0">


                    {/* ═ ROOT CAUSE ANALYSIS ═════════════════════════ */}
                    {activeDivision === 'rca' && (
                        <RCATab
                            rcas={rcas}
                            expandedRca={expandedRca}
                            onToggleExpand={setExpandedRca}
                            onNewAssessment={() => navigate('/analyze/rca/new')}
                            onRefresh={refetchAnalyze}
                            onDETaskCreated={refreshDETasks}
                            paretoData={paretoData}
                            paretoCriteria={paretoCriteria}
                            onParetoDataChange={handleParetoDataChange}
                            onInitiateRCA={handleInitiateRCA}
                            onCreateFMEA={handleCreateFMEA}
                        />
                    )}

                    {/* ═ DEFECT ELIMINATION ═══════════════════════════ */}
                    {activeDivision === 'defect_elimination' && (
                        <DefectEliminationDivision
                            deTasks={deTasks}
                            onCreateTask={handleCreateDETask}
                            onUpdateTaskStatus={handleUpdateDETaskStatus}
                            onEditTask={handleEditDETask}
                            onDeleteTask={handleDeleteDETask}
                            onUpdateTaskCollaborators={handleDEUpdateCollaborators}
                            onGenerateWO={handleGenerateWO}
                            onCreatePM={handleCreatePMFromDE}
                            linkedWOs={deLinkedWOs}
                            onNavigateToRCA={(assetId: string) => navigate(`/analyze/rca/new?asset=${assetId}`)}
                            badActors={paretoData}
                            criteria={paretoCriteria}
                        />
                    )}

                    {/* ═ OEE ANALYSIS ══════════════════════════════ */}
                    {activeDivision === 'oee' && (
                        <OEETab
                            contextAsset={contextAsset}
                            onRcaInitiate={(assetName, oeeScore) => {
                                openNewAnalysis('rca', {
                                    title: `RCA: ${assetName} Low OEE`,
                                    description: `Initiated due to low Overall Equipment Effectiveness (OEE: ${(oeeScore * 100).toFixed(1)}%). Primary loss driver requires formal Root Cause Analysis.`,
                                });
                            }}
                        />
                    )}
                </div>

                {/* Right: Reliability Specialist + Triggers (1/4) */}
                <div className="space-y-4">
                    <ReliabilitySpecialist
                        activeDivision={activeDivision as any}
                        contextAsset={contextAsset}
                        paretoData={paretoData}
                        paretoCriteria={paretoCriteria}
                    />

                    {/* Trigger Alerts */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-yellow-500 mb-2">
                            <Zap size={16} /> Active Triggers ({triggers.length})
                        </div>
                        {triggers.length > 0 ? (
                            <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                {triggers.slice(0, 6).map((t, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center gap-2 text-xs cursor-pointer hover:bg-yellow-50 rounded-lg px-1 py-0.5 transition-colors"
                                        onClick={() => {
                                            setActiveDivision('rca');
                                            // scroll Pareto section into view after tab switch
                                            setTimeout(() => {
                                                document.getElementById('rca-investigations-section')
                                                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                            }, 200);
                                        }}
                                        title={`Investigate ${t.asset_name} — click to open Pareto prioritization`}
                                    >
                                        <span className="px-1.5 py-0.5 bg-yellow-50 text-yellow-600 border border-yellow-200 rounded text-[10px] font-semibold">{t.trigger}</span>
                                        <span className="text-slate-700 truncate">{t.asset_name}</span>
                                        <span className="text-slate-400 ml-auto text-[10px]">{t.value.toLocaleString()} / {t.threshold.toLocaleString()}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-slate-400">No active triggers. Assets are within normal operating parameters.</p>
                        )}
                    </div>
                </div>
            </div>


            {/* ═ NEW ASSESSMENT MODAL ══════════════════════════ */}
            <NewAssessmentModal
                isOpen={showNewAssessment}
                initialType={modalInitialType}
                initialAssetId={modalInitialAssetId}
                initialTitle={modalInitialTitle}
                initialTargetLevel={modalInitialTargetLevel}
                initialDescription={modalInitialDescription}
                onClose={() => setShowNewAssessment(false)}
                onCreated={refetchAnalyze}
            />
        </div>
    );
};
