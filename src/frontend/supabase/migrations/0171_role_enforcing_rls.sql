-- ═══════════════════════════════════════════════════════════════════════
-- 0171: Role-enforcing RLS on privilege-sensitive tables
-- ═══════════════════════════════════════════════════════════════════════
-- Posture: SINGLE-TENANT-PER-DEPLOYMENT (decided 2026-07). No site isolation
-- here — this closes the PRIVILEGE-ESCALATION holes that "authenticated can
-- do everything" (0150/0155) leaves open. Today any logged-in user can, with
-- nothing but the public anon key and their own session:
--   · UPDATE users              → grant themselves SUPER_ADMIN / edit
--                                 permission_overrides on anyone
--   · UPDATE reference_codes    → rewrite a custom role's permission dict
--   · UPDATE hierarchy_config / numbering_config → corrupt global config
--   · UPDATE/DELETE audit_logs  → erase their tracks
-- The client-side PermissionGate does not protect the REST API. This does.
--
-- WHAT STAYS OPEN (deliberately): operational tables (work orders, assets,
-- inventory, readings…) remain authenticated-CRUD — technicians and planners
-- must write them, and finer role scoping there is a later, separate pass.
--
-- ── PREFLIGHT (run this FIRST — verify your admin account will match) ──
--   SELECT username, email, status, roles FROM users
--   WHERE roles ?| ARRAY['SUPER_ADMIN','SYS_ADMIN'];
-- Confirm the account you administer with is listed, status = 'active', and
-- its email OR username matches your login (the app logs in as
-- <username>@cainergy.com — the same matching implemented below).
-- If that returns no rows, DO NOT APPLY — you would lock admin writes out.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. The admin predicate ──────────────────────────────────────────────
-- Mirrors AuthContext.fetchProfile's user matching: JWT email equals the
-- users row email, OR the users row username equals the email's local part.
-- SECURITY DEFINER so it can read `users` regardless of users' own policies
-- (also avoids policy recursion). STABLE → evaluated once per statement.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE (
                lower(coalesce(u.email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
             OR lower(coalesce(u.username, '')) = lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1))
              )
          AND coalesce(u.status, 'active') = 'active'
          AND u.roles ?| ARRAY['SUPER_ADMIN', 'SYS_ADMIN']
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- ── 2. Numbering trigger must keep working for every role ───────────────
-- generate_equipment_number() (0167) updates numbering_config counters on
-- asset insert. It runs as the INSERTING user, so locking numbering_config
-- would break asset creation for non-admins. SECURITY DEFINER makes the
-- counter bump system behavior (runs as the function owner) while direct
-- client writes to numbering_config become admin-only below.
ALTER FUNCTION generate_equipment_number() SECURITY DEFINER;
ALTER FUNCTION generate_equipment_number() SET search_path = public;


-- ── 3. users — reads stay broad, writes admin-only ──────────────────────
-- (Reads must stay: login profile resolution queries users before any role
-- is known.)
DROP POLICY IF EXISTS "auth_insert_users" ON users;
DROP POLICY IF EXISTS "auth_update_users" ON users;
DROP POLICY IF EXISTS "auth_delete_users" ON users;
CREATE POLICY "admin_insert_users" ON users FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "admin_update_users" ON users FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "admin_delete_users" ON users FOR DELETE TO authenticated USING (public.is_admin());


-- ── 4. Config / dictionary tables — reads broad, writes admin-only ──────
-- reference_codes additionally CARRIES custom-role permission dictionaries,
-- so it is as privilege-sensitive as `users`.
DO $$
DECLARE tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['reference_codes', 'hierarchy_config', 'numbering_config']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
            -- replace any prior permissive policies (0150-style names included)
            EXECUTE format('DROP POLICY IF EXISTS "auth_select_%s" ON %I', tbl, tbl);
            EXECUTE format('DROP POLICY IF EXISTS "auth_insert_%s" ON %I', tbl, tbl);
            EXECUTE format('DROP POLICY IF EXISTS "auth_update_%s" ON %I', tbl, tbl);
            EXECUTE format('DROP POLICY IF EXISTS "auth_delete_%s" ON %I', tbl, tbl);
            EXECUTE format('DROP POLICY IF EXISTS "admin_insert_%s" ON %I', tbl, tbl);
            EXECUTE format('DROP POLICY IF EXISTS "admin_update_%s" ON %I', tbl, tbl);
            EXECUTE format('DROP POLICY IF EXISTS "admin_delete_%s" ON %I', tbl, tbl);
            EXECUTE format('CREATE POLICY "auth_select_%s"  ON %I FOR SELECT TO authenticated USING (true)', tbl, tbl);
            EXECUTE format('CREATE POLICY "admin_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (public.is_admin())', tbl, tbl);
            EXECUTE format('CREATE POLICY "admin_update_%s" ON %I FOR UPDATE TO authenticated USING (public.is_admin())', tbl, tbl);
            EXECUTE format('CREATE POLICY "admin_delete_%s" ON %I FOR DELETE TO authenticated USING (public.is_admin())', tbl, tbl);
        END IF;
    END LOOP;
END $$;


-- ── 5. audit_logs — append-only for everyone (tamper evidence) ───────────
-- SELECT + INSERT stay; UPDATE/DELETE policies are dropped and NOT replaced,
-- so RLS default-deny applies to every role, admins included.
DROP POLICY IF EXISTS "auth_update_audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "auth_delete_audit_logs" ON audit_logs;


-- ═══════════════════════════════════════════════════════════════════════
-- POST-APPLY VERIFICATION
--   1) In the app as your admin: Admin → edit a dictionary entry → saves OK.
--   2) In the app as a TECHNICIAN: create an asset (numbering still works),
--      create/save a work order — all OK.
--   3) Negative test (SQL editor, or curl with a technician session token):
--        UPDATE users SET roles = '["SUPER_ADMIN"]'::jsonb WHERE username = '<any>';
--      → 0 rows / permission denied for the technician session.
--
-- ROLLBACK (restores 0150 permissive writes) — only if something breaks:
--   CREATE POLICY "auth_insert_users" ON users FOR INSERT TO authenticated WITH CHECK (true);
--   CREATE POLICY "auth_update_users" ON users FOR UPDATE TO authenticated USING (true);
--   CREATE POLICY "auth_delete_users" ON users FOR DELETE TO authenticated USING (true);
--   DROP POLICY "admin_insert_users" ON users; DROP POLICY "admin_update_users" ON users;
--   DROP POLICY "admin_delete_users" ON users;
--   -- (repeat the same pattern for reference_codes / hierarchy_config /
--   --  numbering_config, and recreate auth_update/auth_delete on audit_logs
--   --  with USING (true) if you truly need audit rows mutable.)
-- ═══════════════════════════════════════════════════════════════════════
