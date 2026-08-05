/**
 * bulkImportService — hierarchy-aware bulk import for CMMS migration.
 *
 * Replaces the old per-row `DatabaseService.addAsset` loop, which dropped
 * `parentTag` entirely and never set `hierarchyLevel` — so a legacy category
 * fallback collapsed AREA→SITE, SUBSYSTEM→SYSTEM and everything else→EQUIPMENT,
 * landing every imported asset as a flat root node.
 *
 * What this does instead:
 *   • resolves the level through `hierarchyModel` (the same engine the register,
 *     the numbering trigger and the drag-drop guard obey)
 *   • topologically sorts by parentTag so children can appear above parents,
 *     with cycle detection
 *   • enforces per-level rules (allowed children, mandatory criticality) rather
 *     than defaulting everything to 'C'
 *   • reports every row's fate instead of silently succeeding
 *
 * Writes go straight through supabase (not DatabaseService) so the shape is
 * explicit and auditable; `DatabaseService.addAsset` remains for single-asset
 * creation in the register UI.
 */
import { supabase } from '../lib/supabase';
import {
    getLevelConfig, resolveLevelCode, isValidChild, criticalityRequired,
} from './hierarchyModel';
import { parseDateValue } from './assetTemplates';
import {
    emptyResult, tally, errMessage, isUniqueViolation,
    type ImportResult, type RowOutcome,
} from './importTypes';

/** Assets insert in small chunks: the numbering trigger takes a row lock on
 *  numbering_config for EVERY row, and an AFTER trigger writes an audit row. */
const ASSET_CHUNK = 50;
const LOOKUP_CHUNK = 200;
const READING_CHUNK = 200;

type Row = Record<string, string>;

/** Row number as it appears in the user's spreadsheet. */
const rowNum = (r: Row, fallback: number) => Number(r.__row) || fallback;

const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

interface ExistingAsset { id: string; tag: string; level?: string; companyId: string | null }

/** Look up assets by tag in chunks (the `.in()` list has practical limits). */
async function fetchAssetsByTag(tags: string[]): Promise<Map<string, ExistingAsset>> {
    const map = new Map<string, ExistingAsset>();
    const unique = [...new Set(tags.filter(Boolean))];
    for (const part of chunk(unique, LOOKUP_CHUNK)) {
        const { data, error } = await supabase
            .from('assets')
            .select('id, tag, hierarchy_level, company_id')
            .in('tag', part);
        if (error) throw new Error(`Asset lookup failed: ${error.message}`);
        for (const a of data ?? []) {
            map.set(String(a.tag).toUpperCase(), {
                id: a.id, tag: a.tag, level: a.hierarchy_level ?? undefined, companyId: a.company_id ?? null,
            });
        }
    }
    return map;
}

// ───────────────────────── Assets ─────────────────────────

interface AssetDraft {
    row: number;
    tag: string;
    parentTag: string;
    level: string;
    data: Row;
}

export async function importAssets(rows: Row[], opts: { withBatch?: boolean } = {}): Promise<ImportResult> {
    const res = emptyResult();
    if (rows.length === 0) return res;

    // ── 1. Resolve levels; reject what the level model doesn't recognise ──
    const drafts: AssetDraft[] = [];
    const seenTags = new Set<string>();

    rows.forEach((r, i) => {
        const row = rowNum(r, i + 2);
        const tag = (r['tag'] || '').trim();
        const key = tag.toUpperCase();

        if (tag && seenTags.has(key)) {
            tally(res, { row, key: tag, status: 'failed', reason: 'Duplicate tag in this file' });
            return;
        }
        if (tag) seenTags.add(key);

        // Empty strings must become undefined: resolveLevelCode chains with ??,
        // which does NOT fall through on '' — a blank hierarchyLevel column
        // (explicitly allowed by the template) would otherwise block the
        // assetType fallback and fail the row.
        const level = resolveLevelCode({
            hierarchyLevel: (r['hierarchylevel'] || '').trim() || undefined,
            assetType: (r['assettype'] || '').trim() || undefined,
        });
        if (!level) {
            tally(res, {
                row, key: tag, status: 'failed',
                reason: `Unknown hierarchy level "${r['hierarchylevel'] || r['assettype'] || ''}" — see the template's Instructions sheet`,
            });
            return;
        }
        drafts.push({ row, tag, parentTag: (r['parenttag'] || '').trim(), level, data: r });
    });

    if (drafts.length === 0) return res;

    // ── 2. What already exists (own tags + parent tags) ──
    const existing = await fetchAssetsByTag([
        ...drafts.map(d => d.tag),
        ...drafts.map(d => d.parentTag),
    ]);

    const inFile = new Map<string, AssetDraft>();
    const pending: AssetDraft[] = [];
    for (const d of drafts) {
        if (d.tag && existing.has(d.tag.toUpperCase())) {
            tally(res, { row: d.row, key: d.tag, status: 'skipped', reason: 'Tag already exists — left untouched' });
            continue;
        }
        if (d.tag) inFile.set(d.tag.toUpperCase(), d);
        pending.push(d);
    }

    // ── 3. Resolve parents; topological sort (Kahn) ──
    const blocked = new Set<AssetDraft>();
    for (const d of pending) {
        if (!d.parentTag) continue;
        const pk = d.parentTag.toUpperCase();
        if (!existing.has(pk) && !inFile.has(pk)) {
            tally(res, { row: d.row, key: d.tag, status: 'failed', reason: `Parent tag "${d.parentTag}" not found in this file or in ERS` });
            blocked.add(d);
        }
    }

    // Layers, not a flat order: every row in a layer has its in-file parent
    // already INSERTED (in an earlier layer), so a layer can be written as one
    // batch and still know its parent_ids. A flat list chunked at a fixed size
    // could split a parent from its child.
    const sortable = pending.filter(d => !blocked.has(d));
    const layers: AssetDraft[][] = [];
    const placed = new Set<string>();
    let remaining = [...sortable];

    while (remaining.length) {
        const ready = remaining.filter(d => {
            const pk = d.parentTag.toUpperCase();
            return !d.parentTag || !inFile.has(pk) || placed.has(pk);
        });
        if (ready.length === 0) break; // everything left is in a cycle
        layers.push(ready);
        ready.forEach(d => { if (d.tag) placed.add(d.tag.toUpperCase()); });
        const readySet = new Set(ready);
        remaining = remaining.filter(d => !readySet.has(d));
    }
    for (const d of remaining) {
        tally(res, { row: d.row, key: d.tag, status: 'failed', reason: 'Circular parent reference' });
    }
    if (layers.length === 0) return res;

    // ── 4. Cost centres (codes in the sheet → uuid FK) ──
    const ccByCode = new Map<string, string>();
    const wantsCc = layers.some(l => l.some(d => d.data['costcenter']));
    if (wantsCc) {
        const { data } = await supabase.from('cost_centers').select('id, code');
        for (const c of data ?? []) ccByCode.set(String(c.code).toUpperCase(), c.id);
    }

    // ── 5. Provenance batch (optional — import_batches is admin-only by RLS) ──
    let batchId: string | null = null;
    if (opts.withBatch) {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const { data, error } = await supabase
                .from('import_batches')
                .insert({ source_system: 'spreadsheet', file_name: 'Asset register import', status: 'draft', created_by: user?.id ?? null })
                .select('id')
                .single();
            if (error) throw new Error(error.message);
            batchId = data.id as string;
        } catch (e) {
            res.notes!.push(`Provenance batch not recorded (${errMessage(e)}) — rows still imported, but this run can't be rolled back as a batch.`);
        }
    }

    // ── 6. Insert layer by layer so parent ids exist before children ──
    const idByTag = new Map<string, string>();
    for (const [k, v] of existing) idByTag.set(k, v.id);
    const companyByTag = new Map<string, string | null>();
    for (const [k, v] of existing) companyByTag.set(k, v.companyId);

    // Insert layer by layer; chunk WITHIN a layer (all parents already exist).
    for (const layer of layers) {
      for (const part of chunk(layer, ASSET_CHUNK)) {
        const payload: { draft: AssetDraft; row: Record<string, unknown> }[] = [];

        for (const d of part) {
            const pk = d.parentTag.toUpperCase();
            const parentId = d.parentTag ? idByTag.get(pk) : undefined;

            if (d.parentTag && !parentId) {
                // Parent was expected by now — it must have failed to insert.
                tally(res, { row: d.row, key: d.tag, status: 'failed', reason: `Parent "${d.parentTag}" was not imported, so this row has nowhere to hang` });
                continue;
            }

            const parentLevel = d.parentTag
                ? (existing.get(pk)?.level ?? inFile.get(pk)?.level)
                : undefined;

            if (parentLevel && !isValidChild({ hierarchyLevel: parentLevel }, d.level)) {
                const allowed = getLevelConfig(parentLevel)?.allowedChildCodes ?? [];
                tally(res, {
                    row: d.row, key: d.tag, status: 'failed',
                    reason: `${d.level} cannot sit under ${parentLevel} (allowed: ${allowed.join(', ') || 'none'})`,
                });
                continue;
            }

            const crit = (d.data['criticality'] || '').toUpperCase();
            if (!crit && criticalityRequired({ hierarchyLevel: d.level })) {
                tally(res, { row: d.row, key: d.tag, status: 'failed', reason: `Criticality is required for ${d.level} assets` });
                continue;
            }

            const ccCode = (d.data['costcenter'] || '').toUpperCase();
            const ccId = ccCode ? ccByCode.get(ccCode) : undefined;

            const props: Record<string, unknown> = {};
            if (d.data['department']) props.department = d.data['department'];
            if (d.data['location']) props.location = d.data['location'];
            if (d.data['description']) props.description = d.data['description'];
            if (batchId) props.import_batch_id = batchId;

            payload.push({
                draft: d,
                row: {
                    tag: d.tag || null,                        // blank ⇒ trigger auto-numbers
                    name: d.data['name'] || d.tag,
                    hierarchy_level: d.level,
                    parent_id: parentId ?? null,
                    criticality: crit || null,                 // nullable since 0161
                    status_code: (d.data['status'] || 'ACTIVE').toUpperCase(),
                    equipment_number: d.data['equipmentnumber'] || null,
                    serial_number: d.data['serialnumber'] || null,
                    manufacturer: d.data['manufacturer'] || null,
                    model: d.data['model'] || null,            // no more model←category stuffing
                    asset_category: d.data['assettype'] || null,
                    asset_type_code: d.data['assettype'] || null,
                    cost_center_id: ccId ?? null,
                    // Inherit the parent's company when there is one, and
                    // OMIT the key otherwise — never send an explicit null.
                    //
                    // Since the shared-DB tenancy work, company_id defaults to
                    // caller_company() and every insert policy carries
                    // WITH CHECK (company_id = caller_company()). An explicit
                    // null suppresses the default AND evaluates the check to
                    // NULL, which Postgres treats as a violation — so sending
                    // `company_id: null` does not import an untenanted row, it
                    // refuses the row outright. Every root-level asset went
                    // down that path, which is Migration Center phase 1 and the
                    // first thing a new customer does.
                    ...(d.parentTag && companyByTag.get(pk)
                        ? { company_id: companyByTag.get(pk) }
                        : {}),
                    import_batch_id: batchId,
                    properties: props,
                },
            });

            if (ccCode && !ccId) {
                res.notes!.push(`Cost centre "${d.data['costcenter']}" not found — row ${d.row} imported without it.`);
            }
        }

        if (payload.length === 0) continue;

        const { data, error } = await supabase
            .from('assets')
            .insert(payload.map(p => p.row))
            .select('id, tag, company_id');

        if (error) {
            // Chunk failed as a unit — retry row by row so one bad row doesn't
            // sink 49 good ones.
            for (const p of payload) {
                const { data: one, error: oneErr } = await supabase
                    .from('assets').insert(p.row).select('id, tag, company_id').single();
                if (oneErr) {
                    tally(res, {
                        row: p.draft.row, key: p.draft.tag, status: 'failed',
                        reason: isUniqueViolation(oneErr) ? 'Tag or equipment number already in use' : oneErr.message,
                    });
                } else {
                    idByTag.set(String(one.tag).toUpperCase(), one.id);
                    companyByTag.set(String(one.tag).toUpperCase(), one.company_id ?? null);
                    tally(res, { row: p.draft.row, key: p.draft.tag || one.tag, status: 'inserted' });
                }
            }
            continue;
        }

        const returnedByTag = new Map((data ?? []).map(a => [String(a.tag).toUpperCase(), a]));
        for (const p of payload) {
            const hit = p.draft.tag ? returnedByTag.get(p.draft.tag.toUpperCase()) : undefined;
            if (hit) {
                idByTag.set(String(hit.tag).toUpperCase(), hit.id);
                companyByTag.set(String(hit.tag).toUpperCase(), hit.company_id ?? null);
            }
            tally(res, { row: p.draft.row, key: p.draft.tag || hit?.tag, status: 'inserted' });
        }
      }
    }

    // ── 7. Seal the batch ──
    if (batchId) {
        await supabase.from('import_batches').update({
            status: 'committed',
            row_counts: { assets: res.inserted, skipped: res.skipped + res.failed },
            committed_at: new Date().toISOString(),
        }).eq('id', batchId);
    }

    return res;
}

// ───────────────────────── Readings ─────────────────────────

/**
 * Historical meter / condition readings. Reading points (`reading_definitions`)
 * are created on demand — a migration file only carries the log, and requiring
 * the points to exist first would make the import unusable.
 */
export async function importReadings(rows: Row[]): Promise<ImportResult> {
    const res = emptyResult();
    if (rows.length === 0) return res;

    const assets = await fetchAssetsByTag(rows.map(r => r['assettag'] || ''));

    // Existing reading points, keyed asset+type.
    const defByKey = new Map<string, string>();
    const assetIds = [...new Set([...assets.values()].map(a => a.id))];
    for (const part of chunk(assetIds, LOOKUP_CHUNK)) {
        const { data, error } = await supabase
            .from('reading_definitions')
            .select('id, asset_id, reading_type_code')
            .in('asset_id', part);
        if (error) throw new Error(`Reading point lookup failed: ${error.message}`);
        for (const d of data ?? []) defByKey.set(`${d.asset_id}::${d.reading_type_code}`, d.id);
    }

    interface LogDraft { row: number; key: string; log: Record<string, unknown> }
    const drafts: LogDraft[] = [];
    let pointsCreated = 0;

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const row = rowNum(r, i + 2);
        const tag = (r['assettag'] || '').trim();
        const asset = assets.get(tag.toUpperCase());
        if (!asset) {
            tally(res, { row, key: tag, status: 'failed', reason: `Asset "${tag}" not found — import assets first` });
            continue;
        }

        const type = (r['readingtype'] || '').trim().toUpperCase();
        const date = parseDateValue(r['date']);
        const value = Number(r['value']);
        if (!type) { tally(res, { row, key: tag, status: 'failed', reason: 'Missing readingType' }); continue; }
        if (!date) { tally(res, { row, key: tag, status: 'failed', reason: `Unrecognised date "${r['date']}"` }); continue; }
        if (isNaN(value)) { tally(res, { row, key: tag, status: 'failed', reason: `Value "${r['value']}" is not a number` }); continue; }

        // Find-or-create the reading point.
        const dk = `${asset.id}::${type}`;
        let defId = defByKey.get(dk);
        if (!defId) {
            const { data, error } = await supabase
                .from('reading_definitions')
                .insert({
                    asset_id: asset.id,
                    reading_type_code: type,
                    name: `${type.charAt(0)}${type.slice(1).toLowerCase()} (imported)`,
                    unit: r['unit'] || null,
                })
                .select('id')
                .single();
            if (error) {
                tally(res, { row, key: tag, status: 'failed', reason: `Could not create reading point: ${error.message}` });
                continue;
            }
            defId = data.id as string;
            defByKey.set(dk, defId);
            pointsCreated += 1;
        }

        drafts.push({
            row, key: `${tag} ${type}`,
            log: {
                definition_id: defId,
                asset_id: asset.id,
                reading_type_code: type,
                reading_value: value,
                reading_date: date,
                entered_by: 'import',
                notes: r['notes'] || null,
            },
        });
    }

    for (const part of chunk(drafts, READING_CHUNK)) {
        const { error } = await supabase.from('reading_logs').insert(part.map(d => d.log));
        if (error) {
            for (const d of part) {
                const { error: oneErr } = await supabase.from('reading_logs').insert(d.log);
                if (oneErr) tally(res, { row: d.row, key: d.key, status: 'failed', reason: oneErr.message });
                else tally(res, { row: d.row, key: d.key, status: 'inserted' });
            }
            continue;
        }
        for (const d of part) tally(res, { row: d.row, key: d.key, status: 'inserted' });
    }

    if (pointsCreated > 0) {
        res.notes!.push(`${pointsCreated} reading point${pointsCreated === 1 ? '' : 's'} created automatically. Set alarm limits on each asset's Readings tab.`);
    }
    return res;
}

// ───────────────────── Failure-code catalogs ─────────────────────

/** A code used by imported history that the catalog cannot decode. */
export interface UnresolvedCode { category: string; code: string; uses: number }

/**
 * Every failure code in wo_failure_data that has no catalog entry.
 *
 * These are invisible failures: nothing rejects an unknown code on insert, and
 * the semantic layer LEFT JOINs the catalog, so the record counts as "coded"
 * while decoding to blank. This is what makes coverage statistics lie.
 */
export async function findUnresolvedFailureCodes(): Promise<UnresolvedCode[]> {
    const [{ data: coded }, { data: catalog }] = await Promise.all([
        supabase.from('wo_failure_data').select('failure_mode_code, failure_cause_code, remedy_code'),
        supabase.from('reference_codes_effective').select('category, code'),
    ]);

    const known = new Set((catalog ?? []).map(c => `${c.category}|${c.code}`));
    const counts = new Map<string, UnresolvedCode>();

    const note = (category: string, code: string | null) => {
        const c = (code ?? '').trim();
        if (!c || c.toUpperCase() === 'UNKNOWN') return;
        if (known.has(`${category}|${c}`)) return;
        const key = `${category}|${c}`;
        const hit = counts.get(key);
        if (hit) hit.uses += 1;
        else counts.set(key, { category, code: c, uses: 1 });
    };

    for (const r of coded ?? []) {
        note('FAILURE_MODE', r.failure_mode_code);
        note('FAILURE_CAUSE', r.failure_cause_code);
        note('REMEDY_CODE', r.remedy_code);
    }
    return [...counts.values()].sort((a, b) => b.uses - a.uses || a.code.localeCompare(b.code));
}

/**
 * Load a failure-code catalog. Upserts on (category, code) — the table's own
 * unique key — so re-importing a corrected sheet updates descriptions instead
 * of duplicating codes.
 */
export async function importFailureCodes(rows: Row[]): Promise<ImportResult> {
    const res = emptyResult();
    if (rows.length === 0) return res;

    const unresolvedBefore = await findUnresolvedFailureCodes().catch(() => []);

    const { data: existing } = await supabase.from('reference_codes_effective').select('category, code');
    const known = new Set((existing ?? []).map(c => `${c.category}|${c.code}`));

    interface Draft { row: number; key: string; payload: Record<string, unknown> }
    const drafts: Draft[] = [];

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const row = rowNum(r, i + 2);
        const category = (r['category'] || '').trim().toUpperCase();
        const code = (r['code'] || '').trim();
        const description = (r['description'] || '').trim();

        if (!category) { tally(res, { row, status: 'failed', reason: 'Missing category' }); continue; }
        if (!code) { tally(res, { row, key: category, status: 'failed', reason: 'Missing code' }); continue; }
        if (!description) { tally(res, { row, key: `${category} ${code}`, status: 'failed', reason: 'Missing description — an undescribed code is no more useful than an uncatalogued one' }); continue; }

        drafts.push({
            row,
            key: `${category} ${code}`,
            payload: {
                category,
                code,
                description,
                active: !['no', 'false', 'n'].includes((r['active'] || 'yes').toLowerCase()),
            },
        });
    }

    for (const part of chunk(drafts, LOOKUP_CHUNK)) {
        const { error } = await supabase
            .from('reference_codes')
            .upsert(part.map(d => d.payload), { onConflict: 'company_id,category,code' });

        if (error) {
            // reference_codes writes are admin-only; say so rather than
            // reporting a bare permission error per row.
            const denied = error.code === '42501';
            for (const d of part) {
                tally(res, {
                    row: d.row, key: d.key, status: 'failed',
                    reason: denied ? 'Administrator rights are required to load a code catalog' : error.message,
                });
            }
            if (denied) break;
            continue;
        }
        for (const d of part) {
            const updated = known.has(`${d.payload.category}|${d.payload.code}`);
            tally(res, {
                row: d.row, key: d.key,
                status: 'inserted',
                reason: updated ? 'description updated' : undefined,
            });
        }
    }

    // What the import actually bought: how much of the existing history now decodes.
    if (res.inserted > 0) {
        const after = await findUnresolvedFailureCodes().catch(() => null);
        if (after) {
            const fixed = unresolvedBefore.length - after.length;
            if (fixed > 0) {
                res.notes!.push(`${fixed} code(s) used by your existing history now resolve.`);
            }
            if (after.length > 0) {
                const top = after.slice(0, 3).map(u => `${u.code} (${u.uses}×)`).join(', ');
                res.notes!.push(`${after.length} code(s) in your history still have no catalog entry — e.g. ${top}.`);
            } else if (unresolvedBefore.length > 0) {
                res.notes!.push('Every failure code in your history now resolves.');
            }
        }
    }

    return res;
}

export const bulkImportService = { importAssets, importReadings, importFailureCodes, findUnresolvedFailureCodes };

// Exported for unit tests — pure ordering logic, no I/O.
export const __testables = { chunk };

export type { ImportResult, RowOutcome };
