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
 * Two patterns are reported:
 *
 *  1. SWALLOWED CATCH → SUCCESS
 *     A catch that only logs, followed by an unconditional success message.
 *
 *  2. UNCHECKED SUPABASE WRITE
 *     insert/update/upsert/delete whose { error } is never read. PostgREST
 *     resolves rather than throwing, so a try/catch around one of these is
 *     decoration — an RLS denial passes straight through it.
 *
 * Usage:  node scripts/scan-silent-success.mjs [--strict]
 *         --strict exits 1 on any finding (for CI).
 *
 * A genuine exception can be marked with a trailing comment:
 *     // silent-success-ok: <reason>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = 'src';
const ALLOW = /silent-success-ok/;

const files = [];
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

const swallowed = [];
const unchecked = [];

for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');

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
    }
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

const total = swallowed.length + unchecked.length;
console.log(`\n${total} finding(s) across ${files.length} files.`);
if (total > 0) {
    console.log('Mark a deliberate exception with a trailing  // silent-success-ok: <reason>');
}
process.exit(STRICT && total > 0 ? 1 : 0);
