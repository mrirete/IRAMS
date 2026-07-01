import React, { useState, useEffect, useRef } from 'react';
import {
    Package,
    AlertTriangle,
    X,
    Calendar,
    CheckCircle,
    Clock,
    ArrowRight,
    CalendarCheck,
} from 'lucide-react';

// ── Exported Types ────────────────────────────────────────────────────

export interface MaterialCheckItem {
    inventoryItemId: string;
    description: string;
    materialNumber?: string;
    requiredQty: number;
    onHandQty: number;
    onOrderQty: number;
    reservedQty?: number;
    availableQty?: number;
    status: 'AVAILABLE' | 'ON_ORDER' | 'SHORTAGE';
    earliestAvailDate?: string;
}

export interface MaterialCheckResult {
    ready: boolean;
    items: MaterialCheckItem[];
    suggestedEarliestDate?: string;
}

interface MaterialCheckModalProps {
    isOpen: boolean;
    onClose: () => void;
    onScheduleAnyway: (reason: string) => void;
    onScheduleSuggested: (suggestedDate: string) => void;
    woNumber: string;
    woTitle: string;
    targetDate: string;
    checkResult: MaterialCheckResult;
}

// ── Helpers ───────────────────────────────────────────────────────────

const formatDate = (dateStr: string): string => {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return dateStr;
    }
};

const formatDateShort = (dateStr: string): string => {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
        });
    } catch {
        return dateStr;
    }
};

const STATUS_CONFIG: Record<
    MaterialCheckItem['status'],
    { label: string; bg: string; text: string; border: string; dot: string }
> = {
    AVAILABLE: {
        label: 'Available',
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        border: 'border-emerald-200',
        dot: 'bg-emerald-500',
    },
    ON_ORDER: {
        label: 'On Order',
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        border: 'border-amber-200',
        dot: 'bg-amber-500',
    },
    SHORTAGE: {
        label: 'Shortage',
        bg: 'bg-red-50',
        text: 'text-red-700',
        border: 'border-red-200',
        dot: 'bg-red-500',
    },
};

// ── Component ─────────────────────────────────────────────────────────

export const MaterialCheckModal: React.FC<MaterialCheckModalProps> = ({
    isOpen,
    onClose,
    onScheduleAnyway,
    onScheduleSuggested,
    woNumber,
    woTitle,
    targetDate,
    checkResult,
}) => {
    const [showReasonInput, setShowReasonInput] = useState(false);
    const [reason, setReason] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Reset state when modal opens / closes
    useEffect(() => {
        if (isOpen) {
            setShowReasonInput(false);
            setReason('');
        }
    }, [isOpen]);

    // Auto-focus the reason textarea when it appears
    useEffect(() => {
        if (showReasonInput) {
            setTimeout(() => textareaRef.current?.focus(), 100);
        }
    }, [showReasonInput]);

    if (!isOpen) return null;

    const { items, ready, suggestedEarliestDate } = checkResult;
    const unavailableCount = items.filter((i) => i.status !== 'AVAILABLE').length;
    const totalCount = items.length;
    const canSubmitReason = reason.trim().length > 0;

    const handleScheduleAnyway = () => {
        if (!showReasonInput) {
            setShowReasonInput(true);
            return;
        }
        if (!canSubmitReason) return;
        onScheduleAnyway(reason.trim());
    };

    const handleScheduleSuggested = () => {
        if (suggestedEarliestDate) {
            onScheduleSuggested(suggestedEarliestDate);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden transform transition-all scale-100">
                {/* ── Amber Warning Header Bar ── */}
                <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-3">
                    <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 p-2 rounded-lg bg-white/20">
                            <Package className="text-white" size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-base font-bold text-white">
                                Material Availability Check
                            </h3>
                            <p className="text-xs text-amber-100 mt-0.5 truncate">
                                {woNumber} — {woTitle}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-white/80 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* ── Body ── */}
                <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
                    {/* Summary banner */}
                    {!ready && (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-amber-800">
                                    {unavailableCount} of {totalCount} required part{totalCount !== 1 ? 's' : ''}{' '}
                                    {unavailableCount === 1 ? 'is' : 'are'} not in stock
                                </p>
                                <p className="text-xs text-amber-600 mt-0.5">
                                    Scheduled date:{' '}
                                    <span className="font-medium">{formatDate(targetDate)}</span>.
                                    Review material status below before proceeding.
                                </p>
                            </div>
                        </div>
                    )}

                    {ready && (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                            <CheckCircle size={16} className="text-emerald-600 shrink-0" />
                            <div>
                                <p className="text-sm font-semibold text-emerald-800">
                                    All {totalCount} required part{totalCount !== 1 ? 's' : ''} are available
                                </p>
                                <p className="text-xs text-emerald-600 mt-0.5">
                                    Materials are in stock for the scheduled date:{' '}
                                    <span className="font-medium">{formatDate(targetDate)}</span>.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Material Items Table */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                        Material
                                    </th>
                                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">
                                        Description
                                    </th>
                                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                        Req
                                    </th>
                                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                        On Hand
                                    </th>
                                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                        Reserved
                                    </th>
                                    <th className="text-center px-2 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                        On Order
                                    </th>
                                    <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                        Status
                                    </th>
                                    <th className="text-center px-3 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">
                                        Earliest
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {items.map((item) => {
                                    const cfg = STATUS_CONFIG[item.status];
                                    return (
                                        <tr
                                            key={item.inventoryItemId}
                                            className="hover:bg-slate-50/50 transition-colors"
                                        >
                                            {/* Material Number */}
                                            <td className="px-3 py-2.5">
                                                <span className="font-mono text-xs text-slate-700">
                                                    {item.materialNumber || '—'}
                                                </span>
                                                {/* Show description inline on small screens */}
                                                <p className="text-[11px] text-slate-500 mt-0.5 sm:hidden truncate max-w-[120px]">
                                                    {item.description}
                                                </p>
                                            </td>

                                            {/* Description (hidden on small screens) */}
                                            <td className="px-3 py-2.5 hidden sm:table-cell">
                                                <span className="text-xs text-slate-600 line-clamp-1">
                                                    {item.description}
                                                </span>
                                            </td>

                                            {/* Required Qty */}
                                            <td className="px-2 py-2.5 text-center">
                                                <span className="text-xs font-semibold text-slate-800">
                                                    {item.requiredQty}
                                                </span>
                                            </td>

                                            {/* On Hand */}
                                            <td className="px-2 py-2.5 text-center">
                                                <span
                                                    className={`text-xs font-medium ${
                                                        (item.availableQty ?? item.onHandQty) >= item.requiredQty
                                                            ? 'text-emerald-600'
                                                            : 'text-red-600'
                                                    }`}
                                                >
                                                    {item.onHandQty}
                                                </span>
                                            </td>

                                            {/* Reserved (ATP netting — other open WOs) */}
                                            <td className="px-2 py-2.5 text-center">
                                                <span
                                                    className={`text-xs ${
                                                        (item.reservedQty || 0) > 0 ? 'text-amber-600 font-medium' : 'text-slate-400'
                                                    }`}
                                                    title="Committed to other open work orders"
                                                >
                                                    {item.reservedQty ? `−${item.reservedQty}` : '0'}
                                                </span>
                                            </td>

                                            {/* On Order */}
                                            <td className="px-2 py-2.5 text-center">
                                                <span className="text-xs text-slate-600">
                                                    {item.onOrderQty}
                                                </span>
                                            </td>

                                            {/* Status Badge */}
                                            <td className="px-3 py-2.5 text-center">
                                                <span
                                                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.bg} ${cfg.text} ${cfg.border}`}
                                                >
                                                    <span
                                                        className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}
                                                    />
                                                    {cfg.label}
                                                </span>
                                            </td>

                                            {/* Earliest Available Date */}
                                            <td className="px-3 py-2.5 text-center hidden md:table-cell">
                                                {item.earliestAvailDate ? (
                                                    <span className="text-xs text-slate-600 flex items-center justify-center gap-1">
                                                        <Clock size={11} className="text-slate-400" />
                                                        {formatDateShort(item.earliestAvailDate)}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-slate-400">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Suggested Earliest Date Callout */}
                    {suggestedEarliestDate && (
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                            <CalendarCheck size={18} className="text-blue-600 shrink-0" />
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-blue-800">
                                    Suggested earliest date
                                </p>
                                <p className="text-xs text-blue-600 mt-0.5">
                                    All materials are expected to be available by{' '}
                                    <span className="font-bold text-blue-700">
                                        {formatDate(suggestedEarliestDate)}
                                    </span>
                                </p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-blue-500 shrink-0">
                                <Calendar size={14} className="text-blue-400" />
                                <span className="font-medium">{formatDate(targetDate)}</span>
                                <ArrowRight size={14} className="text-blue-400" />
                                <span className="font-bold text-blue-700">
                                    {formatDateShort(suggestedEarliestDate)}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Schedule Anyway — Inline Reason Textarea (expands on click) */}
                    {showReasonInput && (
                        <div className="border border-amber-200 rounded-lg p-4 bg-amber-50/50 space-y-2">
                            <label className="block text-sm font-medium text-slate-700">
                                Reason for Scheduling Without Materials{' '}
                                <span className="text-red-500">*</span>
                            </label>
                            <textarea
                                ref={textareaRef}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Provide a justification for proceeding despite material shortages…"
                                rows={3}
                                className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none transition resize-none ${
                                    reason.trim()
                                        ? 'border-slate-300 focus:ring-2 focus:ring-amber-200 focus:border-amber-400'
                                        : 'border-red-300 focus:ring-2 focus:ring-red-200 focus:border-red-400 bg-red-50/30'
                                }`}
                            />
                            {!reason.trim() && (
                                <p className="text-[11px] text-red-500 flex items-center gap-1">
                                    <AlertTriangle size={10} />
                                    A reason is mandatory when scheduling with material shortages
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="bg-slate-50 px-6 py-4 flex flex-wrap justify-end gap-3 border-t border-slate-100">
                    {/* Cancel */}
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                    >
                        Cancel
                    </button>

                    {/* Schedule for Suggested Date */}
                    <button
                        onClick={handleScheduleSuggested}
                        disabled={!suggestedEarliestDate}
                        className={`px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-2 ${
                            suggestedEarliestDate
                                ? 'bg-primary-600 hover:bg-primary-500 text-white'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        <CalendarCheck size={14} />
                        {suggestedEarliestDate
                            ? `Schedule for ${formatDateShort(suggestedEarliestDate)}`
                            : 'No Suggested Date'}
                    </button>

                    {/* Schedule Anyway */}
                    <button
                        onClick={handleScheduleAnyway}
                        disabled={showReasonInput && !canSubmitReason}
                        className={`px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-2 ${
                            showReasonInput && !canSubmitReason
                                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                : 'bg-amber-500 hover:bg-amber-600 text-white'
                        }`}
                    >
                        <AlertTriangle size={14} />
                        {showReasonInput ? 'Confirm Schedule' : 'Schedule Anyway'}
                    </button>
                </div>
            </div>
        </div>
    );
};
