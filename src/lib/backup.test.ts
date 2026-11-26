import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module (the backup runs in GitHub Actions with Node, not in the app)
import { authTablesFor, backupDay, driveClient, expired, isMonthEnd, isYearEnd } from '../../scripts/backup/run.mjs';

describe('backup schedule', () => {
  it('backs up the Dar business day that just ended, even if the job starts late', () => {
    // 00:00 Dar on 27 Nov = 21:00 UTC on 26 Nov
    expect(backupDay(new Date('2026-11-26T21:00:00Z'))).toBe('2026-11-26');
    // GitHub can start up to an hour or more late
    expect(backupDay(new Date('2026-11-26T23:40:00Z'))).toBe('2026-11-26');
  });

  it('knows month and year ends, including February and leap years', () => {
    expect(isMonthEnd('2026-11-30')).toBe(true);
    expect(isMonthEnd('2026-11-29')).toBe(false);
    expect(isMonthEnd('2027-02-28')).toBe(true);
    expect(isMonthEnd('2028-02-28')).toBe(false);
    expect(isMonthEnd('2028-02-29')).toBe(true);
    expect(isYearEnd('2026-12-31')).toBe(true);
    expect(isYearEnd('2026-12-30')).toBe(false);
  });
});

describe('keeping and removing old backups', () => {
  it('keeps the last 30 nightly backups', () => {
    expect(expired('daily', 'thebest-2026-11-30.sql.gz', '2026-11-30')).toBe(false);
    expect(expired('daily', 'thebest-2026-11-01.sql.gz', '2026-11-30')).toBe(false); // 30th kept
    expect(expired('daily', 'thebest-2026-10-31.sql.gz', '2026-11-30')).toBe(true); // 31st removed
  });

  it('keeps monthly backups 10 years', () => {
    expect(expired('monthly', 'thebest-2016-11.sql.gz', '2026-11-30')).toBe(false);
    expect(expired('monthly', 'thebest-2016-10.xlsx', '2026-11-30')).toBe(true);
  });

  it('never removes yearly backups or files it does not recognise', () => {
    expect(expired('yearly', 'thebest-1990.sql.gz', '2026-12-31')).toBe(false);
    expect(expired('daily', 'notes.txt', '2026-11-30')).toBe(false);
  });
});

describe('restore test helpers', () => {
  it('shapes the stand-in sign-in tables from the backup', () => {
    const sql = 'COPY auth.users (instance_id, id, email, phone) FROM stdin;\nCOPY auth.identities (id, user_id, provider) FROM stdin;\n';
    const out = authTablesFor(sql);
    expect(out).toContain('create table auth.users (instance_id text, id uuid primary key, email text, phone text)');
    expect(out).toContain('create table auth.identities (id uuid primary key, user_id uuid, provider text)');
    expect(authTablesFor('-- no auth data')).toBe('');
  });
});

describe('Google Drive client', () => {
  /** A tiny in-memory Drive that records what the backup asks for. */
  function fakeDrive() {
    const files: { id: string; name: string; parent: string | null; folder: boolean }[] = [];
    const log: string[] = [];
    let n = 0;
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? 'GET';
      if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'ya29.test' });
      log.push(`${method} ${url.pathname}`);
      if (method === 'GET') {
        const q = url.searchParams.get('q') ?? '';
        const name = q.match(/name = '([^']*)'/)?.[1];
        const parent = q.match(/'([^']+)' in parents/)?.[1] ?? null;
        const wantFolder = q.includes('google-apps.folder');
        const hits = files.filter((f) => (!name || f.name === name) && (!parent || f.parent === parent) && (!wantFolder || f.folder));
        return json({ files: hits.map(({ id, name }) => ({ id, name })) });
      }
      if (method === 'DELETE') {
        const id = url.pathname.split('/').pop()!;
        files.splice(files.findIndex((f) => f.id === id), 1);
        return new Response(null, { status: 204 });
      }
      // POST: create a folder (JSON) or upload a file (multipart)
      const body = String(init?.body ?? '');
      const meta = JSON.parse(body.includes('{') ? body.slice(body.indexOf('{'), body.indexOf('}') + 1) : '{}');
      const f = { id: `f${++n}`, name: meta.name, parent: meta.parents?.[0] ?? null, folder: meta.mimeType === 'application/vnd.google-apps.folder' };
      files.push(f);
      return json({ id: f.id, name: f.name });
    }) as typeof fetch;
    return { files, log, fetchImpl };
  }

  it('makes its folder once, replaces a re-run upload, and removes files', async () => {
    const d = fakeDrive();
    const drive = driveClient({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }, d.fetchImpl);
    const root = await drive.folder('THE BEST Backups', null);
    expect(await drive.folder('THE BEST Backups', null)).toBe(root); // found, not made twice
    const daily = await drive.folder('Kila siku', root);
    await drive.upload(daily, 'thebest-2026-11-26.sql.gz', Buffer.from('a'), 'application/gzip');
    await drive.upload(daily, 'thebest-2026-11-26.sql.gz', Buffer.from('b'), 'application/gzip'); // same night re-run
    expect(d.files.filter((f) => f.name === 'thebest-2026-11-26.sql.gz')).toHaveLength(1);
    const [only] = await drive.files(daily);
    await drive.remove(only.id);
    expect(await drive.files(daily)).toHaveLength(0);
  });
});
