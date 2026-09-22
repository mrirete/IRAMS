/**
 * The sync stamp on a schedule: when IREAMS last sent it to SAP, and when a
 * planner confirmed the change was applied there.
 *
 * Lives on recurring_work.origin as `sap_sync`, next to the change trail the
 * Specialist writeback keeps (interval_revisions) — the same JSON the rest of
 * the provenance uses, so no new table and no new column. Read-modify-write
 * on the origin, merging only this key, so nothing else on it is disturbed.
 */
import { supabase } from '../lib/supabase';

export interface SapSyncStamp {
    sent_at?: string;
    sent_in?: string;
    confirmed_at?: string;
    confirmed_by?: string | null;
}

async function stamp(ids: string[], patch: SapSyncStamp): Promise<{ updated: number; failed: string[] }> {
    const failed: string[] = [];
    let updated = 0;
    if (ids.length === 0) return { updated, failed };
    const { data, error } = await supabase.from('recurring_work').select('id, origin').in('id', ids);
    if (error) throw new Error(`Could not read schedules: ${error.message}`);
    // Each row's origin differs, so each is its own update — but they need not
    // wait for one another: a file with thirty schedules is stamped in one
    // round-trip's time, not thirty.
    const rows = (data ?? []) as { id: string; origin: Record<string, unknown> | null }[];
    const results = await Promise.all(rows.map(async row => {
        const origin = row.origin ?? {};
        const prior = (origin.sap_sync ?? {}) as Record<string, unknown>;
        const { error: upErr } = await supabase
            .from('recurring_work')
            .update({ origin: { ...origin, sap_sync: { ...prior, ...patch } }, updated_at: new Date().toISOString() })
            .eq('id', row.id);
        return { id: row.id, ok: !upErr };
    }));
    for (const r of results) { if (r.ok) updated += 1; else failed.push(r.id); }
    return { updated, failed };
}

/** The file has been downloaded with these schedules in it. */
export const markSentToSap = (ids: string[], fileName: string) =>
    stamp(ids, { sent_at: new Date().toISOString(), sent_in: fileName });

/** A planner applied the change in SAP (IP02 / IA06) — or the live link read it back. */
export async function markConfirmedInSap(id: string): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    const out = await stamp([id], { confirmed_at: new Date().toISOString(), confirmed_by: user?.email ?? user?.id ?? null });
    if (out.failed.length) throw new Error('Could not mark the schedule as confirmed in SAP.');
}
