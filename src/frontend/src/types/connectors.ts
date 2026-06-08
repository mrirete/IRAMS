export type ConnectorType = 'rest_api' | 'opc_ua' | 'database' | 'mqtt' | 'csv' | 'historian' | 'document_store' | 'weather_api';

export type ConnectorStatus = 'stopped' | 'starting' | 'running' | 'error';

export type SyncMode = 'full' | 'incremental' | 'dry_run';

export interface BaseConnectorConfig {
    id: string; // UUID
    name: string;
    type: ConnectorType;
    is_active: boolean;
    sync_interval_seconds: number;
    retry_max_attempts: number;
    retry_backoff_base_seconds: number;
    dqs_record_type: string;
    dqs_asset_class: string;
}

export interface RESTConfig extends BaseConnectorConfig {
    type: 'rest_api';
    base_url: string;
    auth_type: string;
    auth_token?: string;
    auth_user?: string;
    auth_pass?: string;
    pagination_style: string;
    rate_limit_rpm: number;
}

export interface OPCUAConfig extends BaseConnectorConfig {
    type: 'opc_ua';
    endpoint_url: string;
    username?: string;
    password?: string;
    namespace_index: number;
    root_node_id: string;
}

export interface DatabaseConfig extends BaseConnectorConfig {
    type: 'database';
    connection_url: string;
    query: string;
    incremental_column?: string;
}

export interface MQTTConfig extends BaseConnectorConfig {
    type: 'mqtt';
    broker_url: string;
    port: number;
    topic: string;
    qos: number;
    client_id?: string;
    username?: string;
    password?: string;
}

export interface CSVConfig extends BaseConnectorConfig {
    type: 'csv';
    directory_path: string;
    file_pattern: string;
    delimiter: string;
    has_header: boolean;
}

export interface HistorianConfig extends BaseConnectorConfig {
    type: 'historian';
    server_name: string;
    api_url: string;
    username: string;
    password: string;
    tag_prefix: string;
}

export interface DocumentStoreConfig extends BaseConnectorConfig {
    type: 'document_store';
    storage_type: 'sharepoint' | 's3' | 'azure_blob' | 'local' | 'google_drive';
    endpoint_url: string;
    auth_token?: string;
    bucket_or_site?: string;
    base_path: string;
    file_types: string; // comma-separated, e.g. "pdf,dwg,svg,png"
    ai_parsing_enabled: boolean;
    metadata_extraction: boolean;
    watch_for_changes: boolean;
}

export interface WeatherAPIConfig extends BaseConnectorConfig {
    type: 'weather_api';
    provider: 'openweather' | 'noaa' | 'weatherapi' | 'custom';
    api_key: string;
    api_url?: string; // for custom provider
    latitude: number;
    longitude: number;
    location_name: string;
    data_points: string[]; // e.g. ['temperature', 'humidity', 'wind_speed', 'precipitation']
    forecast_days: number;
    units: 'metric' | 'imperial';
}

export type AnyConnectorConfig = RESTConfig | OPCUAConfig | DatabaseConfig | MQTTConfig | CSVConfig | HistorianConfig | DocumentStoreConfig | WeatherAPIConfig;


export interface ConnectorHealth {
    connector_id: string;
    name: string;
    type: ConnectorType;
    status: ConnectorStatus;
    last_sync: string | null; // ISO string
    next_sync: string | null;
    error_message: string | null;
    records_synced?: number; // total records synced lifetime
    dqs_score?: number;
    overall_status?: 'healthy' | 'degraded' | 'error';
}

export interface DimensionScore {
    dimension: 'completeness' | 'accuracy' | 'timeliness' | 'consistency';
    score: number;
    weight: number;
    weighted_score: number;
    details: any;
}

export interface DQSResult {
    asset_id: string;
    record_type: string;
    composite_score: number;
    dimensions: DimensionScore[];
    ai_confidence_modifier: number;
    scored_at: string; // ISO string
    source_id: string | null;
}

export interface ConnectorSyncLog {
    id: string;
    connector_id: string;
    mode: SyncMode;
    start_time: string;
    end_time: string | null;
    status: 'completed' | 'failed' | 'running';
    records_processed: number;
    records_added: number;
    records_updated: number;
    records_failed: number;
    error_message: string | null;
    average_dqs_score: number | null;
}
