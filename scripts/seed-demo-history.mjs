#!/usr/bin/env node
/**
 * Seed DEMO reliability history against your REAL EAM data.
 *
 * Creates, on a real asset, a short history of corrective failures (with ISO 14224
 * failure modes — one recurring) so the "Asset Reliability" card + RCA recommendation
 * light up, and — if you have a PM strategy — a PM execution WO + corrective
 * follow-ups so "PM & PdM Effectiveness" shows a real number.
 *
 * It only writes to work_orders + wo_failure_data, all tagged DEMO- for easy removal.
 *
 * RUN (PowerShell, from repo root):
 *   $env:SEED_EMAIL="you@example.com"; $env:SEED_PASSWORD="yourpassword"; node scripts/seed-demo-history.mjs
 * CLEAN UP afterwards:
 *   $env:SEED_EMAIL=...; $env:SEED_PASSWORD=...; node scripts/seed-demo-history.mjs --clean
 *
 * Your password is read from the env var only and never stored or printed.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// ── Read Supabase URL + anon key from the frontend env ──
const envText = (() => {
  for (const p of ['.env.local', '.env', 'src/frontend/.env.local', 'src/frontend/.env', '../.env.local', '../.env']) {
    try { return readFileSync(p, 'utf8'); } catch { /* next */ }
  }
  return '';
})();
const envVal = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] || process.env[k] || '').trim().replace(/^["']|["']$/g, '');
const URL = envVal('VITE_SUPABASE_URL');
const ANON = envVal('VITE_SUPABASE_ANON_KEY');
const EMAIL = process.env.SEED_EMAIL;
const PASSWORD = process.env.SEED_PASSWORD;
const CLEAN = process.argv.includes('--clean');

if (!URL || !ANON) { console.error('✗ Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in src/frontend/.env'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('✗ Set SEED_EMAIL and SEED_PASSWORD env vars (your app login).'); process.exit(1); }

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const die = (msg, err) => { console.error('✗', msg, err?.message || err || ''); process.exit(1); };
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) die('Login failed:', authErr);
const userId = auth.user.id;
console.log('✓ Signed in as', EMAIL);

// ── CLEAN ──
if (CLEAN) {
  const { data: demo } = await sb.from('work_orders').select('id').like('wo_number', 'DEMO-%');
  const ids = (demo || []).map(d => d.id);
  if (ids.length) {
    await sb.from('wo_failure_data').delete().in('wo_id', ids);
    const { error } = await sb.from('work_orders').delete().in('id', ids);
    if (error) die('Cleanup failed:', error);
  }
  console.log(`✓ Removed ${ids.length} DEMO work order(s).`);
  process.exit(0);
}

// ── Pick a real asset (prefer Criticality A/B with a name) ──
const { data: assets, error: aErr } = await sb.from('assets')
  .select('id, tag, name, criticality').order('criticality', { ascending: true }).limit(200);
if (aErr) die('Could not read assets:', aErr);
if (!assets?.length) die('No assets found in the EAM to attach the demo to.');
const asset = assets.find(a => a.criticality === 'A') || assets.find(a => a.criticality === 'B') || assets[0];
console.log(`✓ Using asset: ${asset.tag || asset.id} — ${asset.name || ''} (Crit ${asset.criticality || '—'})`);

// ── Real failure-mode codes (fall back to generic if the dictionary table differs) ──
let modes = [];
for (const t of ['dictionaries', 'dictionary_entries']) {
  const { data } = await sb.from(t).select('code').eq('type', 'FAILURE_MODE').limit(5);
  if (data?.length) { modes = data.map(d => d.code); break; }
}
if (modes.length < 2) modes = ['SEAL-LEAK', 'BRG-VIBRATION', 'MOTOR-WINDING'];
const recurring = modes[0]; // this one will repeat → triggers RCA recommendation
console.log(`✓ Failure modes: ${modes.join(', ')} (recurring: ${recurring})`);

// ── Helper: insert a work order, return its id ──
let seq = 1;
const insertWO = async (over) => {
  const base = {
    wo_number: `DEMO-${String(seq++).padStart(3, '0')}`,
    title: 'DEMO — reliability history',
    description: 'Seeded demo record (safe to delete via --clean).',
    asset_id: asset.id,
    type: 'Corrective',
    status: 'CLOSED',
    priority_code: 'MEDIUM',
    est_duration: 4,
    actual_duration: 4,
    created_by: userId,
    created_at: daysAgo(300),
    closed_at: daysAgo(300),
  };
  const { data, error } = await sb.from('work_orders').insert({ ...base, ...over }).select('id').single();
  if (error) die(`Insert failed for ${over.wo_number || base.wo_number} (a column may differ — paste this error to fix):`, error);
  return data.id;
};
const setFailure = async (woId, mode, cause) => {
  const { error } = await sb.from('wo_failure_data').upsert({ wo_id: woId, failure_mode_code: mode, failure_cause_code: cause || null }, { onConflict: 'wo_id' });
  if (error) die('wo_failure_data upsert failed:', error);
};

// ── 1) Asset failure history: 5 corrective WOs over the last year (recurring mode ×3) ──
const historyDays = [310, 250, 180, 95, 25];
const histModes = [recurring, modes[1] || recurring, recurring, modes[2] || modes[1] || recurring, recurring];
for (let i = 0; i < historyDays.length; i++) {
  const id = await insertWO({
    title: `DEMO — ${histModes[i]} on ${asset.tag || 'asset'}`,
    actual_duration: 3 + (i % 4),
    created_at: daysAgo(historyDays[i] + 2),
    closed_at: daysAgo(historyDays[i]),
  });
  await setFailure(id, histModes[i]);
}
console.log('✓ Seeded 5 corrective failures (recurring mode ×3) → Asset Reliability + RCA recommendation.');

// ── 2) PM & PdM Effectiveness: a PM execution WO + two corrective follow-ups ──
const { data: pms } = await sb.from('recurring_work').select('id, description, title').limit(1);
if (pms?.length) {
  const pm = pms[0];
  const pmWoId = await insertWO({ title: `DEMO — PM execution (${pm.description || pm.title || 'PM'})`, type: 'Preventive', recurring_work_id: pm.id, created_at: daysAgo(60), closed_at: daysAgo(60) });
  // Necessary follow-up (defect found → failure mode coded)
  const f1 = await insertWO({ title: 'DEMO — PM follow-up (defect found)', parent_wo_id: pmWoId, created_at: daysAgo(58), closed_at: daysAgo(55) });
  await setFailure(f1, modes[1] || recurring);
  // Unnecessary follow-up (no fault found → no failure mode) → effectiveness 50%
  await insertWO({ title: 'DEMO — PM follow-up (no fault found)', parent_wo_id: pmWoId, created_at: daysAgo(58), closed_at: daysAgo(56) });
  console.log(`✓ Seeded PM "${pm.description || pm.title}" + 2 follow-ups → PM & PdM Effectiveness 50% (1/2).`);
} else {
  console.log('• No PM strategies found — skipped PM Effectiveness seed (create a PM first to see that one).');
}

console.log('\n✅ Done. Open the asset’s Work Orders / a WO on it → Analysis tab for reliability; Work Orders → Strategies for PM effectiveness.');
console.log('   Remove anytime with:  node scripts/seed-demo-history.mjs --clean');
process.exit(0);
