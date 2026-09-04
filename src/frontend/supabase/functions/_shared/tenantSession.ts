// Scheduled work runs AS THE TENANT (launch review, 2026-09-04).
//
// Since 0276 every tenant table has company_id NOT NULL with a default of
// caller_company(), which reads the JWT claim. Scheduled functions ran as the
// service role: no JWT, so no claim, so every INSERT they made (escalation
// notifications, watchdog proposals, briefing audit rows) failed with 23502 —
// silently, because pg_cron only sees that the HTTP call was queued. On a
// shared project their READS also mixed tenants.
//
// The fix: for each active company, mint a short-lived JWT for one of that
// company's administrators (HS256 with the project's JWT secret — the same
// key GoTrue signs with) and run with a client that carries it. RLS scopes
// every read, the column default fills company_id on every write, the
// security-invoker semantic views resolve the right tenant, and is_admin()
// is true — exactly what an interactive admin session gets.
//
// Fallback (SUPABASE_JWT_SECRET not set as a function secret): the caller
// gets the service-role client and MUST stamp company_id on inserts itself;
// reads are unscoped. That keeps single-tenant projects working and makes
// the gap visible in the function log instead of a silent 500.
//
//   supabase secrets set SUPABASE_JWT_SECRET=<Project Settings → API → JWT Secret>
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";
import { SignJWT } from "https://esm.sh/jose@5.9.6";

export interface TenantRun {
  companyId: string;
  companyName: string;
  /** Client to use for reads and writes. Scoped to the tenant when `scoped` is true. */
  // deno-lint-ignore no-explicit-any
  db: any;
  scoped: boolean;
  runAsUserId: string | null;
}

// deno-lint-ignore no-explicit-any
export async function listActiveCompanies(admin: any): Promise<{ id: string; name: string }[]> {
  const { data, error } = await admin.from("companies").select("id, name").eq("active", true).order("created_at");
  if (error) throw new Error(`companies: ${error.message}`);
  return (data ?? []) as { id: string; name: string }[];
}

// deno-lint-ignore no-explicit-any
async function pickRunAsUser(admin: any, companyId: string): Promise<string | null> {
  const { data } = await admin
    .from("users")
    .select("id, roles, status")
    .eq("company_id", companyId)
    .limit(200);
  const rows = (data ?? []) as { id: string; roles: string[] | null; status: string | null }[];
  const active = rows.filter((u) => (u.status ?? "active") === "active");
  const admins = active.filter((u) => (u.roles ?? []).some((r) => ["SUPER_ADMIN", "SYS_ADMIN"].includes(String(r).toUpperCase())));
  return admins[0]?.id ?? active[0]?.id ?? null;
}

async function mintTenantJwt(secret: string, sub: string, companyId: string, ttlSeconds = 600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { company_id: companyId, provider: "scheduler" },
    user_metadata: {},
    iat: now,
    exp: now + ttlSeconds,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(sub)
    .setIssuer(`${Deno.env.get("SUPABASE_URL") ?? ""}/auth/v1`)
    .sign(new TextEncoder().encode(secret));
}

/**
 * Iterate the active companies, yielding a client per tenant. Never throws
 * for one tenant's failure; the caller decides how to report it.
 */
// deno-lint-ignore no-explicit-any
export async function forEachTenant(admin: any, fn: (run: TenantRun) => Promise<void>): Promise<{ companies: number; scoped: boolean; errors: string[] }> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET") ?? "";
  const companies = await listActiveCompanies(admin);
  const errors: string[] = [];
  const scoped = !!JWT_SECRET && !!ANON_KEY;
  if (!scoped) {
    console.warn("[tenantSession] SUPABASE_JWT_SECRET not set — running as service role; reads are unscoped and inserts must stamp company_id.");
  }
  for (const c of companies) {
    try {
      let db = admin;
      let runAs: string | null = null;
      if (scoped) {
        runAs = await pickRunAsUser(admin, c.id);
        if (!runAs) { errors.push(`${c.name}: no active user to run as`); continue; }
        const jwt = await mintTenantJwt(JWT_SECRET, runAs, c.id);
        db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
      }
      await fn({ companyId: c.id, companyName: c.name, db, scoped, runAsUserId: runAs });
    } catch (e) {
      errors.push(`${c.name}: ${String(e).slice(0, 300)}`);
      console.error(`[tenantSession] ${c.name}:`, e);
    }
  }
  return { companies: companies.length, scoped, errors };
}
