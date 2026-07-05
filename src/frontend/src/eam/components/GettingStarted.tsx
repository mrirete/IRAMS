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
import { CheckCircle2, Circle, ArrowRight, X, Rocket, Boxes, CalendarClock, Wrench, Users } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';

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

export const GettingStarted: React.FC = () => {
    const navigate = useNavigate();
    const [counts, setCounts] = useState<Counts | null>(null);
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

    return (
        <div className="bg-white border border-slate-200 rounded-card shadow-card overflow-hidden">
            <div className="flex items-start gap-3 p-4 sm:p-5 border-b border-slate-100 bg-gradient-to-r from-primary-50 to-white">
                <div className="p-2 rounded-lg bg-primary-600 text-white flex-shrink-0"><Rocket size={18} /></div>
                <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-slate-800">Get IRAMS running</h2>
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
        </div>
    );
};
