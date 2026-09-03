/**
 * FailureReviewPage — the FRACAS queue as a first-class working surface.
 *
 * Coding failures is a sit-down job: viewport-locked shell, a stat band that
 * shows the debt (unreviewed / uncoded) and why it matters, then the queue
 * filling the rest of the screen. Backlinks in every direction — Dashboard ←
 * here → Reliability Metrics / Analyze·RCA; each queue row deep-links to its
 * Work Order and per-asset RCA. The dashboard hat and the Reliability Metrics
 * tab both lead HERE; nothing embeds the working queue any more.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ClipboardCheck, Gauge, Microscope, AlertTriangle, ShieldCheck } from 'lucide-react';
import { FailureReviewQueue } from '../components/analyze/FailureReviewQueue';
import { useAuth } from '../eam/contexts/AuthContext';

export const FailureReviewPage: React.FC = () => {
    const navigate = useNavigate();
    const { user, profile } = useAuth() as any;
    const [stats, setStats] = useState<{ unreviewed: number; uncoded: number } | null>(null);

    return (
        <div className="ers-page-record w-full flex flex-col gap-3 md:gap-4 h-[calc(100dvh-11rem)] md:h-[calc(100vh-7rem)] min-h-0">
            {/* Header — identity + the round trips */}
            <div className="flex flex-wrap items-center gap-2 md:gap-3 flex-none">
                <button onClick={() => navigate('/dashboard')} aria-label="Back to dashboard" title="Back to dashboard"
                    className="md:hidden -ml-2 p-2 rounded-lg text-slate-500 hover:bg-slate-100 active:scale-95 transition"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="min-w-0 mr-auto">
                    <h1 className="text-lg md:text-xl font-bold text-slate-900 flex items-center gap-2">
                        <ClipboardCheck size={20} className="text-blue-600" /> Failure Review
                    </h1>
                    <p className="hidden sm:block text-xs text-slate-500">Confirm mode + cause, mark Reviewed — repeat offenders go to RCA.</p>
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2">
                    <button onClick={() => navigate('/reliability-metrics')}
                        className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:border-slate-400 transition"
                    >
                        <Gauge size={14} /> <span className="hidden xs:inline">Reliability Metrics</span><ArrowRight size={12} className="hidden xs:block" />
                    </button>
                    <button onClick={() => navigate('/analyze')}
                        className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:border-slate-400 transition"
                    >
                        <Microscope size={14} /> <span className="hidden xs:inline">Analyze · RCA</span><ArrowRight size={12} className="hidden xs:block" />
                    </button>
                </div>
            </div>

            {/* Stat band — the debt, and why clearing it matters */}
            <div className="grid grid-cols-2 gap-2 md:gap-3 lg:flex flex-none">
                <div className="bg-white px-3 py-2.5 rounded-card shadow-card border border-slate-200 lg:flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="p-1 rounded-md bg-blue-50 text-blue-600 flex-shrink-0"><ClipboardCheck size={16} /></span>
                        <span className="text-[11px] font-medium text-slate-500 truncate">Unreviewed Events</span>
                    </div>
                    <div className="text-xl font-bold text-slate-900 leading-none mt-2">{stats ? stats.unreviewed : '…'}</div>
                </div>
                <div className="bg-white px-3 py-2.5 rounded-card shadow-card border border-slate-200 lg:flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="p-1 rounded-md bg-amber-50 text-amber-600 flex-shrink-0"><AlertTriangle size={16} /></span>
                        <span className="text-[11px] font-medium text-slate-500 truncate">Uncoded</span>
                    </div>
                    <div className="flex items-end justify-between gap-2 mt-2">
                        <span className={`text-xl font-bold leading-none ${stats && stats.uncoded > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{stats ? stats.uncoded : '…'}</span>
                        <span className="text-[10px] text-slate-500 whitespace-nowrap">data-quality debt</span>
                    </div>
                </div>
                <div className="hidden lg:flex lg:flex-[2] items-center gap-2.5 bg-emerald-50/60 border border-emerald-100 rounded-card px-4 py-2.5">
                    <ShieldCheck size={18} className="text-emerald-600 flex-shrink-0" />
                    <p className="text-xs text-emerald-800 m-0">
                        Confirmed coding is what MTBF, the bad-actor Pareto and the Specialist's advice stand on —
                        an empty queue means every number downstream is trusted.
                    </p>
                </div>
            </div>

            {/* The queue is the page — rows deep-link to their WO and per-asset RCA */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                <FailureReviewQueue
                    variant="page"
                    currentUser={user?.username || profile?.username || user?.email || 'engineer'}
                    onStatsChange={setStats}
                />
            </div>
        </div>
    );
};

export default FailureReviewPage;
