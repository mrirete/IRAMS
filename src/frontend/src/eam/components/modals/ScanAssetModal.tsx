import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, QrCode, Camera, Keyboard, CheckCircle, AlertTriangle, Search, Loader } from 'lucide-react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';

interface ScanAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAssetFound: (asset: any) => void;
    assets: any[]; // All assets to match against
}

type ScanMode = 'camera' | 'manual';

export const ScanAssetModal: React.FC<ScanAssetModalProps> = ({ isOpen, onClose, onAssetFound, assets }) => {
    const [mode, setMode] = useState<ScanMode>('camera');
    const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'found' | 'not-found'>('idle');
    const [scannedCode, setScannedCode] = useState('');
    const [matchedAsset, setMatchedAsset] = useState<any | null>(null);
    const [manualInput, setManualInput] = useState('');
    const [cameraError, setCameraError] = useState<string | null>(null);
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const readerDivId = 'ers-qr-reader';

    // Cleanup scanner on unmount or close
    const stopScanner = useCallback(async () => {
        try {
            if (scannerRef.current) {
                const state = scannerRef.current.getState();
                if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
                    await scannerRef.current.stop();
                }
                scannerRef.current.clear();
                scannerRef.current = null;
            }
        } catch (e) {
            console.warn('[ScanAssetModal] Scanner cleanup error:', e);
            scannerRef.current = null;
        }
    }, []);

    // Match scanned code against assets
    const matchAsset = useCallback((code: string) => {
        const normalized = code.trim().toUpperCase();
        // Match against tag (primary), name, or id
        const match = assets.find(a =>
            a.tag?.toUpperCase() === normalized ||
            a.tag?.toUpperCase().includes(normalized) ||
            a.name?.toUpperCase().includes(normalized) ||
            a.id === code.trim()
        );
        return match || null;
    }, [assets]);

    // Handle successful scan
    const handleCodeDetected = useCallback((decodedText: string) => {
        setScannedCode(decodedText);
        const asset = matchAsset(decodedText);

        if (asset) {
            setMatchedAsset(asset);
            setScanStatus('found');
            // Auto-stop scanner on successful match
            stopScanner();
        } else {
            setMatchedAsset(null);
            setScanStatus('not-found');
        }
    }, [matchAsset, stopScanner]);

    // Start camera scanner
    const startScanner = useCallback(async () => {
        setCameraError(null);
        setScanStatus('scanning');
        setScannedCode('');
        setMatchedAsset(null);

        // Small delay to ensure DOM is ready
        await new Promise(r => setTimeout(r, 300));

        const el = document.getElementById(readerDivId);
        if (!el) {
            setCameraError('Scanner container not found.');
            return;
        }

        try {
            const scanner = new Html5Qrcode(readerDivId);
            scannerRef.current = scanner;

            await scanner.start(
                { facingMode: 'environment' },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0,
                },
                (decodedText) => {
                    handleCodeDetected(decodedText);
                },
                () => {} // Ignore scan failures (continuous scanning)
            );
        } catch (err: any) {
            console.error('[ScanAssetModal] Camera error:', err);
            if (err?.toString().includes('NotAllowedError') || err?.toString().includes('Permission')) {
                setCameraError('Camera permission denied. Please allow camera access in your browser settings, or use manual entry.');
            } else if (err?.toString().includes('NotFoundError')) {
                setCameraError('No camera found on this device. Use manual entry instead.');
            } else {
                setCameraError(`Camera error: ${err?.message || err}. Try manual entry.`);
            }
            setScanStatus('idle');
        }
    }, [handleCodeDetected]);

    // Initialize scanner when modal opens in camera mode
    useEffect(() => {
        if (isOpen && mode === 'camera') {
            startScanner();
        }

        return () => {
            stopScanner();
        };
    }, [isOpen, mode]);

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setScanStatus('idle');
            setScannedCode('');
            setMatchedAsset(null);
            setManualInput('');
            setCameraError(null);
            setMode('camera');
        }
    }, [isOpen]);

    const handleManualSearch = () => {
        if (!manualInput.trim()) return;
        handleCodeDetected(manualInput.trim());
    };

    const handleConfirm = () => {
        if (matchedAsset) {
            onAssetFound(matchedAsset);
            onClose();
        }
    };

    const handleRetry = () => {
        setScanStatus('idle');
        setScannedCode('');
        setMatchedAsset(null);
        if (mode === 'camera') {
            startScanner();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                            <QrCode size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg">Scan Asset ID</h3>
                            <p className="text-white/60 text-xs">QR Code, Barcode, or Manual Entry</p>
                        </div>
                    </div>
                    <button
                        onClick={() => { stopScanner(); onClose(); }}
                        className="p-2 hover:bg-white/10 rounded-lg transition"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Mode Tabs */}
                <div className="flex border-b border-slate-200">
                    <button
                        onClick={() => { setMode('camera'); setScanStatus('idle'); }}
                        className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                            mode === 'camera'
                                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                    >
                        <Camera size={16} /> Camera Scan
                    </button>
                    <button
                        onClick={() => { stopScanner(); setMode('manual'); setScanStatus('idle'); }}
                        className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                            mode === 'manual'
                                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                    >
                        <Keyboard size={16} /> Manual Entry
                    </button>
                </div>

                {/* Content */}
                <div className="p-5">
                    {mode === 'camera' && (
                        <div className="space-y-4">
                            {cameraError ? (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="font-bold text-amber-800 mb-1">Camera Unavailable</p>
                                            <p className="text-amber-700">{cameraError}</p>
                                            <button
                                                onClick={() => setMode('manual')}
                                                className="mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg text-xs font-bold hover:bg-amber-700 transition"
                                            >
                                                Switch to Manual Entry
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : scanStatus === 'found' ? (
                                /* Match Found UI */
                                <div className="space-y-3">
                                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <CheckCircle size={20} className="text-emerald-600" />
                                            <span className="font-bold text-emerald-800">Asset Identified!</span>
                                        </div>
                                        <div className="bg-white rounded-lg p-3 border border-emerald-100">
                                            <div className="text-lg font-bold text-slate-900">{matchedAsset?.tag}</div>
                                            <div className="text-sm text-slate-600">{matchedAsset?.name}</div>
                                            {matchedAsset?.location && (
                                                <div className="text-xs text-slate-400 mt-1">📍 {matchedAsset.location}</div>
                                            )}
                                        </div>
                                        <div className="text-xs text-emerald-600 mt-2 font-mono">
                                            Scanned: {scannedCode}
                                        </div>
                                    </div>
                                </div>
                            ) : scanStatus === 'not-found' ? (
                                /* No Match UI */
                                <div className="space-y-3">
                                    <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <AlertTriangle size={20} className="text-red-600" />
                                            <span className="font-bold text-red-800">No Matching Asset Found</span>
                                        </div>
                                        <p className="text-sm text-red-700">
                                            Scanned code "<span className="font-mono font-bold">{scannedCode}</span>" does not match any registered asset tag.
                                        </p>
                                        <p className="text-xs text-red-500 mt-2">
                                            Ensure the asset is registered in the Asset Registry, or try manual entry.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                /* Scanner Viewport */
                                <div className="space-y-3">
                                    <div
                                        id={readerDivId}
                                        className="rounded-xl overflow-hidden border-2 border-blue-200 bg-black min-h-[280px]"
                                    />
                                    <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                                        <Loader size={14} className="animate-spin" />
                                        Point camera at QR code or barcode on the asset nameplate
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {mode === 'manual' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                    Enter Asset Tag / ID
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={manualInput}
                                        onChange={(e) => setManualInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                                        placeholder="e.g. P-101A, GEN-001, K-205..."
                                        className="flex-1 p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-blue-500 outline-none"
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleManualSearch}
                                        disabled={!manualInput.trim()}
                                        className="px-4 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-primary-500 disabled:opacity-50 disabled:bg-slate-300 transition flex items-center gap-1.5"
                                    >
                                        <Search size={16} /> Find
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1.5">
                                    Enter the asset tag printed on the equipment nameplate. Partial matches are supported.
                                </p>
                            </div>

                            {scanStatus === 'found' && matchedAsset && (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                                    <div className="flex items-center gap-2 mb-3">
                                        <CheckCircle size={20} className="text-emerald-600" />
                                        <span className="font-bold text-emerald-800">Asset Found!</span>
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-emerald-100">
                                        <div className="text-lg font-bold text-slate-900">{matchedAsset.tag}</div>
                                        <div className="text-sm text-slate-600">{matchedAsset.name}</div>
                                        {matchedAsset.location && (
                                            <div className="text-xs text-slate-400 mt-1">📍 {matchedAsset.location}</div>
                                        )}
                                        {matchedAsset.criticality && (
                                            <div className={`inline-block mt-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                                matchedAsset.criticality === 'A' ? 'bg-red-100 text-red-700' :
                                                matchedAsset.criticality === 'B' ? 'bg-amber-100 text-amber-700' :
                                                'bg-slate-100 text-slate-600'
                                            }`}>
                                                Criticality {matchedAsset.criticality}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {scanStatus === 'not-found' && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertTriangle size={20} className="text-red-600" />
                                        <span className="font-bold text-red-800">No Match</span>
                                    </div>
                                    <p className="text-sm text-red-700">
                                        No asset matches "<span className="font-mono font-bold">{scannedCode}</span>".
                                        Check the tag and try again.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex gap-3">
                    {(scanStatus === 'found' || scanStatus === 'not-found') && (
                        <button
                            onClick={handleRetry}
                            className="px-4 py-2.5 border border-slate-300 rounded-xl text-slate-600 font-medium text-sm hover:bg-white transition"
                        >
                            {mode === 'camera' ? 'Scan Again' : 'Try Again'}
                        </button>
                    )}
                    <div className="flex-1" />
                    <button
                        onClick={() => { stopScanner(); onClose(); }}
                        className="px-4 py-2.5 border border-slate-300 rounded-xl text-slate-600 font-medium text-sm hover:bg-white transition"
                    >
                        Cancel
                    </button>
                    {scanStatus === 'found' && matchedAsset && (
                        <button
                            onClick={handleConfirm}
                            className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-xl font-bold text-sm shadow-md hover:shadow-lg transition flex items-center gap-2"
                        >
                            <CheckCircle size={16} /> Use This Asset
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
