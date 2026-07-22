import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { cn } from './cn';

export interface SelectOption {
    value: string;
    label: string;
    description?: string;
    badge?: string;
    badgeColor?: string; // e.g. 'bg-red-100 text-red-700 border-red-200'
    icon?: React.ReactNode;
    disabled?: boolean;
}

export interface ModernSelectProps {
    options: (SelectOption | string)[];
    value: string | undefined;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
    disabled?: boolean;
    searchable?: boolean;
    clearable?: boolean;
    className?: string;
    error?: string;
    size?: 'sm' | 'md' | 'lg';
}

export const ModernSelect: React.FC<ModernSelectProps> = ({
    options: rawOptions,
    value,
    onChange,
    placeholder = 'Select option...',
    label,
    disabled = false,
    searchable,
    clearable = false,
    className,
    error,
    size = 'md',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number; placeAbove: boolean } | null>(null);

    const triggerRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Normalize raw options into SelectOption objects
    const options: SelectOption[] = rawOptions.map(opt =>
        typeof opt === 'string' ? { value: opt, label: opt } : opt
    );

    const selectedOption = options.find(o => o.value === value);

    // Automatically enable search bar if more than 5 options exist
    const isSearchable = searchable !== undefined ? searchable : options.length > 5;

    // Filter options based on search text
    const filteredOptions = options.filter(o =>
        o.label.toLowerCase().includes(filter.toLowerCase()) ||
        (o.description && o.description.toLowerCase().includes(filter.toLowerCase())) ||
        (o.value && o.value.toLowerCase().includes(filter.toLowerCase()))
    );

    // Calculate popover coordinates on open
    const updatePosition = useCallback(() => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const placeAbove = spaceBelow < 280 && rect.top > 280;

        setPopoverPos({
            top: placeAbove ? rect.top + window.scrollY - 8 : rect.bottom + window.scrollY + 6,
            left: rect.left + window.scrollX,
            width: Math.max(rect.width, 280),
            placeAbove,
        });
    }, []);

    const handleOpen = () => {
        if (disabled) return;
        updatePosition();
        setIsOpen(true);
    };

    const handleClose = useCallback(() => {
        setIsOpen(false);
        setFilter('');
    }, []);

    const handleSelect = (val: string) => {
        onChange(val);
        handleClose();
    };

    // Scroll lock and window resize/scroll listener
    useEffect(() => {
        if (!isOpen) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };

        const onScrollOrResize = () => {
            updatePosition();
        };

        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('scroll', onScrollOrResize, true);
        window.addEventListener('resize', onScrollOrResize);

        // Focus search input on open
        const timer = setTimeout(() => searchInputRef.current?.focus(), 50);

        return () => {
            document.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('scroll', onScrollOrResize, true);
            window.removeEventListener('resize', onScrollOrResize);
            clearTimeout(timer);
        };
    }, [isOpen, handleClose, updatePosition]);

    // Size variants
    const sizeClasses = {
        sm: 'px-2.5 py-1.5 min-h-[34px] text-xs rounded-lg',
        md: 'px-3.5 py-2.5 min-h-[42px] text-sm rounded-xl',
        lg: 'px-4 py-3 min-h-[48px] text-base rounded-xl',
    };

    return (
        <div className={cn('relative w-full', className)}>
            {label && (
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                    {label}
                </label>
            )}

            {/* ── Trigger Button ── */}
            <div
                ref={triggerRef}
                onClick={handleOpen}
                tabIndex={disabled ? -1 : 0}
                onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isOpen) {
                        e.preventDefault();
                        handleOpen();
                    }
                }}
                className={cn(
                    'w-full bg-white border border-slate-200 shadow-2xs flex items-center justify-between gap-2 cursor-pointer transition-all',
                    'hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500',
                    isOpen && 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm',
                    error && 'border-red-300 focus:ring-red-500/20 focus:border-red-500',
                    disabled && 'bg-slate-50 opacity-60 cursor-not-allowed hover:border-slate-200',
                    sizeClasses[size]
                )}
            >
                <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                    {selectedOption ? (
                        <>
                            {selectedOption.icon && <span className="shrink-0 text-slate-500">{selectedOption.icon}</span>}
                            <span className="font-medium text-slate-900 truncate">
                                {selectedOption.label}
                            </span>
                            {selectedOption.badge && (
                                <span className={cn(
                                    'px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider shrink-0 border',
                                    selectedOption.badgeColor || 'bg-slate-100 text-slate-700 border-slate-200'
                                )}>
                                    {selectedOption.badge}
                                </span>
                            )}
                        </>
                    ) : (
                        <span className="text-slate-400 truncate font-normal">
                            {placeholder}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-1">
                    {clearable && value && !disabled && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange('');
                            }}
                            className="p-1 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            aria-label="Clear selection"
                        >
                            <X size={14} />
                        </button>
                    )}
                    <ChevronDown
                        size={16}
                        className={cn('text-slate-400 transition-transform duration-200', isOpen && 'rotate-180 text-indigo-600')}
                    />
                </div>
            </div>

            {error && <p className="mt-1 text-xs text-red-600 font-medium">{error}</p>}

            {/* ── Dropdown Portal Panel ── */}
            {isOpen && createPortal(
                <div className="fixed inset-0 z-[250]">
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] sm:bg-transparent sm:backdrop-blur-none transition-opacity animate-[fadeIn_120ms_ease-out]"
                        onClick={handleClose}
                    />

                    {/* Desktop Floating Card / Mobile Bottom Sheet */}
                    <div
                        className={cn(
                            'fixed z-[260] bg-white shadow-2xl border border-slate-200/80 overflow-hidden flex flex-col',
                            // Mobile layout: Bottom Sheet on small screens
                            'inset-x-0 bottom-0 rounded-t-3xl max-h-[80vh] sm:max-h-[380px]',
                            // Desktop layout: Floating dropdown positioning
                            'sm:fixed sm:inset-auto sm:rounded-2xl sm:shadow-xl sm:w-auto',
                            'animate-[confirmSlideUp_180ms_cubic-bezier(0.16,1,0.3,1)] sm:animate-[scaleIn_120ms_ease-out]'
                        )}
                        style={
                            typeof window !== 'undefined' && window.innerWidth >= 640 && popoverPos
                                ? {
                                    top: popoverPos.placeAbove ? 'auto' : `${popoverPos.top}px`,
                                    bottom: popoverPos.placeAbove ? `${window.innerHeight - popoverPos.top}px` : 'auto',
                                    left: `${popoverPos.left}px`,
                                    width: `${popoverPos.width}px`,
                                }
                                : {}
                        }
                    >
                        {/* Mobile Header / Drag Handle */}
                        <div className="sm:hidden flex items-center justify-between px-5 pt-3.5 pb-2.5 border-b border-slate-100 bg-slate-50/50">
                            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto absolute top-2 left-1/2 -translate-x-1/2" />
                            <h4 className="text-sm font-bold text-slate-800 pt-2">{label || placeholder}</h4>
                            <button
                                onClick={handleClose}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors pt-2"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Search Bar */}
                        {isSearchable && (
                            <div className="p-2.5 bg-slate-50/80 border-b border-slate-100">
                                <div className="relative">
                                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        value={filter}
                                        onChange={(e) => setFilter(e.target.value)}
                                        placeholder="Search options..."
                                        className="w-full text-xs font-medium pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
                                    />
                                    {filter && (
                                        <button
                                            onClick={() => setFilter('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Options List */}
                        <div className="flex-1 overflow-y-auto max-h-[320px] p-1.5 space-y-0.5 divide-y divide-slate-50">
                            {filteredOptions.length > 0 ? (
                                filteredOptions.map((opt) => {
                                    const isSelected = value === opt.value;
                                    return (
                                        <div
                                            key={opt.value || '__empty__'}
                                            onClick={() => !opt.disabled && handleSelect(opt.value)}
                                            className={cn(
                                                'px-3.5 py-2.5 rounded-xl cursor-pointer flex items-center justify-between gap-3 transition-colors',
                                                isSelected ? 'bg-indigo-50/80 text-indigo-900 font-semibold' : 'hover:bg-slate-50 text-slate-700',
                                                opt.disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                                            )}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                {/* Checkmark Indicator */}
                                                <div className={cn(
                                                    'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors',
                                                    isSelected ? 'bg-indigo-600 text-white shadow-xs' : 'border border-slate-300 bg-white'
                                                )}>
                                                    {isSelected && <Check size={12} strokeWidth={3} />}
                                                </div>

                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        {opt.icon && <span className="text-slate-500 shrink-0">{opt.icon}</span>}
                                                        <span className="text-xs sm:text-sm truncate leading-snug">
                                                            {opt.label}
                                                        </span>
                                                    </div>
                                                    {opt.description && (
                                                        <p className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
                                                            {opt.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Option Badge */}
                                            {opt.badge && (
                                                <span className={cn(
                                                    'px-2 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider shrink-0 border',
                                                    opt.badgeColor || 'bg-slate-100 text-slate-700 border-slate-200'
                                                )}>
                                                    {opt.badge}
                                                </span>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="px-4 py-8 text-center text-slate-400">
                                    <p className="text-xs font-medium">No matching options</p>
                                    <p className="text-[10px] text-slate-300 mt-0.5">Try searching with a different term</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
