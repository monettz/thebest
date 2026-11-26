#!/usr/bin/env node
/**
 * One-time helper: gets the Google "refresh token" the nightly backup uses to upload to YOUR Google Drive.
 *
 *   node scripts/backup/get-refresh-token.mjs
 *
 * It asks for the OAuth Client ID and Client Secret (Google Cloud → Credentials, type "Desktop app"), opens
 * Google's sign-in page, and after you allow access prints the refresh token. Put it in GitHub → Settings →
 * Secrets and variables → Actions as GDRIVE_REFRESH_TOKEN. Nothing is saved or sent anywhere else.
 *
 * Access asked for: drive.file — only files and folders this backup creates. It cannot see your other files.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const clientId = (await rl.question('Client ID: ')).trim();
const clientSecret = (await rl.question('Client Secret: ')).trim();
rl.close();
if (!clientId || !clientSecret) {
  console.error('Client ID na Client Secret vinahitajika.');
  process.exit(1);
}

const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const redirectUri = `http://127.0.0.1:${server.address().port}`;

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

console.log('\nFungua link hii kwenye browser (inajaribu kujifungua yenyewe), ingia kwa Gmail yako na ubofye Allow:\n');
console.log(authUrl + '\n');
const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', authUrl.replace(/&/g, '^&')]] : process.platform === 'darwin' ? ['open', [authUrl]] : ['xdg-open', [authUrl]];
spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {});

server.on('request', async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(404).end();
    return;
  }
  const done = (msg) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<p style="font:16px sans-serif">${msg}</p>`);
    server.close();
  };
  if (url.searchParams.get('state') !== state) {
    done('Ombi si sahihi. Rudi kwenye terminal.');
    console.error('Imeshindikana: state haikulingana.');
    process.exit(1);
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  const body = await tokenRes.json();
  if (!tokenRes.ok || !body.refresh_token) {
    done('Imeshindikana. Rudi kwenye terminal.');
    console.error('Imeshindikana kupata refresh token:', body.error_description || body.error || tokenRes.status);
    process.exit(1);
  }
  done('Imefanikiwa ✅ Rudi kwenye terminal na unakili refresh token.');
  console.log('\n✅ Refresh token (iweke GitHub kama GDRIVE_REFRESH_TOKEN; usiitume kwa mtu yeyote):\n');
  console.log(body.refresh_token + '\n');
});
