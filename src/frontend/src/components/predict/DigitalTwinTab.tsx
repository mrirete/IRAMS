import React from 'react';
import { HeartPulse, AlertTriangle } from 'lucide-react';
import { TwinHealthChart } from './TwinHealthChart';
import { ScenarioSimulator } from './ScenarioSimulator';
import { VisionThermalFeed } from './VisionThermalFeed';
import type { TwinState, RULEstimate } from '../../types/intelligence';

interface DigitalTwinTabProps {
    twinHealth: TwinState | null;
    rulEstimate: RULEstimate | null;
    selectedAssetId: string;
    selectedAssetName: string;
}

export const DigitalTwinTab: React.FC<DigitalTwinTabProps> = ({
    twinHealth, rulEstimate, selectedAssetId, selectedAssetName,
}) => {
    return (
        <div className="space-y-6 animate-in fade-in duration-300">
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
                    <p className="text-xs text-slate-400 mb-4 leading-relaxed">Physics-based wear models (corrosion, bearing wear, fatigue). The bar shows how much of the component's life has been consumed. Projected failure date is when damage reaches 100%.</p>
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

            {/* What-If Scenario Simulator */}
            <ScenarioSimulator assetId={selectedAssetId} assetName={selectedAssetName} />

            {/* Vision Thermal Anomalies Feed */}
            <VisionThermalFeed assetId={selectedAssetId} assetName={selectedAssetName} />
        </div>
    );
};
