/**
 * Fiscal year and money formatting for the finance screens — the same rule
 * the database uses (0396 ers_fiscal_year_for):
 *
 *   a fiscal year is labelled by the calendar year it STARTS in.
 *   start = 4 (April):  Apr 2026 – Mar 2027 is FY 2026, shown "FY 2026/27".
 *   start = 1 (default): the label is the calendar year, shown "FY 2026".
 *
 * The tenant's start month and currency live in Admin › Settings
 * (companies.app_settings). SettingsContext pushes them here when they load,
 * so services that have no React context (FinOpsService) can ask for "the
 * current fiscal year" without threading settings through every call.
 * Display only — one currency per tenant, no conversion.
 */

let fyStart = 1;
let currencySymbol = '$';
let currency = 'USD';
let locale: string | undefined = undefined;

export function configureFinance(opts: { fiscalYearStart?: number; currency?: string; currencySymbol?: string; locale?: string }) {
  if (opts.currency) currency = opts.currency;
  if (opts.fiscalYearStart && opts.fiscalYearStart >= 1 && opts.fiscalYearStart <= 12) fyStart = Math.round(opts.fiscalYearStart);
  if (opts.currencySymbol) currencySymbol = opts.currencySymbol;
  if (opts.locale) locale = opts.locale;
}

export function fiscalYearStart(): number { return fyStart; }

/** Fiscal-year label for a date (or YYYY-MM-DD). */
export function fiscalYearOf(d: Date | string = new Date(), start = fyStart): number {
  const { y, m } = ym(d);
  return m >= start ? y : y - 1;
}

/** 1-based period within the fiscal year (April = 1 for an April start). */
export function fiscalPeriodOf(d: Date | string = new Date(), start = fyStart): number {
  const { m } = ym(d);
  return ((m - start + 12) % 12) + 1;
}

export function currentFiscalYear(): number { return fiscalYearOf(new Date()); }
export function currentFiscalPeriod(): number { return fiscalPeriodOf(new Date()); }

/** "FY 2026" for a January start, "FY 2026/27" otherwise. */
export function fiscalYearLabel(fy: number, start = fyStart): string {
  return start === 1 ? `FY ${fy}` : `FY ${fy}/${String((fy + 1) % 100).padStart(2, '0')}`;
}

/** First day (YYYY-MM-DD) of a fiscal year, and the first day of the next. */
export function fiscalYearBounds(fy: number, start = fyStart): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${fy}-${pad(start)}-01`, to: `${fy + 1}-${pad(start)}-01` };
}

/** Calendar month name of a fiscal period ("Apr" for period 1 of an April year). */
export function fiscalPeriodMonthName(period: number, start = fyStart): string {
  const m = ((start - 1 + period - 1) % 12);
  return new Date(2000, m, 1).toLocaleDateString(locale, { month: 'short' });
}

/** Money in the tenant's currency. Whole units by default (finance screens). */
export function money(n: number | null | undefined, opts: { decimals?: number; fallback?: string } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return opts.fallback ?? '—';
  const d = opts.decimals ?? 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}${currencySymbol}${Math.abs(n).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** Compact money for tiles: 1.2M / 340K. */
export function moneyCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}${currencySymbol}${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}${currencySymbol}${(a / 1_000).toFixed(1)}K`;
  return money(n);
}

export function currencySym(): string { return currencySymbol; }
export function currencyCode(): string { return currency; }

function ym(d: Date | string): { y: number; m: number } {
  if (typeof d === 'string') {
    const mt = /^(\d{4})-(\d{2})/.exec(d);
    if (mt) return { y: Number(mt[1]), m: Number(mt[2]) };
    d = new Date(d);
  }
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}
