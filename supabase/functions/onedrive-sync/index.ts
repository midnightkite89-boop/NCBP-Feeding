// onedrive-sync: copies the app's records into the centre's OneDrive folder.
//
//   Birds/<bird>/                                  everything about one bird, like the SMJ database
//     <bird> - bird record.pdf                     its details: species, ring, sex, aviary, food, targets, notes…
//     Health and vet log.csv                       health issues, updates, medication and every dose given
//     Health checks/<date> health check.pdf        one per check, laid out like NCBP's paper form
//     Photos/                                      the bird's photo, health photos, prescriptions
//   Weekly records/<Monday> week.csv               every bird: weight (when weighed), fed and food left each day
//   Breeding/Breeding <year>.csv                   every nest check, egg, hatching, fledging, loss, note
//
// Weekly records cover this week and last week. Files are only sent when they've changed, and a run
// stops after about 100 seconds and carries on next time (the first run has a lot to make).
// Runs every 30 minutes (pg_cron) and from "Copy now".
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

/** Grams in the bird's own unit, e.g. "1150 g" or "2 lb 8.57 oz" */
export function weightText(grams: number, unit: string | null): string {
  if (unit !== 'lb_oz') return `${Math.round(grams * 10) / 10} g`;
  const totalOz = Math.round((grams / 28.349523125) * 100) / 100;
  const lb = Math.floor(totalOz / 16);
  const oz = Math.round((totalOz - lb * 16) * 100) / 100;
  return lb > 0 ? `${lb} lb ${oz} oz` : `${oz} oz`;
}

export interface WeekLog {
  bird_id: string;
  log_date: string;
  status: string;
  food_type: string | null;
  amount: string | null;
  weight_g: number | null;
}
const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${monday}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10));

/** The week for every bird, section by section: weight (when weighed), fed and food left each day */
export function weeklyRecordsCsv(monday: string, birds: { id: string; name: string; weight_unit: string | null; aviary: string; section: string }[], logs: WeekLog[]): string {
  const days = weekDays(monday);
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const rows: string[][] = [
    [`Weekly records, week commencing ${ukDate(monday)}`],
    ['Bird', 'Aviary', ...days.flatMap((d, i) => [`${names[i]} ${ukDate(d).slice(0, 5)} weight`, 'fed', 'left'])],
  ];
  let section = '';
  for (const b of birds) {
    if (b.section !== section) {
      section = b.section;
      rows.push([section.toUpperCase()]);
    }
    const mine = logs.filter((l) => l.bird_id === b.id);
    rows.push([
      b.name,
      b.aviary,
      ...days.flatMap((d) => {
        const day = mine.filter((l) => l.log_date === d);
        const fed = sumFeeds(day.filter((l) => l.status === 'fed'));
        return [
          day.filter((l) => l.weight_g != null).map((l) => weightText(l.weight_g!, b.weight_unit)).join(' / '),
          fed || (day.some((l) => l.status === 'fasting') ? 'Fast' : ''),
          sumFeeds(day.filter((l) => l.status === 'left')),
        ];
      }),
    ]);
  }
  return csv(rows);
}

/** A bird's details on one page: what used to be its record card */
export async function birdRecordPdf(title: string, sections: { heading: string; rows: [string, string][] }[], centre: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const plum = rgb(0.53, 0.13, 0.31);
  page.drawText(pdfText(centre), { x: 40, y: 790, size: 12, font: bold, color: plum });
  page.drawText(pdfText(title), { x: 40, y: 766, size: 20, font: bold });
  let y = 730;
  const wrap = (s: string, width: number) => {
    const out: string[] = [];
    let cur = '';
    for (const w of pdfText(s).split(/\s+/).filter(Boolean)) {
      if (cur && font.widthOfTextAtSize(`${cur} ${w}`, 10) > width) {
        out.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  for (const sec of sections) {
    const rows = sec.rows.filter(([, v]) => v);
    if (rows.length === 0) continue;
    if (y < 120) {
      page = doc.addPage([595, 842]);
      y = 790;
    }
    page.drawText(pdfText(sec.heading), { x: 40, y, size: 12, font: bold, color: plum });
    y -= 18;
    for (const [label, value] of rows) {
      const lines = wrap(value, 360);
      if (y - lines.length * 13 < 50) {
        page = doc.addPage([595, 842]);
        y = 790;
      }
      page.drawText(pdfText(label), { x: 40, y, size: 10, font: bold });
      lines.forEach((l, i) => page.drawText(l, { x: 190, y: y - i * 13, size: 10, font }));
      y -= Math.max(16, lines.length * 13 + 4);
    }
    y -= 10;
  }
  return doc.save();
}

/** Everything health-related for a bird, oldest first, one line each */
export function healthLogCsv(bird: string, events: { date: string; time: string; kind: string; detail: string; action: string; by: string }[]): string {
  return csv([
    [`${bird}: health and vet log`],
    ['Date', 'Time', 'What', 'Details', 'Action taken', 'By'],
    ...[...events].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((e) => [ukDate(e.date), e.time, e.kind, e.detail, e.action, e.by]),
  ]);
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

async function run(): Promise<{ copied: number; skipped: number; more: boolean }> {
  const started = Date.now();
  const timeUp = () => Date.now() - started > 100_000;
  let more = false;
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
  /**
   * Uploads (or replaces) a file when it has changed. `sig` describes the content (for PDFs, whose
   * bytes differ every time they're made); the file is only built when the sig is new.
   */
  async function put(key: string, sig: string, path: string[], file: string, make: () => Promise<Uint8Array | string> | Uint8Array | string, type: string) {
    const h = await hash(sig);
    if (copiedHash.get(key) === h) {
      skipped++;
      return;
    }
    const body = await make();
    const parent = await folder(path);
    const r = await graph(`/me/drive/items/${parent}:/${encodeURIComponent(safe(file))}:/content`, { method: 'PUT', headers: { 'Content-Type': type }, body: body as BodyInit });
    if (!r.ok) throw new Error(`Uploading ${[...path, file].join('/')}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    await db.from('onedrive_copied').upsert({ key, hash: h, copied_at: new Date().toISOString() });
    copiedHash.set(key, h);
    copied++;
  }
  const stop = () => {
    if (!timeUp()) return false;
    more = true;
    return true;
  };

  const [{ data: birds }, { data: aviaries }, { data: profiles }] = await Promise.all([
    db.from('birds').select('*'),
    db.from('aviaries').select('id, name, number, breeding'),
    db.from('profiles').select('id, display_name'),
  ]);
  const aviaryOf = (id: string | null) => (aviaries ?? []).find((x) => x.id === id);
  const aviaryLabel = (id: string | null) => {
    const a = aviaryOf(id);
    return a ? (a.number != null ? `${a.name} ${a.number}` : a.name) : 'No aviary';
  };
  const staff = (id: string | null) => (profiles ?? []).find((p) => p.id === id)?.display_name ?? '';
  const today = londonToday();
  const active = [...(birds ?? [])].filter((b) => b.status === 'active').sort((x, y) => (x.route_order ?? 1e9) - (y.route_order ?? 1e9));
  const hhmm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const londonDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));

  // Health records for every bird, loaded once
  const [{ data: checks }, { data: issues }, { data: entries }, { data: meds }, { data: doses }] = await Promise.all([
    db.from('bird_checkups').select('*').is('voided_at', null).order('checked_on'),
    db.from('health_issues').select('*').is('voided_at', null),
    db.from('health_entries').select('*').is('voided_at', null),
    db.from('medications').select('*').is('voided_at', null),
    db.from('med_doses').select('*').is('voided_at', null),
  ]);

  // 1) The weekly records: every bird, this week and last week
  for (const monday of [mondayOf(addDays(today, -7)), mondayOf(today)]) {
    if (stop()) break;
    const { data: weekLogs } = await db
      .from('feed_logs')
      .select('bird_id, log_date, status, food_type, amount, weight_g')
      .in('status', ['fed', 'left', 'fasting', 'weighed'])
      .is('voided_at', null)
      .gte('log_date', monday)
      .lte('log_date', addDays(monday, 6));
    const list = active.map((b) => ({ id: b.id, name: b.name, weight_unit: b.weight_unit, aviary: aviaryLabel(b.aviary_id), section: aviaryOf(b.aviary_id)?.name ?? 'No aviary' }));
    const sheet = weeklyRecordsCsv(monday, list, (weekLogs ?? []) as WeekLog[]);
    await put(`week:${monday}`, sheet, ['Weekly records'], `${monday} week.csv`, () => sheet, 'text/csv');
  }

  // 2) Each bird's folder: record, health and vet log, health checks
  for (const b of active) {
    if (stop()) break;
    const dir = ['Birds', b.name];

    const lastCheck = (checks ?? []).filter((c) => c.bird_id === b.id).at(-1);
    const openIssues = (issues ?? []).filter((i) => i.bird_id === b.id && !i.closed_at);
    const currentMeds = (meds ?? []).filter((m) => m.bird_id === b.id && !m.stopped_at && (!m.end_date || m.end_date >= today));
    const fast = (b.fast_days ?? []).map((d: number) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ');
    const target = [b.target_weight_min, b.target_weight_max].filter((x) => x != null).map((g) => weightText(g, b.weight_unit)).join(' – ');
    const team = { flying: 'Flying team', resting: 'Flying team (resting)', aviary: 'Aviary bird' }[b.team as string] ?? '';
    const sections: { heading: string; rows: [string, string][] }[] = [
      {
        heading: 'Bird',
        rows: [
          ['Name', b.name],
          ['Species', b.species ?? ''],
          ['Scientific name', b.scientific_name ?? ''],
          ['Sex', b.sex === 'M' ? 'Male' : b.sex === 'F' ? 'Female' : 'Unknown'],
          ['Ring / microchip', b.ring_microchip ?? ''],
          ['Hatched', [b.hatch_date, b.hatch_year].filter(Boolean).join(' / ')],
          ['Arrived', [b.arrival_date, b.age_at_arrival && `aged ${b.age_at_arrival}`, b.supplier && `from ${b.supplier}`].filter(Boolean).join(', ')],
        ],
      },
      {
        heading: 'Where and how it is kept',
        rows: [
          ['Aviary', aviaryLabel(b.aviary_id) + (aviaryOf(b.aviary_id)?.breeding ? ' (breeding aviary)' : '')],
          ['Team', team],
          ['Usual food', [b.default_portion, b.default_food].filter(Boolean).join(' ')],
          ['Feeds a day', String(b.feeds_per_day ?? 1)],
          ['Fast days', fast],
          ['Target weight', target],
          ['Care notes', b.care_notes ?? ''],
          ['Enrichment', b.enrichment ?? ''],
        ],
      },
      {
        heading: 'Health',
        rows: [
          ['Last health check', lastCheck ? `${ukDate(lastCheck.checked_on)}${lastCheck.condition_score != null ? `, condition ${scoreText(lastCheck.condition_score)}` : ''}${lastCheck.weight_g != null ? `, ${weightText(lastCheck.weight_g, b.weight_unit)}` : ''}` : 'None yet'],
          ['Open health issues', openIssues.map((i) => `${i.title} (since ${ukDate(i.started_on)})`).join('; ') || 'None'],
          ['Current medication', currentMeds.map((m) => `${m.name_dose}, ${m.amount}`).join('; ') || 'None'],
          ['Vaccinations', b.vaccinations ?? ''],
          ['Other notes', b.record_notes ?? ''],
        ],
      },
    ];
    const recordSig = JSON.stringify(sections);
    await put(`record:${b.id}`, recordSig, dir, `${b.name} - bird record.pdf`, () => birdRecordPdf(`${b.name}: bird record`, sections, 'National Centre for Birds of Prey'), 'application/pdf');

    // Health and vet log: issues, updates, medication courses and every dose
    const myIssues = (issues ?? []).filter((i) => i.bird_id === b.id);
    const titleOf = (id: string | null) => myIssues.find((i) => i.id === id)?.title ?? '';
    const events = [
      ...myIssues.map((i) => ({ date: i.started_on, time: hhmm(i.opened_at), kind: 'Health issue', detail: i.title, action: '', by: staff(i.opened_by) })),
      ...myIssues.filter((i) => i.closed_at).map((i) => ({ date: londonDay(i.closed_at), time: hhmm(i.closed_at), kind: 'Issue closed', detail: i.title, action: i.outcome ?? '', by: staff(i.closed_by) })),
      ...(entries ?? [])
        .filter((e) => e.bird_id === b.id)
        .map((e) => ({ date: e.log_date, time: hhmm(e.logged_at), kind: 'Health update', detail: [titleOf(e.issue_id), e.notes, e.photo_paths?.length ? `${e.photo_paths.length} photo(s)` : ''].filter(Boolean).join(': '), action: e.action ?? '', by: staff(e.staff_id) })),
      ...(meds ?? [])
        .filter((m) => m.bird_id === b.id)
        .flatMap((m) => [
          { date: m.start_date, time: '', kind: 'Medication started', detail: `${m.name_dose}, ${m.amount}, ${m.times_per_day}x a day${m.every_days > 1 ? ` every ${m.every_days} days` : ''}${m.end_date ? ` until ${ukDate(m.end_date)}` : ''}${m.notes ? ` (${m.notes})` : ''}`, action: m.prescribed_by ? `Prescribed by ${m.prescribed_by}` : '', by: staff(m.created_by) },
          ...(m.stopped_at ? [{ date: londonDay(m.stopped_at), time: hhmm(m.stopped_at), kind: 'Medication stopped', detail: m.name_dose, action: m.stop_reason ?? '', by: staff(m.stopped_by) }] : []),
        ]),
      ...(doses ?? [])
        .filter((d) => d.bird_id === b.id)
        .map((d) => ({ date: d.dose_date, time: hhmm(d.logged_at), kind: 'Dose given', detail: [(meds ?? []).find((m) => m.id === d.medication_id)?.name_dose, d.amount].filter(Boolean).join(', '), action: d.notes ?? '', by: staff(d.staff_id) })),
    ];
    if (events.length) {
      const log = healthLogCsv(b.name, events);
      await put(`healthlog:${b.id}`, log, dir, 'Health and vet log.csv', () => log, 'text/csv');
    }

    // Health checks: one PDF each, sent again if it's ticked as added to ZIMS later
    for (const c of (checks ?? []).filter((x) => x.bird_id === b.id)) {
      if (stop()) break;
      const input: CheckupForPdf = {
        checked_on: c.checked_on,
        bird: { name: b.name, species: b.species, sex: b.sex },
        aviary: aviaryLabel(b.aviary_id),
        staff: staff(c.staff_id),
        done_with: c.done_with,
        ring_seen: c.ring_seen,
        condition_score: c.condition_score,
        weight_g: c.weight_g,
        checks: c.checks ?? {},
        notes: c.notes,
        zims: !!c.zims_at,
      };
      await put(`checkup:${c.id}`, JSON.stringify(input), [...dir, 'Health checks'], `${c.checked_on} health check.pdf`, () => checkupPdf(input, 'National Centre for Birds of Prey'), 'application/pdf');
    }
  }

  // 3) Photos into each bird's Photos folder: its own photo, health photos, prescriptions (copied once)
  const photos: { key: string; bucket: string; path: string; dir: string[]; file: string }[] = [];
  for (const b of active) {
    const dir = ['Birds', b.name, 'Photos'];
    if (b.photo_path) photos.push({ key: `photo:${b.photo_path}`, bucket: 'bird-photos', path: b.photo_path, dir, file: `${b.name} ${b.photo_path.split('/').pop()}` });
    for (const e of (entries ?? []).filter((x) => x.bird_id === b.id))
      (e.photo_paths ?? []).forEach((path: string, n: number) => {
        const title = (issues ?? []).find((i) => i.id === e.issue_id)?.title ?? 'Health';
        photos.push({ key: `photo:${path}`, bucket: 'health-photos', path, dir: [...dir, `Health - ${title}`], file: `${e.log_date} ${n + 1}.${path.split('.').pop() ?? 'jpg'}` });
      });
    for (const m of (meds ?? []).filter((x) => x.bird_id === b.id))
      (m.prescription_paths ?? []).forEach((path: string, n: number) =>
        photos.push({ key: `photo:${path}`, bucket: 'health-photos', path, dir: [...dir, 'Prescriptions'], file: `${m.start_date} ${m.name_dose} ${n + 1}.${path.split('.').pop() ?? 'jpg'}` }),
      );
  }
  for (const ph of photos) {
    if (copiedHash.has(ph.key)) continue;
    if (stop()) break;
    await put(ph.key, ph.path, ph.dir, ph.file, async () => {
      const { data, error } = await db.storage.from(ph.bucket).download(ph.path);
      if (error || !data) throw new Error(`Reading photo ${ph.path}: ${error?.message ?? 'missing'}`);
      return new Uint8Array(await data.arrayBuffer());
    }, 'image/jpeg');
  }

  // 4) This year's breeding records (and last year's in January, to finish it off)
  const year = Number(today.slice(0, 4));
  for (const y of today.slice(5, 7) === '01' ? [year - 1, year] : [year]) {
    if (stop()) break;
    const { data: breeding } = await db.from('breeding_logs').select('*').is('voided_at', null).gte('log_date', `${y}-01-01`).lte('log_date', `${y}-12-31`).order('logged_at');
    if (!breeding?.length) continue;
    const rows = breeding.map((e) => ({ log_date: e.log_date, aviary: aviaryLabel(e.aviary_id), kind: e.kind, count: e.count, notes: e.notes, staff: staff(e.staff_id) }));
    const sheet = breedingCsv(y, rows);
    await put(`breeding:${y}`, sheet, ['Breeding'], `Breeding ${y}.csv`, () => sheet, 'text/csv');
  }

  await db.from('onedrive_settings').update({ last_run_at: new Date().toISOString(), last_copied: copied, last_error: null }).eq('id', 1);
  return { copied, skipped, more };
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
