import React from 'react';
import type { PurchaseOrder } from '../../types';
import { fmtMoney } from '../../lib/money';

/**
 * Print view of one purchase order. Hidden on screen; under `@media print`
 * the app chrome (sidebar, top bar, bottom nav, the PO list column and the
 * tabbed screen view) is hidden and this sheet is the only thing rendered.
 * window.print() from the header "Print" action is all it takes — the button
 * had an empty onClick before.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  html, body, #root, #root div, #root main { height: auto !important; max-height: none !important; overflow: visible !important; }
  body { background: #fff !important; }
  header, nav, aside, .bg-slate-900.w-64, .po-no-print, .po-screen, .fab { display: none !important; }
  .po-print-root { box-shadow: none !important; border: 0 !important; border-radius: 0 !important; }
  .po-print-sheet { display: block !important; }
}
`;

export const PoPrintSheet: React.FC<{
    po: PurchaseOrder;
    supplierName: string;
    shipToName: string;
    invoiceToName: string;
    costCenterLabel: string;
    workOrderNumber: (jobId?: string) => string;
    totalAmount: number;
}> = ({ po, supplierName, shipToName, invoiceToName, costCenterLabel, workOrderNumber, totalAmount }) => {
    const money = (v: number) => fmtMoney(v, po.currency);
    const meta: [string, string][] = [
        ['Status', po.status.replace('_', ' ')],
        ['Date created', po.dateCreated || '—'],
        ['Date required', po.dateRequired || '—'],
        ['Currency', po.currency || '—'],
        ['Cost centre', costCenterLabel || '—'],
        ['Reference', po.reference || '—'],
        ['Raised by', po.createdById || '—'],
        ['Authorised by', po.authorizedById ? `${po.authorizedById}${po.authorizedAt ? ` · ${new Date(po.authorizedAt).toLocaleDateString()}` : ''}` : 'Pending'],
    ];
    return (
        <section className="po-print-sheet hidden text-slate-900 text-[12px] leading-snug">
            <style>{PRINT_CSS}</style>
            <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
                <div>
                    <h1 className="text-xl font-bold m-0">Purchase Order {po.poCode}</h1>
                    <p className="text-slate-600 m-0">{supplierName || 'Supplier not selected'}{po.supplierContactName ? ` · Attn: ${po.supplierContactName}` : ''}</p>
                </div>
                <div className="text-right text-[11px] text-slate-500">Printed {new Date().toLocaleString()}</div>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3">
                <div><span className="block text-[9px] uppercase tracking-wide text-slate-500 font-bold">Ship to</span>{shipToName || '—'}</div>
                <div><span className="block text-[9px] uppercase tracking-wide text-slate-500 font-bold">Invoice to</span>{invoiceToName || '—'}</div>
            </div>
            <div className="grid grid-cols-4 gap-x-4 gap-y-1 border border-slate-300 rounded p-2 mb-4">
                {meta.map(([k, v]) => (
                    <div key={k}><span className="block text-[9px] uppercase tracking-wide text-slate-500 font-bold">{k}</span>{v}</div>
                ))}
            </div>

            <table className="w-full border-collapse">
                <thead>
                    <tr className="bg-slate-100 text-[10px] uppercase text-slate-600">
                        <th className="border border-slate-300 px-2 py-1 text-left w-8">#</th>
                        <th className="border border-slate-300 px-2 py-1 text-left">Description</th>
                        <th className="border border-slate-300 px-2 py-1 text-left w-24">Work order</th>
                        <th className="border border-slate-300 px-2 py-1 text-right w-16">Qty</th>
                        <th className="border border-slate-300 px-2 py-1 text-left w-12">UoM</th>
                        <th className="border border-slate-300 px-2 py-1 text-right w-24">Unit</th>
                        <th className="border border-slate-300 px-2 py-1 text-right w-24">Total</th>
                        <th className="border border-slate-300 px-2 py-1 text-right w-16">Rec'd</th>
                    </tr>
                </thead>
                <tbody>
                    {po.items.length === 0 ? (
                        <tr><td colSpan={8} className="border border-slate-300 px-2 py-3 text-center text-slate-500">No lines</td></tr>
                    ) : po.items.map((it, i) => (
                        <tr key={it.id}>
                            <td className="border border-slate-300 px-2 py-1">{i + 1}</td>
                            <td className="border border-slate-300 px-2 py-1">{it.description}</td>
                            <td className="border border-slate-300 px-2 py-1">{workOrderNumber(it.jobId) || '—'}</td>
                            <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{it.qtyOrdered}</td>
                            <td className="border border-slate-300 px-2 py-1">{it.uom}</td>
                            <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{money(it.unitCost)}</td>
                            <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{money(it.lineTotal)}</td>
                            <td className="border border-slate-300 px-2 py-1 text-right tabular-nums">{it.qtyReceivedTotal || 0}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr>
                        <td colSpan={6} className="px-2 py-1 text-right font-bold">Total {po.taxInclusive ? '(tax incl.)' : '(net — tax at invoice)'}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right font-bold tabular-nums">{money(totalAmount)}</td>
                        <td />
                    </tr>
                </tfoot>
            </table>

            {po.comments && (
                <div className="mt-4">
                    <span className="block text-[9px] uppercase tracking-wide text-slate-500 font-bold">Comments</span>
                    <p className="whitespace-pre-wrap m-0">{po.comments}</p>
                </div>
            )}

            <div className="grid grid-cols-3 gap-6 mt-10">
                {['Raised by', 'Authorised by', 'Received by'].map(l => (
                    <div key={l} className="border-t border-slate-700 pt-1 text-[10px] text-slate-600">{l} · signature / date</div>
                ))}
            </div>
        </section>
    );
};
