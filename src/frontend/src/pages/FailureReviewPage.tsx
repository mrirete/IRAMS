/**
 * FailureReviewPage — the FRACAS queue as a first-class working surface.
 *
 * The queue previously lived only embedded (dashboard Reliability hat, a tab on
 * Reliability Metrics). Coding failures is a sit-down job, so it earns a full
 * page: viewport-locked shell, the queue as the whole body, and explicit
 * backlinks both ways — Dashboard ← here → Reliability Metrics / Analyze·RCA;
 * each queue row already deep-links to its Work Order and per-asset RCA.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ClipboardCheck, Gauge, Microscope } from 'lucide-react';
import { FailureReviewQueue } from '../components/analyze/FailureReviewQueue';
import { useAuth } from '../eam/contexts/AuthContext';

export const FailureReviewPage: React.FC = () => {
    const navigate = useNavigate();
    const { user, profile } = useAuth() as any;
    const [count, setCount] = useState(0);

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
                        {count > 0 && (
                            <span className="text-[10px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full leading-none">{count}</span>
                        )}
                    </h1>
                    <p className="hidden sm:block text-xs text-slate-500">FRACAS — code every failure event, then send the bad ones to RCA.</p>
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

            {/* The queue is the page — rows deep-link to their WO and per-asset RCA */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                <FailureReviewQueue
                    currentUser={user?.username || profile?.username || user?.email || 'engineer'}
                    onCountChange={setCount}
                />
            </div>
        </div>
    );
};

export default FailureReviewPage;
