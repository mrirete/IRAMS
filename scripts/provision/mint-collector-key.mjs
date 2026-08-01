#!/usr/bin/env node
/**
 * mint-collector-key — issue a credential for one ERS Collector install.
 *
 * Each collector gets its own key so it can be revoked without cutting off the
 * others, and so pushed readings are attributable. Only the SHA-256 hash is
 * stored; the key itself is printed once here and never recoverable.
 *
 *   node scripts/provision/mint-collector-key.mjs --name "Bonny Island terminal"
 *   node scripts/provision/mint-collector-key.mjs --list
 *   node scripts/provision/mint-collector-key.mjs --revoke ers_col_1a2b3c4d
 *
 * Needs SUPABASE_ACCESS_TOKEN (sbp_…, from supabase.com/dashboard/account/tokens).
 * The user keeps it in the gitignored root .env.local.
 */
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'hacrebcfvyqdnjvilhqc';

function loadToken() {
    if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
    for (const p of ['.env.local', '../.env.local', '../../.env.local']) {
        try {
            const line = readFileSync(new URL(p, import.meta.url), 'utf8')
                .replace(/^﻿/, '')
                .split(/\r?\n/)
                .find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
            if (line) return line.slice('SUPABASE_ACCESS_TOKEN='.length).trim();
        } catch { /* try the next candidate */ }
    }
    return null;
}

const TOKEN = loadToken();
if (!TOKEN) {
    console.error('SUPABASE_ACCESS_TOKEN not set and not found in .env.local');
    process.exit(1);
}

async function sql(query) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const body = await res.json();
    if (!res.ok || body?.message) throw new Error(body?.message || `HTTP ${res.status}`);
    return body;
}

const esc = (s) => String(s).replace(/'/g, "''");

const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : (args[i + 1] ?? true);
};

if (args.includes('--list')) {
    const rows = await sql(
        `select name, key_prefix, is_active, last_seen_at, readings_count, created_at
           from ers_collector_keys order by created_at desc`,
    );
    if (!rows.length) { console.log('No collector keys minted yet.'); process.exit(0); }
    console.log('\nCollector keys\n');
    for (const r of rows) {
        const seen = r.last_seen_at ? new Date(r.last_seen_at).toISOString().replace('T', ' ').slice(0, 16) : 'never';
        console.log(
            `  ${r.is_active ? '●' : '○'} ${String(r.name).padEnd(28)} ${r.key_prefix}…  ` +
            `last seen ${seen}  ${r.readings_count} readings${r.is_active ? '' : '  (REVOKED)'}`,
        );
    }
    console.log('');
    process.exit(0);
}

const revoke = flag('--revoke');
if (revoke && revoke !== true) {
    const prefix = String(revoke).replace(/…$/, '');
    const rows = await sql(
        `update ers_collector_keys set is_active = false
          where key_prefix = '${esc(prefix)}' returning name, key_prefix`,
    );
    if (!rows.length) { console.error(`No key with prefix ${prefix}`); process.exit(1); }
    console.log(`Revoked "${rows[0].name}" (${rows[0].key_prefix}…). It is rejected from the next request on.`);
    process.exit(0);
}

const name = flag('--name');
if (!name || name === true) {
    console.error('Usage: mint-collector-key.mjs --name "<collector name>" [--note "<note>"]');
    console.error('       mint-collector-key.mjs --list');
    console.error('       mint-collector-key.mjs --revoke <key_prefix>');
    process.exit(1);
}

// 32 random bytes → 64 hex chars. Prefixed so it is recognisable in a log or a
// support ticket as an ERS collector credential.
const key = `ers_col_${randomBytes(32).toString('hex')}`;
const hash = createHash('sha256').update(key).digest('hex');
const prefix = key.slice(0, 16);
const note = flag('--note');

await sql(
    `insert into ers_collector_keys (name, key_prefix, key_hash, note)
     values ('${esc(name)}', '${esc(prefix)}', '${esc(hash)}',
             ${note && note !== true ? `'${esc(note)}'` : 'null'})`,
);

console.log(`
Collector key minted for "${name}".

  ${key}

This is the only time it is shown — the database stores only its SHA-256 hash.
Put it in the collector's config as the x-api-key header:

  curl -X POST https://${PROJECT_REF}.supabase.co/functions/v1/ingest-readings \\
    -H "x-api-key: ${key}" \\
    -H "Content-Type: application/json" \\
    -d '{"readings":[{"asset":"P-101A","tag":"vibration_de","value":4.2,"unit":"mm/s"}]}'

Revoke it any time with:  --revoke ${prefix}
`);
