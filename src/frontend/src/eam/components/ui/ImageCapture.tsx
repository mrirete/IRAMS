import React, { useState, useRef, useCallback } from 'react';
import { Camera, Upload, X, Loader2 } from 'lucide-react';
import { DatabaseService } from '../../services/DatabaseService';

/**
 * Compress an image file client-side using canvas.
 * Returns a new File with max dimension = maxDim and JPEG quality.
 */
async function compressImage(file: File, maxDim: number = 1920, quality: number = 0.8): Promise<File> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width <= maxDim && height <= maxDim && file.size < 500_000) {
                resolve(file); // Already small enough
                return;
            }
            if (width > height) {
                if (width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
            } else {
                if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => {
                if (!blob) { reject(new Error('Compression failed')); return; }
                const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
                resolve(compressed);
            }, 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
        img.src = url;
    });
}

interface ImageCaptureProps {
    /** Callback with the Supabase Storage public URL */
    onImageCaptured: (url: string) => void;
    /** Storage bucket name (e.g. 'assets', 'avatars') */
    bucket: string;
    /** Filename prefix (e.g. 'asset_', 'contact_') */
    prefix?: string;
    /** Current image URL for preview */
    currentImage?: string;
    /** Callback when image is removed */
    onRemove?: () => void;
    /** Preview shape */
    shape?: 'square' | 'circle';
    /** Max file size in MB */
    maxSizeMB?: number;
    /** Size of the preview area */
    size?: 'sm' | 'md' | 'lg';
    /** Placeholder text or icon */
    placeholder?: React.ReactNode;
}

export const ImageCapture: React.FC<ImageCaptureProps> = ({
    onImageCaptured,
    bucket,
    prefix = '',
    currentImage,
    onRemove,
    shape = 'square',
    maxSizeMB = 10,
    size = 'md',
    placeholder
}) => {
    const [isUploading, setIsUploading] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [showWebcam, setShowWebcam] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const sizeClasses = {
        sm: 'w-16 h-16',
        md: 'w-28 h-28',
        lg: 'w-40 h-40'
    };

    const handleUpload = useCallback(async (file: File) => {
        if (file.size > maxSizeMB * 1024 * 1024) {
            setError(`Image too large. Max ${maxSizeMB}MB.`);
            return;
        }
        setIsUploading(true);
        setError(null);
        try {
            const compressed = await compressImage(file);
            const url = await DatabaseService.getInstance().uploadImage(compressed, bucket, prefix);
            onImageCaptured(url);
        } catch (err: any) {
            console.error('Image upload failed:', err);
            setError(err?.message || 'Upload failed');
        } finally {
            setIsUploading(false);
            setShowMenu(false);
        }
    }, [bucket, prefix, maxSizeMB, onImageCaptured]);

    const handleFileSelect = () => {
        setShowMenu(false);
        fileInputRef.current?.click();
    };

    const handleCameraCapture = () => {
        setShowMenu(false);
        // On mobile, the capture attribute will open the camera directly
        // On desktop, we fall back to the webcam modal
        if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
            cameraInputRef.current?.click();
        } else {
            openWebcam();
        }
    };

    const openWebcam = async () => {
        setShowWebcam(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (err) {
            console.error('Webcam access denied:', err);
            setError('Camera access denied. Please allow camera permission.');
            setShowWebcam(false);
        }
    };

    const snapPhoto = () => {
        if (!videoRef.current) return;
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0);
        canvas.toBlob(async blob => {
            if (!blob) return;
            const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
            closeWebcam();
            await handleUpload(file);
        }, 'image/jpeg', 0.9);
    };

    const closeWebcam = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setShowWebcam(false);
    };

    const handleRemove = () => {
        setShowMenu(false);
        onRemove?.();
    };

    // Close menu on outside click
    React.useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false);
            }
        };
        if (showMenu) document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showMenu]);

    return (
        <div className="relative">
            {/* Hidden file inputs */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ''; }}
            />
            <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); e.target.value = ''; }}
            />

            {/* Preview area */}
            <div
                className={`${sizeClasses[size]} ${shape === 'circle' ? 'rounded-full' : 'rounded-lg'} 
                    bg-slate-100 border-2 border-dashed border-slate-300 overflow-hidden 
                    flex items-center justify-center cursor-pointer relative group
                    hover:border-blue-400 transition-all`}
                onClick={() => setShowMenu(!showMenu)}
            >
                {isUploading ? (
                    <Loader2 size={24} className="text-blue-500 animate-spin" />
                ) : currentImage ? (
                    <>
                        <img src={currentImage} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Camera size={20} className="text-white" />
                        </div>
                    </>
                ) : (
                    <div className="text-center p-2">
                        {placeholder || (
                            <>
                                <Camera size={20} className="text-slate-400 mx-auto mb-1" />
                                <span className="text-[10px] text-slate-400 leading-tight block">Add Photo</span>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Dropdown menu */}
            {showMenu && (
                <div ref={menuRef} className="absolute z-50 mt-1 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 animate-in fade-in duration-150">
                    <button
                        onClick={handleFileSelect}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                    >
                        <Upload size={14} className="text-slate-400" />
                        Upload from device
                    </button>
                    <button
                        onClick={handleCameraCapture}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
                    >
                        <Camera size={14} className="text-blue-500" />
                        Take photo
                    </button>
                    {currentImage && onRemove && (
                        <>
                            <div className="border-t border-slate-100 my-1" />
                            <button
                                onClick={handleRemove}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                            >
                                <X size={14} />
                                Remove image
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Error tooltip */}
            {error && (
                <div className="absolute top-full mt-1 left-0 bg-red-50 text-red-600 text-xs px-2 py-1 rounded border border-red-200 whitespace-nowrap z-50">
                    {error}
                    <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
                </div>
            )}

            {/* Webcam modal */}
            {showWebcam && (
                <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center" onClick={closeWebcam}>
                    <div
                        className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                            <h3 className="font-semibold text-slate-900">Take Photo</h3>
                            <button onClick={closeWebcam} className="text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="relative bg-black aspect-video">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <div className="flex justify-center py-4 bg-slate-50">
                            <button
                                onClick={snapPhoto}
                                className="w-14 h-14 bg-white border-4 border-blue-500 rounded-full hover:border-blue-600 
                                    active:scale-95 transition-all shadow-lg flex items-center justify-center"
                            >
                                <div className="w-10 h-10 bg-blue-500 rounded-full hover:bg-relantern-500 transition" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
