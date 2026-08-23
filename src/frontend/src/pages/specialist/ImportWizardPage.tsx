/**
 * ImportWizardPage — "send us your CMMS export" (Specialist Phase 1).
 *
 * Upload → the CMMS Analyst agent proposes a column mapping (human edits &
 * confirms) → deterministic apply + data-quality review → commit as an
 * import batch. The pure transformation lives in lib/importPipeline; writes
 * in ImportService; the LLM only proposes the mapping, never touches data.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    UploadCloud, FileSpreadsheet, Wand2, CheckCircle2, AlertTriangle,
    ArrowRight, ArrowLeft, Database, RotateCcw, Loader2, BarChart2, Download,
} from 'lucide-react';
import { useAuth } from '../../eam/contexts/AuthContext';
import { runCmmsAnalyst } from '../../eam/services/agentRunClient';
import { importService, type CommitResult } from '../../eam/services/ImportService';
import {
    applyMapping, buildDqReport, parseMappingProposal,
    type AppliedImport, type DqReport, type ImportMapping, type AssetField, type WoField,
} from '../../lib/importPipeline';
import { templatesForSource, downloadCmmsTemplate } from './cmmsTemplates';
import { supabase } from '../../eam/lib/supabase';

type Step = 'upload' | 'map' | 'review' | 'done';

// exportHint answers the question every first-time user has here: "which
// export, from where?" — a spreadsheet extract, never a database dump.
const SOURCE_SYSTEMS = [
    {
        value: 'sap_pm', label: 'SAP PM',
        exportHint: 'From SAP: IW38/IW39 (order list) or IW47/IW49 for history → export to spreadsheet. Register: IH06 / IE05 equipment list.',
    },
    {
        value: 'maximo', label: 'IBM Maximo',
        exportHint: 'From Maximo: Work Order Tracking → filter → Download (CSV). Register: Assets application → Download.',
    },
    {
        value: 'maintainx', label: 'MaintainX',
        exportHint: 'From MaintainX: Reporting → Work Orders → Export CSV. Register: Assets → ⋯ → Export.',
    },
    {
        value: 'emaint', label: 'eMaint',
        exportHint: 'From eMaint X5: Work Orders table view → Export to Excel. Register: Assets table view → Export.',
    },
    {
        value: 'limble', label: 'Limble',
        exportHint: 'From Limble: Work → Tasks → Export CSV. Register: Assets → Export.',
    },
    {
        value: 'fiix', label: 'Fiix',
        exportHint: 'From Fiix: Work Orders view → Export. Register: Assets view → Export.',
    },
    {
        value: 'upkeep', label: 'UpKeep',
        exportHint: 'From UpKeep: Work Orders → Export CSV. Register: Assets → Export.',
    },
    {
        value: 'spreadsheet', label: 'Spreadsheet / other',
        exportHint: 'Any sheet with one row per work order (and/or per asset) works — the Specialist proposes the column mapping either way.',
    },
];

const ASSET_FIELD_LABELS: Record<AssetField, string> = {
    tag: 'Asset tag *', equipment_number: 'Equipment number (SAP EQUNR)',
    functional_location: 'Functional location', name: 'Asset name', criticality: 'Criticality',
    manufacturer: 'Manufacturer', model: 'Model', serial_number: 'Serial number',
    asset_category: 'Category',
};
const WO_FIELD_LABELS: Record<WoField, string> = {
    wo_number: 'WO number *', title: 'Title', description: 'Description',
    type: 'Work type', status: 'Status', priority: 'Priority',
    asset_tag: 'Asset tag link *', asset_location: 'Location link (fallback)', asset_name: 'Asset name',
    created_at: 'WO date *', closed_at: 'Completion date',
    labor_cost: 'Labor cost', material_cost: 'Material cost', total_cost: 'Total cost',
    downtime_hours: 'Downtime (hrs)', labor_hours: 'Actual work (hrs)',
    breakdown: 'Breakdown indicator', malfunction_start: 'Malfunction start',
    malfunction_end: 'Malfunction end', failure_mode: 'Failure mode',
    failure_cause: 'Failure cause', remedy: 'Remedy',
};

const EMPTY_MAPPING: ImportMapping = {
    file_kind: 'work_orders',
    asset_fields: {},
    wo_fields: {},
    value_maps: {},
    date_format: 'auto',
};

export const ImportWizardPage: React.FC = () => {
    const navigate = useNavigate();
    const fileRef = useRef<HTMLInputElement>(null);
    const { role } = useAuth();
    // import_batches is admin-only by RLS, so a non-admin's commit fails at the
    // very last step after all the mapping work. Say so up front instead.
    const canCommit = role === 'SUPER_ADMIN' || role === 'SYS_ADMIN';

    const [step, setStep] = useState<Step>('upload');
    const [sourceSystem, setSourceSystem] = useState('sap_pm');
    // Registerless-history guard: history committed with no asset register
    // creates flat, unlevelled assets. The Migration Center hard-locks its
    // phase-7 link on the same condition; this advisory covers the sidebar
    // route, where blocking would kill the legitimate bootstrap-from-history
    // flow. null until the count arrives — say nothing rather than guess.
    const [hasRegister, setHasRegister] = useState<boolean | null>(null);
    useEffect(() => {
        void supabase.from('assets').select('id', { count: 'exact', head: true })
            .then(({ count, error }) => { if (!error) setHasRegister((count ?? 0) > 0); });
    }, []);
    const [fileName, setFileName] = useState('');
    const [headers, setHeaders] = useState<string[]>([]);
    const [rows, setRows] = useState<unknown[][]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [agentProse, setAgentProse] = useState('');
    const [mapping, setMapping] = useState<ImportMapping>(EMPTY_MAPPING);
    const [applied, setApplied] = useState<AppliedImport | null>(null);
    const [dq, setDq] = useState<DqReport | null>(null);
    const [batchId, setBatchId] = useState<string | null>(null);
    const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

    // ── Step 1: parse the file ────────────────────────────────────────────
    const handleFile = async (file: File) => {
        setBusy(true); setError(null);
        try {
            const XLSX = await import('xlsx');
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array', cellDates: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
            const headerRowIdx = aoa.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
            if (headerRowIdx < 0) throw new Error('The file appears to be empty.');
            const hdrs = aoa[headerRowIdx].map((h) => String(h ?? '').trim());
            const dataRows = aoa.slice(headerRowIdx + 1);
            if (dataRows.length === 0) throw new Error('No data rows found under the header row.');
            setFileName(file.name);
            setHeaders(hdrs);
            setRows(dataRows);

            // Ask the CMMS Analyst for a mapping proposal. Its failure must NOT
            // strand the user on Upload — the manual mapping UI is right there,
            // and an AI outage (or an exhausted quota) shouldn't block a migration.
            try {
                const res = await runCmmsAnalyst({
                    file_name: file.name,
                    source_hint: sourceSystem,
                    headers: hdrs,
                    sample_rows: dataRows.slice(0, 15),
                });
                const { prose, mapping: proposed } = parseMappingProposal(res.answer);
                setAgentProse(prose);
                setMapping(proposed ?? EMPTY_MAPPING);
                if (!proposed) setError('The Specialist could not produce a mapping automatically — map the columns manually below.');
            } catch (agentErr) {
                setAgentProse('');
                setMapping(EMPTY_MAPPING);
                setError(
                    `Automatic column mapping is unavailable right now (${agentErr instanceof Error ? agentErr.message : String(agentErr)}). ` +
                    'Map the columns manually below — the import itself works exactly the same.'
                );
            }
            setStep('map');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    // ── Step 2 → 3: apply the confirmed mapping ───────────────────────────
    const confirmMapping = async () => {
        setBusy(true); setError(null);
        try {
            const result = applyMapping(headers, rows, mapping);
            if (result.workOrders.length === 0 && result.assets.length === 0) {
                throw new Error('The mapping produced no importable rows — check the tag / WO-number / date columns.');
            }
            const report = buildDqReport(result);
            const id = batchId ?? await importService.createBatch(sourceSystem, fileName);
            setBatchId(id);
            await importService.saveMapping(id, mapping);
            setApplied(result);
            setDq(report);
            setStep('review');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    // ── Step 3 → 4: commit ────────────────────────────────────────────────
    const commit = async () => {
        if (!batchId || !applied || !dq) return;
        setBusy(true); setError(null);
        try {
            const res = await importService.commitBatch(batchId, applied, dq);
            setCommitResult(res);
            setStep('done');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const setField = (group: 'asset_fields' | 'wo_fields', field: string, header: string) => {
        setMapping((m) => ({
            ...m,
            [group]: { ...m[group], [field]: header === '' ? null : header },
        }));
    };

    const stepIndex = ['upload', 'map', 'review', 'done'].indexOf(step);
    const sampleValues = useMemo(() => {
        const out = new Map<string, string>();
        headers.forEach((h, i) => {
            const v = rows.slice(0, 30).map((r) => String(r[i] ?? '').trim()).filter(Boolean).slice(0, 3);
            out.set(h, v.join(' · '));
        });
        return out;
    }, [headers, rows]);

    const FieldSelect: React.FC<{ group: 'asset_fields' | 'wo_fields'; field: string; label: string }> = ({ group, field, label }) => {
        const current = (mapping[group] as Record<string, string | null>)[field] ?? '';
        return (
            <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-slate-600">{label}</span>
                <select
                    value={current ?? ''}
                    onChange={(e) => setField(group, field, e.target.value)}
                    className={`rounded-lg border px-2 py-1.5 bg-white text-slate-700 ${current ? 'border-primary-400' : 'border-slate-200 text-slate-400'}`}
                >
                    <option value="">— not mapped —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                {current && <span className="text-[10px] text-slate-400 truncate" title={sampleValues.get(current)}>{sampleValues.get(current)}</span>}
            </label>
        );
    };

    return (
        <div className="ers-page-form space-y-6 pb-24 animate-in fade-in duration-300">
            {/* Header + stepper */}
            <div>
                {/* This wizard is phase 7 of the Migration Center's checklist — lead
                    admins back to it. The origin state makes its back button return
                    here (see MigrationOrigin). Route is admin-gated, so only show
                    the link to roles that can enter it. */}
                {canCommit && (
                    <Link
                        to="/admin/migration"
                        state={{ to: '/specialist/import', label: 'Import wizard' }}
                        className="inline-flex items-center gap-1.5 mb-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors w-fit py-0.5"
                    >
                        <ArrowLeft size={14} strokeWidth={2.5} /> Back to Migration Center
                    </Link>
                )}
                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                    <Database size={22} className="text-primary-600" /> Import CMMS Data
                </h1>
                <p className="text-slate-500 text-sm mt-1">
                    Send your Specialist a maintenance-history export — SAP PM, Maximo, MaintainX or any spreadsheet.
                </p>
                <div className="flex items-center gap-2 mt-4">
                    {['Upload', 'Map columns', 'Review quality', 'Done'].map((label, i) => (
                        <React.Fragment key={label}>
                            {i > 0 && <div className={`h-px flex-1 ${i <= stepIndex ? 'bg-primary-400' : 'bg-slate-200'}`} />}
                            <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${i === stepIndex ? 'bg-primary-600 text-white border-primary-600'
                                : i < stepIndex ? 'bg-primary-50 text-primary-700 border-primary-200'
                                    : 'bg-white text-slate-400 border-slate-200'}`}>
                                {i < stepIndex ? <CheckCircle2 size={12} /> : <span className="font-bold">{i + 1}</span>}
                                {label}
                            </div>
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {!canCommit && (
                <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-slate-400" />
                    <span>
                        Importing CMMS history requires an administrator account. You can upload a file and
                        review the mapping, but the final commit will be blocked — ask an admin to run the import.
                    </span>
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
                </div>
            )}

            {/* ── Step 1: Upload ── */}
            {step === 'upload' && hasRegister === false && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>
                        No asset register exists yet. History imported now still works, but the assets it creates
                        are flat — no hierarchy, no levels.{' '}
                        {canCommit ? (
                            <>If you have an equipment list, load it first in the{' '}
                                <Link to="/admin/migration" state={{ to: '/specialist/import', label: 'Import wizard' }}
                                    className="font-semibold underline underline-offset-2">Migration Center</Link>{' '}
                                (phase 1), then come back.</>
                        ) : (
                            <>If your company has an equipment list, ask an admin to import it first.</>
                        )}
                    </span>
                </div>
            )}
            {step === 'upload' && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
                    <label className="flex flex-col gap-1.5 text-sm max-w-xs">
                        <span className="font-medium text-slate-600">Source system</span>
                        <select value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)}
                            className="rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-700">
                            {SOURCE_SYSTEMS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                    </label>
                    <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 max-w-2xl">
                        {SOURCE_SYSTEMS.find((s) => s.value === sourceSystem)?.exportHint}
                    </p>
                    {/* No export handy? Pre-formatted sheets whose headers auto-map in step 2. */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-500">Or start from a template:</span>
                        {templatesForSource(sourceSystem).map((t) => (
                            <button key={t.filename} onClick={() => downloadCmmsTemplate(t)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-600 hover:border-primary-300 hover:text-primary-700 transition-colors">
                                <Download size={12} /> {t.label}
                            </button>
                        ))}
                        <span className="basis-full text-[11px] text-slate-400">
                            These import a flat asset list plus history for analysis. To build the full asset
                            hierarchy (sites, units, parents), use Assets › Import and its own template — the two
                            match on the same asset tag.
                        </span>
                    </div>
                    <button
                        onClick={() => fileRef.current?.click()}
                        disabled={busy}
                        className="w-full rounded-2xl border-2 border-dashed border-primary-200 bg-primary-50/40 hover:bg-primary-50 transition-colors p-10 flex flex-col items-center gap-3 text-primary-700"
                    >
                        {busy ? <Loader2 size={32} className="animate-spin" /> : <UploadCloud size={32} />}
                        <span className="font-semibold">{busy ? 'Reading file & consulting your Specialist…' : 'Choose an export file'}</span>
                        <span className="text-xs text-primary-600">.xlsx, .xls or .csv — work-order history and/or asset register</span>
                    </button>
                    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }} />
                    <p className="text-xs text-slate-400">
                        Nothing is written until you review and confirm at the final step. The file itself never leaves your browser —
                        only the column headers and a small sample go to the Specialist for mapping.
                    </p>
                </div>
            )}

            {/* ── Step 2: Map ── */}
            {step === 'map' && (
                <div className="space-y-4">
                    <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-primary-800">
                            <Wand2 size={16} /> Specialist's read of <span className="font-mono text-xs bg-white border border-primary-200 rounded px-1.5 py-0.5">{fileName}</span>
                            {typeof mapping.confidence === 'number' && (
                                <span className="ml-auto text-xs font-medium text-primary-600">confidence {(mapping.confidence * 100).toFixed(0)}%</span>
                            )}
                        </div>
                        {agentProse && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{agentProse}</p>}
                        {(mapping.warnings ?? []).length > 0 && (
                            <ul className="mt-2 space-y-1">
                                {mapping.warnings!.map((w, i) => (
                                    <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-5">
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                            <label className="flex items-center gap-2">
                                <span className="font-medium text-slate-600">File contains</span>
                                <select value={mapping.file_kind}
                                    onChange={(e) => setMapping((m) => ({ ...m, file_kind: e.target.value as ImportMapping['file_kind'] }))}
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700 text-xs">
                                    <option value="work_orders">Work-order history</option>
                                    <option value="assets">Asset register</option>
                                    <option value="combined">Both (combined)</option>
                                </select>
                            </label>
                            <label className="flex items-center gap-2">
                                <span className="font-medium text-slate-600">Dates are</span>
                                <select value={mapping.date_format ?? 'auto'}
                                    onChange={(e) => setMapping((m) => ({ ...m, date_format: e.target.value as ImportMapping['date_format'] }))}
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700 text-xs">
                                    <option value="auto">Auto-detect</option>
                                    <option value="DMY">Day/Month/Year</option>
                                    <option value="MDY">Month/Day/Year</option>
                                    <option value="ISO">ISO (yyyy-mm-dd)</option>
                                </select>
                            </label>
                        </div>

                        {(mapping.file_kind === 'work_orders' || mapping.file_kind === 'combined') && (
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Work-order fields</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {(Object.keys(WO_FIELD_LABELS) as WoField[]).map((f) => (
                                        <FieldSelect key={f} group="wo_fields" field={f} label={WO_FIELD_LABELS[f]} />
                                    ))}
                                </div>
                            </div>
                        )}
                        {(mapping.file_kind === 'assets' || mapping.file_kind === 'combined') && (
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Asset fields</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {(Object.keys(ASSET_FIELD_LABELS) as AssetField[]).map((f) => (
                                        <FieldSelect key={f} group="asset_fields" field={f} label={ASSET_FIELD_LABELS[f]} />
                                    ))}
                                </div>
                            </div>
                        )}

                        {Object.keys(mapping.value_maps?.type ?? {}).length + Object.keys(mapping.value_maps?.status ?? {}).length > 0 && (
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Value translations (agent-proposed)</h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(mapping.value_maps?.type ?? {}).map(([k, v]) => (
                                        <span key={`t${k}`} className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-slate-600">{k} → {v}</span>
                                    ))}
                                    {Object.entries(mapping.value_maps?.status ?? {}).map(([k, v]) => (
                                        <span key={`s${k}`} className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-slate-600">{k} → {v}</span>
                                    ))}
                                </div>
                                <p className="text-[11px] text-slate-400 mt-1.5">Values not listed fall back to sensible defaults (completed-looking → CLOSED, preventive-looking → PM, …) and are reported in the quality review.</p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-between">
                        <button onClick={() => { setStep('upload'); setError(null); }}
                            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 px-3 py-2">
                            <ArrowLeft size={14} /> Back
                        </button>
                        <button onClick={() => void confirmMapping()} disabled={busy}
                            className="flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-5 py-2.5 disabled:opacity-50 transition-colors">
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                            Apply mapping & review
                        </button>
                    </div>
                </div>
            )}

            {/* ── Step 3: Review ── */}
            {step === 'review' && applied && dq && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                            { label: 'Assets', value: dq.totals.assets },
                            { label: 'Work orders', value: dq.totals.work_orders },
                            { label: 'Rows skipped', value: dq.totals.skipped_rows },
                            { label: 'History span', value: dq.date_range.months ? `${dq.date_range.months} mo` : '—' },
                        ].map((s) => (
                            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4">
                                <div className="text-2xl font-bold text-slate-800">{s.value}</div>
                                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Data coverage</h3>
                        <div className="space-y-2.5">
                            {[
                                { label: 'Work orders with cost data', pct: dq.coverage.cost_pct },
                                { label: 'With completion dates', pct: dq.coverage.closed_date_pct },
                                { label: 'With failure coding', pct: dq.coverage.failure_code_pct },
                                { label: 'With downtime hours', pct: dq.coverage.downtime_pct },
                                { label: 'With breakdown indicator', pct: dq.coverage.breakdown_pct },
                                { label: 'With actual work hours', pct: dq.coverage.labor_hours_pct },
                            ].map((c) => (
                                <div key={c.label} className="flex items-center gap-3 text-xs">
                                    <span className="w-52 text-slate-600 shrink-0">{c.label}</span>
                                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                                        <div className={`h-full rounded-full ${c.pct >= 60 ? 'bg-emerald-500' : c.pct >= 30 ? 'bg-amber-400' : 'bg-rose-400'}`}
                                            style={{ width: `${c.pct}%` }} />
                                    </div>
                                    <span className="w-10 text-right font-mono text-slate-500">{c.pct}%</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {(dq.warnings.length > 0 || dq.issues.length > 0) && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 space-y-2">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-600">The Specialist's honest read</h3>
                            {dq.warnings.map((w, i) => (
                                <p key={i} className="text-sm text-amber-800 flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{w}</p>
                            ))}
                            {dq.issues.map((iss) => (
                                <p key={iss.kind} className="text-xs text-amber-700 pl-6">
                                    {iss.message} <span className="font-mono">({iss.count}× — e.g. row{iss.rows.length > 1 ? 's' : ''} {iss.rows.slice(0, 5).join(', ')})</span>
                                </p>
                            ))}
                        </div>
                    )}

                    <div className="flex justify-between">
                        <button onClick={() => { setStep('map'); setError(null); }}
                            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 px-3 py-2">
                            <ArrowLeft size={14} /> Adjust mapping
                        </button>
                        <button onClick={() => void commit()} disabled={busy || !canCommit}
                            title={canCommit ? undefined : 'Administrator rights are required to commit an import'}
                            className="flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                            Commit {dq.totals.work_orders} work orders / {dq.totals.assets} assets
                        </button>
                    </div>
                </div>
            )}

            {/* ── Step 4: Done ── */}
            {step === 'done' && commitResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 sm:p-8 text-center space-y-4">
                    <CheckCircle2 size={40} className="text-emerald-500 mx-auto" />
                    <h2 className="text-lg font-bold text-slate-800">Import committed</h2>
                    <p className="text-sm text-slate-600 max-w-lg mx-auto">
                        {commitResult.workOrdersCreated} work orders and {commitResult.assetsCreated} new assets imported
                        {commitResult.assetsMatched > 0 && <> ({commitResult.assetsMatched} matched existing assets)</>}
                        {commitResult.failureRowsCreated > 0 && <>, with {commitResult.failureRowsCreated} failure-coded records</>}.
                    </p>
                    {commitResult.notes.length > 0 && (
                        <ul className="text-xs text-slate-500 space-y-1 max-w-lg mx-auto text-left">
                            {commitResult.notes.map((n, i) => <li key={i}>• {n}</li>)}
                        </ul>
                    )}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 pt-2">
                        <button onClick={() => navigate('/specialist/assessment')}
                            className="flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-5 py-2.5 transition-colors">
                            <BarChart2 size={15} /> Run the assessment
                        </button>
                        {/* History was phase 7 of the migration checklist — the next
                            phase (failure-code catalogs) lives back in the Center. */}
                        {canCommit && (
                            <button onClick={() => navigate('/admin/migration', { state: { to: '/specialist/import', label: 'Import wizard' } })}
                                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-sm font-medium px-4 py-2.5">
                                <ArrowLeft size={14} /> Continue the migration
                            </button>
                        )}
                        <button onClick={() => { setStep('upload'); setBatchId(null); setApplied(null); setDq(null); setCommitResult(null); setError(null); }}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-sm font-medium px-4 py-2.5">
                            <RotateCcw size={14} /> Import another file
                        </button>
                    </div>
                </div>
            )}

            {step === 'upload' && <RecentBatches />}
        </div>
    );
};

/** Recent batches list with rollback — the audit trail of the motion. */
const RecentBatches: React.FC = () => {
    const [batches, setBatches] = useState<Awaited<ReturnType<typeof importService.listBatches>>>([]);
    const [rolling, setRolling] = useState<string | null>(null);
    React.useEffect(() => { void importService.listBatches().then(setBatches); }, []);

    if (batches.length === 0) return null;
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <FileSpreadsheet size={13} /> Previous imports
            </h3>
            <div className="divide-y divide-slate-100">
                {batches.map((b) => (
                    <div key={b.id} className="py-2.5 flex items-center gap-3 text-sm">
                        <span className="font-medium text-slate-700 truncate max-w-[16rem]">{b.file_name ?? '(no file name)'}</span>
                        <span className="text-xs text-slate-400">{b.source_system}</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${b.status === 'committed' ? 'bg-emerald-50 text-emerald-600'
                            : b.status === 'rolled_back' ? 'bg-slate-100 text-slate-500'
                                : 'bg-amber-50 text-amber-600'}`}>{b.status}</span>
                        <span className="text-xs text-slate-400 ml-auto">
                            {b.row_counts?.work_orders ?? 0} WOs · {new Date(b.created_at).toLocaleDateString()}
                        </span>
                        {b.status === 'committed' && (
                            <button
                                disabled={rolling === b.id}
                                onClick={async () => {
                                    if (!window.confirm('Remove everything this import created?')) return;
                                    setRolling(b.id);
                                    try { await importService.rollbackBatch(b.id); setBatches(await importService.listBatches()); }
                                    finally { setRolling(null); }
                                }}
                                className="text-xs text-rose-500 hover:text-rose-700 font-medium disabled:opacity-50">
                                {rolling === b.id ? 'Rolling back…' : 'Roll back'}
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ImportWizardPage;
