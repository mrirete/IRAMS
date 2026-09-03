/**
 * CrewBoard — the supervisor's morning screen (RF-01 item 3).
 *
 * MRS answers "does next week fit"; the Backlog answers "what's waiting".
 * This answers the question supervisors actually start the day with:
 * WHO on my crew is on WHAT right now, who's free, and what's slipping today.
 *
 * Read-only by design (assignment stays in the Backlog/assign modal — one
 * write path, not two). Derived entirely from data already on the page:
 * open work orders (assigned_to → contacts) + the labor contact list.
 */
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, AlertTriangle, Wrench, CircleDashed, Inbox } from 'lucide-react';
import { isOpenWo } from '../../../lib/woState';

interface CrewBoardProps {
    jobs: any[];
    contacts: any[];
}

const IN_PROGRESS = new Set(['WIP', 'INPRG', 'IN_PROGRESS']);

const dueOf = (j: any): string | undefined =>
    j.dateDueStart || j.dueDate || j.date_due_start || j.due_date || undefined;

const nameOf = (c: any): string =>
    c.name || [c.firstName ?? c.first_name, c.lastName ?? c.last_name].filter(Boolean).join(' ') || c.id;

const craftOf = (c: any): string | null => {
    const t = c.types?.[0] ?? c.roles?.[0] ?? c.contactType ?? null;
    return t ? String(t).replaceAll('_', ' ').toLowerCase() : null;
};

export const CrewBoard: React.FC<CrewBoardProps> = ({ jobs, contacts }) => {
    const navigate = useNavigate();
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const now = Date.now();

    const { rows, unassigned } = useMemo(() => {
        const open = (jobs || []).filter(j => isOpenWo(j.status));
        const byAssignee = new Map<string, any[]>();
        const unassigned: any[] = [];
        for (const j of open) {
            const a = (j as any).assignedTo ?? (j as any).assigned_to;
            if (a) (byAssignee.get(a) ?? byAssignee.set(a, []).get(a)!).push(j);
            else unassigned.push(j);
        }
        const rows = (contacts || []).map(c => {
            const mine = byAssignee.get(c.id) ?? [];
            const wip = mine.filter(j => IN_PROGRESS.has(String(j.status || '').toUpperCase()));
            const overdue = mine.filter(j => { const d = dueOf(j); return d && new Date(d).getTime() < now; });
            const dueToday = mine.filter(j => {
                const d = dueOf(j); if (!d) return false;
                const t = new Date(d).getTime();
                return t >= now && t <= todayEnd.getTime();
            });
            return { contact: c, mine, wip, overdue, dueToday };
        })
            // People with work first (most overdue → most loaded); free people last but visible.
            .sort((a, b) => (b.overdue.length - a.overdue.length) || (b.mine.length - a.mine.length));
        return { rows, unassigned };
    }, [jobs, contacts, now, todayEnd]);

    const woChip = (j: any, tone: 'red' | 'amber' | 'blue') => (
        <button key={j.id}
            onClick={() => navigate(`/work-orders/${j.id}`)}
            title={`${j.woNumber || ''} · ${j.title || ''}${dueOf(j) ? ` · due ${new Date(dueOf(j)!).toLocaleDateString()}` : ''}`}
            className={`max-w-full truncate text-left text-[11px] font-medium rounded-md px-2 py-1 border transition-colors ${tone === 'red' ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                : tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                    : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'}`}>
            {j.woNumber ? `${j.woNumber} · ` : ''}{j.title}
        </button>
    );

    return (
        <div className="space-y-3">
            {/* Unassigned queue — the board's call to action */}
            {unassigned.length > 0 && (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                    <Inbox size={16} className="text-amber-600 shrink-0" />
                    <p className="text-sm text-amber-800">
                        <span className="font-bold">{unassigned.length} open job{unassigned.length === 1 ? '' : 's'} unassigned</span>
                        {' '}— assign them from the Backlog view.
                    </p>
                </div>
            )}

            {rows.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
                    No labor contacts found. Add your crew under People &amp; Org and their assignments appear here.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {rows.map(({ contact, mine, wip, overdue, dueToday }) => (
                        <div key={contact.id} className={`bg-white border rounded-xl p-4 ${overdue.length > 0 ? 'border-red-200' : 'border-slate-200'}`}>
                            <div className="flex items-center gap-2.5 mb-2.5">
                                <span className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                    <User size={15} className="text-slate-500" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-slate-800 truncate">{nameOf(contact)}</div>
                                    {craftOf(contact) && <div className="text-[11px] text-slate-400 capitalize">{craftOf(contact)}</div>}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-semibold">
                                    {overdue.length > 0 && (
                                        <span className="flex items-center gap-1 text-red-600" title="Overdue assigned jobs">
                                            <AlertTriangle size={12} /> {overdue.length}
                                        </span>
                                    )}
                                    <span className="text-slate-400" title="Open assigned jobs">{mine.length} open</span>
                                </div>
                            </div>

                            {mine.length === 0 ? (
                                <p className="text-[12px] text-slate-400 flex items-center gap-1.5 m-0">
                                    <CircleDashed size={12} /> Free — nothing assigned
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {wip.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1"><Wrench size={10} /> Working now</p>
                                            <div className="flex flex-col gap-1">{wip.slice(0, 3).map(j => woChip(j, 'blue'))}</div>
                                        </div>
                                    )}
                                    {overdue.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-red-400 mb-1">Overdue</p>
                                            <div className="flex flex-col gap-1">{overdue.slice(0, 3).map(j => woChip(j, 'red'))}</div>
                                        </div>
                                    )}
                                    {dueToday.length > 0 && (
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-500 mb-1">Due today</p>
                                            <div className="flex flex-col gap-1">{dueToday.slice(0, 3).map(j => woChip(j, 'amber'))}</div>
                                        </div>
                                    )}
                                    {(wip.length + overdue.length + dueToday.length) === 0 && (
                                        <p className="text-[11px] text-slate-400 m-0">{mine.length} open, none in progress or due today</p>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CrewBoard;
