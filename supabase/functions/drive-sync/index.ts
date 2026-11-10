// drive-sync: copies app records into the SMJ Falconry Database on Google Drive.
//
// Works through the drive_queue table (filled by database triggers):
//   bird_photo    -> the bird's Photos folder
//   health_entry  -> photos into Photos/Health – <issue>, a row on the Vet Treatment Log
//   medication    -> prescription photos into Documents, a row on the Vet Treatment Log
//   dose          -> a row on the Vet Treatment Log
//   issue_closed, med_stopped, dose_removed, entry_removed -> a row on the Vet Treatment Log
//
// Runs every few minutes (pg_cron) and whenever the app saves something.
// Secrets (Supabase > Edge Functions > Secrets): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// GOOGLE_REFRESH_TOKEN. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// The app calls this from the browser, which first checks it's allowed to (CORS)
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const MAX_ATTEMPTS = 10;
const BATCH = 25;

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
async function google(url: string, init: RequestInit = {}): Promise<Response> {
  if (!accessToken) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: Deno.env.get('GOOGLE_REFRESH_TOKEN')!,
        grant_type: 'refresh_token',
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`);
    accessToken = body.access_token;
  }
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const folderCache = new Map<string, string>();

async function findChild(parent: string, name: string, mime?: string): Promise<string | null> {
  const query = [`'${parent}' in parents`, `name = '${q(name)}'`, 'trashed = false', mime ? `mimeType = '${mime}'` : ''].filter(Boolean).join(' and ');
  const res = await google(`https://www.googleapis.com/drive/v3/files?fields=files(id)&pageSize=1&q=${encodeURIComponent(query)}`);
  return (await res.json()).files?.[0]?.id ?? null;
}

async function folder(parent: string, name: string): Promise<string> {
  const key = `${parent}/${name}`;
  if (folderCache.has(key)) return folderCache.get(key)!;
  let id = await findChild(parent, name, 'application/vnd.google-apps.folder');
  if (!id) {
    const res = await google('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }),
    });
    id = (await res.json()).id as string;
  }
  folderCache.set(key, id);
  return id;
}

async function upload(parent: string, name: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (await findChild(parent, name)) return; // already copied on an earlier run
  const boundary = 'smj' + crypto.randomUUID();
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  await google('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

const sheetCache = new Map<string, string | null>();
async function vetLog(birdFolder: string): Promise<string | null> {
  if (sheetCache.has(birdFolder)) return sheetCache.get(birdFolder)!;
  const query = `'${birdFolder}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and name contains 'Vet Treatment Log' and trashed = false`;
  const res = await google(`https://www.googleapis.com/drive/v3/files?fields=files(id)&pageSize=1&q=${encodeURIComponent(query)}`);
  const id = (await res.json()).files?.[0]?.id ?? null;
  sheetCache.set(birdFolder, id);
  return id;
}

/** Date | Vet | Reason / Condition | Treatment Given | Medication & Dose | Follow-up Due | Outcome | Recorded By | Notes */
async function logRow(birdFolder: string, row: (string | null | undefined)[]): Promise<void> {
  const sheet = await vetLog(birdFolder);
  if (!sheet) throw new Error('No "Vet Treatment Log" sheet in this bird\'s Drive folder');
  await google(`https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row.map((c) => c ?? '')] }),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "2026-10-31" -> "31/10/2026" */
const ukDate = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const londonTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const londonDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

const staffCache = new Map<string, string>();
async function staff(id: string | null): Promise<string> {
  if (!id) return '';
  if (!staffCache.has(id)) {
    const { data } = await db.from('profiles').select('display_name').eq('id', id).maybeSingle();
    staffCache.set(id, data?.display_name ?? '');
  }
  return staffCache.get(id)!;
}

/** Who did it: on a shared device, the person picked (staff or volunteer), else the signed-in account */
async function who(row: { staff_id: string | null; logged_for?: string | null; logged_for_name?: string | null }): Promise<string> {
  if (row.logged_for_name) return row.logged_for_name;
  if (row.logged_for) return await staff(row.logged_for);
  return await staff(row.staff_id);
}

async function birdFolder(birdId: string): Promise<{ id: string; name: string }> {
  const { data } = await db.from('birds').select('name, drive_folder_url').eq('id', birdId).maybeSingle();
  if (!data) throw new Error('Bird not found');
  const id = data.drive_folder_url?.match(/folders\/([\w-]+)/)?.[1];
  if (!id) throw new Error(`${data.name} has no Drive folder link (More > Birds > ${data.name})`);
  return { id, name: data.name };
}

async function download(bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Could not read ${path}: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

function scheduleText(m: { times_per_day: number; every_days: number }): string {
  const per = `${m.times_per_day} × a day`;
  return m.every_days === 1 ? per : m.every_days === 2 ? `${per}, every other day` : `${per}, every ${m.every_days} days`;
}

// ---------------------------------------------------------------------------
// One queue item
// ---------------------------------------------------------------------------

async function handle(item: { kind: string; ref_id: string }): Promise<string> {
  switch (item.kind) {
    case 'bird_photo': {
      const { data: b } = await db.from('birds').select('id, name, photo_path').eq('id', item.ref_id).maybeSingle();
      if (!b?.photo_path) return 'no photo';
      const f = await birdFolder(b.id);
      // The file name comes from the upload time, so a re-run never makes a duplicate
      await upload(await folder(f.id, 'Photos'), `${safe(b.name)} – app photo ${b.photo_path.split('/').pop()}`, await download('bird-photos', b.photo_path), 'image/jpeg');
      return 'photo copied';
    }

    case 'health_entry':
    case 'entry_removed': {
      const { data: e } = await db.from('health_entries').select('*').eq('id', item.ref_id).maybeSingle();
      if (!e) return 'gone';
      const { data: issue } = await db.from('health_issues').select('*').eq('id', e.issue_id).maybeSingle();
      const f = await birdFolder(e.bird_id);
      const title = issue?.title ?? 'Health';
      if (item.kind === 'entry_removed') {
        await logRow(f.id, [ukDate(londonDate(e.voided_at ?? new Date().toISOString())), '', title, '', '', '', '', await staff(e.voided_by), `Removed in the app: update from ${ukDate(e.log_date)}`]);
        return 'removal noted';
      }
      if (e.voided_at) return 'removed before copying';
      const day = issue ? daysBetween(issue.started_on, e.log_date) + 1 : null;
      if (e.photo_paths?.length) {
        const dir = await folder(await folder(f.id, 'Photos'), safe(`Health – ${title} (${issue?.started_on ?? e.log_date})`));
        let i = 0;
        for (const p of e.photo_paths as string[]) {
          i++;
          await upload(dir, `${e.log_date}${day ? ` day ${day}` : ''}${e.photo_paths.length > 1 ? ` (${i})` : ''} ${p.split('/').pop()}`, await download('health-photos', p), 'image/jpeg');
        }
      }
      const photos = e.photo_paths?.length ? `${e.photo_paths.length} photo${e.photo_paths.length > 1 ? 's' : ''} in Photos/Health – ${title}` : '';
      await logRow(f.id, [ukDate(e.log_date), '', title, e.action, '', '', '', await who(e), [e.notes, photos].filter(Boolean).join(' · ')]);
      return 'entry copied';
    }

    case 'issue_closed': {
      const { data: i } = await db.from('health_issues').select('*').eq('id', item.ref_id).maybeSingle();
      if (!i?.closed_at) return 'not closed';
      const f = await birdFolder(i.bird_id);
      await logRow(f.id, [ukDate(londonDate(i.closed_at)), '', i.title, '', '', '', i.outcome || 'Resolved', await staff(i.closed_by), `Issue opened ${ukDate(i.started_on)}`]);
      return 'closure noted';
    }

    case 'medication':
    case 'med_stopped': {
      const { data: m } = await db.from('medications').select('*').eq('id', item.ref_id).maybeSingle();
      if (!m) return 'gone';
      const f = await birdFolder(m.bird_id);
      const { data: issue } = m.issue_id ? await db.from('health_issues').select('title').eq('id', m.issue_id).maybeSingle() : { data: null };
      if (item.kind === 'med_stopped') {
        await logRow(f.id, [ukDate(londonDate(m.stopped_at ?? new Date().toISOString())), m.prescribed_by, issue?.title, 'Medication stopped', `${m.name_dose} – ${m.amount}`, '', '', await staff(m.stopped_by), m.stop_reason]);
        return 'stop noted';
      }
      if (m.voided_at) return 'removed before copying';
      let i = 0;
      for (const p of (m.prescription_paths ?? []) as string[]) {
        i++;
        await upload(await folder(f.id, 'Documents'), safe(`Prescription – ${m.name_dose} – ${m.start_date}${m.prescription_paths.length > 1 ? ` (${i})` : ''}`) + '.jpg', await download('health-photos', p), 'image/jpeg');
      }
      const course = m.end_date ? `${ukDate(m.start_date)} to ${ukDate(m.end_date)}` : `from ${ukDate(m.start_date)} until stopped`;
      await logRow(f.id, [
        ukDate(m.start_date),
        m.prescribed_by,
        issue?.title,
        `Course started: ${scheduleText(m)}, ${course}`,
        `${m.name_dose} – ${m.amount} (${m.med_type})`,
        ukDate(m.end_date),
        '',
        await staff(m.created_by),
        [m.notes, m.prescription_paths?.length ? 'prescription photo in Documents' : ''].filter(Boolean).join(' · '),
      ]);
      return 'medication copied';
    }

    case 'dose':
    case 'dose_removed': {
      const { data: d } = await db.from('med_doses').select('*').eq('id', item.ref_id).maybeSingle();
      if (!d) return 'gone';
      const { data: m } = await db.from('medications').select('*').eq('id', d.medication_id).maybeSingle();
      if (!m) return 'medication gone';
      const f = await birdFolder(d.bird_id);
      const { data: issue } = m.issue_id ? await db.from('health_issues').select('title').eq('id', m.issue_id).maybeSingle() : { data: null };
      if (item.kind === 'dose_removed') {
        await logRow(f.id, [ukDate(d.dose_date), '', issue?.title, 'Dose removed in the app', `${m.name_dose} – ${d.amount ?? m.amount}`, '', '', await staff(d.voided_by), `Was logged at ${londonTime(d.logged_at)}`]);
        return 'removal noted';
      }
      if (d.voided_at) return 'removed before copying';
      await logRow(f.id, [ukDate(d.dose_date), '', issue?.title, `Dose given ${londonTime(d.logged_at)}`, `${m.name_dose} – ${d.amount ?? m.amount}`, '', '', await who(d), d.notes]);
      return 'dose copied';
    }
  }
  return 'unknown kind';
}

// ---------------------------------------------------------------------------
// One-off tidy (admin only): removes rows copied twice onto Vet Treatment Logs and
// spare "Health – …" folders made twice, for anything copied since `since`.
// ---------------------------------------------------------------------------

async function tidy(req: Request, since: string | undefined): Promise<Response> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  const { data: user } = await db.auth.getUser(token);
  const { data: me } = user?.user ? await db.from('profiles').select('role').eq('id', user.user.id).maybeSingle() : { data: null };
  if (me?.role !== 'admin') return reply({ error: 'Admins only' }, 403);
  const from = since ?? new Date(Date.now() - 864e5).toISOString();
  const report: string[] = [];

  const list = async (query: string) => {
    const res = await google(`https://www.googleapis.com/drive/v3/files?fields=files(id,name,parents,createdTime)&pageSize=200&q=${encodeURIComponent(query)}`);
    return ((await res.json()).files ?? []) as { id: string; name: string; parents?: string[]; createdTime: string }[];
  };

  // 1. Vet Treatment Logs: delete a row that exactly repeats an earlier row
  for (const f of await list(`name contains 'Vet Treatment Log' and mimeType = 'application/vnd.google-apps.spreadsheet' and modifiedTime > '${from}' and trashed = false`)) {
    const meta = await (await google(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}?fields=sheets.properties(sheetId,title)`)).json();
    const sheet = meta.sheets?.[0]?.properties;
    if (!sheet) continue;
    const vals = (await (await google(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${encodeURIComponent(sheet.title)}!A:I`)).json()).values ?? [];
    const seen = new Set<string>();
    const dupes: number[] = [];
    vals.forEach((row: string[], i: number) => {
      if (i === 0) return;
      const key = JSON.stringify(row.map((c) => (c ?? '').trim()).concat(Array(9).fill('')).slice(0, 9));
      if (seen.has(key)) dupes.push(i);
      else seen.add(key);
    });
    if (dupes.length === 0) continue;
    await google(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: dupes.sort((a, b) => b - a).map((i) => ({ deleteDimension: { range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } })),
      }),
    });
    report.push(`${f.name}: removed ${dupes.length} repeated row(s)`);
  }

  // 2. Health folders made twice: keep the first, move anything missing into it, bin the spare
  const folders = await list(`mimeType = 'application/vnd.google-apps.folder' and name contains 'Health – ' and createdTime > '${from}' and trashed = false`);
  const groups = new Map<string, typeof folders>();
  for (const f of folders) {
    const key = `${f.parents?.[0]}|${f.name}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    const [keep, ...spares] = group;
    const kept = new Set((await list(`'${keep.id}' in parents and trashed = false`)).map((x) => x.name));
    for (const spare of spares) {
      for (const file of await list(`'${spare.id}' in parents and trashed = false`)) {
        if (!kept.has(file.name)) {
          await google(`https://www.googleapis.com/drive/v3/files/${file.id}?addParents=${keep.id}&removeParents=${spare.id}&fields=id`, { method: 'PATCH' });
          kept.add(file.name);
        }
      }
      await google(`https://www.googleapis.com/drive/v3/files/${spare.id}?fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
      report.push(`${spare.name}: spare copy moved to the Drive bin`);
    }
  }
  return reply({ done: report.length, results: report.length ? report : ['Nothing to tidy'] });
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const body = await req.json().catch(() => ({}));
  if (body?.action === 'tidy') return await tidy(req, body.since);

  // Claim a batch, so a second run at the same moment can't take the same items
  const { data: items, error } = await db.rpc('drive_claim', { p_limit: BATCH });
  if (error) return reply({ error: error.message }, 500);

  const results: string[] = [];
  for (const item of (items ?? []) as { id: number; kind: string; ref_id: string; attempts: number }[]) {
    try {
      const note = await handle(item);
      await db.from('drive_queue').update({ done_at: new Date().toISOString(), note, last_error: null }).eq('id', item.id);
      results.push(`${item.kind}: ${note}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from('drive_queue').update({ attempts: item.attempts + 1, last_error: msg.slice(0, 500), claimed_at: null }).eq('id', item.id);
      results.push(`${item.kind}: FAILED ${msg}`);
      // A sign-in problem will fail everything; stop and try again next run
      if (msg.startsWith('Google sign-in failed')) break;
    }
  }
  return reply({ done: results.length, results });
});
