import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * One place that answers "what may this person do in Reliability Modelling?"
 * — the page equivalent of the 0358 database rules, so the UI never offers an
 * action the database will refuse (audit M-5: a view-only technician was
 * offered Save / Create PM Program / Apply min level).
 */
export interface ReliabilityPerms {
    uid: string | null;
    isAdmin: boolean;
    canView: boolean;
    /** save analyses, create studies, edit own studies */
    canEdit: boolean;
    /** holds reliability.approve — whether a GIVEN study can be approved also needs `canApproveStudy` */
    canApprove: boolean;
    /** create a PM program (pm.create / pm.edit) */
    canCreatePm: boolean;
    /** change an inventory item's min/max level (inventory.edit) */
    canApplyStock: boolean;
    /** four-eyes: approve this study — never its own author unless admin */
    canApproveStudy: (study: { created_by_user_id?: string | null }) => boolean;
    /** edit this study — admin, reliability.edit, or its author */
    canEditStudy: (study: { created_by_user_id?: string | null }) => boolean;
}

export function useReliabilityPerms(): ReliabilityPerms {
    const { user, permissions, role } = useAuth() as any;
    return useMemo(() => {
        const uid: string | null = user?.id ?? null;
        const isAdmin = ['SUPER_ADMIN', 'SYS_ADMIN'].includes(String(role || '').toUpperCase());
        const rel = permissions?.reliability || {};
        const pm = permissions?.pm || {};
        const inv = permissions?.inventory || {};
        const canEdit = isAdmin || rel.edit === true || rel.create === true;
        const canApprove = isAdmin || rel.approve === true;
        return {
            uid,
            isAdmin,
            canView: isAdmin || rel.view === true,
            canEdit,
            canApprove,
            canCreatePm: isAdmin || pm.create === true || pm.edit === true,
            canApplyStock: isAdmin || inv.edit === true,
            canApproveStudy: s => isAdmin || (rel.approve === true && !!uid && s.created_by_user_id !== uid),
            canEditStudy: s => isAdmin || rel.edit === true || (canEdit && !!uid && s.created_by_user_id === uid),
        };
    }, [user?.id, permissions, role]);
}
