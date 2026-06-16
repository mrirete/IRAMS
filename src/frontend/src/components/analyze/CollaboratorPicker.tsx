/**
 * CollaboratorPicker — Search & invite users, teams, departments to a reliability study
 *
 * Dual-tab search: "People" (contacts) + "Teams" (organization_units)
 * Integrates with existing Contact and OrganizationUnit Supabase tables.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    X, Search, Users, Building2, UserPlus, Shield, Eye, Pencil,
    ChevronDown, Trash2, Check, Mail, User2,
} from 'lucide-react';
import analyzeService from '../../eam/services/AnalyzeService';
import type { StudyCollaborator } from '../../eam/services/AnalyzeService';

type CollabRole = StudyCollaborator['role'];

const ROLE_META: Record<CollabRole, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    owner:    { label: 'Owner',    color: 'text-amber-600',  bg: 'bg-amber-50 border-amber-200',  icon: <Shield size={10} /> },
    editor:   { label: 'Editor',   color: 'text-primary-600',   bg: 'bg-primary-50 border-primary-200',    icon: <Pencil size={10} /> },
    reviewer: { label: 'Reviewer', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: <Eye size={10} /> },
    viewer:   { label: 'Viewer',   color: 'text-slate-500',  bg: 'bg-slate-50 border-slate-200',  icon: <Eye size={10} /> },
};

// ── Avatar helper ──────────────────────────────────────
const getInitials = (name: string) => {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
};

const AVATAR_COLORS = [
    'bg-primary-500', 'bg-blue-500', 'bg-amber-500', 'bg-emerald-500',
    'bg-rose-500', 'bg-blue-500', 'bg-pink-500', 'bg-primary-500',
];
const colorFor = (id: string) => AVATAR_COLORS[Math.abs([...id].reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length];

// ── Mini Avatar Stack (for study cards) ──────────────
export const AvatarStack: React.FC<{ collaborators: StudyCollaborator[]; max?: number; size?: 'sm' | 'md' }> = ({
    collaborators = [],
    max = 4,
    size = 'sm',
}) => {
    if (!collaborators?.length) return null;
    const shown = collaborators.slice(0, max);
    const overflow = collaborators.length - max;
    const sz = size === 'md' ? 'w-7 h-7 text-[10px]' : 'w-5 h-5 text-[8px]';
    const offset = size === 'md' ? '-ml-2' : '-ml-1.5';

    return (
        <div className="flex items-center">
            {shown.map((c, i) => (
                <div key={c.id} className={`${sz} rounded-full flex items-center justify-center text-white font-bold ring-2 ring-white ${colorFor(c.ref_id)} ${i > 0 ? offset : ''}`}
                    title={`${c.name} (${ROLE_META[c.role].label})`}>
                    {c.type === 'org_unit' ? <Building2 size={size === 'md' ? 12 : 8} /> : getInitials(c.name)}
                </div>
            ))}
            {overflow > 0 && (
                <div className={`${sz} rounded-full flex items-center justify-center bg-slate-200 text-slate-600 font-bold ring-2 ring-white ${offset}`}>
                    +{overflow}
                </div>
            )}
        </div>
    );
};

// ── Team Panel (slide-out) ───────────────────────────
interface TeamPanelProps {
    collaborators: StudyCollaborator[];
    onAdd: (collab: StudyCollaborator) => void | Promise<void>;
    onRemove: (id: string) => void;
    onUpdateRole: (id: string, role: CollabRole) => void;
    onClose: () => void;
    accentColor?: string; // 'cyan' or 'violet'
}

export const TeamPanel: React.FC<TeamPanelProps> = ({
    collaborators,
    onAdd,
    onRemove,
    onUpdateRole,
    onClose,
    accentColor = 'cyan',
}) => {
    const [showPicker, setShowPicker] = useState(false);
    const [tab, setTab] = useState<'people' | 'teams'>('people');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [selectedRole, setSelectedRole] = useState<CollabRole>('editor');
    const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
    const [addingSaving, setAddingSaving] = useState(false);
    const [savedFlash, setSavedFlash] = useState<string | null>(null); // name of last saved
    const inputRef = useRef<HTMLInputElement>(null);

    // Debounced search — loads browse list on open, filters as user types
    useEffect(() => {
        if (!showPicker) return;
        // For short queries, do a browse (no filter); for 2+ chars, filter
        if (query.length > 0 && query.length < 2) return; // Wait for 2 chars to filter
        setSearching(true);
        const timer = setTimeout(async () => {
            const data = tab === 'people'
                ? await analyzeService.searchContacts(query)
                : await analyzeService.searchOrgUnits(query);
            setResults(data);
            setSearching(false);
        }, query.length >= 2 ? 300 : 50);
        return () => clearTimeout(timer);
    }, [query, tab, showPicker]);

    // Focus input when picker opens
    useEffect(() => {
        if (showPicker) setTimeout(() => inputRef.current?.focus(), 100);
    }, [showPicker]);

    const existingIds = new Set(collaborators.map(c => c.ref_id));

    const handleAddResult = useCallback(async (item: any) => {
        const newCollab: StudyCollaborator = {
            id: crypto.randomUUID(),
            type: tab === 'people' ? 'contact' : 'org_unit',
            ref_id: item.id,
            name: item.name,
            role: selectedRole,
            department: tab === 'people' ? (item.title || undefined) : (item.type || undefined),
            email: item.email || undefined,
            added_at: new Date().toISOString(),
        };
        setAddingSaving(true);
        try {
            await onAdd(newCollab);
            setSavedFlash(newCollab.name);
            setTimeout(() => setSavedFlash(null), 3000);
        } catch (e) {
            console.error('[TeamPanel] Add failed:', e);
        } finally {
            setAddingSaving(false);
        }
        setQuery('');
        setResults([]);
    }, [tab, selectedRole, onAdd]);

    const accent = accentColor === 'violet'
        ? { btn: 'bg-primary-600 hover:bg-primary-500', light: 'bg-blue-50 border-blue-200 text-blue-700', ring: 'focus:ring-blue-200 focus:border-blue-400' }
        : { btn: 'bg-primary-600 hover:bg-primary-700', light: 'bg-primary-50 border-primary-200 text-primary-700', ring: 'focus:ring-primary-200 focus:border-primary-400' };

    return (
        <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
            <div className="w-full max-w-md bg-white shadow-2xl h-full flex flex-col animate-in slide-in-from-right duration-300" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div>
                        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                            <Users size={16} className={accentColor === 'violet' ? 'text-blue-600' : 'text-primary-600'} /> Study Team
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">{collaborators.length} member{collaborators.length !== 1 ? 's' : ''}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X size={16} /></button>
                </div>

                {/* Invite button */}
                <div className="px-5 py-3 border-b border-slate-50">
                    {!showPicker ? (
                        <button onClick={() => setShowPicker(true)}
                            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 ${accent.btn} text-white text-sm font-medium rounded-lg shadow-sm transition-all`}>
                            <UserPlus size={14} /> Invite People or Teams
                        </button>
                    ) : (
                        <div className="space-y-2.5">
                            {/* Tabs */}
                            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                                <button onClick={() => { setTab('people'); setQuery(''); }}
                                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === 'people' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                                    <User2 size={12} /> People
                                </button>
                                <button onClick={() => { setTab('teams'); setQuery(''); }}
                                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${tab === 'teams' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                                    <Building2 size={12} /> Teams / Departments
                                </button>
                            </div>

                            {/* Search + Role selector */}
                            <div className="flex gap-2">
                                <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
                                    <Search size={13} className="text-slate-400 shrink-0" />
                                    <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
                                        placeholder={tab === 'people' ? 'Search by name, ID, or email…' : 'Search team or department…'}
                                        className={`flex-1 text-sm outline-none bg-transparent text-slate-700 placeholder-slate-400`} />
                                    {searching && <span className="text-[9px] text-slate-400 animate-pulse shrink-0">searching…</span>}
                                </div>
                                <select value={selectedRole} onChange={e => setSelectedRole(e.target.value as CollabRole)}
                                    className="px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 outline-none cursor-pointer">
                                    <option value="editor">Editor</option>
                                    <option value="reviewer">Reviewer</option>
                                    <option value="viewer">Viewer</option>
                                </select>
                            </div>

                            {/* Results */}
                            {results.length > 0 && (
                                <div className="bg-white border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-50">
                                    {results.map(item => {
                                        const already = existingIds.has(item.id);
                                        return (
                                            <div key={item.id}
                                                className={`flex items-center gap-3 px-3 py-2.5 ${already ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50 cursor-pointer'} transition-colors`}
                                                onClick={() => !already && handleAddResult(item)}>
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${colorFor(item.id)} shrink-0`}>
                                                    {tab === 'teams' ? <Building2 size={14} /> : getInitials(item.name)}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                                                    <p className="text-[10px] text-slate-400 truncate">
                                                        {tab === 'people'
                                                            ? [item.code, item.title, item.email].filter(Boolean).join(' · ')
                                                            : [item.code, item.type, item.description].filter(Boolean).join(' · ')}
                                                    </p>
                                                </div>
                                                {already ? (
                                                    <span className="text-[9px] text-slate-400 font-medium shrink-0">Added</span>
                                                ) : (
                                                    <UserPlus size={14} className="text-slate-300 shrink-0" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Empty state */}
                            {query.length >= 2 && !searching && results.length === 0 && (
                                <p className="text-xs text-slate-400 text-center py-3">No {tab === 'people' ? 'people' : 'teams'} match "{query}"</p>
                            )}

                            <button onClick={() => { setShowPicker(false); setQuery(''); setResults([]); }}
                                className="w-full text-xs text-slate-400 hover:text-slate-600 text-center py-1">
                                Close search
                            </button>
                        </div>
                    )}
                </div>

                {/* Current members list */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                    {collaborators.length === 0 ? (
                        <div className="text-center py-12">
                            <Users size={28} className="mx-auto text-slate-200 mb-2" />
                            <p className="text-sm text-slate-400 font-medium">No team members yet</p>
                            <p className="text-xs text-slate-300 mt-1 max-w-xs mx-auto">Invite people, teams, or departments to collaborate on this study.</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {collaborators.map(c => (
                                <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 group transition-colors">
                                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${colorFor(c.ref_id)} shrink-0`}>
                                        {c.type === 'org_unit' ? <Building2 size={14} /> : getInitials(c.name)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            {c.type === 'org_unit' && <Building2 size={8} className="text-slate-400" />}
                                            {c.department && <span className="text-[9px] text-slate-400">{c.department}</span>}
                                            {c.email && <span className="text-[9px] text-slate-400 flex items-center gap-0.5"><Mail size={7} /> {c.email}</span>}
                                        </div>
                                    </div>
                                    {/* Role dropdown */}
                                    <div className="relative">
                                        {editingRoleId === c.id ? (
                                            <select
                                                autoFocus
                                                value={c.role}
                                                onChange={e => { onUpdateRole(c.id, e.target.value as CollabRole); setEditingRoleId(null); }}
                                                onBlur={() => setEditingRoleId(null)}
                                                className="text-[10px] px-2 py-1 border border-slate-200 rounded-md outline-none bg-white"
                                            >
                                                <option value="owner">Owner</option>
                                                <option value="editor">Editor</option>
                                                <option value="reviewer">Reviewer</option>
                                                <option value="viewer">Viewer</option>
                                            </select>
                                        ) : (
                                            <button onClick={() => setEditingRoleId(c.id)}
                                                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${ROLE_META[c.role].bg} ${ROLE_META[c.role].color} hover:opacity-80 transition-opacity`}>
                                                {ROLE_META[c.role].icon} {ROLE_META[c.role].label}
                                                <ChevronDown size={8} />
                                            </button>
                                        )}
                                    </div>
                                    {/* Remove */}
                                    <button onClick={() => onRemove(c.id)}
                                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                                        title="Remove from study">
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer summary */}
                <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>{collaborators.filter(c => c.type === 'contact').length} people · {collaborators.filter(c => c.type === 'org_unit').length} teams</span>
                        {addingSaving ? (
                            <span className="flex items-center gap-1 text-amber-500 font-semibold animate-pulse">
                                <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" /> Saving…
                            </span>
                        ) : savedFlash ? (
                            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                                <Check size={10} /> {savedFlash} saved · ⚡ Notification sent
                            </span>
                        ) : (
                            <span>Changes auto-saved</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TeamPanel;
