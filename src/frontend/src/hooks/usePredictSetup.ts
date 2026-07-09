/**
 * usePredictSetup — DB-derived setup state for the Predict front page.
 *
 * "Connected" is honest and register-scoped: an asset counts as connected when
 * it has online sensor rows (ers_sensor_readings) OR manual condition data
 * (reading_logs). The Predict page uses this to decide whether a first-timer
 * lands in the guided Setup Journey instead of an empty dashboard. Progress is
 * derived from live counts (same idea as GettingStarted), so it survives
 * sessions and reflects work teammates already did.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../eam/lib/supabase';

export interface PredictSetupState {
    loading: boolean;
    /** Asset ids with any data — online sensors or manual readings. */
    connected: Set<string>;
    /** Asset ids with at least one active measurement point defined. */
    withPoints: Set<string>;
    refresh: () => Promise<void>;
}

export function usePredictSetup(): PredictSetupState {
    const [loading, setLoading] = useState(true);
    const [connected, setConnected] = useState<Set<string>>(new Set());
    const [withPoints, setWithPoints] = useState<Set<string>>(new Set());

    const refresh = useCallback(async () => {
        try {
            const [sensors, logs, defs] = await Promise.all([
                supabase.from('ers_sensor_readings').select('asset_id').limit(5000),
                supabase.from('reading_logs').select('asset_id').eq('is_active', true).limit(5000),
                supabase.from('reading_definitions').select('asset_id').eq('is_active', true).limit(5000),
            ]);
            const conn = new Set<string>();
            (sensors.data || []).forEach((r: { asset_id: string | null }) => r.asset_id && conn.add(r.asset_id));
            (logs.data || []).forEach((r: { asset_id: string | null }) => r.asset_id && conn.add(r.asset_id));
            const pts = new Set<string>();
            (defs.data || []).forEach((r: { asset_id: string | null }) => r.asset_id && pts.add(r.asset_id));
            setConnected(conn);
            setWithPoints(pts);
        } catch (e) {
            console.warn('[usePredictSetup] state fetch failed:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    return { loading, connected, withPoints, refresh };
}
