import React from 'react';
import { cn } from './cn';

/**
 * Card — the base surface primitive. Uses the @theme elevation + radius tokens
 * (--shadow-card / --radius-card) so every surface in the app reads consistently.
 *
 *   <Card>
 *     <CardHeader title="Details" actions={<Button size="sm">Edit</Button>} />
 *     <CardBody>…</CardBody>
 *   </Card>
 *
 * `interactive` adds hover elevation + pointer affordance (use for clickable cards,
 * e.g. the mobile work-order list).
 */

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Hover elevation + cursor pointer for clickable cards */
    interactive?: boolean;
    /** Remove the default border (e.g. when nested inside another surface) */
    flush?: boolean;
}

export const Card: React.FC<CardProps> = ({ interactive, flush, className, children, ...props }) => (
    <div
        className={cn(
            'bg-white rounded-card shadow-card',
            !flush && 'border border-slate-200',
            interactive && 'cursor-pointer transition-shadow hover:shadow-raised active:shadow-card',
            className
        )}
        {...props}
    >
        {children}
    </div>
);

export interface CardHeaderProps {
    title?: React.ReactNode;
    subtitle?: React.ReactNode;
    /** Leading icon / avatar */
    icon?: React.ReactNode;
    /** Right-aligned actions (buttons, menus) */
    actions?: React.ReactNode;
    className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, subtitle, icon, actions, className }) => (
    <div className={cn('flex items-center gap-3 px-4 py-3 border-b border-slate-100', className)}>
        {icon && <div className="flex-shrink-0 text-slate-400">{icon}</div>}
        <div className="min-w-0 flex-1">
            {title && <div className="text-sm font-bold text-slate-800 truncate">{title}</div>}
            {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
);

export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Tighter padding for dense desktop content */
    dense?: boolean;
}

export const CardBody: React.FC<CardBodyProps> = ({ dense, className, children, ...props }) => (
    <div className={cn(dense ? 'p-3' : 'p-4', className)} {...props}>
        {children}
    </div>
);
