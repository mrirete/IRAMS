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

    // ── internal apply (0299) ────────────────────────────────────────────

    /**
     * Apply an approved interval proposal to IREAMS's OWN schedule — the third
     * delivery route (0299), for the full-suite tenant whose PMs live here
     * rather than in a foreign CMMS. Updates recurring_work.frequency_interval,
     * appends an interval_revision to the PM's origin provenance, and marks the
     * proposal 'applied' (a terminal, ROI-counted state).
     *
     * The PM is resolved by the payload's current_pm_code first (exact code
     * match); as a fallback, a SINGLE active PM on the proposal's asset. An
     * ambiguous or missing match throws rather than guessing — never silently
     * retime the wrong programme.
     */
    public async applyIntervalProposal(p: ApprovedProposal): Promise<{
        pmId: string; pmCode: string; fromInterval: number; fromUnit: string; toDays: number;
    }> {
        const payload = (p.draft_payload ?? {}) as Record<string, unknown>;
        const kind = String(payload.recommendation_type ?? '');
        if (kind !== 'extend_interval' && kind !== 'set_interval') {
            throw new Error('Only interval proposals (extend/set interval) can be applied to the schedule.');
        }
        const toDays = Number(payload.recommended_interval_days);
        if (!Number.isFinite(toDays) || toDays <= 0) {
            throw new Error('Proposal carries no valid recommended interval.');
        }

        // Resolve the target PM.
        const code = String(payload.current_pm_code ?? '').trim();
        let pm: { id: string; code: string; frequency_interval: number; frequency_unit: string; origin: Record<string, unknown> | null } | null = null;
        if (code) {
            const { data, error } = await supabase
                .from('recurring_work')
                .select('id, code, frequency_interval, frequency_unit, origin')
                .eq('code', code)
                .limit(2);
            if (error) throw new Error(`PM lookup failed: ${error.message}`);
            if ((data ?? []).length > 1) throw new Error(`PM code ${code} is ambiguous (${data!.length} matches).`);
            pm = data?.[0] ?? null;
        }
        if (!pm && p.asset_id) {
            const { data, error } = await supabase
                .from('recurring_work')
                .select('id, code, frequency_interval, frequency_unit, origin')
                .eq('asset_id', p.asset_id)
                .eq('active', true)
                .limit(3);
            if (error) throw new Error(`PM lookup failed: ${error.message}`);
            if ((data ?? []).length === 1) pm = data![0];
            else if ((data ?? []).length > 1) {
                throw new Error('This asset has several active PMs — the proposal names none (no current_pm_code). Adjust the PM directly in Work → PM Programs.');
            }
        }
        if (!pm) throw new Error('No matching PM programme found for this proposal.');

        const { data: { user } } = await supabase.auth.getUser();
        const appliedBy = user?.email ?? user?.id ?? null;
        const revision = {
            proposal_id: p.id,
            recommendation_type: kind,
            from_interval: pm.frequency_interval,
            from_unit: pm.frequency_unit,
            to_days: toDays,
            basis: String(payload.basis ?? ''),
            applied_at: new Date().toISOString(),
            applied_by: appliedBy,
        };
        const priorRevisions = Array.isArray((pm.origin as any)?.interval_revisions)
            ? (pm.origin as any).interval_revisions : [];
        const { error: pmErr } = await supabase
            .from('recurring_work')
            .update({
                frequency_interval: toDays,
                frequency_unit: 'Days',
                origin: { ...(pm.origin ?? {}), interval_revisions: [...priorRevisions, revision] },
                updated_at: new Date().toISOString(),
            })
            .eq('id', pm.id);
        if (pmErr) throw new Error(`Could not update the PM: ${pmErr.message}`);

        // Terminal state on the proposal. If this stamp fails, say so loudly —
        // the PM HAS changed and the queue must not offer a second apply.
        const { error: actErr } = await supabase
            .from('ers_agent_actions')
            .update({
                status: 'applied',
                applied_at: new Date().toISOString(),
                applied_ref: { pm_id: pm.id, pm_code: pm.code, from_interval: pm.frequency_interval, from_unit: pm.frequency_unit, to_days: toDays, applied_by: appliedBy },
                updated_at: new Date().toISOString(),
            })
            .eq('id', p.id)
            .eq('status', 'approved');
        if (actErr) {
            throw new Error(`PM ${pm.code} was updated to every ${toDays} days, but the proposal could not be marked applied (${actErr.message}). Refresh before retrying — do not apply it twice.`);
        }
        return { pmId: pm.id, pmCode: pm.code, fromInterval: pm.frequency_interval, fromUnit: pm.frequency_unit, toDays };
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
