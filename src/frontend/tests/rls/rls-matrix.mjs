/**
 * rls-matrix — does the DATABASE agree with the permission matrix?
 *
 * The layer this closes
 * ─────────────────────
 * The launch plan's L0/L1 (types, lint, unit) and L3 (browser smoke) both test
 * the client. Neither can see the database. When the RBAC gate fix landed, what
 * it proved was that a technician gets "Access Restricted" in the UI — not that
 * the technician's token is refused by Postgres. Those are different claims, and
 * only the second one matters if someone opens devtools or calls the REST API
 * directly. A hidden button is not an access control.
 *
 * What it does
 * ────────────
 * For every role and every sensitive table, sign in for real and read. Compare
 * what the database allows against what ROLE_PERMISSION_TEMPLATES says the role
 * should see, and report the cases where the database is MORE permissive than
 * the UI. Those are the leaks: the UI says no, the API says yes.
 *
 * Why an admin baseline is taken first
 * ───────────────────────────────────
 * A role reading zero rows is ambiguous — RLS may have filtered everything, or
 * the table may simply be empty. Without a baseline every empty table reads as
 * a successful denial and the report becomes flattering nonsense. Admin reads
 * each table first; only tables admin can see rows in yield a verdict, and the
 * rest are reported INCONCLUSIVE rather than quietly counted as passes.
 *
 * Writes
 * ──────
 * --writes adds an UPDATE probe: read a row, write the SAME value back, count
 * the returned rows. Zero rows with no error is how an RLS USING clause refuses
 * an update (it filters rather than rejects, so `error` stays null — the trap
 * that made "Save" lie on the settings page). The value is unchanged, but the
 * statement is real: updated_at columns and triggers WILL fire. Off by default
 * for that reason.
 *
 * Usage
 *   node tests/rls/rls-matrix.mjs               reads only (safe)
 *   node tests/rls/rls-matrix.mjs --writes      adds the same-value write probe
 *   node tests/rls/rls-matrix.mjs --strict      exit 1 if any leak is found
 *   RLS_LOGINS_JSON=[{...}]                     override the role list
 */
import { ROLE_PERMISSION_TEMPLATES } from '../../src/eam/constants/rolePermissions.ts';

const STRICT = process.argv.includes('--strict');
const WRITES = process.argv.includes('--writes');

const SB = process.env.VITE_SUPABASE_URL || 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';

/** Admin baseline account — must be able to read everything. */
const ADMIN = { email: 'admin001@cainergy.com', password: 'Password123!' };

/**
 * Roles to probe. Every entry must be a REAL login: this harness exists to test
 * the database's answer to a real token, so there is nothing to simulate.
 */
const LOGINS = JSON.parse(process.env.RLS_LOGINS_JSON || JSON.stringify([
    { label: 'RELIABILITY_ENG', email: 'k.syrus@cainergy.com', password: 'Password123!' },
    { label: 'TECHNICIAN', email: 'bea@cainergy.com', password: 'Password123!' },
    { label: 'REQUESTER', email: 'requester01@cainergy.com', password: 'Password123!' },
]));

/**
 * Permission key → the tables holding that module's data.
 *
 * Names come from the migrations, not from guesswork. A key maps to several
 * tables because a module leaks through whichever of its tables is most
 * permissive — checking only the headline table would miss the line-item table
 * beside it, which is usually where the sensitive detail actually lives.
 */
const TABLES = {
    assets: ['assets', 'asset_financials', 'asset_bom'],
    workOrders: ['work_orders', 'work_order_labor', 'work_order_parts', 'job_tasks'],
    requests: ['service_requests'],
    inventory: ['inventory_items', 'inventory_stock', 'inventory_transactions'],
    purchasing: ['purchase_orders', 'goods_receipts', 'invoice_matches'],
    contacts: ['contacts', 'users', 'qualifications'],
    vendors: ['vendors'],
    pm: ['recurring_work', 'maintenance_strategies'],
    readings: ['reading_definitions', 'reading_logs'],
    finops: ['budgets', 'cost_centers', 'journal_entries', 'depreciation_books', 'capital_events'],
    reliability: ['ers_rcm_studies', 'ers_fmea_worksheets', 'ers_rca_investigations',
        'ers_reliability_analyses', 'ers_bad_actor_snapshots', 'ers_prediction_alerts', 'ers_sensor_readings'],
    integrity: ['ers_cmls', 'ers_thickness_readings', 'ers_corrosion_rates', 'ers_inspections',
        'ers_rbi_assessments', 'ers_ffs_assessments', 'ers_damage_mechanisms'],
    safety: ['ers_psm_studies', 'ers_hazop_nodes', 'loto_permits', 'ptw_permits', 'jsa_assessments'],
    moc: ['moc_requests'],
    audits: ['audits', 'audit_findings', 'audit_responses', 'audit_templates'],
    sustain: ['ers_carbon_metrics', 'ers_climate_risks'],
    notifications: ['notifications', 'notification_rules', 'notification_outbox'],
    admin: ['companies', 'connectors', 'error_logs', 'user_invites', 'hierarchy_config'],
    activityLog: ['audit_logs'],
};

/**
 * Tables where the UI permission matrix is the WRONG yardstick.
 *
 * The matrix describes modules a user may open. Some tables are infrastructure
 * every session needs regardless of role, and reporting them as leaks forever
 * would train everyone to skim past this output — which is how a real finding
 * gets missed. Each entry states the intended posture and why, so the exemption
 * is a decision on record rather than a silence.
 */
const EXPECTED_OPEN = {
    companies: 'useEdition + SettingsContext read this on every page load for every user ' +
        '(edition, app_settings). Admin-only would break routing and settings for everyone. ' +
        'Sensitive columns here would need column grants, not RLS.',
    users: 'AuthContext resolves your own profile from it at login, and DatabaseService looks up ' +
        'OTHER users to render assignee names. Admin-only breaks login; self-or-admin breaks every ' +
        'assignee label. Proper fix is a directory view exposing (id, username) — needs a code change.',
    notifications: 'Every user reads their own; row scoping is the recipient filter, not the module gate.',
    audit_logs: 'Deliberately PART-open since 0238: change history on business records stays readable ' +
        '(Assets.tsx renders the per-asset Audit Trail tab for TECHNICIAN/REQUESTER), while rows auditing ' +
        'users/companies/user_invites/contacts are admin-only. This check is binary and cannot express ' +
        'row-level scoping, so it sees "readable" and calls it a leak. Verify the scoping directly: a ' +
        'non-admin reading ?table_name=eq.users must get 0 rows.',
};

const signIn = async (email, password) => {
    const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${(await res.text()).slice(0, 120)}`);
    return (await res.json()).access_token;
};

const H = (token) => ({ apikey: ANON, Authorization: `Bearer ${token}` });

/** Read up to `n` rows. Returns { status, rows, denied }. */
async function probeSelect(token, table, n = 2) {
    const res = await fetch(`${SB}/rest/v1/${table}?select=*&limit=${n}`, { headers: H(token) });
    if (!res.ok) return { status: res.status, rows: 0, denied: true };
    const body = await res.json();
    return { status: res.status, rows: Array.isArray(body) ? body.length : 0, denied: false };
}

/**
 * Same-value UPDATE probe. Picks a row, writes one of its own scalar columns
 * back unchanged, and counts what returns. `.select()` is what makes the count
 * observable — without it PostgREST returns no body and a refusal is invisible.
 */
async function probeUpdate(token, table, adminToken) {
    const seed = await fetch(`${SB}/rest/v1/${table}?select=*&limit=1`, { headers: H(adminToken) });
    if (!seed.ok) return { skipped: 'no admin read' };
    const [row] = await seed.json();
    if (!row?.id) return { skipped: 'no id column' };

    // A column that is safe to rewrite with its current value.
    const col = Object.keys(row).find(k =>
        !['id', 'created_at', 'updated_at'].includes(k) &&
        (typeof row[k] === 'string' || typeof row[k] === 'number') && row[k] !== null);
    if (!col) return { skipped: 'no scalar column' };

    const res = await fetch(`${SB}/rest/v1/${table}?id=eq.${row.id}&select=id`, {
        method: 'PATCH',
        headers: { ...H(token), 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ [col]: row[col] }),
    });
    if (!res.ok) return { allowed: false, status: res.status };
    const back = await res.json();
    return { allowed: Array.isArray(back) && back.length > 0, status: res.status };
}

// ── Run ─────────────────────────────────────────────────────────────────────

console.log(`RLS matrix — ${SB}`);
console.log(WRITES ? 'reads + same-value write probe\n' : 'reads only (pass --writes to probe updates)\n');

const adminToken = await signIn(ADMIN.email, ADMIN.password);

// Baseline: which tables actually hold rows an admin can see?
const baseline = {};
for (const tables of Object.values(TABLES)) {
    for (const t of tables) {
        if (baseline[t] === undefined) baseline[t] = (await probeSelect(adminToken, t)).rows;
    }
}
const populated = Object.entries(baseline).filter(([, n]) => n > 0).length;
console.log(`baseline: ${populated}/${Object.keys(baseline).length} tables have rows visible to SUPER_ADMIN`);
console.log('(tables with no rows cannot yield a verdict and are reported inconclusive)\n');

const leaks = [];
const inconclusive = [];
const exempt = new Set();   // tables in EXPECTED_OPEN that were seen open

for (const login of LOGINS) {
    const template = ROLE_PERMISSION_TEMPLATES[login.label];
    if (!template) { console.log(`⚠ ${login.label}: no role template — skipped\n`); continue; }

    let token;
    try { token = await signIn(login.email, login.password); }
    catch (e) { console.log(`⚠ ${login.label}: ${e.message}\n`); continue; }

    console.log(`── ${login.label} ─────────────────────────────`);

    for (const [permKey, tables] of Object.entries(TABLES)) {
        const uiCanView = template[permKey]?.view === true;
        const uiCanEdit = template[permKey]?.edit === true;

        for (const table of tables) {
            if (!baseline[table]) { inconclusive.push(`${login.label} ${table} (empty)`); continue; }

            const r = await probeSelect(token, table);
            const dbCanRead = !r.denied && r.rows > 0;

            if (!uiCanView && dbCanRead && EXPECTED_OPEN[table]) {
                exempt.add(table);
                console.log(`  ~ open   ${table.padEnd(28)} intentionally readable — see EXPECTED_OPEN`);
            } else if (!uiCanView && dbCanRead) {
                leaks.push({ role: login.label, table, permKey, op: 'SELECT',
                    detail: `UI says ${permKey}.view=false but the API returned ${r.rows} row(s)` });
                console.log(`  ✗ LEAK  ${table.padEnd(28)} ${permKey}.view=false → API returned ${r.rows} row(s)`);
            } else if (!uiCanView && !dbCanRead) {
                console.log(`  ✓ deny  ${table.padEnd(28)} ${permKey}.view=false → ${r.denied ? `HTTP ${r.status}` : '0 rows'}`);
            } else if (uiCanView && !dbCanRead) {
                console.log(`  · note  ${table.padEnd(28)} ${permKey}.view=true but read ${r.denied ? `HTTP ${r.status}` : '0 rows'} (stricter than UI — not a leak)`);
            }

            if (WRITES && !uiCanEdit) {
                const w = await probeUpdate(token, table, adminToken);
                if (w.allowed) {
                    leaks.push({ role: login.label, table, permKey, op: 'UPDATE',
                        detail: `UI says ${permKey}.edit=false but the UPDATE affected a row` });
                    console.log(`  ✗ LEAK  ${table.padEnd(28)} ${permKey}.edit=false → UPDATE was accepted`);
                }
            }
        }
    }
    console.log('');
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log('═'.repeat(72));
if (leaks.length === 0) {
    console.log('No leaks: the database is at least as strict as the permission matrix.');
} else {
    console.log(`${leaks.length} LEAK(S) — the API is more permissive than the UI:\n`);
    for (const l of leaks) console.log(`  ${l.role.padEnd(17)} ${l.op.padEnd(7)} ${l.table.padEnd(28)} ${l.detail}`);
    console.log('\nA user with this role can reach the data directly, whatever the UI shows.');
}
if (exempt.size) {
    console.log(`
${exempt.size} table(s) intentionally readable (EXPECTED_OPEN — reviewed, not leaks):`);
    for (const t of exempt) console.log(`  ${t.padEnd(16)} ${EXPECTED_OPEN[t]}`);
}
if (inconclusive.length) {
    console.log(`\n${inconclusive.length} inconclusive (table empty — seed it to get a verdict):`);
    console.log(`  ${[...new Set(inconclusive.map(s => s.split(' ')[1]))].join(', ')}`);
}
process.exit(STRICT && leaks.length ? 1 : 0);
