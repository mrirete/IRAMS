import React, { useState, useEffect } from 'react';
import { Leaf, Zap, Recycle, CloudRain, TrendingDown, Plane } from 'lucide-react';
import { useStrategy } from '../hooks/useStrategy';
import { visionService } from '../eam/services/VisionService';

export const SustainPage: React.FC = () => {
    const { carbon, repairVsReplace, waste, climateRisks, totalCO2, diversionRate } = useStrategy();
    const [tab, setTab] = useState<'carbon' | 'circular' | 'climate'>('carbon');
    const [droneAnomalyCounts, setDroneAnomalyCounts] = useState<Record<string, number>>({});

    useEffect(() => {
        (async () => {
            try {
                const surveys = await visionService.getAllDroneSurveys();
                const counts: Record<string, number> = {};
                surveys.forEach(s => {
                    if (s.asset_id && s.anomalies_found > 0) {
                        counts[s.asset_id] = (counts[s.asset_id] || 0) + s.anomalies_found;
                    }
                });
                setDroneAnomalyCounts(counts);
            } catch { /* fallback empty */ }
        })();
    }, []);

    const riskColor = (l: string) => {
        if (l === 'extreme') return 'text-red-600 bg-red-50 border-red-200';
        if (l === 'high') return 'text-orange-600 bg-orange-50 border-orange-200';
        if (l === 'moderate') return 'text-amber-600 bg-amber-50 border-amber-200';
        return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    };

    const wasteColor: Record<string, string> = { recycled: 'bg-emerald-500', reused: 'bg-cyan-500', landfill: 'bg-slate-400', incinerated: 'bg-orange-500', hazardous: 'bg-red-500' };

    return (
        <div className="space-y-6 pb-20">
            <div><h1 className="text-2xl font-bold text-slate-800 tracking-tight">ESG & Sustainability</h1><p className="text-slate-500 text-sm mt-1">Carbon footprint, circular economy metrics, and climate risk assessment</p></div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Total CO₂ (Scope 1+2)" value={`${(totalCO2 / 1000).toFixed(1)}k tCO₂`} icon={Leaf} color="text-emerald-600" bg="bg-emerald-50" />
                <Kpi label="Energy Intensity" value="2.4 GJ/t" icon={Zap} color="text-amber-500" bg="bg-amber-50" />
                <Kpi label="Circularity Index" value={`${diversionRate}%`} icon={Recycle} color="text-cyan-600" bg="bg-cyan-50" />
                <Kpi label="High Climate Risk" value={climateRisks.filter(c => c.risk_level === 'high' || c.risk_level === 'extreme').length} icon={CloudRain} color="text-orange-500" bg="bg-orange-50" />
            </div>

            <div className="flex space-x-1 bg-slate-100 rounded-xl p-1 w-fit">
                <button onClick={() => setTab('carbon')} className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'carbon' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Carbon Dashboard</button>
                <button onClick={() => setTab('circular')} className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'circular' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Circular Economy</button>
                <button onClick={() => setTab('climate')} className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'climate' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Climate Risk</button>
            </div>

            {tab === 'carbon' && (
                <div className="space-y-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-5">Emissions by Asset (tCO₂/yr)</h3>
                        <div className="space-y-4">
                            {carbon.sort((a, b) => b.total_tco2 - a.total_tco2).map(c => {
                                const maxVal = carbon[0].total_tco2;
                                return (
                                    <div key={c.asset_id} className="space-y-1.5">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-700 font-medium">{c.asset_name}</span>
                                            <span className="text-slate-500 font-mono">{c.total_tco2.toLocaleString()} tCO₂</span>
                                        </div>
                                        <div className="w-full bg-slate-100 rounded-full h-4 flex overflow-hidden">
                                            <div className="bg-gradient-to-r from-orange-400 to-orange-500 h-full rounded-l transition-all" style={{ width: `${(c.scope1_tco2 / maxVal) * 100}%` }} title={`Scope 1: ${c.scope1_tco2}`}></div>
                                            <div className="bg-gradient-to-r from-blue-400 to-blue-500 h-full transition-all" style={{ width: `${(c.scope2_tco2 / maxVal) * 100}%` }} title={`Scope 2: ${c.scope2_tco2}`}></div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex space-x-6 mt-5 text-xs text-slate-500"><span className="flex items-center"><span className="w-3 h-3 bg-orange-500 rounded-sm mr-1.5"></span>Scope 1 (Direct)</span><span className="flex items-center"><span className="w-3 h-3 bg-blue-500 rounded-sm mr-1.5"></span>Scope 2 (Indirect)</span></div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-5">Repair vs Replace — Carbon & Cost Comparison</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {repairVsReplace.map(r => (
                                <div key={r.asset_id} className="bg-slate-50 rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
                                    <p className="text-slate-800 font-semibold text-sm mb-4">{r.asset_name}</p>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-center"><p className="text-slate-500 text-[10px] mb-1.5 uppercase">Repair</p><p className="text-emerald-600 font-mono font-bold text-base">${(r.repair_cost / 1000).toFixed(0)}k</p><p className="text-slate-500 font-mono mt-1">{(r.repair_carbon_kg / 1000).toFixed(1)}t CO₂</p></div>
                                        <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-center"><p className="text-slate-500 text-[10px] mb-1.5 uppercase">Replace</p><p className="text-red-600 font-mono font-bold text-base">${(r.replace_cost / 1000).toFixed(0)}k</p><p className="text-slate-500 font-mono mt-1">{(r.replace_carbon_kg / 1000).toFixed(1)}t CO₂</p></div>
                                    </div>
                                    <div className="mt-3 text-center"><span className="px-3 py-1.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-700 uppercase">{r.recommendation}</span></div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'circular' && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6 shadow-sm">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-widest">Waste Stream Breakdown</h3>
                    <div className="flex items-center space-x-6">
                        <div className="text-center">
                            <span className="text-4xl font-bold text-cyan-600 font-mono">{diversionRate}%</span>
                            <p className="text-slate-500 text-xs mt-1">Diversion Rate</p>
                        </div>
                        <div className="flex-1 h-8 flex rounded-full overflow-hidden shadow-inner bg-slate-100">
                            {waste.map(w => (<div key={w.category} className={`${wasteColor[w.category]} h-full transition-all`} style={{ width: `${w.pct}%` }} title={`${w.category}: ${w.pct}%`}></div>))}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-5">{waste.map(w => (<div key={w.category} className="flex items-center space-x-2 text-xs text-slate-600"><span className={`w-3 h-3 rounded-sm ${wasteColor[w.category]}`}></span><span className="capitalize font-medium">{w.category}</span><span className="font-mono text-slate-500">{w.mass_tonnes}t ({w.pct}%)</span></div>))}</div>
                </div>
            )}

            {tab === 'climate' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {climateRisks.map(c => {
                        const rc = riskColor(c.risk_level);
                        return (
                            <div key={c.asset_id} className={`bg-white border-2 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow ${rc.split(' ').slice(2).join(' ')}`}>
                                <div className="flex justify-between items-start mb-4">
                                    <div><h3 className="text-slate-800 font-semibold">{c.asset_name}</h3><p className="text-slate-400 text-xs font-mono mt-0.5">{c.asset_id.toUpperCase()}</p></div>
                                    <span className={`px-2.5 py-1 text-[10px] font-bold uppercase rounded-full ${rc}`}>{c.risk_level}</span>
                                </div>
                                <div className="mb-4"><span className="text-slate-500 text-[10px] uppercase font-semibold tracking-wider">Vulnerability Score</span>
                                    <div className="flex items-center mt-1.5"><div className="flex-1 bg-slate-100 rounded-full h-2.5"><div className={`h-2.5 rounded-full transition-all ${c.vulnerability_score >= 70 ? 'bg-red-500' : c.vulnerability_score >= 40 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${c.vulnerability_score}%` }}></div></div><span className="ml-3 text-slate-700 font-mono text-sm font-bold">{c.vulnerability_score}</span></div>
                                </div>
                                <div className="space-y-1.5">{c.risk_factors.map((f, i) => (<p key={i} className="text-slate-600 text-xs flex items-center"><TrendingDown size={12} className="mr-1.5 text-slate-400" />{f}</p>))}</div>
                                {/* Vision Drone Anomaly Badge */}
                                {droneAnomalyCounts[c.asset_id] > 0 && (
                                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                                        <Plane size={12} className="text-cyan-500" />
                                        <span className="text-[10px] text-cyan-700 font-medium">
                                            {droneAnomalyCounts[c.asset_id]} drone anomal{droneAnomalyCounts[c.asset_id] === 1 ? 'y' : 'ies'} detected
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

function Kpi({ label, value, icon: Icon, color = 'text-accent-blue', bg = 'bg-blue-50' }: any) {
    return (<div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center shadow-sm hover:shadow-md transition-shadow"><div className={`p-3 rounded-lg ${bg} ${color} mr-4`}><Icon size={24} /></div><div><p className="text-slate-500 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p><h3 className="text-2xl font-bold text-slate-800 tracking-tight">{value}</h3></div></div>);
}
