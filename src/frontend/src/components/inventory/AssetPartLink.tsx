/**
 * AssetPartLink — Reusable Multi-Select Pill Component
 * ════════════════════════════════════════════════════
 * Links parts ↔ assets with criticality badge and add/remove.
 */

import React, { useState, useMemo } from 'react';
import { X, Plus, Search, ShieldAlert } from 'lucide-react';
import { useAssetLookup } from '../../hooks/useAssetLookup';

interface AssetPartLinkProps {
    linkedAssetIds: string[];
    onChange: (ids: string[]) => void;
}

export const AssetPartLink: React.FC<AssetPartLinkProps> = ({ linkedAssetIds, onChange }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [search, setSearch] = useState('');
    const { assetOptions, getAssetById } = useAssetLookup();

    const linkedAssets = useMemo(() =>
        linkedAssetIds.map(id => getAssetById(id)).filter(Boolean) as NonNullable<ReturnType<typeof getAssetById>>[],
        [linkedAssetIds, getAssetById]);

    const hasCritA = linkedAssets.some(a => a.criticality === 'A');

    const availableAssets = useMemo(() =>
        assetOptions.filter(a => !linkedAssetIds.includes(a.id) &&
            (search === '' || a.name.toLowerCase().includes(search.toLowerCase()) || a.tag.toLowerCase().includes(search.toLowerCase()))
        ),
        [assetOptions, linkedAssetIds, search]);

    const handleAdd = (id: string) => {
        onChange([...linkedAssetIds, id]);
        setSearch('');
    };

    const handleRemove = (id: string) => {
        onChange(linkedAssetIds.filter(aid => aid !== id));
    };

    const critBadge = (crit: string) => {
        const map: Record<string, string> = {
            'A': 'bg-red-500/20 text-red-400 border-red-500/30',
            'B': 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
            'C': 'bg-green-500/10 text-green-400 border-green-500/30',
        };
        return map[crit] || 'bg-slate-100 text-slate-500';
    };

    return (
        <div>
            <label className="block text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider">
                Linked Assets ({linkedAssets.length})
            </label>

            {hasCritA && (
                <div className="flex items-center gap-1.5 text-[10px] text-orange-400 mb-2">
                    <ShieldAlert size={12} /> Part auto-flagged as critical (linked to Criticality A asset)
                </div>
            )}

            {/* Pills */}
            <div className="flex flex-wrap gap-2 mb-3">
                {linkedAssets.map(a => (
                    <div key={a.id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-full text-sm group hover:border-slate-300 transition-colors"
                    >
                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${critBadge(a.criticality)}`}>
                            {a.criticality}
                        </span>
                        <span className="text-slate-700 text-xs">{a.name}</span>
                        <button onClick={() => handleRemove(a.id)}
                            className="p-0.5 text-slate-400 hover:text-red-400 rounded-full hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100">
                            <X size={12} />
                        </button>
                    </div>
                ))}

                {/* Add Button */}
                <button onClick={() => setIsAdding(!isAdding)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 border border-dashed border-slate-300 rounded-full text-xs text-slate-500 hover:text-accent-cyan hover:border-accent-cyan/30 transition-colors">
                    <Plus size={12} /> Link Asset
                </button>
            </div>

            {/* Dropdown for adding */}
            {isAdding && (
                <div className="bg-slate-50 border border-slate-300 rounded-lg p-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search assets..."
                            className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-relantern-500"
                            autoFocus
                        />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                        {availableAssets.length === 0 && (
                            <p className="text-xs text-slate-400 text-center py-2">No matching assets</p>
                        )}
                        {availableAssets.slice(0, 10).map(a => (
                            <button key={a.id} onClick={() => handleAdd(a.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-md text-sm hover:bg-white transition-colors">
                                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${critBadge(a.criticality)}`}>
                                    {a.criticality}
                                </span>
                                <span className="text-slate-700 text-xs truncate">{a.tag} — {a.name}</span>
                                <span className="text-slate-400 text-[10px] ml-auto">{a.system}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
