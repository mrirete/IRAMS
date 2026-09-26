/**
 * VerdictLine — the one sentence a first-time visitor needs, with its next
 * step as a button. The sentence comes from lib/predict/verdict, built from
 * the same numbers the tabs show. Full width on the Now tab; compact in the
 * side rail on every tab.
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, Eye, ArrowRight } from 'lucide-react';
import type { Verdict } from '../../lib/predict/verdict';

const TONE = {
    ok: { box: 'bg-emerald-50 border-emerald-200 text-emerald-900', icon: <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" /> },
    watch: { box: 'bg-amber-50 border-amber-200 text-amber-900', icon: <Eye size={16} className="text-amber-600 shrink-0 mt-0.5" /> },
    act: { box: 'bg-red-50 border-red-200 text-red-900', icon: <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" /> },
};
const ACTION_LABEL: Record<Verdict['action'], string | null> = {
    take_reading: 'Request a reading',
    plan_work: 'Go to Forecast',
    set_up: 'Set up monitoring',
    none: null,
};

export const VerdictLine: React.FC<{ verdict: Verdict; onAction?: () => void; compact?: boolean }> = ({ verdict, onAction, compact }) => {
    const t = TONE[verdict.tone];
    const label = ACTION_LABEL[verdict.action];
    return (
        <div className={`flex items-start gap-2.5 rounded-xl border ${t.box} ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`} role="status" data-testid="predict-verdict">
            {t.icon}
            <div className="min-w-0 flex-1">
                <p className={`${compact ? 'text-[12px]' : 'text-sm'} leading-relaxed font-medium`}>{verdict.text}</p>
                {label && onAction && (
                    <button onClick={onAction} className={`mt-1.5 inline-flex items-center gap-1 ${compact ? 'text-[11px]' : 'text-xs'} font-bold underline-offset-2 hover:underline`}>
                        {label} <ArrowRight size={12} />
                    </button>
                )}
            </div>
        </div>
    );
};

export default VerdictLine;
