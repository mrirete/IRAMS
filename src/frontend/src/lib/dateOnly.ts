/**
 * Date-only values (YYYY-MM-DD from a Postgres `date` column) rendered in the
 * viewer's locale WITHOUT the UTC shift. `new Date('2026-03-01')` is midnight
 * UTC, which toLocaleDateString() shows as 28 Feb anywhere west of Greenwich —
 * every warranty and policy date on the Financials tab was one day early for
 * US users.
 */
export function parseDateOnly(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? null : d; }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDateOnly(s: string | null | undefined, fallback = '—'): string {
  const d = parseDateOnly(s);
  return d ? d.toLocaleDateString() : fallback;
}

/** Today as YYYY-MM-DD in LOCAL time (toISOString() would give the UTC date). */
export function todayDateOnly(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
