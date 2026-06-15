import React from 'react';
import { Search, Plus, X } from 'lucide-react';

export interface FilterPill {
    id: string;
    label: string;
    icon?: React.ReactNode;
    /** Number of active selections in this filter */
    activeCount?: number;
    onClick?: () => void;
}

export interface FilterBarAction {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
}

export interface UnifiedFilterBarProps {
    searchValue: string;
    onSearchChange: (value: string) => void;
    searchPlaceholder?: string;
    /** Filter pills displayed as horizontal scrollable chips */
    filters?: FilterPill[];
    /** Action buttons (right side) */
    actions?: FilterBarAction[];
    /** Additional content to show after filters */
    children?: React.ReactNode;
}

export const UnifiedFilterBar: React.FC<UnifiedFilterBarProps> = ({
    searchValue,
    onSearchChange,
    searchPlaceholder = 'Search...',
    filters = [],
    actions = [],
    children,
}) => {
    return (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200 flex-shrink-0 overflow-x-auto scrollbar-hide">
            {/* Search input */}
            <div className="relative min-w-[180px] max-w-[280px] flex-shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                <input
                    type="text"
                    value={searchValue}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={searchPlaceholder}
                    className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none bg-slate-50/50"
                />
                {searchValue && (
                    <button
                        onClick={() => onSearchChange('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* Separator */}
            {filters.length > 0 && (
                <div className="h-5 w-px bg-slate-200 flex-shrink-0" />
            )}

            {/* Filter pills */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1">
                {filters.map(filter => (
                    <button
                        key={filter.id}
                        onClick={filter.onClick}
                        className={`
                            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                            border transition-colors whitespace-nowrap flex-shrink-0
                            ${filter.activeCount && filter.activeCount > 0
                                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                            }
                        `}
                    >
                        {filter.icon}
                        {filter.label}
                        {filter.activeCount !== undefined && filter.activeCount > 0 && (
                            <span className="bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none">
                                {filter.activeCount}
                            </span>
                        )}
                    </button>
                ))}

                {filters.length > 0 && (
                    <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-600 hover:bg-slate-50 border border-dashed border-slate-200 whitespace-nowrap flex-shrink-0 transition-colors">
                        <Plus size={12} />
                        Add Filter
                    </button>
                )}

                {children}
            </div>

            {/* Actions */}
            {actions.length > 0 && (
                <>
                    <div className="h-5 w-px bg-slate-200 flex-shrink-0" />
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {actions.map((action, i) => (
                            <button
                                key={i}
                                onClick={action.onClick}
                                className={`
                                    flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                                    transition-colors whitespace-nowrap
                                    ${action.variant === 'primary'
                                        ? 'bg-primary-600 hover:bg-primary-500 text-white shadow-sm'
                                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }
                                `}
                            >
                                {action.icon}
                                {action.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
