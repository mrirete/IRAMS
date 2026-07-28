/**
 * assessmentSnapshotService — persistence for Specialist assessment runs
 * (Phase A1, docs/Specialist-150k-Replacement-Plan.md).
 *
 * Table 0228_assessment_snapshots. Append-only: the report page saves at most
 * one snapshot per SNAPSHOT_MIN_INTERVAL_HOURS so casual revisits don't spam
 * the trend record, and a failed insert (e.g. non-admin viewer) is silently
 * non-fatal — the on-screen report never depends on persistence.
 */
import { supabase } from '../lib/supabase';

export interface AssessmentSnapshot {
    id: string;
    created_at: string;
    created_by: string | null;
    total_spend_12mo: number;
    wo_count_12mo: number;
    asset_count: number;
    warranty_recoverable: number;
    pm_flag_count: number;
    coverage_cost_pct: number | null;
    coverage_failure_pct: number | null;
    coverage_downtime_pct: number | null;
    register_health_pct: number | null;
    /** % of A/B-criticality assets with a strategy in place (0231). */
    strategy_coverage_pct?: number | null;
    findings: Record<string, unknown>;
    narrative: string | null;
}

export const SNAPSHOT_MIN_INTERVAL_HOURS = 12;

export async function getLatestSnapshot(): Promise<AssessmentSnapshot | null> {
    const { data, error } = await supabase
        .from('ers_assessment_snapshots')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) {
        console.error('assessmentSnapshotService.getLatestSnapshot:', error);
        return null;
    }
    return (data ?? null) as AssessmentSnapshot | null;
}

export function shouldSaveSnapshot(prev: AssessmentSnapshot | null, nowMs: number): boolean {
    if (!prev) return true;
    const ageHours = (nowMs - new Date(prev.created_at).getTime()) / 3_600_000;
    return ageHours >= SNAPSHOT_MIN_INTERVAL_HOURS;
}

// Concurrent-mount guard (StrictMode double-effects, rapid revisits): the
// shouldSaveSnapshot check reads the DB, so two overlapping loads both pass
// it. This stamp is set synchronously before the insert await, so the second
// caller in the same session bails instead of double-writing the trend.
let lastSaveStartedMs = 0;

export async function saveSnapshot(
    row: Omit<AssessmentSnapshot, 'id' | 'created_at'>,
): Promise<AssessmentSnapshot | null> {
    if (Date.now() - lastSaveStartedMs < 60_000) return null;
    lastSaveStartedMs = Date.now();
    const { data, error } = await supabase
        .from('ers_assessment_snapshots')
        .insert(row)
        .select()
        .single();
    if (error) {
        // Expected for non-admin viewers (RLS) — the report stands without it.
        console.warn('assessmentSnapshotService.saveSnapshot skipped:', error.message);
        return null;
    }
    return data as AssessmentSnapshot;
}
