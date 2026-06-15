import React from 'react';
import { cn } from './cn';
import type { Density } from './DensityToggle';
import { SkeletonRows } from './Skeleton';
import { EmptyState } from './EmptyState';

/**
 * DataList — the Hybrid bridge.
 *
 * The same data renders two ways from ONE column definition:
 *   • md and up  → a dense, Fiori-style <table> (honors the `density-*` classes
 *                  driven by the page's DensityToggle).
 *   • below md   → a MaintainX-style stack of cards (no horizontal scroll, no
 *                  hidden columns) — built automatically from the columns, or
 *                  via a custom `renderCard`.
 *
 * This kills the "hide table columns on mobile" anti-pattern app-wide.
 */

export interface DataColumn<T> {
    id: string;
    /** Column header (string used as the label in the default mobile card). */
    header: string;
    /** Override the rendered <th> content (e.g. a select-all checkbox). Falls back to `header`. */
    headerCell?: React.ReactNode;
    /** Cell renderer. */
    render: (row: T) => React.ReactNode;
    align?: 'left' | 'right' | 'center';
    /** Hide this column below a breakpoint ON DESKTOP table (progressive disclosure). */
    hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
    /** Fixed width utility class, e.g. 'w-24'. */
    widthClass?: string;
    /** Exclude from the auto-generated mobile card (e.g. row actions). */
    hideOnCard?: boolean;
    /** Use this column's value as the mobile card title (first such column wins). */
    cardTitle?: boolean;
}

export interface DataListProps<T> {
    columns: DataColumn<T>[];
    data: T[];
    getRowId: (row: T) => string;
    onRowClick?: (row: T) => void;
    /** Highlight the active row (master–detail). */
    selectedId?: string | null;
    /** Desktop table density (from the page's DensityToggle). */
    density?: Density;
    loading?: boolean;
    /** Custom mobile card renderer; falls back to an auto-built card. */
    renderCard?: (row: T) => React.ReactNode;
    /** Empty-state content. */
    empty?: React.ReactNode;
    className?: string;
}

const ALIGN: Record<string, string> = { left: 'text-left', right: 'text-right', center: 'text-center' };
const HIDE_BELOW: Record<string, string> = {
    sm: 'hidden sm:table-cell',
    md: 'hidden md:table-cell',
    lg: 'hidden lg:table-cell',
    xl: 'hidden xl:table-cell',
};

export function DataList<T>({
    columns,
    data,
    getRowId,
    onRowClick,
    selectedId,
    density = 'compact',
    loading,
    renderCard,
    empty,
    className,
}: DataListProps<T>) {
    if (loading) return <SkeletonRows rows={8} />;

    if (!data.length) {
        return <>{empty ?? <EmptyState title="No records" description="Nothing matches the current filters." />}</>;
    }

    const cardColumns = columns.filter(c => !c.hideOnCard);
    const titleCol = columns.find(c => c.cardTitle) ?? columns[0];

    const defaultCard = (row: T) => (
        <div className="space-y-2">
            <div className="text-sm font-bold text-slate-800">{titleCol.render(row)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {cardColumns
                    .filter(c => c.id !== titleCol.id)
                    .map(c => (
                        <div key={c.id} className="min-w-0">
                            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{c.header}</dt>
                            <dd className="text-xs text-slate-700 truncate">{c.render(row)}</dd>
                        </div>
                    ))}
            </dl>
        </div>
    );

    return (
        <div className={cn('flex-1 min-h-0', className)}>
            {/* ── Desktop: dense table (md+) ── */}
            <div className={cn('hidden md:block overflow-y-auto overflow-x-hidden h-full', `density-${density}`)}>
                <table className="w-full divide-y divide-slate-200 table-fixed">
                    <thead className="sticky top-0 z-10 bg-slate-50">
                        <tr>
                            {columns.map(c => (
                                <th
                                    key={c.id}
                                    className={cn(
                                        'px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500',
                                        ALIGN[c.align ?? 'left'],
                                        c.widthClass,
                                        c.hideBelow && HIDE_BELOW[c.hideBelow]
                                    )}
                                >
                                    {c.headerCell ?? c.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {data.map(row => {
                            const id = getRowId(row);
                            const active = selectedId === id;
                            return (
                                <tr
                                    key={id}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                    className={cn(
                                        'transition-colors',
                                        onRowClick && 'cursor-pointer',
                                        active ? 'bg-primary-50' : 'hover:bg-slate-50'
                                    )}
                                >
                                    {columns.map(c => (
                                        <td
                                            key={c.id}
                                            className={cn(
                                                'px-3 text-slate-700 truncate',
                                                ALIGN[c.align ?? 'left'],
                                                c.hideBelow && HIDE_BELOW[c.hideBelow]
                                            )}
                                        >
                                            {c.render(row)}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* ── Mobile: card stack (< md) ── */}
            <div className="md:hidden h-full overflow-y-auto overflow-x-hidden p-3 space-y-2.5">
                {data.map(row => {
                    const id = getRowId(row);
                    const active = selectedId === id;
                    return (
                        <div
                            key={id}
                            onClick={onRowClick ? () => onRowClick(row) : undefined}
                            className={cn(
                                'bg-white rounded-card border shadow-card p-3.5 transition-shadow',
                                onRowClick && 'cursor-pointer active:shadow-raised',
                                active ? 'border-primary-400 ring-1 ring-primary-200' : 'border-slate-200'
                            )}
                        >
                            {renderCard ? renderCard(row) : defaultCard(row)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
