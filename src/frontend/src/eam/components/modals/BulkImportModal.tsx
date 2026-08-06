/**
 * BulkImportModal — Universal wizard for bulk importing data from Excel/CSV
 * Supports: Assets, BOMs, Recurring Jobs, People, Inventory, Work Orders, Locations, Vendors
 * Steps: Select Type → Upload → Validate → Import
 */
import React, { useState, useCallback, useRef } from 'react';
import {
    X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle,
    XCircle, Download, ChevronRight, Loader2, FileCheck,
    Wrench, Users, Package, Building2, CalendarClock, Boxes, Gauge, ListChecks, Tags
} from 'lucide-react';
import {
    parseImportFile, detectImportType,
    downloadAssetTemplate, downloadBOMTemplate,
    downloadRecurringJobTemplate, downloadPeopleTemplate,
    downloadInventoryTemplate, downloadVendorTemplate,
    downloadReadingsTemplate, downloadJobPlanTemplate, downloadFailureCodesTemplate,
    type ImportType, type ParseResult, type ParsedRow
} from '../../services/assetTemplates';
import { outcomesToCsv, type ImportResult } from '../../services/importTypes';

// ─── Import type metadata ───────────────────────────────────────
// Functional locations are asset rows (FLOC-class hierarchy levels), so the
// asset template carries the whole tree — there is no separate Locations type.
// Work-order *history* belongs to the CMMS Import Wizard (/specialist/import),
// which maps foreign columns and gives you a rollback-able batch.
const IMPORT_TYPES: { type: ImportType; label: string; desc: string; icon: React.ReactNode; color: string; downloadFn: () => void }[] = [
    { type: 'asset',     label: 'Assets',          desc: 'Equipment & hierarchy',          icon: <Wrench size={20} />,         color: 'blue',    downloadFn: downloadAssetTemplate },
    { type: 'bom',       label: 'BOM',             desc: 'Bills of materials',             icon: <Boxes size={20} />,          color: 'emerald', downloadFn: downloadBOMTemplate },
    { type: 'recurring', label: 'Recurring Jobs',  desc: 'PM/PdM schedules',               icon: <CalendarClock size={20} />,  color: 'violet',  downloadFn: downloadRecurringJobTemplate },
    { type: 'people',    label: 'People',          desc: 'Contacts & personnel',           icon: <Users size={20} />,          color: 'cyan',    downloadFn: downloadPeopleTemplate },
    { type: 'inventory', label: 'Inventory',       desc: 'Spare parts & stock',            icon: <Package size={20} />,        color: 'amber',   downloadFn: downloadInventoryTemplate },
    { type: 'vendor',    label: 'Vendors',         desc: 'Suppliers & contractors',         icon: <Building2 size={20} />,      color: 'orange',  downloadFn: downloadVendorTemplate },
    { type: 'readings',  label: 'Readings',        desc: 'Meter & condition history',       icon: <Gauge size={20} />,          color: 'rose',    downloadFn: downloadReadingsTemplate },
    { type: 'jobplan',   label: 'Job Plans',       desc: 'PM task lists & operations',      icon: <ListChecks size={20} />,     color: 'violet',  downloadFn: downloadJobPlanTemplate },
    { type: 'failurecodes', label: 'Failure Codes', desc: 'Your ISO 14224 / SAP catalogs',   icon: <Tags size={20} />,           color: 'teal',    downloadFn: downloadFailureCodesTemplate },
];

// Display label per type
const TYPE_LABELS: Record<ImportType, string> = {
    asset: 'Assets', bom: 'BOM Items', recurring: 'Recurring Jobs', people: 'People',
    inventory: 'Inventory Items', workorder: 'Work Orders', location: 'Locations',
    vendor: 'Vendors', readings: 'Readings', jobplan: 'Job Plans', failurecodes: 'Failure Codes', unknown: 'Records',
};

// Key field to show in validation table per type
const KEY_FIELDS: Record<ImportType, [string, string]> = {
    asset: ['tag', 'name'],
    bom: ['assettag', 'inventorycode'],
    recurring: ['code', 'description'],
    people: ['code', 'name'],
    inventory: ['code', 'description'],
    workorder: ['wonumber', 'description'],
    location: ['tag', 'name'],
    vendor: ['code', 'name'],
    readings: ['assettag', 'readingtype'],
    jobplan: ['pmcode', 'description'],
    failurecodes: ['code', 'description'],
    unknown: ['', ''],
};

interface BulkImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    preSelectedType?: ImportType;
    /** Restrict the type-selector grid to only these types */
    allowedTypes?: ImportType[];
    /**
     * Generic callback — caller interprets rows by type. Returning an
     * ImportResult makes the completion screen report what actually landed;
     * a void return falls back to the pre-validation count (clearly labelled).
     */
    onImportData: (type: ImportType, rows: Record<string, string>[]) => Promise<ImportResult | void>;
    /** Raw-row asset handler. Hierarchy resolution happens in the handler. */
    onImportAssets?: (rows: Record<string, string>[]) => Promise<ImportResult | void>;
    /** Raw-row BOM handler — the engine (importBoms) owns resolution and dedup. */
    onImportBOMs?: (rows: Record<string, string>[]) => Promise<ImportResult | void>;
}

type Step = 'select' | 'upload' | 'validate' | 'importing';

export default function BulkImportModal({
    isOpen, onClose, preSelectedType, allowedTypes, onImportData,
    onImportAssets, onImportBOMs
}: BulkImportModalProps) {
    const [step, setStep] = useState<Step>(preSelectedType ? 'upload' : 'select');
    const [selectedType, setSelectedType] = useState<ImportType>(preSelectedType || 'asset');
    const [parseResult, setParseResult] = useState<ParseResult | null>(null);
    const [fileName, setFileName] = useState('');
    const [importing, setImporting] = useState(false);
    const [importDone, setImportDone] = useState(false);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    /** Advisory only: the file's headers look like a different template. */
    const [typeMismatch, setTypeMismatch] = useState<ImportType | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const reset = () => {
        setStep(preSelectedType ? 'upload' : 'select');
        setSelectedType(preSelectedType || 'asset');
        setParseResult(null);
        setFileName('');
        setImporting(false);
        setImportDone(false);
        setResult(null);
        setImportError(null);
        setTypeMismatch(null);
    };

    const handleClose = () => { reset(); onClose(); };

    const handleTypeSelect = (type: ImportType) => {
        setSelectedType(type);
        setStep('upload');
    };

    // ── File Upload ──
    const handleFile = useCallback(async (file: File) => {
        setFileName(file.name);
        setImportError(null);
        try {
            const parsed = await parseImportFile(file, selectedType !== 'unknown' ? selectedType : undefined);
            setParseResult(parsed);
            // Detection stays ADVISORY — a user may deliberately import a file
            // with unusual headers as a chosen type. We only warn on mismatch
            // so a work-order file dropped on the People page can't sail
            // through silently mis-parsed.
            const detected = detectImportType(Object.keys(parsed.rows[0]?.data ?? {}));
            setTypeMismatch(detected !== 'unknown' && detected !== selectedType ? detected : null);
            setStep('validate');
        } catch (err) {
            alert('Failed to parse file. Please ensure it is a valid .xlsx or .csv file.');
        }
    }, [selectedType]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    // ── Import ──
    const handleImport = async () => {
        if (!parseResult) return;
        setStep('importing');
        setImporting(true);
        setImportError(null);

        // Row numbers travel with the data so outcomes can point back at the
        // user's spreadsheet rather than at an opaque zero-based index.
        const validParsed = parseResult.rows.filter(r => r.isValid);
        const validRows: Record<string, string>[] = validParsed.map(r => ({ ...r.data, __row: String(r.rowIndex) }));

        try {
            // Assets go through the hierarchy-aware engine as RAW rows — the
            // modal no longer pre-flattens them (that path silently dropped
            // parentTag and defaulted every criticality to 'C').
            if (parseResult.type === 'asset' && onImportAssets) {
                const res = await onImportAssets(validRows);
                if (res) setResult(res);
            } else if (parseResult.type === 'bom' && onImportBOMs) {
                // Raw rows, like assets: the engine resolves codes and reports
                // per-row outcomes. The old path pre-grouped here and returned
                // nothing, so the result screen never showed BOM failures.
                const res = await onImportBOMs(validRows);
                if (res) setResult(res);
            } else {
                const res = await onImportData(parseResult.type, validRows);
                if (res) setResult(res);
            }
        } catch (err) {
            // A throw here means the whole run died, not one row — say so
            // instead of showing a green "Import Complete".
            console.error('Import error:', err);
            setImportError(err instanceof Error ? err.message : String(err));
        }

        setImporting(false);
        setImportDone(true);
    };

    const downloadFailures = () => {
        if (!result) return;
        const blob = new Blob([outcomesToCsv(result)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `import-issues-${selectedType}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!isOpen) return null;

    const typeMeta = IMPORT_TYPES.find(t => t.type === selectedType) || IMPORT_TYPES[0];
    const typeLabel = TYPE_LABELS[parseResult?.type || selectedType] || 'Records';
    const stepLabels: { key: Step; label: string }[] = preSelectedType
        ? [{ key: 'upload', label: 'Upload' }, { key: 'validate', label: 'Validate' }, { key: 'importing', label: 'Import' }]
        : [{ key: 'select', label: 'Select' }, { key: 'upload', label: 'Upload' }, { key: 'validate', label: 'Validate' }, { key: 'importing', label: 'Import' }];
    const currentIdx = stepLabels.findIndex(s => s.key === step);

    const [keyField1, keyField2] = KEY_FIELDS[parseResult?.type || selectedType] || ['', ''];

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Bulk Import</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Import data from Excel (.xlsx) or CSV files
                        </p>
                    </div>
                    <button onClick={handleClose} className="p-2 hover:bg-slate-100 rounded-lg transition"><X size={18} /></button>
                </div>

                {/* Steps Indicator */}
                <div className="flex items-center gap-2 px-6 py-3 bg-slate-50 border-b border-slate-100">
                    {stepLabels.map((s, i) => (
                        <React.Fragment key={s.key}>
                            <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition
                                ${i < currentIdx ? 'bg-emerald-100 text-emerald-700' :
                                    i === currentIdx ? 'bg-blue-100 text-blue-700' :
                                        'bg-slate-100 text-slate-400'}`}>
                                {i < currentIdx ? <CheckCircle2 size={14} /> : <span className="w-4 h-4 flex items-center justify-center text-[10px] rounded-full border border-current">{i + 1}</span>}
                                {s.label}
                            </div>
                            {i < stepLabels.length - 1 && <ChevronRight size={14} className="text-slate-300" />}
                        </React.Fragment>
                    ))}
                    {fileName && (
                        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
                            <FileSpreadsheet size={14} className="text-emerald-500" />
                            {fileName}
                        </div>
                    )}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-auto p-6">
                    {/* ── SELECT TYPE ── */}
                    {step === 'select' && (
                        <div>
                            <div className="text-sm font-semibold text-slate-700 mb-4">What would you like to import?</div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {IMPORT_TYPES.filter(t => !allowedTypes || allowedTypes.includes(t.type)).map(t => (
                                    <button
                                        key={t.type}
                                        onClick={() => handleTypeSelect(t.type)}
                                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-slate-200 hover:border-${t.color}-400 hover:bg-${t.color}-50/30 transition-all group text-center`}
                                    >
                                        <div className={`p-2.5 rounded-xl bg-${t.color}-100 text-${t.color}-600 group-hover:bg-${t.color}-200 transition`}>
                                            {t.icon}
                                        </div>
                                        <div className="text-xs font-bold text-slate-800">{t.label}</div>
                                        <div className="text-[10px] text-slate-400 leading-tight">{t.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── UPLOAD ── */}
                    {step === 'upload' && (
                        <div className="space-y-6">
                            <div
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                                onClick={() => fileRef.current?.click()}
                                className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all"
                            >
                                <Upload size={40} className="mx-auto mb-3 text-slate-400" />
                                <div className="text-sm font-semibold text-slate-700">Drag & drop your {typeMeta.label} file here</div>
                                <div className="text-xs text-slate-400 mt-1">or click to browse • Supports .xlsx and .csv</div>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".xlsx,.csv,.xls"
                                    onChange={handleFileInput}
                                    className="hidden"
                                />
                            </div>

                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                                <h4 className="text-xs font-bold text-slate-600 uppercase mb-3">Download Template</h4>
                                <button
                                    onClick={typeMeta.downloadFn}
                                    className="flex items-center gap-3 p-3 bg-white rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-all group w-full"
                                >
                                    <div className="p-2 bg-blue-100 rounded-lg text-blue-600 group-hover:bg-blue-200">
                                        <Download size={18} />
                                    </div>
                                    <div className="text-left">
                                        <div className="text-sm font-semibold text-slate-800">{typeMeta.label} Template</div>
                                        <div className="text-[10px] text-slate-400">With examples, instructions & validation rules</div>
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── VALIDATE ── */}
                    {step === 'validate' && parseResult && (
                        <div className="space-y-4">
                            {/* Summary stats */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
                                    <div className="text-2xl font-bold text-slate-800">{parseResult.rows.length}</div>
                                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Rows</div>
                                </div>
                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                                    <div className="text-2xl font-bold text-emerald-700">{parseResult.validCount}</div>
                                    <div className="text-[10px] text-emerald-600 uppercase font-semibold">Valid</div>
                                </div>
                                <div className={`border rounded-xl p-4 text-center ${parseResult.errorCount > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                                    <div className={`text-2xl font-bold ${parseResult.errorCount > 0 ? 'text-red-700' : 'text-slate-400'}`}>{parseResult.errorCount}</div>
                                    <div className={`text-[10px] uppercase font-semibold ${parseResult.errorCount > 0 ? 'text-red-600' : 'text-slate-500'}`}>Errors</div>
                                </div>
                            </div>

                            {parseResult.type === 'unknown' && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="text-sm font-semibold text-amber-800">Unrecognized format</div>
                                        <div className="text-xs text-amber-600 mt-0.5">
                                            Headers did not match any known template. Please download the correct template and try again.
                                        </div>
                                    </div>
                                </div>
                            )}

                            {typeMismatch && (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                    <div>
                                        <div className="text-sm font-semibold text-amber-800">
                                            This looks like a {TYPE_LABELS[typeMismatch]} file
                                        </div>
                                        <div className="text-xs text-amber-600 mt-0.5">
                                            It will be imported as {TYPE_LABELS[parseResult.type]}. If that's not what you meant,
                                            go back and download the {TYPE_LABELS[typeMismatch]} template instead.
                                        </div>
                                    </div>
                                </div>
                            )}

                            {parseResult.type !== 'unknown' && !typeMismatch && (
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-2">
                                    <FileCheck size={16} className="text-blue-500" />
                                    <span className="text-xs font-semibold text-blue-700">
                                        Detected: {TYPE_LABELS[parseResult.type]} Import
                                    </span>
                                </div>
                            )}

                            {/* Row-level validation table */}
                            <div className="border border-slate-200 rounded-xl overflow-hidden">
                                <div className="max-h-64 overflow-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50 sticky top-0">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-bold text-slate-500">Row</th>
                                                <th className="px-3 py-2 text-left font-bold text-slate-500">Status</th>
                                                <th className="px-3 py-2 text-left font-bold text-slate-500">{keyField1 || 'Key'}</th>
                                                <th className="px-3 py-2 text-left font-bold text-slate-500">{keyField2 || 'Description'}</th>
                                                <th className="px-3 py-2 text-left font-bold text-slate-500">Issues</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {parseResult.rows.map(row => (
                                                <tr key={row.rowIndex} className={row.isValid ? 'bg-white' : 'bg-red-50/30'}>
                                                    <td className="px-3 py-2 font-mono text-slate-400">{row.rowIndex}</td>
                                                    <td className="px-3 py-2">
                                                        {row.isValid ? (
                                                            <CheckCircle2 size={14} className="text-emerald-500" />
                                                        ) : (
                                                            <XCircle size={14} className="text-red-500" />
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 font-semibold text-slate-700">
                                                        {row.data[keyField1] || '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-slate-600 max-w-[180px] truncate">
                                                        {row.data[keyField2] || '—'}
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {row.errors.map((e, i) => (
                                                            <span key={`e${i}`} className="inline-block text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded mr-1 mb-0.5">{e}</span>
                                                        ))}
                                                        {row.warnings.map((w, i) => (
                                                            <span key={`w${i}`} className="inline-block text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded mr-1 mb-0.5">{w}</span>
                                                        ))}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── IMPORTING / DONE ── */}
                    {step === 'importing' && (
                        <div className="flex flex-col items-center justify-center py-12">
                            {importing ? (
                                <>
                                    <Loader2 size={48} className="text-blue-500 animate-spin mb-4" />
                                    <div className="text-lg font-semibold text-slate-800">Importing...</div>
                                    <div className="text-sm text-slate-500">Processing {parseResult?.validCount} {typeLabel.toLowerCase()}</div>
                                </>
                            ) : importDone ? (
                                <div className="w-full">
                                    {importError ? (
                                        <div className="flex flex-col items-center">
                                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                                                <XCircle size={32} className="text-red-600" />
                                            </div>
                                            <div className="text-lg font-semibold text-slate-800">Import failed</div>
                                            <div className="text-sm text-red-600 mt-1 max-w-md text-center font-mono text-xs">{importError}</div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center">
                                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${result && result.failed > 0 ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                                                <CheckCircle2 size={32} className={result && result.failed > 0 ? 'text-amber-600' : 'text-emerald-600'} />
                                            </div>
                                            <div className="text-lg font-semibold text-slate-800">
                                                {result && result.failed > 0 ? 'Import finished with issues' : 'Import Complete!'}
                                            </div>
                                            {result ? (
                                                <div className="flex items-center gap-3 mt-4">
                                                    {[
                                                        { label: 'Imported', value: result.inserted, cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                                                        // Only a sync-mode run produces updates. Shown apart from
                                                        // "Imported" because an overwritten record is not a new one,
                                                        // and hidden at zero so a one-time migration reads as before.
                                                        ...(result.updated > 0
                                                            ? [{ label: 'Updated', value: result.updated, cls: 'bg-blue-50 border-blue-200 text-blue-700' }]
                                                            : []),
                                                        { label: 'Skipped', value: result.skipped, cls: 'bg-slate-50 border-slate-200 text-slate-600' },
                                                        { label: 'Failed', value: result.failed, cls: result.failed > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-400' },
                                                    ].map(s => (
                                                        <div key={s.label} className={`border rounded-xl px-5 py-3 text-center ${s.cls}`}>
                                                            <div className="text-2xl font-bold">{s.value}</div>
                                                            <div className="text-[10px] uppercase font-semibold">{s.label}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-sm text-slate-500 mt-1">
                                                    {parseResult?.validCount} {typeLabel.toLowerCase()} submitted
                                                    <span className="text-slate-400"> (pre-validation count)</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Batch-level notes */}
                                    {result?.notes && result.notes.length > 0 && (
                                        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                                            {result.notes.map((n, i) => (
                                                <div key={i} className="text-xs text-slate-600">• {n}</div>
                                            ))}
                                        </div>
                                    )}

                                    {/* What didn't land, and why */}
                                    {result && (result.failed > 0 || result.skipped > 0) && (
                                        <div className="mt-5">
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-xs font-bold text-slate-600 uppercase">Rows needing attention</h4>
                                                <button onClick={downloadFailures} className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800">
                                                    <Download size={13} /> Download CSV
                                                </button>
                                            </div>
                                            <div className="border border-slate-200 rounded-xl overflow-hidden">
                                                <div className="max-h-52 overflow-auto">
                                                    <table className="w-full text-xs">
                                                        <thead className="bg-slate-50 sticky top-0">
                                                            <tr>
                                                                <th className="px-3 py-2 text-left font-bold text-slate-500">Row</th>
                                                                <th className="px-3 py-2 text-left font-bold text-slate-500">Key</th>
                                                                <th className="px-3 py-2 text-left font-bold text-slate-500">Status</th>
                                                                <th className="px-3 py-2 text-left font-bold text-slate-500">Reason</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {result.outcomes.filter(o => o.status !== 'inserted').map((o, i) => (
                                                                <tr key={`${o.row}-${i}`} className={o.status === 'failed' ? 'bg-red-50/30' : 'bg-white'}>
                                                                    <td className="px-3 py-2 font-mono text-slate-400">{o.row}</td>
                                                                    <td className="px-3 py-2 font-semibold text-slate-700">{o.key || '—'}</td>
                                                                    <td className="px-3 py-2">
                                                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${o.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{o.status}</span>
                                                                    </td>
                                                                    <td className="px-3 py-2 text-slate-600">{o.reason || '—'}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex justify-center">
                                        <button
                                            onClick={handleClose}
                                            className="mt-6 px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium"
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {step !== 'importing' && !importDone && (
                    <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
                        <button
                            onClick={step === 'select' || (step === 'upload' && preSelectedType)
                                ? handleClose
                                : () => setStep(step === 'validate' ? 'upload' : step === 'upload' ? 'select' : 'select')}
                            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 font-medium"
                        >
                            {step === 'select' || (step === 'upload' && preSelectedType) ? 'Cancel' : '← Back'}
                        </button>

                        {step === 'validate' && parseResult && parseResult.validCount > 0 && (
                            <button
                                onClick={handleImport}
                                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-primary-500 transition font-semibold text-sm flex items-center gap-2"
                            >
                                Import {parseResult.validCount} of {parseResult.rows.length} {typeLabel}
                                <ChevronRight size={16} />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
