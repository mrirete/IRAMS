/**
 * scan-silent-success — find code that tells the user it worked without knowing
 * that it did.
 *
 * This defect class is worse than a crash. A crash gets reported; a false
 * success gets believed, and the damage surfaces months later as data nobody
 * can explain. Four instances shipped before this check existed:
 *
 *   • a PO line-item import that toasted "Imported 5 items (Mock)" and wrote nothing
 *   • "Import Complete!" showing the pre-flight row count while DB failures went to console
 *   • a PM save reporting success when the job plan (steps, JSA, labour, parts) had failed
 *   • a Criticality A gatekeeper rejection claiming "Audit trail logged" when the write failed
 *
 * Three patterns are reported:
 *
 *  1. SWALLOWED CATCH → SUCCESS
 *     A catch that only logs, followed by an unconditional success message.
 *
 *  2. UNCHECKED SUPABASE WRITE
 *     insert/update/upsert/delete whose { error } is never read. PostgREST
 *     resolves rather than throwing, so a try/catch around one of these is
 *     decoration — an RLS denial passes straight through it.
 *
 *  3. UPDATE/DELETE CLAIMING SUCCESS WITHOUT COUNTING ROWS
 *     Reading { error } is necessary but NOT sufficient for update and delete,
 *     because RLS refuses those two silently:
 *
 *         CREATE POLICY ... ON companies FOR UPDATE USING (public.is_admin());
 *
 *     A USING clause FILTERS rather than rejects. Postgres rewrites the
 *     statement as "…and also is_admin()", the row drops out of scope, and the
 *     update succeeds against nothing — UPDATE 0. Zero rows is not an error, so
 *     the client gets `error === null, data === []` and a success branch that
 *     only tests `error` runs happily. Measured on a real non-admin: HTTP 200,
 *     0 rows, no error.
 *
 *     RLS is asymmetric, which is what catches people out:
 *         INSERT         → WITH CHECK → throws 42501, loud
 *         UPDATE/DELETE  → USING      → zero rows, silent
 *     Learn RLS through inserts and you learn "denials throw" — then that quietly
 *     stops being true.
 *
 *     Counting rows requires asking for them back: `.update(…).select('id')`
 *     then `if (!data?.length)`. Without the select there is nothing to count.
 *     (upsert can hit the same trap on its update half; it is not flagged here
 *     because its insert half legitimately throws, so judge those by hand.)
 *
 * Usage:  node scripts/scan-silent-success.mjs [--strict] [--self-test]
 *         --strict     exits 1 on any finding (for CI).
 *         --self-test  runs the rules against inline fixtures and exits 1 if a
 *                      rule has stopped biting. Worth running in CI too: a
 *                      detector that quietly matches nothing reports "0
 *                      findings", which reads exactly like success.
 *
 * A genuine exception can be marked with a trailing comment:
 *     // silent-success-ok: <reason>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STRICT = process.argv.includes('--strict');
const SELF_TEST = process.argv.includes('--self-test');
const ROOT = 'src';
const ALLOW = /silent-success-ok/;

const files = [];
if (!SELF_TEST) {
    (function walk(dir) {
        for (const entry of readdirSync(dir)) {
            const p = join(dir, entry);
            if (statSync(p).isDirectory()) {
                if (!/node_modules|dist|\.git/.test(p)) walk(p);
            } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.spec\./.test(entry)) {
                files.push(p.replace(/\\/g, '/'));
            }
        }
    })(ROOT);
}

const swallowed = [];
const unchecked = [];
const uncounted = [];

/**
 * Collect the rest of the enclosing block from `start`, stopping when the
 * brace depth goes negative (we left it). Keeps look-ahead inside the function
 * that actually performed the write — a success toast in the next function down
 * is unrelated, which is where this file's earlier false positives came from.
 */
function restOfBlock(lines, start, max = 30) {
    const out = [];
    let depth = 0;
    for (let k = start; k < lines.length && out.length < max; k++) {
        const l = lines[k];
        depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        out.push(l);
        if (depth < 0) break;
    }
    return out;
}

/**
 * Drop comments before matching. Without this a passing remark silences a real
 * finding — a comment reading "no count." was enough to suppress this rule
 * entirely while it was being written. Leaves `https://` alone.
 */
const stripComments = (l) =>
    l.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/, '$1');

/**
 * The write statement itself: the destructure line above, then forward only to
 * the semicolon that ends it. A fixed ±N window bleeds into the NEXT function,
 * where an unrelated `!data?.length` suppresses this call's finding — the same
 * leak pattern 1 already documents.
 */
function statementAt(lines, i, max = 8) {
    const out = [lines[i - 1] ?? ''];
    for (let k = i; k < Math.min(lines.length, i + max); k++) {
        out.push(lines[k]);
        if (/;\s*$/.test(lines[k].trim())) break;
    }
    return out.map(stripComments).join('\n');
}

/**
 * A conclusion that the write worked — shown to the user, returned to the
 * caller, or merely logged. The success words are matched ANYWHERE inside a
 * string literal, not just at its start: the first version of this rule anchored
 * them and so walked straight past
 *     console.log('[updateAsset] ✅ Saved successfully for asset:', id)
 * which is exactly the shape being hunted.
 */
const CLAIMS_SUCCESS = new RegExp([
    /showToast\([^;]*['"]success['"]/,
    /\bok\s*:\s*true/,
    /set(Saved|Success|Done|Complete)\(\s*true\s*\)/,
    /['"][^'"]*\b(Saved|Updated|Deleted|Removed|Success(fully)?)\b[^'"]*['"]/i,
].map(r => r.source).join('|'));

function scanSource(file, source) {
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // ── Pattern 1: swallowed catch → unconditional success ──────────
        if (/catch\s*\(/.test(line)) {
            let body = [], j = i + 1, depth = 1;
            while (j < lines.length && depth > 0 && body.length < 14) {
                const l = lines[j];
                depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
                if (depth > 0) body.push(l);
                j++;
            }
            const text = body.join('\n');
            const onlyLogs = /console\.(warn|error|log)/.test(text);
            // A catch that records the failure anywhere — rethrows, flags a
            // variable, pushes an outcome — is handled. Only a catch whose
            // entire body is a log leaves the caller none the wiser.
            const handles = /(return|throw|setError|showToast|alert|tally|reject)/.test(text)
                || /^\s*[A-Za-z_$][\w.$]*\s*(=|\.push\()/m.test(text.replace(/console\.[^\n]*/g, ''));
            if (onlyLogs && !handles && !ALLOW.test(text)) {
                // Only look within the function that contains the catch. A
                // success toast in the *next* function is unrelated — most of
                // this rule's false positives were read-path loaders sitting
                // above an unrelated save handler.
                const ahead = [];
                let depth2 = 0;
                for (let k = j; k < lines.length && ahead.length < 40; k++) {
                    const l = lines[k];
                    depth2 += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
                    ahead.push(l);
                    if (depth2 < 0) break;      // left the enclosing block
                }
                const idx = ahead.findIndex(l =>
                    /showToast\([^;]*['"]success['"]/.test(l)
                    // A conditional severity is honest reporting, not a false
                    // claim: `deleted === ids.length ? 'success' : 'warning'`.
                    && !/\?[^;]*['"](warning|error)['"]/.test(l)
                    && !/['"](warning|error)['"][^;]*:/.test(l)
                );
                if (idx >= 0 && !ALLOW.test(ahead[idx])) {
                    swallowed.push({
                        file, line: i + 1,
                        detail: (body.map(s => s.trim()).filter(Boolean)[0] || '(empty)').slice(0, 72),
                        then: ahead[idx].trim().slice(0, 72),
                    });
                }
            }
        }

        // ── Pattern 2: supabase write whose error is never read ─────────
        const write = line.match(/(?:await\s+)?supabase[\s\S]{0,80}?\.(insert|update|upsert|delete)\(/);
        if (write) {
            // The destructure may sit on this line or the one that opened the call.
            const context = [lines[i - 1] ?? '', line].join('\n');
            const reads = /\{\s*(data\s*:|error|data\s*,)/.test(context) || /\.select\(/.test(line);
            // Or the result is assigned and inspected shortly after.
            const ahead = lines.slice(i, i + 6).join('\n');
            const inspected = /\berror\b/.test(ahead) || /throwOnError\(\)/.test(ahead);
            if (!reads && !inspected && !ALLOW.test(context) && !ALLOW.test(ahead)) {
                unchecked.push({ file, line: i + 1, detail: line.trim().slice(0, 84) });
            }
        }

        // ── Pattern 3: update/delete that claims success without counting ──
        // Deliberately NOT insert/upsert: an insert denial violates WITH CHECK
        // and throws, so pattern 2 already covers it. Only update and delete
        // are refused by a USING filter, which is silent.
        const mut = line.match(/(?:await\s+)?supabase[\s\S]{0,80}?\.(update|delete)\(/);
        if (mut) {
            const stmt = statementAt(lines, i);          // the call chain, comment-free
            const asksForRows = /\.select\(/.test(stmt);

            const after = restOfBlock(lines, i);         // enclosing block only
            const scrubbed = after.map(stripComments);

            // Any inspection of how many rows came back counts as handled.
            const countsRows = /data\s*(\?\.|\.)\s*length|!\s*data\b|data\s*\[\s*0\s*\]|\bcount\b|\browCount\b|\.maybeSingle\(|\.single\(/
                .test(stmt + '\n' + scrubbed.join('\n'));

            const claimIdx = scrubbed.findIndex(l => CLAIMS_SUCCESS.test(l));
            const claims = claimIdx >= 0;

            if (claims && !countsRows && !ALLOW.test(stmt) && !ALLOW.test(after[claimIdx])) {
                uncounted.push({
                    file, line: i + 1,
                    detail: line.trim().slice(0, 84),
                    then: after[claimIdx].trim().slice(0, 72),
                    hint: asksForRows
                        ? 'rows returned but never counted — add `if (!data?.length)`'
                        : 'no .select() — nothing to count; add `.select(\'id\')` then check the length',
                });
            }
        }
    }
}

// ── Self-test ───────────────────────────────────────────────────────────────
// A detector that silently matches nothing is the very defect this file hunts,
// and pattern 3 shipped in exactly that state during development: a stray
// comment reading "no count." suppressed it, and its look-ahead window bled
// into the next function. Both bugs were invisible because the only symptom was
// a reassuring "0 findings". These fixtures assert each rule still bites.
const FIXTURES = [
    {
        name: 'p3 flags update that reports success without counting rows',
        expect: 'uncounted',
        src: `async function save() {
    const { error } = await supabase.from('companies').update({ a: 1 }).eq('id', id);
    if (error) return { ok: false };
    return { ok: true };
}`,
    },
    {
        name: 'p3 flags delete followed by a success toast',
        expect: 'uncounted',
        src: `async function remove() {
    const { error } = await supabase.from('widgets').delete().eq('id', id);
    if (error) throw error;
    showToast('Deleted', 'success');
}`,
    },
    {
        name: 'p3 flags a success claim buried mid-string',
        expect: 'uncounted',
        src: `async function save() {
    const { error } = await supabase.from('assets').update(row).eq('id', id);
    if (error) { report(error); } else { console.log('[save] OK Saved successfully for:', id); }
}`,
    },
    {
        name: 'p3 stays quiet when rows are counted',
        expect: null,
        src: `async function save() {
    const { data, error } = await supabase.from('companies').update({ a: 1 }).eq('id', id).select('id');
    if (error) return { ok: false };
    if (!data?.length) return { ok: false };
    return { ok: true };
}`,
    },
    {
        name: 'p3 ignores insert (WITH CHECK throws — pattern 2 covers it)',
        expect: null,
        src: `async function add() {
    const { error } = await supabase.from('companies').insert({ a: 1 });
    if (error) return { ok: false };
    return { ok: true };
}`,
    },
    {
        name: 'p2 flags a write whose error is never read',
        expect: 'unchecked',
        src: `async function save() {
    await supabase.from('widgets').insert({ a: 1 });
}`,
    },
];

if (SELF_TEST) {
    let failed = 0;
    for (const f of FIXTURES) {
        swallowed.length = unchecked.length = uncounted.length = 0;
        scanSource('<fixture>', f.src);
        const got = uncounted.length ? 'uncounted' : unchecked.length ? 'unchecked' : swallowed.length ? 'swallowed' : null;
        const ok = got === f.expect;
        if (!ok) failed++;
        console.log(`  ${ok ? '✓' : '✗ FAIL'} ${f.name}${ok ? '' : `  (expected ${f.expect ?? 'no finding'}, got ${got ?? 'no finding'})`}`);
    }
    console.log(failed ? `\n${failed}/${FIXTURES.length} self-test(s) FAILED` : `\nAll ${FIXTURES.length} self-tests passed.`);
    process.exit(failed ? 1 : 0);
}

for (const file of files) {
    scanSource(file, readFileSync(file, 'utf8'));
}

const report = (title, rows, render) => {
    console.log(`\n${title}: ${rows.length}`);
    if (rows.length === 0) console.log('  none');
    for (const r of rows) {
        console.log(`  ${r.file}:${r.line}`);
        render(r);
    }
};

console.log('Scanning for silent-success defects…');
report('Swallowed catch followed by an unconditional success message', swallowed, r => {
    console.log(`     catch → ${r.detail}`);
    console.log(`     then  → ${r.then}`);
});
report('Supabase write whose { error } is never read', unchecked, r => {
    console.log(`     ${r.detail}`);
});
report('update/delete claiming success without counting affected rows (RLS refuses these silently)', uncounted, r => {
    console.log(`     write → ${r.detail}`);
    console.log(`     then  → ${r.then}`);
    console.log(`     fix   → ${r.hint}`);
});

const total = swallowed.length + unchecked.length + uncounted.length;
console.log(`\n${total} finding(s) across ${files.length} files.`);
if (total > 0) {
    console.log('Mark a deliberate exception with a trailing  // silent-success-ok: <reason>');
}
process.exit(STRICT && total > 0 ? 1 : 0);
