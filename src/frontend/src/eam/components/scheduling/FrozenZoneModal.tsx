import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Calendar, ArrowRight, Shield, X, Lock } from 'lucide-react';

interface FrozenZoneModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => void;
    woNumber: string;
    woTitle: string;
    originalDate: string;
    newDate: string;
    daysFromNow: number;
    assetCriticality?: 'A' | 'B' | 'C' | 'D';
}

export const FrozenZoneModal: React.FC<FrozenZoneModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    woNumber,
    woTitle,
    originalDate,
    newDate,
    daysFromNow,
    assetCriticality,
}) => {
    const [reason, setReason] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const isCriticalityA = assetCriticality === 'A';
    const canSubmit = reason.trim().length > 0;

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setReason('');
            setTimeout(() => textareaRef.current?.focus(), 100);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (!canSubmit) return;
        onConfirm(reason.trim());
        onClose();
    };

    /** Format an ISO date string or date for human display */
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

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden transform transition-all scale-100">
                {/* ── Header ── */}
                <div className="px-6 pt-6 pb-4">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 p-3 rounded-full bg-amber-100">
                            <AlertTriangle className="text-amber-600" size={24} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-lg font-bold text-slate-900">
                                Frozen Zone Override
                            </h3>
                            <p className="text-sm text-slate-500 mt-0.5">
                                {woNumber} — {woTitle}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-500 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* ── Body ── */}
                <div className="px-6 pb-5 space-y-4">
                    {/* Frozen zone warning banner */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                        <Lock size={16} className="text-amber-600 shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-amber-800">
                                This date is within the 7-day frozen schedule window
                            </p>
                            <p className="text-xs text-amber-600 mt-0.5">
                                The new date is{' '}
                                <span className="font-bold">{daysFromNow} day{daysFromNow !== 1 ? 's' : ''}</span>{' '}
                                from now. Changes within the frozen zone require documented justification.
                            </p>
                        </div>
                    </div>

                    {/* Date change display */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="flex-1 text-center">
                            <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">
                                Original Date
                            </div>
                            <div className="flex items-center justify-center gap-1.5 text-sm font-medium text-slate-700">
                                <Calendar size={14} className="text-slate-400" />
                                {formatDate(originalDate)}
                            </div>
                        </div>

                        <ArrowRight size={18} className="text-amber-500 shrink-0" />

                        <div className="flex-1 text-center">
                            <div className="text-[10px] font-medium text-amber-500 uppercase tracking-wider mb-1">
                                New Date
                            </div>
                            <div className="flex items-center justify-center gap-1.5 text-sm font-bold text-amber-700">
                                <Calendar size={14} className="text-amber-500" />
                                {formatDate(newDate)}
                            </div>
                        </div>
                    </div>

                    {/* Criticality A safety escalation */}
                    {isCriticalityA && (
                        <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
                            <Shield size={16} className="text-red-600 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-semibold text-red-800">
                                    Safety Critical — Criticality A Asset
                                </p>
                                <p className="text-xs text-red-600 mt-0.5">
                                    Rescheduling a Criticality A asset requires supervisor sign-off.
                                    This override will be flagged for mandatory review in the audit trail.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Mandatory reason */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                            Reason for Override{' '}
                            <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            ref={textareaRef}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Provide a documented justification for rescheduling within the frozen zone…"
                            rows={3}
                            className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none transition resize-none ${
                                reason.trim()
                                    ? 'border-slate-300 focus:ring-2 focus:ring-amber-200 focus:border-amber-400'
                                    : 'border-red-300 focus:ring-2 focus:ring-red-200 focus:border-red-400 bg-red-50/30'
                            }`}
                        />
                        {!reason.trim() && (
                            <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                                <AlertTriangle size={10} />
                                A reason is mandatory for frozen zone overrides
                            </p>
                        )}
                    </div>
                </div>

                {/* ── Footer ── */}
                <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 text-sm font-medium hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!canSubmit}
                        className={`px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center gap-2 ${
                            canSubmit
                                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        <Lock size={14} />
                        Override &amp; Schedule
                    </button>
                </div>
            </div>
        </div>
    );
};
