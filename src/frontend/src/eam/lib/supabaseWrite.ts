/**
 * Checked PostgREST writes.
 *
 * `supabase.from(x).insert(y)` resolves with `{ error }` instead of rejecting,
 * so `await`ing one inside a try/catch looks safe and catches nothing — an RLS
 * denial, a constraint violation and a network failure all pass straight
 * through. The result is a UI that reports success over a write that never
 * happened; stock that was issued but never transacted, an audit record that
 * does not exist, a work order generated without its labour and parts.
 *
 * Use `mustWrite` when the caller can surface a failure, and `tryWrite` for
 * genuinely best-effort work, which still logs loudly rather than vanishing.
 */

type WriteResult = { error: { message: string; code?: string } | null };

/** Await a write and throw with context if it failed. */
export async function mustWrite(
    op: PromiseLike<WriteResult>,
    what: string,
): Promise<void> {
    const { error } = await op;
    if (error) {
        const code = error.code ? ` [${error.code}]` : '';
        throw new Error(`${what} failed${code}: ${error.message}`);
    }
}

/**
 * Await a best-effort write. Returns whether it succeeded and logs an error
 * when it did not — never silent, never fatal. Callers that report status to a
 * user should use the return value rather than assuming success.
 */
export async function tryWrite(
    op: PromiseLike<WriteResult>,
    what: string,
): Promise<boolean> {
    try {
        const { error } = await op;
        if (error) {
            console.error(`[write] ${what} failed [${error.code ?? '—'}]: ${error.message}`);
            return false;
        }
        return true;
    } catch (e) {
        console.error(`[write] ${what} threw:`, e);
        return false;
    }
}
