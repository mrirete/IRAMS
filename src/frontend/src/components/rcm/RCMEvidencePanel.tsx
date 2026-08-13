/**
 * RCM Evidence tab — the living-RCM check: this study vs the asset's DATA.
 * Pattern verdict (fitted β vs chosen task types), postulated-vs-observed
 * failure modes, and CBM coverage (every on-condition task needs a real
 * measurement point). Nothing here edits the study — it tells the analyst
 * where the study and the field disagree.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Loader2, CheckCircle2, AlertTriangle, Radio, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { fetchGroundedFit } from '../../lib/predict/groundedFit';
import {
    patternVerdict, checkDecisionAgainstPattern, reconcileModes, checkCbmCoverage,
    type PatternVerdict, type DecisionCheck, type CbmCoverageRow,
} from '../../lib/predict/rcmEvidence';
import type { RCMStudy, RCMFunction, RCMFailureMode, RCMDecision } from '../../eam/services/RCMService';

interface Props {
    study: RCMStudy;
    functions: RCMFunction[];
    failureModes: RCMFailureMode[];
    decisions: Map<string, RCMDecision>;
    /**
     * Close the living-RCM loop: pull an observed-but-unanalyzed failure mode
     * INTO the study (as a wo_history row under the chosen function). JA1011
     * treats RCM as a continuous process — a study that ignores what the field
     * keeps recording is a binder, not a program.
     */
    onAddObservedMode: (code: string, description: string, functionId: string) => Promise<boolean>;
}

export const RCMEvidencePanel: React.FC<Props> = ({ study, functions, failureModes, decisions, onAddObservedMode }) => {
    const [loading, setLoading] = useState(true);
    const [verdict, setVerdict] = useState<PatternVerdict | null>(null);
    const [observedCounts, setObservedCounts] = useState<Record<string, number>>({});
    const [modeDict, setModeDict] = useState<Record<string, string>>({});
    const [readingDefs, setReadingDefs] = useState<{ name: string; isActive?: boolean }[]>([]);
    const [addTarget, setAddTarget] = useState<string>('');   // function id for adds
    const [addingCode, setAddingCode] = useState<string | null>(null);

    const decisionList = useMemo(() => Array.from(decisions.values()), [decisions]);
    const fmById = useMemo(() => new Map(failureModes.map(f => [f.id, f])), [failureModes]);

    // Fetch keyed on the ASSET only — editing a decision must not re-download
    // the fit, reading definitions and WO history. Reconciliation and coverage
    // derive locally below.
    useEffect(() => {
        let active = true;
        setLoading(true);
        (async () => {
            try {
                if (!study.asset_id) { setVerdict(null); setObservedCounts({}); setReadingDefs([]); return; }
                const [fit, defs, { data: wos }, { data: dict }] = await Promise.all([
                    fetchGroundedFit(study.asset_id),
                    DatabaseService.getInstance().getReadingDefinitions(study.asset_id),
                    supabase.from('work_orders')
                        .select('id, wo_failure_data!wo_id(failure_mode_code)')
                        .eq('asset_id', study.asset_id),
                    supabase.from('dictionaries_effective')
                        .select('code, description')
                        .eq('type', 'FAILURE_MODE'),
                ]);
                if (!active) return;
                setVerdict(patternVerdict(fit.beta));
                const counts: Record<string, number> = {};
                for (const w of (wos || [])) {
                    const fd = Array.isArray((w as any).wo_failure_data) ? (w as any).wo_failure_data : [(w as any).wo_failure_data];
                    for (const f of fd) {
                        const code = f?.failure_mode_code;
                        if (code) counts[code] = (counts[code] || 0) + 1;
                    }
                }
                setObservedCounts(counts);
                setModeDict(Object.fromEntries((dict || []).map(d => [String(d.code).toUpperCase(), d.description])));
                setReadingDefs(defs || []);
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [study.asset_id]);

    useEffect(() => {
        if (!addTarget && functions.length > 0) setAddTarget(functions[0].id);
    }, [functions, addTarget]);

    const recon = useMemo(
        () => reconcileModes(failureModes, observedCounts),
        [failureModes, observedCounts],
    );
    const coverage = useMemo(
        () => checkCbmCoverage(decisionList, readingDefs),
        [decisionList, readingDefs],
    );

    const handleAdd = async (code: string) => {
        if (!addTarget) return;
        setAddingCode(code);
        await onAddObservedMode(code, modeDict[code] || code, addTarget);
        setAddingCode(null);
    };

    const checks: DecisionCheck[] = useMemo(
        () => (verdict ? decisionList.map(d => checkDecisionAgainstPattern(d, verdict)) : []),
        [decisionList, verdict],
    );
    const contradicted = checks.filter(c => c.support === 'contradicted');
    const uncovered = coverage.filter(c => !c.covered);

    if (!study.asset_id) {
        return (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                <p className="text-sm font-medium text-slate-500">This study has no linked asset</p>
                <p className="text-xs text-slate-400 mt-1">Evidence checks compare the study against a real asset's failure history and measurement points.</p>
            </div>
        );
    }
    if (loading) {
        return <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400"><Loader2 size={18} className="inline animate-spin mr-2" />Checking the study against the data…</div>;
    }

    return (
        <div className="space-y-4">
            {/* ── 1. Pattern verdict ── */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                    <FlaskConical size={18} className="text-primary-500" />
                    <h3 className="text-base font-semibold text-slate-800">Failure-pattern verdict</h3>
                    {verdict && verdict.pattern !== 'unknown' && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase ${verdict.pattern === 'wear-out' ? 'bg-primary-50 text-primary-700 border-primary-200' : verdict.pattern === 'random' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                            {verdict.pattern} · β={verdict.beta}
                        </span>
                    )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{verdict?.guidance}</p>
                {contradicted.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                        {contradicted.map(c => (
                            <div key={c.failureModeId} className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                                <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-xs text-amber-800">
                                    <strong>{fmById.get(c.failureModeId)?.failure_mode_description || 'Failure mode'}:</strong> {c.note}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
                {verdict && verdict.pattern !== 'unknown' && contradicted.length === 0 && checks.some(c => c.support === 'supported') && (
                    <p className="mt-2 text-xs text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={13} /> All selected task types are consistent with the fitted pattern.</p>
                )}
            </div>

            {/* ── 2. Postulated vs observed modes ── */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-base font-semibold text-slate-800 mb-1">Postulated vs observed failure modes</h3>
                <p className="text-xs text-slate-400 mb-3">The study's modes against real coded failures on this asset's work orders — the check that keeps an RCM study living.</p>
                <div className="grid md:grid-cols-3 gap-3">
                    <div className="border border-red-200 bg-red-50/40 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-1.5">Observed, not analyzed ({recon.observedNotAnalyzed.length})</p>
                        {recon.observedNotAnalyzed.length ? (
                            <>
                                {functions.length > 1 && (
                                    <label className="block text-[10px] text-slate-500 mb-2">
                                        Add under function:{' '}
                                        <select
                                            value={addTarget}
                                            onChange={e => setAddTarget(e.target.value)}
                                            className="border border-slate-200 rounded px-1 py-0.5 text-[10px] bg-white cursor-pointer focus:border-accent-cyan focus:outline-none"
                                        >
                                            {functions.map(fn => (
                                                <option key={fn.id} value={fn.id}>{fn.function_number} — {fn.function_description.slice(0, 40)}</option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                {recon.observedNotAnalyzed.map(m => (
                                    <div key={m.code} className="flex items-center gap-2 py-1">
                                        <p className="text-xs text-slate-700 flex-1 min-w-0">
                                            <strong>{m.code}</strong>{modeDict[m.code] ? ` — ${modeDict[m.code]}` : ''} · {m.count}× on record
                                        </p>
                                        <button
                                            onClick={() => handleAdd(m.code)}
                                            aria-disabled={addingCode === m.code || functions.length === 0}
                                            title={functions.length === 0 ? 'Add a function to the worksheet first' : `Add ${m.code} to the study as a failure mode (source: WO history)`}
                                            className="flex items-center gap-1 px-2 py-1 rounded-md border border-red-300 bg-white text-[10px] font-bold text-red-700 hover:bg-red-100 transition-colors shrink-0"
                                        >
                                            {addingCode === m.code ? <RefreshCw size={10} className="animate-spin" /> : <Plus size={10} />}
                                            Add to study
                                        </button>
                                    </div>
                                ))}
                            </>
                        ) : <p className="text-xs text-slate-400">none — every observed mode is analyzed</p>}
                    </div>
                    <div className="border border-slate-200 bg-slate-50/60 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Postulated, never observed ({recon.postulatedNeverObserved.length})</p>
                        {recon.postulatedNeverObserved.length ? recon.postulatedNeverObserved.map(m => (
                            <p key={m.code} className="text-xs text-slate-600"><strong>{m.code}</strong> — {m.description}</p>
                        )) : <p className="text-xs text-slate-400">none</p>}
                        <p className="text-[10px] text-slate-400 mt-1.5">not wrong — possibly prevented, or not yet coded on WOs</p>
                    </div>
                    <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-3">
                        <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1.5">Matched ({recon.matched.length})</p>
                        {recon.matched.length ? recon.matched.map(m => (
                            <p key={m.code} className="text-xs text-slate-700"><strong>{m.code}</strong> — {m.count}× observed & analyzed</p>
                        )) : <p className="text-xs text-slate-400">none yet</p>}
                    </div>
                </div>
            </div>

            {/* ── 3. CBM coverage ── */}
            <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-1">
                    <Radio size={16} className="text-primary-500" />
                    <h3 className="text-base font-semibold text-slate-800">On-condition task coverage</h3>
                    {uncovered.length > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">{uncovered.length} uncovered</span>}
                </div>
                <p className="text-xs text-slate-400 mb-3">A CBM task with no measurement point behind it is a paper task — each on-condition decision is checked against the asset's actual points (Condition Data).</p>
                {coverage.length === 0 ? (
                    <p className="text-xs text-slate-400">No on-condition tasks in this study's decisions yet.</p>
                ) : (
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1.4fr_0.7fr_1.3fr] gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span>Task</span><span>Needs</span><span>Coverage</span>
                        </div>
                        {coverage.map((c, i) => (
                            <div key={i} className="grid grid-cols-[1.4fr_0.7fr_1.3fr] gap-2 px-3 py-2 border-b border-slate-100 last:border-b-0 text-xs items-center">
                                <span className="text-slate-700 truncate" title={c.task}>{c.task}{c.technology ? <span className="text-slate-400"> · {c.technology}</span> : null}</span>
                                <span className="text-slate-500">{c.neededKind ?? '—'}</span>
                                <span className={c.covered ? 'text-emerald-700' : 'text-red-600 font-medium'}>
                                    {c.covered ? <CheckCircle2 size={12} className="inline mr-1 -mt-0.5" /> : <AlertTriangle size={12} className="inline mr-1 -mt-0.5" />}
                                    {c.note}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
