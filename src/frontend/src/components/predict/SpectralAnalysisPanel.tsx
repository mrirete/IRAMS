/**
 * SpectralAnalysisPanel — ISO 13374 DM layer for rotating equipment.
 *
 * Paste/upload a vibration time-waveform (bare values or time,value CSV),
 * give the sample rate (+ optional RPM), and get: time-domain condition
 * indicators, the Hann-windowed amplitude spectrum, the envelope
 * (demodulated) spectrum, and screening-grade diagnosis findings.
 *
 * Captures persist to ers_waveforms (0206) so a history builds per asset;
 * when an online waveform feed lands, it writes the same table and this
 * panel needs nothing new.
 */
import React, { useMemo, useState } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { AudioWaveform, Play, Save, Clock, FlaskConical } from 'lucide-react';
import {
    analyzeWaveform, parseWaveformText, decimateForPlot, demoBearingSignal,
    type SpectralAnalysis,
} from '../../lib/predict/spectral';
import { predictionService, type WaveformCapture } from '../../eam/services/PredictionService';

interface Props {
    assetId: string;
    assetName: string;
    currentUser?: string | null;
}

const TONE_STYLES: Record<string, string> = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    watch: 'bg-amber-50 text-amber-700 border-amber-200',
    investigate: 'bg-red-50 text-red-600 border-red-200',
};

const Chip: React.FC<{ label: string; value: string; hint?: string; alarm?: boolean }> = ({ label, value, hint, alarm }) => (
    <div className={`rounded-lg border p-2.5 ${alarm ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`} title={hint}>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className={`text-base font-bold tabular-nums ${alarm ? 'text-amber-700' : 'text-slate-800'}`}>{value}</p>
    </div>
);

const SpectrumChart: React.FC<{ data: { freqHz: number; amp: number }[]; color: string; title: string; sub: string }> = ({ data, color, title, sub }) => (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-700">{title}</p>
        <p className="text-[10px] text-slate-400 mb-1">{sub}</p>
        <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="freqHz" tick={{ fontSize: 9 }} unit=" Hz" minTickGap={40} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip formatter={(v: any) => [Number(v).toFixed(4), 'amplitude']} labelFormatter={(l: any) => `${l} Hz`} contentStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="amp" stroke={color} dot={false} strokeWidth={1.2} isAnimationActive={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    </div>
);

export const SpectralAnalysisPanel: React.FC<Props> = ({ assetId, assetName, currentUser }) => {
    const [rawText, setRawText] = useState('');
    const [fs, setFs] = useState('5120');
    const [rpm, setRpm] = useState('');
    const [tag, setTag] = useState('Vibration — NDE bearing');
    const [analysis, setAnalysis] = useState<SpectralAnalysis | null>(null);
    const [samples, setSamples] = useState<number[]>([]);
    const [isDemo, setIsDemo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedMsg, setSavedMsg] = useState<string | null>(null);
    const [history, setHistory] = useState<WaveformCapture[] | null>(null);

    const run = (values: number[], demo: boolean) => {
        setError(null);
        setSavedMsg(null);
        try {
            const a = analyzeWaveform(values, Number(fs), rpm.trim() ? Number(rpm) : null);
            setSamples(values);
            setAnalysis(a);
            setIsDemo(demo);
        } catch (e: any) {
            setAnalysis(null);
            setError(e.message || 'Analysis failed');
        }
    };

    const handleAnalyze = () => run(parseWaveformText(rawText), false);
    const handleDemo = () => {
        setFs('5120');
        setRpm('1480');
        run(demoBearingSignal({ rpm: 1480 }), true);
    };

    const handleSave = async () => {
        if (!analysis || isDemo) return;
        setSaving(true);
        const saved = await predictionService.saveWaveform({
            asset_id: assetId,
            tag,
            sample_rate_hz: analysis.sampleRateHz,
            rpm: analysis.rpm,
            samples,
            features: {
                n: analysis.time.n,
                time: analysis.time,
                specPeaks: analysis.specPeaks,
                envPeaks: analysis.envPeaks,
                diagnosis: analysis.diagnosis,
            },
            created_by: currentUser ?? null,
        });
        setSaving(false);
        setSavedMsg(saved ? 'Capture saved — feature history builds per asset ✓' : 'Save failed — apply migration 0206 (ers_waveforms) first');
    };

    const loadHistory = async () => setHistory(await predictionService.getWaveforms(assetId));

    const specPlot = useMemo(() => analysis ? decimateForPlot(analysis.spectrum) : [], [analysis]);
    const envPlot = useMemo(
        () => analysis ? decimateForPlot(analysis.envelope, 400, Math.min(500, analysis.sampleRateHz / 2)) : [],
        [analysis],
    );

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <h3 className="text-base font-semibold text-slate-800 mb-1 flex items-center gap-2">
                <AudioWaveform size={18} className="text-primary-500" />
                Spectral Analysis — Vibration Waveform (DM layer)
                <span className="text-[10px] font-normal text-slate-400 ml-auto">{assetName}</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                FFT + envelope demodulation on a time-waveform: 1×/2× lines flag imbalance and misalignment;
                impulsive kurtosis with an envelope tone flags rolling-element bearing defects. Screening aid
                (ISO 13373-style) — findings are candidates for an analyst, not verdicts.
            </p>

            {/* Inputs */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Waveform samples</label>
                    <textarea
                        value={rawText}
                        onChange={e => setRawText(e.target.value)}
                        rows={4}
                        placeholder={'Paste values (one per line or comma-separated), or time,value CSV rows.\nMost analyzers and data collectors export this directly.'}
                        className="w-full mt-1 p-2.5 border border-slate-200 rounded-lg text-xs font-mono resize-none focus:border-primary-400 focus:outline-none"
                    />
                </div>
                <div className="space-y-2">
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sample rate (Hz)</label>
                        <input type="number" value={fs} onChange={e => setFs(e.target.value)}
                            className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm focus:border-primary-400 focus:outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Running speed (RPM, optional)</label>
                        <input type="number" value={rpm} onChange={e => setRpm(e.target.value)} placeholder="enables 1×/2× order checks"
                            className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm focus:border-primary-400 focus:outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Point / tag</label>
                        <input type="text" value={tag} onChange={e => setTag(e.target.value)}
                            className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm focus:border-primary-400 focus:outline-none" />
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button onClick={handleAnalyze} disabled={!rawText.trim() || !Number(fs)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors">
                    <Play size={13} /> Analyze
                </button>
                <button onClick={handleDemo}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors"
                    title="Synthetic signal: 1× line + bearing-style impact train — exercises the full pipeline">
                    <FlaskConical size={13} /> Demo signal (synthetic)
                </button>
                <button onClick={loadHistory}
                    className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors">
                    <Clock size={13} /> History
                </button>
                {analysis && !isDemo && (
                    <button onClick={handleSave} disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors ml-auto">
                        <Save size={13} /> {saving ? 'Saving…' : 'Save capture'}
                    </button>
                )}
            </div>

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            {savedMsg && <p className="text-xs text-emerald-700 mt-2">{savedMsg}</p>}

            {/* Results */}
            {analysis && (
                <div className="mt-4 space-y-4">
                    {isDemo && (
                        <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-[11px] text-blue-700">
                            Synthetic demo signal — illustrates the pipeline; not data from {assetName}. Saving is disabled.
                        </div>
                    )}

                    {/* Time-domain condition indicators */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Chip label="RMS" value={String(analysis.time.rms)} hint="AC-coupled RMS of the capture" />
                        <Chip label="Peak" value={String(analysis.time.peak)} />
                        <Chip label="Crest factor" value={String(analysis.time.crest)} hint="peak ÷ RMS — impacting when > ~5" alarm={analysis.time.crest > 5} />
                        <Chip label="Kurtosis" value={String(analysis.time.kurtosis)} hint="3 = Gaussian; > ~4 = impulsive (bearing/gear impacts)" alarm={analysis.time.kurtosis > 4} />
                    </div>

                    {/* Spectra */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <SpectrumChart data={specPlot} color="#0ea5e9" title="Amplitude spectrum"
                            sub={`Hann window · ${analysis.spectrum.df.toFixed(2)} Hz/bin · ${analysis.time.n.toLocaleString()} samples`} />
                        <SpectrumChart data={envPlot} color="#8b5cf6" title="Envelope spectrum (demodulated)"
                            sub="Hilbert-transform envelope — bearing/gear repetition frequencies appear here" />
                    </div>

                    {/* Peaks */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-[11px]">
                        {[{ title: 'Spectrum peaks', peaks: analysis.specPeaks }, { title: 'Envelope tones', peaks: analysis.envPeaks }].map(g => (
                            <div key={g.title} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                <p className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-1.5">{g.title}</p>
                                {g.peaks.length === 0 ? <p className="text-slate-400 italic">None above the noise floor</p> : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {g.peaks.map((p, i) => (
                                            <span key={i} className="px-2 py-0.5 bg-white border border-slate-200 rounded-md font-mono">
                                                {p.freqHz} Hz{p.order != null ? ` · ${p.order}×` : ''}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Diagnosis */}
                    <div className="space-y-2">
                        {analysis.diagnosis.findings.map((f, i) => (
                            <div key={i} className={`px-3 py-2.5 rounded-lg border ${TONE_STYLES[f.tone]}`}>
                                <p className="text-xs font-bold">{f.label}</p>
                                <p className="text-[11px] mt-0.5 leading-relaxed opacity-90">{f.detail}</p>
                            </div>
                        ))}
                        <p className="text-[10px] text-slate-400">Screening heuristics only — confirm findings with a vibration analyst before condemning components.</p>
                    </div>
                </div>
            )}

            {/* Capture history */}
            {history && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Saved captures</p>
                    {history.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No saved captures for this asset yet.</p>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {history.map(h => {
                                const d = h.features?.diagnosis;
                                return (
                                    <div key={h.id} className="flex items-center gap-3 py-2 text-xs">
                                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold shrink-0 ${TONE_STYLES[d?.severity || 'ok']}`}>
                                            {(d?.severity || 'ok').toUpperCase()}
                                        </span>
                                        <span className="font-medium text-slate-700 truncate">{h.tag}</span>
                                        <span className="text-slate-400 shrink-0">
                                            kurt {h.features?.time?.kurtosis ?? '—'} · {new Date(h.captured_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SpectralAnalysisPanel;
