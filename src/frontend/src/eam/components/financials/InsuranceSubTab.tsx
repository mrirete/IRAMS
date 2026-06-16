import React, { useState } from 'react';
import { Shield, AlertCircle, Plus, Edit3, Trash2, X, Save } from 'lucide-react';
import { FinOpsService, AssetInsurance, InsuranceIncident } from '../../services/FinOpsService';
import { AddInsuranceModal } from '../modals/AddInsuranceModal';

interface InsuranceProps {
    assetId: string;
    insurancePolicies: AssetInsurance[];
    incidents: InsuranceIncident[];
    saving: boolean;
    setSaving: (v: boolean) => void;
    onAddInsurance: (data: Partial<AssetInsurance>) => void;
    onDeleteInsurance: (id: string, provider: string) => void;
    onUpdateInsurance: (id: string, data: Partial<AssetInsurance>) => void;
    onReload: () => void;
}

export const InsuranceSubTab: React.FC<InsuranceProps> = ({
    assetId, insurancePolicies, incidents, saving, setSaving,
    onAddInsurance, onDeleteInsurance, onUpdateInsurance, onReload
}) => {
    const [showAddModal, setShowAddModal] = useState(false);

    // Inline edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editProvider, setEditProvider] = useState('');
    const [editPolicyNum, setEditPolicyNum] = useState('');
    const [editStartDate, setEditStartDate] = useState('');
    const [editEndDate, setEditEndDate] = useState('');
    const [editPremium, setEditPremium] = useState(0);
    const [editDeductible, setEditDeductible] = useState(0);
    const [editInsuredValue, setEditInsuredValue] = useState(0);

    // Claims form
    const [showClaimForm, setShowClaimForm] = useState(false);
    const [claimType, setClaimType] = useState('EQUIPMENT_DAMAGE');
    const [claimDescription, setClaimDescription] = useState('');
    const [claimEstDamage, setClaimEstDamage] = useState(0);

    const startEdit = (p: AssetInsurance) => {
        setEditingId(p.id);
        setEditProvider(p.provider);
        setEditPolicyNum(p.policyNumber);
        setEditStartDate(p.startDate);
        setEditEndDate(p.endDate);
        setEditPremium(p.premiumAmount);
        setEditDeductible(p.deductible);
        setEditInsuredValue(p.insuredValue);
    };

    const handleSave = () => {
        if (!editingId) return;
        onUpdateInsurance(editingId, {
            provider: editProvider,
            policyNumber: editPolicyNum,
            startDate: editStartDate,
            endDate: editEndDate,
            premiumAmount: editPremium,
            deductible: editDeductible,
            insuredValue: editInsuredValue
        });
        setEditingId(null);
    };

    const handleFileClaim = async () => {
        setSaving(true);
        try {
            await FinOpsService.trackInsuranceIncident(assetId, '', claimType, claimDescription, claimEstDamage);
            await onReload();
            setShowClaimForm(false);
            setClaimDescription('');
            setClaimEstDamage(0);
        } catch (err) {
            console.error('Error filing claim:', err);
            alert('Failed to file insurance claim.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Insurance Policies */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <Shield size={16} className="text-slate-400" />
                        Insurance Policies
                    </h3>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="text-xs bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg flex items-center gap-1 font-medium transition"
                    >
                        <Plus size={12} /> Add Policy
                    </button>
                </div>

                {insurancePolicies.length === 0 ? (
                    <div className="p-10 text-center">
                        <Shield size={28} className="mx-auto mb-2 text-slate-300" />
                        <div className="text-sm text-slate-400 italic">No insurance policies.</div>
                        <div className="text-xs text-slate-400 mt-1">Add a property or equipment insurance policy.</div>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {insurancePolicies.map(p => (
                            <div key={p.id} className="p-4 hover:bg-slate-50/50 transition">
                                {editingId === p.id ? (
                                    <div className="space-y-3 bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Provider</label>
                                                <input type="text" value={editProvider} onChange={e => setEditProvider(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Policy #</label>
                                                <input type="text" value={editPolicyNum} onChange={e => setEditPolicyNum(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Start Date</label>
                                                <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">End Date</label>
                                                <input type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Premium ($)</label>
                                                <input type="number" value={editPremium} onChange={e => setEditPremium(parseFloat(e.target.value) || 0)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Deductible ($)</label>
                                                <input type="number" value={editDeductible} onChange={e => setEditDeductible(parseFloat(e.target.value) || 0)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase">Insured Val ($)</label>
                                                <input type="number" value={editInsuredValue} onChange={e => setEditInsuredValue(parseFloat(e.target.value) || 0)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                                            </div>
                                        </div>
                                        <div className="flex justify-end gap-2 pt-1">
                                            <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded flex items-center gap-1">
                                                <X size={12} /> Cancel
                                            </button>
                                            <button onClick={handleSave} disabled={saving} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-primary-500 flex items-center gap-1 disabled:opacity-50">
                                                <Save size={12} /> {saving ? '...' : 'Save'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex justify-between items-start mb-1">
                                            <div>
                                                <div className="font-medium text-slate-800 text-sm">{p.provider}</div>
                                                <div className="text-xs text-slate-500">#{p.policyNumber}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => startEdit(p)} className="text-xs text-blue-400 hover:text-blue-600 p-0.5" title="Edit policy">
                                                    <Edit3 size={13} />
                                                </button>
                                                <button onClick={() => onDeleteInsurance(p.id, p.provider)} className="text-xs text-red-400 hover:text-red-600 p-0.5" title="Delete policy">
                                                    <Trash2 size={13} />
                                                </button>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${p.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                    {p.status}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center mt-2 text-xs">
                                            <span className="text-slate-500">Premium: ${(p.premiumAmount ?? 0).toLocaleString()}</span>
                                            <span className="text-slate-500">Exp: {p.endDate ? new Date(p.endDate).toLocaleDateString() : 'N/A'}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Insurance Claims */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <AlertCircle size={16} className="text-slate-400" />
                        Insurance Claims
                    </h3>
                    <button
                        onClick={() => setShowClaimForm(!showClaimForm)}
                        className="text-xs bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg flex items-center gap-1 font-medium transition"
                    >
                        <Plus size={12} /> File Claim
                    </button>
                </div>

                {/* Add Claim Inline Form */}
                {showClaimForm && (
                    <div className="p-4 bg-blue-50 border-b border-blue-100 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Incident Type</label>
                                <select value={claimType} onChange={e => setClaimType(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white">
                                    <option value="EQUIPMENT_DAMAGE">Equipment Damage</option>
                                    <option value="FIRE">Fire</option>
                                    <option value="NATURAL_DISASTER">Natural Disaster</option>
                                    <option value="THEFT">Theft</option>
                                    <option value="VANDALISM">Vandalism</option>
                                    <option value="COLLISION">Collision</option>
                                    <option value="WATER_DAMAGE">Water Damage</option>
                                    <option value="OTHER">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Est. Damage ($)</label>
                                <input type="number" value={claimEstDamage} onChange={e => setClaimEstDamage(parseFloat(e.target.value) || 0)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white" />
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Description</label>
                            <textarea value={claimDescription} onChange={e => setClaimDescription(e.target.value)} className="w-full px-2 py-1.5 border border-blue-300 rounded text-xs bg-white h-16" placeholder="Describe the incident..." />
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                            <button onClick={() => { setShowClaimForm(false); setClaimDescription(''); setClaimEstDamage(0); }} className="px-2 py-1 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded flex items-center gap-1">
                                <X size={12} /> Cancel
                            </button>
                            <button onClick={handleFileClaim} disabled={saving || !claimDescription} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-primary-500 flex items-center gap-1 disabled:opacity-50">
                                <Save size={12} /> {saving ? '...' : 'File Claim'}
                            </button>
                        </div>
                    </div>
                )}

                {incidents.length === 0 && !showClaimForm ? (
                    <div className="p-10 text-center">
                        <AlertCircle size={28} className="mx-auto mb-2 text-slate-300" />
                        <div className="text-sm text-slate-400 italic">No claims filed.</div>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50">
                        {incidents.map(inc => (
                            <div key={inc.id} className="p-3 hover:bg-slate-50">
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="font-mono text-blue-600 font-medium">{inc.incidentNumber}</span>
                                    <span className={`px-1.5 py-0.5 rounded-full font-bold uppercase text-[10px]
                                        ${inc.claimStatus === 'OPEN' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                                        {inc.claimStatus}
                                    </span>
                                </div>
                                <div className="text-xs text-slate-600 mb-1">{inc.incidentType}</div>
                                <div className="flex justify-between text-xs text-slate-400">
                                    <span>{new Date(inc.incidentDate).toLocaleDateString()}</span>
                                    <span className="font-mono text-slate-600">${(inc.totalCost ?? 0).toLocaleString()}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <AddInsuranceModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSave={(data) => { onAddInsurance(data); setShowAddModal(false); }}
            />
        </div>
    );
};
