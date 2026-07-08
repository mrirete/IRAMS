import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Settings, RefreshCw, Power, Clock, Zap, BarChart3, History, MapPin } from 'lucide-react';
import { useConnectors } from '../../hooks/useConnectors';
import { DQSRadarChart } from '../../components/connectors/DQSRadarChart';
import { SyncHistoryTable } from '../../components/connectors/SyncHistoryTable';
import type { ConnectorHealth, ConnectorSyncLog, ConnectorType } from '../../types/connectors';

type DetailTab = 'overview' | 'history' | 'mapping' | 'settings';

const TAB_ITEMS: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 size={15} /> },
    { id: 'history', label: 'Sync History', icon: <History size={15} /> },
    { id: 'mapping', label: 'Field Mapping', icon: <MapPin size={15} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={15} /> },
];

const getTypeName = (type: ConnectorType) => {
    const names: Record<ConnectorType, string> = {
        rest_api: 'REST API', database: 'Database', csv: 'CSV',
        mqtt: 'MQTT', opc_ua: 'OPC-UA', historian: 'Historian',
        document_store: 'Document Store', weather_api: 'Weather API',
    };
    return names[type] || type;
};

// More comprehensive mock logs
const generateMockLogs = (connectorId: string): ConnectorSyncLog[] => {
    const logs: ConnectorSyncLog[] = [];
    const now = Date.now();
    for (let i = 0; i < 18; i++) {
        const start = now - (i * 3600000 + Math.random() * 1800000);
        const duration = 2000 + Math.random() * 45000;
        const failed = Math.random() > 0.85 ? Math.floor(Math.random() * 5) : 0;
        logs.push({
            id: `log-${connectorId}-${i}`,
            connector_id: connectorId,
            start_time: new Date(start).toISOString(),
            end_time: new Date(start + duration).toISOString(),
            mode: i % 7 === 0 ? 'full' : 'incremental',
            status: failed > 2 ? 'failed' : 'completed',
            records_processed: Math.floor(Math.random() * 500) + 20,
            records_added: Math.floor(Math.random() * 50),
            records_updated: Math.floor(Math.random() * 400) + 20,
            records_failed: failed,
            error_message: failed > 2 ? 'Partial sync failure: 3 records rejected due to schema mismatch' : null,
            average_dqs_score: 75 + Math.random() * 20,
        });
    }
    return logs;
};

export const ConnectorDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { connectors, triggerSync } = useConnectors();

    const [connector, setConnector] = useState<ConnectorHealth | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [activeTab, setActiveTab] = useState<DetailTab>('overview');

    const mockLogs = useMemo(() => id ? generateMockLogs(id) : [], [id]);

    useEffect(() => {
        if (id && connectors.length > 0) {
            const found = connectors.find(c => c.connector_id === id);
            setConnector(found || null);
        }
    }, [id, connectors]);

    const handleSync = async () => {
        if (!id) return;
        setIsSyncing(true);
        await triggerSync(id, 'incremental');
        setTimeout(() => setIsSyncing(false), 2000);
    };

    // Compute throughput from logs
    const throughput = useMemo(() => {
        if (mockLogs.length === 0) return 0;
        const totalRecords = mockLogs.reduce((sum, l) => sum + l.records_processed, 0);
        const firstLog = mockLogs[mockLogs.length - 1];
        const lastLog = mockLogs[0];
        const hoursSpan = (new Date(lastLog.start_time).getTime() - new Date(firstLog.start_time).getTime()) / 3600000;
        return hoursSpan > 0 ? Math.round((totalRecords / hoursSpan) * 24) : totalRecords;
    }, [mockLogs]);

    if (!connector) {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <p className="text-slate-500 font-medium">Loading or connector not found.</p>
                <button onClick={() => navigate('/admin/connectors')} className="mt-4 text-primary-600 hover:text-primary-700 font-semibold transition-colors">
                    Return to Connector Hub
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                    <button
                        onClick={() => navigate('/admin/connectors')}
                        className="p-2 bg-white hover:bg-slate-50 rounded-lg text-slate-500 hover:text-slate-800 transition-colors border border-slate-300 shadow-sm"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <div className="flex items-center space-x-3">
                            <h1 className="text-2xl font-black text-slate-900 tracking-tight">{connector.name}</h1>
                            <span className={`px-2.5 py-1 rounded text-xs font-bold ${connector.overall_status === 'healthy' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                connector.overall_status === 'degraded' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                    'bg-red-50 text-red-700 border border-red-200'
                                }`}>
                                {connector.overall_status?.toUpperCase() || 'UNKNOWN'}
                            </span>
                        </div>
                        <p className="text-sm text-slate-500 font-medium mt-1">{getTypeName(connector.type)} Integration</p>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="flex items-center px-4 py-2.5 bg-accent-blue hover:bg-primary-600 text-white font-bold rounded-lg transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20 active:scale-95"
                    >
                        {isSyncing ? <RefreshCw size={18} className="mr-2 animate-spin" /> : <Play size={18} className="mr-2" />}
                        {isSyncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                </div>
            </div>

            {/* Top Metrics Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock size={14} className="text-slate-400" />
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Last Sync</p>
                    </div>
                    <p className="text-lg font-bold text-slate-900">
                        {connector.last_sync ? new Date(connector.last_sync).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'}
                    </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                        <Clock size={14} className="text-slate-400" />
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Next Sync</p>
                    </div>
                    <p className="text-lg font-bold text-slate-900">
                        {connector.next_sync ? new Date(connector.next_sync).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Manual Only'}
                    </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                        <Zap size={14} className="text-slate-400" />
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Throughput</p>
                    </div>
                    <p className="text-lg font-bold text-slate-900">
                        ~{throughput.toLocaleString()} <span className="text-xs text-slate-400 font-normal">rec/day</span>
                    </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <Power size={14} className="text-slate-400" />
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status</p>
                        </div>
                        <p className={`text-lg font-bold ${connector.status === 'running' ? 'text-emerald-600' : connector.status === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
                            {connector.status === 'running' ? 'Active' : connector.status === 'error' ? 'Error' : 'Stopped'}
                        </p>
                    </div>
                    <button className="p-2.5 bg-slate-50 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors border border-slate-200" title="Pause Connector">
                        <Power size={20} />
                    </button>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="border-b border-slate-200">
                <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                    {TAB_ITEMS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 shrink-0 whitespace-nowrap transition-colors ${activeTab === tab.id
                                ? 'border-accent-cyan text-primary-700'
                                : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'overview' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1">
                        <DQSRadarChart health={connector} />
                    </div>
                    <div className="lg:col-span-2">
                        <SyncHistoryTable logs={mockLogs.slice(0, 10)} />
                    </div>
                </div>
            )}

            {activeTab === 'history' && (
                <SyncHistoryTable logs={mockLogs} />
            )}

            {activeTab === 'mapping' && (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-sm">
                    <MapPin size={32} className="text-slate-400 mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-slate-800">Field Mapping Configuration</h3>
                    <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto font-medium">
                        View and edit how external fields are mapped to ERS ISO 14224 taxonomy.
                        This will be connected to the live mapping engine in a future update.
                    </p>
                </div>
            )}

            {activeTab === 'settings' && (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4 shadow-sm">
                    <Settings size={32} className="text-slate-400 mx-auto mb-3" />
                    <h3 className="text-lg font-bold text-slate-800">Connector Settings</h3>
                    <p className="text-sm text-slate-500 max-w-md mx-auto font-medium">
                        Reconfigure connection credentials, sync intervals, and retry policies.
                    </p>
                    <div className="flex items-center justify-center gap-3 mt-6">
                        <button className="px-4 py-2.5 bg-white text-slate-700 rounded-lg border border-slate-300 hover:bg-slate-50 hover:text-slate-900 transition-colors text-sm font-semibold shadow-sm">
                            Reconfigure
                        </button>
                        <button className="px-4 py-2.5 bg-red-50 text-red-600 rounded-lg border border-red-200 hover:bg-red-100 transition-colors text-sm font-semibold">
                            Delete Connector
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
