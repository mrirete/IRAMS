/**
 * ErpExportPanel — Tier 1 outbound, as a person actually uses it.
 *
 * Pick a period, see what is in it, download the files, drop them in the
 * customer's middleware. Preview before download is not a nicety: this is a
 * finance interface, and the first question anyone asks is "what exactly will
 * it send them?" — the same reason proposal-writeback has a dry run.
 *
 * Re-running a period is safe and the panel says so, because the instinct
 * after a failed transfer is to worry about double-posting.
 */
import React, { useState } from 'react';
import { Download, FileUp, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ErpExportService } from '../../services/ErpExportService';
import type { RenderedBatch } from '../../../lib/erp/emitters';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

const isoDaysAgo = (n: number): string =>
    new Date(Date.now() - n * 86400000).toISOString().split('T')[0];

const FAMILY_LABEL: Record<string, string> = {
    cost_posting: 'Cost postings',
    goods_movement: 'Goods movements',
    goods_receipt: 'Goods receipts',
    purchase_order_line: 'Open commitments',
    supplier_invoice: 'Supplier invoices',
};

export const ErpExportPanel: React.FC = () => {
    const { showToast } = useToast();
    // The silent-truncation guard. RLS refuses reads QUIETLY: a caller whose
    // role lacks finops.view gets zero cost postings and would export a
    // confident "empty period" file — incomplete without looking incomplete.
    // The finance file must be all-or-nothing, so the panel refuses instead.
    // (The nightly edge function runs as service_role and is immune.)
    const { permissions } = useAuth();
    const canReadFinance = permissions?.finops?.view === true;
    const [from, setFrom] = useState(isoDaysAgo(1));
    const [to, setTo] = useState(isoDaysAgo(0));
    const [includeCommitments, setIncludeCommitments] = useState(false);
    const [batch, setBatch] = useState<RenderedBatch | null>(null);
    const [busy, setBusy] = useState(false);

    const preview = async () => {
        if (from > to) {
            showToast('The start date is after the end date.', 'warning');
            return;
        }
        setBusy(true);
        try {
            setBatch(await ErpExportService.exportPeriod({ from, to, includeOpenCommitments: includeCommitments }));
        } catch (e: any) {
            showToast('Export failed: ' + (e?.message || 'unknown error'), 'error');
            setBatch(null);
        } finally {
            setBusy(false);
        }
    };

    const download = () => {
        if (!batch) return;
        const files = ErpExportService.toFiles(batch);
        if (files.length === 0) {
            showToast('Nothing to download — the period is empty.', 'warning');
            return;
        }
        for (const file of files) {
            // A Blob per family rather than one archive: middleware pickup
            // rules match on filename, and a zip would have to be unpacked
            // before anything could route it.
            const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv;charset=utf-8;' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(url);
        }
        showToast(`${files.length} file${files.length === 1 ? '' : 's'} downloaded.`, 'success');
    };

    const rows = batch ? ErpExportService.summarise(batch) : [];
    const total = rows.reduce((s, r) => s + r.rows, 0);

    return (
        <div className="bg-white border border-slate-200 rounded-card p-4 space-y-4">
            <div className="flex items-center gap-2">
                <FileUp size={16} className="text-slate-400" />
                <h3 className="text-sm font-bold text-slate-700">ERP Export</h3>
                <span className="text-[11px] text-slate-400">
                    a period of finance documents, for the customer&apos;s middleware
                </span>
            </div>

            {!canReadFinance && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    Your role cannot read cost postings, so an export from here would silently omit
                    them — a finance file must be complete or not produced. The nightly export is
                    unaffected; ask an administrator for FinOps view access to export interactively.
                </div>
            )}

            <div className="flex flex-wrap items-end gap-3">
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">From</label>
                    <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                        className="border border-slate-300 rounded p-1.5 text-sm" />
                </div>
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">To</label>
                    <input type="date" value={to} onChange={e => setTo(e.target.value)}
                        className="border border-slate-300 rounded p-1.5 text-sm" />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 pb-2"
                    title="A commitment has no event date, so this is today's open orders regardless of the period above">
                    <input type="checkbox" checked={includeCommitments}
                        onChange={e => setIncludeCommitments(e.target.checked)} />
                    Include open commitments
                </label>
                <button onClick={preview} disabled={busy || !canReadFinance}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                    {busy ? 'Reading…' : 'Preview'}
                </button>
                <button onClick={download} disabled={!batch || total === 0}
                    className="px-3 py-1.5 bg-primary-600 text-white text-xs font-bold rounded hover:bg-primary-500 disabled:opacity-40 flex items-center gap-2">
                    <Download size={14} /> Download
                </button>
            </div>

            {batch && (
                <div className="space-y-2">
                    {total === 0 ? (
                        <p className="text-xs text-slate-500">No documents in this period.</p>
                    ) : (
                        <table className="w-full text-xs">
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.kind} className="border-b border-slate-100 last:border-0">
                                        <td className="py-1.5 text-slate-700">{FAMILY_LABEL[r.kind] || r.kind}</td>
                                        <td className="py-1.5 text-right tabular-nums font-semibold text-slate-800">{r.rows}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {batch.skipped.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-xs text-amber-800">
                            <div className="flex items-center gap-1.5 font-bold mb-1">
                                <AlertTriangle size={13} />
                                {batch.skipped.length} record{batch.skipped.length === 1 ? '' : 's'} not exported
                            </div>
                            <ul className="list-disc ml-4 space-y-0.5">
                                {batch.skipped.slice(0, 5).map(s => (
                                    <li key={s.document_id}>{s.kind}: {s.reason}</li>
                                ))}
                                {batch.skipped.length > 5 && <li>…and {batch.skipped.length - 5} more</li>}
                            </ul>
                        </div>
                    )}

                    <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
                        <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-500" />
                        Re-running this period produces the same documents with the same ids, so a
                        receiver that has already taken one will recognise and drop the repeat. A failed
                        transfer is fixed by running it again.
                    </p>
                </div>
            )}
        </div>
    );
};

export default ErpExportPanel;
