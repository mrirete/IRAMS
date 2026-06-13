import {
    BarChart, Bar, LineChart, Line, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine
} from 'recharts';
import {
    TrendingUp, TrendingDown, Activity, Clock, DollarSign, Shield, ArrowRight,
    Wrench, Package, AlertTriangle, CheckCircle
} from 'lucide-react';
import type { MCOutput, MCPercentiles } from '../utils/monteCarloEngine';

const KPI = ({ label, value, unit, sub, color = 'blue', delta }: {
    label: string; value: string | number; unit?: string; sub?: string; color?: string;
    delta?: { value: number; label: string; invert?: boolean };
}) => {
    const isGood = delta ? (delta.invert ? delta.value < 0 : delta.value > 0) : true;
    return (
        <div className={`bg-${color}-50 border border-${color}-100 rounded-xl p-4`}>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{label}</p>
            <p className={`text-xl font-bold text-${color}-700 mt-1`}>
                {value} {unit && <span className="text-xs font-normal">{unit}</span>}
            </p>
            {sub && <p className={`text-[11px] text-${color}-500 mt-1`}>{sub}</p>}
            {delta && Math.abs(delta.value) > 0.01 && (
                <div className={`flex items-center gap-1 mt-1.5 text-[11px] font-bold ${isGood ? 'text-emerald-600' : 'text-red-500'}`}>
                    {isGood ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {delta.value > 0 ? '+' : ''}{delta.value.toFixed(1)} {delta.label}
                </div>
            )}
        </div>
    );
};

export const MonteCarloResults: React.FC<{
    output: MCOutput;
    hasPM: boolean;
    onSendToRAM?: (mtbf: number, mttr: number, ao: number) => void;
    /** MC → Work Management bridge */
    onCreatePM?: () => void;
    asset?: { id: string; tag: string; name: string } | null;
    pmInterval?: number;
    beta?: number;
    eta?: number;
}> = ({ output, hasPM, onSendToRAM, onCreatePM, asset, pmInterval, beta, eta }) => {
    const rtf = output.rtfPercentiles;
    const pm = output.pmPercentiles;
    const pctTable = [
        { metric: 'Availability (%)', ...spreadPct(rtf.ao) },
        { metric: 'Failures / yr', ...spreadPct(rtf.failures) },
        { metric: 'Total Cost ($)', ...spreadPctK(rtf.cost) },
        { metric: 'Downtime (hrs)', ...spreadPct(rtf.downtime) },
    ];

    return (
        <div className="space-y-5 animate-in fade-in duration-300">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <KPI label="Availability (P50)" value={rtf.ao.p50.toFixed(1)} unit="%" color="emerald"
                    sub={`P10: ${rtf.ao.p10.toFixed(1)}% · P90: ${rtf.ao.p90.toFixed(1)}%`}
                    delta={pm ? { value: pm.ao.p50 - rtf.ao.p50, label: '% vs RTF' } : undefined} />
                <KPI label="Expected Failures" value={rtf.failures.p50.toFixed(1)} unit="/yr" color="blue"
                    sub={`P10: ${rtf.failures.p10} · P90: ${rtf.failures.p90}`} />
                <KPI label="Total Cost (P50)" value={`$${(rtf.cost.p50 / 1000).toFixed(1)}k`} color="amber"
                    sub={`P10: $${(rtf.cost.p10 / 1000).toFixed(0)}k · P90: $${(rtf.cost.p90 / 1000).toFixed(0)}k`}
                    delta={pm ? { value: pm.cost.p50 - rtf.cost.p50, label: '$ vs RTF', invert: true } : undefined} />
                <KPI label="Simulated MTBF" value={rtf.mtbfSim === Infinity ? '∞' : rtf.mtbfSim.toLocaleString()} unit="hrs" color="purple"
                    sub={`Downtime P50: ${rtf.downtime.p50.toFixed(0)} hrs`} />
            </div>

            {/* PM Strategy Banner */}
            {hasPM && pm && (
                <div className={`p-4 rounded-xl border ${pm.ao.p50 > rtf.ao.p50
                    ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${pm.ao.p50 > rtf.ao.p50 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                            <Shield size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-800">PM Strategy Comparison</p>
                            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                Planned Maintenance {pm.ao.p50 > rtf.ao.p50 ? 'improves' : 'reduces'} availability by{' '}
                                <strong>{Math.abs(pm.ao.p50 - rtf.ao.p50).toFixed(1)}%</strong> and{' '}
                                {pm.cost.p50 < rtf.cost.p50 ? 'saves' : 'costs an additional'}{' '}
                                <strong>${Math.abs(pm.cost.p50 - rtf.cost.p50).toLocaleString()}/yr</strong>{' '}
                                compared to Run-to-Failure.
                                {pm.ao.p50 > rtf.ao.p50 && pm.cost.p50 < rtf.cost.p50 ? ' Recommended for implementation.' : ''}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Charts 2x2 Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Availability Histogram */}
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                        <Activity size={14} className="text-emerald-500" /> Availability Distribution
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-3">Histogram of Ao across {output.rtfRuns.length.toLocaleString()} runs</p>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={output.histogramAo}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="bin" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Bar dataKey="rtf" fill="#94a3b8" name="RTF" radius={[2, 2, 0, 0]} />
                            {hasPM && <Bar dataKey="pm" fill="#34d399" name="PM" radius={[2, 2, 0, 0]} opacity={0.7} />}
                            <ReferenceLine x={rtf.ao.p50.toFixed(1)} stroke="#0ea5e9" strokeDasharray="4 4" label={{ value: 'P50', fontSize: 10 }} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Cost Distribution */}
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                        <DollarSign size={14} className="text-amber-500" /> Cost Distribution
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-3">Annual lifecycle cost distribution</p>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={output.histogramCost}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="bin" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Bar dataKey="rtf" fill="#f59e0b" name="RTF" radius={[2, 2, 0, 0]} />
                            {hasPM && <Bar dataKey="pm" fill="#06b6d4" name="PM" radius={[2, 2, 0, 0]} opacity={0.7} />}
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Survival Curve */}
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                        <TrendingUp size={14} className="text-blue-500" /> Survival Curve R(t)
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-3">Simulated vs theoretical Weibull reliability</p>
                    <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={output.survivalCurve}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="t" tick={{ fontSize: 10 }} label={{ value: 'Hours', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} label={{ value: 'R(t) %', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="theoretical" stroke="#a855f7" strokeWidth={2} dot={false} name="Weibull R(t)" />
                            <Line type="stepAfter" dataKey="simulated" stroke="#10b981" strokeWidth={1.5} dot={false} name="Simulated" strokeDasharray="4 4" />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                {/* Convergence Monitor */}
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                        <Clock size={14} className="text-cyan-500" /> Convergence Monitor
                    </h4>
                    <p className="text-[10px] text-slate-400 mb-3">
                        Running average Ao ·{' '}
                        <span className={output.converged ? 'text-emerald-600 font-bold' : 'text-amber-500 font-bold'}>
                            {output.converged ? '✓ Converged' : '⚠ Not converged — increase runs'}
                        </span>
                    </p>
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={output.convergence}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="run" tick={{ fontSize: 10 }} label={{ value: 'Runs', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                            <Tooltip />
                            <Area type="monotone" dataKey="aoUpper" stroke="none" fill="#d1fae5" />
                            <Area type="monotone" dataKey="aoLower" stroke="none" fill="white" />
                            <Line type="monotone" dataKey="aoAvg" stroke="#10b981" strokeWidth={2} dot={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Percentile Table */}
            <div className="bg-white border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-bold text-slate-800 mb-3">Percentile Summary (RTF Scenario)</h4>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200">
                                <th className="text-left py-2 px-3 text-xs font-bold text-slate-500 uppercase">Metric</th>
                                {['P10', 'P25', 'P50', 'P75', 'P90'].map(p => (
                                    <th key={p} className="text-right py-2 px-3 text-xs font-bold text-slate-500 uppercase">{p}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {pctTable.map((row, i) => (
                                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                                    <td className="py-2 px-3 font-medium text-slate-700">{row.metric}</td>
                                    <td className="py-2 px-3 text-right font-mono text-slate-600">{row.p10}</td>
                                    <td className="py-2 px-3 text-right font-mono text-slate-600">{row.p25}</td>
                                    <td className="py-2 px-3 text-right font-mono text-slate-800 font-bold">{row.p50}</td>
                                    <td className="py-2 px-3 text-right font-mono text-slate-600">{row.p75}</td>
                                    <td className="py-2 px-3 text-right font-mono text-slate-600">{row.p90}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ═══ MC → WORK MANAGEMENT ACTIONS ═══ */}
            {asset && (
                <div className="bg-gradient-to-r from-slate-50 via-teal-50/30 to-cyan-50/30 border border-teal-200/60 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-teal-100">
                            <Wrench size={14} className="text-teal-600" />
                        </div>
                        <h4 className="text-sm font-bold text-slate-800">Work Management Actions</h4>
                        <span className="text-[10px] text-slate-400 ml-auto font-mono">{output.rtfRuns.length.toLocaleString()} runs · {asset.tag}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* ── 1. Create PM Program ──────────────────── */}
                        {hasPM && pm && pm.ao.p50 > rtf.ao.p50 && onCreatePM && (
                            <div className="bg-white border border-emerald-200 rounded-xl p-4 flex flex-col">
                                <div className="flex items-center gap-2 mb-2">
                                    <Wrench size={14} className="text-emerald-600" />
                                    <span className="text-xs font-bold text-emerald-800">Create PM Program</span>
                                </div>
                                <p className="text-[11px] text-slate-600 leading-relaxed flex-1">
                                    Simulation confirms PM at <strong>{pmInterval?.toLocaleString() || '—'} hrs</strong> improves
                                    Ao by <strong className="text-emerald-700">{(pm.ao.p50 - rtf.ao.p50).toFixed(1)}%</strong> and
                                    saves <strong className="text-emerald-700">${Math.abs(pm.cost.p50 - rtf.cost.p50).toLocaleString()}/yr</strong>.
                                </p>
                                <button
                                    onClick={onCreatePM}
                                    className="mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-bold rounded-lg shadow-md hover:shadow-lg hover:scale-[1.02] transition-all"
                                >
                                    <Wrench size={13} /> Create PM Program
                                </button>
                            </div>
                        )}

                        {/* ── 2. Spares Demand Forecast ──────────────── */}
                        <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col">
                            <div className="flex items-center gap-2 mb-2">
                                <Package size={14} className="text-blue-600" />
                                <span className="text-xs font-bold text-blue-800">Spares Demand Forecast</span>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-relaxed flex-1">
                                P50: <strong>{rtf.failures.p50.toFixed(0)}</strong> failures/yr ·
                                P90: <strong className="text-blue-700">{rtf.failures.p90.toFixed(0)}</strong> failures/yr.
                                {hasPM && pm ? (
                                    <> With PM: <strong className="text-emerald-600">{pm.failures.p50.toFixed(0)}</strong> failures/yr (P50).</>                                ) : null}
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                                <div className="flex-1 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5 text-center">
                                    <p className="text-[9px] text-blue-400 font-bold uppercase">Stock for P90</p>
                                    <p className="text-sm font-bold text-blue-700">{Math.ceil(rtf.failures.p90)} units</p>
                                </div>
                                {hasPM && pm && (
                                    <div className="flex-1 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-1.5 text-center">
                                        <p className="text-[9px] text-emerald-400 font-bold uppercase">With PM (P90)</p>
                                        <p className="text-sm font-bold text-emerald-700">{Math.ceil(pm.failures.p90)} units</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── 3. SLA / Availability Risk Alert ────────── */}
                        {(() => {
                            const slaTarget = 95; // Typical O&G SLA
                            const currentAo = hasPM && pm ? pm.ao.p50 : rtf.ao.p50;
                            const atRisk = currentAo < slaTarget;
                            return (
                                <div className={`bg-white border rounded-xl p-4 flex flex-col ${
                                    atRisk ? 'border-red-200' : 'border-emerald-200'
                                }`}>
                                    <div className="flex items-center gap-2 mb-2">
                                        {atRisk
                                            ? <AlertTriangle size={14} className="text-red-500" />
                                            : <CheckCircle size={14} className="text-emerald-500" />
                                        }
                                        <span className={`text-xs font-bold ${
                                            atRisk ? 'text-red-800' : 'text-emerald-800'
                                        }`}>SLA Compliance ({slaTarget}% Ao Target)</span>
                                    </div>
                                    <p className="text-[11px] text-slate-600 leading-relaxed flex-1">
                                        {atRisk ? (
                                            <>Simulated Ao = <strong className="text-red-600">{currentAo.toFixed(1)}%</strong> — below {slaTarget}% SLA target.
                                            Gap: <strong className="text-red-600">{(slaTarget - currentAo).toFixed(1)}%</strong>.
                                            Consider design-out, redundancy, or PM optimization.</>
                                        ) : (
                                            <>Simulated Ao = <strong className="text-emerald-600">{currentAo.toFixed(1)}%</strong> — meets {slaTarget}% target.
                                            Margin: <strong className="text-emerald-600">+{(currentAo - slaTarget).toFixed(1)}%</strong>.</>
                                        )}
                                    </p>
                                    <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold ${
                                        atRisk ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                    }`}>
                                        {atRisk ? <AlertTriangle size={12} /> : <Shield size={12} />}
                                        <span>{atRisk ? 'ACTION REQUIRED — Raise reliability improvement WR' : 'SLA COMPLIANT — No action needed'}</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3">
                {onSendToRAM && (
                    <button onClick={() => onSendToRAM(rtf.mtbfSim, rtf.downtime.p50, rtf.ao.p50 / 100)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white text-sm font-semibold rounded-lg shadow-md hover:shadow-lg transition-all">
                        <ArrowRight size={14} /> Send to RAM Dashboard
                    </button>
                )}
                <button onClick={() => exportCSV(output)}
                    className="flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition-colors">
                    📥 Export CSV
                </button>
                <span className="ml-auto text-[10px] text-slate-400 self-center font-mono">
                    {output.rtfRuns.length.toLocaleString()} runs · {output.elapsedMs}ms · {output.converged ? '✓ converged' : '⚠ not converged'}
                </span>
            </div>
        </div>
    );
};

function spreadPct(p: MCPercentiles['ao']) {
    return { p10: p.p10.toFixed(1), p25: p.p25.toFixed(1), p50: p.p50.toFixed(1), p75: p.p75.toFixed(1), p90: p.p90.toFixed(1) };
}
function spreadPctK(p: MCPercentiles['cost']) {
    const fmt = (v: number) => `$${(v / 1000).toFixed(1)}k`;
    return { p10: fmt(p.p10), p25: fmt(p.p25), p50: fmt(p.p50), p75: fmt(p.p75), p90: fmt(p.p90) };
}

function exportCSV(output: MCOutput) {
    const header = 'Run,Availability_%,Failures,Downtime_hrs,Total_Cost_USD\n';
    const rows = output.rtfRuns.map((r, i) => `${i + 1},${r.availability},${r.failures},${r.downtime},${r.totalCost}`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `monte_carlo_results_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
}

export default MonteCarloResults;
