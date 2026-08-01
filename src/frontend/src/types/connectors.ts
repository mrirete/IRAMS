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
    /** Reading map — dotted JSON paths sensor-sync uses to turn the response
     *  into (asset, tag, value) points. `records_path` locates the array. */
    records_path?: string;
    map_asset?: string;
    map_tag?: string;
    map_value?: string;
    map_unit?: string;
    map_timestamp?: string;
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

/** A historian is REST underneath — PI Web API and Aspen both speak HTTPS/JSON.
 *  It carries the same reading map as RESTConfig; sensor-sync executes both
 *  through the identical `kind: 'rest'` path. */
export interface HistorianConfig extends BaseConnectorConfig {
    type: 'historian';
    server_name: string;
    api_url: string;
    /** appended to api_url — the query that returns the readings array */
    query_path?: string;
    username: string;
    password: string;
    tag_prefix: string;
    records_path?: string;
    map_asset?: string;
    map_tag?: string;
    map_value?: string;
    map_unit?: string;
    map_timestamp?: string;
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
    /** Providers sensor-sync has adapters for. Open-Meteo needs no key. */
    provider: 'openmeteo' | 'openweather' | 'weatherapi';
    api_key?: string;
    latitude: number;
    longitude: number;
    location_name: string;
    /** asset tag or id these environmental readings attach to */
    asset_tag: string;
    data_points: string[]; // e.g. ['temperature', 'humidity', 'wind_speed', 'precipitation']
    units: 'metric' | 'imperial';
}

export type AnyConnectorConfig = RESTConfig | OPCUAConfig | DatabaseConfig | MQTTConfig | CSVConfig | HistorianConfig | DocumentStoreConfig | WeatherAPIConfig;

/** Every measurement the weather form can offer. */
export const ALL_WEATHER_POINTS = [
    'temperature', 'humidity', 'wind_speed', 'precipitation',
    'pressure', 'uv_index', 'visibility', 'dew_point',
] as const;

/**
 * What each provider's current-conditions endpoint actually serves. Mirrors the
 * adapter table in supabase/functions/sensor-sync — keep the two in step, or
 * the form will offer a measurement the worker has to skip.
 */
export const WEATHER_SUPPORT: Record<string, string[]> = {
    openmeteo: ['temperature', 'humidity', 'wind_speed', 'precipitation', 'pressure'],
    openweather: ['temperature', 'humidity', 'wind_speed', 'precipitation', 'pressure', 'visibility'],
    weatherapi: [...ALL_WEATHER_POINTS],
};

/** Providers that require an API key (Open-Meteo is open). */
export const WEATHER_NEEDS_KEY: Record<string, boolean> = {
    openmeteo: false, openweather: true, weatherapi: true,
};

export const DEFAULT_WEATHER_POINTS = ['temperature', 'humidity', 'wind_speed', 'precipitation'];


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
