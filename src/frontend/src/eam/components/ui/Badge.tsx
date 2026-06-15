import React from 'react';
import { cn } from './cn';
import { type Tone, statusTone, priorityTone } from './statusTones';

/**
 * Badge / StatusPill — the single status + label primitive.
 * Replaces the scattered inline status/priority spans (e.g. the `● HIGH` pills
 * in WorkOrders). `tone` drives semantic color; the statusTone/priorityTone
 * helpers (in ./statusTones) map real EAM enum values to a tone so callers
 * don't hand-pick colors.
 */

export type { Tone };

const TONES: Record<Tone, string> = {
    neutral: 'bg-slate-100 text-slate-600 border-slate-200',
    info: 'bg-primary-50 text-primary-700 border-primary-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    purple: 'bg-violet-50 text-violet-700 border-violet-200',
};

const DOT: Record<Tone, string> = {
    neutral: 'bg-slate-400',
    info: 'bg-primary-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    purple: 'bg-violet-500',
};

export interface BadgeProps {
    tone?: Tone;
    /** Show a leading status dot */
    dot?: boolean;
    /** Pill (rounded-full) vs tag (rounded) shape */
    pill?: boolean;
    className?: string;
    children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', dot, pill = true, className, children }) => (
    <span
        className={cn(
            'inline-flex items-center gap-1.5 border font-bold uppercase tracking-wide leading-none',
            'text-[10px] px-2 py-1',
            pill ? 'rounded-full' : 'rounded',
            TONES[tone],
            className
        )}
    >
        {dot && <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', DOT[tone])} />}
        {children}
    </span>
);

/** StatusPill — convenience wrapper that auto-maps a wo_status value to a tone. */
export const StatusPill: React.FC<{ status?: string | null; className?: string }> = ({ status, className }) => (
    <Badge tone={statusTone(status)} dot className={className}>
        {(status || 'OPEN').replace(/_/g, ' ')}
    </Badge>
);

/** PriorityPill — convenience wrapper that auto-maps a priority value to a tone. */
export const PriorityPill: React.FC<{ priority?: string | null; className?: string }> = ({ priority, className }) => (
    <Badge tone={priorityTone(priority)} dot className={className}>
        {priority || 'LOW'}
    </Badge>
);
