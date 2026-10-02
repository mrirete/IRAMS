/**
 * Organisation chart — the unit hierarchy (Site → Division → Department →
 * Section → Team, configurable) and who sits in each unit.
 *
 * Data: three reads on open — levels (getOrgLevels, with their metadata), units,
 * and every person with ALL their memberships (getOrgPeople). It used to fire
 * one contacts query per unit and saw only primary members.
 *
 * Writes: membership changes go through set_contact_org_units /
 * set_primary_org_unit (0399a), so taking someone out of one unit never drops
 * their other units. Every write affordance is hidden without contacts.edit —
 * the database refuses those writes anyway.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DatabaseService } from '../services/DatabaseService';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { OrganizationUnit } from '../types';
import { OrgUnitModal } from './OrgUnitModal';
import { AddMemberModal } from './modals/AddMemberModal';
import {
    Plus, Edit2, Trash2, Users, ChevronRight, ChevronDown, UserPlus, UserMinus,
    Settings, X, Smartphone, FolderOpen, Folder, Home, ArrowLeft, Search,
    Info, Network, UserCheck, AlertTriangle,
} from 'lucide-react';
import { OrgUnitDetailsDrawer } from './OrgUnitDetailsDrawer';
import { DraggableUserList } from './DraggableUserList';
import { OrgLevelSettingsModal } from './OrgLevelSettingsModal';
import { levelStyle, pluralLevel, unitsMoved, unitsWithout, type OrgLevel, type OrgPerson } from '../lib/orgLevels';

type ConfirmAction =
    | { type: 'delete-unit'; unit: OrganizationUnit; message: string }
    | { type: 'remove-member'; person: OrgPerson; unit: OrganizationUnit; message: string }
    | { type: 'assign-anyway'; person: OrgPerson; unit: OrganizationUnit; fromUnitId?: string; message: string };

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export const OrgChart: React.FC = () => {
    // Restructuring the chart moves people between units; the database (0399a)
    // allows it to roles with contacts.edit. Everyone else can look.
    const { permissions } = useAuth();
    const { showToast } = useToast();
    const canEdit = permissions?.contacts?.edit === true;

    const [levels, setLevels] = useState<OrgLevel[]>([]);
    const [units, setUnits] = useState<OrganizationUnit[]>([]);
    const [people, setPeople] = useState<OrgPerson[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Modals / panels
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedUnit, setSelectedUnit] = useState<OrganizationUnit | undefined>(undefined);
    const [targetParent, setTargetParent] = useState<OrganizationUnit | undefined>(undefined);
    const [memberTarget, setMemberTarget] = useState<OrganizationUnit | null>(null);
    const [detailsUnit, setDetailsUnit] = useState<OrganizationUnit | null>(null);
    const [showPeoplePanel, setShowPeoplePanel] = useState(false);
    const [peopleRefreshKey, setPeopleRefreshKey] = useState(0);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);

    // View
    const [viewMode, setViewMode] = useState<'folder' | 'tree'>('folder');
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
    const [expandedMembers, setExpandedMembers] = useState<Record<string, boolean>>({});
    const [collapsedTree, setCollapsedTree] = useState<Record<string, boolean>>({});
    const [highlightPersonId, setHighlightPersonId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);

    // Search
    const [query, setQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    // Phone: pick a person, then tap a unit
    const [isMobileAssignMode, setIsMobileAssignMode] = useState(false);
    const [mobilePick, setMobilePick] = useState<{ id: string; name: string } | null>(null);

    // ═══ LOAD ═══
    const loadPeople = useCallback(async () => {
        const p = await DatabaseService.getInstance().getOrgPeople();
        setPeople(p);
        setPeopleRefreshKey(k => k + 1);
    }, []);

    const loadAll = useCallback(async () => {
        setLoadError(null);
        try {
            const db = DatabaseService.getInstance();
            const [lv, us, pp] = await Promise.all([db.getOrgLevels(), db.getOrgUnits(), db.getOrgPeople()]);
            setLevels(lv);
            setUnits(us);
            setPeople(pp);
            setPeopleRefreshKey(k => k + 1);
        } catch (e: any) {
            setLoadError(e?.message || 'The organisation chart could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void loadAll(); }, [loadAll]);

    useEffect(() => {
        const close = (e: MouseEvent) => { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    // ═══ DERIVED ═══
    const unitMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);
    const levelMap = useMemo(() => new Map(levels.map(l => [l.code, l])), [levels]);
    const peopleById = useMemo(() => new Map(people.map(p => [p.id, p])), [people]);

    const childrenOf = useMemo(() => {
        const m = new Map<string | null, OrganizationUnit[]>();
        for (const u of units) {
            const key = u.parentId && unitMap.has(u.parentId) ? u.parentId : null; // orphans surface at the root
            if (!m.has(key)) m.set(key, []);
            m.get(key)!.push(u);
        }
        m.forEach(list => list.sort(byName));
        return m;
    }, [units, unitMap]);

    const membersOf = useMemo(() => {
        const m = new Map<string, OrgPerson[]>();
        for (const p of people) for (const u of p.unitIds) {
            if (!m.has(u)) m.set(u, []);
            m.get(u)!.push(p);
        }
        // active first, then by name
        m.forEach(list => list.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)));
        return m;
    }, [people]);

    const activeMemberCount = (unitId: string) => (membersOf.get(unitId) || []).filter(p => p.active).length;

    const pathOf = useCallback((unitId: string | null): OrganizationUnit[] => {
        const path: OrganizationUnit[] = [];
        const seen = new Set<string>();
        let id = unitId;
        while (id && unitMap.has(id) && !seen.has(id)) {
            seen.add(id);
            const u = unitMap.get(id)!;
            path.unshift(u);
            id = u.parentId || null;
        }
        return path;
    }, [unitMap]);

    const breadcrumbs = useMemo(() => pathOf(currentFolderId), [pathOf, currentFolderId]);
    const currentFolder = currentFolderId ? unitMap.get(currentFolderId) || null : null;
    const currentChildren = childrenOf.get(currentFolderId) || [];

    const topLevel = levels[0] || null;
    const levelFor = (u: OrganizationUnit) => levelMap.get(u.type) || null;
    const childLevelOf = (u: OrganizationUnit | null): OrgLevel | null => {
        if (!u) return topLevel;
        const lvl = levelFor(u);
        if (lvl?.childType) return levelMap.get(lvl.childType) || null;
        const idx = lvl ? levels.indexOf(lvl) : -1;
        return idx >= 0 && idx < levels.length - 1 ? levels[idx + 1] : null;
    };

    /** "2 Divisions" or "1 Division · 1 Department" — from what is actually there, not the config. */
    const childSummary = (unitId: string): string | null => {
        const kids = childrenOf.get(unitId) || [];
        if (!kids.length) return null;
        const counts = new Map<string, number>();
        kids.forEach(k => counts.set(k.type, (counts.get(k.type) || 0) + 1));
        return Array.from(counts.entries())
            .sort((a, b) => (levelMap.get(a[0])?.sortOrder ?? 99) - (levelMap.get(b[0])?.sortOrder ?? 99))
            .map(([type, n]) => `${n} ${pluralLevel(levelMap.get(type)?.description || 'sub-unit', n)}`)
            .join(' · ');
    };

    const activePeople = people.filter(p => p.active);
    const placed = activePeople.filter(p => p.unitIds.length > 0).length;
    const unassigned = activePeople.length - placed;

    const managerName = (u: OrganizationUnit) => (u.managerId ? peopleById.get(u.managerId)?.name || null : null);

    // ═══ SEARCH ═══
    const q = query.trim().toLowerCase();
    const unitHits = q ? units.filter(u => u.name.toLowerCase().includes(q) || (u.code || '').toLowerCase().includes(q)).slice(0, 6) : [];
    const personHits = q ? people.filter(p => p.name.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q)).slice(0, 6) : [];

    const openUnit = (unitId: string | null) => {
        setViewMode('folder');
        setCurrentFolderId(unitId);
        setExpandedMembers({});
    };
    const goToPerson = (p: OrgPerson) => {
        setSearchOpen(false);
        setQuery('');
        if (!p.unitIds.length) { showToast(`${p.name} is not in any unit yet.`, 'info'); return; }
        openUnit(p.primaryUnitId || p.unitIds[0]);
        setHighlightPersonId(p.id);
        window.setTimeout(() => setHighlightPersonId(null), 4000);
    };

    // ═══ WRITES ═══
    const assign = async (person: OrgPerson, unit: OrganizationUnit, fromUnitId?: string) => {
        const db = DatabaseService.getInstance();
        if (fromUnitId) await db.setContactOrgUnits(person.id, unitsMoved(person, fromUnitId, unit.id));
        else await db.assignContactsToUnit([person.id], unit.id);
        showToast(`${person.name} ${fromUnitId ? 'moved to' : 'placed in'} ${unit.name}.`, 'success');
        setExpandedMembers(prev => ({ ...prev, [unit.id]: true }));
        await loadPeople();
    };

    /** Drop / tap-assign: refuse no-ops, warn (in-app) when the person has no access to the unit's scope. */
    const requestAssign = async (contactId: string, unit: OrganizationUnit, fromUnitId?: string) => {
        if (!canEdit) return;
        const person = peopleById.get(contactId);
        if (!person) { showToast('That person is not in the directory any more.', 'error'); return; }
        if (fromUnitId === unit.id) return;
        if (!fromUnitId && person.unitIds.includes(unit.id)) { showToast(`${person.name} is already in ${unit.name}.`, 'info'); return; }
        try {
            const hasAccess = await DatabaseService.getInstance().checkUserAccess(contactId, unit.id);
            if (!hasAccess) {
                setConfirmAction({
                    type: 'assign-anyway', person, unit, fromUnitId,
                    message: `${person.name} has no sign-in access set up for "${unit.name}" (Admin › User Access). They can still be placed in the chart — they just won't see this unit's work until access is granted.`,
                });
                return;
            }
            await assign(person, unit, fromUnitId);
        } catch (err: any) {
            showToast(`Not changed: ${err?.message || 'the change was refused.'}`, 'error');
        }
    };

    const askRemove = (person: OrgPerson, unit: OrganizationUnit) => {
        const after = unitsWithout(person, unit.id);
        const promoted = person.primaryUnitId === unit.id && after.length ? unitMap.get(after[0])?.name : null;
        setConfirmAction({
            type: 'remove-member', person, unit,
            message: `Take ${person.name} out of "${unit.name}"? They stay in the directory${after.length ? ` and in their other unit${after.length > 1 ? 's' : ''}` : ''}.${promoted ? `\n\n${promoted} becomes their primary unit.` : ''}`,
        });
    };

    const askDelete = (unit: OrganizationUnit) => {
        const kids = (childrenOf.get(unit.id) || []).length;
        if (kids) {
            showToast(`"${unit.name}" still has ${kids} sub-unit${kids > 1 ? 's' : ''}. Move or delete ${kids > 1 ? 'them' : 'it'} first.`, 'error');
            return;
        }
        const n = (membersOf.get(unit.id) || []).length;
        setConfirmAction({
            type: 'delete-unit', unit,
            message: `Delete "${unit.name}"?${n ? `\n\n${n} ${n === 1 ? 'person is' : 'people are'} taken out of it (they stay in the directory).` : ''}`,
        });
    };

    const executeConfirm = async () => {
        if (!confirmAction) return;
        setIsConfirming(true);
        try {
            const db = DatabaseService.getInstance();
            if (confirmAction.type === 'delete-unit') {
                await db.deleteOrgUnit(confirmAction.unit.id);
                if (currentFolderId === confirmAction.unit.id) setCurrentFolderId(confirmAction.unit.parentId || null);
                await loadAll();
            } else if (confirmAction.type === 'remove-member') {
                await db.setContactOrgUnits(confirmAction.person.id, unitsWithout(confirmAction.person, confirmAction.unit.id));
                await loadPeople();
            } else {
                await assign(confirmAction.person, confirmAction.unit, confirmAction.fromUnitId);
            }
            setConfirmAction(null);
        } catch (e: any) {
            showToast(e?.message || 'That change was not saved.', 'error');
            setConfirmAction(null);
        } finally {
            setIsConfirming(false);
        }
    };

    const openNewUnit = (parent: OrganizationUnit | null) => { setSelectedUnit(undefined); setTargetParent(parent || undefined); setIsModalOpen(true); };
    const openEditUnit = (u: OrganizationUnit) => { setSelectedUnit(u); setTargetParent(undefined); setIsModalOpen(true); };

    // ═══ DnD ═══
    const dropProps = (unit: OrganizationUnit) => canEdit ? {
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDragOverId(unit.id); },
        onDragLeave: (e: React.DragEvent) => { e.stopPropagation(); setDragOverId(null); },
        onDrop: (e: React.DragEvent) => {
            e.preventDefault(); e.stopPropagation(); setDragOverId(null);
            const raw = e.dataTransfer.getData('application/json');
            if (!raw) return;
            try {
                const { contactId, sourceUnitId } = JSON.parse(raw);
                void requestAssign(contactId, unit, sourceUnitId || undefined);
            } catch { /* not ours */ }
        },
    } : {};

    // ═══ RENDER PIECES ═══
    const levelBadge = (unit: OrganizationUnit) => {
        const lvl = levelFor(unit);
        return (
            <span key={`lvl-${unit.id}`} className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap ${levelStyle(lvl?.color).badge}`}>
                {lvl?.description || unit.type}
            </span>
        );
    };

    const memberRow = (person: OrgPerson, unit: OrganizationUnit) => (
        <div
            key={person.id}
            draggable={canEdit && person.active}
            onDragStart={(e) => {
                e.dataTransfer.setData('application/json', JSON.stringify({ contactId: person.id, name: person.name, type: 'CONTACT', sourceUnitId: unit.id }));
                e.dataTransfer.effectAllowed = 'move';
            }}
            className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 border transition-all ${highlightPersonId === person.id ? 'bg-amber-50 border-amber-300 ring-2 ring-amber-200' : 'bg-slate-50 border-slate-100 hover:border-slate-300'} ${canEdit && person.active ? 'cursor-grab active:cursor-grabbing' : ''} ${person.active ? '' : 'opacity-60'}`}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-[10px] shrink-0">{person.initials}</div>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate leading-tight">
                        {person.name}
                        {unit.managerId === person.id && <span className="ml-1.5 text-[10px] font-bold text-primary-700">Lead</span>}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                        {person.title || person.role || 'No role'}
                        {person.primaryUnitId !== unit.id && person.unitIds.length > 1 && <span className="text-slate-400"> · also here</span>}
                        {!person.active && <span className="text-slate-400"> · inactive</span>}
                    </p>
                </div>
            </div>
            {canEdit && (
                <button onClick={(e) => { e.stopPropagation(); askRemove(person, unit); }}
                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors shrink-0"
                    aria-label={`Take ${person.name} out of ${unit.name}`} title="Take out of this unit">
                    <X size={13} />
                </button>
            )}
        </div>
    );

    const memberList = (unit: OrganizationUnit) => {
        const list = membersOf.get(unit.id) || [];
        return (
            <div className="space-y-1.5">
                {list.length === 0
                    ? <p className="text-xs text-slate-400 italic py-2 text-center">Nobody in this unit yet{canEdit ? ' — drag someone here or add them.' : '.'}</p>
                    : list.map(p => memberRow(p, unit))}
                {canEdit && (
                    <button onClick={(e) => { e.stopPropagation(); setMemberTarget(unit); }}
                        className="w-full text-xs text-primary-700 hover:text-primary-800 font-semibold py-1.5 border border-dashed border-primary-200 rounded-lg hover:bg-primary-50 transition-colors">
                        + Add people
                    </button>
                )}
            </div>
        );
    };

    // ═══ STATES ═══
    if (loading) return (
        <div className="space-y-4" aria-busy="true" aria-label="Loading the organisation chart">
            <div className="h-16 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="h-11 bg-white border border-slate-200 rounded-xl animate-pulse" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[0, 1, 2].map(i => <div key={i} className="h-32 bg-white border border-slate-200 rounded-xl animate-pulse" />)}
            </div>
        </div>
    );

    if (loadError) return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 flex items-start gap-3">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">
                <p className="font-semibold">The organisation chart did not load.</p>
                <p className="mt-0.5">{loadError}</p>
            </div>
            <button onClick={() => { setLoading(true); void loadAll(); }} className="px-3 py-1.5 rounded-lg bg-white border border-red-200 font-semibold hover:bg-red-100">Retry</button>
        </div>
    );

    const childLevel = childLevelOf(currentFolder);
    const addLabel = childLevel?.description || 'Sub-unit';

    // ═══ TREE NODE ═══
    const renderTreeNode = (unit: OrganizationUnit, depth: number): React.ReactNode => {
        const lvl = levelFor(unit);
        const kids = childrenOf.get(unit.id) || [];
        const collapsed = !!collapsedTree[unit.id];
        const n = activeMemberCount(unit.id);
        const lead = managerName(unit);
        return (
            <li key={unit.id}>
                <div
                    className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 transition-colors ${dragOverId === unit.id ? 'bg-primary-50 ring-2 ring-primary-300' : ''}`}
                    style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
                    {...dropProps(unit)}
                >
                    {kids.length ? (
                        <button onClick={() => setCollapsedTree(c => ({ ...c, [unit.id]: !c[unit.id] }))}
                            className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={collapsed ? `Expand ${unit.name}` : `Collapse ${unit.name}`} aria-expanded={!collapsed}>
                            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                    ) : <span className="w-[18px] shrink-0" />}
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${levelStyle(lvl?.color).dot}`} aria-hidden />
                    <button onClick={() => openUnit(unit.id)} className="min-w-0 flex-1 flex items-center gap-2 text-left">
                        <span className="font-semibold text-sm text-slate-800 truncate">{unit.name}</span>
                        <span className="hidden sm:inline">{levelBadge(unit)}</span>
                        {lead && <span className="hidden md:inline text-[11px] text-slate-500 truncate">· {lead}</span>}
                    </button>
                    <span className="text-[11px] text-slate-500 tabular-nums inline-flex items-center gap-1 shrink-0" title={`${n} people`}><Users size={11} className="text-slate-400" />{n}</span>
                    <span className="hidden sm:inline text-[10px] font-mono text-slate-400 shrink-0 w-24 truncate text-right">{unit.code}</span>
                    {canEdit && (
                        <span className="flex items-center gap-0.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                            <button onClick={() => openEditUnit(unit)} className="p-1 text-slate-400 hover:text-slate-700 hover:bg-white rounded" aria-label={`Edit ${unit.name}`}><Edit2 size={12} /></button>
                            {childLevelOf(unit) && (
                                <button onClick={() => openNewUnit(unit)} className="p-1 text-slate-400 hover:text-primary-700 hover:bg-white rounded" aria-label={`Add ${childLevelOf(unit)!.description} inside ${unit.name}`}><Plus size={12} /></button>
                            )}
                        </span>
                    )}
                </div>
                {kids.length > 0 && !collapsed && <ul className="border-l border-slate-100" style={{ marginLeft: `${depth * 1.25 + 1.05}rem` }}>{kids.map(k => renderTreeNode(k, 0))}</ul>}
            </li>
        );
    };

    return (
        <div className="space-y-5 pb-16 animate-in fade-in duration-300">
            {/* ═══ OVERVIEW STRIP — levels in hierarchy order, then people ═══ */}
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                {levels.map(l => {
                    const n = units.filter(u => u.type === l.code).length;
                    return (
                        <div key={l.code} className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${levelStyle(l.color).dot}`} aria-hidden />
                            <span className={`text-lg font-black tabular-nums ${n ? 'text-slate-800' : 'text-slate-300'}`}>{n}</span>
                            <span className="text-xs text-slate-500">{pluralLevel(l.description, n)}</span>
                        </div>
                    );
                })}
                <div className="hidden sm:block h-6 w-px bg-slate-200" />
                <div className="flex items-center gap-2" title="Active people with at least one unit">
                    <UserCheck size={14} className="text-emerald-600" />
                    <span className="text-lg font-black tabular-nums text-slate-800">{placed}</span>
                    <span className="text-xs text-slate-500">of {activePeople.length} people placed</span>
                </div>
                {unassigned > 0 && (
                    canEdit ? (
                        <button onClick={() => setShowPeoplePanel(true)} className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100">
                            {unassigned} not in any unit — place them
                        </button>
                    ) : (
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">{unassigned} not in any unit</span>
                    )
                )}
            </div>

            {/* ═══ TOOLBAR ═══ */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div ref={searchRef} className="relative flex-1 min-w-0">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={query}
                        onChange={e => { setQuery(e.target.value); setSearchOpen(true); }}
                        onFocus={() => setSearchOpen(true)}
                        onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false); } }}
                        placeholder="Find a unit or a person…"
                        aria-label="Find a unit or a person"
                        className="w-full pl-9 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
                    />
                    {query && (
                        <button onClick={() => { setQuery(''); setSearchOpen(false); }} aria-label="Clear search"
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={14} /></button>
                    )}
                    {searchOpen && q && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 py-1 max-h-[22rem] overflow-y-auto">
                            {unitHits.length === 0 && personHits.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">Nothing matches “{query.trim()}”.</p>}
                            {unitHits.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Units</p>}
                            {unitHits.map(u => (
                                <button key={u.id} onClick={() => { setSearchOpen(false); setQuery(''); openUnit(u.id); }}
                                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${levelStyle(levelFor(u)?.color).dot}`} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium text-slate-800 truncate">{u.name}</span>
                                        <span className="block text-[11px] text-slate-400 truncate">{pathOf(u.parentId || null).map(x => x.name).join(' › ') || 'Top level'}</span>
                                    </span>
                                    {levelBadge(u)}
                                </button>
                            ))}
                            {personHits.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">People</p>}
                            {personHits.map(p => (
                                <button key={p.id} onClick={() => goToPerson(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2.5">
                                    <span className="h-7 w-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-[10px] shrink-0">{p.initials}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-medium text-slate-800 truncate">{p.name}{!p.active && <span className="text-slate-400 font-normal"> · inactive</span>}</span>
                                        <span className="block text-[11px] text-slate-400 truncate">
                                            {p.unitIds.length ? p.unitIds.map(id => unitMap.get(id)?.name).filter(Boolean).join(', ') : 'Not in any unit'}
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div role="tablist" aria-label="View" className="flex rounded-xl bg-white border border-slate-200 p-0.5">
                        <button role="tab" aria-selected={viewMode === 'folder'} onClick={() => setViewMode('folder')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${viewMode === 'folder' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
                            <Folder size={13} /> Browse
                        </button>
                        <button role="tab" aria-selected={viewMode === 'tree'} onClick={() => setViewMode('tree')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${viewMode === 'tree' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800'}`}>
                            <Network size={13} /> Whole tree
                        </button>
                    </div>
                    {canEdit && (
                        <>
                            <button
                                onClick={() => { const on = !isMobileAssignMode; setIsMobileAssignMode(on); if (on) setShowPeoplePanel(true); else setMobilePick(null); }}
                                className={`md:hidden flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${isMobileAssignMode ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
                                <Smartphone size={14} /> {isMobileAssignMode ? 'Done placing' : 'Tap to place'}
                            </button>
                            <button onClick={() => setShowPeoplePanel(v => !v)}
                                className={`hidden md:flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${showPeoplePanel ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                                <Users size={14} /> {showPeoplePanel ? 'Hide people' : 'Place people'}
                            </button>
                            {(viewMode === 'tree' ? topLevel : childLevel) && (
                                <button onClick={() => openNewUnit(viewMode === 'tree' ? null : currentFolder)}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-sm transition-colors">
                                    <Plus size={14} /> New {viewMode === 'tree' ? topLevel!.description : addLabel}
                                </button>
                            )}
                            <button onClick={() => setIsSettingsOpen(true)} aria-label="Configure hierarchy levels" title="Configure hierarchy levels"
                                className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
                                <Settings size={16} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {viewMode === 'tree' ? (
                /* ═══ WHOLE TREE ═══ */
                <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4">
                    {(childrenOf.get(null) || []).length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                            <Network size={40} className="mx-auto mb-3 opacity-40" />
                            <p className="font-medium text-slate-600">No organisation structure yet</p>
                            <p className="text-sm mt-1">Start with a {topLevel?.description || 'unit'}.</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex justify-end gap-3 mb-1 text-[11px] font-semibold">
                                <button className="text-slate-500 hover:text-slate-800" onClick={() => setCollapsedTree({})}>Expand all</button>
                                <button className="text-slate-500 hover:text-slate-800" onClick={() => setCollapsedTree(Object.fromEntries(units.filter(u => (childrenOf.get(u.id) || []).length).map(u => [u.id, true])))}>Collapse all</button>
                            </div>
                            <ul>{(childrenOf.get(null) || []).map(u => renderTreeNode(u, 0))}</ul>
                        </>
                    )}
                </div>
            ) : (
                /* ═══ BROWSE ═══ */
                <>
                    {/* Breadcrumbs */}
                    <nav aria-label="Where you are" className="flex items-center gap-1 text-sm overflow-x-auto -mt-1">
                        <button onClick={() => openUnit(null)}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg font-medium whitespace-nowrap transition-colors ${!currentFolderId ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-white'}`}>
                            <Home size={13} /> Organisation
                        </button>
                        {breadcrumbs.map((crumb, idx) => {
                            const last = idx === breadcrumbs.length - 1;
                            return (
                                <React.Fragment key={crumb.id}>
                                    <ChevronRight size={14} className="text-slate-300 shrink-0" />
                                    <button onClick={() => !last && openUnit(crumb.id)} aria-current={last ? 'page' : undefined}
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg font-medium whitespace-nowrap transition-colors ${last ? 'bg-white border border-slate-200 text-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-white'}`}>
                                        {last ? <FolderOpen size={13} /> : <Folder size={13} />} {crumb.name}
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </nav>

                    {/* The unit you are in: who leads it, who is in it */}
                    {currentFolder && (() => {
                        const lvl = levelFor(currentFolder);
                        const st = levelStyle(lvl?.color);
                        const lead = managerName(currentFolder);
                        const members = membersOf.get(currentFolder.id) || [];
                        const kidsLabel = childSummary(currentFolder.id);
                        return (
                            <section className={`bg-white border border-slate-200 border-l-4 ${st.border} rounded-xl ${dragOverId === currentFolder.id ? 'ring-2 ring-primary-300' : ''}`} {...dropProps(currentFolder)}>
                                <div className="px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-lg font-bold text-slate-800">{currentFolder.name}</h2>
                                            {levelBadge(currentFolder)}
                                            {currentFolder.code && <span className="text-xs font-mono text-slate-400">{currentFolder.code}</span>}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
                                            <span className="flex items-center gap-1"><UserCheck size={12} className="text-slate-400" />{lead ? <>Led by <b className="text-slate-700 font-semibold">{lead}</b></> : 'No lead set'}</span>
                                            <span className="flex items-center gap-1"><Users size={12} className="text-slate-400" />{activeMemberCount(currentFolder.id)} {activeMemberCount(currentFolder.id) === 1 ? 'person' : 'people'}</span>
                                            {kidsLabel && <span className="flex items-center gap-1"><Network size={12} className="text-slate-400" />{kidsLabel}</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button onClick={() => openUnit(currentFolder.parentId || null)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"><ArrowLeft size={13} /> Up</button>
                                        <button onClick={() => setDetailsUnit(currentFolder)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Info size={13} /> Details</button>
                                        {canEdit && <button onClick={() => openEditUnit(currentFolder)} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label={`Edit ${currentFolder.name}`}><Edit2 size={14} /></button>}
                                    </div>
                                </div>
                                <div className="border-t border-slate-100 px-4 sm:px-5 py-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">People in {currentFolder.name}</p>
                                    {members.length > 0 || canEdit ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                            {members.map(p => memberRow(p, currentFolder))}
                                            {canEdit && (
                                                <button onClick={() => setMemberTarget(currentFolder)}
                                                    className="flex items-center justify-center gap-1.5 text-xs text-primary-700 font-semibold py-2 border border-dashed border-primary-200 rounded-lg hover:bg-primary-50 transition-colors">
                                                    <UserPlus size={13} /> Add people
                                                </button>
                                            )}
                                        </div>
                                    ) : <p className="text-xs text-slate-400 italic">Nobody in this unit yet.</p>}
                                </div>
                            </section>
                        );
                    })()}

                    {/* Units inside */}
                    {currentChildren.length > 0 && currentFolder && (
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">{childSummary(currentFolder.id)}</h3>
                    )}
                    {currentChildren.length === 0 ? (
                        <div className="text-center py-12 border border-dashed border-slate-200 rounded-xl bg-white">
                            <FolderOpen size={36} className="mx-auto text-slate-300 mb-3" />
                            <p className="font-semibold text-slate-700">
                                {currentFolder ? (childLevel ? `No ${pluralLevel(childLevel.description)} inside ${currentFolder.name}` : `${currentFolder.name} is the lowest level`) : 'No organisation structure yet'}
                            </p>
                            <p className="text-sm text-slate-500 mt-1 mb-4">
                                {currentFolder
                                    ? (childLevel ? `A ${childLevel.description} sits under a ${levelFor(currentFolder)?.description || 'unit'}.` : 'People are placed here directly.')
                                    : `Start with a ${topLevel?.description || 'unit'} — everything else hangs off it.`}
                            </p>
                            {canEdit && childLevel && (
                                <button onClick={() => openNewUnit(currentFolder)}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold">
                                    <Plus size={14} /> Add {childLevel.description}
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {currentChildren.map(unit => {
                                const lvl = levelFor(unit);
                                const st = levelStyle(lvl?.color);
                                const kidLevel = childLevelOf(unit);
                                const kidsLabel = childSummary(unit.id);
                                const n = activeMemberCount(unit.id);
                                const lead = managerName(unit);
                                const isExpanded = !!expandedMembers[unit.id];
                                const isDropTarget = dragOverId === unit.id;
                                const tapping = isMobileAssignMode && !!mobilePick;
                                const activate = () => {
                                    if (tapping) { void requestAssign(mobilePick!.id, unit); setMobilePick(null); return; }
                                    openUnit(unit.id);
                                };
                                return (
                                    <div key={unit.id}
                                        className={`bg-white border border-slate-200 border-l-4 ${st.border} rounded-xl transition-all ${isDropTarget ? 'ring-2 ring-primary-400 shadow-lg' : tapping ? 'ring-2 ring-emerald-300' : 'hover:shadow-sm hover:border-slate-300'}`}
                                        {...dropProps(unit)}
                                    >
                                        <div role="button" tabIndex={0} onClick={activate}
                                            onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(); } }}
                                            className="px-4 pt-3.5 pb-3 cursor-pointer rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <h3 className="font-semibold text-slate-800 truncate">{unit.name}</h3>
                                                        <ChevronRight size={14} className="text-slate-400 shrink-0" />
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        {levelBadge(unit)}
                                                        {unit.code && <span className="text-[10px] font-mono text-slate-400 truncate">{unit.code}</span>}
                                                    </div>
                                                </div>
                                                {canEdit && (
                                                    <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                                                        <button onClick={() => openEditUnit(unit)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded" aria-label={`Edit ${unit.name}`}><Edit2 size={13} /></button>
                                                        <button onClick={() => askDelete(unit)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" aria-label={`Delete ${unit.name}`}><Trash2 size={13} /></button>
                                                    </div>
                                                )}
                                            </div>
                                            <p className="mt-2 text-xs text-slate-500 flex items-center gap-1 truncate">
                                                <UserCheck size={12} className="text-slate-400 shrink-0" />
                                                {lead ? <>Led by <span className="font-medium text-slate-700 truncate">{lead}</span></> : <span className="text-slate-400">No lead set</span>}
                                            </p>
                                        </div>
                                        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
                                            <button onClick={() => setExpandedMembers(p => ({ ...p, [unit.id]: !p[unit.id] }))} aria-expanded={isExpanded}
                                                className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border transition-colors ${isExpanded ? 'bg-primary-50 text-primary-700 border-primary-200' : 'text-slate-600 bg-white border-slate-200 hover:bg-slate-50'}`}>
                                                <Users size={11} /> {n} {n === 1 ? 'person' : 'people'} {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                            </button>
                                            {kidsLabel && <span className="text-xs text-slate-500 flex items-center gap-1 min-w-0 truncate"><Folder size={11} className="text-slate-400 shrink-0" />{kidsLabel}</span>}
                                            {canEdit && kidLevel && (
                                                <button onClick={() => openNewUnit(unit)}
                                                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                                                    title={`Add a ${kidLevel.description} inside ${unit.name}`}>
                                                    <Plus size={11} /> {kidLevel.description}
                                                </button>
                                            )}
                                        </div>
                                        {isExpanded && (
                                            <div className="border-t border-slate-100 p-3" onClick={e => e.stopPropagation()}>
                                                {memberList(unit)}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {/* ═══ MODALS ═══ */}
            <OrgUnitModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={() => void loadAll()} unit={selectedUnit} parentUnit={targetParent} />

            {memberTarget && (
                <AddMemberModal unit={memberTarget} onClose={() => setMemberTarget(null)} onSave={() => void loadPeople()} />
            )}

            <OrgUnitDetailsDrawer isOpen={!!detailsUnit} onClose={() => setDetailsUnit(null)} unit={detailsUnit}
                onUpdate={(u) => { void loadAll(); setDetailsUnit(u); }} />

            {canEdit && (
                <DraggableUserList isOpen={showPeoplePanel} onClose={() => { setShowPeoplePanel(false); setIsMobileAssignMode(false); setMobilePick(null); }}
                    refreshKey={peopleRefreshKey}
                    onSelectContact={isMobileAssignMode ? (c) => { setMobilePick({ id: c.id, name: c.name }); setShowPeoplePanel(false); } : undefined} />
            )}

            {canEdit && <OrgLevelSettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onSave={() => void loadAll()} levels={levels} />}

            {/* Phone: the picked person waits for a tap on a unit */}
            {isMobileAssignMode && mobilePick && (
                <div className="fixed bottom-16 left-3 right-3 bg-emerald-600 text-white rounded-xl px-4 py-3 flex items-center justify-between z-50 shadow-lg">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{mobilePick.name}</p>
                        <p className="text-[11px] text-emerald-100">Tap a unit to place them there</p>
                    </div>
                    <button onClick={() => setMobilePick(null)} className="p-2 hover:bg-emerald-700 rounded-lg" aria-label="Cancel"><X size={18} /></button>
                </div>
            )}

            {/* Confirm (delete unit / take someone out / place without access) */}
            {confirmAction && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => !isConfirming && setConfirmAction(null)}>
                    <div role="dialog" aria-modal="true" aria-labelledby="org-confirm-title" className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${confirmAction.type === 'delete-unit' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                                {confirmAction.type === 'delete-unit' ? <Trash2 size={20} /> : confirmAction.type === 'remove-member' ? <UserMinus size={20} /> : <AlertTriangle size={20} />}
                            </div>
                            <h3 id="org-confirm-title" className="text-lg font-bold text-slate-800">
                                {confirmAction.type === 'delete-unit' ? 'Delete unit' : confirmAction.type === 'remove-member' ? 'Take out of unit' : 'Place without access?'}
                            </h3>
                        </div>
                        <p className="text-sm text-slate-600 whitespace-pre-line mb-6">{confirmAction.message}</p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setConfirmAction(null)} disabled={isConfirming} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                            <button onClick={() => void executeConfirm()} disabled={isConfirming}
                                className={`px-4 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-50 ${confirmAction.type === 'delete-unit' ? 'bg-red-600 hover:bg-red-700' : confirmAction.type === 'remove-member' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-primary-600 hover:bg-primary-700'}`}>
                                {isConfirming ? 'Working…' : confirmAction.type === 'delete-unit' ? 'Delete' : confirmAction.type === 'remove-member' ? 'Take out' : 'Place anyway'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
