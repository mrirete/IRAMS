import React from 'react';
import { HelpCircle } from 'lucide-react';
import type { ConnectorType } from '../../types/connectors';
import {
    ALL_WEATHER_POINTS, WEATHER_SUPPORT, WEATHER_NEEDS_KEY, DEFAULT_WEATHER_POINTS,
} from '../../types/connectors';

interface Props {
    type: ConnectorType;
    config: any;
    onChange: (updates: any) => void;
    errors?: Record<string, string>;
}

const Tooltip: React.FC<{ text: string }> = ({ text }) => (
    <span className="group relative inline-flex ml-1">
        <HelpCircle size={13} className="text-brand-600 hover:text-slate-500 cursor-help transition-colors" />
        <span className="invisible group-hover:visible absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2 bg-slate-50 border border-slate-300 rounded-md text-xs text-slate-600 z-50 shadow-xl leading-relaxed">
            {text}
        </span>
    </span>
);

const FieldError: React.FC<{ error?: string }> = ({ error }) => {
    if (!error) return null;
    return <p className="text-xs text-red-400 mt-1">{error}</p>;
};

export const ConfigForm: React.FC<Props> = ({ type, config, onChange, errors = {} }) => {

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type: inputType } = e.target;
        const parsedValue = inputType === 'number' ? Number(value) : value;
        onChange({ ...config, [name]: parsedValue });
    };

    const inputClass = (fieldName: string) =>
        `w-full bg-slate-50 border rounded-md px-3 py-2.5 text-sm text-slate-800 focus:outline-none transition-colors ${errors[fieldName] ? 'border-red-500 focus:border-red-400' : 'border-slate-200 focus:border-relantern-500'}`;

    // Weather form state — Open-Meteo is the default because it needs no key.
    const provider: string = config.provider || 'openmeteo';
    const providerNeedsKey = WEATHER_NEEDS_KEY[provider] ?? true;
    const selectedPoints: string[] = config.data_points ?? DEFAULT_WEATHER_POINTS;

    const renderCommonFields = () => (
        <div className="space-y-4 mb-6">
            <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">General Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        Connector Name <span className="text-red-400 ml-0.5">*</span>
                        <Tooltip text="A human-readable name to identify this connector in the ERS Hub." />
                    </label>
                    <input
                        type="text" name="name" value={config.name || ''} onChange={handleChange}
                        placeholder="e.g. Production API"
                        className={inputClass('name')}
                    />
                    <FieldError error={errors.name} />
                </div>
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        Sync Interval
                        <Tooltip text="How often (in seconds) ERS will poll for new data. Minimum 60s." />
                    </label>
                    <input
                        type="number" name="sync_interval_seconds" value={config.sync_interval_seconds || 3600}
                        onChange={handleChange} min={60}
                        className={inputClass('sync_interval_seconds')}
                    />
                    <FieldError error={errors.sync_interval_seconds} />
                </div>
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        DQS Record Type
                        <Tooltip text="What type of data this connector feeds into. Determines which DQS scoring rules apply." />
                    </label>
                    <select name="dqs_record_type" value={config.dqs_record_type || 'asset'} onChange={handleChange} className={inputClass('dqs_record_type')}>
                        <option value="asset">Asset / Equipment</option>
                        <option value="work_order">Work Order</option>
                        <option value="reading">Condition Reading</option>
                        <option value="inventory">Inventory Part</option>
                        <option value="document">Document / Drawing</option>
                        <option value="environmental">Environmental Data</option>
                    </select>
                </div>
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        Sync Mode
                        <Tooltip text="Full: re-syncs all records every time. Incremental: only syncs changes since last run." />
                    </label>
                    <select name="sync_mode" value={config.sync_mode || 'incremental'} onChange={handleChange} className={inputClass('sync_mode')}>
                        <option value="full">Full Sync</option>
                        <option value="incremental">Incremental</option>
                    </select>
                </div>
            </div>
        </div>
    );

    /**
     * How the sync worker turns a JSON response into (asset, tag, value)
     * points. REST and historian connectors run the same engine, so they share
     * this block rather than each growing their own copy.
     */
    const renderReadingMap = (hint: string) => (
        <>
            <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2 pt-2">Reading Map</h3>
            <p className="text-xs text-slate-500 -mt-2">{hint}</p>
            <div>
                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                    Records Path
                    <Tooltip text="Dotted path to the ARRAY of readings in the response, e.g. 'data.items'. Leave empty if the response body is the array itself." />
                </label>
                <input type="text" name="records_path" value={config.records_path || ''} onChange={handleChange}
                    placeholder="data.readings (optional)"
                    className={inputClass('records_path')} />
            </div>
            <div className="grid grid-cols-3 gap-4">
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        Asset Field <span className="text-red-400 ml-0.5">*</span>
                        <Tooltip text="Field holding the asset tag or id each reading belongs to." />
                    </label>
                    <input type="text" name="map_asset" value={config.map_asset || ''} onChange={handleChange}
                        placeholder="asset" className={inputClass('map_asset')} />
                    <FieldError error={errors.map_asset} />
                </div>
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        Tag Field <span className="text-red-400 ml-0.5">*</span>
                        <Tooltip text="Field naming the measurement, e.g. 'vibration_de' or 'discharge_pressure'." />
                    </label>
                    <input type="text" name="map_tag" value={config.map_tag || ''} onChange={handleChange}
                        placeholder="tag" className={inputClass('map_tag')} />
                    <FieldError error={errors.map_tag} />
                </div>
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        Value Field <span className="text-red-400 ml-0.5">*</span>
                        <Tooltip text="Field holding the numeric reading value." />
                    </label>
                    <input type="text" name="map_value" value={config.map_value || ''} onChange={handleChange}
                        placeholder="value" className={inputClass('map_value')} />
                    <FieldError error={errors.map_value} />
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        Unit Field
                        <Tooltip text="Optional field holding the engineering unit, e.g. 'mm/s'." />
                    </label>
                    <input type="text" name="map_unit" value={config.map_unit || ''} onChange={handleChange}
                        placeholder="unit (optional)" className={inputClass('map_unit')} />
                </div>
                <div>
                    <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                        Timestamp Field
                        <Tooltip text="Optional field holding the reading time — used to order the series." />
                    </label>
                    <input type="text" name="map_timestamp" value={config.map_timestamp || ''} onChange={handleChange}
                        placeholder="timestamp (optional)" className={inputClass('map_timestamp')} />
                </div>
            </div>
        </>
    );

    const renderTypeSpecificFields = () => {
        switch (type) {
            case 'rest_api':
                return (
                    <div className="space-y-4">
                        <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">REST API Configuration</h3>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Base URL <span className="text-red-400 ml-0.5">*</span>
                                <Tooltip text="The root URL of the REST API. Endpoint paths will be appended to this." />
                            </label>
                            <input
                                type="text" name="base_url" value={config.base_url || ''} onChange={handleChange}
                                placeholder="https://api.example.com/v1/"
                                className={inputClass('base_url')}
                            />
                            <FieldError error={errors.base_url} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Auth Type
                                    <Tooltip text="Bearer Token: Use an API key or OAuth token. Basic Auth: Username + password." />
                                </label>
                                <select name="auth_type" value={config.auth_type || 'bearer'} onChange={handleChange} className={inputClass('auth_type')}>
                                    <option value="bearer">Bearer Token</option>
                                    <option value="basic">Basic Auth</option>
                                    <option value="oauth2">OAuth 2.0</option>
                                    <option value="none">None</option>
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Token / Key
                                    <Tooltip text="Your API key or authentication token. This is stored encrypted." />
                                </label>
                                <input type="password" name="auth_token" value={config.auth_token || ''} onChange={handleChange}
                                    placeholder="••••••••••••"
                                    className={inputClass('auth_token')} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Pagination Style
                                    <Tooltip text="How the API handles multi-page results. Cursor-based is most efficient." />
                                </label>
                                <select name="pagination_style" value={config.pagination_style || 'cursor'} onChange={handleChange} className={inputClass('pagination_style')}>
                                    <option value="cursor">Cursor-based</option>
                                    <option value="offset">Offset</option>
                                    <option value="page">Page Number</option>
                                    <option value="none">None</option>
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Rate Limit (RPM)
                                    <Tooltip text="Max requests per minute to avoid throttling from the source API." />
                                </label>
                                <input type="number" name="rate_limit_rpm" value={config.rate_limit_rpm || 120} onChange={handleChange} min={1}
                                    className={inputClass('rate_limit_rpm')} />
                            </div>
                        </div>

                        {renderReadingMap("Tell the sync worker where each reading's fields live in the response JSON (dotted paths). The asset field should hold your asset tag or id.")}
                    </div>
                );
            case 'database':
                return (
                    <div className="space-y-4">
                        <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">Database Configuration</h3>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Connection URL <span className="text-red-400 ml-0.5">*</span>
                                <Tooltip text="Full JDBC/connection string including host, port, and database name." />
                            </label>
                            <input type="text" name="connection_url" value={config.connection_url || ''} onChange={handleChange}
                                placeholder="postgresql://user:pass@host:5432/dbname"
                                className={inputClass('connection_url')} />
                            <FieldError error={errors.connection_url} />
                        </div>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                SQL Query
                                <Tooltip text="The query used to extract data. Use :last_sync parameter for incremental syncs." />
                            </label>
                            <textarea
                                name="query" value={config.query || ''} rows={4}
                                onChange={handleChange as any}
                                placeholder="SELECT * FROM assets WHERE updated_at > :last_sync"
                                className={`${inputClass('query')} font-mono text-xs`} />
                        </div>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Incremental Column
                                <Tooltip text="Column used to detect changes since last sync (e.g. updated_at)." />
                            </label>
                            <input type="text" name="incremental_column" value={config.incremental_column || ''} onChange={handleChange}
                                placeholder="updated_at"
                                className={inputClass('incremental_column')} />
                        </div>
                    </div>
                );
            case 'opc_ua':
                return (
                    <div className="space-y-4">
                        <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">OPC-UA Configuration</h3>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Endpoint URL <span className="text-red-400 ml-0.5">*</span>
                                <Tooltip text="OPC-UA server endpoint, typically of the form opc.tcp://hostname:4840" />
                            </label>
                            <input type="text" name="endpoint_url" value={config.endpoint_url || ''} onChange={handleChange}
                                placeholder="opc.tcp://192.168.1.100:4840"
                                className={inputClass('endpoint_url')} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">Username</label>
                                <input type="text" name="username" value={config.username || ''} onChange={handleChange}
                                    className={inputClass('username')} />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">Password</label>
                                <input type="password" name="password" value={config.password || ''} onChange={handleChange}
                                    className={inputClass('password')} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Namespace Index
                                    <Tooltip text="The OPC-UA namespace index for your node hierarchy." />
                                </label>
                                <input type="number" name="namespace_index" value={config.namespace_index || 2} onChange={handleChange}
                                    className={inputClass('namespace_index')} />
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Root Node ID
                                    <Tooltip text="The starting node from which to browse the OPC-UA address space." />
                                </label>
                                <input type="text" name="root_node_id" value={config.root_node_id || ''} onChange={handleChange}
                                    placeholder="ns=2;s=Root"
                                    className={inputClass('root_node_id')} />
                            </div>
                        </div>
                    </div>
                );
            case 'mqtt':
                return (
                    <div className="space-y-4">
                        <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">MQTT Broker Configuration</h3>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="col-span-2">
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Broker URL <span className="text-red-400 ml-0.5">*</span>
                                </label>
                                <input type="text" name="broker_url" value={config.broker_url || ''} onChange={handleChange}
                                    placeholder="mqtt://broker.example.com"
                                    className={inputClass('broker_url')} />
                                <FieldError error={errors.broker_url} />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">Port</label>
                                <input type="number" name="port" value={config.port || 1883} onChange={handleChange}
                                    className={inputClass('port')} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Topic
                                    <Tooltip text="MQTT topic pattern to subscribe to. Supports wildcards (+, #)." />
                                </label>
                                <input type="text" name="topic" value={config.topic || ''} onChange={handleChange}
                                    placeholder="plant/sensors/#"
                                    className={inputClass('topic')} />
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    QoS Level
                                    <Tooltip text="0 = At most once, 1 = At least once, 2 = Exactly once." />
                                </label>
                                <select name="qos" value={config.qos ?? 1} onChange={handleChange} className={inputClass('qos')}>
                                    <option value={0}>0 — At most once</option>
                                    <option value={1}>1 — At least once</option>
                                    <option value={2}>2 — Exactly once</option>
                                </select>
                            </div>
                        </div>
                    </div>
                );
            case 'historian':
                return (
                    <div className="space-y-4">
                        <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">Historian Configuration</h3>
                        <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs text-sky-800 leading-relaxed">
                            Historians are read over their HTTPS/JSON interface (PI Web API, Aspen REST). ERS calls
                            <strong> API URL + Query Path</strong> and reads the response with the map below. If your historian
                            sits on an isolated plant network, run the ERS Collector inside that network instead.
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Server Name <span className="text-red-400 ml-0.5">*</span>
                                    <Tooltip text="A label for the historian this connector reads — shown in the Hub." />
                                </label>
                                <input type="text" name="server_name" value={config.server_name || ''} onChange={handleChange}
                                    placeholder="PI-PROD-01"
                                    className={inputClass('server_name')} />
                                <FieldError error={errors.server_name} />
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    API URL <span className="text-red-400 ml-0.5">*</span>
                                    <Tooltip text="Base URL of the historian's web API, e.g. the PI Web API root." />
                                </label>
                                <input type="text" name="api_url" value={config.api_url || ''} onChange={handleChange}
                                    placeholder="https://piwebapi.example.com/piwebapi"
                                    className={inputClass('api_url')} />
                                <FieldError error={errors.api_url} />
                            </div>
                        </div>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Query Path
                                <Tooltip text="Appended to the API URL — the endpoint that returns your readings, including any query string." />
                            </label>
                            <input type="text" name="query_path" value={config.query_path || ''} onChange={handleChange}
                                placeholder="streamsets/value?path=\\PI-PROD-01\UNIT-01.*"
                                className={inputClass('query_path')} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Username
                                    <Tooltip text="Sent as HTTP Basic auth. Leave blank if the endpoint is unauthenticated." />
                                </label>
                                <input type="text" name="username" value={config.username || ''} onChange={handleChange}
                                    className={inputClass('username')} />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">Password</label>
                                <input type="password" name="password" value={config.password || ''} onChange={handleChange}
                                    className={inputClass('password')} />
                            </div>
                        </div>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Tag Prefix
                                <Tooltip text="Optional note recording which tag namespace this connector covers." />
                            </label>
                            <input type="text" name="tag_prefix" value={config.tag_prefix || ''} onChange={handleChange}
                                placeholder="UNIT-01."
                                className={inputClass('tag_prefix')} />
                        </div>
                        {renderReadingMap('Point the worker at the readings in your historian\'s response (dotted paths). The asset field should hold the ERS asset tag or id.')}
                    </div>
                );
            case 'csv':
                return (
                    <div className="space-y-4">
                        <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">CSV File Configuration</h3>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Directory Path <span className="text-red-400 ml-0.5">*</span>
                                <Tooltip text="The directory where CSV files are dropped. ERS monitors this for new files." />
                            </label>
                            <input type="text" name="directory_path" value={config.directory_path || ''} onChange={handleChange}
                                placeholder="/data/exports/nightly/"
                                className={inputClass('directory_path')} />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    File Pattern
                                    <Tooltip text="Glob pattern to match files (e.g. *.csv or assets_*.csv)." />
                                </label>
                                <input type="text" name="file_pattern" value={config.file_pattern || '*.csv'} onChange={handleChange}
                                    className={inputClass('file_pattern')} />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-600 mb-1.5 block">Delimiter</label>
                                <select name="delimiter" value={config.delimiter || ','} onChange={handleChange} className={inputClass('delimiter')}>
                                    <option value=",">Comma (,)</option>
                                    <option value=";">Semicolon (;)</option>
                                    <option value="\t">Tab (\t)</option>
                                    <option value="|">Pipe (|)</option>
                                </select>
                            </div>
                            <div className="flex items-end pb-1">
                                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                    <input type="checkbox" name="has_header"
                                        checked={config.has_header !== false}
                                        onChange={(e) => onChange({ ...config, has_header: e.target.checked })}
                                        className="rounded bg-slate-50 border-slate-200 text-accent-cyan focus:ring-primary-500"
                                    />
                                    Has Header Row
                                </label>
                            </div>
                        </div>
                    </div>
                );
            case 'document_store':
                return (
                    <div className="space-y-4">
                        <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">Document Store Configuration</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Storage Provider <span className="text-red-400 ml-0.5">*</span>
                                    <Tooltip text="Where your engineering documents (P&IDs, PFDs, drawings) are stored." />
                                </label>
                                <select name="storage_type" value={config.storage_type || 'sharepoint'} onChange={handleChange} className={inputClass('storage_type')}>
                                    <option value="sharepoint">SharePoint / OneDrive</option>
                                    <option value="s3">AWS S3</option>
                                    <option value="azure_blob">Azure Blob Storage</option>
                                    <option value="google_drive">Google Drive</option>
                                    <option value="local">Local / Network Share</option>
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Endpoint / Site URL <span className="text-red-400 ml-0.5">*</span>
                                    <Tooltip text="SharePoint site URL, S3 endpoint, or Azure storage account URL." />
                                </label>
                                <input type="text" name="endpoint_url" value={config.endpoint_url || ''} onChange={handleChange}
                                    placeholder={config.storage_type === 's3' ? 'https://s3.amazonaws.com' : 'https://contoso.sharepoint.com/sites/engineering'}
                                    className={inputClass('endpoint_url')} />
                                <FieldError error={errors.endpoint_url} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Bucket / Site Library
                                    <Tooltip text="S3 bucket name, SharePoint document library, or Azure container." />
                                </label>
                                <input type="text" name="bucket_or_site" value={config.bucket_or_site || ''} onChange={handleChange}
                                    placeholder="engineering-docs"
                                    className={inputClass('bucket_or_site')} />
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Auth Token / Key
                                    <Tooltip text="API key, SAS token, or OAuth token for authentication." />
                                </label>
                                <input type="password" name="auth_token" value={config.auth_token || ''} onChange={handleChange}
                                    placeholder="••••••••••••"
                                    className={inputClass('auth_token')} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Base Path
                                    <Tooltip text="Root folder/prefix to scan. Leave empty for entire bucket/library." />
                                </label>
                                <input type="text" name="base_path" value={config.base_path || ''} onChange={handleChange}
                                    placeholder="/drawings/plant-a/"
                                    className={inputClass('base_path')} />
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    File Types
                                    <Tooltip text="Comma-separated list of file extensions to ingest (e.g. pdf,dwg,svg,png,docx)." />
                                </label>
                                <input type="text" name="file_types" value={config.file_types || 'pdf,dwg,svg,png'} onChange={handleChange}
                                    placeholder="pdf,dwg,svg,png,docx"
                                    className={inputClass('file_types')} />
                            </div>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                            <h4 className="text-sm font-medium text-slate-700">AI & Processing Options</h4>
                            <div className="grid grid-cols-3 gap-4">
                                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                    <input type="checkbox" name="ai_parsing_enabled"
                                        checked={config.ai_parsing_enabled ?? true}
                                        onChange={(e) => onChange({ ...config, ai_parsing_enabled: e.target.checked })}
                                        className="rounded bg-slate-50 border-slate-200 text-accent-cyan focus:ring-primary-500"
                                    />
                                    AI P&ID Parsing
                                </label>
                                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                    <input type="checkbox" name="metadata_extraction"
                                        checked={config.metadata_extraction ?? true}
                                        onChange={(e) => onChange({ ...config, metadata_extraction: e.target.checked })}
                                        className="rounded bg-slate-50 border-slate-200 text-accent-cyan focus:ring-primary-500"
                                    />
                                    Extract Metadata
                                </label>
                                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                    <input type="checkbox" name="watch_for_changes"
                                        checked={config.watch_for_changes ?? true}
                                        onChange={(e) => onChange({ ...config, watch_for_changes: e.target.checked })}
                                        className="rounded bg-slate-50 border-slate-200 text-accent-cyan focus:ring-primary-500"
                                    />
                                    Watch for Changes
                                </label>
                            </div>
                        </div>
                    </div>
                );
            case 'weather_api':
                return (
                    <div className="space-y-4">
                        <h3 className="text-base font-semibold text-slate-800 border-b border-slate-200 pb-2">Weather & Environment Configuration</h3>
                        <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs text-sky-800 leading-relaxed">
                            Each sync appends one sample per selected measurement to the asset below, tagged
                            <code className="mx-1 px-1 py-0.5 bg-white border border-sky-200 rounded">weather_temperature</code>,
                            <code className="mx-1 px-1 py-0.5 bg-white border border-sky-200 rounded">weather_humidity</code>, and so on —
                            the same feed Predict reads, so environmental history builds up for corrosion and outdoor scheduling.
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Provider <span className="text-red-400 ml-0.5">*</span>
                                    <Tooltip text="Open-Meteo needs no API key — the quickest way to prove the connector works. For any provider not listed, use the REST API connector." />
                                </label>
                                <select
                                    name="provider"
                                    value={provider}
                                    onChange={(e) => {
                                        // Keep only the measurements the new provider can actually serve.
                                        const next = e.target.value;
                                        const allowed = WEATHER_SUPPORT[next] || [];
                                        onChange({
                                            ...config,
                                            provider: next,
                                            data_points: selectedPoints.filter((p: string) => allowed.includes(p)),
                                        });
                                    }}
                                    className={inputClass('provider')}
                                >
                                    <option value="openmeteo">Open-Meteo (no API key)</option>
                                    <option value="openweather">OpenWeatherMap</option>
                                    <option value="weatherapi">WeatherAPI.com</option>
                                </select>
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    API Key {providerNeedsKey && <span className="text-red-400 ml-0.5">*</span>}
                                    <Tooltip text="API key from your weather provider. Open-Meteo does not use one." />
                                </label>
                                <input type="password" name="api_key" value={config.api_key || ''} onChange={handleChange}
                                    disabled={!providerNeedsKey}
                                    placeholder={providerNeedsKey ? '••••••••••••' : 'Not required for Open-Meteo'}
                                    className={`${inputClass('api_key')} disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed`} />
                                <FieldError error={errors.api_key} />
                            </div>
                        </div>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Attach Readings To Asset <span className="text-red-400 ml-0.5">*</span>
                                <Tooltip text="The ERS asset tag (or id) these environmental readings belong to — usually the site's weather station or the exposed asset you're tracking." />
                            </label>
                            <input type="text" name="asset_tag" value={config.asset_tag || ''} onChange={handleChange}
                                placeholder="e.g. WS-001 or the tag of the exposed asset"
                                className={inputClass('asset_tag')} />
                            <FieldError error={errors.asset_tag} />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Location Name
                                    <Tooltip text="Human-readable name for the monitoring station/site." />
                                </label>
                                <input type="text" name="location_name" value={config.location_name || ''} onChange={handleChange}
                                    placeholder="Bonny Island Terminal"
                                    className={inputClass('location_name')} />
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Latitude <span className="text-red-400 ml-0.5">*</span>
                                    <Tooltip text="GPS latitude of the monitoring location." />
                                </label>
                                <input type="number" step="0.0001" name="latitude" value={config.latitude ?? ''} onChange={handleChange}
                                    placeholder="4.4397"
                                    className={inputClass('latitude')} />
                                <FieldError error={errors.latitude} />
                            </div>
                            <div>
                                <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                    Longitude <span className="text-red-400 ml-0.5">*</span>
                                    <Tooltip text="GPS longitude of the monitoring location." />
                                </label>
                                <input type="number" step="0.0001" name="longitude" value={config.longitude ?? ''} onChange={handleChange}
                                    placeholder="7.1534"
                                    className={inputClass('longitude')} />
                                <FieldError error={errors.longitude} />
                            </div>
                        </div>
                        <div>
                            <label className="flex items-center text-sm font-medium text-slate-600 mb-1.5">
                                Units
                            </label>
                            <select name="units" value={config.units || 'metric'} onChange={handleChange} className={`${inputClass('units')} md:w-1/2`}>
                                <option value="metric">Metric (°C, km/h, mm)</option>
                                <option value="imperial">Imperial (°F, mph, in)</option>
                            </select>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                            <h4 className="text-sm font-medium text-slate-700 mb-1">Data Points to Collect</h4>
                            <p className="text-xs text-slate-500 mb-3">
                                Greyed-out measurements aren't served by this provider's current-conditions endpoint.
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {ALL_WEATHER_POINTS.map(point => {
                                    const supported = (WEATHER_SUPPORT[provider] || []).includes(point);
                                    return (
                                        <label
                                            key={point}
                                            title={supported ? undefined : `${provider} does not serve ${point.replace(/_/g, ' ')}`}
                                            className={`flex items-center gap-2 text-sm ${supported ? 'text-slate-600 cursor-pointer' : 'text-slate-400 cursor-not-allowed'}`}
                                        >
                                            <input type="checkbox"
                                                disabled={!supported}
                                                checked={supported && selectedPoints.includes(point)}
                                                onChange={(e) => {
                                                    const updated = e.target.checked
                                                        ? [...selectedPoints, point]
                                                        : selectedPoints.filter((p: string) => p !== point);
                                                    onChange({ ...config, data_points: updated });
                                                }}
                                                className="rounded bg-slate-50 border-slate-200 text-accent-cyan focus:ring-primary-500 disabled:opacity-40"
                                            />
                                            {point.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                        </label>
                                    );
                                })}
                            </div>
                            <FieldError error={errors.data_points} />
                        </div>
                    </div>
                );
            default:
                return <div className="p-4 bg-white border border-slate-200 rounded-md text-slate-500 text-center">Form fields for {type} coming soon.</div>;
        }
    };

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            {renderCommonFields()}
            {renderTypeSpecificFields()}
        </div>
    );
};
