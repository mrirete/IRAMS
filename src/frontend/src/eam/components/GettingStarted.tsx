/**
 * GettingStarted — first-run adoption checklist.
 *
 * New organizations face forty capable-but-empty pages with no path to their
 * first work order. This mirrors the real adoption sequence — import assets →
 * create a PM → raise a work order → invite the team — and each step deep-links
 * straight into the doing. Steps auto-complete from live data counts (so it
 * reflects reality, not clicks), and the whole card can be dismissed once the
 * team is rolling. Shown on the Dashboard until complete or dismissed.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, ArrowRight, X, Rocket, Boxes, CalendarClock, Wrench, Users, Database } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';
import { useAuth } from '../contexts/AuthContext';
import { Modal } from './ui';

const DISMISS_KEY = 'ers_onboarding_dismissed_v1';

interface Step {
    id: keyof Counts;
    label: string;
    detail: string;
    cta: string;
    to: string;
    icon: React.ReactNode;
}
interface Counts { assets: number; pms: number; workOrders: number; people: number; }

const STEPS: Step[] = [
    { id: 'assets', label: 'Import your assets', detail: 'Bulk-import equipment from a spreadsheet, mapped to your hierarchy — or add one by hand.', cta: 'Import assets', to: '/assets?action=import', icon: <Boxes size={18} /> },
    { id: 'pms', label: 'Create your first PM', detail: 'Set a recurring preventive job so the system schedules the work for you.', cta: 'Create a PM', to: '/recurring-work', icon: <CalendarClock size={18} /> },
    { id: 'workOrders', label: 'Raise a work order', detail: 'Log the first job — corrective or planned — and track it to completion.', cta: 'New work order', to: '/work-orders?action=create', icon: <Wrench size={18} /> },
    { id: 'people', label: 'Invite your team', detail: 'Add the technicians and planners who will do and schedule the work.', cta: 'Add people', to: '/contacts', icon: <Users size={18} /> },
];

export const GettingStarted: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    const navigate = useNavigate();
    const { role } = useAuth();
    const isAdmin = role === 'SUPER_ADMIN' || role === 'SYS_ADMIN';
    const [counts, setCounts] = useState<Counts | null>(null);
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState<boolean>(() => {
        try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
    });

    useEffect(() => {
        if (dismissed) return;
        let active = true;
        DatabaseService.getInstance().getOnboardingCounts()
            .then(c => { if (active) setCounts(c); })
            .catch(() => { if (active) setCounts({ assets: 0, pms: 0, workOrders: 0, people: 0 }); });
        return () => { active = false; };
    }, [dismissed]);

    if (dismissed || !counts) return null;

    const done = (s: Step) => counts[s.id] > 0;
    const completed = STEPS.filter(done).length;
    // Once every step has data, the org is up and running — retire the card.
    if (completed === STEPS.length) return null;

    const dismiss = () => {
        try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* ignore */ }
        setDismissed(true);
    };

    // The next incomplete step gets the primary CTA emphasis.
    const nextStep = STEPS.find(s => !done(s));

    // Calm-screens: on the viewport-locked dashboard the checklist collapses to a
    // one-line strip; the full step list lives in a popup so the page keeps its
    // height budget while onboarding stays one click away.
    if (compact) {
        return (
            <>
                <div className="flex items-center gap-2.5 sm:gap-3 bg-white border border-slate-200 rounded-card shadow-card px-3 sm:px-4 py-2 flex-none">
                    <span className="p-1.5 rounded-lg bg-primary-600 text-white flex-shrink-0"><Rocket size={14} /></span>
                    <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-semibold text-slate-800 truncate">Get IREAMS running</div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <div className="h-1 w-20 sm:w-32 bg-slate-200 rounded-full overflow-hidden flex-shrink-0">
                                <div className="h-full bg-primary-600 rounded-full transition-all" style={{ width: `${(completed / STEPS.length) * 100}%` }} />
                            </div>
                            <span className="text-[10px] text-slate-500 whitespace-nowrap">{completed} of {STEPS.length} done</span>
                        </div>
                    </div>
                    <button
                        onClick={() => setOpen(true)}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-500 transition-colors"
                    >
                        Continue setup <ArrowRight size={13} />
                    </button>
                    <button onClick={dismiss} className="text-slate-400 hover:text-slate-600 flex-shrink-0 p-1" aria-label="Dismiss getting started" title="Dismiss">
                        <X size={15} />
                    </button>
                </div>
                <Modal open={open} onClose={() => setOpen(false)} title="Get IREAMS running" size="lg">
                    <p className="text-sm text-slate-500 mb-3">{completed} of {STEPS.length} done — a few steps to a live maintenance system.</p>
                    <div className="mb-3 h-1.5 w-full max-w-xs bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-600 rounded-full transition-all" style={{ width: `${(completed / STEPS.length) * 100}%` }} />
                    </div>
                    <div className="border border-slate-200 rounded-card overflow-hidden">
                        <ul className="divide-y divide-slate-100">
                            {STEPS.map(s => {
                                const isDone = done(s);
                                const isNext = s.id === nextStep?.id;
                                return (
                                    <li key={s.id} className={`flex items-center gap-3 p-3 ${isDone ? 'opacity-70' : ''}`}>
                                        <span className="flex-shrink-0">
                                            {isDone ? <CheckCircle2 size={20} className="text-emerald-500" /> : <Circle size={20} className="text-slate-300" />}
                                        </span>
                                        <div className="flex-shrink-0 text-slate-400 hidden sm:block">{s.icon}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className={`text-sm font-semibold ${isDone ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}>{s.label}</div>
                                            {!isDone && <div className="text-xs text-slate-500 mt-0.5">{s.detail}</div>}
                                        </div>
                                        {!isDone && (
                                            <button
                                                onClick={() => navigate(s.to)}
                                                className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${isNext ? 'bg-primary-600 text-white hover:bg-primary-500' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                            >
                                                {s.cta} <ArrowRight size={13} />
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                        {isAdmin && (
                            <button
                                onClick={() => navigate('/admin/migration', { state: { to: '/dashboard', label: 'Dashboard' } })}
                                className="w-full flex items-center gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60 hover:bg-slate-50 text-left transition-colors"
                            >
                                <Database size={15} className="text-slate-400 flex-shrink-0" />
                                <span className="text-xs text-slate-600 flex-1">
                                    Already have a CMMS? <span className="font-semibold text-slate-700">Bring your data across in the Migration Center</span>
                                </span>
                                <ArrowRight size={13} className="text-slate-400 flex-shrink-0" />
                            </button>
                        )}
                    </div>
                </Modal>
            </>
        );
    }

    return (
        <div className="bg-white border border-slate-200 rounded-card shadow-card overflow-hidden">
            <div className="flex items-start gap-3 p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-white">
                <div className="p-2 rounded-lg bg-primary-600 text-white flex-shrink-0"><Rocket size={18} /></div>
                <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-slate-800">Get IREAMS running</h2>
                    <p className="text-sm text-slate-500">{completed} of {STEPS.length} done — a few steps to a live maintenance system.</p>
                    <div className="mt-2 h-1.5 w-full max-w-xs bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-600 rounded-full transition-all" style={{ width: `${(completed / STEPS.length) * 100}%` }} />
                    </div>
                </div>
                <button onClick={dismiss} className="text-slate-400 hover:text-slate-600 flex-shrink-0" aria-label="Dismiss getting started" title="Dismiss">
                    <X size={16} />
                </button>
            </div>

            <ul className="divide-y divide-slate-100">
                {STEPS.map(s => {
                    const isDone = done(s);
                    const isNext = s.id === nextStep?.id;
                    return (
                        <li key={s.id} className={`flex items-center gap-3 p-3 sm:px-5 ${isDone ? 'opacity-70' : ''}`}>
                            <span className="flex-shrink-0">
                                {isDone ? <CheckCircle2 size={20} className="text-emerald-500" /> : <Circle size={20} className="text-slate-300" />}
                            </span>
                            <div className="flex-shrink-0 text-slate-400 hidden sm:block">{s.icon}</div>
                            <div className="flex-1 min-w-0">
                                <div className={`text-sm font-semibold ${isDone ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-800'}`}>{s.label}</div>
                                {!isDone && <div className="text-xs text-slate-500 mt-0.5">{s.detail}</div>}
                            </div>
                            {!isDone && (
                                <button
                                    onClick={() => navigate(s.to)}
                                    className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${isNext ? 'bg-primary-600 text-white hover:bg-primary-500' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                >
                                    {s.cta} <ArrowRight size={13} />
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            {/* Coming off an existing CMMS? This checklist is the from-scratch
                path; the Migration Center is the bring-your-data-with-you one. */}
            {isAdmin && (
                <button
                    onClick={() => navigate('/admin/migration', { state: { to: '/dashboard', label: 'Dashboard' } })}
                    className="w-full flex items-center gap-2 px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50/60 hover:bg-slate-50 text-left transition-colors"
                >
                    <Database size={15} className="text-slate-400 flex-shrink-0" />
                    <span className="text-xs text-slate-600 flex-1">
                        Already have a CMMS? <span className="font-semibold text-slate-700">Bring your data across in the Migration Center</span>
                    </span>
                    <ArrowRight size={13} className="text-slate-400 flex-shrink-0" />
                </button>
            )}
        </div>
    );
};
