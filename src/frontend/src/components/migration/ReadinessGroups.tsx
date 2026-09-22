/**
 * Readiness, rendered for people — shared by every migration screen.
 *
 * Three groups in the order a person acts on them; plain name first, the SAP
 * code as a tag, what to do underneath; folded detail for the items that
 * cover many fields. Empty groups are not shown. The grouping itself is the
 * pure readinessView(); this only draws it, so the inbound page, the outbound
 * page and the Migration Center cannot drift into three dialects.
 */
import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import type { ViewItem, ReadinessView } from '../../lib/sapCockpit/readinessView';

export const IssueLine: React.FC<{ item: ViewItem }> = ({ item }) => {
    const icon = item.level === 'error'
        ? <AlertOctagon size={15} className="text-rose-600 mt-0.5 shrink-0" />
        : item.level === 'warn' ? <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" /> : <Info size={15} className="text-slate-400 mt-0.5 shrink-0" />;
    return (
        <li className="flex items-start gap-2.5 py-2.5">
            {icon}
            <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800 flex items-start gap-2 flex-wrap">
                    <span>{item.title}</span>
                    {item.code && <span className="text-[10px] font-mono text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 mt-0.5">{item.code}</span>}
                    {item.rows && item.rows > 1 && <span className="text-xs text-slate-400 mt-0.5">{item.rows.toLocaleString()} rows</span>}
                </div>
                {item.action && <div className="text-xs text-slate-500 mt-0.5">{item.action}</div>}
                {item.details && item.details.length > 0 && (
                    <details className="mt-1">
                        <summary className="text-xs text-primary-700 cursor-pointer select-none">Which fields ({item.details.length})</summary>
                        <ul className="mt-1 text-xs text-slate-500 list-disc pl-4 space-y-0.5">{item.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
                    </details>
                )}
            </div>
        </li>
    );
};

/**
 * One group. `initiallyOpen` is only the starting state: a <details open={…}>
 * bound to a prop is re-applied on every render, so a group the person opened
 * would snap shut the next time anything on the page changed. The element
 * owns its state after mount; React only seeds it.
 */
const Group: React.FC<{ title: string; hint: string; items: ViewItem[]; tone: string; initiallyOpen: boolean }> = ({ title, hint, items, tone, initiallyOpen }) => {
    const [open, setOpen] = useState(initiallyOpen);
    if (items.length === 0) return null;
    return (
        <details open={open} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-2 text-sm">
                <span className={`font-semibold ${tone}`}>{title}</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">{items.length} item{items.length === 1 ? '' : 's'}</span>
                <span className="text-xs text-slate-400 ml-1 hidden md:inline">— {hint}</span>
            </summary>
            <ul className="px-4 pb-2 divide-y divide-slate-100 border-t border-slate-100">{items.map((it, i) => <IssueLine key={i} item={it} />)}</ul>
        </details>
    );
};

export const ReadinessGroups: React.FC<{ view: ReadinessView; mustFixHint?: string }> = ({ view, mustFixHint }) => (
    <div className="space-y-2">
        <Group title="Must fix before loading" hint={mustFixHint ?? 'these rows will not load'} items={view.mustFix} tone="text-rose-700" initiallyOpen />
        <Group title="Worth a look" hint="loads, but something was changed or left out" items={view.check} tone="text-amber-700" initiallyOpen={view.mustFix.length === 0} />
        <Group title="Good to know" hint="how the file was read" items={view.notes} tone="text-slate-700" initiallyOpen={false} />
    </div>
);

export default ReadinessGroups;
