import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { User, ModulePermissions, DataScope } from '../types';
import {
    ROLE_PERMISSION_TEMPLATES, BASE_PACKAGE_DEFAULTS,
    BASIC_ACCESS, NO_ACCESS_PERM
} from '../constants/rolePermissions';

interface AuthContextType {
    user: SupabaseUser | null;
    profile: User | null;     // Application User Profile
    permissions: Record<string, ModulePermissions> | null; // Resolved Permissions
    role: string | null;      // Current Role Code (e.g. TECHNICIAN)
    dataScope: DataScope | null; // Resolved Data Scope (site/department boundaries)
    loading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    profile: null,
    permissions: null,
    role: null,
    dataScope: null,
    loading: true,
    signOut: async () => { },
});

// ── Optimistic profile cache ────────────────────────────────────────────────
// Last-known profile/permissions are cached per-user so warm loads paint
// instantly while the real values revalidate in the background. WRITTEN only
// from the verified fetchProfile path, and READ only when the stored userId
// matches the current session — so it can speed up but never expose another
// user's data or render against malformed data.
const PROFILE_CACHE_KEY = 'ers_auth_profile_v1';
interface CachedAuth {
    userId: string;
    profile: User;
    permissions: Record<string, ModulePermissions>;
    role: string;
    dataScope: DataScope;
}
const readProfileCache = (userId: string): CachedAuth | null => {
    try {
        const raw = localStorage.getItem(PROFILE_CACHE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw) as CachedAuth;
        if (c?.userId === userId && c.profile?.id && c.permissions && c.role && c.dataScope) return c;
    } catch { /* ignore parse/storage errors */ }
    return null;
};
const writeProfileCache = (c: CachedAuth): void => {
    try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(c)); } catch { /* quota / private mode */ }
};
const clearProfileCache = (): void => {
    try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
};

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [profile, setProfile] = useState<User | null>(null);
    const [permissions, setPermissions] = useState<Record<string, ModulePermissions> | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [dataScope, setDataScope] = useState<DataScope | null>(null);
    const [loading, setLoading] = useState(true);
    // Which user id we've already initiated a profile fetch for (dedupes the
    // getSession + INITIAL_SESSION double-signal without a stale closure).
    const fetchedForUserRef = useRef<string | null>(null);

    useEffect(() => {
        let mounted = true;

        // Fetch a user's profile exactly once. The two init signals (getSession and
        // onAuthStateChange's INITIAL_SESSION) both land here for the same user; the
        // ref dedupes them so we never double-fetch — and, critically, never reset an
        // already-painted session back into the loading gate (the old stale-closure
        // guard captured `profile` at mount, so it never skipped → the app would load,
        // then blank on INITIAL_SESSION, needing a second refresh).
        const initProfile = (u: SupabaseUser) => {
            if (fetchedForUserRef.current === u.id) return;
            fetchedForUserRef.current = u.id;
            // Optimistic warm-load paint from cache, then revalidate.
            const cached = readProfileCache(u.id);
            if (cached) {
                setProfile(cached.profile);
                setPermissions(cached.permissions);
                setRole(cached.role);
                setDataScope(cached.dataScope);
                setLoading(false);
            }
            fetchProfile(u);
        };

        // 1. Restore any active session.
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (!mounted) return;
            setUser(session?.user ?? null);
            if (session?.user) {
                initProfile(session.user);
            } else {
                clearProfileCache();
                console.log('[AuthContext] No Supabase session — redirecting to login.');
                setLoading(false);
            }
        }).catch(err => {
            console.error("Auth initialization error:", err);
            if (mounted) setLoading(false);
        });

        // 2. React to auth changes. Profile work is DEFERRED out of this callback:
        //    running awaited Supabase queries directly inside onAuthStateChange can
        //    contend with GoTrue's auth lock (a documented deadlock) and hang the
        //    first load — the classic "have to refresh twice" symptom.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!mounted) return;
            setUser(session?.user ?? null);
            if (session?.user) {
                if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                    setTimeout(() => { if (mounted) initProfile(session.user); }, 0);
                }
                // TOKEN_REFRESHED / USER_UPDATED: user object updated, profile stays intact.
            } else {
                fetchedForUserRef.current = null;
                clearProfileCache();
                setProfile(null);
                setPermissions(null);
                setRole(null);
                setDataScope(null);
                setLoading(false);
            }
        });

        return () => { mounted = false; subscription.unsubscribe(); };
    }, []);

    const fetchProfile = async (currentUser: SupabaseUser) => {
        try {
            // A. Get User Profile — single round-trip: match email OR the derived
            // username (email prefix, case-insensitive — e.g. "J.test1" → "j.test1").
            // Previously this was two sequential queries, which gated first paint.
            let userData: any = null;
            let userError: any = null;

            const derivedUser = currentUser.email?.split('@')[0] || '';
            const orFilters = [
                currentUser.email ? `email.eq.${currentUser.email}` : '',
                derivedUser ? `username.ilike.${derivedUser}` : '',
            ].filter(Boolean).join(',');

            if (orFilters) {
                const userLookup = await supabase
                    .from('users')
                    .select('*')
                    .or(orFilters)
                    .limit(2);

                if (userLookup.error) {
                    userError = userLookup.error;
                } else if (userLookup.data && userLookup.data.length > 0) {
                    // Prefer an exact email match, else fall back to the username match.
                    userData = userLookup.data.find((u: any) => u.email === currentUser.email) || userLookup.data[0];
                }
            }

            if (userError || !userData) {
                console.warn("No user profile found for email:", currentUser.email, "— attempting contact lookup.");
                const derivedUsername = currentUser.email?.split('@')[0] || 'user';

                // Try to find a matching contact by username
                let contactName = currentUser.user_metadata?.full_name || derivedUsername;
                let contactRole = '';
                let contactId = '';
                let contactDept = '';

                const { data: contactMatch } = await supabase
                    .from('contacts')
                    .select('id, name, roles, organization_unit_id, organization_units(name)')
                    .ilike('name', `%${derivedUsername.replace('.', ' ')}%`)
                    .limit(1)
                    .maybeSingle();

                if (contactMatch) {
                    contactName = contactMatch.name || contactName;
                    contactId = contactMatch.id || '';
                    contactRole = (contactMatch.roles && (contactMatch.roles as string[]).length > 0)
                        ? (contactMatch.roles as string[])[0] : '';
                    contactDept = (contactMatch as any).organization_units?.name || '';
                }

                setProfile({
                    id: currentUser.id,
                    username: derivedUsername,
                    contactId: contactId,
                    status: 'active',
                    mfaEnabled: false,
                    fullName: contactName,
                    email: currentUser.email || '',
                    department: contactDept,
                    roleLabel: contactRole || 'User',
                });
                setPermissions({ ...BASE_PACKAGE_DEFAULTS });
                setDataScope({ siteIds: ['*'], departmentIds: [], ownWorkOnly: false }); // No profile = global (fail-open for scope on unknown users since perms are already fail-closed)
                console.warn(`[AuthContext] ⚠ No user profile row found — applying BASE_PACKAGE_DEFAULTS (fail-closed). Role: "${contactRole || 'USER'}"`);
                setRole(contactRole || 'USER');
                setLoading(false);
                return;
            }

            // ── Resolve EVERYTHING the gate needs from the `users` row alone, so it
            // clears after ONE round-trip. Role, permissions (client-side templates)
            // and data-scope are all derivable here. The linked Contact (display
            // name / dept) and the custom-role permission dict are enriched in the
            // BACKGROUND afterwards — the profile is set NON-NULL first, so nothing
            // ever renders against a null profile.
            const roleCode = (userData.roles && Array.isArray(userData.roles) && userData.roles.length > 0)
                ? userData.roles[0] : 'GUEST';

            // Permission templates are the authoritative source; the reference_codes
            // dict only matters for roles WITHOUT a template (fetched in background).
            const templatePerms = ROLE_PERMISSION_TEMPLATES[roleCode];
            const basePermissions: Record<string, ModulePermissions> = templatePerms || { ...BASE_PACKAGE_DEFAULTS };
            const userOverrides = userData.permission_overrides || {};
            const finalPermissions = { ...basePermissions };
            Object.keys(userOverrides).forEach(moduleKey => {
                finalPermissions[moduleKey] = { ...(finalPermissions[moduleKey] || {}), ...userOverrides[moduleKey] };
            });

            const dbScope = userData.data_scope_overrides as Partial<DataScope> | null;

            // Commit a complete, non-null profile + fail-closed permissions, then
            // unblock the app (1 round-trip).
            const resolvedProfile: User = {
                id: userData.id,
                username: userData.username,
                contactId: userData.contact_id,
                status: userData.status,
                mfaEnabled: userData.mfa_enabled,
                fullName: userData.username,        // enriched with contact name below
                email: currentUser.email || '',
                department: '',
                roleLabel: roleCode,
            };
            const resolvedScope: DataScope = {
                siteIds: dbScope?.siteIds || ['*'],
                departmentIds: dbScope?.departmentIds || [],
                ownWorkOnly: dbScope?.ownWorkOnly || false,
            };
            setProfile(resolvedProfile);
            setRole(roleCode);
            setPermissions(finalPermissions);
            setDataScope(resolvedScope);
            setLoading(false);
            // Cache for instant warm-load hydration next time.
            writeProfileCache({ userId: currentUser.id, profile: resolvedProfile, permissions: finalPermissions, role: roleCode, dataScope: resolvedScope });

            // ── Background enrichment (does NOT block first paint) ──
            // 1. Contact → better display name / email / department, and a role
            //    fallback when the users row had no role.
            if (userData.contact_id) {
                supabase
                    .from('contacts')
                    .select('name, email, roles, organization_unit_id, organization_units(name)')
                    .eq('id', userData.contact_id)
                    .maybeSingle()
                    .then(({ data: c }: any) => {
                        if (!c) return;
                        const contactRoleLabel = (c.roles && (c.roles as string[]).length > 0) ? (c.roles as string[])[0] : '';
                        setProfile(prev => prev ? {
                            ...prev,
                            fullName: c.name || prev.fullName,
                            email: c.email || prev.email,
                            department: c.organization_units?.name || prev.department,
                            roleLabel: prev.roleLabel && prev.roleLabel !== 'GUEST' ? prev.roleLabel : (contactRoleLabel || prev.roleLabel),
                        } : prev);
                        if (roleCode === 'GUEST' && contactRoleLabel) setRole(contactRoleLabel);
                    });
            }
            // 2. Custom-role permission dict — only when no code template exists.
            if (!templatePerms) {
                supabase
                    .from('reference_codes')
                    .select('properties')
                    .eq('category', 'CONTACT_TYPE')
                    .eq('code', roleCode)
                    .maybeSingle()
                    .then(({ data: d, error: e }: any) => {
                        if (e || !d?.properties?.permissions) return;
                        const merged: Record<string, ModulePermissions> = { ...d.properties.permissions };
                        Object.keys(userOverrides).forEach(mk => { merged[mk] = { ...(merged[mk] || {}), ...userOverrides[mk] }; });
                        setPermissions(merged);
                    });
            }

        } catch (error) {
            console.error("Error fetching profile:", error);
            // Safety net (fail-closed per NIST/ISO 55000). Crucially, set a NON-NULL
            // profile so the app never renders against a null profile when the gate
            // clears below — even if the users query failed.
            setProfile(prev => prev ?? {
                id: currentUser.id,
                username: currentUser.email?.split('@')[0] || 'user',
                contactId: '',
                status: 'active',
                mfaEnabled: false,
                fullName: currentUser.email?.split('@')[0] || 'User',
                email: currentUser.email || '',
                department: '',
                roleLabel: 'USER',
            });
            setPermissions(prev => prev ?? { ...BASE_PACKAGE_DEFAULTS });
            setRole(prev => prev ?? 'USER');
            setDataScope(prev => prev ?? { siteIds: ['*'], departmentIds: [], ownWorkOnly: false });
        } finally {
            setLoading(false);
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('ers_access_token');
        fetchedForUserRef.current = null;
        clearProfileCache();
        setProfile(null);
        setPermissions(null);
        setRole(null);
        setDataScope(null);
    };

    return (
        <AuthContext.Provider value={{ user, profile, permissions, role, dataScope, loading, signOut }}>
            {children}
        </AuthContext.Provider>
    );
};
