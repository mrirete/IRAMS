// Emits the reference_codes seed block for the ISO 14224 taxonomy from the
// single TypeScript source (src/lib/iso14224Taxonomy.ts), so the migration and
// the app can never disagree. Run with:
//   npx vite-node scripts/gen-iso14224-seed.mjs > out.sql
// The test iso14224Taxonomy.test.ts asserts every code is present in 0317.
import { CATEGORIES, CLASSES, TYPES } from '../src/lib/iso14224Taxonomy.ts';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const rows = [];
for (const c of CATEGORIES) {
  rows.push(`    ('ASSET_CATEGORY', ${q(c.code)}, ${q(c.label)}, NULL, '{"source":"ISO 14224:2016 Table A.1","iso":${JSON.stringify(c.iso)}}'::jsonb)`);
}
for (const c of CLASSES) {
  const props = { source: 'ISO 14224:2016 Table A.4', categoryRef: c.category, ...(c.failureScope ? { failureScope: c.failureScope } : {}), ...(c.isoRef ? { isoRef: c.isoRef } : {}) };
  rows.push(`    ('ASSET_CLASS', ${q(c.code)}, ${q(c.label)}, ${q(c.category)}, ${q(JSON.stringify(props))}::jsonb)`);
}
for (const t of TYPES) {
  const props = { source: 'ISO 14224:2016 Annex A.2', categoryRef: t.cls };
  rows.push(`    ('ASSET_TYPE', ${q(t.code)}, ${q(t.label)}, ${q(t.cls)}, ${q(JSON.stringify(props))}::jsonb)`);
}
process.stdout.write(`INSERT INTO public.reference_codes (category, code, description, category_ref, properties, is_locked, active)
SELECT v.category, v.code, v.description, v.category_ref, v.properties, false, true
FROM (VALUES
${rows.join(',\n')}
) AS v(category, code, description, category_ref, properties)
ON CONFLICT (company_id, category, code) DO UPDATE
  SET description  = EXCLUDED.description,
      category_ref = EXCLUDED.category_ref,
      properties   = COALESCE(public.reference_codes.properties, '{}'::jsonb) || EXCLUDED.properties,
      active       = true,
      updated_at   = now();
-- ${CATEGORIES.length} categories, ${CLASSES.length} classes, ${TYPES.length} types
`);
