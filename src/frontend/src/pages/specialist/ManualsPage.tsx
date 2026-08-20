/**
 * ManualsPage — teach the Specialist your own documentation (Phase 3, 0222).
 *
 * Upload OEM manuals / SOPs → text is extracted in the browser → chunked →
 * indexed for full-text retrieval. The search box below works with no AI
 * credits at all: it is the raw retrieval the agent sees, which also makes it
 * the honest way to check what the index actually contains.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ArrowLeft, BookOpen, UploadCloud, Loader2, AlertTriangle, Search,
    Trash2, FileText, Sparkles, CheckCircle2,
} from 'lucide-react';
import { manualService, type ManualDocument, type ManualHit } from '../../eam/services/ManualService';
import { estimateTokens, type ManualChunk } from '../../lib/manualChunker';
import AdvisoryAgentPanel from '../../eam/components/ui/AdvisoryAgentPanel';
import { runManualReader } from '../../eam/services/agentRunClient';

const DOC_TYPES = [
    { value: 'oem_manual', label: 'OEM manual' },
    { value: 'sop', label: 'SOP / procedure' },
    { value: 'datasheet', label: 'Datasheet' },
    { value: 'standard', label: 'Standard / code' },
    { value: 'other', label: 'Other' },
];

export const ManualsPage: React.FC = () => {
    const navigate = useNavigate();
    const fileRef = useRef<HTMLInputElement>(null);

    const [docs, setDocs] = useState<ManualDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // staged upload
    const [chunks, setChunks] = useState<ManualChunk[] | null>(null);
    const [name, setName] = useState('');
    const [docType, setDocType] = useState('oem_manual');
    const [assetTag, setAssetTag] = useState('');
    const [equipClass, setEquipClass] = useState('');

    // retrieval check
    const [query, setQuery] = useState('');
    const [hits, setHits] = useState<ManualHit[] | null>(null);
    const [searching, setSearching] = useState(false);

    const load = async () => {
        setLoading(true);
        setDocs(await manualService.listDocuments());
        setLoading(false);
    };
    useEffect(() => { void load(); }, []);

    const handleFile = async (file: File) => {
        setBusy(true); setError(null); setNotice(null); setChunks(null);
        try {
            const prepared = await manualService.prepare(file);
            setChunks(prepared);
            setName(file.name);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const index = async () => {
        if (!chunks) return;
        setBusy(true); setError(null);
        try {
            const written = await manualService.ingest(chunks, {
                source: name,
                document_type: docType,
                asset_tag: assetTag || null,
                equipment_class: equipClass || null,
            });
            setNotice(`Indexed ${written} passage(s) from ${name}. Your Specialist can now cite it.`);
            setChunks(null); setName(''); setAssetTag(''); setEquipClass('');
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const runSearch = async () => {
        if (!query.trim()) return;
        setSearching(true);
        try {
            setHits(await manualService.search(query));
        } finally {
            setSearching(false);
        }
    };

    const remove = async (source: string) => {
        if (!window.confirm(`Remove "${source}" from the index?`)) return;
        try {
            await manualService.deleteDocument(source);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const totalChunks = docs.reduce((s, d) => s + d.chunks, 0);

    return (
        <div className="ers-page-form space-y-5 pb-24 animate-in fade-in duration-300">
            <div>
                <button onClick={() => navigate('/specialist')}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3">
                    <ArrowLeft size={15} /> Specialist workspace
                </button>
                <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                    <BookOpen size={20} className="text-primary-600" /> Manuals & procedures
                </h1>
                <p className="text-slate-500 text-sm mt-1">
                    An engineer who has read your OEM manuals beats one working from general knowledge.
                    Index them here and the Specialist answers with a document and page number instead of a guess.
                </p>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
                </div>
            )}
            {notice && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> {notice}
                </div>
            )}

            {/* Upload / stage */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                {!chunks ? (
                    <>
                        <button onClick={() => fileRef.current?.click()} disabled={busy}
                            className="w-full rounded-2xl border-2 border-dashed border-primary-200 bg-primary-50/40 hover:bg-primary-50 transition-colors p-8 flex flex-col items-center gap-2 text-primary-700">
                            {busy ? <Loader2 size={28} className="animate-spin" /> : <UploadCloud size={28} />}
                            <span className="font-semibold">{busy ? 'Reading the document…' : 'Add a manual or procedure'}</span>
                            <span className="text-xs text-primary-600">PDF, TXT or MD — the file is read in your browser; only the text is stored</span>
                        </button>
                        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }} />
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <FileText size={16} className="text-primary-600" /> Ready to index
                            <span className="text-xs font-normal text-slate-400">
                                {chunks.length} passage(s) · ~{estimateTokens(chunks.map((c) => c.chunk_text).join(' ')).toLocaleString()} tokens
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="font-medium text-slate-600">Document name</span>
                                <input value={name} onChange={(e) => setName(e.target.value)}
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700" />
                            </label>
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="font-medium text-slate-600">Type</span>
                                <select value={docType} onChange={(e) => setDocType(e.target.value)}
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700">
                                    {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="font-medium text-slate-600">Asset tag (optional)</span>
                                <input value={assetTag} onChange={(e) => setAssetTag(e.target.value)} placeholder="P-101"
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700 font-mono" />
                                <span className="text-[10px] text-slate-400">Scopes searches to this equipment</span>
                            </label>
                            <label className="flex flex-col gap-1 text-xs">
                                <span className="font-medium text-slate-600">Equipment class (optional)</span>
                                <input value={equipClass} onChange={(e) => setEquipClass(e.target.value)} placeholder="Centrifugal pump"
                                    className="rounded-lg border border-slate-200 px-2 py-1.5 bg-white text-slate-700" />
                            </label>
                        </div>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 max-h-32 overflow-y-auto">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">First passage preview</div>
                            <p className="text-xs text-slate-600 whitespace-pre-wrap">{chunks[0].chunk_text.slice(0, 400)}…</p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => void index()} disabled={busy || !name.trim()}
                                className="flex items-center gap-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-5 py-2.5 disabled:opacity-50 transition-colors">
                                {busy ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />} Index this document
                            </button>
                            <button onClick={() => { setChunks(null); setName(''); }}
                                className="text-sm text-slate-500 hover:text-slate-700 px-3">Cancel</button>
                        </div>
                    </>
                )}
            </section>

            {/* Retrieval check — works with no AI credits */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Search size={15} className="text-slate-500" /> Search the index
                    <span className="text-[11px] font-normal text-slate-400">— exactly what the Specialist retrieves</span>
                </h2>
                <div className="flex gap-2">
                    <input value={query} onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
                        placeholder="mechanical seal flush plan, bearing clearance, torque spec…"
                        className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" />
                    <button onClick={() => void runSearch()} disabled={searching || !query.trim()}
                        className="rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 disabled:opacity-40">
                        {searching ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
                    </button>
                </div>
                {hits !== null && (
                    hits.length === 0 ? (
                        <p className="text-sm text-slate-400 italic">
                            No passage matched. Try the words the manual itself would use — full-text search matches vocabulary, not meaning.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {hits.map((h) => (
                                <div key={h.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mb-1">
                                        <FileText size={11} />
                                        <span className="font-semibold text-slate-700">{h.source}</span>
                                        {h.page_number && <span>page {h.page_number}</span>}
                                        <span className="ml-auto font-mono">score {h.score.toFixed(3)}</span>
                                    </div>
                                    <p className="text-xs text-slate-600 line-clamp-4">{h.chunk_text}</p>
                                </div>
                            ))}
                        </div>
                    )
                )}
            </section>

            {/* Ask the reader (needs AI credits) */}
            <AdvisoryAgentPanel
                title="Ask the Manual Reader"
                subtitle="Answers from your indexed documentation, cited by document and page — and says plainly when the manuals don't cover it"
                icon={<Sparkles size={16} />}
                accent="primary"
                runLabel="Ask"
                inputPlaceholder="What is the recommended lubrication interval for P-101?"
                onRun={(input) => runManualReader(input)}
            />

            {/* Indexed documents */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-bold text-slate-800 mb-3">
                    Indexed documents
                    {docs.length > 0 && <span className="text-slate-400 font-normal"> — {docs.length} document(s), {totalChunks.toLocaleString()} passages</span>}
                </h2>
                {loading ? (
                    <Loader2 size={16} className="animate-spin text-slate-400" />
                ) : docs.length === 0 ? (
                    <p className="text-sm text-slate-400 italic">
                        Nothing indexed yet. Until a manual is added, the Specialist will say so rather than invent a specification.
                    </p>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {docs.map((d) => (
                            <div key={d.source} className="py-2.5 flex items-center gap-3 text-sm">
                                <FileText size={14} className="text-slate-300 shrink-0" />
                                <span className="font-medium text-slate-700 truncate">{d.source}</span>
                                <span className="text-[10px] uppercase tracking-wider bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5">
                                    {d.document_type.replaceAll('_', ' ')}
                                </span>
                                {d.asset_tag && <span className="text-xs font-mono text-primary-600">{d.asset_tag}</span>}
                                <span className="text-xs text-slate-400 ml-auto">{d.chunks} passages</span>
                                <button onClick={() => void remove(d.source)} title="Remove from index"
                                    className="text-slate-300 hover:text-rose-500">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

export default ManualsPage;
