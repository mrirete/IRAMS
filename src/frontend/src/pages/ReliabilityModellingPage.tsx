/**
 * ReliabilityModellingPage — Standalone page for the Reliability Modelling sub-module.
 *
 * Wraps the existing ReliabilityModellingDivision component with a proper page
 * header and layout. Part of the Reliability Tier (ISO 14224 · MIL-HDBK-338).
 *
 * Route: /reliability-modelling
 * Sidebar: Reliability Tier → Reliability Modelling
 *
 * P1.3 Fix: The "Analyze & Investigate" button now passes contextual state
 * (asset ID, system metrics) via query parameters to the Analyze page,
 * enabling direct RCA/Defect Elimination workflow initialization.
 */
import React, { useState, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowRight, Search, HelpCircle, Database, HelpCircle as Question, Wrench } from 'lucide-react';
import ReliabilityModellingDivision from '../components/analyze/ReliabilityModellingDivision';
import { Modal } from '../eam/components/ui';

/** Drill-through seed passed via navigation state (e.g. Metrics bad actor → Fit Weibull). */
interface ModellingSeed {
    asset: { id: string; name: string; tag: string; criticality: string } | null;
    tab?: 'ram' | 'weibull' | 'spares' | 'rbd' | 'montecarlo';
}

const TOOL_IDS = ['ram', 'weibull', 'spares', 'rbd', 'montecarlo'] as const;
type ToolId = typeof TOOL_IDS[number];

interface ModellingContext {
    asset: { id: string; tag: string; name: string } | null;
    results: Record<string, any>;
    activeTab: string | null;
}

/** The loop the module exists to close — shown in the "How this works" popup. */
const HOW_STEPS: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; body: string }[] = [
    {
        icon: Database,
        title: 'Your corrective work orders are the data',
        body: 'Every closed corrective work order is one failure event: when it happened, how long the asset was down, what it cost. No separate data entry — if the work is being recorded, the models already have what they need.',
    },
    {
        icon: Question,
        title: 'Pick an asset and ask one question',
        body: 'Start here shows which assets your history says are worth studying and which model their data can actually carry. Or start from the question — when to change it out, whether a PM pays, how many spares, which item is the weak link.',
    },
    {
        icon: Wrench,
        title: 'The answer leaves as work',
        body: 'A replacement age becomes a PM program. A stocking number becomes an inventory min level. A failure pattern becomes an RCM strategy or an RCA. Each study is saved, versioned and reviewable — so the decision has a record behind it.',
    },
];

const ReliabilityModellingPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const seed = (location.state as { seed?: ModellingSeed } | null)?.seed ?? null;
    const [context, setContext] = useState<ModellingContext | null>(null);
    const [showHow, setShowHow] = useState(false);

    // Full-page tool mode (?tool=weibull): each tool is its own page —
    // the bare route is a launcher (study records + tool cards).
    const [searchParams, setSearchParams] = useSearchParams();
    const toolParam = searchParams.get('tool');
    const tool: ToolId | null = TOOL_IDS.includes(toolParam as ToolId) ? (toolParam as ToolId) : null;
    const handleToolChange = useCallback((t: ToolId | null) => {
        setSearchParams(t ? { tool: t } : {}, { replace: false });
    }, [setSearchParams]);

    const handleContextChange = useCallback((ctx: ModellingContext) => {
        setContext(ctx);
    }, []);

    // Build contextual navigation URL with query params
    const handleAnalyzeNavigate = useCallback(() => {
        const params = new URLSearchParams();

        // Pass asset context if available
        if (context?.asset?.id) {
            params.set('asset', context.asset.id);
        }

        // Pass the analysis tab to open (default to 'rca' for investigation)
        params.set('tab', 'rca');

        // Pass key metrics as context for the Analyze page
        if (context?.results) {
            if (context.results.ao) params.set('systemAo', String(context.results.ao));
            if (context.results.mtbf) params.set('mtbf', String(context.results.mtbf));
            if (context.results.mttr) params.set('mttr', String(context.results.mttr));
        }

        // Pass the source module for breadcrumb/back-nav
        params.set('from', 'reliability-modelling');

        const queryString = params.toString();
        navigate(`/analyze${queryString ? `?${queryString}` : ''}`);
    }, [navigate, context]);

    return (
        <div className="space-y-5 px-3 py-4 sm:p-6 max-w-[1760px] mx-auto">
            {/* ── Page Header ─────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-primary-500 to-primary-700" />
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 font-sans tracking-tight">Reliability Modelling</h1>
                    </div>
                    <p className="text-slate-500 text-xs sm:text-sm mt-1.5 ml-4 max-w-3xl">
                        Turn your work-order failure history into maintenance decisions — when to change a part out,
                        whether a PM interval is worth doing, how many spares to hold, and which item takes the system down.
                    </p>
                    <button
                        onClick={() => setShowHow(true)}
                        className="ml-4 mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 hover:text-primary-700 transition-colors"
                    >
                        <HelpCircle size={13} /> How this works
                    </button>
                </div>
                <div className="flex gap-2 shrink-0">
                    {context?.asset && (
                    <button
                        onClick={handleAnalyzeNavigate}
                        className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-600 rounded-control text-xs sm:text-sm transition-all border border-slate-200 shadow-sm hover:shadow group"
                        title={`Investigate ${context.asset.tag} — RCA & Defect Elimination`}
                    >
                        <Search size={14} className="text-slate-400 group-hover:text-primary-600 transition-colors" />
                        <span>Investigate in RCA</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-primary-50 text-primary-600 rounded-md border border-primary-200">
                            {context.asset.tag}
                        </span>
                        <ArrowRight size={15} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                    )}
                </div>
            </div>

            {/* ── Division Content ────────────────────────────── */}
            <ReliabilityModellingDivision
                onContextChange={handleContextChange}
                seed={seed}
                tool={tool}
                onToolChange={handleToolChange}
            />

            {/* ── How this works — purpose & outcome, in three steps ── */}
            <Modal open={showHow} onClose={() => setShowHow(false)} title="How reliability modelling works" size="lg">
                <div className="space-y-4">
                    <p className="text-sm text-slate-600 leading-relaxed">
                        Every model on this page is built from work you already record. Nothing here is a forecast
                        pulled out of the air — it is your own failure history, read back to you as a decision.
                    </p>
                    {HOW_STEPS.map((step, i) => (
                        <div key={step.title} className="flex items-start gap-3">
                            <span className="w-8 h-8 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0 font-bold text-sm">
                                {i + 1}
                            </span>
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                                    <step.icon size={14} className="text-slate-400" /> {step.title}
                                </p>
                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">{step.body}</p>
                            </div>
                        </div>
                    ))}
                    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-3">
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                            <strong className="text-slate-600">What counts as a failure:</strong> a corrective work order,
                            or any work order carrying a failure mode code. The same definition is used here, on the
                            Metrics scoreboard and in Reports — so these numbers cannot disagree with those.
                            Methods follow ISO 14224 and SMRP 7th edition.
                        </p>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ReliabilityModellingPage;
