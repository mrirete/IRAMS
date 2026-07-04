import React, { useState } from 'react';
import { Camera, Brain, AlertTriangle, CheckCircle, Image, Plus, X, Eye, Scan, Thermometer, Tag, Shield, Wrench } from 'lucide-react';
import { useStrategy } from '../hooks/useStrategy';
import { useAssetLookup } from '../hooks/useAssetLookup';
import { agentService } from '../eam/services/AgentService';
import { visionService } from '../eam/services/VisionService';
import type { VisionResult, AnalysisType, VisionSeverity } from '../types/strategy';
import { ImageCapture } from '../eam/components/ui/ImageCapture';

export const VisionPage: React.FC = () => {
    const { visionResults, droneSurveys, addVisionResult } = useStrategy();
    const { assetOptions } = useAssetLookup();
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ image_name: '', analysis_type: 'corrosion' as AnalysisType, asset_id: '', detected_items: '', max_severity: 'minor' as VisionSeverity });
    const [draftingId, setDraftingId] = useState<string | null>(null);
    const [draftMessage, setDraftMessage] = useState<string | null>(null);

    const handleSubmit = () => {
        if (!form.image_name || !form.asset_id) return;
        const v: VisionResult = {
            id: `vis-${Date.now()}`, image_name: form.image_name,
            analysis_type: form.analysis_type, detected_items: parseInt(form.detected_items) || 0,
            max_severity: form.max_severity, timestamp: new Date().toISOString(),
            asset_id: form.asset_id, reviewed: false,
        };
        addVisionResult(v);
        setForm({ image_name: '', analysis_type: 'corrosion', asset_id: '', detected_items: '', max_severity: 'minor' });
        setShowNew(false);
    };

    const unreviewed = visionResults.filter(v => !v.reviewed).length;

    const handleDraftWR = async (finding: VisionResult) => {
        setDraftingId(finding.id);
        setDraftMessage(null);
        try {
            const asset = assetOptions.find(a => a.id === finding.asset_id);
            const result = await agentService.draftWorkOrderFromVisionFinding(finding, {
                assetName: asset?.name || finding.asset_id,
                assetTag: asset?.tag,
            });
            setDraftMessage(result.message);
        } catch {
            setDraftMessage('Failed to draft WR — check Agent Review Panel for details.');
        }
        setTimeout(() => setDraftingId(null), 500);
    };

    const severityConfig: Record<string, { text: string; bg: string; border: string }> = {
        critical: { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
        severe: { text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
        moderate: { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
        minor: { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    };
    const typeConfig: Record<string, { text: string; bg: string; border: string; icon: React.ReactNode }> = {
        corrosion: { text: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', icon: <Shield size={12} /> },
        thermal: { text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: <Thermometer size={12} /> },
        condition: { text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', icon: <Eye size={12} /> },
        tagging: { text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', icon: <Tag size={12} /> },
    };
    const getSeverity = (s: string) => severityConfig[s] || severityConfig.minor;
    const getType = (t: string) => typeConfig[t] || typeConfig.condition;

    return (
        <div className="space-y-6 pb-20 animate-in fade-in duration-500">
            {/* ── Page Header ─────────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-8 rounded-full bg-gradient-to-b from-blue-500 to-blue-500" />
                        <h1 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight">Computer Vision</h1>
                    </div>
                    <p className="text-slate-500 text-xs sm:text-sm mt-1.5 ml-4">AI-powered visual inspection, drone surveys, and anomaly detection</p>
                </div>
                <button
                    onClick={() => setShowNew(true)}
                    className="flex items-center gap-2 px-4 sm:px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white font-semibold rounded-xl text-xs sm:text-sm transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30"
                >
                    <Plus size={15} /> Upload Analysis
                </button>
            </div>

            {/* ── KPI Cards ───────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
                <KpiCard label="Total Results" value={visionResults.length} icon={Scan} gradient="from-blue-500 to-primary-500" />
                <KpiCard label="Unreviewed" value={unreviewed} icon={AlertTriangle} gradient="from-amber-500 to-orange-500" />
                <KpiCard label="Critical Detections" value={visionResults.filter(v => v.max_severity === 'critical').length} icon={AlertTriangle} gradient="from-red-500 to-rose-500" />
                <KpiCard label="Drone Surveys" value={droneSurveys.length} icon={Image} gradient="from-blue-500 to-blue-500" />
            </div>

            {/* ── HITL Alert ──────────────────────────────── */}
            {unreviewed > 0 && (
                <div className="bg-gradient-to-r from-blue-50 to-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg shrink-0">
                        <Brain className="text-blue-600" size={18} />
                    </div>
                    <div>
                        <p className="text-blue-800 text-sm font-semibold">{unreviewed} AI vision result(s) pending human review</p>
                        <p className="text-blue-600/70 text-xs mt-1">All AI-generated detections are <strong>Tier 2 advisory</strong>. Critical findings require inspector verification before work order generation.</p>
                    </div>
                </div>
            )}

            {/* ── Vision Analysis Results Gallery ──────────── */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-1 h-4 rounded-full bg-gradient-to-b from-blue-500 to-blue-500" />
                    <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Vision Analysis Results</h3>
                    <span className="ml-auto text-xs text-slate-400">{visionResults.length} total</span>
                </div>
                {visionResults.length === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
                        <Camera size={40} className="mx-auto text-slate-300 mb-3" />
                        <p className="text-sm font-medium text-slate-500">No vision analyses yet</p>
                        <p className="text-xs text-slate-400 mt-1">Upload an image to begin AI-powered inspection</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {visionResults.map(v => {
                            const sev = getSeverity(v.max_severity);
                            const typ = getType(v.analysis_type);
                            return (
                                <div key={v.id} className={`group bg-white border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 ${v.reviewed ? 'border-slate-200' : `${sev.border} ring-1 ring-offset-1 ring-amber-200/50`}`}>
                                    {/* Image placeholder */}
                                    <div className="h-36 bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center relative overflow-hidden">
                                        <Camera className="text-slate-300 group-hover:scale-110 transition-transform duration-300" size={36} />
                                        {!v.reviewed && (
                                            <span className="absolute top-3 right-3 text-[10px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shadow-sm">
                                                Pending Review
                                            </span>
                                        )}
                                        {v.reviewed && (
                                            <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shadow-sm">
                                                <CheckCircle size={10} /> Reviewed
                                            </span>
                                        )}
                                    </div>
                                    {/* Details */}
                                    <div className="p-4">
                                        <p className="text-sm font-semibold text-slate-800 truncate mb-2">{v.image_name}</p>
                                        <div className="flex items-center gap-2 mb-3">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md border capitalize ${typ.text} ${typ.bg} ${typ.border}`}>
                                                {typ.icon} {v.analysis_type}
                                            </span>
                                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border capitalize ${sev.text} ${sev.bg} ${sev.border}`}>
                                                {v.max_severity}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-slate-600 font-medium">{v.detected_items} item(s) detected</span>
                                            <span className="text-slate-400 font-mono text-[10px]">{new Date(v.timestamp).toLocaleDateString()}</span>
                                        </div>
                                        {/* Draft WR Action — HITL governed */}
                                        {visionService.isWRDraftEligible(v.max_severity) && (
                                            <button
                                                onClick={() => handleDraftWR(v)}
                                                disabled={draftingId === v.id}
                                                className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                                                title="Draft a Work Request from this finding (requires HITL approval)"
                                            >
                                                {draftingId === v.id
                                                    ? <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                                    : <Wrench size={12} />
                                                }
                                                Draft Work Request
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Agent Draft Response ───────────────────── */}
            {draftMessage && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 flex items-center justify-between animate-in fade-in duration-300">
                    <div className="flex items-center gap-2 text-sm text-blue-700">
                        <Brain size={16} className="text-blue-500 shrink-0" />
                        <span><span className="font-semibold">Agent:</span> {draftMessage}</span>
                    </div>
                    <button onClick={() => setDraftMessage(null)} className="text-blue-400 hover:text-blue-600 transition-colors">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* ── Drone Surveys ────────────────────────────── */}
            <div>
                <div className="flex items-center gap-2 mb-3">
                    <div className="w-1 h-4 rounded-full bg-gradient-to-b from-blue-400 to-primary-400" />
                    <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Drone Surveys</h3>
                    <span className="ml-auto text-xs text-slate-400">{droneSurveys.length} total</span>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    <table className="w-full text-sm text-left">
                        <thead>
                            <tr className="bg-gradient-to-r from-slate-50 to-slate-100/50 border-b border-slate-200">
                                <th className="px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Survey</th>
                                <th className="px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                                <th className="px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right">Area (m²)</th>
                                <th className="px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider text-right">Anomalies</th>
                                <th className="px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {droneSurveys.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">No drone surveys recorded yet</td>
                                </tr>
                            ) : droneSurveys.map(d => (
                                <tr key={d.id} className="hover:bg-slate-50/80 transition-colors">
                                    <td className="px-5 py-3.5 text-slate-800 font-medium">{d.survey_name}</td>
                                    <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{new Date(d.date).toLocaleDateString()}</td>
                                    <td className="px-5 py-3.5 text-right font-mono text-slate-600">{d.area_covered_sqm.toLocaleString()}</td>
                                    <td className="px-5 py-3.5 text-right">
                                        <span className={`font-mono font-semibold ${d.anomalies_found > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                            {d.anomalies_found}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3.5">
                                        {d.reviewed
                                            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"><CheckCircle size={10} /> Reviewed</span>
                                            : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"><AlertTriangle size={10} /> Pending</span>
                                        }
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Upload Modal ─────────────────────────────── */}
            {showNew && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowNew(false)}>
                    <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg mx-4 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-gradient-to-br from-blue-500 to-blue-500 rounded-xl text-white shadow-lg shadow-blue-500/20">
                                    <Camera size={18} />
                                </div>
                                <div>
                                    <h2 className="text-base font-bold text-slate-800">Upload Vision Analysis</h2>
                                    <p className="text-[11px] text-slate-400 mt-0.5">Submit an image for AI-powered inspection</p>
                                </div>
                            </div>
                            <button onClick={() => setShowNew(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"><X size={18} /></button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Capture / Upload Image</label>
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                                    <ImageCapture
                                        bucket="assets"
                                        prefix="vision_"
                                        currentImage={undefined}
                                        onImageCaptured={(url) => setForm(f => ({ ...f, image_name: url.split('/').pop() || `vision_${Date.now()}.jpg` }))}
                                        shape="square"
                                        size="md"
                                        placeholder={<><Camera size={24} className="mb-2 text-slate-400" /><span className="text-sm font-medium text-slate-400">Take Photo or Upload</span></>}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Image / File Name</label>
                                <input type="text" value={form.image_name} onChange={e => setForm(f => ({ ...f, image_name: e.target.value }))} placeholder="e.g. V205_shell_12oclock.jpg" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-all" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Analysis Type</label>
                                    <select value={form.analysis_type} onChange={e => setForm(f => ({ ...f, analysis_type: e.target.value as AnalysisType }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-all">
                                        <option value="corrosion">Corrosion</option><option value="thermal">Thermal</option><option value="condition">Condition</option><option value="tagging">Tagging / OCR</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Target Asset</label>
                                    <select value={form.asset_id} onChange={e => setForm(f => ({ ...f, asset_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-all">
                                        <option value="">Select asset…</option>{assetOptions.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Detected Items</label>
                                    <input type="number" min="0" value={form.detected_items} onChange={e => setForm(f => ({ ...f, detected_items: e.target.value }))} placeholder="0" className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-all" />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Max Severity</label>
                                    <select value={form.max_severity} onChange={e => setForm(f => ({ ...f, max_severity: e.target.value as VisionSeverity }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-all">
                                        <option value="minor">Minor</option><option value="moderate">Moderate</option><option value="severe">Severe</option><option value="critical">Critical</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="p-5 border-t border-slate-100 flex justify-end gap-3">
                            <button onClick={() => setShowNew(false)} className="px-4 py-2.5 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-xl transition-all">Cancel</button>
                            <button onClick={handleSubmit} disabled={!form.image_name || !form.asset_id} className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-600 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/25">Submit for Analysis</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ── KPI Card Component ───────────────────────── */
function KpiCard({ label, value, icon: Icon, gradient }: { label: string; value: number; icon: React.FC<{ size?: number; className?: string }>; gradient: string }) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-all duration-300 group">
            <div className="flex items-center gap-3 sm:gap-4">
                <div className={`p-2.5 sm:p-3 rounded-xl bg-gradient-to-br ${gradient} text-white shadow-lg group-hover:scale-105 transition-transform duration-300`}>
                    <Icon size={20} />
                </div>
                <div>
                    <p className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider font-semibold">{label}</p>
                    <h3 className="text-xl sm:text-2xl font-bold text-slate-800 tracking-tight mt-0.5">{value}</h3>
                </div>
            </div>
        </div>
    );
}
