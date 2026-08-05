/**
 * importTypes — the honest-result contract shared by every bulk-import handler.
 *
 * Before this, handlers returned void and the modal reported the *pre-flight*
 * valid-row count as "successfully imported", so per-row DB failures were
 * invisible (they were only console.error'd). Every handler now reports what
 * actually happened, row by row, and the modal renders those numbers.
 */

export type RowStatus = 'inserted' | 'updated' | 'skipped' | 'failed';

export interface RowOutcome {
    /** 1-based row number as it appears in the spreadsheet (header is row 1). */
    row: number;
    /** Natural key for the row — asset tag, part number, contact code… */
    key?: string;
    status: RowStatus;
    /** Why it was skipped or failed. Also carries soft notes on inserted rows. */
    reason?: string;
}

export interface ImportResult {
    inserted: number;
    /**
     * Rows that matched an existing record and were changed rather than
     * created. Only a sync-mode import produces these — a one-time migration
     * skips what already exists. Counted apart from `inserted` because
     * "352 imported" reads as 352 new records, and reporting 340 overwrites
     * that way is exactly the dishonesty this contract exists to stop.
     */
    updated: number;
    skipped: number;
    failed: number;
    outcomes: RowOutcome[];
    /** Batch-level notes (e.g. "provenance not recorded — admin rights required"). */
    notes?: string[];
}

export const emptyResult = (): ImportResult =>
    ({ inserted: 0, updated: 0, skipped: 0, failed: 0, outcomes: [], notes: [] });

/** Tally outcomes into a result. Mutates and returns `res` for chaining. */
export const tally = (res: ImportResult, outcome: RowOutcome): ImportResult => {
    res.outcomes.push(outcome);
    if (outcome.status === 'inserted') res.inserted += 1;
    else if (outcome.status === 'updated') res.updated += 1;
    else if (outcome.status === 'skipped') res.skipped += 1;
    else res.failed += 1;
    return res;
};

/** Postgres unique-violation — treated as a per-row failure, never a batch abort. */
export const isUniqueViolation = (err: unknown): boolean =>
    !!err && typeof err === 'object' && (err as { code?: string }).code === '23505';

export const errMessage = (err: unknown): string =>
    err instanceof Error ? err.message
        : (err && typeof err === 'object' && 'message' in err) ? String((err as { message: unknown }).message)
            : String(err);

/** Failure/skip rows as a CSV the user can hand back to their data owner. */
export const outcomesToCsv = (result: ImportResult): string => {
    const rows = result.outcomes.filter((o) => o.status !== 'inserted');
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return [
        'row,key,status,reason',
        ...rows.map((o) => [o.row, esc(o.key ?? ''), o.status, esc(o.reason ?? '')].join(',')),
    ].join('\n');
};
