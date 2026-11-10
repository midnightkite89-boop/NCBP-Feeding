// Demo mode (dev only): a pretend Supabase that lives in this browser.
// Answers the REST, RPC and auth calls the app makes from a copy of the centre's
// data (demo-data.json, built by scripts/build-demo-data.mjs). Changes are kept in
// localStorage so a reload doesn't lose them; open with ?demo=reset to start again.
// Loaded this way so a checkout without the (uncommitted) data file still builds
const seed = Object.values(import.meta.glob('./demo-data.json', { eager: true, import: 'default' }))[0] ?? { user: 'demo', tables: {} };

type Row = Record<string, unknown>;
interface Db {
  user: string;
  tables: Record<string, { columns: string[]; rows: Row[] }>;
}

const STORE_KEY = 'demo-db';
export const DEMO_URL = 'http://demo.localhost';

function load(): Db {
  try {
    if (new URLSearchParams(location.search).get('demo') === 'reset') localStorage.removeItem(STORE_KEY);
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return JSON.parse(saved) as Db;
  } catch {
    /* fall back to the seed */
  }
  return structuredClone(seed) as Db;
}

const db = load();
const save = () => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    /* full or blocked: the demo still works until reload */
  }
};

const now = () => new Date().toISOString();
const londonDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));

/** A signed-in session for the demo user, so the app skips the login screen */
export function seedDemoSession() {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const user = { id: db.user, email: 'demo@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: now() };
  const access_token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: db.user, exp, role: 'authenticated' })}.demo`;
  localStorage.setItem('sb-demo-auth-token', JSON.stringify({ access_token, token_type: 'bearer', expires_in: 31536000, expires_at: exp, refresh_token: 'demo', user }));
  return { access_token, user, exp };
}

// --- PostgREST filters ------------------------------------------------------------

function parseValue(v: string): unknown {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

/** One condition like "eq.active" or "not.is.null" against a value */
function test(value: unknown, cond: string): boolean {
  let negate = false;
  if (cond.startsWith('not.')) {
    negate = true;
    cond = cond.slice(4);
  }
  const dot = cond.indexOf('.');
  const op = cond.slice(0, dot);
  const raw = cond.slice(dot + 1);
  let ok: boolean;
  switch (op) {
    case 'eq':
      ok = value != null && String(value) === raw;
      break;
    case 'neq':
      ok = value != null && String(value) !== raw;
      break;
    case 'is':
      ok = raw === 'null' ? value == null : value === parseValue(raw);
      break;
    case 'gt':
      ok = value != null && compare(value, raw) > 0;
      break;
    case 'gte':
      ok = value != null && compare(value, raw) >= 0;
      break;
    case 'lt':
      ok = value != null && compare(value, raw) < 0;
      break;
    case 'lte':
      ok = value != null && compare(value, raw) <= 0;
      break;
    case 'in':
      ok = raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(value));
      break;
    case 'cs': // array contains
      ok = Array.isArray(value) && raw.replace(/^\{|\}$/g, '').split(',').every((x) => (value as unknown[]).map(String).includes(x));
      break;
    default:
      console.warn('[demo] unsupported filter', op);
      ok = true;
  }
  return negate ? !ok : ok;
}

/** "(a.is.null,b.gte.2026-01-01)" → rows matching any */
function testOr(row: Row, expr: string): boolean {
  const parts = expr.replace(/^\(|\)$/g, '').split(/,(?![^(]*\))/);
  return parts.some((p) => {
    const dot = p.indexOf('.');
    return test(row[p.slice(0, dot)], p.slice(dot + 1));
  });
}

function applyQuery(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, val] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
    if (key === 'or') out = out.filter((r) => testOr(r, val));
    else out = out.filter((r) => test(r[key], val));
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((k) => {
      const [col, ...mods] = k.split('.');
      return { col, desc: mods.includes('desc'), nullsFirst: mods.includes('nullsfirst') };
    });
    out = [...out].sort((a, b) => {
      for (const { col, desc, nullsFirst } of keys) {
        const x = a[col];
        const y = b[col];
        if (x == null && y == null) continue;
        if (x == null) return nullsFirst ? -1 : 1;
        if (y == null) return nullsFirst ? 1 : -1;
        const c = compare(x, y);
        if (c !== 0) return desc ? -c : c;
      }
      return 0;
    });
  }
  const limit = params.get('limit');
  if (limit) out = out.slice(Number(params.get('offset') ?? 0), Number(params.get('offset') ?? 0) + Number(limit));
  return out;
}

/** "id, name, feed_logs(log_date)" → only those columns; embedded tables come back empty */
function project(rows: Row[], select: string | null): Row[] {
  if (!select || select === '*') return rows;
  const cols = select.split(/,(?![^(]*\))/).map((c) => c.trim());
  return rows.map((r) => {
    const o: Row = {};
    for (const c of cols) {
      const embed = c.match(/^(\w+)\(/);
      if (embed) o[embed[1]] = null;
      else if (c === '*') Object.assign(o, r);
      else o[c] = r[c];
    }
    return o;
  });
}

// --- writes ----------------------------------------------------------------------

/** Fill in what the database would: ids, times, who, today's date */
function withDefaults(table: string, row: Row): Row {
  const t = db.tables[table];
  const full: Row = {};
  for (const c of t.columns) full[c] = null;
  Object.assign(full, row);
  const has = (c: string) => t.columns.includes(c);
  if (has('id') && full.id == null) full.id = crypto.randomUUID();
  for (const c of ['created_at', 'logged_at', 'added_at', 'updated_at']) if (has(c) && full[c] == null) full[c] = now();
  for (const c of ['staff_id', 'created_by', 'added_by', 'changed_by']) if (has(c) && full[c] == null) full[c] = db.user;
  if (has('log_date') && full.log_date == null) full.log_date = londonDate(String(full.logged_at ?? now()));
  for (const c of ['more_due', 'archived', 'concern']) if (has(c) && full[c] == null) full[c] = false;
  if (table === 'birds') full.status ??= 'active';
  return full;
}

const VOIDS: Record<string, string> = {
  void_feed_log: 'feed_logs',
  void_care_log: 'care_logs',
  void_ferret_log: 'ferret_logs',
  void_flight_track: 'flight_tracks',
};

function rpc(name: string, args: Row): unknown {
  const rows = (t: string) => db.tables[t]?.rows ?? [];
  if (VOIDS[name]) {
    for (const r of rows(VOIDS[name])) if (r.id === args.log_id && !r.voided_at) Object.assign(r, { voided_at: now(), voided_by: db.user });
  } else if (name === 'clear_special_request') {
    for (const r of rows('special_requests')) if (r.id === args.request_id) Object.assign(r, { cleared_at: now(), cleared_by: db.user });
  } else if (name === 'resolve_concern') {
    for (const r of rows('care_logs')) if (r.id === args.log_id) Object.assign(r, { resolved_at: now(), resolved_by: db.user, resolution: args.action });
  } else if (name === 'remove_from_clean_plan') {
    rows('clean_plan').push(withDefaults('clean_plan', { plan_date: args.p_date, aviary_id: args.p_aviary, removed_by: db.user, removed_at: now() }));
  } else if (name === 'set_bird_targets') {
    for (const r of rows('birds'))
      if (r.id === args.p_bird) Object.assign(r, { target_weight_min: args.p_min, target_weight_max: args.p_max, default_portion: args.p_portion });
  } else {
    console.info('[demo] rpc not imitated, ignoring:', name);
  }
  save();
  return null;
}

// --- the fetch itself ------------------------------------------------------------

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (!url.href.startsWith(DEMO_URL)) return fetch(input, init);
  const path = url.pathname;
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.text();
  const data = body ? JSON.parse(body) : null;

  if (path.startsWith('/auth/v1/')) {
    const s = seedDemoSession();
    if (path.endsWith('/user')) return json(s.user);
    if (path.endsWith('/logout')) return new Response(null, { status: 204 });
    return json({ access_token: s.access_token, token_type: 'bearer', expires_in: 31536000, expires_at: s.exp, refresh_token: 'demo', user: s.user });
  }
  if (path.startsWith('/rest/v1/rpc/')) return json(rpc(path.slice('/rest/v1/rpc/'.length), data ?? {}));
  if (path.startsWith('/storage/v1/')) return json({ error: 'Photos are not stored in demo mode' }, 400);
  if (path.startsWith('/functions/v1/')) return json({});

  const table = path.replace('/rest/v1/', '');
  const t = db.tables[table];
  if (!t) return json({ code: 'PGRST205', message: `[demo] no table ${table}` }, 404);
  const params = url.searchParams;
  const single = (req.headers.get('Accept') ?? '').includes('vnd.pgrst.object');
  const prefer = req.headers.get('Prefer') ?? '';
  const reply = (rows: Row[], status = 200) => {
    const projected = project(rows, params.get('select'));
    const headers: Record<string, string> = prefer.includes('count=') ? { 'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` } : {};
    if (req.method === 'HEAD') return new Response(null, { status, headers });
    if (single) return projected.length === 1 ? json(projected[0], status) : json({ code: 'PGRST116', message: 'Not one row' }, 406);
    return json(projected, status, headers);
  };

  switch (req.method) {
    case 'GET':
    case 'HEAD':
      return reply(applyQuery(t.rows, params));
    case 'POST': {
      const incoming = (Array.isArray(data) ? data : [data]) as Row[];
      const merge = prefer.includes('merge-duplicates');
      const added = incoming.map((r) => {
        const existing = merge && r.id != null ? t.rows.find((x) => x.id === r.id) : undefined;
        if (existing) return Object.assign(existing, r);
        const full = withDefaults(table, r);
        t.rows.push(full);
        return full;
      });
      save();
      return reply(added, 201);
    }
    case 'PATCH': {
      const hit = applyQuery(t.rows, params);
      for (const r of hit) Object.assign(r, data);
      save();
      return reply(hit);
    }
    case 'DELETE': {
      const hit = new Set(applyQuery(t.rows, params));
      t.rows = t.rows.filter((r) => !hit.has(r));
      save();
      return reply([...hit]);
    }
  }
  return json({ message: '[demo] unsupported' }, 400);
}
