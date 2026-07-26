/**
 * ThreadPanel — the reusable contextual conversation, mounted on any work
 * object (work order, request, RCA, asset, work group). Realtime, append-only,
 * @mention-aware, offline-capable. One component, five surfaces.
 *
 * Mobile-first: fills its container; the composer sticks to the bottom with
 * large touch targets. On desktop it slots into a detail tab/column.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, AtSign, MessagesSquare, WifiOff } from 'lucide-react';
import { messagingService, type Message, type ThreadType } from '../../eam/services/MessagingService';
import { DatabaseService } from '../../eam/services/DatabaseService';
import { useAuth } from '../../eam/contexts/AuthContext';

interface Person { id: string; name: string; }

interface Props {
    threadType: ThreadType;
    threadId: string;
    /** Human label for notifications / header, e.g. "WO-2026-4526". */
    threadLabel?: string;
    className?: string;
}

const initials = (name: string) => name.split(/[\s._]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';

// Deterministic avatar tint from the name (calm palette, no random).
const TINTS = ['bg-primary-100 text-primary-700', 'bg-blue-100 text-blue-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700'];
const tintFor = (s: string) => TINTS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];

function fmtTime(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const ThreadPanel: React.FC<Props> = ({ threadType, threadId, threadLabel, className }) => {
    const { user, profile } = useAuth();
    const myId = user?.id || '';
    const myName = profile?.username || user?.email || 'You';

    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [body, setBody] = useState('');
    const [sending, setSending] = useState(false);
    const [people, setPeople] = useState<Person[]>([]);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);

    const scrollToEnd = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));

    // People list for @mentions (users linked to a contact for display names).
    useEffect(() => {
        (async () => {
            const db = DatabaseService.getInstance();
            const [users, contacts] = await Promise.all([db.getUsers(), db.getContacts()]);
            const nameByContact = new Map((contacts as any[]).map(c => [c.id, c.name]));
            setPeople((users as any[])
                .filter(u => u.id && u.status !== 'inactive')
                .map(u => ({ id: u.id, name: nameByContact.get(u.contactId) || u.username || 'User' })));
        })();
    }, []);

    // Load + realtime subscribe + mark read.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        messagingService.getMessages(threadType, threadId).then(ms => {
            if (cancelled) return;
            setMessages(ms);
            setLoading(false);
            scrollToEnd();
            if (myId) messagingService.markRead(myId, threadType, threadId);
        });
        const unsub = messagingService.subscribe(threadType, threadId, m => {
            setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
            scrollToEnd();
            if (myId && m.sender_id !== myId) messagingService.markRead(myId, threadType, threadId);
        });
        return () => { cancelled = true; unsub(); };
    }, [threadType, threadId, myId]);

    // Detect the @token currently being typed (for the mention menu).
    const onChange = (v: string) => {
        setBody(v);
        const upToCaret = v.slice(0, taRef.current?.selectionStart ?? v.length);
        const m = upToCaret.match(/(?:^|\s)@([\w.]*)$/);
        setMentionQuery(m ? m[1].toLowerCase() : null);
    };

    const mentionMatches = useMemo(() => {
        if (mentionQuery === null) return [];
        return people
            .filter(p => p.id !== myId && p.name.toLowerCase().includes(mentionQuery))
            .slice(0, 6);
    }, [mentionQuery, people, myId]);

    const pickMention = (p: Person) => {
        // Replace the trailing @token with "@Name " and remember the resolved id.
        setBody(prev => prev.replace(/(^|\s)@([\w.]*)$/, `$1@${p.name} `));
        setMentionQuery(null);
        taRef.current?.focus();
    };

    // Resolve @Name tokens in the final body back to user ids at send time.
    const resolveMentions = (text: string): string[] => {
        const ids = new Set<string>();
        for (const p of people) {
            if (p.id === myId) continue;
            if (new RegExp(`@${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`).test(text)) ids.add(p.id);
        }
        return [...ids];
    };

    const send = async () => {
        const text = body.trim();
        if (!text || !myId || sending) return;
        setSending(true);
        const mentions = resolveMentions(text);
        try {
            const { message, queued } = await messagingService.postMessage({
                threadType, threadId, body: text, senderId: myId, senderName: myName, mentions, threadLabel,
            });
            // Optimistic echo (realtime will dedupe by id when the insert lands).
            setMessages(prev => prev.some(x => x.id === message.id) ? prev : [...prev, { ...message, _queued: queued } as any]);
            setBody(''); setMentionQuery(null);
            scrollToEnd();
        } finally {
            setSending(false);
        }
    };

    return (
        <div className={`flex flex-col h-full min-h-[300px] bg-white ${className || ''}`}>
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-3">
                {loading ? (
                    <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading conversation…</div>
                ) : messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 py-8">
                        <MessagesSquare size={28} className="mb-2 opacity-30" />
                        <p className="text-sm font-semibold text-slate-500">No messages yet</p>
                        <p className="text-xs mt-1 max-w-xs">Start the conversation — notes here stay on the record and are visible to everyone on this work. Type <span className="font-mono">@</span> to mention a teammate.</p>
                    </div>
                ) : messages.map(m => {
                    const mine = m.sender_id === myId;
                    const name = m.sender_name || people.find(p => p.id === m.sender_id)?.name || 'User';
                    return (
                        <div key={m.id} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-extrabold ${tintFor(name)}`}>{initials(name)}</div>
                            <div className={`min-w-0 max-w-[80%] ${mine ? 'items-end text-right' : ''} flex flex-col`}>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 mb-0.5">
                                    <span className="font-bold text-slate-500">{mine ? 'You' : name}</span>
                                    <span>{fmtTime(m.created_at)}</span>
                                    {(m as any)._queued && <span className="flex items-center gap-0.5 text-amber-500"><WifiOff size={9} /> queued</span>}
                                </div>
                                <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${mine ? 'bg-primary-600 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                                    {renderBody(m.body, mine)}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Composer */}
            <div className="border-t border-slate-100 p-2.5 sm:p-3 shrink-0 relative">
                {mentionMatches.length > 0 && (
                    <div className="absolute bottom-full left-3 mb-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-10">
                        {mentionMatches.map(p => (
                            <button key={p.id} onClick={() => pickMention(p)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-primary-50 text-xs">
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-extrabold ${tintFor(p.name)}`}>{initials(p.name)}</span>
                                <span className="font-semibold text-slate-700">{p.name}</span>
                            </button>
                        ))}
                    </div>
                )}
                <div className="flex items-end gap-2">
                    <textarea
                        ref={taRef}
                        value={body}
                        onChange={e => onChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !mentionMatches.length) { e.preventDefault(); send(); } }}
                        rows={1}
                        placeholder="Message the team…  (@ to mention)"
                        className="flex-1 resize-none max-h-28 rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400"
                    />
                    <button onClick={send} disabled={sending || !body.trim()}
                        className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl bg-primary-600 text-white hover:bg-primary-500 disabled:opacity-40 transition-all">
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                </div>
                <p className="text-[9px] text-slate-300 mt-1 flex items-center gap-1"><AtSign size={9} /> Messages stay on the record · everyone on this work can see them</p>
            </div>
        </div>
    );
};

// Highlight @mentions inline.
function renderBody(text: string, mine: boolean) {
    const parts = text.split(/(@[\w.]+(?:\s[\w.]+)?)/g);
    return parts.map((p, i) =>
        p.startsWith('@')
            ? <span key={i} className={`font-bold ${mine ? 'text-primary-100 underline' : 'text-primary-600'}`}>{p}</span>
            : <React.Fragment key={i}>{p}</React.Fragment>,
    );
}

export default ThreadPanel;
