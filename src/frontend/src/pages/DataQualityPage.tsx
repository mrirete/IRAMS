import React from 'react';
import { Database, AlertTriangle, XCircle, BarChart3 } from 'lucide-react';
import { useStrategy } from '../hooks/useStrategy';

export const DataQualityPage: React.FC = () => {
    const { dataQuality, dataViolations, overallCompleteness } = useStrategy();

    const entityLabel: Record<string, string> = { asset: 'Assets', work_order: 'Work Orders', person: 'People', inventory: 'Inventory' };
    const entityIcon: Record<string, string> = { asset: '🏗️', work_order: '🔧', person: '👤', inventory: '📦' };

    const scoreColor = (pct: number) => {
        if (pct >= 90) return { text: 'text-emerald-600', bar: 'bg-emerald-500', border: 'border-emerald-200' };
        if (pct >= 80) return { text: 'text-amber-600', bar: 'bg-amber-500', border: 'border-amber-200' };
        return { text: 'text-red-600', bar: 'bg-red-500', border: 'border-red-200' };
    };

    return (
        <div className="space-y-6 pb-20">
            <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Data Quality & Governance</h1><p className="text-slate-500 text-sm mt-1">"Single Source of Truth" — completeness, integrity, and EAM compliance checks</p></div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Overall Completeness" value={`${overallCompleteness}%`} icon={Database} color={overallCompleteness >= 90 ? 'text-emerald-500' : 'text-amber-500'} bg={overallCompleteness >= 90 ? 'bg-emerald-50' : 'bg-amber-50'} />
                <Kpi label="Errors" value={dataViolations.filter(v => v.severity === 'error').length} icon={XCircle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Warnings" value={dataViolations.filter(v => v.severity === 'warning').length} icon={AlertTriangle} color="text-amber-500" bg="bg-amber-50" />
                <Kpi label="Total Records" value={dataQuality.reduce((a, d) => a + d.total_records, 0).toLocaleString()} icon={BarChart3} />
            </div>

            {/* Entity Scorecards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {dataQuality.map(dq => {
                    const c = scoreColor(dq.completeness_score);
                    return (
                        <div key={dq.entity_type} className={`bg-white border ${c.border} rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow`}>
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex items-center">
                                    <span className="text-2xl mr-2">{entityIcon[dq.entity_type]}</span>
                                    <div>
                                        <h3 className="text-slate-800 font-semibold text-sm">{entityLabel[dq.entity_type]}</h3>
                                        <p className="text-slate-400 text-[10px] font-mono">{dq.total_records.toLocaleString()} records</p>
                                    </div>
                                </div>
                                <span className={`text-2xl font-bold font-mono ${c.text}`}>{dq.completeness_score}%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-2 mb-3">
                                <div className={`h-2 rounded-full transition-all ${c.bar}`} style={{ width: `${dq.completeness_score}%` }}></div>
                            </div>
                            <div className="flex justify-between text-[10px] text-slate-500">
                                <span>Missing: <span className={dq.missing_fields_pct > 5 ? 'text-amber-600 font-medium' : 'text-slate-600'}>{dq.missing_fields_pct}%</span></span>
                                <span>Duplicates: <span className={dq.duplicate_count > 5 ? 'text-amber-600 font-medium' : 'text-slate-600'}>{dq.duplicate_count}</span></span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Violations Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest">EAM Rule Violations</h3>
                    <span className="text-slate-400 text-xs">{dataViolations.length} issue(s) detected</span>
                </div>
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-3">Severity</th>
                            <th className="px-6 py-3">Entity</th>
                            <th className="px-6 py-3">Record</th>
                            <th className="px-6 py-3">Violation</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {dataViolations.map(v => (
                            <tr key={v.id} className={`hover:bg-slate-50 transition-colors ${v.severity === 'error' ? 'bg-red-50/30' : ''}`}>
                                <td className="px-6 py-3">{v.severity === 'error' ? <span className="flex items-center text-red-600 text-xs font-bold"><XCircle size={14} className="mr-1" />Error</span> : <span className="flex items-center text-amber-600 text-xs font-semibold"><AlertTriangle size={14} className="mr-1" />Warning</span>}</td>
                                <td className="px-6 py-3 capitalize text-slate-600 text-xs">{v.entity_type.replace(/_/g, ' ')}</td>
                                <td className="px-6 py-3"><span className="font-mono text-slate-700 text-xs">{v.record_id}</span> <span className="text-slate-400 text-xs">— {v.record_name}</span></td>
                                <td className="px-6 py-3 text-slate-700 text-xs">{v.violation}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-blue-50' }: any) {
    return (<div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className={`p-3 rounded-lg ${bg} ${color} mr-4`}><Icon size={24} /></div><div><p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p><h3 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h3></div></div>);
}
