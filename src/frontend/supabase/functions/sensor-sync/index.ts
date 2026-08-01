// Supabase Edge Function: sensor-sync
// ────────────────────────────────────────────────────────────────────────────
// The real backend worker behind the Connector Hub. Reads active cloud-route
// connectors from the `connectors` table, pulls each source, and upserts the
// readings into ers_sensor_readings — the same feed the Predict twin reads and
// the CSV importer writes to.
//
// Two execution kinds, both landing in the same (asset, tag, value) contract:
//   • kind: 'rest'    — fetch a JSON endpoint, walk dotted paths to an array of
//                       records. Backs the REST API and Historian connectors
//                       (a historian is just REST with Basic auth + a path).
//                       REPLACES each series with the window it pulled.
//   • kind: 'weather' — fetch a weather provider's single-object response and
//                       emit one point per selected data point, bound to one
//                       asset. APPENDS to the series (each poll is one sample).
// Rows written before `kind` existed are treated as 'rest'.
//
// Runs two ways:
//   • on a schedule  — pg_cron POSTs here every N minutes (see README)
//   • on demand      — POST { "connectorId": "<uuid>" } to sync just one
//
// Deploy:  supabase functions deploy sensor-sync
// Uses the auto-injected SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role
// bypasses RLS so it can write). No secrets in this repo — per-source tokens go
// in the connector's `config.headers` or a function secret.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWeatherPoints, getPath, type Point, type WeatherConfig } from '../_shared/weather.ts';

/** Connector types this function can execute (the cloud route). Everything
 *  else — OPC-UA, MQTT, on-prem SQL, file drops — needs the collector agent,
 *  which pushes to the `ingest-readings` function instead. */
const CLOUD_TYPES = ['rest_api', 'weather_api', 'historian'];

const SERIES_KEEP = 50;

interface Mapping {
    asset: string; tag: string; value: string;
    unit?: string; timestamp?: string; alarm_high?: string; alarm_low?: string;
}
interface RestConfig {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    /** dotted path to the array of records in the response (omit if the body IS the array) */
    root?: string;
    /** maps our fields → source JSON field paths */
    map: Mapping;
}
// ── Shared writer ───────────────────────────────────────────────────────────
/**
 * Resolve asset tokens → asset_id, group per (asset_id, tag), and upsert.
 * `append: true` keeps the prior series and adds to it (weather polls yield a
 * single sample per run); `false` replaces it with the pulled window (REST).
 */
async function upsertPoints(
    sb: SupabaseClient,
    points: Point[],
    opts: { append: boolean; source: string },
): Promise<number> {
    if (points.length === 0) return 0;

    const { data: assets } = await sb.from('assets').select('id, tag');
    const byId = new Map<string, string>(); const byTag = new Map<string, string>();
    for (const a of assets ?? []) {
        byId.set(String(a.id).toLowerCase(), a.id);
        if (a.tag) byTag.set(String(a.tag).toLowerCase(), a.id);
    }
    const resolve = (tok: string) => byId.get(tok.toLowerCase()) || byTag.get(tok.toLowerCase()) || null;

    type Grp = { asset_id: string; tag: string; unit: string; hi: number | null; lo: number | null; series: { v: number; ts: string }[] };
    const groups = new Map<string, Grp>();
    const unresolved = new Set<string>();
    for (const r of points) {
        const aid = resolve(r.assetToken);
        if (!aid) { unresolved.add(r.assetToken); continue; }
        const key = `${aid}|${r.tag}`;
        const g = groups.get(key) ?? { asset_id: aid, tag: r.tag, unit: r.unit, hi: r.hi, lo: r.lo, series: [] };
        g.series.push({ v: r.value, ts: r.ts });
        if (!g.unit && r.unit) g.unit = r.unit;
        if (g.hi == null && r.hi != null) g.hi = r.hi;
        if (g.lo == null && r.lo != null) g.lo = r.lo;
        groups.set(key, g);
    }
    // Points arrived but nothing matched an asset — a silent 0 hides a typo'd
    // tag, so surface it as the error it is.
    if (groups.size === 0) {
        const sample = [...unresolved].slice(0, 5).join(', ');
        throw new Error(`no reading matched an asset — unknown asset tag/id: ${sample || '(none supplied)'}`);
    }

    const assetIds = [...new Set([...groups.values()].map((g) => g.asset_id))];
    const { data: existing } = await sb.from('ers_sensor_readings')
        .select('id, asset_id, tag, readings, unit, alarm_high, alarm_low').in('asset_id', assetIds);
    const priorByKey = new Map<string, Record<string, unknown>>();
    for (const e of existing ?? []) priorByKey.set(`${e.asset_id}|${e.tag}`, e);

    const payload = [...groups.values()].map((g) => {
        const ordered = g.series.every((s) => s.ts)
            ? [...g.series].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
            : g.series;
        const prior = priorByKey.get(`${g.asset_id}|${g.tag}`) as any;
        const priorVals: number[] = opts.append && Array.isArray(prior?.readings) ? prior.readings : [];
        const vals = [...priorVals, ...ordered.map((s) => s.v)].slice(-SERIES_KEEP);
        const last = vals[vals.length - 1];
        const prev = vals.length > 1 ? vals[vals.length - 2] : undefined;
        return {
            id: prior?.id ?? crypto.randomUUID(),
            asset_id: g.asset_id, tag: g.tag, current_value: last,
            unit: g.unit || prior?.unit || '—',
            trend: prev == null ? null : last > prev ? 'rising' : last < prev ? 'falling' : 'stable',
            alarm_high: g.hi ?? prior?.alarm_high ?? null,
            alarm_low: g.lo ?? prior?.alarm_low ?? null,
            readings: vals,
        };
    });
    const { error } = await sb.from('ers_sensor_readings').upsert(payload);
    if (error) throw new Error(error.message);

    // Append the same points to the time-series store (0236). The projection
    // above keeps only the last 50 values; this is the history behind it.
    // ignoreDuplicates lets a retried poll re-send the same instants harmlessly.
    const seriesRows = [...groups.values()].flatMap((g) =>
        g.series.map((s) => ({
            asset_id: g.asset_id,
            tag: g.tag,
            ts: s.ts && !Number.isNaN(Date.parse(s.ts)) ? new Date(s.ts).toISOString() : new Date().toISOString(),
            value: s.v,
            unit: g.unit || null,
            source: opts.source,
        }))
    );
    if (seriesRows.length > 0) {
        const { error: seriesErr } = await sb
            .from('ers_sensor_reading_points')
            .upsert(seriesRows, { onConflict: 'asset_id,tag,ts', ignoreDuplicates: true });
        // History is additive — never fail a sync that already wrote the
        // projection Predict reads. Surface it in the logs instead.
        if (seriesErr) console.warn('[sensor-sync] time-series append failed (0236 applied?):', seriesErr.message);
    }

    return payload.length;
}

// ── kind: 'rest' — REST API and Historian ───────────────────────────────────
async function syncRest(sb: SupabaseClient, connector: Record<string, unknown>): Promise<number> {
    const cfg = connector.config as RestConfig;
    if (!cfg?.url || !cfg?.map) throw new Error('connector config missing url/map');

    const res = await fetch(cfg.url, { method: cfg.method || 'GET', headers: cfg.headers || {} });
    if (!res.ok) throw new Error(`source responded ${res.status}`);
    const json = await res.json();
    const arr = getPath(json, cfg.root);
    const items: unknown[] = Array.isArray(arr) ? arr : Array.isArray(json) ? json : [];
    if (items.length === 0) return 0;

    const m = cfg.map;
    const points: Point[] = items.map((it) => ({
        assetToken: String(getPath(it, m.asset) ?? '').trim(),
        tag: String(getPath(it, m.tag) ?? '').trim(),
        value: Number(getPath(it, m.value)),
        unit: m.unit ? String(getPath(it, m.unit) ?? '') : '',
        ts: m.timestamp ? String(getPath(it, m.timestamp) ?? '') : '',
        hi: m.alarm_high ? Number(getPath(it, m.alarm_high)) : null,
        lo: m.alarm_low ? Number(getPath(it, m.alarm_low)) : null,
    })).filter((r) => r.tag && Number.isFinite(r.value));

    return await upsertPoints(sb, points, { append: false, source: 'sensor-sync' });
}

// ── kind: 'weather' — provider adapters live in _shared/weather.ts ──────────
async function syncWeather(sb: SupabaseClient, connector: Record<string, unknown>): Promise<number> {
    const { points, skipped, label } = await fetchWeatherPoints(connector.config as WeatherConfig);
    const written = await upsertPoints(sb, points, { append: true, source: 'sensor-sync' });
    if (skipped.length) console.warn(`[sensor-sync] ${label} cannot serve: ${skipped.join(', ')}`);
    return written;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    let connectorId: string | undefined;
    try { connectorId = (await req.json())?.connectorId; } catch { /* cron: no body */ }

    const base = sb.from('connectors').select('*');
    const query = connectorId
        ? base.eq('id', connectorId)
        : base.eq('is_active', true).in('type', CLOUD_TYPES);
    const { data: connectors, error } = await query;
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    /**
     * Each connector carries its own `sync_interval_seconds`, but the cron that
     * calls us fires on one fixed schedule. Without this check a 24-hour
     * connector would be polled at the cron's cadence, so the interval the user
     * configured would be decorative. Cron runs often; each connector runs when
     * it is actually due. An explicit connectorId (Sync Now, wizard Test) always
     * runs — the user asked for it.
     */
    const isDue = (c: Record<string, unknown>): boolean => {
        if (connectorId) return true;
        if (!c.last_sync) return true;
        const intervalMs = (Number(c.sync_interval_seconds) || 3600) * 1000;
        const elapsed = Date.now() - new Date(String(c.last_sync)).getTime();
        // Small tolerance so a run that lands a few seconds early isn't deferred
        // a whole cron tick.
        return elapsed >= intervalMs - 30_000;
    };

    const results: unknown[] = [];
    let skippedNotDue = 0;
    for (const c of connectors ?? []) {
        if (!isDue(c)) { skippedNotDue++; continue; }
        const startedAt = new Date().toISOString();
        try {
            // Rows written before `kind` existed are REST.
            const kind = (c.config as Record<string, unknown>)?.kind ?? 'rest';
            if (kind !== 'rest' && kind !== 'weather') {
                throw new Error(`connector type "${c.type}" runs on the ERS Collector, not the cloud sync worker`);
            }
            const records = kind === 'weather' ? await syncWeather(sb, c) : await syncRest(sb, c);
            await sb.from('connectors').update({
                last_sync: startedAt, last_status: 'ok', last_error: null,
                records_synced: (Number(c.records_synced) || 0) + records, updated_at: startedAt,
            }).eq('id', c.id);
            await sb.from('connector_sync_logs').insert({ connector_id: c.id, started_at: startedAt, finished_at: new Date().toISOString(), status: 'ok', records, message: `${records} points` });
            results.push({ connector: c.name, ok: true, records });
        } catch (e) {
            const msg = String((e as Error)?.message ?? e).slice(0, 300);
            await sb.from('connectors').update({ last_sync: startedAt, last_status: 'error', last_error: msg, updated_at: startedAt }).eq('id', c.id);
            await sb.from('connector_sync_logs').insert({ connector_id: c.id, started_at: startedAt, finished_at: new Date().toISOString(), status: 'error', records: 0, message: msg });
            results.push({ connector: c.name, ok: false, error: msg });
        }
    }
    return new Response(
        JSON.stringify({ ran: results.length, skippedNotDue, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
});
