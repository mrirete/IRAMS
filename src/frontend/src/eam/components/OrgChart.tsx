import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DatabaseService } from '../services/DatabaseService';
import { OrganizationUnit } from '../types';
import { OrgUnitModal } from './OrgUnitModal';
import { AddMemberModal } from './modals/AddMemberModal';
import {
    Plus, Edit2, Trash2, Users, ChevronRight, UserPlus, UserMinus,
    Settings, X, Smartphone, FolderOpen, Folder, Home, ArrowLeft,
    MoreHorizontal, Building2, Network
} from 'lucide-react';
import { Contact } from '../types';

import { OrgUnitDetailsDrawer } from './OrgUnitDetailsDrawer';
import { DraggableUserList } from './DraggableUserList';
import { OrgLevelSettingsModal } from './OrgLevelSettingsModal';

// Type for ORG_LEVEL dictionary entry
interface OrgLevel {
    code: string;
    description: string;
    sortOrder: number;
    color: string;
    childType: string | null;
    childLabel: string | null;
}

// Color utility – maps level color names to Tailwind classes
const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string; badge: string; accent: string; hover: string }> = {
    '#3b82f6': { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700', accent: 'text-blue-600', hover: 'hover:bg-blue-100/60 dark:hover:bg-blue-900/40' },
    '#8b5cf6': { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700', accent: 'text-blue-600', hover: 'hover:bg-blue-100/60 dark:hover:bg-blue-900/40' },
    '#f59e0b': { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800', badge: 'bg-amber-100 text-amber-700', accent: 'text-amber-600', hover: 'hover:bg-amber-100/60 dark:hover:bg-amber-900/40' },
    '#10b981': { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800', badge: 'bg-emerald-100 text-emerald-700', accent: 'text-emerald-600', hover: 'hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40' },
    '#6366f1': { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700', accent: 'text-blue-600', hover: 'hover:bg-blue-100/60 dark:hover:bg-blue-900/40' },
    // Legacy named colors
    indigo: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700', accent: 'text-blue-600', hover: 'hover:bg-blue-100/60' },
    blue: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700', accent: 'text-blue-600', hover: 'hover:bg-blue-100/60' },
    green: { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-300', border: 'border-green-200 dark:border-green-800', badge: 'bg-green-100 text-green-700', accent: 'text-green-600', hover: 'hover:bg-green-100/60' },
    purple: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 text-blue-700', accent: 'text-blue-600', hover: 'hover:bg-blue-100/60' },
    amber: { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800', badge: 'bg-amber-100 text-amber-700', accent: 'text-amber-600', hover: 'hover:bg-amber-100/60' },
    rose: { bg: 'bg-rose-50 dark:bg-rose-900/20', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-800', badge: 'bg-rose-100 text-rose-700', accent: 'text-rose-600', hover: 'hover:bg-rose-100/60' },
    teal: { bg: 'bg-teal-50 dark:bg-teal-900/20', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200 dark:border-teal-800', badge: 'bg-teal-100 text-teal-700', accent: 'text-teal-600', hover: 'hover:bg-teal-100/60' },
    gray: { bg: 'bg-gray-50 dark:bg-gray-900/20', text: 'text-gray-700 dark:text-gray-300', border: 'border-gray-200 dark:border-gray-800', badge: 'bg-gray-100 text-gray-700', accent: 'text-gray-600', hover: 'hover:bg-gray-100/60' },
};

const getLevelColors = (color: string) => LEVEL_COLORS[color] || LEVEL_COLORS.gray;

export const OrgChart: React.FC = () => {
    // All org units flat
    const [allUnits, setAllUnits] = useState<OrganizationUnit[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState<OrganizationUnit | undefined>(undefined);
    const [targetParent, setTargetParent] = useState<OrganizationUnit | undefined>(undefined);
    const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
    const [targetUnitForMember, setTargetUnitForMember] = useState<OrganizationUnit | undefined>(undefined);

    // Drawer
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [selectedUnitForDetails, setSelectedUnitForDetails] = useState<OrganizationUnit | null>(null);

    // User list sidebar
    const [showUserList, setShowUserList] = useState(false);
    const [userListRefreshKey, setUserListRefreshKey] = useState(0);

    // Dynamic Org Levels
    const [orgLevels, setOrgLevels] = useState<OrgLevel[]>([]);
    const [stats, setStats] = useState<Record<string, number>>({});

    // Member counts and cache per unit
    const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
    const [unitMembers, setUnitMembers] = useState<Record<string, Contact[]>>({});

    // Expanded members per unit-card
    const [expandedMembers, setExpandedMembers] = useState<Record<string, boolean>>({});

    // DnD
    const [dragOverId, setDragOverId] = useState<string | null>(null);

    // Mobile assign
    const [selectedContactForAssign, setSelectedContactForAssign] = useState<{ id: string; name: string } | null>(null);
    const [isMobileAssignMode, setIsMobileAssignMode] = useState(false);

    // Settings
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Confirmation modal (delete unit / remove member)
    const [confirmAction, setConfirmAction] = useState<{
        type: 'delete-unit' | 'remove-member';
        id: string;
        name: string;
        message: string;
        contactId?: string;
        unitId?: string;
        unitName?: string;
    } | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);

    // ═══ VIEW MODE ═══
    const [viewMode, setViewMode] = useState<'folder' | 'tree'>('folder');

    // ═══ FOLDER NAVIGATION STATE ═══
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null); // null = root

    // Build lookup map
    const unitMap = useMemo(() => {
        const m = new Map<string, OrganizationUnit>();
        allUnits.forEach(u => m.set(u.id, u));
        return m;
    }, [allUnits]);

    // Compute breadcrumb path from currentFolder up to root
    const breadcrumbs = useMemo(() => {
        const path: OrganizationUnit[] = [];
        let id = currentFolderId;
        while (id && unitMap.has(id)) {
            const unit = unitMap.get(id)!;
            path.unshift(unit);
            id = unit.parentId || null;
        }
        return path;
    }, [currentFolderId, unitMap]);

    // Get children of current folder
    const currentChildren = useMemo(() => {
        if (!currentFolderId) {
            // Root: show units with no parent
            return allUnits.filter(u => !u.parentId);
        }
        return allUnits.filter(u => u.parentId === currentFolderId);
    }, [allUnits, currentFolderId]);

    const currentFolder = currentFolderId ? unitMap.get(currentFolderId) || null : null;

    // Count children recursively
    const getDescendantCount = useCallback((unitId: string): number => {
        const directChildren = allUnits.filter(u => u.parentId === unitId);
        return directChildren.length + directChildren.reduce((sum, c) => sum + getDescendantCount(c.id), 0);
    }, [allUnits]);

    // Count direct children
    const getDirectChildCount = useCallback((unitId: string): number => {
        return allUnits.filter(u => u.parentId === unitId).length;
    }, [allUnits]);

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const db = DatabaseService.getInstance();

            // Load ORG_LEVEL dictionaries
            const dictionaries = await db.getDictionaries();
            const levelDicts = dictionaries
                .filter((d: any) => d.type === 'ORG_LEVEL' && d.active !== false)
                .map((d: any) => ({
                    code: d.code,
                    description: d.description,
                    sortOrder: d.metadata?.sort_order ?? 99,
                    color: d.metadata?.color ?? d.colorCode ?? 'gray',
                    childType: d.metadata?.child_type ?? null,
                    childLabel: d.metadata?.child_label ?? null
                }))
                .sort((a: OrgLevel, b: OrgLevel) => a.sortOrder - b.sortOrder);
            setOrgLevels(levelDicts);

            // Load all units flat
            const data = await db.getOrgUnits();
            setAllUnits(data);

            // Stats
            const newStats: Record<string, number> = {};
            levelDicts.forEach((lvl: OrgLevel) => {
                newStats[lvl.code] = data.filter((u: OrganizationUnit) => u.type === lvl.code).length;
            });
            setStats(newStats);

            // Member counts + cache
            const counts: Record<string, number> = {};
            const membersCache: Record<string, Contact[]> = {};
            await Promise.all(data.map(async (u: OrganizationUnit) => {
                try {
                    const members = await db.getContactsByUnit(u.id);
                    counts[u.id] = members.length;
                    membersCache[u.id] = members;
                } catch { counts[u.id] = 0; membersCache[u.id] = []; }
            }));
            setMemberCounts(counts);
            setUnitMembers(membersCache);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // ═══ NAVIGATION ═══
    const navigateToFolder = (unitId: string | null) => {
        setCurrentFolderId(unitId);
        setExpandedMembers({});
    };

    // ═══ CRUD HANDLERS ═══
    const handleAddChild = (parent?: OrganizationUnit) => {
        setSelectedUnit(undefined);
        setTargetParent(parent);
        setIsModalOpen(true);
    };

    const handleEdit = (unit: OrganizationUnit) => {
        setSelectedUnit(unit);
        setTargetParent(undefined);
        setIsModalOpen(true);
    };

    const handleDelete = (id: string, name: string) => {
        const childCount = getDirectChildCount(id);
        const mCount = memberCounts[id] || 0;
        let message = `Are you sure you want to delete "${name}"?`;
        if (childCount > 0) message += `\n\n⚠ This will also remove ${childCount} child unit${childCount > 1 ? 's' : ''}.`;
        if (mCount > 0) message += `\n${mCount} member${mCount > 1 ? 's' : ''} will be unassigned.`;
        setConfirmAction({ type: 'delete-unit', id, name, message });
    };

    const handleRemoveMember = (member: Contact, unit: OrganizationUnit) => {
        setConfirmAction({
            type: 'remove-member',
            id: member.id,
            name: member.name || `${member.firstName} ${member.lastName}`,
            message: `Remove "${member.name}" from "${unit.name}"?\n\nThis person will be unassigned from this organizational unit.`,
            contactId: member.id,
            unitId: unit.id,
            unitName: unit.name,
        });
    };

    const executeConfirmAction = async () => {
        if (!confirmAction) return;
        setIsConfirming(true);
        try {
            const db = DatabaseService.getInstance();
            if (confirmAction.type === 'delete-unit') {
                await db.deleteOrgUnit(confirmAction.id);
            } else if (confirmAction.type === 'remove-member' && confirmAction.contactId) {
                await db.assignContactsToUnit([confirmAction.contactId], null);
                if (confirmAction.unitId) {
                    setMemberCounts(prev => ({ ...prev, [confirmAction.unitId!]: Math.max(0, (prev[confirmAction.unitId!] || 1) - 1) }));
                    setUnitMembers(prev => ({ ...prev, [confirmAction.unitId!]: (prev[confirmAction.unitId!] || []).filter(m => m.id !== confirmAction.contactId) }));
                    setUserListRefreshKey(k => k + 1);
                }
            }
            setConfirmAction(null);
            loadData();
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        } finally {
            setIsConfirming(false);
        }
    };

    const handleAddMember = (unit: OrganizationUnit) => {
        setTargetUnitForMember(unit);
        setIsAddMemberOpen(true);
    };

    const handleOpenDetails = (unit: OrganizationUnit) => {
        setSelectedUnitForDetails(unit);
        setIsDrawerOpen(true);
    };

    // ═══ DnD ═══
    const handleDragOver = (e: React.DragEvent, unitId: string) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setDragOverId(unitId);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.stopPropagation();
        setDragOverId(null);
    };

    const handleDrop = async (e: React.DragEvent, targetUnit: OrganizationUnit) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverId(null);
        const data = e.dataTransfer.getData('application/json');
        if (!data) return;

        try {
            const { contactId, name, sourceUnitId } = JSON.parse(data);
            if (sourceUnitId && sourceUnitId === targetUnit.id) return;

            const db = DatabaseService.getInstance();
            const hasAccess = await db.checkUserAccess(contactId, targetUnit.id);
            if (!hasAccess) {
                const proceed = confirm(`⚠️ No explicit permission found for '${name}' on '${targetUnit.name}'.\n\nAssign anyway?`);
                if (!proceed) return;
            }

            await db.assignContactsToUnit([contactId], targetUnit.id);

            // Optimistic updates
            setMemberCounts(prev => {
                const updated = { ...prev, [targetUnit.id]: (prev[targetUnit.id] || 0) + 1 };
                if (sourceUnitId && sourceUnitId !== targetUnit.id) {
                    updated[sourceUnitId] = Math.max(0, (prev[sourceUnitId] || 1) - 1);
                }
                return updated;
            });

            if (sourceUnitId && sourceUnitId !== targetUnit.id) {
                setUnitMembers(prev => {
                    const movedMember = (prev[sourceUnitId] || []).find(m => m.id === contactId);
                    const updated: Record<string, Contact[]> = { ...prev, [sourceUnitId]: (prev[sourceUnitId] || []).filter(m => m.id !== contactId) };
                    if (movedMember) updated[targetUnit.id] = [...(prev[targetUnit.id] || []), movedMember];
                    return updated;
                });
            } else {
                setUnitMembers(prev => {
                    const already = (prev[targetUnit.id] || []).some(m => m.id === contactId);
                    if (!already) {
                        return { ...prev, [targetUnit.id]: [...(prev[targetUnit.id] || []), { id: contactId, name, firstName: name.split(' ')[0] || '', lastName: name.split(' ')[1] || '' } as any] };
                    }
                    return prev;
                });
            }

            setExpandedMembers(prev => ({ ...prev, [targetUnit.id]: true }));
            setUserListRefreshKey(k => k + 1);
            loadData();
        } catch (err) {
            console.error(err);
            alert("Failed to assign user.");
        }
    };

    // Mobile assign
    const handleMobileAssign = async (targetUnit: OrganizationUnit) => {
        if (!selectedContactForAssign) return;
        try {
            const db = DatabaseService.getInstance();
            await db.assignContactsToUnit([selectedContactForAssign.id], targetUnit.id);
            setMemberCounts(prev => ({ ...prev, [targetUnit.id]: (prev[targetUnit.id] || 0) + 1 }));
            setUserListRefreshKey(k => k + 1);
            setSelectedContactForAssign(null);
            loadData();
        } catch (err) {
            console.error(err);
            alert('Failed to assign user.');
        }
    };

    // ═══ RENDERING ═══

    if (loading) return (
        <div className="flex items-center justify-center h-64 gap-3 text-gray-500">
            <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            Loading Organization Structure...
        </div>
    );

    // Current level config
    const currentLevelConfig = currentFolder ? orgLevels.find(l => l.code === currentFolder.type) : null;
    const childLevelConfig = currentLevelConfig
        ? orgLevels.find(l => l.code === currentLevelConfig.childType)
        : orgLevels[0] || null;

    // Label for "New ___" button
    const addLabel = currentFolder
        ? (childLevelConfig?.description || 'Sub-unit')
        : (orgLevels[0]?.description || 'Division');

    return (
        <div className="w-full flex flex-col items-center py-6 px-4 sm:px-8 bg-white dark:bg-gray-900 min-h-full">
            <div className="w-full max-w-7xl space-y-6">

                {/* ═══ STATS ROW ═══ */}
                <div className="w-full flex justify-center gap-4 sm:gap-6 flex-wrap">
                    {orgLevels.map(level => {
                        const colors = getLevelColors(level.color);
                        return (
                            <div key={level.code}
                                className={`w-36 sm:w-44 ${colors.bg} border ${colors.border} px-4 py-3 rounded-xl shadow-sm flex flex-col items-center justify-center transition-all hover:scale-105 hover:shadow-md cursor-default`}>
                                <div className={`text-[10px] font-bold ${colors.text} uppercase tracking-wider mb-0.5`}>{level.description}s</div>
                                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stats[level.code] || 0}</div>
                            </div>
                        );
                    })}
                    {/* Total people stat */}
                    <div className="w-36 sm:w-44 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 px-4 py-3 rounded-xl shadow-sm flex flex-col items-center justify-center">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">People</div>
                        <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{Object.values(memberCounts).reduce((s, n) => s + n, 0)}</div>
                    </div>
                </div>

                {/* ═══ TOOLBAR ═══ */}
                <div className="flex justify-between items-center gap-4 flex-wrap">
                    {/* Breadcrumbs */}
                    <div className="flex items-center gap-1 text-sm overflow-x-auto">
                        <button
                            onClick={() => navigateToFolder(null)}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors font-medium min-w-fit ${!currentFolderId
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                                }`}
                        >
                            <Home size={14} />
                            <span className="hidden sm:inline">Organization</span>
                        </button>

                        {breadcrumbs.map((crumb, idx) => {
                            const isLast = idx === breadcrumbs.length - 1;
                            const lvl = orgLevels.find(l => l.code === crumb.type);
                            const colors = getLevelColors(lvl?.color || 'gray');
                            return (
                                <React.Fragment key={crumb.id}>
                                    <ChevronRight size={14} className="text-gray-300 flex-shrink-0" />
                                    <button
                                        onClick={() => !isLast && navigateToFolder(crumb.id)}
                                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors font-medium min-w-fit ${isLast
                                            ? `${colors.bg} ${colors.text} border ${colors.border}`
                                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800'
                                            }`}
                                    >
                                        {isLast ? <FolderOpen size={14} /> : <Folder size={14} />}
                                        {crumb.name}
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Back button when in folder */}
                        {currentFolderId && (
                            <button
                                onClick={() => navigateToFolder(currentFolder?.parentId || null)}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                                <ArrowLeft size={14} /> Back
                            </button>
                        )}

                        {/* Mobile Assign */}
                        <button
                            onClick={() => {
                                setIsMobileAssignMode(!isMobileAssignMode);
                                if (isMobileAssignMode) setSelectedContactForAssign(null);
                                else setShowUserList(true);
                            }}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors md:hidden ${isMobileAssignMode ? 'bg-green-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                                }`}
                        >
                            <Smartphone size={14} />
                            {isMobileAssignMode ? 'Exit Assign' : 'Tap Assign'}
                        </button>

                        {/* Assign People */}
                        <button
                            onClick={() => setShowUserList(!showUserList)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors ${showUserList ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'}`}
                        >
                            <Users size={14} />
                            {showUserList ? 'Hide People' : 'People'}
                        </button>

                        {/* New unit – at root always show; inside folder only if non-leaf */}
                        {(!currentFolder || childLevelConfig) && (
                            <button
                                onClick={() => handleAddChild(currentFolder || undefined)}
                                className="flex items-center gap-1.5 px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 text-sm font-medium shadow-sm transition-colors"
                            >
                                <Plus size={14} /> New {addLabel}
                            </button>
                        )}

                        {/* View Toggle */}
                        <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg overflow-hidden shadow-sm">
                            <button
                                onClick={() => setViewMode('folder')}
                                className={`p-2 transition-colors ${viewMode === 'folder' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                                title="Folder View"
                            >
                                <Folder size={16} />
                            </button>
                            <button
                                onClick={() => setViewMode('tree')}
                                className={`p-2 transition-colors ${viewMode === 'tree' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                                title="Tree View"
                            >
                                <Network size={16} />
                            </button>
                        </div>

                        {/* Settings */}
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className="p-2 text-gray-500 hover:text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400"
                            title="Configure Hierarchy Levels"
                        >
                            <Settings size={16} />
                        </button>
                    </div>
                </div>

                {/* ═══ CONTENT AREA ═══ */}
                {viewMode === 'tree' ? (
                    /* ═══ TREE VIEW ═══ */
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 overflow-x-auto">
                        <div className="min-w-[400px]">
                            {allUnits.filter(u => !u.parentId).length === 0 ? (
                                <div className="text-center py-12 text-gray-400">
                                    <Network size={48} className="mx-auto mb-3 opacity-40" />
                                    <p className="font-medium">No organization structure yet</p>
                                    <p className="text-sm mt-1">Create your first {orgLevels[0]?.description || 'unit'} to get started</p>
                                </div>
                            ) : (
                                allUnits.filter(u => !u.parentId).map(rootUnit => {
                                    const renderTreeNode = (unit: OrganizationUnit, depth: number, isLast: boolean, parentLines: boolean[]): React.ReactNode => {
                                        const lvl = orgLevels.find(l => l.code === unit.type);
                                        const colors = getLevelColors(lvl?.color || 'gray');
                                        const children = allUnits.filter(u => u.parentId === unit.id);
                                        const mCount = memberCounts[unit.id] || 0;

                                        return (
                                            <div key={unit.id} className="select-none">
                                                <div className="flex items-stretch">
                                                    {/* Connector lines for ancestry */}
                                                    {depth > 0 && parentLines.map((showLine, idx) => (
                                                        <div key={idx} className="w-6 flex-shrink-0 relative">
                                                            {showLine && (
                                                                <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
                                                            )}
                                                        </div>
                                                    ))}
                                                    {depth > 0 && (
                                                        <div className="w-6 flex-shrink-0 relative">
                                                            <div className="absolute left-3 top-0 h-1/2 w-px bg-gray-200 dark:bg-gray-700" />
                                                            <div className="absolute left-3 top-1/2 w-3 h-px bg-gray-200 dark:bg-gray-700" />
                                                            {!isLast && (
                                                                <div className="absolute left-3 top-1/2 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Node content */}
                                                    <div
                                                        className={`flex items-center gap-2 px-3 py-2 my-0.5 rounded-lg border ${colors.border} ${colors.bg} ${colors.hover} cursor-pointer transition-all group flex-1 min-w-0`}
                                                        onClick={() => { setViewMode('folder'); navigateToFolder(unit.id); }}
                                                    >
                                                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: lvl?.color || '#6b7280' }} />
                                                        <div className="min-w-0 flex-1">
                                                            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate block">{unit.name}</span>
                                                        </div>
                                                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${colors.badge} flex-shrink-0`}>
                                                            {lvl?.description || unit.type}
                                                        </span>
                                                        <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{unit.code}</span>
                                                        {mCount > 0 && (
                                                            <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 flex-shrink-0">
                                                                <Users size={10} /> {mCount}
                                                            </span>
                                                        )}
                                                        {children.length > 0 && (
                                                            <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400 flex-shrink-0">
                                                                <Folder size={10} /> {children.length}
                                                            </span>
                                                        )}
                                                        <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                                                            <button onClick={(e) => { e.stopPropagation(); handleEdit(unit); }} className="p-1 text-gray-400 hover:text-gray-700 hover:bg-white/60 rounded">
                                                                <Edit2 size={12} />
                                                            </button>
                                                            <button onClick={(e) => { e.stopPropagation(); setSelectedUnit(undefined); setTargetParent(unit); setIsModalOpen(true); }} className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Add child">
                                                                <Plus size={12} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                {children.length > 0 && (
                                                    <div>
                                                        {children.map((child, idx) =>
                                                            renderTreeNode(child, depth + 1, idx === children.length - 1, depth > 0 ? [...parentLines, !isLast] : [])
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    };
                                    return renderTreeNode(rootUnit, 0, true, []);
                                })
                            )}
                        </div>
                    </div>
                ) : (
                    /* ═══ FOLDER VIEW ═══ */
                    <>
                        {/* Current folder header */}
                        {currentFolder && (
                            <div className={`border rounded-xl p-4 ${getLevelColors(currentLevelConfig?.color || 'gray').bg} ${getLevelColors(currentLevelConfig?.color || 'gray').border}`}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${getLevelColors(currentLevelConfig?.color || 'gray').badge}`}>
                                            <Building2 size={20} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{currentFolder.name}</h2>
                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${getLevelColors(currentLevelConfig?.color || 'gray').badge}`}>
                                                    {currentLevelConfig?.description || currentFolder.type}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 font-mono">{currentFolder.code}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => handleOpenDetails(currentFolder)} className="p-2 text-gray-500 hover:bg-white/60 rounded-lg transition-colors" title="View Details">
                                            <MoreHorizontal size={16} />
                                        </button>
                                        <button onClick={() => handleEdit(currentFolder)} className="p-2 text-gray-500 hover:bg-white/60 rounded-lg transition-colors" title="Edit">
                                            <Edit2 size={14} />
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
                                    <span className="flex items-center gap-1"><Users size={12} /> {memberCounts[currentFolder.id] || 0} members</span>
                                    <span className="flex items-center gap-1"><Network size={12} /> {getDirectChildCount(currentFolder.id)} {childLevelConfig?.description || 'sub-unit'}s</span>
                                </div>
                            </div>
                        )}

                        {/* Folder contents */}
                        {currentChildren.length === 0 ? (
                            <div className="text-center text-gray-500 py-16 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/50 dark:bg-gray-800/30">
                                <FolderOpen size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-4" />
                                <p className="mb-2 font-medium text-gray-600 dark:text-gray-400">
                                    {currentFolder ? `No ${childLevelConfig?.description || 'sub-unit'}s yet` : 'No organization units defined'}
                                </p>
                                <p className="text-sm text-gray-400 mb-4">
                                    {currentFolder
                                        ? `Add a ${childLevelConfig?.description || 'sub-unit'} inside "${currentFolder.name}"`
                                        : `Create a ${orgLevels[0]?.description || 'Division'} to start building your organization`}
                                </p>
                                <button
                                    onClick={() => handleAddChild(currentFolder || undefined)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                                >
                                    <Plus size={14} /> Add First {addLabel}
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                {currentChildren.map(unit => {
                                    const lvl = orgLevels.find(l => l.code === unit.type);
                                    const colors = getLevelColors(lvl?.color || 'gray');
                                    const lvlIdx = orgLevels.findIndex(l => l.code === unit.type);
                                    const childLvl = lvl?.childType
                                        ? orgLevels.find(l => l.code === lvl.childType)
                                        : (lvlIdx >= 0 && lvlIdx < orgLevels.length - 1 ? orgLevels[lvlIdx + 1] : null);
                                    const childLabel = childLvl?.description || 'Sub-unit';
                                    const childCount = getDirectChildCount(unit.id);
                                    const mCount = memberCounts[unit.id] || 0;
                                    const members = unitMembers[unit.id] || [];
                                    const isExpanded = expandedMembers[unit.id];
                                    const isDragTarget = dragOverId === unit.id;

                                    return (
                                        <div
                                            key={unit.id}
                                            className={`border rounded-xl overflow-hidden transition-all duration-200 cursor-pointer ${colors.border} ${isDragTarget ? 'ring-2 ring-blue-400 shadow-lg scale-[1.02]' : 'shadow-sm hover:shadow-md'}`}
                                            onDragOver={(e) => handleDragOver(e, unit.id)}
                                            onDragLeave={handleDragLeave}
                                            onDrop={(e) => handleDrop(e, unit)}
                                            onClick={() => {
                                                if (isMobileAssignMode && selectedContactForAssign) {
                                                    handleMobileAssign(unit);
                                                    return;
                                                }
                                                navigateToFolder(unit.id);
                                            }}
                                        >
                                            {/* Card Header */}
                                            <div className={`p-4 ${colors.bg} ${colors.hover} transition-colors`}
                                            >
                                                <div className="flex items-start justify-between">
                                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                                        <div className={`p-2 rounded-lg ${colors.badge} flex-shrink-0`}>
                                                            <Folder size={18} />
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{unit.name}</h3>
                                                                <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <span className="text-[10px] font-mono text-gray-500">{unit.code}</span>
                                                                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${colors.badge}`}>
                                                                    {lvl?.description || unit.type}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1 flex-shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                                                        <button onClick={() => handleEdit(unit)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-white/60 rounded transition-colors" title="Edit">
                                                            <Edit2 size={13} />
                                                        </button>
                                                        <button onClick={() => handleDelete(unit.id, unit.name)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Delete">
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Badges row */}
                                                <div className="flex items-center gap-2 mt-3 flex-wrap">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setExpandedMembers(p => ({ ...p, [unit.id]: !p[unit.id] })); }}
                                                        className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border transition-all ${isExpanded
                                                            ? 'bg-blue-100 text-blue-700 border-blue-300'
                                                            : isMobileAssignMode && selectedContactForAssign
                                                                ? 'bg-green-100 text-green-700 border-green-300 animate-pulse'
                                                                : 'text-gray-600 bg-white/70 border-gray-200 hover:bg-blue-50 hover:border-blue-200'
                                                            }`}
                                                        title={`${mCount} people`}
                                                    >
                                                        <Users size={11} /> {mCount}
                                                    </button>
                                                    {childCount > 0 && (
                                                        <span className="text-xs text-gray-500 flex items-center gap-1">
                                                            <Folder size={11} /> {childCount} {childLabel}s
                                                        </span>
                                                    )}
                                                    <div className="flex-1" />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleAddMember(unit); }}
                                                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                                                        title="Add Member"
                                                    >
                                                        <UserPlus size={12} /> Member
                                                    </button>
                                                    {childLvl && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setSelectedUnit(undefined); setTargetParent(unit); setIsModalOpen(true); }}
                                                            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border ${getLevelColors(childLvl.color).border} ${getLevelColors(childLvl.color).bg} ${getLevelColors(childLvl.color).text} hover:opacity-80 transition-colors`}
                                                            title={`Add ${childLabel} inside ${unit.name}`}
                                                        >
                                                            <Plus size={11} /> {childLabel}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Expanded Members */}
                                            {isExpanded && (
                                                <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 space-y-1.5"
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDragOver={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                                    onDrop={(e) => { e.stopPropagation(); }}
                                                >
                                                    {members.length === 0 ? (
                                                        <p className="text-xs text-gray-400 italic py-2 text-center">No members assigned</p>
                                                    ) : (
                                                        members.map(member => (
                                                            <div
                                                                key={member.id}
                                                                draggable
                                                                onDragStart={(e) => {
                                                                    e.dataTransfer.setData('application/json', JSON.stringify({
                                                                        contactId: member.id,
                                                                        name: member.name,
                                                                        type: 'CONTACT',
                                                                        sourceUnitId: unit.id
                                                                    }));
                                                                    e.dataTransfer.effectAllowed = 'move';
                                                                }}
                                                                className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700 hover:border-gray-300 transition-all cursor-grab active:cursor-grabbing"
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <div className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-[10px] flex-shrink-0">
                                                                        {member.firstName?.[0]}{member.lastName?.[0]}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate leading-tight">{member.name}</p>
                                                                        <p className="text-[10px] text-gray-500 truncate">{member.defaultType || member.title || 'No role'}</p>
                                                                    </div>
                                                                </div>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleRemoveMember(member, unit);
                                                                    }}
                                                                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                                                                    title="Remove from unit"
                                                                >
                                                                    <X size={13} />
                                                                </button>
                                                            </div>
                                                        ))
                                                    )}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleAddMember(unit); }}
                                                        className="w-full text-xs text-blue-600 hover:text-blue-800 font-medium py-1.5 border border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                                                    >
                                                        + Add Member
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ═══ MODALS ═══ */}
            <OrgUnitModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={loadData}
                unit={selectedUnit}
                parentUnit={targetParent}
            />

            {targetUnitForMember && isAddMemberOpen && (
                <AddMemberModal
                    unit={targetUnitForMember}
                    onClose={() => setIsAddMemberOpen(false)}
                    onSave={loadData}
                />
            )}

            <OrgUnitDetailsDrawer
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                unit={selectedUnitForDetails}
                onUpdate={(u) => { loadData(); setSelectedUnitForDetails(u); }}
            />

            <DraggableUserList
                isOpen={showUserList}
                onClose={() => setShowUserList(false)}
                refreshKey={userListRefreshKey}
                onSelectContact={isMobileAssignMode ? (contact) => {
                    setSelectedContactForAssign({ id: contact.id, name: contact.name });
                } : undefined}
            />

            <OrgLevelSettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                onSave={loadData}
                levels={orgLevels}
            />

            {/* Mobile Assign Bar */}
            {isMobileAssignMode && selectedContactForAssign && (
                <div className="fixed bottom-0 left-0 right-0 bg-green-600 text-white px-4 py-3 flex items-center justify-between z-50 shadow-lg shadow-green-900/30 safe-area-inset">
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">📌</div>
                        <div>
                            <p className="text-sm font-semibold">{selectedContactForAssign.name}</p>
                            <p className="text-[10px] text-green-100">Tap a folder above to assign</p>
                        </div>
                    </div>
                    <button onClick={() => setSelectedContactForAssign(null)} className="p-2 hover:bg-green-700 rounded-lg transition-colors">
                        <X size={18} />
                    </button>
                </div>
            )}
            {/* Confirmation Modal (Delete Unit / Remove Member) */}
            {confirmAction && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => !isConfirming && setConfirmAction(null)}>
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 animate-in" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                                confirmAction.type === 'remove-member'
                                    ? 'bg-orange-100 dark:bg-orange-900/30'
                                    : 'bg-red-100 dark:bg-red-900/30'
                            }`}>
                                {confirmAction.type === 'remove-member'
                                    ? <UserMinus size={20} className="text-orange-600" />
                                    : <Trash2 size={20} className="text-red-600" />
                                }
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                                    {confirmAction.type === 'remove-member' ? 'Remove Member' : 'Delete Organization Unit'}
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{confirmAction.name}</p>
                            </div>
                        </div>
                        <div className={`border rounded-lg p-3 mb-5 ${
                            confirmAction.type === 'remove-member'
                                ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                        }`}>
                            <p className={`text-sm whitespace-pre-line ${
                                confirmAction.type === 'remove-member'
                                    ? 'text-orange-800 dark:text-orange-300'
                                    : 'text-red-800 dark:text-red-300'
                            }`}>{confirmAction.message}</p>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setConfirmAction(null)}
                                disabled={isConfirming}
                                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeConfirmAction}
                                disabled={isConfirming}
                                className={`px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 ${
                                    confirmAction.type === 'remove-member'
                                        ? 'bg-orange-600 hover:bg-orange-700'
                                        : 'bg-red-600 hover:bg-red-700'
                                }`}
                            >
                                {isConfirming ? (
                                    <><span className="animate-spin inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></span> Processing...</>
                                ) : confirmAction.type === 'remove-member' ? (
                                    <><UserMinus size={14} /> Remove</>
                                ) : (
                                    <><Trash2 size={14} /> Delete</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
