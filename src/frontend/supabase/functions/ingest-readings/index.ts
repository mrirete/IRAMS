/**
 * ingest-readings — push-model sensor ingestion (Wave 2 / C2).
 *
 * sensor-sync polls sources on a schedule; this is the complement for
 * devices and gateways that can POST. Any client that can make an HTTPS
 * request with a shared key can stream readings into ers_sensor_readings —
 * the same feed Predict, the digital twin, and the CSV importer use.
 *
 *   POST /functions/v1/ingest-readings
 *   Headers: x-api-key: <collector key>
 *   Body: { "readings": [
 *     { "asset": "P-101A", "tag": "vibration_de", "value": 4.2,
 *       "unit": "mm/s", "timestamp": "2026-07-17T10:00:00Z",
 *       "alarm_high": 7.1, "alarm_low": 0 }
 *   ] }   — or a bare array. `asset` is an asset tag or id.
 *
 * Unlike sensor-sync (which replaces each series with the window it pulled),
 * this APPENDS each point to the existing series (last 50 kept) — the right
 * semantics for incremental pushes. It also appends to
 * ers_sensor_reading_points (0236), the real history behind that projection,
 * and (0298) mirrors the latest point into reading_logs for definitions that
 * declare a matching sensor_tag — so meter-based PMs and reading alarms react
 * to live feeds, not just manual entries.
 *
 * AUTH — per-collector keys (0236), not one shared secret. Each Collector
 * install gets its own key: hashed at rest, revocable on its own, and stamped
 * with a last-seen heartbeat so a silent collector is visible. There is
 * deliberately no global-key fallback; a single key shared across customers
 * cannot be revoked or attributed.
 *
 * Mint one:
 *   node scripts/provision/mint-collector-key.mjs --name "Bonny Island"
 * Revoke:
 *   update ers_collector_keys set is_active = false where key_prefix = '...';
 *
 * Env: injected SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Deploy: supabase functions deploy ingest-readings --no-verify-jwt
 *         (--no-verify-jwt lets devices call without a Supabase JWT; the
 *          collector key is the gate)
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_BATCH = 500;
const SERIES_KEEP = 50;

/** Lowercase hex SHA-256 — must match the mint script's hashing exactly. */
async function sha256Hex(input: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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

    // ── Authenticate the collector ──────────────────────────────────────
    const presented = req.headers.get("x-api-key") ?? "";
    if (!presented) return json({ error: "Missing x-api-key" }, 401);

    let collector: { id: string; name: string; readings_count: number; company_id: string | null } | null = null;
    try {
        const hash = await sha256Hex(presented);
        const rows = await rest(
            `ers_collector_keys?select=id,name,readings_count,company_id&key_hash=eq.${hash}&is_active=eq.true`,
        ) as { id: string; name: string; readings_count: number; company_id: string | null }[];
        collector = rows?.[0] ?? null;
    } catch (e) {
        console.error("collector key lookup failed (0236 applied?):", e);
        return json({ error: "Ingestion unavailable: collector key store unreachable" }, 503);
    }
    if (!collector) return json({ error: "Invalid or revoked collector key" }, 401);

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
        // TENANT-SCOPED (0298 hardening): keys belong to one company; resolving
        // against every tenant's register let a tag collision route a push into
        // another tenant's asset in the shared database.
        const tenantFilter = collector.company_id ? `&company_id=eq.${collector.company_id}` : "";
        const assets = await rest(`assets?select=id,tag${tenantFilter}`) as { id: string; tag: string | null }[];
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

        const assetIds = [...new Set([...groups.values()].map((g) => g.asset_id))];

        // ── History first: the points table is the source of truth ─────────
        // A replayed batch (the store-and-forward retry every collector does)
        // re-sends identical instants, so collide on (asset, tag, ts) and
        // ignore duplicates. The projection below is then DERIVED from this,
        // which is what stops a retry from inflating the sparkline.
        const seriesRows = [...groups.values()].flatMap((g) =>
            g.pts.map((p) => ({
                asset_id: g.asset_id,
                tag: g.tag,
                ts: p.ts && !Number.isNaN(Date.parse(p.ts)) ? new Date(p.ts).toISOString() : new Date().toISOString(),
                value: p.v,
                unit: g.unit || null,
                source: "ingest",
            }))
        );
        let historyWritten = 0;
        try {
            if (seriesRows.length > 0) {
                await rest(`ers_sensor_reading_points?on_conflict=asset_id,tag,ts`, {
                    method: "POST",
                    headers: { "Prefer": "resolution=ignore-duplicates" },
                    body: JSON.stringify(seriesRows),
                });
                historyWritten = seriesRows.length;
            }
        } catch (e) {
            // History is additive — never fail an ingest over it.
            console.warn("time-series append failed (0236 applied?):", e);
        }

        // ── Projection: rebuild each series from the stored history ────────
        const existing = await rest(
            `ers_sensor_readings?select=id,asset_id,tag,readings,unit,alarm_high,alarm_low&asset_id=in.(${assetIds.join(",")})`,
        ) as Record<string, any>[];
        const existingByKey = new Map(existing.map((e) => [`${e.asset_id}|${e.tag}`, e]));

        // Last SERIES_KEEP points per touched (asset, tag), oldest → newest.
        const storedSeries = new Map<string, number[]>();
        if (historyWritten > 0) {
            await Promise.all([...groups.values()].map(async (g) => {
                try {
                    const rows = await rest(
                        `ers_sensor_reading_points?select=value,ts&asset_id=eq.${g.asset_id}` +
                        `&tag=eq.${encodeURIComponent(g.tag)}&order=ts.desc&limit=${SERIES_KEEP}`,
                    ) as { value: number | string }[];
                    if (rows?.length) {
                        storedSeries.set(`${g.asset_id}|${g.tag}`, rows.map((r) => Number(r.value)).reverse());
                    }
                } catch { /* fall back to the in-memory append below */ }
            }));
        }

        const payload = [...groups.values()].map((g) => {
            const key = `${g.asset_id}|${g.tag}`;
            const prior = existingByKey.get(key);
            const ordered = g.pts.every((p) => p.ts)
                ? [...g.pts].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
                : g.pts;
            // Derived from history when we have it; otherwise the legacy
            // in-memory append, so ingestion still works if 0236 is missing.
            const vals = storedSeries.get(key) ?? (() => {
                const priorVals: number[] = Array.isArray(prior?.readings) ? prior.readings : [];
                return [...priorVals, ...ordered.map((p) => p.v)].slice(-SERIES_KEEP);
            })();
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

        // ── Bridge to the CMMS condition side (0298) ───────────────────────
        // Meter-based PMs and reading alarms read reading_logs, not
        // ers_sensor_readings — without this mirror a live vibration feed
        // drives the Predict twin but never trips a condition-based PM.
        // A reading_definition on the same asset whose sensor_tag (or, as a
        // zero-config fallback, reading_type_code) matches the pushed tag
        // gets the LATEST point of this batch mirrored, throttled to one
        // log row per definition per 15 minutes so high-rate sensors don't
        // flood a table designed for rounds-cadence data.
        let mirrored = 0;
        try {
            const defs = await rest(
                `reading_definitions?select=id,asset_id,reading_type_code,sensor_tag,min_critical,max_critical` +
                `&asset_id=in.(${assetIds.join(",")})&is_active=eq.true`,
            ) as { id: string; asset_id: string; reading_type_code: string; sensor_tag: string | null; min_critical: number | null; max_critical: number | null }[];
            if (defs?.length) {
                const matches: { def: typeof defs[0]; g: Grp }[] = [];
                for (const g of groups.values()) {
                    const tagLc = g.tag.toLowerCase();
                    const def = defs.find((d) => d.asset_id === g.asset_id && (d.sensor_tag ?? "").toLowerCase() === tagLc)
                        ?? defs.find((d) => d.asset_id === g.asset_id && !d.sensor_tag && d.reading_type_code.toLowerCase() === tagLc);
                    if (def) matches.push({ def, g });
                }
                if (matches.length) {
                    const throttleIso = new Date(Date.now() - 15 * 60_000).toISOString();
                    const recent = await rest(
                        `reading_logs?select=definition_id&definition_id=in.(${matches.map((m) => m.def.id).join(",")})` +
                        `&created_at=gte.${throttleIso}`,
                    ) as { definition_id: string }[];
                    const throttled = new Set((recent ?? []).map((r) => r.definition_id));
                    const logRows = matches.filter((m) => !throttled.has(m.def.id)).map(({ def, g }) => {
                        const ordered = g.pts.every((p) => p.ts)
                            ? [...g.pts].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
                            : g.pts;
                        const latest = ordered[ordered.length - 1];
                        const at = latest.ts && !Number.isNaN(Date.parse(latest.ts)) ? new Date(latest.ts) : new Date();
                        const isAlarm = (def.max_critical != null && latest.v >= Number(def.max_critical))
                            || (def.min_critical != null && latest.v <= Number(def.min_critical));
                        return {
                            definition_id: def.id,
                            asset_id: def.asset_id,
                            reading_type_code: def.reading_type_code,
                            reading_date: at.toISOString().slice(0, 10),
                            reading_time: at.toISOString().slice(11, 19),
                            reading_value: latest.v,
                            entered_by: `collector:${collector.name}`,
                            comments: "Mirrored from live sensor feed (ingest-readings)",
                            is_alarm: isAlarm,
                            ...(collector.company_id ? { company_id: collector.company_id } : {}),
                        };
                    });
                    if (logRows.length) {
                        await rest(`reading_logs`, { method: "POST", body: JSON.stringify(logRows) });
                        mirrored = logRows.length;
                    }
                }
            }
        } catch (e) {
            // The bridge is additive — never fail an ingest over it.
            console.warn("reading_logs mirror failed (0298 applied?):", e);
        }

        // Heartbeat: makes a silent collector visible without extra plumbing.
        try {
            await rest(`ers_collector_keys?id=eq.${collector.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    last_seen_at: new Date().toISOString(),
                    readings_count: (Number(collector.readings_count) || 0) + seriesRows.length,
                }),
            });
        } catch (e) {
            console.warn("collector heartbeat failed:", e);
        }

        return json({
            collector: collector.name,
            accepted: payload.length,
            points: valid.length - [...unknownAssets].length,
            historyWritten,
            mirroredToConditionLogs: mirrored,
            rejected,
            unknownAssets: [...unknownAssets],
        });
    } catch (error) {
        console.error("ingest-readings error:", error);
        return json({ error: String(error) }, 500);
    }
});
