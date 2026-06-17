import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, AlertOctagon, ChevronDown, X, Edit3, Check } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';

export const FF_GROUP_LABELS: Record<string, string> = {
    'ROTATING': '⚙️ Rotating Equipment',
    'STATIC_PRESSURE': '🏗️ Static / Pressure Vessels',
    'ELECTRICAL': '⚡ Electrical',
    'INSTRUMENT': '📊 Instrumentation',
    'PIPING': '🔩 Piping',
    'SAFETY_SYSTEM': '🛡️ Safety Systems',
    'HEAT_TRANSFER': '🌡️ Heat Transfer',
};

/**
 * ISO 14224 functional-failure picker. Loads FAULT_TYPE dictionary entries,
 * filters by asset class, supports manual entry (flagged for admin review).
 * Extracted from ServiceRequests so the unified report/request form can reuse it.
 */
export const FunctionalFailureSelector: React.FC<{
    value: string | undefined;
    onChange: (code: string) => void;
    readOnly?: boolean;
    assetClassCode?: string; // Asset class/category code for filtering
}> = ({ value, onChange, readOnly, assetClassCode }) => {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [functionalFailures, setFunctionalFailures] = useState<any[]>([]);
    const [isLoadingFF, setIsLoadingFF] = useState(true);
    const [showManualEntry, setShowManualEntry] = useState(false);
    const [manualCode, setManualCode] = useState('');
    const [manualDesc, setManualDesc] = useState('');
    const [duplicateError, setDuplicateError] = useState('');

    // Fetch functional failures from database
    useEffect(() => {
        const loadFailures = async () => {
            try {
                const dictionaries = await DatabaseService.getInstance().getDictionaries();
                const failures = dictionaries.filter((d: any) => d.type === 'FAULT_TYPE' || d.dict_type === 'FAULT_TYPE');
                setFunctionalFailures(failures);
            } catch (e) {
                console.error('Failed to load functional failures:', e);
                setFunctionalFailures([]);
            } finally {
                setIsLoadingFF(false);
            }
        };
        loadFailures();
    }, []);

    // Filter by asset class: show General (no categoryRef) + matched class
    const contextFiltered = useMemo(() => {
        if (!assetClassCode) return functionalFailures; // No asset selected → show all
        return functionalFailures.filter((f: any) => {
            const ref = f.categoryRef || f.category_ref;
            return !ref || ref === assetClassCode;
        });
    }, [functionalFailures, assetClassCode]);

    const selectedEntry = functionalFailures.find((f: any) => f.id === value || f.code === value);

    // Initialize search with current value description
    useEffect(() => {
        if (selectedEntry) {
            setSearch(`${selectedEntry.code} - ${selectedEntry.description}`);
        } else if (value && value.startsWith('MANUAL:')) {
            setSearch(value.replace('MANUAL:', ''));
        } else if (!isOpen) {
            setSearch('');
        }
    }, [value, selectedEntry, isOpen]);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Search filter
    const filtered = contextFiltered.filter((f: any) =>
        (f.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (f.code || f.dict_code || '').toLowerCase().includes(search.toLowerCase())
    );

    // Build grouped items: General first, then asset-specific
    const groupedItems = useMemo(() => {
        const general = filtered.filter((f: any) => !(f.categoryRef || f.category_ref));
        const grouped = new Map<string, any[]>();
        filtered.forEach((f: any) => {
            const ref = f.categoryRef || f.category_ref;
            if (!ref) return;
            if (!grouped.has(ref)) grouped.set(ref, []);
            grouped.get(ref)!.push(f);
        });

        const items: { type: 'header' | 'item'; label?: string; ff?: any }[] = [];
        if (general.length > 0) {
            items.push({ type: 'header', label: '🔧 General (All Assets)' });
            general.forEach(f => items.push({ type: 'item', ff: f }));
        }
        grouped.forEach((ffs, key) => {
            items.push({ type: 'header', label: FF_GROUP_LABELS[key] || key });
            ffs.forEach(f => items.push({ type: 'item', ff: f }));
        });
        return items;
    }, [filtered]);

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange('');
        setSearch('');
        setIsOpen(false);
        setShowManualEntry(false);
    };

    // Manual entry: validate for duplicate codes
    const handleManualCodeChange = (code: string) => {
        setManualCode(code.toUpperCase().replace(/[^A-Z0-9_]/g, ''));
        const dup = functionalFailures.find((f: any) => f.code === code.toUpperCase());
        setDuplicateError(dup ? `Code "${dup.code}" already exists: ${dup.description}` : '');
    };

    const submitManualEntry = () => {
        if (!manualCode || !manualDesc || duplicateError) return;
        // Store as "MANUAL:CODE - Description" for later admin promotion
        onChange(`MANUAL:${manualCode} - ${manualDesc}`);
        setSearch(`${manualCode} - ${manualDesc}`);
        setShowManualEntry(false);
        setIsOpen(false);
        setManualCode('');
        setManualDesc('');
    };

    if (readOnly) {
        return (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                    <AlertOctagon size={12} /> Functional Failure
                </label>
                {value ? (
                    <div className="text-sm text-slate-800 font-medium">
                        <div className="font-mono text-xs text-slate-500">{value}</div>
                        {selectedEntry?.description || (value.startsWith('MANUAL:') ? value.replace('MANUAL:', '') : value)}
                    </div>
                ) : (
                    <div className="text-xs text-slate-400 italic">Not specified</div>
                )}
            </div>
        );
    }

    return (
        <div ref={dropdownRef}>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Functional Failure (ISO 14224)</label>
            {assetClassCode && (
                <div className="text-[10px] text-blue-600 mb-1.5 flex items-center gap-1">
                    <Search size={10} /> Showing failures relevant to <strong>{FF_GROUP_LABELS[assetClassCode]?.replace(/^[^\s]+ /, '') || assetClassCode}</strong>
                </div>
            )}
            <div className="relative">
                <div
                    className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 cursor-text group hover:border-blue-300 transition-colors"
                    onClick={() => setIsOpen(true)}
                >
                    <div className="p-2 text-slate-400 bg-slate-50 border-r border-slate-200 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                        <AlertOctagon size={16} />
                    </div>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setIsOpen(true);
                            setShowManualEntry(false);
                        }}
                        onFocus={() => {
                            setIsOpen(true);
                            if (value && search === `${selectedEntry?.code} - ${selectedEntry?.description}`) {
                                setSearch(''); // Clear formatted value on focus to allow fresh search
                            }
                        }}
                        placeholder="Type to search (e.g. Leak, Bearing, Seal)..."
                        className="flex-1 p-2 text-sm outline-none w-full"
                    />

                    {value && (
                        <button
                            onClick={handleClear}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-slate-100 transition-colors"
                            title="Clear Selection"
                        >
                            <X size={16} />
                        </button>
                    )}

                    <button
                        className="p-2 text-slate-400 hover:text-slate-600 border-l border-slate-100"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(!isOpen);
                        }}
                    >
                        <ChevronDown size={16} />
                    </button>
                </div>

                {isOpen && !showManualEntry && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                        {groupedItems.length > 0 ? (
                            groupedItems.map((item, idx) => {
                                if (item.type === 'header') {
                                    return (
                                        <div key={`hdr-${idx}`} className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase bg-slate-50 border-y border-slate-100 tracking-wide select-none sticky top-0 z-10">
                                            {item.label}
                                        </div>
                                    );
                                }
                                const ff = item.ff;
                                return (
                                    <div
                                        key={ff.id}
                                        onClick={() => {
                                            onChange(ff.id);
                                            setSearch(`${ff.code} - ${ff.description}`);
                                            setIsOpen(false);
                                        }}
                                        className={`p-3 cursor-pointer border-b border-slate-50 last:border-0 hover:bg-blue-50 transition-colors ${ff.id === value ? 'bg-blue-50 border-l-4 border-l-blue-500 pl-2' : ''}`}
                                    >
                                        <div className="font-bold text-slate-800 text-sm">{ff.description}</div>
                                        <div className="text-xs text-slate-500 font-mono">{ff.code}</div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="p-4 text-center text-slate-500 text-sm">
                                No functional failures match "{search}".
                            </div>
                        )}

                        {/* Manual Entry Trigger */}
                        <div
                            onClick={() => setShowManualEntry(true)}
                            className="p-3 border-t border-slate-200 bg-slate-50 text-center cursor-pointer hover:bg-blue-50 transition-colors"
                        >
                            <span className="text-xs font-medium text-blue-600 flex items-center justify-center gap-1.5">
                                <Edit3 size={12} /> Not in list? Enter manually
                            </span>
                        </div>
                    </div>
                )}

                {/* Manual Entry Panel */}
                {showManualEntry && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-blue-200 rounded-lg shadow-xl p-4 animate-in fade-in zoom-in-95 duration-100">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-slate-700 uppercase">Manual Failure Entry</h4>
                            <button onClick={() => { setShowManualEntry(false); setIsOpen(true); }} className="text-slate-400 hover:text-slate-600">
                                <X size={14} />
                            </button>
                        </div>
                        <div className="space-y-2">
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Code <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={manualCode}
                                    onChange={(e) => handleManualCodeChange(e.target.value)}
                                    placeholder="e.g. CUSTOM_LEAK_01"
                                    className={`w-full p-2 border rounded-lg text-xs font-mono ${duplicateError ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                                    maxLength={30}
                                />
                                {duplicateError && (
                                    <p className="text-[10px] text-red-600 mt-0.5">{duplicateError}</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Description <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={manualDesc}
                                    onChange={(e) => setManualDesc(e.target.value)}
                                    placeholder="Describe the functional failure..."
                                    className="w-full p-2 border border-slate-300 rounded-lg text-xs"
                                />
                            </div>
                            <div className="flex justify-between items-center pt-1">
                                <p className="text-[9px] text-slate-400">This entry will be flagged for admin review.</p>
                                <button
                                    onClick={submitManualEntry}
                                    disabled={!manualCode || !manualDesc || !!duplicateError}
                                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                >
                                    <Check size={12} /> Apply
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Categorizing the failure correctly helps with Root Cause Analysis (RCM).</p>
        </div>
    );
};
