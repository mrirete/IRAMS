import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X, Check } from 'lucide-react';
import { cn } from './cn';

export interface PromptDialogProps {
    open: boolean;
    onConfirm: (value: string) => void;
    onCancel: () => void;
    /** Modal title — e.g. "Save as Library Template" */
    title: string;
    /** Optional subtitle or instructions text */
    message?: string;
    /** Initial input value */
    defaultValue?: string;
    /** Input field placeholder */
    placeholder?: string;
    /** Custom header icon accent */
    icon?: React.ReactNode;
    /** Label for submit button (default: "Save") */
    confirmLabel?: string;
    /** Label for cancel button (default: "Cancel") */
    cancelLabel?: string;
    /** Input control type: single line text or multiline textarea */
    inputType?: 'text' | 'textarea' | 'number';
    /** Optional sync validation function — return error string or null */
    validation?: (value: string) => string | null | undefined;
    /** Loading indicator on confirm button */
    loading?: boolean;
}

export const PromptDialog: React.FC<PromptDialogProps> = ({
    open,
    onConfirm,
    onCancel,
    title,
    message,
    defaultValue = '',
    placeholder = 'Enter value...',
    icon,
    confirmLabel = 'Save',
    cancelLabel = 'Cancel',
    inputType = 'text',
    validation,
    loading = false,
}) => {
    const [value, setValue] = useState(defaultValue);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    // Sync input value when defaultValue or open status changes
    useEffect(() => {
        if (open) {
            setValue(defaultValue ?? '');
            setError(null);
        }
    }, [open, defaultValue]);

    // Handle scroll locking, focus, escape key
    useEffect(() => {
        if (!open) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        // Auto focus and select input text
        const timer = setTimeout(() => {
            if (inputRef.current) {
                inputRef.current.focus();
                if ('select' in inputRef.current && typeof inputRef.current.select === 'function') {
                    inputRef.current.select();
                }
            }
        }, 50);

        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = prevOverflow;
            clearTimeout(timer);
        };
    }, [open, onCancel]);

    if (!open) return null;

    const handleSubmit = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (loading) return;

        if (validation) {
            const err = validation(value);
            if (err) {
                setError(err);
                return;
            }
        }
        setError(null);
        onConfirm(value);
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && inputType !== 'textarea' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-dialog-title"
        >
            {/* Glassmorphic Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
                onClick={onCancel}
                aria-hidden
            />

            {/* Modal Card */}
            <div
                className={cn(
                    'relative w-full max-w-[440px] bg-white rounded-2xl shadow-2xl',
                    'animate-[confirmSlideUp_200ms_cubic-bezier(0.16,1,0.3,1)]',
                    'border border-slate-100 overflow-hidden',
                )}
            >
                {/* Close Button */}
                <button
                    onClick={onCancel}
                    className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors z-10"
                    aria-label="Close"
                >
                    <X size={18} />
                </button>

                <form onSubmit={handleSubmit}>
                    {/* Header */}
                    <div className="px-6 pt-6 pb-4">
                        <div className="flex items-start gap-4">
                            {/* Icon Badge */}
                            <div className="flex-shrink-0 w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center ring-8 ring-indigo-50/50 shadow-xs">
                                {icon || <HelpCircle size={22} className="text-indigo-600" />}
                            </div>

                            <div className="flex-1 min-w-0 pt-0.5">
                                <h3
                                    id="prompt-dialog-title"
                                    className="text-[16px] font-bold text-slate-900 leading-snug tracking-tight"
                                >
                                    {title}
                                </h3>
                                {message && (
                                    <p className="mt-1 text-[13px] text-slate-500 leading-relaxed">
                                        {message}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Input Field Area */}
                        <div className="mt-5">
                            {inputType === 'textarea' ? (
                                <textarea
                                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                                    value={value}
                                    onChange={(e) => {
                                        setValue(e.target.value);
                                        if (error) setError(null);
                                    }}
                                    placeholder={placeholder}
                                    rows={3}
                                    className={cn(
                                        'w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm font-medium text-slate-900',
                                        'placeholder:text-slate-400 focus:bg-white focus:outline-none transition-all shadow-xs',
                                        error
                                            ? 'border-red-300 focus:ring-2 focus:ring-red-500/20 focus:border-red-500'
                                            : 'border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500',
                                    )}
                                />
                            ) : (
                                <input
                                    ref={inputRef as React.RefObject<HTMLInputElement>}
                                    type={inputType}
                                    value={value}
                                    onChange={(e) => {
                                        setValue(e.target.value);
                                        if (error) setError(null);
                                    }}
                                    onKeyDown={handleInputKeyDown}
                                    placeholder={placeholder}
                                    className={cn(
                                        'w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm font-medium text-slate-900',
                                        'placeholder:text-slate-400 focus:bg-white focus:outline-none transition-all shadow-xs',
                                        error
                                            ? 'border-red-300 focus:ring-2 focus:ring-red-500/20 focus:border-red-500'
                                            : 'border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500',
                                    )}
                                />
                            )}

                            {error && (
                                <p className="mt-1.5 text-xs text-red-600 font-medium">
                                    {error}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="bg-slate-50/80 px-6 py-3.5 flex items-center justify-end gap-2.5 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={loading}
                            className={cn(
                                'px-4 py-2 rounded-xl text-[13px] font-semibold text-slate-700 bg-white border border-slate-200',
                                'hover:bg-slate-100 active:bg-slate-200 transition-colors shadow-2xs',
                                'disabled:opacity-50',
                            )}
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className={cn(
                                'px-4.5 py-2 rounded-xl text-[13px] font-semibold text-white bg-indigo-600',
                                'hover:bg-indigo-700 active:bg-indigo-800 transition-all shadow-sm shadow-indigo-600/20',
                                'focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1',
                                'disabled:opacity-50 flex items-center gap-1.5',
                                loading && 'cursor-wait',
                            )}
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    <span>Saving...</span>
                                </>
                            ) : (
                                <>
                                    <Check size={16} strokeWidth={2.5} />
                                    <span>{confirmLabel}</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body,
    );
};
