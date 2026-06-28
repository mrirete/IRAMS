import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, Info, HelpCircle, X } from 'lucide-react';
import { cn } from './cn';

// ── Types ────────────────────────────────────────────────────────────────────

export type ConfirmVariant = 'danger' | 'warning' | 'info';

export interface ConfirmDialogProps {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    /** Dialog title — e.g. "Delete Task" */
    title: string;
    /** Descriptive body message */
    message: string;
    /** Controls icon and button color theme */
    variant?: ConfirmVariant;
    /** Label for the confirm button — defaults to "Confirm" */
    confirmLabel?: string;
    /** Label for the cancel button — defaults to "Cancel" */
    cancelLabel?: string;
    /** Show a loading spinner on the confirm button */
    loading?: boolean;
}

// ── Variant Configs ──────────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<ConfirmVariant, {
    icon: React.ReactNode;
    iconBg: string;
    iconRing: string;
    confirmBtn: string;
    confirmBtnHover: string;
}> = {
    danger: {
        icon: <Trash2 size={22} className="text-red-600" strokeWidth={2} />,
        iconBg: 'bg-red-50',
        iconRing: 'ring-red-100',
        confirmBtn: 'bg-red-600 text-white shadow-sm',
        confirmBtnHover: 'hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500',
    },
    warning: {
        icon: <AlertTriangle size={22} className="text-amber-600" strokeWidth={2} />,
        iconBg: 'bg-amber-50',
        iconRing: 'ring-amber-100',
        confirmBtn: 'bg-amber-600 text-white shadow-sm',
        confirmBtnHover: 'hover:bg-amber-700 active:bg-amber-800 focus-visible:ring-amber-500',
    },
    info: {
        icon: <Info size={22} className="text-primary-600" strokeWidth={2} />,
        iconBg: 'bg-primary-50',
        iconRing: 'ring-primary-100',
        confirmBtn: 'bg-primary-600 text-white shadow-sm',
        confirmBtnHover: 'hover:bg-primary-700 active:bg-primary-800 focus-visible:ring-primary-500',
    },
};

// ── Component ────────────────────────────────────────────────────────────────

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    onConfirm,
    onCancel,
    title,
    message,
    variant = 'danger',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    loading = false,
}) => {
    const confirmRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);

    // Lock body scroll + Escape key
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        // Focus the cancel button for safety (non-destructive default)
        requestAnimationFrame(() => cancelRef.current?.focus());

        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onCancel]);

    if (!open) return null;

    const cfg = VARIANT_CONFIG[variant];

    return createPortal(
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-message"
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px] animate-[fadeIn_120ms_ease-out]"
                onClick={onCancel}
                aria-hidden
            />

            {/* Dialog Card */}
            <div
                className={cn(
                    'relative w-full max-w-[400px] bg-white rounded-2xl shadow-2xl',
                    'animate-[confirmSlideUp_200ms_cubic-bezier(0.16,1,0.3,1)]',
                    'overflow-hidden',
                )}
            >
                {/* Close button (top right) */}
                <button
                    onClick={onCancel}
                    className="absolute top-3 right-3 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors z-10"
                    aria-label="Close"
                >
                    <X size={16} />
                </button>

                {/* Body */}
                <div className="px-6 pt-6 pb-5 text-center">
                    {/* Icon Badge */}
                    <div
                        className={cn(
                            'mx-auto w-12 h-12 rounded-full flex items-center justify-center ring-8',
                            cfg.iconBg,
                            cfg.iconRing,
                            'mb-4',
                        )}
                    >
                        {cfg.icon}
                    </div>

                    {/* Title */}
                    <h3
                        id="confirm-dialog-title"
                        className="text-[15px] font-bold text-slate-900 leading-snug"
                    >
                        {title}
                    </h3>

                    {/* Message */}
                    <p
                        id="confirm-dialog-message"
                        className="mt-1.5 text-[13px] text-slate-500 leading-relaxed max-w-[320px] mx-auto"
                    >
                        {message}
                    </p>
                </div>

                {/* Actions — full-width stacked on mobile-first, side-by-side */}
                <div className="px-6 pb-6 flex gap-3">
                    <button
                        ref={cancelRef}
                        onClick={onCancel}
                        disabled={loading}
                        className={cn(
                            'flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold',
                            'bg-slate-100 text-slate-700',
                            'hover:bg-slate-200 active:bg-slate-300',
                            'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1',
                            'disabled:opacity-50',
                        )}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmRef}
                        onClick={onConfirm}
                        disabled={loading}
                        className={cn(
                            'flex-1 px-4 py-2.5 rounded-xl text-[13px] font-semibold',
                            cfg.confirmBtn,
                            cfg.confirmBtnHover,
                            'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                            'disabled:opacity-50',
                            loading && 'cursor-wait',
                        )}
                    >
                        {loading ? (
                            <span className="inline-flex items-center gap-2">
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                {confirmLabel}
                            </span>
                        ) : confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
};
