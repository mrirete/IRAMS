/**
 * RLS Negative Test — Privilege Escalation Attempt
 * 
 * Signs in as a non-admin (technician) and tries to escalate privileges
 * by updating the `users` table. After migration 0171, this MUST fail.
 *
 * Usage:
 *   node test_rls_negative.mjs <email> <password>
 *   
 * Example:
 *   node test_rls_negative.mjs smoke-ci@irams.app "YourPassword123!"
 */

const SUPABASE_URL = 'https://hacrebcfvyqdnjvilhqc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhY3JlYmNmdnlxZG5qdmlsaHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mjk5ODAsImV4cCI6MjA4NzEwNTk4MH0.F-2Fordc833NAuprdRBmm5s-Bd5fQsO0vxUK7_06AJ0';

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: node test_rls_negative.mjs <email> <password>');
  process.exit(1);
}

// ── 1. Sign in ──────────────────────────────────────────────────────
console.log(`\n🔐 Signing in as ${email}...`);

const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  },
  body: JSON.stringify({ email, password }),
});

if (!loginRes.ok) {
  const err = await loginRes.json();
  console.error('❌ Login failed:', err.error_description || err.msg || err);
  process.exit(1);
}

const { access_token, user } = await loginRes.json();
const role = user?.user_metadata?.role || 'unknown';
console.log(`✅ Signed in as "${user?.user_metadata?.username}" (role: ${role})`);

// ── 2. Attempt privilege escalation ──────────────────────────────────
console.log('\n⚠️  Attempting privilege escalation: UPDATE users SET roles = ["SUPER_ADMIN"]...');

const attackRes = await fetch(
  `${SUPABASE_URL}/rest/v1/users?username=eq.${user?.user_metadata?.username || 'smoke-ci'}`,
  {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${access_token}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ roles: ['SUPER_ADMIN'] }),
  }
);

const status = attackRes.status;
const body = await attackRes.json().catch(() => null);
const rowsAffected = Array.isArray(body) ? body.length : 0;

console.log(`   HTTP ${status} — ${rowsAffected} row(s) affected`);

// ── 3. Also try updating another user's roles ────────────────────────
console.log('\n⚠️  Attempting to escalate another user: UPDATE users SET roles = ["SUPER_ADMIN"] WHERE username = "admin001"...');

const attackRes2 = await fetch(
  `${SUPABASE_URL}/rest/v1/users?username=eq.admin001`,
  {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${access_token}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ roles: ['SUPER_ADMIN'] }),
  }
);

const status2 = attackRes2.status;
const body2 = await attackRes2.json().catch(() => null);
const rowsAffected2 = Array.isArray(body2) ? body2.length : 0;

console.log(`   HTTP ${status2} — ${rowsAffected2} row(s) affected`);

// ── 4. Try tampering with audit_logs ─────────────────────────────────
console.log('\n⚠️  Attempting audit log tampering: DELETE FROM audit_logs...');

const auditRes = await fetch(
  `${SUPABASE_URL}/rest/v1/audit_logs?id=gt.0`,
  {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${access_token}`,
      'Prefer': 'return=representation',
    },
  }
);

const auditStatus = auditRes.status;
const auditBody = await auditRes.json().catch(() => null);
const auditRows = Array.isArray(auditBody) ? auditBody.length : 0;

console.log(`   HTTP ${auditStatus} — ${auditRows} row(s) deleted`);

// ── 5. Try modifying reference_codes (permission dictionaries) ───────
console.log('\n⚠️  Attempting reference_codes tampering: UPDATE reference_codes SET code = "HACKED"...');

const refRes = await fetch(
  `${SUPABASE_URL}/rest/v1/reference_codes?category=eq.CONTACT_TYPE&code=eq.TECHNICIAN`,
  {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${access_token}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({ code: 'HACKED' }),
  }
);

const refStatus = refRes.status;
const refBody = await refRes.json().catch(() => null);
const refRows = Array.isArray(refBody) ? refBody.length : 0;

console.log(`   HTTP ${refStatus} — ${refRows} row(s) affected`);


// ── VERDICT ──────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));

const allBlocked = rowsAffected === 0 && rowsAffected2 === 0 && auditRows === 0 && refRows === 0;

if (allBlocked) {
  console.log('✅ ALL ATTACKS BLOCKED — RLS is enforced correctly.');
  console.log('   • Self-escalation:       BLOCKED (0 rows)');
  console.log('   • Cross-user escalation: BLOCKED (0 rows)');
  console.log('   • Audit log tampering:   BLOCKED (0 rows)');
  console.log('   • Reference code tamper: BLOCKED (0 rows)');
} else {
  console.log('🚨 RLS BREACH DETECTED:');
  if (rowsAffected > 0)  console.log(`   • Self-escalation:       ${rowsAffected} row(s) MODIFIED`);
  if (rowsAffected2 > 0) console.log(`   • Cross-user escalation: ${rowsAffected2} row(s) MODIFIED`);
  if (auditRows > 0)     console.log(`   • Audit log tampering:   ${auditRows} row(s) DELETED`);
  if (refRows > 0)       console.log(`   • Reference code tamper: ${refRows} row(s) MODIFIED`);
}

console.log('═'.repeat(60) + '\n');
process.exit(allBlocked ? 0 : 1);
