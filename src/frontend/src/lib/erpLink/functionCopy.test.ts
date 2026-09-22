/**
 * The erp-sync and sap-sim edge functions carry COPIES of this library.
 *
 * Deno requires `.ts` extensions on relative imports; the app's bundler
 * forbids them — so the functions cannot import these files in place. A copy
 * that can drift is how this codebase once got four rival "open work order"
 * definitions; this test makes drift a red build. The files must be
 * byte-identical after normalising exactly one thing, the import extensions.
 *
 * If this fails you edited one side. Fix src/lib/erpLink, then re-copy:
 *   for f in odata masterData; do
 *     sed "s|from './odata'|from './odata.ts'|; s|from './masterData'|from './masterData.ts'|" \
 *       "src/lib/erpLink/$f.ts" > "supabase/functions/erp-sync/lib/$f.ts"; done
 *   sed "s|from './odata'|from './odata.ts'|" src/lib/erpLink/odata.ts > supabase/functions/sap-sim/lib/odata.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appDir = resolve(__dirname);
const normalise = (src: string): string => src.replace(/from '(\.\/[A-Za-z]+)\.ts'/g, "from '$1'");

describe.each([
    ['erp-sync', 'odata'], ['erp-sync', 'masterData'], ['sap-sim', 'odata'],
])('%s/lib/%s.ts', (fn, name) => {
    it('is byte-identical to the app library (imports aside)', () => {
        const app = readFileSync(resolve(appDir, `${name}.ts`), 'utf8');
        const copy = readFileSync(resolve(__dirname, `../../../supabase/functions/${fn}/lib/${name}.ts`), 'utf8');
        expect(normalise(copy)).toBe(app);
    });
});
