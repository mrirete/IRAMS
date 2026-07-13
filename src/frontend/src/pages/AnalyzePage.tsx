import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
    Target, GitMerge, Cpu,
    Plus, Download, X, ArrowRight, MoreHorizontal,
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

// ── Shared modals ────────────────────────────────────────────
import NewAssessmentModal from '../components/analyze/NewAssessmentModal';

// ── Services ─────────────────────────────────────────────────
import { ScrollTabStrip } from '../eam/components/ui';
import { usePageRelanternContext, type SpecialistAction } from '../eam/contexts/RelanternContext';
import { aiEngine } from '../eam/services/AIAnalysisEngine';
import analyzeService from '../eam/services/AnalyzeService';
import type { ParetoResult, StudyCollaborator } from '../eam/services/AnalyzeService';
import { type DefectEliminationTask } from '../components/analyze/DefectEliminationPanel';

// ── Types ────────────────────────────────────────────────────
type Division = 'rca' | 'defect_elimination' | 'oee';
type ParetoCriteria = 'cost' | 'downtime' | 'wo_frequency';
type AssessmentType = 'fmea' | 'rca' | 'criticality' | 'bad_actor';

// Human labels for the tool aiEngine.recommendTool() returns.
const TOOL_LABELS: Record<string, string> = {
    rca: 'Root Cause Analysis',
    fmea: 'FMECA',
    pareto: 'Pareto Analysis',
    rbd: 'Reliability Block Diagram',
    fault_tree: 'Fault Tree Analysis',
    monte_carlo: 'Monte Carlo Simulation',
};

// ── Division Tabs ────────────────────────────────────────────
const DIVISIONS: { id: Division; label: string; mobileLabel: string; icon: React.ReactNode; description: string }[] = [
    { id: 'rca', label: 'Root Cause Analysis', mobileLabel: 'RCA', icon: <GitMerge size={16} />, description: 'Formal failure investigations — 5-Why, Fishbone, Fault Tree · problem type determines the tool' },
    { id: 'defect_elimination', label: 'Defect Elimination', mobileLabel: 'DE', icon: <Target size={16} />, description: 'Identify bad actors → detect patterns → eliminate chronic defects to prevent reoccurrence' },
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

    // ── Visible investigation rows (bubbled up from RCATab) for CSV export ──
    const [rcaExportRows, setRcaExportRows] = useState<string[] | null>(null);

    // ── Page overflow menu (Export / Model reliability) ──
    const [pageMenuOpen, setPageMenuOpen] = useState(false);
    const pageMenuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!pageMenuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (pageMenuRef.current && !pageMenuRef.current.contains(e.target as Node)) setPageMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [pageMenuOpen]);

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

    // The page-header "New Analysis" button is gone: it duplicated the "New" button
    // on the Investigations list (both went to /analyze/rca/new), and on the DE tab it
    // mapped to type 'bad_actor', which NewAssessmentModal handles in neither branch —
    // it fell straight through to setAssessmentCreated(true), showing a green
    // "Analysis Created / Redirecting…" screen while writing nothing and going nowhere.
    // Creation now happens on the list that the thing is created into.

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

    // ── Defect Elimination tasks ──────────────────────────────
    const [deTasks, setDeTasks] = useState<DefectEliminationTask[]>([]);

    // ── Ground the global Reliability Specialist in this page ─────────────────
    // Analyze used to carry its own floating Specialist with a separate chat
    // history. There is one Specialist now (the TopBar / RelanternAI panel); this
    // hands it the same context the old bubble built, so opening it from anywhere
    // in Analyze lands pre-grounded rather than generic.
    const specialistContext = useMemo(() => {
        const divisionLabel = DIVISIONS.find(d => d.id === activeDivision)?.label || activeDivision;
        const parts = [`Analyze module — active division: ${divisionLabel}.`];
        if (contextAsset) {
            parts.push(`Asset in context: ${contextAsset.tag} (${contextAsset.name})` +
                `${contextAsset.criticality ? `, criticality ${contextAsset.criticality}` : ''}` +
                `${(contextAsset as any).equipment_type ? `, type ${(contextAsset as any).equipment_type}` : ''}.`);
        }
        if (paretoData.length > 0) {
            const top = paretoData.slice(0, 3)
                .map(p => `${p.asset_tag} (${p.metric_value.toLocaleString()})`).join(', ');
            parts.push(`Top ${Math.min(3, paretoData.length)} bad actors by ${paretoCriteria}: ${top}.`);
        }
        if (rcas.length > 0) parts.push(`${rcas.length} RCA investigation(s) open.`);
        if (deTasks.length > 0) parts.push(`${deTasks.length} defect-elimination task(s) tracked.`);
        return parts.join(' ');
    }, [activeDivision, contextAsset, paretoData, paretoCriteria, rcas.length, deTasks.length]);

    // Engine-backed Specialist skills. Each one calls a deterministic IRAMS engine
    // (aiEngine) with this page's real data and renders what it returns — the chat
    // model is never asked to compute a failure rate, a cost, or a payback period.
    // Ported from the retired Analyze-only Specialist bubble.
    const specialistActions = useMemo<SpecialistAction[]>(() => [
        {
            label: 'Recommend Tool',
            description: 'Suggest the best analysis approach for this situation',
            userMessage: '🔍 Recommend the best analysis tool for my current situation',
            run: async () => {
                const r = await aiEngine.recommendTool({
                    problemDescription: contextAsset?.name || paretoData[0]?.asset_name || 'General reliability analysis',
                    assetCriticality: contextAsset?.criticality || paretoData[0]?.criticality || 'B',
                    failureCount: paretoData.reduce((s, p) => s + p.event_count, 0) || undefined,
                    totalCost: paretoData.reduce((s, p) => s + p.metric_value, 0) || undefined,
                });
                let out = `**Recommended: ${TOOL_LABELS[r.tool] || r.tool}**\n\n${r.reasoning}`;
                if (r.suggestedSteps?.length) {
                    out += '\n\n**Suggested Steps:**\n' + r.suggestedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n');
                }
                return out;
            },
        },
        {
            label: 'Generate Hypotheses',
            description: 'AI-generated RCA hypotheses (5-Why / Fishbone)',
            userMessage: '🧪 Generate RCA hypotheses for the current asset',
            run: async () => {
                const r = await aiEngine.generateRCAHypothesis({
                    problemStatement: contextAsset
                        ? `Investigate failures on ${contextAsset.name} (${contextAsset.tag})`
                        : 'General failure investigation',
                    assetType: (contextAsset as any)?.equipment_type,
                });
                if (!r.hypotheses.length) {
                    return 'No hypotheses could be generated. Please provide more context about the failure event.';
                }
                let out = '**RCA Hypotheses (PROACT 3-Layer Model):**\n\n';
                r.hypotheses.forEach((h, i) => {
                    const icon = h.likelihood === 'high' ? '🔴' : h.likelihood === 'medium' ? '🟡' : '🟢';
                    out += `${i + 1}. ${icon} **[${h.category}]** ${h.description} _(Likelihood: ${h.likelihood})_\n`;
                });
                if (r.suggestedEvidence?.length) {
                    out += '\n**Evidence to Collect:**\n' + r.suggestedEvidence.map(e => `- ${e}`).join('\n');
                }
                if (Object.keys(r.fishboneCategories).length > 0) {
                    out += '\n\n**Fishbone (6M) Categories:**\n';
                    Object.entries(r.fishboneCategories).forEach(([cat, items]) => {
                        if (items.length > 0) out += `- **${cat}:** ${items.join(', ')}\n`;
                    });
                }
                return out;
            },
        },
        {
            label: 'Corrective Actions',
            description: 'Suggest corrective actions for root causes',
            userMessage: '🔧 Suggest corrective actions for identified root causes',
            run: async () => {
                const r = await aiEngine.suggestCorrectiveActions({
                    rootCauses: [{
                        description: contextAsset ? `Repeated failures on ${contextAsset.name}` : 'General equipment failure',
                        category: 'physical',
                    }],
                    assetCriticality: contextAsset?.criticality || 'B',
                    industry: 'Oil & Gas',
                });
                if (!r.actions.length) {
                    return 'Unable to generate corrective actions. Please provide more context about the root causes.';
                }
                let out = '**Corrective Actions:**\n\n';
                r.actions.forEach((a, i) => {
                    const icon = a.type === 'immediate' ? '⚡' : a.type === 'short_term' ? '📋' : '🏗️';
                    out += `${i + 1}. ${icon} **[${a.type.replace('_', ' ')}]** ${a.description}`;
                    if (a.estimatedCost) out += ` _(Est: ${a.estimatedCost})_`;
                    if (a.requiresMoC) out += ' `⚠️ MoC Required`';
                    out += '\n';
                });
                if (r.riskOfInaction) out += `\n**Risk of Inaction:** ${r.riskOfInaction}`;
                return out;
            },
        },
        {
            label: 'Defect Pattern',
            description: 'Detect repeat failure patterns',
            userMessage: '📊 Assess defect patterns from work order history',
            run: async () => {
                const r = await aiEngine.assessDefectPattern({
                    assetName: contextAsset?.name || paretoData[0]?.asset_name || 'Unknown',
                    assetType: (contextAsset as any)?.equipment_type,
                    workOrders: paretoData.slice(0, 10).map(p => ({
                        type: 'CM', title: `Failure on ${p.asset_tag}`, cost: p.metric_value,
                        date: new Date().toISOString().slice(0, 10), failureMode: 'Unknown',
                    })),
                });
                return r.patternDetected
                    ? `**⚠️ Pattern Detected**\n\n- **Failure Mode:** ${r.failureMode}\n- **Recurrence Rate:** ${r.recurrenceRate} failures/year\n- **Estimated Annual Cost:** $${r.estimatedAnnualCost.toLocaleString()}\n\n**Recommendation:** ${r.recommendation}`
                    : '**✅ No Repeat Pattern Detected**\n\nThe failure data does not show a clear recurring pattern. Continue monitoring.';
            },
        },
        {
            label: 'Draft DE Plan',
            description: 'Draft a defect elimination plan',
            userMessage: '📝 Draft a defect elimination plan',
            run: async () => {
                const top = paretoData[0];
                const r = await aiEngine.draftEliminationPlan({
                    assetName: contextAsset?.name || top?.asset_name || 'Unknown',
                    assetCriticality: contextAsset?.criticality || top?.criticality || 'B',
                    annualFailureCost: top?.metric_value || 50000,
                    failureCount: top?.event_count || 5,
                    dominantFailureMode: 'Mechanical wear',
                });
                return `**Defect Elimination Plan Draft**\n\n**Title:** ${r.title}\n**Scope:** ${r.scope}\n**Priority:** \`${r.priority}\`\n\n`
                    + `**Root Cause Summary:** ${r.rootCauseSummary}\n\n**Proposed Solution:** ${r.proposedSolution}\n\n`
                    + `| Metric | Value |\n|---|---|\n`
                    + `| Est. Annual Savings | $${r.estimatedSavingsPerYear.toLocaleString()} |\n`
                    + `| Implementation Cost | $${r.estimatedImplementationCost.toLocaleString()} |\n`
                    + `| Payback Period | ${r.paybackMonths} months |`;
            },
        },
    ], [contextAsset, paretoData]);

    usePageRelanternContext(specialistContext, 'analyze', specialistActions);

    // ── Callback: ParetoAnalysisTab bubbles up its data + criteria ──
    const handleParetoDataChange = useCallback((data: ParetoResult[], criteria: ParetoCriteria) => {
        setParetoData(data);
        setParetoCriteria(criteria);
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

    // Export targets what's actually on screen. Pareto wins when an analysis has
    // been run (it's the more specific dataset); otherwise we export the list the
    // active division is showing. `null` = nothing to export, so the button
    // disables rather than silently no-opping.
    const exportTarget = useMemo<{ label: string; file: string; rows: string[] } | null>(() => {
        const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const today = new Date().toISOString().slice(0, 10);

        if (paretoData.length > 0) {
            const rows = ['Rank,Tag,Asset Name,Criticality,Metric Value,Unit,Event Count,% of Total,Cumulative %'];
            paretoData.forEach(d => {
                rows.push([d.rank, csv(d.asset_tag), csv(d.asset_name), d.criticality, d.metric_value,
                    d.metric_unit, d.event_count, d.pct_of_total, d.cumulative_pct].join(','));
            });
            return { label: 'Export Pareto', file: `pareto_${paretoCriteria}_${today}.csv`, rows };
        }

        // RCATab supplies these — it holds the asset id → tag map and the active
        // search/filter/sort, so the export matches the rows actually on screen.
        if (activeDivision === 'rca' && rcaExportRows) {
            return { label: 'Export Investigations', file: `investigations_${today}.csv`, rows: rcaExportRows };
        }

        if (activeDivision === 'defect_elimination' && deTasks.length > 0) {
            const rows = ['#,Title,Asset,Status,Priority,Owner,Due'];
            deTasks.forEach((t: any, i: number) => {
                rows.push([i + 1, csv(t.title), csv(t.asset_tag), csv(t.status), csv(t.priority),
                    csv(t.owner || t.assigned_to), csv(t.due_date)].join(','));
            });
            return { label: 'Export DE Tasks', file: `defect_elimination_${today}.csv`, rows };
        }

        return null;
    }, [paretoData, paretoCriteria, activeDivision, rcaExportRows, deTasks]);

    const handleExportCSV = useCallback(() => {
        if (!exportTarget) return;
        const blob = new Blob([exportTarget.rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = exportTarget.file;
        a.click(); URL.revokeObjectURL(url);
    }, [exportTarget]);

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

            {/* ── Page Header ───────────────────────────────────
                One title, one line, no method narration. The workflow used to be
                restated four times on this page (here, the tab tooltips, the DE loop
                strip, the Pareto explainer) — the page teaches by leading, not by
                captioning itself. Secondary actions live behind ⋯ so the header is
                calm; the primary action lives on the list it creates into. */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-blue-500 to-blue-600 shrink-0" />
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-800 font-sans tracking-tight truncate">Analyze</h1>
                </div>

                <div className="relative shrink-0" ref={pageMenuRef}>
                    <button
                        onClick={() => setPageMenuOpen(o => !o)}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        aria-label="More actions"
                        aria-expanded={pageMenuOpen}
                    >
                        <MoreHorizontal size={20} />
                    </button>
                    {pageMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 w-60 bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden py-1">
                            <button
                                onClick={() => { setPageMenuOpen(false); handleExportCSV(); }}
                                disabled={!exportTarget}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 enabled:hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-left"
                            >
                                <Download size={15} className="text-slate-400 shrink-0" />
                                <span className="truncate">{exportTarget?.label ?? 'Nothing to export yet'}</span>
                            </button>
                            <button
                                onClick={() => { setPageMenuOpen(false); navigate('/reliability-modelling'); }}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 text-left"
                            >
                                <Cpu size={15} className="text-slate-400 shrink-0" />
                                <span className="flex-1">Model reliability</span>
                                <ArrowRight size={13} className="text-slate-300 shrink-0" />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Division Tab Bar (primary tools) ─────────────── */}
            <ScrollTabStrip
                activeId={activeDivision}
                className="flex gap-1.5 bg-gradient-to-r from-slate-50 via-white to-slate-50 p-1.5 rounded-2xl border border-slate-200/80 shadow-sm backdrop-blur-sm"
            >
                {DIVISIONS.map(div => (
                    <button
                        key={div.id}
                        data-active={activeDivision === div.id}
                        title={div.description}
                        onClick={() => setActiveDivision(div.id)}
                        className={`relative flex items-center gap-2 sm:gap-2.5 px-3 sm:px-5 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-300 whitespace-nowrap ${activeDivision === div.id
                            ? 'bg-gradient-to-r from-blue-600 to-blue-600 text-white shadow-lg shadow-blue-500/25 scale-[1.02]'
                            : 'text-slate-500 hover:text-slate-800 hover:bg-white hover:shadow-md'
                            }`}
                    >
                        <span className={`transition-colors duration-300 ${activeDivision === div.id ? 'text-white/90' : 'text-slate-400'}`}>{div.icon}</span>
                        <span className="hidden sm:inline">{div.label}</span>
                        <span className="sm:hidden">{div.mobileLabel}</span>
                        {activeDivision === div.id && (
                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-1 bg-white/30 rounded-full" />
                        )}
                    </button>
                ))}
            </ScrollTabStrip>


            {/* ── Main Content + Reliability Specialist sidebar ── */}
            {/* Specialist is a call-up now — content gets the full width. */}
            <div className="space-y-4">
                {/* Active Division Content — full width */}
                <div className="min-w-0">


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
                            onExportRowsChange={setRcaExportRows}
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
                    {/* OEE retired — its real metric (Availability) now lives in Reliability -> Metrics. */}
                </div>

                {/* Active Triggers panel removed. It was AnalyzeService.checkTriggers() —
                    i.e. getParetoAnalysis() re-skinned as alerts — so it was a fifth ranking
                    of the same bad actors, sat below ~2000px of content, and its click handler
                    scrolled to an element id that only exists inside RCATab's unreachable
                    workspace, ignoring the row you clicked. Bad actors now live in one place:
                    the Bad actors sheet. */}
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
