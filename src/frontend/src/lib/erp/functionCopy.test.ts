/**
 * The erp-export edge function carries a COPY of this library.
 *
 * Deno requires `.ts` extensions on relative imports; the app's bundler
 * forbids them — so the function cannot import these files in place, and a
 * copy was the least-bad option. A copy that can drift is how this codebase
 * got four rival "open work order" definitions, so this test makes drift a
 * red build instead of a silent divergence: the files must be byte-identical
 * after normalising exactly one thing, the import extensions.
 *
 * If this fails you edited one side. Fix src/lib/erp, then re-copy:
 *   for f in canonical mapToCanonical emitters; do
 *     sed "s|from './canonical'|from './canonical.ts'|; s|from './mapToCanonical'|from './mapToCanonical.ts'|" \
 *       "src/lib/erp/$f.ts" > "supabase/functions/erp-export/lib/$f.ts"; done
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appDir = resolve(__dirname);
const fnDir = resolve(__dirname, '../../../supabase/functions/erp-export/lib');

/** Strip the one permitted difference: `.ts` on relative import specifiers. */
const normalise = (src: string): string =>
    src.replace(/from '(\.\/[A-Za-z]+)\.ts'/g, "from '$1'");

describe.each(['canonical', 'mapToCanonical', 'emitters'])('%s.ts', (name) => {
    it('is byte-identical to the edge-function copy (imports aside)', () => {
        const app = readFileSync(resolve(appDir, `${name}.ts`), 'utf8');
        const fn = readFileSync(resolve(fnDir, `${name}.ts`), 'utf8');
        expect(normalise(fn)).toBe(app);
    });
});
