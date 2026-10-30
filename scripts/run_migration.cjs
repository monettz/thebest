const fs = require('fs');
const https = require('https');

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (Supabase dashboard > Account > Access Tokens) before running this script.');
  process.exit(1);
}

const migrationFile = process.argv[2] || './supabase/migrations/002_seed_data.sql';
const query = fs.readFileSync(migrationFile, 'utf8');
const postData = JSON.stringify({ query });

const options = {
  hostname: 'api.supabase.com',
  path: '/v1/projects/xiioocqcxaqxkrxmfafx/database/query',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};
const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('STATUS:', res.statusCode, 'RESULT:', data));
});
req.on('error', e => console.error(e));
req.write(postData);
req.end();

