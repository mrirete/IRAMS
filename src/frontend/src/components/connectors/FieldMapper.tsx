import React, { useState } from 'react';
import { ArrowRight, Check, Wand2, AlertTriangle, Sparkles, RotateCcw } from 'lucide-react';

interface Props {
    externalFields: string[];
    internalFields: string[];
    mapping: Record<string, string>;
    onChange: (mapping: Record<string, string>) => void;
}

// Simple fuzzy matching for auto-map
const KNOWN_MAPPINGS: Record<string, string[]> = {
    asset_id: ['id', 'id_external', 'asset_id', 'assetid', 'equip_id', 'equipment_id'],
    code: ['equip_num', 'asset_code', 'code', 'tag', 'tag_number', 'equipment_number'],
    name: ['description', 'name', 'asset_name', 'equip_name', 'short_desc'],
    status: ['status_code', 'status', 'asset_status', 'condition'],
    updated_at: ['last_modified', 'updated_at', 'modified_date', 'change_date', 'last_update'],
    location: ['location_code', 'location', 'func_loc', 'functional_location', 'site'],
    oem: ['manufacturer', 'oem', 'vendor', 'make', 'brand'],
};

const REQUIRED_FIELDS = ['asset_id', 'code', 'name'];

const fuzzyMatch = (internal: string, external: string): number => {
    const candidates = KNOWN_MAPPINGS[internal] || [];
    const extLower = external.toLowerCase();

    // Exact match in known mappings
    if (candidates.includes(extLower)) return 95;

    // Partial string match
    if (extLower.includes(internal) || internal.includes(extLower)) return 75;

    // Levenshtein-ish: count common characters
    const internalChars = new Set(internal.toLowerCase().split(''));
    const extChars = new Set(extLower.split(''));
    const intersection = [...internalChars].filter(c => extChars.has(c));
    const similarity = (intersection.length / Math.max(internalChars.size, extChars.size)) * 100;

    return similarity > 50 ? Math.round(similarity) : 0;
};

export const FieldMapper: React.FC<Props> = ({ externalFields, internalFields, mapping, onChange }) => {
    const [autoMapConfidence, setAutoMapConfidence] = useState<Record<string, number>>({});

    const handleMap = (internal: string, external: string) => {
        const newConfidence = { ...autoMapConfidence };
        delete newConfidence[internal]; // Clear AI confidence on manual map
        setAutoMapConfidence(newConfidence);
        onChange({ ...mapping, [internal]: external });
    };

    const handleAutoMap = () => {
        const newMapping: Record<string, string> = {};
        const newConfidence: Record<string, number> = {};
        const usedExternals = new Set<string>();

        for (const internal of internalFields) {
            let bestMatch = '';
            let bestScore = 0;

            for (const external of externalFields) {
                if (usedExternals.has(external)) continue;
                const score = fuzzyMatch(internal, external);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = external;
                }
            }

            if (bestScore >= 50 && bestMatch) {
                newMapping[internal] = bestMatch;
                newConfidence[internal] = bestScore;
                usedExternals.add(bestMatch);
            }
        }

        setAutoMapConfidence(newConfidence);
        onChange({ ...mapping, ...newMapping });
    };

    const handleClearAll = () => {
        setAutoMapConfidence({});
        onChange({});
    };

    const mappedCount = Object.keys(mapping).length;
    const requiredMapped = REQUIRED_FIELDS.filter(f => mapping[f]).length;

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Header */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h3 className="font-medium text-slate-800">Schema Mapping</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {mappedCount} / {internalFields.length} mapped
                        {requiredMapped < REQUIRED_FIELDS.length && (
                            <span className="text-amber-400 ml-2">• {REQUIRED_FIELDS.length - requiredMapped} required field{REQUIRED_FIELDS.length - requiredMapped > 1 ? 's' : ''} unmapped</span>
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleClearAll}
                        className="flex items-center px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-500 rounded-md hover:text-slate-700 hover:border-brand-500 transition-colors"
                    >
                        <RotateCcw size={12} className="mr-1.5" /> Clear All
                    </button>
                    <button
                        onClick={handleAutoMap}
                        className="flex items-center px-3 py-1.5 text-xs font-medium bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-md hover:bg-accent-cyan/20 transition-colors"
                    >
                        <Wand2 size={12} className="mr-1.5" /> Auto-Map
                    </button>
                </div>
            </div>

            {/* Mapping Rows */}
            <div className="divide-y divide-brand-700/50">
                {internalFields.map(internal => {
                    const mappedExternal = mapping[internal];
                    const isMapped = !!mappedExternal;
                    const isRequired = REQUIRED_FIELDS.includes(internal);
                    const confidence = autoMapConfidence[internal];

                    return (
                        <div key={internal} className={`p-4 flex items-center justify-between gap-3 transition-colors ${isMapped ? 'bg-white/30' : isRequired ? 'bg-amber-500/5' : 'hover:bg-white/50'}`}>
                            {/* Target Internal Field */}
                            <div className="flex items-center bg-slate-50 border border-slate-300 rounded-md px-3 py-2 w-[35%] min-w-0">
                                <span className="font-mono text-sm text-accent-cyan truncate flex-1">{internal}</span>
                                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                    {isRequired && !isMapped && (
                                        <AlertTriangle size={13} className="text-amber-400" />
                                    )}
                                    {isMapped && <Check size={14} className="text-accent-safe" />}
                                </div>
                            </div>

                            <ArrowRight size={16} className={`flex-shrink-0 ${isMapped ? 'text-accent-cyan' : 'text-brand-600'}`} />

                            {/* Source External Field Selector */}
                            <div className="w-[50%] min-w-0 flex items-center gap-2">
                                <select
                                    value={mappedExternal || ''}
                                    onChange={(e) => handleMap(internal, e.target.value)}
                                    className={`flex-1 min-w-0 appearance-none bg-slate-50 border rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-relantern-500 cursor-pointer transition-colors ${isMapped ? 'border-brand-500 text-slate-800' : isRequired ? 'border-amber-500/40 text-slate-400' : 'border-slate-200 text-slate-400'
                                        }`}
                                >
                                    <option value="" disabled>Select source field...</option>
                                    {externalFields.map(ext => (
                                        <option key={ext} value={ext}>{ext}</option>
                                    ))}
                                </select>

                                {/* Confidence Badge */}
                                {confidence && (
                                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${confidence >= 90 ? 'bg-accent-safe/10 text-accent-safe' :
                                        confidence >= 70 ? 'bg-accent-cyan/10 text-accent-cyan' :
                                            'bg-amber-500/10 text-amber-400'
                                        }`}>
                                        <Sparkles size={10} />
                                        {confidence}%
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2 text-xs text-slate-400">
                <Sparkles size={12} className="text-accent-cyan" />
                <span>Auto-Map uses fuzzy matching against known ISO 14224 field name patterns.</span>
            </div>
        </div>
    );
};
