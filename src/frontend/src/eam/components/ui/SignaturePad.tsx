import React, { useRef, useEffect, useState } from 'react';
import { PenTool, RotateCcw } from 'lucide-react';
import { StorageImage } from './StorageImage';

interface SignaturePadProps {
    onCapture: (dataUrl: string) => void;
    existingSignature?: string;
    disabled?: boolean;
    label?: string;
}

// Backing-store scale. Kept at 2 so a stroke stays crisp on a phone screen.
const SCALE = 2;

/** Paints the pad ground and the dashed signing guide. Takes CSS pixels. */
const paintBackdrop = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(16, height - 20);
    ctx.lineTo(width - 16, height - 20);
    ctx.stroke();
    ctx.setLineDash([]);
};

/**
 * Canvas-based digital signature capture pad.
 * Draws smooth lines via pointer events; outputs a base64 PNG data URL.
 */
export const SignaturePad: React.FC<SignaturePadProps> = ({ onCapture, existingSignature, disabled, label }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [drawing, setDrawing] = useState(false);
    const [hasStrokes, setHasStrokes] = useState(false);
    const lastPoint = useRef<{ x: number; y: number } | null>(null);

    // Size the backing store to the element, and keep it in step.
    //
    // The pad used to measure itself exactly once, on mount. On a phone that
    // measurement was taken before the surrounding card had settled — and it was
    // never retaken on rotation — so the backing store no longer matched the
    // element and every stroke landed offset from the finger. A ResizeObserver
    // re-sizes and repaints, carrying any strokes already drawn across.
    //
    // The effect also re-runs when an existing signature is cleared: that path
    // mounts a fresh canvas, which previously came back unsized and unpainted.
    // (hasStrokes is reset by whichever control did the clearing, not here.)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resize = () => {
            const { width, height } = canvas.getBoundingClientRect();
            if (!width || !height) return;
            const w = Math.round(width * SCALE);
            const h = Math.round(height * SCALE);
            if (canvas.width === w && canvas.height === h) return;

            // Carry existing strokes over the resize rather than wiping a signature.
            let carried: HTMLCanvasElement | null = null;
            if (canvas.width && canvas.height) {
                carried = document.createElement('canvas');
                carried.width = canvas.width;
                carried.height = canvas.height;
                carried.getContext('2d')?.drawImage(canvas, 0, 0);
            }

            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
            paintBackdrop(ctx, width, height);
            if (carried) ctx.drawImage(carried, 0, 0, width, height);
        };

        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [existingSignature]);

    const getPos = (e: React.PointerEvent) => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (disabled || existingSignature) return;
        setDrawing(true);
        lastPoint.current = getPos(e);
        canvasRef.current?.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!drawing || disabled) return;
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx || !lastPoint.current) return;
        const pos = getPos(e);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        lastPoint.current = pos;
        setHasStrokes(true);
    };

    const onPointerUp = () => {
        if (!drawing) return;
        setDrawing(false);
        lastPoint.current = null;
        // Capture
        if (hasStrokes && canvasRef.current) {
            onCapture(canvasRef.current.toDataURL('image/png'));
        }
    };

    const clear = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const rect = canvas.getBoundingClientRect();
        paintBackdrop(ctx, rect.width, rect.height);
        setHasStrokes(false);
        onCapture('');
    };

    if (existingSignature) {
        return (
            <div className="relative">
                {label && <p className="text-[10px] uppercase font-bold text-slate-500 mb-1">{label}</p>}
                <div className="border border-slate-200 rounded-lg bg-slate-50 p-2 flex items-center gap-3">
                    <StorageImage value={existingSignature} alt="Signature" className="h-12 object-contain flex-1" />
                    {!disabled && (
                        <button
                            onClick={() => { setHasStrokes(false); onCapture(''); }}
                            className="text-xs text-slate-400 hover:text-red-500 p-2 rounded hover:bg-red-50 transition flex-shrink-0"
                            title="Clear signature"
                        >
                            <RotateCcw size={14} />
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div>
            {label && <p className="text-[10px] uppercase font-bold text-slate-500 mb-1">{label}</p>}
            <div className={`relative border-2 rounded-lg overflow-hidden ${disabled ? 'border-slate-200 opacity-50' : 'border-dashed border-slate-300 hover:border-blue-400'} transition`}>
                <canvas
                    ref={canvasRef}
                    className="w-full cursor-crosshair h-28 sm:h-20"
                    style={{ touchAction: 'none' }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                    onPointerCancel={onPointerUp}
                />
                {!hasStrokes && !disabled && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-xs text-slate-400 flex items-center gap-1.5">
                            <PenTool size={12} /> Draw signature here
                        </span>
                    </div>
                )}
                {hasStrokes && !disabled && (
                    <button
                        onClick={clear}
                        className="absolute top-1 right-1 text-slate-400 hover:text-red-500 bg-white/80 rounded p-0.5"
                        title="Clear"
                    >
                        <RotateCcw size={12} />
                    </button>
                )}
            </div>
        </div>
    );
};
