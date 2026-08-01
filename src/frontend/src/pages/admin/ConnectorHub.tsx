import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Database, ShieldCheck, Activity, Search, LayoutGrid, List, SlidersHorizontal, AlertTriangle, UploadCloud, Info } from 'lucide-react';
import { useConnectors } from '../../hooks/useConnectors';
import { ConnectorCard } from '../../components/connectors/ConnectorCard';
import { ImportReadingsModal } from '../../components/connectors/ImportReadingsModal';
import type { ConnectorStatus } from '../../types/connectors';

type SortKey = 'name' | 'dqs' | 'last_sync' | 'status';
type ViewMode = 'grid' | 'list';

const STATUS_FILTERS: { label: string; value: ConnectorStatus | 'all' }[] = [
    { label: 'All', value: 'all' },
    { label: 'Running', value: 'running' },
    { label: 'Stopped', value: 'stopped' },
    { label: 'Error', value: 'error' },
];

export const ConnectorHub: React.FC = () => {
    const { connectors, isLoading, error, triggerSync } = useConnectors();

    // --- Filter / Sort / Search state ---
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<ConnectorStatus | 'all'>('all');
    const [sortKey, setSortKey] = useState<SortKey>('name');
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [importOpen, setImportOpen] = useState(false);

    // --- Derived data ---
    const filteredConnectors = useMemo(() => {
        let result = [...connectors];

        // Search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(c =>
                c.name.toLowerCase().includes(q) ||
                c.type.toLowerCase().includes(q) ||
                c.connector_id.includes(q)
            );
        }

        // Status filter
        if (statusFilter !== 'all') {
            result = result.filter(c => c.status === statusFilter);
        }

        // Sort
        result.sort((a, b) => {
            switch (sortKey) {
                case 'name': return a.name.localeCompare(b.name);
                case 'dqs': return (b.dqs_score ?? 0) - (a.dqs_score ?? 0);
                case 'last_sync': {
                    const aTime = a.last_sync ? new Date(a.last_sync).getTime() : 0;
                    const bTime = b.last_sync ? new Date(b.last_sync).getTime() : 0;
                    return bTime - aTime;
                }
                case 'status': {
                    const order: Record<string, number> = { error: 0, stopped: 1, starting: 2, running: 3 };
                    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                }
                default: return 0;
            }
        });

        return result;
    }, [connectors, searchQuery, statusFilter, sortKey]);

    const activeCount = connectors.filter(c => c.status === 'running').length;
    const errorCount = connectors.filter(c => c.status === 'error').length;
    const connectorsWithDqs = connectors.filter(c => c.dqs_score !== undefined && c.dqs_score !== null);
    const avgDqs = connectorsWithDqs.length > 0
        ? connectorsWithDqs.reduce((acc, c) => acc + (c.dqs_score || 0), 0) / connectorsWithDqs.length
        : 0;
    const totalRecords = connectors.reduce((acc, c) => acc + (c.records_synced ?? 0), 0);

    const formatRecordCount = (n: number) => {
        if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return n.toString();
    };

    return (
        <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <Database size={22} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Connector Hub</h1>
                        <p className="text-slate-500 text-sm font-medium">Manage data integrations and monitor feed health.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 w-fit">
                    <button
                        onClick={() => setImportOpen(true)}
                        className="px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-500 transition-all flex items-center space-x-2 shadow-lg shadow-blue-500/20 active:scale-95"
                        title="Import a historian/SCADA/lab CSV export into ers_sensor_readings (feeds Predict)"
                    >
                        <UploadCloud size={18} />
                        <span>Import Readings (CSV)</span>
                    </button>
                    <Link
                        to="/admin/connectors/new"
                        className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-all flex items-center space-x-2 active:scale-95"
                    >
                        <Plus size={18} />
                        <span>Add Connector</span>
                    </Link>
                </div>
            </div>

            {/* Cloud route (sensor-sync): REST, historian, weather. Plus manual
                CSV import. Plant-local protocols run on the Collector agent. */}
            <div className="flex items-start gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                <Info size={14} className="shrink-0 mt-0.5 text-blue-600" />
                <span>
                    <strong>REST API</strong>, <strong>Historian</strong>, and <strong>Weather</strong> connectors run in the cloud with nothing to install,
                    alongside <strong>CSV import</strong> — all write real rows into the sensor feed Predict reads.
                    OPC-UA, MQTT, on-prem databases, and file drops run on the ERS Collector inside your network.
                </span>
            </div>

            {/* High-Level System Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex items-center space-x-3">
                    <div className="p-2.5 bg-primary-50 rounded-lg text-primary-600">
                        <Database size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 uppercase tracking-wider font-bold">Active Feeds</div>
                        <div className="text-xl font-black text-slate-900">{activeCount}<span className="text-sm text-slate-400 font-normal ml-1">/ {connectors.length}</span></div>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex items-center space-x-3">
                    <div className="p-2.5 bg-emerald-50 rounded-lg text-emerald-600">
                        <ShieldCheck size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 uppercase tracking-wider font-bold">System DQS</div>
                        <div className="flex items-baseline space-x-1">
                            {connectorsWithDqs.length === 0 ? (
                                <span className="text-xl font-black text-slate-300" title="Data-quality scoring not yet computed for any feed">—</span>
                            ) : (
                                <>
                                    <span className={`text-xl font-black ${avgDqs >= 80 ? 'text-emerald-600' : avgDqs >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{avgDqs.toFixed(1)}</span>
                                    <span className="text-xs text-slate-400">/ 100</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex items-center space-x-3">
                    <div className="p-2.5 bg-blue-50 rounded-lg text-blue-600">
                        <Activity size={20} />
                    </div>
                    <div>
                        <div className="text-xs text-slate-500 uppercase tracking-wider font-bold">Total Records</div>
                        <div className="text-xl font-black text-slate-900">{formatRecordCount(totalRecords)}</div>
                    </div>
                </div>

                {errorCount > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl shadow-sm p-4 flex items-center space-x-3">
                        <div className="p-2.5 bg-red-100 rounded-lg text-red-600">
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <div className="text-xs text-red-600 uppercase tracking-wider font-bold">Errors</div>
                            <div className="text-xl font-black text-red-700">{errorCount}</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Search / Filter / Sort Toolbar */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex flex-col md:flex-row items-stretch md:items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 min-w-0">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search connectors by name or type..."
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-accent-cyan focus:ring-2 focus:ring-accent-cyan/20 transition-all font-medium"
                    />
                </div>

                {/* Status Filter Pills */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {STATUS_FILTERS.map(f => (
                        <button
                            key={f.value}
                            onClick={() => setStatusFilter(f.value)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${statusFilter === f.value
                                ? 'bg-primary-50 text-primary-700 border border-primary-300'
                                : 'bg-slate-50 text-slate-600 border border-slate-200 hover:text-slate-800 hover:border-slate-300'
                                }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                {/* Sort */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    <SlidersHorizontal size={14} className="text-slate-400" />
                    <select
                        value={sortKey}
                        onChange={(e) => setSortKey(e.target.value as SortKey)}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-semibold focus:outline-none focus:border-accent-cyan cursor-pointer"
                    >
                        <option value="name">Name A-Z</option>
                        <option value="dqs">DQS High→Low</option>
                        <option value="last_sync">Last Sync</option>
                        <option value="status">Status</option>
                    </select>

                    {/* View Toggle */}
                    <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-primary-50 text-primary-700' : 'bg-slate-50 text-slate-400 hover:text-slate-600'}`}
                            title="Grid view"
                        >
                            <LayoutGrid size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-primary-50 text-primary-700' : 'bg-slate-50 text-slate-400 hover:text-slate-600'}`}
                            title="List view"
                        >
                            <List size={14} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Connectors Grid/List */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-slate-900">
                        Configured Data Feeds
                        {searchQuery && <span className="text-sm text-slate-500 font-normal ml-2">({filteredConnectors.length} result{filteredConnectors.length !== 1 ? 's' : ''})</span>}
                    </h2>
                </div>

                {isLoading ? (
                    <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5' : 'space-y-3'}>
                        {[1, 2, 3].map(i => (
                            <div key={i} className={`bg-white border border-slate-200 rounded-xl animate-pulse shadow-sm ${viewMode === 'grid' ? 'h-56' : 'h-20'}`} />
                        ))}
                    </div>
                ) : error ? (
                    <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700 text-center font-medium">
                        <p>{error}</p>
                    </div>
                ) : filteredConnectors.length === 0 ? (
                    <div className="p-12 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-center bg-white">
                        <div className="p-4 bg-slate-100 rounded-full mb-4">
                            <Database size={32} className="text-slate-400" />
                        </div>
                        {connectors.length === 0 ? (
                            <>
                                <h3 className="text-lg font-bold text-slate-800">No connectors configured</h3>
                                <p className="text-slate-500 mt-2 max-w-md font-medium">Connect your existing CMMS, Historian, or Databases to start ingesting data into ERS.</p>
                                <div className="mt-6 grid grid-cols-3 gap-4 text-xs text-slate-600 max-w-sm font-semibold">
                                    <div className="flex flex-col items-center gap-1">
                                        <div className="w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center text-primary-700 font-bold">1</div>
                                        <span>Choose source</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-1">
                                        <div className="w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center text-primary-700 font-bold">2</div>
                                        <span>Map schema</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-1">
                                        <div className="w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center text-primary-700 font-bold">3</div>
                                        <span>Start syncing</span>
                                    </div>
                                </div>
                                <Link
                                    to="/admin/connectors/new"
                                    className="mt-6 px-4 py-2 bg-accent-blue text-white font-semibold rounded-lg hover:bg-primary-600 transition-colors shadow-sm"
                                >
                                    Configure First Connector
                                </Link>
                            </>
                        ) : (
                            <>
                                <h3 className="text-lg font-bold text-slate-800">No matches found</h3>
                                <p className="text-slate-500 mt-2 font-medium">Try adjusting your search or filter criteria.</p>
                                <button
                                    onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                                    className="mt-4 text-sm text-primary-600 hover:text-primary-700 transition-colors font-semibold"
                                >
                                    Clear all filters
                                </button>
                            </>
                        )}
                    </div>
                ) : (
                    <div className={viewMode === 'grid'
                        ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5'
                        : 'space-y-3'
                    }>
                        {filteredConnectors.map(connector => (
                            <ConnectorCard
                                key={connector.connector_id}
                                health={connector}
                                onSync={triggerSync}
                                compact={viewMode === 'list'}
                            />
                        ))}
                    </div>
                )}
            </div>

            {importOpen && <ImportReadingsModal onClose={() => setImportOpen(false)} />}
        </div>
    );
};
