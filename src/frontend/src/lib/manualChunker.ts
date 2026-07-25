// manualChunker — pure text preparation for the Manual Reader (Phase 3).
//
// Retrieval quality is decided here, before any search runs: a chunk that
// splits mid-procedure cites badly, and a chunk that spans three topics
// matches everything and means nothing. Chunks stay paragraph-aligned where
// possible, carry the page they started on so the Specialist can cite
// "page 47", and overlap slightly so a step split across a boundary is still
// findable from either side.
//
// No I/O: pages in, chunks out. PDF extraction lives in ManualService.

export interface SourcePage {
    /** 1-based page number; null for formats without pages (.txt, .md). */
    page: number | null;
    text: string;
}

export interface ManualChunk {
    chunk_index: number;
    chunk_text: string;
    page_number: number | null;
}

export interface ChunkOptions {
    /** Target maximum characters per chunk (~4 chars per token). */
    maxChars?: number;
    /** Characters of the previous chunk repeated at the start of the next. */
    overlapChars?: number;
    /** A trailing fragment shorter than this is merged into the previous chunk. */
    minChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
    maxChars: 2000,      // ≈ 500 tokens
    overlapChars: 200,
    minChars: 120,
};

/**
 * Clean text as it comes out of a PDF extractor.
 * Fixes the artefacts that most damage retrieval: words hyphenated across a
 * line break, hard-wrapped lines inside a paragraph, and runs of blank lines.
 */
export function normalizeText(raw: string): string {
    return raw
        .replace(/\r\n?/g, '\n')
        // De-hyphenate across line breaks: "centri-\nfugal" → "centrifugal"
        .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
        // Collapse the spaces PDF extractors sprinkle between glyphs
        .replace(/[ \t]+/g, ' ')
        // A single newline inside a paragraph is a hard wrap, not a break
        .replace(/(\S)\n(?!\n)(\S)/g, '$1 $2')
        // Normalise paragraph breaks
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map((l) => l.trim())
        .join('\n')
        .trim();
}

/** Rough token estimate for UI display — 4 characters per token. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** Split into sentences, keeping terminal punctuation with its sentence. */
function splitSentences(text: string): string[] {
    const parts = text.match(/[^.!?]+[.!?]+[\])'"`’”]*\s*|[^.!?]+$/g);
    return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Last-resort split for a single run of text longer than maxChars. */
function hardSplit(text: string, maxChars: number): string[] {
    const out: string[] = [];
    let rest = text;
    while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(' ', maxChars);
        if (cut <= 0) cut = maxChars; // no space to break on (e.g. a long token)
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out;
}

/** Trailing slice of a chunk, trimmed forward to a word boundary. */
function overlapTail(text: string, chars: number): string {
    if (chars <= 0 || text.length <= chars) return '';
    const slice = text.slice(-chars);
    const space = slice.indexOf(' ');
    return space >= 0 ? slice.slice(space + 1).trim() : slice.trim();
}

interface Unit {
    text: string;
    page: number | null;
}

/**
 * Break extracted pages into retrieval-sized chunks.
 * Paragraph-aligned first, sentence-aligned when a paragraph is too long,
 * hard-split only as a last resort.
 */
export function chunkPages(pages: SourcePage[], opts: ChunkOptions = {}): ManualChunk[] {
    const { maxChars, overlapChars, minChars } = { ...DEFAULTS, ...opts };

    // 1. Flatten to units small enough to place, each remembering its page.
    const units: Unit[] = [];
    for (const p of pages) {
        const clean = normalizeText(p.text ?? '');
        if (!clean) continue;
        for (const para of clean.split(/\n{2,}/)) {
            const block = para.trim();
            if (!block) continue;
            if (block.length <= maxChars) {
                units.push({ text: block, page: p.page });
                continue;
            }
            for (const sentence of splitSentences(block)) {
                if (sentence.length <= maxChars) {
                    units.push({ text: sentence, page: p.page });
                } else {
                    for (const piece of hardSplit(sentence, maxChars)) {
                        units.push({ text: piece, page: p.page });
                    }
                }
            }
        }
    }
    if (units.length === 0) return [];

    // 2. Pack units into chunks.
    const chunks: ManualChunk[] = [];
    let buffer = '';
    let bufferPage: number | null = null;

    const flush = () => {
        const text = buffer.trim();
        if (!text) return;
        chunks.push({ chunk_index: chunks.length, chunk_text: text, page_number: bufferPage });
        buffer = '';
        bufferPage = null;
    };

    for (const unit of units) {
        const candidate = buffer ? `${buffer}\n\n${unit.text}` : unit.text;
        if (candidate.length > maxChars && buffer) {
            const carried = overlapTail(buffer, overlapChars);
            const startedOn = bufferPage;
            flush();
            buffer = carried ? `${carried}\n\n${unit.text}` : unit.text;
            // Overlapped text came from the previous page; the new chunk is
            // still best cited by where its own content begins.
            bufferPage = unit.page ?? startedOn;
        } else {
            buffer = candidate;
            if (bufferPage === null) bufferPage = unit.page;
        }
    }
    flush();

    // 3. Merge a runt tail into its predecessor rather than indexing a fragment.
    if (chunks.length > 1) {
        const last = chunks[chunks.length - 1];
        if (last.chunk_text.length < minChars) {
            const prev = chunks[chunks.length - 2];
            prev.chunk_text = `${prev.chunk_text}\n\n${last.chunk_text}`;
            chunks.pop();
        }
    }

    return chunks.map((c, i) => ({ ...c, chunk_index: i }));
}
