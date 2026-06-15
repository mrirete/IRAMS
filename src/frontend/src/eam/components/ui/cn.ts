/**
 * cn — tiny className joiner (clsx-lite).
 * Filters out falsy values so conditional classes stay readable:
 *   cn('btn', isActive && 'btn-active', size === 'sm' && 'btn-sm')
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
    return parts.filter(Boolean).join(' ');
}
