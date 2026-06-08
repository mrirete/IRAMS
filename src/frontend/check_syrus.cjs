const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: __dirname + '/.env.local' });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY
);

async function check() {
    // Sign in as admin to get past RLS
    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: 'admin@cainergy.com',
        password: 'Test1234!'
    });

    if (authErr) {
        console.error('Admin auth failed:', authErr.message);
        // Try direct query anyway
    } else {
        console.log('Signed in as:', authData.user?.email);
    }

    const { data, error } = await supabase
        .from('users')
        .select('id, username, email, roles, contact_id, status')
        .or('email.eq.k.syrus@cainergy.com,username.ilike.%syrus%');

    console.log('\n=== K.Syrus DB Records ===');
    if (error) {
        console.error('Query Error:', error.message);
    } else if (data && data.length > 0) {
        data.forEach(u => {
            console.log(`  username:   ${u.username}`);
            console.log(`  email:      ${u.email}`);
            console.log(`  roles:      ${JSON.stringify(u.roles)}`);
            console.log(`  contact_id: ${u.contact_id}`);
            console.log(`  status:     ${u.status}`);
            console.log('  ---');
        });
    } else {
        console.log('  NO RECORDS FOUND');
    }

    await supabase.auth.signOut();
}

check();
