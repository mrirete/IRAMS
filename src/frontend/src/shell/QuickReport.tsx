import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, Mic, MicOff, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Badge, Textarea, priorityTone } from '../eam/components/ui';
import { ImageCapture } from '../eam/components/ui/ImageCapture';
import { SearchableDropdown } from '../eam/components/ui/SearchableDropdown';
import { useAuth } from '../eam/contexts/AuthContext';
import { useToast } from '../eam/contexts/ToastContext';
import { DatabaseService } from '../eam/services/DatabaseService';
import { DataMapper } from '../eam/services/DataMapper';
import { RequestStatus, type ServiceRequest, type JobFile } from '../eam/types';

/**
 * QuickReport — operator-first "Report a Problem" bottom sheet.
 *
 * Mobile field flow: describe (with optional voice-to-text) → mark breakdown →
 * photo → optional asset → submit. Priority is auto-computed (RPN: asset
 * criticality × failure severity) and shown live, then the request is created
 * through the SAME path as the desktop form (DataMapper.toDBRequest + createRequest).
 *
 * Opened via the `open-quick-report` window event (dispatched from MobileBottomNav),
 * matching the existing `toggle-sidebar` event pattern in AppLayout.
 */

interface AssetLite { id: string; tag?: string; name?: string; criticality?: string }

// Minimal Web Speech API shape (not in the TS DOM lib across all targets).
interface SpeechRecognitionLike {
    lang: string;
    interimResults: boolean;
    onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
    onend: () => void;
    onerror: () => void;
    start: () => void;
    stop: () => void;
}
type SpeechRecognitionCtor = { new (): SpeechRecognitionLike };

// RPN priority — mirrors ServiceRequests CreationForm so field + desk agree.
function computePriority(desc: string, isBreakdown: boolean, criticality?: string) {
    const critScores: Record<string, number> = { A: 10, B: 5, C: 2 };
    const critScore = critScores[criticality || ''] || 3;
    const d = desc.toLowerCase();
    let sev = 3;
    if (isBreakdown) sev = 10;
    else if (/(fire|gas leak|explosion)/.test(d)) sev = 10;
    else if (/(leak|safety|hazard)/.test(d)) sev = 8;
    else if (/(vibrat|overheat|abnormal)/.test(d)) sev = 6;
    else if (/(noise|alarm|grinding)/.test(d)) sev = 5;
    const rpn = critScore * sev;
    const priority: ServiceRequest['priority'] =
        rpn >= 40 ? 'EMERGENCY' : rpn >= 25 ? 'HIGH' : rpn >= 10 ? 'MEDIUM' : 'LOW';
    return { rpn, priority };
}

export const QuickReport: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { user, profile } = useAuth();
    const { showToast } = useToast();

    const [desc, setDesc] = useState('');
    const [isBreakdown, setIsBreakdown] = useState(false);
    const [files, setFiles] = useState<JobFile[]>([]);
    const [assets, setAssets] = useState<AssetLite[]>([]);
    const [assetId, setAssetId] = useState<string | undefined>();
    const [submitting, setSubmitting] = useState(false);
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

    const selectedAsset = assets.find(a => a.id === assetId);
    const { rpn, priority } = computePriority(desc, isBreakdown, selectedAsset?.criticality);

    // Web Speech API support (progressive enhancement)
    const speechGlobals = (typeof window !== 'undefined' ? window : {}) as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechRecognition = speechGlobals.SpeechRecognition || speechGlobals.webkitSpeechRecognition;

    // Load assets lazily on first open
    useEffect(() => {
        if (!open || assets.length) return;
        DatabaseService.getInstance().getAssets()
            .then((rows: AssetLite[]) => setAssets(rows.map(a => ({ id: a.id, tag: a.tag, name: a.name, criticality: a.criticality }))))
            .catch(() => {});
    }, [open, assets.length]);

    // Lock body scroll + Esc to close while open
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [open, onClose]);

    const reset = () => { setDesc(''); setIsBreakdown(false); setFiles([]); setAssetId(undefined); };

    const toggleDictation = useCallback(() => {
        if (!SpeechRecognition) return;
        if (listening) { recognitionRef.current?.stop(); return; }
        const rec = new SpeechRecognition();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.onresult = (e) => {
            const text = Array.from(e.results).map(r => r[0].transcript).join(' ');
            setDesc(prev => (prev ? prev + ' ' : '') + text);
        };
        rec.onend = () => setListening(false);
        rec.onerror = () => setListening(false);
        recognitionRef.current = rec;
        rec.start();
        setListening(true);
    }, [SpeechRecognition, listening]);

    const handleSubmit = async () => {
        if (!user) { showToast('You must be logged in to submit a report.', 'error'); return; }
        if (desc.trim().length < 3) { showToast('Please describe the problem.', 'error'); return; }
        setSubmitting(true);
        try {
            const newReq: ServiceRequest = {
                id: self.crypto.randomUUID(),
                requestNumber: `REQ-2026-${Math.floor(Math.random() * 1000)}`,
                title: desc.trim().slice(0, 40) + (desc.trim().length > 40 ? '…' : ''),
                description: desc.trim(),
                assetId: selectedAsset?.id,
                assetName: selectedAsset?.tag,
                status: RequestStatus.NEW,
                priority,
                category: 'CORRECTIVE',
                requesterId: user.id,
                requesterName: profile?.username || user.email || 'Unknown User',
                createdAt: new Date().toISOString(),
                slaDeadline: new Date(Date.now() + (priority === 'EMERGENCY' ? 14400000 : 86400000)).toISOString(),
                aiRiskScore: rpn,
                isBreakdown,
                files,
            };
            await DatabaseService.getInstance().createRequest(DataMapper.toDBRequest(newReq), user.id);
            showToast(`Report submitted — priority ${priority}.`, 'success');
            reset();
            onClose();
        } catch (e) {
            console.error('[QuickReport] submit failed:', e);
            showToast('Could not submit report. Try again.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) return null;

    return createPortal(
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center sm:justify-center">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />

            <div
                role="dialog"
                aria-modal="true"
                aria-label="Report a problem"
                className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-card shadow-overlay flex flex-col max-h-[92vh] animate-[slideUp_220ms_ease-out] sm:animate-[scaleIn_160ms_ease-out]"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-relantern-50 flex items-center justify-center">
                            <AlertTriangle size={16} className="text-relantern-600" />
                        </span>
                        <h2 className="text-base font-bold text-slate-800">Report a Problem</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 -mr-1" aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Description + dictation */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-semibold text-slate-600">What's wrong?</label>
                            {SpeechRecognition && (
                                <button
                                    onClick={toggleDictation}
                                    className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full transition-colors ${
                                        listening ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                    }`}
                                >
                                    {listening ? <MicOff size={12} /> : <Mic size={12} />}
                                    {listening ? 'Stop' : 'Speak'}
                                </button>
                            )}
                        </div>
                        <Textarea
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            rows={4}
                            autoFocus
                            placeholder="Describe the problem — e.g. Pump P-101 leaking oil from the seal"
                            className="text-base"
                        />
                    </div>

                    {/* Breakdown toggle */}
                    <button
                        onClick={() => setIsBreakdown(v => !v)}
                        className={`w-full flex items-center gap-3 p-3 rounded-card border-2 transition-colors text-left ${
                            isBreakdown ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                    >
                        <span className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${isBreakdown ? 'bg-red-500 justify-end' : 'bg-slate-300 justify-start'}`}>
                            <span className="w-5 h-5 bg-white rounded-full shadow" />
                        </span>
                        <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-slate-800">Equipment stopped working</span>
                            <span className="block text-[11px] text-slate-500">Breakdown — escalates priority</span>
                        </span>
                    </button>

                    {/* Optional asset */}
                    <div>
                        <label className="text-xs font-semibold text-slate-600 mb-1 block">Equipment (optional)</label>
                        <SearchableDropdown
                            options={assets.map(a => ({ code: a.id, description: `${a.tag || ''}${a.name ? ' — ' + a.name : ''}`.trim() }))}
                            value={assetId}
                            onChange={setAssetId}
                            placeholder="Search asset tag or name…"
                        />
                    </div>

                    {/* Photo */}
                    <div>
                        <label className="text-xs font-semibold text-slate-600 mb-1 block">Photo (optional)</label>
                        <div className="flex items-center gap-3">
                            <ImageCapture
                                bucket="assets"
                                prefix="sr_"
                                onImageCaptured={(url) => setFiles(prev => [...prev, {
                                    id: `file-${Date.now()}`,
                                    name: `Photo_${prev.length + 1}.jpg`,
                                    type: 'image/jpeg',
                                    url,
                                    uploadedBy: profile?.username || 'Unknown User',
                                    uploadedAt: new Date().toISOString(),
                                }])}
                                shape="square"
                                size="md"
                                placeholder={<><Camera size={22} className="mb-1 text-slate-400" /><span className="text-xs font-medium text-slate-500">Add Photo</span></>}
                            />
                            {files.length > 0 && (
                                <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                                    <CheckCircle2 size={14} /> {files.length} photo{files.length !== 1 ? 's' : ''} attached
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer — live priority + submit */}
                <div
                    className="flex items-center gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50/60"
                    style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
                >
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Priority</span>
                        <Badge tone={priorityTone(priority)} dot>{priority}</Badge>
                    </div>
                    <Button
                        onClick={handleSubmit}
                        loading={submitting}
                        size="lg"
                        fullWidth
                        leftIcon={!submitting ? <CheckCircle2 size={18} /> : undefined}
                        className="flex-1"
                    >
                        Submit Report
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
};
