import { useState, useEffect } from 'react';
import type { ConnectorHealth, AnyConnectorConfig, SyncMode } from '../types/connectors';

// --- MOCK DATA ---
const MOCK_CONNECTORS: ConnectorHealth[] = [
    {
        connector_id: '11111111-1111-1111-1111-111111111111',
        name: 'Primary ERP System',
        type: 'rest_api',
        status: 'running',
        last_sync: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        next_sync: new Date(Date.now() + 1000 * 60 * 45).toISOString(),
        error_message: null,
        records_synced: 124500,
        dqs_score: 88.5,
        overall_status: 'healthy'
    },
    {
        connector_id: '22222222-2222-2222-2222-222222222222',
        name: 'Legacy Historian',
        type: 'historian',
        status: 'stopped',
        last_sync: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
        next_sync: null,
        error_message: null,
        records_synced: 89200,
        dqs_score: 62.1,
        overall_status: 'degraded'
    },
    {
        connector_id: '33333333-3333-3333-3333-333333333333',
        name: 'Sensor Gateway Broker',
        type: 'mqtt',
        status: 'error',
        last_sync: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
        next_sync: new Date(Date.now() + 1000 * 60 * 5).toISOString(),
        error_message: 'Connection reset by peer after 3000ms timeout.',
        records_synced: 5120,
        dqs_score: 45.0,
        overall_status: 'error'
    },
    {
        connector_id: '44444444-4444-4444-4444-444444444444',
        name: 'Work Orders CMMS',
        type: 'database',
        status: 'running',
        last_sync: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        next_sync: new Date(Date.now() + 1000 * 60 * 120).toISOString(),
        error_message: null,
        records_synced: 67800,
        dqs_score: 91.2,
        overall_status: 'healthy'
    },
    {
        connector_id: '55555555-5555-5555-5555-555555555555',
        name: 'Nightly CSV Extract',
        type: 'csv',
        status: 'running',
        last_sync: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
        next_sync: new Date(Date.now() + 1000 * 60 * 60 * 16).toISOString(),
        error_message: null,
        records_synced: 32100,
        dqs_score: 74.8,
        overall_status: 'degraded'
    },
    {
        connector_id: '66666666-6666-6666-6666-666666666666',
        name: 'SharePoint P&IDs',
        type: 'document_store',
        status: 'running',
        last_sync: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
        next_sync: new Date(Date.now() + 1000 * 60 * 60 * 22).toISOString(),
        error_message: null,
        records_synced: 2450,
        dqs_score: 82.3,
        overall_status: 'healthy'
    },
    {
        connector_id: '77777777-7777-7777-7777-777777777777',
        name: 'Bonny Island Weather',
        type: 'weather_api',
        status: 'running',
        last_sync: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        next_sync: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
        error_message: null,
        records_synced: 18600,
        dqs_score: 95.1,
        overall_status: 'healthy'
    }
];

const MOCK_CONFIGS: Record<string, AnyConnectorConfig> = {
    '11111111-1111-1111-1111-111111111111': {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Primary ERP System',
        type: 'rest_api',
        is_active: true,
        sync_interval_seconds: 3600,
        retry_max_attempts: 5,
        retry_backoff_base_seconds: 2,
        dqs_record_type: 'asset',
        dqs_asset_class: 'General',
        base_url: 'https://api.sap.example.com/v1',
        auth_type: 'bearer',
        pagination_style: 'cursor',
        rate_limit_rpm: 120
    } as AnyConnectorConfig,
};

// --- HOOK ---
export function useConnectors() {
    const [connectors, setConnectors] = useState<ConnectorHealth[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch all connectors (Health overview)
    useEffect(() => {
        let isMounted = true;
        const fetchConnectors = async () => {
            setIsLoading(true);
            try {
                // TODO: Replace with Real API Call
                // const res = await fetch('/api/v1/connectors/health');
                // const data = await res.json();

                // Simulate network delay
                await new Promise(resolve => setTimeout(resolve, 600));

                if (isMounted) {
                    setConnectors(MOCK_CONNECTORS);
                    setError(null);
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Failed to fetch connectors');
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        fetchConnectors();
        return () => { isMounted = false; };
    }, []);

    // Get specific connector config
    const getConnectorConfig = async (id: string): Promise<AnyConnectorConfig | null> => {
        setIsLoading(true);
        try {
            await new Promise(resolve => setTimeout(resolve, 300));
            return MOCK_CONFIGS[id] || null;
        } finally {
            setIsLoading(false);
        }
    };

    // Trigger a sync
    const triggerSync = async (id: string, _mode: SyncMode = 'dry_run') => {
        // TODO: Replace with Real API Call
        setConnectors(prev => prev.map(c =>
            c.connector_id === id
                ? { ...c, status: 'starting' as const }
                : c
        ));
    };

    const registerConnector = async (config: AnyConnectorConfig) => {
        // TODO: POST /api/v1/connectors/register/rest etc
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('Registered', config);

        // Optimistically add to local state so the Hub shows it immediately
        const newHealth: ConnectorHealth = {
            connector_id: config.id || crypto.randomUUID(),
            name: config.name,
            type: config.type,
            status: 'stopped',
            last_sync: null,
            next_sync: null,
            error_message: null,
            records_synced: 0,
            dqs_score: undefined,
            overall_status: 'healthy',
        };
        setConnectors(prev => [newHealth, ...prev]);
    };

    return {
        connectors,
        isLoading,
        error,
        getConnectorConfig,
        triggerSync,
        registerConnector
    };
}
