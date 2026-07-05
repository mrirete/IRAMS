import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronRight, MoreVertical } from 'lucide-react';

export interface HeaderAction {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    disabled?: boolean;
    /** Tooltip text — shown on hover (e.g. permission reason for disabled state) */
    tooltip?: string;
    hidden?: boolean;
    /** Hide label on small screens, show only icon */
    compactLabel?: boolean;
    /** Mark as primary — always visible. Non-primary actions go to overflow on mobile */
    isPrimary?: boolean;
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
    primary: 'bg-primary-600 hover:bg-primary-500 text-white shadow-sm',
    secondary: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 shadow-sm',
    danger: 'bg-white border border-red-200 text-red-600 hover:bg-red-50 shadow-sm',
    ghost: 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
};

const overflowVariantStyles: Record<string, string> = {
    primary: 'text-primary-600 font-semibold',
    secondary: 'text-slate-700',
    danger: 'text-red-600',
    ghost: 'text-slate-600',
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
    const isActionArray = Array.isArray(actions);
    const visibleActions = isActionArray ? (actions as HeaderAction[]).filter(a => !a.hidden) : [];

    // Split into primary (always visible) and overflow (hidden on mobile)
    const primaryActions = visibleActions.filter(a => a.isPrimary || a.variant === 'primary');
    const overflowActions = visibleActions.filter(a => !a.isPrimary && a.variant !== 'primary');

    // Overflow menu state
    const [showOverflow, setShowOverflow] = useState(false);
    const overflowRef = useRef<HTMLDivElement>(null);

    // Close overflow on outside click
    useEffect(() => {
        if (!showOverflow) return;
        const handler = (e: MouseEvent) => {
            if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
                setShowOverflow(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showOverflow]);

    return (
        <div className="border-b border-slate-200 bg-white flex-shrink-0 unified-header-enter">
            {/* ═══ MOBILE: Compact single-row header (<640px) ═══ */}
            <div className="sm:hidden px-3 py-2 flex items-center gap-2 min-h-[48px]">
                {/* Icon */}
                {icon && <div className="flex-shrink-0">{icon}</div>}

                {/* Title + status inline */}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                    <h1 className="text-sm font-bold text-slate-900 truncate">{title}</h1>
                    {status && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider border flex-shrink-0 ${statusClassName}`}>
                            {status}
                        </span>
                    )}
                </div>

                {/* Actions — only primary + overflow */}
                <div className="flex items-center gap-1 flex-shrink-0">
                    {isActionArray ? (
                        <>
                            {primaryActions.map((action, i) => (
                                <button
                                    key={`mp-${i}`}
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    className={`p-2 rounded-lg transition-colors ${
                                        action.disabled ? 'opacity-50 cursor-not-allowed' : ''
                                    } ${variantStyles[action.variant || 'secondary']}`}
                                    title={action.tooltip || action.label}
                                >
                                    {action.icon}
                                </button>
                            ))}
                            {overflowActions.length > 0 && (
                                <div className="relative" ref={overflowRef}>
                                    <button
                                        onClick={() => setShowOverflow(!showOverflow)}
                                        className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                                        aria-label="More actions"
                                    >
                                        <MoreVertical size={18} />
                                    </button>
                                    {showOverflow && (
                                        <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] py-1 animate-in fade-in zoom-in-95 duration-150">
                                            {overflowActions.map((action, i) => (
                                                <button
                                                    key={i}
                                                    onClick={() => { action.onClick(); setShowOverflow(false); }}
                                                    disabled={action.disabled}
                                                    className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-slate-50 ${
                                                        action.disabled ? 'opacity-50 cursor-not-allowed' : ''
                                                    } ${overflowVariantStyles[action.variant || 'secondary']}`}
                                                >
                                                    {action.icon}
                                                    {action.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    ) : actions}
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        title="Close"
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* ═══ DESKTOP/TABLET: Full header (≥640px) ═══ */}
            <div className="hidden sm:block">
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
                <div className="px-5 py-3 flex items-center gap-4 min-h-[56px]">
                    {/* Icon / Avatar */}
                    {icon && <div className="flex-shrink-0">{icon}</div>}

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
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {isActionArray ? (
                            <>
                                {visibleActions.map((action, i) => (
                                    <button
                                        key={`d-${i}`}
                                        onClick={action.onClick}
                                        disabled={action.disabled}
                                        className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
                                            action.disabled ? 'opacity-50 cursor-not-allowed' : ''
                                        } ${variantStyles[action.variant || 'secondary']}`}
                                        title={action.tooltip || action.label}
                                    >
                                        {action.icon}
                                        <span className="hidden sm:inline">{action.label}</span>
                                    </button>
                                ))}
                            </>
                        ) : actions}
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
        </div>
    );
};
