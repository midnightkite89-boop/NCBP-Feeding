import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MePoint, TrackPoint } from '../gps';
import { mmss } from '../gps';

const BIRD = '#872250';
const ME = '#2f5d8a';
const GAP = 3;

/** Map of the bird's flight (and the falconer), with a dot at the chosen second */
export function FlightMap({ bird, me, at, dimOutside }: { bird: TrackPoint[]; me?: MePoint[] | null; at?: number; dimOutside?: { start: number; end: number } }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const dot = useRef<{ bird: L.CircleMarker; me: L.CircleMarker } | null>(null);

  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(m);
    map.current = m;
    layers.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Draw the lines whenever the track or trim changes
  useEffect(() => {
    const m = map.current;
    const g = layers.current;
    if (!m || !g || bird.length === 0) return;
    g.clearLayers();
    const inTrim = (t: number) => !dimOutside || (t >= dimOutside.start && t <= dimOutside.end);
    // Split into runs: in/out of the trim, and signal gaps
    let run: L.LatLngExpression[] = [];
    let runIn = inTrim(bird[0][0]);
    const flush = () => {
      if (run.length > 1) L.polyline(run, { color: BIRD, weight: runIn ? 3 : 2, opacity: runIn ? 0.95 : 0.25 }).addTo(g);
      run = [];
    };
    bird.forEach((p, i) => {
      const prev = bird[i - 1];
      if (prev && p[0] - prev[0] > GAP) {
        flush();
        L.polyline([[prev[1], prev[2]], [p[1], p[2]]], { color: '#888', weight: 2, dashArray: '4 6', opacity: 0.8 }).addTo(g);
      }
      if (inTrim(p[0]) !== runIn) {
        const last = run.at(-1);
        flush();
        if (last) run.push(last);
        runIn = inTrim(p[0]);
      }
      run.push([p[1], p[2]]);
    });
    flush();
    if (me && me.length > 1) L.polyline(me.filter((p) => inTrim(p[0])).map((p) => [p[1], p[2]] as L.LatLngTuple), { color: ME, weight: 3, opacity: 0.9 }).addTo(g);
    const shown = bird.filter((p) => inTrim(p[0]));
    const bounds = L.latLngBounds((shown.length ? shown : bird).map((p) => [p[1], p[2]] as L.LatLngTuple));
    if (me) for (const p of me) if (inTrim(p[0])) bounds.extend([p[1], p[2]]);
    m.fitBounds(bounds, { padding: [20, 20] });
    dot.current = {
      me: L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: ME, fillOpacity: 1 }),
      bird: L.circleMarker([0, 0], { radius: 8, color: '#fff', weight: 2, fillColor: BIRD, fillOpacity: 1 }),
    };
  }, [bird, me, dimOutside?.start, dimOutside?.end]);

  // Move the dots
  useEffect(() => {
    const g = layers.current;
    if (!g || !dot.current || at == null) return;
    const b = pointAt(bird, at);
    if (b) dot.current.bird.setLatLng([b[1], b[2]]).addTo(g);
    const mp = me ? pointAt(me, at) : null;
    if (mp) dot.current.me.setLatLng([mp[1], mp[2]]).addTo(g);
  }, [at, bird, me]);

  return <div className="flight-map" ref={box} role="img" aria-label="Map of the flight" />;
}

/** The last point at or before second t */
export function pointAt<T extends { 0: number }>(list: T[], t: number): T | null {
  let lo = 0;
  let hi = list.length - 1;
  if (hi < 0 || list[0][0] > t) return list[0] ?? null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

/** A small line chart over time, e.g. speed. Gaps in the signal break the line. */
export function TrackChart({
  bird,
  index,
  title,
  unit,
  from,
  to,
  at,
  shade,
  onPick,
}: {
  bird: TrackPoint[];
  index: 3 | 4 | 5;
  title: string;
  unit: string;
  from: number;
  to: number;
  at?: number;
  shade?: { start: number; end: number };
  onPick?: (t: number) => void;
}) {
  const W = 600;
  const H = 120;
  const L0 = 36;
  const B = 18;
  const values = bird.map((p) => p[index]).filter((v): v is number => v != null);
  const lo = Math.min(0, ...values);
  const hiRaw = Math.max(1, ...values);
  const step = niceStep((hiRaw - lo) / 4);
  const hi = Math.ceil(hiRaw / step) * step;
  const x = (t: number) => L0 + ((t - from) / Math.max(1, to - from)) * (W - L0 - 6);
  const y = (v: number) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - B - 6);

  const path = useMemo(() => {
    let d = '';
    let pen = false;
    bird.forEach((p, i) => {
      const v = p[index];
      if (v == null || p[0] < from || p[0] > to || (i > 0 && p[0] - bird[i - 1][0] > GAP)) pen = false;
      if (v == null || p[0] < from || p[0] > to) return;
      d += `${pen ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bird, index, from, to, lo, hi]);

  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v));
  const minuteStep = to - from > 1800 ? 10 : to - from > 600 ? 5 : 1;
  const minutes: number[] = [];
  for (let m = Math.ceil(from / 60 / minuteStep) * minuteStep; m * 60 <= to; m += minuteStep) minutes.push(m);

  function pick(e: React.PointerEvent<SVGSVGElement>) {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = from + (((e.clientX - r.left) / r.width) * W - L0) / (W - L0 - 6) * (to - from);
    onPick(Math.round(Math.min(to, Math.max(from, t))));
  }

  return (
    <figure className="track-chart">
      <figcaption>
        <strong>{title}</strong> <span className="muted">{unit}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onPointerDown={pick} onPointerMove={(e) => e.buttons && pick(e)}>
        {shade && (
          <>
            <rect x={L0} y={0} width={Math.max(0, x(shade.start) - L0)} height={H - B} fill="#000" opacity={0.08} />
            <rect x={x(shade.end)} y={0} width={Math.max(0, W - 6 - x(shade.end))} height={H - B} fill="#000" opacity={0.08} />
          </>
        )}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L0} x2={W - 6} y1={y(v)} y2={y(v)} stroke="#e3e3e3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={L0 - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#666">
              {v}
            </text>
          </g>
        ))}
        {minutes.map((m) => (
          <text key={m} x={x(m * 60)} y={H - 4} textAnchor="middle" fontSize={11} fill="#666">
            {m}m
          </text>
        ))}
        <path d={path} fill="none" stroke={BIRD} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        {at != null && <line x1={x(at)} x2={x(at)} y1={0} y2={H - B} stroke="#111" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
    </figure>
  );
}

function niceStep(raw: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Play / pause and a slider over the flight, with a readout for the chosen second */
export function usePlayback(from: number, to: number) {
  const [at, setAt] = useState(from);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  useEffect(() => setAt(from), [from]);
  useEffect(() => {
    if (!playing) return;
    let last = 0;
    let raf = 0;
    const tick = (ts: number) => {
      const dt = last ? (ts - last) / 1000 : 0;
      last = ts;
      setAt((a) => {
        const next = Math.min(to, a + dt * speed);
        if (next >= to) setPlaying(false);
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, to]);
  return { at, setAt, playing, setPlaying, speed, setSpeed };
}

export function PlaybackBar({ from, to, p, clock }: { from: number; to: number; p: ReturnType<typeof usePlayback>; clock: (t: number) => string }) {
  return (
    <div className="playback">
      <button
        type="button"
        className="btn btn-outline"
        onClick={() => {
          if (!p.playing && p.at >= to) p.setAt(from);
          p.setPlaying(!p.playing);
        }}
      >
        {p.playing ? 'Pause' : 'Play'}
      </button>
      <select value={p.speed} onChange={(e) => p.setSpeed(Number(e.target.value))} aria-label="Playback speed">
        <option value={10}>10×</option>
        <option value={30}>30×</option>
        <option value={60}>60×</option>
      </select>
      <input
        type="range"
        min={from}
        max={to}
        step={1}
        value={Math.round(p.at)}
        onChange={(e) => {
          p.setPlaying(false);
          p.setAt(Number(e.target.value));
        }}
        aria-label="Time in flight"
      />
      <span className="playback-time">
        {clock(p.at)} <span className="muted">({mmss(p.at - from)})</span>
      </span>
    </div>
  );
}
