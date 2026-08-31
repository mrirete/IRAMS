/**
 * ApiKeysPage — self-serve credentials for the two ingest endpoints (0299 UI;
 * keys themselves are 0236). Until now keys could only be minted with a repo
 * script (scripts/provision/mint-collector-key.mjs), which meant a
 * reliability-tier customer literally could not set up their own nightly sync
 * or sensor push. Same contract as the script:
 *
 *   key    = ers_col_ + 64 hex chars, shown ONCE at mint time
 *   stored = SHA-256 hash + first 16 chars (identification only)
 *   revoke = is_active=false (rejected from the next request on)
 *
 * Admin-only via RLS (admin_manage_collector_keys) — a non-admin sees an
 * empty list and failed writes, both surfaced plainly.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    KeyRound, Plus, Loader2, Copy, Check, AlertTriangle, ShieldOff, Shield,
    Satellite, ArrowRightLeft,
} from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';

interface CollectorKeyRow {
    id: string;
    name: string;
    key_prefix: string;
    is_active: boolean;
    last_seen_at: string | null;
    readings_count: number;
    note: string | null;
    created_at: string;
}

const sha256Hex = async (input: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const randomHex = (bytes: number): string => {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const timeAgo = (iso: string | null): string => {
    if (!iso) return 'never';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 48 * 60) return `${Math.floor(mins / 60)} h ago`;
    return `${Math.floor(mins / 1440)} d ago`;
};

export const ApiKeysPage: React.FC = () => {
    const [keys, setKeys] = useState<CollectorKeyRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [showMint, setShowMint] = useState(false);
    const [mintName, setMintName] = useState('');
    const [mintNote, setMintNote] = useState('');
    const [minting, setMinting] = useState(false);
    /** The one and only time the full key is visible. */
    const [mintedKey, setMintedKey] = useState<{ name: string; key: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [rowBusy, setRowBusy] = useState<string | null>(null);

    const functionsBase = useMemo(() => {
        const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
        return url ? `${url}/functions/v1` : '<your-project>/functions/v1';
    }, []);

    const load = async () => {
        setLoading(true);
        const { data, error: err } = await supabase
            .from('ers_collector_keys')
            .select('id, name, key_prefix, is_active, last_seen_at, readings_count, note, created_at')
            .order('created_at', { ascending: false });
        if (err) setError(`Could not load keys: ${err.message}`);
        setKeys((data ?? []) as CollectorKeyRow[]);
        setLoading(false);
    };
    useEffect(() => { void load(); }, []);

    const mint = async () => {
        if (!mintName.trim()) return;
        setMinting(true); setError(null);
        try {
            // Same format as scripts/provision/mint-collector-key.mjs — the two
            // must stay interchangeable.
            const key = `ers_col_${randomHex(32)}`;
            const { error: err } = await supabase.from('ers_collector_keys').insert({
                name: mintName.trim(),
                key_prefix: key.slice(0, 16),
                key_hash: await sha256Hex(key),
                is_active: true,
                note: mintNote.trim() || null,
            });
            if (err) throw new Error(err.message);
            setMintedKey({ name: mintName.trim(), key });
            setMintName(''); setMintNote(''); setShowMint(false); setCopied(false);
            await load();
        } catch (e) {
            setError(`Could not mint the key: ${e instanceof Error ? e.message : String(e)} (admin permission is required)`);
        } finally {
            setMinting(false);
        }
    };

    const setActive = async (row: CollectorKeyRow, active: boolean) => {
        setRowBusy(row.id); setError(null);
        const { error: err } = await supabase
            .from('ers_collector_keys')
            .update({ is_active: active })
            .eq('id', row.id);
        if (err) setError(`Could not ${active ? 'reactivate' : 'revoke'} "${row.name}": ${err.message}`);
        await load();
        setRowBusy(null);
    };

    const copyKey = async () => {
        if (!mintedKey) return;
        await navigator.clipboard.writeText(mintedKey.key);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    return (
        <div className="ers-page-form space-y-5 pb-24 animate-in fade-in duration-300">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        <KeyRound size={20} className="text-primary-600" /> API keys
                    </h1>
                    <p className="text-slate-500 text-sm mt-1 max-w-2xl">
                        Credentials for pushing data into IREAMS from outside — each integration gets its own key,
                        so one can be revoked without cutting off the rest, and every push is attributable.
                    </p>
                </div>
                <button onClick={() => { setShowMint((v) => !v); setMintedKey(null); }}
                    className="flex items-center gap-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold px-4 py-2.5 transition-colors">
                    <Plus size={15} /> New key
                </button>
            </div>

            {/* What a key unlocks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-1">
                        <ArrowRightLeft size={14} className="text-primary-600" /> CMMS sync
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        Nightly work-order delta from SAP / Maximo / any CMMS.
                        POST to <span className="font-mono text-[11px] bg-slate-100 px-1 rounded break-all">{functionsBase}/ingest-work-orders</span> with
                        header <span className="font-mono text-[11px] bg-slate-100 px-1 rounded">x-api-key</span>. See docs/CMMS-Sync-API.md.
                    </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-1">
                        <Satellite size={14} className="text-primary-600" /> Sensor push
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        Collectors and gateways (OPC-UA, MQTT, historians, devices) stream readings to{' '}
                        <span className="font-mono text-[11px] bg-slate-100 px-1 rounded break-all">{functionsBase}/ingest-readings</span> with
                        the same header. Feeds the digital twin — and condition-based PMs where a reading definition names its sensor tag.
                    </p>
                </div>
            </div>

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
                </div>
            )}

            {/* One-time key reveal */}
            {mintedKey && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
                    <div className="text-sm font-bold text-emerald-800">
                        Key for “{mintedKey.name}” — copy it now, it is shown only once
                    </div>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-[12px] bg-white border border-emerald-200 rounded-lg px-3 py-2.5 break-all select-all">
                            {mintedKey.key}
                        </code>
                        <button onClick={() => void copyKey()}
                            className="flex items-center gap-1.5 shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2.5 transition-colors">
                            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    <p className="text-xs text-emerald-700">
                        Only a hash is stored — if the key is lost, revoke it and mint a new one.
                    </p>
                </div>
            )}

            {/* Mint form */}
            {showMint && (
                <div className="rounded-2xl border border-primary-200 bg-primary-50/50 p-5 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="font-medium text-slate-600">Name — where will this key live?</span>
                            <input value={mintName} onChange={(e) => setMintName(e.target.value)}
                                placeholder="Plant A nightly SAP sync"
                                className="rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-700 text-sm" />
                        </label>
                        <label className="flex flex-col gap-1 text-xs">
                            <span className="font-medium text-slate-600">Note (optional)</span>
                            <input value={mintNote} onChange={(e) => setMintNote(e.target.value)}
                                placeholder="Contact: J. Doe, IT integration"
                                className="rounded-lg border border-slate-200 px-3 py-2 bg-white text-slate-700 text-sm" />
                        </label>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => void mint()} disabled={minting || !mintName.trim()}
                            className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold px-4 py-2 disabled:opacity-40 transition-colors">
                            {minting ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Mint key
                        </button>
                        <button onClick={() => setShowMint(false)} className="text-xs text-slate-500 hover:text-slate-700 px-3">Cancel</button>
                    </div>
                </div>
            )}

            {/* Key list */}
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-sm">
                        <Loader2 size={18} className="animate-spin" /> Loading keys…
                    </div>
                ) : keys.length === 0 ? (
                    <div className="p-10 text-center">
                        <KeyRound size={30} className="text-slate-300 mx-auto mb-3" />
                        <h2 className="text-sm font-semibold text-slate-700">No API keys yet</h2>
                        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                            Mint one to connect a nightly CMMS sync or a sensor collector. Keys are shown once and stored hashed.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 border-b border-slate-100">
                                <tr>
                                    <th className="text-left font-semibold text-slate-500 text-xs uppercase tracking-wide px-4 py-3">Name</th>
                                    <th className="text-left font-semibold text-slate-500 text-xs uppercase tracking-wide px-4 py-3">Key</th>
                                    <th className="text-left font-semibold text-slate-500 text-xs uppercase tracking-wide px-4 py-3">Last seen</th>
                                    <th className="text-right font-semibold text-slate-500 text-xs uppercase tracking-wide px-4 py-3">Readings</th>
                                    <th className="text-left font-semibold text-slate-500 text-xs uppercase tracking-wide px-4 py-3">Status</th>
                                    <th className="px-4 py-3"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {keys.map((k) => (
                                    <tr key={k.id} className="hover:bg-slate-50/60">
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-800">{k.name}</div>
                                            {k.note && <div className="text-[11px] text-slate-400 truncate max-w-[16rem]" title={k.note}>{k.note}</div>}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{k.key_prefix}…</td>
                                        <td className="px-4 py-3 text-xs text-slate-500"
                                            title={k.last_seen_at ? new Date(k.last_seen_at).toLocaleString() : 'This key has never made a request — a silent integration is visible here'}>
                                            {timeAgo(k.last_seen_at)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-500">{Number(k.readings_count).toLocaleString()}</td>
                                        <td className="px-4 py-3">
                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${k.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                                                {k.is_active ? 'active' : 'revoked'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => void setActive(k, !k.is_active)} disabled={rowBusy !== null}
                                                title={k.is_active ? 'Revoke — rejected from the next request on' : 'Reactivate this key'}
                                                className={`inline-flex items-center gap-1 rounded-lg border text-[11px] font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-40 ${k.is_active
                                                    ? 'border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600'
                                                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'}`}>
                                                {rowBusy === k.id ? <Loader2 size={12} className="animate-spin" />
                                                    : k.is_active ? <ShieldOff size={12} /> : <Shield size={12} />}
                                                {k.is_active ? 'Revoke' : 'Reactivate'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ApiKeysPage;
