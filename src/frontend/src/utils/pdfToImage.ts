/**
 * pdfToImage — Convert page 1 of a PDF file to a PNG Blob.
 *
 * Uses pdfjs-dist (lazy-imported) so the ~2 MB library is only
 * loaded when a user actually uploads a PDF.
 */

export async function pdfToImageBlob(file: File): Promise<Blob> {
    // Dynamic import keeps pdfjs-dist out of the main bundle
    const pdfjsLib = await import('pdfjs-dist');

    // Point the worker to the bundled version shipped by pdfjs-dist
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
    ).toString();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);

    // Render at 2x scale for readability (≈ 150 DPI)
    const scale = 2;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');

    await page.render({ canvasContext: ctx, viewport }).promise;

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
            'image/png',
        );
    });
}
