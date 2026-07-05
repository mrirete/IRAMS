/**
 * RLS Negative Test — Privilege-Escalation Attempt (self-restoring)
 *
 * Signs in as a non-admin and TRIES to escalate privileges / tamper with
 * config + audit tables via the REST API. After migration 0171 every attempt
 * must affect 0 rows.
 *
 * SAFE AGAINST PRODUCTION: each attack reads the target's current value first
 * and, if the write unexpectedly SUCCEEDS (a breach), immediately restores the
 * original value — so a regression is reported loudly but never leaves the
 * database corrupted. (The first version of this script pre-dated that guard
 * and, when RLS was still open, actually modified live rows.)
 *
 * Usage:
 *   node test_rls_negative.mjs <email> <password>
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';

const email = process.argv[2] || process.env.SMOKE_EMAIL;
const password = process.argv[3] || process.env.SMOKE_PASSWORD;
if (!email || !password) {
  console.error('Usage: node test_rls_negative.mjs <email> <password>');
  process.exit(2);
}

const rest = (path, token, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });

// ── Sign in ─────────────────────────────────────────────────────────────────
const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
  body: JSON.stringify({ email, password }),
});
if (!loginRes.ok) {
  console.error('✗ Login failed:', (await loginRes.json().catch(() => ({}))).msg || loginRes.status);
  process.exit(2);
}
const { access_token: token } = await loginRes.json();
console.log(`Signed in as ${email} (non-admin fixture).`);

const breaches = [];

/**
 * Attempt a forbidden write on ONE row. `locate` selects it; `field` is the
 * single column we mutate; `evil` is the malicious value. We capture the row's
 * immutable `id` + original value first, mutate BY ID, and restore BY ID — so
 * the restore never depends on the column we just changed (an earlier version
 * filtered on the mutated column and could not find the row to restore it).
 */
async function attempt(label, table, locate, field, evil) {
  const before = await rest(`${table}?${locate}&select=id,${field}`, token).then(r => r.json()).catch(() => []);
  if (!Array.isArray(before) || !before[0]) { console.log(`  … skipped ${label} — target row not found`); return; }
  const { id } = before[0];
  const original = before[0][field];

  const res = await rest(`${table}?id=eq.${id}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ [field]: evil }),
  });
  const body = await res.json().catch(() => null);
  const rows = Array.isArray(body) ? body.length : 0;

  if (rows > 0) {
    // BREACH — undo BY ID (immune to the column we changed).
    await rest(`${table}?id=eq.${id}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: original }),
    });
    console.log(`  ✗ BREACH ${label} — 1 row modified (restored by id)`);
    breaches.push(label);
  } else {
    console.log(`  ✓ blocked ${label} — HTTP ${res.status}`);
  }
}

async function attemptDelete(label, table, filter) {
  const res = await rest(`${table}?${filter}`, token, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  const body = await res.json().catch(() => null);
  const rows = Array.isArray(body) ? body.length : 0;
  if (rows > 0) { console.log(`  ✗ BREACH ${label} — ${rows} row(s) DELETED (unrecoverable)`); breaches.push(label); }
  else console.log(`  ✓ blocked ${label} — HTTP ${res.status}`);
}

console.log('\nAttempting privilege escalation / tampering (all must be blocked):');
// Escalate a real admin — but never persist it (restored on breach).
await attempt('escalate admin001.roles', 'users', 'username=eq.admin001', 'roles', ['SUPER_ADMIN', 'TAMPER_PROBE']);
// Rewrite a role's permission dictionary code.
await attempt('rename reference_code', 'reference_codes', 'category=eq.CONTACT_TYPE&code=eq.TECHNICIAN', 'code', 'TAMPER_PROBE');
// Erase audit trail (DELETE cannot be un-deleted — this MUST be blocked).
await attemptDelete('delete audit_logs', 'audit_logs', 'id=gt.0');

console.log('\n' + '═'.repeat(56));
if (breaches.length === 0) {
  console.log('✓ ALL ATTACKS BLOCKED — role-enforcing RLS (0171) is active.');
  process.exit(0);
}
console.log(`🚨 RLS NOT ENFORCED — breaches: ${breaches.join(', ')}`);
console.log('   Re-apply migration 0171 (it is atomic + idempotent).');
process.exit(1);
