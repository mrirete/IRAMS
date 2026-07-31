-- ════════════════════════════════════════════════════════════════════════════
-- 0235 — Global settings that are actually global
--
-- /admin/settings is titled "Enterprise-wide configuration & preferences" and
-- was none of those things. Site name, timezone, date format, locale, currency
-- and fiscal year lived in localStorage, so they applied to one browser: two
-- users could read the same work order's timestamps in different timezones and
-- its costs in different currencies, with nothing on screen explaining why. The
-- Save button's handler set a "Saved" label for two seconds and wrote nothing.
--
-- Settings belong with the tenant, next to companies.edition (0219), following
-- the single-tenant deployment model (0173): the first active company row.
--
-- No new policies needed — 0173 already says exactly the right thing about
-- companies:
--     auth_select_companies   SELECT  authenticated  USING (true)
--     admin_update_companies  UPDATE  authenticated  USING (public.is_admin())
-- Everyone reads the settings; only SUPER_ADMIN / SYS_ADMIN change them. A
-- non-admin attempting to save is refused by the database rather than by a
-- hidden button, and the UI now reports that refusal instead of claiming
-- success.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS app_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN companies.app_settings IS
    'Enterprise-wide app settings (site name, timezone, date format, locale, currency, fiscal year, notification thresholds). Read by every authenticated user; written only by public.is_admin(). Partial by design — the client merges over its defaults, so a key absent here means "use the default", and adding a setting needs no migration.';
