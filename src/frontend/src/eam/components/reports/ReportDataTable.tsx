import React, { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronRight, Download, Search, ChevronLeft, Columns, FileSpreadsheet } from 'lucide-react';
import { exportCSV, exportXLSX } from '../../utils/reportExport';

export interface TableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  format?: 'text' | 'number' | 'currency' | 'percent' | 'hours' | 'date';
  width?: string;
  ragThresholds?: { green: number; amber: number }; // >= green → green, >= amber → amber, else red
  dataBar?: boolean; // Show inline gradient bar
}

interface ReportDataTableProps {
  columns: TableColumn[];
  data: any[];
  title?: string;
  onRowClick?: (row: any) => void;
  pageSize?: number;
  exportFilename?: string;
  onGroupByChange?: (key: string | null) => void;
  /** If provided, rows become expandable. Return JSX to show when row is expanded. */
  renderExpandedRow?: (row: any) => React.ReactNode;
  /** Key to uniquely identify rows for expansion tracking (default: index) */
  rowKey?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

const formatCell = (value: any, format?: string): string => {
  if (value == null) return '—';
  switch (format) {
    case 'currency': return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    case 'percent': return `${Number(value).toFixed(1)}%`;
    case 'hours': return `${Number(value).toFixed(1)}h`;
    case 'number': return Number(value).toLocaleString();
    case 'date': return new Date(value).toLocaleDateString();
    default: return String(value);
  }
};

const getRagClass = (value: number, thresholds?: { green: number; amber: number }): string => {
  if (!thresholds) return '';
  if (value >= thresholds.green) return 'bg-emerald-50 text-emerald-600 font-medium';
  if (value >= thresholds.amber) return 'bg-amber-50 text-amber-600 font-medium';
  return 'bg-red-50 text-red-600 font-medium';
};

// Priority/Status RAG mapping
const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-blue-50 text-blue-600 font-medium', WIP: 'bg-amber-50 text-amber-600 font-medium',
  COMP: 'bg-emerald-50 text-emerald-600 font-medium', TECO: 'bg-emerald-50 text-emerald-600 font-medium',
  CLOSED: 'bg-slate-100 text-slate-600 font-medium', CANCELLED: 'bg-red-50 text-red-600 font-medium',
};
const PRIORITY_COLORS: Record<string, string> = {
  EMERGENCY: 'bg-red-50 text-red-600 font-medium', URGENT: 'bg-amber-50 text-amber-600 font-medium',
  HIGH: 'bg-amber-50 text-amber-600 font-medium', NORMAL: 'bg-blue-50 text-blue-600 font-medium',
  LOW: 'bg-slate-100 text-slate-600 font-medium',
};

const getStatusRag = (key: string, value: any): string => {
  if (!value) return '';
  const upper = String(value).toUpperCase();
  if (key === 'status') return STATUS_COLORS[upper] || '';
  if (key === 'priority') return PRIORITY_COLORS[upper] || '';
  return '';
};

export const ReportDataTable: React.FC<ReportDataTableProps> = ({
  columns, data, title, onRowClick, pageSize: initialPageSize = 10, exportFilename, onGroupByChange, renderExpandedRow, rowKey,
}) => {
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [showColMenu, setShowColMenu] = useState(false);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [groupByKey, setGroupByKey] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const visibleColumns = useMemo(() => columns.filter(c => !hiddenCols.has(c.key)), [columns, hiddenCols]);

  const maxVal = useMemo(() => {
    const barCols = visibleColumns.filter(c => c.dataBar);
    const result: Record<string, number> = {};
    barCols.forEach(col => {
      result[col.key] = Math.max(...data.map(r => Number(r[col.key]) || 0), 1);
    });
    return result;
  }, [data, visibleColumns]);

  const filtered = useMemo(() => {
    let d = data;
    if (searchTerm) {
      d = d.filter(r => columns.some(c => String(r[c.key] ?? '').toLowerCase().includes(searchTerm.toLowerCase())));
    }
    // Per-column filters
    Object.entries(columnFilters).forEach(([key, val]) => {
      if (val) d = d.filter(r => String(r[key] ?? '').toLowerCase().includes(val.toLowerCase()));
    });
    if (sortKey) {
      d = [...d].sort((a, b) => {
        const av = a[sortKey]; const bv = b[sortKey];
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return d;
  }, [data, searchTerm, sortKey, sortDir, columns, columnFilters]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const handleExportCSV = () => {
    if (!exportFilename) return;
    exportCSV(filtered, visibleColumns.map(c => ({ key: c.key, label: c.label })), exportFilename);
  };

  const handleExportXLSX = () => {
    if (!exportFilename) return;
    const xlsxName = exportFilename.replace(/\.csv$/i, '.xlsx');
    exportXLSX(filtered, visibleColumns.map(c => ({ key: c.key, label: c.label })), xlsxName);
  };

  const toggleCol = (key: string) => {
    const next = new Set(hiddenCols);
    next.has(key) ? next.delete(key) : next.add(key);
    setHiddenCols(next);
  };

  // Grouping
  const groupedData = useMemo(() => {
    if (!groupByKey) return null;
    const groups: Record<string, any[]> = {};
    filtered.forEach(row => {
      const key = String(row[groupByKey] ?? 'Unspecified');
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    return groups;
  }, [filtered, groupByKey]);

  const renderRow = (row: any, i: number) => {
    const id = rowKey ? String(row[rowKey]) : String(i);
    const isExpanded = expandedRows.has(id);
    const isExpandable = !!renderExpandedRow;
    const handleClick = () => {
      if (isExpandable) {
        setExpandedRows(prev => {
          const next = new Set(prev);
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
        });
      } else {
        onRowClick?.(row);
      }
    };
    return (
      <React.Fragment key={id}>
        <tr
          onClick={handleClick}
          className={`border-b border-slate-100 transition-colors
            ${(onRowClick || isExpandable) ? 'cursor-pointer hover:bg-slate-50' : ''}
            ${isExpanded ? 'bg-blue-50/40' : i % 2 === 0 ? 'bg-slate-50/50' : ''}`}
        >
          {isExpandable && (
            <td className="pl-3 pr-0 py-2.5 w-6">
              <ChevronRight size={14} className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
            </td>
          )}
          {visibleColumns.map(col => {
            const val = row[col.key];
            const ragClass = col.ragThresholds && typeof val === 'number'
              ? getRagClass(val, col.ragThresholds)
              : getStatusRag(col.key, val);
            const barWidth = col.dataBar && maxVal[col.key] ? (Number(val) / maxVal[col.key]) * 100 : 0;

            return (
              <td key={col.key} className="px-4 py-2.5 whitespace-nowrap">
                {col.dataBar ? (
                  <div className="flex items-center gap-2">
                    <span className={`text-slate-700 ${ragClass ? `px-1.5 py-0.5 rounded ${ragClass}` : ''}`}>
                      {formatCell(val, col.format)}
                    </span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden min-w-[60px]">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-primary-400 rounded-full transition-all"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <span className={`text-slate-700 ${ragClass ? `px-1.5 py-0.5 rounded ${ragClass}` : ''}`}>
                    {formatCell(val, col.format)}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
        {isExpanded && renderExpandedRow && (
          <tr className="bg-blue-50/20 border-b border-slate-200">
            <td colSpan={visibleColumns.length + 1} className="px-6 py-3">
              {renderExpandedRow(row)}
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 flex-wrap gap-2">
        {title && <h3 className="text-sm font-bold text-slate-800">{title}</h3>}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Group By */}
          <select
            value={groupByKey || ''}
            onChange={e => { const v = e.target.value || null; setGroupByKey(v); onGroupByChange?.(v); }}
            className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-700 shadow-sm"
          >
            <option value="">No Grouping</option>
            {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>

          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text" placeholder="Search…" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setPage(0); }}
              className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 placeholder-slate-400 w-40 shadow-sm"
            />
          </div>

          {/* Column Toggle */}
          <div className="relative">
            <button onClick={() => setShowColMenu(!showColMenu)} className="p-1.5 hover:bg-slate-100 rounded-md text-slate-500 hover:text-slate-800 transition-colors" title="Toggle Columns">
              <Columns size={14} />
            </button>
            {showColMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowColMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-2 max-h-60 overflow-y-auto">
                  {columns.map(col => (
                    <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                      <input type="checkbox" checked={!hiddenCols.has(col.key)} onChange={() => toggleCol(col.key)} className="rounded border-slate-300 text-blue-600 w-3.5 h-3.5" />
                      {col.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Export buttons */}
          {exportFilename && (
            <>
              <button onClick={handleExportCSV} className="p-1.5 hover:bg-slate-100 rounded-md text-slate-500 hover:text-slate-800 transition-colors" title="Export CSV">
                <Download size={14} />
              </button>
              <button onClick={handleExportXLSX} className="p-1.5 hover:bg-slate-100 rounded-md text-slate-500 hover:text-slate-800 transition-colors" title="Export XLSX">
                <FileSpreadsheet size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              {renderExpandedRow && <th className="w-6"></th>}
              {visibleColumns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-left font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap
                    ${col.sortable !== false ? 'cursor-pointer hover:text-slate-900 select-none' : ''}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className="flex items-center gap-1" onClick={() => col.sortable !== false && handleSort(col.key)}>
                    {col.label}
                    {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </span>
                  {/* Per-column filter */}
                  <input
                    type="text" placeholder="Filter…"
                    value={columnFilters[col.key] || ''}
                    onChange={e => { setColumnFilters(prev => ({ ...prev, [col.key]: e.target.value })); setPage(0); }}
                    onClick={e => e.stopPropagation()}
                    className="w-full mt-1.5 px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] text-slate-800 placeholder-slate-400 font-normal shadow-sm"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupedData ? (
              Object.entries(groupedData).map(([group, rows]) => (
                <React.Fragment key={group}>
                  <tr className="bg-slate-100/80 border-b border-slate-200">
                    <td colSpan={visibleColumns.length} className="px-4 py-2.5 text-xs font-bold text-slate-800">
                      {groupByKey && columns.find(c => c.key === groupByKey)?.label}: {group}
                      <span className="ml-2 text-slate-500 font-medium">({rows.length})</span>
                    </td>
                  </tr>
                  {rows.map((row, i) => renderRow(row, i))}
                </React.Fragment>
              ))
            ) : (
              paged.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-8 text-center text-slate-500 font-medium">No data found matching your filters</td></tr>
              ) : paged.map((row, i) => renderRow(row, i))
            )}
          </tbody>
        </table>
          {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
        <span className="text-xs text-slate-500 font-medium">
          {filtered.length} records · Page {page + 1} of {Math.max(1, totalPages)}
        </span>
        <div className="flex items-center gap-2">
          {/* Page size */}
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}
            className="px-2 py-1 bg-white border border-slate-300 rounded text-xs text-slate-700 shadow-sm"
          >
            {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
          </select>

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              className="p-1 rounded-md text-slate-500 hover:bg-slate-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>     </div>
    </div>
  );
};
