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
import { useNavigate, useLocation } from 'react-router-dom';
import { Cpu, ArrowRight, Search } from 'lucide-react';
import ReliabilityModellingDivision from '../components/analyze/ReliabilityModellingDivision';

/** Drill-through seed passed via navigation state (e.g. Metrics bad actor → Fit Weibull). */
interface ModellingSeed {
    asset: { id: string; name: string; tag: string; criticality: string } | null;
    tab?: 'ram' | 'weibull' | 'spares' | 'rbd' | 'montecarlo';
}

interface ModellingContext {
    asset: { id: string; tag: string; name: string } | null;
    results: Record<string, any>;
    activeTab: string;
}

const ReliabilityModellingPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const seed = (location.state as { seed?: ModellingSeed } | null)?.seed ?? null;
    const [context, setContext] = useState<ModellingContext | null>(null);

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
                    <p className="text-slate-500 text-xs sm:text-sm mt-1.5 ml-4">
                        Data-Driven Asset Intelligence — RBD, RAM, Weibull, Spares Demand · Live WO Integration · ISO 14224
                    </p>
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
            <ReliabilityModellingDivision onContextChange={handleContextChange} seed={seed} />
        </div>
    );
};

export default ReliabilityModellingPage;
