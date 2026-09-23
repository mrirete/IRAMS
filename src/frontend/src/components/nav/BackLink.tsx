/**
 * "Back to …" — the way home for a page reached from somewhere else.
 *
 * A page that sends people onward (the Migration Center, the dashboard's
 * getting-started card) passes its own origin as router state:
 *   <Link to="/specialist/deliver" state={{ to: '/admin/migration', label: 'Migration Center' }}>
 * The destination renders <BackLink />, which returns there. With no origin in
 * the state it falls back to the page's natural parent, or renders nothing —
 * so pages that are also top-level sidebar entries look unchanged when opened
 * from the sidebar.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { readOrigin, type NavOrigin } from '../../lib/navOrigin';

export const BackLink: React.FC<{ fallback?: NavOrigin; className?: string }> = ({ fallback, className = '' }) => {
    const { state, pathname } = useLocation();
    const origin = readOrigin(state) ?? fallback ?? null;
    if (!origin || origin.to === pathname) return null;
    return (
        <Link
            to={origin.to}
            className={`inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors w-fit py-0.5 ${className}`}
        >
            <ArrowLeft size={14} strokeWidth={2.5} /> Back to {origin.label}
        </Link>
    );
};

/**
 * For pages that are ALSO top-level sidebar entries (People, Inventory, FinOps…):
 * a thin return line above the page, only when it was opened from somewhere
 * that said where it came from. Wrapping at the route keeps the page's own
 * full-height layout untouched.
 */
export const WithReturn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { state } = useLocation();
    return (
        <>
            {readOrigin(state) && <div className="mb-2"><BackLink /></div>}
            {children}
        </>
    );
};
