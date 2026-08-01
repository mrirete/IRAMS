/**
 * QuickWins — the action strip that sits directly under each chart.
 *
 * A figure states a magnitude; it does not tell anyone what to touch. This is
 * the bridge: for each section, the two or three things worth doing about what
 * the chart just showed, each with the number that justifies it and a button
 * into the module where the work happens.
 *
 * "Go" is a guided handoff, not a drop-off — the same contract the briefing's
 * missions use: the win travels in sessionStorage and MissionGuide (mounted in
 * AppLayout) keeps the Specialist's walkthrough on screen inside the
 * destination module until it is handled or dismissed.
 *
 * Items are computed deterministically in lib/assessmentQuickWins; nothing here
 * derives a number.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ChevronRight } from 'lucide-react';
import { MISSION_HANDOFF_KEY, type ActiveMission } from '../../lib/briefingParse';
import type { QuickWin } from '../../lib/assessmentQuickWins';

interface Props {
    wins: QuickWin[];
    /** Scopes mission progress for the handoff (the assessment's data date). */
    briefingKey: string;
    formatCurrency: (n: number) => string;
}

export const QuickWins: React.FC<Props> = ({ wins, briefingKey, formatCurrency }) => {
    const navigate = useNavigate();
    if (!wins.length) return null;

    const go = (w: QuickWin, i: number) => {
        if (!w.path) return;
        const handoff: ActiveMission = {
            briefingKey: `${briefingKey}:${w.section}`,
            index: i,
            text: w.text,
            path: w.path,
            label: w.label ?? 'the module',
            tags: w.tags,
        };
        try { sessionStorage.setItem(MISSION_HANDOFF_KEY, JSON.stringify(handoff)); } catch { /* private mode */ }
        navigate(w.path);
    };

    return (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 print:bg-white">
            <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
                <Zap size={12} className="text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-[0.07em] text-amber-700">Quick wins</span>
                <span className="text-[10px] text-amber-600/70">— what to do about this chart</span>
            </div>
            <ul className="divide-y divide-amber-100">
                {wins.map((w, i) => (
                    <li key={w.id} className="flex items-start gap-2.5 px-3 py-2.5">
                        <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                <span className="text-[12.5px] font-semibold leading-snug text-slate-800">{w.text}</span>
                                {w.value != null && w.value > 0 && (
                                    <span className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10.5px] font-bold tabular-nums text-emerald-700">
                                        {formatCurrency(w.value)}
                                    </span>
                                )}
                            </div>
                            <p className="mt-0.5 text-[11.5px] leading-snug text-slate-500">{w.basis}</p>
                        </div>
                        {w.path && w.label && (
                            <button
                                onClick={() => go(w, i)}
                                title={`The Specialist guides you through this in ${w.label}`}
                                className="no-print mt-px inline-flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-amber-200 bg-white px-2 text-[11px] font-semibold text-amber-700 transition-colors hover:border-amber-400 hover:bg-amber-100"
                            >
                                {w.label} <ChevronRight size={12} />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default QuickWins;
