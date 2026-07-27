/**
 * pidPdfText — pull the text layer out of an as-built P&ID.
 *
 * Split from pidTagExtract so the recognition rules stay pure and unit-testable
 * with no pdfjs in the way. This module does the I/O and nothing else: it makes
 * no judgement about what any string means.
 *
 * Extraction runs in the browser, following the same reasoning as
 * ManualService: a customer's as-builts never leave their machine on the way
 * into ERS — only the tags they confirm are stored.
 */
import type { PdfTextItem } from './pidTagExtract';

export interface PdfReadResult {
    items: PdfTextItem[];
    pages: number;
    /**
     * True when the file carries essentially no text. A scanned drawing is a
     * picture of a drawing: there is nothing to extract, and saying so beats
     * returning an empty register and letting the user conclude ERS is broken.
     */
    looksScanned: boolean;
}

/** Below this many text runs per page, a drawing is almost certainly a scan. */
const SCAN_THRESHOLD_PER_PAGE = 8;

export async function readPidPdf(file: File): Promise<PdfReadResult> {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
        throw new Error('Upload a PDF of the P&ID. Images and DWG files are not read yet.');
    }

    // Lazy import: pdfjs is ~2 MB and only needed when a drawing is uploaded.
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
    ).toString();

    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const items: PdfTextItem[] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
        const pg = await pdf.getPage(p);
        const content = await pg.getTextContent();
        for (const raw of content.items) {
            const it = raw as { str?: string; transform?: number[] };
            if (typeof it.str !== 'string' || !it.str.trim()) continue;
            items.push({
                str: it.str,
                page: p,
                // transform[4]/[5] are the x/y of the text run on the page.
                x: it.transform?.[4],
                y: it.transform?.[5],
            });
        }
    }

    return {
        items,
        pages: pdf.numPages,
        looksScanned: items.length < pdf.numPages * SCAN_THRESHOLD_PER_PAGE,
    };
}
