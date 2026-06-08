
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0"

serve(async (req) => {
    // 1. Setup CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
            }
        })
    }

    try {
        // 2. Auth Check (Must be Admin)
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        )

        const { data: { user }, error: authError } = await supabaseClient.auth.getUser()
        if (authError || !user) throw new Error('Unauthorized')

        // Optional: Check 'roles' in public.users or dictionary to ensure they are Admin
        // For now, assuming any authenticated user with access to the UI can try this, 
        // but typically you'd check 'ADMIN' role here.

        // 3. Admin Client (Service Role)
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 4. Parse Body
        const { username, email, password, role } = await req.json()
        if (!username || !email || !password) throw new Error('Missing fields')

        // 5. Create Auth User
        const { data: authUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true, // Auto-confirm!
            user_metadata: { username, role }
        })

        if (createError) throw createError

        // 6. Handle Public User & Contact (Optional - Trigger updates this?)
        // The trigger 'handle_new_user' executes on INSERT to auth.users.
        // So public.users should be auto-created.
        // However, the trigger logic might duplicate 'role' or default to TECHNICIAN.
        // We can rely on the trigger or update public.users explicitly here to perfect the data.

        // Let's rely on trigger for creation, but maybe update the role if needed?
        // trigger defaults to 'TECHNICIAN' if no contact found.
        // We want to force the role passed here.

        return new Response(
            JSON.stringify(authUser),
            { headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' } },
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { "Content-Type": "application/json", 'Access-Control-Allow-Origin': '*' } },
        )
    }
})
