import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Plus, Search, Filter, Clock, CheckCircle,
    X, User, Camera, Zap, Trash2, Save,
    MoreHorizontal, QrCode, ChevronLeft, Bot, ShieldCheck, FileText, AlertOctagon, ChevronDown, Mic, Package, MapPin, Edit3, Check
} from 'lucide-react';
import { MOCK_REQUESTS, MOCK_ASSETS, MOCK_DICTIONARIES, MOCK_WORK_ORDERS } from '../constants';
import { ServiceRequest, RequestStatus, Asset, JobFile, WorkOrderStatus, WorkOrderType } from '../types';

import { DatabaseService } from '../services/DatabaseService';
import { ImageGallery } from '../components/ui/ImageGallery';
import { ImageCapture } from '../components/ui/ImageCapture';
import { DataMapper } from '../services/DataMapper';
import { SearchableDropdown } from '../components/ui/SearchableDropdown';
import { ConfirmationModal } from '../components/modals/ConfirmationModal';
import { NotificationService } from '../services/NotificationService';
import { useAuth } from '../contexts/AuthContext';
import { AskRelanternButton } from '../components/AskRelanternButton';
import { UnifiedDetailHeader } from '../components/ui/UnifiedDetailHeader';
import { ScanAssetModal } from '../components/modals/ScanAssetModal';

export const ServiceRequests: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useAuth();
    const [isCreating, setIsCreating] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
    const [requests, setRequests] = useState<ServiceRequest[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [dictionaries, setDictionaries] = useState<any[]>([]);

    // Polling / Real-time updates simulation
    const refreshData = async () => {
        const db = DatabaseService.getInstance();
        const dbRecords = await db.getRequests();
        const assetsData = await db.getAssets();
        const usersData = await db.getUsers();
        const dictionariesData = await db.getDictionaries();

        setAssets(assetsData);
        setUsers(usersData);
        setDictionaries(dictionariesData);

        const uiRecords = dbRecords.map(r => DataMapper.toUIRequest(r, assetsData, usersData));
        // Sort by date desc
        setRequests(uiRecords.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    };


    useEffect(() => {
        refreshData();
    }, []);

    // Auto-open creation form when navigated with ?action=create (from Dashboard quick actions)
    useEffect(() => {
        if (searchParams.get('action') === 'create') {
            setIsCreating(true);
            setSearchParams({}, { replace: true }); // Clean URL to prevent re-trigger on refresh
        }
    }, [searchParams, setSearchParams]);

    const handleCreateSubmit = async (newRequest: ServiceRequest) => {
        // Submit to DB
        try {
            const dbRecord = DataMapper.toDBRequest(newRequest);
            await DatabaseService.getInstance().createRequest(dbRecord, user?.id || 'unknown');
            setIsCreating(false);
            await refreshData();
        } catch (e: any) {
            alert("Error creating request: " + e.message);
        }
    };


    const handleStatusChange = async (id: string, newStatus: RequestStatus) => {
        try {
            const db = DatabaseService.getInstance();
            if (newStatus === RequestStatus.CONVERTED) {
                // Trigger Conversion Transaction
                const wo = await db.approveRequestAndConvert(id, user?.id || 'unknown');
                alert(`Success! Work Order ${wo.wo_number} created.`);
            } else {
                // Standard Status Update
                // Need to map UI Status to DB Status
                // Since our mapper logic handles this 1:1, we can cast or map back
                const dbStatus = DataMapper.toDBRequest({ status: newStatus } as any).status;
                await db.updateRequest(id, { status: dbStatus }, user?.id || 'unknown');
            }
            await refreshData();

            // Update selected view if open
            if (selectedRequest && selectedRequest.id === id) {
                // Re-fetch specific item
                const all = await db.getRequests(); // Inefficient but safe for migration
                const updated = all.find(r => r.id === id);
                if (updated) {
                    const uiRequest = DataMapper.toUIRequest(updated, assets, users);
                    setSelectedRequest(uiRequest);
                    // Trigger Rules Engine
                    await NotificationService.checkRules('requests', 'SR_STATUS_CHANGE', uiRequest);
                }
            }
        } catch (e: any) {
            alert("Action Failed: " + e.message);
        }
    };


    const handleRequestUpdate = async (updatedRequest: ServiceRequest) => {
        try {
            // GAP-5 FIX: Persist ALL editable fields, not just functional_failure_id
            const dbRecord = DataMapper.toDBRequest(updatedRequest);
            await DatabaseService.getInstance().updateRequest(updatedRequest.id, {
                functional_failure_id: dbRecord.functional_failure_id,
                description: dbRecord.description,
                is_breakdown: dbRecord.is_breakdown,
                category: dbRecord.category,
            }, user?.id || 'unknown');

            await refreshData();
            setSelectedRequest(updatedRequest); // Optimistic UI update for detail view
        } catch (e: any) {
            alert(e.message);
        }
    };

    const handleRequestDelete = async (id: string) => {
        try {
            await DatabaseService.getInstance().deleteRequest(id);
            setSelectedRequest(null);
            await refreshData();
        } catch (e: any) {
            alert('Delete failed: ' + e.message);
        }
    };

    // Click handler: navigate to WO if converted, otherwise open detail
    const handleRequestClick = (req: ServiceRequest) => {
        if (req.status === RequestStatus.CONVERTED && req.linkedWOId) {
            navigate(`/work-orders?id=${req.linkedWOId}`);
        } else {
            setIsCreating(false);
            setSelectedRequest(req);
        }
    };


    return (
        <div className="flex h-[calc(100vh-6rem)] gap-6">
            {/* Main Board / List View */}
            <div className={`flex-1 flex flex-col transition-all duration-300 ${selectedRequest || isCreating ? 'hidden lg:flex lg:w-1/3 lg:flex-none' : 'w-full'}`}>
                <div className="mb-6 flex flex-wrap justify-between items-center gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Maintenance Requests</h1>
                        <p className="text-sm text-slate-500">Triage and convert issues to work orders.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <AskRelanternButton
                            contextType="serviceRequest"
                            contextSummary={`Maintenance Request Triage: ${requests.length} total requests. Pending: ${requests.filter(r => r.status === 'PENDING').length}. In Progress: ${requests.filter(r => r.status === 'IN_PROGRESS').length}. Approved: ${requests.filter(r => r.status === 'APPROVED').length}. Ask about triage prioritization, auto-classification, risk-based escalation, or converting MRs to work orders.`}
                            compact
                        />
                        <button
                            onClick={() => setIsCreating(true)}
                            className="bg-relantern-500 hover:bg-relantern-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm"
                        >
                            <Plus size={18} /> New Request
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="mb-4 flex gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search requests..."
                            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-relantern-500 focus:outline-none"
                        />
                    </div>
                    <button className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50">
                        <Filter size={18} />
                    </button>
                </div>

                {/* Board */}
                <div className="flex-1 overflow-x-auto overflow-y-hidden pb-4">
                    <div className="flex h-full gap-4 min-w-[800px] lg:min-w-0 lg:flex-col lg:overflow-y-auto lg:gap-0">
                        {/* Mobile: Horizontal Columns / Desktop (Split View): Vertical List */}
                        {selectedRequest || isCreating ? (
                            // Compact List View when Detail is open
                            <div className="space-y-2">
                                {requests.map(req => (
                                    <div
                                        key={req.id}
                                        onClick={() => handleRequestClick(req)}
                                        className={`p-3 rounded-lg border cursor-pointer hover:bg-slate-50 transition ${selectedRequest?.id === req.id ? 'bg-blue-50 border-blue-500' : 'bg-white border-slate-200'}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-mono text-xs text-slate-500">{req.requestNumber}</span>
                                                {req.isBreakdown && <AlertOctagon size={12} className="text-red-600" title="Breakdown" />}
                                            </div>
                                            <StatusBadge status={req.status} compact />
                                        </div>
                                        <h3 className="text-sm font-medium text-slate-900 truncate">{req.title}</h3>
                                        <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                                            <Clock size={12} /> <span>{new Date(req.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            // Full Kanban Board
                            <div className="flex h-full gap-4">
                                <RequestColumn title="New" statuses={[RequestStatus.NEW]} requests={requests} onSelect={setSelectedRequest} color="bg-slate-100" />
                                <RequestColumn title="Under Review" statuses={[RequestStatus.REVIEW]} requests={requests} onSelect={setSelectedRequest} color="bg-blue-50" />
                                <RequestColumn title="Authorized" statuses={[RequestStatus.AUTHORIZED]} requests={requests} onSelect={setSelectedRequest} color="bg-indigo-50" />
                                <RequestColumn title="Approved & Converted" statuses={[RequestStatus.APPROVED, RequestStatus.CONVERTED]} requests={requests} onSelect={setSelectedRequest} color="bg-green-50" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Right Panel: Creation Form or Details */}
            {(selectedRequest || isCreating) && (
                <div className="w-full lg:flex-1 bg-white rounded-xl shadow-lg border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right duration-300">
                    {isCreating ? (
                        <CreationForm onClose={() => setIsCreating(false)} onSubmit={handleCreateSubmit} />
                    ) : selectedRequest ? (
                        <RequestDetail
                            request={selectedRequest}
                            onClose={() => setSelectedRequest(null)}
                            onStatusChange={handleStatusChange}
                            onUpdate={handleRequestUpdate}
                            onDelete={handleRequestDelete}
                            dictionaries={dictionaries}
                        />
                    ) : null}
                </div>
            )}
        </div>
    );
};

// --- Reusable Selector Component ---

const FunctionalFailureSelector: React.FC<{
    value: string | undefined;
    onChange: (code: string) => void;
    readOnly?: boolean;
}> = ({ value, onChange, readOnly }) => {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [functionalFailures, setFunctionalFailures] = useState<any[]>([]);
    const [isLoadingFF, setIsLoadingFF] = useState(true);

    // Fetch functional failures from database
    useEffect(() => {
        const loadFailures = async () => {
            try {
                const dictionaries = await DatabaseService.getInstance().getDictionaries();
                const failures = dictionaries.filter((d: any) => d.type === 'FAULT_TYPE' || d.dict_type === 'FAULT_TYPE');
                setFunctionalFailures(failures);
            } catch (e) {
                console.error('Failed to load functional failures:', e);
                // Fallback to mock data if DB fetch fails
                setFunctionalFailures([]);
            } finally {
                setIsLoadingFF(false);
            }
        };
        loadFailures();
    }, []);

    const selectedEntry = functionalFailures.find((f: any) => f.id === value);

    // Initialize search with current value description
    useEffect(() => {
        if (selectedEntry) {
            setSearch(`${selectedEntry.code} - ${selectedEntry.description}`);
        } else if (!isOpen) {
            setSearch('');
        }
    }, [value, selectedEntry, isOpen]);

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filtered = functionalFailures.filter((f: any) =>
        (f.description || '').toLowerCase().includes(search.toLowerCase()) ||
        (f.code || f.dict_code || '').toLowerCase().includes(search.toLowerCase())
    );

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange('');
        setSearch('');
        setIsOpen(false);
    };

    if (readOnly) {
        return (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                    <AlertOctagon size={12} /> Functional Failure
                </label>
                {value ? (
                    <div className="text-sm text-slate-800 font-medium">
                        <div className="font-mono text-xs text-slate-500">{value}</div>
                        {selectedEntry?.description || value}
                    </div>
                ) : (
                    <div className="text-xs text-slate-400 italic">Not specified</div>
                )}
            </div>
        );
    }

    return (
        <div ref={dropdownRef}>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Functional Failure (ISO 14224)</label>
            <div className="relative">
                <div
                    className="flex items-center border border-slate-300 rounded-lg bg-white overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 cursor-text group hover:border-blue-300 transition-colors"
                    onClick={() => setIsOpen(true)}
                >
                    <div className="p-2 text-slate-400 bg-slate-50 border-r border-slate-200 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
                        <AlertOctagon size={16} />
                    </div>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setIsOpen(true);
                        }}
                        onFocus={() => {
                            setIsOpen(true);
                            if (value && search === `${selectedEntry?.code} - ${selectedEntry?.description}`) {
                                setSearch(''); // Clear formatted value on focus to allow fresh search
                            }
                        }}
                        placeholder="Type to search (e.g. Leak, Start, Stop)..."
                        className="flex-1 p-2 text-sm outline-none w-full"
                    />

                    {value && (
                        <button
                            onClick={handleClear}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-slate-100 transition-colors"
                            title="Clear Selection"
                        >
                            <X size={16} />
                        </button>
                    )}

                    <button
                        className="p-2 text-slate-400 hover:text-slate-600 border-l border-slate-100"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(!isOpen);
                        }}
                    >
                        <ChevronDown size={16} />
                    </button>
                </div>

                {isOpen && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto animate-in fade-in zoom-in-95 duration-100">
                        {filtered.length > 0 ? (
                            filtered.map(ff => (
                                <div
                                    key={ff.id}
                                    onClick={() => {
                                        onChange(ff.id);
                                        setSearch(`${ff.code} - ${ff.description}`);
                                        setIsOpen(false);
                                    }}
                                    className={`p-3 cursor-pointer border-b border-slate-50 last:border-0 hover:bg-blue-50 transition-colors ${ff.id === value ? 'bg-blue-50 border-l-4 border-l-blue-500 pl-2' : ''}`}
                                >
                                    <div className="font-bold text-slate-800 text-sm">{ff.description}</div>
                                    <div className="text-xs text-slate-500 font-mono">{ff.code}</div>
                                </div>
                            ))
                        ) : (
                            <div className="p-4 text-center text-slate-500 text-sm">
                                No functional failures match "{search}".
                            </div>
                        )}
                    </div>
                )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Categorizing the failure correctly helps with Root Cause Analysis (RCM).</p>
        </div>
    );
};

// --- Components ---

const RequestColumn: React.FC<{
    title: string;
    statuses: RequestStatus[];
    requests: ServiceRequest[];
    onSelect: (r: ServiceRequest) => void;
    color: string;
}> = ({ title, statuses, requests, onSelect, color }) => {
    const navigate = useNavigate();
    const filtered = requests.filter(r => statuses.includes(r.status));

    return (
        <div className={`flex-1 min-w-[280px] rounded-xl flex flex-col ${color} border border-transparent`}>
            <div className="p-3 font-semibold text-slate-700 flex justify-between items-center">
                {title}
                <span className="bg-white/50 px-2 py-0.5 rounded text-xs text-slate-600">{filtered.length}</span>
            </div>
            <div className="p-2 flex-1 overflow-y-auto space-y-2">
                {filtered.map(req => (
                    <div
                        key={req.id}
                        onClick={() => onSelect(req)}
                        className="bg-white p-3 rounded-lg shadow-sm border border-slate-200 hover:shadow-md transition cursor-pointer group"
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border ${req.priority === 'HIGH' ? 'bg-red-50 text-red-700 border-red-100' :
                                req.priority === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                    'bg-slate-50 text-slate-600 border-slate-100'
                                }`}>
                                {req.priority}
                            </div>
                            <div className="flex items-center gap-1">
                                {req.isBreakdown && (
                                    <div className="text-[10px] flex items-center gap-1 text-red-700 bg-red-50 font-bold border border-red-100 px-1 py-0.5 rounded" title="Equipment Breakdown">
                                        <AlertOctagon size={10} className="text-red-600" /> Breakdown
                                    </div>
                                )}
                                {req.aiRiskScore && req.aiRiskScore > 80 && (
                                    <div className="text-[10px] flex items-center gap-1 text-red-600 font-bold" title="High Risk Detected by AI">
                                        <Zap size={10} fill="currentColor" /> AI Risk
                                    </div>
                                )}
                            </div>
                        </div>
                        <h4 className="text-sm font-semibold text-slate-900 mb-1 group-hover:text-blue-600 transition-colors">{req.title}</h4>
                        <p className="text-xs text-slate-500 line-clamp-2 mb-3">{req.description}</p>

                        <div className="border-t border-slate-100 pt-2 flex justify-between items-center text-xs text-slate-500">
                            <div className="flex items-center gap-1">
                                <User size={12} /> {req.requesterName.split(' ')[0]}
                            </div>
                            {req.linkedWOId ? (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/work-orders?id=${req.linkedWOId}`);
                                    }}
                                    className="flex items-center gap-1 text-blue-600 font-bold hover:underline"
                                >
                                    <FileText size={12} /> View WO #{req.linkedWONumber || '...'}
                                </button>
                            ) : (
                                <SLAIndicator deadline={req.slaDeadline} />
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const SLAIndicator: React.FC<{ deadline: string }> = ({ deadline }) => {
    const hoursLeft = (new Date(deadline).getTime() - Date.now()) / 3600000;

    if (hoursLeft < 0) return <span className="text-red-600 font-bold flex items-center gap-1"><Clock size={12} /> Overdue</span>;
    if (hoursLeft < 4) return <span className="text-amber-600 font-bold flex items-center gap-1"><Clock size={12} /> {Math.ceil(hoursLeft)}h left</span>;

    return <span className="text-slate-400 flex items-center gap-1"><Clock size={12} /> {Math.ceil(hoursLeft / 24)}d left</span>;
};

const StatusBadge: React.FC<{ status: RequestStatus, compact?: boolean }> = ({ status, compact }) => {
    const styles = {
        [RequestStatus.NEW]: 'bg-blue-100 text-blue-700',
        [RequestStatus.REVIEW]: 'bg-purple-100 text-purple-700',
        [RequestStatus.AUTHORIZED]: 'bg-indigo-100 text-indigo-700',
        [RequestStatus.APPROVED]: 'bg-green-100 text-green-700',
        [RequestStatus.REJECTED]: 'bg-slate-100 text-slate-600',
        [RequestStatus.CONVERTED]: 'bg-slate-800 text-slate-100',
    };

    return (
        <span className={`rounded-full font-bold uppercase tracking-wider ${styles[status]} ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'}`}>
            {status}
        </span>
    );
};

// --- Creation Form ---



const CreationForm: React.FC<{ onClose: () => void, onSubmit: (req: ServiceRequest) => void }> = ({ onClose, onSubmit }) => {
    const { user, profile } = useAuth();

    const [step, setStep] = useState(1);
    const [desc, setDesc] = useState('');
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [funcFailure, setFuncFailure] = useState('');
    const [isBreakdown, setIsBreakdown] = useState(false);
    const [category, setCategory] = useState('GENERAL'); // GAP-6: Bound category state
    const [files, setFiles] = useState<JobFile[]>([]);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [selectedLocation, setSelectedLocation] = useState<string>('');
    const [showAssetPicker, setShowAssetPicker] = useState(false);
    const [showLocationPicker, setShowLocationPicker] = useState(false);
    const [assetSearch, setAssetSearch] = useState('');
    const [locationSearch, setLocationSearch] = useState('');
    const [dbAssets, setDbAssets] = useState<Asset[]>([]);
    const [allAssets, setAllAssets] = useState<Asset[]>([]);
    const [locations, setLocations] = useState<Asset[]>([]);
    const [isLoadingAssets, setIsLoadingAssets] = useState(true);
    const [locationAutoFilled, setLocationAutoFilled] = useState(false);
    const [showScanner, setShowScanner] = useState(false);

    // Location-type asset codes (ISO 14224 hierarchy levels)
    const LOCATION_TYPE_CODES = ['SITE', 'AREA', 'UNIT', 'SYSTEM', 'BUILDING', 'FLOOR', 'ROOM', 'LOCATION', 'PLANT', 'FACILITY', 'ZONE', 'FLOWSTATION', 'WELLHEAD', 'PLATFORM'];

    const isLocationType = (asset: Asset): boolean => {
        const typeCode = (asset.assetType || asset.category || asset.hierarchyLevel || '').toUpperCase();
        return LOCATION_TYPE_CODES.some(lt => typeCode.includes(lt));
    };

    // Fetch assets from database on mount — separate locations from equipment
    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoadingAssets(true);
                const db = DatabaseService.getInstance();
                const assets = await db.getAssets();
                setAllAssets(assets);

                const locationAssets: Asset[] = [];
                const equipmentAssets: Asset[] = [];
                assets.forEach((a: Asset) => {
                    if (isLocationType(a)) {
                        locationAssets.push(a);
                    } else {
                        equipmentAssets.push(a);
                    }
                });

                setLocations(locationAssets);
                setDbAssets(equipmentAssets.length > 0 ? equipmentAssets : assets);
            } catch (e) {
                console.error('Failed to load assets:', e);
            } finally {
                setIsLoadingAssets(false);
            }
        };
        loadData();
    }, []);

    // --- Smart-Link Helpers ---

    // Walk up the parent chain to find the nearest location ancestor
    const findLocationAncestor = (asset: Asset): Asset | null => {
        let current: Asset | undefined = asset;
        let depth = 0;
        while (current && depth < 10) {
            if (current.parentId) {
                const parent = allAssets.find(a => a.id === current!.parentId);
                if (parent && isLocationType(parent)) return parent;
                current = parent;
            } else {
                break;
            }
            depth++;
        }
        return null;
    };

    // Get all descendant IDs of a location (for filtering assets at that location)
    const getDescendantIds = (parentId: string): Set<string> => {
        const ids = new Set<string>();
        const walk = (pid: string) => {
            allAssets.forEach(a => {
                if (a.parentId === pid && !ids.has(a.id)) {
                    ids.add(a.id);
                    walk(a.id);
                }
            });
        };
        walk(parentId);
        return ids;
    };

    // Get location display name with breadcrumb
    const getLocationPath = (loc: Asset): string => {
        const parts: string[] = [loc.tag];
        let current: Asset | undefined = loc;
        let depth = 0;
        while (current?.parentId && depth < 5) {
            const parent = allAssets.find(a => a.id === current!.parentId);
            if (parent && isLocationType(parent)) {
                parts.unshift(parent.tag);
            }
            current = parent;
            depth++;
        }
        return parts.join(' › ');
    };

    // Smart-link: When an asset is selected, auto-fill location from hierarchy
    const handleSelectAsset = (asset: Asset) => {
        setSelectedAsset(asset);
        setShowAssetPicker(false);
        setAssetSearch('');
        // Auto-fill location from the asset's hierarchy
        const locAncestor = findLocationAncestor(asset);
        if (locAncestor) {
            setSelectedLocation(locAncestor.id);
            setLocationAutoFilled(true);
        }
    };

    // Smart-link: When a location is selected, filter assets to that subtree
    const handleSelectLocation = (locId: string) => {
        setSelectedLocation(locId);
        setShowLocationPicker(false);
        setLocationSearch('');
        setLocationAutoFilled(false);
        // If the currently selected asset is not under the new location, clear it
        if (selectedAsset && locId) {
            const descendants = getDescendantIds(locId);
            if (!descendants.has(selectedAsset.id)) {
                setSelectedAsset(null);
            }
        }
    };

    // Filtered assets: if a location is selected, show ONLY assets under it (no fallback)
    const filteredDbAssets = selectedLocation
        ? (() => {
            const descendants = getDescendantIds(selectedLocation);
            // Filter from allAssets (not just equipment) to find any maintainable item under this location
            return allAssets.filter(a => descendants.has(a.id) && !isLocationType(a));
        })()
        : dbAssets;

    // Resolve location for submission
    const getResolvedLocation = (): string => {
        if (selectedLocation) {
            const loc = locations.find(l => l.id === selectedLocation);
            return loc ? getLocationPath(loc) : 'Unknown';
        }
        if (selectedAsset) {
            const loc = findLocationAncestor(selectedAsset);
            return loc ? getLocationPath(loc) : selectedAsset.location || 'Unknown';
        }
        return 'Unknown';
    };

    const handleVoiceToText = () => {
        setIsListening(true);
        setTimeout(() => {
            setIsListening(false);
            setDesc(prev => prev + (prev ? ' ' : '') + "The pump is making a loud vibration noise and seems to be overheating.");
        }, 2000);
    };

    const handleAddPhoto = () => {
        const newFile: JobFile = {
            id: `file-${Date.now()}`,
            name: `Photo_${files.length + 1}.jpg`,
            type: 'image/jpeg',
            url: 'https://images.unsplash.com/photo-1581092921461-eab62e97a780?auto=format&fit=crop&q=80&w=200',
            uploadedBy: profile?.username || 'Unknown User',
            uploadedAt: new Date().toISOString()
        };
        setFiles([...files, newFile]);
    };

    // Mock AI analysis
    const handleAnalyze = () => {
        setIsAnalyzing(true);
        setTimeout(() => {
            setIsAnalyzing(false);
            // Simulate finding an asset if mentioned
            // Simulate finding an asset if mentioned
            if (desc.toLowerCase().includes('pump')) {
                const pump = dbAssets.find(a => a.tag.includes('P-'));
                if (pump) setSelectedAsset(pump);
            }
            setStep(2);
        }, 1500);
    };

    const handleSubmit = () => {
        if (!user) {
            alert("You must be logged in to submit a request.");
            return;
        }

        const newId = self.crypto.randomUUID();
        const newReqNumber = `REQ-2026-${Math.floor(Math.random() * 1000)}`;
        console.log("Creating Request:", { newId, newReqNumber });

        const newReq: ServiceRequest = {
            id: newId,
            requestNumber: newReqNumber,
            title: desc.substring(0, 40) + '...',
            description: desc,
            assetId: selectedAsset?.id,
            assetName: selectedAsset?.tag,
            location: getResolvedLocation(),
            status: RequestStatus.NEW,
            priority: desc.toLowerCase().includes('fire') || desc.toLowerCase().includes('leak') ? 'HIGH' : 'MEDIUM',
            category: category, // GAP-6: Persisted from bound state
            requesterId: user.id, // Use Real User ID
            requesterName: profile?.username || user.email || 'Unknown User',
            createdAt: new Date().toISOString(),
            slaDeadline: new Date(Date.now() + 86400000).toISOString(),
            aiRiskScore: desc.toLowerCase().includes('leak') ? 85 : 40,
            functionalFailureType: funcFailure,
            isBreakdown: isBreakdown,
            files: files
        };
        onSubmit(newReq);
    };

    return (
        <div className="flex flex-col h-full relative">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <h2 className="font-bold text-slate-800 flex items-center gap-2">
                    <Plus size={20} className="text-blue-600" /> New Maintenance Request
                </h2>
                <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-500">
                    <X size={20} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                {step === 1 && (
                    <div className="space-y-6 max-w-2xl mx-auto">
                        {/* Unified Asset / Location Selector (ISO 14224) */}
                        <div className="relative">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1">
                                <Package size={12} /> Asset or Location
                                <span className="text-slate-400 font-normal normal-case ml-1">(optional)</span>
                            </label>
                            <div
                                onClick={() => { setShowAssetPicker(!showAssetPicker); }}
                                className={`p-3 border rounded-xl cursor-pointer transition-all flex items-center justify-between ${
                                    selectedAsset
                                        ? 'bg-blue-50 border-blue-200 text-blue-900'
                                        : selectedLocation
                                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                            : 'bg-white border-slate-300 text-slate-500 hover:border-blue-300'
                                }`}
                            >
                                {selectedAsset ? (
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                                            <Package size={16} className="text-blue-600" />
                                        </div>
                                        <div>
                                            <div className="font-bold text-sm">{selectedAsset.tag}</div>
                                            <div className="text-xs opacity-75">{selectedAsset.name}</div>
                                        </div>
                                    </div>
                                ) : selectedLocation ? (
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                            <MapPin size={16} className="text-emerald-600" />
                                        </div>
                                        <div>
                                            <div className="font-bold text-sm">{locations.find(l => l.id === selectedLocation)?.tag || '—'}</div>
                                            <div className="text-xs opacity-75">{locations.find(l => l.id === selectedLocation)?.name}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <span className="text-sm">What needs attention?</span>
                                )}
                                <div className="flex items-center gap-1">
                                    {(selectedAsset || selectedLocation) && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSelectedAsset(null); setSelectedLocation(''); setLocationAutoFilled(false); }}
                                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                    <ChevronDown size={16} className="text-slate-400" />
                                </div>
                            </div>

                            {/* Resolved Hierarchy Breadcrumb */}
                            {(selectedAsset || selectedLocation) && (
                                <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
                                    <MapPin size={10} className="text-emerald-500 flex-shrink-0" />
                                    <span className="text-slate-500 font-mono">
                                        {selectedAsset
                                            ? (() => {
                                                const loc = findLocationAncestor(selectedAsset);
                                                return loc ? getLocationPath(loc) + ' › ' + selectedAsset.tag : selectedAsset.tag;
                                            })()
                                            : (() => {
                                                const loc = locations.find(l => l.id === selectedLocation);
                                                return loc ? getLocationPath(loc) : '—';
                                            })()
                                        }
                                    </span>
                                    {selectedAsset && selectedAsset.criticality && (
                                        <span className={`ml-1 px-1.5 py-0.5 rounded font-bold uppercase ${
                                            selectedAsset.criticality === 'A' ? 'bg-red-100 text-red-700' :
                                            selectedAsset.criticality === 'B' ? 'bg-amber-100 text-amber-700' :
                                            'bg-slate-100 text-slate-600'
                                        }`}>
                                            Crit {selectedAsset.criticality}
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Unified Dropdown */}
                            {showAssetPicker && (
                                <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-80 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                    <div className="p-2 border-b border-slate-100">
                                        <div className="relative">
                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                type="text"
                                                value={assetSearch}
                                                onChange={(e) => setAssetSearch(e.target.value)}
                                                placeholder="Search by tag, name, or location..."
                                                className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                                autoFocus
                                            />
                                        </div>
                                    </div>
                                    <div className="overflow-y-auto max-h-[300px]">
                                        {/* Equipment Section */}
                                        {(() => {
                                            const searchTerm = assetSearch.toLowerCase();
                                            const filteredEquipment = allAssets.filter(a =>
                                                !isLocationType(a) && (
                                                    a.tag.toLowerCase().includes(searchTerm) ||
                                                    a.name.toLowerCase().includes(searchTerm)
                                                )
                                            ).slice(0, 8);
                                            const filteredLocations = locations.filter(l =>
                                                l.tag.toLowerCase().includes(searchTerm) ||
                                                l.name.toLowerCase().includes(searchTerm)
                                            ).slice(0, 6);

                                            if (filteredEquipment.length === 0 && filteredLocations.length === 0) {
                                                return (
                                                    <div className="p-6 text-center text-slate-400 text-sm">
                                                        {isLoadingAssets ? 'Loading...' : 'No assets or locations match your search'}
                                                    </div>
                                                );
                                            }

                                            return (
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
                                                                        onClick={() => {
                                                                            handleSelectAsset(asset);
                                                                            setShowAssetPicker(false);
                                                                            setAssetSearch('');
                                                                        }}
                                                                        className={`px-3 py-2.5 cursor-pointer hover:bg-blue-50 border-b border-slate-50 last:border-0 transition-colors ${selectedAsset?.id === asset.id ? 'bg-blue-50 border-l-4 border-l-blue-500 pl-2' : ''}`}
                                                                    >
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="font-medium text-sm text-slate-800">{asset.tag}</div>
                                                                            {asset.criticality && (
                                                                                <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${
                                                                                    asset.criticality === 'A' ? 'bg-red-100 text-red-700' :
                                                                                    asset.criticality === 'B' ? 'bg-amber-100 text-amber-700' :
                                                                                    'bg-slate-100 text-slate-500'
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
                                                                    onClick={() => {
                                                                        handleSelectLocation(loc.id);
                                                                        setSelectedAsset(null);
                                                                        setShowAssetPicker(false);
                                                                        setAssetSearch('');
                                                                    }}
                                                                    className={`px-3 py-2.5 cursor-pointer hover:bg-emerald-50 border-b border-slate-50 last:border-0 transition-colors ${selectedLocation === loc.id ? 'bg-emerald-50 border-l-4 border-l-emerald-500 pl-2' : ''}`}
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
                                            );
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Problem Description Section */}
                        <div className="text-center mb-4">
                            <h3 className="text-xl font-semibold text-slate-900 mb-2">What seems to be the problem?</h3>
                            <p className="text-slate-500">Describe the issue naturally. Relantern AI will categorize it for you.</p>
                        </div>

                        <div className="relative">
                            <textarea
                                value={desc}
                                onChange={(e) => setDesc(e.target.value)}
                                placeholder="E.g., The feed pump in Unit 100 is vibrating heavily and making a grinding noise..."
                                className="w-full h-40 p-4 border border-slate-300 rounded-xl text-lg focus:ring-2 focus:ring-relantern-500 focus:border-blue-500 shadow-sm resize-none"
                            />
                            {/* Voice Button */}
                            <button
                                onClick={handleVoiceToText}
                                className={`absolute bottom-4 right-4 p-2 rounded-full transition-all ${isListening ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-slate-100 text-slate-500 hover:bg-blue-100 hover:text-blue-600'}`}
                                title="Dictate Description"
                            >
                                <Mic size={20} />
                            </button>
                        </div>

                        {/* Media Section */}
                        <div className="space-y-3">
                            <div className="flex gap-4">
                                <div className="flex-1 bg-slate-50 border border-slate-200 border-dashed rounded-xl p-4 flex flex-col items-center justify-center">
                                    <ImageCapture
                                        bucket="assets"
                                        prefix="sr_"
                                        currentImage={undefined}
                                        onImageCaptured={(url) => {
                                            const newFile: JobFile = {
                                                id: `file-${Date.now()}`,
                                                name: `Photo_${files.length + 1}.jpg`,
                                                type: 'image/jpeg',
                                                url,
                                                uploadedBy: profile?.username || 'Unknown User',
                                                uploadedAt: new Date().toISOString()
                                            };
                                            setFiles([...files, newFile]);
                                        }}
                                        shape="square"
                                        size="md"
                                        placeholder={<><Camera size={24} className="mb-2 text-slate-400" /><span className="text-sm font-medium text-slate-500">Capture / Add Photo</span></>}
                                    />
                                </div>
                                <div
                                    onClick={() => setShowScanner(true)}
                                    className="flex-1 bg-slate-50 border border-slate-200 border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-slate-500 hover:bg-blue-50 hover:border-blue-200 cursor-pointer transition"
                                >
                                    <QrCode size={24} className="mb-2" />
                                    <span className="text-sm font-medium">Scan Asset ID</span>
                                </div>

                                {/* QR/Barcode Scanner Modal */}
                                <ScanAssetModal
                                    isOpen={showScanner}
                                    onClose={() => setShowScanner(false)}
                                    assets={allAssets}
                                    onAssetFound={(asset) => handleSelectAsset(asset)}
                                />
                            </div>

                            {/* Preview Files */}
                            {files.length > 0 && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {files.map(f => (
                                        <div key={f.id} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200">
                                            <img src={f.url} alt="Proof" className="w-full h-full object-cover" />
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
                        </div>

                        {/* Functional Failure Selector (Added to Step 1) */}
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <FunctionalFailureSelector
                                value={funcFailure}
                                onChange={setFuncFailure}
                            />
                            <div className="mt-4 pt-4 border-t border-slate-200 flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="isBreakdown"
                                    checked={isBreakdown}
                                    onChange={(e) => setIsBreakdown(e.target.checked)}
                                    className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                />
                                <label htmlFor="isBreakdown" className="text-sm font-medium text-slate-700 cursor-pointer">
                                    This is a Breakdown (Equipment is stopped or cannot fulfill its function)
                                </label>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleSubmit}
                                disabled={!desc}
                                className="flex-1 py-4 border border-blue-600 text-blue-600 rounded-xl font-bold text-lg hover:bg-blue-50 transition-all disabled:opacity-50 disabled:border-slate-300 disabled:text-slate-400"
                            >
                                Save Request
                            </button>
                            <button
                                onClick={handleAnalyze}
                                disabled={!desc}
                                className="flex-[2] py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                            >
                                {isAnalyzing ? (
                                    <>Processing <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /></>
                                ) : (
                                    <><Zap size={20} fill="currentColor" /> Analyze & Categorize</>
                                )}
                            </button>
                        </div>
                    </div>
                )
                }

                {
                    step === 2 && (
                        <div className="space-y-6 max-w-2xl mx-auto animate-in slide-in-from-right duration-300">
                            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-3">
                                <Bot size={24} className="text-blue-600 mt-1" />
                                <div>
                                    <h4 className="font-bold text-blue-900">Nexus AI Analysis</h4>
                                    <p className="text-sm text-blue-700 mt-1">
                                        I've analyzed your description. Based on the keywords, I've identified the asset and suggested a priority level. Please review.
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Identified Asset</label>
                                    {selectedAsset ? (
                                        <div className="p-3 border border-green-200 bg-green-50 rounded-lg flex items-center justify-between">
                                            <div>
                                                <div className="font-bold text-slate-900">{selectedAsset.tag}</div>
                                                <div className="text-xs text-slate-500">{selectedAsset.name}</div>
                                            </div>
                                            <CheckCircle size={20} className="text-green-600" />
                                        </div>
                                    ) : (
                                        <div className="p-3 border border-slate-300 rounded-lg text-slate-500 italic">
                                            No specific asset detected.
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Suggested Priority</label>
                                    <div className={`p-3 border rounded-lg font-bold flex items-center gap-2 ${desc.toLowerCase().includes('leak') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                                        {desc.toLowerCase().includes('leak') ? 'HIGH (Safety Risk)' : 'MEDIUM'}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="md:col-span-1">
                                    {/* Searchable Functional Failure Combobox (Also in Step 2 for Review) */}
                                    <FunctionalFailureSelector
                                        value={funcFailure}
                                        onChange={(code) => {
                                            setFuncFailure(code);
                                            setValidationError(null); // Clear error on change
                                        }}
                                    />
                                    {validationError && (
                                        <p className="text-xs text-red-600 font-bold mt-1 animate-pulse">{validationError}</p>
                                    )}
                                </div>
                                <div className="md:col-span-1">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Category</label>
                                    <select
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="w-full p-2 border border-slate-300 rounded-lg bg-white h-[42px]"
                                    >
                                        <option value="GENERAL">General</option>
                                        <option value="MECHANICAL">Mechanical</option>
                                        <option value="ELECTRICAL">Electrical</option>
                                        <option value="INSTRUMENTATION">Instrumentation</option>
                                        <option value="FACILITIES">Facilities</option>
                                        <option value="SAFETY">Safety</option>
                                        <option value="HVAC">HVAC</option>
                                        <option value="CIVIL">Civil / Structural</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-6">
                                <button onClick={() => setStep(1)} className="px-6 py-3 border border-slate-300 rounded-lg text-slate-600 font-medium hover:bg-slate-50">Back</button>
                                <button onClick={handleSubmit} className="flex-1 py-3 bg-relantern-500 text-white rounded-lg font-bold hover:bg-relantern-600 shadow-md">Save Request</button>
                            </div>
                        </div>
                    )
                }
            </div >
        </div >
    );
};

// --- Request Detail / Triage View ---

const RequestDetail: React.FC<{
    request: ServiceRequest;
    onClose: () => void;
    onStatusChange: (id: string, s: RequestStatus) => void;
    onUpdate: (r: ServiceRequest) => void;
    onDelete: (id: string) => void;
    dictionaries?: any[];
}> = ({ request, onClose, onStatusChange, onUpdate, onDelete, dictionaries = [] }) => {

    // Real Auth Context - use Effective Permission Matrix
    const { user, profile, role, permissions } = useAuth();

    const currentUser = {
        id: user?.id || '',
        name: profile?.username || user?.email || 'Unknown',
        roles: role ? [role] : []
    };

    // Filter for Service Request statuses only
    const requestStatuses = dictionaries.filter(d => d.type === 'STATUS_CODE' && ['NEW', 'REVIEW', 'AUTHORIZED', 'APPROVED', 'REJECTED', 'CONVERTED'].includes(d.code));

    // Permission checks from Admin Effective Permission Matrix
    const canEdit = permissions?.requests?.edit === true;
    const canDelete = permissions?.requests?.delete === true;
    const canAuthorize = permissions?.requests?.authorize === true;
    const canApprove = permissions?.requests?.approve === true;

    // Rejection modal state
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

    // Logic: Editable if status is NEW or REVIEW. 
    // Approved, Rejected, Converted are generally locked for historical integrity.
    const isEditable = [RequestStatus.NEW, RequestStatus.REVIEW].includes(request.status) && canEdit;

    const handleFailureChange = (newCode: string) => {
        onUpdate({ ...request, functionalFailureType: newCode });
    };

    // Rejection handler with reason
    const handleReject = async () => {
        if (!rejectionReason.trim()) {
            alert('Please provide a reason for rejection.');
            return;
        }
        setIsProcessing(true);
        try {
            const db = DatabaseService.getInstance();
            await db.updateRequest(request.id, {
                status: 'REJECTED',
                rejection_reason: rejectionReason
            }, currentUser.id);
            onStatusChange(request.id, RequestStatus.REJECTED);
            setShowRejectModal(false);
            setRejectionReason('');
        } catch (e: any) {
            alert('Rejection failed: ' + e.message);
        } finally {
            setIsProcessing(false);
        }
    };

    // Approve handler - auto-converts to Work Order
    const handleApprove = async () => {
        setIsProcessing(true);
        try {
            const db = DatabaseService.getInstance();
            const wo = await db.approveRequestAndConvert(request.id, currentUser.id);
            alert(`Request approved! Work Order ${wo.wo_number} created.`);
            onStatusChange(request.id, RequestStatus.CONVERTED);
        } catch (e: any) {
            alert('Approval failed: ' + e.message);
        } finally {
            setIsProcessing(false);
        }
    };

    // Delete handler
    const handleDeleteClick = () => {
        setIsDeleteModalOpen(true);
    };

    const handleConfirmDelete = async () => {
        setIsProcessing(true);
        try {
            const db = DatabaseService.getInstance();
            await db.deleteRequest(request.id);
            onDelete(request.id);
        } catch (e: any) {
            alert('Delete failed: ' + e.message);
        } finally {
            setIsProcessing(false);
            setIsDeleteModalOpen(false);
        }
    };

    // Save handler - persists current edits to DB
    const handleSave = async () => {
        setIsProcessing(true);
        try {
            const db = DatabaseService.getInstance();
            await db.updateRequest(request.id, {
                description: request.description,
                functional_failure_id: request.functionalFailureType,
                status: request.status as any,
                is_breakdown: request.isBreakdown,
                category: request.category, // GAP-6: Persist category from detail view
            }, currentUser.id);
            alert('Request saved successfully.');
        } catch (e: any) {
            alert('Save failed: ' + e.message);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header with Status Dropdown */}
            <UnifiedDetailHeader
                title={request.title}
                subtitle={request.requestNumber}
                icon={<FileText size={18} />}
                onClose={onClose}
                badges={
                    <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Status</label>
                        <select
                            value={request.status}
                            onChange={(e) => onStatusChange(request.id, e.target.value as RequestStatus)}
                            disabled={!isEditable}
                            className={`text-xs border-slate-300 rounded-md bg-white px-2 py-1 ${!isEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                            {requestStatuses.length > 0 ? (
                                requestStatuses.map(s => (
                                    <option key={s.code} value={s.code}>{s.description}</option>
                                ))
                            ) : (
                                <>
                                    <option value="NEW">New / Draft</option>
                                    <option value="REVIEW">Under Review</option>
                                    <option value="AUTHORIZED">Authorized (Budget)</option>
                                    <option value="APPROVED">Approved (Technical)</option>
                                    <option value="REJECTED">Rejected</option>
                                    <option value="CONVERTED">Converted to Work Order</option>
                                </>
                            )}
                        </select>
                    </div>
                }
            />

            {/* Action Buttons */}
            {request.status !== RequestStatus.CONVERTED && request.status !== RequestStatus.REJECTED && (
                <div className="flex flex-wrap gap-2 p-3 border-b border-slate-200 bg-white items-center">
                    {/* Debug info */}
                    <span className="text-xs text-slate-400">Status: {request.status}</span>

                    {/* Save Button - requires edit permission */}
                    <button
                        onClick={handleSave}
                        disabled={isProcessing || !canEdit || !isEditable}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg flex items-center gap-1.5 ${canEdit && isEditable
                            ? 'bg-relantern-500 text-white hover:bg-relantern-600'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            } disabled:opacity-50`}
                    >
                        <Save size={14} />
                        Save
                    </button>


                    {/* Delete Button - requires delete permission */}
                    <button
                        onClick={handleDeleteClick}
                        disabled={isProcessing || !canDelete || request.status === RequestStatus.CONVERTED}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg flex items-center gap-1.5 border ${canDelete && request.status !== RequestStatus.CONVERTED
                            ? 'border-red-300 text-red-700 hover:bg-red-50'
                            : 'border-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        <Trash2 size={14} />
                        Delete
                    </button>

                    <span className="ml-auto"></span>

                    {/* Start Review - requires edit permission, only for NEW */}
                    <button
                        onClick={() => onStatusChange(request.id, RequestStatus.REVIEW)}
                        disabled={request.status !== RequestStatus.NEW || !canEdit}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg ${request.status === RequestStatus.NEW && canEdit
                            ? 'bg-slate-600 text-white hover:bg-slate-700'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        Review
                    </button>

                    {/* Reject - requires edit permission at REVIEW or AUTHORIZED */}
                    <button
                        onClick={() => setShowRejectModal(true)}
                        disabled={![RequestStatus.REVIEW, RequestStatus.AUTHORIZED].includes(request.status as RequestStatus) || isProcessing || !canEdit}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg border ${[RequestStatus.REVIEW, RequestStatus.AUTHORIZED].includes(request.status as RequestStatus) && canEdit
                            ? 'border-red-300 text-red-700 hover:bg-red-50'
                            : 'border-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        Reject
                    </button>

                    {/* Authorize - requires authorize permission at REVIEW status */}
                    {/* GAP-7 FIX: Writes authorized_by and authorized_at stamps for governance evidence */}
                    <button
                        onClick={async () => {
                            setIsProcessing(true);
                            try {
                                const db = DatabaseService.getInstance();
                                await db.updateRequest(request.id, {
                                    status: 'AUTHORIZED',
                                    authorized_by: currentUser.id,
                                    authorized_at: new Date().toISOString()
                                }, currentUser.id);
                                onStatusChange(request.id, RequestStatus.AUTHORIZED);
                            } catch (e: any) {
                                alert('Authorization failed: ' + e.message);
                            } finally {
                                setIsProcessing(false);
                            }
                        }}
                        disabled={request.status !== RequestStatus.REVIEW || isProcessing || !canAuthorize}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg ${request.status === RequestStatus.REVIEW && canAuthorize
                            ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        Authorize
                    </button>

                    {/* Approve - requires approve permission at AUTHORIZED status */}
                    <button
                        onClick={handleApprove}
                        disabled={request.status !== RequestStatus.AUTHORIZED || isProcessing || !canApprove}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg ${request.status === RequestStatus.AUTHORIZED && canApprove
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        {isProcessing ? 'Processing...' : 'Approve'}
                    </button>
                </div>
            )}

            {/* Rejection Modal */}
            {showRejectModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-4">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">Reject Request</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            Please provide a reason for rejecting this request. This will be recorded for audit purposes.
                        </p>
                        <textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Enter reason for rejection..."
                            className="w-full p-3 border border-slate-300 rounded-lg text-sm resize-none h-32 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                            autoFocus
                        />
                        <div className="flex justify-end gap-3 mt-4">
                            <button
                                onClick={() => { setShowRejectModal(false); setRejectionReason(''); }}
                                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleReject}
                                disabled={isProcessing || !rejectionReason.trim()}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isProcessing ? 'Rejecting...' : 'Confirm Rejection'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
                {/* JOB RAISED Badge for Converted Requests */}
                {request.status === RequestStatus.CONVERTED && (
                    <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                        <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                            <Check size={20} className="text-green-600" />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-green-800">JOB RAISED</div>
                            <div className="text-xs text-green-600">
                                Work Order {request.linkedWONumber || 'created'} generated from this request
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left Main Form */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* Request Form Card */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Request Code */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Request Code</label>
                                    <input
                                        type="text"
                                        value={request.requestNumber}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 font-mono text-sm"
                                    />
                                </div>

                                {/* Asset */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Asset</label>
                                    <input
                                        type="text"
                                        value={request.assetName || ''}
                                        readOnly={!isEditable}
                                        className={`w-full px-3 py-2 border rounded-lg text-sm ${isEditable ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}
                                    />
                                </div>

                                {/* Current Path (Location) */}
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Current Path</label>
                                    <input
                                        type="text"
                                        value={request.location || 'Location not specified'}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600 text-sm"
                                    />
                                </div>

                                {/* Fault Type (Functional Failure) */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Fault Type</label>
                                    <FunctionalFailureSelector
                                        value={request.functionalFailureType}
                                        onChange={handleFailureChange}
                                        readOnly={!isEditable}
                                    />
                                    {/* Breakdown Toggle */}
                                    <div className="mt-3 flex items-center gap-2">
                                        <input 
                                            type="checkbox" 
                                            id={`breakdown-${request.id}`}
                                            checked={request.isBreakdown || false}
                                            disabled={!isEditable}
                                            onChange={(e) => onUpdate({ ...request, isBreakdown: e.target.checked })}
                                            className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 disabled:opacity-50"
                                        />
                                        <label htmlFor={`breakdown-${request.id}`} className={`text-sm font-medium ${!isEditable ? 'text-slate-400' : 'text-slate-700 cursor-pointer'}`}>
                                            Breakdown (Equipment stopped)
                                        </label>
                                    </div>
                                </div>

                                {/* Priority */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Priority</label>
                                    <div className={`inline-flex items-center px-3 py-2 rounded-lg text-sm font-semibold
                                        ${request.priority === 'HIGH' ? 'bg-red-100 text-red-700 border border-red-200' :
                                            request.priority === 'MEDIUM' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                                                'bg-slate-100 text-slate-700 border border-slate-200'}
                                    `}>
                                        {request.priority}
                                    </div>
                                </div>

                                {/* Description */}
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Description</label>
                                    <textarea
                                        value={request.description}
                                        readOnly={!isEditable}
                                        rows={4}
                                        className={`w-full px-3 py-2 border rounded-lg text-sm resize-none ${isEditable ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Requester Info Card */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-900 mb-4 text-sm uppercase tracking-wide">Requester Information</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Contact</label>
                                    <input
                                        type="text"
                                        value={request.requesterName}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Department</label>
                                    <input
                                        type="text"
                                        value={request.requesterDepartment || 'Operations'}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Phone</label>
                                    <input
                                        type="text"
                                        value={request.requesterPhone || 'Not provided'}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Email</label>
                                    <input
                                        type="text"
                                        value={request.requesterEmail || 'Not provided'}
                                        readOnly
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* AI Triage Card - Only show if aiRiskScore exists */}
                        {request.aiRiskScore !== undefined && request.aiRiskScore > 0 && (
                            <div className="bg-white border border-indigo-100 rounded-xl shadow-sm overflow-hidden">
                                <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-100 flex items-center gap-2">
                                    <Zap size={18} className="text-indigo-600" fill="currentColor" />
                                    <h3 className="font-bold text-indigo-900 text-sm">Nexus AI Triage Assessment</h3>
                                    <span className="ml-auto text-xs text-indigo-600 font-medium">Confidence: {request.aiRiskScore}%</span>
                                </div>
                                <div className="p-4 space-y-3">
                                    <div className="flex items-start gap-3">
                                        <div className="mt-1"><ShieldCheck size={16} className="text-slate-400" /></div>
                                        <div>
                                            <span className="text-xs font-bold text-slate-500 uppercase">Risk Analysis (ISO 31000)</span>
                                            <p className="text-sm text-slate-700 mt-1">
                                                Risk Priority Number calculated based on asset criticality and failure severity.
                                                Score: <strong className={request.aiRiskScore > 70 ? 'text-red-600' : request.aiRiskScore > 40 ? 'text-orange-600' : 'text-green-600'}>{request.aiRiskScore}/100</strong>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Evidence Photos */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <ImageGallery
                                entityId={request.id}
                                entityType="SERVICE_REQUEST"
                                bucket="assets"
                                prefix="sr_"
                                readonly={request.status === RequestStatus.CONVERTED || request.status === RequestStatus.REJECTED}
                            />
                        </div>
                    </div>

                    {/* Right Sidebar - Audit Trail */}
                    <div className="space-y-6">
                        {/* Audit Info Card */}
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                            <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wide">Audit Trail</h3>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Created By</label>
                                <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 bg-slate-200 rounded-full flex items-center justify-center text-[10px] font-bold">
                                        {request.requesterName.charAt(0)}
                                    </div>
                                    <span className="text-sm text-slate-700">{request.requesterName}</span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Created</label>
                                <div className="text-sm text-slate-700 flex items-center gap-2">
                                    <Clock size={14} className="text-slate-400" />
                                    {new Date(request.createdAt).toLocaleDateString()} {new Date(request.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>

                            {request.authorizedBy && (
                                <>
                                    <hr className="border-slate-100" />
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Authorized By</label>
                                        <div className="text-sm text-slate-700">{request.authorizedBy}</div>
                                    </div>
                                    {request.authorizedAt && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Authorized</label>
                                            <div className="text-sm text-slate-700 flex items-center gap-2">
                                                <Clock size={14} className="text-slate-400" />
                                                {new Date(request.authorizedAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            <hr className="border-slate-100" />

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SLA Deadline</label>
                                <div className="text-sm text-slate-700 flex items-center gap-2">
                                    <Clock size={14} className="text-slate-400" />
                                    {new Date(request.slaDeadline).toLocaleDateString()}
                                </div>
                            </div>
                        </div>

                        {/* Media Grid */}
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-900 mb-4 text-sm uppercase tracking-wide">Attachments</h3>
                            {request.files && request.files.length > 0 ? (
                                <div className="grid grid-cols-2 gap-2">
                                    {request.files.map(f => (
                                        <div key={f.id} className="aspect-square bg-slate-100 rounded-lg overflow-hidden border border-slate-200 relative group cursor-pointer">
                                            <img src={f.url} alt={f.name} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white text-xs font-bold">
                                                View
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-4 border border-dashed border-slate-200 rounded-lg text-center text-slate-400 text-xs">
                                    No media attached.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
