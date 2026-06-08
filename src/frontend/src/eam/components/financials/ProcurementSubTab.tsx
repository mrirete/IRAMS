import React from 'react';
import { CreditCard } from 'lucide-react';
import { Asset } from '../../types';

interface ProcurementProps {
    asset: Asset;
    purchaseOrders: any[];
}

export const ProcurementSubTab: React.FC<ProcurementProps> = ({ asset, purchaseOrders }) => {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <CreditCard size={16} className="text-slate-400" />
                        Supply Chain & Procurement
                    </h3>
                </div>
                <div className="p-5">
                    {/* Vendor Information */}
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Vendor Information</div>
                    {asset.manufacturer ? (
                        <div className="mb-6 bg-slate-50 border border-slate-200 rounded-lg p-4">
                            <div className="font-medium text-slate-700 text-sm">{asset.manufacturer}</div>
                            <div className="text-xs text-blue-600 cursor-pointer hover:underline mt-1">View Vendor Profile</div>
                        </div>
                    ) : (
                        <div className="text-xs text-slate-400 italic mb-6 bg-slate-50 rounded-lg p-3 border border-dashed border-slate-200">
                            No manufacturer linked to this asset.
                        </div>
                    )}

                    {/* Purchase Orders */}
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Purchase Orders</div>
                    {purchaseOrders.length === 0 ? (
                        <div className="text-center py-8 text-slate-400">
                            <CreditCard size={24} className="mx-auto mb-2 text-slate-300" />
                            <div className="text-sm italic">No purchase orders found for this asset.</div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {purchaseOrders.map(po => (
                                <div key={po.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100 hover:border-slate-200 transition">
                                    <div>
                                        <div className="text-xs font-mono text-slate-700 font-medium">{po.poNumber || po.po_number || '—'}</div>
                                        <div className="text-[10px] text-slate-500">
                                            {po.date || po.date_created ? new Date(po.date || po.date_created).toLocaleDateString() : '—'}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold text-slate-900">${(po.amount ?? po.total_amount ?? 0).toLocaleString()}</div>
                                        <div className={`text-[10px] font-bold ${po.status === 'CLOSED' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                            {po.status || '—'}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
