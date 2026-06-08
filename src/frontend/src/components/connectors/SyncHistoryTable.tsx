import React, { useState } from 'react';
import { History, CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { ConnectorSyncLog } from '../../types/connectors';

interface Props {
    logs: ConnectorSyncLog[];
}

const PAGE_SIZE = 5;

export const SyncHistoryTable: React.FC<Props> = ({ logs }) => {
    const [page, setPage] = useState(0);

    const sortedLogs = [...logs].sort((a, b) =>
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    );

    const totalPages = Math.ceil(sortedLogs.length / PAGE_SIZE);
    const pagedLogs = sortedLogs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const handleExportCSV = () => {
        const headers = ['Timestamp', 'Mode', 'Status', 'Records Added', 'Records Updated', 'Records Failed', 'Duration (s)'];
        const rows = sortedLogs.map(log => [
            new Date(log.start_time).toISOString(),
            log.mode,
            log.status,
            log.records_added,
            log.records_updated,
            log.records_failed,
            log.end_time ? ((new Date(log.end_time).getTime() - new Date(log.start_time).getTime()) / 1000).toFixed(1) : '',
        ]);

        const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sync_history_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getDurationColor = (startTime: string, endTime: string | null) => {
        if (!endTime) return 'text-slate-500';
        const durationSec = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000;
        if (durationSec < 10) return 'text-accent-safe';
        if (durationSec < 60) return 'text-yellow-500';
        return 'text-red-400';
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-full">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white/50">
                <div className="flex items-center space-x-2">
                    <History className="text-slate-500" size={18} />
                    <h3 className="text-base font-semibold text-slate-800">Sync History</h3>
                    <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">{sortedLogs.length} total</span>
                </div>
                <button
                    onClick={handleExportCSV}
                    className="flex items-center text-xs text-slate-500 hover:text-accent-cyan transition-colors px-2 py-1 rounded-md border border-slate-200 hover:border-brand-500"
                >
                    <Download size={13} className="mr-1.5" /> Export CSV
                </button>
            </div>

            {/* Table */}
            <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 text-slate-400 text-xs border-b border-slate-200">
                            <th className="px-4 py-2.5 font-medium">Timestamp</th>
                            <th className="px-4 py-2.5 font-medium">Mode</th>
                            <th className="px-4 py-2.5 font-medium">Status</th>
                            <th className="px-4 py-2.5 font-medium text-right">Added</th>
                            <th className="px-4 py-2.5 font-medium text-right">Updated</th>
                            <th className="px-4 py-2.5 font-medium text-right">Failed</th>
                            <th className="px-4 py-2.5 font-medium">Duration</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-700/50">
                        {pagedLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-white/50 transition-colors">
                                <td className="px-4 py-3 text-sm text-slate-800 whitespace-nowrap">
                                    {new Date(log.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="px-4 py-3">
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-50 border border-slate-300 text-slate-600 uppercase">
                                        {log.mode}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center space-x-1.5">
                                        {log.status === 'completed' ? (
                                            <><CheckCircle2 size={14} className="text-accent-safe" /><span className="text-xs text-accent-safe">Completed</span></>
                                        ) : log.status === 'failed' ? (
                                            <><XCircle size={14} className="text-red-500" /><span className="text-xs text-red-500">Failed</span></>
                                        ) : (
                                            <><Clock size={14} className="text-yellow-500 animate-pulse" /><span className="text-xs text-yellow-500">Running</span></>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-right text-sm text-slate-600 font-mono">{log.records_added.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-sm text-slate-600 font-mono">{log.records_updated.toLocaleString()}</td>
                                <td className="px-4 py-3 text-right text-sm font-mono">
                                    {log.records_failed > 0 ? (
                                        <span className="text-red-400 font-medium">{log.records_failed.toLocaleString()}</span>
                                    ) : <span className="text-brand-600">—</span>}
                                </td>
                                <td className={`px-4 py-3 text-sm font-mono whitespace-nowrap ${getDurationColor(log.start_time, log.end_time)}`}>
                                    {log.end_time
                                        ? `${((new Date(log.end_time).getTime() - new Date(log.start_time).getTime()) / 1000).toFixed(1)}s`
                                        : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {sortedLogs.length === 0 && (
                    <div className="p-8 text-center text-slate-400">No sync history available.</div>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between bg-slate-50/30">
                    <span className="text-xs text-slate-400">
                        Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedLogs.length)} of {sortedLogs.length}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => (
                            <button
                                key={i}
                                onClick={() => setPage(i)}
                                className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${page === i ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/30' : 'text-slate-400 hover:text-slate-700 hover:bg-white'}`}
                            >
                                {i + 1}
                            </button>
                        ))}
                        <button
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={page === totalPages - 1}
                            className="p-1.5 rounded-md text-slate-500 hover:text-slate-700 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
