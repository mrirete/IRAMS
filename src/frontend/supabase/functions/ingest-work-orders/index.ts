/**
 * ingest-work-orders — the missing HTTP path for CMMS history (0298).
 *
 * The reliability-only tier lives on work-order history imported from a
 * foreign CMMS (SAP, Maximo, MaintainX, …). Until now that history could only
 * arrive through the file-based Import Wizard — fine for onboarding, useless
 * for a nightly delta sync. This endpoint is the wizard's commit path as an
 * API: any client that can export "work orders changed since yesterday" and
 * POST JSON can keep IREAMS current without ever using the EAM day-to-day.
 *
 *   POST /functions/v1/ingest-work-orders
 *   Headers: x-api-key: <collector key>          (ers_collector_keys, 0236)
 *   Body: {
 *     "source_system": "sap_pm",                 // optional; coerced to the
 *                                                // import_batches CHECK set
 *     "work_orders": [ {
 *       "wo_number": "4000123", "asset": "P-101A",   // asset tag, equipment
 *                                                    // number, or asset id
 *       "title": "Seal replacement", "type": "PM02", "status": "TECO",
 *       "created_at": "2026-05-02", "closed_at": "2026-05-04",
 *       "breakdown": true, "malfunction_start": "2026-05-02T03:10:00Z",
 *       "malfunction_end": "2026-05-02T09:40:00Z", "downtime_hours": 6.5,
 *       "labor_hours": 12, "labor_cost": 1400, "material_cost": 830,
 *       "failure_mode": "SEA", "failure_cause": "WEA", "remedy": "REP",
 *       "priority": "2"
 *     } ]
 *   }   — or a bare array.
 *
 * Semantics (deliberately mirrors ImportService.commitBatch):
 *   • TENANT-SCOPED by the collector key's company_id — lookups and writes
 *     never leave the key's tenant.
 *   • Assets must already exist (by tag, equipment number, or id). Unknown
 *     assets are reported, not silently created flat — migrate the register
 *     first (Admin › Migration Center), same dependency the wizard enforces.
 *   • Every request creates one import_batches row, so an API sync is visible
 *     next to file imports and ROLLBACK-ABLE by batch like any of them.
 *   • Idempotent delta sync: an existing wo_number that came from import/API
 *     is UPDATED (status, closure, breakdown, malfunction window, downtime,
 *     costs while not frozen); a wo_number owned by a native in-app work
 *     order is a CONFLICT — the sync must never clobber records users author
 *     in IREAMS. Re-sending an unchanged row is therefore safe.
 *   • Failure coding lands in wo_failure_data; no 'UNKNOWN' padding (0298 —
 *     NULL mode is an honest state).
 *   • Unrecognised work types are kept verbatim (importPipeline rule): they
 *     are NOT counted as failures unless breakdown/failure coding says so.
 *
 * Env: injected SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Deploy: supabase functions deploy ingest-work-orders --no-verify-jwt
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_BATCH = 500;

const SOURCE_SYSTEMS = new Set([
    "sap_pm", "maximo", "maintainx", "emaint", "limble", "fiix", "upkeep", "spreadsheet", "other", "unknown",
]);
const WO_TYPES = new Set(["CM", "PM", "PdM", "INSPECTION", "SAFETY"]);
const WO_STATUSES = new Set(["CLOSED", "TECO", "OPEN", "WIP", "CANCELLED"]);

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
    return text ? JSON.parse(text) : null;
}

// Same classification contract as src/lib/importPipeline.ts guessWoType —
// keep the two in lockstep. null = unclassifiable; the caller keeps the
// source value so it stays neutral to the failure engine and mappable later.
function guessWoType(raw: string): string | null {
    const v = raw.toLowerCase().trim();
    if (/^pm0?3$/.test(v)) return "PM";
    if (/^pm0?[125]$/.test(v)) return "CM";
    if (/prev|pm\b|planned|routine/.test(v)) return "PM";
    if (/pred|pdm|condition|vibra/.test(v)) return "PdM";
    if (/insp|survey|check/.test(v)) return "INSPECTION";
    if (/safe|hse|incident/.test(v)) return "SAFETY";
    if (/correct|break|emerg|repair|fail|\bcm\b|\bem\b|\bbm\b/.test(v)) return "CM";
    return null;
}

function guessWoStatus(raw: string, hasClosedDate: boolean): string {
    const v = raw.toUpperCase().trim();
    if (WO_STATUSES.has(v)) return v;
    if (/TECO|CLOS|COMP|DONE|FINISH/.test(v)) return "CLOSED";
    if (/CANC|DELE/.test(v)) return "CANCELLED";
    if (/PROG|WIP|EXEC|INPR|ASSIGN/.test(v)) return "WIP";
    if (v) return hasClosedDate ? "CLOSED" : "OPEN";
    return hasClosedDate ? "CLOSED" : "OPEN";
}

const iso = (v: unknown): string | null => {
    if (v == null || v === "") return null;
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null => {
    if (v === true || v === false) return v;
    const s = String(v ?? "").trim().toLowerCase();
    if (["true", "yes", "y", "x", "1"].includes(s)) return true;
    if (["false", "no", "n", "0"].includes(s)) return false;
    return null;
};
const str = (v: unknown): string | null => {
    const s = String(v ?? "").trim();
    return s ? s : null;
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // ── Authenticate ────────────────────────────────────────────────────
    const presented = req.headers.get("x-api-key") ?? "";
    if (!presented) return json({ error: "Missing x-api-key" }, 401);

    let collector: { id: string; name: string; company_id: string | null } | null = null;
    try {
        const hash = await sha256Hex(presented);
        const rows = await rest(
            `ers_collector_keys?select=id,name,company_id&key_hash=eq.${hash}&is_active=eq.true`,
        ) as { id: string; name: string; company_id: string | null }[];
        collector = rows?.[0] ?? null;
    } catch (e) {
        console.error("collector key lookup failed:", e);
        return json({ error: "Ingestion unavailable: key store unreachable" }, 503);
    }
    if (!collector) return json({ error: "Invalid or revoked collector key" }, 401);
    const tenantFilter = collector.company_id ? `&company_id=eq.${collector.company_id}` : "";
    const tenantStamp = collector.company_id ? { company_id: collector.company_id } : {};

    try {
        const body = await req.json().catch(() => null);
        const incoming: Record<string, unknown>[] = Array.isArray(body) ? body
            : Array.isArray(body?.work_orders) ? body.work_orders : [];
        if (incoming.length === 0) {
            return json({ error: "Body must be an array of work orders or { work_orders: [...] }" }, 400);
        }
        if (incoming.length > MAX_BATCH) {
            return json({ error: `Batch too large — max ${MAX_BATCH} work orders per request` }, 413);
        }

        // ── Normalise rows ─────────────────────────────────────────────
        const rejects: { wo_number: string | null; reason: string }[] = [];
        const drafts = incoming.flatMap((r) => {
            const woNumber = str(r.wo_number);
            const assetToken = str(r.asset) ?? str(r.asset_tag);
            const createdAt = iso(r.created_at);
            if (!woNumber) { rejects.push({ wo_number: null, reason: "missing wo_number" }); return []; }
            if (!assetToken) { rejects.push({ wo_number: woNumber, reason: "missing asset" }); return []; }
            if (!createdAt) { rejects.push({ wo_number: woNumber, reason: "missing/unparseable created_at" }); return []; }

            const rawType = str(r.type) ?? "";
            const type = rawType
                ? (WO_TYPES.has(rawType) ? rawType : guessWoType(rawType) ?? rawType.toUpperCase().slice(0, 20))
                : "CM";
            const closedAt = iso(r.closed_at);
            let malfStart = iso(r.malfunction_start);
            let malfEnd = iso(r.malfunction_end);
            if (malfStart && malfEnd && malfEnd < malfStart) { malfStart = null; malfEnd = null; }
            return [{
                wo_number: woNumber,
                assetToken,
                title: str(r.title) ?? str(r.description) ?? `${type} on ${assetToken}`,
                description: str(r.description),
                type,
                status: guessWoStatus(str(r.status) ?? "", !!closedAt),
                priority: str(r.priority),
                created_at: createdAt,
                closed_at: closedAt,
                // Combined-figure rule matches the Import Wizard: total_cost is
                // used ONLY when neither component is given (stored as the
                // material component, same convention) — otherwise a row
                // carrying labor + total would double-count the labor.
                labor_cost: num(r.labor_cost) ?? 0,
                material_cost: num(r.material_cost)
                    ?? (num(r.labor_cost) == null ? num(r.total_cost) : null)
                    ?? 0,
                downtime_hours: num(r.downtime_hours),
                labor_hours: num(r.labor_hours),
                breakdown: bool(r.breakdown),
                malfunction_start: malfStart,
                malfunction_end: malfEnd,
                failure_mode: str(r.failure_mode),
                failure_cause: str(r.failure_cause),
                remedy: str(r.remedy),
            }];
        });
        if (drafts.length === 0) {
            return json({ accepted: 0, rejected: rejects.length, rejects }, 400);
        }

        // ── Resolve assets (tenant-scoped, tag OR equipment number OR id) ──
        const assets = await rest(`assets?select=id,tag,equipment_number${tenantFilter}`) as
            { id: string; tag: string | null; equipment_number: string | null }[];
        const byToken = new Map<string, string>();
        for (const a of assets) {
            byToken.set(String(a.id).toLowerCase(), a.id);
            if (a.tag) byToken.set(a.tag.toLowerCase(), a.id);
            if (a.equipment_number) byToken.set(a.equipment_number.toLowerCase(), a.id);
        }
        const unknownAssets = new Set<string>();
        const resolved = drafts.filter((d) => {
            const id = byToken.get(d.assetToken.toLowerCase());
            if (!id) { unknownAssets.add(d.assetToken); return false; }
            (d as Record<string, unknown>).asset_id = id;
            return true;
        });
        if (resolved.length === 0) {
            return json({
                accepted: 0, rejected: rejects.length, rejects,
                unknownAssets: [...unknownAssets],
                hint: "Assets must exist before history can sync — import the register first (Admin › Migration Center).",
            }, 422);
        }

        // ── One batch row per request: visible + rollback-able like a file ──
        const requestedSource = String(body?.source_system ?? "").toLowerCase();
        const sourceSystem = SOURCE_SYSTEMS.has(requestedSource) ? requestedSource : "other";
        const batchRows = await rest(`import_batches`, {
            method: "POST",
            headers: { "Prefer": "return=representation" },
            body: JSON.stringify({
                source_system: sourceSystem,
                file_name: `api:${collector.name}`,
                status: "committed",
                committed_at: new Date().toISOString(),
                ...tenantStamp,
            }),
        }) as { id: string }[];
        const batchId = batchRows?.[0]?.id;
        if (!batchId) throw new Error("could not create import batch");

        // ── Split into create vs update vs conflict ────────────────────
        const nums = [...new Set(resolved.map((d) => d.wo_number))];
        const existing: { id: string; wo_number: string; import_batch_id: string | null; cost_frozen: boolean | null }[] = [];
        for (let i = 0; i < nums.length; i += 100) {
            const part = nums.slice(i, i + 100).map(encodeURIComponent);
            const rows = await rest(
                `work_orders?select=id,wo_number,import_batch_id,cost_frozen&wo_number=in.(${part.map((n) => `"${n}"`).join(",")})${tenantFilter}`,
            ) as typeof existing;
            existing.push(...rows);
        }
        const existingByNum = new Map(existing.map((w) => [w.wo_number, w]));

        let created = 0, updated = 0, failureRows = 0;
        const conflicts: string[] = [];
        const failureUpserts: { wo_id: string; d: typeof resolved[0] }[] = [];

        const toInsert = resolved.filter((d) => !existingByNum.has(d.wo_number));
        const toUpdate = resolved.filter((d) => {
            const ex = existingByNum.get(d.wo_number);
            if (!ex) return false;
            // Only rows born from import/API may be re-synced. A native
            // wo_number collision is a conflict, never an overwrite.
            if (!ex.import_batch_id) { conflicts.push(d.wo_number); return false; }
            return true;
        });

        for (let i = 0; i < toInsert.length; i += 100) {
            const part = toInsert.slice(i, i + 100);
            const rows = part.map((d) => {
                const closed = d.status === "CLOSED" || d.status === "TECO";
                return {
                    wo_number: d.wo_number,
                    title: d.title,
                    description: d.description,
                    status: d.status,
                    type: d.type,
                    asset_id: (d as Record<string, unknown>).asset_id,
                    created_at: d.created_at,
                    closed_at: d.closed_at ?? (closed ? d.created_at : null),
                    frozen_labor_cost: closed ? d.labor_cost : null,
                    frozen_material_cost: closed ? d.material_cost : null,
                    total_actual_cost: d.labor_cost + d.material_cost,
                    cost_frozen: closed,
                    actual_downtime_hrs: d.downtime_hours,
                    actual_duration_hrs: d.labor_hours,
                    breakdown: d.breakdown,
                    malfunction_start: d.malfunction_start,
                    malfunction_end: d.malfunction_end,
                    created_by: null,
                    import_batch_id: batchId,
                    properties: { import_priority_raw: d.priority, ingest_source: sourceSystem },
                    ...tenantStamp,
                };
            });
            const ins = await rest(`work_orders?select=id,wo_number`, {
                method: "POST",
                headers: { "Prefer": "return=representation" },
                body: JSON.stringify(rows),
            }) as { id: string; wo_number: string }[];
            created += ins.length;
            const idByNum = new Map(ins.map((w) => [w.wo_number, w.id]));
            for (const d of part) {
                const id = idByNum.get(d.wo_number);
                if (id && (d.failure_mode || d.failure_cause || d.remedy)) failureUpserts.push({ wo_id: id, d });
            }
        }

        for (const d of toUpdate) {
            const ex = existingByNum.get(d.wo_number)!;
            const closed = d.status === "CLOSED" || d.status === "TECO";
            // Frozen history keeps its money (0284); an open imported order can
            // still take cost + closure on the sync that closes it. The freeze
            // must land in its OWN update BEFORE the status flips: the 0284
            // trigger recomputes frozen costs from sem_wo_actual_lines on the
            // open→CLOSED transition, and synced orders have no actual lines —
            // a combined patch would freeze them at $0. With cost_frozen already
            // TRUE, the trigger's recompute branch is skipped.
            if (!ex.cost_frozen) {
                const costPatch: Record<string, unknown> = { total_actual_cost: d.labor_cost + d.material_cost };
                if (closed) {
                    costPatch.frozen_labor_cost = d.labor_cost;
                    costPatch.frozen_material_cost = d.material_cost;
                    costPatch.cost_frozen = true;
                }
                await rest(`work_orders?id=eq.${ex.id}`, { method: "PATCH", body: JSON.stringify(costPatch) });
            }
            await rest(`work_orders?id=eq.${ex.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    status: d.status,
                    closed_at: d.closed_at ?? (closed ? d.created_at : null),
                    breakdown: d.breakdown,
                    malfunction_start: d.malfunction_start,
                    malfunction_end: d.malfunction_end,
                    actual_downtime_hrs: d.downtime_hours,
                    actual_duration_hrs: d.labor_hours,
                }),
            });
            updated += 1;
            if (d.failure_mode || d.failure_cause || d.remedy) failureUpserts.push({ wo_id: ex.id, d });
        }

        // ── Failure coding sidecar (no 'UNKNOWN' padding — 0298) ───────
        for (let i = 0; i < failureUpserts.length; i += 200) {
            const rows = failureUpserts.slice(i, i + 200).map(({ wo_id, d }) => ({
                wo_id,
                failure_mode_code: d.failure_mode,
                failure_cause_code: d.failure_cause,
                remedy_code: d.remedy,
                comments: `Synced from ${sourceSystem} (ingest-work-orders)`,
                ...tenantStamp,
            }));
            try {
                await rest(`wo_failure_data?on_conflict=wo_id`, {
                    method: "POST",
                    headers: { "Prefer": "resolution=merge-duplicates" },
                    body: JSON.stringify(rows),
                });
                failureRows += rows.length;
            } catch (e) {
                console.warn("failure-coding upsert failed:", e);
                break;
            }
        }

        // ── Seal the batch + heartbeat ─────────────────────────────────
        await rest(`import_batches?id=eq.${batchId}`, {
            method: "PATCH",
            body: JSON.stringify({
                row_counts: { work_orders: created, updated, failure_rows: failureRows, skipped: rejects.length + unknownAssets.size + conflicts.length },
                notes: [
                    conflicts.length ? `${conflicts.length} wo_number(s) owned by native work orders — not touched.` : null,
                    unknownAssets.size ? `${unknownAssets.size} unknown asset reference(s) skipped.` : null,
                ].filter(Boolean).join(" ") || null,
            }),
        });
        try {
            await rest(`ers_collector_keys?id=eq.${collector.id}`, {
                method: "PATCH",
                body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
            });
        } catch { /* heartbeat is best-effort */ }

        return json({
            collector: collector.name,
            batch_id: batchId,
            created,
            updated,
            failure_rows: failureRows,
            conflicts,
            rejected: rejects.length,
            rejects,
            unknownAssets: [...unknownAssets],
        });
    } catch (error) {
        console.error("ingest-work-orders error:", error);
        return json({ error: String(error) }, 500);
    }
});
