import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Plus, Trash2, X, ZoomIn, Loader2, Clock } from 'lucide-react';
import { StorageImage } from './StorageImage';
import { DatabaseService } from '../../services/DatabaseService';
import { ImageCapture } from './ImageCapture';

interface GalleryImage {
    id: string;
    url: string;
    name: string;
    uploadedBy: string;
    createdAt: string;
}

interface ImageGalleryProps {
    /** Parent record ID */
    entityId: string;
    /** Entity type: 'WORK_ORDER', 'SERVICE_REQUEST', etc. */
    entityType: string;
    /** Storage bucket */
    bucket?: string;
    /** Filename prefix */
    prefix?: string;
    /** Disable add/delete for closed records */
    readonly?: boolean;
    /** Max images allowed */
    maxImages?: number;
}

export const ImageGallery: React.FC<ImageGalleryProps> = ({
    entityId,
    entityType,
    bucket = 'assets',
    prefix = '',
    readonly = false,
    maxImages = 20
}) => {
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [showCapture, setShowCapture] = useState(false);

    const db = DatabaseService.getInstance();

    const loadImages = useCallback(async () => {
        setLoading(true);
        try {
            const files = await db.getEntityFiles(entityId, entityType);
            // Filter to only image types
            const imageFiles = files.filter((f: any) =>
                f.type?.startsWith('image/') ||
                f.name?.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i) ||
                f.url?.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)
            );
            setImages(imageFiles.map((f: any) => ({
                id: f.id,
                url: f.url,
                name: f.name,
                uploadedBy: f.uploadedBy || 'system',
                createdAt: f.createdAt
            })));
        } catch (err) {
            console.error('Failed to load gallery images:', err);
        } finally {
            setLoading(false);
        }
    }, [entityId, entityType]);

    useEffect(() => { loadImages(); }, [loadImages]);

    const handleImageCaptured = async (url: string) => {
        try {
            await db.addEntityFile({
                entityId,
                entityType,
                name: url.split('/').pop() || `photo_${Date.now()}.jpg`,
                url,
                type: 'image/jpeg',
                sizeBytes: 0,
                uploadedBy: 'current_user'
            });
            // Log to audit trail
            try {
                await db.addJournalEntry(entityId, entityType, {
                    type: 'PHOTO',
                    description: `Photo uploaded: ${url.split('/').pop()}`,
                    createdBy: 'current_user'
                });
            } catch { /* journal is best-effort */ }
            await loadImages();
        } catch (err) {
            console.error('Failed to save image record:', err);
        }
        setShowCapture(false);
    };

    const handleDelete = async (img: GalleryImage) => {
        if (!confirm('Delete this photo?')) return;
        try {
            // Delete entity file record
            await db.deleteEntityFile(img.id);
            // Delete from storage
            await db.deleteImage(bucket, img.url);
            // Audit trail
            try {
                await db.addJournalEntry(entityId, entityType, {
                    type: 'PHOTO',
                    description: `Photo deleted: ${img.name}`,
                    createdBy: 'current_user'
                });
            } catch { /* best-effort */ }
            setImages(prev => prev.filter(i => i.id !== img.id));
        } catch (err) {
            console.error('Failed to delete image:', err);
        }
    };

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Camera size={16} className="text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">
                        Photos {images.length > 0 && <span className="text-slate-400 font-normal">({images.length})</span>}
                    </span>
                </div>
                {!readonly && images.length < maxImages && (
                    <button
                        onClick={() => setShowCapture(!showCapture)}
                        className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 
                            px-2 py-1 rounded hover:bg-blue-50 transition"
                    >
                        <Plus size={14} />
                        Add Photo
                    </button>
                )}
            </div>

            {/* Capture widget (shown inline when adding) */}
            {showCapture && (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <ImageCapture
                        bucket={bucket}
                        prefix={prefix}
                        onImageCaptured={handleImageCaptured}
                        shape="square"
                        size="sm"
                    />
                    <div className="text-xs text-slate-500">
                        Upload or take a photo
                    </div>
                    <button
                        onClick={() => setShowCapture(false)}
                        className="ml-auto text-slate-400 hover:text-slate-600"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Image grid */}
            {loading ? (
                <div className="flex justify-center py-6">
                    <Loader2 size={20} className="text-slate-400 animate-spin" />
                </div>
            ) : images.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm italic border border-dashed border-slate-200 rounded-lg">
                    No photos attached.
                </div>
            ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {images.map(img => (
                        <div
                            key={img.id}
                            className="group relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-100 cursor-pointer"
                        >
                            <StorageImage
                                value={img.url}
                                alt={img.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <button
                                    onClick={() => setLightboxUrl(img.url)}
                                    className="p-1.5 bg-white/90 rounded-full text-slate-700 hover:bg-white transition"
                                    title="View full size"
                                >
                                    <ZoomIn size={14} />
                                </button>
                                {!readonly && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(img); }}
                                        className="p-1.5 bg-red-500/90 rounded-full text-white hover:bg-red-600 transition"
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                            {/* Timestamp badge */}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
                                <div className="flex items-center gap-1 text-[9px] text-white/80">
                                    <Clock size={8} />
                                    {new Date(img.createdAt).toLocaleDateString()}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Lightbox */}
            {lightboxUrl && (
                <div
                    className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
                    onClick={() => setLightboxUrl(null)}
                >
                    <button
                        onClick={() => setLightboxUrl(null)}
                        className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
                    >
                        <X size={28} />
                    </button>
                    <StorageImage
                        value={lightboxUrl}
                        alt="Full size"
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
};
