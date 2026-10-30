const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://xiioocqcxaqxkrxmfafx.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard > Project Settings > API) before running this script.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const defaultUsers = [
  { phone: '255712000001', pin: '1234', fullName: 'Mmiliki Mkuu', role: 'owner' },
  { phone: '255712000002', pin: '4321', fullName: 'Muuzaji Mmoja', role: 'seller' },
];

async function seed() {
  for (const u of defaultUsers) {
    const email = `${u.phone}@thebest.pos`;
    console.log(`Checking user: ${email}...`);
    
    // Check if user already exists
    const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) {
      console.error('List users error:', listErr);
      return;
    }
    
    let existing = list.users.find(x => x.email === email);
    if (!existing) {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password: `pin_${u.pin}`,
        email_confirm: true,
        user_metadata: { full_name: u.fullName, phone: u.phone, role: u.role }
      });
      if (createErr) {
        console.error(`Create user error for ${email}:`, createErr);
        continue;
      }
      existing = created.user;
      console.log(`Created auth user: ${existing.id}`);
    } else {
      console.log(`Auth user already exists: ${existing.id}`);
    }

    // Upsert profile
    const { error: profErr } = await supabase.from('profiles').upsert({
      id: existing.id,
      phone: u.phone,
      full_name: u.fullName,
      role: u.role,
      is_active: true
    });
    if (profErr) {
      console.error(`Profile upsert error:`, profErr);
    } else {
      console.log(`Profile upserted for ${u.fullName} (${u.role})`);
    }
  }
}

seed().catch(console.error);

