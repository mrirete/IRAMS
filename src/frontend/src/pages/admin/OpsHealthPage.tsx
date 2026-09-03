/**
 * OpsHealthPage — /admin/ops-health (launch review B8).
 *
 * Before this page a missing vault secret made the Monday briefing and the
 * nightly watchdog silent no-ops, a dead outbox looked like "no email", and
 * client errors were written to error_logs but nobody looked. This reads
 * ops_health() (0310, admin-only): every cron job with its last run outcome,
 * outbox failures, error volume and the last briefing / watchdog run.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, RefreshCw, AlertTriangle, CheckCircle2, Clock, Mail, Bug, Loader2 } from 'lucide-react';
import { supabase } from '../../eam/lib/supabase';

interface CronRow { jobname: string; schedule: string; active: boolean; last_status: string | null; last_run: string | null; last_message: string | null }
interface Health {
    checked_at: string; pg_cron: boolean; crons: CronRow[];
    outbox_failed_7d: number; outbox_pending: number; errors_24h: number; errors_7d: number;
    last_briefing: string | null; last_watchdog: string | null;
}

const ago = (iso: string | null): string => {
    if (!iso) return 'never';
    const h = (Date.now() - new Date(iso).getTime()) / 36e5;
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
    if (h < 48) return `${Math.round(h)} h ago`;
    return `${Math.round(h / 24)} d ago`;
};
const stale = (iso: string | null, hours: number) => !iso || (Date.now() - new Date(iso).getTime()) / 36e5 > hours;

export const OpsHealthPage: React.FC = () => {
    const [h, setH] = useState<Health | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true); setErr(null);
        const { data, error } = await supabase.rpc('ops_health');
        if (error) setErr(error.message.includes('ops_health') && error.message.includes('does not exist') ? 'Migration 0310 is not applied on this project yet.' : error.message);
        else setH(data as Health);
        setLoading(false);
    };
    useEffect(() => { load(); }, []);

    const problems: string[] = [];
    if (h) {
        if (!h.pg_cron) problems.push('pg_cron is not enabled on this project: no scheduled job can run.');
        for (const c of h.crons) {
            if (!c.active) problems.push(`${c.jobname} is disabled.`);
            else if (c.last_status && c.last_status !== 'succeeded') problems.push(`${c.jobname} last run ${c.last_status}: ${c.last_message || ''}`.trim());
            else if (!c.last_run) problems.push(`${c.jobname} has never run.`);
        }
        if (h.outbox_failed_7d > 0) problems.push(`${h.outbox_failed_7d} notification email(s) failed to send in the last 7 days — check RESEND_API_KEY on notify-dispatch.`);
        if (stale(h.last_briefing, 24 * 8)) problems.push('No Monday briefing in the last 8 days — check the briefing cron and the vault secrets project_url / briefing_cron_key.');
        if (stale(h.last_watchdog, 48)) problems.push('No nightly watchdog run in the last 48 hours.');
    }

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2"><Activity size={22} className="text-primary-600" /> Operations Health</h1>
                    <p className="text-sm text-slate-500 mt-1">Scheduled jobs, email delivery, client errors and the Specialist's last runs — what would otherwise fail silently.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Link to="/admin/error-logs" className="text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 flex items-center gap-1.5"><Bug size={13} /> Error log</Link>
                    <button onClick={load} className="text-xs font-semibold text-white bg-primary-600 rounded-lg px-3 py-2 hover:bg-primary-500 flex items-center gap-1.5"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button>
                </div>
            </div>

            {err && <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"><AlertTriangle size={16} /> {err}</div>}
            {loading && !h && <div className="text-slate-400 text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading…</div>}

            {h && (
                <>
                    <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${problems.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                        {problems.length === 0
                            ? <span className="flex items-center gap-2"><CheckCircle2 size={16} /> Everything scheduled has run and nothing is failing. Checked {ago(h.checked_at)}.</span>
                            : <ul className="list-disc pl-5 space-y-1">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                        <Tile label="Cron jobs" value={`${h.crons.filter(c => c.active).length}/${h.crons.length}`} sub="active" icon={<Clock size={14} />} />
                        <Tile label="Email failed · 7d" value={String(h.outbox_failed_7d)} sub={`${h.outbox_pending} pending`} icon={<Mail size={14} />} tone={h.outbox_failed_7d > 0 ? 'bad' : 'ok'} />
                        <Tile label="Client errors · 24h" value={String(h.errors_24h)} sub={`${h.errors_7d} in 7 days`} icon={<Bug size={14} />} tone={h.errors_24h > 20 ? 'bad' : 'ok'} />
                        <Tile label="Last briefing" value={ago(h.last_briefing)} sub="Monday digest" icon={<Activity size={14} />} tone={stale(h.last_briefing, 24 * 8) ? 'bad' : 'ok'} />
                        <Tile label="Last watchdog" value={ago(h.last_watchdog)} sub="nightly sweep" icon={<Activity size={14} />} tone={stale(h.last_watchdog, 48) ? 'bad' : 'ok'} />
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-800">Scheduled jobs</div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                                    <tr><th className="text-left px-4 py-2">Job</th><th className="text-left px-4 py-2">Schedule (UTC)</th><th className="text-left px-4 py-2">Last run</th><th className="text-left px-4 py-2">Outcome</th><th className="text-left px-4 py-2">Message</th></tr>
                                </thead>
                                <tbody>
                                    {h.crons.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No cron jobs are registered on this project.</td></tr>}
                                    {h.crons.map(c => (
                                        <tr key={c.jobname} className="border-t border-slate-100">
                                            <td className="px-4 py-2 font-mono text-xs">{c.jobname}{!c.active && <span className="ml-2 text-[10px] text-red-600 font-bold">DISABLED</span>}</td>
                                            <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.schedule}</td>
                                            <td className="px-4 py-2 text-slate-600">{ago(c.last_run)}</td>
                                            <td className="px-4 py-2">{c.last_status ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.last_status === 'succeeded' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{c.last_status}</span> : <span className="text-[10px] text-slate-400">never</span>}</td>
                                            <td className="px-4 py-2 text-xs text-slate-500 max-w-[28rem] truncate" title={c.last_message || ''}>{c.last_message || ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

const Tile: React.FC<{ label: string; value: string; sub?: string; icon: React.ReactNode; tone?: 'ok' | 'bad' }> = ({ label, value, sub, icon, tone }) => (
    <div className={`bg-white border rounded-xl p-4 ${tone === 'bad' ? 'border-red-200' : 'border-slate-200'}`}>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">{icon} {label}</p>
        <p className={`text-xl font-black mt-1 ${tone === 'bad' ? 'text-red-600' : 'text-slate-800'}`}>{value}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
);

export default OpsHealthPage;
