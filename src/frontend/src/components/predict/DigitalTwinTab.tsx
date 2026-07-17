import React from 'react';
import { HeartPulse, AlertTriangle, Layers } from 'lucide-react';
import { TwinHealthChart } from './TwinHealthChart';
import { ScenarioSimulator } from './ScenarioSimulator';
import { VisionThermalFeed } from './VisionThermalFeed';
import type { TwinState, RULEstimate } from '../../types/intelligence';
import type { ClassResolution } from '../../lib/predict/equipmentClass';
import type { IntegrityAssessment } from '../../lib/predict/integrity';
import { screenRbi } from '../../lib/predict/rbi';
import type { GroundedRul } from '../../lib/predict/groundedFit';

interface DigitalTwinTabProps {
    twinHealth: TwinState | null;
    rulEstimate: RULEstimate | null;
    selectedAssetId: string;
    selectedAssetName: string;
    /** Equipment-class resolution (Phase 2) */
    equipmentClass?: ClassResolution | null;
    /** API 570 thickness assessment — static assets with ≥2 thickness readings */
    integrity?: IntegrityAssessment | null;
    /** Asset criticality (A–E) — CoF proxy for the RBI screening (Phase 5) */
    criticality?: string | null;
    /** Grounded Weibull fit — enables the REAL Monte Carlo What-If (Phase 6) */
    groundedFit?: GroundedRul | null;
    /** RBI → WM link: raise an inspection WO with the due date pre-filled. */
    onScheduleInspection?: (args: { title: string; contextNote: string; dueDate: string }) => void;
}

const RBI_BAND_TONE: Record<string, string> = {
    High: 'bg-red-50 text-red-600 border-red-200',
    'Medium-High': 'bg-amber-50 text-amber-700 border-amber-200',
    Medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    Low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export const DigitalTwinTab: React.FC<DigitalTwinTabProps> = ({
    twinHealth, rulEstimate, selectedAssetId, selectedAssetName, equipmentClass, integrity, criticality, groundedFit, onScheduleInspection,
}) => {
    // RBI-lite (Phase 5): risk screening from measured wall loss × criticality.
    const rbi = equipmentClass?.cls === 'static' ? screenRbi(integrity, criticality) : null;
    return (
        <div className="space-y-6 animate-in fade-in duration-300">

            {/* ═══ Integrity (API 570) — the correct degradation surface for STATIC equipment ═══ */}
            {equipmentClass?.cls === 'static' && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                    <h3 className="text-base font-semibold text-slate-800 mb-1 flex items-center gap-2">
                        <Layers size={18} className="text-blue-500" />
                        Integrity — Wall Thickness (API 570)
                        <span className="text-[10px] font-normal text-slate-400 ml-auto">{selectedAssetName}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                        Static equipment degrades by wall loss, not bearing wear — corrosion rate from successive
                        thickness readings sets the remaining life to minimum required thickness (t-min), and the
                        re-inspection interval (≤ half the remaining life).
                    </p>
                    {integrity ? (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Current Wall</p>
                                    <p className="text-lg font-bold text-slate-800 tabular-nums">{integrity.current}<span className="text-xs text-slate-400 font-medium ml-1">mm</span></p>
                                    {integrity.tMin != null && <p className="text-[10px] text-slate-400 mt-0.5">t-min {integrity.tMin} mm</p>}
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Corrosion Rate</p>
                                    <p className={`text-lg font-bold tabular-nums ${integrity.governingPerYear > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{integrity.governingPerYear}<span className="text-xs text-slate-400 font-medium ml-1">mm/yr</span></p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">governing: {integrity.governingBasis} · LT {integrity.ltcrPerYear} / ST {integrity.stcrPerYear}</p>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Remaining Life</p>
                                    <p className={`text-lg font-bold tabular-nums ${integrity.remainingLifeYears != null && integrity.remainingLifeYears < 2 ? 'text-red-500' : 'text-slate-800'}`}>
                                        {integrity.remainingLifeYears != null ? integrity.remainingLifeYears : '—'}
                                        <span className="text-xs text-slate-400 font-medium ml-1">{integrity.remainingLifeYears != null ? 'years' : ''}</span>
                                    </p>
                                    {integrity.remainingLifeYears == null && <p className="text-[10px] text-amber-600 mt-0.5">{integrity.governingPerYear > 0 ? 'set t-min on the thickness point' : 'no measurable wall loss'}</p>}
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Next Inspection</p>
                                    <p className="text-lg font-bold text-slate-800 tabular-nums">
                                        {integrity.nextInspectionYears != null ? `≤ ${integrity.nextInspectionYears}` : '—'}
                                        <span className="text-xs text-slate-400 font-medium ml-1">{integrity.nextInspectionYears != null ? 'years' : ''}</span>
                                    </p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">API 570: half remaining life</p>
                                </div>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-3">{integrity.note} <span className="text-slate-400">({integrity.n} readings over {integrity.spanYears}y)</span></p>

                            {/* ── RBI-lite risk screening (Phase 5) ── */}
                            {rbi && (
                                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-3 flex-wrap" title={rbi.note}>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Risk screening</span>
                                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${RBI_BAND_TONE[rbi.band]}`}>
                                        {rbi.band} · {rbi.cell}
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                        PoF {rbi.pof}/5 (remaining life) × CoF {rbi.cof}/5 (criticality {(criticality || 'C').toUpperCase()})
                                    </span>
                                    {rbi.nextInspectionDate && (
                                        <span className="flex items-center gap-2 ml-auto">
                                            <span className="text-[11px] text-slate-600 font-medium">
                                                Inspect by {new Date(rbi.nextInspectionDate).toLocaleDateString([], { year: 'numeric', month: 'short' })}
                                            </span>
                                            {onScheduleInspection && (
                                                <button
                                                    onClick={() => onScheduleInspection({
                                                        title: `API 570 thickness inspection — ${selectedAssetName}`,
                                                        contextNote:
                                                            `RBI screening: ${rbi.band} (${rbi.cell}) — PoF ${rbi.pof}/5 from thickness-trend remaining life` +
                                                            `${integrity?.remainingLifeYears != null ? ` (${integrity.remainingLifeYears}y to t-min)` : ''}, ` +
                                                            `CoF ${rbi.cof}/5 from criticality ${(criticality || 'C').toUpperCase()}. ` +
                                                            `Corrosion rate ${integrity?.governingPerYear ?? '—'}/yr (${integrity?.governingBasis ?? '—'}). ` +
                                                            `Due ≤ half remaining life (API 570).`,
                                                        dueDate: rbi.nextInspectionDate!,
                                                    })}
                                                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-primary-600 hover:bg-primary-500 text-white transition-colors"
                                                >
                                                    Schedule inspection
                                                </button>
                                            )}
                                        </span>
                                    )}
                                    <span className="w-full text-[10px] text-slate-400">Screening aid (API 580-inspired) — not a full API 581 damage-factor analysis.</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="border border-dashed border-slate-300 rounded-lg p-5 text-center">
                            <p className="text-sm font-medium text-slate-500">No thickness trend yet</p>
                            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto leading-relaxed">
                                Add a <strong>Wall Thickness</strong> measurement point (Condition Data), set its
                                "Alert below" to the minimum required thickness (t-min), and log UT readings —
                                corrosion rate and remaining life appear after the second reading.
                            </p>
                        </div>
                    )}
                </div>
            )}
            {/* Digital Twin Trajectory Chart */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-lg flex flex-col">
                <div className="p-5 border-b border-slate-200">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                            <HeartPulse className="text-accent-cyan" size={20} />
                            <h3 className="text-lg font-semibold text-slate-800">Digital Twin Trajectory</h3>
                            <span className="text-[10px] font-mono bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-500">T{rulEstimate?.governance_tier}</span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs">
                            <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-accent-cyan mr-1.5" /> Predicted</span>
                            <span className="flex items-center ml-3"><div className="w-2 h-2 rounded-full bg-blue-500/30 mr-1.5" /> 95% Confidence</span>
                            <span className="flex items-center ml-3"><div className="w-2 h-2 rounded-full bg-red-500 mr-1.5" /> Failure Limit</span>
                        </div>
                    </div>
                    <p className="text-xs text-slate-400 mt-2 leading-relaxed">This chart projects the asset's health index forward 30 days. The shaded band shows uncertainty — wider bands = less certainty. If the line approaches the red failure limit, schedule maintenance before it crosses.</p>
                </div>
                <div className="p-5 min-h-[350px]">
                    <TwinHealthChart twinState={twinHealth} />
                </div>
            </div>

            {/* Degradation Models */}
            {twinHealth?.degradation_models && twinHealth.degradation_models.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                    <h3 className="text-base font-semibold text-slate-800 mb-2 flex items-center gap-2">
                        <AlertTriangle size={18} className="text-yellow-500" />
                        Active Degradation Mechanisms
                    </h3>
                    <p className="text-xs text-slate-400 mb-4 leading-relaxed">Indicative wear mechanisms inferred from the health trend — directional, not fitted physics (thickness-based corrosion rates live in the Integrity panel; fitted life models in RUL & Reliability). The bar shows estimated life consumed; projected failure is when damage reaches 100%.</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {twinHealth.degradation_models.map((model, idx) => (
                            <div key={idx} className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-800">{model.mechanism}</p>
                                        <p className="text-xs text-slate-400 mt-0.5">{model.model_type}</p>
                                    </div>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${model.current_damage_pct > 40 ? 'bg-red-500/15 text-red-400' : model.current_damage_pct > 20 ? 'bg-yellow-500/15 text-yellow-500' : 'bg-accent-safe/15 text-accent-safe'}`}>
                                        {model.current_damage_pct.toFixed(1)}%
                                    </span>
                                </div>
                                {/* Progress Bar */}
                                <div className="w-full bg-brand-800 rounded-full h-2 mb-3">
                                    <div
                                        className={`h-2 rounded-full transition-all duration-500 ${model.current_damage_pct > 40 ? 'bg-gradient-to-r from-yellow-500 to-red-500' : model.current_damage_pct > 20 ? 'bg-gradient-to-r from-accent-safe to-yellow-500' : 'bg-accent-safe'}`}
                                        style={{ width: `${Math.min(model.current_damage_pct, 100)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-slate-400">Projected Failure:</span>
                                    <span className="text-brand-200 font-medium">
                                        {new Date(model.projected_failure_date || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* What-If Scenario Explorer — real Monte Carlo when a fitted life model exists */}
            <ScenarioSimulator assetId={selectedAssetId} assetName={selectedAssetName} groundedFit={groundedFit} equipmentClass={equipmentClass} />

            {/* Vision Thermal Anomalies Feed */}
            <VisionThermalFeed assetId={selectedAssetId} assetName={selectedAssetName} />
        </div>
    );
};
