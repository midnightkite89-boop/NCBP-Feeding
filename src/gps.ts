// Reads Marshall AeroVision flight logs (.kml, or a .zip holding one), trims the
// still bits at either end, and works out the flight stats.
import { unzipSync, strFromU8 } from 'fflate';

/** One second of the bird's track: [secs from start, lat, lon, speed mph | null, metres from you | null, height vs you m | null] */
export type TrackPoint = [number, number, number, number | null, number | null, number | null];
/** One second of the falconer's (receiver's) track: [secs, lat, lon] */
export type MePoint = [number, number, number];

export interface ParsedFlight {
  bird: TrackPoint[];
  me: MePoint[];
  /** "16:31" from the file's name, if it has one */
  startClock: string | null;
  name: string | null;
  /** The top speed the Marshall app itself reports for the file (mph), if given */
  fileMaxSpeed: number | null;
}

export interface FlightStats {
  duration_s: number;
  distance_m: number;
  max_speed_mph: number | null;
  avg_speed_mph: number | null;
  max_dist_m: number | null;
  gap_s: number;
  fast_s: number;
}

const MAX_GAP = 3; // seconds without a fix before it counts as a signal gap
// mph; only throws out impossible readings – a peregrine's stoop can pass 100 mph
const MAX_SPEED = 250;

/** Pull the KML text out of a picked file (.kml or .zip) */
export async function readFlightFile(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) return new TextDecoder().decode(buf);
  const files = unzipSync(buf, { filter: (f) => /\.kml$/i.test(f.name) && !f.name.includes('__MACOSX') });
  const name = Object.keys(files)[0];
  if (!name) throw new Error('That zip has no .kml flight file in it.');
  return strFromU8(files[name]);
}

const num = (desc: string, key: string): number | null => {
  const m = desc.match(new RegExp(`${key}: (-?[\\d.]+)`));
  return m ? Number(m[1]) : null;
};

/** Parse AeroVision KML: "Transmitter" points are the bird, "My track" points are the receiver */
export function parseKml(text: string): ParsedFlight {
  const split = text.indexOf('<name>My track</name>');
  const birdPart = split > 0 ? text.slice(0, split) : text;
  const mePart = split > 0 ? text.slice(split) : '';
  const re = /<Placemark>\s*<name>(\d{1,2}):(\d\d):(\d\d)<\/name>[\s\S]*?<description>([\s\S]*?)<\/description>/g;

  // The tag logs ~10 fixes a second; we keep one point a second for the map, but
  // keep the FASTEST speed and furthest distance of that second so short bursts
  // like a stoop aren't lost.
  const birdBySec = new Map<number, { lat: number; lon: number; altFt: number | null; spd: number | null; dist: number | null }>();
  for (const m of birdPart.matchAll(re)) {
    const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const d = m[4];
    const lat = num(d, 'Latitude');
    const lon = num(d, 'Longitude');
    if (lat == null || lon == null) continue;
    const raw = num(d, 'Speed');
    const spd = raw != null && raw <= MAX_SPEED ? raw : null;
    const dist = num(d, 'Distance\\(meters\\)');
    const prev = birdBySec.get(t);
    birdBySec.set(t, {
      lat,
      lon,
      altFt: num(d, 'Altitude'),
      spd: prev?.spd != null && (spd == null || prev.spd > spd) ? prev.spd : spd,
      dist: prev?.dist != null && (dist == null || prev.dist > dist) ? prev.dist : dist,
    });
  }
  const meBySec = new Map<number, { lat: number; lon: number; alt: number | null }>();
  for (const m of mePart.matchAll(re)) {
    const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const lat = num(m[4], 'Latitude');
    const lon = num(m[4], 'Longitude');
    if (lat != null && lon != null) meBySec.set(t, { lat, lon, alt: num(m[4], 'Altitude') });
  }
  if (birdBySec.size < 10) throw new Error("This doesn't look like an AeroVision flight file (no bird track found).");

  const bird: TrackPoint[] = [...birdBySec.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, p]) => {
      const me = meBySec.get(t);
      // Bird altitude is in feet, the receiver's in metres
      const h = p.altFt != null && me?.alt != null ? Math.round((p.altFt * 0.3048 - me.alt) * 10) / 10 : null;
      return [t, round6(p.lat), round6(p.lon), p.spd, p.dist, h];
    });
  const me: MePoint[] = [...meBySec.entries()].sort((a, b) => a[0] - b[0]).map(([t, p]) => [t, round6(p.lat), round6(p.lon)]);

  const name = text.match(/<Document>\s*<name>([^<]*)<\/name>/)?.[1]?.trim() ?? null;
  const startClock = name?.match(/(\d{1,2}:\d\d)/)?.[1] ?? null;
  const headMax = text.slice(0, 3000).match(/Max Speed: ([\d.]+) mph/);
  return { bird, me, startClock, name, fileMaxSpeed: headMax ? Number(headMax[1]) : null };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Metres between two lat/lon points (flat-earth is fine over a few km) */
export function metres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const x = ((bLon - aLon) * Math.PI) / 180 * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  const y = ((bLat - aLat) * Math.PI) / 180;
  return 6371000 * Math.hypot(x, y);
}

/** Speed for each point: the tag's own reading, else worked out from the move since the last fix */
function speeds(track: TrackPoint[]): number[] {
  return track.map((p, i) => {
    if (p[3] != null) return p[3];
    if (i === 0) return 0;
    const q = track[i - 1];
    const dt = p[0] - q[0];
    return dt > 0 && dt <= MAX_GAP ? (metres(q[1], q[2], p[1], p[2]) / dt) * 2.237 : 0;
  });
}

/**
 * Where the flight really starts and ends: the first and last stretch where the
 * bird is moving (over 4 mph for at least half of a 20-second window). Cuts the
 * tag sitting still before release and after it was left recording.
 */
export function autoTrim(track: TrackPoint[]): { start: number; end: number } {
  const whole = { start: track[0]?.[0] ?? 0, end: track.at(-1)?.[0] ?? 0 };
  if (track.length < 5) return whole;
  const spd = speeds(track);
  const WINDOW = 20;
  // active[i]: the 20 seconds from point i are mostly moving
  const active = track.map((p, i) => {
    let moving = 0;
    let total = 0;
    for (let j = i; j < track.length && track[j][0] < p[0] + WINDOW; j++) {
      total++;
      if (spd[j] >= 4) moving++;
    }
    return total >= 5 && moving / total >= 0.5;
  });
  const firstWindow = active.indexOf(true);
  if (firstWindow === -1) return whole;
  // The first moving point inside that first active window
  let first = firstWindow;
  while (first < track.length - 1 && spd[first] < 4) first++;
  const lastWindow = active.lastIndexOf(true);
  // The last moving point inside that final active window
  let last = lastWindow;
  for (let j = lastWindow; j < track.length && track[j][0] < track[lastWindow][0] + WINDOW; j++) if (spd[j] >= 4) last = j;
  const pad = 5;
  return { start: Math.max(whole.start, track[first][0] - pad), end: Math.min(whole.end, track[last][0] + pad) };
}

export function trimTrack<T extends { 0: number }>(track: T[], start: number, end: number): T[] {
  return track.filter((p) => p[0] >= start && p[0] <= end);
}

export function flightStats(track: TrackPoint[]): FlightStats {
  let distance = 0;
  let gap = 0;
  let fast = 0;
  let maxSpeed: number | null = null;
  let maxDist: number | null = null;
  let spdSum = 0;
  let spdN = 0;
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (i > 0) {
      const q = track[i - 1];
      const dt = p[0] - q[0];
      if (dt > MAX_GAP) gap += dt;
      else distance += metres(q[1], q[2], p[1], p[2]);
    }
    if (p[3] != null) {
      maxSpeed = Math.max(maxSpeed ?? 0, p[3]);
      if (p[3] >= 3) {
        spdSum += p[3];
        spdN++;
      }
      if (p[3] >= 25) fast++;
    }
    if (p[4] != null) maxDist = Math.max(maxDist ?? 0, p[4]);
  }
  return {
    duration_s: track.length ? track.at(-1)![0] - track[0][0] : 0,
    distance_m: Math.round(distance),
    max_speed_mph: maxSpeed,
    avg_speed_mph: spdN ? Math.round((spdSum / spdN) * 10) / 10 : null,
    max_dist_m: maxDist,
    gap_s: gap,
    fast_s: fast,
  };
}

export const miles = (m: number) => (m / 1609.34).toFixed(1);
export function mmss(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
