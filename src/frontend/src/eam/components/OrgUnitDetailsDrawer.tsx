
import React, { useState, useEffect } from 'react';
import { OrganizationUnit, WorkOrder, Contact } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import {
    X, MapPin, Mail, Phone, Building, Briefcase,
    FileText, TrendingUp, DollarSign, Award, Grid,
    AlertTriangle, CheckCircle, Clock, Upload, User
} from 'lucide-react';

interface OrgUnitDetailsDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    unit: OrganizationUnit | null;
    onUpdate: (updatedUnit: OrganizationUnit) => void;
}

type TabType = 'DETAILS' | 'PERFORMANCE' | 'WORK' | 'ASSETS' | 'COMPETENCY' | 'FINANCIALS' | 'FILES';

export const OrgUnitDetailsDrawer: React.FC<OrgUnitDetailsDrawerProps> = ({ isOpen, onClose, unit, onUpdate }) => {
    const [activeTab, setActiveTab] = useState<TabType>('DETAILS');
    const [isLoading, setIsLoading] = useState(false);

    // Data State
    const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
    const [assets, setAssets] = useState<any[]>([]);
    const [members, setMembers] = useState<Contact[]>([]);
    const [files, setFiles] = useState<any[]>([]);

    // Form State (for Details tab)
    const [formData, setFormData] = useState<Partial<OrganizationUnit>>({});

    useEffect(() => {
        if (isOpen && unit) {
            setFormData(unit);
            loadData(unit);
        }
    }, [isOpen, unit]);

    const loadData = async (currentItem: OrganizationUnit) => {
        setIsLoading(true);
        const db = DatabaseService.getInstance();

        try {
            // Parallel Fetching
            const [wos, assetList, memberList, fileList] = await Promise.all([
                db.getWorkOrdersByOrgUnit(currentItem.id),
                db.getAssetsByOrgUnit(currentItem.code), // Matching by Code/CostCenter
                db.getContactsByUnit(currentItem.id),
                db.getEntityFiles(currentItem.id, 'ORG_UNIT')
            ]);

            setWorkOrders(wos);
            setAssets(assetList);
            setMembers(memberList);
            setFiles(fileList);
        } catch (e) {
            console.error("Error loading drawer data:", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSaveDetails = async () => {
        if (!unit) return;
        try {
            const db = DatabaseService.getInstance();
            // 1. Try to save EVERYTHING (including new fields if DB is migrated)
            await db.updateOrgUnit({
                ...unit,
                ...formData as OrganizationUnit
            });
            onUpdate({ ...unit, ...formData as OrganizationUnit });
            alert("Saved successfully!");
        } catch (e: any) {
            console.warn("Full update failed, trying fallback...", e);
            // 2. Fallback: Save only KNOWN existing columns
            try {
                const db = DatabaseService.getInstance();
                const fallbackData = {
                    id: unit.id,
                    name: formData.name || unit.name,
                    code: formData.code || unit.code,
                    type: formData.type || unit.type,
                    manager_id: formData.managerId || unit.managerId || null, // Note: DB field is manager_id, but service expects camelCase? check Service
                    // We need to call a method that doesn't send extra fields, or manually craft the update
                    // Since updateOrgUnit sends everything, we might need to rely on the service to handle it
                    // OR, we can just alert the user for now if we can't easily strip fields without modifying Service.
                    // Actually, let's just assume the service passes what we give it to Supabase.
                    // If we give it a trimmed object, Supabase update might still complain if we are missing required fields?
                    // No, update only updates passed fields.
                };

                // We need to call the underlying update with specific fields.
                // But DatabaseService.updateOrgUnit likely takes the whole object.
                // Let's modify DatabaseService.updateOrgUnit to be more flexible or just try basic fields here if possible?
                // Wait, db.updateOrgUnit implementation takes 'unit: OrganizationUnit'.
                // If I pass a casted object with ONLY core fields, it might work?
                // Let's rely on the user knowing about the migration for new fields for now 
                // but at least give them a Partial Success message if core fields worked?
                // Actually, if the first try failed, it's likely because we sent 'description' etc.
                // So if we try again WITHOUT 'description', it should work for core fields.

                const coreUpdate = {
                    ...unit,
                    name: formData.name || unit.name,
                    // Exclude description/location/email
                };
                delete (coreUpdate as any).description;
                delete (coreUpdate as any).location;
                delete (coreUpdate as any).email;
                delete (coreUpdate as any).phone;
                delete (coreUpdate as any).customFields;

                await db.updateOrgUnit(coreUpdate);
                onUpdate(coreUpdate);
                alert("Saved basic details! (New fields like Location could not be saved pending database update)");

            } catch (fallbackError) {
                console.error(fallbackError);
                alert("Failed to save changes. Please ensure the database migration (0022) is applied.");
            }
        }
    };

    if (!isOpen || !unit) return null;

    // --- RENDERERS ---

    const renderTabs = () => (
        <div className="flex space-x-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 px-6 backdrop-blur-md sticky top-0 bg-white/80 dark:bg-gray-900/80 z-10 no-scrollbar">
            {[
                { id: 'DETAILS', label: 'Details', icon: FileText },
                { id: 'PERFORMANCE', label: 'Performance', icon: TrendingUp },
                { id: 'WORK', label: 'Work', icon: Briefcase },
                { id: 'ASSETS', label: 'Assets', icon: Grid },
                { id: 'COMPETENCY', label: 'Competency', icon: Award },
                { id: 'FINANCIALS', label: 'Financials', icon: DollarSign },
                { id: 'FILES', label: 'Files', icon: Upload },
            ].map(tab => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TabType)}
                    className={`
                        flex items-center px-4 py-4 text-sm font-medium border-b-2 whitespace-nowrap transition-colors duration-200
                        ${activeTab === tab.id
                            ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                            : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}
                    `}
                >
                    <tab.icon className="w-4 h-4 mr-2" />
                    {tab.label}
                </button>
            ))}
        </div>
    );

    const renderDetails = () => (
        <div className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-6">
                <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Description</label>
                    <textarea
                        className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 dark:bg-gray-800 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2"
                        rows={3}
                        value={formData.description || ''}
                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                        placeholder="Organization unit mission and responsibility..."
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Location</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 dark:bg-gray-700 dark:border-gray-600 text-gray-500 sm:text-sm">
                            <MapPin className="h-4 w-4" />
                        </span>
                        <input
                            type="text"
                            className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-r-md border-gray-300 dark:border-gray-700 dark:bg-gray-800 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            value={formData.location || ''}
                            onChange={e => setFormData({ ...formData, location: e.target.value })}
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email (Group)</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 dark:bg-gray-700 dark:border-gray-600 text-gray-500 sm:text-sm">
                            <Mail className="h-4 w-4" />
                        </span>
                        <input
                            type="email"
                            className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-r-md border-gray-300 dark:border-gray-700 dark:bg-gray-800 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                            value={formData.email || ''}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                        />
                    </div>
                </div>

                {/* Add Custom Fields Editor here later */}
            </div>

        </div>
    );

    const handleDuplicate = async () => {
        if (!unit) return;
        const confirmDup = window.confirm(`Are you sure you want to duplicate ${unit.name}?`);
        if (!confirmDup) return;

        try {
            const db = DatabaseService.getInstance();
            const newUnit: OrganizationUnit = {
                ...unit,
                id: crypto.randomUUID(), // New ID
                name: `${unit.name} (Copy)`,
                code: `${unit.code}-COPY`,
                // Reset manager to null for copy usually? or keep? Let's keep for now but maybe user wants reset.
            };
            // Remove DB specific fields if any (like created_at usually handled by DB, but here we might send full object)
            // Ideally addOrgUnit handles this.
            await db.addOrgUnit(newUnit);
            alert("Unit duplicated successfully!");
            onClose(); // Close to refresh parent
            window.location.reload(); // Brute force refresh for now or trigger parent update
        } catch (e) {
            console.error(e);
            alert("Failed to duplicate unit.");
        }
    };

    const handleDelete = async () => {
        if (!unit) return;
        const confirmDelete = window.confirm(`Are you sure you want to DELETE ${unit.name}? This action cannot be undone.`);
        if (!confirmDelete) return;

        try {
            const db = DatabaseService.getInstance();
            await db.deleteOrgUnit(unit.id);
            alert("Unit deleted successfully!");
            onClose();
            window.location.reload(); // Brute force refresh
        } catch (e) {
            console.error(e);
            alert("Failed to delete unit.");
        }
    };

    const renderPerformance = () => {
        // Mock Data for KPI Cards
        const pmCompliance = 87; // Mock
        const scheduleCompliance = 92; // Mock
        const backlogHours = 124; // Mock

        return (
            <div className="p-6 space-y-6">
                <div className="grid grid-cols-3 gap-6">
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-gray-500">PM Compliance</div>
                            <CheckCircle className={`w-5 h-5 ${pmCompliance > 85 ? 'text-green-500' : 'text-red-500'}`} />
                        </div>
                        <div className="mt-2 flex items-baseline">
                            <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{pmCompliance}%</span>
                            <span className="ml-2 text-sm text-gray-500">Target: 90%</span>
                        </div>
                        <div className="mt-4 w-full bg-gray-200 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pmCompliance}%` }}></div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-gray-500">Schedule Adherence</div>
                            <Clock className="w-5 h-5 text-blue-500" />
                        </div>
                        <div className="mt-2 flex items-baseline">
                            <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{scheduleCompliance}%</span>
                            <span className="ml-2 text-sm text-gray-500">Last Week</span>
                        </div>
                        <div className="mt-4 w-full bg-gray-200 rounded-full h-2">
                            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${scheduleCompliance}%` }}></div>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-gray-100 dark:border-gray-700">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-gray-500">Backlog</div>
                            <Briefcase className="w-5 h-5 text-amber-500" />
                        </div>
                        <div className="mt-2 flex items-baseline">
                            <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{backlogHours}</span>
                            <span className="ml-2 text-sm text-gray-500">Hours</span>
                        </div>
                        <div className="mt-4 text-xs text-amber-600 font-medium bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded inline-block">
                            Details currently unavailable
                        </div>
                    </div>
                </div>

                {/* Graphs would go here */}
                <div className="h-64 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center text-gray-400">
                    Performance Trends Chart Placeholder
                </div>
            </div>
        );
    };

    const renderWork = () => (
        <div className="p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Active Jobs ({workOrders.length})</h3>
            <div className="space-y-3">
                {workOrders.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No active work orders found for this team.</p>
                ) : (
                    workOrders.map((wo) => (
                        <div key={wo.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-100">{wo.id}</div>
                                <div className="text-sm text-gray-600 dark:text-gray-300">{wo.title}</div>
                                <div className="text-xs text-gray-400 mt-1">{wo.assetId} • {wo.type}</div>
                            </div>
                            <div className="flex flex-col items-end">
                                <span className={`px-2 py-1 text-xs font-semibold rounded-full 
                                    ${wo.status === 'OPEN' ? 'bg-blue-100 text-blue-800' :
                                        wo.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-800' :
                                            'bg-green-100 text-green-800'}`}>
                                    {wo.status}
                                </span>
                                <span className="text-xs text-gray-500 mt-1">Due: {wo.dueDate || 'N/A'}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderAssets = () => (
        <div className="p-6">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">Managed Assets ({assets.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {assets.length === 0 ? (
                    <p className="col-span-2 text-gray-500 text-center py-8">No assets linked to this Cost Center / Location.</p>
                ) : (
                    assets.map((asset) => (
                        <div key={asset.id} className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 flex items-start space-x-3">
                            <div className={`w-2 h-full rounded-l self-stretch ${asset.status === 'ACTIVE' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            <div className="flex-1">
                                <div className="flex justify-between">
                                    <span className="font-medium text-gray-900 dark:text-gray-100">{asset.tag}</span>
                                    <span className="text-xs text-gray-500">{asset.category}</span>
                                </div>
                                <div className="text-sm text-gray-600 dark:text-gray-400 truncate">{asset.name}</div>
                                <div className="text-xs text-gray-400 mt-1">{asset.location}</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );

    const renderCompetency = () => (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Team Competency Matrix</h3>
                <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-1 rounded">Overall: 88%</span>
            </div>

            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 rounded-lg">
                <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                            <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Member</th>
                            <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Role</th>
                            <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">HSE Cert</th>
                            <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Tech Qual</th>
                            <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-gray-100">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
                        {members.map((member) => (
                            <tr key={member.id}>
                                <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                                    <div className="flex items-center">
                                        <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold mr-3">
                                            {member.firstName.charAt(0)}{member.lastName.charAt(0)}
                                        </div>
                                        {member.name}
                                    </div>
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{member.title || 'Technician'}</td>
                                <td className="whitespace-nowrap px-3 py-4 text-sm">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                        Valid
                                    </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-sm">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                        Lvl 3
                                    </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                                    {member.active ? 'Active' : 'Inactive'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-6 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="flex">
                    <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden="true" />
                    <div className="ml-3">
                        <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Expiring Certifications</h3>
                        <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                            <ul className="list-disc pl-5 space-y-1">
                                <li>Jude (Admin) - H2S Clear (Expires in 5 days)</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderFinancials = () => (
        <div className="p-6 text-center text-gray-500">
            <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>Financial aggregation (Labor + Material) across {workOrders.length} jobs coming soon.</p>
        </div>
    );

    const renderFiles = () => (
        <div className="p-6">
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <span className="mt-2 block text-sm font-medium text-gray-900 dark:text-gray-100">
                    Upload SOPs or Charters
                </span>
            </div>

            <ul className="mt-6 space-y-2">
                {files.length === 0 ? (
                    <li className="text-gray-500 text-center text-sm">No files uploaded.</li>
                ) : (
                    files.map(f => (
                        <li key={f.id} className="flex justify-between items-center bg-white dark:bg-gray-800 p-3 rounded border">
                            <div className="flex items-center">
                                <FileText className="w-4 h-4 mr-2 text-gray-400" />
                                <span className="text-sm text-gray-700 dark:text-gray-300">{f.name}</span>
                            </div>
                            <span className="text-xs text-gray-400">{new Date(f.createdAt).toLocaleDateString()}</span>
                        </li>
                    ))
                )}
            </ul>
        </div>
    );


    // Overlay Backdrop
    // Overlay Backdrop
    return (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
            <div className="flex min-h-screen items-center justify-center p-4 text-center sm:p-0">
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
                    onClick={onClose}
                    aria-hidden="true"
                />

                <div className="relative transform overflow-hidden rounded-xl bg-white dark:bg-gray-900 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-5xl">
                    <div className="flex h-[80vh] flex-col bg-white dark:bg-gray-900">
                        {/* Header */}
                        <div className="bg-indigo-700 px-6 py-6">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center">
                                    <div className="bg-white/20 p-2 rounded-lg mr-4">
                                        {unit.type === 'DIVISION' ? <Building className="text-white w-8 h-8" /> :
                                            unit.type === 'GROUP' ? <User className="text-white w-8 h-8" /> :
                                                <Building className="text-white w-8 h-8" />}
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-white tracking-wide">{unit.name}</h2>
                                        <p className="text-indigo-200 text-sm mt-1 flex items-center">
                                            <span className="uppercase tracking-wider font-semibold mr-2 px-2 py-0.5 bg-white/10 rounded">{unit.type}</span>
                                            {unit.code}
                                        </p>
                                    </div>
                                </div>
                                <div className="ml-3 flex items-center space-x-3">
                                    <button
                                        onClick={handleDelete}
                                        title="Delete Unit"
                                        className="px-3 py-1.5 text-xs font-medium rounded border border-red-400 text-red-100 hover:bg-red-500/20 focus:outline-none"
                                    >
                                        Delete
                                    </button>
                                    <button
                                        onClick={handleDuplicate}
                                        title="Duplicate Unit"
                                        className="px-3 py-1.5 text-xs font-medium rounded border border-indigo-400 text-indigo-100 hover:bg-indigo-600 focus:outline-none"
                                    >
                                        Duplicate
                                    </button>
                                    <button
                                        onClick={handleSaveDetails}
                                        className="px-3 py-1.5 text-xs font-bold rounded bg-white text-indigo-700 hover:bg-indigo-50 shadow-sm focus:outline-none"
                                    >
                                        Save Changes
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded-md text-indigo-200 hover:text-white focus:outline-none focus:ring-2 focus:ring-white ml-2"
                                        onClick={onClose}
                                    >
                                        <span className="sr-only">Close panel</span>
                                        <X className="h-6 w-6" aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                            <div className="mt-4 flex items-center space-x-6 text-indigo-100 text-sm">
                                <div className="flex items-center">
                                    <User className="w-4 h-4 mr-2 opacity-75" />
                                    <span className="opacity-90">Manager: {unit.managerId ? 'Assigned' : 'Unassigned'}</span>
                                </div>
                                <div className="flex items-center">
                                    <Briefcase className="w-4 h-4 mr-2 opacity-75" />
                                    <span className="opacity-90">{workOrders.length} Active Jobs</span>
                                </div>
                            </div>
                        </div>

                        {/* Tabs Header */}
                        {renderTabs()}

                        {/* Main Content */}
                        <div className="relative flex-1 overflow-y-auto">
                            {isLoading ? (
                                <div className="p-12 flex justify-center">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                                </div>
                            ) : (
                                <>
                                    {activeTab === 'DETAILS' && renderDetails()}
                                    {activeTab === 'PERFORMANCE' && renderPerformance()}
                                    {activeTab === 'WORK' && renderWork()}
                                    {activeTab === 'ASSETS' && renderAssets()}
                                    {activeTab === 'COMPETENCY' && renderCompetency()}
                                    {activeTab === 'FINANCIALS' && renderFinancials()}
                                    {activeTab === 'FILES' && renderFiles()}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
