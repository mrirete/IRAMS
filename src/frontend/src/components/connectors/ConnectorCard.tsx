import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, RefreshCw, Server, Database, FileText, Radio, Activity, Globe, ExternalLink, FolderOpen, CloudSun } from 'lucide-react';
import type { ConnectorHealth, ConnectorType } from '../../types/connectors';

interface ConnectorCardProps {
    health: ConnectorHealth;
    onSync: (id: string, mode: 'full' | 'incremental' | 'dry_run') => void;
    compact?: boolean;
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'running': return { bg: 'bg-accent-safe', text: 'text-accent-safe', label: 'Running' };
        case 'stopped': return { bg: 'bg-brand-500', text: 'text-slate-400', label: 'Stopped' };
        case 'starting': return { bg: 'bg-accent-blue', text: 'text-accent-blue', label: 'Syncing' };
        case 'error': return { bg: 'bg-accent-alert', text: 'text-accent-alert', label: 'Error' };
        default: return { bg: 'bg-brand-500', text: 'text-slate-400', label: 'Unknown' };
    }
};

const getTypeIcon = (type: ConnectorType) => {
    switch (type) {
        case 'rest_api': return <Globe size={18} className="text-accent-blue" />;
        case 'database': return <Database size={18} className="text-accent-cyan" />;
        case 'csv': return <FileText size={18} className="text-slate-600" />;
        case 'mqtt': return <Radio size={18} className="text-accent-warn" />;
        case 'opc_ua': return <Server size={18} className="text-purple-400" />;
        case 'historian': return <Activity size={18} className="text-pink-400" />;
        case 'document_store': return <FolderOpen size={18} className="text-emerald-400" />;
        case 'weather_api': return <CloudSun size={18} className="text-sky-400" />;
        default: return <Server size={18} className="text-slate-400" />;
    }
};

const getTypeName = (type: ConnectorType) => {
    const names: Record<ConnectorType, string> = {
        rest_api: 'REST API',
        database: 'Database',
        csv: 'CSV',
        mqtt: 'MQTT',
        opc_ua: 'OPC-UA',
        historian: 'Historian',
        document_store: 'Document Store',
        weather_api: 'Weather API',
    };
    return names[type] || type;
};

const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Never';
    return new Date(isoString).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
};

const formatRecordCount = (n?: number) => {
    if (!n) return '—';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
};

// SVG DQS Arc Component
const DQSArc: React.FC<{ score: number; size?: number }> = ({ score, size = 48 }) => {
    const radius = (size - 6) / 2;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(score / 100, 1);
    const strokeDashoffset = circumference * (1 - progress);

    let strokeColor = '#10b981'; // green
    if (score < 60) strokeColor = '#ef4444'; // red
    else if (score < 80) strokeColor = '#f59e0b'; // amber

    return (
        <svg width={size} height={size} className="transform -rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={3} className="text-slate-200" />
            <circle
                cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={strokeColor} strokeWidth={3}
                strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                strokeLinecap="round" className="transition-all duration-1000 ease-out"
            />
        </svg>
    );
};

export const ConnectorCard: React.FC<ConnectorCardProps> = ({ health, onSync, compact = false }) => {
    const dqsScore = health.dqs_score ?? 0;
    const status = getStatusColor(health.status);

    // Compact / List Mode
    if (compact) {
        return (
            <Link
                to={`/admin/connectors/${health.connector_id}`}
                className="bg-white border border-slate-200 rounded-lg p-4 flex items-center gap-4 hover:border-cyan-400 hover:bg-slate-50 transition-all group"
            >
                <div className="p-2 bg-slate-50 rounded-md border border-slate-200">
                    {getTypeIcon(health.type)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="font-medium text-slate-800 truncate">{health.name}</h3>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${status.bg}/15 ${status.text}`}>
                            {status.label}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                        <span>{getTypeName(health.type)}</span>
                        <span>•</span>
                        <span>Synced {formatDate(health.last_sync)}</span>
                    </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                        <div className="text-xs text-slate-400">DQS</div>
                        <div className={`text-sm font-bold ${dqsScore >= 80 ? 'text-accent-safe' : dqsScore >= 60 ? 'text-yellow-500' : 'text-accent-alert'}`}>
                            {dqsScore > 0 ? dqsScore.toFixed(0) : '—'}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-xs text-slate-400">Records</div>
                        <div className="text-sm font-medium text-slate-600">{formatRecordCount(health.records_synced)}</div>
                    </div>
                    <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSync(health.connector_id, 'incremental'); }}
                        disabled={health.status === 'starting'}
                        className="p-2 text-slate-500 hover:text-accent-cyan hover:bg-slate-100 rounded-md transition-colors disabled:opacity-50"
                        title="Quick Sync"
                    >
                        <RefreshCw size={16} className={health.status === 'starting' ? 'animate-spin' : ''} />
                    </button>
                    <ExternalLink size={14} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                </div>
            </Link>
        );
    }

    // Full Grid Card
    return (
        <Link
            to={`/admin/connectors/${health.connector_id}`}
            className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col h-full hover:border-cyan-400 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden group cursor-pointer"
        >
            {/* Ambient glow */}
            <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-5 pointer-events-none ${status.bg}`} />

            {/* Header: Icon + Name + Status */}
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex-shrink-0">
                        {getTypeIcon(health.type)}
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-medium text-slate-800 truncate pr-2 group-hover:text-slate-900 transition-colors" title={health.name}>
                            {health.name}
                        </h3>
                        <div className="flex items-center space-x-2 text-xs text-slate-500 mt-0.5">
                            <span>{getTypeName(health.type)}</span>
                            <span>•</span>
                            <div className="flex items-center space-x-1.5">
                                <div className={`w-1.5 h-1.5 rounded-full ${status.bg} ${health.status === 'starting' ? 'animate-pulse' : ''}`} />
                                <span className={status.text}>{status.label}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* DQS Arc */}
                <div className="relative flex-shrink-0">
                    <DQSArc score={dqsScore} size={44} />
                    <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold transform rotate-0 ${dqsScore >= 80 ? 'text-accent-safe' : dqsScore >= 60 ? 'text-yellow-500' : 'text-accent-alert'}`}>
                        {dqsScore > 0 ? Math.round(dqsScore) : '—'}
                    </span>
                </div>
            </div>

            {/* Metrics Row */}
            <div className="grid grid-cols-3 gap-3 my-3 flex-1">
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-0.5">Last Sync</div>
                    <div className="text-xs font-semibold text-slate-700">{formatDate(health.last_sync)}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-0.5">Next Sync</div>
                    <div className="text-xs font-semibold text-slate-700">{formatDate(health.next_sync)}</div>
                </div>
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-0.5">Records</div>
                    <div className="text-xs font-bold text-slate-800">{formatRecordCount(health.records_synced)}</div>
                </div>
            </div>

            {/* Footer: Quick Actions */}
            <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-200">
                <span className="text-xs text-slate-400 group-hover:text-slate-600 transition-colors">Click to view details</span>
                <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSync(health.connector_id, 'incremental'); }}
                    disabled={health.status === 'starting'}
                    className="p-2 text-slate-500 hover:text-accent-cyan hover:bg-slate-100 rounded-md transition-colors disabled:opacity-50"
                    title="Trigger Quick Sync"
                >
                    <RefreshCw size={15} className={health.status === 'starting' ? 'animate-spin' : ''} />
                </button>
            </div>

            {/* Error Banner */}
            {health.status === 'error' && health.error_message && (
                <div className="mt-3 text-xs text-accent-alert bg-accent-alert/10 border border-accent-alert/20 p-2 rounded-md flex items-start space-x-2">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span className="line-clamp-2">{health.error_message}</span>
                </div>
            )}
        </Link>
    );
};
