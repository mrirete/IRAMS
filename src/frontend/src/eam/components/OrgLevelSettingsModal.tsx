import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, Factory, RotateCcw } from 'lucide-react';
import { DatabaseService } from '../services/DatabaseService';

interface OrgLevel {
    id?: string;
    code: string;
    description: string;
    sortOrder: number;
    color: string;
    childType: string | null;
    childLabel: string | null;
    isNew?: boolean;
}

interface OrgLevelSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    levels: OrgLevel[];
}

// Industry-standard 5-level hierarchy (ISO 55000 / Oil & Gas)
const INDUSTRY_TEMPLATE: OrgLevel[] = [
    { code: 'SITE', description: 'Site / Plant', sortOrder: 1, color: '#3b82f6', childType: 'DIVISION', childLabel: 'Add Division' },
    { code: 'DIVISION', description: 'Division', sortOrder: 2, color: '#8b5cf6', childType: 'DEPARTMENT', childLabel: 'Add Department' },
    { code: 'DEPARTMENT', description: 'Department', sortOrder: 3, color: '#f59e0b', childType: 'SECTION', childLabel: 'Add Section' },
    { code: 'SECTION', description: 'Section / Unit', sortOrder: 4, color: '#10b981', childType: 'TEAM', childLabel: 'Add Team' },
    { code: 'TEAM', description: 'Team', sortOrder: 5, color: '#6366f1', childType: null, childLabel: null },
];

const AVAILABLE_COLORS = [
    { hex: '#3b82f6', label: 'Blue' },
    { hex: '#8b5cf6', label: 'Violet' },
    { hex: '#f59e0b', label: 'Amber' },
    { hex: '#10b981', label: 'Emerald' },
    { hex: '#6366f1', label: 'Indigo' },
    { hex: '#ef4444', label: 'Red' },
    { hex: '#14b8a6', label: 'Teal' },
    { hex: '#6b7280', label: 'Gray' },
    { hex: '#ec4899', label: 'Pink' },
];

export const OrgLevelSettingsModal: React.FC<OrgLevelSettingsModalProps> = ({
    isOpen,
    onClose,
    onSave,
    levels: initialLevels
}) => {
    const [levels, setLevels] = useState<OrgLevel[]>([]);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLevels(initialLevels.map(l => ({ ...l })));
        }
    }, [isOpen, initialLevels]);

    const handleAddLevel = () => {
        const newOrder = levels.length + 1;
        // Prompt user for a meaningful code and name
        const name = prompt('Level name (e.g., Region, Section, Crew):');
        if (!name || !name.trim()) return;

        const suggestedCode = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_');
        const code = prompt(`Level code (uppercase, no spaces):`, suggestedCode);
        if (!code || !code.trim()) return;

        const newLevel: OrgLevel = {
            code: code.trim().toUpperCase().replace(/\s/g, '_'),
            description: name.trim(),
            sortOrder: newOrder,
            color: AVAILABLE_COLORS[newOrder % AVAILABLE_COLORS.length].hex,
            childType: null,
            childLabel: null,
            isNew: true
        };

        const newLevels = [...levels, newLevel];
        recalculateLevelRelationships(newLevels);
        setLevels(newLevels);
    };

    const handleRemoveLevel = (index: number) => {
        if (!confirm(`Remove level "${levels[index].description}"? Existing units of this type will need to be re-assigned.`)) return;
        const newLevels = levels.filter((_, i) => i !== index);
        recalculateLevelRelationships(newLevels);
        setLevels(newLevels);
    };

    const handleMoveUp = (index: number) => {
        if (index === 0) return;
        const newLevels = [...levels];
        [newLevels[index - 1], newLevels[index]] = [newLevels[index], newLevels[index - 1]];
        recalculateLevelRelationships(newLevels);
        setLevels(newLevels);
    };

    const handleMoveDown = (index: number) => {
        if (index === levels.length - 1) return;
        const newLevels = [...levels];
        [newLevels[index], newLevels[index + 1]] = [newLevels[index + 1], newLevels[index]];
        recalculateLevelRelationships(newLevels);
        setLevels(newLevels);
    };

    const recalculateLevelRelationships = (lvls: OrgLevel[]) => {
        lvls.forEach((lvl, idx) => {
            lvl.sortOrder = idx + 1;
            if (idx < lvls.length - 1) {
                lvl.childType = lvls[idx + 1].code;
                lvl.childLabel = `Add ${lvls[idx + 1].description}`;
            } else {
                lvl.childType = null;
                lvl.childLabel = null;
            }
        });
    };

    const handleUpdateLevel = (index: number, field: keyof OrgLevel, value: string) => {
        const newLevels = [...levels];
        (newLevels[index] as any)[field] = value;

        // If description changed, update parent's childLabel
        if (field === 'description' && index > 0) {
            newLevels[index - 1].childLabel = `Add ${value}`;
        }

        // If code changed, update parent's childType
        if (field === 'code' && index > 0) {
            newLevels[index - 1].childType = value;
        }

        setLevels(newLevels);
    };

    const handleApplyTemplate = () => {
        if (levels.length > 0 && !confirm('This will replace your current hierarchy configuration with the industry-standard template (Site → Division → Department → Section → Team). Continue?')) return;
        setLevels(INDUSTRY_TEMPLATE.map(l => ({ ...l, isNew: true })));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const db = DatabaseService.getInstance();

            // Recalculate relationships before saving
            recalculateLevelRelationships(levels);

            // Get all existing ORG_LEVEL entries from database
            const dictionaries = await db.getDictionaries();
            const existingLevels = dictionaries.filter((d: any) => d.type === 'ORG_LEVEL');

            // Find levels that were deleted
            const currentCodes = new Set(levels.map(l => l.code.toUpperCase()));
            const levelsToDelete = existingLevels.filter((e: any) => !currentCodes.has(e.code.toUpperCase()));

            // Delete removed levels
            for (const toDelete of levelsToDelete) {
                await db.deleteDictionary(toDelete.id);
            }

            // Save each level using UPSERT
            for (const level of levels) {
                const entry = {
                    type: 'ORG_LEVEL',
                    code: level.code.toUpperCase(),
                    description: level.description,
                    is_locked: false,
                    active: true,
                    metadata: {
                        sort_order: level.sortOrder,
                        color: level.color,
                        child_type: level.childType,
                        child_label: level.childLabel
                    }
                };
                await db.upsertDictionary(entry);
            }

            onSave();
            onClose();
        } catch (err: any) {
            console.error('Failed to save levels:', err);
            alert(`Failed to save hierarchy levels: ${err?.message || 'Unknown error'}\n\nPlease check that database migrations are applied.`);
        } finally {
            setSaving(false);
        }
    };

    const handleResyncTypes = async () => {
        if (!confirm('This will update ALL organization unit types based on their depth in the hierarchy. Units at root become the first level, their children become the second level, etc. Continue?')) return;

        setSyncing(true);
        try {
            const db = DatabaseService.getInstance();
            const result = await db.resyncOrgUnitTypes();

            if (result.errors.length > 0) {
                alert(`Re-sync completed with errors:\nUpdated: ${result.updated}\nErrors: ${result.errors.join('\n')}`);
            } else {
                alert(`Re-sync completed successfully!\nUpdated: ${result.updated} organization units.`);
            }
            onSave();
        } catch (err: any) {
            console.error('Failed to resync types:', err);
            alert(`Failed to re-sync types: ${err?.message || 'Unknown error'}`);
        } finally {
            setSyncing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                            Configure Hierarchy Levels
                        </h2>
                        <p className="text-xs text-gray-500 mt-0.5">Define how your organization is structured from top to bottom</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-auto p-6">
                    {/* Industry Template Button */}
                    <div className="mb-5 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Factory size={16} className="text-blue-600" />
                                <span className="text-sm font-medium text-blue-800 dark:text-blue-300">Industry Standard (ISO 55000)</span>
                            </div>
                            <button
                                onClick={handleApplyTemplate}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-500 transition-colors"
                            >
                                <RotateCcw size={12} />
                                Apply Template
                            </button>
                        </div>
                        <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1.5">
                            Site → Division → Department → Section → Team
                        </p>
                    </div>

                    {/* Visual Chain Preview */}
                    {levels.length > 0 && (
                        <div className="mb-4 flex items-center gap-1 overflow-x-auto py-2 px-1">
                            {levels.map((level, idx) => (
                                <React.Fragment key={level.code + idx}>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap border"
                                        style={{
                                            backgroundColor: level.color + '15',
                                            borderColor: level.color + '40',
                                            color: level.color
                                        }}
                                    >
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: level.color }} />
                                        {level.description}
                                    </div>
                                    {idx < levels.length - 1 && (
                                        <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                                    )}
                                </React.Fragment>
                            ))}
                            <span className="text-[10px] text-gray-400 ml-1 whitespace-nowrap">→ People</span>
                        </div>
                    )}

                    {/* Level List */}
                    <div className="space-y-2">
                        {levels.map((level, index) => (
                            <div
                                key={level.code + index}
                                className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600"
                            >
                                {/* Reorder Buttons */}
                                <div className="flex flex-col gap-0.5">
                                    <button onClick={() => handleMoveUp(index)} disabled={index === 0}
                                        className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded disabled:opacity-30">
                                        <ChevronUp size={14} />
                                    </button>
                                    <button onClick={() => handleMoveDown(index)} disabled={index === levels.length - 1}
                                        className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded disabled:opacity-30">
                                        <ChevronDown size={14} />
                                    </button>
                                </div>

                                {/* Level Number with Color */}
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                                    style={{ backgroundColor: level.color }}>
                                    {index + 1}
                                </div>

                                {/* Name Input */}
                                <input
                                    type="text"
                                    value={level.description}
                                    onChange={(e) => handleUpdateLevel(index, 'description', e.target.value)}
                                    placeholder="Level Name"
                                    className="flex-1 px-2.5 py-1.5 border border-gray-300 dark:border-gray-500 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm min-w-0"
                                />

                                {/* Code Input */}
                                <input
                                    type="text"
                                    value={level.code}
                                    onChange={(e) => handleUpdateLevel(index, 'code', e.target.value.toUpperCase().replace(/\s/g, '_'))}
                                    placeholder="CODE"
                                    className="w-28 px-2.5 py-1.5 border border-gray-300 dark:border-gray-500 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-mono uppercase"
                                />

                                {/* Color Picker */}
                                <select
                                    value={level.color}
                                    onChange={(e) => handleUpdateLevel(index, 'color', e.target.value)}
                                    className="w-24 px-1.5 py-1.5 border border-gray-300 dark:border-gray-500 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm"
                                >
                                    {AVAILABLE_COLORS.map(c => (
                                        <option key={c.hex} value={c.hex}>{c.label}</option>
                                    ))}
                                </select>

                                {/* Child Type (read-only) */}
                                <span className="text-[10px] text-gray-400 w-16 text-center flex-shrink-0 truncate" title={level.childType ? `→ ${level.childType}` : 'Leaf'}>
                                    {level.childType ? `→ ${level.childType}` : '(leaf)'}
                                </span>

                                {/* Delete Button */}
                                <button onClick={() => handleRemoveLevel(index)}
                                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded flex-shrink-0">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Add Level Button */}
                    <button
                        onClick={handleAddLevel}
                        className="mt-3 flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg text-sm font-medium w-full justify-center border-2 border-dashed border-blue-200 dark:border-blue-800"
                    >
                        <Plus size={16} />
                        Add Custom Level
                    </button>
                </div>

                {/* Footer */}
                <div className="flex justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <button
                        onClick={handleResyncTypes}
                        disabled={syncing || saving}
                        className="px-3 py-2 bg-amber-500 text-white hover:bg-amber-600 rounded-lg text-xs font-medium disabled:opacity-50"
                        title="Update all organization unit types based on their depth"
                    >
                        {syncing ? 'Syncing...' : '🔄 Re-sync Unit Types'}
                    </button>
                    <div className="flex gap-3">
                        <button onClick={onClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium">
                            Cancel
                        </button>
                        <button onClick={handleSave} disabled={saving || levels.length === 0}
                            className="px-4 py-2 bg-primary-600 text-white hover:bg-primary-500 rounded-lg text-sm font-medium disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
