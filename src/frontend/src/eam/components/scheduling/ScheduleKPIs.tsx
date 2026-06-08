import React, { useMemo } from 'react';
import {
    CheckCircle,
    TrendingUp,
    Briefcase,
    AlertTriangle,
    Clock,
    Activity,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────

interface ScheduleKPIsProps {
    jobs: any[]; // WorkOrder[]
    recurringJobs?: any[]; // RecurringJob[]
    materialStatusMap?: Record<string, 'AVAILABLE' | 'ON_ORDER' | 'SHORTAGE' | 'UNCHECKED'>;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Get color tier: green >90%, amber 70-90%, red <70% */
const getComplianceTier = (
    pct: number
): { text: string; bg: string; ring: string; gradient: string; label: string } => {
    if (pct >= 90)
        return {
            text: 'text-emerald-700',
            bg: 'bg-emerald-50',
            ring: '#22c55e',
            gradient: 'from-emerald-500 to-emerald-600',
            label: 'On Track',
        };
    if (pct >= 70)
        return {
            text: 'text-amber-700',
            bg: 'bg-amber-50',
            ring: '#f59e0b',
            gradient: 'from-amber-500 to-amber-600',
            label: 'At Risk',
        };
    return {
        text: 'text-red-700',
        bg: 'bg-red-50',
        ring: '#ef4444',
        gradient: 'from-red-500 to-red-600',
        label: 'Critical',
    };
};

/** Circular progress ring rendered as SVG */
const CircularProgress: React.FC<{
    value: number; // 0-100
    size?: number;
    strokeWidth?: number;
    color: string;
}> = ({ value, size = 56, strokeWidth = 5, color }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(value, 100) / 100) * circumference;

    return (
        <svg
            width={size}
            height={size}
            className="transform -rotate-90 transition-all duration-700 ease-out"
        >
            {/* Background ring */}
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="#e2e8f0"
                strokeWidth={strokeWidth}
                fill="none"
            />
            {/* Progress ring */}
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                className="transition-all duration-1000 ease-out"
            />
        </svg>
    );
};

/** Days elapsed since a date string */
const daysSince = (dateStr: string | undefined): number => {
    if (!dateStr) return 0;
    try {
        const now = new Date();
        const then = new Date(dateStr);
        return Math.max(0, Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24)));
    } catch {
        return 0;
    }
};

/** Check if a date is in the current month */
const isThisMonth = (dateStr: string | undefined): boolean => {
    if (!dateStr) return false;
    try {
        const d = new Date(dateStr);
        const now = new Date();
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    } catch {
        return false;
    }
};

// ── Component ─────────────────────────────────────────────────────────

export const ScheduleKPIs: React.FC<ScheduleKPIsProps> = ({
    jobs,
    recurringJobs,
    materialStatusMap,
}) => {
    // ── KPI Calculations ──────────────────────────────────────────────

    const metrics = useMemo(() => {
        const now = new Date();

        // 1. Schedule Compliance %
        const scheduledWOs = jobs.filter(
            (j) => j.dateDueStart || j.dueDate
        );
        const completedOnTime = scheduledWOs.filter((j) => {
            if (j.status !== 'CLOSED' && j.status !== 'TECO') return false;
            const scheduled = new Date(j.dateDueStart || j.dueDate);
            const completed = j.dateCompleted
                ? new Date(j.dateCompleted)
                : j.dateClosed
                ? new Date(j.dateClosed)
                : now; // If TECO/CLOSED but no completion date, use now
            return completed <= scheduled;
        });
        const scheduleCompliance =
            scheduledWOs.length > 0
                ? (completedOnTime.length / scheduledWOs.length) * 100
                : 100;

        // 2. PM Compliance %
        const pmJobs = jobs.filter(
            (j) =>
                j.type === 'PM' ||
                j.type === 'PREVENTIVE' ||
                j.type === 'INSPECTION' ||
                j.type === 'CALIBRATION'
        );
        const pmsDueThisMonth = pmJobs.filter(
            (j) =>
                isThisMonth(j.dateDueStart || j.dueDate)
        );
        const pmsCompletedOnTime = pmsDueThisMonth.filter((j) => {
            if (j.status !== 'CLOSED' && j.status !== 'TECO') return false;
            const due = new Date(
                j.dateDueStart || j.dueDate
            );
            const completed = j.dateCompleted
                ? new Date(j.dateCompleted)
                : j.dateClosed
                ? new Date(j.dateClosed)
                : now;
            return completed <= due;
        });
        const pmCompliance =
            pmsDueThisMonth.length > 0
                ? (pmsCompletedOnTime.length / pmsDueThisMonth.length) * 100
                : 100;

        // 3. Ready Backlog
        const readyBacklog = jobs.filter(
            (j) =>
                (j.status === 'OPEN' ||
                j.status === 'PLAN' ||
                j.status === 'PLANNED' ||
                j.status === 'READY') &&
                // GAP-D: Only count as "ready" if materials are not in shortage
                (!materialStatusMap || materialStatusMap[j.id] !== 'SHORTAGE')
        );

        // 4. Overdue
        const overdue = jobs.filter((j) => {
            if (
                j.status === 'CLOSED' ||
                j.status === 'TECO' ||
                j.status === 'CANCELLED' ||
                j.status === 'CANC'
            )
                return false;
            const due = j.dueDate || j.dateDueStart;
            if (!due) return false;
            return new Date(due) < now;
        });

        // 5. Avg Backlog Age
        const backlogAges = readyBacklog.map((j) =>
            daysSince(j.dateCreated || j.createdAt)
        );
        const avgBacklogAge =
            backlogAges.length > 0
                ? backlogAges.reduce((a, b) => a + b, 0) / backlogAges.length
                : 0;

        return {
            scheduleCompliance: Math.round(scheduleCompliance * 10) / 10,
            scheduledTotal: scheduledWOs.length,
            completedOnTimeCount: completedOnTime.length,
            pmCompliance: Math.round(pmCompliance * 10) / 10,
            pmsDueCount: pmsDueThisMonth.length,
            pmsCompletedCount: pmsCompletedOnTime.length,
            readyBacklog: readyBacklog.length,
            overdue: overdue.length,
            avgBacklogAge: Math.round(avgBacklogAge),
        };
    }, [jobs, materialStatusMap]);

    const schedTier = getComplianceTier(metrics.scheduleCompliance);
    const pmTier = getComplianceTier(metrics.pmCompliance);

    return (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* ── 1. Schedule Compliance ── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden relative">
                {/* Top accent bar */}
                <div
                    className={`h-1 bg-gradient-to-r ${schedTier.gradient} transition-all duration-500`}
                />
                <div className="p-4">
                    <div className="flex items-center gap-3">
                        {/* Circular progress */}
                        <div className="relative flex-shrink-0">
                            <CircularProgress
                                value={metrics.scheduleCompliance}
                                color={schedTier.ring}
                                size={56}
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <CheckCircle
                                    size={16}
                                    className="transition-transform duration-300 group-hover:scale-110"
                                    style={{ color: schedTier.ring }}
                                />
                            </div>
                        </div>
                        <div className="min-w-0">
                            <div
                                className={`text-2xl font-bold tabular-nums tracking-tight ${schedTier.text}`}
                            >
                                {metrics.scheduleCompliance.toFixed(0)}
                                <span className="text-sm font-semibold ml-0.5">%</span>
                            </div>
                            <div className="text-[11px] font-medium text-slate-500 leading-tight">
                                Schedule Compliance
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">
                            {metrics.completedOnTimeCount}/{metrics.scheduledTotal} on time
                        </span>
                        <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${schedTier.bg} ${schedTier.text}`}
                        >
                            {schedTier.label}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── 2. PM Compliance ── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden relative">
                <div
                    className={`h-1 bg-gradient-to-r ${pmTier.gradient} transition-all duration-500`}
                />
                <div className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                            <CircularProgress
                                value={metrics.pmCompliance}
                                color={pmTier.ring}
                                size={56}
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <TrendingUp
                                    size={16}
                                    className="transition-transform duration-300 group-hover:scale-110"
                                    style={{ color: pmTier.ring }}
                                />
                            </div>
                        </div>
                        <div className="min-w-0">
                            <div
                                className={`text-2xl font-bold tabular-nums tracking-tight ${pmTier.text}`}
                            >
                                {metrics.pmCompliance.toFixed(0)}
                                <span className="text-sm font-semibold ml-0.5">%</span>
                            </div>
                            <div className="text-[11px] font-medium text-slate-500 leading-tight">
                                PM Compliance
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">
                            {metrics.pmsCompletedCount}/{metrics.pmsDueCount} PMs this month
                        </span>
                        <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${pmTier.bg} ${pmTier.text}`}
                        >
                            {pmTier.label}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── 3. Ready Backlog ── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden relative">
                <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-600" />
                <div className="p-4">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 p-3 rounded-xl bg-blue-50 group-hover:bg-blue-100 transition-colors duration-300">
                            <Briefcase
                                size={20}
                                className="text-blue-600 transition-transform duration-300 group-hover:scale-110"
                            />
                        </div>
                        <div className="min-w-0">
                            <div className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">
                                {metrics.readyBacklog}
                            </div>
                            <div className="text-[11px] font-medium text-slate-500 leading-tight">
                                Ready Backlog
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5">
                        <Activity size={10} className="text-slate-400" />
                        <span className="text-[10px] text-slate-400">
                            OPEN / PLAN work orders
                        </span>
                    </div>
                </div>
            </div>

            {/* ── 4. Overdue ── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden relative">
                <div
                    className={`h-1 bg-gradient-to-r ${
                        metrics.overdue > 0
                            ? 'from-red-500 to-red-600'
                            : 'from-emerald-500 to-emerald-600'
                    }`}
                />
                <div className="p-4">
                    <div className="flex items-center gap-3">
                        <div
                            className={`flex-shrink-0 p-3 rounded-xl transition-colors duration-300 ${
                                metrics.overdue > 0
                                    ? 'bg-red-50 group-hover:bg-red-100'
                                    : 'bg-emerald-50 group-hover:bg-emerald-100'
                            }`}
                        >
                            <AlertTriangle
                                size={20}
                                className={`transition-transform duration-300 group-hover:scale-110 ${
                                    metrics.overdue > 0 ? 'text-red-600' : 'text-emerald-600'
                                }`}
                            />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span
                                    className={`text-2xl font-bold tabular-nums tracking-tight ${
                                        metrics.overdue > 0
                                            ? 'text-red-700'
                                            : 'text-emerald-700'
                                    }`}
                                >
                                    {metrics.overdue}
                                </span>
                                {metrics.overdue > 0 && (
                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-bold animate-pulse">
                                        OVERDUE
                                    </span>
                                )}
                            </div>
                            <div className="text-[11px] font-medium text-slate-500 leading-tight">
                                {metrics.overdue > 0 ? 'Overdue Jobs' : 'No Overdue'}
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5">
                        <Clock size={10} className="text-slate-400" />
                        <span className="text-[10px] text-slate-400">
                            Past due date, not CLOSED/TECO
                        </span>
                    </div>
                </div>
            </div>

            {/* ── 5. Avg Backlog Age ── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden relative">
                <div
                    className={`h-1 bg-gradient-to-r ${
                        metrics.avgBacklogAge > 30
                            ? 'from-amber-500 to-amber-600'
                            : 'from-slate-400 to-slate-500'
                    }`}
                />
                <div className="p-4">
                    <div className="flex items-center gap-3">
                        <div
                            className={`flex-shrink-0 p-3 rounded-xl transition-colors duration-300 ${
                                metrics.avgBacklogAge > 30
                                    ? 'bg-amber-50 group-hover:bg-amber-100'
                                    : 'bg-slate-50 group-hover:bg-slate-100'
                            }`}
                        >
                            <Clock
                                size={20}
                                className={`transition-transform duration-300 group-hover:scale-110 ${
                                    metrics.avgBacklogAge > 30
                                        ? 'text-amber-600'
                                        : 'text-slate-500'
                                }`}
                            />
                        </div>
                        <div className="min-w-0">
                            <div
                                className={`text-2xl font-bold tabular-nums tracking-tight ${
                                    metrics.avgBacklogAge > 30
                                        ? 'text-amber-700'
                                        : 'text-slate-900'
                                }`}
                            >
                                {metrics.avgBacklogAge}
                                <span className="text-sm font-semibold text-slate-400 ml-1">
                                    days
                                </span>
                            </div>
                            <div className="text-[11px] font-medium text-slate-500 leading-tight">
                                Avg Backlog Age
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5">
                        <Activity size={10} className="text-slate-400" />
                        <span className="text-[10px] text-slate-400">
                            Mean age of OPEN/PLAN orders
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
