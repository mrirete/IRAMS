/**
 * CockpitImportPage — SAP Migration Cockpit source data, straight into IREAMS.
 *
 * The cockpit's "Download source data" gives a ZIP per migration object,
 * holding one CSV per staging structure. Unzip it, drop the folder here, and
 * the condition history lands on the register: measuring points become
 * reading points, measurement documents become readings on them.
 *
 * A FOLDER, not loose files, is what the page asks for — and not out of
 * neatness. Two migration objects ship a structure called S_OBJ_LIST with
 * different keys, so the folder name is the only thing that says which
 * object a file belongs to. Loose files still work; the ambiguous ones are
 * reported rather than guessed at.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowLeft, Database, FolderOpen, FileSpreadsheet, Loader2, AlertTriangle,
    AlertOctagon, Info, CheckCircle2, Upload, CalendarClock, ArrowRight,
} from 'lucide-react';
import { useToast } from '../../eam/contexts/ToastContext';
import { errMessage, type ImportResult } from '../../eam/services/importTypes';
import { bulkImportService } from '../../eam/services/bulkImportService';
import {
    readCockpitSet, toReadingRows, type CockpitFile, type CockpitIssue,
} from '../../lib/sapCockpit/inbound';
import { toStrategyRows } from '../../lib/sapCockpit/strategy';
import { COCKPIT_OBJECT_BY_KEY } from '../../lib/sapCockpit/structures';

const ISSUE_ICON = {
    error: <AlertOctagon size={14} className="text-rose-600 mt-0.5 shrink-0" />,
    warn: <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />,
    info: <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />,
};

const IssueRow: React.FC<{ issue: CockpitIssue }> = ({ issue }) => (
    <li className="flex items-start gap-2 py-2 border-b border-slate-100 last:border-0 text-sm text-slate-700">
        {ISSUE_ICON[issue.level]}
        <span>
            {issue.message}
            {issue.count && issue.count > 1 && (
                <span className="ml-1.5 text-xs text-slate-400">({issue.count} rows)</span>
            )}
        </span>
    </li>
);

export const CockpitImportPage: React.FC = () => {
    const { showToast } = useToast();
    const navigate = useNavigate();
    const [files, setFiles] = useState<CockpitFile[]>([]);
    const [reading, setReading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const folderInput = useRef<HTMLInputElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const take = useCallback(async (list: FileList | null) => {
        if (!list || list.length === 0) return;
        setReading(true);
        setResult(null);
        try {
            const picked = [...list].filter(f => /\.csv$/i.test(f.name));
            const read = await Promise.all(picked.map(async f => ({
                // webkitRelativePath is set when a folder was chosen — it carries
                // the "Source data for ..." folder that names the object.
                name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
                text: await f.text(),
            })));
            setFiles(read);
            if (read.length === 0) showToast('No CSV files in that selection — the cockpit writes one CSV per structure.', 'error');
        } catch (e: unknown) {
            showToast(errMessage(e), 'error');
        } finally {
            setReading(false);
        }
    }, [showToast]);

    const set = useMemo(() => readCockpitSet(files), [files]);
    const mapped = useMemo(() => toReadingRows(set), [set]);
    const strategy = useMemo(() => toStrategyRows(set), [set]);

    const points = mapped.rows.filter(r => !r.value).length;
    const readings = mapped.rows.length - points;
    const errors = [...set.issues, ...mapped.issues].filter(i => i.level === 'error');
    const issues = [...set.issues, ...mapped.issues];

    const runImport = async () => {
        if (mapped.rows.length === 0) return;
        setImporting(true);
        try {
            const out = await bulkImportService.importReadings(mapped.rows);
            setResult(out);
            showToast(
                `${out.inserted} inserted, ${out.updated} updated, ${out.skipped} skipped, ${out.failed} failed.`,
                out.failed > 0 ? 'error' : 'success',
            );
        } catch (e: unknown) {
            showToast(errMessage(e), 'error');
        } finally {
            setImporting(false);
        }
    };

    return (
        <div className="ers-page-form space-y-6 pb-24 animate-in fade-in duration-300">
            <div>
                <Link
                    to="/admin/migration"
                    className="inline-flex items-center gap-1.5 mb-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors w-fit py-0.5"
                >
                    <ArrowLeft size={14} strokeWidth={2.5} /> Back to Migration Center
                </Link>
                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                    <Database size={22} className="text-primary-600" /> Import from SAP Migration Cockpit
                </h1>
                <p className="text-slate-500 text-sm mt-1 max-w-2xl">
                    Download the source data from the cockpit, unzip it, and drop the folders here. Measuring points and
                    measurement documents become the condition history a reliability study runs on; task lists, maintenance
                    items and plans become job plans and PM schedules.
                </p>
            </div>

            {/* Intake */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="font-semibold text-slate-800 mb-1">The files</h3>
                <p className="text-sm text-slate-500 mb-4">
                    Choose the unzipped <b>folder</b> where you can — a measurement document names no asset, so it has to be
                    read together with its measuring points, and two objects ship a file with the same name. Loose files work
                    too; anything ambiguous is reported instead of guessed.
                </p>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => folderInput.current?.click()}
                        disabled={reading}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary-600 text-white px-4 py-2 text-sm font-semibold hover:bg-primary-700 disabled:opacity-60"
                    >
                        {reading ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />} Choose a folder
                    </button>
                    <button
                        onClick={() => fileInput.current?.click()}
                        disabled={reading}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                        <FileSpreadsheet size={15} /> Or pick CSV files
                    </button>
                    {files.length > 0 && (
                        <button
                            onClick={() => { setFiles([]); setResult(null); }}
                            className="text-sm text-slate-500 hover:text-slate-800 px-2"
                        >
                            Clear
                        </button>
                    )}
                </div>
                {/* webkitdirectory is not in the React typings */}
                <input
                    ref={folderInput} type="file" multiple hidden
                    onChange={e => { void take(e.target.files); e.target.value = ''; }}
                    {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                />
                <input
                    ref={fileInput} type="file" multiple accept=".csv,text/csv" hidden
                    onChange={e => { void take(e.target.files); e.target.value = ''; }}
                />

                {(set.sheets.length > 0 || set.strategyPackages.length > 0) && (
                    <ul className="mt-4 space-y-1.5">
                        {set.strategyPackages.length > 0 && (
                            <li className="flex items-center gap-2 text-sm">
                                <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                                <span className="font-mono text-xs text-slate-700">strategy packages</span>
                                <span className="text-slate-400 text-xs">IP11 / T351P export — the cycles the cockpit cannot carry</span>
                                <span className="ml-auto text-xs text-slate-500">
                                    {set.strategyPackages.length.toLocaleString()} package{set.strategyPackages.length === 1 ? '' : 's'}
                                </span>
                            </li>
                        )}
                        {set.sheets.map(s => (
                            <li key={s.file} className="flex items-center gap-2 text-sm">
                                <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                                <span className="font-mono text-xs text-slate-700">{s.structure}</span>
                                <span className="text-slate-400 text-xs">{COCKPIT_OBJECT_BY_KEY[s.object].name}</span>
                                <span className="ml-auto text-xs text-slate-500">
                                    {s.rows.length.toLocaleString()} row{s.rows.length === 1 ? '' : 's'}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* What it makes of them */}
            {files.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h3 className="font-semibold text-slate-800 mb-3">What will be imported</h3>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-4">
                        <span className="text-slate-600"><b className="text-slate-900">{points.toLocaleString()}</b> reading point(s)</span>
                        <span className="text-slate-600"><b className="text-slate-900">{readings.toLocaleString()}</b> reading(s)</span>
                        {mapped.skipped > 0 && (
                            <span className="text-rose-700"><b>{mapped.skipped.toLocaleString()}</b> row(s) skipped</span>
                        )}
                    </div>

                    {issues.length > 0 && <ul className="mb-4">{issues.map((i, n) => <IssueRow key={n} issue={i} />)}</ul>}

                    <button
                        onClick={() => void runImport()}
                        disabled={importing || mapped.rows.length === 0}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary-600 text-white px-4 py-2 text-sm font-semibold hover:bg-primary-700 disabled:opacity-60"
                    >
                        {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                        Import {mapped.rows.length.toLocaleString()} row{mapped.rows.length === 1 ? '' : 's'}
                    </button>
                    {errors.length > 0 && (
                        <p className="text-xs text-rose-700 mt-2">
                            The errors above are rows that will not be imported. Fix them at source and download again,
                            or import the rest knowingly.
                        </p>
                    )}
                </section>
            )}

            {/* Strategy — schedules and job plans, handed to the importer that owns them */}
            {(strategy.recurring.length > 0 || strategy.jobplan.length > 0 || strategy.skipped > 0) && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h3 className="font-semibold text-slate-800 mb-1 flex items-center gap-2">
                        <CalendarClock size={16} className="text-slate-400" /> Maintenance strategy
                    </h3>
                    <p className="text-sm text-slate-500 mb-3">
                        What the plant does today: maintenance items become PM schedules, task-list operations become the
                        steps on them. These import on Recurring Work, in that order — a step can only attach to a
                        schedule that already exists.
                    </p>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-4">
                        <span className="text-slate-600"><b className="text-slate-900">{strategy.recurring.length.toLocaleString()}</b> schedule(s)</span>
                        <span className="text-slate-600"><b className="text-slate-900">{strategy.jobplan.length.toLocaleString()}</b> job-plan step(s)</span>
                        {strategy.skipped > 0 && (
                            <span className="text-rose-700"><b>{strategy.skipped.toLocaleString()}</b> row(s) skipped</span>
                        )}
                    </div>

                    {strategy.issues.length > 0 && <ul className="mb-4">{strategy.issues.map((i, n) => <IssueRow key={n} issue={i} />)}</ul>}

                    <button
                        onClick={() => navigate('/recurring-work', { state: { cockpitImport: { recurring: strategy.recurring, jobplan: strategy.jobplan } } })}
                        disabled={strategy.recurring.length === 0 && strategy.jobplan.length === 0}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary-600 text-white px-4 py-2 text-sm font-semibold hover:bg-primary-700 disabled:opacity-60"
                    >
                        Import on Recurring Work <ArrowRight size={15} />
                    </button>
                    <p className="text-xs text-slate-400 mt-2">
                        Opens Recurring Work and runs both passes there, so the schedules and their steps are created by
                        the importer that owns them rather than a second copy of it.
                    </p>
                </section>
            )}

            {/* Outcome */}
            {result && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h3 className="font-semibold text-slate-800 mb-3">Result</h3>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                        <span className="text-emerald-700"><b>{result.inserted.toLocaleString()}</b> inserted</span>
                        <span className="text-slate-600"><b>{result.updated.toLocaleString()}</b> updated</span>
                        <span className="text-slate-600"><b>{result.skipped.toLocaleString()}</b> skipped</span>
                        <span className={result.failed > 0 ? 'text-rose-700' : 'text-slate-600'}>
                            <b>{result.failed.toLocaleString()}</b> failed
                        </span>
                    </div>
                    {(result.notes ?? []).map((n, i) => (
                        <p key={i} className="text-sm text-slate-600 mt-2 flex items-start gap-2">
                            <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />{n}
                        </p>
                    ))}
                    {result.failed > 0 && (
                        <ul className="mt-3 space-y-1">
                            {result.outcomes.filter(o => o.status === 'failed').slice(0, 20).map((o, i) => (
                                <li key={i} className="text-xs text-rose-700">
                                    Row {o.row} <span className="font-mono">{o.key}</span> — {o.reason}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}
        </div>
    );
};

export default CockpitImportPage;
