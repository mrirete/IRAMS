import React from 'react';
import { CheckCircle } from 'lucide-react';
import { PmFixTab, PmReadiness, readinessTone } from '../services/pmReadiness';

const TONE = {
    green: { chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', ring: '#10b981', text: 'text-emerald-700' },
    amber: { chip: 'bg-amber-100 text-amber-700 border-amber-200', ring: '#f59e0b', text: 'text-amber-700' },
    red: { chip: 'bg-red-100 text-red-700 border-red-200', ring: '#ef4444', text: 'text-red-700' },
};

const unmetSummary = (r: PmReadiness) => {
    const miss = r.items.filter(it => !it.met);
    return miss.length === 0
        ? 'Plan complete — the generated order lands as Planned.'
        : `Missing: ${miss.map(it => it.label + (it.severity === 'required' ? '' : ' (recommended)')).join(', ')}`;
};

/** Compact "86%" pill for list rows and the Generate dialog. */
export const PmReadinessChip: React.FC<{ readiness: PmReadiness; className?: string }> = ({ readiness, className = '' }) => {
    const tone = TONE[readinessTone(readiness)];
    return (
        <span
            className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border tabular-nums ${tone.chip} ${className}`}
            title={`Ready to generate: ${readiness.score}%. ${unmetSummary(readiness)}`}
        >
            {readiness.score}%<span className="font-medium opacity-80">plan</span>
        </span>
    );
};

/**
 * Header badge for the PM detail: score ring, the headline, and each missing
 * item as a link into the tab where it is fixed.
 */
export const PmReadinessBadge: React.FC<{ readiness: PmReadiness; onFix?: (tab: PmFixTab) => void }> = ({ readiness, onFix }) => {
    const toneKey = readinessTone(readiness);
    const tone = TONE[toneKey];
    const missing = readiness.items.filter(it => !it.met);
    const r = 15, c = 2 * Math.PI * r;
    return (
        <div className="flex items-start gap-2.5 min-w-0" title={unmetSummary(readiness)}>
            <div className="relative w-9 h-9 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-9 h-9 -rotate-90">
                    <circle cx="18" cy="18" r={r} fill="none" stroke="#e2e8f0" strokeWidth="3" />
                    <circle cx="18" cy="18" r={r} fill="none" stroke={tone.ring} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${(readiness.score / 100) * c} ${c}`} />
                </svg>
                <span className={`absolute inset-0 flex items-center justify-center text-[9px] font-black tabular-nums ${tone.text}`}>{readiness.score}</span>
            </div>
            <div className="min-w-0">
                <div className="text-[11px] sm:text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    Ready to generate
                    <span className={`tabular-nums ${tone.text}`}>{readiness.score}%</span>
                    {missing.length === 0 && <CheckCircle size={12} className="text-emerald-500" />}
                    {readiness.isHighCriticality && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Crit {readiness.criticality}</span>
                    )}
                </div>
                {missing.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {missing.map(it => (
                            <button
                                key={it.id}
                                type="button"
                                onClick={() => onFix?.(readiness.fixTab[it.id] || 'details')}
                                title={it.hint}
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-colors ${it.severity === 'required'
                                    ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}
                            >
                                {it.severity === 'required' ? '' : '○ '}{it.label}
                            </button>
                        ))}
                    </div>
                ) : (
                    <p className="text-[10px] text-slate-500 mt-0.5">The generated order arrives as Planned.</p>
                )}
            </div>
        </div>
    );
};
