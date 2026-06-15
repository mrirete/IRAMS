import React, { useState, useEffect } from 'react';
import { OrganizationUnit, OrgUnitType } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { AlertTriangle } from 'lucide-react';

interface OrgUnitModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    unit?: OrganizationUnit; // If editing
    parentUnit?: OrganizationUnit; // If adding child
}

export const OrgUnitModal: React.FC<OrgUnitModalProps> = ({ isOpen, onClose, onSave, unit, parentUnit }) => {
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [type, setType] = useState<OrgUnitType>('DIVISION');
    const [managerId, setManagerId] = useState<string>('');
    const [description, setDescription] = useState('');
    const [selectedParentId, setSelectedParentId] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [potentialManagers, setPotentialManagers] = useState<any[]>([]);
    const [orgLevels, setOrgLevels] = useState<any[]>([]);
    const [allUnits, setAllUnits] = useState<OrganizationUnit[]>([]);

    useEffect(() => {
        if (isOpen) {
            loadManagers();
            loadOrgLevels();
            loadAllUnits();
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && orgLevels.length > 0) {
            if (unit) {
                // ── EDITING ──
                setName(unit.name);
                setCode(unit.code);
                setType(unit.type);
                setManagerId(unit.managerId || '');
                setDescription(unit.description || '');
                setSelectedParentId(unit.parentId || '');
            } else {
                // ── CREATING NEW ──
                setName('');
                setManagerId('');
                setDescription('');
                setSelectedParentId(parentUnit?.id || '');

                if (parentUnit) {
                    const parentLevel = orgLevels.find(l => l.code === parentUnit.type);
                    if (parentLevel?.childType) {
                        setType(parentLevel.childType as OrgUnitType);
                    } else {
                        const parentIdx = orgLevels.findIndex(l => l.code === parentUnit.type);
                        if (parentIdx >= 0 && parentIdx < orgLevels.length - 1) {
                            setType(orgLevels[parentIdx + 1].code as OrgUnitType);
                        } else {
                            setType(orgLevels[orgLevels.length - 1]?.code || 'TEAM');
                        }
                    }
                } else {
                    setType((orgLevels[0]?.code || 'DIVISION') as OrgUnitType);
                }

                // Auto-generate code prefix from parent
                if (parentUnit?.code) {
                    setCode(parentUnit.code + '-');
                } else {
                    setCode('');
                }
            }
        }
    }, [isOpen, unit, parentUnit, orgLevels]);

    const loadOrgLevels = async () => {
        try {
            const dictionaries = await DatabaseService.getInstance().getDictionaries();
            const levels = dictionaries
                .filter((d: any) => d.type === 'ORG_LEVEL' && d.active !== false)
                .map((d: any) => ({
                    code: d.code,
                    description: d.description,
                    sortOrder: d.metadata?.sort_order ?? 99,
                    childType: d.metadata?.child_type ?? null
                }))
                .sort((a: any, b: any) => a.sortOrder - b.sortOrder);
            setOrgLevels(levels);
        } catch (err) {
            console.error('Failed to load org levels:', err);
        }
    };

    const loadManagers = async () => {
        const contacts = await DatabaseService.getInstance().getContacts();
        setPotentialManagers(contacts.filter(c => c.active && !c.flags?.isVendor));
    };

    const loadAllUnits = async () => {
        try {
            const units = await DatabaseService.getInstance().getOrgUnits();
            setAllUnits(units);
        } catch (err) {
            console.error('Failed to load org units:', err);
        }
    };

    // Build indented label for parent dropdown — shows hierarchy path
    const getUnitLabel = (u: OrganizationUnit): string => {
        let depth = 0;
        let current = u;
        while (current.parentId) {
            const parent = allUnits.find(p => p.id === current.parentId);
            if (!parent) break;
            current = parent;
            depth++;
        }
        const indent = '\u00A0\u00A0'.repeat(depth); // Non-breaking spaces for indent
        const levelLabel = orgLevels.find(l => l.code === u.type)?.description || u.type;
        return `${indent}${u.name} (${levelLabel})`;
    };

    // Filter out the unit itself + its descendants to prevent circular parenting
    const getDescendantIds = (unitId: string): Set<string> => {
        const ids = new Set<string>();
        const walk = (id: string) => {
            ids.add(id);
            allUnits.filter(u => u.parentId === id).forEach(child => walk(child.id));
        };
        walk(unitId);
        return ids;
    };

    const availableParents = unit
        ? (() => {
            const excludeIds = getDescendantIds(unit.id);
            return allUnits
                .filter(u => !excludeIds.has(u.id))
                .sort((a, b) => {
                    // Sort by hierarchy path for intuitive ordering
                    const pathA = getUnitPath(a);
                    const pathB = getUnitPath(b);
                    return pathA.localeCompare(pathB);
                });
        })()
        : allUnits;

    // Get a sortable path string for a unit
    function getUnitPath(u: OrganizationUnit): string {
        const parts: string[] = [];
        let current: OrganizationUnit | undefined = u;
        while (current) {
            parts.unshift(current.name);
            current = current.parentId ? allUnits.find(p => p.id === current!.parentId) : undefined;
        }
        return parts.join('/');
    }

    // Detect if parent changed
    const parentChanged = unit && selectedParentId !== (unit.parentId || '');

    const handleSave = async () => {
        try {
            setLoading(true);
            const resolvedParentId = selectedParentId || null;

            const data: OrganizationUnit = {
                id: unit?.id || '',
                name,
                code,
                type,
                parentId: resolvedParentId,
                managerId: managerId || null,
                description: description || undefined
            };

            if (unit) {
                await DatabaseService.getInstance().updateOrgUnit({ ...data, id: unit.id });
            } else {
                await DatabaseService.getInstance().addOrgUnit(data);
            }

            // Re-sync types after parent change to keep hierarchy consistent
            if (parentChanged) {
                try {
                    await DatabaseService.getInstance().resyncOrgUnitTypes();
                } catch (e) {
                    console.warn('Type resync after re-parent failed (non-critical):', e);
                }
            }

            onSave();
            onClose();
        } catch (error: any) {
            console.error(error);
            alert(`Failed to save Organization Unit: ${error?.message || 'Unknown error'}`);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl w-[520px] max-h-[90vh] overflow-y-auto p-6 shadow-xl" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4 dark:text-white">
                    {unit ? 'Edit ' : 'Add '}
                    {orgLevels.find(l => l.code === type)?.description || 'Unit'}
                    {parentUnit && !unit && <span className="text-sm font-normal text-gray-500 ml-2">in {parentUnit.name}</span>}
                </h2>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none"
                            placeholder="e.g. Operations"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">Code</label>
                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none font-mono"
                            placeholder="e.g. OPS"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Type</label>
                            <select
                                value={type}
                                onChange={(e) => setType(e.target.value as OrgUnitType)}
                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
                                disabled={true}
                            >
                                {orgLevels.map(level => (
                                    <option key={level.code} value={level.code}>{level.description}</option>
                                ))}
                            </select>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                                {unit
                                    ? 'Type is determined by hierarchy position'
                                    : parentUnit
                                        ? `Determined by parent (${parentUnit.name})`
                                        : 'Root level — first in hierarchy'
                                }
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Manager</label>
                            <select
                                value={managerId}
                                onChange={(e) => setManagerId(e.target.value)}
                                className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none"
                            >
                                <option value="">-- None --</option>
                                {potentialManagers.map(m => (
                                    <option key={m.id} value={m.id}>{m.name} ({m.title})</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* ══ PARENT REASSIGNMENT ══ */}
                    <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">
                            Parent Unit
                            {unit && <span className="text-xs text-gray-400 ml-1 font-normal">(change to move this unit)</span>}
                        </label>
                        <select
                            value={selectedParentId}
                            onChange={(e) => setSelectedParentId(e.target.value)}
                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none"
                        >
                            <option value="">── Root (No Parent) ──</option>
                            {availableParents.map(u => (
                                <option key={u.id} value={u.id}>{getUnitLabel(u)}</option>
                            ))}
                        </select>

                        {/* Warning when parent is being changed */}
                        {parentChanged && (
                            <div className="mt-2 flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300">
                                <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                                <span>
                                    Moving <strong>{unit?.name}</strong> from
                                    {unit?.parentId
                                        ? <> <strong>{allUnits.find(u => u.id === unit.parentId)?.name || 'unknown'}</strong></>
                                        : ' Root'
                                    }
                                    {' → '}
                                    {selectedParentId
                                        ? <strong>{allUnits.find(u => u.id === selectedParentId)?.name || 'unknown'}</strong>
                                        : 'Root'
                                    }
                                    . All child units will move with it.
                                </span>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1 dark:text-gray-300">Description <span className="text-gray-400 font-normal">(optional)</span></label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full p-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none"
                            rows={2}
                            placeholder="Brief description of this organizational unit"
                        />
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading || !name || !code}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 disabled:opacity-50 transition-colors font-medium"
                    >
                        {loading ? 'Saving...' : (parentChanged ? 'Save & Move' : 'Save')}
                    </button>
                </div>
            </div>
        </div>
    );
};
