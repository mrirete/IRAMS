/**
 * ManualService — the Specialist's reading of your own documentation
 * (Phase 3, migration 0222). An engineer who has read the OEM manual beats
 * one working from general knowledge, and every answer can cite a page.
 *
 * Extraction runs in the browser (pdfjs, lazily imported) so manual files
 * never leave the customer's machine on their way into the index — only the
 * extracted text chunks are stored.
 *
 * Retrieval is Postgres full-text today via the search_manual_chunks RPC.
 * The embedding column is reserved for semantic search; nothing here needs
 * to change when it is populated.
 */
import { supabase } from '../lib/supabase';
import { chunkPages, type ManualChunk, type SourcePage } from '../../lib/manualChunker';

export interface ManualDocument {
    source: string;
    document_type: string;
    asset_tag: string | null;
    equipment_class: string | null;
    chunks: number;
    created_at: string;
}

export interface ManualHit {
    id: string;
    source: string;
    chunk_index: number;
    chunk_text: string;
    page_number: number | null;
    asset_tag: string | null;
    equipment_class: string | null;
    document_type: string;
    score: number;
}

export interface IngestMeta {
    source: string;
    document_type?: string;
    asset_tag?: string | null;
    equipment_class?: string | null;
}

const INSERT_CHUNK = 200;

class ManualService {
    private static instance: ManualService;
    public static getInstance(): ManualService {
        if (!ManualService.instance) ManualService.instance = new ManualService();
        return ManualService.instance;
    }

    /**
     * Pull text out of an uploaded file. PDFs go through pdfjs page by page so
     * chunks keep their page number for citation; .txt/.md are taken whole.
     */
    public async extractPages(file: File): Promise<SourcePage[]> {
        const name = file.name.toLowerCase();

        if (name.endsWith('.txt') || name.endsWith('.md')) {
            return [{ page: null, text: await file.text() }];
        }
        if (!name.endsWith('.pdf')) {
            throw new Error('Unsupported file type — upload a PDF, TXT or MD file.');
        }

        // Lazy import: pdfjs is ~2 MB and only needed when a PDF is uploaded.
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url,
        ).toString();

        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const pages: SourcePage[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            // hasEOL preserves the line structure that de-hyphenation and
            // paragraph detection in manualChunker depend on.
            const text = content.items
                .map((item) => {
                    const it = item as { str?: string; hasEOL?: boolean };
                    if (typeof it.str !== 'string') return '';
                    return it.hasEOL ? `${it.str}\n` : `${it.str} `;
                })
                .join('');
            pages.push({ page: i, text });
        }
        return pages;
    }

    /** Extract + chunk in one step, without writing anything. */
    public async prepare(file: File): Promise<ManualChunk[]> {
        const pages = await this.extractPages(file);
        const chunks = chunkPages(pages);
        if (chunks.length === 0) {
            throw new Error('No readable text found — this may be a scanned PDF, which needs OCR before it can be indexed.');
        }
        return chunks;
    }

    /**
     * Index a document's chunks. Re-ingesting the same source replaces its
     * chunks rather than duplicating them (a unique index backs this up).
     */
    public async ingest(chunks: ManualChunk[], meta: IngestMeta): Promise<number> {
        const source = meta.source.trim();
        if (!source) throw new Error('A document name is required.');

        await this.deleteDocument(source).catch(() => { /* nothing indexed yet */ });

        let written = 0;
        for (let i = 0; i < chunks.length; i += INSERT_CHUNK) {
            const rows = chunks.slice(i, i + INSERT_CHUNK).map((c) => ({
                source,
                chunk_index: c.chunk_index,
                chunk_text: c.chunk_text,
                page_number: c.page_number,
                asset_tag: meta.asset_tag || null,
                equipment_class: meta.equipment_class || null,
                document_type: meta.document_type || 'oem_manual',
                metadata: { ingested_at: new Date().toISOString() },
            }));
            const { error } = await supabase.from('ers_rag_documents').insert(rows);
            if (error) throw new Error(`Indexing failed at chunk ${i}: ${error.message}`);
            written += rows.length;
        }
        return written;
    }

    /** Ranked full-text search over indexed manuals. */
    public async search(query: string, assetTag?: string, limit = 8): Promise<ManualHit[]> {
        const q = query.trim();
        if (!q) return [];
        const { data, error } = await supabase.rpc('search_manual_chunks', {
            q,
            asset: assetTag?.trim() || null,
            max_results: limit,
        });
        if (error) {
            console.error('search_manual_chunks failed:', error.message);
            return [];
        }
        return (data ?? []) as ManualHit[];
    }

    /** Indexed documents, grouped from their chunks (chunk_text is never fetched). */
    public async listDocuments(): Promise<ManualDocument[]> {
        const { data, error } = await supabase
            .from('ers_rag_documents')
            .select('source, document_type, asset_tag, equipment_class, created_at')
            .limit(20000);
        if (error) {
            console.warn('listDocuments unavailable:', error.message);
            return [];
        }
        const bySource = new Map<string, ManualDocument>();
        for (const r of (data ?? []) as Record<string, string | null>[]) {
            const key = String(r.source);
            const existing = bySource.get(key);
            if (existing) {
                existing.chunks += 1;
                continue;
            }
            bySource.set(key, {
                source: key,
                document_type: String(r.document_type ?? 'oem_manual'),
                asset_tag: r.asset_tag ?? null,
                equipment_class: r.equipment_class ?? null,
                chunks: 1,
                created_at: String(r.created_at ?? ''),
            });
        }
        return [...bySource.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    /** Remove a document from the index (admin-only at the RLS layer). */
    public async deleteDocument(source: string): Promise<void> {
        const { error } = await supabase.from('ers_rag_documents').delete().eq('source', source);
        if (error) throw new Error(`Could not remove '${source}': ${error.message}`);
    }
}

export const manualService = ManualService.getInstance();
