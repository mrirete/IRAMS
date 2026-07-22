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

const SELECT_ARROW =
    "appearance-none bg-no-repeat bg-[right_0.75rem_center] bg-[length:1rem_1rem] " +
    "bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke-width%3D%222%22%20stroke%3D%22%2364748b%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20d%3D%22M19.5%208.25l-7.5%207.5-7.5-7.5%22%20%2F%3E%3C%2Fsvg%3E')] " +
    "pr-9 cursor-pointer transition-all hover:border-indigo-400 font-medium text-slate-800 shadow-2xs rounded-xl";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    invalid?: boolean;
}
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ invalid, className, children, ...props }, ref) => (
        <select
            ref={ref}
            className={cn(CONTROL_BASE, CONTROL_PAD, SELECT_ARROW, invalid && 'border-accent-alert focus:ring-red-300', className)}
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
