/**
 * Money formatting with an explicit currency — no more hardcoded `$`.
 *
 * The document's own currency wins (PO/invoice carry one); callers without a
 * document currency pass the company currency. USD only as the last resort.
 * Intl handles symbol placement and decimals per currency; an unknown code
 * degrades to `CODE 1,234.50` rather than throwing.
 */
export function fmtMoney(n: number, currency?: string | null): string {
    const code = (currency || 'USD').toUpperCase().slice(0, 3);
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n);
    } catch {
        return `${code} ${n.toFixed(2)}`;
    }
}
