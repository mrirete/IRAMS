import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Calendar, AlertTriangle, Filter, ChevronRight, Search, CheckCircle2, Clock, Ban, Pause } from 'lucide-react';
import type { InspectionEvent, InspectionType, InspectionEventStatus } from '../../types/integrity';
import { useIntegrity } from '../../hooks/useIntegrity';

const TYPE_COLORS: Record<InspectionType, { bg: string; text: string }> = {
    UT: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    PAUT: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    RT: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
    VT: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
    MT: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    PT: { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-700' },
    MFL: { bg: 'bg-primary-50 border-primary-200', text: 'text-primary-700' },
};

const STATUS_CONFIG: Record<InspectionEventStatus, { label: string; icon: React.ReactNode; bg: string; text: string }> = {
    scheduled: { label: 'Scheduled', icon: <Calendar size={10} />, bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
    in_progress: { label: 'In Progress', icon: <Clock size={10} />, bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
    completed: { label: 'Completed', icon: <CheckCircle2 size={10} />, bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
    overdue: { label: 'Overdue', icon: <AlertTriangle size={10} />, bg: 'bg-red-50 border-red-200', text: 'text-red-700' },
    deferred: { label: 'Deferred', icon: <Pause size={10} />, bg: 'bg-slate-50 border-slate-200', text: 'text-slate-600' },
    cancelled: { label: 'Cancelled', icon: <Ban size={10} />, bg: 'bg-slate-50 border-slate-200', text: 'text-slate-500' },
};

const ALL_TYPES: InspectionType[] = ['UT', 'PAUT', 'RT', 'VT', 'MT', 'PT', 'MFL'];

interface InspectionAssetTabProps {
    assetId: string;
    assetName?: string;
}

export const InspectionAssetTab: React.FC<InspectionAssetTabProps> = ({ assetId }) => {
    const { inspections } = useIntegrity();
    const navigate = useNavigate();
    const [methodFilter, setMethodFilter] = useState<InspectionType | 'all'>('all');

    // Filter inspections for this asset
    const assetInspections = useMemo(() => {
        return inspections
            .filter(i => i.asset_id === assetId)
            .filter(i => methodFilter === 'all' || i.inspection_type === methodFilter)
            .sort((a, b) => new Date(b.scheduled_date).getTime() - new Date(a.scheduled_date).getTime());
    }, [inspections, assetId, methodFilter]);

    // KPIs
    const allAssetInsp = inspections.filter(i => i.asset_id === assetId);
    const overdueCount = allAssetInsp.filter(i => i.status === 'overdue').length;
    const completedDates = allAssetInsp.filter(i => i.completed_date).map(i => new Date(i.completed_date!).getTime());
    const lastInspection = completedDates.length ? new Date(Math.max(...completedDates)).toLocaleDateString() : '—';
    const scheduledDates = allAssetInsp.filter(i => i.status === 'scheduled').map(i => new Date(i.scheduled_date).getTime());
    const nextDue = scheduledDates.length ? new Date(Math.min(...scheduledDates)).toLocaleDateString() : '—';

    return (
        <div className="space-y-4 p-1">
            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                    { label: 'Total', value: allAssetInsp.length, color: 'text-slate-800' },
                    { label: 'Overdue', value: overdueCount, color: overdueCount > 0 ? 'text-red-600' : 'text-slate-800' },
                    { label: 'Last Inspection', value: lastInspection, color: 'text-slate-800' },
                    { label: 'Next Due', value: nextDue, color: 'text-slate-800' },
                ].map(kpi => (
                    <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{kpi.label}</p>
                        <p className={`text-lg font-bold ${kpi.color}`}>{kpi.value}</p>
                    </div>
                ))}
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2">
                <Filter size={14} className="text-slate-400" />
                <select
                    value={methodFilter}
                    onChange={e => setMethodFilter(e.target.value as InspectionType | 'all')}
                    className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-primary-300 transition-all"
                >
                    <option value="all">All NDE Methods</option>
                    {ALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="text-[10px] text-slate-400 ml-auto">{assetInspections.length} inspection{assetInspections.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Inspection List */}
            {assetInspections.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                    <ClipboardList size={32} className="mx-auto text-slate-300 mb-2" />
                    <p className="text-sm text-slate-500 font-medium">No inspections found</p>
                    <p className="text-xs text-slate-400 mt-1">
                        {methodFilter !== 'all' ? `No ${methodFilter} inspections for this asset` : 'No inspection history for this asset'}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {assetInspections.map(insp => {
                        const tc = TYPE_COLORS[insp.inspection_type];
                        const sc = STATUS_CONFIG[insp.status];
                        const date = new Date(insp.scheduled_date);
                        const isPast = date.getTime() < Date.now();

                        return (
                            <button
                                key={insp.id}
                                onClick={() => navigate(`/comply/inspections/${insp.id}`)}
                                className="w-full bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3 text-left shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group"
                            >
                                {/* Date Column */}
                                <div className="shrink-0 text-center w-14">
                                    <p className="text-lg font-bold text-slate-800 leading-none">{date.getDate()}</p>
                                    <p className="text-[10px] font-medium text-slate-400 uppercase">{date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</p>
                                </div>

                                {/* Divider */}
                                <div className="w-px h-10 bg-slate-200 shrink-0" />

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${tc.bg} ${tc.text}`}>
                                            {insp.inspection_type}
                                        </span>
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border ${sc.bg} ${sc.text}`}>
                                            {sc.icon} {sc.label}
                                        </span>
                                        {insp.findings_count > 0 && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-orange-50 border border-orange-200 text-orange-700">
                                                {insp.findings_count} finding{insp.findings_count !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-500 truncate">
                                        {insp.description || `${insp.inspection_type} inspection`}
                                        <span className="text-slate-400"> · {insp.inspector}</span>
                                    </p>
                                </div>

                                {/* Arrow */}
                                <ChevronRight size={16} className="text-slate-300 group-hover:text-primary-500 transition-colors shrink-0" />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
