import React from 'react';

/**
 * Detail-page rail — the narrow sticky column beside a record's main reading
 * column.
 *
 * Records carry two kinds of field: the ones you read and write while working
 * the job (asset, description, scope) and the short, high-frequency ones you
 * only glance at (dates, terms, status). Splitting a detail page 50/50 between
 * them gives the short side half a monitor of white space and stretches a
 * dd-mm-yyyy input to 350px. Put the short ones in a rail instead: they stay in
 * view while the long column scrolls, and they stop competing for width.
 *
 * Pair with `RailRow` — label left, value right, spec-sheet style — so a whole
 * date block fits ~300px.
 */

export const RAIL_INPUT = 'w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white';
export const RAIL_INPUT_LOCKED = 'w-full text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-slate-100 text-slate-500';

export interface RailRowProps {
    label: string;
    children: React.ReactNode;
}

export const RailRow: React.FC<RailRowProps> = ({ label, children }) => (
    <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide leading-tight">{label}</span>
        <div className="w-[132px] flex-shrink-0">{children}</div>
    </div>
);

export interface DetailRailProps {
    title: string;
    icon?: React.ReactNode;
    /** Optional chip beside the title — only worth it if the page header does not already show it. */
    badge?: React.ReactNode;
    /** Visibility classes from the host (e.g. a mobile show/hide toggle). */
    className?: string;
    children: React.ReactNode;
}

export const DetailRail: React.FC<DetailRailProps> = ({ title, icon, badge, className = '', children }) => (
    <aside className={`lg:sticky lg:top-2 ${className}`}>
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                    {icon}{title}
                </h3>
                {badge}
            </div>
            {children}
        </div>
    </aside>
);
