
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';

export const SearchableDropdown: React.FC<{
    options: { code: string; description: string }[];
    value: string | undefined;
    onChange: (code: string) => void;
    placeholder?: string;
    disabled?: boolean;
}> = ({ options, value, onChange, placeholder, disabled }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Derived state for display
    const selectedOption = options.find(o => o.code === value);
    const displayValue = selectedOption ? selectedOption.description : (value || '');

    // Filter logic — match on description or code
    const filteredOptions = options.filter(o =>
        o.description.toLowerCase().includes(filter.toLowerCase()) ||
        o.code.toLowerCase().includes(filter.toLowerCase())
    );

    // Reset highlight when filter changes
    useEffect(() => {
        setHighlightedIndex(0);
    }, [filter]);

    // Reset filter when closing
    useEffect(() => {
        if (!isOpen) {
            setFilter('');
            setHighlightedIndex(0);
        }
    }, [isOpen]);

    // Click outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Scroll highlighted item into view
    useEffect(() => {
        if (isOpen && listRef.current) {
            const items = listRef.current.querySelectorAll('[data-option-index]');
            const item = items[highlightedIndex] as HTMLElement;
            if (item) {
                item.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [highlightedIndex, isOpen]);

    const handleSelect = useCallback((code: string) => {
        onChange(code);
        setIsOpen(false);
    }, [onChange]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
                e.preventDefault();
                setIsOpen(true);
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredOptions[highlightedIndex]) {
                    handleSelect(filteredOptions[highlightedIndex].code);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                break;
        }
    }, [isOpen, filteredOptions, highlightedIndex, handleSelect]);

    // Focus search input when opened
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Highlight matching text in description
    const highlightMatch = (text: string) => {
        if (!filter) return text;
        const idx = text.toLowerCase().indexOf(filter.toLowerCase());
        if (idx === -1) return text;
        return (
            <>
                {text.slice(0, idx)}
                <span className="bg-amber-200/70 text-amber-900 rounded px-0.5">{text.slice(idx, idx + filter.length)}</span>
                {text.slice(idx + filter.length)}
            </>
        );
    };

    if (disabled) {
        return <input type="text" value={displayValue} disabled className="w-full text-sm border-slate-300 rounded-md bg-slate-100 p-2 text-slate-500" />;
    }

    return (
        <div className="relative" ref={containerRef} onKeyDown={handleKeyDown}>
            {/* ── Trigger Button ── */}
            <div
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full text-sm border rounded-lg bg-white p-2 min-h-[38px] flex items-center justify-between cursor-pointer transition-all ${
                    isOpen ? 'border-blue-400 ring-2 ring-blue-100 shadow-sm' : 'border-slate-300 hover:border-blue-400'
                }`}
            >
                <span className={`truncate ${!value ? 'text-slate-400' : 'text-slate-900'}`}>
                    {displayValue || placeholder || 'Select...'}
                </span>
                <div className="flex items-center gap-1 shrink-0 ml-1">
                    {value && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onChange('');
                            }}
                            className="p-0.5 rounded-full hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                            title="Clear"
                        >
                            <X size={12} />
                        </button>
                    )}
                    <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </div>
            </div>

            {/* ── Dropdown Panel ── */}
            {isOpen && (
                <div className="absolute z-[60] mt-1 w-full min-w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
                    style={{ animation: 'searchDropIn 0.15s ease-out' }}
                >
                    {/* Search Input */}
                    <div className="p-2.5 bg-slate-50 border-b border-slate-200">
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                ref={inputRef}
                                type="text"
                                autoFocus
                                placeholder="Type to filter…"
                                className="w-full text-sm pl-8 pr-8 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none bg-white transition"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                            />
                            {filter && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setFilter(''); }}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                            <span className="text-[10px] text-slate-400 font-medium">
                                {filteredOptions.length} result{filteredOptions.length !== 1 ? 's' : ''}
                                {filter && ` for "${filter}"`}
                            </span>
                            <span className="text-[10px] text-slate-300">
                                ↑↓ navigate · ↵ select · esc close
                            </span>
                        </div>
                    </div>

                    {/* Results List — taller, more compact rows */}
                    <div ref={listRef} className="max-h-[320px] overflow-y-auto overscroll-contain">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((opt, i) => {
                                const isSelected = value === opt.code;
                                const isHighlighted = i === highlightedIndex;
                                // Determine if it's the "None" option
                                const isNone = opt.code === '';

                                return (
                                    <div
                                        key={opt.code || '__none__'}
                                        data-option-index={i}
                                        onClick={() => handleSelect(opt.code)}
                                        onMouseEnter={() => setHighlightedIndex(i)}
                                        className={`
                                            px-3 py-2 cursor-pointer flex items-center gap-2.5 transition-colors border-b border-slate-50 last:border-0
                                            ${isHighlighted ? 'bg-blue-50' : ''}
                                            ${isSelected ? 'bg-blue-50/70' : ''}
                                            ${!isHighlighted && !isSelected ? 'hover:bg-slate-50' : ''}
                                        `}
                                    >
                                        {/* Selection indicator */}
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                                            isSelected ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white'
                                        }`}>
                                            {isSelected && <Check size={12} strokeWidth={3} />}
                                        </div>

                                        {/* Content */}
                                        <div className="flex-1 min-w-0">
                                            <div className={`text-sm truncate ${isNone ? 'italic text-slate-400' : 'text-slate-800'} ${isSelected ? 'font-semibold text-blue-800' : ''}`}>
                                                {highlightMatch(opt.description)}
                                            </div>
                                            {!isNone && opt.code && (
                                                <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                                                    {highlightMatch(opt.code)}
                                                </div>
                                            )}
                                        </div>

                                        {/* Selected badge */}
                                        {isSelected && (
                                            <span className="text-[9px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded shrink-0">
                                                SELECTED
                                            </span>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="px-4 py-8 text-center">
                                <Search size={24} className="mx-auto mb-2 text-slate-300" />
                                <div className="text-sm text-slate-400">No matches found</div>
                                <div className="text-xs text-slate-300 mt-1">Try a different search term</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Keyframe animation */}
            <style>{`
                @keyframes searchDropIn {
                    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </div>
    );
};
