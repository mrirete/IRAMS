/**
 * ReliabilityHomePage — prompt-first landing for the Reliability Tier.
 *
 * One calm question — "What do you want to achieve today?" — with the
 * Reliability Specialist behind it, plus intent chips that route
 * DETERMINISTICALLY (they work even if the AI is unavailable) and a quiet
 * "continue where you left off" strip. The landing is an offer, never a gate:
 * the sidebar stays available and nothing here blocks a task-driven user.
 * Mobile-first: single column, large touch targets, launcher clears the
 * bottom tab bar.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Send, Search, Gauge, GitBranch, Target, TrendingUp, ArrowRight, FolderOpen } from 'lucide-react';
import ReliabilitySpecialist from '../components/analyze/ReliabilitySpecialist';
import { analyzeService, type RCAInvestigation } from '../eam/services/AnalyzeService';
import { useAuth } from '../eam/contexts/AuthContext';

const INTENTS: { icon: React.ReactNode; label: string; hint: string; path: string }[] = [
    { icon: <Search size={15} />, label: 'Investigate a failure', hint: 'Start a root cause analysis', path: '/analyze/rca/new' },
    { icon: <TrendingUp size={15} />, label: 'Find my bad actors', hint: 'Pareto — what drives 80% of cost', path: '/analyze' },
    { icon: <Gauge size={15} />, label: 'Check asset health', hint: 'KPIs, Golden Spot & Success Rate', path: '/reliability-metrics' },
    { icon: <GitBranch size={15} />, label: 'Model reliability', hint: 'Weibull, RBD, Monte Carlo', path: '/reliability-modelling' },
    { icon: <Target size={15} />, label: 'Decide a strategy', hint: 'RCM decision logic', path: '/rcm' },
];

const LOOP = [
    { label: 'Measure', path: '/reliability-metrics' },
    { label: 'Diagnose', path: '/analyze' },
    { label: 'Model', path: '/reliability-modelling' },
    { label: 'Decide', path: '/rcm' },
    { label: 'Forecast', path: '/predict' },
];

export const ReliabilityHomePage: React.FC = () => {
    const navigate = useNavigate();
    const { profile } = useAuth();
    const [question, setQuestion] = useState('');
    const [seededPrompt, setSeededPrompt] = useState<string | undefined>(undefined);
    const [openWork, setOpenWork] = useState<RCAInvestigation[]>([]);

    useEffect(() => {
        analyzeService.getRCAInvestigations().then(rcas =>
            setOpenWork(rcas.filter(r => r.status !== 'closed').slice(0, 3)),
        );
    }, []);

    const ask = () => {
        if (!question.trim()) return;
        setSeededPrompt(question.trim()); // opens the Specialist drawer, pre-seeded
        setQuestion('');
    };

    const firstName = (profile?.username || '').split(/[._\s]/)[0] || '';

    return (
        <div className="min-h-[70vh] flex flex-col">
            {/* ── Centered ask ─────────────────────────────────── */}
            <div className="flex-1 flex flex-col items-center justify-center px-4 py-10 sm:py-16">
                <div className="w-full max-w-2xl text-center">
                    <div className="mx-auto mb-4 flex items-center justify-center w-12 h-12 rounded-2xl bg-violet-100 text-violet-600">
                        <Bot size={22} />
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                        What do you want to achieve today{firstName ? `, ${firstName}` : ''}?
                    </h1>
                    <p className="mt-2 text-sm text-slate-400">
                        Your Reliability Specialist is on hand — or jump straight to the work.
                    </p>

                    {/* Ask box */}
                    <div className="mt-6 flex items-center gap-2 bg-white border border-slate-300 rounded-2xl shadow-sm px-4 py-1.5 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-500/15 transition-all">
                        <input
                            value={question}
                            onChange={e => setQuestion(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') ask(); }}
                            placeholder="Ask anything — “why does P-101 keep failing?”"
                            className="flex-1 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent outline-none"
                        />
                        <button
                            onClick={ask}
                            disabled={!question.trim()}
                            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 transition-all"
                            title="Ask the Reliability Specialist"
                        >
                            <Send size={15} />
                        </button>
                    </div>

                    {/* Intent chips — deterministic routes, work with AI down */}
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {INTENTS.map(i => (
                            <button
                                key={i.label}
                                onClick={() => navigate(i.path)}
                                title={i.hint}
                                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-700 hover:shadow-sm transition-all"
                            >
                                <span className="text-slate-400">{i.icon}</span>{i.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Continue where you left off ──────────────────── */}
            {openWork.length > 0 && (
                <div className="max-w-2xl w-full mx-auto px-4 pb-6">
                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                        <FolderOpen size={11} /> Continue where you left off
                    </div>
                    <div className="space-y-1.5">
                        {openWork.map(r => (
                            <button
                                key={r.id}
                                onClick={() => navigate(`/analyze/rca/${r.id}`)}
                                className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-left hover:border-violet-300 hover:shadow-sm transition-all"
                            >
                                <span className="min-w-0">
                                    <span className="block text-xs font-bold text-slate-800 truncate">{r.title}</span>
                                    <span className="block text-[10px] text-slate-400">RCA investigation · {r.status?.replace('_', ' ')}</span>
                                </span>
                                <ArrowRight size={14} className="shrink-0 text-slate-300" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── The reliability loop, one quiet strip ────────── */}
            <div className="max-w-2xl w-full mx-auto px-4 pb-10">
                <div className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-400 flex-wrap">
                    {LOOP.map((s, i) => (
                        <React.Fragment key={s.label}>
                            {i > 0 && <span className="text-slate-200">→</span>}
                            <button onClick={() => navigate(s.path)} className="px-2 py-1 rounded-lg hover:text-violet-600 hover:bg-violet-50 transition-colors">
                                {s.label}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {/* The Specialist call-up (renders its own launcher + drawer) */}
            <ReliabilitySpecialist
                activeDivision={'rca' as any}
                contextAsset={null}
                paretoData={[]}
                paretoCriteria="cost"
                initialPrompt={seededPrompt}
            />
        </div>
    );
};

export default ReliabilityHomePage;
