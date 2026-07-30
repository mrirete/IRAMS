/**
 * ReportModal — "open the full detail" for a report section.
 *
 * The briefing and the assessment both lead with an illustration and keep the
 * long form one click away. This is that click: a wide, quiet overlay that can
 * hold prose, a full table, or both, without the caller re-implementing focus
 * handling and scroll locking each time.
 *
 * Deliberate details:
 *  - `no-print`, so printing the assessment never captures an open overlay;
 *  - Escape and backdrop close, and the panel takes focus on open so the
 *    keyboard lands inside it rather than back at the page top;
 *  - the page behind is scroll-locked, because a scrolling background under a
 *    tall table reads as a rendering fault.
 */
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const WIDTH = {
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
} as const;

export interface ReportModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    icon?: React.ReactNode;
    /** Sits in the header's right edge — e.g. an export or "open module" action. */
    action?: React.ReactNode;
    width?: keyof typeof WIDTH;
    children: React.ReactNode;
}

export const ReportModal: React.FC<ReportModalProps> = ({
    open, onClose, title, subtitle, icon, action, width = 'lg', children,
}) => {
    const panel = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panel.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 backdrop-blur-[2px] p-4 md:p-8"
            onClick={onClose}
            role="presentation"
        >
            <div
                ref={panel}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                onClick={(e) => e.stopPropagation()}
                className={`w-full ${WIDTH[width]} my-auto rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-150`}
            >
                <header className="sticky top-0 z-10 flex items-start gap-3 rounded-t-2xl border-b border-slate-100 bg-white/95 backdrop-blur px-5 py-3.5">
                    {icon && (
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                            {icon}
                        </span>
                    )}
                    <div className="min-w-0 flex-1">
                        <h2 className="text-[14px] font-bold leading-tight text-slate-800">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-[11.5px] text-slate-500">{subtitle}</p>}
                    </div>
                    {action}
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                        <X size={15} />
                    </button>
                </header>
                <div className="px-5 py-4">{children}</div>
            </div>
        </div>
    );
};

export default ReportModal;
