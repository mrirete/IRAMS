// Supabase Edge Function: erp-sync
// ────────────────────────────────────────────────────────────────────────────
// The live-link worker (docs/SAP-Live-Link-Plan.md §2). Once per tick, or on
// demand from Admin › Integrations, it takes the lease on each due target
// (erp_claim_run, 0383), sends what changed in IREAMS since the outbound
// watermark, pulls what changed in SAP since the inbound watermark, applies
// the family's ownership rule where both sides moved, records every document
// verbatim in erp_outbox, and advances the watermarks only after the run's
// rows are committed.
//
// Families carried: master data (functional locations, equipment — phase 1)
// and condition (measuring points, measurement documents — phase 2). Each is
// a module below over one generic send path; the others join on the same
// spine.
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
    backoffMinutes, changedFields, entitySetOf, flows, fromEquipment, fromFunctionalLocation,
    newAssetFromEquipment, newAssetFromFunctionalLocation, objectTypeOf, patchDiff, resolveInbound, resolveStaleSend,
    sendOrder, settleWatermark, toEquipmentDoc, toFunctionalLocationDoc, watermarkOf, withWatermark,
    type AssetPatch, type Families, type FamilyRule, type Family, type LinkAsset, type Owner, type ParentRef, type SapObjectType, type Watermarks,
} from './lib/masterData.ts';
import {
    fromMeasurementDocument, fromMeasuringPoint, newPointFromMeasuringPoint, pointDiff, pointOwner, readingGoesOut,
    toMeasurementDocumentDoc, toMeasuringPointDoc, type LinkPoint, type LinkReading,
} from './lib/condition.ts';
import {
    newWorkOrderFromOrder, objectRefOf, orderPatch, requestGoesOut, toNotificationDoc, workOrderDiff,
    type LinkRequest, type OrderDoc,
} from './lib/work.ts';

type Json = Record<string, unknown>;
type Mode = 'sync' | 'dry_run' | 'test' | 'sim_edit' | 'sim_reset';
type Direction = 'OUT' | 'IN' | 'BOTH';

interface TargetAuth { mode?: 'none' | 'basic' | 'bearer' | 'oauth2_client_credentials'; secret_name?: string; token_url?: string; client_id?: string; username?: string }
interface Target {
    id: string; company_id: string; name: string; system: string; base_url: string;
    auth: TargetAuth; families: Families; poll_interval_minutes: number;
    dry_run: boolean; is_active: boolean; watermarks: Watermarks | null; last_run_at: string | null;
}
/** External object types the link maps: SAP's own table names, so a planner recognises them. */
type ExternalType = SapObjectType | 'IMPT' | 'IMRG' | 'QMEL' | 'AUFK';
type EntityType = 'asset' | 'reading_definition' | 'reading_log' | 'request' | 'work_order';
interface MapRow { id: string; entity_id: string; external_key: string; external_type: ExternalType | null; etag: string | null; last_synced_at: string | null }
interface Stats { [k: string]: number }

const ASSET_COLS = 'id, tag, name, hierarchy_level, parent_id, equipment_number, manufacturer, model, serial_number, criticality, status_code, updated_at';
const POINT_COLS = 'id, asset_id, reading_type_code, name, unit, category, min_critical, min_warning, max_warning, max_critical, is_active, source_system, source_ref, updated_at';
const READING_COLS = 'id, definition_id, asset_id, reading_type_code, reading_date, reading_time, reading_value, entered_by, comments, valuation_code, source_system, source_ref, created_at';
const OUTBOX_COLS = 'id, status, family, document_type, document_id, document_version, payload, attempts, next_attempt_at, external_key, etag';
const BATCH = 500;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 1000);
/** Timestamps arrive with varying fraction lengths and offsets; compare instants, never strings. */
const instant = (ts: string | null | undefined): number => (ts ? new Date(ts).getTime() : Number.NEGATIVE_INFINITY);
const bump = (s: Stats, k: string, n = 1) => { s[k] = (s[k] ?? 0) + n; };
const nowIso = () => new Date().toISOString();

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

/** One page of a collection changed since the watermark, oldest first. */
async function changedSince(headers: Record<string, string>, t: Target, set: EntitySet, since: string | null): Promise<Json[]> {
    const reply = await call(headers, 'GET', setUrl(t.base_url, set, {
        $filter: sinceFilter('LastChangeDateTime', since), $orderby: 'LastChangeDateTime asc', $top: BATCH,
    }));
    if (!reply.ok) throw new Error(`inbound ${set}: HTTP ${reply.status} ${reply.text.slice(0, 200)}`);
    return (Array.isArray(reply.body?.value) ? reply.body!.value : []) as Json[];
}

// ── Maps ─────────────────────────────────────────────────────────────────────

async function mapsFor(sb: SupabaseClient, companyId: string, entityType: EntityType, ids: string[]): Promise<Map<string, MapRow>> {
    const out = new Map<string, MapRow>();
    if (ids.length === 0) return out;
    const { data, error } = await sb
        .from('erp_object_map')
        .select('id, entity_id, external_key, external_type, etag, last_synced_at')
        .eq('company_id', companyId).eq('system', 'SAP').eq('entity_type', entityType).eq('active', true)
        .in('entity_id', [...new Set(ids)]);
    if (error) throw new Error(`erp_object_map: ${error.message}`);
    for (const m of (data ?? []) as MapRow[]) out.set(m.entity_id, m);
    return out;
}

async function mapByExternal(sb: SupabaseClient, companyId: string, entityType: EntityType, type: ExternalType, key: string): Promise<MapRow | null> {
    const { data, error } = await sb
        .from('erp_object_map')
        .select('id, entity_id, external_key, external_type, etag, last_synced_at')
        .eq('company_id', companyId).eq('system', 'SAP').eq('entity_type', entityType).eq('active', true)
        .eq('external_type', type).eq('external_key', key)
        .maybeSingle();
    if (error) throw new Error(`erp_object_map: ${error.message}`);
    return (data as MapRow | null) ?? null;
}

async function upsertMap(sb: SupabaseClient, t: Target, owner: Owner, entityType: EntityType, entityId: string, type: ExternalType, key: string, etag: string | null, direction: 'IN' | 'OUT'): Promise<void> {
    const { error } = await sb.from('erp_object_map').upsert({
        company_id: t.company_id, system: 'SAP', entity_type: entityType, entity_id: entityId,
        external_key: key, external_type: type, etag,
        ownership: owner === 'sap' ? 'EXTERNAL' : 'LOCAL',
        last_synced_at: nowIso(), last_direction: direction, last_error: null, active: true,
    }, { onConflict: 'company_id,system,entity_type,entity_id' });
    if (error) throw new Error(`erp_object_map upsert: ${error.message}`);
}

const refOf = (m: MapRow | undefined | null): ParentRef | null =>
    m?.external_type && (m.external_type === 'EQUI' || m.external_type === 'IFLOT') && m.external_key ? { type: m.external_type, key: m.external_key } : null;

// ── The generic send path ────────────────────────────────────────────────────

interface OutboxRow { id: string; status: string; family: Family; document_type: string; document_id: string; document_version: string; payload: Json; attempts: number; next_attempt_at: string | null; external_key: string | null; etag: string | null }

/** What the send path needs to know about the record behind an outbox row. */
interface SendSpec {
    set: EntitySet;
    entityType: EntityType;
    externalType: ExternalType;
    entityId: string;
    label: string;                 // what a person calls it: the tag, the point name
    map: MapRow | undefined;       // existing mapping → PATCH; none → POST
    createOnly?: boolean;          // documents: never PATCH, once created they are done
}

/** Exactly-once, before the wire. Returns the live row to send, or null when this version is done or waiting. */
async function liveRow(sb: SupabaseClient, t: Target, family: Family, docType: string, docId: string, version: string, key: string, payload: Json, stats: Stats): Promise<OutboxRow | null> {
    const { data: existing } = await sb
        .from('erp_outbox').select(OUTBOX_COLS)
        .eq('target_id', t.id).eq('family', family).eq('document_id', docId).eq('document_version', version)
        .in('status', ['sent', 'pending', 'failed', 'conflict']);
    const rows = (existing ?? []) as OutboxRow[];
    if (rows.some((r) => r.status === 'sent')) { bump(stats, 'out_already_sent'); return null; }
    const pending = rows.find((r) => r.status === 'pending');
    if (pending) return pending;
    if (rows.length) { bump(stats, 'out_waiting'); return null; }
    const { data: ins, error } = await sb.from('erp_outbox').insert({
        company_id: t.company_id, target_id: t.id, family, direction: 'OUT',
        document_type: docType, document_id: docId, document_version: version, document_key: key,
        status: 'pending', payload,
    }).select(OUTBOX_COLS).single();
    if (error) {
        if (error.code === '23505') { bump(stats, 'out_raced'); return null; }
        throw new Error(`outbox insert: ${error.message}`);
    }
    bump(stats, 'out_queued');
    return ins as OutboxRow;
}

async function markDryRun(sb: SupabaseClient, row: OutboxRow, stats: Stats): Promise<void> {
    await sb.from('erp_outbox').update({ status: 'dry_run', response: { note: 'Dry run — nothing was sent. This is the document SAP would receive.' } }).eq('id', row.id);
    bump(stats, 'out_dry_run');
}

/** Send one outbox row and record the outcome. Returns the SAP key when SAP accepted it. */
async function send(sb: SupabaseClient, t: Target, owner: Owner, headers: Record<string, string>, row: OutboxRow, spec: SendSpec, stats: Stats): Promise<string | null> {
    const keyProp = KEY_PROPERTY[spec.set];
    const body: Json = { ...row.payload };
    const existingKey = spec.createOnly ? null : (spec.map?.external_key ?? null);
    let reply: Reply;
    try {
        if (existingKey) {
            delete body[keyProp];
            // A person retrying a conflict row sets its etag to '*': send
            // IREAMS's version over whatever SAP has now.
            reply = await call(headers, 'PATCH', keyUrl(t.base_url, spec.set, existingKey), body, row.etag === '*' ? '*' : (spec.map?.etag ?? '*'));
            if (reply.status === 412) {
                if (resolveStaleSend(owner) === 'force') {
                    const fresh = await call(headers, 'GET', keyUrl(t.base_url, spec.set, existingKey));
                    reply = fresh.ok && fresh.etag
                        ? await call(headers, 'PATCH', keyUrl(t.base_url, spec.set, existingKey), body, fresh.etag)
                        : fresh;
                } else {
                    await sb.from('erp_outbox').update({
                        status: 'conflict', http_status: 412, response: reply.body, attempts: row.attempts + 1,
                        reason: `SAP changed ${spec.label} since the last sync, and SAP owns this family. Review it in SAP; Retry sends IREAMS's version over it.`,
                    }).eq('id', row.id);
                    bump(stats, 'out_conflict');
                    return null;
                }
            }
        } else {
            reply = await call(headers, 'POST', setUrl(t.base_url, spec.set), body);
        }
    } catch (e) {
        reply = { status: 0, ok: false, body: null, etag: null, text: errText(e) };
    }

    if (reply.ok) {
        const key = String(reply.body?.[keyProp] ?? existingKey ?? body[keyProp] ?? '');
        const { error } = await sb.from('erp_outbox').update({
            status: 'sent', sent_at: nowIso(), http_status: reply.status, response: reply.body,
            external_key: key || null, etag: reply.etag, attempts: row.attempts + 1, error: null, next_attempt_at: null,
        }).eq('id', row.id);
        if (error) {
            // 23505 here means another run recorded this version as sent while
            // we were on the wire: the index did its job; this row is retired.
            await sb.from('erp_outbox').update({ status: 'skipped', reason: 'Recorded as sent by a concurrent run.', attempts: row.attempts + 1 }).eq('id', row.id);
            bump(stats, 'out_duplicate_prevented');
            return null;
        }
        if (key) await upsertMap(sb, t, owner, spec.entityType, spec.entityId, spec.externalType, key, reply.etag, 'OUT');
        bump(stats, 'out_sent');
        return key || null;
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

/** Rebuild the send spec for a queued row from the record it points at, or null when the record is gone. */
async function specFor(sb: SupabaseClient, t: Target, row: OutboxRow): Promise<SendSpec | null> {
    const co = t.company_id;
    switch (row.document_type) {
        case 'equipment': case 'functional_location': {
            const { data } = await sb.from('assets').select('id, tag, hierarchy_level').eq('company_id', co).eq('id', row.document_id).maybeSingle();
            if (!data) return null;
            const a = data as Pick<LinkAsset, 'id' | 'tag' | 'hierarchy_level'>;
            const type = objectTypeOf(a.hierarchy_level);
            return { set: entitySetOf(type), entityType: 'asset', externalType: type, entityId: a.id, label: a.tag, map: (await mapsFor(sb, co, 'asset', [a.id])).get(a.id) };
        }
        case 'measuring_point': {
            const { data } = await sb.from('reading_definitions').select('id, name').eq('company_id', co).eq('id', row.document_id).maybeSingle();
            if (!data) return null;
            const p = data as { id: string; name: string };
            return { set: 'A_MeasuringPoint', entityType: 'reading_definition', externalType: 'IMPT', entityId: p.id, label: p.name, map: (await mapsFor(sb, co, 'reading_definition', [p.id])).get(p.id) };
        }
        case 'measurement_document': {
            const { data } = await sb.from('reading_logs').select('id, reading_type_code').eq('company_id', co).eq('id', row.document_id).maybeSingle();
            if (!data) return null;
            const r = data as { id: string; reading_type_code: string };
            return { set: 'A_MeasurementDocument', entityType: 'reading_log', externalType: 'IMRG', entityId: r.id, label: `reading ${r.reading_type_code}`, map: undefined, createOnly: true };
        }
        case 'notification': {
            const { data } = await sb.from('service_requests').select('id, request_number').eq('company_id', co).eq('id', row.document_id).maybeSingle();
            if (!data) return null;
            const r = data as { id: string; request_number: string };
            return { set: 'A_MaintenanceNotification', entityType: 'request', externalType: 'QMEL', entityId: r.id, label: r.request_number, map: (await mapsFor(sb, co, 'request', [r.id])).get(r.id) };
        }
        default: return null;
    }
}

/** Failed rows whose back-off has elapsed, re-sent from their own payload. */
async function retryDue(sb: SupabaseClient, t: Target, family: Family, owner: Owner, headers: Record<string, string>, stats: Stats): Promise<void> {
    const { data: due, error } = await sb
        .from('erp_outbox').select(OUTBOX_COLS)
        .eq('company_id', t.company_id).eq('target_id', t.id).eq('family', family).eq('direction', 'OUT')
        .eq('status', 'failed').lte('next_attempt_at', nowIso())
        .order('next_attempt_at').limit(100);
    if (error) throw new Error(`outbox retries: ${error.message}`);
    for (const r of (due ?? []) as OutboxRow[]) {
        const spec = await specFor(sb, t, r);
        if (!spec) {
            await sb.from('erp_outbox').update({ status: 'skipped', reason: 'The record no longer exists in IREAMS.' }).eq('id', r.id);
            bump(stats, 'out_skipped');
            continue;
        }
        await send(sb, t, owner, headers, r, spec, stats);
        bump(stats, 'out_retried');
    }
}

// ── Master data: functional locations and equipment ──────────────────────────

async function assetById(sb: SupabaseClient, companyId: string, id: string): Promise<LinkAsset | null> {
    const { data } = await sb.from('assets').select(ASSET_COLS).eq('company_id', companyId).eq('id', id).maybeSingle();
    return (data as LinkAsset | null) ?? null;
}

async function assetByTag(sb: SupabaseClient, companyId: string, tag: string): Promise<LinkAsset | null> {
    const { data } = await sb.from('assets').select(ASSET_COLS).eq('company_id', companyId).eq('tag', tag).maybeSingle();
    return (data as LinkAsset | null) ?? null;
}

function assetDoc(a: LinkAsset, map: MapRow | undefined, parent: ParentRef | null): { type: SapObjectType; set: EntitySet; doc: Json } {
    const type = objectTypeOf(a.hierarchy_level);
    const doc = type === 'EQUI' ? toEquipmentDoc(a, map?.external_key ?? null, parent) : toFunctionalLocationDoc(a, map?.external_key ?? null, parent);
    return { type, set: entitySetOf(type), doc: doc as unknown as Json };
}

async function masterDataOut(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, dryRun: boolean, stats: Stats): Promise<string | null> {
    const wm = watermarkOf(t.watermarks, 'master_data', 'out');
    const processed: string[] = [];
    if (!dryRun) await retryDue(sb, t, 'master_data', rule.owner, headers, stats);

    let q = sb.from('assets').select(ASSET_COLS).eq('company_id', t.company_id).order('updated_at').limit(BATCH);
    if (wm) q = q.gt('updated_at', wm);
    const { data, error } = await q;
    if (error) throw new Error(`assets: ${error.message}`);
    const assets = sendOrder((data ?? []) as LinkAsset[]);
    if (assets.length === 0) return wm;

    const parentIds = assets.map((a) => a.parent_id).filter((p): p is string => !!p);
    const maps = await mapsFor(sb, t.company_id, 'asset', [...assets.map((a) => a.id), ...parentIds]);
    const sentThisRun = new Map<string, ParentRef>();

    for (const a of assets) {
        processed.push(a.updated_at);
        const map = maps.get(a.id);
        // Already in step: nothing changed here since the last exchange with
        // SAP in either direction (an inbound apply bumps updated_at, then
        // the map records the moment). Sending it back would only echo.
        if (map?.last_synced_at && instant(a.updated_at) <= instant(map.last_synced_at)) { bump(stats, 'out_in_sync'); continue; }
        const parent: ParentRef | null = a.parent_id ? (sentThisRun.get(a.parent_id) ?? refOf(a.parent_id ? maps.get(a.parent_id) : undefined)) : null;
        if (a.parent_id && !parent) bump(stats, 'out_parent_unlinked');
        const { type, set, doc } = assetDoc(a, map, parent);
        const row = await liveRow(sb, t, 'master_data', type === 'EQUI' ? 'equipment' : 'functional_location', a.id, a.updated_at, a.tag, doc, stats);
        if (!row) continue;
        if (dryRun) { await markDryRun(sb, row, stats); const r = refOf(map); if (r) sentThisRun.set(a.id, r); continue; }
        const key = await send(sb, t, rule.owner, headers, row, { set, entityType: 'asset', externalType: type, entityId: a.id, label: a.tag, map }, stats);
        if (key) sentThisRun.set(a.id, { type, key });
    }
    return settleWatermark(wm, processed, []);
}

/** The IREAMS parent of an incoming entity, through the map of the parent it names. */
async function parentOf(sb: SupabaseClient, companyId: string, entity: Json): Promise<{ id: string; level: string } | null> {
    const candidates: [SapObjectType, unknown][] = [
        ['IFLOT', entity.SuperiorFunctionalLocation], ['EQUI', entity.SuperordinateEquipment], ['IFLOT', entity.FunctionalLocation],
    ];
    for (const [type, key] of candidates) {
        if (typeof key !== 'string' || !key) continue;
        const m = await mapByExternal(sb, companyId, 'asset', type, key);
        if (!m) continue;
        const a = await assetById(sb, companyId, m.entity_id);
        if (a) return { id: a.id, level: a.hierarchy_level };
    }
    return null;
}

async function masterDataIn(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, dryRun: boolean, stats: Stats): Promise<string | null> {
    const wm = watermarkOf(t.watermarks, 'master_data', 'in');
    const processed: string[] = [];

    for (const set of ['A_FunctionalLocation', 'A_Equipment'] as const) {
        const type: SapObjectType = set === 'A_Equipment' ? 'EQUI' : 'IFLOT';
        const docType = type === 'EQUI' ? 'equipment' : 'functional_location';
        for (const e of await changedSince(headers, t, set, wm)) {
            const key = String(e[KEY_PROPERTY[set]] ?? '');
            const changedAt = typeof e.LastChangeDateTime === 'string' ? e.LastChangeDateTime : nowIso();
            processed.push(changedAt);
            if (!key) { bump(stats, 'in_no_key'); continue; }
            const etag = bodyEtag(e);
            const map = await mapByExternal(sb, t.company_id, 'asset', type, key);
            if (map?.etag && etag && map.etag === etag) { bump(stats, 'in_echo'); continue; }

            const patch: AssetPatch = type === 'EQUI' ? fromEquipment(e) : fromFunctionalLocation(e);
            const rowBase = {
                company_id: t.company_id, target_id: t.id, family: 'master_data', direction: 'IN',
                document_type: docType, document_version: changedAt, document_key: key, payload: e, external_key: key, etag,
            };

            if (map) {
                const asset = await assetById(sb, t.company_id, map.entity_id);
                if (!asset) { bump(stats, 'in_orphan_map'); continue; }
                const diff = patchDiff(asset, patch);
                const localChanged = !!map.last_synced_at && instant(asset.updated_at) > instant(map.last_synced_at);
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
                } else if (decision.apply === 'remote') bump(stats, 'in_unchanged');
                await upsertMap(sb, t, rule.owner, 'asset', asset.id, type, key, etag, 'IN');
                const { error: obErr } = await sb.from('erp_outbox').insert({
                    ...rowBase, document_id: asset.id,
                    status: decision.queue ? 'conflict' : 'sent', sent_at: decision.queue ? null : nowIso(), reason: decision.reason,
                });
                if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
                if (decision.queue) bump(stats, 'in_conflict');
                if (decision.resend) {
                    const parentMap = asset.parent_id ? (await mapsFor(sb, t.company_id, 'asset', [asset.parent_id])).get(asset.parent_id) : undefined;
                    const { doc } = assetDoc(asset, map, refOf(parentMap));
                    const { error: rsErr } = await sb.from('erp_outbox').insert({
                        company_id: t.company_id, target_id: t.id, family: 'master_data', direction: 'OUT', document_type: docType,
                        document_id: asset.id, document_version: nowIso(), document_key: asset.tag, status: 'pending', payload: doc,
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
                const { data: created, error } = await sb.from('assets').insert({ ...draft, company_id: t.company_id }).select('id').single();
                if (error) throw new Error(`assets insert ${draft.tag}: ${error.message}`);
                assetId = (created as { id: string }).id;
                bump(stats, 'in_created');
            }
            await upsertMap(sb, t, rule.owner, 'asset', assetId, type, key, etag, 'IN');
            const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: assetId, status: 'sent', sent_at: nowIso() });
            if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
        }
    }
    return settleWatermark(wm, processed, []);
}

// ── Condition: measuring points and measurement documents ────────────────────

async function pointById(sb: SupabaseClient, companyId: string, id: string): Promise<LinkPoint | null> {
    const { data } = await sb.from('reading_definitions').select(POINT_COLS).eq('company_id', companyId).eq('id', id).maybeSingle();
    return (data as LinkPoint | null) ?? null;
}

async function conditionOut(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, dryRun: boolean, stats: Stats): Promise<{ points: string | null; docs: string | null }> {
    const owner = pointOwner(rule.owner);
    if (!dryRun) await retryDue(sb, t, 'condition', owner, headers, stats);

    // 1. Points, by updated_at. A point whose asset is not in SAP yet is held
    //    (the watermark stays before it) until the asset has been sent.
    const wmP = watermarkOf(t.watermarks, 'condition', 'out');
    const processedP: string[] = []; const heldP: string[] = [];
    let q = sb.from('reading_definitions').select(POINT_COLS).eq('company_id', t.company_id).order('updated_at').limit(BATCH);
    if (wmP) q = q.gt('updated_at', wmP);
    const { data: pts, error: pErr } = await q;
    if (pErr) throw new Error(`reading_definitions: ${pErr.message}`);
    const points = (pts ?? []) as LinkPoint[];
    const pointMaps = await mapsFor(sb, t.company_id, 'reading_definition', points.map((p) => p.id));
    const assetMaps = await mapsFor(sb, t.company_id, 'asset', points.map((p) => p.asset_id));
    for (const p of points) {
        const map = pointMaps.get(p.id);
        if (map?.last_synced_at && instant(p.updated_at) <= instant(map.last_synced_at)) { processedP.push(p.updated_at); bump(stats, 'out_in_sync'); continue; }
        // A point SAP created is SAP's; it only goes back if IREAMS owns condition and changed it (handled as any mapped point).
        const object = refOf(assetMaps.get(p.asset_id));
        if (!object && !map) { heldP.push(p.updated_at); bump(stats, 'out_object_unlinked'); continue; }
        processedP.push(p.updated_at);
        const doc = toMeasuringPointDoc(p, map?.external_key ?? null, object) as unknown as Json;
        const row = await liveRow(sb, t, 'condition', 'measuring_point', p.id, p.updated_at, p.name, doc, stats);
        if (!row) continue;
        if (dryRun) { await markDryRun(sb, row, stats); continue; }
        await send(sb, t, owner, headers, row, { set: 'A_MeasuringPoint', entityType: 'reading_definition', externalType: 'IMPT', entityId: p.id, label: p.name, map }, stats);
    }

    // 2. Documents, by created_at: logged readings only, never SAP's own, and
    //    only once their point is in SAP (held otherwise).
    const wmD = watermarkOf(t.watermarks, 'condition', 'docs_out');
    const processedD: string[] = []; const heldD: string[] = [];
    let qd = sb.from('reading_logs').select(READING_COLS).eq('company_id', t.company_id).order('created_at').limit(BATCH);
    if (wmD) qd = qd.gt('created_at', wmD);
    const { data: rds, error: rErr } = await qd;
    if (rErr) throw new Error(`reading_logs: ${rErr.message}`);
    const readings = (rds ?? []) as LinkReading[];
    const readingMaps = await mapsFor(sb, t.company_id, 'reading_log', readings.map((r) => r.id));
    const pointMaps2 = await mapsFor(sb, t.company_id, 'reading_definition', readings.map((r) => r.definition_id));
    const units = new Map<string, string | null>();
    for (const r of readings) {
        if (!readingGoesOut(r)) { processedD.push(r.created_at); bump(stats, (r.source_system ?? '').toLowerCase().startsWith('sap') ? 'out_reading_from_sap' : 'out_reading_not_logged'); continue; }
        if (readingMaps.get(r.id)) { processedD.push(r.created_at); bump(stats, 'out_already_sent'); continue; }
        const pm = pointMaps2.get(r.definition_id);
        if (!pm) { heldD.push(r.created_at); bump(stats, 'out_point_unlinked'); continue; }
        processedD.push(r.created_at);
        if (!units.has(r.definition_id)) units.set(r.definition_id, (await pointById(sb, t.company_id, r.definition_id))?.unit ?? null);
        const doc = toMeasurementDocumentDoc(r, pm.external_key, units.get(r.definition_id) ?? null) as unknown as Json;
        const row = await liveRow(sb, t, 'condition', 'measurement_document', r.id, r.created_at, `${r.reading_type_code} ${r.reading_date}`, doc, stats);
        if (!row) continue;
        if (dryRun) { await markDryRun(sb, row, stats); continue; }
        await send(sb, t, owner, headers, row, { set: 'A_MeasurementDocument', entityType: 'reading_log', externalType: 'IMRG', entityId: r.id, label: `reading ${r.reading_type_code}`, map: undefined, createOnly: true }, stats);
    }
    return { points: settleWatermark(wmP, processedP, heldP), docs: settleWatermark(wmD, processedD, heldD) };
}

async function conditionIn(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, dryRun: boolean, stats: Stats): Promise<{ points: string | null; docs: string | null }> {
    const owner = pointOwner(rule.owner);

    // 1. Points
    const wmP = watermarkOf(t.watermarks, 'condition', 'in');
    const processedP: string[] = [];
    for (const e of await changedSince(headers, t, 'A_MeasuringPoint', wmP)) {
        const key = String(e.MeasuringPoint ?? '');
        const changedAt = typeof e.LastChangeDateTime === 'string' ? e.LastChangeDateTime : nowIso();
        processedP.push(changedAt);
        if (!key) { bump(stats, 'in_no_key'); continue; }
        const etag = bodyEtag(e);
        const map = await mapByExternal(sb, t.company_id, 'reading_definition', 'IMPT', key);
        if (map?.etag && etag && map.etag === etag) { bump(stats, 'in_echo'); continue; }
        const patch = fromMeasuringPoint(e);
        const rowBase = {
            company_id: t.company_id, target_id: t.id, family: 'condition', direction: 'IN',
            document_type: 'measuring_point', document_version: changedAt, document_key: key, payload: e, external_key: key, etag,
        };
        if (map) {
            const point = await pointById(sb, t.company_id, map.entity_id);
            if (!point) { bump(stats, 'in_orphan_map'); continue; }
            const diff = pointDiff(point, patch);
            const localChanged = !!map.last_synced_at && instant(point.updated_at) > instant(map.last_synced_at);
            const decision = resolveInbound(owner, localChanged && Object.keys(diff).length > 0, Object.keys(diff));
            if (dryRun) {
                await sb.from('erp_outbox').insert({ ...rowBase, document_id: point.id, status: 'dry_run', reason: decision.reason ?? (Object.keys(diff).length ? `Would change ${Object.keys(diff).join(', ')} on ${point.name}.` : `No difference on ${point.name}.`) });
                bump(stats, 'in_dry_run');
                continue;
            }
            if (decision.apply === 'remote' && Object.keys(diff).length > 0) {
                const { error } = await sb.from('reading_definitions').update(diff).eq('company_id', t.company_id).eq('id', point.id);
                if (error) throw new Error(`reading_definitions update ${point.name}: ${error.message}`);
                bump(stats, 'in_applied');
            } else if (decision.apply === 'remote') bump(stats, 'in_unchanged');
            await upsertMap(sb, t, owner, 'reading_definition', point.id, 'IMPT', key, etag, 'IN');
            const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: point.id, status: decision.queue ? 'conflict' : 'sent', sent_at: decision.queue ? null : nowIso(), reason: decision.reason?.replace('master data', 'condition data') ?? null });
            if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
            if (decision.queue) bump(stats, 'in_conflict');
            if (decision.resend) {
                const assetMap = (await mapsFor(sb, t.company_id, 'asset', [point.asset_id])).get(point.asset_id);
                const doc = toMeasuringPointDoc(point, map.external_key, refOf(assetMap)) as unknown as Json;
                const { error: rsErr } = await sb.from('erp_outbox').insert({
                    company_id: t.company_id, target_id: t.id, family: 'condition', direction: 'OUT', document_type: 'measuring_point',
                    document_id: point.id, document_version: nowIso(), document_key: point.name, status: 'pending', payload: doc,
                    reason: `Re-sent: IREAMS owns condition data and SAP changed ${Object.keys(diff).join(', ') || 'the point'}.`,
                });
                if (rsErr && rsErr.code !== '23505') throw new Error(`outbox resend: ${rsErr.message}`);
                bump(stats, 'out_resend_queued');
            }
            continue;
        }
        // A point first seen in SAP needs its technical object in IREAMS.
        const objType = e.MeasuringPointObjectType === 'IFLOT' ? 'IFLOT' : 'EQUI';
        const objKey = typeof e.MeasuringPointObject === 'string' ? e.MeasuringPointObject : '';
        const assetMap = objKey ? await mapByExternal(sb, t.company_id, 'asset', objType, objKey) : null;
        if (!assetMap) {
            if (!dryRun) {
                const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: '00000000-0000-0000-0000-000000000000', status: 'skipped', reason: `SAP measuring point ${key} hangs on ${objType} ${objKey || '(none)'}, which IREAMS does not know. Bring that object across first.` });
                if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
            }
            bump(stats, 'in_object_unknown');
            continue;
        }
        const draft = newPointFromMeasuringPoint({ ...(e as Json), MeasuringPoint: key } as Parameters<typeof newPointFromMeasuringPoint>[0], assetMap.entity_id);
        if (dryRun) {
            await sb.from('erp_outbox').insert({ ...rowBase, document_id: '00000000-0000-0000-0000-000000000000', status: 'dry_run', reason: `Would create reading point ${draft.reading_type_code} (${draft.name}).` });
            bump(stats, 'in_dry_run');
            continue;
        }
        // 0382 identity: a point already brought across by file is adopted, not doubled.
        const { error: upErr } = await sb.from('reading_definitions').upsert({ ...draft, company_id: t.company_id }, { onConflict: 'company_id,source_system,source_ref', ignoreDuplicates: true });
        if (upErr) throw new Error(`reading_definitions insert ${draft.reading_type_code}: ${upErr.message}`);
        const { data: got } = await sb.from('reading_definitions').select('id').eq('company_id', t.company_id).eq('source_system', 'sap_pm').eq('source_ref', key).maybeSingle();
        const pointId = (got as { id: string } | null)?.id;
        if (!pointId) throw new Error(`reading_definitions: point ${key} not found after insert`);
        await upsertMap(sb, t, owner, 'reading_definition', pointId, 'IMPT', key, etag, 'IN');
        const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: pointId, status: 'sent', sent_at: nowIso() });
        if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
        bump(stats, 'in_created');
    }

    // 2. Documents: immutable in SAP, so there is no conflict rule — only
    //    "already have it" (our own send echoed back, or a re-read) and "new".
    const wmD = watermarkOf(t.watermarks, 'condition', 'docs_in');
    const processedD: string[] = [];
    const pointsByKey = new Map<string, { id: string; asset_id: string; reading_type_code: string } | null>();
    for (const e of await changedSince(headers, t, 'A_MeasurementDocument', wmD)) {
        const key = String(e.MeasurementDocument ?? '');
        const changedAt = typeof e.LastChangeDateTime === 'string' ? e.LastChangeDateTime : nowIso();
        processedD.push(changedAt);
        if (!key) { bump(stats, 'in_no_key'); continue; }
        if (await mapByExternal(sb, t.company_id, 'reading_log', 'IMRG', key)) { bump(stats, 'in_echo'); continue; }
        const pointKey = String(e.MeasuringPoint ?? '');
        if (!pointsByKey.has(pointKey)) {
            const pm = pointKey ? await mapByExternal(sb, t.company_id, 'reading_definition', 'IMPT', pointKey) : null;
            const p = pm ? await pointById(sb, t.company_id, pm.entity_id) : null;
            pointsByKey.set(pointKey, p ? { id: p.id, asset_id: p.asset_id, reading_type_code: p.reading_type_code } : null);
        }
        const point = pointsByKey.get(pointKey) ?? null;
        const rowBase = {
            company_id: t.company_id, target_id: t.id, family: 'condition', direction: 'IN',
            document_type: 'measurement_document', document_version: changedAt, document_key: key, payload: e, external_key: key, etag: bodyEtag(e),
        };
        if (!point) {
            if (!dryRun) {
                const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: '00000000-0000-0000-0000-000000000000', status: 'skipped', reason: `SAP measurement document ${key} is on measuring point ${pointKey || '(none)'}, which IREAMS does not know.` });
                if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
            }
            bump(stats, 'in_point_unknown');
            continue;
        }
        const draft = fromMeasurementDocument({ ...(e as Json), MeasurementDocument: key } as Parameters<typeof fromMeasurementDocument>[0], point);
        if (!draft) { bump(stats, 'in_no_value'); continue; }
        if (dryRun) {
            await sb.from('erp_outbox').insert({ ...rowBase, document_id: point.id, status: 'dry_run', reason: `Would log ${draft.reading_value} on ${point.reading_type_code} at ${draft.reading_date} ${draft.reading_time}.` });
            bump(stats, 'in_dry_run');
            continue;
        }
        // 0381 identity: the same document twice inserts nothing.
        const { error: upErr } = await sb.from('reading_logs').upsert({ ...draft, company_id: t.company_id }, { onConflict: 'company_id,source_system,source_ref', ignoreDuplicates: true });
        if (upErr) throw new Error(`reading_logs insert ${key}: ${upErr.message}`);
        const { data: got } = await sb.from('reading_logs').select('id').eq('company_id', t.company_id).eq('source_system', 'sap_pm').eq('source_ref', key).maybeSingle();
        const readingId = (got as { id: string } | null)?.id;
        if (!readingId) throw new Error(`reading_logs: document ${key} not found after insert`);
        await upsertMap(sb, t, owner, 'reading_log', readingId, 'IMRG', key, bodyEtag(e), 'IN');
        const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: readingId, status: 'sent', sent_at: nowIso() });
        if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
        bump(stats, 'in_created');
    }
    return { points: settleWatermark(wmP, processedP, []), docs: settleWatermark(wmD, processedD, []) };
}

// ── Work: notifications out, orders and status in ────────────────────────────

const REQUEST_COLS = 'id, request_number, status, description, asset_id, requester_id, risk_score, is_breakdown, category, created_at, updated_at';

/** Who raised it, in the 12 characters SAP keeps: the login name, else nothing. */
async function reporterName(sb: SupabaseClient, companyId: string, userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const { data } = await sb.from('users').select('username, email').eq('company_id', companyId).eq('id', userId).maybeSingle();
    const u = data as { username: string | null; email: string | null } | null;
    return (u?.username || u?.email?.split('@')[0] || '').trim() || null;
}

async function workOut(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, dryRun: boolean, stats: Stats): Promise<string | null> {
    const wm = watermarkOf(t.watermarks, 'work', 'out');
    const processed: string[] = []; const held: string[] = [];
    if (!dryRun) await retryDue(sb, t, 'work', rule.owner, headers, stats);

    let q = sb.from('service_requests').select(REQUEST_COLS).eq('company_id', t.company_id).order('updated_at').limit(BATCH);
    if (wm) q = q.gt('updated_at', wm);
    const { data, error } = await q;
    if (error) throw new Error(`service_requests: ${error.message}`);
    const requests = (data ?? []) as LinkRequest[];
    const maps = await mapsFor(sb, t.company_id, 'request', requests.map((r) => r.id));
    const assetMaps = await mapsFor(sb, t.company_id, 'asset', requests.map((r) => r.asset_id));
    const names = new Map<string, string | null>();
    for (const r of requests) {
        if (!requestGoesOut(r)) { processed.push(r.updated_at); bump(stats, 'out_request_not_sent'); continue; }
        const map = maps.get(r.id);
        if (map?.last_synced_at && instant(r.updated_at) <= instant(map.last_synced_at)) { processed.push(r.updated_at); bump(stats, 'out_in_sync'); continue; }
        const object = refOf(assetMaps.get(r.asset_id));
        if (!object && !map) { held.push(r.updated_at); bump(stats, 'out_object_unlinked'); continue; }
        processed.push(r.updated_at);
        if (!names.has(r.requester_id ?? '')) names.set(r.requester_id ?? '', await reporterName(sb, t.company_id, r.requester_id));
        const doc = toNotificationDoc(r, map?.external_key ?? null, object, names.get(r.requester_id ?? '') ?? null) as unknown as Json;
        const row = await liveRow(sb, t, 'work', 'notification', r.id, r.updated_at, r.request_number, doc, stats);
        if (!row) continue;
        if (dryRun) { await markDryRun(sb, row, stats); continue; }
        await send(sb, t, rule.owner, headers, row, { set: 'A_MaintenanceNotification', entityType: 'request', externalType: 'QMEL', entityId: r.id, label: r.request_number, map }, stats);
    }
    return settleWatermark(wm, processed, held);
}

async function workIn(sb: SupabaseClient, t: Target, rule: FamilyRule, headers: Record<string, string>, dryRun: boolean, stats: Stats): Promise<string | null> {
    const wm = watermarkOf(t.watermarks, 'work', 'in');
    const processed: string[] = [];
    for (const e of await changedSince(headers, t, 'A_MaintenanceOrder', wm)) {
        const key = String(e.MaintenanceOrder ?? '');
        const changedAt = typeof e.LastChangeDateTime === 'string' ? e.LastChangeDateTime : nowIso();
        processed.push(changedAt);
        if (!key) { bump(stats, 'in_no_key'); continue; }
        const etag = bodyEtag(e);
        const order = e as unknown as OrderDoc;
        const map = await mapByExternal(sb, t.company_id, 'work_order', 'AUFK', key);
        if (map?.etag && etag && map.etag === etag) { bump(stats, 'in_echo'); continue; }
        const rowBase = {
            company_id: t.company_id, target_id: t.id, family: 'work', direction: 'IN',
            document_type: 'order', document_version: changedAt, document_key: key, payload: e, external_key: key, etag,
        };

        if (map) {
            const { data: cur } = await sb.from('work_orders').select('id, wo_number, title, status, priority_code, due_date, date_due_start, updated_at, properties').eq('company_id', t.company_id).eq('id', map.entity_id).maybeSingle();
            const wo = cur as { id: string; wo_number: string; status: string; updated_at: string; properties: Json | null } & Record<string, unknown> | null;
            if (!wo) { bump(stats, 'in_orphan_map'); continue; }
            const patch = orderPatch(order);
            const diff = workOrderDiff(wo, patch);
            const localChanged = !!map.last_synced_at && instant(wo.updated_at) > instant(map.last_synced_at);
            const decision = resolveInbound(rule.owner, localChanged && Object.keys(diff).length > 0, Object.keys(diff));
            if (dryRun) {
                await sb.from('erp_outbox').insert({ ...rowBase, document_id: wo.id, status: 'dry_run', reason: decision.reason ?? (Object.keys(diff).length ? `Would change ${Object.keys(diff).join(', ')} on ${wo.wo_number}.` : `No difference on ${wo.wo_number}.`) });
                bump(stats, 'in_dry_run');
                continue;
            }
            if (decision.apply === 'remote' && Object.keys(diff).length > 0) {
                const props = { ...(wo.properties ?? {}), sap_status: order.MaintenanceOrderStatus ?? null };
                const { error } = await sb.from('work_orders').update({ ...diff, properties: props }).eq('company_id', t.company_id).eq('id', wo.id);
                if (error) throw new Error(`work_orders update ${wo.wo_number}: ${error.message}`);
                bump(stats, 'in_applied');
                if (diff.status) bump(stats, 'in_status_moved');
            } else if (decision.apply === 'remote') bump(stats, 'in_unchanged');
            await upsertMap(sb, t, rule.owner, 'work_order', wo.id, 'AUFK', key, etag, 'IN');
            const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: wo.id, status: decision.queue ? 'conflict' : 'sent', sent_at: decision.queue ? null : nowIso(), reason: decision.reason?.replace('master data', 'work') ?? null });
            if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
            if (decision.queue) bump(stats, 'in_conflict');
            continue;
        }

        // A new order needs its technical object in IREAMS; its notification, if mapped, becomes the request link.
        const obj = objectRefOf(order);
        const assetMap = obj ? await mapByExternal(sb, t.company_id, 'asset', obj.type, obj.key) : null;
        if (!assetMap) {
            if (!dryRun) {
                const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: '00000000-0000-0000-0000-000000000000', status: 'skipped', reason: `SAP order ${key} is on ${obj ? `${obj.type} ${obj.key}` : 'no technical object'}, which IREAMS does not know. Bring that object across first.` });
                if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
            }
            bump(stats, 'in_object_unknown');
            continue;
        }
        const notif = (order.MaintenanceNotification ?? '').trim();
        const requestMap = notif ? await mapByExternal(sb, t.company_id, 'request', 'QMEL', notif) : null;
        if (dryRun) {
            await sb.from('erp_outbox').insert({ ...rowBase, document_id: '00000000-0000-0000-0000-000000000000', status: 'dry_run', reason: `Would create work order "${(order.MaintenanceOrderDesc ?? '').trim() || key}" (${order.MaintenanceOrderStatus ?? 'CRTD'}) on the mapped asset${requestMap ? ', linked to its request' : ''}.` });
            bump(stats, 'in_dry_run');
            continue;
        }
        const { data: num, error: numErr } = await sb.rpc('generate_wo_number');
        if (numErr || !num) throw new Error(`generate_wo_number: ${numErr?.message ?? 'no number'}`);
        const draft = newWorkOrderFromOrder(order, String(num), assetMap.entity_id, requestMap?.entity_id ?? null);
        const { data: created, error } = await sb.from('work_orders').insert({ ...draft, company_id: t.company_id }).select('id').single();
        if (error) throw new Error(`work_orders insert ${key}: ${error.message}`);
        const woId = (created as { id: string }).id;
        if (requestMap) {
            // The request became work — the same status the in-app conversion sets.
            await sb.from('service_requests').update({ status: 'CONVERTED' }).eq('company_id', t.company_id).eq('id', requestMap.entity_id).neq('status', 'CONVERTED');
        }
        await upsertMap(sb, t, rule.owner, 'work_order', woId, 'AUFK', key, etag, 'IN');
        const { error: obErr } = await sb.from('erp_outbox').insert({ ...rowBase, document_id: woId, status: 'sent', sent_at: nowIso() });
        if (obErr && obErr.code !== '23505') throw new Error(`outbox in: ${obErr.message}`);
        bump(stats, 'in_created');
    }
    return settleWatermark(wm, processed, []);
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
        const out = direction === 'OUT' || direction === 'BOTH';
        const inn = direction === 'IN' || direction === 'BOTH';
        let w: Watermarks = t.watermarks ?? {};
        const md = t.families?.master_data;
        if (md && out && flows(md, 'out')) w = withWatermark(w, 'master_data', 'out', await masterDataOut(sb, t, md, headers, dryRun, stats));
        if (md && inn && flows(md, 'in')) w = withWatermark(w, 'master_data', 'in', await masterDataIn(sb, t, md, headers, dryRun, stats));
        const cd = t.families?.condition;
        if (cd && out && flows(cd, 'out')) {
            const r = await conditionOut(sb, { ...t, watermarks: w }, cd, headers, dryRun, stats);
            w = withWatermark(withWatermark(w, 'condition', 'out', r.points), 'condition', 'docs_out', r.docs);
        }
        if (cd && inn && flows(cd, 'in')) {
            const r = await conditionIn(sb, { ...t, watermarks: w }, cd, headers, dryRun, stats);
            w = withWatermark(withWatermark(w, 'condition', 'in', r.points), 'condition', 'docs_in', r.docs);
        }
        const wk = t.families?.work;
        if (wk && out && flows(wk, 'out')) w = withWatermark(w, 'work', 'out', await workOut(sb, { ...t, watermarks: w }, wk, headers, dryRun, stats));
        if (wk && inn && flows(wk, 'in')) w = withWatermark(w, 'work', 'in', await workIn(sb, { ...t, watermarks: w }, wk, headers, dryRun, stats));
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
            if (!set || !edit?.changes) throw new Error('edit needs set and changes.');
            if (edit.key) {
                const cur = await call(headers, 'GET', keyUrl(t.base_url, set, edit.key));
                if (!cur.ok) throw new Error(`HTTP ${cur.status}: ${set} ${edit.key} not found in the simulator.`);
                const r = await call(headers, 'PATCH', keyUrl(t.base_url, set, edit.key), edit.changes, cur.etag ?? '*');
                stats.http_status = r.status;
                if (!r.ok) error = `HTTP ${r.status}: ${r.text.slice(0, 200)}`;
            } else {
                // No key: create "in SAP" (a planner adding a document or a point).
                const r = await call(headers, 'POST', setUrl(t.base_url, set), edit.changes);
                stats.http_status = r.status;
                if (!r.ok) error = `HTTP ${r.status}: ${r.text.slice(0, 200)}`;
                else stats.created = 1;
            }
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
        // The tenant claim lives in the JWT (custom access-token hook, 0258);
        // the user object getUser() returns does not carry it. Decode the
        // token we just validated rather than trust the profile.
        try {
            const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            scopeCompany = (payload?.app_metadata?.company_id as string | undefined) ?? null;
        } catch { scopeCompany = null; }
        scopeCompany = scopeCompany ?? (u.user.app_metadata?.company_id as string | undefined) ?? null;
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
