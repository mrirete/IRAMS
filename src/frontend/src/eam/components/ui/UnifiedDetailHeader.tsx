import React from 'react';
import { X, ChevronRight } from 'lucide-react';

export interface HeaderAction {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    disabled?: boolean;
    hidden?: boolean;
    /** Hide label on small screens, show only icon */
    compactLabel?: boolean;
}

export interface UnifiedDetailHeaderProps {
    /** Primary title (e.g., asset tag, WO number) */
    title: string;
    /** Secondary text (e.g., description, supplier name) */
    subtitle?: string;
    /** Status badge text */
    status?: string;
    /** Tailwind classes for the status badge */
    statusClassName?: string;
    /** Icon or avatar element to show before the title */
    icon?: React.ReactNode;
    /** Breadcrumb path segments */
    breadcrumbs?: string[];
    /** Action buttons — array of HeaderAction objects or raw JSX */
    actions?: HeaderAction[] | React.ReactNode;
    /** Close/deselect handler */
    onClose: () => void;
    /** Additional badges (e.g., criticality) */
    badges?: React.ReactNode;
    /** Extra content row below the title (e.g., metadata chips) */
    metadata?: React.ReactNode;
}

const variantStyles: Record<string, string> = {
    primary: 'bg-relantern-500 hover:bg-relantern-600 text-white shadow-sm',
    secondary: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 shadow-sm',
    danger: 'bg-white border border-red-200 text-red-600 hover:bg-red-50 shadow-sm',
    ghost: 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
};

export const UnifiedDetailHeader: React.FC<UnifiedDetailHeaderProps> = ({
    title,
    subtitle,
    status,
    statusClassName = 'bg-slate-100 text-slate-600 border-slate-200',
    icon,
    breadcrumbs,
    actions = [],
    onClose,
    badges,
    metadata,
}) => {
    // Support both HeaderAction[] array and raw JSX ReactNode
    const isActionArray = Array.isArray(actions);
    const visibleActions = isActionArray ? (actions as HeaderAction[]).filter(a => !a.hidden) : [];

    return (
        <div className="border-b border-slate-200 bg-white flex-shrink-0 unified-header-enter">
            {/* Breadcrumb row (optional) */}
            {breadcrumbs && breadcrumbs.length > 0 && (
                <div className="px-5 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center text-[10px] text-slate-400 gap-1 overflow-x-auto scrollbar-hide">
                    {breadcrumbs.map((crumb, i) => (
                        <React.Fragment key={i}>
                            {i > 0 && <ChevronRight size={10} className="text-slate-300 flex-shrink-0" />}
                            <span className="whitespace-nowrap">{crumb}</span>
                        </React.Fragment>
                    ))}
                </div>
            )}

            {/* Main header row */}
            <div className="px-3 py-2.5 md:px-5 md:py-3 flex items-center gap-2 md:gap-4 min-h-[48px] md:min-h-[56px]">
                {/* Icon / Avatar */}
                {icon && (
                    <div className="flex-shrink-0">
                        {icon}
                    </div>
                )}

                {/* Title block */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h1 className="text-lg font-bold text-slate-900 truncate">{title}</h1>
                        {status && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border ${statusClassName}`}>
                                {status}
                            </span>
                        )}
                        {badges}
                    </div>
                    {subtitle && (
                        <p className="text-sm text-slate-500 truncate mt-0.5">{subtitle}</p>
                    )}
                    {metadata && (
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                            {metadata}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0 action-bar-collapse">
                    {isActionArray ? visibleActions.map((action, i) => (
                        <button
                            key={i}
                            onClick={action.onClick}
                            disabled={action.disabled}
                            className={`px-2 py-1.5 md:px-3 rounded-lg text-xs md:text-sm font-medium flex items-center gap-1.5 md:gap-2 transition-colors ${
                                action.disabled ? 'opacity-50 cursor-not-allowed' : ''
                            } ${variantStyles[action.variant || 'secondary']} ${
                                action.variant === 'primary' || action.variant === 'danger' ? '' : 'action-secondary'
                            }`}
                            title={action.label}
                        >
                            {action.icon}
                            <span className={action.compactLabel ? 'hidden sm:inline' : 'hidden sm:inline'}>
                                {action.label}
                            </span>
                        </button>
                    )) : actions}

                    {/* Close button */}
                    <button
                        onClick={onClose}
                        className="ml-1 p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Close"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};
