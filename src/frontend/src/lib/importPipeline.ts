// importPipeline — pure, deterministic core of the CMMS import wizard.
// The cmms_analyst agent PROPOSES an ImportMapping (see agent-run/agents.ts);
// a human confirms/edits it; this module APPLIES it: header resolution, value
// translation, date/cost parsing, row validation, and the data-quality report.
// No I/O here — parsing the file (xlsx) and writing rows (ImportService) live
// at the edges. Tools compute; this is the tool.

export type FileKind = 'assets' | 'work_orders' | 'combined';
export type DateFormat = 'ISO' | 'DMY' | 'MDY' | 'auto';

export interface ImportMapping {
  file_kind: FileKind;
  source_system_guess?: string;
  confidence?: number;
  asset_fields: Partial<Record<AssetField, string | null>>;
  wo_fields: Partial<Record<WoField, string | null>>;
  value_maps: {
    type?: Record<string, string>;
    status?: Record<string, string>;
    criticality?: Record<string, string>;
  };
  date_format?: DateFormat;
  unmapped_headers?: string[];
  warnings?: string[];
}

export type AssetField =
  | 'tag' | 'equipment_number' | 'functional_location' | 'name' | 'criticality'
  | 'manufacturer' | 'model' | 'serial_number' | 'asset_category';

export type WoField =
  | 'wo_number' | 'title' | 'description' | 'type' | 'status' | 'priority'
  | 'asset_tag' | 'asset_location' | 'asset_name' | 'created_at' | 'closed_at'
  | 'labor_cost' | 'material_cost' | 'total_cost' | 'downtime_hours'
  | 'labor_hours' | 'breakdown' | 'malfunction_start' | 'malfunction_end'
  | 'failure_mode' | 'failure_cause' | 'remedy';

export interface AssetDraft {
  tag: string;                        // field tag (SAP TIDNR when present)
  equipment_number: string | null;    // source CMMS object identity (SAP EQUNR, Maximo ASSETNUM)
  functional_location: string | null; // SAP TPLNR path — kept as a property (the flat importer builds no tree)
  name: string;
  criticality: 'A' | 'B' | 'C' | 'D' | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  asset_category: string | null;
}

export interface WoDraft {
  wo_number: string;
  title: string;
  description: string | null;
  type: string;             // CM | PM | PdM | INSPECTION | SAFETY
  status: string;           // CLOSED | TECO | OPEN | WIP | CANCELLED
  priority: string | null;
  asset_tag: string;
  created_at: string;       // ISO
  closed_at: string | null; // ISO
  labor_cost: number;
  material_cost: number;
  downtime_hours: number | null;
  labor_hours: number | null;       // actual work hours (SAP "Actual work", Maximo ACTLABHRS)
  breakdown: boolean | null;        // SAP MSAUS indicator; null = not recorded (honest legacy state)
  malfunction_start: string | null; // ISO — equipment failure event time (SAP AUSVN)
  malfunction_end: string | null;   // ISO — back in service (SAP AUSBS)
  failure_mode: string | null;
  failure_cause: string | null;
  remedy: string | null;
  source_row: number;       // 1-based data-row index for issue tracebacks
}

export interface DqIssue {
  kind: string;             // e.g. 'missing_date', 'bad_cost', 'duplicate_wo'
  message: string;
  rows: number[];           // sample of affected 1-based data rows (capped)
  count: number;
}

export interface AppliedImport {
  assets: AssetDraft[];
  workOrders: WoDraft[];
  issues: DqIssue[];
  skippedRows: number;
}

export interface DqReport {
  totals: { assets: number; work_orders: number; skipped_rows: number };
  coverage: {
    cost_pct: number;         // % of WOs carrying any cost
    closed_date_pct: number;  // % of WOs with a completion date
    failure_code_pct: number; // % of WOs with failure coding
    downtime_pct: number;     // % of WOs with downtime hours
    breakdown_pct: number;    // % of WOs with a recorded breakdown indicator (true OR false)
    labor_hours_pct: number;  // % of WOs with actual work hours
  };
  date_range: { from: string | null; to: string | null; months: number };
  issues: DqIssue[];
  warnings: string[];
}

// ── value canonicalisation ────────────────────────────────────────────────

const WO_TYPES = new Set(['CM', 'PM', 'PdM', 'INSPECTION', 'SAFETY']);
const WO_STATUSES = new Set(['CLOSED', 'TECO', 'OPEN', 'WIP', 'CANCELLED']);
const CRITICALITIES = new Set(['A', 'B', 'C', 'D']);

/** Fallback type heuristic for values the mapping's value_maps doesn't cover. */
export function guessWoType(raw: string): string {
  const v = raw.toLowerCase();
  if (/prev|pm\b|planned|routine/.test(v)) return 'PM';
  if (/pred|pdm|condition|vibra/.test(v)) return 'PdM';
  if (/insp|survey|check/.test(v)) return 'INSPECTION';
  if (/safe|hse|incident/.test(v)) return 'SAFETY';
  return 'CM'; // corrective is the conservative default for history
}

/** Fallback status heuristic: completed-looking → CLOSED, else OPEN. */
export function guessWoStatus(raw: string, hasClosedDate: boolean): string {
  const v = raw.toLowerCase();
  // Token-exact first: Maximo's CAN would otherwise never match (/canc/ needs
  // four letters), and a substring test on 'can' would false-positive 'scan'.
  const tokens = v.split(/[\s,;/|]+/);
  if (tokens.includes('can') || tokens.includes('cnl')) return 'CANCELLED';
  if (/clos|comp|done|teco|clsd|finish|fertig/.test(v)) return 'CLOSED';
  if (/canc|abgebr|deleted/.test(v)) return 'CANCELLED';
  if (/prog|wip|inprg|started|exec/.test(v)) return 'WIP';
  if (v.trim() === '' && hasClosedDate) return 'CLOSED';
  return hasClosedDate ? 'CLOSED' : 'OPEN';
}

// ── date parsing ──────────────────────────────────────────────────────────

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // Excel serial day 0

/** Parse one cell into an ISO timestamp, honouring the mapping's format hint. */
export function parseDateCell(cell: unknown, format: DateFormat = 'auto'): string | null {
  if (cell === null || cell === undefined || cell === '') return null;

  // Excel serial (SheetJS raw mode). Plausible window: 1990-01-01..2079.
  // Any other bare number is NOT a date — never fall through to string parsing.
  if (typeof cell === 'number') {
    if (cell > 32874 && cell < 65380) {
      return new Date(EXCEL_EPOCH_MS + cell * 86400_000).toISOString();
    }
    return null;
  }

  const s = String(cell).trim();
  if (!s || /^\d{1,6}$/.test(s)) return null; // bare digit runs are ids, not dates

  // ISO-ish (yyyy-mm-dd...) — trust Date parsing.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  // dd/mm/yyyy | mm/dd/yyyy | dd.mm.yyyy | dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    let day: number, month: number;
    if (a > 12) { day = a; month = b; }        // unambiguous DMY
    else if (b > 12) { day = b; month = a; }   // unambiguous MDY
    else if (format === 'MDY') { month = a; day = b; }
    else { day = a; month = b; }               // DMY default (SAP, most non-US)
    const d = new Date(Date.UTC(year, month - 1, day));
    if (isNaN(d.getTime()) || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return d.toISOString();
  }

  const d = new Date(s); // last resort: "13 May 2025", "May 13, 2025"
  if (isNaN(d.getTime())) return null;
  const yr = d.getUTCFullYear();
  return yr >= 1990 && yr <= 2079 ? d.toISOString() : null;
}

// ── boolean parsing ───────────────────────────────────────────────────────

/**
 * Breakdown-indicator cell → boolean | null. SAP exports a checkbox as "X";
 * other systems use Yes/No, Y/N, TRUE/FALSE, 1/0. Blank/unknown stays NULL —
 * "not recorded" must remain distinguishable from "recorded as no breakdown".
 */
export function parseBooleanCell(cell: unknown): boolean | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'boolean') return cell;
  const v = String(cell).trim().toLowerCase();
  if (!v) return null;
  if (['x', 'y', 'yes', 'true', '1'].includes(v)) return true;
  if (['n', 'no', 'false', '0', '-'].includes(v)) return false;
  return null;
}

// ── cost parsing ──────────────────────────────────────────────────────────

/** "₦1,234.50", "$ 1.234,50", "(500)" → number. Null when unparseable. */
export function parseCostCell(cell: unknown): number | null {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'number') return isFinite(cell) ? cell : null;
  let s = String(cell).trim().replace(/[^0-9.,()-]/g, '');
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[()-]/g, '');
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the later separator is the decimal point.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Comma only: a single comma with 1-2 trailing digits is a decimal
    // ("1234,5"); otherwise it's a thousands separator ("250,000").
    const decimals = s.length - lastComma - 1;
    const single = s.indexOf(',') === lastComma;
    if (single && decimals >= 1 && decimals <= 2) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

// ── mapping application ───────────────────────────────────────────────────

const ISSUE_ROW_SAMPLE = 8;

class IssueCollector {
  private map = new Map<string, DqIssue>();
  add(kind: string, message: string, row: number) {
    const cur = this.map.get(kind);
    if (cur) {
      cur.count += 1;
      if (cur.rows.length < ISSUE_ROW_SAMPLE) cur.rows.push(row);
    } else {
      this.map.set(kind, { kind, message, rows: [row], count: 1 });
    }
  }
  list(): DqIssue[] {
    return [...this.map.values()].sort((a, b) => b.count - a.count);
  }
}

function headerIndex(headers: string[], name: string | null | undefined): number {
  if (!name) return -1;
  const exact = headers.indexOf(name);
  if (exact >= 0) return exact;
  const norm = name.trim().toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === norm);
}

function cellStr(row: unknown[], idx: number): string {
  if (idx < 0) return '';
  const v = row[idx];
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * Apply a confirmed mapping to the parsed sheet. Deterministic; collects
 * per-row issues instead of throwing. Rows without the required keys
 * (asset tag / wo_number / created_at) are skipped and reported.
 */
export function applyMapping(
  headers: string[],
  rows: unknown[][],
  mapping: ImportMapping,
): AppliedImport {
  const issues = new IssueCollector();
  const fmt: DateFormat = mapping.date_format ?? 'auto';
  const af = mapping.asset_fields ?? {};
  const wf = mapping.wo_fields ?? {};
  const vmaps = mapping.value_maps ?? {};

  const ai = {
    tag: headerIndex(headers, af.tag),
    equipment_number: headerIndex(headers, af.equipment_number),
    functional_location: headerIndex(headers, af.functional_location),
    name: headerIndex(headers, af.name),
    criticality: headerIndex(headers, af.criticality),
    manufacturer: headerIndex(headers, af.manufacturer),
    model: headerIndex(headers, af.model),
    serial_number: headerIndex(headers, af.serial_number),
    asset_category: headerIndex(headers, af.asset_category),
  };
  const wi = Object.fromEntries(
    (Object.keys(wf) as WoField[]).map((k) => [k, headerIndex(headers, wf[k])]),
  ) as Record<WoField, number>;
  const w = (k: WoField): number => wi[k] ?? -1;

  const assetsByTag = new Map<string, AssetDraft>();
  const workOrders: WoDraft[] = [];
  const seenWoNumbers = new Set<string>();
  let skipped = 0;

  const isWoFile = mapping.file_kind === 'work_orders' || mapping.file_kind === 'combined';
  const isAssetFile = mapping.file_kind === 'assets' || mapping.file_kind === 'combined';

  const mapValue = (
    table: Record<string, string> | undefined,
    raw: string,
  ): string | null => {
    if (!raw) return null;
    if (table && Object.prototype.hasOwnProperty.call(table, raw)) return table[raw];
    // tolerate case/space drift between the agent's samples and the full file
    if (table) {
      const norm = raw.trim().toLowerCase();
      for (const k of Object.keys(table)) if (k.trim().toLowerCase() === norm) return table[k];
    }
    return null;
  };

  // SAP system status is MULTI-token — a real IW38 cell reads "TECO CNF PRC
  // SETC", so an exact map keyed on "TECO" never fires on the whole cell.
  // Try the full value first (covers single-token systems and combos the
  // agent mapped verbatim), then each token left-to-right — SAP prints the
  // primary status first, so the first mapped token is the right one.
  const mapStatusValue = (
    table: Record<string, string> | undefined,
    raw: string,
  ): string | null => {
    const whole = mapValue(table, raw);
    if (whole !== null) return whole;
    const tokens = raw.split(/[\s,;/|]+/).filter(Boolean);
    if (tokens.length < 2) return null;
    for (const t of tokens) {
      const hit = mapValue(table, t);
      if (hit !== null) return hit;
    }
    return null;
  };

  rows.forEach((row, i) => {
    const rowNo = i + 1;
    const isEmpty = row.every((c) => c === null || c === undefined || String(c).trim() === '');
    if (isEmpty) return;

    // Asset extraction — from asset files directly, or derived from WO rows.
    // Two identities per SAP practice: tag (TechIdentNo./functional location —
    // what's painted on the machine) and equipment_number (EQUNR — the CMMS's
    // own object id). External numbering collapses them into one: a row with
    // no tag cell but an equipment number uses that number as its tag.
    const tagIdx = isAssetFile && ai.tag >= 0 ? ai.tag : w('asset_tag');
    const equipNo = cellStr(row, ai.equipment_number) || null;
    // Position column: the asset file's own FL field, or the WO file's
    // location link (SAP "Functional Loc.", Maximo LOCATION).
    const location = (cellStr(row, ai.functional_location) || cellStr(row, w('asset_location'))) || null;
    let tag = cellStr(row, tagIdx) || (isAssetFile ? equipNo ?? '' : '');
    // Orders raised against a position with no equipment id are routine
    // (area work, Maximo location-only WOs). Link by the position rather
    // than dropping the history — the draft becomes a position-level asset.
    let linkedByLocation = false;
    if (!tag && isWoFile && location) { tag = location; linkedByLocation = true; }
    if (tag) {
      const existing = assetsByTag.get(tag);
      const rawCrit = cellStr(row, ai.criticality);
      const mappedCrit = mapValue(vmaps.criticality, rawCrit) ?? (CRITICALITIES.has(rawCrit.toUpperCase()) ? rawCrit.toUpperCase() : null);
      const draft: AssetDraft = {
        tag,
        equipment_number: equipNo || existing?.equipment_number || null,
        functional_location: location || existing?.functional_location || null,
        name: cellStr(row, ai.name) || cellStr(row, w('asset_name')) || existing?.name || tag,
        criticality: (mappedCrit && CRITICALITIES.has(mappedCrit) ? mappedCrit : existing?.criticality ?? null) as AssetDraft['criticality'],
        manufacturer: cellStr(row, ai.manufacturer) || existing?.manufacturer || null,
        model: cellStr(row, ai.model) || existing?.model || null,
        serial_number: cellStr(row, ai.serial_number) || existing?.serial_number || null,
        asset_category: cellStr(row, ai.asset_category) || existing?.asset_category || null,
      };
      assetsByTag.set(tag, draft);
    } else if (isAssetFile && !isWoFile) {
      issues.add('missing_tag', 'Row has no asset tag — skipped.', rowNo);
      skipped += 1;
      return;
    }

    if (!isWoFile) return;

    // Work-order extraction.
    const woNumber = cellStr(row, w('wo_number'));
    if (!woNumber) {
      issues.add('missing_wo_number', 'Row has no work-order number — skipped.', rowNo);
      skipped += 1;
      return;
    }
    if (!tag) {
      issues.add('missing_asset_link', 'Work order has no asset tag — skipped (cannot link to an asset).', rowNo);
      skipped += 1;
      return;
    }
    if (seenWoNumbers.has(woNumber)) {
      issues.add('duplicate_wo', 'Duplicate work-order number in file — first occurrence kept. (Operation/confirmation-level exports like SAP IW47/IW49 produce one row per operation; export one row per ORDER — IW38/IW39 — for full fidelity. Maximo multi-site exports repeat WONUM across sites; prefix it with SITEID.)', rowNo);
      skipped += 1;
      return;
    }

    const createdAt = parseDateCell(row[w('created_at')], fmt);
    if (!createdAt) {
      issues.add('missing_date', 'Work order has no parseable date — skipped (history needs real dates).', rowNo);
      skipped += 1;
      return;
    }
    const closedAt = w('closed_at') >= 0 ? parseDateCell(row[w('closed_at')], fmt) : null;

    const rawType = cellStr(row, w('type'));
    let type = mapValue(vmaps.type, rawType) ?? (rawType ? guessWoType(rawType) : 'CM');
    if (!WO_TYPES.has(type)) {
      issues.add('unmapped_type', `Unrecognised work type value(s) defaulted to CM.`, rowNo);
      type = 'CM';
    }

    const rawStatus = cellStr(row, w('status'));
    let status = mapStatusValue(vmaps.status, rawStatus) ?? guessWoStatus(rawStatus, !!closedAt);
    if (!WO_STATUSES.has(status)) {
      issues.add('unmapped_status', `Unrecognised status value(s) defaulted by completion date.`, rowNo);
      status = closedAt ? 'CLOSED' : 'OPEN';
    }

    const labor = w('labor_cost') >= 0 ? parseCostCell(row[w('labor_cost')]) : null;
    let material = w('material_cost') >= 0 ? parseCostCell(row[w('material_cost')]) : null;
    if (labor === null && material === null && w('total_cost') >= 0) {
      // Only a combined figure exists — keep the total (stored as material
      // component; sem_work_history's total_cost = labor + material).
      material = parseCostCell(row[w('total_cost')]);
    }
    if ((w('labor_cost') >= 0 || w('material_cost') >= 0 || w('total_cost') >= 0)
      && labor === null && material === null && (cellStr(row, w('labor_cost')) || cellStr(row, w('material_cost')) || cellStr(row, w('total_cost')))) {
      issues.add('bad_cost', 'Cost value could not be parsed — treated as 0.', rowNo);
    }

    const downtime = w('downtime_hours') >= 0 ? parseCostCell(row[w('downtime_hours')]) : null;
    const laborHours = w('labor_hours') >= 0 ? parseCostCell(row[w('labor_hours')]) : null;
    const breakdown = w('breakdown') >= 0 ? parseBooleanCell(row[w('breakdown')]) : null;
    // Malfunction window (SAP AUSVN/AUSBS): the true failure-event times —
    // preferred MTBF basis over paperwork dates (0283). Discard an inverted
    // window rather than importing negative outages.
    let malfStart = w('malfunction_start') >= 0 ? parseDateCell(row[w('malfunction_start')], fmt) : null;
    let malfEnd = w('malfunction_end') >= 0 ? parseDateCell(row[w('malfunction_end')], fmt) : null;
    if (malfStart && malfEnd && malfEnd < malfStart) {
      issues.add('bad_malfunction_window', 'Malfunction end precedes malfunction start — window dropped for this row.', rowNo);
      malfStart = null; malfEnd = null;
    }

    if (linkedByLocation) {
      issues.add('linked_by_location', 'Work order had no equipment id — linked by its location/functional location instead (a position-level asset is created).', rowNo);
    }
    seenWoNumbers.add(woNumber);
    workOrders.push({
      wo_number: woNumber,
      title: cellStr(row, w('title')) || cellStr(row, w('description')) || `${type} on ${tag}`,
      description: cellStr(row, w('description')) || null,
      type,
      status,
      priority: cellStr(row, w('priority')) || null,
      asset_tag: tag,
      created_at: createdAt,
      closed_at: closedAt,
      labor_cost: labor ?? 0,
      material_cost: material ?? 0,
      downtime_hours: downtime !== null && downtime >= 0 ? downtime : null,
      labor_hours: laborHours !== null && laborHours >= 0 ? laborHours : null,
      breakdown,
      malfunction_start: malfStart,
      malfunction_end: malfEnd,
      failure_mode: cellStr(row, w('failure_mode')) || null,
      failure_cause: cellStr(row, w('failure_cause')) || null,
      remedy: cellStr(row, w('remedy')) || null,
      source_row: rowNo,
    });
  });

  return {
    assets: [...assetsByTag.values()],
    workOrders,
    issues: issues.list(),
    skippedRows: skipped,
  };
}

// ── data-quality report ───────────────────────────────────────────────────

export function buildDqReport(applied: AppliedImport): DqReport {
  const wos = applied.workOrders;
  const n = wos.length || 1;
  const pct = (k: (w: WoDraft) => boolean) => Math.round((wos.filter(k).length / n) * 100);

  let from: string | null = null, to: string | null = null;
  for (const wo of wos) {
    if (!from || wo.created_at < from) from = wo.created_at;
    if (!to || wo.created_at > to) to = wo.created_at;
  }
  const months = from && to
    ? Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / (30.44 * 86400_000)))
    : 0;

  const warnings: string[] = [];
  if (wos.length && months < 12) {
    warnings.push(`History spans only ~${months} months — annualised figures (bad-actor cost/yr, PM waste) carry wide uncertainty; 12+ months unlocks confident annual rates.`);
  }
  const costPct = pct((w) => w.labor_cost + w.material_cost > 0);
  if (wos.length && costPct < 30) {
    warnings.push(`Only ${costPct}% of work orders carry cost data — money-ranked findings understate reality. Exporting cost fields from the source CMMS is the single most valuable data improvement.`);
  }
  const failPct = pct((w) => !!w.failure_mode || !!w.failure_cause);
  if (wos.length && failPct < 20) {
    warnings.push(`Only ${failPct}% of work orders carry failure coding — failure-mode analysis (RCM/RCA grounding) is limited until coding improves.`);
  }
  const breakdownPct = pct((w) => w.breakdown !== null);
  if (wos.length && breakdownPct === 0) {
    warnings.push('No breakdown indicator in the file — failure-event counting falls back to work type, which over-counts (not every corrective order is a functional failure). SAP: add the Breakdown column (MSAUS) to your layout.');
  }
  if (applied.assets.length && applied.assets.every((a) => !a.criticality)) {
    warnings.push('No criticality data found — assets default to unranked; a criticality assessment would sharpen every prioritisation in the report.');
  }
  // SAP internal numbering leaves EQUNR (a long digit run) as the only identity.
  // Importing those as tags builds a register nobody in the field recognises.
  // One equipment number, one asset. The same EQUNR under two different tags
  // would violate the DB's uniqueness at commit — flag it while it's cheap.
  const enCounts = new Map<string, number>();
  for (const a of applied.assets) {
    if (a.equipment_number) enCounts.set(a.equipment_number, (enCounts.get(a.equipment_number) ?? 0) + 1);
  }
  const dupEns = [...enCounts.entries()].filter(([, n]) => n > 1).map(([en]) => en);
  if (dupEns.length) {
    warnings.push(`Equipment number(s) ${dupEns.slice(0, 5).join(', ')}${dupEns.length > 5 ? ', …' : ''} appear under more than one tag — an equipment number identifies ONE physical asset; fix the source rows or the commit will be rejected.`);
  }
  // Strict majority: a few blank-TIDNR rows are normal; a mostly-digit
  // register means the Equipment column was mapped as the tag.
  const digitTags = applied.assets.filter((a) => /^\d{6,}$/.test(a.tag) && (!a.equipment_number || a.equipment_number === a.tag));
  if (digitTags.length && digitTags.length * 2 > applied.assets.length) {
    warnings.push(`${digitTags.length} asset tag(s) are long digit runs — these look like internal CMMS object ids (SAP EQUNR, Maximo autonumbered ASSETNUM), not field tags. Map the human tag column (SAP TechIdentNo., a Maximo alias/location) to Asset tag and the system id to Equipment number, so assets keep the tag technicians recognise; work-order history still links by either identity.`);
  }

  return {
    totals: {
      assets: applied.assets.length,
      work_orders: wos.length,
      skipped_rows: applied.skippedRows,
    },
    coverage: {
      cost_pct: wos.length ? costPct : 0,
      closed_date_pct: wos.length ? pct((w) => !!w.closed_at) : 0,
      failure_code_pct: wos.length ? failPct : 0,
      downtime_pct: wos.length ? pct((w) => w.downtime_hours !== null) : 0,
      breakdown_pct: wos.length ? breakdownPct : 0,
      labor_hours_pct: wos.length ? pct((w) => w.labor_hours !== null) : 0,
    },
    date_range: { from, to, months },
    issues: applied.issues,
    warnings,
  };
}

// ── mapping proposal parsing (agent → wizard) ─────────────────────────────

/** Extract the ```import-mapping``` fenced block from the agent's answer. */
export function parseMappingProposal(answer: string): { prose: string; mapping: ImportMapping | null } {
  const m = answer.match(/```import-mapping\s*([\s\S]*?)```/);
  if (!m) return { prose: answer.trim(), mapping: null };
  const prose = answer.replace(m[0], '').trim();
  try {
    const parsed = JSON.parse(m[1]);
    if (!parsed || typeof parsed !== 'object' || !parsed.file_kind) return { prose, mapping: null };
    const mapping: ImportMapping = {
      file_kind: ['assets', 'work_orders', 'combined'].includes(parsed.file_kind) ? parsed.file_kind : 'work_orders',
      source_system_guess: typeof parsed.source_system_guess === 'string' ? parsed.source_system_guess : 'unknown',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      asset_fields: parsed.asset_fields ?? {},
      wo_fields: parsed.wo_fields ?? {},
      value_maps: parsed.value_maps ?? {},
      date_format: ['ISO', 'DMY', 'MDY', 'auto'].includes(parsed.date_format) ? parsed.date_format : 'auto',
      unmapped_headers: Array.isArray(parsed.unmapped_headers) ? parsed.unmapped_headers : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
    return { prose, mapping };
  } catch {
    return { prose, mapping: null };
  }
}
