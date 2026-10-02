/**
 * AssessLayout — the one frame every Assess & Improve page sits in.
 *
 * The shell's <main> is already the scroll container and carries the outer
 * padding, so pages here add neither; they centre on the record width
 * (ers-page-record, 72rem) so the content keeps breathing room on both sides
 * of a wide screen instead of running sidebar-to-edge.
 *
 * StatStrip replaces the row of five or six separate KPI boxes: one quiet
 * card, figures divided by hairlines, zeros muted, and a figure that is
 * also a filter says so by being a button.
 */
import React from 'react';

export const ASSESS_PRIMARY_BTN =
    'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const ASSESS_SECONDARY_BTN =
    'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 text-sm font-semibold transition-colors disabled:opacity-40';
export const ASSESS_INPUT =
    'w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100';

export const AssessPage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="ers-page-record w-full space-y-6 pb-16 animate-in fade-in duration-300">{children}</div>
);

export const AssessHeader: React.FC<{
    title: string;
    subtitle?: React.ReactNode;
    actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between pt-2">
        <div className="min-w-0">
            <h1 className="text-2xl font-black tracking-tight text-slate-800">{title}</h1>
            {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
);

export type StatTone = 'default' | 'amber' | 'red' | 'green' | 'sky' | 'violet';

const TONE: Record<StatTone, string> = {
    default: 'text-slate-800',
    amber: 'text-amber-600',
    red: 'text-red-600',
    green: 'text-emerald-600',
    sky: 'text-sky-600',
    violet: 'text-violet-600',
};

export interface Stat {
    key: string;
    label: string;
    value: React.ReactNode;
    tone?: StatTone;
    hint?: string;
    /** Present → the figure is a filter. */
    onClick?: () => void;
    active?: boolean;
}

const COLS: Record<number, string> = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6' };

export const StatStrip: React.FC<{ stats: Stat[] }> = ({ stats }) => (
    <div className={`grid grid-cols-2 ${COLS[stats.length] ?? 'sm:grid-cols-4'} gap-px bg-slate-200 border border-slate-200 rounded-xl overflow-hidden
        [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1`}>
        {stats.map(s => {
            const muted = s.value === 0 || s.value === '—';
            const body = (
                <>
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.label}</span>
                    <span className={`block text-xl font-black tabular-nums mt-0.5 ${muted ? 'text-slate-300' : TONE[s.tone ?? 'default']}`}>{s.value}</span>
                    {s.hint && <span className="block text-[11px] text-slate-400 mt-0.5 truncate">{s.hint}</span>}
                </>
            );
            return s.onClick ? (
                <button key={s.key} type="button" onClick={s.onClick} aria-pressed={!!s.active}
                    className={`text-left px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300 ${s.active ? 'bg-primary-50/70 shadow-[inset_0_-2px_0_var(--color-primary-500)]' : 'bg-white hover:bg-slate-50'}`}>
                    {body}
                </button>
            ) : (
                <div key={s.key} className="bg-white px-4 py-3">{body}</div>
            );
        })}
    </div>
);

/** Shared date format for the section: "12 May 2026" (never the ambiguous 5/12/2026). */
export const fmtDate = (d: string | null | undefined): string =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** Enter/Space on a clickable card does what a click does. */
export const onActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
};
