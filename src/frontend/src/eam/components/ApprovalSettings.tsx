import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, Plus, Trash2, UserCheck } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ROLE_PERMISSION_TEMPLATES } from '../constants/rolePermissions';
import type { ApprovalChain, ApprovalChainStep, ApprovalDocType, ApproverSubstitute } from '../types';

/**
 * Admin › Approvals — who signs what, by value.
 *
 * Two chains (work-order cost release, purchase-order authorisation), each a
 * ladder of value bands signed in order, and the list of stand-ins who sign
 * for an absent approver. The database enforces all of it (0401); this screen
 * only edits the configuration.
 */

const DOCS: { key: ApprovalDocType; label: string; blurb: string }[] = [
    { key: 'WORK_ORDER', label: 'Work orders', blurb: 'Checked when an order leaves planning for the schedule, against its planned cost.' },
    { key: 'PURCHASE_ORDER', label: 'Purchase orders', blurb: 'Checked when an order is authorised, against its total.' },
];

// Roles that can hold a step: every template except the admins, who may sign anything.
const ROLE_OPTIONS = Object.keys(ROLE_PERMISSION_TEMPLATES).filter(r => !['SUPER_ADMIN', 'SYS_ADMIN'].includes(r)).sort();
const roleLabel = (r: string) => r.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

const ChainEditor: React.FC<{ doc: typeof DOCS[number]; canEdit: boolean }> = ({ doc, canEdit }) => {
    const { showToast } = useToast();
    const [chain, setChain] = useState<ApprovalChain | null>(null);
    const [steps, setSteps] = useState<ApprovalChainStep[]>([]);
    const [exempt, setExempt] = useState(true);
    const [busy, setBusy] = useState(false);
    const [missing, setMissing] = useState(false);

    const load = useCallback(async () => {
        try {
            const c = await DatabaseService.getInstance().getApprovalChain(doc.key);
            setChain(c); setSteps(c.steps); setExempt(c.exempt_plan_generated);
        } catch {
            setMissing(true);
        }
    }, [doc.key]);
    useEffect(() => { load(); }, [load]);

    const dirty = useMemo(
        () => !!chain && (JSON.stringify(chain.steps) !== JSON.stringify(steps) || chain.exempt_plan_generated !== exempt),
        [chain, steps, exempt],
    );
    const setStep = (i: number, patch: Partial<ApprovalChainStep>) => setSteps(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    const toggleRole = (i: number, role: string) => {
        const has = steps[i].roles.includes(role);
        setStep(i, { roles: has ? steps[i].roles.filter(r => r !== role) : [...steps[i].roles, role] });
    };
    const addStep = () => {
        const last = steps[steps.length - 1];
        setSteps([...steps, { step_order: steps.length + 1, roles: [], up_to_amount: last ? last.up_to_amount * 4 : 5000, notify_after_hours: 24, takeover_after_hours: 48 }]);
    };

    const save = async () => {
        setBusy(true);
        try {
            const c = await DatabaseService.getInstance().saveApprovalChain(doc.key, steps, doc.key === 'WORK_ORDER' ? exempt : undefined);
            setChain(c); setSteps(c.steps); setExempt(c.exempt_plan_generated);
            showToast(`${doc.label}: approval chain saved.`, 'success');
        } catch (e: any) {
            showToast(e?.message || 'Could not save the chain.', 'error');
        } finally { setBusy(false); }
    };

    if (missing) {
        return (
            <section className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                {doc.label}: approval chains need migration 0401 — not applied to this database yet.
            </section>
        );
    }
    if (!chain) return <section className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-400">Loading…</section>;

    return (
        <section className="bg-white rounded-xl border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-bold text-slate-800">{doc.label}</h3>
                    <p className="text-xs text-slate-500">{doc.blurb}{chain.is_default && ' Showing the built-in defaults — save to make them your own.'}</p>
                </div>
                {canEdit && dirty && (
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => { setSteps(chain.steps); setExempt(chain.exempt_plan_generated); }} className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Discard</button>
                        <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-50">{busy ? 'Saving…' : 'Save chain'}</button>
                    </div>
                )}
            </div>

            <div className="p-4 space-y-2">
                {steps.map((s, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && <div className="flex justify-center text-slate-300"><ArrowDown size={14} /></div>}
                        <div className="rounded-lg border border-slate-200 p-3">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                <span className="text-xs font-bold text-slate-500 uppercase w-14">Step {i + 1}</span>
                                <label className="flex items-center gap-2 text-sm text-slate-700">
                                    up to
                                    <input
                                        type="number" min={1} disabled={!canEdit}
                                        value={s.up_to_amount || ''}
                                        onChange={e => setStep(i, { up_to_amount: parseFloat(e.target.value) || 0 })}
                                        className="w-32 text-right rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums"
                                    />
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-500">
                                    remind the next level after
                                    <input type="number" min={1} disabled={!canEdit} value={s.notify_after_hours}
                                        onChange={e => setStep(i, { notify_after_hours: parseInt(e.target.value, 10) || 24 })}
                                        className="w-16 text-right rounded-lg border border-slate-300 px-2 py-1 text-xs" /> h
                                </label>
                                <label className="flex items-center gap-2 text-xs text-slate-500">
                                    they may sign it after
                                    <input type="number" min={1} disabled={!canEdit} value={s.takeover_after_hours}
                                        onChange={e => setStep(i, { takeover_after_hours: parseInt(e.target.value, 10) || 48 })}
                                        className="w-16 text-right rounded-lg border border-slate-300 px-2 py-1 text-xs" /> h
                                </label>
                                {canEdit && steps.length > 1 && (
                                    <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="ml-auto p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label={`Remove step ${i + 1}`}>
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="text-xs text-slate-500 mr-1 self-center">Signed by</span>
                                {ROLE_OPTIONS.map(r => {
                                    const on = s.roles.includes(r);
                                    if (!canEdit && !on) return null;
                                    return (
                                        <button key={r} type="button" disabled={!canEdit} onClick={() => toggleRole(i, r)} aria-pressed={on}
                                            className={`px-2 py-1 rounded-full border text-xs font-medium ${on ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                                            {roleLabel(r)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </React.Fragment>
                ))}
                {canEdit && (
                    <button type="button" onClick={addStep} className="mt-1 text-sm text-primary-700 hover:text-primary-900 font-medium flex items-center gap-1">
                        <Plus size={14} /> Add a step
                    </button>
                )}
                <p className="text-xs text-slate-500 pt-1">
                    A value above the last step needs every step, then an administrator. Whoever starts an approval holds their own step and the ones below it.
                </p>
                {doc.key === 'WORK_ORDER' && (
                    <label className="flex items-start gap-2 pt-2 text-sm text-slate-700">
                        <input type="checkbox" className="mt-0.5" disabled={!canEdit} checked={exempt} onChange={e => setExempt(e.target.checked)} />
                        <span>
                            Orders generated from a maintenance plan need no cost approval
                            <span className="block text-xs text-slate-500">Their cost was accepted when the plan was approved. Emergency orders are always exempt and reviewed afterwards.</span>
                        </span>
                    </label>
                )}
            </div>
        </section>
    );
};

const Substitutes: React.FC<{ isAdmin: boolean; myId?: string }> = ({ isAdmin, myId }) => {
    const { showToast } = useToast();
    const [rows, setRows] = useState<ApproverSubstitute[]>([]);
    const [users, setUsers] = useState<{ id: string; label: string }[]>([]);
    const [missing, setMissing] = useState(false);
    const today = new Date().toISOString().slice(0, 10);
    const [draft, setDraft] = useState({ userId: isAdmin ? '' : (myId || ''), substituteUserId: '', validFrom: today, validTo: today });

    const load = useCallback(async () => {
        try { setRows(await DatabaseService.getInstance().getApproverSubstitutes()); } catch { setMissing(true); }
    }, []);
    useEffect(() => {
        load();
        DatabaseService.getInstance().getUsers().then(us => setUsers(
            us.filter((u: any) => (u.status || 'active') === 'active')
                .map((u: any) => ({ id: u.id, label: u.username || u.email || u.id }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        )).catch(() => { /* names fall back to ids */ });
    }, [load]);

    const name = (id: string) => users.find(u => u.id === id)?.label || id.slice(0, 8);
    const add = async () => {
        if (!draft.userId || !draft.substituteUserId) { showToast('Choose the approver and their substitute.', 'warning'); return; }
        if (draft.userId === draft.substituteUserId) { showToast('A person cannot substitute for themselves.', 'warning'); return; }
        if (draft.validTo < draft.validFrom) { showToast('The end date is before the start date.', 'warning'); return; }
        try {
            await DatabaseService.getInstance().addApproverSubstitute(draft);
            setDraft(d => ({ ...d, substituteUserId: '' }));
            await load();
            showToast('Substitute added.', 'success');
        } catch (e: any) { showToast(e?.message || 'Could not add the substitute.', 'error'); }
    };
    const remove = async (id: string) => {
        try { await DatabaseService.getInstance().removeApproverSubstitute(id); await load(); }
        catch (e: any) { showToast(e?.message || 'Could not remove it.', 'error'); }
    };

    if (missing) return null;
    const field = 'rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white';
    return (
        <section className="bg-white rounded-xl border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><UserCheck size={15} className="text-slate-400" /> Substitutes</h3>
                <p className="text-xs text-slate-500">While the dates run, the substitute receives the approver's requests and signs on their behalf. A substitute cannot sign something they raised, and cannot pass it on.</p>
            </div>
            <div className="p-4 space-y-3">
                {rows.length === 0 ? (
                    <p className="text-sm text-slate-500">No substitutes set.</p>
                ) : (
                    <ul className="divide-y divide-slate-100">
                        {rows.map(r => {
                            const active = r.validFrom <= today && today <= r.validTo;
                            return (
                                <li key={r.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                    <span className="font-medium text-slate-800">{name(r.substituteUserId)}</span>
                                    <span className="text-slate-500">signs for</span>
                                    <span className="font-medium text-slate-800">{name(r.userId)}</span>
                                    <span className="text-xs text-slate-500 tabular-nums">{r.validFrom} → {r.validTo}</span>
                                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${active ? 'bg-green-100 text-green-700' : r.validTo < today ? 'bg-slate-100 text-slate-500' : 'bg-blue-100 text-blue-700'}`}>
                                        {active ? 'Active' : r.validTo < today ? 'Ended' : 'Upcoming'}
                                    </span>
                                    {(isAdmin || r.userId === myId) && (
                                        <button type="button" onClick={() => remove(r.id)} className="ml-auto p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" aria-label="Remove substitute"><Trash2 size={14} /></button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
                <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100">
                    <label className="text-xs text-slate-500">Approver
                        <select className={`${field} block mt-1`} value={draft.userId} disabled={!isAdmin} onChange={e => setDraft({ ...draft, userId: e.target.value })}>
                            <option value="">Choose…</option>
                            {users.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                        </select>
                    </label>
                    <label className="text-xs text-slate-500">Substitute
                        <select className={`${field} block mt-1`} value={draft.substituteUserId} onChange={e => setDraft({ ...draft, substituteUserId: e.target.value })}>
                            <option value="">Choose…</option>
                            {users.filter(u => u.id !== draft.userId).map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                        </select>
                    </label>
                    <label className="text-xs text-slate-500">From
                        <input type="date" className={`${field} block mt-1`} value={draft.validFrom} onChange={e => setDraft({ ...draft, validFrom: e.target.value })} />
                    </label>
                    <label className="text-xs text-slate-500">To
                        <input type="date" className={`${field} block mt-1`} value={draft.validTo} onChange={e => setDraft({ ...draft, validTo: e.target.value })} />
                    </label>
                    <button type="button" onClick={add} className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-slate-800 text-white hover:bg-slate-700">Add substitute</button>
                </div>
            </div>
        </section>
    );
};

export const ApprovalSettings: React.FC = () => {
    const { user, role } = useAuth();
    const isAdmin = ['SUPER_ADMIN', 'SYS_ADMIN'].includes(String(role || '').toUpperCase());
    return (
        <div className="p-4 sm:p-6 overflow-y-auto h-full">
            <div className="ers-page-narrow space-y-4">
                {DOCS.map(d => <ChainEditor key={d.key} doc={d} canEdit={isAdmin} />)}
                <Substitutes isAdmin={isAdmin} myId={user?.id} />
            </div>
        </div>
    );
};
