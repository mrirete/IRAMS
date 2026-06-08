import React, { useRef, useEffect, useState } from 'react';
import { PenTool, RotateCcw } from 'lucide-react';

interface SignaturePadProps {
    onCapture: (dataUrl: string) => void;
    existingSignature?: string;
    disabled?: boolean;
    label?: string;
}

/**
 * Canvas-based digital signature capture pad.
 * Draws smooth lines via pointer events; outputs a base64 PNG data URL.
 */
export const SignaturePad: React.FC<SignaturePadProps> = ({ onCapture, existingSignature, disabled, label }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [drawing, setDrawing] = useState(false);
    const [hasStrokes, setHasStrokes] = useState(false);
    const lastPoint = useRef<{ x: number; y: number } | null>(null);

    // Set canvas size and background
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2; // retina
        canvas.height = rect.height * 2;
        const ctx = canvas.getContext('2d')!;
        ctx.scale(2, 2);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, rect.width, rect.height);
        // Draw guide line
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(16, rect.height - 20);
        ctx.lineTo(rect.width - 16, rect.height - 20);
        ctx.stroke();
        ctx.setLineDash([]);
    }, []);

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
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, rect.width, rect.height);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(16, rect.height - 20);
        ctx.lineTo(rect.width - 16, rect.height - 20);
        ctx.stroke();
        ctx.setLineDash([]);
        setHasStrokes(false);
        onCapture('');
    };

    if (existingSignature) {
        return (
            <div className="relative">
                {label && <p className="text-[10px] uppercase font-bold text-slate-500 mb-1">{label}</p>}
                <div className="border border-slate-200 rounded-lg bg-slate-50 p-2 flex items-center gap-3">
                    <img src={existingSignature} alt="Signature" className="h-12 object-contain flex-1" />
                    {!disabled && (
                        <button
                            onClick={() => onCapture('')}
                            className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition"
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
                    className="w-full cursor-crosshair"
                    style={{ height: 80, touchAction: 'none' }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
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
