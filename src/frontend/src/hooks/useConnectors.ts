import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../eam/lib/supabase';
import type { ConnectorHealth, ConnectorSyncLog, AnyConnectorConfig, SyncMode, ConnectorStatus } from '../types/connectors';

/**
 * Connector Hub data layer — DB-backed (0202) after a long life as mock.
 *
 * Rows live in `connectors`; the sensor-sync edge function reads active
 * REST connectors from the same table, pulls each source, and upserts
 * ers_sensor_readings (the feed Predict and the twin read). `config` holds
 * the sensor-sync shape (url/method/headers/root/map) plus `source` — the
 * raw wizard fields — so the wizard can round-trip edits.
 *
 * No DQS scores are fabricated: dqs_score stays undefined until a real
 * quality engine exists.
 */

interface ConnectorRow {
    id: string;
    name: string;
    type: string;
    is_active: boolean;
    config: any;
    sync_interval_seconds: number;
    last_sync: string | null;
    last_status: string | null;
    last_error: string | null;
    records_synced: number;
    created_at: string;
}

function rowToHealth(row: ConnectorRow): ConnectorHealth {
    const status: ConnectorStatus = !row.is_active ? 'stopped'
        : row.last_status === 'error' ? 'error'
            : 'running';
    const nextSync = row.is_active && row.last_sync
        ? new Date(new Date(row.last_sync).getTime() + (row.sync_interval_seconds || 3600) * 1000).toISOString()
        : null;
    return {
        connector_id: row.id,
        name: row.name,
        type: row.type as ConnectorHealth['type'],
        status,
        last_sync: row.last_sync,
        next_sync: nextSync,
        error_message: row.last_error,
        records_synced: Number(row.records_synced) || 0,
        dqs_score: undefined,
        overall_status: status === 'error' ? 'error' : row.last_status === 'ok' ? 'healthy' : undefined,
    };
}

/** Wizard config → the `config` jsonb sensor-sync executes. */
function buildSyncConfig(config: Partial<AnyConnectorConfig>): any {
    const c = config as any;
    if (config.type === 'rest_api') {
        const headers: Record<string, string> = {};
        if (c.auth_type === 'bearer' && c.auth_token) headers['Authorization'] = `Bearer ${c.auth_token}`;
        if (c.auth_type === 'basic' && c.auth_user) headers['Authorization'] = `Basic ${btoa(`${c.auth_user}:${c.auth_pass || ''}`)}`;
        return {
            url: c.base_url,
            method: 'GET',
            headers,
            root: c.records_path || undefined,
            map: {
                asset: c.map_asset || 'asset',
                tag: c.map_tag || 'tag',
                value: c.map_value || 'value',
                unit: c.map_unit || undefined,
                timestamp: c.map_timestamp || undefined,
            },
            source: config, // wizard fields, for round-trip editing
        };
    }
    // Non-REST types are not executable yet — store the wizard fields only.
    return { source: config };
}

export interface ConnectorTestResult {
    ok: boolean;
    records: number;
    error: string | null;
    connectorId: string;
}

export function useConnectors() {
    const [connectors, setConnectors] = useState<ConnectorHealth[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const { data, error: err } = await supabase
                .from('connectors').select('*').order('created_at', { ascending: false });
            if (err) throw err;
            setConnectors((data || []).map(rowToHealth));
            setError(null);
        } catch (e: any) {
            // Pre-0202 database: show an empty hub, not a crash.
            const msg = String(e?.message || e);
            if (msg.includes('does not exist') || msg.includes('relation')) {
                setConnectors([]);
                setError(null);
                console.warn('[useConnectors] connectors table missing — apply migration 0202.');
            } else {
                setError(msg);
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    /** Insert or update a connector row; returns its id. */
    const saveConnector = useCallback(async (
        config: Partial<AnyConnectorConfig>,
        opts?: { id?: string; active?: boolean },
    ): Promise<string> => {
        const row = {
            name: config.name || 'Unnamed connector',
            type: config.type,
            is_active: opts?.active ?? false,
            config: buildSyncConfig(config),
            sync_interval_seconds: config.sync_interval_seconds || 3600,
            updated_at: new Date().toISOString(),
        };
        if (opts?.id) {
            const { error: err } = await supabase.from('connectors').update(row).eq('id', opts.id);
            if (err) throw err;
            await refresh();
            return opts.id;
        }
        const { data, error: err } = await supabase.from('connectors').insert(row).select('id').single();
        if (err) throw err;
        await refresh();
        return data.id;
    }, [refresh]);

    /**
     * Real connection test: save (or reuse) a draft row, then run sensor-sync
     * against just that connector. The result is the actual pull — records
     * upserted into ers_sensor_readings, or the real error message.
     */
    const testConnector = useCallback(async (
        config: Partial<AnyConnectorConfig>,
        draftId?: string,
    ): Promise<ConnectorTestResult> => {
        const id = await saveConnector(config, { id: draftId, active: false });
        try {
            const { data, error: err } = await supabase.functions.invoke('sensor-sync', {
                body: { connectorId: id },
            });
            if (err) throw err;
            const result = data?.results?.[0];
            if (!result) return { ok: false, records: 0, error: 'sensor-sync ran but returned no result — is the connector saved?', connectorId: id };
            return { ok: !!result.ok, records: Number(result.records) || 0, error: result.error || null, connectorId: id };
        } catch (e: any) {
            return { ok: false, records: 0, error: String(e?.message || e) + ' (is the sensor-sync edge function deployed?)', connectorId: id };
        } finally {
            refresh();
        }
    }, [saveConnector, refresh]);

    /** Wizard finish: persist and activate. */
    const registerConnector = useCallback(async (config: AnyConnectorConfig, draftId?: string) => {
        await saveConnector(config, { id: draftId, active: true });
    }, [saveConnector]);

    /** On-demand sync of one connector via sensor-sync. */
    const triggerSync = useCallback(async (id: string, _mode: SyncMode = 'incremental') => {
        setConnectors(prev => prev.map(c => c.connector_id === id ? { ...c, status: 'starting' as const } : c));
        try {
            await supabase.functions.invoke('sensor-sync', { body: { connectorId: id } });
        } catch (e) {
            console.warn('[useConnectors] sync invoke failed (sensor-sync deployed?):', e);
        }
        await refresh();
    }, [refresh]);

    const setConnectorActive = useCallback(async (id: string, active: boolean) => {
        const { error: err } = await supabase.from('connectors')
            .update({ is_active: active, updated_at: new Date().toISOString() }).eq('id', id);
        if (err) throw err;
        await refresh();
    }, [refresh]);

    const deleteConnector = useCallback(async (id: string) => {
        const { error: err } = await supabase.from('connectors').delete().eq('id', id);
        if (err) throw err;
        await refresh();
    }, [refresh]);

    /** Wizard fields for editing: `config.source`, falling back to the row basics. */
    const getConnectorConfig = useCallback(async (id: string): Promise<AnyConnectorConfig | null> => {
        const { data, error: err } = await supabase.from('connectors').select('*').eq('id', id).maybeSingle();
        if (err || !data) return null;
        return {
            ...(data.config?.source || {}),
            id: data.id,
            name: data.name,
            type: data.type,
            is_active: data.is_active,
            sync_interval_seconds: data.sync_interval_seconds,
        } as AnyConnectorConfig;
    }, []);

    /** Real run history from connector_sync_logs (written by sensor-sync). */
    const getSyncLogs = useCallback(async (connectorId: string, limit = 20): Promise<ConnectorSyncLog[]> => {
        const { data, error: err } = await supabase
            .from('connector_sync_logs').select('*')
            .eq('connector_id', connectorId)
            .order('started_at', { ascending: false })
            .limit(limit);
        if (err) return [];
        return (data || []).map((r: any) => ({
            id: r.id,
            connector_id: r.connector_id,
            mode: 'incremental' as SyncMode,
            start_time: r.started_at,
            end_time: r.finished_at,
            status: r.status === 'ok' ? 'completed' as const : 'failed' as const,
            records_processed: r.records || 0,
            records_added: r.records || 0,
            records_updated: 0,
            records_failed: r.status === 'ok' ? 0 : 1,
            error_message: r.status === 'ok' ? null : r.message,
            average_dqs_score: null,
        }));
    }, []);

    return {
        connectors,
        isLoading,
        error,
        refresh,
        getConnectorConfig,
        getSyncLogs,
        triggerSync,
        registerConnector,
        testConnector,
        setConnectorActive,
        deleteConnector,
    };
}
