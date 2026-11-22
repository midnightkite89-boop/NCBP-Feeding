// onedrive-sync: copies the app's records into the centre's OneDrive folder.
//
//   Health checks/<aviary>/<date> <bird>.pdf   one per check, laid out like NCBP's paper form
//                                              (sent again if it's later ticked as added to ZIMS)
//   Feed sheets/<Monday> <barn>.csv            this week and last week, fed and left per aviary
//   Breeding/Breeding <year>.csv               every nest check, egg, hatching, fledging, loss, note
//
// Files are only sent when they've changed. Runs every 30 minutes (pg_cron) and from "Copy now".
// Deploy with "Verify JWT" OFF; it checks the caller itself (the schedule's key, or a signed-in user).
// Secrets: MS_CLIENT_ID, MS_CLIENT_SECRET, ONEDRIVE_SYNC_KEY. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SCOPES = 'offline_access Files.ReadWrite User.Read';
const MAX_PDFS = 40; // per run, so a big backlog is spread over a few runs

// ---------------------------------------------------------------------------
// Building the files (no network; also run by scripts/test-onedrive.mjs)
// ---------------------------------------------------------------------------

export const CHECK_ITEMS: [string, string][] = [
  ['toes', 'Manipulate toes'],
  ['feet_under', 'Feet - underside'],
  ['talons', 'Feet - talons'],
  ['carpals', 'Carpal joints'],
  ['beak_in', 'Beak - inside'],
  ['beak_out', 'Beak - outside'],
  ['feathers', 'Feather condition'],
  ['wounds', 'Wounds'],
];

export interface CheckupForPdf {
  checked_on: string;
  bird: { name: string; species: string | null; sex: string | null };
  aviary: string;
  staff: string;
  done_with: string | null;
  ring_seen: string | null;
  condition_score: number | null;
  weight_g: number | null;
  checks: Record<string, { ok: boolean; note?: string }>;
  notes: string | null;
  zims: boolean;
}

const ukDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** The standard PDF fonts only know Western characters: swap the common others, drop the rest */
const pdfText = (s: string) => s.replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
export const scoreText = (n: number | null) => (n == null ? '' : `${Math.floor(n)}${n % 1 ? '+' : ''}`);

/** One health check as a PDF, in the layout of NCBP's paper Health Check Form */
export async function checkupPdf(c: CheckupForPdf, centre: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const plum = rgb(0.53, 0.13, 0.31);
  const grey = rgb(0.4, 0.4, 0.4);
  const line = rgb(0.6, 0.6, 0.6);
  const text = (s: string, x: number, y: number, size = 11, f = font, color = rgb(0, 0, 0)) => page.drawText(pdfText(s), { x, y, size, font: f, color });
  /** Shortened with "..." if it won't fit the column */
  /** Splits text into lines that fit the column */
  const wrap = (s: string, width: number, size: number) => {
    const lines: string[] = [];
    let cur = '';
    for (const w of pdfText(s).split(/\s+/).filter(Boolean)) {
      if (cur && font.widthOfTextAtSize(`${cur} ${w}`, size) > width) {
        lines.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };
  const fit = (s: string, width: number, size: number) => {
    let t = pdfText(s);
    if (font.widthOfTextAtSize(t, size) <= width) return t;
    while (t && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
    return `${t}...`;
  };

  text(centre, 40, 790, 12, bold, plum);
  text('Health Check Form', 40, 768, 20, bold);
  text(`Date: ${ukDate(c.checked_on)}`, 400, 790, 11);
  text(`Species: ${c.bird.species ?? ''}`, 40, 740);
  text(`Aviary: ${c.aviary}`, 40, 722);
  text(`Staff: ${[c.staff, c.done_with].filter(Boolean).join(' + ')}`, 330, 740);

  const sex = c.bird.sex === 'M' ? 'Male' : c.bird.sex === 'F' ? 'Female' : 'Unknown';
  const rows: [string, string, string][] = [
    ['Ring/microchip', c.ring_seen ?? '', ''],
    ['Gender', sex, ''],
    ['Name', c.bird.name, ''],
    ['Condition score / Weight', [c.condition_score != null ? `Score ${scoreText(c.condition_score)}` : '', c.weight_g != null ? `${Math.round(c.weight_g)} g` : ''].filter(Boolean).join('   '), ''],
    ...CHECK_ITEMS.map(([key, label]): [string, string, string] => [label, c.checks[key]?.ok ? 'Checked' : '-', c.checks[key]?.note ?? '']),
    ['Added and saved to ZIMS', c.zims ? 'Done' : 'Not yet', ''],
  ];
  const x0 = 40, x1 = 220, x2 = 330, x3 = 555, rowH = 30;
  let y = 690;
  page.drawRectangle({ x: x0, y: y - 4, width: x3 - x0, height: 22, color: rgb(0.96, 0.9, 0.93) });
  text('Bird', x1 + 6, y + 3, 11, bold);
  text('Notes', x2 + 6, y + 3, 11, bold);
  y -= 4;
  for (const [label, value, note] of rows) {
    page.drawLine({ start: { x: x0, y }, end: { x: x3, y }, thickness: 0.6, color: line });
    text(label, x0 + 6, y - 19, 11, bold);
    text(fit(value, x2 - x1 - 12, 11), x1 + 6, y - 19);
    // Notes wrap; the row grows to fit them
    const noteLines = wrap(note, x3 - x2 - 12, 9);
    const h = Math.max(rowH, 12 + noteLines.length * 11);
    noteLines.forEach((l, i) => text(l, x2 + 6, y - 15 - i * 11, 9));
    y -= h;
  }
  page.drawLine({ start: { x: x0, y }, end: { x: x3, y }, thickness: 0.6, color: line });
  for (const x of [x0, x1, x2, x3]) page.drawLine({ start: { x, y: 690 + 18 }, end: { x, y }, thickness: 0.6, color: line });

  if (c.notes) {
    y -= 30;
    text('Other notes', x0, y, 11, bold);
    const words = pdfText(c.notes).split(/\s+/);
    let lineText = '';
    for (const w of words) {
      if (font.widthOfTextAtSize(`${lineText} ${w}`, 11) > x3 - x0) {
        y -= 16;
        text(lineText, x0, y);
        lineText = w;
      } else lineText = lineText ? `${lineText} ${w}` : w;
    }
    y -= 16;
    text(lineText, x0, y);
  }
  text('Made by NCBP Bird Care from the record in the app. Details to be transcribed to ZIMS.', x0, 40, 8, font, grey);
  return doc.save();
}

// --- amounts, as the app writes them ("11", "1½", "20 Chick, ½ Rabbit") ---

function parseQty(s: string): number | null {
  const m = s.trim().match(/^(\d+)?\s*(½)?$/);
  if (!m || (!m[1] && !m[2])) return null;
  return (m[1] ? Number(m[1]) : 0) + (m[2] ? 0.5 : 0);
}
const formatQty = (n: number) => (Math.floor(n) || '') + (n % 1 ? '½' : '') || '0';

/** Adds up feeds by food, e.g. three × "11" Chick → "33 Chick" */
export function sumFeeds(feeds: { amount: string | null; food_type: string | null }[]): string {
  const totals = new Map<string, number>();
  const other: string[] = [];
  for (const f of feeds) {
    const amount = (f.amount ?? '').trim();
    const parts = f.food_type ? [`${amount} ${f.food_type}`] : amount.split(/,\s*(?=[\d½])/);
    for (const p of parts) {
      const m = p.trim().match(/^([\d½]+)\s+(.+)$/);
      const qty = m ? parseQty(m[1]) : null;
      if (m && qty != null) totals.set(m[2], (totals.get(m[2]) ?? 0) + qty);
      else if (p.trim()) other.push(p.trim());
    }
  }
  return [...[...totals].map(([food, qty]) => `${formatQty(qty)} ${food}`), ...other].join(', ');
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const csv = (rows: string[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export interface SheetBird {
  id: string;
  name: string;
  species: string | null;
  team: string;
  aviary_id: string | null;
  route_order: number | null;
}
export interface SheetLog {
  bird_id: string;
  log_date: string;
  status: string;
  food_type: string | null;
  amount: string | null;
}

/** A barn's week: one row per aviary (birds sharing an aviary together), Fed and Left for each day */
export function feedSheetCsv(barn: string, monday: string, birds: SheetBird[], aviaryLabel: (id: string | null) => string, logs: SheetLog[]): string {
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${monday}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10));
  const stops = new Map<string, SheetBird[]>();
  for (const b of birds) {
    const key = b.aviary_id ?? b.id;
    stops.set(key, [...(stops.get(key) ?? []), b]);
  }
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const rows: string[][] = [
    [`${barn} feed sheet, week commencing ${ukDate(monday)}`],
    ['Aviary', 'Birds', ...days.flatMap((d, i) => [`${names[i]} ${ukDate(d).slice(0, 5)} fed`, 'left'])],
  ];
  for (const stop of stops.values()) {
    const ids = new Set(stop.map((b) => b.id));
    rows.push([
      aviaryLabel(stop[0].aviary_id),
      stop.map((b) => b.name).join(', '),
      ...days.flatMap((d) => {
        const day = logs.filter((l) => l.log_date === d && ids.has(l.bird_id));
        const fed = sumFeeds(day.filter((l) => l.status === 'fed'));
        return [fed || (day.some((l) => l.status === 'fasting') ? 'Fast' : ''), sumFeeds(day.filter((l) => l.status === 'left'))];
      }),
    ]);
  }
  return csv(rows);
}

const KIND: Record<string, string> = { nest_check: 'Nest check', egg: 'Eggs laid', hatched: 'Hatched', fledged: 'Fledged', lost: 'Lost', note: 'Note' };
export function breedingCsv(year: number, entries: { log_date: string; aviary: string; kind: string; count: number | null; notes: string | null; staff: string }[]): string {
  return csv([
    [`Breeding records ${year}`],
    ['Date', 'Aviary', 'Entry', 'How many', 'Notes', 'Logged by'],
    ...entries.map((e) => [ukDate(e.log_date), e.aviary, KIND[e.kind] ?? e.kind, e.count == null ? '' : String(e.count), e.notes ?? '', e.staff]),
  ]);
}

export async function hash(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const safe = (s: string) => s.replace(/[\\/:*?"<>|#%]/g, '-').trim().slice(0, 80);
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

async function run(): Promise<{ copied: number; skipped: number }> {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: settings } = await db.from('onedrive_settings').select('*').eq('id', 1).single();
  const { data: tok } = await db.from('onedrive_tokens').select('refresh_token').eq('id', 1).maybeSingle();
  if (!settings?.folder_id || !tok?.refresh_token) throw new Error('OneDrive is not connected yet');

  // A fresh access token; Microsoft may hand back a new permission token, which is kept
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('MS_CLIENT_ID')!,
      client_secret: Deno.env.get('MS_CLIENT_SECRET')!,
      grant_type: 'refresh_token',
      refresh_token: tok.refresh_token,
      scope: SCOPES,
    }),
  });
  const tokens = await res.json();
  if (!res.ok) throw new Error(`Microsoft permission failed: ${tokens.error_description?.split('\n')[0] ?? tokens.error ?? res.status}. Connect OneDrive again.`);
  if (tokens.refresh_token && tokens.refresh_token !== tok.refresh_token)
    await db.from('onedrive_tokens').update({ refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() }).eq('id', 1);

  const graph = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${tokens.access_token}` } });
    return r;
  };
  const folders = new Map<string, string>();
  async function folder(path: string[]): Promise<string> {
    let parent = settings!.folder_id as string;
    for (let i = 0; i < path.length; i++) {
      const key = path.slice(0, i + 1).join('/');
      if (!folders.has(key)) {
        const name = safe(path[i]);
        let r = await graph(`/me/drive/items/${parent}:/${encodeURIComponent(name)}`);
        if (r.status === 404)
          r = await graph(`/me/drive/items/${parent}/children`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
          });
        if (!r.ok) throw new Error(`OneDrive folder "${key}": ${r.status} ${(await r.text()).slice(0, 200)}`);
        folders.set(key, (await r.json()).id);
      }
      parent = folders.get(key)!;
    }
    return parent;
  }

  const { data: done } = await db.from('onedrive_copied').select('key, hash');
  const copiedHash = new Map((done ?? []).map((d) => [d.key, d.hash]));
  let copied = 0;
  let skipped = 0;
  /** Uploads (or replaces) a file if it changed since last time */
  async function put(key: string, path: string[], file: string, body: Uint8Array | string, type: string) {
    const h = await hash(body);
    if (copiedHash.get(key) === h) {
      skipped++;
      return;
    }
    const parent = await folder(path);
    const r = await graph(`/me/drive/items/${parent}:/${encodeURIComponent(safe(file))}:/content`, { method: 'PUT', headers: { 'Content-Type': type }, body: body as BodyInit });
    if (!r.ok) throw new Error(`Uploading ${[...path, file].join('/')}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    await db.from('onedrive_copied').upsert({ key, hash: h, copied_at: new Date().toISOString() });
    copiedHash.set(key, h);
    copied++;
  }

  const [{ data: birds }, { data: aviaries }, { data: profiles }] = await Promise.all([
    db.from('birds').select('id, name, species, sex, team, aviary_id, route_order, status'),
    db.from('aviaries').select('id, name, number'),
    db.from('profiles').select('id, display_name'),
  ]);
  const aviaryLabel = (id: string | null) => {
    const a = (aviaries ?? []).find((x) => x.id === id);
    return a ? (a.number != null ? `${a.name} ${a.number}` : a.name) : 'No aviary';
  };
  const staff = (id: string | null) => (profiles ?? []).find((p) => p.id === id)?.display_name ?? '';

  // 1) Health checks, oldest first, a batch per run
  const { data: checks } = await db.from('bird_checkups').select('*').is('voided_at', null).order('checked_on');
  let pdfs = 0;
  for (const c of checks ?? []) {
    const bird = (birds ?? []).find((b) => b.id === c.bird_id);
    if (!bird) continue;
    const key = `checkup:${c.id}`;
    const stamp = `${c.zims_at ? 'zims' : ''}`;
    if (copiedHash.has(key) && copiedHash.get(`${key}:state`) === stamp) continue;
    if (pdfs++ >= MAX_PDFS) break;
    const pdf = await checkupPdf(
      {
        checked_on: c.checked_on,
        bird,
        aviary: aviaryLabel(bird.aviary_id),
        staff: staff(c.staff_id),
        done_with: c.done_with,
        ring_seen: c.ring_seen,
        condition_score: c.condition_score,
        weight_g: c.weight_g,
        checks: c.checks ?? {},
        notes: c.notes,
        zims: !!c.zims_at,
      },
      'National Centre for Birds of Prey',
    );
    await put(key, ['Health checks', aviaryLabel(bird.aviary_id)], `${c.checked_on} ${bird.name}.pdf`, pdf, 'application/pdf');
    await db.from('onedrive_copied').upsert({ key: `${key}:state`, hash: stamp });
    copiedHash.set(`${key}:state`, stamp);
  }

  // 2) Feed sheets for this week and last week, one per barn (aviary and resting birds)
  const today = londonToday();
  const sheetBirds = (birds ?? []).filter((b) => b.status === 'active' && (b.team === 'aviary' || b.team === 'resting'));
  const barns = new Map<string, SheetBird[]>();
  for (const b of [...sheetBirds].sort((x, y) => (x.route_order ?? 1e9) - (y.route_order ?? 1e9))) {
    const barn = (aviaries ?? []).find((a) => a.id === b.aviary_id)?.name ?? 'No aviary';
    barns.set(barn, [...(barns.get(barn) ?? []), b]);
  }
  for (const monday of [mondayOf(addDays(today, -7)), mondayOf(today)]) {
    const { data: logs } = await db
      .from('feed_logs')
      .select('bird_id, log_date, status, food_type, amount')
      .in('status', ['fed', 'left', 'fasting'])
      .is('voided_at', null)
      .gte('log_date', monday)
      .lte('log_date', addDays(monday, 6));
    for (const [barn, list] of barns)
      await put(`feedsheet:${monday}:${barn}`, ['Feed sheets'], `${monday} ${barn}.csv`, feedSheetCsv(barn, monday, list, aviaryLabel, logs ?? []), 'text/csv');
  }

  // 3) This year's breeding records (and last year's in January, to finish it off)
  const year = Number(today.slice(0, 4));
  for (const y of today.slice(5, 7) === '01' ? [year - 1, year] : [year]) {
    const { data: entries } = await db.from('breeding_logs').select('*').is('voided_at', null).gte('log_date', `${y}-01-01`).lte('log_date', `${y}-12-31`).order('logged_at');
    if (!entries?.length) continue;
    const rows = entries.map((e) => ({ log_date: e.log_date, aviary: aviaryLabel(e.aviary_id), kind: e.kind, count: e.count, notes: e.notes, staff: staff(e.staff_id) }));
    await put(`breeding:${y}`, ['Breeding'], `Breeding ${y}.csv`, breedingCsv(y, rows), 'text/csv');
  }

  await db.from('onedrive_settings').update({ last_run_at: new Date().toISOString(), last_copied: copied, last_error: null }).eq('id', 1);
  return { copied, skipped };
}

if (typeof Deno !== 'undefined')
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // The schedule sends its key; the app sends the signed-in user's login
    const key = req.headers.get('x-sync-key');
    const allowed =
      (key && key === Deno.env.get('ONEDRIVE_SYNC_KEY')) ||
      !!(await db.auth.getUser((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''))).data.user;
    if (!allowed) return Response.json({ error: 'Not allowed' }, { status: 401, headers: CORS });
    try {
      return Response.json(await run(), { headers: CORS });
    } catch (e) {
      const message = String((e as Error).message ?? e).slice(0, 300);
      await db.from('onedrive_settings').update({ last_run_at: new Date().toISOString(), last_error: message }).eq('id', 1);
      return Response.json({ error: message }, { status: 500, headers: CORS });
    }
  });
