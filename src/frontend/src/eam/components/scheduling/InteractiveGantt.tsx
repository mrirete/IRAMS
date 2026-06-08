import React, { useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Calendar, Crosshair,
    Maximize2, GripHorizontal, AlertTriangle
} from 'lucide-react';
import { WorkOrder, DictionaryEntry } from '../../types';

// ── Types ────────────────────────────────────────────────────────────
type ZoomLevel = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER';

interface InteractiveGanttProps {
    jobs: WorkOrder[];
    onReschedule?: (woId: string, newStartDate: string, newEndDate: string) => void;
    dictionaries?: DictionaryEntry[];
}

// ── Priority Color Palette ───────────────────────────────────────────
const PRIORITY_COLORS: Record<string, { bar: string; barLight: string; text: string }> = {
    EMERGENCY: { bar: '#ef4444', barLight: '#fecaca', text: '#991b1b' },
    HIGH: { bar: '#f97316', barLight: '#fed7aa', text: '#9a3412' },
    MEDIUM: { bar: '#3b82f6', barLight: '#bfdbfe', text: '#1e40af' },
    LOW: { bar: '#22c55e', barLight: '#bbf7d0', text: '#166534' },
    DEFAULT: { bar: '#64748b', barLight: '#e2e8f0', text: '#334155' },
};
const STATUS_COMPLETED = ['CLOSED', 'TECO'];
const COMPLETED_COLOR = { bar: '#10b981', barLight: '#d1fae5', text: '#065f46' };

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 56;
const LABEL_WIDTH = 240;
const MIN_BAR_WIDTH = 6;

// ── Helpers ──────────────────────────────────────────────────────────

/** Days between two dates */
const daysBetween = (a: Date, b: Date): number =>
    Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));

/** ISO date string from Date */
const toISO = (d: Date): string => d.toISOString().split('T')[0];

/** Get the range start/end based on zoom level */
const getViewRange = (anchor: Date, zoom: ZoomLevel): { start: Date; end: Date; dayCount: number } => {
    const start = new Date(anchor);
    const end = new Date(anchor);

    switch (zoom) {
        case 'DAY':
            start.setDate(anchor.getDate() - 1);
            end.setDate(anchor.getDate() + 12); // ~14 day view
            break;
        case 'WEEK':
            start.setDate(anchor.getDate() - anchor.getDay() + 1); // Monday
            end.setDate(start.getDate() + 27); // 4 weeks
            break;
        case 'MONTH':
            start.setDate(1);
            end.setMonth(start.getMonth() + 1);
            end.setDate(0); // Last day of month
            break;
        case 'QUARTER':
            start.setDate(1);
            end.setMonth(start.getMonth() + 3);
            end.setDate(0);
            break;
    }

    return { start, end, dayCount: daysBetween(start, end) + 1 };
};

/** Generate date ticks for the header */
const generateTicks = (start: Date, dayCount: number, zoom: ZoomLevel): { date: Date; label: string; isMajor: boolean }[] => {
    const ticks: { date: Date; label: string; isMajor: boolean }[] = [];
    for (let i = 0; i < dayCount; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);

        let label = '';
        let isMajor = false;

        switch (zoom) {
            case 'DAY':
                label = d.getDate().toString();
                isMajor = d.getDay() === 1; // Monday
                break;
            case 'WEEK':
                label = d.getDate().toString();
                isMajor = d.getDate() === 1;
                break;
            case 'MONTH':
                label = d.getDate().toString();
                isMajor = d.getDay() === 1;
                break;
            case 'QUARTER':
                label = d.getDate() === 1 || d.getDate() === 15 ? d.getDate().toString() : '';
                isMajor = d.getDate() === 1;
                break;
        }

        ticks.push({ date: d, label, isMajor });
    }
    return ticks;
};

// ── Component ────────────────────────────────────────────────────────

export const InteractiveGantt: React.FC<InteractiveGanttProps> = ({
    jobs,
    onReschedule,
    dictionaries,
}) => {
    const navigate = useNavigate();
    const containerRef = useRef<HTMLDivElement>(null);

    // State
    const [anchorDate, setAnchorDate] = useState(new Date());
    const [zoom, setZoom] = useState<ZoomLevel>('MONTH');
    const [dragState, setDragState] = useState<{
        woId: string;
        mode: 'move' | 'resize';
        startX: number;
        originalStart: string;
        originalEnd: string;
    } | null>(null);
    const [dragPreview, setDragPreview] = useState<{ start: string; end: string } | null>(null);

    // Computed
    const { start: rangeStart, end: rangeEnd, dayCount } = useMemo(
        () => getViewRange(anchorDate, zoom),
        [anchorDate, zoom]
    );

    const ticks = useMemo(
        () => generateTicks(rangeStart, dayCount, zoom),
        [rangeStart, dayCount, zoom]
    );

    // Filter to jobs with dates that overlap the view range
    const visibleJobs = useMemo(() => {
        const rs = toISO(rangeStart);
        const re = toISO(rangeEnd);
        return jobs
            .filter(j => j.dateDueStart && j.dueDate)
            .filter(j => j.dueDate >= rs && j.dateDueStart <= re)
            .sort((a, b) => a.dateDueStart.localeCompare(b.dateDueStart));
    }, [jobs, rangeStart, rangeEnd]);

    // Column width per day
    const dayWidth = useMemo(() => {
        const available = (containerRef.current?.clientWidth || 1000) - LABEL_WIDTH;
        return Math.max(available / dayCount, zoom === 'QUARTER' ? 8 : 20);
    }, [dayCount, zoom, containerRef.current?.clientWidth]);

    const totalWidth = dayWidth * dayCount;

    // Today marker position
    const todayOffset = useMemo(() => {
        const diff = daysBetween(rangeStart, new Date());
        if (diff < 0 || diff > dayCount) return null;
        return diff * dayWidth;
    }, [rangeStart, dayCount, dayWidth]);

    // ── Bar Position Calc ────────────────────────────────────────────
    const getBarStyle = useCallback((startDate: string, endDate: string) => {
        const s = new Date(startDate);
        const e = new Date(endDate);
        const offsetDays = daysBetween(rangeStart, s);
        const durationDays = daysBetween(s, e) + 1;

        const left = Math.max(offsetDays * dayWidth, 0);
        const width = Math.max(durationDays * dayWidth, MIN_BAR_WIDTH);

        return { left, width };
    }, [rangeStart, dayWidth]);

    // ── Navigation ───────────────────────────────────────────────────
    const navigate_date = (dir: -1 | 1) => {
        const next = new Date(anchorDate);
        switch (zoom) {
            case 'DAY': next.setDate(next.getDate() + dir * 7); break;
            case 'WEEK': next.setDate(next.getDate() + dir * 28); break;
            case 'MONTH': next.setMonth(next.getMonth() + dir); break;
            case 'QUARTER': next.setMonth(next.getMonth() + dir * 3); break;
        }
        setAnchorDate(next);
    };

    const goToToday = () => setAnchorDate(new Date());

    const cycleZoom = (dir: 1 | -1) => {
        const levels: ZoomLevel[] = ['DAY', 'WEEK', 'MONTH', 'QUARTER'];
        const idx = levels.indexOf(zoom);
        const next = levels[Math.max(0, Math.min(levels.length - 1, idx + dir))];
        setZoom(next);
    };

    // ── Drag Handlers ────────────────────────────────────────────────
    const handleBarMouseDown = (e: React.MouseEvent, job: WorkOrder, mode: 'move' | 'resize') => {
        e.stopPropagation();
        e.preventDefault();
        setDragState({
            woId: job.id,
            mode,
            startX: e.clientX,
            originalStart: job.dateDueStart,
            originalEnd: job.dueDate,
        });
        setDragPreview({ start: job.dateDueStart, end: job.dueDate });
    };

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!dragState) return;
        const deltaX = e.clientX - dragState.startX;
        const deltaDays = Math.round(deltaX / dayWidth);

        if (deltaDays === 0 && !dragPreview) return;

        const origStart = new Date(dragState.originalStart);
        const origEnd = new Date(dragState.originalEnd);

        if (dragState.mode === 'move') {
            const newStart = new Date(origStart);
            newStart.setDate(newStart.getDate() + deltaDays);
            const newEnd = new Date(origEnd);
            newEnd.setDate(newEnd.getDate() + deltaDays);
            setDragPreview({ start: toISO(newStart), end: toISO(newEnd) });
        } else {
            // resize — only change end date
            const newEnd = new Date(origEnd);
            newEnd.setDate(newEnd.getDate() + deltaDays);
            if (newEnd >= origStart) {
                setDragPreview({ start: dragState.originalStart, end: toISO(newEnd) });
            }
        }
    }, [dragState, dayWidth]);

    const handleMouseUp = useCallback(() => {
        if (dragState && dragPreview) {
            const changed = dragPreview.start !== dragState.originalStart || dragPreview.end !== dragState.originalEnd;
            if (changed && onReschedule) {
                onReschedule(dragState.woId, dragPreview.start, dragPreview.end);
            }
        }
        setDragState(null);
        setDragPreview(null);
    }, [dragState, dragPreview, onReschedule]);

    // ── Color for a bar ──────────────────────────────────────────────
    const getBarColor = (job: WorkOrder) => {
        if (STATUS_COMPLETED.includes(job.status as string)) return COMPLETED_COLOR;
        const pKey = (job.priority || 'DEFAULT').toUpperCase();
        return PRIORITY_COLORS[pKey] || PRIORITY_COLORS.DEFAULT;
    };

    // ── Month header labels ──────────────────────────────────────────
    const monthHeaders = useMemo(() => {
        const headers: { label: string; startIdx: number; span: number }[] = [];
        let current = '';
        let startIdx = 0;
        let span = 0;

        ticks.forEach((t, i) => {
            const monthKey = `${t.date.getFullYear()}-${t.date.getMonth()}`;
            if (monthKey !== current) {
                if (current) headers.push({ label: current, startIdx, span });
                current = monthKey;
                startIdx = i;
                span = 1;
            } else {
                span++;
            }
        });
        if (current) headers.push({ label: current, startIdx, span });

        return headers.map(h => ({
            label: new Date(parseInt(h.label.split('-')[0]), parseInt(h.label.split('-')[1]))
                .toLocaleString('default', { month: 'long', year: 'numeric' }),
            left: h.startIdx * dayWidth,
            width: h.span * dayWidth,
        }));
    }, [ticks, dayWidth]);

    // ── Title ────────────────────────────────────────────────────────
    const viewTitle = useMemo(() => {
        const opts: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
        if (zoom === 'QUARTER') {
            return `${rangeStart.toLocaleDateString('default', opts)} — ${rangeEnd.toLocaleDateString('default', opts)}`;
        }
        return rangeStart.toLocaleDateString('default', opts);
    }, [rangeStart, rangeEnd, zoom]);

    // GAP-K: Dependency arrows for PROJECT scope WOs (parent → child)
    const dependencyArrows = useMemo(() => {
        const arrows: { fromIdx: number; toIdx: number; fromRight: number; toLeft: number }[] = [];
        visibleJobs.forEach((job, toIdx) => {
            if (!(job as any).parentWoId) return;
            const fromIdx = visibleJobs.findIndex(j => j.id === (job as any).parentWoId);
            if (fromIdx < 0) return;

            const parent = visibleJobs[fromIdx];
            const parentBar = getBarStyle(parent.dateDueStart, parent.dueDate);
            const childBar = getBarStyle(job.dateDueStart, job.dueDate);

            arrows.push({
                fromIdx,
                toIdx,
                fromRight: parentBar.left + parentBar.width,
                toLeft: childBar.left,
            });
        });
        return arrows;
    }, [visibleJobs, getBarStyle]);

    // ── Render ───────────────────────────────────────────────────────
    return (
        <div
            ref={containerRef}
            className="flex flex-col h-full bg-slate-50 select-none"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* ── Toolbar ── */}
            <div className="px-4 py-2.5 border-b border-slate-200 bg-white flex items-center justify-between flex-shrink-0 gap-3">
                <div className="flex items-center gap-3">
                    <button onClick={() => navigate_date(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition text-slate-500" title="Previous">
                        <ChevronLeft size={18} />
                    </button>
                    <h2 className="font-bold text-slate-800 text-sm min-w-[200px] text-center">{viewTitle}</h2>
                    <button onClick={() => navigate_date(1)} className="p-1.5 rounded-lg hover:bg-slate-100 transition text-slate-500" title="Next">
                        <ChevronRight size={18} />
                    </button>
                    <button
                        onClick={goToToday}
                        className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition flex items-center gap-1.5"
                    >
                        <Crosshair size={13} /> Today
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    {/* Zoom controls */}
                    <div className="flex bg-slate-100 rounded-lg p-0.5">
                        {(['DAY', 'WEEK', 'MONTH', 'QUARTER'] as ZoomLevel[]).map(z => (
                            <button
                                key={z}
                                onClick={() => setZoom(z)}
                                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition ${zoom === z ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {z === 'DAY' ? '2W' : z === 'WEEK' ? '4W' : z === 'MONTH' ? 'Mo' : 'Qtr'}
                            </button>
                        ))}
                    </div>

                    {/* Legend */}
                    <div className="hidden md:flex items-center gap-3 ml-3 text-[11px] text-slate-500">
                        <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-blue-500"></div> Planned</span>
                        <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-emerald-500"></div> Completed</span>
                        <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-red-500"></div> Emergency</span>
                        <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-orange-500"></div> High</span>
                    </div>
                </div>
            </div>

            {/* ── Chart Body ── */}
            <div className="flex-1 overflow-auto relative" style={{ cursor: dragState ? 'grabbing' : 'default' }}>
                <div style={{ width: LABEL_WIDTH + totalWidth, minHeight: visibleJobs.length * ROW_HEIGHT + HEADER_HEIGHT + 20 }}>
                    {/* ── Header Row ── */}
                    <div className="flex sticky top-0 z-20 bg-white border-b border-slate-200" style={{ height: HEADER_HEIGHT }}>
                        {/* Label column header */}
                        <div className="flex-shrink-0 sticky left-0 z-30 bg-white border-r border-slate-200" style={{ width: LABEL_WIDTH }}>
                            <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase">Asset / Job</div>
                            <div className="px-3 text-[10px] text-slate-400">{visibleJobs.length} item{visibleJobs.length !== 1 ? 's' : ''}</div>
                        </div>

                        {/* Date headers */}
                        <div className="relative" style={{ width: totalWidth }}>
                            {/* Month row */}
                            <div className="flex h-6 border-b border-slate-100">
                                {monthHeaders.map((mh, i) => (
                                    <div
                                        key={i}
                                        className="text-[10px] font-bold text-slate-600 truncate px-2 flex items-center border-r border-slate-100"
                                        style={{ position: 'absolute', left: mh.left, width: mh.width }}
                                    >
                                        {mh.label}
                                    </div>
                                ))}
                            </div>

                            {/* Day ticks */}
                            <div className="flex h-[30px]">
                                {ticks.map((t, i) => {
                                    const isWeekend = t.date.getDay() === 0 || t.date.getDay() === 6;
                                    const isToday = toISO(t.date) === toISO(new Date());
                                    return (
                                        <div
                                            key={i}
                                            className={`text-center text-[9px] flex items-center justify-center border-r ${t.isMajor ? 'border-slate-200' : 'border-slate-50'} ${isWeekend ? 'bg-slate-50/60 text-slate-300' : 'text-slate-500'} ${isToday ? 'font-bold text-blue-600 bg-blue-50' : ''}`}
                                            style={{ width: dayWidth, minWidth: dayWidth }}
                                        >
                                            {t.label}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* ── Rows ── */}
                    {visibleJobs.map((job, rowIdx) => {
                        const isActive = dragState?.woId === job.id;
                        const displayStart = isActive && dragPreview ? dragPreview.start : job.dateDueStart;
                        const displayEnd = isActive && dragPreview ? dragPreview.end : job.dueDate;
                        const barStyle = getBarStyle(displayStart, displayEnd);
                        const color = getBarColor(job);
                        const isCompleted = STATUS_COMPLETED.includes(job.status as string);

                        return (
                            <div
                                key={job.id}
                                className={`flex border-b border-slate-100 ${isActive ? 'bg-blue-50/30' : rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-blue-50/20 transition-colors group`}
                                style={{ height: ROW_HEIGHT }}
                            >
                                {/* Label */}
                                <div
                                    className="flex-shrink-0 sticky left-0 z-10 bg-inherit border-r border-slate-200 px-3 flex flex-col justify-center cursor-pointer hover:bg-slate-50 group-hover:bg-blue-50/20"
                                    style={{ width: LABEL_WIDTH }}
                                    onClick={() => navigate(`/work-orders/${job.id}`)}
                                    title={`${job.woNumber} — ${job.title}`}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-mono text-[10px] font-bold text-slate-500">{job.woNumber}</span>
                                        {job.priority === 'EMERGENCY' && <AlertTriangle size={10} className="text-red-500" />}
                                    </div>
                                    <div className="text-xs text-slate-700 truncate max-w-[200px]">{job.title}</div>
                                </div>

                                {/* Bar area */}
                                <div className="relative" style={{ width: totalWidth }}>
                                    {/* Weekend stripes */}
                                    {ticks.map((t, i) => {
                                        if (t.date.getDay() !== 0 && t.date.getDay() !== 6) return null;
                                        return <div key={i} className="absolute inset-y-0 bg-slate-50/60" style={{ left: i * dayWidth, width: dayWidth }} />;
                                    })}

                                    {/* Today marker line (within row) */}
                                    {todayOffset !== null && (
                                        <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-[5] opacity-60" style={{ left: todayOffset }} />
                                    )}

                                    {/* Baseline bar (original date — thin grey bar above main bar) */}
                                    {isActive && dragPreview && (dragPreview.start !== job.dateDueStart || dragPreview.end !== job.dueDate) && (
                                        <div
                                            className="absolute rounded-sm opacity-40"
                                            style={{
                                                ...(() => {
                                                    const bs = getBarStyle(job.dateDueStart, job.dueDate);
                                                    return { left: bs.left, width: bs.width };
                                                })(),
                                                height: 4,
                                                top: ROW_HEIGHT / 2 - 12,
                                                backgroundColor: '#94a3b8',
                                            }}
                                        />
                                    )}

                                    {/* Main bar */}
                                    <div
                                        className={`absolute rounded-md flex items-center gap-1 px-1.5 text-[10px] font-bold overflow-hidden whitespace-nowrap transition-shadow ${isActive ? 'shadow-lg ring-2 ring-blue-400 z-10' : 'shadow-sm hover:shadow-md'} ${!isCompleted && onReschedule ? 'cursor-grab' : 'cursor-pointer'}`}
                                        style={{
                                            left: barStyle.left,
                                            width: barStyle.width,
                                            height: 24,
                                            top: (ROW_HEIGHT - 24) / 2,
                                            backgroundColor: color.bar,
                                            color: 'white',
                                        }}
                                        onMouseDown={(e) => {
                                            if (!isCompleted && onReschedule) handleBarMouseDown(e, job, 'move');
                                        }}
                                        onClick={(e) => {
                                            if (!dragState) navigate(`/work-orders/${job.id}`);
                                        }}
                                        title={`${job.woNumber}: ${job.dateDueStart} → ${job.dueDate} | ${job.status} | ${job.assetName}`}
                                    >
                                        <GripHorizontal size={10} className="opacity-50 flex-shrink-0" />
                                        <span className="truncate">{barStyle.width > 60 ? `${job.woNumber} — ${job.assetName}` : job.woNumber}</span>
                                    </div>

                                    {/* Resize handle (right edge) */}
                                    {!isCompleted && onReschedule && (
                                        <div
                                            className="absolute top-0 bottom-0 w-2 cursor-col-resize z-[8] opacity-0 hover:opacity-100 transition-opacity"
                                            style={{ left: barStyle.left + barStyle.width - 4 }}
                                            onMouseDown={(e) => handleBarMouseDown(e, job, 'resize')}
                                        >
                                            <div className="absolute inset-y-2 right-0 w-1 bg-white/80 rounded-full" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* ── Today Full-Height Line ── */}
                    {todayOffset !== null && (
                        <div
                            className="absolute w-0.5 bg-red-500 z-[15] pointer-events-none"
                            style={{
                                left: LABEL_WIDTH + todayOffset,
                                top: HEADER_HEIGHT,
                                bottom: 0,
                                height: visibleJobs.length * ROW_HEIGHT,
                            }}
                        >
                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                                TODAY
                            </div>
                        </div>
                    )}

                    {/* GAP-K: Dependency Arrows SVG */}
                    {dependencyArrows.length > 0 && (
                        <svg
                            className="absolute pointer-events-none z-[4]"
                            style={{
                                left: LABEL_WIDTH,
                                top: HEADER_HEIGHT,
                                width: totalWidth,
                                height: visibleJobs.length * ROW_HEIGHT,
                            }}
                        >
                            <defs>
                                <marker id="gantt-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                                    <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
                                </marker>
                            </defs>
                            {dependencyArrows.map((arrow, i) => {
                                const fromY = arrow.fromIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                                const toY = arrow.toIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
                                const midX = (arrow.fromRight + arrow.toLeft) / 2;

                                // Curved path from end of parent bar to start of child bar
                                const path = `M ${arrow.fromRight + 2} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${arrow.toLeft - 4} ${toY}`;
                                return (
                                    <path
                                        key={i}
                                        d={path}
                                        stroke="#94a3b8"
                                        strokeWidth={1.5}
                                        fill="none"
                                        strokeDasharray="4 2"
                                        markerEnd="url(#gantt-arrow)"
                                        opacity={0.6}
                                    />
                                );
                            })}
                        </svg>
                    )}
                </div>
            </div>

            {/* ── Status Bar ── */}
            <div className="px-4 py-1.5 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 flex-shrink-0">
                <span>{visibleJobs.length} jobs in view • {rangeStart.toLocaleDateString()} — {rangeEnd.toLocaleDateString()}</span>
                <span className="flex items-center gap-3">
                    <span>Drag bars to reschedule • Drag edges to resize</span>
                    <span className="flex items-center gap-1 text-red-500"><div className="w-3 h-0.5 bg-red-500" /> Today</span>
                </span>
            </div>
        </div>
    );
};
