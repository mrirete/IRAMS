/**
 * The three ways data moves in and out of IREAMS, made navigable from each
 * other so a person who lands on the wrong one is one click from the right
 * one:
 *
 *   Migration Center     files, one-off, people on both ends
 *   Integrations         systems kept in step continuously — three parts:
 *                          Systems (an ERP through its API), Feeds (historians,
 *                          sensors), Inbound APIs (keys other systems push with)
 *   Import Work History  one file kind, for the reliability engineer
 *
 * `IntegrationStrip` sits under the title of the three Integrations pages
 * (they stay separate pages with their own tested UI; the strip is what makes
 * them read as one area). Its labels are the pages' own titles and the
 * sidebar's entries (config/adminNav) — one name per page everywhere. `LookingFor` is the one-line cross-link the data
 * pages share.
 */
import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Plug, Radio, KeyRound } from 'lucide-react';

export type IntegrationPart = 'systems' | 'feeds' | 'apis';

const PARTS: { key: IntegrationPart; to: string; label: string; hint: string; icon: React.ReactNode }[] = [
    { key: 'systems', to: '/admin/integrations', label: 'ERP Systems', hint: 'an ERP kept in step through its API', icon: <Plug size={13} /> },
    { key: 'feeds', to: '/admin/connectors', label: 'Sensor & Data Feeds', hint: 'historians and sensors into reading points', icon: <Radio size={13} /> },
    { key: 'apis', to: '/admin/api-keys', label: 'Inbound APIs', hint: 'keys other systems push with', icon: <KeyRound size={13} /> },
];

export const IntegrationStrip: React.FC<{ active: IntegrationPart }> = ({ active }) => (
    <nav aria-label="Integrations" className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">
        <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Integrations</span>
        {PARTS.map((p) => (
            <NavLink
                key={p.key}
                to={p.to}
                end
                title={p.hint}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${p.key === active ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
                {p.icon} {p.label}
            </NavLink>
        ))}
    </nav>
);

type Door = 'migration' | 'integrations' | 'history';

const DOORS: Record<Door, { to: string; label: string; what: string }> = {
    migration: { to: '/admin/migration', label: 'Migration Center', what: 'move data once, by file' },
    integrations: { to: '/admin/integrations', label: 'Integrations', what: 'keep systems and feeds in step, continuously' },
    history: { to: '/specialist/import', label: 'Import Work History', what: 'one work-order history file, for a reliability study' },
};

/** "Looking for…?" — the two doors this page is not. */
export const LookingFor: React.FC<{ here: Door }> = ({ here }) => (
    <p className="text-xs text-slate-500">
        Looking for something else?{' '}
        {(Object.keys(DOORS) as Door[]).filter((d) => d !== here).map((d, i, arr) => (
            <React.Fragment key={d}>
                <Link to={DOORS[d].to} className="text-primary-700 font-semibold hover:underline">{DOORS[d].label}</Link>
                <span> — {DOORS[d].what}</span>{i < arr.length - 1 ? ' · ' : '.'}
            </React.Fragment>
        ))}
    </p>
);
