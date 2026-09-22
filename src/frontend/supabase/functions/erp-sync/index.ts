// Supabase Edge Function: erp-sync
// ────────────────────────────────────────────────────────────────────────────
// The live-link worker (docs/SAP-Live-Link-Plan.md §2). Once per tick, or on
// demand from Admin › Integrations, it takes the lease on each due target
// (erp_claim_run, 0383), sends what changed in IREAMS since the outbound
// watermark, pulls what changed in SAP since the inbound watermark, applies
// the family's ownership rule where both sides moved, records every document
// verbatim in erp_outbox, and advances the watermarks only after the run's
// rows are committed. Phase 1 carries master data (functional locations and
// equipment); the other families join in phases 2–3 on the same spine.
//
// Exactly-once is the database's job, not this file's: a version already
// recorded 'sent' is never sent again (checked before the call, enforced by
// the unique index after it), a failed row is retried from its own payload
// on its own back-off, and one live row per version means a crashed run
// replays harmlessly.
//
// TENANT DISCIPLINE — this runs as the service role, which RLS waves through.
// Every query carries the target's company_id explicitly; remove one and a
// tenant's equipment lands in another tenant's SAP. The `erp-export` rule.
//
// Auth: the scheduler sends x-cron-key (BRIEFING_CRON_KEY, the project's one
// cron key); a person sends their JWT and must be an administrator of the
// target's tenant (is_admin() — the database's own definition, not a copy).
//
// Body (all optional): { target_id, mode: 'sync'|'dry_run'|'test'|'sim_edit'|'sim_reset',
//                        direction: 'OUT'|'IN'|'BOTH', edit: { set, key, changes } }
//
// Deploy: supabase functions deploy erp-sync --no-verify-jwt
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsFor } from '../_shared/cors.ts';
import {
    KEY_PROPERTY, bodyEtag, keyUrl, setUrl, sinceFilter, type EntitySet,
} from './lib/odata.ts';
import {
    advanceWatermark, backoffMinutes, changedFields, entitySetOf, flows, fromEquipment, fromFunctionalLocation,
    newAssetFromEquipment, newAssetFromFunctionalLocation, objectTypeOf, patchDiff, resolveInbound, resolveStaleSend,
    sendOrder, toEquipmentDoc, toFunctionalLocationDoc, watermarkOf, withWatermark,
    type AssetPatch, type Families, type FamilyRule, type LinkAsset, type ParentRef, type SapObjectType, type Watermarks,
} from './lib/masterData.ts';

type Json = Record<string, unknown>;
type Mode = 'sync' | 'dry_run' | 'test' | 'sim_edit' | 'sim_reset';
type Direction = 'OUT' | 'IN' | 'BOTH';

interface TargetAuth { mode?: 'none' | 'basic' | 'bearer' | 'oauth2_client_credentials'; secret_name?: string; token_url?: string; client_id?: string; username?: string }
interface Target {
    id: string; company_id: string; name: string; system: string; base_url: string;
    auth: TargetAuth; families: Families; poll_interval_minutes: number;
    dry_run: boolean; is_active: boolean; watermarks: Watermarks | null; last_run_at: string | null;
}
interface MapRow { id: string; entity_id: string; external_key: string; external_type: SapObjectType | null; etag: string | null; last_synced_at: string | null }
interface Stats { [k: string]: number }

const ASSET_COLS = 'id, tag, name, hierarchy_level, parent_id, equipment_number, manufacturer, model, serial_number, criticality, status_code, updated_at';
const BATCH = 500;
const FAMILY = 'master_data' as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);
const bump = (s: Stats, k: string, n = 1) => { s[k] = (s[k] ?? 0) + n; };

// ── HTTP to the target ───────────────────────────────────────────────────────

const tokenCache = new Map<string, string>();

/** Headers for the target. A credential is read from the function's secrets by the NAME the target stores — never from the database. */
async function targetHeaders(t: Target): Promise<Record<string, string>> {
    const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    const a = t.auth ?? {};
    const mode = a.mode ?? 'none';
    if (mode === 'none') return h;
    if (!a.secret_name) throw new Error(`Target '${t.name}': auth mode ${mode} needs a secret name.`);
    const secret = Deno.env.get(a.secret_name) ?? '';
    if (!secret) throw new Error(`Secret '${a.secret_name}' is not set on this project (supabase secrets set ${a.secret_name}=…).`);
    if (mode === 'bearer') h.Authorization = `Bearer ${secret}`;
    else if (mode === 'basic') h.Authorization = `Basic ${a.username ? btoa(`${a.username}:${secret}`) : secret}`;
    else if (mode === 'oauth2_client_credentials') {
        if (!a.token_url || !a.client_id) throw new Error(`Target '${t.name}': OAuth2 needs token_url and client_id.`);
        let tok = tokenCache.get(t.id);
        if (!tok) {
            const res = await fetch(a.token_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'client_credentials', client_id: a.client_id, client_secret: secret }),
            });
            if (!res.ok) throw new Error(`OAuth2 token request failed: HTTP ${res.status}`);
            tok = String(((await res.json()) as Json).access_token ?? '');
            if (!tok) throw new Error('OAuth2 token response had no access_token.');
            tokenCache.set(t.id, tok);
        }
        h.Authorization = `Bearer ${tok}`;
    }
    return h;
}

interface Reply { status: number; ok: boolean; body: Json | null; etag: string | null; text: string }

async function call(headers: Record<string, string>, method: string, url: string, body?: unknown, ifMatch?: string | null): Promise<Reply> {
    const h = { ...headers };
    if (ifMatch) h['If-Match'] = ifMatch;
    const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: Json | null = null;
    try { parsed = text ? JSON.parse(text) as Json : null; } catch { parsed = null; }
    return { status: res.status, ok: res.ok, body: parsed, etag: res.headers.get('etag') ?? bodyEtag(parsed), text: text.slice(0, 4000) };
}

// ── Maps ─────────────────────────────────────────────────────────────────────

async function mapsFor(sb: SupabaseClient, companyId: string, assetIds: string[]): Promise<Map<string, MapRow>> {
    const out = new Map<string, MapRow>();
    if (assetIds.length === 0) return out;
    const { data, error } = await sb
        .from('erp_object_map')
        .select('id, entity_id, external_key, external_type, etag, last_synced_at')
        .eq('company_id', companyId).eq('system', 'SAP').eq('entity_type', 'asset').eq('active', true)
        .in('entity_id', assetIds);
    if (error) throw new Error(`erp_object_map: ${error.message}`);
    for (const m of (data ?? []) as MapRow[]) out.set(m.entity_id, m);
    return out;
}

async function mapByExternal(sb: SupabaseClient, companyId: string, type: SapObjectType, key: string): Promise<MapRow | null> {
    const { data, error } = await sb
        .from('erp_object_map')
        .select('id, entity_id, external_key, external_type, etag, last_synced_at')
        .eq('company_id', companyId).eq('system', 'SAP').eq('entity_type', 'asset').eq('active', true)
        .eq('external_type', type).eq('external_key', key)
        .maybeSingle();
    if (error) throw new Error(`erp_object_map: ${error.message}`);
    return (data as MapRow | null) ?? null;
}

async function upsertMap(sb: SupabaseClient, t: Target, rule: FamilyRule, assetId: string, type: SapObjectType, key: string, etag: string | null, direction: 'IN' | 'OUT'): Promise<void> {
    const { error } = await sb.from('erp_object_map').upsert({
        company_id: t.company_id, system: 'SAP', entity_type: 'asset', entity_id: assetId,
        external_key: key, external_type: type, etag,
        ownership: rule.owner === 'sap' ? 'EXTERNAL' : 'LOCAL',
        last_synced_at: new Date().toISOString(), last_direction: direction, last_error: null, active: true,
    }, { onConflict: 'company_id,system,entity_type,entity_id' });
    if (error) throw new Error(`erp_object_map upsert: ${error.message}`);
}

// ── Outbound: IREAMS → SAP ───────────────────────────────────────────────────

interface OutboxRow { id: string; status: string; document_id: string; document_version: string; payload: Json; attempts: number; next_attempt_at: string | null; external_key: string | null; etag: string | null }
const OUTBOX_COLS = 'id, status, document_id, document_version, payload, attempts, next_attempt_at, external_key, etag';

function buildDoc(a: LinkAsset, map: MapRow | undefined, parent: ParentRef | null): { type: SapObjectType; set: EntitySet; doc: Json } {
    const type = objectTypeOf(a.hierarchy_level);
    const set = entitySetOf(type);
    const doc = type === 'EQUI'
        ? toEquipmentDoc(a, map?.external_key ?? null, parent)
        : toFunctionalLocationDoc(a, map?.external_key ?? null, parent);
    return { type, set, doc: doc as unknown as Json };
}

/** Send one outbox row and record the outcome. Returns true when SAP accepted it. */
async function deliver(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, row: OutboxRow, asset: Pick<LinkAsset, 'id' | 'tag' | 'hierarchy_level'>, map: MapRow | undefined, stats: Stats): Promise<{ key: string; type: SapObjectType } | null> {
    const type = objectTypeOf(asset.hierarchy_level);
    const set = entitySetOf(type);
    const keyProp = KEY_PROPERTY[set];
    const body: Json = { ...row.payload };
    const existingKey = map?.external_key ?? null;
    let reply: Reply;
    try {
        if (existingKey) {
            delete body[keyProp];
            // A person retrying a conflict row sets its etag to '*': send
            // IREAMS's version over whatever SAP has now.
            reply = await call(headers, 'PATCH', keyUrl(t.base_url, set, existingKey), body, row.etag === '*' ? '*' : (map?.etag ?? '*'));
            if (reply.status === 412) {
                if (resolveStaleSend(rule.owner) === 'force') {
                    const fresh = await call(headers, 'GET', keyUrl(t.base_url, set, existingKey));
                    reply = fresh.ok && fresh.etag
                        ? await call(headers, 'PATCH', keyUrl(t.base_url, set, existingKey), body, fresh.etag)
                        : fresh;
                } else {
                    await sb.from('erp_outbox').update({
                        status: 'conflict', http_status: 412, response: reply.body, attempts: row.attempts + 1,
                        reason: `SAP changed ${asset.tag} since the last sync, and SAP owns master data. Review it in SAP; Retry sends IREAMS's version over it.`,
                    }).eq('id', row.id);
                    bump(stats, 'out_conflict');
                    return null;
                }
            }
        } else {
            reply = await call(headers, 'POST', setUrl(t.base_url, set), body);
        }
    } catch (e) {
        reply = { status: 0, ok: false, body: null, etag: null, text: errText(e) };
    }

    if (reply.ok) {
        const key = String(reply.body?.[keyProp] ?? existingKey ?? body[keyProp] ?? '');
        const { error } = await sb.from('erp_outbox').update({
            status: 'sent', sent_at: new Date().toISOString(), http_status: reply.status, response: reply.body,
            external_key: key || null, etag: reply.etag, attempts: row.attempts + 1, error: null, next_attempt_at: null,
        }).eq('id', row.id);
        if (error) {
            // 23505 here means another run recorded this version as sent while
            // we were on the wire: the index did its job; this row is retired.
            await sb.from('erp_outbox').update({ status: 'skipped', reason: 'Recorded as sent by a concurrent run.', attempts: row.attempts + 1 }).eq('id', row.id);
            bump(stats, 'out_duplicate_prevented');
            return null;
        }
        if (key) await upsertMap(sb, t, rule, asset.id, type, key, reply.etag, 'OUT');
        bump(stats, 'out_sent');
        return key ? { key, type } : null;
    }

    const attempts = row.attempts + 1;
    await sb.from('erp_outbox').update({
        status: 'failed', http_status: reply.status || null, response: reply.body, attempts,
        error: reply.body?.error ? JSON.stringify(reply.body.error).slice(0, 1000) : reply.text || `HTTP ${reply.status}`,
        next_attempt_at: new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString(),
    }).eq('id', row.id);
    bump(stats, 'out_failed');
    return null;
}

async function outbound(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, dryRun: boolean, stats: Stats): Promise<string | null> {
    const wm = watermarkOf(t.watermarks, FAMILY, 'out');
    const processed: string[] = [];

    // 1. Retries first: failed rows whose back-off has elapsed, from their own payload.
    if (!dryRun) {
        const { data: due, error } = await sb
            .from('erp_outbox')
            .select(OUTBOX_COLS)
            .eq('company_id', t.company_id).eq('target_id', t.id).eq('family', FAMILY).eq('direction', 'OUT')
            .eq('status', 'failed').lte('next_attempt_at', new Date().toISOString())
            .order('next_attempt_at').limit(100);
        if (error) throw new Error(`outbox retries: ${error.message}`);
        const rows = (due ?? []) as OutboxRow[];
        if (rows.length) {
            const ids = rows.map((r) => r.document_id);
            const { data: assets } = await sb.from('assets').select('id, tag, hierarchy_level').eq('company_id', t.company_id).in('id', ids);
            const byId = new Map(((assets ?? []) as Pick<LinkAsset, 'id' | 'tag' | 'hierarchy_level'>[]).map((a) => [a.id, a]));
            const maps = await mapsFor(sb, t.company_id, ids);
            for (const r of rows) {
                const a = byId.get(r.document_id);
                if (!a) {
                    await sb.from('erp_outbox').update({ status: 'skipped', reason: 'The asset no longer exists in IREAMS.' }).eq('id', r.id);
                    bump(stats, 'out_skipped');
                    continue;
                }
                await deliver(sb, t, rule, headers, r, a, maps.get(a.id), stats);
                bump(stats, 'out_retried');
            }
        }
    }

    // 2. What changed since the watermark, parents first.
    let q = sb.from('assets').select(ASSET_COLS).eq('company_id', t.company_id).order('updated_at').limit(BATCH);
    if (wm) q = q.gt('updated_at', wm);
    const { data, error } = await q;
    if (error) throw new Error(`assets: ${error.message}`);
    const assets = sendOrder((data ?? []) as LinkAsset[]);
    if (assets.length === 0) return wm;

    const parentIds = assets.map((a) => a.parent_id).filter((p): p is string => !!p);
    const maps = await mapsFor(sb, t.company_id, [...new Set([...assets.map((a) => a.id), ...parentIds])]);
    const sentThisRun = new Map<string, ParentRef>();

    for (const a of assets) {
        processed.push(a.updated_at);
        const map = maps.get(a.id);
        const pm = a.parent_id ? maps.get(a.parent_id) : undefined;
        const parent: ParentRef | null = a.parent_id
            ? (sentThisRun.get(a.parent_id) ?? (pm?.external_type && pm.external_key ? { type: pm.external_type, key: pm.external_key } : null))
            : null;
        if (a.parent_id && !parent) bump(stats, 'out_parent_unlinked');
        const { type, doc } = buildDoc(a, map, parent);

        // Exactly-once, before the wire: this version already sent, or already live?
        const { data: existing } = await sb
            .from('erp_outbox')
            .select(OUTBOX_COLS)
            .eq('target_id', t.id).eq('family', FAMILY).eq('document_id', a.id).eq('document_version', a.updated_at)
            .in('status', ['sent', 'pending', 'failed', 'conflict']);
        const rows = (existing ?? []) as OutboxRow[];
        if (rows.some((r) => r.status === 'sent')) { bump(stats, 'out_already_sent'); continue; }
        let row = rows.find((r) => r.status === 'pending') ?? null;
        if (!row && rows.some((r) => r.status === 'failed' || r.status === 'conflict')) { bump(stats, 'out_waiting'); continue; }

        if (!row) {
            const { data: ins, error: insErr } = await sb.from('erp_outbox').insert({
                company_id: t.company_id, target_id: t.id, family: FAMILY, direction: 'OUT',
                document_type: type === 'EQUI' ? 'equipment' : 'functional_location',
                document_id: a.id, document_version: a.updated_at, document_key: a.tag,
                status: 'pending', payload: doc,
            }).select(OUTBOX_COLS).single();
            if (insErr) {
                if (insErr.code === '23505') { bump(stats, 'out_raced'); continue; }
                throw new Error(`outbox insert: ${insErr.message}`);
            }
            row = ins as OutboxRow;
        }
        bump(stats, 'out_queued');

        if (dryRun) {
            await sb.from('erp_outbox').update({ status: 'dry_run', response: { note: 'Dry run — nothing was sent. This is the document SAP would receive.' } }).eq('id', row.id);
            bump(stats, 'out_dry_run');
            if (map?.external_type && map.external_key) sentThisRun.set(a.id, { type: map.external_type, key: map.external_key });
            continue;
        }

        const sent = await deliver(sb, t, rule, headers, row, a, map, stats);
        if (sent) sentThisRun.set(a.id, sent);
    }
    return advanceWatermark(wm, processed);
}

// ── Inbound: SAP → IREAMS ────────────────────────────────────────────────────

async function assetById(sb: SupabaseClient, companyId: string, id: string): Promise<LinkAsset | null> {
    const { data } = await sb.from('assets').select(ASSET_COLS).eq('company_id', companyId).eq('id', id).maybeSingle();
    return (data as LinkAsset | null) ?? null;
}

async function assetByTag(sb: SupabaseClient, companyId: string, tag: string): Promise<LinkAsset | null> {
    const { data } = await sb.from('assets').select(ASSET_COLS).eq('company_id', companyId).eq('tag', tag).maybeSingle();
    return (data as LinkAsset | null) ?? null;
}

/** The IREAMS parent of an incoming entity, through the map of the parent it names. */
async function parentOf(sb: SupabaseClient, companyId: string, entity: Json): Promise<{ id: string; level: string } | null> {
    const candidates: [SapObjectType, unknown][] = [
        ['IFLOT', entity.SuperiorFunctionalLocation], ['EQUI', entity.SuperordinateEquipment], ['IFLOT', entity.FunctionalLocation],
    ];
    for (const [type, key] of candidates) {
        if (typeof key !== 'string' || !key) continue;
        const m = await mapByExternal(sb, companyId, type, key);
        if (!m) continue;
        const a = await assetById(sb, companyId, m.entity_id);
        if (a) return { id: a.id, level: a.hierarchy_level };
    }
    return null;
}

async function inbound(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, dryRun: boolean, stats: Stats): Promise<string | null> {
    const wm = watermarkOf(t.watermarks, FAMILY, 'in');
    const processed: string[] = [];

    for (const set of ['A_FunctionalLocation', 'A_Equipment'] as const) {
        const type: SapObjectType = set === 'A_Equipment' ? 'EQUI' : 'IFLOT';
        const docType = type === 'EQUI' ? 'equipment' : 'functional_location';
        const reply = await call(headers, 'GET', setUrl(t.base_url, set, {
            $filter: sinceFilter('LastChangeDateTime', wm), $orderby: 'LastChangeDateTime asc', $top: BATCH,
        }));
        if (!reply.ok) throw new Error(`inbound ${set}: HTTP ${reply.status} ${reply.text.slice(0, 200)}`);
        const entities = (Array.isArray(reply.body?.value) ? reply.body!.value : []) as Json[];

        for (const e of entities) {
            const key = String(e[KEY_PROPERTY[set]] ?? '');
            const changedAt = typeof e.LastChangeDateTime === 'string' ? e.LastChangeDateTime : new Date().toISOString();
            processed.push(changedAt);
            if (!key) { bump(stats, 'in_no_key'); continue; }
            const etag = bodyEtag(e);
            const map = await mapByExternal(sb, t.company_id, type, key);

            // Our own write coming back: same ETag we recorded. Nothing to do.
            if (map?.etag && etag && map.etag === etag) { bump(stats, 'in_echo'); continue; }

            const patch: AssetPatch = type === 'EQUI' ? fromEquipment(e) : fromFunctionalLocation(e);
            const rowBase = {
                company_id: t.company_id, target_id: t.id, family: FAMILY, direction: 'IN',
                document_type: docType, document_version: changedAt, document_key: key,
                payload: e, external_key: key, etag,
            };

            if (map) {
                const asset = await assetById(sb, t.company_id, map.entity_id);
                if (!asset) { bump(stats, 'in_orphan_map'); continue; }
                const diff = patchDiff(asset, patch);
                const localChanged = !!map.last_synced_at && asset.updated_at > map.last_synced_at;
                const decision = resolveInbound(rule.owner, localChanged && Object.keys(diff).length > 0, Object.keys(diff));

                if (dryRun) {
                    await sb.from('erp_outbox').insert({ ...rowBase, document_id: asset.id, status: 'dry_run', reason: decision.reason ?? (Object.keys(diff).length ? `Would change ${Object.keys(diff).join(', ')} on ${asset.tag}.` : `No difference on ${asset.tag}.`) });
                    bump(stats, 'in_dry_run');
                    continue;
                }
                if (decision.apply === 'remote' && Object.keys(diff).length > 0) {
                    const { error } = await sb.from('assets').update(diff).eq('company_id', t.company_id).eq('id', asset.id);
                    if (error) throw new Error(`assets update ${asset.tag}: ${error.message}`);
                    bump(stats, 'in_applied');
                } else if (decision.apply === 'remote') {
                    bump(stats, 'in_unchanged');
                }
                await upsertMap(sb, t, rule, asset.id, type, key, etag, 'IN');
                const { error: obErr } = await sb.from('erp_outbox').insert({
                    ...rowBase, document_id: asset.id,
                    status: decision.queue ? 'conflict' : 'sent', sent_at: decision.queue ? null : new Date().toISOString(),
                    reason: decision.reason,
                });
                if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
                if (decision.queue) bump(stats, 'in_conflict');
                if (decision.resend) {
                    // The owner re-asserts itself: queue IREAMS's version as a new outbound version.
                    const parentMap = asset.parent_id ? (await mapsFor(sb, t.company_id, [asset.parent_id])).get(asset.parent_id) : undefined;
                    const parent: ParentRef | null = parentMap?.external_type && parentMap.external_key ? { type: parentMap.external_type, key: parentMap.external_key } : null;
                    const { doc } = buildDoc(asset, map, parent);
                    const { error: rsErr } = await sb.from('erp_outbox').insert({
                        company_id: t.company_id, target_id: t.id, family: FAMILY, direction: 'OUT', document_type: docType,
                        document_id: asset.id, document_version: new Date().toISOString(), document_key: asset.tag, status: 'pending', payload: doc,
                        reason: `Re-sent: IREAMS owns master data and SAP changed ${changedFields(asset, { ...asset, ...patch }).join(', ') || 'the record'}.`,
                    });
                    if (rsErr && rsErr.code !== '23505') throw new Error(`outbox resend: ${rsErr.message}`);
                    bump(stats, 'out_resend_queued');
                }
                continue;
            }

            // Never seen: adopt an unmapped asset with the same tag, else create one.
            const parent = await parentOf(sb, t.company_id, e);
            const draft = type === 'EQUI'
                ? newAssetFromEquipment({ ...(e as Json), Equipment: key } as Parameters<typeof newAssetFromEquipment>[0], parent)
                : newAssetFromFunctionalLocation({ ...(e as Json), FunctionalLocation: key } as Parameters<typeof newAssetFromFunctionalLocation>[0], parent);
            const existing = await assetByTag(sb, t.company_id, draft.tag);

            if (dryRun) {
                await sb.from('erp_outbox').insert({ ...rowBase, document_id: existing?.id ?? '00000000-0000-0000-0000-000000000000', status: 'dry_run', reason: existing ? `Would link SAP ${key} to existing asset ${existing.tag}.` : `Would create ${draft.hierarchy_level} ${draft.tag} (${draft.name}).` });
                bump(stats, 'in_dry_run');
                continue;
            }

            let assetId: string;
            if (existing) {
                const diff = patchDiff(existing, patch);
                if (Object.keys(diff).length) {
                    const { error } = await sb.from('assets').update(diff).eq('company_id', t.company_id).eq('id', existing.id);
                    if (error) throw new Error(`assets adopt ${existing.tag}: ${error.message}`);
                }
                assetId = existing.id;
                bump(stats, 'in_adopted');
            } else {
                const { data: created, error } = await sb.from('assets')
                    .insert({ ...draft, company_id: t.company_id })
                    .select('id').single();
                if (error) throw new Error(`assets insert ${draft.tag}: ${error.message}`);
                assetId = (created as { id: string }).id;
                bump(stats, 'in_created');
            }
            await upsertMap(sb, t, rule, assetId, type, key, etag, 'IN');
            const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: assetId, status: 'sent', sent_at: new Date().toISOString() });
            if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
        }
    }
    return advanceWatermark(wm, processed);
}

// ── One target ───────────────────────────────────────────────────────────────

interface Report { target_id: string; name: string; run_id: string | null; status: 'done' | 'failed' | 'busy' | 'skipped'; dry_run: boolean; stats: Stats; error: string | null }

async function testConnection(sb: SupabaseClient, t: Target): Promise<Report> {
    const stats: Stats = {};
    let error: string | null = null;
    try {
        const headers = await targetHeaders(t);
        const r = await call(headers, 'GET', setUrl(t.base_url, 'A_Equipment', { $top: 1 }));
        stats.http_status = r.status;
        stats.equipment_seen = Array.isArray(r.body?.value) ? (r.body!.value as unknown[]).length : 0;
        if (!r.ok) error = `HTTP ${r.status}: ${(r.body?.error as Json | undefined)?.message ?? r.text.slice(0, 200) ?? 'no body'}`;
    } catch (e) { error = errText(e); }
    await sb.from('erp_targets').update({ last_status: error ? 'test failed' : 'test ok', last_error: error }).eq('id', t.id);
    return { target_id: t.id, name: t.name, run_id: null, status: error ? 'failed' : 'done', dry_run: true, stats, error };
}

async function runTarget(sb: SupabaseClient, t: Target, mode: Mode, direction: Direction, worker: string): Promise<Report> {
    if (mode === 'test') return testConnection(sb, t);
    const dryRun = mode === 'dry_run' || t.dry_run;
    const stats: Stats = {};

    const { data: runId, error: claimErr } = await sb.rpc('erp_claim_run', { p_target: t.id, p_direction: direction, p_worker: worker, p_lease: '00:10:00' });
    if (claimErr) return { target_id: t.id, name: t.name, run_id: null, status: 'failed', dry_run: dryRun, stats, error: `claim: ${claimErr.message}` };
    if (!runId) return { target_id: t.id, name: t.name, run_id: null, status: 'busy', dry_run: dryRun, stats, error: 'Another run holds this target.' };

    let error: string | null = null;
    try {
        const headers = await targetHeaders(t);
        const rule = t.families?.master_data;
        let w: Watermarks = t.watermarks ?? {};
        if (rule && (direction === 'OUT' || direction === 'BOTH') && flows(rule, 'out')) {
            w = withWatermark(w, FAMILY, 'out', await outbound(sb, t, rule, headers, dryRun, stats));
        }
        if (rule && (direction === 'IN' || direction === 'BOTH') && flows(rule, 'in')) {
            w = withWatermark(w, FAMILY, 'in', await inbound(sb, t, rule, headers, dryRun, stats));
        }
        // Watermarks move only after the rows above are committed (they are —
        // every write was its own statement), and never on a dry run.
        if (!dryRun) {
            const { error: wErr } = await sb.from('erp_targets').update({ watermarks: w }).eq('id', t.id);
            if (wErr) throw new Error(`watermarks: ${wErr.message}`);
        }
    } catch (e) {
        error = errText(e);
    }
    await sb.rpc('erp_finish_run', { p_run: runId, p_status: error ? 'failed' : 'done', p_stats: { ...stats, dry_run: dryRun ? 1 : 0 }, p_error: error });
    return { target_id: t.id, name: t.name, run_id: runId as string, status: error ? 'failed' : 'done', dry_run: dryRun, stats, error };
}

/** Demo helpers against the simulator only: change or wipe "what SAP has" from the Integrations screen. */
async function simControl(t: Target, mode: 'sim_edit' | 'sim_reset', edit: { set?: string; key?: string; changes?: Json } | undefined): Promise<Report> {
    const stats: Stats = {};
    let error: string | null = null;
    try {
        if (t.system !== 'sap_sim') throw new Error('Only a simulator target can be edited from here.');
        const headers = await targetHeaders(t);
        if (mode === 'sim_reset') {
            const r = await call(headers, 'POST', `${t.base_url.replace(/\/+$/, '')}/__reset`, {});
            stats.http_status = r.status;
            if (!r.ok) error = `HTTP ${r.status}`;
            else stats.deleted = Number(r.body?.deleted ?? 0);
        } else {
            const set = edit?.set as EntitySet | undefined;
            if (!set || !edit?.key || !edit.changes) throw new Error('edit needs set, key and changes.');
            const cur = await call(headers, 'GET', keyUrl(t.base_url, set, edit.key));
            if (!cur.ok) throw new Error(`HTTP ${cur.status}: ${set} ${edit.key} not found in the simulator.`);
            const r = await call(headers, 'PATCH', keyUrl(t.base_url, set, edit.key), edit.changes, cur.etag ?? '*');
            stats.http_status = r.status;
            if (!r.ok) error = `HTTP ${r.status}: ${r.text.slice(0, 200)}`;
        }
    } catch (e) { error = errText(e); }
    return { target_id: t.id, name: t.name, run_id: null, status: error ? 'failed' : 'done', dry_run: false, stats, error };
}

// ── Entry ────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
    const cors = corsFor(req);
    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const CRON_KEY = Deno.env.get('BRIEFING_CRON_KEY') ?? '';
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    let body: { target_id?: string; mode?: Mode; direction?: Direction; edit?: { set?: string; key?: string; changes?: Json } } = {};
    try { body = await req.json(); } catch { /* cron sends {} or nothing */ }
    const mode: Mode = body.mode ?? 'sync';
    const direction: Direction = body.direction ?? 'BOTH';

    // Who is asking: the clock, or an administrator of one tenant.
    let scopeCompany: string | null = null;
    let worker = 'cron';
    const cronKey = req.headers.get('x-cron-key');
    if (cronKey && CRON_KEY && cronKey === CRON_KEY) {
        if (mode !== 'sync') return json({ error: 'The scheduler only syncs.' }, 400);
    } else {
        const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
        if (!jwt) return json({ error: 'Unauthorized' }, 401);
        const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
        const { data: u, error: uErr } = await asUser.auth.getUser();
        if (uErr || !u?.user) return json({ error: 'Unauthorized' }, 401);
        const { data: isAdmin } = await asUser.rpc('is_admin');
        if (!isAdmin) return json({ error: 'Administrators only.' }, 403);
        scopeCompany = (u.user.app_metadata?.company_id as string | undefined) ?? null;
        if (!scopeCompany) return json({ error: 'Your login has no tenant claim.' }, 403);
        worker = `user:${u.user.id}`;
    }

    let q = sb.from('erp_targets').select('id, company_id, name, system, base_url, auth, families, poll_interval_minutes, dry_run, is_active, watermarks, last_run_at');
    if (scopeCompany) q = q.eq('company_id', scopeCompany);
    if (body.target_id) q = q.eq('id', body.target_id);
    else q = q.eq('is_active', true);
    const { data: targets, error: tErr } = await q.order('created_at');
    if (tErr) return json({ error: tErr.message }, 500);

    const now = Date.now();
    const reports: Report[] = [];
    for (const t of (targets ?? []) as Target[]) {
        // The clock only runs a target when its own interval has passed; a person's click always runs.
        if (!scopeCompany && t.last_run_at && now - new Date(t.last_run_at).getTime() < t.poll_interval_minutes * 60_000) {
            reports.push({ target_id: t.id, name: t.name, run_id: null, status: 'skipped', dry_run: t.dry_run, stats: {}, error: null });
            continue;
        }
        if (mode === 'sim_edit' || mode === 'sim_reset') reports.push(await simControl(t, mode, body.edit));
        else reports.push(await runTarget(sb, t, mode, direction, worker));
    }
    return json({ ok: true, mode, targets: reports });
});
