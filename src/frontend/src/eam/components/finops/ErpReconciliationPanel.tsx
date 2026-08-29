/**
 * ErpReconciliationPanel — the exception queue the integration lives or dies by.
 *
 * Integrations do not die of missing features; they die in week three because
 * nobody owns the failed documents. This panel is that ownership made visible:
 * finished orders whose cost has not reached the ledger, invoices blocked from
 * payment, movements that owe a posting, and whether last night's export
 * actually happened — with the fix actions inline where one exists.
 *
 * Calm by design: when every queue is empty it collapses to a single green
 * line, because an empty exception queue is the normal state and a wall of
 * empty tables would teach people to stop looking.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Loader2, MoonStar } from 'lucide-react';
import { ErpExportService } from '../../services/ErpExportService';
import { FinOpsService } from '../../services/FinOpsService';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

type Queues = Awaited<ReturnType<typeof ErpExportService.getReconciliationQueues>>;
type Runs = Awaited<ReturnType<typeof ErpExportService.getRunHistory>>;

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ErpReconciliationPanel: React.FC = () => {
    const { showToast } = useToast();
    const { permissions } = useAuth();
    // Settling and re-matching are finance writes; viewing the queues is not.
    const canAct = permissions?.finops?.edit === true;

    const [queues, setQueues] = useState<Queues | null>(null);
    const [runs, setRuns] = useState<Runs>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = useCallback(async () => {
        const [q, r] = await Promise.all([
            ErpExportService.getReconciliationQueues().catch(() => null),
            ErpExportService.getRunHistory(),
        ]);
        setQueues(q);
        setRuns(r);
    }, []);

    useEffect(() => { void load(); }, [load]);

    const settle = async (workOrderId: string, woNumber: string) => {
        setBusyId(workOrderId);
        try {
            const posted = await FinOpsService.settleWorkOrder(workOrderId);
            showToast(posted.length === 0
                ? `${woNumber}: already settled.`
                : `${woNumber}: ${posted.length} posting${posted.length === 1 ? '' : 's'} to the ledger.`, 'success');
            await load();
        } catch (e: any) {
            showToast(`Settle failed: ${e.message}`, 'error');
        } finally {
            setBusyId(null);
        }
    };

    const rematch = async (invoiceId: string, invoiceNumber: string) => {
        setBusyId(invoiceId);
        try {
            const verdict = await FinOpsService.matchInvoice(invoiceId);
            showToast(verdict.status === 'BLOCKED'
                ? `${invoiceNumber}: still blocked — ${(verdict.block || 'variance').toLowerCase()}.`
                : `${invoiceNumber}: now ${verdict.status.toLowerCase()}.`,
                verdict.status === 'BLOCKED' ? 'warning' : 'success');
            await load();
        } catch (e: any) {
            showToast(`Re-match failed: ${e.message}`, 'error');
        } finally {
            setBusyId(null);
        }
    };

    if (!queues) return null;

    const total = queues.unsettled.length + queues.blockedInvoices.length + queues.unpostedMovements;
    const lastRun = runs[0];

    return (
        <div className="bg-white border border-slate-200 rounded-card p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
                <RefreshCw size={16} className="text-slate-400" />
                <h3 className="text-sm font-bold text-slate-700">ERP Reconciliation</h3>
                <span className="text-[11px] text-slate-400">what has not reached the books, and why — IREAMS keeps the maintenance cost ledger and hands SAP FI documents, never journal entries; costs carrying a work order post via settlement only</span>
                {/* Last night's verdict rides in the header — the first question is always "did it run?" */}
                {lastRun && (
                    <span
                        className={`ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            lastRun.status === 'error' ? 'bg-red-50 text-red-700'
                                : lastRun.status === 'empty' ? 'bg-slate-100 text-slate-500'
                                    : 'bg-emerald-50 text-emerald-700'}`}
                        title={lastRun.error || `${lastRun.documents} document(s), ${lastRun.files.length} file(s), ${lastRun.triggeredBy}`}
                    >
                        <MoonStar size={11} />
                        {lastRun.status === 'error' ? `export failed ${lastRun.date}`
                            : lastRun.status === 'empty' ? `export empty ${lastRun.date}`
                                : `exported ${lastRun.date} · ${lastRun.documents} docs`}
                    </span>
                )}
            </div>

            {total === 0 ? (
                <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 size={13} /> Nothing owed to the ledger — every finished order is settled,
                    no invoice is blocked, no movement is unposted.
                </p>
            ) : (
                <div className="space-y-3">
                    {queues.unsettled.length > 0 && (
                        <div>
                            <div className="text-[10px] uppercase font-bold text-amber-700 mb-1">
                                Finished orders not fully settled ({queues.unsettled.length})
                            </div>
                            <table className="w-full text-xs">
                                <tbody>
                                    {queues.unsettled.map(u => (
                                        <tr key={u.workOrderId} className="border-b border-slate-100 last:border-0">
                                            <td className="py-1.5 font-medium text-slate-700">{u.woNumber}</td>
                                            <td className="py-1.5 text-right tabular-nums text-amber-700">{money(u.variance)}</td>
                                            <td className="py-1.5 text-right w-24">
                                                <button
                                                    onClick={() => void settle(u.workOrderId, u.woNumber)}
                                                    disabled={!canAct || busyId === u.workOrderId}
                                                    title={canAct ? 'Post the outstanding cost' : 'FinOps edit required'}
                                                    className="text-primary-600 hover:underline font-semibold disabled:opacity-40 disabled:no-underline"
                                                >
                                                    {busyId === u.workOrderId ? <Loader2 size={12} className="animate-spin inline" /> : 'Settle'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {queues.blockedInvoices.length > 0 && (
                        <div>
                            <div className="text-[10px] uppercase font-bold text-red-700 mb-1">
                                Invoices blocked from payment ({queues.blockedInvoices.length})
                            </div>
                            <table className="w-full text-xs">
                                <tbody>
                                    {queues.blockedInvoices.map(inv => (
                                        <tr key={inv.invoiceId} className="border-b border-slate-100 last:border-0">
                                            <td className="py-1.5 font-medium text-slate-700">{inv.invoiceNumber}</td>
                                            <td className="py-1.5 text-slate-500">{inv.vendor}</td>
                                            <td className="py-1.5">
                                                <span className="bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded">{inv.block}</span>
                                            </td>
                                            <td className="py-1.5 text-right tabular-nums text-red-700">{money(inv.variance)}</td>
                                            <td className="py-1.5 text-right w-24">
                                                <button
                                                    onClick={() => void rematch(inv.invoiceId, inv.invoiceNumber)}
                                                    disabled={!canAct || busyId === inv.invoiceId}
                                                    title={canAct ? 'A late delivery can clear a quantity block' : 'FinOps edit required'}
                                                    className="text-primary-600 hover:underline font-semibold disabled:opacity-40 disabled:no-underline"
                                                >
                                                    {busyId === inv.invoiceId ? <Loader2 size={12} className="animate-spin inline" /> : 'Re-match'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {queues.unpostedMovements > 0 && (
                        <p className="text-xs text-amber-800 flex items-center gap-1.5">
                            <AlertTriangle size={13} />
                            {queues.unpostedMovements} stock movement{queues.unpostedMovements === 1 ? '' : 's'} carrying value
                            but no financial document — the next settlement run or a support look is owed.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

export default ErpReconciliationPanel;
