import React from 'react';
import { cn } from './cn';

/**
 * Form control primitives — Field (label + error wrapper) + Input/Select/Textarea.
 * One consistent control style (focus ring = primary, 44px touch target on mobile)
 * replacing per-page input styling. For searchable selects, keep using the existing
 * SearchableDropdown component.
 */

const CONTROL_BASE =
    'w-full rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 ' +
    'transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-primary-500 ' +
    'disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed';

const CONTROL_PAD = 'px-3 py-2 min-h-[40px] md:min-h-0';

export interface FieldProps {
    label?: React.ReactNode;
    /** Mark the label with a red asterisk */
    required?: boolean;
    /** Validation/error message — turns the control red via context-free styling */
    error?: string;
    /** Helper text below the control */
    hint?: string;
    htmlFor?: string;
    className?: string;
    children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, required, error, hint, htmlFor, className, children }) => (
    <div className={cn('flex flex-col gap-1', className)}>
        {label && (
            <label htmlFor={htmlFor} className="text-xs font-semibold text-slate-600">
                {label}
                {required && <span className="text-accent-alert ml-0.5">*</span>}
            </label>
        )}
        {children}
        {error ? (
            <span className="text-xs text-accent-alert">{error}</span>
        ) : hint ? (
            <span className="text-xs text-slate-400">{hint}</span>
        ) : null}
    </div>
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    invalid?: boolean;
}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ invalid, className, ...props }, ref) => (
        <input
            ref={ref}
            className={cn(CONTROL_BASE, CONTROL_PAD, invalid && 'border-accent-alert focus:ring-red-300', className)}
            {...props}
        />
    )
);
Input.displayName = 'Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    invalid?: boolean;
}
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ invalid, className, children, ...props }, ref) => (
        <select
            ref={ref}
            className={cn(CONTROL_BASE, CONTROL_PAD, invalid && 'border-accent-alert focus:ring-red-300', className)}
            {...props}
        >
            {children}
        </select>
    )
);
Select.displayName = 'Select';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    invalid?: boolean;
}
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ invalid, className, ...props }, ref) => (
        <textarea
            ref={ref}
            className={cn(CONTROL_BASE, 'px-3 py-2 resize-y', invalid && 'border-accent-alert focus:ring-red-300', className)}
            {...props}
        />
    )
);
Textarea.displayName = 'Textarea';
