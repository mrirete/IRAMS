/**
 * RCATab — the RCA PORTFOLIO: the investigation list, and the bad-actors sheet.
 *
 * It used to also carry a second, in-tab copy of the whole investigation workspace
 * (stepper, method gate, the six steps, plus DE-task / delete / team / EAM-context
 * modals). That copy was unreachable: `openWorkspace` was never called, so `viewMode`
 * could never leave 'portfolio'. ~850 lines that could not run, quietly importing
 * every heavy editor in the module. The live workspace is pages/RCAInvestigationPage.
 * Deleted — after moving the parts worth keeping (the step guide, and data-driven
 * step completion) into that live page, where users can finally see them.
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    GitMerge, Plus, X, Search,
    BarChart3, ArrowRight, ChevronUp, ChevronDown, ChevronRight,
} from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import { useAuth } from '../../eam/contexts/AuthContext';
import type { ParetoResult, StudyCollaborator, RCAInvestigation } from '../../eam/services/AnalyzeService';
import { AvatarStack } from './CollaboratorPicker';
import { useAssetContext } from '../../contexts/AssetContext';
import { Drawer } from '../../eam/components/ui';
import ParetoAnalysisTab from './ParetoAnalysisTab';
import AssetDrillDrawer from './AssetDrillDrawer';

// â”€â”€ Props â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface IncomingWOPayload {
    asset_id: string;
    wo_id: string;
    wo_number: string;
    title: string;
    description: string;
    failure_mode?: string | null;
    failure_cause?: string | null;
    event_date: string;
    cost?: number;
}

interface RCATabProps {
    rcas: any[];
    expandedRca: string | null;
    onToggleExpand: (id: string | null) => void;
    onNewAssessment: () => void;
    onRefresh?: () => void;
    onDETaskCreated?: () => void;
    paretoData?: ParetoResult[];
    paretoCriteria?: 'cost' | 'downtime' | 'wo_frequency';
    onParetoDataChange?: (data: ParetoResult[], criteria: 'cost' | 'downtime' | 'wo_frequency') => void;
    onInitiateRCA?: (asset: ParetoResult) => void;
    onCreateFMEA?: (asset: ParetoResult) => void;
    incomingWO?: IncomingWOPayload | null;
    /** Bubbles up the visible (searched/filtered/sorted) portfolio as CSV rows so the
     *  page-header Export button can offer exactly what's on screen. Asset tags are
     *  resolved here because only this component holds the id → tag map. */
    onExportRowsChange?: (rows: string[] | null) => void;
}

const METHODS: Record<string, { label: string; color: string }> = {
    five_why: { label: '5-Why', color: '#22d3ee' },
    fishbone: { label: 'Fishbone', color: '#f59e0b' },
    fault_tree: { label: 'Fault Tree', color: '#a855f7' },
    logic_tree: { label: 'Logic Tree', color: '#8b5cf6' },
    taproot: { label: 'TapRooTÂ®', color: '#ef4444' },
    apollo: { label: 'Apollo', color: '#3b82f6' },
};

// Inline-style status chip (used by the portfolio table + its mobile card equivalent)
const STATUS_CHIP: Record<string, { label: string; color: string; bg: string }> = {
    draft: { label: 'Draft', color: '#64748b', bg: '#f1f5f9' },
    in_progress: { label: 'In Progress', color: '#2563eb', bg: '#eff6ff' },
    review: { label: 'Review', color: '#d97706', bg: '#fffbeb' },
    closed: { label: 'Closed', color: '#059669', bg: '#ecfdf5' },
};
const statusChip = (status?: string) =>
    STATUS_CHIP[status || ''] || { label: status || '—', color: '#94a3b8', bg: '#f8fafc' };


export const RCATab: React.FC<RCATabProps> = ({
    rcas,
    expandedRca: _expandedRca,
    onToggleExpand: _onToggleExpand,
    onNewAssessment,
    onRefresh,
    onDETaskCreated,
    paretoData = [],
    paretoCriteria = 'cost',
    onParetoDataChange,
    onInitiateRCA,
    onCreateFMEA,
    onExportRowsChange,
}) => {
    const navigate = useNavigate();
    const { assets: allHierarchyAssets } = useAssetContext();

    const [drillAsset, setDrillAsset] = useState<ParetoResult | null>(null);
    // Bad-actors sheet. Closed by default, always — the previous inline section used
    // `useState(rcas.length > 0)`, which meant a brand-new user with nothing on the page
    // had the entire Pareto tool expanded at them on first load.
    const [paretoOpen, setParetoOpen] = useState(false);
    const [rcaScope, setRcaScope] = useState<'all' | 'mine'>('all');

    // â”€â”€ Current user context (for scoping) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { user: authUser, profile: authProfile, role: authRole } = useAuth();
    const currentContactId = authProfile?.contactId || null;
    const currentUsername = authProfile?.username || authUser?.email || '';
    const currentRole = authRole || '';

    // Determine if user has admin/manager-level visibility (full portfolio access)
    const isFullAccessRole = useMemo(() => {
        // SUPER_ADMIN/ADMIN were missing — the super admin saw an EMPTY list
        // because the ownership fallback below could never match them either.
        const fullAccessRoles = ['SUPER_ADMIN', 'SYS_ADMIN', 'ADMIN', 'MANAGER', 'EXECUTIVE', 'PLANNER', 'SUPERVISOR'];
        return fullAccessRoles.includes((currentRole || '').toUpperCase());
    }, [currentRole]);

    // â”€â”€ Helper: check if a user is a collaborator on an RCA â”€â”€â”€
    const isUserCollaborator = useCallback((rca: any): boolean => {
        const collabs = rca.collaborators || [];
        if (!currentContactId && !currentUsername) return false;
        return collabs.some((c: any) =>
            (currentContactId && c.ref_id === currentContactId) ||
            (c.name && c.name.toLowerCase() === currentUsername.toLowerCase())
        );
    }, [currentContactId, currentUsername]);

    // â”€â”€ Helper: check if user is involved in an RCA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const isUserInvolved = useCallback((rca: any): boolean => {
        return (
            rca.lead_investigator === currentUsername ||
            // created_by holds the auth user's UUID (0184) — compare against the
            // auth id, keeping the legacy username match for older rows.
            (authUser?.id && rca.created_by === authUser.id) ||
            rca.created_by === currentUsername ||
            isUserCollaborator(rca)
        );
    }, [currentUsername, authUser?.id, isUserCollaborator]);

    // â”€â”€ Filtered RCA list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Full-access roles see all RCAs; scoped roles only see their own.
    // "My RCAs" always filters to personal involvement regardless of role.
    const displayedRcas = useMemo(() => {
        if (rcaScope === 'mine') {
            return rcas.filter(rca => isUserInvolved(rca));
        }
        // 'all' scope â€” admins see everything, others see only their own
        if (isFullAccessRole) return rcas;
        return rcas.filter(rca => isUserInvolved(rca));
    }, [rcas, rcaScope, isFullAccessRole, isUserInvolved]);

    // Map asset_id â†’ tag+criticality for the portfolio table
    const [assetTagMap, setAssetTagMap] = useState<Record<string, { tag: string; criticality: string; name: string }>>({});

    // Gone with the dead workspace: edit/delete/collaborator/EAM/DE-modal state, and
    // the two effects that fetched an investigation's nodes, actions, evidence and
    // full EAM context (7 Supabase round trips) whenever `selectedId` changed. Nothing
    // could set `selectedId` once openWorkspace was unreachable, so those fetches never
    // fired — but every one of them was still shipped to the browser.

    // â”€â”€ Batch lookup asset tags for portfolio table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useEffect(() => {
        const ids = rcas.map(r => r.asset_id).filter(Boolean);
        const unique = [...new Set(ids)].filter(id => !assetTagMap[id]);
        if (unique.length === 0) return;
        // Use hierarchy assets first (already loaded)
        const newMap: Record<string, { tag: string; criticality: string; name: string }> = { ...assetTagMap };
        for (const id of unique) {
            const ha = allHierarchyAssets.find(a => a.id === id);
            if (ha) {
                newMap[id] = { tag: ha.tag || '', criticality: (ha as any).criticality || 'C', name: ha.name || '' };
            }
        }
        setAssetTagMap(newMap);
    }, [rcas, allHierarchyAssets]);

    // Edit / delete / collaborator / EAM-context / DE-task handlers all lived here.
    // Every one of them was driven by `selectedId`, which only the deleted in-tab
    // workspace could set — so none could run. They exist for real on the live
    // investigation page (pages/RCAInvestigationPage.tsx), which is where a row click
    // has always gone.

    // â”€â”€ Investigate from Pareto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleInvestigateFromPareto = useCallback((asset: ParetoResult) => {
        const criteriaLabel = paretoCriteria === 'cost' ? 'Total Cost' : paretoCriteria === 'downtime' ? 'Downtime' : 'WO Frequency';
        const problem_statement = `${asset.asset_name} (${asset.asset_tag}) ranked #${asset.rank} in Pareto analysis. ${criteriaLabel}: ${asset.metric_unit === '$' ? '$' : ''}${asset.metric_value.toLocaleString()}${asset.metric_unit !== '$' ? ` ${asset.metric_unit}` : ''} across ${asset.event_count} work orders. Criticality: ${asset.criticality}.`;
        navigate('/analyze/rca/new', {
            state: {
                title: `RCA: ${asset.asset_name} â€” Bad Actor Analysis`,
                asset_id: asset.asset_id || '',
                description: problem_statement,
                maintenanceData: {
                    source: 'pareto',
                    targetLevel: asset.hierarchy_level || 'equipment',
                    totalWorkOrders: asset.event_count,
                    failureWorkOrders: asset.event_count,
                    lastWODate: null,
                    mtbfHours: null,
                    mttrHours: paretoCriteria === 'downtime' ? asset.metric_value : null,
                    topFailureModes: [],
                    workOrderSamples: [],
                }
            }
        });
    }, [paretoCriteria, navigate]);

    const handleDrillInitiateRCA = useCallback((asset: ParetoResult) => {
        setDrillAsset(null);
        onInitiateRCA?.(asset);
    }, [onInitiateRCA]);

    const handleDrillCreateFMEA = useCallback((asset: ParetoResult) => {
        setDrillAsset(null);
        onCreateFMEA?.(asset);
    }, [onCreateFMEA]);

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //  PORTFOLIO VIEW STATE
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // `viewMode` is gone: it could only ever hold 'portfolio'. So is `showNewForm`,
    // which was a hard-coded `false` still being branched on.
    const [portfolioSearch, setPortfolioSearch] = useState('');
    const [portfolioSort, setPortfolioSort] = useState<{ field: string; dir: 'asc' | 'desc' }>({ field: 'created_at', dir: 'desc' });
    const [portfolioFilter, setPortfolioFilter] = useState<string>('all'); // 'all' | 'draft' | 'in_progress' | 'review' | 'closed'


    // Filtered + sorted list for portfolio table
    const portfolioList = useMemo(() => {
        let list = [...displayedRcas];
        if (portfolioFilter !== 'all') list = list.filter(r => r.status === portfolioFilter);
        if (portfolioSearch.trim()) {
            const q = portfolioSearch.toLowerCase();
            list = list.filter(r =>
                (r.title || '').toLowerCase().includes(q) ||
                (r.problem_statement || '').toLowerCase().includes(q) ||
                (r.asset_name || '').toLowerCase().includes(q)
            );
        }
        list.sort((a, b) => {
            const aVal = a[portfolioSort.field] || '';
            const bVal = b[portfolioSort.field] || '';
            const cmp = String(aVal).localeCompare(String(bVal));
            return portfolioSort.dir === 'asc' ? cmp : -cmp;
        });
        return list;
    }, [displayedRcas, portfolioSearch, portfolioSort, portfolioFilter]);

    // Publish the visible portfolio as CSV rows for the page-header Export button.
    const exportRows = useMemo(() => {
        if (portfolioList.length === 0) return null;
        const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = ['#,Title,Asset,Criticality,Method,Status,Category,Problem Statement,Created'];
        portfolioList.forEach((r, i) => {
            const ai = assetTagMap[r.asset_id];
            rows.push([
                i + 1,
                q(r.title || 'Untitled Investigation'),
                q(ai ? (ai.tag || ai.name) : (r.event_what || '')),
                q(ai?.criticality || ''),
                q(METHODS[r.method]?.label || r.method),
                q(statusChip(r.status).label),
                q((r.rca_category || '').replace('_', ' ')),
                q(r.problem_statement),
                q(r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : ''),
            ].join(','));
        });
        return rows;
    }, [portfolioList, assetTagMap]);

    useEffect(() => {
        onExportRowsChange?.(exportRows);
    }, [exportRows, onExportRowsChange]);

    // openWorkspace / backToPortfolio deleted — openWorkspace was the switch that was
    // never thrown. Rows navigate to /analyze/rca/:id, as they always did.

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    //  RENDER
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return (
        <div className="space-y-6">

            {/* RCA Challenger moved INTO the investigation workspace (step 3) so it
                stress-tests the actual cause analysis against the asset's evidence. */}

            {/* â•â•â•â•â•â•â• PORTFOLIO LANDING VIEW â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {(
                <>


                    {/* â”€â”€ Investigation Table Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    <div style={{
                        background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0',
                        overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
                    }}>
                        {/* Table Header Bar — responsive: stacks on mobile, side-by-side on sm+ */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3"
                            style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                            {/* Left: icon + label + count + scope toggle */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: 8,
                                    background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', border: '1px solid #c7d2fe',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                }}>
                                    <GitMerge size={14} color="#6366f1" />
                                </div>
                                <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>Investigations</span>
                                <span style={{
                                    background: '#eff6ff', color: '#2563eb', fontSize: 12, fontWeight: 700,
                                    padding: '3px 10px', borderRadius: 12, border: '1px solid #bfdbfe', flexShrink: 0,
                                }}>{portfolioList.length}{rcaScope === 'mine' ? `/${rcas.length}` : ''}</span>
                                {/* Scope toggle */}
                                <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
                                    <button
                                        onClick={() => setRcaScope('all')}
                                        style={{
                                            padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                                            background: rcaScope === 'all' ? '#fff' : 'transparent',
                                            color: rcaScope === 'all' ? '#1e293b' : '#94a3b8',
                                            boxShadow: rcaScope === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                            transition: 'all 0.15s',
                                        }}
                                    >All</button>
                                    <button
                                        onClick={() => setRcaScope('mine')}
                                        style={{
                                            padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 4, border: 'none', cursor: 'pointer',
                                            background: rcaScope === 'mine' ? '#fff' : 'transparent',
                                            color: rcaScope === 'mine' ? '#7c3aed' : '#94a3b8',
                                            boxShadow: rcaScope === 'mine' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                            transition: 'all 0.15s',
                                        }}
                                    >My RCAs</button>
                                </div>
                            </div>
                            {/* Right: search + filter + new button — full width on mobile */}
                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                {/* Search — flex-1 so it fills available space */}
                                <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                                    <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                    <input
                                        value={portfolioSearch}
                                        onChange={e => setPortfolioSearch(e.target.value)}
                                        placeholder="Search investigations..."
                                        style={{
                                            padding: '7px 12px 7px 32px', fontSize: 13, border: '1px solid #e2e8f0',
                                            borderRadius: 8, width: '100%', outline: 'none', background: '#fff', color: '#1e293b',
                                        }}
                                    />
                                </div>
                                {/* Status filter */}
                                <select
                                    value={portfolioFilter}
                                    onChange={e => setPortfolioFilter(e.target.value)}
                                    style={{
                                        padding: '7px 10px', fontSize: 13, border: '1px solid #e2e8f0',
                                        borderRadius: 8, background: '#fff', color: '#1e293b', cursor: 'pointer', outline: 'none', flexShrink: 0,
                                    }}
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="draft">Draft</option>
                                    <option value="in_progress">In Progress</option>
                                    <option value="review">Review</option>
                                    <option value="closed">Closed</option>
                                </select>
                                {/* New Investigation — shorter label on mobile */}
                                <button
                                    onClick={onNewAssessment}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                                        background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8,
                                        fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                                    }}
                                >
                                    <Plus size={14} />
                                    <span className="hidden sm:inline">New Investigation</span>
                                    <span className="sm:hidden">New</span>
                                </button>
                            </div>
                        </div>

                        {/* Mobile: stacked cards — no sideways scrolling */}
                        <div className="sm:hidden">
                            {portfolioList.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '40px 24px', color: '#94a3b8' }}>
                                    <div style={{
                                        width: 56, height: 56, borderRadius: '50%', background: '#f1f5f9',
                                        margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <GitMerge size={24} color="#94a3b8" />
                                    </div>
                                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: '#64748b' }}>No investigations yet</div>
                                    <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                                        Run a Pareto analysis below to identify bad actors, then create an RCA investigation.
                                    </div>
                                </div>
                            ) : portfolioList.map((rca, idx) => {
                                const method = METHODS[rca.method] || { label: rca.method || 'RCA', color: '#64748b' };
                                const st = statusChip(rca.status);
                                const ai = assetTagMap[rca.asset_id];
                                const cc = ai?.criticality?.toUpperCase();
                                const critBg = cc === 'A' ? '#fef2f2' : cc === 'B' ? '#fffbeb' : cc === 'C' ? '#eff6ff' : '#f8fafc';
                                const critTc = cc === 'A' ? '#dc2626' : cc === 'B' ? '#d97706' : cc === 'C' ? '#2563eb' : '#64748b';
                                const critBc = cc === 'A' ? '#fecaca' : cc === 'B' ? '#fde68a' : cc === 'C' ? '#bfdbfe' : '#e2e8f0';
                                return (
                                    <div key={rca.id}
                                        onClick={() => navigate(`/analyze/rca/${rca.id}`)}
                                        style={{
                                            padding: '14px 16px', cursor: 'pointer',
                                            borderTop: idx === 0 ? 'none' : '1px solid #e2e8f0',
                                            background: idx % 2 === 1 ? '#fbfcfd' : '#fff',
                                        }}
                                    >
                                        {/* Title row */}
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <span style={{
                                                flexShrink: 0, minWidth: 22, height: 22, borderRadius: 6,
                                                background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b',
                                                fontSize: 11, fontWeight: 800, display: 'inline-flex',
                                                alignItems: 'center', justifyContent: 'center', padding: '0 5px', marginTop: 1,
                                            }}>{idx + 1}</span>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14, lineHeight: 1.35, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                    <span>{rca.title || 'Untitled Investigation'}</span>
                                                    {isUserCollaborator(rca) && (
                                                        <span style={{
                                                            fontSize: 9, fontWeight: 800, textTransform: 'uppercase' as const,
                                                            padding: '2px 7px', borderRadius: 4, letterSpacing: '0.05em',
                                                            background: '#ede9fe', color: '#7c3aed', border: '1px solid #c4b5fd',
                                                        }}>INVITED</span>
                                                    )}
                                                </div>
                                                {rca.problem_statement && (
                                                    <div style={{
                                                        fontSize: 12, color: '#94a3b8', lineHeight: 1.4, marginTop: 2,
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>
                                                        {rca.problem_statement}
                                                    </div>
                                                )}
                                            </div>
                                            <ArrowRight size={16} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 2 }} />
                                        </div>

                                        {/* Asset */}
                                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                            {ai ? (
                                                <>
                                                    <span style={{
                                                        display: 'inline-flex', padding: '2px 6px', borderRadius: 6,
                                                        background: critBg, color: critTc, border: `1px solid ${critBc}`,
                                                        fontSize: 10, fontWeight: 800, letterSpacing: '0.03em', flexShrink: 0,
                                                    }}>{cc}</span>
                                                    <span style={{ fontSize: 12, color: '#334155', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {ai.tag || ai.name}
                                                    </span>
                                                </>
                                            ) : rca.event_what ? (
                                                <>
                                                    <span style={{ display: 'inline-flex', padding: '2px 6px', borderRadius: 6, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', fontSize: 10, fontWeight: 800, flexShrink: 0 }}>MANUAL</span>
                                                    <span style={{ fontSize: 12, color: '#475569', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rca.event_what}</span>
                                                </>
                                            ) : (
                                                <span style={{ color: '#cbd5e1', fontSize: 11 }}>No asset linked</span>
                                            )}
                                        </div>

                                        {/* Badges + meta */}
                                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 10,
                                                fontSize: 11, fontWeight: 700, background: `${method.color}12`, color: method.color,
                                                border: `1px solid ${method.color}30`,
                                            }}>{method.label}</span>
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 10,
                                                fontSize: 11, fontWeight: 700, background: st.bg, color: st.color,
                                                border: `1px solid ${st.color}30`,
                                            }}>{st.label}</span>
                                            {rca.rca_category && (
                                                <span style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>
                                                    {rca.rca_category.replace('_', ' ')}
                                                </span>
                                            )}
                                            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                                                {rca.created_at ? new Date(rca.created_at).toLocaleDateString() : ''}
                                            </span>
                                        </div>

                                        {(rca as any).collaborators?.length > 0 && (
                                            <div style={{ marginTop: 8 }}>
                                                <AvatarStack collaborators={(rca as any).collaborators} max={3} size="sm" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Table (tablet / desktop) */}
                        <div className="hidden sm:block" style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                                        <th style={{ textAlign: 'left', padding: '10px 0 10px 16px', fontWeight: 600, color: '#64748b', fontSize: 12, width: 40 }}>
                                            #
                                        </th>
                                        {[
                                            { key: 'title', label: 'Investigation' },
                                            { key: 'asset_id', label: 'Asset' },
                                            { key: 'method', label: 'Method' },
                                            { key: 'status', label: 'Status' },
                                            { key: 'rca_category', label: 'Category' },
                                            { key: 'created_at', label: 'Created' },
                                        ].map(col => (
                                            <th key={col.key}
                                                onClick={() => setPortfolioSort(prev => ({
                                                    field: col.key,
                                                    dir: prev.field === col.key && prev.dir === 'asc' ? 'desc' : 'asc',
                                                }))}
                                                style={{
                                                    textAlign: 'left', padding: '10px 16px', fontWeight: 600,
                                                    color: '#64748b', cursor: 'pointer', fontSize: 12,
                                                    letterSpacing: '0.03em', userSelect: 'none',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {col.label}
                                                {portfolioSort.field === col.key && (
                                                    portfolioSort.dir === 'asc'
                                                        ? <ChevronUp size={12} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />
                                                        : <ChevronDown size={12} style={{ display: 'inline', marginLeft: 4, verticalAlign: 'middle' }} />
                                                )}
                                            </th>
                                        ))}
                                        <th style={{ textAlign: 'right', padding: '10px 16px', fontWeight: 600, color: '#64748b', fontSize: 12 }}>
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {portfolioList.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} style={{ textAlign: 'center', padding: '48px 24px', color: '#94a3b8' }}>
                                                <div style={{
                                                    width: 56, height: 56, borderRadius: '50%', background: '#f1f5f9',
                                                    margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                }}>
                                                    <GitMerge size={24} color="#94a3b8" />
                                                </div>
                                                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: '#64748b' }}>No investigations yet</div>
                                                <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                                                    Run a Pareto analysis below to identify bad actors,<br />then create an RCA investigation.
                                                </div>
                                            </td>
                                        </tr>
                                    ) : portfolioList.map((rca, idx) => {
                                        const method = METHODS[rca.method] || { label: rca.method || 'RCA', color: '#64748b' };
                                        const { label: statusLabel, color: statusColor, bg: statusBg } = statusChip(rca.status);
                                        const rowBg = idx % 2 === 1 ? '#fbfcfd' : '#fff';
                                        return (
                                            <tr key={rca.id}
                                                onClick={() => navigate(`/analyze/rca/${rca.id}`)}
                                                style={{
                                                    cursor: 'pointer', borderBottom: '1px solid #e2e8f0',
                                                    background: rowBg, transition: 'background .15s',
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                                                onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                                            >
                                                <td style={{ padding: '14px 0 14px 16px', color: '#94a3b8', fontSize: 12, fontWeight: 800, verticalAlign: 'top' }}>
                                                    {idx + 1}
                                                </td>
                                                <td style={{ padding: '14px 16px', maxWidth: 320 }}>
                                                    <div style={{ fontWeight: 600, color: '#1e293b', lineHeight: 1.4, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        {rca.title || 'Untitled Investigation'}
                                                        {isUserCollaborator(rca) && (
                                                            <span style={{
                                                                fontSize: 9, fontWeight: 800, textTransform: 'uppercase' as const,
                                                                padding: '2px 7px', borderRadius: 4, letterSpacing: '0.05em',
                                                                background: '#ede9fe', color: '#7c3aed', border: '1px solid #c4b5fd',
                                                                flexShrink: 0,
                                                            }}>INVITED</span>
                                                        )}
                                                    </div>
                                                    {rca.problem_statement && (
                                                        <div style={{
                                                            fontSize: 12, color: '#94a3b8', lineHeight: 1.4,
                                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300,
                                                        }}>
                                                            {rca.problem_statement}
                                                        </div>
                                                    )}
                                                    {(rca as any).collaborators?.length > 0 && (
                                                        <div style={{ marginTop: 4 }}>
                                                            <AvatarStack collaborators={(rca as any).collaborators} max={3} size="sm" />
                                                        </div>
                                                    )}
                                                </td>
                                                {/* Asset column */}
                                                <td style={{ padding: '14px 12px', whiteSpace: 'nowrap' }}>
                                                    {(() => {
                                                        const ai = assetTagMap[rca.asset_id];
                                                        if (!ai) {
                                                            if (!rca.event_what) return <span style={{ color: '#cbd5e1', fontSize: 11 }}>â€”</span>;
                                                            return (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <span style={{ display: 'inline-flex', padding: '2px 6px', borderRadius: 6, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', fontSize: 10, fontWeight: 800 }}>MANUAL</span>
                                                                    <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>{rca.event_what}</span>
                                                                </div>
                                                            );
                                                        }
                                                        const cc = ai.criticality?.toUpperCase();
                                                        const bg = cc === 'A' ? '#fef2f2' : cc === 'B' ? '#fffbeb' : cc === 'C' ? '#eff6ff' : '#f8fafc';
                                                        const tc = cc === 'A' ? '#dc2626' : cc === 'B' ? '#d97706' : cc === 'C' ? '#2563eb' : '#64748b';
                                                        const bc = cc === 'A' ? '#fecaca' : cc === 'B' ? '#fde68a' : cc === 'C' ? '#bfdbfe' : '#e2e8f0';
                                                        return (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                <span style={{
                                                                    display: 'inline-flex', padding: '2px 6px', borderRadius: 6,
                                                                    background: bg, color: tc, border: `1px solid ${bc}`,
                                                                    fontSize: 10, fontWeight: 800, letterSpacing: '0.03em',
                                                                }}>{cc}</span>
                                                                <span style={{ fontSize: 12, color: '#334155', fontWeight: 500 }}>
                                                                    {ai.tag || ai.name}
                                                                </span>
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                <td style={{ padding: '14px 16px' }}>
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                                        padding: '4px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                        background: `${method.color}12`, color: method.color,
                                                        border: `1px solid ${method.color}30`,
                                                    }}>
                                                        {method.label}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '14px 16px' }}>
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                                        padding: '4px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                                                        background: statusBg, color: statusColor,
                                                        border: `1px solid ${statusColor}30`,
                                                    }}>
                                                        {statusLabel}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '14px 16px', color: '#475569', fontSize: 12, textTransform: 'capitalize' }}>
                                                    {(rca.rca_category || 'â€”').replace('_', ' ')}
                                                </td>
                                                <td style={{ padding: '14px 16px', color: '#64748b', fontSize: 12, whiteSpace: 'nowrap' }}>
                                                    {rca.created_at ? new Date(rca.created_at).toLocaleDateString() : 'â€”'}
                                                </td>
                                                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                                    <button
                                                        onClick={e => { e.stopPropagation(); navigate(`/analyze/rca/${rca.id}`); }}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: 5,
                                                            padding: '5px 12px', background: '#eff6ff', color: '#2563eb',
                                                            border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 12,
                                                            fontWeight: 600, cursor: 'pointer',
                                                        }}
                                                    >
                                                        <ArrowRight size={12} /> Open
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ── Bad actors — one quiet row that OPENS THE TOOL ──────────────
                        This used to be an inline collapsible holding the whole Pareto tool
                        (explainer + 5-control filter card + chart + 4 stat tiles + 20-row
                        table). Worse, it defaulted to EXPANDED when you had no
                        investigations — the emptiest user got the heaviest page. The tool is
                        unchanged; it now lives in a sheet you open when you want it. */}
                    {onParetoDataChange && (
                        <button
                            onClick={() => setParetoOpen(true)}
                            className="w-full flex items-center gap-3 px-4 py-3.5 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all text-left"
                        >
                            <span className="w-9 h-9 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                                <BarChart3 size={16} className="text-red-500" />
                            </span>
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-semibold text-slate-800">Bad actors</span>
                                <span className="block text-xs text-slate-400 truncate">
                                    Find the few assets driving most of your cost
                                </span>
                            </span>
                            {paretoData.length > 0 && (
                                <span className="shrink-0 text-[11px] font-semibold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                                    {paretoData.length}
                                </span>
                            )}
                            <ChevronRight size={16} className="text-slate-300 shrink-0" />
                        </button>
                    )}
                </>
            )}

            {/* Bad actors sheet — the Pareto tool, on demand */}
            {onParetoDataChange && (
                <Drawer
                    open={paretoOpen}
                    onClose={() => setParetoOpen(false)}
                    title="Bad actors"
                    subtitle="Which assets drive 80% of your cost, downtime, or failures"
                    width="xl"
                >
                    <div className="p-4">
                        <ParetoAnalysisTab
                            onDrillDown={setDrillAsset}
                            onParetoDataChange={onParetoDataChange}
                            onInvestigate={rca => { setParetoOpen(false); handleInvestigateFromPareto(rca); }}
                        />
                    </div>
                </Drawer>
            )}



            {/* Asset Drill-Down Drawer (from Pareto bar click) */}
            {drillAsset && (
                <AssetDrillDrawer
                    asset={drillAsset}
                    criteria={paretoCriteria}
                    onClose={() => setDrillAsset(null)}
                    onInitiateRCA={handleDrillInitiateRCA}
                    onCreateFMEA={handleDrillCreateFMEA}
                />
            )}


            {/* Pareto section moved to Step 1 above */}
        </div>
    );
};

export default RCATab;
