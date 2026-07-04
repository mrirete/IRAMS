import React from 'react';
import { cn } from './cn';

/**
 * LoadingState — THE loading indicator.
 *
 * One spinner for the whole app, always with a label. The label matters twice:
 * users see what is loading instead of an anonymous circle, and diagnostics can
 * tell loading states apart (the 2026-07 stuck-spinner incident was prolonged
 * by three visually identical bespoke spinners — route fallback, permission
 * gate, page data — that nobody could distinguish in screenshots).
 *
 * Variants:
 *  - block (default): centered in a content area (route fallbacks, page loads)
 *  - inline: small, flows with text (buttons/panels manage their own via Button loading)
 */
export interface LoadingStateProps {
    /** What is loading — shown under the spinner. Always set it. */
    label: string;
    variant?: 'block' | 'inline';
    /** Block variant: REPLACES the default sizing class (h-64) — cn does not
     *  resolve Tailwind conflicts, so pass your full sizing (e.g. "h-48 py-4"). */
    className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ label, variant = 'block', className }) => {
    if (variant === 'inline') {
        return (
            <span className={cn('inline-flex items-center gap-2 text-sm text-slate-500', className)} role="status" aria-live="polite">
                <span className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin motion-reduce:animate-none flex-shrink-0" aria-hidden="true" />
                {label}
            </span>
        );
    }
    return (
        <div className={cn('flex flex-col items-center justify-center gap-3', className ?? 'h-64')} role="status" aria-live="polite">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <p className="text-sm text-slate-500 m-0">{label}</p>
        </div>
    );
};
