/**
 * ingest-readings — push-model sensor ingestion (Wave 2 / C2).
 *
 * sensor-sync polls sources on a schedule; this is the complement for
 * devices and gateways that can POST. Any client that can make an HTTPS
 * request with a shared key can stream readings into ers_sensor_readings —
 * the same feed Predict, the digital twin, and the CSV importer use.
 *
 *   POST /functions/v1/ingest-readings
 *   Headers: x-api-key: <INGEST_API_KEY>
 *   Body: { "readings": [
 *     { "asset": "P-101A", "tag": "vibration_de", "value": 4.2,
 *       "unit": "mm/s", "timestamp": "2026-07-17T10:00:00Z",
 *       "alarm_high": 7.1, "alarm_low": 0 }
 *   ] }   — or a bare array. `asset` is an asset tag or id.
 *
 * Unlike sensor-sync (which replaces each series with the window it pulled),
 * this APPENDS each point to the existing series (last 50 kept) — the right
 * semantics for incremental pushes.
 *
 * Env: INGEST_API_KEY (required — requests are rejected until it is set)
 *      + injected SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Deploy: supabase functions deploy ingest-readings --no-verify-jwt
 *         supabase secrets set INGEST_API_KEY=<long random string>
 *         (--no-verify-jwt lets devices call without a Supabase JWT; the
 *          shared key is the gate, so make it long and rotate it if leaked)
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INGEST_API_KEY = Deno.env.get("INGEST_API_KEY") ?? "";

const MAX_BATCH = 500;
const SERIES_KEEP = 50;

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...init,
        headers: {
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
        },
    });
    if (!res.ok) throw new Error(`PostgREST ${res.status}: ${await res.text()}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null; // inserts return 201 with empty bodies
}

interface IncomingReading {
    asset?: string; tag?: string; value?: number | string;
    unit?: string; timestamp?: string; alarm_high?: number; alarm_low?: number;
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (!INGEST_API_KEY) {
        return json({ error: "Ingestion disabled: INGEST_API_KEY secret is not set on this deployment" }, 503);
    }
    if (req.headers.get("x-api-key") !== INGEST_API_KEY) {
        return json({ error: "Invalid or missing x-api-key" }, 401);
    }

    try {
        const body = await req.json().catch(() => null);
        const incoming: IncomingReading[] = Array.isArray(body) ? body
            : Array.isArray(body?.readings) ? body.readings : [];
        if (incoming.length === 0) {
            return json({ error: "Body must be an array of readings or { readings: [...] }" }, 400);
        }
        if (incoming.length > MAX_BATCH) {
            return json({ error: `Batch too large — max ${MAX_BATCH} readings per request` }, 413);
        }

        const rows = incoming.map((r) => ({
            assetToken: String(r.asset ?? "").trim(),
            tag: String(r.tag ?? "").trim(),
            value: Number(r.value),
            unit: r.unit ? String(r.unit) : "",
            ts: r.timestamp ? String(r.timestamp) : "",
            hi: r.alarm_high != null ? Number(r.alarm_high) : null,
            lo: r.alarm_low != null ? Number(r.alarm_low) : null,
        }));
        const valid = rows.filter((r) => r.assetToken && r.tag && Number.isFinite(r.value));
        const rejected = rows.length - valid.length;
        if (valid.length === 0) {
            return json({ accepted: 0, rejected, error: "No valid readings (need asset, tag, numeric value)" }, 400);
        }

        // Resolve asset tokens → asset_id by id or tag (same rule as sensor-sync).
        const assets = await rest(`assets?select=id,tag`) as { id: string; tag: string | null }[];
        const byId = new Map<string, string>(); const byTag = new Map<string, string>();
        for (const a of assets) {
            byId.set(String(a.id).toLowerCase(), a.id);
            if (a.tag) byTag.set(String(a.tag).toLowerCase(), a.id);
        }
        const unknownAssets = new Set<string>();

        // Group incoming points per (asset_id, tag), ordered by timestamp when given.
        type Grp = { asset_id: string; tag: string; unit: string; hi: number | null; lo: number | null; pts: { v: number; ts: string }[] };
        const groups = new Map<string, Grp>();
        for (const r of valid) {
            const aid = byId.get(r.assetToken.toLowerCase()) || byTag.get(r.assetToken.toLowerCase());
            if (!aid) { unknownAssets.add(r.assetToken); continue; }
            const key = `${aid}|${r.tag}`;
            const g = groups.get(key) ?? { asset_id: aid, tag: r.tag, unit: r.unit, hi: r.hi, lo: r.lo, pts: [] };
            g.pts.push({ v: r.value, ts: r.ts });
            if (!g.unit && r.unit) g.unit = r.unit;
            if (g.hi == null && r.hi != null) g.hi = r.hi;
            if (g.lo == null && r.lo != null) g.lo = r.lo;
            groups.set(key, g);
        }
        if (groups.size === 0) {
            return json({ accepted: 0, rejected, unknownAssets: [...unknownAssets] }, 422);
        }

        // Append to existing series (push semantics — sensor-sync replaces instead).
        const assetIds = [...new Set([...groups.values()].map((g) => g.asset_id))];
        const existing = await rest(
            `ers_sensor_readings?select=id,asset_id,tag,readings,unit,alarm_high,alarm_low&asset_id=in.(${assetIds.join(",")})`,
        ) as Record<string, any>[];
        const existingByKey = new Map(existing.map((e) => [`${e.asset_id}|${e.tag}`, e]));

        const payload = [...groups.values()].map((g) => {
            const ordered = g.pts.every((p) => p.ts)
                ? [...g.pts].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
                : g.pts;
            const prior = existingByKey.get(`${g.asset_id}|${g.tag}`);
            const priorVals: number[] = Array.isArray(prior?.readings) ? prior.readings : [];
            const vals = [...priorVals, ...ordered.map((p) => p.v)].slice(-SERIES_KEEP);
            const last = vals[vals.length - 1];
            const prev = vals.length > 1 ? vals[vals.length - 2] : undefined;
            return {
                id: prior?.id ?? crypto.randomUUID(),
                asset_id: g.asset_id,
                tag: g.tag,
                current_value: last,
                unit: g.unit || prior?.unit || "—",
                trend: prev == null ? null : last > prev ? "rising" : last < prev ? "falling" : "stable",
                alarm_high: g.hi ?? prior?.alarm_high ?? null,
                alarm_low: g.lo ?? prior?.alarm_low ?? null,
                readings: vals,
            };
        });

        await rest(`ers_sensor_readings`, {
            method: "POST",
            headers: { "Prefer": "resolution=merge-duplicates" },
            body: JSON.stringify(payload),
        });

        return json({
            accepted: payload.length,
            points: valid.length - [...unknownAssets].length,
            rejected,
            unknownAssets: [...unknownAssets],
        });
    } catch (error) {
        console.error("ingest-readings error:", error);
        return json({ error: String(error) }, 500);
    }
});
