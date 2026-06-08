import React from 'react';
import { TrendingUp, AlertTriangle, Activity } from 'lucide-react';
import { useIntegrity } from '../hooks/useIntegrity';

export const CorrosionRatesPage: React.FC = () => {
    const { corrosionRates, cmls, summary } = useIntegrity();

    return (
        <div className="space-y-6 pb-20">
            <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">Corrosion Rate Monitoring</h1><p className="text-slate-500 text-sm mt-1">Short-term vs long-term rates — accelerating corrosion detection</p></div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Avg Short-Term" value={`${summary.avg_corrosion_rate} mm/yr`} icon={TrendingUp} />
                <Kpi label="Accelerating" value={summary.accelerating_count} icon={AlertTriangle} color="text-red-500" bg="bg-red-50" />
                <Kpi label="Total CMLs" value={summary.total_cmls} icon={Activity} />
                <Kpi label="Below T-min" value={summary.cmls_below_tmin} icon={AlertTriangle} color="text-orange-500" bg="bg-orange-50" />
            </div>

            {summary.accelerating_count > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center">
                    <AlertTriangle className="text-red-500 mr-3 flex-shrink-0" size={20} />
                    <p className="text-red-700 text-sm font-medium">{summary.accelerating_count} CML(s) show accelerating corrosion (short-term &gt; 2× long-term). Engineering review recommended.</p>
                </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4">CML</th>
                            <th className="px-6 py-4">Asset</th>
                            <th className="px-6 py-4">Component</th>
                            <th className="px-6 py-4 text-right">Short-Term (mm/yr)</th>
                            <th className="px-6 py-4 text-right">Long-Term (mm/yr)</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4 text-center">Accelerating?</th>
                            <th className="px-6 py-4 text-right">Last Reading</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {corrosionRates.map(cr => {
                            const cml = cmls.find(c => c.id === cr.cml_id);
                            return (
                                <tr key={cr.cml_id} className={`hover:bg-slate-50 transition-colors ${cr.is_accelerating ? 'bg-red-50/50' : ''}`}>
                                    <td className="px-6 py-4 font-mono text-slate-700">{cml?.cml_number || cr.cml_id}</td>
                                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{cr.asset_id.toUpperCase()}</td>
                                    <td className="px-6 py-4 text-slate-600 capitalize">{cml?.component_type.replace(/_/g, ' ') || '—'}</td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-800 font-medium">{cr.short_term_rate_mmpy.toFixed(2)}</td>
                                    <td className="px-6 py-4 text-right font-mono text-slate-600">{cr.long_term_rate_mmpy.toFixed(2)}</td>
                                    <td className="px-6 py-4"><span className="px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded capitalize font-medium">{cr.rate_type}</span></td>
                                    <td className="px-6 py-4 text-center">{cr.is_accelerating ? <span className="text-red-600 font-bold">⚠ YES</span> : <span className="text-emerald-500">—</span>}</td>
                                    <td className="px-6 py-4 text-right font-mono text-xs text-slate-500">{new Date(cr.last_reading_date).toLocaleDateString()}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-blue-50' }: any) {
    return (<div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className={`p-3 rounded-lg ${bg} ${color} mr-4`}><Icon size={24} /></div><div><p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p><h3 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h3></div></div>);
}
