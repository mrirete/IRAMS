/**
 * AssetQRCode — QR code generation for assets
 * Generates scannable QR codes encoding asset tag and ERS deep link
 * Supports single asset view and batch PDF export
 */
import React, { useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Printer, QrCode } from 'lucide-react';
import type { Asset } from '../types';

interface AssetQRCodeProps {
    asset: Asset;
    size?: number;
    showActions?: boolean;
}

export function AssetQRCode({ asset, size = 128, showActions = true }: AssetQRCodeProps) {
    const qrRef = useRef<HTMLDivElement>(null);

    const qrValue = `ers://asset/${asset.tag}`;

    const handleDownload = () => {
        const svg = qrRef.current?.querySelector('svg');
        if (!svg) return;

        const svgData = new XMLSerializer().serializeToString(svg);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        canvas.width = size * 2;
        canvas.height = size * 2;

        img.onload = () => {
            if (ctx) {
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                const pngUrl = canvas.toDataURL('image/png');
                const downloadLink = document.createElement('a');
                downloadLink.download = `QR_${asset.tag}.png`;
                downloadLink.href = pngUrl;
                downloadLink.click();
            }
        };

        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    };

    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const svg = qrRef.current?.querySelector('svg');
        if (!svg) return;

        const svgHtml = new XMLSerializer().serializeToString(svg);

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>QR Label — ${asset.tag}</title>
                <style>
                    body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; font-family: Arial, sans-serif; }
                    .label { text-align: center; padding: 24px; border: 2px dashed #ccc; border-radius: 12px; }
                    .tag { font-size: 24px; font-weight: bold; margin-top: 12px; letter-spacing: 2px; }
                    .name { font-size: 14px; color: #666; margin-top: 4px; }
                    .link { font-size: 10px; color: #999; margin-top: 8px; }
                    @media print { .label { border: none; } }
                </style>
            </head>
            <body>
                <div class="label">
                    ${svgHtml}
                    <div class="tag">${asset.tag}</div>
                    <div class="name">${asset.name}</div>
                    <div class="link">${qrValue}</div>
                </div>
                <script>window.print(); window.close();</script>
            </body>
            </html>
        `);
        printWindow.document.close();
    };

    return (
        <div className="flex flex-col items-center">
            <div ref={qrRef} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <QRCodeSVG
                    value={qrValue}
                    size={size}
                    level="M"
                    includeMargin={false}
                    bgColor="#ffffff"
                    fgColor="#1e293b"
                />
            </div>
            <div className="mt-2 text-center">
                <div className="text-xs font-mono font-bold text-slate-600">{asset.tag}</div>
                <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{asset.name}</div>
            </div>
            {showActions && (
                <div className="flex gap-2 mt-3">
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition"
                    >
                        <Download size={12} /> Save PNG
                    </button>
                    <button
                        onClick={handlePrint}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition"
                    >
                        <Printer size={12} /> Print Label
                    </button>
                </div>
            )}
        </div>
    );
}

// ── Batch QR Export ──────────────────────────────────────────────
export function batchExportQRCodes(assets: Asset[]): void {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const labels = assets.map(a => `
        <div class="label">
            <div class="qr-placeholder" data-value="ers://asset/${a.tag}"></div>
            <div class="tag">${a.tag}</div>
            <div class="name">${a.name}</div>
        </div>
    `).join('');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>ERS Asset QR Labels</title>
            <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
            <style>
                body { margin: 20px; font-family: Arial, sans-serif; }
                .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
                .label { text-align: center; padding: 16px; border: 1px dashed #ddd; border-radius: 8px; break-inside: avoid; }
                .tag { font-size: 14px; font-weight: bold; margin-top: 8px; letter-spacing: 1px; }
                .name { font-size: 10px; color: #666; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; margin-inline: auto; }
                canvas { display: block; margin: 0 auto; }
                @media print { .label { border: none; } }
            </style>
        </head>
        <body>
            <h2 style="text-align: center; margin-bottom: 20px;">ERS Asset QR Labels (${assets.length} assets)</h2>
            <div class="grid">${labels}</div>
            <script>
                document.querySelectorAll('.qr-placeholder').forEach(el => {
                    const canvas = document.createElement('canvas');
                    QRCode.toCanvas(canvas, el.dataset.value, { width: 100, margin: 1 });
                    el.replaceWith(canvas);
                });
                setTimeout(() => { window.print(); }, 500);
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}
