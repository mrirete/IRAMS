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
 *
 * A saved capture that screens "investigate" opens an alert on its point
 * (PredictionService.raiseCaptureAlert), so a route finding reaches the
 * Forecast tab's queue by itself. History trends the chosen point's captures.
 *
 * Per-capture inputs only. The asset's rated speed, bearings and load tag are
 * Monitoring setup (MonitoringSetup.tsx, explicit Save) and arrive as props.
 * The Model tab keys this panel by asset, so switching asset starts clean —
 * it used to keep the previous asset's spectrum and speed, and Save capture
 * would have filed that waveform against the new asset.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { AudioWaveform, Play, Save, Clock, FlaskConical } from 'lucide-react';
import {
    analyzeWaveform, parseWaveformText, decimateForPlot, demoBearingSignal,
    type SpectralAnalysis,
} from '../../lib/predict/spectral';
import { predictionService, type WaveformCapture, type AssetPredictConfig, type MeasurementPointOption } from '../../eam/services/PredictionService';
import { sensorKind } from '../../lib/predict/healthModels';
import { captureTrend, samePoint, MIN_TREND_CAPTURES, type TrendVerdict } from '../../lib/predict/vibrationCaptures';

interface Props {
    assetId: string;
    assetName: string;
    currentUser?: string | null;
    /** Saved Monitoring setup — rated speed and bearing specs. */
    config: AssetPredictConfig | null;
    /** A saved capture opened an alert — the page refreshes its alert queue. */
    onAlertRaised?: () => void;
}

/** Vibration points first (by name or unit); the rest stay pickable. */
const isVibPoint = (p: MeasurementPointOption) => sensorKind(p.name, p.unit) === 'vibration';
const OTHER = '__other__';

const TONE_STYLES: Record<string, string> = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    watch: 'bg-amber-50 text-amber-700 border-amber-200',
    investigate: 'bg-red-50 text-red-600 border-red-200',
};

const VERDICT_TONE: Record<TrendVerdict, string> = {
    growing: 'bg-red-50 text-red-600 border-red-200',
    steady: 'bg-slate-50 text-slate-600 border-slate-200',
    falling: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const fmt = (v: number | null) => (v == null ? '—' : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : String(Number(v.toPrecision(2))));

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

export const SpectralAnalysisPanel: React.FC<Props> = ({ assetId, assetName, currentUser, config, onAlertRaised }) => {
    const [rawText, setRawText] = useState('');
    const [fs, setFs] = useState('5120');
    const [rpm, setRpm] = useState('');
    // Measurement point the capture belongs to — picked from the asset's points.
    const [points, setPoints] = useState<MeasurementPointOption[] | null>(null);
    const [pointSel, setPointSel] = useState('');
    const [otherName, setOtherName] = useState('');
    const [analysis, setAnalysis] = useState<SpectralAnalysis | null>(null);
    const [samples, setSamples] = useState<number[]>([]);
    const [isDemo, setIsDemo] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedMsg, setSavedMsg] = useState<{ text: string; tone: 'ok' | 'alert' | 'warn' } | null>(null);
    const [history, setHistory] = useState<WaveformCapture[] | null>(null);
    const bearings = config?.bearings ?? [];

    // Speed during capture defaults to the saved rated speed (editable per capture).
    const ratedRpm = config?.rated_rpm ?? null;
    useEffect(() => { if (ratedRpm) setRpm(prev => (prev.trim() ? prev : String(ratedRpm))); }, [ratedRpm]);

    useEffect(() => {
        let alive = true;
        // Defined measurement points, plus live-feed tags with no definition yet.
        Promise.all([predictionService.getMeasurementPoints(assetId), predictionService.getLiveTags(assetId)]).then(([defs, live]) => {
            if (!alive) return;
            const known = new Set(defs.flatMap(d => [d.name, d.sensor_tag].filter(Boolean).map(v => String(v).toLowerCase())));
            const list: MeasurementPointOption[] = [
                ...defs,
                ...live.filter(t => !known.has(t.tag.toLowerCase())).map(t => ({ id: `live:${t.tag}`, name: t.tag, unit: t.unit || null, sensor_tag: t.tag })),
            ];
            const sorted = [...list].sort((a, b) => Number(isVibPoint(b)) - Number(isVibPoint(a)));
            setPoints(sorted);
            setPointSel(sorted.find(isVibPoint)?.id ?? OTHER);
        });
        return () => { alive = false; };
    }, [assetId]);
    const tag = pointSel === OTHER ? otherName.trim() : (points?.find(p => p.id === pointSel)?.name ?? '');

    const run = (values: number[], demo: boolean) => {
        setError(null);
        setSavedMsg(null);
        try {
            const a = analyzeWaveform(values, Number(fs), rpm.trim() ? Number(rpm) : null, bearings);
            setSamples(values);
            setAnalysis(a);
            setIsDemo(demo);
        } catch (e: any) {
            setAnalysis(null);
            setError(e.message || 'Analysis failed');
        }
    };

    const sampleCount = useMemo(() => (rawText.trim() ? parseWaveformText(rawText).length : 0), [rawText]);
    const handleAnalyze = () => run(parseWaveformText(rawText), false);
    const handleDemo = () => {
        setFs('5120');
        setRpm('1480');
        run(demoBearingSignal({ rpm: 1480 }), true);
    };

    const handleSave = async () => {
        if (!analysis || isDemo || !tag) return;
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
                bearingFaults: analysis.bearingFaults,
                bearingMatches: analysis.bearingMatches,
            },
            created_by: currentUser ?? null,
        });
        if (!saved) {
            setSaving(false);
            setSavedMsg({ text: 'Save failed — apply migration 0206 (ers_waveforms) first', tone: 'warn' });
            return;
        }
        const r = await predictionService.raiseCaptureAlert(saved);
        setSaving(false);
        if (r.kind === 'raised') {
            setSavedMsg({ text: `Capture saved. It opened a ${r.severity} alert on ${tag} — work it from Forecast › Alerts.`, tone: 'alert' });
            onAlertRaised?.();
        } else if (r.kind === 'covered') {
            setSavedMsg({ text: `Capture saved. An alert on ${r.point} is already open, so no second one.`, tone: 'ok' });
        } else if (r.kind === 'failed') {
            setSavedMsg({ text: `Capture saved, but the alert was not raised: ${r.message}`, tone: 'warn' });
        } else {
            setSavedMsg({
                text: r.severity === 'watch'
                    ? 'Capture saved. A watch finding does not raise an alert. The next capture on this point shows whether it is growing.'
                    : 'Capture saved. No fault signature.',
                tone: 'ok',
            });
        }
        if (history) setHistory(await predictionService.getWaveforms(assetId, 30));
    };

    const loadHistory = async () => setHistory(await predictionService.getWaveforms(assetId, 30));
    const trend = useMemo(() => (history && tag ? captureTrend(history, tag) : null), [history, tag]);

    const specPlot = useMemo(() => analysis ? decimateForPlot(analysis.spectrum) : [], [analysis]);
    const envPlot = useMemo(
        () => analysis ? decimateForPlot(analysis.envelope, 400, Math.min(500, analysis.sampleRateHz / 2)) : [],
        [analysis],
    );

    return (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
            <h3 className="text-base font-semibold text-slate-800 mb-1 flex items-center flex-wrap gap-x-2 gap-y-0.5">
                <AudioWaveform size={18} className="text-primary-500" />
                Vibration spectrum
                <span className="text-[10px] font-normal text-slate-400 w-full sm:w-auto sm:ml-auto">{assetName}</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Paste a vibration waveform to see its spectrum. It flags imbalance, misalignment and bearing
                defects. Findings are screening hints for an analyst (ISO 13373), not verdicts.
            </p>

            {/* Capture inputs — fixed widths; the asset's speed and bearings come from Monitoring setup */}
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 items-start">
                <div className="min-w-0">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Measurement point</label>
                    <select value={pointSel} onChange={e => setPointSel(e.target.value)} disabled={points === null}
                        className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm bg-white focus:border-primary-400 focus:outline-none">
                        {points?.map(p => (
                            <option key={p.id} value={p.id}>{p.name}{p.unit && !p.name.includes(p.unit) ? ` (${p.unit})` : ''}{isVibPoint(p) ? '' : ' — not vibration'}</option>
                        ))}
                        <option value={OTHER}>Other — name it…</option>
                    </select>
                    {pointSel === OTHER && (
                        <input type="text" value={otherName} onChange={e => setOtherName(e.target.value)} placeholder="e.g. Vibration — NDE bearing"
                            className="w-full mt-1.5 p-2 border border-slate-200 rounded-lg text-sm focus:border-primary-400 focus:outline-none" />
                    )}
                </div>
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sample rate (Hz)</label>
                    <input type="number" value={fs} onChange={e => setFs(e.target.value)}
                        className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm focus:border-primary-400 focus:outline-none" />
                </div>
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider" title="Shaft speed while this waveform was recorded — defaults to the rated speed from Monitoring setup">Speed (rpm)</label>
                    <input type="number" value={rpm} onChange={e => setRpm(e.target.value)} placeholder={ratedRpm ? String(ratedRpm) : 'optional'}
                        className="w-full mt-1 p-2 border border-slate-200 rounded-lg text-sm focus:border-primary-400 focus:outline-none" />
                </div>
            </div>
            <div className="mt-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Waveform samples</label>
                <textarea
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                    rows={6}
                    placeholder={'0.012\n-0.034\n0.051\n…\nor  0.012, -0.034, 0.051, …\nor  time,value rows'}
                    className="w-full mt-1 p-2.5 border border-slate-200 rounded-lg text-xs font-mono resize-none focus:border-primary-400 focus:outline-none"
                />
                {/* What the parser actually read — the format question answers itself. */}
                <p className={`text-[10px] mt-0.5 ${sampleCount > 0 && sampleCount < 64 ? 'text-amber-700' : 'text-slate-400'}`}>
                    {sampleCount === 0
                        ? 'Readings evenly spaced at the sample rate, any unit (g, mm/s). At least 64 values. Header lines are skipped.'
                        : `${sampleCount.toLocaleString()} values read · ${(sampleCount / (Number(fs) || 1)).toFixed(2)} s at ${Number(fs) || '?'} Hz${sampleCount < 64 ? ' · need at least 64' : ''}`}
                </p>
                <p className="text-[10px] text-slate-400">
                    {bearings.length > 0
                        ? `${bearings.length} bearing${bearings.length !== 1 ? 's' : ''} from Monitoring setup will name defect tones.`
                        : 'Add bearings in Monitoring setup to name defect tones.'}
                </p>
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
                    <button onClick={handleSave} disabled={saving || !tag} title={tag ? `Save to ${tag}` : 'Name the measurement point first'}
                        className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors ml-auto">
                        <Save size={13} /> {saving ? 'Saving…' : 'Save capture'}
                    </button>
                )}
            </div>

            {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
            {savedMsg && (
                <p className={`text-xs mt-2 ${savedMsg.tone === 'alert' ? 'text-red-600 font-semibold' : savedMsg.tone === 'warn' ? 'text-amber-700' : 'text-emerald-700'}`}>{savedMsg.text}</p>
            )}

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

                    {/* Expected bearing defect frequencies at this shaft speed */}
                    {analysis.bearingFaults.length > 0 && (
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px]">
                            <p className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-1.5">
                                Expected defect frequencies @ {analysis.rpm} RPM
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {analysis.bearingFaults.map((f, i) => (
                                    <span key={i} className="px-2 py-0.5 bg-white border border-slate-200 rounded-md font-mono">
                                        {[f.designation, f.position].filter(Boolean).join(' ')}: BPFO {f.hz.bpfo} · BPFI {f.hz.bpfi}
                                        {f.hz.bsf != null ? ` · BSF ${f.hz.bsf}` : ''}{f.hz.ftf != null ? ` · FTF ${f.hz.ftf}` : ''} Hz
                                        {f.basis === 'approximate' ? ' (approx)' : ''}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

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
                    {trend && (
                        <div className="mb-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Trend on {tag}</p>
                            {trend.points.length < MIN_TREND_CAPTURES ? (
                                <p className="text-xs text-slate-400">
                                    {trend.points.length} capture{trend.points.length !== 1 ? 's' : ''} on this point. The trend starts at {MIN_TREND_CAPTURES}.
                                </p>
                            ) : (
                                <>
                                    <div className="space-y-1">
                                        {([['kurtosis', 'Kurtosis'], ['rms', 'RMS'], ['toneAmp', 'Bearing tone']] as const).map(([k, label]) => {
                                            const vals = trend.points.map(p => p[k]).filter((v): v is number => v != null);
                                            if (vals.length === 0) return null;
                                            const v = trend.verdicts[k];
                                            return (
                                                <div key={k} className="flex items-center gap-2 text-xs min-w-0">
                                                    <span className="w-24 shrink-0 text-slate-500">{label}</span>
                                                    <span className="font-mono text-slate-700 truncate min-w-0">{vals.slice(-5).map(fmt).join(' → ')}</span>
                                                    {v && <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-bold ${VERDICT_TONE[v]}`}>{v === 'growing' ? 'Growing' : v === 'falling' ? 'Falling' : 'Steady'}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">Latest capture against the median of the earlier ones. Growing = 25% or more above it.</p>
                                </>
                            )}
                        </div>
                    )}
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Saved captures</p>
                    {history.length === 0 ? (
                        <p className="text-xs text-slate-400 italic">No saved captures for this asset yet.</p>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {history.map(h => {
                                const d = h.features?.diagnosis;
                                return (
                                    <div key={h.id} className={`flex items-center gap-3 py-2 text-xs ${tag && !samePoint(h.tag, tag) ? 'opacity-60' : ''}`}>
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
