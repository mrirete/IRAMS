/**
 * ImportReadingsModal — the first *real* connector: a CSV/historian import that
 * writes actual rows into ers_sensor_readings, the feed the Predict twin reads.
 * Parse + aggregate is the pure lib (sensorCsv); this resolves asset tags to ids
 * and upserts via PredictionService.importSensorReadings.
 */
import React, { useMemo, useState } from 'react';
import { X, UploadCloud, FileText, CheckCircle2, AlertTriangle, Loader2, Database } from 'lucide-react';
import { parseSensorCsv, aggregateSensors, type AggregatedSensor } from '../../lib/sensorCsv';
import { DatabaseService } from '../../eam/services/DatabaseService';
import predictionService from '../../eam/services/PredictionService';

interface Props { onClose: () => void; onImported?: (count: number) => void; }

const SAMPLE = `asset,tag,value,unit,timestamp,alarm_high,alarm_low
P-101,Bearing Vibration,4.8,mm/s,2026-07-06T08:00,7.1,0
P-101,Bearing Vibration,5.2,mm/s,2026-07-06T09:00,7.1,0
P-101,Discharge Temp,72,degC,2026-07-06T09:00,95,10`;

export const ImportReadingsModal: React.FC<Props> = ({ onClose, onImported }) => {
    const [text, setText] = useState('');
    const [assets, setAssets] = useState<{ id: string; tag: string; name: string }[]>([]);
    const [defaultAssetId, setDefaultAssetId] = useState('');
    const [importing, setImporting] = useState(false);
    const [done, setDone] = useState<number | null>(null);
    const [err, setErr] = useState<string | null>(null);

    React.useEffect(() => {
        DatabaseService.getInstance().getAssets()
            .then(a => setAssets((a || []).map((x: any) => ({ id: x.id, tag: x.tag, name: x.name }))))
            .catch(() => setAssets([]));
    }, []);

    const parsed = useMemo(() => (text.trim() ? parseSensorCsv(text) : null), [text]);
    const aggregated = useMemo(() => (parsed ? aggregateSensors(parsed.rows) : []), [parsed]);

    // Resolve each aggregated sensor's asset token → asset_id (by tag or id).
    const { byId, byTag } = useMemo(() => {
        const byId = new Map<string, string>(); const byTag = new Map<string, string>();
        assets.forEach(a => { byId.set(a.id.toLowerCase(), a.id); if (a.tag) byTag.set(a.tag.toLowerCase(), a.id); });
        return { byId, byTag };
    }, [assets]);

    const resolve = (s: AggregatedSensor): string | null => {
        const tok = (s.asset || '').toLowerCase();
        if (tok) return byId.get(tok) || byTag.get(tok) || null;
        return defaultAssetId || null;
    };

    const resolved = aggregated.map(s => ({ s, assetId: resolve(s) }));
    const importable = resolved.filter(r => r.assetId);
    const unresolved = resolved.filter(r => !r.assetId);
    const assetCount = new Set(importable.map(r => r.assetId)).size;

    const doImport = async () => {
        setImporting(true); setErr(null);
        try {
            const items = importable.map(({ s, assetId }) => ({
                asset_id: assetId!, tag: s.tag, unit: s.unit, current_value: s.currentValue,
                trend: s.trend, readings: s.readings, alarm_high: s.alarmHigh, alarm_low: s.alarmLow,
            }));
            const { upserted } = await predictionService.importSensorReadings(items);
            setDone(upserted);
            onImported?.(upserted);
        } catch (e: any) {
            setErr(e?.message || 'Import failed.');
        } finally { setImporting(false); }
    };

    const onFile = (f?: File) => { if (!f) return; const rd = new FileReader(); rd.onload = () => setText(String(rd.result || '')); rd.readAsText(f); };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-3 flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white flex-shrink-0">
                    <UploadCloud size={18} />
                    <div className="min-w-0"><h3 className="font-bold text-sm leading-tight">Import sensor readings (CSV)</h3>
                        <p className="text-[11px] text-white/80">Historian / SCADA / lab export → ers_sensor_readings → Predict</p></div>
                    <button onClick={onClose} className="ml-auto text-white/80 hover:text-white"><X size={18} /></button>
                </div>

                {done != null ? (
                    <div className="p-8 text-center">
                        <div className="inline-flex p-3 bg-emerald-50 rounded-xl text-emerald-600 mb-3"><CheckCircle2 size={32} /></div>
                        <h3 className="text-base font-bold text-slate-800">{done} reading point{done !== 1 ? 's' : ''} imported</h3>
                        <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">Written to <span className="font-mono">ers_sensor_readings</span>. Run a Digital Twin Snapshot on these assets in Predict to compute health from the imported data.</p>
                        <button onClick={onClose} className="mt-4 px-5 py-2 bg-blue-600 text-white font-semibold rounded-lg text-sm hover:bg-blue-500">Done</button>
                    </div>
                ) : (
                    <>
                        <div className="p-5 space-y-4 overflow-y-auto">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Paste CSV or upload a file</label>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setText(SAMPLE)} className="text-[11px] text-blue-600 hover:underline font-semibold">Insert sample</button>
                                    <label className="text-[11px] text-slate-600 hover:text-slate-800 font-semibold cursor-pointer flex items-center gap-1">
                                        <FileText size={12} /> Choose file
                                        <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                                    </label>
                                </div>
                            </div>
                            <textarea value={text} onChange={e => setText(e.target.value)} rows={7} spellCheck={false}
                                placeholder={"asset,tag,value,unit,timestamp\nP-101,Bearing Vibration,4.8,mm/s,2026-07-06T08:00"}
                                className="w-full p-3 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />

                            {/* Default asset for rows without an asset column */}
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-slate-500">Default asset for rows with no asset column:</span>
                                <select value={defaultAssetId} onChange={e => setDefaultAssetId(e.target.value)} className="flex-1 min-w-0 p-1.5 border border-slate-200 rounded text-xs">
                                    <option value="">— none —</option>
                                    {assets.map(a => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                                </select>
                            </div>

                            {/* Preview / diagnostics */}
                            {parsed && (
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
                                    <div className="flex items-center gap-4 font-semibold text-slate-700">
                                        <span className="flex items-center gap-1"><Database size={13} className="text-blue-500" /> {importable.length} point{importable.length !== 1 ? 's' : ''} · {assetCount} asset{assetCount !== 1 ? 's' : ''}</span>
                                        {unresolved.length > 0 && <span className="text-amber-600 flex items-center gap-1"><AlertTriangle size={13} /> {unresolved.length} unresolved</span>}
                                        {parsed.errors.length > 0 && <span className="text-red-600">{parsed.errors.length} row error{parsed.errors.length !== 1 ? 's' : ''}</span>}
                                    </div>
                                    {unresolved.length > 0 && (
                                        <div className="text-amber-700">Unmatched asset{unresolved.length !== 1 ? 's' : ''}: {[...new Set(unresolved.map(u => u.s.asset || '(blank)'))].slice(0, 6).join(', ')} — set a default asset or fix the tags.</div>
                                    )}
                                    {parsed.errors.length > 0 && <div className="text-red-600 max-h-16 overflow-y-auto">{parsed.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}</div>}
                                    {importable.slice(0, 4).map((r, i) => (
                                        <div key={i} className="flex items-center gap-2 text-slate-500">
                                            <span className="font-mono text-slate-700">{r.s.tag}</span>
                                            <span>= {r.s.currentValue}{r.s.unit ? ' ' + r.s.unit : ''}</span>
                                            <span className="text-slate-400">({r.s.count} pts, {r.s.trend || 'flat'})</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {err && <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600"><AlertTriangle size={14} /> {err}</div>}
                        </div>

                        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 flex-shrink-0">
                            <button onClick={onClose} className="text-sm font-semibold text-slate-500 hover:bg-slate-50 px-3 py-2 rounded-lg">Cancel</button>
                            <button onClick={doImport} disabled={importing || importable.length === 0}
                                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg">
                                {importing ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
                                Import {importable.length > 0 ? `${importable.length} point${importable.length !== 1 ? 's' : ''}` : ''}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
