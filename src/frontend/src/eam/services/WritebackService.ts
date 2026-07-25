/**
 * WritebackService — the outbound half of the Specialist's loop (Phase 3,
 * migration 0221). Phase 1 imported the customer's CMMS history; this sends
 * approved work back to it.
 *
 * Two delivery routes, both fed by the same normalized actions from
 * lib/writebackPackage:
 *   • Export package — a CMMS-shaped file the customer bulk-imports. Always
 *     available; needs no API on their side.
 *   • Live delivery — the proposal-writeback edge function POSTs to a
 *     configured endpoint. The function re-checks approval server-side, so
 *     nothing unapproved can leave, and every attempt is logged.
 */
import { supabase } from '../lib/supabase';
import type { ApprovedProposal, AssetRef, NormalizedAction } from '../../lib/writebackPackage';

export interface WritebackTarget {
    id: string;
    name: string;
    system: 'generic' | 'sap_pm' | 'maximo' | 'maintainx' | 'other';
    endpoint_url: string;
    method: 'POST' | 'PUT';
    config: Record<string, unknown>;
    is_active: boolean;
    last_delivery_at: string | null;
    last_status: string | null;
    last_error: string | null;
    created_at: string;
}

export interface DeliveryLogRow {
    id: string;
    target_id: string | null;
    proposal_id: string;
    status: 'sent' | 'failed' | 'dry_run' | 'skipped';
    http_status: number | null;
    response_excerpt: string | null;
    error: string | null;
    delivered_at: string;
}

export interface DeliveryResult {
    target: string;
    dry_run: boolean;
    sent: number;
    failed: number;
    skipped: number;
    warning?: string;
    results: { proposal_id: string; status: string; reason?: string; error?: string; http_status?: number }[];
}

class WritebackService {
    private static instance: WritebackService;
    public static getInstance(): WritebackService {
        if (!WritebackService.instance) WritebackService.instance = new WritebackService();
        return WritebackService.instance;
    }

    // ── proposals ────────────────────────────────────────────────────────

    /** Approved proposals — the queue of work waiting to reach the host CMMS. */
    public async getApprovedProposals(): Promise<ApprovedProposal[]> {
        const { data, error } = await supabase
            .from('ers_agent_actions')
            .select('id, agent_type, action_type, asset_id, draft_payload, created_at')
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(500);
        if (error) {
            console.error('getApprovedProposals failed:', error.message);
            return [];
        }
        return (data ?? []) as ApprovedProposal[];
    }

    /** Minimal asset register used to resolve proposal → tag/name. */
    public async getAssetRefs(): Promise<AssetRef[]> {
        const { data, error } = await supabase
            .from('assets')
            .select('id, tag, name')
            .limit(10000);
        if (error) {
            console.error('getAssetRefs failed:', error.message);
            return [];
        }
        return (data ?? []) as AssetRef[];
    }

    /** Proposal ids already delivered successfully to a target (hidden from the queue). */
    public async getDeliveredProposalIds(targetId: string): Promise<Set<string>> {
        const { data, error } = await supabase
            .from('writeback_log')
            .select('proposal_id')
            .eq('target_id', targetId)
            .eq('status', 'sent')
            .limit(5000);
        if (error) return new Set();
        return new Set((data ?? []).map((r: { proposal_id: string }) => r.proposal_id));
    }

    // ── targets ──────────────────────────────────────────────────────────

    public async listTargets(): Promise<WritebackTarget[]> {
        const { data, error } = await supabase
            .from('writeback_targets')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            // Table absent (pre-0221) — the export route still works.
            console.warn('listTargets unavailable:', error.message);
            return [];
        }
        return (data ?? []) as WritebackTarget[];
    }

    public async createTarget(input: {
        name: string;
        system: WritebackTarget['system'];
        endpoint_url: string;
        method?: 'POST' | 'PUT';
        config?: Record<string, unknown>;
    }): Promise<WritebackTarget> {
        const { data: { user } } = await supabase.auth.getUser();
        const { data, error } = await supabase
            .from('writeback_targets')
            .insert({
                name: input.name,
                system: input.system,
                endpoint_url: input.endpoint_url,
                method: input.method ?? 'POST',
                config: input.config ?? {},
                is_active: false, // targets start inactive; a dry run proves them first
                created_by: user?.id ?? null,
            })
            .select()
            .single();
        if (error) throw new Error(`Could not create target: ${error.message}`);
        return data as WritebackTarget;
    }

    public async setTargetActive(id: string, active: boolean): Promise<void> {
        const { error } = await supabase
            .from('writeback_targets')
            .update({ is_active: active, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw new Error(`Could not update target: ${error.message}`);
    }

    public async deleteTarget(id: string): Promise<void> {
        const { error } = await supabase.from('writeback_targets').delete().eq('id', id);
        if (error) throw new Error(`Could not delete target: ${error.message}`);
    }

    // ── delivery ─────────────────────────────────────────────────────────

    /**
     * Send normalized actions to a target. `dryRun` builds and logs the exact
     * payload without any outbound call — always worth running first.
     */
    public async deliver(
        targetId: string,
        actions: NormalizedAction[],
        dryRun = false,
    ): Promise<DeliveryResult> {
        const { data, error } = await supabase.functions.invoke('proposal-writeback', {
            body: { targetId, actions, dryRun },
        });
        if (error) throw new Error(friendlyInvokeError(error));
        if (data?.error) throw new Error(String(data.error));
        return data as DeliveryResult;
    }

    public async listDeliveries(limit = 25): Promise<DeliveryLogRow[]> {
        const { data, error } = await supabase
            .from('writeback_log')
            .select('id, target_id, proposal_id, status, http_status, response_excerpt, error, delivered_at')
            .order('delivered_at', { ascending: false })
            .limit(limit);
        if (error) return [];
        return (data ?? []) as DeliveryLogRow[];
    }
}

function friendlyInvokeError(error: unknown): string {
    const msg = error instanceof Error ? error.message : String(error);
    if (/not found|404/i.test(msg)) {
        return 'The proposal-writeback function is not deployed yet — use the export package until it is.';
    }
    return `Delivery failed: ${msg}`;
}

export const writebackService = WritebackService.getInstance();
