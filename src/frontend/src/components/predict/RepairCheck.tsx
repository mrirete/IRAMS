/**
 * RepairCheck — for an alert raised by a vibration capture, once its work is
 * done: the capture that raised it next to the first one taken after the work
 * (lib/predict/vibrationCaptures). It informs the outcome; it never blocks it.
 */
import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, AudioWaveform } from 'lucide-react';
import type { PredictionAlert } from '../../types/intelligence';
import predictionService, { type WaveformCapture } from '../../eam/services/PredictionService';
import { alertPointOf, pickRepairCaptures, repairCheck, type CaptureFeatures } from '../../lib/predict/vibrationCaptures';

const Col: React.FC<{ label: string; cap: WaveformCapture | null }> = ({ label, cap }) => {
    const t = (cap?.features as CaptureFeatures | undefined)?.time;
    return (
        <div className="flex-1 min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
            {cap ? (
                <>
                    <p className="text-[11px] text-slate-500">{new Date(cap.captured_at).toLocaleDateString()}</p>
                    <p className="text-xs font-mono text-slate-700 mt-0.5">kurt {t?.kurtosis ?? '—'} · crest {t?.crest ?? '—'}</p>
                    <p className="text-xs font-mono text-slate-700">RMS {t?.rms ?? '—'}</p>
                </>
            ) : <p className="text-xs text-slate-400 mt-0.5">None</p>}
        </div>
    );
};

export const RepairCheck: React.FC<{ alert: PredictionAlert }> = ({ alert }) => {
    const [caps, setCaps] = useState<WaveformCapture[] | null>(null);
    useEffect(() => {
        let alive = true;
        predictionService.getWaveforms(alert.asset_id, 50).then(c => { if (alive) setCaps(c); });
        return () => { alive = false; };
    }, [alert.asset_id]);

    if (!alert.work_done_at) return null;
    const point = alertPointOf(alert.title);
    if (caps === null) {
        return <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Looking for captures on {point}…</p>;
    }
    const { before, after } = pickRepairCaptures(caps, point, alert.created_at, alert.work_done_at);
    const v = repairCheck((before?.features ?? null) as CaptureFeatures | null, (after?.features ?? null) as CaptureFeatures | null);
    const tone = v.verdict === 'cleared' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : v.verdict === 'not_cleared' ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-amber-200 bg-amber-50 text-amber-800';
    return (
        <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5"><AudioWaveform size={13} className="text-slate-400" /> Did the repair clear it? ({point})</p>
            <div className="flex gap-2">
                <Col label="Raised the alert" cap={before} />
                <Col label="After the work" cap={after} />
            </div>
            <p className={`text-[12px] rounded-lg border px-3 py-2 flex items-start gap-1.5 ${tone}`}>
                {v.verdict === 'cleared' ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
                <span>{v.summary}{v.verdict === 'no_after' ? ' Model tab › Vibration spectrum.' : ''}</span>
            </p>
        </div>
    );
};

export default RepairCheck;
