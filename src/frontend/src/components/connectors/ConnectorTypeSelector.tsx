import React from 'react';
import type { ConnectorType } from '../../types/connectors';
import { Server, Database, FileText, Radio, Activity, Globe, CheckCircle2, Clock, Star, FolderOpen, CloudSun, Cloud, HardDrive, ArrowRight } from 'lucide-react';

interface Props {
    selectedType: ConnectorType | null;
    onSelect: (type: ConnectorType) => void;
}

/**
 * Connectors are grouped by *where they run*, not by whether they're finished.
 *
 *   route 'cloud'     — the sensor-sync worker pulls the source over HTTPS.
 *                       `live` says whether that adapter exists yet.
 *   route 'collector' — the protocol is local to the plant (binary TCP, a
 *                       persistent subscription, or a file share), so it can
 *                       only be read from inside the network. The ERS Collector
 *                       speaks it there and pushes to ingest-readings.
 */
type Route = 'cloud' | 'collector';

interface TypeCard {
    id: ConnectorType;
    name: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    description: string;
    popular: string[];
    setupTime: string;
    route: Route;
    live: boolean;
}

const CONNECTOR_TYPES: TypeCard[] = [
    {
        id: 'rest_api',
        name: 'REST API',
        icon: Globe,
        description: 'Poll any JSON endpoint for readings. The universal route — most systems fit here.',
        popular: ['Gateways', 'Custom APIs', 'Cloud SCADA'],
        setupTime: '~5 min',
        route: 'cloud',
        live: true,
    },
    {
        id: 'historian',
        name: 'Historian',
        icon: Activity,
        description: 'Read PI Web API, Aspen, or any historian that exposes an HTTPS/JSON interface.',
        popular: ['OSIsoft PI', 'Aspen InfoPlus.21'],
        setupTime: '~8 min',
        route: 'cloud',
        live: true,
    },
    {
        id: 'weather_api',
        name: 'Weather & Environment',
        icon: CloudSun,
        description: 'Environmental data for corrosion prediction and outdoor scheduling. Open-Meteo needs no API key.',
        popular: ['Open-Meteo', 'OpenWeather', 'WeatherAPI'],
        setupTime: '~3 min',
        route: 'cloud',
        live: true,
    },
    {
        id: 'document_store',
        name: 'Document Store',
        icon: FolderOpen,
        description: 'Ingest P&IDs, PFDs, engineering drawings, and technical documents.',
        popular: ['SharePoint', 'AWS S3', 'Google Drive'],
        setupTime: '~7 min',
        route: 'cloud',
        live: false,
    },
    {
        id: 'opc_ua',
        name: 'OPC-UA',
        icon: Server,
        description: 'Industrial automation and SCADA. Binary protocol — read on-site, never exposed to the internet.',
        popular: ['Kepware', 'Ignition'],
        setupTime: '~10 min',
        route: 'collector',
        live: false,
    },
    {
        id: 'mqtt',
        name: 'MQTT Broker',
        icon: Radio,
        description: 'Live sensor and IoT telemetry. Needs a persistent subscription held inside your network.',
        popular: ['AWS IoT', 'Mosquitto', 'HiveMQ'],
        setupTime: '~5 min',
        route: 'collector',
        live: false,
    },
    {
        id: 'database',
        name: 'Database (SQL/NoSQL)',
        icon: Database,
        description: 'Query a CMMS or process database directly — reached from inside your network.',
        popular: ['SQL Server', 'Oracle', 'PostgreSQL'],
        setupTime: '~3 min',
        route: 'collector',
        live: false,
    },
    {
        id: 'csv',
        name: 'CSV File Drop',
        icon: FileText,
        description: 'Watch a shared directory for nightly extracts. For one-off files, use Import Readings on the Hub.',
        popular: ['Nightly Extracts', 'Legacy Systems'],
        setupTime: '~2 min',
        route: 'collector',
        live: false,
    },
];

const GROUPS: { route: Route; title: string; blurb: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
    {
        route: 'cloud',
        title: 'Cloud connectors',
        blurb: 'ERS reaches these over HTTPS. Nothing to install.',
        icon: Cloud,
    },
    {
        route: 'collector',
        title: 'Requires the ERS Collector',
        blurb: 'These protocols only exist inside your plant network. The Collector runs on-site, speaks them locally, and pushes readings out over outbound HTTPS — no inbound firewall rule needed.',
        icon: HardDrive,
    },
];

export const ConnectorTypeSelector: React.FC<Props> = ({ selectedType, onSelect }) => {
    const renderCard = (type: TypeCard) => {
        const Icon = type.icon;
        const isSelected = selectedType === type.id;
        const selectable = type.route === 'cloud' && type.live;
        const badge = selectable
            ? { label: 'Live', icon: Star, cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600', iconCls: 'text-emerald-500 fill-emerald-500' }
            : type.route === 'collector'
                ? { label: 'Needs Collector', icon: HardDrive, cls: 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600', iconCls: 'text-indigo-500' }
                : { label: 'Coming soon', icon: Clock, cls: 'bg-slate-200/70 border-slate-300 text-slate-500', iconCls: 'text-slate-500' };
        const BadgeIcon = badge.icon;

        return (
            <button
                key={type.id}
                onClick={() => selectable && onSelect(type.id)}
                disabled={!selectable}
                title={selectable ? undefined
                    : type.route === 'collector'
                        ? 'Available through the ERS Collector — a small agent that runs inside your network'
                        : 'Coming soon'}
                className={`text-left p-5 rounded-xl border-2 transition-all duration-200 relative overflow-hidden group ${isSelected
                    ? 'bg-white border-amber-500 ring-2 ring-amber-500/30 shadow-lg shadow-amber-500/10'
                    : selectable
                        ? 'bg-white border-slate-300 hover:border-amber-400 hover:shadow-md'
                        : 'bg-slate-50 border-slate-200 opacity-70 cursor-not-allowed'
                    }`}
            >
                {isSelected && (
                    <div className="absolute top-4 right-4 text-amber-500 animate-in zoom-in duration-200">
                        <CheckCircle2 size={22} className="fill-white" />
                    </div>
                )}

                {!isSelected && (
                    <div className={`absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 border rounded-full ${badge.cls}`}>
                        <BadgeIcon size={10} className={badge.iconCls} />
                        <span className="text-[9px] font-bold uppercase tracking-wider">{badge.label}</span>
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
    };

    return (
        <div className="space-y-8">
            {GROUPS.map(group => {
                const GroupIcon = group.icon;
                const types = CONNECTOR_TYPES.filter(t => t.route === group.route);
                return (
                    <div key={group.route} className="space-y-3">
                        <div className="flex items-start gap-2.5">
                            <GroupIcon size={16} className="text-slate-400 mt-0.5 shrink-0" />
                            <div>
                                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">{group.title}</h3>
                                <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-relaxed">{group.blurb}</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {types.map(renderCard)}
                        </div>
                    </div>
                );
            })}

            {/* The REST connector is the universal escape hatch — point people
                there instead of leaving them at a dead end. */}
            <div className="border-t border-slate-200 pt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
                <span>Can't find your system?</span>
                <button
                    onClick={() => onSelect('rest_api')}
                    className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-amber-600 underline underline-offset-2 transition-colors"
                >
                    Most systems can be read through the REST API connector
                    <ArrowRight size={12} />
                </button>
            </div>
        </div>
    );
};
