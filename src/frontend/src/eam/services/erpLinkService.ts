/**
 * The live link, from the browser: targets, the exception queue, run
 * history, and the worker's on-demand modes (Test connection, Dry-run, Sync
 * now). Reads and writes go through RLS (0383: tenant + admin); the worker is
 * reached through the erp-sync edge function with the person's own JWT, and
 * decides for itself whether they may run it.
 */
import { supabase } from '../lib/supabase';
import type { Families, Family, Watermarks } from '../../lib/erpLink/masterData';

export type TargetSystem = 'sap_s4' | 'sap_sim' | 'generic';
export type AuthMode = 'none' | 'basic' | 'bearer' | 'oauth2_client_credentials';

export interface TargetAuth { mode: AuthMode; secret_name?: string; token_url?: string; client_id?: string; username?: string }

export interface ErpTarget {
    id: string;
    company_id: string;
    name: string;
    system: TargetSystem;
    base_url: string;
    auth: TargetAuth;
    families: Families;
    poll_interval_minutes: number;
    dry_run: boolean;
    is_active: boolean;
    watermarks: Watermarks | null;
    last_run_at: string | null;
    last_status: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

export type TargetDraft = Pick<ErpTarget, 'name' | 'system' | 'base_url' | 'auth' | 'families' | 'poll_interval_minutes' | 'dry_run' | 'is_active'> & { id?: string };

export type OutboxStatus = 'pending' | 'sent' | 'failed' | 'dry_run' | 'skipped' | 'conflict';

export interface OutboxRow {
    id: string;
    target_id: string;
    family: Family;
    direction: 'OUT' | 'IN';
    document_type: string;
    document_id: string;
    document_version: string;
    document_key: string | null;
    status: OutboxStatus;
    attempts: number;
    next_attempt_at: string | null;
    payload: Record<string, unknown>;
    response: Record<string, unknown> | null;
    http_status: number | null;
    external_key: string | null;
    etag: string | null;
    error: string | null;
    reason: string | null;
    approved_at: string | null;
    resolved_at: string | null;
    sent_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface ErpRun {
    id: string;
    target_id: string;
    direction: 'OUT' | 'IN' | 'BOTH';
    status: 'running' | 'done' | 'failed';
    dry_run: boolean;
    worker: string | null;
    started_at: string;
    finished_at: string | null;
    stats: Record<string, number>;
    error: string | null;
}

export interface SimEntity {
    id: string;
    entity_set: string;
    entity_key: string;
    etag: number;
    payload: Record<string, unknown>;
    last_change_datetime: string;
}

export type SyncMode = 'sync' | 'dry_run' | 'test' | 'sim_edit' | 'sim_reset';

export interface SyncReport {
    target_id: string;
    name: string;
    run_id: string | null;
    status: 'done' | 'failed' | 'busy' | 'skipped';
    dry_run: boolean;
    stats: Record<string, number>;
    error: string | null;
}

/** The migration is not on this database yet — the screen says so instead of erroring. */
export const isMissingTable = (e: { code?: string; message?: string } | null | undefined): boolean =>
    !!e && (e.code === '42P01' || /relation .* does not exist|schema cache/i.test(e.message ?? ''));

const fail = (ctx: string, e: { message: string } | null) => { if (e) throw new Error(`${ctx}: ${e.message}`); };

export const erpLinkService = {
    /**
     * The tenant, from the access token's claim — the same place RLS reads it.
     * The custom access-token hook (0258) puts company_id into the JWT; the
     * session's user object does not necessarily carry it, so decode locally.
     */
    async companyId(): Promise<string | null> {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                const claim = payload?.app_metadata?.company_id;
                if (typeof claim === 'string' && claim) return claim;
            } catch { /* fall through to the user object */ }
        }
        return (data.session?.user.app_metadata?.company_id as string | undefined) ?? null;
    },

    /** The simulator's base URL for this tenant — the path segment IS the tenant. */
    simulatorBaseUrl(companyId: string): string {
        return `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/+$/, '')}/functions/v1/sap-sim/t/${companyId}`;
    },

    async listTargets(): Promise<ErpTarget[]> {
        const { data, error } = await supabase.from('erp_targets').select('*').order('created_at');
        fail('targets', error);
        return (data ?? []) as ErpTarget[];
    },

    async saveTarget(draft: TargetDraft): Promise<ErpTarget> {
        const { data: { user } } = await supabase.auth.getUser();
        const row = {
            name: draft.name.trim(), system: draft.system, base_url: draft.base_url.trim().replace(/\/+$/, ''),
            auth: draft.auth, families: draft.families, poll_interval_minutes: draft.poll_interval_minutes,
            dry_run: draft.dry_run, is_active: draft.is_active,
        };
        if (draft.id) {
            const { data, error } = await supabase.from('erp_targets').update(row).eq('id', draft.id).select('*').single();
            fail('save target', error);
            return data as ErpTarget;
        }
        const { data, error } = await supabase.from('erp_targets').insert({ ...row, created_by: user?.id ?? null }).select('*').single();
        fail('add target', error);
        return data as ErpTarget;
    },

    async deleteTarget(id: string): Promise<void> {
        const { error } = await supabase.from('erp_targets').delete().eq('id', id);
        fail('delete target', error);
    },

    async listQueue(): Promise<OutboxRow[]> {
        const { data, error } = await supabase
            .from('erp_outbox').select('*')
            .in('status', ['failed', 'conflict'])
            .is('resolved_at', null)
            .order('created_at', { ascending: false }).limit(200);
        fail('queue', error);
        return (data ?? []) as OutboxRow[];
    },

    async listRecentDocuments(limit = 50): Promise<OutboxRow[]> {
        const { data, error } = await supabase
            .from('erp_outbox').select('*')
            .order('created_at', { ascending: false }).limit(limit);
        fail('documents', error);
        return (data ?? []) as OutboxRow[];
    },

    async listRuns(limit = 20): Promise<ErpRun[]> {
        const { data, error } = await supabase
            .from('erp_runs').select('*')
            .order('started_at', { ascending: false }).limit(limit);
        fail('runs', error);
        return (data ?? []) as ErpRun[];
    },

    /**
     * Retry: back into the retry lane, due now. For a conflict the person is
     * choosing IREAMS's version over SAP's, and the worker sends it with
     * If-Match: * (the row's etag is the signal — see erp-sync deliver()).
     */
    async retry(row: OutboxRow, byUserId: string | null): Promise<void> {
        const wasConflict = row.status === 'conflict';
        const { error } = await supabase.from('erp_outbox').update({
            status: 'failed', next_attempt_at: new Date().toISOString(), response: null,
            etag: wasConflict ? '*' : row.etag,
            reason: wasConflict ? `Retried by a person: IREAMS's version is sent over SAP's.` : row.reason,
            resolved_by: byUserId, resolved_at: null,
        }).eq('id', row.id);
        fail('retry', error);
    },

    async skip(row: OutboxRow, byUserId: string | null, note: string): Promise<void> {
        const { error } = await supabase.from('erp_outbox').update({
            status: 'skipped', reason: note ? `${row.reason ? row.reason + ' ' : ''}Skipped: ${note}` : row.reason,
            resolved_by: byUserId, resolved_at: new Date().toISOString(), next_attempt_at: null,
        }).eq('id', row.id);
        fail('skip', error);
    },

    /** Acknowledge a conflict that was applied (SAP won): it leaves the queue, the trail stays. */
    async acknowledge(row: OutboxRow, byUserId: string | null): Promise<void> {
        const { error } = await supabase.from('erp_outbox').update({
            resolved_by: byUserId, resolved_at: new Date().toISOString(),
        }).eq('id', row.id);
        fail('acknowledge', error);
    },

    async run(mode: SyncMode, targetId?: string, extra: { direction?: 'OUT' | 'IN' | 'BOTH'; edit?: { set: string; key: string; changes: Record<string, unknown> } } = {}): Promise<SyncReport[]> {
        const { data, error } = await supabase.functions.invoke('erp-sync', { body: { mode, target_id: targetId, ...extra } });
        if (error) {
            // supabase-js hides the function's JSON body behind a generic message; surface it.
            let detail = error.message;
            try {
                const ctx = (error as { context?: Response }).context;
                if (ctx && typeof ctx.json === 'function') detail = ((await ctx.json()) as { error?: string }).error ?? detail;
            } catch { /* keep the generic message */ }
            throw new Error(detail);
        }
        return ((data as { targets?: SyncReport[] })?.targets ?? []);
    },

    async listSimulator(): Promise<SimEntity[]> {
        const { data, error } = await supabase
            .from('sap_sim_entities')
            .select('id, entity_set, entity_key, etag, payload, last_change_datetime')
            .order('entity_set').order('entity_key').limit(500);
        fail('simulator', error);
        return (data ?? []) as SimEntity[];
    },
};

export default erpLinkService;
