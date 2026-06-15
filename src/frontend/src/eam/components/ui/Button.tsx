import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

/**
 * Button — the single interactive primitive.
 * Replaces ad-hoc inline `bg-primary-600 text-white px-3 py-1.5 rounded-lg…` blocks.
 *
 * Variants:
 *   primary   — solid blue, main CTA
 *   secondary — white w/ border, neutral action
 *   ghost     — transparent, low-emphasis / toolbar
 *   danger    — destructive (delete, cancel)
 *   cta       — Relantern amber, reserved for AI / signature CTAs only
 *
 * Sizes: sm | md | lg. On mobile, md/lg meet the 44px touch-target minimum.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'cta';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-primary-600 text-white hover:bg-primary-500 active:bg-primary-700 shadow-sm disabled:bg-primary-300',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200',
    danger: 'bg-accent-alert text-white hover:bg-red-600 active:bg-red-700 shadow-sm disabled:bg-red-300',
    cta: 'bg-relantern-500 text-white hover:bg-relantern-600 active:bg-relantern-700 shadow-sm disabled:bg-relantern-300',
};

const SIZES: Record<ButtonSize, string> = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5 rounded-lg',
    md: 'text-sm px-3.5 py-2 gap-2 rounded-lg min-h-[40px] md:min-h-0',
    lg: 'text-base px-5 py-3 gap-2 rounded-xl min-h-[48px]',
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Show a spinner and disable the button */
    loading?: boolean;
    /** Icon element rendered before the label */
    leftIcon?: React.ReactNode;
    /** Icon element rendered after the label */
    rightIcon?: React.ReactNode;
    /** Stretch to full container width */
    fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            variant = 'primary',
            size = 'md',
            loading = false,
            leftIcon,
            rightIcon,
            fullWidth = false,
            disabled,
            className,
            children,
            ...props
        },
        ref
    ) => {
        return (
            <button
                ref={ref}
                disabled={disabled || loading}
                className={cn(
                    'inline-flex items-center justify-center font-semibold whitespace-nowrap',
                    'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    VARIANTS[variant],
                    SIZES[size],
                    fullWidth && 'w-full',
                    className
                )}
                {...props}
            >
                {loading ? (
                    <Loader2 size={ICON_SIZE[size]} className="animate-spin" />
                ) : (
                    leftIcon
                )}
                {children}
                {!loading && rightIcon}
            </button>
        );
    }
);

Button.displayName = 'Button';
