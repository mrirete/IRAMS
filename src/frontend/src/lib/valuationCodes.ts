/**
 * Coded findings for condition readings — SAP PM "valuation codes".
 *
 * A reading is a number; a finding is what the technician SAW while taking it
 * ("leaking", "abnormal noise"). Coding the observation instead of free text
 * makes findings countable: top findings per asset class, finding ↔ alarm
 * correlation, "every HOT finding on this pump preceded a failure".
 *
 * The catalog is deliberately code-side (no dictionary/seed dependency): every
 * site gets the same ISO 14224-flavoured observation set. `tone` drives the UI
 * chip colour and hints urgency — it is NOT an alarm level; alarm levels come
 * from the reading value vs its bands (readingAlarm.ts).
 */

export interface ValuationCode {
    code: string;
    label: string;
    tone: 'ok' | 'watch' | 'action';
}

export const VALUATION_CODES: ValuationCode[] = [
    { code: 'OK', label: 'Normal / as expected', tone: 'ok' },
    { code: 'NOISE', label: 'Abnormal noise', tone: 'watch' },
    { code: 'VIBR', label: 'Excessive vibration', tone: 'watch' },
    { code: 'HOT', label: 'Running hot', tone: 'watch' },
    { code: 'DIRTY', label: 'Dirty / blocked', tone: 'watch' },
    { code: 'CORR', label: 'Corrosion visible', tone: 'watch' },
    { code: 'LEAK', label: 'Leaking', tone: 'action' },
    { code: 'LOOSE', label: 'Loose / worn parts', tone: 'action' },
    { code: 'DAMAGE', label: 'Visible damage', tone: 'action' },
];

export const valuationByCode = (code?: string | null): ValuationCode | undefined =>
    code ? VALUATION_CODES.find(v => v.code === code) : undefined;

/** Chip classes per tone — kept here so every surface renders findings alike. */
export const VALUATION_TONE_CLASSES: Record<ValuationCode['tone'], string> = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    watch: 'bg-amber-50 text-amber-700 border-amber-200',
    action: 'bg-red-50 text-red-700 border-red-200',
};
