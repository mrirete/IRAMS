/**
 * create-tenant — onboard (or destroy) an SMB tenant in the SHARED database.
 *
 * This is the missing half of provisioning. The baseline load (runbook §3.2)
 * is deployment-per-tenant: it creates the origin company and seeds rows with
 * hardcoded uuids, so pointing it at the shared database makes tenant #2
 * collide with tenant #1 on every primary key. This script goes the other way:
 * the database already exists, and a tenant is ADDED to it.
 *
 *   node scripts/provision/create-tenant.mjs --create \
 *        --name "Acme Industrial" --code ACME --admin-email ops@acme.com \
 *        [--admin-password …] [--currency USD] [--country US] --project-ref <ref>
 *
 *   node scripts/provision/create-tenant.mjs --destroy ACME --project-ref <ref>
 *
 * ── What --create does ──────────────────────────────────────────────────────
 *   1. extracts the product-seed row ids from baseline/seed.sql — the verified,
 *      regenerated-every-migration statement of what a fresh tenant starts
 *      with. Cloning "whatever the origin company has" instead would leak the
 *      origin tenant's own authored rows to every new customer.
 *   2. provision_tenant(): company row + fresh-uuid clones of those seeds
 *      (0271, service-role only)
 *   3. an admin: create_auth_user() (the 0141/0182 machinery that already
 *      provisions every dev login), then company_id + roles stamped on
 *      public.users — roles copied from the origin admin's row byte-for-byte
 *      rather than guessed, because the JSONB shape is what is_admin() reads.
 *   4. VERIFIES, with the new admin's real token, before reporting success:
 *      the claim resolves, origin data reads as zero rows, global config is
 *      visible, the seeds arrived with fresh uuids, a write lands in the new
 *      tenant, and the origin admin cannot see it. A provisioning tool that
 *      does not prove isolation is how a cross-tenant incident gets onboarded.
 *
 * ── What --create does NOT fix ──────────────────────────────────────────────
 * Phase 5 is still open: SettingsContext and useEdition read "the first active
 * company", so a second tenant's UI may render the ORIGIN's app settings until
 * that lands. The DATABASE boundary is enforced — these probes prove it — but
 * expect cosmetic bleed-through in the frontend until Phase 5.
 */
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(HERE, '../../src/frontend/supabase/baseline/seed.sql');
const API = 'https://api.supabase.com/v1';

const SEED_TABLES = [
    'audit_templates', 'audit_template_sections', 'audit_template_questions',
    'notification_rules', 'notification_channels', 'message_templates',
];

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? '') : ''; };
const projectRef = flag('--project-ref') || process.env.SUPABASE_PROJECT_REF || '';
const token = process.env.SUPABASE_ACCESS_TOKEN || '';
if (!projectRef || !token) { console.error('Need --project-ref and SUPABASE_ACCESS_TOKEN.'); process.exit(1); }

const SB = `https://${projectRef}.supabase.co`;
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';

const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const mgmt = async (query, tries = 4) => {
    for (let i = 0; i < tries; i++) {
        try {
            const r = await fetch(`${API}/projects/${projectRef}/database/query`, {
                method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
            });
            const t = await r.text();
            if (r.ok) { try { return JSON.parse(t); } catch { return []; } }
            if (r.status < 500) throw new Error(`mgmt ${r.status}: ${t.slice(0, 300)}`);
        } catch (e) { if (i === tries - 1) throw e; }
        await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
    }
};
const signIn = async (email, password) => {
    const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    return r.ok ? (await r.json()).access_token : null;
};
const rest = (jwt) => async (path, init = {}) => {
    const r = await fetch(`${SB}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) },
    });
    const t = await r.text();
    return { status: r.status, ok: r.ok, body: t ? JSON.parse(t) : null };
};
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));

/**
 * The seed ids, straight out of baseline/seed.sql. One-line INSERTs with "id"
 * as the first column — asserted, not assumed, because a silent format change
 * here would provision tenants with zero seed rows.
 */
function extractSeedIds() {
    const lines = readFileSync(SEED, 'utf8').split('\n');
    const byTable = Object.fromEntries(SEED_TABLES.map((t) => [t, []]));
    for (const line of lines) {
        for (const t of SEED_TABLES) {
            if (!line.startsWith(`INSERT INTO public.${t} (`)) continue;
            if (!line.startsWith(`INSERT INTO public.${t} ("id"`)) {
                throw new Error(`${t}: seed INSERT no longer lists "id" first — update extractSeedIds`);
            }
            const m = /VALUES \('([0-9a-f-]{36})'/.exec(line);
            if (!m) throw new Error(`${t}: could not read the id from: ${line.slice(0, 120)}`);
            byTable[t].push(m[1]);
        }
    }
    for (const t of SEED_TABLES) {
        if (byTable[t].length === 0) throw new Error(`${t}: zero seed rows found in seed.sql — refusing to provision an empty tenant`);
    }
    return byTable;
}

const check = (ok, label, detail = '') => {
    console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) process.exitCode = 1;
    return ok;
};

// ── destroy ─────────────────────────────────────────────────────────────────
if (args.includes('--destroy')) {
    const code = flag('--destroy');
    const [co] = await mgmt(`SELECT id::text, name FROM public.companies WHERE code = ${sqlLit(code)}`);
    if (!co) { console.error(`No company with code ${code}.`); process.exit(1); }
    console.log(`Destroying tenant ${co.name} (${code}, ${co.id.slice(0, 8)}…)…`);
    await mgmt(`SELECT public.deprovision_tenant('${co.id}')`);
    const [gone] = await mgmt(`SELECT count(*)::int n FROM public.companies WHERE code = ${sqlLit(code)}`);
    console.log(gone.n === 0 ? '✔ Tenant removed completely.' : '✖ company row still present');
    process.exit(gone.n === 0 ? 0 : 1);
}

// ── create ──────────────────────────────────────────────────────────────────
if (!args.includes('--create')) {
    console.log('Usage: --create --name <name> --code <CODE> --admin-email <email> [--admin-password …] | --destroy <CODE>');
    process.exit(1);
}
const name = flag('--name'), code = flag('--code').toUpperCase(), adminEmail = flag('--admin-email');
const password = flag('--admin-password') || `Tn-${randomBytes(9).toString('base64url')}`;
const tier = (flag('--tier') || 'starter').toLowerCase();
if (!name || !code || !adminEmail) { console.error('--name, --code and --admin-email are required.'); process.exit(1); }
if (!['starter', 'professional', 'enterprise'].includes(tier)) {
    console.error(`--tier must be starter|professional|enterprise, got "${tier}".`); process.exit(1);
}

const seedIds = extractSeedIds();
const allIds = SEED_TABLES.flatMap((t) => seedIds[t]);
console.log(`Seed set from baseline/seed.sql: ${allIds.length} rows (${SEED_TABLES.map((t) => `${t.split('_').pop()}:${seedIds[t].length}`).join(', ')})`);

// 1+2. company + seed clones, atomically inside provision_tenant
const [made] = await mgmt(`
    SELECT public.provision_tenant(${sqlLit(name)}, ${sqlLit(code)},
        ARRAY[${allIds.map((i) => `'${i}'`).join(',')}]::uuid[],
        ${flag('--currency') ? sqlLit(flag('--currency')) : 'NULL'},
        ${flag('--country') ? sqlLit(flag('--country')) : 'NULL'},
        ${sqlLit(tier)}) AS id`);
const companyId = made.id;
console.log(`✔ company ${code} = ${companyId} (tier: ${tier})`);

// 3. the admin. create_auth_user handles auth.users + identities + public.users;
//    then the tenant + roles are stamped, roles copied from the origin admin so
//    the JSONB shape matches what is_admin() actually reads.
const username = adminEmail.split('@')[0];
await mgmt(`SELECT public.create_auth_user(${sqlLit(adminEmail)}, ${sqlLit(password)}, ${sqlLit(username)}, 'SUPER_ADMIN')`);
await mgmt(`
    UPDATE public.users
       SET company_id = '${companyId}',
           roles = (SELECT roles FROM public.users WHERE email = 'admin001@cainergy.com'),
           status = 'active'
     WHERE email = ${sqlLit(adminEmail)}`);
console.log(`✔ admin ${adminEmail}`);

// 4. prove it. Every claim below is tested with real tokens, not asserted.
console.log('\nVerification — as the NEW tenant admin:');
const jwt = await signIn(adminEmail, password);
if (!check(Boolean(jwt), 'admin can sign in')) process.exit(1);
const as = rest(jwt);

check(claims(jwt)?.app_metadata?.company_id === companyId, 'JWT claim carries the new tenant');

// origin's operational data must read as EMPTY — RLS, not politeness.
for (const t of ['assets', 'work_orders', 'contacts', 'purchase_orders', 'notification_outbox']) {
    const r = await as(`${t}?select=id&limit=5`);
    check(r.ok && r.body.length === 0, `${t}: 0 of origin's rows visible`, r.ok ? `got ${r.body.length}` : `HTTP ${r.status}`);
}

// global config must be fully visible…
const [glob] = await mgmt(`SELECT
    (SELECT count(*) FROM public.dictionaries    WHERE company_id IS NULL)::int AS d,
    (SELECT count(*) FROM public.reference_codes WHERE company_id IS NULL)::int AS rc`);
const dEff = await as('dictionaries_effective?select=code');
const rcEff = await as('reference_codes_effective?select=code');
check(dEff.ok && dEff.body.length === glob.d, `sees all ${glob.d} global dictionaries`, `got ${dEff.body?.length}`);
check(rcEff.ok && rcEff.body.length === glob.rc, `sees all ${glob.rc} global reference codes`, `got ${rcEff.body?.length}`);

// …and the cloned seeds must be the tenant's own, with FRESH uuids.
for (const t of SEED_TABLES) {
    const r = await as(`${t}?select=id`);
    const fresh = r.ok && !r.body.some((row) => seedIds[t].includes(row.id));
    check(r.ok && r.body.length === seedIds[t].length && fresh,
        `${t}: ${seedIds[t].length} own seed rows, all fresh uuids`,
        r.ok ? `got ${r.body.length}${fresh ? '' : ', REUSED SEED IDS'}` : `HTTP ${r.status}`);
}

// Phase 5: the caller's company row is the ONLY visible one — this is what
// makes every "oldest active company" reader correct — and the origin's row
// must be unwritable. That UPDATE was a real hole: companies was exempt from
// the 0261 sweep, so until 0273 any tenant's admin could edit any company row.
const myCo = await as('companies?select=id,code,tier');
check(myCo.ok && myCo.body.length === 1 && myCo.body[0].id === companyId,
    'companies: sees exactly its own row', myCo.ok ? `got ${myCo.body.length}` : `HTTP ${myCo.status}`);
check(myCo.ok && myCo.body[0]?.tier === tier, `tier is server truth: ${tier}`, `got ${myCo.body[0]?.tier}`);

// …and pinned: the tenant's own admin must not be able to raise it.
const tierUp = await as(`companies?id=eq.${companyId}&select=tier`, {
    method: 'PATCH', body: JSON.stringify({ tier: 'enterprise' }),
});
check(!tierUp.ok, 'tier cannot be raised from the app', `HTTP ${tierUp.status}`);
const [origin] = await mgmt(`SELECT id::text FROM public.companies WHERE active ORDER BY created_at LIMIT 1`);
const coWrite = await as(`companies?id=eq.${origin.id}&select=id`, {
    method: 'PATCH', body: JSON.stringify({ description: 'cross-tenant probe' }),
});
check(coWrite.ok && coWrite.body.length === 0, "cannot UPDATE the origin's company row", `rows ${coWrite.body?.length}`);

// the singletons resolve to the global default for a tenant with no override
for (const v of ['hierarchy_config_effective', 'numbering_config_effective']) {
    const r = await as(`${v}?select=company_id`);
    check(r.ok && r.body.length === 1 && r.body[0].company_id === null,
        `${v}: resolves to the product global`, r.ok ? `got ${r.body.length}` : `HTTP ${r.status}`);
}

// a write lands in the new tenant without naming it (the column default)…
const ins = await as('dictionaries?select=id,company_id', {
    method: 'POST',
    body: JSON.stringify({ type: 'DOWNTIME_REASON', code: 'BREAKDOWN', description: `${code} override`, is_locked: false, active: true }),
});
check(ins.ok && ins.body?.[0]?.company_id === companyId, 'write lands in the new tenant via the column default');

// …the override shadows the global for THIS tenant…
const eff = await as('dictionaries_effective?select=description&type=eq.DOWNTIME_REASON&code=eq.BREAKDOWN');
check(eff.ok && eff.body.length === 1 && eff.body[0].description === `${code} override`, 'override shadows the global in dictionaries_effective');

// …and the ORIGIN admin cannot see any of it.
console.log('Verification — as the ORIGIN admin:');
const originJwt = await signIn('admin001@cainergy.com', 'Password123!');
if (originJwt) {
    const asOrigin = rest(originJwt);
    const leak = await asOrigin(`dictionaries?select=id&description=eq.${encodeURIComponent(`${code} override`)}`);
    check(leak.ok && leak.body.length === 0, `origin cannot see ${code}'s override`);
    const tpl = await asOrigin('audit_templates?select=id');
    check(tpl.ok && tpl.body.length === seedIds.audit_templates.length, 'origin still sees exactly its own templates', `got ${tpl.body?.length}`);
} else {
    check(false, 'origin admin sign-in failed — cross-check skipped');
}
if (ins.ok && ins.body?.[0]?.id) await as(`dictionaries?id=eq.${ins.body[0].id}`, { method: 'DELETE' });

if (process.exitCode) {
    console.log(`\n✖ VERIFICATION FAILED — destroy and investigate:\n   node scripts/provision/create-tenant.mjs --destroy ${code} --project-ref ${projectRef}`);
} else {
    console.log(`\n✔ Tenant ${code} provisioned and PROVEN isolated.`);
    console.log(`   login: ${adminEmail} / ${password}`);
}
