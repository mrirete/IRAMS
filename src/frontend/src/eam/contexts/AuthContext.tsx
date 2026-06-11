import React, { createContext, useContext, useEffect, useState } from 'react';
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

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<SupabaseUser | null>(null);
    const [profile, setProfile] = useState<User | null>(null);
    const [permissions, setPermissions] = useState<Record<string, ModulePermissions> | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [dataScope, setDataScope] = useState<DataScope | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 1. Check active session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user);
            } else {
                // No Supabase session — user must log in
                console.log('[AuthContext] No Supabase session — redirecting to login.');
                setLoading(false);
            }
        }).catch(err => {
            console.error("Auth initialization error:", err);
            setLoading(false);
        });

        // 2. Listen for auth changes (sign-in, sign-out, token refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            setUser(session?.user ?? null);
            if (session?.user) {
                // Only re-fetch profile on actual sign-in events, NOT on token refreshes.
                // TOKEN_REFRESHED fires periodically and should NOT clear existing state —
                // doing so causes a loading flicker (the "Authenticating…" loop).
                if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                    // Skip if we already have a profile for this same user (prevents
                    // double-fetch from getSession + onAuthStateChange race)
                    if (profile && profile.id === session.user.id) return;
                    setProfile(null);
                    setPermissions(null);
                    setRole(null);
                    setDataScope(null);
                    setLoading(true);
                    fetchProfile(session.user);
                }
                // TOKEN_REFRESHED: user object updated, but profile stays intact
            } else {
                setProfile(null);
                setPermissions(null);
                setRole(null);
                setDataScope(null);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const fetchProfile = async (currentUser: SupabaseUser) => {
        try {
            // A. Get User Profile — try by email first, then by username
            let userData: any = null;
            let userError: any = null;

            const emailResult = await supabase
                .from('users')
                .select('*')
                .eq('email', currentUser.email)
                .maybeSingle();

            if (emailResult.data) {
                userData = emailResult.data;
            } else {
                // Fallback: try by username (email prefix) — case-insensitive
                // because usernames like "J.test1" derive as "j.test1" from email
                const derivedUser = currentUser.email?.split('@')[0] || '';
                const usernameResult = await supabase
                    .from('users')
                    .select('*')
                    .ilike('username', derivedUser)
                    .maybeSingle();
                userData = usernameResult.data;
                userError = usernameResult.error;
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

            // Map DB User to UI User — start with basic fields,
            // then enrich from linked Contact
            let contactName = userData.username;
            let contactEmail = currentUser.email || '';
            let contactDepartment = '';
            let contactRoleLabel = '';

            // Fetch linked Contact for display data
            if (userData.contact_id) {
                const { data: contactData } = await supabase
                    .from('contacts')
                    .select('name, email, roles, organization_unit_id, organization_units(name)')
                    .eq('id', userData.contact_id)
                    .maybeSingle();

                if (contactData) {
                    contactName = contactData.name || userData.username;
                    contactEmail = contactData.email || contactEmail;
                    // Department from linked org unit
                    contactDepartment = (contactData as any).organization_units?.name || '';
                    // Role label from contact's roles array (same mapping as DatabaseService)
                    contactRoleLabel = (contactData.roles && (contactData.roles as string[]).length > 0)
                        ? (contactData.roles as string[])[0] : '';
                }
            }

            setProfile({
                id: userData.id,
                username: userData.username,
                contactId: userData.contact_id,
                status: userData.status,
                mfaEnabled: userData.mfa_enabled,
                fullName: contactName,
                email: contactEmail,
                department: contactDepartment,
                roleLabel: contactRoleLabel,
            });

            // B. Resolve Role (via Contact or direct role)
            let roleCode = 'GUEST';
            if (userData.roles && Array.isArray(userData.roles) && userData.roles.length > 0) {
                roleCode = userData.roles[0];
            } else if (contactRoleLabel) {
                // Fall back to contact's defaultType if no role in users table
                roleCode = contactRoleLabel;
            }

            setRole(roleCode);

            // C. Get Base Permissions from Dictionaries
            const { data: dictData, error: dictError } = await supabase
                .from('reference_codes')
                .select('properties')
                .eq('category', 'CONTACT_TYPE')
                .eq('code', roleCode)
                .maybeSingle();

            // Permission templates imported from '../constants/rolePermissions'
            // ROLE_PERMISSION_TEMPLATES, BASE_PACKAGE_DEFAULTS are the single source of truth

            let basePermissions: Record<string, ModulePermissions>;

            // ══ Permission Resolution: Code Templates → DB Override → Fallback ══
            if (ROLE_PERMISSION_TEMPLATES[roleCode]) {
                // Primary: Use hardcoded role template (version-controlled, authoritative)
                basePermissions = ROLE_PERMISSION_TEMPLATES[roleCode];
                console.log(`[AuthContext] ✓ Role "${roleCode}" resolved from ROLE_PERMISSION_TEMPLATES`);
            } else if (!dictError && dictData?.properties?.permissions) {
                // Secondary: DB-stored permissions for custom/dynamic roles
                basePermissions = dictData.properties.permissions;
                console.log(`[AuthContext] ✓ Role "${roleCode}" resolved from DB reference_codes`);
            } else {
                // Tertiary: Fail-closed with BASE_PACKAGE_DEFAULTS
                console.warn(`[AuthContext] ⚠ Unknown role "${roleCode}" — applying BASE_PACKAGE_DEFAULTS (fail-closed)`);
                basePermissions = BASE_PACKAGE_DEFAULTS;
            }

            // D. Apply User Overrides (Deep Merge)
            const userOverrides = userData.permission_overrides || {};
            const finalPermissions = { ...basePermissions };

            // Merge overrides: if user has override for a module, merge it in
            Object.keys(userOverrides).forEach(moduleKey => {
                finalPermissions[moduleKey] = {
                    ...(finalPermissions[moduleKey] || {}), // Base or empty
                    ...userOverrides[moduleKey]             // Override
                };
            });

            console.log(`[AuthContext] FINAL permissions for "${userData.username}":`, {
                finops: finalPermissions.finops?.view,
                admin: finalPermissions.admin?.view,
                moc: finalPermissions.moc?.view,
                notifications: finalPermissions.notifications?.view,
                analytics: finalPermissions.analytics?.view,
                assets: finalPermissions.assets?.view,
                overrideKeys: Object.keys(userOverrides),
            });

            setPermissions(finalPermissions);

            // E. Resolve Data Scope (Site/Department boundaries)
            // null data_scope_overrides = Global Access (matches SAP PM convention)
            const dbScope = userData.data_scope_overrides as Partial<DataScope> | null;
            const resolvedScope: DataScope = {
                siteIds: dbScope?.siteIds || ['*'],         // null/missing = all sites
                departmentIds: dbScope?.departmentIds || [], // empty = all departments
                ownWorkOnly: dbScope?.ownWorkOnly || false,
            };
            setDataScope(resolvedScope);
            console.log(`[AuthContext] Data Scope for "${userData.username}":`, resolvedScope);

        } catch (error) {
            console.error("Error fetching profile:", error);
            // Safety net: Base Package defaults on error (fail-closed per NIST/ISO 55000)
            if (!permissions) {
                setPermissions({ ...BASE_PACKAGE_DEFAULTS });
                setRole('USER');
            }
        } finally {
            setLoading(false);
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('ers_access_token');
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
