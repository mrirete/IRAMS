import React, { useState, useMemo } from 'react';
import { AlertCircle, CheckCircle2, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import type { FMEAWorksheetRead } from '../../types/intelligence';

interface Props {
    fmea: FMEAWorksheetRead | null;
}

type SortKey = 'component' | 'failure_mode' | 'severity' | 'occurrence' | 'detection' | 'rpn';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 5;

export const FMEATable: React.FC<Props> = ({ fmea }) => {
    const [sortKey, setSortKey] = useState<SortKey>('rpn');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [page, setPage] = useState(0);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
        setPage(0); // reset to first page on sort
    };

    const sortedItems = useMemo(() => {
        if (!fmea) return [];
        return [...fmea.items].sort((a, b) => {
            const aVal = a[sortKey];
            const bVal = b[sortKey];
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
            }
            return sortDir === 'asc'
                ? String(aVal).localeCompare(String(bVal))
                : String(bVal).localeCompare(String(aVal));
        });
    }, [fmea, sortKey, sortDir]);

    const totalPages = Math.ceil(sortedItems.length / PAGE_SIZE);
    const pagedItems = sortedItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    if (!fmea || fmea.items.length === 0) return (
        <div className="flex items-center justify-center p-8 text-brand-400 text-sm">
            No FMEA items available.
        </div>
    );

    const getRpnColor = (rpn: number) => {
        if (rpn >= 200) return 'text-red-400 bg-red-500/10 border-red-500/20';
        if (rpn >= 100) return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
        return 'text-accent-safe bg-accent-safe/10 border-accent-safe/20';
    };

    const SortIcon = ({ column }: { column: SortKey }) => {
        if (sortKey !== column) return <ChevronsUpDown size={12} className="text-brand-600 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />;
        return sortDir === 'asc'
            ? <ChevronUp size={12} className="text-accent-cyan ml-1" />
            : <ChevronDown size={12} className="text-accent-cyan ml-1" />;
    };

    return (
        <div>
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-brand-800 text-brand-400 text-[11px] uppercase tracking-wider border-b border-brand-700">
                            <th className="px-4 py-3 font-medium cursor-pointer hover:text-brand-200 transition-colors group" onClick={() => handleSort('component')}>
                                <span className="flex items-center">Component <SortIcon column="component" /></span>
                            </th>
                            <th className="px-4 py-3 font-medium cursor-pointer hover:text-brand-200 transition-colors group" onClick={() => handleSort('failure_mode')}>
                                <span className="flex items-center">Failure Mode <SortIcon column="failure_mode" /></span>
                            </th>
                            <th className="px-4 py-3 font-medium">Failure Effect</th>
                            <th className="px-3 py-3 font-medium text-center cursor-pointer hover:text-brand-200 transition-colors group" onClick={() => handleSort('severity')} title="Severity">
                                <span className="flex items-center justify-center">S <SortIcon column="severity" /></span>
                            </th>
                            <th className="px-3 py-3 font-medium text-center cursor-pointer hover:text-brand-200 transition-colors group" onClick={() => handleSort('occurrence')} title="Occurrence">
                                <span className="flex items-center justify-center">O <SortIcon column="occurrence" /></span>
                            </th>
                            <th className="px-3 py-3 font-medium text-center cursor-pointer hover:text-brand-200 transition-colors group" onClick={() => handleSort('detection')} title="Detection">
                                <span className="flex items-center justify-center">D <SortIcon column="detection" /></span>
                            </th>
                            <th className="px-4 py-3 font-medium text-center cursor-pointer hover:text-brand-200 transition-colors group" onClick={() => handleSort('rpn')}>
                                <span className="flex items-center justify-center">RPN <SortIcon column="rpn" /></span>
                            </th>
                            <th className="px-4 py-3 font-medium">Recommended Action</th>
                            <th className="px-4 py-3 font-medium text-right">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-700/50">
                        {pagedItems.map((item) => (
                            <tr key={item.id} className="hover:bg-brand-700/50 transition-colors group">
                                <td className="px-4 py-3 text-sm text-brand-100 font-medium">
                                    {item.component}
                                </td>
                                <td className="px-4 py-3 text-sm text-brand-200">
                                    {item.failure_mode}
                                    <div className="text-xs text-brand-400 mt-1 line-clamp-1">{item.failure_cause}</div>
                                </td>
                                <td className="px-4 py-3 text-sm text-brand-300">
                                    {item.failure_effect}
                                </td>

                                {/* SOD Values */}
                                <td className="px-3 py-3 text-sm text-center text-brand-200 font-mono">{item.severity}</td>
                                <td className="px-3 py-3 text-sm text-center text-brand-200 font-mono">{item.occurrence}</td>
                                <td className="px-3 py-3 text-sm text-center text-brand-200 font-mono">{item.detection}</td>

                                {/* RPN Score */}
                                <td className="px-4 py-3 text-center">
                                    <span className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs font-bold border ${getRpnColor(item.rpn)}`}>
                                        {item.rpn}
                                    </span>
                                </td>

                                <td className="px-4 py-3 text-sm text-accent-cyan">
                                    {item.recommended_action || <span className="text-brand-600 italic">None required</span>}
                                </td>

                                <td className="px-4 py-3 text-right">
                                    {item.action_status === 'open' ? (
                                        <div className="flex items-center justify-end text-yellow-500 text-xs font-medium bg-yellow-500/10 px-2 py-1 rounded w-fit ml-auto">
                                            <AlertCircle size={12} className="mr-1" /> Open
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-end text-accent-safe text-xs font-medium bg-accent-safe/10 px-2 py-1 rounded w-fit ml-auto">
                                            <CheckCircle2 size={12} className="mr-1" /> Closed
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-brand-700 bg-brand-800/50">
                    <p className="text-xs text-brand-400">
                        Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedItems.length)} of {sortedItems.length} items
                    </p>
                    <div className="flex gap-1">
                        {Array.from({ length: totalPages }, (_, i) => (
                            <button
                                key={i}
                                onClick={() => setPage(i)}
                                className={`w-7 h-7 rounded text-xs font-medium transition-colors ${page === i ? 'bg-accent-cyan text-brand-900' : 'bg-brand-700 text-brand-300 hover:bg-brand-600 hover:text-brand-100'}`}
                            >
                                {i + 1}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
