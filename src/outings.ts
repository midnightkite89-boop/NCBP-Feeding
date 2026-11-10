import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Outings: one record per trip out with birds. Forms are filled in on site, often
// with poor signal, so every save lands on this phone first and is sent when it can
// be. A save sends the whole record, so sending twice is harmless.

export type OutingKind = 'show' | 'wedding' | 'school' | 'party' | 'experience' | 'other';
export type Check = 'ok' | 'problem';

export const KINDS: { id: OutingKind; label: string }[] = [
  { id: 'show', label: 'Show' },
  { id: 'wedding', label: 'Wedding' },
  { id: 'school', label: 'School' },
  { id: 'party', label: 'Party' },
  { id: 'experience', label: 'Experience' },
  { id: 'other', label: 'Other' },
];
export const kindLabel = (k: OutingKind) => KINDS.find((x) => x.id === k)?.label ?? k;
/** Shows and weddings need R6 and R7 as well as R8 */
export const fullForms = (k: OutingKind) => k === 'show' || k === 'wedding';

export const BASE_ADDRESS = 'Ox Hays, Long Ridging Farm, Oxenhope, BD22 9QY';
const BASE_POSTCODE = 'BD22 9QY';

export interface Journey {
  purpose?: string;
  from?: string;
  to?: string;
  date?: string;
  start?: string;
  end?: string;
  miles?: string;
}

export interface OutingBird {
  bird_id: string;
  // Kept as they were on the day, in case the bird is later renamed or archived
  name: string;
  species: string | null;
  ring: string | null;
  pre?: Check | null;
  during?: Check | null;
  post?: Check | null;
  handling?: string;
  flown?: string;
  fed?: string;
  note?: string;
}

export interface Hazard {
  hazard?: string;
  harm?: string;
  mitigation?: string;
  further?: string;
  who?: string;
  when?: string;
  confirmed?: string;
}

export interface Injury {
  raptor?: string;
  injury?: string;
  treatment?: string;
}

export interface Accident {
  when?: string;
  location?: string;
  others?: string;
  nature?: string;
  damage?: string;
  injuries?: Injury[];
  claim_date?: string;
}

export interface OutingDetails {
  address?: string;
  completed_by?: string;
  driver?: string;
  arrive?: string;
  leave?: string;
  miles?: string;
  travel_time?: string;
  local_vet?: string;
  outward?: Journey;
  back?: Journey;
  break_time?: string;
  break_duration?: string;
  birds?: OutingBird[];
  risk?: {
    date?: string;
    assessed_by?: string;
    rows?: Record<string, { measures?: string; checked?: boolean }>;
    comments?: string;
    hazards?: Hazard[];
  };
  briefing?: Record<string, boolean>;
  handwash?: string;
  accident?: Accident;
}

export interface Outing {
  id: string;
  kind: OutingKind;
  venue: string;
  start_date: string;
  end_date: string;
  details: OutingDetails;
  created_at?: string;
  updated_at?: string;
  voided_at?: string | null;
}

// Worded as on SMJ's Site Specific Risk Assessment
export const RISK_ROWS: { key: string; label: string }[] = [
  { key: 'static', label: 'Location of static display' },
  { key: 'flying', label: 'Location and times of flying display' },
  { key: 'site', label: 'Risks assessed and discussed with organiser. Powerlines, Cables, Animals, Marquees, Archery and Clay Pigeon Ranges, Rivers, Roads, Train lines and Airports/Aircraft, Wind Turbines.' },
  { key: 'noise', label: 'Any noise disruption discussed. (loud bangs, fly overs, music, funfairs, fireworks etc)' },
  { key: 'plans', label: 'Site Emergency and Fire plans discussed and shared' },
  { key: 'weather', label: 'Weather conditions assessed' },
];

// Worded as on R6
export const BRIEFING_ROWS: { key: string; label: string }[] = [
  { key: 'signs', label: 'Relevant signs are displayed where raptors are exhibited' },
  { key: 'handwash', label: 'Sign post to hand washing facilities to be used before and after coming into contact' },
  { key: 'types', label: 'Describe what type(s) of raptors will be used' },
  { key: 'behave', label: 'Describe how clients/audiences should behave around them (including sudden/loud noises such as applause), or movements that might frighten the raptors and/or make them panic or react aggressively' },
  { key: 'supervised', label: 'Explain that handling will be constantly supervised by a competent member of staff' },
  { key: 'stopped', label: 'Explain that any interaction will be stopped if the raptor shows sign of anxiety, fear, stress or fatigue' },
  { key: 'disease', label: 'Brief on how to minimise the risks of diseases that can be transmitted between humans and raptors' },
  { key: 'alcohol', label: 'Explain that raptors will not be handled by persons whose behaviour appears at the time to be influenced by the consumption of alcohol or by any psychoactive substance' },
];
export const FILM_BRIEFING = {
  key: 'film',
  label: 'Television, film or theatre work only: everyone on the production site has been told what kinds of raptors will be used, how to behave around them, and what might frighten them. Keep all Call Sheets.',
};

/** The riding-along facts are copied; anything that must be checked on the day is left blank */
export function copyRiskFrom(previous: Outing): NonNullable<OutingDetails['risk']> {
  const rows: Record<string, { measures?: string; checked?: boolean }> = {};
  for (const [key, row] of Object.entries(previous.details.risk?.rows ?? {})) {
    if (key !== 'weather' && row.measures) rows[key] = { measures: row.measures, checked: false };
  }
  return {
    rows,
    comments: previous.details.risk?.comments,
    hazards: (previous.details.risk?.hazards ?? []).map((h) => ({ ...h, confirmed: '' })),
  };
}

// ---------------------------------------------------------------------------
// Saving: phone first, then server
// ---------------------------------------------------------------------------

const CACHE_KEY = 'smj-outings';
const PENDING_KEY = 'smj-outings-pending';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the server copy still stands */
  }
}

/** Server list with anything not yet sent laid over it, voided ones removed */
function current(): Outing[] {
  const pending = read<Record<string, Outing>>(PENDING_KEY, {});
  const server = read<Outing[]>(CACHE_KEY, []);
  const merged = server.map((o) => pending[o.id] ?? o);
  for (const o of Object.values(pending)) if (!server.some((s) => s.id === o.id)) merged.push(o);
  return merged.filter((o) => !o.voided_at);
}

async function flush(): Promise<string | null> {
  for (const [id, o] of Object.entries(read<Record<string, Outing>>(PENDING_KEY, {}))) {
    const { error } = await supabase.from('outings').upsert({
      id: o.id,
      kind: o.kind,
      venue: o.venue,
      start_date: o.start_date,
      end_date: o.end_date,
      details: o.details,
      updated_at: o.updated_at,
      voided_at: o.voided_at ?? null,
    });
    if (error) return error.message;
    // Only clear it if it wasn't changed again while this one was sending
    const now = read<Record<string, Outing>>(PENDING_KEY, {});
    if (now[id]?.updated_at === o.updated_at) {
      delete now[id];
      write(PENDING_KEY, now);
    }
  }
  return null;
}

const pendingCount = () => Object.keys(read<Record<string, Outing>>(PENDING_KEY, {})).length;
const isNetworkError = (m: string) => /fetch|network|load failed/i.test(m);

export function useOutings() {
  const [outings, setOutings] = useState<Outing[]>(current);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(pendingCount);
  const [error, setError] = useState<string | null>(null);

  const afterFlush = useCallback((message: string | null) => {
    setError(message && !isNetworkError(message) ? message : null);
    setPending(pendingCount());
  }, []);

  const reload = useCallback(async () => {
    afterFlush(await flush());
    const { data, error: e } = await supabase.from('outings').select('*').is('voided_at', null).order('start_date', { ascending: false });
    if (!e && data) write(CACHE_KEY, data);
    setOutings(current());
    setLoaded(true);
  }, [afterFlush]);

  useEffect(() => {
    void reload();
    const again = () => void reload();
    window.addEventListener('online', again);
    window.addEventListener('focus', again);
    return () => {
      window.removeEventListener('online', again);
      window.removeEventListener('focus', again);
    };
  }, [reload]);

  const save = useCallback(
    (o: Outing) => {
      const now = read<Record<string, Outing>>(PENDING_KEY, {});
      now[o.id] = { ...o, updated_at: new Date().toISOString() };
      write(PENDING_KEY, now);
      setOutings(current());
      setPending(pendingCount());
      void flush().then(afterFlush);
    },
    [afterFlush],
  );

  return { outings, loaded, pending, error, save };
}

// ---------------------------------------------------------------------------
// Miles, travel time and nearest specialist vet (free services, no key needed)
// ---------------------------------------------------------------------------

const VETS = [
  { name: 'Battle Flatts Veterinary Clinic', phone: '01759 371 066', postcode: 'YO41 1AN' },
  { name: 'Ark Vet Surgery', phone: '01246 415 270', postcode: 'S18 2NA' },
  { name: 'Evolution Exotics', phone: '', postcode: 'DY14 0AD' },
  { name: 'Avian Veterinary Services', phone: '01606 350 410', postcode: 'CW9 7TN' },
  { name: 'Holly House Vets Exotics Leeds', phone: '0113 322 4341', postcode: 'LS17 8AE' },
];

export const findPostcode = (text: string | undefined) => text?.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i)?.[0] ?? null;

function milesBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
}

export interface TripInfo {
  miles: string;
  travelTime: string;
  vet: string;
}

/** Throws a plain-English message if it can't be worked out */
export async function workOutTrip(address: string | undefined): Promise<TripInfo> {
  const postcode = findPostcode(address);
  if (!postcode) throw new Error('Add the postcode to the address first.');
  const res = await fetch('https://api.postcodes.io/postcodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postcodes: [BASE_POSTCODE, postcode, ...VETS.map((v) => v.postcode)] }),
  });
  if (!res.ok) throw new Error("Couldn't look up the postcode. Type the miles in instead.");
  const found = ((await res.json()) as { result: { result: { latitude: number; longitude: number } | null }[] }).result.map((r) => r.result);
  const [base, there] = found;
  if (!base || !there) throw new Error("That postcode wasn't recognised.");

  const route = await fetch(`https://router.project-osrm.org/route/v1/driving/${base.longitude},${base.latitude};${there.longitude},${there.latitude}?overview=false`);
  if (!route.ok) throw new Error("Couldn't work out the route. Type the miles in instead.");
  const leg = ((await route.json()) as { routes?: { distance: number; duration: number }[] }).routes?.[0];
  if (!leg) throw new Error("Couldn't work out the route. Type the miles in instead.");
  const mins = Math.round(leg.duration / 60);
  const travelTime = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;

  let vet = '';
  let best = Infinity;
  VETS.forEach((v, i) => {
    const at = found[i + 2];
    if (!at) return;
    const d = milesBetween(there, at);
    if (d < best) {
      best = d;
      vet = [v.name, v.phone].filter(Boolean).join(', ');
    }
  });
  return { miles: (leg.distance / 1609.344).toFixed(1), travelTime, vet };
}
