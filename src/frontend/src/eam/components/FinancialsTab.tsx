import React, { useState, useEffect } from 'react';
import { DollarSign, Shield, FileCheck, BookOpen, CreditCard, LayoutDashboard } from 'lucide-react';
import { Asset } from '../types';
import { FinOpsService, AssetFinancial, DepreciationBook, Warranty, DepreciationScheduleItem, AssetInsurance, InsuranceIncident, RecapitalizationResult } from '../services/FinOpsService';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

/** What the signed-in role may do on this tab. The tab itself is shown on finops.view. */
export interface FinancialsCan {
    create: boolean;
    edit: boolean;
    delete: boolean;
}

// Sub-tab components
import { FinancialsOverviewSubTab } from './financials/FinancialsOverviewSubTab';
import { LifecycleCostCard } from './financials/LifecycleCostCard';
import { DepreciationSubTab } from './financials/DepreciationSubTab';
import { WarrantiesSubTab } from './financials/WarrantiesSubTab';
import { InsuranceSubTab } from './financials/InsuranceSubTab';
import { ProcurementSubTab } from './financials/ProcurementSubTab';

interface FinancialsTabProps {
    asset: Asset;
}

// Error boundary wrapper
class FinancialsErrorBoundary extends React.Component<{children: React.ReactNode, asset: Asset}, {hasError: boolean, error: Error | null}> {
    constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
    componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('FinancialsTab crash:', error, info); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-6 m-4 bg-red-50 border border-red-200 rounded-xl">
                    <h3 className="font-bold text-red-700 mb-2">Financials Tab Error</h3>
                    <p className="text-sm text-red-600 mb-2">The Financials tab encountered an error while rendering:</p>
                    <pre className="text-xs bg-red-100 p-3 rounded overflow-auto max-h-40 text-red-800">{this.state.error?.message}{'\n'}{this.state.error?.stack}</pre>
                    <button onClick={() => this.setState({ hasError: false, error: null })} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export const FinancialsTab: React.FC<FinancialsTabProps> = (props) => (
    <FinancialsErrorBoundary asset={props.asset}>
        <FinancialsTabInner {...props} />
    </FinancialsErrorBoundary>
);

type FinancialSubTab = 'overview' | 'depreciation' | 'warranties' | 'insurance' | 'procurement';

const SUB_TABS: { key: FinancialSubTab; label: string; icon: React.FC<any> }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'depreciation', label: 'Depreciation', icon: BookOpen },
    { key: 'warranties', label: 'Warranties', icon: FileCheck },
    { key: 'insurance', label: 'Insurance', icon: Shield },
    { key: 'procurement', label: 'Procurement', icon: CreditCard },
];

const FinancialsTabInner: React.FC<FinancialsTabProps> = ({ asset }) => {
    // Per-action gating. The tab shows on finops.view; MANAGER and EXECUTIVE
    // hold view only and FINANCE cannot delete, and since 0394 the database
    // refuses the write — so the buttons follow the matrix instead of failing.
    const { permissions } = useAuth();
    const { showToast } = useToast();
    const confirmDialog = useConfirm();
    const can: FinancialsCan = {
        create: permissions?.finops?.create === true,
        edit: permissions?.finops?.edit === true,
        delete: permissions?.finops?.delete === true,
    };
    const [activeSubTab, setActiveSubTab] = useState<FinancialSubTab>('overview');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Core data
    const [financialRecord, setFinancialRecord] = useState<AssetFinancial | null>(null);
    const [books, setBooks] = useState<DepreciationBook[]>([]);
    const [warranties, setWarranties] = useState<Warranty[]>([]);
    const [insurancePolicies, setInsurancePolicies] = useState<AssetInsurance[]>([]);
    const [incidents, setIncidents] = useState<InsuranceIncident[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);

    // Overview-only state
    const [editedDowntimeCost, setEditedDowntimeCost] = useState<number>(0);
    const [isEditingDowntime, setIsEditingDowntime] = useState(false);

    useEffect(() => { loadFinancialData(); }, [asset.id]);

    const loadFinancialData = async () => {
        setLoading(true);

        // 1. Asset financial record (MUST load first — books need its ID)
        let record: AssetFinancial | null = null;
        try {
            record = await FinOpsService.getAssetFinancial(asset.id);
            setFinancialRecord(record);
            setEditedDowntimeCost(record?.downtimeCostPerHour || 0);
        } catch (err) {
            console.error("Error loading asset financial record:", err);
        }

        // 2. Depreciation books (uses financial record ID, NOT asset ID)
        try {
            if (record) {
                const allBooks = await FinOpsService.getDepreciationBooks(record.id);
                setBooks(allBooks);
            } else {
                setBooks([]);
            }
        } catch (e) { console.warn('Failed to load depreciation books:', e); }

        // 3. Warranties (independent)
        try {
            const assetWarranties = await FinOpsService.getWarrantiesForAsset(asset.id);
            setWarranties(assetWarranties);
        } catch (e) { console.warn('Failed to load warranties:', e); }

        // 4. Insurance (independent)
        try {
            const policies = await FinOpsService.getAssetInsurance(asset.id);
            setInsurancePolicies(policies);
        } catch (e) { console.warn('Failed to load insurance policies:', e); }

        // 5. Incidents (independent)
        try {
            const incidentList = await FinOpsService.getInsuranceIncidents(asset.id);
            setIncidents(incidentList);
        } catch (e) { console.warn('Failed to load insurance incidents:', e); }

        // 6. Purchase Orders (independent)
        try {
            const pos = await FinOpsService.getAssetPurchaseOrders(asset.id);
            setPurchaseOrders(pos);
        } catch (e) { console.warn('Failed to load purchase orders:', e); }

        setLoading(false);
    };

    // --- Handler functions (passed as props) ---

    const handleSaveDowntimeCost = async () => {
        setSaving(true);
        try {
            if (financialRecord) {
                const updated = await FinOpsService.updateAssetFinancial(financialRecord.id, {
                    downtimeCostPerHour: editedDowntimeCost
                });
                setFinancialRecord(updated);
            }
            setIsEditingDowntime(false);
        } catch (err) {
            console.error('Error saving downtime cost:', err);
            showToast(`Could not save the downtime rate: ${(err as any)?.message || err}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleCapitalize = async (cost: number, salvage: number, lifeYears: number, date: string) => {
        setSaving(true);
        try {
            const newRecord = await FinOpsService.createAssetFinancial(asset.id, {
                acquisitionCost: cost,
                residualValue: salvage,
                usefulLifeMonths: lifeYears * 12,
                acquisitionDate: date,
                capitalizationDate: date,
                downtimeCostPerHour: 0
            });
            setFinancialRecord(newRecord);
            await FinOpsService.createDepreciationBook({
                assetFinancialId: newRecord.id,
                bookType: 'CORPORATE',
                depreciationMethod: 'STRAIGHT_LINE',
                startDate: date,
                usageBased: false,
                currentValue: cost,
                accumulatedDepreciation: 0
            } as any);
            await loadFinancialData();
        } catch (err) {
            console.error('Error capitalizing asset:', err);
            showToast(`Could not capitalise the asset: ${(err as any)?.message || err}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleAddBook = async (bookType: string, method: string) => {
        if (!financialRecord) return;
        setSaving(true);
        try {
            await FinOpsService.createDepreciationBook({
                assetFinancialId: financialRecord.id,
                bookType: bookType as DepreciationBook['bookType'],
                depreciationMethod: method as DepreciationBook['depreciationMethod'],
                startDate: financialRecord.acquisitionDate,
                usageBased: method === 'UNITS_OF_PRODUCTION',
                currentValue: financialRecord.acquisitionCost,
                accumulatedDepreciation: 0
            });
            await loadFinancialData();
        } catch (err: any) {
            console.error('Error adding depreciation book:', err);
            const msg = err?.code === '23505'
                ? `A ${bookType} book already exists for this asset.`
                : 'Failed to add depreciation book.';
            showToast(msg, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteBook = async (bookId: string, bookType: string) => {
        const ok = await confirmDialog({ title: `Delete the ${bookType} book?`, message: 'Its projected schedule goes with it. A book with posted depreciation is refused by the database — reverse the postings first.', variant: 'danger', confirmLabel: 'Delete book' });
        if (!ok) return;
        setSaving(true);
        try {
            await FinOpsService.deleteDepreciationBook(bookId);
            await loadFinancialData();
        } catch (err) {
            console.error('Error deleting depreciation book:', err);
            showToast(`Could not delete the book: ${(err as any)?.message || err}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleResetFinancials = async () => {
        if (!financialRecord) return;
        const ok = await confirmDialog({ title: 'Reset capitalisation?', message: 'Deletes the financial record and every depreciation book on this asset. Refused by the database once depreciation has been posted — deactivate or dispose of the asset instead.', variant: 'danger', confirmLabel: 'Reset' });
        if (!ok) return;
        setSaving(true);
        try {
            await FinOpsService.deleteAssetFinancial(financialRecord.id);
            setFinancialRecord(null);
            setBooks([]);
            await loadFinancialData();
        } catch (err) {
            console.error('Error resetting financials:', err);
            showToast(`Could not reset: ${(err as any)?.message || err}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    // The add dialogs await this and show a thrown error inline, so the
    // failure reaches the user with their input still on screen.
    const handleAddWarranty = async (data: Partial<Warranty>) => {
        setSaving(true);
        try {
            await FinOpsService.createWarranty(asset.id, { ...data, status: 'ACTIVE', currentHours: 0 });
            await loadFinancialData();
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteWarranty = async (warrantyId: string, warrantyType: string) => {
        const ok = await confirmDialog({ title: `Delete this ${warrantyType} warranty?`, message: 'A warranty with claims is refused by the database; void it instead to keep the history.', variant: 'danger', confirmLabel: 'Delete' });
        if (!ok) return;
        setSaving(true);
        try {
            await FinOpsService.deleteWarranty(warrantyId);
            await loadFinancialData();
        } catch (err) {
            console.error('Error deleting warranty:', err);
            showToast(`Could not delete the warranty: ${(err as any)?.message || err}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdateWarranty = async (id: string, data: Partial<Warranty>) => {
        setSaving(true);
        try {
            await FinOpsService.updateWarranty(id, data);
            await loadFinancialData();
        } catch (err) {
            console.error('Error updating warranty:', err);
            showToast(`Could not update the warranty: ${(err as any)?.message || err}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleAddInsurance = async (data: Partial<AssetInsurance>) => {
        setSaving(true);
        try {
            await FinOpsService.createInsurance(asset.id, { ...data, status: 'ACTIVE' });
            await loadFinancialData();
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteInsurance = async (insuranceId: string, providerName: string) => {
        const ok = await confirmDialog({ title: `Delete the ${providerName} policy?`, message: 'A policy with incidents is refused by the database; mark it cancelled instead.', variant: 'danger', confirmLabel: 'Delete' });
        if (!ok) return;
        setSaving(true);
        try {
            await FinOpsService.deleteAssetInsurance(insuranceId);
            await loadFinancialData();
        } catch (err) {
            console.error('Error deleting insurance:', err);
            showToast(`Could not delete the policy: ${(err as any)?.message || err}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdateInsurance = async (id: string, data: Partial<AssetInsurance>) => {
        setSaving(true);
        try {
            await FinOpsService.updateAssetInsurance(id, data);
            await loadFinancialData();
        } catch (err) {
            console.error('Error updating insurance:', err);
            showToast(`Could not update the policy: ${(err as any)?.message || err}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    // --- Render ---

    if (loading) {
        return <div className="p-8 text-center text-slate-400">Loading financial ledger...</div>;
    }

    const primaryBook = books.find(b => b.bookType === 'CORPORATE') || books[0];

    return (
        <div className="space-y-4 animate-in fade-in duration-300">
            {/* Sub-Tab Navigation Bar */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-2 py-1.5 flex items-center gap-1 overflow-x-auto">
                {SUB_TABS.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeSubTab === tab.key;
                    return (
                        <button
                            key={tab.key}
                            onClick={() => setActiveSubTab(tab.key)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200
                                ${isActive
                                    ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                                }`}
                        >
                            <Icon size={14} className={isActive ? 'text-blue-500' : 'text-slate-400'} />
                            {tab.label}
                            {/* Badge indicators */}
                            {tab.key === 'warranties' && warranties.length > 0 && (
                                <span className="ml-0.5 bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[10px] font-bold">{warranties.length}</span>
                            )}
                            {tab.key === 'insurance' && insurancePolicies.length > 0 && (
                                <span className="ml-0.5 bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[10px] font-bold">{insurancePolicies.length}</span>
                            )}
                            {tab.key === 'procurement' && purchaseOrders.length > 0 && (
                                <span className="ml-0.5 bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[10px] font-bold">{purchaseOrders.length}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Active Sub-Tab Content */}
            {/* RF-01: what this asset has truly cost, trending how — above the fold */}
            {activeSubTab === 'overview' && <LifecycleCostCard assetId={asset.id} />}
            {activeSubTab === 'overview' && (
                <FinancialsOverviewSubTab
                    financialRecord={financialRecord}
                    primaryBook={primaryBook}
                    warranties={warranties}
                    canEdit={can.edit}
                    editedDowntimeCost={editedDowntimeCost}
                    isEditingDowntime={isEditingDowntime}
                    saving={saving}
                    setEditedDowntimeCost={setEditedDowntimeCost}
                    setIsEditingDowntime={setIsEditingDowntime}
                    onSaveDowntimeCost={handleSaveDowntimeCost}
                />
            )}

            {activeSubTab === 'depreciation' && (
                <DepreciationSubTab
                    asset={asset}
                    financialRecord={financialRecord}
                    books={books}
                    can={can}
                    saving={saving}
                    setSaving={setSaving}
                    onCapitalize={handleCapitalize}
                    onAddBook={handleAddBook}
                    onDeleteBook={handleDeleteBook}
                    onReload={loadFinancialData}
                    onReset={handleResetFinancials}
                />
            )}

            {activeSubTab === 'warranties' && (
                <WarrantiesSubTab
                    warranties={warranties}
                    can={can}
                    manufacturerId={asset.manufacturerId}
                    manufacturerName={asset.manufacturer}
                    saving={saving}
                    onAddWarranty={handleAddWarranty}
                    onDeleteWarranty={handleDeleteWarranty}
                    onUpdateWarranty={handleUpdateWarranty}
                />
            )}

            {activeSubTab === 'insurance' && (
                <InsuranceSubTab
                    assetId={asset.id}
                    insurancePolicies={insurancePolicies}
                    incidents={incidents}
                    can={can}
                    defaultInsuredValue={financialRecord?.replacementValue || financialRecord?.acquisitionCost || undefined}
                    saving={saving}
                    setSaving={setSaving}
                    onAddInsurance={handleAddInsurance}
                    onDeleteInsurance={handleDeleteInsurance}
                    onUpdateInsurance={handleUpdateInsurance}
                    onReload={loadFinancialData}
                />
            )}

            {activeSubTab === 'procurement' && (
                <ProcurementSubTab
                    asset={asset}
                    purchaseOrders={purchaseOrders}
                />
            )}
        </div>
    );
};
