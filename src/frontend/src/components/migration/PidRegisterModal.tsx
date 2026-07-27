/**
 * PidRegisterModal — build the asset register from an as-built P&ID.
 *
 * The migration path assumes the customer has a spreadsheet of their assets.
 * Plenty do not: they have drawings, and the register is the thing they were
 * hoping ERS would give them. This reads the tags off the drawing and proposes
 * a register the engineer confirms.
 *
 * Two rules shape the UI. Nothing is imported that the reviewer has not seen —
 * every proposed row is listed with the reason it was proposed, and everything
 * discarded is listed too, because a silent drop is indistinguishable from a
 * bug. And the drawing is not treated as truth: an as-built can be years stale,
 * so this proposes and the engineer disposes.
 *
 * Writes go through bulkImportService.importAssets, the same hierarchy-aware,
 * per-row-reported path the spreadsheet importer uses — no second write path.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    X, Upload, Loader2, FileWarning, CheckCircle2, AlertTriangle, ArrowRight, Info,
} from 'lucide-react';
import { readPidPdf } from '../../lib/pidPdfText';
import {
    extractPidTags, toAssetImportRows,
    type ExtractionResult, type PdfTextItem, type ExtractedTag,
} from '../../lib/pidTagExtract';
import { importAssets } from '../../eam/services/bulkImportService';
import type { ImportResult } from '../../eam/services/importTypes';
import { useToast } from '../../eam/contexts/ToastContext';

interface Props {
    onClose: () => void;
    /** Called after a successful import so the caller can refresh its counts. */
    onImported?: () => void;
}

type Step = 'upload' | 'review' | 'done';

const CONFIDENCE_STYLES: Record<ExtractedTag['confidence'], string> = {
    high: 'bg-emerald-50 text-emerald-700',
    medium: 'bg-amber-50 text-amber-700',
    low: 'bg-slate-100 text-slate-500',
};

export const PidRegisterModal: React.FC<Props> = ({ onClose, onImported }) => {
    const { showToast } = useToast();
    const fileInput = useRef<HTMLInputElement>(null);

    const [step, setStep] = useState<Step>('upload');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fileName, setFileName] = useState('');
    const [items, setItems] = useState<PdfTextItem[]>([]);
    const [pageCount, setPageCount] = useState(0);

    // Review controls
    const [systemTag, setSystemTag] = useState('');
    const [systemName, setSystemName] = useState('');
    const [createSystem, setCreateSystem] = useState(true);
    const [includeInstruments, setIncludeInstruments] = useState(false);
    const [includeValves, setIncludeValves] = useState(true);
    const [includeLowConfidence, setIncludeLowConfidence] = useState(false);
    const [excluded, setExcluded] = useState<Set<string>>(new Set());
    const [result, setResult] = useState<ImportResult | null>(null);

    /**
     * Recognition is pure and fast, so policy changes re-derive from the stored
     * text rather than asking for the file again.
     */
    const extraction: ExtractionResult | null = useMemo(
        () => (items.length ? extractPidTags(items, { includeInstruments, includeValves }) : null),
        [items, includeInstruments, includeValves],
    );

    const visibleTags = useMemo(
        () => (extraction?.tags ?? []).filter(t => includeLowConfidence || t.confidence !== 'low'),
        [extraction, includeLowConfidence],
    );

    const selectedCount = visibleTags.filter(t => !excluded.has(t.tag)).length;

    const handleFile = useCallback(async (file: File) => {
        setBusy(true);
        setError(null);
        try {
            const read = await readPidPdf(file);
            if (read.looksScanned) {
                setError(
                    `"${file.name}" has almost no text in it — it is most likely a scan or an image export. ` +
                    'Tags can only be read from a vector PDF (one plotted from CAD). Ask for the native PDF, or add the equipment by hand.',
                );
                setBusy(false);
                return;
            }
            setItems(read.items);
            setPageCount(read.pages);
            setFileName(file.name);
            // A sensible default the reviewer can overwrite.
            const base = file.name.replace(/\.pdf$/i, '').slice(0, 40);
            setSystemName(prev => prev || base);
            setSystemTag(prev => prev || base.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20));
            setStep('review');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }, []);

    const toggle = (tag: string) => setExcluded(prev => {
        const next = new Set(prev);
        if (next.has(tag)) next.delete(tag); else next.add(tag);
        return next;
    });

    const doImport = async () => {
        if (!extraction) return;
        if (!systemTag.trim()) {
            setError('Give the system a tag — every item from this drawing is parented to it.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const kept: ExtractionResult = {
                ...extraction,
                tags: visibleTags.filter(t => !excluded.has(t.tag)),
            };
            const rows = toAssetImportRows(kept, {
                systemTag: systemTag.trim(),
                systemName: systemName.trim() || systemTag.trim(),
                createSystem,
                minConfidence: includeLowConfidence ? 'low' : 'medium',
            });
            const res = await importAssets(rows, { withBatch: true });
            setResult(res);
            setStep('done');
            if (res.inserted > 0) {
                showToast(`${res.inserted} assets created from ${fileName}`, 'success');
                onImported?.();
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-slate-100">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Build the register from a P&ID</h2>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Reads the equipment tags off an as-built drawing and proposes the assets they imply.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Close">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                    {error && (
                        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                            <FileWarning size={16} className="shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* ── Upload ── */}
                    {step === 'upload' && (
                        <div>
                            <button
                                onClick={() => fileInput.current?.click()}
                                disabled={busy}
                                className="w-full rounded-2xl border-2 border-dashed border-slate-200 hover:border-primary-300 hover:bg-primary-50/40 p-10 flex flex-col items-center gap-3 transition-colors disabled:opacity-60"
                            >
                                {busy
                                    ? <Loader2 size={26} className="animate-spin text-primary-500" />
                                    : <Upload size={26} className="text-slate-400" />}
                                <span className="text-sm font-semibold text-slate-700">
                                    {busy ? 'Reading the drawing…' : 'Choose a P&ID (PDF)'}
                                </span>
                                <span className="text-xs text-slate-400 max-w-md text-center">
                                    Works on vector PDFs plotted from CAD, where the tags are real text.
                                    A scanned drawing has nothing to read and will say so.
                                </span>
                            </button>
                            <input
                                ref={fileInput} type="file" accept=".pdf" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }}
                            />
                            <p className="mt-4 text-xs text-slate-400 flex items-start gap-1.5">
                                <Info size={13} className="shrink-0 mt-0.5" />
                                Nothing is uploaded — the drawing is read in your browser, and only the tags you
                                confirm are saved. Connectivity is not read here; that is drawn in the P&amp;ID editor.
                            </p>
                        </div>
                    )}

                    {/* ── Review ── */}
                    {step === 'review' && extraction && (
                        <div className="space-y-5">
                            <div className="text-xs text-slate-500">
                                <span className="font-semibold text-slate-700">{fileName}</span>
                                {' — '}{pageCount} page{pageCount === 1 ? '' : 's'}, {extraction.stats.itemsScanned.toLocaleString()} text runs scanned,
                                {' '}{extraction.stats.proposed} item{extraction.stats.proposed === 1 ? '' : 's'} proposed.
                            </div>

                            {/* Where it all hangs */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="block">
                                    <span className="text-xs font-semibold text-slate-600">System tag</span>
                                    <input
                                        value={systemTag} onChange={e => setSystemTag(e.target.value)}
                                        placeholder="SYS-COMP-01"
                                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs font-semibold text-slate-600">System name</span>
                                    <input
                                        value={systemName} onChange={e => setSystemName(e.target.value)}
                                        placeholder="Gas Compression Train"
                                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                    />
                                </label>
                            </div>

                            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                                <label className="flex items-center gap-1.5">
                                    <input type="checkbox" checked={createSystem} onChange={e => setCreateSystem(e.target.checked)} />
                                    Create the system too (uncheck if it already exists)
                                </label>
                                <label className="flex items-center gap-1.5">
                                    <input type="checkbox" checked={includeValves} onChange={e => setIncludeValves(e.target.checked)} />
                                    Include relief &amp; actuated valves
                                </label>
                                <label className="flex items-center gap-1.5">
                                    <input type="checkbox" checked={includeInstruments} onChange={e => setIncludeInstruments(e.target.checked)} />
                                    Include instrument loops
                                </label>
                                <label className="flex items-center gap-1.5">
                                    <input type="checkbox" checked={includeLowConfidence} onChange={e => setIncludeLowConfidence(e.target.checked)} />
                                    Show doubtful matches
                                </label>
                            </div>

                            {/* Proposals */}
                            <div className="rounded-xl border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 flex justify-between">
                                    <span>Proposed assets</span>
                                    <span>{selectedCount} of {visibleTags.length} selected</span>
                                </div>
                                {visibleTags.length === 0 ? (
                                    <p className="p-4 text-sm text-slate-500">
                                        No equipment tags were recognised. If the drawing uses a site-specific tag
                                        convention, it needs teaching before this can read it.
                                    </p>
                                ) : (
                                    <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                                        {visibleTags.map(t => (
                                            <label key={t.tag} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer">
                                                <input
                                                    type="checkbox" className="mt-1"
                                                    checked={!excluded.has(t.tag)}
                                                    onChange={() => toggle(t.tag)}
                                                />
                                                <span className="flex-1 min-w-0">
                                                    <span className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-mono text-sm font-semibold text-slate-800">{t.tag}</span>
                                                        <span className="text-sm text-slate-600">{t.equipmentClass}</span>
                                                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${CONFIDENCE_STYLES[t.confidence]}`}>
                                                            {t.confidence}
                                                        </span>
                                                        <span className="text-[10px] text-slate-400">
                                                            p{t.pages.join(', ')} · seen {t.occurrences}×
                                                        </span>
                                                    </span>
                                                    <span className="block text-xs text-slate-400 mt-0.5">{t.reason}</span>
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* What was not proposed — shown, never silent */}
                            {extraction.rejected.length > 0 && (
                                <details className="rounded-xl border border-slate-200">
                                    <summary className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-500 cursor-pointer">
                                        Not proposed ({extraction.rejected.length})
                                    </summary>
                                    <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
                                        {extraction.rejected.map(r => (
                                            <div key={r.text} className="px-4 py-2 text-xs flex items-baseline gap-3">
                                                <span className="font-mono text-slate-600 shrink-0">{r.text}</span>
                                                <span className="text-slate-400">{r.reason}</span>
                                                <span className="ml-auto text-slate-300">{r.occurrences}×</span>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}

                            <p className="text-xs text-slate-400 flex items-start gap-1.5">
                                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                                A drawing records the design, which may differ from what is installed. Treat this as a
                                first pass to confirm against the plant, and add nameplate details (make, model, serial)
                                afterwards — a P&amp;ID does not carry them.
                            </p>
                        </div>
                    )}

                    {/* ── Result ── */}
                    {step === 'done' && result && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <CheckCircle2 size={22} className="text-emerald-500" />
                                <div>
                                    <p className="font-semibold text-slate-800">
                                        {result.inserted} created, {result.skipped} skipped, {result.failed} failed
                                    </p>
                                    <p className="text-xs text-slate-500">from {fileName}</p>
                                </div>
                            </div>
                            {result.outcomes.some(o => o.status !== 'inserted') && (
                                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                                    {result.outcomes.filter(o => o.status !== 'inserted').map((o, i) => (
                                        <div key={`${o.key}-${i}`} className="px-4 py-2 text-xs flex items-baseline gap-3">
                                            <span className="font-mono text-slate-600 shrink-0">{o.key || `row ${o.row}`}</span>
                                            <span className={o.status === 'failed' ? 'text-rose-600' : 'text-slate-400'}>
                                                {o.status}
                                            </span>
                                            <span className="text-slate-400">{o.reason}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {result.notes?.map(n => (
                                <p key={n} className="text-xs text-slate-400">{n}</p>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t border-slate-100 p-4 flex justify-end gap-2">
                    {step === 'review' && (
                        <>
                            <button
                                onClick={() => { setStep('upload'); setItems([]); setError(null); }}
                                className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-sm font-medium px-4 py-2"
                            >
                                Choose another drawing
                            </button>
                            <button
                                onClick={() => void doImport()}
                                disabled={busy || selectedCount === 0}
                                className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"
                            >
                                {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                                Create {selectedCount} asset{selectedCount === 1 ? '' : 's'}
                                <ArrowRight size={14} />
                            </button>
                        </>
                    )}
                    {step !== 'review' && (
                        <button
                            onClick={onClose}
                            className="rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold px-4 py-2"
                        >
                            {step === 'done' ? 'Done' : 'Close'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PidRegisterModal;
