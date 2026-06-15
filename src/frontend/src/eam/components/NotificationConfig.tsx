
import React, { useState, useMemo } from 'react';
import {
    Bell, Mail, MessageSquare, Smartphone, Zap,
    Plus, Trash2, Save, Edit2, CheckCircle, Shield, Clock, Users,
    AlertTriangle, Filter, ChevronDown, ChevronRight, Database, RefreshCw, Send
} from 'lucide-react';
import { MOCK_NOTIFICATION_RULES, MOCK_DICTIONARIES } from '../constants';
import { NotificationRule, NotificationSeverity, NotificationChannel, ModuleName, NotificationChannelConfig, MessageTemplate, NotificationLog } from '../types';
import { DatabaseService } from '../services/DatabaseService';
import { useEffect } from 'react';

export const NotificationConfig: React.FC = () => {
    const [rules, setRules] = useState<NotificationRule[]>([]);
    const [dictionaries, setDictionaries] = useState<any[]>([]);
    const [contacts, setContacts] = useState<any[]>([]);
    const [vendors, setVendors] = useState<any[]>([]);

    // New State for Channels & Templates
    const [channels, setChannels] = useState<NotificationChannelConfig[]>([]);
    const [templates, setTemplates] = useState<MessageTemplate[]>([]);
    const [logs, setLogs] = useState<NotificationLog[]>([]);
    const [editingTemplate, setEditingTemplate] = useState<Partial<MessageTemplate> | null>(null);

    const [isSeeding, setIsSeeding] = useState(false);
    const [editingRule, setEditingRule] = useState<Partial<NotificationRule> | null>(null);
    const [activeTab, setActiveTab] = useState<'RULES' | 'CHANNELS' | 'TEMPLATES'>('RULES');

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        const db = DatabaseService.getInstance();
        if (activeTab === 'RULES') {
            setRules(await db.getNotificationRules());
            setDictionaries(await db.getDictionaries());
            setContacts(await db.getContacts());
            setVendors(await db.getVendors());
        } else if (activeTab === 'CHANNELS') {
            setChannels(await db.getNotificationChannels());
            setLogs(await db.getNotificationLogs());
        } else if (activeTab === 'TEMPLATES') {
            setTemplates(await db.getMessageTemplates());
        }
    };

    const loadRules = async () => { // Legacy wrapper for existing calls
        setRules(await DatabaseService.getInstance().getNotificationRules());
    };

    // --- Channel Logic ---
    const toggleChannelActive = async (type: NotificationChannel, current: boolean) => {
        try {
            const db = DatabaseService.getInstance();
            const config: NotificationChannelConfig = channels.find(c => c.type === type) || {
                id: '', type, isActive: current, config: {}
            };

            // 1. Optimistic Update (for responsiveness)
            setChannels(prev => {
                const exists = prev.find(p => p.type === type);
                const updated = { ...config, isActive: !current };
                if (exists) return prev.map(p => p.type === type ? updated : p);
                return [...prev, updated];
            });

            // 2. Persist to DB
            const updated = { ...config, isActive: !current };
            await db.saveNotificationChannel(updated);

            // 3. Confirm Sync (Reload from DB)
            // This ensures "Database Sync" is real. If DB failed silent or optimistic lied, this fixes it.
            const verified = await db.getNotificationChannels();
            setChannels(verified);

            console.log(`[NotificationConfig] Channel ${type} synced: ${!current}`);

        } catch (error: any) {
            console.error("Failed to toggle channel:", error);
            alert(`Error updating channel: ${error.message || 'Unknown DB Error'}`);
            // Revert on error
            loadData();
        }
    };

    const handleSimulateSend = async (channelType: string = 'EMAIL') => {
        const recipient = prompt(`Enter recipient for ${channelType} test:`, 'test@user.com');
        if (!recipient) return;
        await DatabaseService.getInstance().logNotificationAudit(
            recipient, channelType,
            `[TEST] Channel Test — ${channelType}`,
            `This is a test message sent via the ${channelType} channel. If you see this, the channel is working correctly.`
        );
        alert(`Test sent via ${channelType}! Check the In-App Mailbox below.`);
        setLogs(await DatabaseService.getInstance().getNotificationLogs());
    };

    // --- Template Logic ---
    const handleSaveTemplate = async () => {
        if (!editingTemplate || !editingTemplate.name || !editingTemplate.triggerEvent) {
            alert("Name and Trigger are required.");
            return;
        }
        try {
            await DatabaseService.getInstance().saveMessageTemplate(editingTemplate as MessageTemplate);
            setEditingTemplate(null);
            setTemplates(await DatabaseService.getInstance().getMessageTemplates());
        } catch (e: any) {
            alert("Error saving template: " + e.message);
        }
    };

    // --- Actions ---
    const handleSeedRules = async () => {
        if (!confirm("This will populate default notification rules. Continue?")) return;
        setIsSeeding(true);
        try {
            for (const mock of MOCK_NOTIFICATION_RULES) {
                await DatabaseService.getInstance().addNotificationRule(mock);
            }
            await loadRules();
            alert("Default rules added successfully.");
        } catch (e: any) {
            alert("Error seeding rules: " + e.message);
        } finally {
            setIsSeeding(false);
        }
    };

    const handleSaveRule = async () => {
        if (!editingRule || !editingRule.name || !editingRule.module || !editingRule.eventTrigger) {
            alert("Please fill in all required fields (Name, Module, Event).");
            return;
        }

        try {
            console.log("Saving Rule:", editingRule);
            const ruleData = {
                ...editingRule,
                id: editingRule.id,
                isActive: editingRule.isActive ?? true,
                filters: editingRule.filters || [],
                recipients: editingRule.recipients || [],
                channels: editingRule.channels || ['IN_APP'],
                severity: editingRule.severity || 'INFO'
            };
            console.log("Rule Payload:", ruleData);

            if (editingRule.id) {
                // Update
                await DatabaseService.getInstance().updateNotificationRule(ruleData);
            } else {
                // Create
                await DatabaseService.getInstance().addNotificationRule(ruleData);
            }

            await loadRules();
            setEditingRule(null);
        } catch (e) {
            alert('Failed to save rule');
            console.error(e);
        }
    };

    const handleDeleteRule = async (id: string) => {
        if (confirm('Delete this notification rule? This action cannot be undone.')) {
            try {
                await DatabaseService.getInstance().deleteNotificationRule(id);
                // Close editor if the deleted rule was being edited
                if (editingRule?.id === id) setEditingRule(null);
                await loadRules();
            } catch (e: any) {
                alert('Failed to delete rule: ' + (e.message || 'Unknown error'));
            }
        }
    };

    const toggleRuleActive = async (id: string, current: boolean) => {
        const rule = rules.find(r => r.id === id);
        if (rule) {
            const updated = { ...rule, isActive: !current };
            // Optimistic update
            setRules(prev => prev.map(r => r.id === id ? updated : r));
            await DatabaseService.getInstance().updateNotificationRule(updated);
            // await loadRules(); // Optional
        }
    };

    // --- Helpers ---



    const modules: { key: ModuleName; label: string }[] = [
        { key: 'workOrders', label: 'Work Orders' },
        { key: 'requests', label: 'Requests' },
        { key: 'inventory', label: 'Inventory' },
        { key: 'pm', label: 'Preventive Maint.' },
        { key: 'readings', label: 'Condition Monitoring' },
        { key: 'purchasing', label: 'Purchasing' },
    ];

    const roles = useMemo(() => {
        const raw = dictionaries.filter(d => d.type === 'CONTACT_TYPE');
        // Deduplicate by Code (in case of seed duplicates)
        const unique = new Map();
        raw.forEach(r => {
            if (!unique.has(r.code)) unique.set(r.code, r);
        });
        return Array.from(unique.values()).sort((a: any, b: any) => a.description.localeCompare(b.description));
    }, [dictionaries]);

    // Hardcoded event options per module (fallback when NOTIFICATION_EVENT dictionaries don't exist)
    const BUILTIN_EVENTS: Record<string, { code: string; description: string }[]> = {
        workOrders: [
            { code: 'WO_CREATED', description: 'Work Order Created' },
            { code: 'WO_ASSIGNED', description: 'Work Order Assigned' },
            { code: 'WO_STATUS_CHANGE', description: 'Status Changed' },
            { code: 'WO_COMPLETED', description: 'Work Order Completed' },
            { code: 'WO_CLOSED', description: 'Work Order Closed' },
            { code: 'WO_OVERDUE', description: 'Work Order Overdue' },
            { code: 'WO_CANCELLED', description: 'Work Order Cancelled' },
            { code: 'WO_PRIORITY_ESCALATED', description: 'Priority Escalated' },
        ],
        requests: [
            { code: 'SR_CREATED', description: 'Service Request Created' },
            { code: 'SR_APPROVED', description: 'Service Request Approved' },
            { code: 'SR_REJECTED', description: 'Service Request Rejected' },
            { code: 'SR_STATUS_CHANGE', description: 'Status Changed' },
            { code: 'SR_CONVERTED_TO_WO', description: 'Converted to Work Order' },
        ],
        inventory: [
            { code: 'STOCK_LOW', description: 'Stock Below Reorder Point' },
            { code: 'STOCK_OUT', description: 'Stock Out (Zero Quantity)' },
            { code: 'STOCK_RECEIVED', description: 'Stock Received' },
            { code: 'STOCK_ISSUED', description: 'Stock Issued' },
            { code: 'STOCK_ADJUSTED', description: 'Stock Adjustment Made' },
        ],
        pm: [
            { code: 'PM_DUE', description: 'PM Due for Execution' },
            { code: 'PM_OVERDUE', description: 'PM Overdue' },
            { code: 'PM_WO_GENERATED', description: 'WO Generated from PM' },
            { code: 'PM_COMPLETED', description: 'PM Cycle Completed' },
        ],
        readings: [
            { code: 'READING_ALARM', description: 'Reading Exceeded Alarm Limit' },
            { code: 'READING_WARNING', description: 'Reading Exceeded Warning Limit' },
            { code: 'READING_MISSED', description: 'Scheduled Reading Missed' },
            { code: 'READING_TREND_ANOMALY', description: 'Trend Anomaly Detected' },
        ],
        purchasing: [
            { code: 'PO_CREATED', description: 'Purchase Order Created' },
            { code: 'PO_APPROVED', description: 'Purchase Order Approved' },
            { code: 'PO_RECEIVED', description: 'Goods Received' },
            { code: 'PO_OVERDUE', description: 'Purchase Order Overdue' },
            { code: 'PO_BUDGET_EXCEEDED', description: 'Budget Threshold Exceeded' },
        ],
    };

    // Dynamic events from dictionaries (Admin-configurable), filtered by selected module
    // Falls back to hardcoded BUILTIN_EVENTS if no dictionary entries exist
    const eventOptions = useMemo(() => {
        const selectedModule = editingRule?.module;
        const raw = dictionaries.filter(d => {
            if (d.type !== 'NOTIFICATION_EVENT' || d.active === false) return false;
            if (!selectedModule) return true;
            const modules = d.metadata?.modules || [];
            return modules.includes(selectedModule);
        });

        // If we have dictionary events, use them
        if (raw.length > 0) {
            const unique = new Map();
            raw.forEach(r => {
                if (!unique.has(r.code)) unique.set(r.code, r);
            });
            return Array.from(unique.values()).sort((a: any, b: any) => a.description.localeCompare(b.description));
        }

        // Fallback to hardcoded events for the selected module
        if (selectedModule && BUILTIN_EVENTS[selectedModule]) {
            return BUILTIN_EVENTS[selectedModule];
        }

        // If no module selected, return all built-in events
        return Object.values(BUILTIN_EVENTS).flat();
    }, [dictionaries, editingRule?.module]);

    return (
        <div className="flex h-full flex-col bg-white">
            {/* Sub-Header */}
            <div className="border-b border-slate-200 px-6 py-3 flex gap-6 text-sm font-medium">
                <button
                    onClick={() => setActiveTab('RULES')}
                    className={`pb-3 -mb-3.5 border-b-2 transition ${activeTab === 'RULES' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    Rules Engine
                </button>
                <button
                    onClick={() => setActiveTab('CHANNELS')}
                    className={`pb-3 -mb-3.5 border-b-2 transition ${activeTab === 'CHANNELS' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    Delivery Channels
                </button>
                <button
                    onClick={() => setActiveTab('TEMPLATES')}
                    className={`pb-3 -mb-3.5 border-b-2 transition ${activeTab === 'TEMPLATES' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    Message Templates
                </button>
            </div>

            <div className="flex-1 overflow-hidden flex">
                {activeTab === 'RULES' && (
                    <div className="flex-1 flex flex-col md:flex-row h-full">
                        {/* Rule List */}
                        <div className={`flex-1 flex flex-col overflow-hidden ${editingRule ? 'hidden md:flex md:w-1/2 border-r border-slate-200' : 'w-full'}`}>
                            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-slate-700">Notification Rules</h3>
                                <button
                                    onClick={() => setEditingRule({ isActive: true, channels: ['IN_APP'], recipients: [], severity: 'INFO' })}
                                    className="bg-relantern-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-relantern-600 flex items-center gap-2"
                                >
                                    <Plus size={14} /> New Rule
                                </button>
                            </div>
                            {rules.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                    <Bell size={48} className="mb-4 opacity-20" />
                                    <p>No message rules defined.</p>
                                    <button
                                        onClick={handleSeedRules}
                                        disabled={isSeeding}
                                        className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium flex items-center gap-2 border border-slate-300 transition-colors"
                                    >
                                        {isSeeding ? <Zap className="animate-spin" size={16} /> : <Database size={16} />}
                                        Seed Default Rules
                                    </button>
                                </div>
                            )}
                            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                {rules.map(rule => (
                                    <div
                                        key={rule.id}
                                        onClick={() => setEditingRule(rule)}
                                        className={`p-3 rounded-lg border cursor-pointer hover:bg-slate-50 transition group ${editingRule?.id === rule.id ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200'}`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="font-bold text-sm text-slate-800">{rule.name}</div>
                                            <div className="flex gap-2 items-center">
                                                <div
                                                    onClick={(e) => { e.stopPropagation(); toggleRuleActive(rule.id, rule.isActive); }}
                                                    className={`w-8 h-4 rounded-full p-0.5 cursor-pointer transition-colors ${rule.isActive ? 'bg-green-500' : 'bg-slate-300'}`}
                                                >
                                                    <div className={`w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform ${rule.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteRule(rule.id); }}
                                                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Delete Rule"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="text-xs text-slate-500 mb-2">{rule.description}</div>
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-slate-600">{rule.eventTrigger}</span>
                                            <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${rule.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                                                rule.severity === 'WARNING' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                                }`}>{rule.severity}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Rule Editor */}
                        {editingRule && (
                            <div className="flex-1 flex flex-col h-full bg-white overflow-y-auto animate-in slide-in-from-right duration-300">
                                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 sticky top-0 z-10">
                                    <h3 className="font-bold text-slate-800">{editingRule.id ? 'Edit Rule' : 'Create Rule'}</h3>
                                    <div className="flex gap-2">
                                        {editingRule.id && (
                                            <button
                                                onClick={() => handleDeleteRule(editingRule.id!)}
                                                className="text-red-500 hover:bg-red-50 px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 border border-red-200 hover:border-red-300 transition-colors"
                                            >
                                                <Trash2 size={14} /> Delete
                                            </button>
                                        )}
                                        <button onClick={() => setEditingRule(null)} className="text-slate-500 hover:text-slate-700 px-3 py-1.5 text-sm">Cancel</button>
                                        <button onClick={handleSaveRule} className="bg-relantern-500 text-white px-3 py-1.5 rounded text-sm font-bold hover:bg-relantern-600 flex items-center gap-2">
                                            <Save size={14} /> Save
                                        </button>
                                    </div>
                                </div>

                                <div className="p-6 space-y-6">
                                    {/* Basics */}
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Rule Name</label>
                                            <input
                                                type="text"
                                                value={editingRule.name || ''}
                                                onChange={e => setEditingRule({ ...editingRule, name: e.target.value })}
                                                className="w-full p-2 border border-slate-300 rounded text-sm"
                                                placeholder="e.g. Critical Asset Failure"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description</label>
                                            <textarea
                                                value={editingRule.description || ''}
                                                onChange={e => setEditingRule({ ...editingRule, description: e.target.value })}
                                                className="w-full p-2 border border-slate-300 rounded text-sm h-16 resize-none"
                                            />
                                        </div>
                                    </div>

                                    {/* Trigger */}
                                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                        <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><Zap size={16} className="text-amber-500" /> Trigger Condition</h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Module</label>
                                                <select
                                                    value={editingRule.module || ''}
                                                    onChange={e => setEditingRule({ ...editingRule, module: e.target.value as ModuleName })}
                                                    className="w-full p-2 border border-slate-300 rounded text-sm bg-white"
                                                >
                                                    <option value="">Select Module...</option>
                                                    {modules.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event</label>
                                                <select
                                                    value={editingRule.eventTrigger || ''}
                                                    onChange={e => setEditingRule({ ...editingRule, eventTrigger: e.target.value })}
                                                    className="w-full p-2 border border-slate-300 rounded text-sm bg-white"
                                                >
                                                    <option value="">Select Event...</option>
                                                    {eventOptions.map((e: any) => (
                                                        <option key={e.code} value={e.code}>{e.description}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Filters Mock */}
                                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                        <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><Filter size={16} className="text-blue-500" /> Filters (Optional)</h4>
                                        <div className="text-xs text-slate-500 italic mb-2">Apply this rule only when...</div>
                                        {editingRule.filters?.map((f, i) => (
                                            <div key={i} className="flex gap-2 mb-2 items-center">
                                                <select
                                                    value={f.field}
                                                    onChange={e => {
                                                        const filters = [...(editingRule.filters || [])];
                                                        filters[i] = { ...filters[i], field: e.target.value, value: '' };
                                                        setEditingRule({ ...editingRule, filters });
                                                    }}
                                                    className="text-xs font-mono bg-white px-2 py-1 border rounded w-32"
                                                >
                                                    <option value="">-- field --</option>
                                                    <option value="priority">Priority</option>
                                                    <option value="status">Status</option>
                                                    <option value="workType">Work Type</option>
                                                    <option value="criticality">Criticality</option>
                                                    <option value="department">Department</option>
                                                    <option value="site">Site</option>
                                                    <option value="assetCode">Asset Code</option>
                                                    <option value="severity">Severity</option>
                                                    <option value="category">Category</option>
                                                    <option value="requestType">Request Type</option>
                                                </select>
                                                <select
                                                    value={f.operator}
                                                    onChange={e => {
                                                        const filters = [...(editingRule.filters || [])];
                                                        filters[i] = { ...filters[i], operator: e.target.value as 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'GREATER_THAN' };
                                                        setEditingRule({ ...editingRule, filters });
                                                    }}
                                                    className="text-xs font-bold bg-white px-1 py-1 border rounded"
                                                >
                                                    <option value="EQUALS">EQUALS</option>
                                                    <option value="NOT_EQUALS">NOT EQUALS</option>
                                                    <option value="CONTAINS">CONTAINS</option>
                                                    <option value="GREATER_THAN">GREATER THAN</option>
                                                </select>
                                                <select
                                                    value={f.value}
                                                    onChange={e => {
                                                        const filters = [...(editingRule.filters || [])];
                                                        filters[i] = { ...filters[i], value: e.target.value };
                                                        setEditingRule({ ...editingRule, filters });
                                                    }}
                                                    className="text-xs font-mono bg-white px-2 py-1 border rounded w-32"
                                                >
                                                    <option value="">-- value --</option>
                                                    {f.field === 'priority' && <>
                                                        <option value="EMERGENCY">Emergency</option>
                                                        <option value="URGENT">Urgent</option>
                                                        <option value="HIGH">High</option>
                                                        <option value="MEDIUM">Medium</option>
                                                        <option value="LOW">Low</option>
                                                    </>}
                                                    {f.field === 'status' && <>
                                                        <option value="DRAFT">Draft</option>
                                                        <option value="OPEN">Open</option>
                                                        <option value="IN_PROGRESS">In Progress</option>
                                                        <option value="ON_HOLD">On Hold</option>
                                                        <option value="COMPLETE">Complete</option>
                                                        <option value="CLOSED">Closed</option>
                                                        <option value="CANCELLED">Cancelled</option>
                                                    </>}
                                                    {f.field === 'workType' && <>
                                                        <option value="CM">Corrective (CM)</option>
                                                        <option value="PM">Preventive (PM)</option>
                                                        <option value="PdM">Predictive (PdM)</option>
                                                        <option value="EM">Emergency (EM)</option>
                                                        <option value="CAP">Capital Project</option>
                                                        <option value="MOD">Modification</option>
                                                        <option value="INSP">Inspection</option>
                                                    </>}
                                                    {f.field === 'criticality' && <>
                                                        <option value="A">A — Safety Critical</option>
                                                        <option value="B">B — Production Critical</option>
                                                        <option value="C">C — Important</option>
                                                        <option value="D">D — Non-Critical</option>
                                                    </>}
                                                    {f.field === 'severity' && <>
                                                        <option value="CRITICAL">Critical</option>
                                                        <option value="WARNING">Warning</option>
                                                        <option value="INFO">Info</option>
                                                        <option value="SUCCESS">Success</option>
                                                    </>}
                                                    {f.field === 'category' && <>
                                                        <option value="MECHANICAL">Mechanical</option>
                                                        <option value="ELECTRICAL">Electrical</option>
                                                        <option value="INSTRUMENTATION">Instrumentation</option>
                                                        <option value="CIVIL">Civil</option>
                                                        <option value="SAFETY">Safety</option>
                                                        <option value="ENVIRONMENTAL">Environmental</option>
                                                    </>}
                                                    {f.field === 'requestType' && <>
                                                        <option value="BREAKDOWN">Breakdown</option>
                                                        <option value="OBSERVATION">Observation</option>
                                                        <option value="IMPROVEMENT">Improvement</option>
                                                        <option value="SAFETY_CONCERN">Safety Concern</option>
                                                        <option value="PLANNED">Planned</option>
                                                    </>}
                                                    {(f.field === 'department' || f.field === 'site' || f.field === 'assetCode') && (
                                                        <option value={f.value || ''}>{f.value || 'Type or select...'}</option>
                                                    )}
                                                </select>
                                                {/* Allow free text for department/site/assetCode */}
                                                {(f.field === 'department' || f.field === 'site' || f.field === 'assetCode') && (
                                                    <input
                                                        type="text"
                                                        value={f.value}
                                                        onChange={e => {
                                                            const filters = [...(editingRule.filters || [])];
                                                            filters[i] = { ...filters[i], value: e.target.value };
                                                            setEditingRule({ ...editingRule, filters });
                                                        }}
                                                        className="text-xs font-mono bg-white px-2 py-1 border rounded w-28"
                                                        placeholder={`Enter ${f.field}...`}
                                                    />
                                                )}
                                                <button
                                                    onClick={() => {
                                                        setEditingRule(prev => {
                                                            if (!prev) return null;
                                                            const filters = [...(prev.filters || [])];
                                                            filters.splice(i, 1);
                                                            return { ...prev, filters };
                                                        });
                                                    }}
                                                    className="text-red-500 hover:bg-red-50 p-1 rounded"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => {
                                                const filters = [...(editingRule.filters || []), { field: '', operator: 'EQUALS' as const, value: '' }];
                                                setEditingRule({ ...editingRule, filters });
                                            }}
                                            className="text-xs text-blue-600 font-medium flex items-center gap-1 mt-2 hover:text-blue-800"
                                        >+ Add Filter Condition</button>
                                    </div>

                                    {/* Recipients & Channels */}
                                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                        <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><Users size={16} className="text-green-500" /> Routing & Delivery</h4>

                                        <div className="mb-4">
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Recipients</label>

                                            {/* Dynamic Recipients */}
                                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1 mt-2">Dynamic (context-aware)</p>
                                            <div className="flex flex-wrap gap-2 mb-3">
                                                {['Assignee', 'Requester'].map(dyn => {
                                                    const isChecked = editingRule.recipients?.some(r => r.type === 'DYNAMIC' && r.targetId === dyn);
                                                    return (
                                                        <label key={dyn} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-slate-300 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                className="rounded text-blue-600"
                                                                onChange={(e) => {
                                                                    setEditingRule(prev => {
                                                                        if (!prev) return null;
                                                                        const current = prev.recipients || [];
                                                                        const next = e.target.checked
                                                                            ? [...current, { type: 'DYNAMIC' as const, targetId: dyn }]
                                                                            : current.filter(r => !(r.type === 'DYNAMIC' && r.targetId === dyn));
                                                                        return { ...prev, recipients: next };
                                                                    });
                                                                }}
                                                            />
                                                            <span className="text-sm">{dyn === 'Assignee' ? 'Job Assignee' : dyn}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>

                                            {/* By Role */}
                                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">By Role (all users with role)</p>
                                            <div className="flex flex-wrap gap-2 mb-3">
                                                {roles.map((role: any) => {
                                                    const isChecked = editingRule.recipients?.some(r => r.type === 'ROLE' && r.targetId === role.code);
                                                    return (
                                                        <label key={role.id} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-slate-300 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                className="rounded text-blue-600"
                                                                onChange={(e) => {
                                                                    setEditingRule(prev => {
                                                                        if (!prev) return null;
                                                                        const current = prev.recipients || [];
                                                                        const next = e.target.checked
                                                                            ? [...current, { type: 'ROLE' as const, targetId: role.code }]
                                                                            : current.filter(r => !(r.type === 'ROLE' && r.targetId === role.code));
                                                                        return { ...prev, recipients: next };
                                                                    });
                                                                }}
                                                            />
                                                            <span className="text-sm">{role.description}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>

                                            {/* Specific People */}
                                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Specific People (user directory)</p>
                                            <div className="flex flex-wrap gap-2 mb-3 max-h-32 overflow-y-auto">
                                                {contacts.filter((c: any) => c.userId || c.user_id).map((person: any) => {
                                                    const uid = person.userId || person.user_id;
                                                    const isChecked = editingRule.recipients?.some(r => r.type === 'USER' && r.targetId === uid);
                                                    const displayName = `${person.firstName || person.first_name || ''} ${person.lastName || person.last_name || ''}`.trim() || person.name;
                                                    const roleLabel = person.contactType || person.contact_type || '';
                                                    return (
                                                        <label key={uid} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-blue-200 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                className="rounded text-blue-600"
                                                                onChange={(e) => {
                                                                    setEditingRule(prev => {
                                                                        if (!prev) return null;
                                                                        const current = prev.recipients || [];
                                                                        const next = e.target.checked
                                                                            ? [...current, { type: 'USER' as const, targetId: uid }]
                                                                            : current.filter(r => !(r.type === 'USER' && r.targetId === uid));
                                                                        return { ...prev, recipients: next };
                                                                    });
                                                                }}
                                                            />
                                                            <span className="text-sm">{displayName}</span>
                                                            {roleLabel && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{roleLabel}</span>}
                                                        </label>
                                                    );
                                                })}
                                                {contacts.filter((c: any) => c.userId || c.user_id).length === 0 && (
                                                    <span className="text-xs text-slate-400 italic">No user accounts found in People module</span>
                                                )}
                                            </div>

                                            {/* External Vendors */}
                                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">External Vendors</p>
                                            <div className="flex flex-wrap gap-2">
                                                {vendors.filter((v: any) => v.active !== false).map((vendor: any) => {
                                                    const isChecked = editingRule.recipients?.some(r => r.type === 'VENDOR' && r.targetId === vendor.id);
                                                    return (
                                                        <label key={vendor.id} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-amber-200 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                className="rounded text-amber-600"
                                                                onChange={(e) => {
                                                                    setEditingRule(prev => {
                                                                        if (!prev) return null;
                                                                        const current = prev.recipients || [];
                                                                        const next = e.target.checked
                                                                            ? [...current, { type: 'VENDOR' as const, targetId: vendor.id }]
                                                                            : current.filter(r => !(r.type === 'VENDOR' && r.targetId === vendor.id));
                                                                        return { ...prev, recipients: next };
                                                                    });
                                                                }}
                                                            />
                                                            <span className="text-sm">{vendor.name}</span>
                                                            {vendor.email && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{vendor.email}</span>}
                                                        </label>
                                                    );
                                                })}
                                                {vendors.filter((v: any) => v.active !== false).length === 0 && (
                                                    <span className="text-xs text-slate-400 italic">No active vendors found</span>
                                                )}
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Channels</label>
                                            <div className="flex gap-4">
                                                {['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'WEBHOOK'].map(ch => (
                                                    <label key={ch} className="flex items-center gap-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingRule.channels?.includes(ch as any)}
                                                            className="rounded text-blue-600 focus:ring-primary-500"
                                                            onChange={(e) => {
                                                                const current = editingRule.channels || [];
                                                                const next = e.target.checked ? [...current, ch] : current.filter(x => x !== ch);
                                                                setEditingRule({ ...editingRule, channels: next as any });
                                                            }}
                                                        />
                                                        <span className="text-sm capitalize">{ch.replace('_', ' ').toLowerCase()}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Escalation */}
                                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                        <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><Clock size={16} className="text-red-500" /> Severity &amp; Escalation</h4>
                                        <div className="grid grid-cols-4 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Severity Level</label>
                                                <select
                                                    value={editingRule.severity}
                                                    onChange={e => setEditingRule({ ...editingRule, severity: e.target.value as any })}
                                                    className="w-full p-2 border border-slate-300 rounded text-sm bg-white"
                                                >
                                                    <option value="INFO">Info</option>
                                                    <option value="SUCCESS">Success</option>
                                                    <option value="WARNING">Warning</option>
                                                    <option value="CRITICAL">Critical</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Escalate After (Minutes)</label>
                                                <input
                                                    type="number"
                                                    placeholder="0 = Disabled"
                                                    value={editingRule.escalationTimeoutMinutes || ''}
                                                    onChange={e => setEditingRule({ ...editingRule, escalationTimeoutMinutes: parseInt(e.target.value) })}
                                                    className="w-full p-2 border border-slate-300 rounded text-sm"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Escalate To (Role)</label>
                                                <select
                                                    value={editingRule.escalationRecipientRole || ''}
                                                    onChange={e => setEditingRule({ ...editingRule, escalationRecipientRole: e.target.value })}
                                                    className={`w-full p-2 border rounded text-sm bg-white ${(editingRule.escalationTimeoutMinutes || 0) > 0 ? 'border-slate-300' : 'border-slate-200 text-slate-400'
                                                        }`}
                                                    disabled={!(editingRule.escalationTimeoutMinutes && editingRule.escalationTimeoutMinutes > 0)}
                                                >
                                                    <option value="">Same Recipient</option>
                                                    <option value="__SUPERVISOR">↑ Direct Supervisor</option>
                                                    {roles.map((role: any) => (
                                                        <option key={role.id} value={role.code}>{role.description}</option>
                                                    ))}
                                                </select>
                                                {(editingRule.escalationTimeoutMinutes || 0) > 0 && (
                                                    <p className="text-[10px] text-slate-400 mt-1">
                                                        {editingRule.escalationRecipientRole === '__SUPERVISOR'
                                                            ? 'Escalation goes to the org chart supervisor (original recipient stays in copy)'
                                                            : editingRule.escalationRecipientRole
                                                                ? `Escalation notifies all users with role: ${editingRule.escalationRecipientRole} (original recipient in copy)`
                                                                : 'Re-notifies the same recipient'
                                                        }
                                                    </p>
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Recipient Scope</label>
                                                <select
                                                    value={editingRule.escalationScope || 'ORG_UNIT'}
                                                    onChange={e => setEditingRule({ ...editingRule, escalationScope: e.target.value as any })}
                                                    className={`w-full p-2 border rounded text-sm bg-white ${(editingRule.recipients || []).some((r: any) => r.type === 'ROLE') || editingRule.escalationRecipientRole
                                                            ? 'border-slate-300'
                                                            : 'border-slate-200 text-slate-400'
                                                        }`}
                                                    disabled={!((editingRule.recipients || []).some((r: any) => r.type === 'ROLE') || editingRule.escalationRecipientRole)}
                                                >
                                                    <option value="ORG_UNIT">🏢 Org Unit (walk up hierarchy)</option>
                                                    <option value="SITE">📍 Same Site as Asset</option>
                                                    <option value="GLOBAL">🌐 Global (all with role)</option>
                                                </select>
                                                <p className="text-[10px] text-slate-400 mt-1">
                                                    {(editingRule.escalationScope || 'ORG_UNIT') === 'ORG_UNIT'
                                                        ? 'Finds nearest person with role in chain of command'
                                                        : (editingRule.escalationScope) === 'SITE'
                                                            ? 'Finds role holders at the same physical site'
                                                            : 'Notifies all users with this role enterprise-wide'
                                                    }
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="h-12"></div> {/* Spacer */}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'CHANNELS' && (
                    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
                        <div className="p-6 overflow-y-auto">
                            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                                <Smartphone size={18} /> Active Delivery Channels
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                                {['IN_APP', 'EMAIL', 'SMS', 'PUSH', 'WEBHOOK'].map((type) => {
                                    const isActive = channels.find(c => c.type === type)?.isActive ?? false;
                                    const icons: any = { EMAIL: Mail, SMS: MessageSquare, PUSH: Bell, IN_APP: Bell, WEBHOOK: Zap };
                                    const Icon = icons[type] || Bell;

                                    return (
                                        <div key={type} className={`bg-white p-4 rounded-lg border shadow-sm flex items-center justify-between ${isActive ? 'border-green-200' : 'border-slate-200'}`}>
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-full ${isActive ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
                                                    <Icon size={20} />
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm text-slate-700">{type.replace('_', ' ')}</div>
                                                    <div className="text-xs text-slate-500">{isActive ? 'Active' : 'Disabled'}</div>
                                                </div>
                                            </div>
                                            <div
                                                onClick={() => toggleChannelActive(type as NotificationChannel, isActive)}
                                                className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${isActive ? 'bg-green-500' : 'bg-slate-300'}`}
                                            >
                                                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                                            </div>
                                            {/* Gap #13: Per-channel test button */}
                                            {isActive && (
                                                <button
                                                    onClick={() => handleSimulateSend(type)}
                                                    className="ml-2 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded border border-blue-200 font-medium flex items-center gap-1"
                                                    title={`Send test via ${type}`}
                                                >
                                                    <Send size={12} /> Test
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* In-App Mailbox for Testing */}
                            <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col h-[500px]">
                                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-lg">
                                    <div className="flex items-center gap-2">
                                        <Mail size={16} className="text-blue-500" />
                                        <h4 className="font-bold text-slate-700">In-App Mailbox (Developer Tool)</h4>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => loadData()} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded"><RefreshCw size={14} /></button>
                                        <button
                                            onClick={() => handleSimulateSend()}
                                            className="bg-relantern-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-relantern-600 flex items-center gap-2"
                                        >
                                            <Send size={14} /> Simulate Send
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-0">
                                    {logs.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
                                            <Mail size={32} className="mb-2 opacity-20" />
                                            <p className="text-sm">No messages found. Try simulating a send.</p>
                                        </div>
                                    ) : (
                                        <table className="w-full text-sm text-left">
                                            <thead className="text-xs text-slate-500 bg-slate-50 border-b">
                                                <tr>
                                                    <th className="px-4 py-2">Time</th>
                                                    <th className="px-4 py-2">Channel</th>
                                                    <th className="px-4 py-2">Recipient</th>
                                                    <th className="px-4 py-2">Subject</th>
                                                    <th className="px-4 py-2">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {logs.map(log => (
                                                    <tr key={log.id} className="border-b hover:bg-slate-50 transition-colors">
                                                        <td className="px-4 py-2 font-mono text-xs text-slate-500">
                                                            {new Date(log.sentAt).toLocaleTimeString()}
                                                        </td>
                                                        <td className="px-4 py-2">
                                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded textxs font-bold">{log.channel}</span>
                                                        </td>
                                                        <td className="px-4 py-2 text-slate-600">{log.recipientId}</td>
                                                        <td className="px-4 py-2 font-medium text-slate-800">{log.subject}</td>
                                                        <td className="px-4 py-2">
                                                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${log.status === 'SENT' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                {log.status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'TEMPLATES' && (
                    <div className="flex-1 flex flex-col md:flex-row h-full">
                        {/* List */}
                        <div className={`flex-1 overflow-hidden flex flex-col ${editingTemplate ? 'hidden md:flex md:w-1/3 border-r border-slate-200' : 'w-full'}`}>
                            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-slate-700">Message Templates</h3>
                                <button
                                    onClick={() => setEditingTemplate({ isActive: true, channelType: 'EMAIL' })}
                                    className="bg-relantern-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-relantern-600 flex items-center gap-2"
                                >
                                    <Plus size={14} /> New
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                {templates.map(t => (
                                    <div
                                        key={t.id}
                                        onClick={() => setEditingTemplate(t)}
                                        className={`p-3 rounded-lg border cursor-pointer hover:bg-slate-50 transition ${editingTemplate?.id === t.id ? 'bg-blue-50 border-blue-500' : 'bg-white border-slate-200'}`}
                                    >
                                        <div className="font-bold text-sm text-slate-800 mb-1">{t.name}</div>
                                        <div className="flex gap-2 text-xs mb-1">
                                            <span className="bg-slate-100 px-1.5 rounded text-slate-600 font-mono">{t.triggerEvent}</span>
                                            <span className="bg-slate-100 px-1.5 rounded text-slate-600">{t.channelType}</span>
                                        </div>
                                    </div>
                                ))}
                                {templates.length === 0 && <div className="p-8 text-center text-slate-400 text-sm">No templates found.</div>}
                            </div>
                        </div>

                        {/* Editor */}
                        {editingTemplate && (
                            <div className="flex-1 flex flex-col h-full bg-white overflow-y-auto animate-in slide-in-from-right duration-300">
                                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 sticky top-0">
                                    <h3 className="font-bold text-slate-800">{editingTemplate.id ? 'Edit Template' : 'New Template'}</h3>
                                    <div className="flex gap-2">
                                        <button onClick={() => setEditingTemplate(null)} className="text-slate-500 hover:text-slate-700 px-3 py-1.5 text-sm">Cancel</button>
                                        <button onClick={handleSaveTemplate} className="bg-relantern-500 text-white px-3 py-1.5 rounded text-sm font-bold hover:bg-relantern-600 flex items-center gap-2">
                                            <Save size={14} /> Save
                                        </button>
                                    </div>
                                </div>
                                <div className="p-6 space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Template Name</label>
                                        <input
                                            type="text"
                                            value={editingTemplate.name || ''}
                                            onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                                            className="w-full p-2 border border-slate-300 rounded text-sm"
                                            placeholder="e.g. Technician Assignment Email"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Trigger Event</label>
                                            <select
                                                value={editingTemplate.triggerEvent || ''}
                                                onChange={e => setEditingTemplate({ ...editingTemplate, triggerEvent: e.target.value })}
                                                className="w-full p-2 border border-slate-300 rounded text-sm bg-white"
                                            >
                                                <option value="">Select Event...</option>
                                                <option value="JOB_ASSIGNED">Job Assigned</option>
                                                <option value="STATUS_CHANGE">Status Change</option>
                                                <option value="SLA_BREACH">SLA Breach</option>
                                                <option value="STOCK_LOW">Stock Low</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Channel</label>
                                            <select
                                                value={editingTemplate.channelType || 'EMAIL'}
                                                onChange={e => setEditingTemplate({ ...editingTemplate, channelType: e.target.value as any })}
                                                className="w-full p-2 border border-slate-300 rounded text-sm bg-white"
                                            >
                                                <option value="EMAIL">Email</option>
                                                <option value="SMS">SMS</option>
                                                <option value="PUSH">Push Notification</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject Template</label>
                                        <input
                                            type="text"
                                            value={editingTemplate.subjectTemplate || ''}
                                            onChange={e => setEditingTemplate({ ...editingTemplate, subjectTemplate: e.target.value })}
                                            className="w-full p-2 border border-slate-300 rounded text-sm font-mono text-slate-700"
                                            placeholder="New Job: {{wo_number}}"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Body Template</label>
                                        <div className="text-xs text-slate-400 mb-1">Supports Liquid syntax:  {`{{wo_number}}, {{title}}, {{assignee_name}}`}</div>
                                        <textarea
                                            value={editingTemplate.bodyTemplate || ''}
                                            onChange={e => setEditingTemplate({ ...editingTemplate, bodyTemplate: e.target.value })}
                                            className="w-full p-2 border border-slate-300 rounded text-sm font-mono h-64"
                                            placeholder="Hello {{assignee_name}}, you have been assigned..."
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
