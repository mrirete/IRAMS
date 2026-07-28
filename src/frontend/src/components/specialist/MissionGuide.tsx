/**
 * MissionGuide — the Specialist walks WITH the user after a mission handoff.
 *
 * Clicking "Go" on a briefing mission stores an ActiveMission handoff
 * (sessionStorage) and navigates; this card — mounted once in AppLayout —
 * picks it up and floats the Specialist's concrete playbook in the corner of
 * whatever module the user is in, until they mark the mission done or
 * dismiss it. "Done" writes back into the same per-briefing progress the
 * workspace mission list reads, so the loop stays one loop.
 *
 * Deliberately quiet: one card, bottom-right, no modal, never blocks work.
 * Hidden on the Specialist's own pages (that's mission control, not the
 * field) and on print.
 */
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrainCircuit, Check, X, ChevronDown } from 'lucide-react';
import { MISSION_HANDOFF_KEY, guideForMission, type ActiveMission } from '../../lib/briefingParse';

const readMission = (): ActiveMission | null => {
    try {
        const raw = sessionStorage.getItem(MISSION_HANDOFF_KEY);
        return raw ? (JSON.parse(raw) as ActiveMission) : null;
    } catch {
        return null;
    }
};

export const MissionGuide: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [mission, setMission] = useState<ActiveMission | null>(null);
    const [collapsed, setCollapsed] = useState(false);

    // Re-read on every navigation — same-tab sessionStorage writes don't fire
    // storage events, but a handoff always navigates right after writing.
    useEffect(() => { setMission(readMission()); }, [location.pathname]);

    if (!mission) return null;
    // The workspace is mission control — the card lives in the field only.
    if (location.pathname.startsWith('/specialist')) return null;

    const clear = () => {
        try { sessionStorage.removeItem(MISSION_HANDOFF_KEY); } catch { /* ignore */ }
        setMission(null);
    };

    /** Done here = done on the briefing's mission list (same storage). */
    const markDone = () => {
        try {
            const key = `specialist-missions:${mission.briefingKey}`;
            const done = new Set<number>(JSON.parse(localStorage.getItem(key) ?? '[]') as number[]);
            done.add(mission.index);
            localStorage.setItem(key, JSON.stringify([...done]));
        } catch { /* private mode */ }
        clear();
    };

    const guide = guideForMission(mission.path, mission.tags);
    // Deep-linked paths carry query strings — compare pathnames only, and
    // "on track" means being anywhere under the destination's first segment.
    const basePath = mission.path.split('?')[0];
    const onTrack = location.pathname.startsWith(basePath.split('/').slice(0, 2).join('/'));

    return (
        <aside className="no-print fixed bottom-4 right-4 z-40 w-[21rem] max-w-[calc(100vw-2rem)] rounded-xl border border-primary-200 bg-white shadow-xl shadow-primary-900/10 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-100">
                <span className="w-7 h-7 rounded-lg bg-primary-600 text-white flex items-center justify-center shrink-0">
                    <BrainCircuit size={15} />
                </span>
                <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-slate-900 leading-tight">{guide.title}</div>
                    <div className="text-[10.5px] text-slate-400 truncate">Your Specialist · mission {mission.index + 1}</div>
                </div>
                <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand guide' : 'Collapse guide'}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50">
                    <ChevronDown size={14} className={`transition-transform ${collapsed ? '' : 'rotate-180'}`} />
                </button>
                <button onClick={clear} aria-label="Dismiss guide"
                    className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                    <X size={14} />
                </button>
            </div>

            {!collapsed && (
                <div className="px-3.5 py-3">
                    <p className="text-[11.5px] text-slate-500 leading-relaxed line-clamp-2 mb-2.5">
                        {mission.text.replace(/\*\*/g, '')}
                    </p>
                    <ol className="space-y-2 mb-3">
                        {guide.steps.map((s, i) => (
                            <li key={i} className="flex gap-2 text-[12px] text-slate-600 leading-[1.55]">
                                <span className="mt-px w-[18px] h-[18px] shrink-0 rounded-full bg-primary-50 border border-primary-200 text-primary-700 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                                <span>{s}</span>
                            </li>
                        ))}
                    </ol>
                    {!onTrack && (
                        <button onClick={() => navigate(mission.path)}
                            className="w-full mb-1.5 inline-flex items-center justify-center rounded-lg border border-primary-200 bg-primary-50 hover:bg-primary-100 text-primary-700 text-[12px] font-semibold h-8 transition-colors">
                            Take me back to {mission.label}
                        </button>
                    )}
                    <button onClick={markDone}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold h-8 transition-colors">
                        <Check size={13} /> Mission handled
                    </button>
                </div>
            )}
        </aside>
    );
};

export default MissionGuide;
