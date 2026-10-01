/**
 * Depreciation engine — pure, monthly.
 *
 * Every method is expressed per MONTH over a remaining life in months, so
 * that (1) the monthly posting run and the annual projection agree to the
 * cent, (2) the first fiscal year is pro-rata from the month the asset went
 * into service, (3) a fractional life (30 months) is exact rather than
 * "ceil(2.5) years", and (4) after a capital event the carrying amount is
 * spread over the REMAINING life instead of restarting from cost.
 *
 * Conventions (documented, deliberate):
 *  - full-month: the in-service month counts as a whole month.
 *  - DECLINING_BALANCE is double-declining (rate 2/life) and switches to
 *    straight-line on the remaining balance the month that gives more, so the
 *    asset reaches salvage by end of life instead of asymptotically.
 *  - SUM_OF_YEARS_DIGITS is applied to months (SYD over the remaining months).
 *  - UNITS_OF_PRODUCTION has no usage forecast, so a projection is the
 *    straight-line equivalent; the monthly posting uses the same when no
 *    period usage is supplied.
 */

export type DepreciationMethod = 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'UNITS_OF_PRODUCTION' | 'SUM_OF_YEARS_DIGITS';

export interface MonthlyInput {
  method: DepreciationMethod;
  /** carrying value at the start of the month */
  bookValue: number;
  salvage: number;
  /** total useful life in months (the DDB rate is 2/life) */
  lifeMonths: number;
  /** months still to depreciate, including this one */
  remainingMonths: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Expense for ONE month. Never below zero, never past salvage. */
export function monthlyExpense(i: MonthlyInput): number {
  const depreciable = Math.max(0, i.bookValue - i.salvage);
  if (depreciable <= 0 || i.remainingMonths <= 0) return 0;
  const sl = depreciable / i.remainingMonths;
  let e: number;
  switch (i.method) {
    case 'DECLINING_BALANCE': {
      const ddb = i.bookValue * (2 / Math.max(1, i.lifeMonths));
      e = Math.max(ddb, sl); // switch to straight-line when it gives more
      break;
    }
    case 'SUM_OF_YEARS_DIGITS': {
      const n = i.remainingMonths;
      e = depreciable * (n / ((n * (n + 1)) / 2)); // = 2/(n+1) of the remaining
      break;
    }
    case 'UNITS_OF_PRODUCTION':
    case 'STRAIGHT_LINE':
    default:
      e = sl;
  }
  return round2(Math.min(e, depreciable));
}

export interface ProjectionInput {
  method: DepreciationMethod;
  cost: number;
  salvage: number;
  lifeMonths: number;
  /** YYYY-MM-DD the book started (in-service date) */
  startDate: string;
  /** already posted: carrying value and accumulated so far, and the CALENDAR year/month of the last posting */
  posted?: { bookValue: number; accumulated: number; lastFiscalYear: number; lastPeriod: number } | null;
  /** fiscal-year start month (1-12); rows are grouped by fiscal year. Default January. */
  fiscalStart?: number;
}

export interface YearRow {
  period: number;      // 1-based year index of the projection
  fiscalYear: number;
  months: number;      // months depreciated in that fiscal year (pro-rata first/last)
  openingBookValue: number;
  depreciationExpense: number;
  accumulatedDepreciation: number;
  closingBookValue: number;
}

/** Months from startDate (inclusive) to the given month (inclusive). */
export function monthsBetween(startDate: string, fiscalYear: number, period: number): number {
  const [sy, sm] = startDate.slice(0, 10).split('-').map(Number);
  return (fiscalYear - sy) * 12 + (period - sm) + 1;
}

/**
 * Annual projection, aggregated from months. When `posted` is given the
 * projection starts the month after the last posting from the posted
 * carrying value over the remaining life — which is exactly what a capital
 * event needs (new gross value, depreciation to date untouched).
 */
export function projectAnnual(p: ProjectionInput): YearRow[] {
  const [sy, sm] = p.startDate.slice(0, 10).split('-').map(Number);
  if (!sy || !sm || !(p.lifeMonths > 0)) return [];

  let year = sy, month = sm;
  let value = p.cost;
  let accumulated = 0;
  let elapsed = 0;
  if (p.posted) {
    elapsed = Math.max(0, monthsBetween(p.startDate, p.posted.lastFiscalYear, p.posted.lastPeriod));
    value = p.posted.bookValue;
    accumulated = p.posted.accumulated;
    year = p.posted.lastFiscalYear;
    month = p.posted.lastPeriod + 1;
    if (month > 12) { month = 1; year += 1; }
  }
  let remaining = p.lifeMonths - elapsed;
  if (remaining <= 0) return [];

  // Group months by FISCAL year (labelled by the calendar year it starts in,
  // the same rule as 0396 ers_fiscal_year_for).
  const fs = p.fiscalStart && p.fiscalStart >= 1 && p.fiscalStart <= 12 ? p.fiscalStart : 1;
  const fyOf = (y: number, m: number) => (m >= fs ? y : y - 1);

  const rows: YearRow[] = [];
  let periodIdx = 0;
  let guard = 0;
  while (remaining > 0 && value - p.salvage > 0.005 && guard++ < 1200) {
    const opening = value;
    let expense = 0;
    let months = 0;
    const fy = fyOf(year, month);
    while (fyOf(year, month) === fy && remaining > 0 && value - p.salvage > 0.005) {
      const e = monthlyExpense({ method: p.method, bookValue: value, salvage: p.salvage, lifeMonths: p.lifeMonths, remainingMonths: remaining });
      value = round2(value - e);
      accumulated = round2(accumulated + e);
      expense = round2(expense + e);
      months += 1;
      remaining -= 1;
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    periodIdx += 1;
    rows.push({ period: periodIdx, fiscalYear: fy, months, openingBookValue: round2(opening), depreciationExpense: expense, accumulatedDepreciation: accumulated, closingBookValue: value });
    if (fyOf(year, month) === fy) break; // life ended mid-year
  }
  return rows;
}
