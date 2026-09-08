/**
 * assessmentInvites — the answer side of an assessment invitation (0338).
 *
 * An invitation is a row in audit_assessment_collaborators addressed to an
 * email. Until 0338 nothing ever changed its status: the invitee had no way to
 * accept or decline, and the inviter saw "Pending" forever. The answer goes
 * through respond_to_assessment_invite(), which checks the row is the caller's
 * and grants audits access sized to the role only on acceptance.
 */
import { supabase } from '../lib/supabase';
import { NotificationService } from './NotificationService';

export type InviteRole = 'viewer' | 'contributor';
export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface InviteAnswer {
    ok: boolean;
    reason?: 'not_found' | 'not_yours';
    unchanged?: boolean;
    status?: InviteStatus;
    assessment_id?: string;
    role?: InviteRole;
    invited_by?: string | null;
    email?: string;
}

export interface SharedInvite {
    found: boolean;
    assessment_id?: string;
    assessment_number?: string | null;
    role?: InviteRole;
    status?: InviteStatus;
    email?: string;
    invited_by?: string | null;
    /** True when the invitation is addressed to the signed-in user. */
    mine?: boolean;
}

/** Record-level route for an assessment — the same deep link the invite panel copies. */
export const assessmentRoute = (assessmentId: string) => `/audits?open=${encodeURIComponent(assessmentId)}`;

/** Shared-link route carrying the invitation token (external invitees). */
export const assessmentInviteLink = (token: string) =>
    `${window.location.origin}/audits?invite=${encodeURIComponent(token)}`;

/**
 * Accept or decline. Pass either the assessment id (the caller's own row is
 * found by email) or a shared-link token. On a real change the inviter is
 * told the answer.
 */
export async function respondToAssessmentInvite(opts: {
    accept: boolean;
    assessmentId?: string;
    token?: string;
    /** Who answered — for the inviter's notification. */
    responder?: { id?: string; name?: string };
}): Promise<InviteAnswer> {
    const { data, error } = await supabase.rpc('respond_to_assessment_invite', {
        p_accept: opts.accept,
        p_assessment: opts.assessmentId ?? null,
        p_token: opts.token ?? null,
    });
    if (error) throw error;
    const answer = (data || { ok: false }) as InviteAnswer;
    if (answer.ok && !answer.unchanged) {
        await notifyInviter(answer, opts.accept, opts.responder).catch(e =>
            console.warn('[assessmentInvites] Non-critical: inviter notification failed', e));
    }
    return answer;
}

export async function getAssessmentInvite(token: string): Promise<SharedInvite> {
    const { data, error } = await supabase.rpc('get_assessment_invite', { p_token: token });
    if (error) throw error;
    return (data || { found: false }) as SharedInvite;
}

/** The caller's own invitation on an assessment, if any (RLS: same tenant). */
export async function getMyInvite(assessmentId: string, email: string): Promise<{ id: string; role: InviteRole; status: InviteStatus; invitedBy: string | null } | null> {
    if (!assessmentId || !email) return null;
    const { data } = await supabase
        .from('audit_assessment_collaborators')
        .select('id, role, status, invited_by')
        .eq('assessment_id', assessmentId)
        .ilike('email', email)
        .order('invited_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!data) return null;
    return { id: data.id, role: data.role, status: data.status, invitedBy: data.invited_by };
}

async function notifyInviter(answer: InviteAnswer, accepted: boolean, responder?: { id?: string; name?: string }) {
    const inviterEmail = (answer.invited_by || '').trim();
    if (!inviterEmail || !inviterEmail.includes('@') || !answer.assessment_id) return;
    const { data: inviter } = await supabase
        .from('users').select('id').ilike('email', inviterEmail).maybeSingle();
    if (!inviter?.id) return;
    const who = responder?.name || 'Your colleague';
    await NotificationService.notify({
        recipientId: inviter.id,
        title: accepted ? '✅ Assessment invitation accepted' : '✖ Assessment invitation declined',
        message: accepted
            ? `${who} accepted your invitation and joined the assessment as ${answer.role}.`
            : `${who} declined your invitation to the assessment.`,
        severity: 'INFO',
        notificationType: 'STATUS_CHANGE',
        module: 'audits',
        entityId: answer.assessment_id,
        entityType: 'ASSESSMENT',
        actionLink: assessmentRoute(answer.assessment_id),
        actionRequired: false,
        createdBy: responder?.id || 'SYSTEM',
    });
}
