import React from 'react';
import type { ConnectorType } from '../../types/connectors';
import { Server, Database, FileText, Radio, Activity, Globe, CheckCircle2, Clock, Star, FolderOpen, CloudSun } from 'lucide-react';

interface Props {
    selectedType: ConnectorType | null;
    onSelect: (type: ConnectorType) => void;
}

// `live: false` types render as honest Coming-soon cards — the sensor-sync
// worker only executes REST polling today (CSV import is live on the Hub).
const CONNECTOR_TYPES = [
    {
        id: 'rest_api' as ConnectorType,
        name: 'REST API',
        icon: Globe,
        description: 'Poll any JSON endpoint for readings — the live connector type.',
        popular: ['Gateways', 'Historian REST', 'Custom APIs'],
        setupTime: '~5 min',
        recommended: true,
        live: true,
    },
    {
        id: 'database' as ConnectorType,
        name: 'Database (SQL/NoSQL)',
        icon: Database,
        description: 'Direct query to relational or document databases.',
        popular: ['PostgreSQL', 'SQL Server', 'Oracle'],
        setupTime: '~3 min',
        recommended: false,
        live: false,
    },
    {
        id: 'opc_ua' as ConnectorType,
        name: 'OPC-UA',
        icon: Server,
        description: 'Industrial automation and SCADA integration.',
        popular: ['Kepware', 'Ignition'],
        setupTime: '~10 min',
        recommended: true,
        live: false,
    },
    {
        id: 'mqtt' as ConnectorType,
        name: 'MQTT Broker',
        icon: Radio,
        description: 'Subscribes to live sensor and IoT telemetry.',
        popular: ['AWS IoT', 'Mosquitto', 'HiveMQ'],
        setupTime: '~5 min',
        recommended: false,
        live: false,
    },
    {
        id: 'historian' as ConnectorType,
        name: 'Historian',
        icon: Activity,
        description: 'Time-series process data integration.',
        popular: ['OSIsoft PI', 'Aspen InfoPlus.21'],
        setupTime: '~8 min',
        recommended: true,
        live: false,
    },
    {
        id: 'csv' as ConnectorType,
        name: 'CSV File Dump',
        icon: FileText,
        description: 'Batch file ingestion from shared directories.',
        popular: ['Nightly Extracts', 'Legacy Systems'],
        setupTime: '~2 min',
        recommended: false,
        live: false,
    },
    {
        id: 'document_store' as ConnectorType,
        name: 'Document Store',
        icon: FolderOpen,
        description: 'Ingest P&IDs, PFDs, engineering drawings, and technical documents.',
        popular: ['SharePoint', 'AWS S3', 'Google Drive'],
        setupTime: '~7 min',
        recommended: true,
        live: false,
    },
    {
        id: 'weather_api' as ConnectorType,
        name: 'Weather & Environment',
        icon: CloudSun,
        description: 'Environmental data for corrosion prediction and outdoor scheduling.',
        popular: ['OpenWeather', 'NOAA', 'WeatherAPI'],
        setupTime: '~3 min',
        recommended: false,
    }
];

export const ConnectorTypeSelector: React.FC<Props> = ({ selectedType, onSelect }) => {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {CONNECTOR_TYPES.map(type => {
                    const Icon = type.icon;
                    const isSelected = selectedType === type.id;
                    const isLive = !!(type as any).live;

                    return (
                        <button
                            key={type.id}
                            onClick={() => isLive && onSelect(type.id)}
                            disabled={!isLive}
                            title={isLive ? undefined : 'Coming soon — REST API polling and CSV import are the live routes today'}
                            className={`text-left p-5 rounded-xl border-2 transition-all duration-200 relative overflow-hidden group ${isSelected
                                ? 'bg-white border-amber-500 ring-2 ring-amber-500/30 shadow-lg shadow-amber-500/10'
                                : isLive
                                    ? 'bg-white border-slate-300 hover:border-amber-400 hover:shadow-md'
                                    : 'bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed'
                                }`}
                        >
                            {/* Selected Check */}
                            {isSelected && (
                                <div className="absolute top-4 right-4 text-amber-500 animate-in zoom-in duration-200">
                                    <CheckCircle2 size={22} className="fill-white" />
                                </div>
                            )}

                            {/* Coming-soon / Recommended Badge */}
                            {!isLive ? (
                                <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 bg-slate-200/70 border border-slate-300 rounded-full">
                                    <Clock size={10} className="text-slate-500" />
                                    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Coming soon</span>
                                </div>
                            ) : type.recommended && !isSelected && (
                                <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                                    <Star size={10} className="text-emerald-500 fill-emerald-500" />
                                    <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Live</span>
                                </div>
                            )}

                            <div className="flex items-start space-x-4">
                                <div className={`p-3 rounded-lg border ${isSelected ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-slate-50 border-slate-200 text-slate-500 group-hover:text-slate-700'}`}>
                                    <Icon size={24} />
                                </div>
                                <div className="flex-1 pr-6">
                                    <h3 className={`font-semibold text-lg ${isSelected ? 'text-slate-800' : 'text-slate-700'}`}>
                                        {type.name}
                                    </h3>
                                    <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                                        {type.description}
                                    </p>
                                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                                        {type.popular.map(p => (
                                            <span key={p} className={`text-xs px-2 py-0.5 rounded-md border ${isSelected ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                                                {p}
                                            </span>
                                        ))}
                                        <span className={`flex items-center gap-1 text-[10px] ml-auto ${isSelected ? 'text-slate-500' : 'text-slate-400'}`}>
                                            <Clock size={10} />
                                            {type.setupTime}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Can't find your system? */}
            <div className="text-center pt-2">
                <button className="text-xs text-slate-400 hover:text-slate-600 transition-colors underline underline-offset-2">
                    Can't find your system? Request a new connector type →
                </button>
            </div>
        </div>
    );
};
