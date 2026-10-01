import React from 'react';
import { RequestStatus } from '../../types';
import { Modal, cn } from '../ui';
import { EMPTY_FILTERS, STATUS_LABEL, type RequestFilters, type RaisedWithin } from '../../lib/requestBoard';

export type ClosedWindow = 7 | 30 | 90 | null;

const PRIORITIES = ['EMERGENCY', 'HIGH', 'MEDIUM', 'LOW'];
const STATUSES = [RequestStatus.NEW, RequestStatus.REVIEW, RequestStatus.AUTHORIZED, RequestStatus.CONVERTED, RequestStatus.REJECTED];
const RAISED: { v: RaisedWithin; label: string }[] = [
    { v: 'ANY', label: 'Any time' }, { v: '24H', label: '24 h' }, { v: '7D', label: '7 days' }, { v: '30D', label: '30 days' },
];
const CLOSED: { v: ClosedWindow; label: string }[] = [
    { v: 7, label: '7 days' }, { v: 30, label: '30 days' }, { v: 90, label: '90 days' }, { v: null, label: 'All' },
];

const Toggle: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode }> = ({ on, onClick, children }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className={cn(
            'px-3 py-1.5 rounded-lg border text-xs font-medium transition',
            on ? 'bg-primary-50 border-primary-400 text-primary-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
        )}
    >
        {children}
    </button>
);

const Section: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div>
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">{label}</div>
        <div className="flex flex-wrap gap-2">{children}</div>
        {hint && <p className="mt-1.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
);

const selectCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-primary-500 focus:outline-none';

export const RequestFiltersModal: React.FC<{
    open: boolean;
    onClose: () => void;
    filters: RequestFilters;
    onChange: (f: RequestFilters) => void;
    plants: string[];
    types: string[];
    requesters: { id: string; name: string }[];
    closedWindow: ClosedWindow;
    onClosedWindow: (w: ClosedWindow) => void;
}> = ({ open, onClose, filters: f, onChange, plants, types, requesters, closedWindow, onClosedWindow }) => {
    const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Filter requests"
            footer={
                <>
                    <button
                        type="button"
                        onClick={() => onChange({ ...EMPTY_FILTERS, q: f.q, chip: f.chip })}
                        className="px-3 py-2 text-sm text-slate-600 hover:text-slate-800"
                    >
                        Reset filters
                    </button>
                    <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-500">
                        Done
                    </button>
                </>
            }
        >
            <div className="space-y-5">
                <Section label="Priority">
                    {PRIORITIES.map(p => (
                        <Toggle key={p} on={f.priorities.includes(p)} onClick={() => onChange({ ...f, priorities: flip(f.priorities, p) })}>
                            {p.charAt(0) + p.slice(1).toLowerCase()}
                        </Toggle>
                    ))}
                </Section>

                <Section label="Status">
                    {STATUSES.map(s => (
                        <Toggle key={s} on={f.statuses.includes(s)} onClick={() => onChange({ ...f, statuses: flip(f.statuses, s) })}>
                            {STATUS_LABEL[s]}
                        </Toggle>
                    ))}
                </Section>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <label className="block">
                        <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Plant / system</span>
                        <select value={f.plant} onChange={e => onChange({ ...f, plant: e.target.value })} className={selectCls}>
                            <option value="ALL">All plants / systems</option>
                            {plants.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Equipment type</span>
                        <select value={f.type} onChange={e => onChange({ ...f, type: e.target.value })} className={selectCls}>
                            <option value="ALL">All equipment types</option>
                            {types.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </label>
                    <label className="block sm:col-span-2">
                        <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Raised by</span>
                        <select value={f.requester} onChange={e => onChange({ ...f, requester: e.target.value })} className={selectCls}>
                            <option value="ALL">Anyone</option>
                            {requesters.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </label>
                </div>

                <Section label="Raised within">
                    {RAISED.map(o => (
                        <Toggle key={o.v} on={f.raised === o.v} onClick={() => onChange({ ...f, raised: o.v })}>{o.label}</Toggle>
                    ))}
                </Section>

                <Section label="Closed requests shown" hint="Converted and rejected requests changed in this window. Open requests are always all shown.">
                    {CLOSED.map(o => (
                        <Toggle key={String(o.v)} on={closedWindow === o.v} onClick={() => onClosedWindow(o.v)}>{o.label}</Toggle>
                    ))}
                </Section>
            </div>
        </Modal>
    );
};
