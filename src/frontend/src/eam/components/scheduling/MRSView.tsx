import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
    Users, Calendar, Clock, ChevronLeft, ChevronRight, GripVertical,
    User, AlertTriangle, Briefcase, ChevronDown, ChevronUp, Search,
    Loader2, Inbox, X, UserCircle
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export interface LaborResource {
    contactId: string;
    name: string;
    craftTypes: string[];
    hourlyRate: number;
    dailyCapacityHours: number;
    workingDays: string[]; // e.g. ['Mon','Tue','Wed','Thu','Fri']
    qualifications: { name: string; status: string; expires: string }[];
    orgUnitIds: string[];
    assignments: { woId: string; woNumber: string; date: string; hours: number; title?: string; priority?: string }[];
    availableHoursPerDay: Record<string, number>;
}

export interface MRSViewProps {
    resources: LaborResource[];
    jobs: any[]; // WorkOrder[]
    currentDate: Date;
    onDateChange: (d: Date) => void;
    onAssignJob: (woId: string, contactId: string, date: string) => void;
    loading?: boolean;
}

// ─────────────────────────────────────────────────────────
// Constants & Utilities
// ─────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
    EMERGENCY: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' },
    HIGH:      { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
    MEDIUM:    { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
    LOW:       { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' },
};

const CRAFT_COLORS: Record<string, string> = {
    ELECTRICIAN: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    MECHANIC:    'bg-sky-100 text-sky-800 border-sky-300',
    INSTRUMENT:  'bg-purple-100 text-purple-800 border-purple-300',
    OPERATOR:    'bg-emerald-100 text-emerald-800 border-emerald-300',
    TECHNICIAN:  'bg-indigo-100 text-indigo-800 border-indigo-300',
    SUPERVISOR:  'bg-rose-100 text-rose-800 border-rose-300',
    PLUMBER:     'bg-cyan-100 text-cyan-800 border-cyan-300',
    WELDER:      'bg-amber-100 text-amber-800 border-amber-300',
};

function getPriorityStyle(priority: string) {
    const key = priority?.toUpperCase() || 'MEDIUM';
    return PRIORITY_COLORS[key] || PRIORITY_COLORS.MEDIUM;
}

function getCraftStyle(craft: string) {
    const key = craft?.toUpperCase() || '';
    return CRAFT_COLORS[key] || 'bg-slate-100 text-slate-700 border-slate-300';
}

/** Get Monday of the week containing the given date */
function getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // Monday = start
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Get 7 days starting from Monday of the week */
function getWeekDates(date: Date): Date[] {
    const monday = getWeekStart(date);
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d;
    });
}

function formatDateKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayHeader(d: Date): { dayName: string; dateLabel: string; fullLabel: string } {
    return {
        dayName: DAY_NAMES[d.getDay()],
        dateLabel: `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`,
        fullLabel: DAY_NAMES_FULL[d.getDay()],
    };
}

function isToday(d: Date): boolean {
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function getInitials(name: string): string {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─────────────────────────────────────────────────────────
// Skeleton Loader
// ─────────────────────────────────────────────────────────

const SkeletonRow: React.FC = () => (
    <div className="flex border-b border-slate-100 animate-pulse">
        <div className="w-56 lg:w-64 shrink-0 p-3 border-r border-slate-100">
            <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-200" />
                <div className="flex-1 space-y-2">
                    <div className="h-3.5 bg-slate-200 rounded w-28" />
                    <div className="h-2.5 bg-slate-100 rounded w-20" />
                </div>
            </div>
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex-1 min-w-0 p-2 border-r border-slate-50">
                <div className="h-8 bg-slate-100 rounded-md mb-1.5" />
                <div className="h-6 bg-slate-50 rounded-md w-3/4" />
            </div>
        ))}
    </div>
);

const SkeletonLoader: React.FC = () => (
    <div className="flex-1 overflow-hidden">
        {/* Header skeleton */}
        <div className="flex border-b border-slate-200 animate-pulse">
            <div className="w-56 lg:w-64 shrink-0 p-4 border-r border-slate-200">
                <div className="h-4 bg-slate-200 rounded w-24" />
            </div>
            {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex-1 min-w-0 p-3 border-r border-slate-100">
                    <div className="h-3 bg-slate-200 rounded w-12 mx-auto mb-1.5" />
                    <div className="h-2.5 bg-slate-100 rounded w-16 mx-auto" />
                </div>
            ))}
        </div>
        {/* Rows */}
        {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
        ))}
    </div>
);

// ─────────────────────────────────────────────────────────
// WO Chip (Draggable)
// ─────────────────────────────────────────────────────────

interface WOChipProps {
    woId: string;
    woNumber: string;
    title?: string;
    hours?: number;
    priority?: string;
    isDraggable?: boolean;
    compact?: boolean;
}

const WOChip: React.FC<WOChipProps> = ({ woId, woNumber, title, hours, priority, isDraggable = true, compact = false }) => {
    const style = getPriorityStyle(priority || 'MEDIUM');

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('application/mrs-wo-id', woId);
        e.dataTransfer.setData('application/mrs-wo-number', woNumber);
        e.dataTransfer.setData('application/mrs-wo-title', title || '');
        e.dataTransfer.setData('application/mrs-wo-hours', String(hours || 0));
        e.dataTransfer.setData('application/mrs-wo-priority', priority || 'MEDIUM');
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            draggable={isDraggable}
            onDragStart={handleDragStart}
            className={`group relative flex items-center gap-1.5 px-2 py-1 rounded-md border
                ${style.bg} ${style.border} ${style.text}
                ${isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
                hover:shadow-sm transition-all duration-150 text-[11px] leading-tight select-none
                ${compact ? 'py-0.5' : ''}
            `}
            title={`${woNumber}${title ? ` — ${title}` : ''}${hours ? ` (${hours}h)` : ''}`}
        >
            {isDraggable && (
                <GripVertical size={10} className="text-current opacity-40 group-hover:opacity-70 shrink-0 hidden sm:block" />
            )}
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot} shrink-0`} />
            <span className="font-semibold truncate">{woNumber}</span>
            {hours != null && hours > 0 && (
                <span className="text-[10px] opacity-70 shrink-0">{hours}h</span>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Capacity Utilization Bar
// ─────────────────────────────────────────────────────────

interface CapacityBarProps {
    assigned: number;
    capacity: number;
}

const CapacityBar: React.FC<CapacityBarProps> = ({ assigned, capacity }) => {
    const pct = capacity > 0 ? Math.min((assigned / capacity) * 100, 120) : 0;
    const displayPct = Math.min(pct, 100);

    let barColor = 'from-emerald-400 to-emerald-500'; // < 80%
    let textColor = 'text-emerald-700';
    if (pct >= 100) {
        barColor = 'from-red-400 to-red-500';
        textColor = 'text-red-700';
    } else if (pct >= 80) {
        barColor = 'from-amber-400 to-amber-500';
        textColor = 'text-amber-700';
    }

    return (
        <div className="px-1.5">
            <div className="relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                    className={`absolute inset-y-0 left-0 bg-gradient-to-r ${barColor} rounded-full transition-all duration-500 ease-out`}
                    style={{ width: `${displayPct}%` }}
                />
            </div>
            <div className={`text-[9px] font-medium ${textColor} text-center mt-0.5 tabular-nums`}>
                {assigned}/{capacity}h
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Day Cell (Drop Target)
// ─────────────────────────────────────────────────────────

interface DayCellProps {
    contactId: string;
    date: Date;
    dateKey: string;
    assignments: LaborResource['assignments'];
    isWorkingDay: boolean;
    isTodayCol: boolean;
    isOverAllocated: boolean;
    onDrop: (woId: string, contactId: string, dateKey: string) => void;
}

const DayCell: React.FC<DayCellProps> = ({
    contactId, date, dateKey, assignments, isWorkingDay, isTodayCol, isOverAllocated, onDrop,
}) => {
    const [dragOver, setDragOver] = useState(false);
    const dayAssignments = assignments.filter(a => a.date === dateKey);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOver(true);
    };

    const handleDragLeave = () => setDragOver(false);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const woId = e.dataTransfer.getData('application/mrs-wo-id');
        if (woId) {
            onDrop(woId, contactId, dateKey);
        }
    };

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
                relative flex-1 min-w-0 p-1.5 border-r border-slate-50 transition-colors duration-150
                ${!isWorkingDay ? 'bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,#f1f5f9_4px,#f1f5f9_6px)]' : ''}
                ${isTodayCol ? 'border-l-2 border-l-blue-400 bg-blue-50/30' : ''}
                ${isOverAllocated ? 'ring-1 ring-inset ring-red-300' : ''}
                ${dragOver ? 'bg-blue-100/60 ring-2 ring-inset ring-blue-400 ring-opacity-60' : ''}
            `}
        >
            {dayAssignments.length > 0 ? (
                <div className="space-y-1">
                    {dayAssignments.map((a, idx) => (
                        <WOChip
                            key={`${a.woId}-${idx}`}
                            woId={a.woId}
                            woNumber={a.woNumber}
                            title={a.title}
                            hours={a.hours}
                            priority={a.priority}
                            isDraggable={false}
                            compact={dayAssignments.length > 2}
                        />
                    ))}
                </div>
            ) : isWorkingDay ? (
                <div className={`h-full min-h-[2rem] flex items-center justify-center transition-opacity ${dragOver ? 'opacity-100' : 'opacity-0'}`}>
                    <span className="text-[10px] text-blue-400 font-medium">Drop here</span>
                </div>
            ) : null}
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Resource Row
// ─────────────────────────────────────────────────────────

interface ResourceRowProps {
    resource: LaborResource;
    weekDates: Date[];
    onDrop: (woId: string, contactId: string, dateKey: string) => void;
}

const ResourceRow: React.FC<ResourceRowProps> = ({ resource, weekDates, onDrop }) => {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            className={`flex border-b border-slate-100 transition-colors duration-100 ${hovered ? 'bg-slate-50/70' : ''}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Resource Info Cell */}
            <div className="w-56 lg:w-64 shrink-0 p-2.5 border-r border-slate-200 flex items-start gap-2.5">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-white text-[11px] font-bold shrink-0 shadow-sm">
                    {getInitials(resource.name)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate leading-tight">
                        {resource.name}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                        {resource.craftTypes.slice(0, 2).map(craft => (
                            <span
                                key={craft}
                                className={`inline-flex items-center px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide rounded border ${getCraftStyle(craft)}`}
                            >
                                {craft}
                            </span>
                        ))}
                        {resource.craftTypes.length > 2 && (
                            <span className="text-[9px] text-slate-400 font-medium">+{resource.craftTypes.length - 2}</span>
                        )}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-medium">
                        ${resource.hourlyRate}/hr
                    </div>
                </div>
            </div>

            {/* Day Cells */}
            {weekDates.map(date => {
                const dateKey = formatDateKey(date);
                const dayName = DAY_NAMES[date.getDay()];
                const isWorkingDay = resource.workingDays.includes(dayName);
                const isTodayCol = isToday(date);
                const assignedHours = resource.assignments
                    .filter(a => a.date === dateKey)
                    .reduce((sum, a) => sum + (a.hours || 0), 0);
                const capacity = resource.availableHoursPerDay[dateKey] ?? (isWorkingDay ? resource.dailyCapacityHours : 0);
                const isOverAllocated = assignedHours > capacity && capacity > 0;

                return (
                    <DayCell
                        key={dateKey}
                        contactId={resource.contactId}
                        date={date}
                        dateKey={dateKey}
                        assignments={resource.assignments}
                        isWorkingDay={isWorkingDay}
                        isTodayCol={isTodayCol}
                        isOverAllocated={isOverAllocated}
                        onDrop={onDrop}
                    />
                );
            })}
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Craft Group Section
// ─────────────────────────────────────────────────────────

interface CraftGroupProps {
    craftName: string;
    resources: LaborResource[];
    weekDates: Date[];
    onDrop: (woId: string, contactId: string, dateKey: string) => void;
    defaultExpanded?: boolean;
}

const CraftGroup: React.FC<CraftGroupProps> = ({ craftName, resources, weekDates, onDrop, defaultExpanded = true }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const craftStyle = getCraftStyle(craftName);

    return (
        <div>
            {/* Section Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50/80 border-b border-slate-200
                    text-xs font-bold uppercase tracking-wider text-slate-500
                    hover:bg-slate-100/80 transition-colors duration-100 sticky left-0"
            >
                {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] ${craftStyle}`}>
                    {craftName}
                </span>
                <span className="text-slate-400 font-medium normal-case tracking-normal">
                    {resources.length} {resources.length === 1 ? 'resource' : 'resources'}
                </span>
                <div className="flex-1" />
            </button>

            {/* Resource Rows */}
            {expanded && resources.map(resource => (
                <ResourceRow
                    key={resource.contactId}
                    resource={resource}
                    weekDates={weekDates}
                    onDrop={onDrop}
                />
            ))}
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// Unscheduled Pool Sidebar
// ─────────────────────────────────────────────────────────

interface UnscheduledPoolProps {
    jobs: any[];
    isOpen: boolean;
    onToggle: () => void;
}

const UnscheduledPool: React.FC<UnscheduledPoolProps> = ({ jobs, isOpen, onToggle }) => {
    const [search, setSearch] = useState('');

    const unscheduledJobs = useMemo(() => {
        return jobs.filter(j => {
            const hasNoDate = !j.dateDueStart && !j.dueDate;
            const isOpen = !['TECO', 'CLOSED', 'CANC', 'CANCELLED'].includes(j.status?.toUpperCase());
            return hasNoDate && isOpen;
        });
    }, [jobs]);

    const filtered = useMemo(() => {
        if (!search.trim()) return unscheduledJobs;
        const q = search.toLowerCase();
        return unscheduledJobs.filter(j =>
            (j.woNumber || '').toLowerCase().includes(q) ||
            (j.title || '').toLowerCase().includes(q) ||
            (j.assetName || '').toLowerCase().includes(q)
        );
    }, [unscheduledJobs, search]);

    return (
        <div
            className={`
                border-l border-slate-200 bg-white flex flex-col transition-all duration-300 ease-in-out
                ${isOpen ? 'w-72 xl:w-80' : 'w-11'}
            `}
        >
            {/* Toggle Button */}
            <button
                onClick={onToggle}
                className="flex items-center gap-2 px-3 py-3 border-b border-slate-200 hover:bg-slate-50 transition-colors"
                title={isOpen ? 'Collapse pool' : 'Expand unscheduled pool'}
            >
                {isOpen ? (
                    <>
                        <Inbox size={16} className="text-slate-500 shrink-0" />
                        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide flex-1 text-left">
                            Unscheduled
                        </span>
                        <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {unscheduledJobs.length}
                        </span>
                        <X size={14} className="text-slate-400" />
                    </>
                ) : (
                    <div className="flex flex-col items-center gap-1">
                        <Inbox size={16} className="text-slate-500" />
                        <span className="bg-blue-100 text-blue-700 text-[9px] font-bold px-1 py-0.5 rounded-full leading-none">
                            {unscheduledJobs.length}
                        </span>
                    </div>
                )}
            </button>

            {/* Content */}
            {isOpen && (
                <>
                    {/* Search */}
                    <div className="px-2.5 py-2 border-b border-slate-100">
                        <div className="relative">
                            <Search className="absolute left-2 top-1.5 text-slate-400" size={12} />
                            <input
                                type="text"
                                placeholder="Filter WOs…"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full pl-6 pr-2 py-1 border border-slate-200 rounded-md text-[11px] bg-white
                                    focus:outline-none focus:ring-1 focus:ring-blue-200 focus:border-blue-400"
                            />
                        </div>
                    </div>

                    {/* WO List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        {filtered.length === 0 ? (
                            <div className="text-center py-8">
                                <Briefcase size={24} className="text-slate-300 mx-auto mb-2" />
                                <p className="text-[11px] text-slate-400 font-medium">
                                    {unscheduledJobs.length === 0 ? 'All jobs scheduled' : 'No matching jobs'}
                                </p>
                            </div>
                        ) : (
                            filtered.map(job => (
                                <div
                                    key={job.id}
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('application/mrs-wo-id', job.id);
                                        e.dataTransfer.setData('application/mrs-wo-number', job.woNumber || job.id);
                                        e.dataTransfer.setData('application/mrs-wo-title', job.title || '');
                                        e.dataTransfer.setData('application/mrs-wo-hours', String(job.estDuration || 0));
                                        e.dataTransfer.setData('application/mrs-wo-priority', job.priority || 'MEDIUM');
                                        e.dataTransfer.effectAllowed = 'move';
                                    }}
                                    className="group p-2 rounded-lg border border-slate-200 bg-white
                                        hover:border-blue-300 hover:shadow-sm cursor-grab active:cursor-grabbing
                                        transition-all duration-150"
                                >
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <GripVertical size={10} className="text-slate-300 group-hover:text-slate-500 shrink-0" />
                                        <span className={`w-1.5 h-1.5 rounded-full ${getPriorityStyle(job.priority || 'MEDIUM').dot} shrink-0`} />
                                        <span className="text-[11px] font-bold text-slate-700 truncate">
                                            {job.woNumber || job.id}
                                        </span>
                                        {job.estDuration > 0 && (
                                            <span className="text-[9px] text-slate-400 ml-auto shrink-0 flex items-center gap-0.5">
                                                <Clock size={8} />
                                                {job.estDuration}h
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-slate-500 truncate pl-4">
                                        {job.title || 'Untitled'}
                                    </p>
                                    {job.assetName && (
                                        <p className="text-[9px] text-slate-400 truncate pl-4 mt-0.5">
                                            {job.assetName}
                                        </p>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────
// MAIN COMPONENT — MRSView
// ─────────────────────────────────────────────────────────

export const MRSView: React.FC<MRSViewProps> = ({
    resources,
    jobs,
    currentDate,
    onDateChange,
    onAssignJob,
    loading = false,
}) => {
    const [poolOpen, setPoolOpen] = useState(true);
    const [myScheduleMode, setMyScheduleMode] = useState(false);
    const gridRef = useRef<HTMLDivElement>(null);
    const { permissions } = useAuth();

    // Responsive: detect small screen
    const [isSmallScreen, setIsSmallScreen] = useState(false);
    useEffect(() => {
        const check = () => setIsSmallScreen(window.innerWidth < 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    // Week dates (Mon–Sun), or 3 days on mobile
    const allWeekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);
    const weekDates = useMemo(() => {
        if (!isSmallScreen) return allWeekDates;
        // On small screens: show today + next 2 days
        const todayIdx = allWeekDates.findIndex(d => isToday(d));
        const startIdx = todayIdx >= 0 ? todayIdx : 0;
        return allWeekDates.slice(startIdx, startIdx + 3);
    }, [allWeekDates, isSmallScreen]);

    // Group resources by primary craft type
    const craftGroups = useMemo(() => {
        // GAP-H: Filter to current user's resource in My Schedule mode
        const effectiveResources = myScheduleMode && (permissions as any)?.username
            ? resources.filter(r => {
                // Match by contactId (username) or by name (fallback)
                const username = ((permissions as any).username as string).toLowerCase();
                return r.contactId === (permissions as any).username
                    || r.name.toLowerCase().includes(username)
                    || r.contactId.toLowerCase() === username;
            })
            : resources;

        const groups: Record<string, LaborResource[]> = {};
        effectiveResources.forEach(r => {
            const primaryCraft = r.craftTypes[0]?.toUpperCase() || 'OTHER';
            if (!groups[primaryCraft]) groups[primaryCraft] = [];
            groups[primaryCraft].push(r);
        });
        // Sort groups alphabetically, but put OTHER at end
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            if (a === 'OTHER') return 1;
            if (b === 'OTHER') return -1;
            return a.localeCompare(b);
        });
        return sortedKeys.map(key => ({ craftName: key, resources: groups[key] }));
    }, [resources, myScheduleMode, (permissions as any)?.username]);

    // Capacity aggregation per day (across all resources)
    const dayCapacity = useMemo(() => {
        const map: Record<string, { assigned: number; capacity: number }> = {};
        weekDates.forEach(date => {
            const dateKey = formatDateKey(date);
            let totalAssigned = 0;
            let totalCapacity = 0;
            resources.forEach(r => {
                const dayName = DAY_NAMES[date.getDay()];
                const isWorkingDay = r.workingDays.includes(dayName);
                const capacity = r.availableHoursPerDay[dateKey] ?? (isWorkingDay ? r.dailyCapacityHours : 0);
                const assigned = r.assignments
                    .filter(a => a.date === dateKey)
                    .reduce((sum, a) => sum + (a.hours || 0), 0);
                totalAssigned += assigned;
                totalCapacity += capacity;
            });
            map[dateKey] = { assigned: totalAssigned, capacity: totalCapacity };
        });
        return map;
    }, [weekDates, resources]);

    // Week navigation
    const navigateWeek = useCallback((direction: number) => {
        const d = new Date(currentDate);
        d.setDate(d.getDate() + 7 * direction);
        onDateChange(d);
    }, [currentDate, onDateChange]);

    const goToToday = useCallback(() => {
        onDateChange(new Date());
    }, [onDateChange]);

    // GAP-J: Handle drop with skill/qualification blocking
    const handleDrop = useCallback((woId: string, contactId: string, dateKey: string) => {
        const resource = resources.find(r => r.contactId === contactId);
        const wo = jobs.find((j: any) => j.id === woId);

        // Skill mismatch check — if WO type maps to a craft, verify the resource has it
        if (resource && wo) {
            const woType = ((wo as any).type || '').toUpperCase();
            const craftMap: Record<string, string> = {
                ELEC: 'ELECTRICIAN', ELECTRICAL: 'ELECTRICIAN',
                MECH: 'MECHANIC', MECHANICAL: 'MECHANIC',
                INST: 'INSTRUMENT', INSTRUMENTATION: 'INSTRUMENT',
                PIPE: 'PLUMBER', PIPING: 'PLUMBER',
                WELD: 'WELDER', WELDING: 'WELDER',
            };
            const requiredCraft = craftMap[woType];

            if (requiredCraft && !resource.craftTypes.some(ct => ct.toUpperCase() === requiredCraft)) {
                const proceed = window.confirm(
                    `⚠ SKILL MISMATCH\n\n` +
                    `Work order ${(wo as any).woNumber || woId} requires ${requiredCraft} craft,\n` +
                    `but ${resource.name} is qualified as: ${resource.craftTypes.join(', ')}.\n\n` +
                    `Do you still want to assign this job?`
                );
                if (!proceed) return;
            }

            // Qualification expiry check
            const expiredQuals = resource.qualifications.filter(q => {
                if (q.status === 'EXPIRED') return true;
                if (q.expires) {
                    try { return new Date(q.expires) < new Date(); } catch { return false; }
                }
                return false;
            });
            if (expiredQuals.length > 0) {
                const proceed = window.confirm(
                    `⚠ QUALIFICATION ALERT\n\n` +
                    `${resource.name} has ${expiredQuals.length} expired qualification(s):\n` +
                    `${expiredQuals.map(q => `• ${q.name} (expired ${q.expires})`).join('\n')}\n\n` +
                    `Do you still want to assign this job?`
                );
                if (!proceed) return;
            }
        }

        onAssignJob(woId, contactId, dateKey);
    }, [onAssignJob, resources, jobs]);

    // Week label
    const weekLabel = useMemo(() => {
        const monday = allWeekDates[0];
        const sunday = allWeekDates[6];
        const monthStart = monday.toLocaleString('en-GB', { month: 'short' });
        const monthEnd = sunday.toLocaleString('en-GB', { month: 'short' });
        const year = monday.getFullYear();
        if (monthStart === monthEnd) {
            return `${monday.getDate()} – ${sunday.getDate()} ${monthStart} ${year}`;
        }
        return `${monday.getDate()} ${monthStart} – ${sunday.getDate()} ${monthEnd} ${year}`;
    }, [allWeekDates]);

    // ─── Empty State ───
    if (!loading && resources.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="text-center max-w-sm px-6 py-16">
                    <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                        <Users size={28} className="text-slate-400" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-700 mb-2">No labor resources found</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">
                        Configure contacts as labor in the <span className="font-semibold text-blue-600">People</span> module.
                        Resources need craft types and working day configurations to appear in the scheduling grid.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* ─── Top Toolbar ─── */}
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-white shrink-0">
                <div className="flex items-center gap-3">
                    {/* MRS Icon + Title */}
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                            <Users size={16} className="text-white" />
                        </div>
                        <div className="hidden sm:block">
                            <h2 className="text-sm font-bold text-slate-800 leading-tight">Multi-Resource Scheduling</h2>
                            <p className="text-[10px] text-slate-400 font-medium">SAP MRS-style resource view</p>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-8 bg-slate-200 hidden sm:block" />

                    {/* Week Navigation */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => navigateWeek(-1)}
                            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                            title="Previous week"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={goToToday}
                            className="px-2.5 py-1 rounded-md text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors border border-blue-200"
                        >
                            Today
                        </button>
                        <button
                            onClick={() => navigateWeek(1)}
                            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                            title="Next week"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    {/* Week Label */}
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                        <Calendar size={14} className="text-slate-400" />
                        <span className="hidden md:inline">{weekLabel}</span>
                    </div>
                </div>

                {/* Right side — Resource count */}
                <div className="flex items-center gap-3">
                    {/* GAP-H: My Schedule toggle */}
                    <div className="flex bg-slate-100 rounded-lg p-0.5">
                        <button
                            onClick={() => setMyScheduleMode(false)}
                            className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition flex items-center gap-1 ${!myScheduleMode ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Users size={12} /> Team
                        </button>
                        <button
                            onClick={() => setMyScheduleMode(true)}
                            className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition flex items-center gap-1 ${myScheduleMode ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <UserCircle size={12} /> My Schedule
                        </button>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
                        <User size={12} className="text-slate-400" />
                        <span>{resources.length} resources</span>
                    </div>
                    {/* Pool toggle for mobile */}
                    <button
                        onClick={() => setPoolOpen(!poolOpen)}
                        className="sm:hidden p-1.5 rounded-md hover:bg-slate-100 text-slate-500 transition-colors"
                    >
                        <Inbox size={16} />
                    </button>
                </div>
            </div>

            {/* ─── Main Content ─── */}
            <div className="flex-1 flex overflow-hidden">
                {/* ─── Grid ─── */}
                <div className="flex-1 flex flex-col overflow-hidden" ref={gridRef}>
                    {loading ? (
                        <SkeletonLoader />
                    ) : (
                        <>
                            {/* ─── Column Headers ─── */}
                            <div className="flex border-b border-slate-200 bg-slate-50/50 shrink-0 sticky top-0 z-10">
                                {/* Resource label column */}
                                <div className="w-56 lg:w-64 shrink-0 px-3 py-2.5 border-r border-slate-200 flex items-center gap-2">
                                    <Users size={14} className="text-slate-400" />
                                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Resource</span>
                                </div>

                                {/* Day columns */}
                                {weekDates.map(date => {
                                    const dateKey = formatDateKey(date);
                                    const isTodayCol = isToday(date);
                                    const { dayName, dateLabel } = formatDayHeader(date);
                                    const cap = dayCapacity[dateKey] || { assigned: 0, capacity: 0 };

                                    return (
                                        <div
                                            key={dateKey}
                                            className={`flex-1 min-w-0 py-2 px-1 border-r border-slate-100 text-center
                                                ${isTodayCol ? 'bg-blue-50/50 border-l-2 border-l-blue-400' : ''}
                                            `}
                                        >
                                            <div className={`text-[10px] font-bold uppercase tracking-wider ${isTodayCol ? 'text-blue-600' : 'text-slate-400'}`}>
                                                {dayName}
                                            </div>
                                            <div className={`text-xs font-semibold ${isTodayCol ? 'text-blue-700' : 'text-slate-600'}`}>
                                                {dateLabel}
                                            </div>
                                            {/* Capacity utilization bar */}
                                            <div className="mt-1.5">
                                                <CapacityBar assigned={cap.assigned} capacity={cap.capacity} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* ─── Resource Rows (Grouped by Craft) ─── */}
                            <div className="flex-1 overflow-y-auto">
                                {craftGroups.map(group => (
                                    <CraftGroup
                                        key={group.craftName}
                                        craftName={group.craftName}
                                        resources={group.resources}
                                        weekDates={weekDates}
                                        onDrop={handleDrop}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* ─── Unscheduled Pool Sidebar ─── */}
                <UnscheduledPool
                    jobs={jobs}
                    isOpen={poolOpen}
                    onToggle={() => setPoolOpen(!poolOpen)}
                />
            </div>
        </div>
    );
};
