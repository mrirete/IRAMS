/**
 * AreaAssessmentModal — "assess this system more closely" (Phase B2).
 *
 * Same deterministic engine as the whole-plant report
 * (eam/services/assessmentEngine), filtered to one hierarchy subtree.
 * The result persists as an ers_reliability_studies record — the governed
 * container the reliability tier already owns (lifecycle active →
 * in_review → approved), so an area deep-dive becomes an auditable study
 * rather than a screenshot.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    X, Loader2, Layers, Check, FolderPlus, Search, AlertTriangle, Play,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { computeAssessment, type Assessment } from '../../eam/services/assessmentEngine';
import { parentIds } from '../../lib/assetSubtree';
import { analyzeService } from '../../eam/services/AnalyzeService';

interface PickerAsset {
    id: string; tag: string; name: string; parent_id: string | null; criticality: string | null;
}

function buildFindings(a: Assessment, fmt: (n: number) => string): string {
    const lines = [
        `Area assessment — ${a.scope?.rootTag ?? ''} ${a.scope?.rootName ?? ''} (${new Date().toISOString().slice(0, 10)})`,
        `Scope: ${a.assetCount} assets in the subtree · history ${a.dataFrom ?? '—'} → ${a.dataTo ?? '—'}`,
        `12-month spend: ${fmt(a.totalSpend12mo)} across ${a.woCount12mo} work orders` +
        (a.paretoShare ? ` — top ${a.paretoShare.topN} asset(s) drive ${a.paretoShare.pct}%` : ''),
        a.badActors.length
            ? `Top cost drivers: ${a.badActors.slice(0, 3).map((b) => `${b.tag} ${fmt(b.cost12mo)}`).join('; ')}`
            : 'No costed work in the last 12 months.',
        ...a.weibull.slice(0, 3).map((w) =>
            `Weibull ${w.tag}: β=${w.beta}, η=${w.eta}d, B10=${w.b10Days}d (R²=${w.r2}, n=${w.nFailures}) — ${w.interpretation}`),
        a.warranty.total > 0 ? `Warranty recoverable: ${fmt(a.warranty.total)}` : '',
        a.pmWaste.length ? `PM flags: ${a.pmWaste.length} (${a.pmWaste.map((p) => p.category).join(', ')})` : '',
        `Register health (subtree): ${a.register.healthPct}% · coverage: cost ${a.coverage.cost_pct}%, failure codes ${a.coverage.failure_code_pct}%, downtime ${a.coverage.downtime_pct}%`,
        '',
        'Method: Pareto on frozen WO costs; censored median-rank-regression Weibull; PM effectiveness vs corrective history; warranty windows; ISO 14224-style register hygiene. Computed deterministically by the Reliability Specialist.',
    ];
    return lines.filter(Boolean).join('\n');
}

export const AreaAssessmentModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { formatCurrency } = useSettings();

    const [assets, setAssets] = useState<PickerAsset[]>([]);
    const [query, setQuery] = useState('');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<Assessment | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [savedStudyId, setSavedStudyId] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setResult(null); setError(null); setQuery(''); setSavedStudyId(null);
        void supabase.from('assets').select('id, tag, name, parent_id, criticality').limit(10000)
            .then(({ data, error: err }) => {
                if (err) setError(err.message);
                else setAssets((data ?? []) as PickerAsset[]);
            });
    }, [open]);

    // Sensible roots = assets with children; searchable by tag/name.
    const roots = useMemo(() => {
        const parents = parentIds(assets);
        const q = query.trim().toLowerCase();
        return assets
            .filter((a) => parents.has(a.id))
            .filter((a) => !q || a.tag.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
            .sort((a, b) => a.tag.localeCompare(b.tag))
            .slice(0, 30);
    }, [assets, query]);

    const run = async (id: string) => {
        setRunning(true); setResult(null); setError(null); setSavedStudyId(null);
        try {
            setResult(await computeAssessment(id));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setRunning(false);
        }
    };

    const saveAsStudy = async () => {
        if (!result?.scope) return;
        setSaving(true);
        try {
            const study = await analyzeService.createReliabilityStudy({
                name: `Area assessment — ${result.scope.rootTag} (${new Date().toISOString().slice(0, 10)})`,
                asset_id: result.scope.rootId,
                asset_tag: result.scope.rootTag,
                asset_name: result.scope.rootName,
                description: `Scoped Specialist assessment of ${result.scope.rootTag} and its ${result.assetCount - 1} descendant assets.`,
                findings: buildFindings(result, formatCurrency),
                created_by: user?.username ?? user?.id ?? null,
            } as never);
            if (study) setSavedStudyId(study.id);
        } finally {
            setSaving(false);
        }
    };

    if (!open) return null;
    const a = result;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="w-full max-w-3xl max-h-[85vh] rounded-2xl bg-white shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 border border-sky-100 flex items-center justify-center"><Layers size={16} /></span>
                        <div>
                            <h2 className="text-[15px] font-semibold text-slate-900">Assess an area</h2>
                            <p className="text-[11.5px] text-slate-400">Pick a system — the full assessment runs on it and its descendants, and can be kept as a study.</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Close" className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
                    {error && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0" />{error}
                        </div>
                    )}

                    {/* Scope picker */}
                    {!a && !running && (
                        <>
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search systems / areas…"
                                    className="w-full rounded-lg border border-slate-200 pl-9 pr-3 h-10 text-[13px] focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/15" />
                            </div>
                            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                                {roots.length === 0 && (
                                    <li className="px-4 py-6 text-center text-[12.5px] text-slate-400">
                                        No hierarchy parents found{query ? ' for that search' : ' — a flat register has no areas to scope'}.
                                    </li>
                                )}
                                {roots.map((r) => (
                                    <li key={r.id}>
                                        <button onClick={() => void run(r.id)}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-primary-50/50 transition-colors">
                                            <span className="font-mono text-[12px] font-bold text-primary-700 shrink-0">{r.tag}</span>
                                            <span className="text-[12.5px] text-slate-600 truncate flex-1">{r.name}</span>
                                            <Play size={13} className="text-slate-300 shrink-0" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {running && (
                        <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-sm">
                            <Loader2 size={18} className="animate-spin" /> Running the assessment on the subtree…
                        </div>
                    )}

                    {/* Scoped result */}
                    {a && a.scope && (
                        <>
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[13px] text-slate-700">
                                    <span className="font-mono font-bold text-primary-700">{a.scope.rootTag}</span>
                                    <span className="text-slate-400"> · {a.scope.rootName} · {a.assetCount} assets in scope</span>
                                </div>
                                <button onClick={() => setResult(null)} className="text-[11.5px] font-semibold text-slate-400 hover:text-slate-600">
                                    ← pick another area
                                </button>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                                {[
                                    { label: 'Spend (12 mo)', value: formatCurrency(a.totalSpend12mo) },
                                    { label: 'Work orders (12 mo)', value: String(a.woCount12mo) },
                                    { label: 'Register health', value: `${a.register.healthPct}%` },
                                    { label: 'Warranty recoverable', value: a.warranty.total > 0 ? formatCurrency(a.warranty.total) : '—' },
                                ].map((s) => (
                                    <div key={s.label} className="bg-white p-3">
                                        <div className="text-lg font-semibold text-slate-900 tabular-nums">{s.value}</div>
                                        <div className="text-[10.5px] text-slate-400 mt-0.5">{s.label}</div>
                                    </div>
                                ))}
                            </div>

                            {a.badActors.length > 0 && (
                                <div>
                                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">Cost drivers in this area</div>
                                    <ul className="space-y-1">
                                        {a.badActors.slice(0, 5).map((b) => (
                                            <li key={b.tag} className="flex items-center gap-2 text-[12.5px]">
                                                <span className="font-mono font-semibold text-slate-700 w-24 shrink-0 truncate">{b.tag}</span>
                                                <span className="text-slate-400 truncate flex-1">{b.name}</span>
                                                <span className="font-mono font-semibold text-slate-800">{formatCurrency(b.cost12mo)}</span>
                                                <span className="text-[10.5px] text-slate-400 w-12 text-right">{b.cumulativePct}%</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {a.weibull.length > 0 && (
                                <div>
                                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-slate-400 mb-1.5">Failure behaviour</div>
                                    <ul className="space-y-1">
                                        {a.weibull.slice(0, 3).map((w) => (
                                            <li key={w.tag} className="text-[12px] text-slate-600">
                                                <span className="font-mono font-semibold text-slate-700">{w.tag}</span>
                                                <span className="tabular-nums"> β {w.beta} · η {w.eta}d · B10 {w.b10Days}d</span>
                                                <span className="text-slate-400 italic"> — {w.interpretation}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                <span>{a.pmWaste.length} PM flag{a.pmWaste.length === 1 ? '' : 's'}</span>
                                <span>coverage: cost {a.coverage.cost_pct}% · codes {a.coverage.failure_code_pct}% · downtime {a.coverage.downtime_pct}%</span>
                            </div>

                            <div className="pt-1">
                                {savedStudyId ? (
                                    <button onClick={() => { onClose(); navigate('/analyze'); }}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold px-3.5 h-9 transition-colors">
                                        <Check size={13} /> Saved — open in Reliability Modelling
                                    </button>
                                ) : (
                                    <button onClick={() => void saveAsStudy()} disabled={saving}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-[12.5px] font-semibold px-3.5 h-9 disabled:opacity-45 transition-colors">
                                        {saving ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />}
                                        Keep as a reliability study
                                    </button>
                                )}
                                <p className="text-[10.5px] text-slate-400 mt-2">
                                    Saves the findings into the study lifecycle (active → in review → approved) so the deep-dive is auditable, not a screenshot.
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AreaAssessmentModal;
