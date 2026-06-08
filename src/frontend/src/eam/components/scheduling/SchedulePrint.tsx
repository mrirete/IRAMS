import React, { useState } from 'react';
import { Printer, FileSpreadsheet, X, Download, Calendar, User, Clock, Package } from 'lucide-react';
import { WorkOrder } from '../../types';

// ── Types ────────────────────────────────────────────────────────────

interface SchedulePrintProps {
    jobs: WorkOrder[];
    currentDate: Date;
    materialStatusMap?: Record<string, 'AVAILABLE' | 'ON_ORDER' | 'SHORTAGE' | 'UNCHECKED'>;
}

interface PrintModalProps extends SchedulePrintProps {
    isOpen: boolean;
    onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

const formatDate = (d: Date): string =>
    d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const formatShort = (dateStr: string): string => {
    try { return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }
    catch { return dateStr; }
};

const materialDot = (status: string | undefined): string => {
    switch (status) {
        case 'AVAILABLE': return '🟢';
        case 'ON_ORDER': return '🟡';
        case 'SHORTAGE': return '🔴';
        default: return '⚪';
    }
};

const priorityLabel = (p: string): string => {
    const map: Record<string, string> = { EMERGENCY: '🔴 EMER', HIGH: '🟠 HIGH', MEDIUM: '🔵 MED', LOW: '🟢 LOW' };
    return map[p?.toUpperCase()] || p;
};

// ── Print Daily Schedule ─────────────────────────────────────────────

const printDailySchedule = (jobs: WorkOrder[], date: Date, materialStatusMap?: Record<string, string>) => {
    const dateStr = date.toISOString().split('T')[0];
    const dayJobs = jobs
        .filter(j => j.dateDueStart === dateStr && !['CLOSED', 'CANC', 'CANCELLED'].includes(j.status as string))
        .sort((a, b) => {
            const pOrder: Record<string, number> = { EMERGENCY: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
            return (pOrder[a.priority] ?? 4) - (pOrder[b.priority] ?? 4);
        });

    const html = `
<!DOCTYPE html>
<html><head>
<title>Daily Schedule — ${formatDate(date)}</title>
<style>
    @page { size: A4 landscape; margin: 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #1e293b; }
    .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #3b82f6; padding-bottom: 8px; margin-bottom: 12px; }
    .header h1 { font-size: 18px; color: #1e293b; }
    .header .meta { text-align: right; color: #64748b; font-size: 10px; }
    .summary { display: flex; gap: 20px; margin-bottom: 12px; font-size: 10px; color: #475569; }
    .summary span { background: #f1f5f9; padding: 4px 10px; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; text-align: left; padding: 6px 8px; font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #e2e8f0; }
    td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr:hover { background: #f8fafc; }
    .priority-emer { border-left: 3px solid #ef4444; }
    .priority-high { border-left: 3px solid #f97316; }
    .priority-med { border-left: 3px solid #3b82f6; }
    .priority-low { border-left: 3px solid #22c55e; }
    .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
    @media print { .no-print { display: none; } }
</style>
</head><body>
<div class="header">
    <div>
        <h1>📋 Daily Work Schedule</h1>
        <div style="font-size: 14px; color: #3b82f6; font-weight: 600; margin-top: 4px;">${formatDate(date)}</div>
    </div>
    <div class="meta">
        <div>Printed: ${new Date().toLocaleString()}</div>
        <div>ERS Work Management</div>
    </div>
</div>
<div class="summary">
    <span>📊 Total Jobs: <strong>${dayJobs.length}</strong></span>
    <span>🔴 Emergency: <strong>${dayJobs.filter(j => j.priority === 'EMERGENCY').length}</strong></span>
    <span>⏱ Est Hours: <strong>${dayJobs.reduce((sum, j) => sum + (j.estDuration || 0), 0).toFixed(1)}</strong></span>
</div>
<table>
    <thead><tr>
        <th style="width:90px">WO #</th>
        <th style="width:80px">Priority</th>
        <th>Asset</th>
        <th>Description</th>
        <th style="width:100px">Assigned To</th>
        <th style="width:55px">Hours</th>
        <th style="width:50px">Parts</th>
        <th style="width:60px">Status</th>
    </tr></thead>
    <tbody>
        ${dayJobs.map(j => {
        const pClass = j.priority === 'EMERGENCY' ? 'priority-emer' : j.priority === 'HIGH' ? 'priority-high' : j.priority === 'LOW' ? 'priority-low' : 'priority-med';
        return `<tr class="${pClass}">
            <td><strong>${j.woNumber || j.id}</strong></td>
            <td>${priorityLabel(j.priority)}</td>
            <td>${j.assetName || '—'}</td>
            <td>${j.title || '—'}</td>
            <td>${(j as any).assignedToName || '—'}</td>
            <td style="text-align:center">${j.estDuration || '—'}</td>
            <td style="text-align:center">${materialDot(materialStatusMap?.[j.id])}</td>
            <td>${j.status}</td>
        </tr>`;
    }).join('')}
    </tbody>
</table>
${dayJobs.length === 0 ? '<div style="text-align:center;padding:40px;color:#94a3b8;">No jobs scheduled for this date.</div>' : ''}
<div class="footer">
    <span>Daily Schedule — ${formatDate(date)}</span>
    <span>Page 1 of 1 | Confidential</span>
</div>
<script>window.print();</script>
</body></html>`;

    const win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
};

// ── Export Weekly Excel ──────────────────────────────────────────────

const exportWeeklyExcel = async (jobs: WorkOrder[], currentDate: Date, materialStatusMap?: Record<string, string>) => {
    try {
        const XLSX = await import('xlsx');

        const weekStart = new Date(currentDate);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const startISO = weekStart.toISOString().split('T')[0];
        const endISO = weekEnd.toISOString().split('T')[0];

        const weekJobs = jobs
            .filter(j => j.dateDueStart && j.dateDueStart >= startISO && j.dateDueStart <= endISO)
            .sort((a, b) => a.dateDueStart.localeCompare(b.dateDueStart));

        const rows = weekJobs.map(j => ({
            'Date': formatShort(j.dateDueStart),
            'WO #': j.woNumber || j.id,
            'Priority': j.priority,
            'Asset': j.assetName || '',
            'Description': j.title || '',
            'Type': j.type || '',
            'Assigned To': (j as any).assignedToName || '',
            'Est Hours': j.estDuration || 0,
            'Parts Status': materialStatusMap?.[j.id] || 'UNCHECKED',
            'Status': j.status || '',
        }));

        const ws = XLSX.utils.json_to_sheet(rows);

        // Column widths
        ws['!cols'] = [
            { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 25 },
            { wch: 35 }, { wch: 8 }, { wch: 20 }, { wch: 8 },
            { wch: 12 }, { wch: 8 },
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Weekly Schedule');
        XLSX.writeFile(wb, `Weekly_Schedule_${startISO}_to_${endISO}.xlsx`);
    } catch (err) {
        console.error('[SchedulePrint] Excel export failed:', err);
        alert('Export failed — please try again.');
    }
};

// ── Print/Export Modal ───────────────────────────────────────────────

export const SchedulePrintModal: React.FC<PrintModalProps> = ({
    isOpen,
    onClose,
    jobs,
    currentDate,
    materialStatusMap,
}) => {
    if (!isOpen) return null;

    const dateStr = currentDate.toISOString().split('T')[0];
    const dayJobCount = jobs.filter(j => j.dateDueStart === dateStr).length;

    const weekStart = new Date(currentDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekJobCount = jobs.filter(j => {
        const start = weekStart.toISOString().split('T')[0];
        const end = weekEnd.toISOString().split('T')[0];
        return j.dateDueStart && j.dateDueStart >= start && j.dateDueStart <= end;
    }).length;

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Printer size={20} />
                        <h2 className="text-lg font-bold">Print / Export</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition">
                        <X size={18} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {/* Daily Print */}
                    <button
                        onClick={() => { printDailySchedule(jobs, currentDate, materialStatusMap); onClose(); }}
                        className="w-full flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all group text-left"
                    >
                        <div className="p-2.5 bg-blue-100 rounded-lg text-blue-600 group-hover:bg-blue-200 transition">
                            <Printer size={20} />
                        </div>
                        <div className="flex-1">
                            <div className="font-bold text-slate-800 group-hover:text-blue-700 transition">Print Daily Schedule</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                                {formatDate(currentDate)} • {dayJobCount} job{dayJobCount !== 1 ? 's' : ''}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">A4 landscape • Priority sorted • Crew assignments</div>
                        </div>
                    </button>

                    {/* Weekly Export */}
                    <button
                        onClick={() => { exportWeeklyExcel(jobs, currentDate, materialStatusMap); onClose(); }}
                        className="w-full flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all group text-left"
                    >
                        <div className="p-2.5 bg-emerald-100 rounded-lg text-emerald-600 group-hover:bg-emerald-200 transition">
                            <FileSpreadsheet size={20} />
                        </div>
                        <div className="flex-1">
                            <div className="font-bold text-slate-800 group-hover:text-emerald-700 transition">Export Weekly Plan (Excel)</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                                {weekStart.toLocaleDateString()} — {weekEnd.toLocaleDateString()} • {weekJobCount} job{weekJobCount !== 1 ? 's' : ''}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">XLSX file • WO#, Asset, Priority, Assigned To, Hours, Parts Status</div>
                        </div>
                    </button>
                </div>

                <div className="px-6 pb-4">
                    <button
                        onClick={onClose}
                        className="w-full py-2 text-sm font-medium text-slate-500 hover:text-slate-700 transition"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

// ── Toolbar Button (for embedding in Scheduling.tsx) ─────────────────

export const PrintExportButton: React.FC<{
    onClick: () => void;
}> = ({ onClick }) => (
    <button
        onClick={onClick}
        className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition flex items-center gap-1.5"
        title="Print or Export Schedule"
    >
        <Printer size={13} /> Print / Export
    </button>
);
