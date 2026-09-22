// Supabase Edge Function: sap-sim
// ────────────────────────────────────────────────────────────────────────────
// A small SAP S/4HANA PM simulator: the subset of OData V4 the live link uses
// (docs/SAP-Live-Link-Plan.md §2.5). It is not a SAP. It is enough SAP to
// prove the runtime, the conflict rule, the retry path and the exception
// queue, and it is what every demo runs against until a client sandbox
// exists. Nothing in erp-sync knows it is talking to this rather than an S/4;
// that is the point.
//
// What it implements
//   GET    /t/<company>/<Set>                 $filter (field op literal [and …]),
//                                             $top, $skip, $orderby=LastChangeDateTime [asc|desc]
//   GET    /t/<company>/<Set>('<key>')        200 + ETag, or 404
//   POST   /t/<company>/<Set>                 201 + ETag; number generated for
//                                             equipment/notification/order/document,
//                                             key required for functional location / measuring point;
//                                             409 if the key exists
//   PATCH  /t/<company>/<Set>('<key>')        If-Match required (428 without it),
//                                             412 when stale, 200 with the new ETag
//   DELETE /t/<company>/<Set>('<key>')        204
//   POST   /t/<company>/__reset               empties the tenant's simulator (demos)
//
// State lives in sap_sim_entities (0384), tenant-scoped by the <company> path
// segment. Auth is one bearer token per project, SAP_SIM_TOKEN, which the
// worker reads by name from the target's auth.secret_name — the same path a
// real credential takes, so the demo exercises the real code.
//
// Deploy: supabase functions deploy sap-sim --no-verify-jwt
//         supabase secrets set SAP_SIM_TOKEN=<long random string>
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
    KEY_PROPERTY, etagOf, etagMatches, isEntitySet, matchesFilter, parseFilter, parseKeyPath,
    type EntitySet,
} from './lib/odata.ts';

type Json = Record<string, unknown>;

interface Row {
    id: string;
    entity_set: EntitySet;
    entity_key: string;
    etag: number;
    payload: Json;
    last_change_datetime: string;
}

const odataError = (status: number, code: string, message: string, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: { code, message } }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'OData-Version': '4.0', ...extra },
    });

const render = (r: Row): Json => ({
    ...r.payload,
    [KEY_PROPERTY[r.entity_set]]: r.entity_key,
    LastChangeDateTime: new Date(r.last_change_datetime).toISOString(),
    '@odata.etag': etagOf(r.etag),
});

const entityResponse = (r: Row, status: number) =>
    new Response(JSON.stringify(render(r)), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'OData-Version': '4.0', ETag: etagOf(r.etag) },
    });

/** Sets whose numbers SAP assigns from a range; the rest are keyed by the caller. */
const GENERATED: Partial<Record<EntitySet, number>> = {
    A_Equipment: 10000000,
    A_MeasuringPoint: 1000,
    A_MeasurementDocument: 1,
    A_MaintenanceNotification: 10000000,
    A_MaintenanceOrder: 4000000,
};

/** The body's own fields, without OData annotations or the key (the key is the path). */
function cleanBody(set: EntitySet, body: Json): Json {
    const out: Json = {};
    for (const [k, v] of Object.entries(body)) {
        if (k.startsWith('@odata') || k === KEY_PROPERTY[set] || k === 'LastChangeDateTime') continue;
        out[k] = v;
    }
    return out;
}

async function nextNumber(sb: SupabaseClient, companyId: string, set: EntitySet): Promise<string> {
    const start = GENERATED[set] ?? 1;
    const { data } = await sb
        .from('sap_sim_entities')
        .select('entity_key')
        .eq('company_id', companyId)
        .eq('entity_set', set);
    let max = start - 1;
    for (const r of (data ?? []) as { entity_key: string }[]) {
        const n = Number(r.entity_key);
        if (Number.isFinite(n) && n > max) max = n;
    }
    return String(max + 1);
}

/** The path after the function name: `t/<company>/<rest…>`. */
function route(url: URL): { companyId: string; segment: string } | null {
    const parts = url.pathname.split('/').filter(Boolean);
    const t = parts.lastIndexOf('t');
    if (t < 0 || parts.length < t + 3) return null;
    const companyId = parts[t + 1];
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) return null;
    return { companyId, segment: parts.slice(t + 2).join('/') };
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const TOKEN = Deno.env.get('SAP_SIM_TOKEN') ?? '';
    if (!TOKEN) return odataError(503, 'NOT_CONFIGURED', 'SAP_SIM_TOKEN is not set on this project — the simulator refuses to run open.');
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${TOKEN}`) return odataError(401, 'UNAUTHORIZED', 'Bearer token missing or wrong.', { 'WWW-Authenticate': 'Bearer' });

    const url = new URL(req.url);
    const r = route(url);
    if (!r) return odataError(404, 'NOT_FOUND', 'Expected /t/<company-id>/<EntitySet>[(\'<key>\')] or /t/<company-id>/__reset.');

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: company } = await sb.from('companies').select('id').eq('id', r.companyId).maybeSingle();
    if (!company) return odataError(404, 'NOT_FOUND', 'No such tenant.');

    // ── demo control ─────────────────────────────────────────────────────
    if (r.segment === '__reset') {
        if (req.method !== 'POST') return odataError(405, 'METHOD_NOT_ALLOWED', 'POST to reset.');
        const { data, error } = await sb.from('sap_sim_entities').delete().eq('company_id', r.companyId).select('id');
        if (error) return odataError(500, 'DB', error.message);
        return new Response(JSON.stringify({ deleted: data?.length ?? 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const kp = parseKeyPath(r.segment);
    if (!kp) return odataError(404, 'NOT_FOUND', `Unknown entity set in '${r.segment}'.`);
    const set = kp.set;
    if (!isEntitySet(set)) return odataError(404, 'NOT_FOUND', `Unknown entity set '${set}'.`);

    const load = async (key: string): Promise<Row | null> => {
        const { data } = await sb
            .from('sap_sim_entities')
            .select('id, entity_set, entity_key, etag, payload, last_change_datetime')
            .eq('company_id', r.companyId).eq('entity_set', set).eq('entity_key', key)
            .maybeSingle();
        return (data as Row | null) ?? null;
    };

    // ── collection ───────────────────────────────────────────────────────
    if (kp.key === null) {
        if (req.method === 'GET') {
            const clauses = parseFilter(url.searchParams.get('$filter'));
            if (clauses === null) return odataError(400, 'BAD_FILTER', 'This simulator understands `Field op literal [and …]` only.');
            const top = Math.min(Math.max(Number(url.searchParams.get('$top') ?? 500) || 500, 1), 1000);
            const skip = Math.max(Number(url.searchParams.get('$skip') ?? 0) || 0, 0);
            const orderby = (url.searchParams.get('$orderby') ?? 'LastChangeDateTime asc').trim();
            if (!/^LastChangeDateTime(\s+(asc|desc))?$/i.test(orderby)) return odataError(400, 'BAD_ORDERBY', 'Only $orderby=LastChangeDateTime [asc|desc].');
            const desc = /desc$/i.test(orderby);

            const { data, error } = await sb
                .from('sap_sim_entities')
                .select('id, entity_set, entity_key, etag, payload, last_change_datetime')
                .eq('company_id', r.companyId).eq('entity_set', set)
                .order('last_change_datetime', { ascending: !desc })
                .order('entity_key', { ascending: true });
            if (error) return odataError(500, 'DB', error.message);
            const all = ((data ?? []) as Row[]).map(render).filter((e) => matchesFilter(e, clauses));
            const page = all.slice(skip, skip + top);
            const body: Json = { '@odata.context': `$metadata#${set}`, value: page };
            if (skip + top < all.length) body['@odata.nextLink'] = `${url.pathname}?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), $skip: String(skip + top) })}`;
            return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'OData-Version': '4.0' } });
        }
        if (req.method === 'POST') {
            let body: Json;
            try { body = await req.json() as Json; } catch { return odataError(400, 'BAD_JSON', 'Body must be JSON.'); }
            const keyProp = KEY_PROPERTY[set];
            let key = typeof body[keyProp] === 'string' && (body[keyProp] as string).trim() ? (body[keyProp] as string).trim() : '';
            if (!key) {
                if (!(set in GENERATED)) return odataError(400, 'KEY_REQUIRED', `${keyProp} is required for ${set}.`);
                key = await nextNumber(sb, r.companyId, set);
            } else if (await load(key)) {
                return odataError(409, 'ALREADY_EXISTS', `${set} ${key} already exists.`);
            }
            const { data, error } = await sb
                .from('sap_sim_entities')
                .insert({ company_id: r.companyId, entity_set: set, entity_key: key, payload: cleanBody(set, body) })
                .select('id, entity_set, entity_key, etag, payload, last_change_datetime')
                .single();
            if (error) return odataError(error.code === '23505' ? 409 : 500, 'DB', error.message);
            return entityResponse(data as Row, 201);
        }
        return odataError(405, 'METHOD_NOT_ALLOWED', 'GET or POST on a collection.');
    }

    // ── single entity ────────────────────────────────────────────────────
    const row = await load(kp.key);
    if (!row) return odataError(404, 'NOT_FOUND', `${set} ${kp.key} does not exist.`);

    if (req.method === 'GET') return entityResponse(row, 200);

    if (req.method === 'PATCH') {
        const ifMatch = req.headers.get('if-match');
        if (!ifMatch) return odataError(428, 'PRECONDITION_REQUIRED', 'If-Match is required for an update.');
        if (!etagMatches(ifMatch, etagOf(row.etag))) return odataError(412, 'PRECONDITION_FAILED', `The object was changed in SAP since you read it (current ETag ${etagOf(row.etag)}).`, { ETag: etagOf(row.etag) });
        let body: Json;
        try { body = await req.json() as Json; } catch { return odataError(400, 'BAD_JSON', 'Body must be JSON.'); }
        const { data, error } = await sb
            .from('sap_sim_entities')
            .update({ payload: { ...row.payload, ...cleanBody(set, body) }, etag: row.etag + 1, last_change_datetime: new Date().toISOString() })
            .eq('id', row.id)
            .select('id, entity_set, entity_key, etag, payload, last_change_datetime')
            .single();
        if (error) return odataError(500, 'DB', error.message);
        return entityResponse(data as Row, 200);
    }

    if (req.method === 'DELETE') {
        const ifMatch = req.headers.get('if-match');
        if (ifMatch && !etagMatches(ifMatch, etagOf(row.etag))) return odataError(412, 'PRECONDITION_FAILED', 'Stale ETag.');
        const { error } = await sb.from('sap_sim_entities').delete().eq('id', row.id);
        if (error) return odataError(500, 'DB', error.message);
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    return odataError(405, 'METHOD_NOT_ALLOWED', 'GET, PATCH or DELETE on an entity.');
});
