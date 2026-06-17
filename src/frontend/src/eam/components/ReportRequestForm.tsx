import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Camera, Mic, AlertTriangle, CheckCircle2, Package, MapPin,
    Search, ChevronDown, ChevronRight, QrCode,
} from 'lucide-react';
import { Button, Badge, Textarea, priorityTone } from './ui';
import { ImageCapture } from './ui/ImageCapture';
import { ScanAssetModal } from './modals/ScanAssetModal';
import { FunctionalFailureSelector } from './FunctionalFailureSelector';
import { DatabaseService } from '../services/DatabaseService';
import { useToast } from '../contexts/ToastContext';
import { useCreateServiceRequest } from '../hooks/useCreateServiceRequest';
import { computeRequestPriority } from '../lib/serviceRequest';
import type { Asset, JobFile } from '../types';

/**
 * ReportRequestForm — the single unified "Report a Problem" / "New Work Request"
 * intake, shared by the mobile bottom-nav Report button and the desktop
 * Service Requests page. Bottom sheet on mobile, centered modal on desktop.
 *
 * Core fields are always visible (description + voice, breakdown, asset/location,
 * photo, live priority); the richer ISO 14224 fields (functional failure, category)
 * sit behind a collapsible "Add details" disclosure. All creation logic — priority
 * RPN, request shape, offline-aware submit — lives in lib/serviceRequest via the
 * useCreateServiceRequest hook, so field/desk paths can never drift apart.
 */

// Location-type asset codes (ISO 14224 hierarchy levels)
const LOCATION_TYPE_CODES = ['SITE', 'AREA', 'UNIT', 'SYSTEM', 'BUILDING', 'FLOOR', 'ROOM', 'LOCATION', 'PLANT', 'FACILITY', 'ZONE', 'FLOWSTATION', 'WELLHEAD', 'PLATFORM'];

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
    { value: 'GENERAL', label: 'General' },
    { value: 'MECHANICAL', label: 'Mechanical' },
    { value: 'ELECTRICAL', label: 'Electrical' },
    { value: 'INSTRUMENTATION', label: 'Instrumentation' },
    { value: 'FACILITIES', label: 'Facilities' },
    { value: 'SAFETY', label: 'Safety' },
    { value: 'HVAC', label: 'HVAC' },
    { value: 'CIVIL', label: 'Civil / Structural' },
];

// Minimal Web Speech API shape (not in the TS DOM lib across all targets).
interface SpeechRecognitionLike {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
    onend: () => void;
    onerror: (e: { error?: string }) => void;
    start: () => void;
    stop: () => void;
}
type SpeechRecognitionCtor = { new (): SpeechRecognitionLike };

const isLocationType = (asset: Asset): boolean => {
    const typeCode = (asset.assetType || asset.category || asset.hierarchyLevel || '').toUpperCase();
    return LOCATION_TYPE_CODES.some(lt => typeCode.includes(lt));
};

export const ReportRequestForm: React.FC<{
    open: boolean;
    onClose: () => void;
    onCreated?: () => void;
}> = ({ open, onClose, onCreated }) => {
    const { showToast } = useToast();
    const { create, submitting } = useCreateServiceRequest(() => {
        reset();
        onCreated?.();
        onClose();
    });

    // ── Core fields ──
    const [desc, setDesc] = useState('');
    const [isBreakdown, setIsBreakdown] = useState(false);
    const [files, setFiles] = useState<JobFile[]>([]);

    // ── Asset / location ──
    const [allAssets, setAllAssets] = useState<Asset[]>([]);
    const [locations, setLocations] = useState<Asset[]>([]);
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [selectedLocationId, setSelectedLocationId] = useState<string>('');
    const [showAssetPicker, setShowAssetPicker] = useState(false);
    const [assetSearch, setAssetSearch] = useState('');
    const [showScanner, setShowScanner] = useState(false);
    const [isLoadingAssets, setIsLoadingAssets] = useState(false);

    // ── Advanced (progressive disclosure) ──
    const [showDetails, setShowDetails] = useState(false);
    const [funcFailure, setFuncFailure] = useState('');
    const [category, setCategory] = useState('GENERAL');

    // ── Voice dictation ──
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const speechGlobals = (typeof window !== 'undefined' ? window : {}) as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechRecognition = speechGlobals.SpeechRecognition || speechGlobals.webkitSpeechRecognition;

    const { rpn, priority } = computeRequestPriority(desc, isBreakdown, selectedAsset?.criticality);

    // Load assets lazily on first open, split equipment vs. locations
    useEffect(() => {
        if (!open || allAssets.length) return;
        setIsLoadingAssets(true);
        DatabaseService.getInstance().getAssets()
            .then((assets: Asset[]) => {
                setAllAssets(assets);
                setLocations(assets.filter(isLocationType));
            })
            .catch(() => {})
            .finally(() => setIsLoadingAssets(false));
    }, [open, allAssets.length]);

    // Lock body scroll + Esc to close while open
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [open, onClose]);

    const reset = () => {
        setDesc(''); setIsBreakdown(false); setFiles([]);
        setSelectedAsset(null); setSelectedLocationId(''); setAssetSearch('');
        setShowDetails(false); setFuncFailure(''); setCategory('GENERAL');
    };

    // ── Hierarchy helpers ──
    const getLocationPath = (loc: Asset): string => {
        const parts: string[] = [loc.tag];
        let current: Asset | undefined = loc;
        let depth = 0;
        while (current?.parentId && depth < 5) {
            const parent = allAssets.find(a => a.id === current!.parentId);
            if (parent && isLocationType(parent)) parts.unshift(parent.tag);
            current = parent;
            depth++;
        }
        return parts.join(' › ');
    };

    const findLocationAncestor = (asset: Asset): Asset | null => {
        let current: Asset | undefined = asset;
        let depth = 0;
        while (current && depth < 10) {
            if (current.parentId) {
                const parent = allAssets.find(a => a.id === current!.parentId);
                if (parent && isLocationType(parent)) return parent;
                current = parent;
            } else break;
            depth++;
        }
        return null;
    };

    const getDescendantIds = (parentId: string): Set<string> => {
        const ids = new Set<string>();
        const walk = (pid: string) => {
            allAssets.forEach(a => {
                if (a.parentId === pid && !ids.has(a.id)) { ids.add(a.id); walk(a.id); }
            });
        };
        walk(parentId);
        return ids;
    };

    const getResolvedLocation = (): string | undefined => {
        if (selectedLocationId) {
            const loc = locations.find(l => l.id === selectedLocationId);
            return loc ? getLocationPath(loc) : undefined;
        }
        if (selectedAsset) {
            const loc = findLocationAncestor(selectedAsset);
            return loc ? getLocationPath(loc) : (selectedAsset.location || undefined);
        }
        return undefined;
    };

    const handleSelectAsset = (asset: Asset) => {
        setSelectedAsset(asset);
        setShowAssetPicker(false);
        setAssetSearch('');
        const locAncestor = findLocationAncestor(asset);
        if (locAncestor) setSelectedLocationId(locAncestor.id);
    };

    const handleSelectLocation = (locId: string) => {
        setSelectedLocationId(locId);
        setShowAssetPicker(false);
        setAssetSearch('');
        if (selectedAsset && locId) {
            const descendants = getDescendantIds(locId);
            if (!descendants.has(selectedAsset.id)) setSelectedAsset(null);
        }
    };

    const clearAssetLocation = (e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedAsset(null);
        setSelectedLocationId('');
    };

    // ── Voice dictation ──
    const toggleDictation = useCallback(() => {
        if (listening) { recognitionRef.current?.stop(); return; }
        if (!SpeechRecognition) {
            showToast('Voice input is not supported in this browser. Try Chrome, Edge, or Safari.', 'error');
            return;
        }
        // Web Speech only works on a secure origin (https / localhost).
        if (typeof window !== 'undefined' && !window.isSecureContext) {
            showToast('Voice input requires a secure (https) connection.', 'error');
            return;
        }
        const rec = new SpeechRecognition();
        rec.lang = 'en-US';
        rec.continuous = true;
        rec.interimResults = false;
        rec.onresult = (e) => {
            let finalText = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
            }
            if (finalText) setDesc(prev => (prev ? prev + ' ' : '') + finalText.trim());
        };
        rec.onend = () => setListening(false);
        rec.onerror = (e) => {
            setListening(false);
            console.error('[ReportRequestForm] speech recognition error:', e.error);
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                showToast('Microphone access denied. Allow mic permission for this site, then try again.', 'error');
            } else if (e.error === 'no-speech') {
                showToast('No speech detected — try again and speak clearly.', 'info');
            } else if (e.error && e.error !== 'aborted') {
                showToast(`Voice input error: ${e.error}`, 'error');
            }
        };
        recognitionRef.current = rec;
        try {
            rec.start();
            setListening(true);
        } catch (err) {
            console.error('[ReportRequestForm] could not start dictation:', err);
            showToast('Could not start voice input. Try again.', 'error');
            setListening(false);
        }
    }, [SpeechRecognition, listening, showToast]);

    const handleSubmit = () => {
        create({
            description: desc,
            isBreakdown,
            criticality: selectedAsset?.criticality,
            assetId: selectedAsset?.id,
            assetName: selectedAsset?.tag,
            location: getResolvedLocation(),
            category,
            functionalFailureType: funcFailure || undefined,
            files,
        });
    };

    if (!open) return null;

    const selectedLocation = locations.find(l => l.id === selectedLocationId);
    const searchTerm = assetSearch.toLowerCase();
    const filteredEquipment = allAssets
        .filter(a => !isLocationType(a) && (a.tag.toLowerCase().includes(searchTerm) || a.name.toLowerCase().includes(searchTerm)))
        .slice(0, 8);
    const filteredLocations = locations
        .filter(l => l.tag.toLowerCase().includes(searchTerm) || l.name.toLowerCase().includes(searchTerm))
        .slice(0, 6);

    return createPortal(
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center sm:justify-center">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />

            <div
                role="dialog"
                aria-modal="true"
                aria-label="Report a problem"
                className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-card shadow-overlay flex flex-col max-h-[92vh] animate-[slideUp_220ms_ease-out] sm:animate-[scaleIn_160ms_ease-out]"
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
                                        listening ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                    }`}
                                >
                                    <Mic size={12} />
                                    {listening ? 'Listening…' : 'Speak'}
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

                    {/* Asset / Location picker */}
                    <div className="relative">
                        <label className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1">
                            <Package size={12} /> Asset or Location
                            <span className="text-slate-400 font-normal ml-1">(optional)</span>
                        </label>
                        <div
                            onClick={() => setShowAssetPicker(v => !v)}
                            className={`p-3 border rounded-xl cursor-pointer transition-all flex items-center justify-between ${
                                selectedAsset ? 'bg-blue-50 border-blue-200 text-blue-900'
                                    : selectedLocation ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                    : 'bg-white border-slate-300 text-slate-500 hover:border-blue-300'
                            }`}
                        >
                            {selectedAsset ? (
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                                        <Package size={16} className="text-blue-600" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-bold text-sm truncate">{selectedAsset.tag}</div>
                                        <div className="text-xs opacity-75 truncate">{selectedAsset.name}</div>
                                    </div>
                                </div>
                            ) : selectedLocation ? (
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                        <MapPin size={16} className="text-emerald-600" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-bold text-sm truncate">{selectedLocation.tag}</div>
                                        <div className="text-xs opacity-75 truncate">{selectedLocation.name}</div>
                                    </div>
                                </div>
                            ) : (
                                <span className="text-sm">What needs attention?</span>
                            )}
                            <div className="flex items-center gap-1 flex-shrink-0">
                                {(selectedAsset || selectedLocation) && (
                                    <button onClick={clearAssetLocation} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition">
                                        <X size={14} />
                                    </button>
                                )}
                                <ChevronDown size={16} className="text-slate-400" />
                            </div>
                        </div>

                        {/* Resolved hierarchy breadcrumb */}
                        {(selectedAsset || selectedLocation) && (
                            <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                                <MapPin size={10} className="text-emerald-500 flex-shrink-0" />
                                <span className="text-slate-500 font-mono truncate">
                                    {selectedAsset
                                        ? (() => {
                                            const loc = findLocationAncestor(selectedAsset);
                                            return loc ? getLocationPath(loc) + ' › ' + selectedAsset.tag : selectedAsset.tag;
                                        })()
                                        : selectedLocation ? getLocationPath(selectedLocation) : '—'}
                                </span>
                                {selectedAsset?.criticality && (
                                    <span className={`ml-1 px-1.5 py-0.5 rounded font-bold uppercase ${
                                        selectedAsset.criticality === 'A' ? 'bg-red-100 text-red-700'
                                            : selectedAsset.criticality === 'B' ? 'bg-amber-100 text-amber-700'
                                            : 'bg-slate-100 text-slate-600'
                                    }`}>
                                        Crit {selectedAsset.criticality}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Dropdown */}
                        {showAssetPicker && (
                            <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-80 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                <div className="p-2 border-b border-slate-100">
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={assetSearch}
                                            onChange={(e) => setAssetSearch(e.target.value)}
                                            placeholder="Search by tag, name, or location…"
                                            className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                            autoFocus
                                        />
                                    </div>
                                </div>
                                <div className="overflow-y-auto max-h-[260px]">
                                    {filteredEquipment.length === 0 && filteredLocations.length === 0 ? (
                                        <div className="p-6 text-center text-slate-400 text-sm">
                                            {isLoadingAssets ? 'Loading…' : 'No assets or locations match your search'}
                                        </div>
                                    ) : (
                                        <>
                                            {filteredEquipment.length > 0 && (
                                                <>
                                                    <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 flex items-center gap-1.5">
                                                        <Package size={10} /> Equipment ({filteredEquipment.length})
                                                    </div>
                                                    {filteredEquipment.map(asset => {
                                                        const locParent = findLocationAncestor(asset);
                                                        return (
                                                            <div
                                                                key={asset.id}
                                                                onClick={() => handleSelectAsset(asset)}
                                                                className={`px-3 py-2.5 cursor-pointer hover:bg-blue-50 border-b border-slate-50 last:border-0 transition-colors ${selectedAsset?.id === asset.id ? 'bg-blue-50 border-l-4 border-l-blue-500 pl-2' : ''}`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <div className="font-medium text-sm text-slate-800">{asset.tag}</div>
                                                                    {asset.criticality && (
                                                                        <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${
                                                                            asset.criticality === 'A' ? 'bg-red-100 text-red-700'
                                                                                : asset.criticality === 'B' ? 'bg-amber-100 text-amber-700'
                                                                                : 'bg-slate-100 text-slate-500'
                                                                        }`}>{asset.criticality}</span>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs text-slate-500">{asset.name}</div>
                                                                {locParent && (
                                                                    <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                                                                        <MapPin size={8} className="text-emerald-400" /> {getLocationPath(locParent)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </>
                                            )}
                                            {filteredLocations.length > 0 && (
                                                <>
                                                    <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 flex items-center gap-1.5">
                                                        <MapPin size={10} /> Locations ({filteredLocations.length})
                                                    </div>
                                                    {filteredLocations.map(loc => (
                                                        <div
                                                            key={loc.id}
                                                            onClick={() => handleSelectLocation(loc.id)}
                                                            className={`px-3 py-2.5 cursor-pointer hover:bg-emerald-50 border-b border-slate-50 last:border-0 transition-colors ${selectedLocationId === loc.id ? 'bg-emerald-50 border-l-4 border-l-emerald-500 pl-2' : ''}`}
                                                        >
                                                            <div className="flex items-center gap-1.5">
                                                                <MapPin size={12} className="text-emerald-500 flex-shrink-0" />
                                                                <div className="font-medium text-sm text-slate-800">{loc.tag}</div>
                                                            </div>
                                                            <div className="text-xs text-slate-500 ml-5">{loc.name}</div>
                                                            <div className="text-[10px] text-slate-400 ml-5 mt-0.5 font-mono">{getLocationPath(loc)}</div>
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Photo + QR scan */}
                    <div className="flex items-stretch gap-3">
                        <div className="flex-1 bg-slate-50 border border-slate-200 border-dashed rounded-xl p-3 flex flex-col items-center justify-center">
                            <ImageCapture
                                bucket="assets"
                                prefix="sr_"
                                onImageCaptured={(url) => setFiles(prev => [...prev, {
                                    id: `file-${Date.now()}`,
                                    name: `Photo_${prev.length + 1}.jpg`,
                                    type: 'image/jpeg',
                                    url,
                                    uploadedBy: 'Reporter',
                                    uploadedAt: new Date().toISOString(),
                                }])}
                                shape="square"
                                size="md"
                                placeholder={<><Camera size={22} className="mb-1 text-slate-400" /><span className="text-xs font-medium text-slate-500">Add Photo</span></>}
                            />
                        </div>
                        <button
                            onClick={() => setShowScanner(true)}
                            className="flex-1 bg-slate-50 border border-slate-200 border-dashed rounded-xl p-3 flex flex-col items-center justify-center text-slate-500 hover:bg-blue-50 hover:border-blue-200 transition"
                        >
                            <QrCode size={22} className="mb-1" />
                            <span className="text-xs font-medium">Scan Asset ID</span>
                        </button>
                    </div>
                    {files.length > 0 && (
                        <div className="grid grid-cols-4 gap-2">
                            {files.map(f => (
                                <div key={f.id} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200">
                                    <img src={f.url} alt="Attachment" className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => setFiles(files.filter(file => file.id !== f.id))}
                                        className="absolute top-1 right-1 bg-black/50 hover:bg-red-600 text-white p-1 rounded-full backdrop-blur-sm"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Progressive disclosure: richer ISO 14224 fields */}
                    <div className="border-t border-slate-100 pt-2">
                        <button
                            onClick={() => setShowDetails(v => !v)}
                            className="w-full flex items-center justify-between py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
                        >
                            <span>Add details {funcFailure || category !== 'GENERAL' ? '' : '(optional)'}</span>
                            <ChevronRight size={16} className={`transition-transform ${showDetails ? 'rotate-90' : ''}`} />
                        </button>

                        {showDetails && (
                            <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-1 duration-150">
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                                    <FunctionalFailureSelector
                                        value={funcFailure}
                                        onChange={setFuncFailure}
                                        assetClassCode={selectedAsset?.assetClass || selectedAsset?.assetCategory || ''}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Category</label>
                                    <select
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="w-full p-2 border border-slate-300 rounded-lg bg-white h-[42px] text-sm"
                                    >
                                        {CATEGORY_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}
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
                        Submit Request
                    </Button>
                </div>

                {/* QR / barcode scanner */}
                <ScanAssetModal
                    isOpen={showScanner}
                    onClose={() => setShowScanner(false)}
                    assets={allAssets}
                    onAssetFound={(asset) => handleSelectAsset(asset)}
                />
            </div>
        </div>,
        document.body
    );
};
