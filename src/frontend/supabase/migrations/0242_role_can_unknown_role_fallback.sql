-- ════════════════════════════════════════════════════════════════════════════
-- 0242 — role_can(): fall back to the default for UNKNOWN roles, not just NULL
--
-- Caught by tests/rls/caller-can-parity.mjs (Gate G1) before any policy used the
-- function, which is the entire reason Phase 1 ships the mechanism applied to
-- nothing.
--
-- 0241 wrote `coalesce(p_role, '__default__')`. That handles a NULL role — a
-- user with no row in `users` — but not a role that is present and simply has
-- no template: a custom role from reference_codes, or a typo. Those found zero
-- rows in role_permissions and were denied EVERYTHING.
--
-- The client does something different. AuthContext.tsx:
--     ROLE_PERMISSION_TEMPLATES[roleCode] || BASE_PACKAGE_DEFAULTS
-- An unrecognised role gets the baseline, which grants assets/workOrders/
-- requests and withholds the premium modules. Fail-closed on what matters,
-- still usable.
--
-- So the two disagreed: SQL denied a custom-role user everything while the UI
-- offered them the baseline. Had a policy shipped on the 0241 version, every
-- custom-role user would have found their pages empty with no error — the
-- silent-denial shape that is so hard to diagnose from a bug report.
--
-- Now: use p_role only if that role actually appears in the mirror; otherwise
-- '__default__'.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.role_can(
    p_role      text,
    p_overrides jsonb,
    p_module    text,
    p_action    text
) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE
        -- A per-user override wins outright, in EITHER direction. Tested for
        -- NULL rather than truthiness so that an explicit false WITHDRAWS
        -- permission instead of falling through to the template.
        WHEN p_overrides -> p_module ->> p_action IS NOT NULL
            THEN (p_overrides -> p_module ->> p_action)::boolean
        ELSE EXISTS (
            SELECT 1 FROM public.role_permissions rp
            WHERE rp.role = CASE
                    WHEN p_role IS NOT NULL AND EXISTS (
                        SELECT 1 FROM public.role_permissions k WHERE k.role = p_role
                    ) THEN p_role
                    ELSE '__default__'
                 END
              AND rp.module = p_module
              AND rp.action = p_action
        )
    END;
$$;

COMMENT ON FUNCTION public.role_can(text, jsonb, text, text) IS
    'Pure permission decision: role template + per-user overrides. An override of false WITHDRAWS. A role with no template falls back to __default__ (BASE_PACKAGE_DEFAULTS), matching AuthContext''s `TEMPLATES[role] || BASE_PACKAGE_DEFAULTS`. Verified by tests/rls/caller-can-parity.mjs.';
