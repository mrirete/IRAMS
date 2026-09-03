// Cloudflare Turnstile verification for the public signup door (launch review B6).
//
// Enforced only when TURNSTILE_SECRET_KEY is configured on the project — the
// matching VITE_TURNSTILE_SITE_KEY renders the widget in the Signup page. With
// no secret set the check is skipped (and logged) so a missing key never turns
// signup off by accident; set BOTH keys to enforce.
//   supabase secrets set TURNSTILE_SECRET_KEY=...
//   vercel env add VITE_TURNSTILE_SITE_KEY

export type TurnstileResult = { ok: true; skipped: boolean } | { ok: false; reason: string };

export async function verifyTurnstile(token: string | undefined, remoteIp: string | null): Promise<TurnstileResult> {
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
    if (!secret) {
        console.warn("[signup-tenant] TURNSTILE_SECRET_KEY not set — CAPTCHA check skipped");
        return { ok: true, skipped: true };
    }
    if (!token) return { ok: false, reason: "Please complete the verification challenge." };
    try {
        const form = new URLSearchParams({ secret, response: token });
        if (remoteIp) form.set("remoteip", remoteIp);
        const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (body?.success === true) return { ok: true, skipped: false };
        return { ok: false, reason: "Verification failed — please try the challenge again." };
    } catch (e) {
        console.error("[signup-tenant] turnstile verify error:", String(e));
        return { ok: false, reason: "Verification service unavailable — please try again." };
    }
}
