import { sumFeeds } from '../food';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { aviaryLabel, routeSort } from '../aviary';
import { BirdPhoto } from '../components/BirdPhoto';
import { useStore } from '../store';
import { targetRange } from '../status';
import { supabase } from '../supabase';
import { addDays, formatDay, formatTime } from '../time';
import { flightTypeLabel, type Bird, type FeedLog } from '../types';
import { GRAMS_PER_OZ, formatWeight } from '../weight';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '3 months' },
  { days: 365, label: 'Year' },
];

interface Day {
  date: string;
  weights: FeedLog[];
  fed: FeedLog[];
  /** Food found uneaten */
  left: FeedLog[];
  fasting: boolean;
  flights: FeedLog[];
  foodSet: FeedLog[];
  notes: string[];
  staff: Set<string>;
}

/** Look back at a bird's weights and feeding, day by day, with a weight chart. */
export function Records() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { birds, aviaries } = useStore();
  const [query, setQuery] = useState('');
  const bird = birds.find((b) => b.id === id) ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = routeSort(
      birds.filter((b) => b.status === 'active'),
      aviaries,
    );
    if (!q) return list;
    return list.filter((b) => {
      const a = aviaries.find((x) => x.id === b.aviary_id);
      return [b.name, b.species ?? '', a ? aviaryLabel(a) : ''].some((t) => t.toLowerCase().includes(q));
    });
  }, [birds, aviaries, query]);

  return (
    <div className="records">
      <WeighModeTabs mode="records" />
      {!bird ? (
        <>
          <div className="search">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bird, species or aviary"
              aria-label="Search birds"
              autoComplete="off"
              autoFocus
            />
          </div>
          <ul className="admin-list">
            {matches.map((b) => {
              const a = aviaries.find((x) => x.id === b.aviary_id);
              return (
                <li key={b.id}>
                  <button onClick={() => navigate(`/weigh/records/${b.id}`)}>
                    <BirdPhoto bird={b} size={44} />
                    <span>
                      <strong>{b.name}</strong>
                      <br />
                      <small>
                        {a ? aviaryLabel(a) : 'no aviary'}
                        {b.species && ` · ${b.species}`}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {matches.length === 0 && <p className="empty">No bird matches "{query.trim()}".</p>}
        </>
      ) : (
        <BirdRecords key={bird.id} bird={bird} />
      )}
    </div>
  );
}

/** Weigh in | Records switch at the top of the Weigh tab */
export function WeighModeTabs({ mode }: { mode: 'weigh' | 'records' | 'week' }) {
  return (
    <div className="segmented scan-tabs" role="tablist">
      <Link role="tab" aria-selected={mode === 'weigh'} className={`seg-link${mode === 'weigh' ? ' on' : ''}`} to="/weigh">
        Weigh in
      </Link>
      <Link role="tab" aria-selected={mode === 'records'} className={`seg-link${mode === 'records' ? ' on' : ''}`} to="/weigh/records">
        Records
      </Link>
      <Link role="tab" aria-selected={mode === 'week'} className={`seg-link${mode === 'week' ? ' on' : ''}`} to="/weigh/week">
        Weekly
      </Link>
    </div>
  );
}

function BirdRecords({ bird }: { bird: Bird }) {
  const { aviaries, today, staffName, todayLogs, isAdmin } = useStore();
  const [range, setRange] = useState(30);
  const [logs, setLogs] = useState<FeedLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aviary = aviaries.find((a) => a.id === bird.aviary_id);
  const from = addDays(today, -(range - 1));

  useEffect(() => {
    setLogs(null);
    setError(null);
    supabase
      .from('feed_logs')
      .select('*')
      .eq('bird_id', bird.id)
      .is('voided_at', null)
      .gte('log_date', from)
      .order('logged_at')
      .then(({ data, error }) => {
        if (error) setError('Records need a signal to load.');
        setLogs((data as FeedLog[]) ?? []);
      });
    // today's logs change → refetch so new entries appear
  }, [bird.id, from, todayLogs.length]);

  const days = useMemo(() => {
    const map = new Map<string, Day>();
    for (const l of logs ?? []) {
      const d = map.get(l.log_date) ?? { date: l.log_date, weights: [], fed: [], left: [], fasting: false, flights: [], foodSet: [], notes: [], staff: new Set<string>() };
      if (l.weight_g != null) d.weights.push(l);
      if (l.status === 'fed') d.fed.push(l);
      if (l.status === 'left') d.left.push(l);
      if (l.status === 'fasting') d.fasting = true;
      if (l.status === 'flown') d.flights.push(l);
      if (l.status === 'weighed' && l.weight_g == null && (l.food_type || l.amount)) d.foodSet.push(l);
      if (l.notes) d.notes.push(l.notes);
      d.staff.add(l.staff_id);
      map.set(l.log_date, d);
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [logs]);

  // One point per day: the first weight of the day (usually the morning weigh-in)
  const points = useMemo(
    () =>
      [...days]
        .reverse()
        .filter((d) => d.weights.length > 0)
        .map((d) => ({ date: d.date, grams: d.weights[0].weight_g as number })),
    [days],
  );

  const unit = bird.weight_unit ?? 'g';
  const latest = points.at(-1) ?? null;
  const first = points[0] ?? null;
  const change = latest && first && points.length > 1 ? latest.grams - first.grams : null;

  function downloadCsv() {
    if (!isAdmin) return;
    const lbOz = unit === 'lb_oz';
    const rows = [['Date', ...(lbOz ? ['Weight (lb/oz)'] : []), 'Weight (g)', 'Fed', 'Left', 'Fasting', 'Flights', 'Notes', 'Staff']];
    for (const d of [...days].reverse()) {
      rows.push([
        d.date,
        ...(lbOz ? [d.weights.map((w) => formatWeight(w.weight_g, unit)).join(' / ')] : []),
        d.weights.map((w) => String(w.weight_g)).join(' / '),
        d.fed.map((f) => [f.amount, f.food_type].filter(Boolean).join(' ')).join(' + '),
        sumFeeds(d.left),
        d.fasting ? 'yes' : '',
        d.flights.map((f) => `${formatTime(f.logged_at)} ${flightTypeLabel(f.flight_type) ?? ''}`.trim()).join(', '),
        d.notes.join(' | '),
        [...d.staff].map(staffName).join(', '),
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `${bird.name} records ${from} to ${today}.csv`;
    a.click();
  }

  return (
    <>
      <Link to="/weigh/records" className="btn btn-outline">
        ← Choose another bird
      </Link>
      <div className="bird-head records-head">
        <BirdPhoto bird={bird} size={64} />
        <div className="bird-title">
          <div className="bird-name">{bird.name}</div>
          <div className="species">
            {aviary && <span className="card-aviary">{aviaryLabel(aviary)}</span>}
            {bird.species}
          </div>
        </div>
      </div>

      <div className="segmented" role="radiogroup" aria-label="Period">
        {RANGES.map((r) => (
          <button key={r.days} role="radio" aria-checked={range === r.days} className={range === r.days ? 'on' : ''} onClick={() => setRange(r.days)}>
            {r.label}
          </button>
        ))}
      </div>

      {error && <p className="warn">{error}</p>}
      {logs == null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <dl className="facts records-stats">
            <dt>Latest weight</dt>
            <dd>{latest ? `${formatWeight(latest.grams, unit)} · ${formatDay(latest.date)}` : '—'}</dd>
            <dt>Change</dt>
            <dd>{change == null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : '±'}${formatWeight(Math.abs(Math.round(change * 10) / 10), unit)} over ${points.length} weigh-ins`}</dd>
            <dt>Target</dt>
            <dd>{targetRange(bird) ?? '—'}</dd>
          </dl>

          <section className="panel">
            <h2>Weight</h2>
            {points.length === 0 ? <p className="muted">No weights recorded in this period.</p> : <WeightChart bird={bird} points={points} from={from} to={today} />}
          </section>

          <div className="section-head">
            <h2>Day by day</h2>
            {/* Downloads are for the admin only */}
            {isAdmin && (
              <button className="btn btn-outline" onClick={downloadCsv} disabled={days.length === 0}>
                Download CSV
              </button>
            )}
          </div>
          {days.length === 0 ? (
            <p className="muted">Nothing logged in this period.</p>
          ) : (
            <div className="table-wrap">
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Weight</th>
                    <th>Fed</th>
                    <th>Left</th>
                    <th>Flown</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <td className="nowrap">{formatDay(d.date)}</td>
                      <td className="nowrap">{d.weights.map((w) => formatWeight(w.weight_g, unit)).join(' / ') || '—'}</td>
                      <td>
                        {d.fasting && <strong>Fasting </strong>}
                        {d.fed.map((f) => [f.amount, f.food_type].filter(Boolean).join(' ') || 'Fed').join(' + ') || (d.fasting ? '' : '—')}
                        {d.foodSet.length > 0 && d.fed.length === 0 && <span className="muted"> (set: {d.foodSet.at(-1)!.amount} {d.foodSet.at(-1)!.food_type})</span>}
                      </td>
                      <td className={d.left.length ? 'week-left has-left' : ''}>{sumFeeds(d.left)}</td>
                      <td>{d.flights.map((f) => `${formatTime(f.logged_at)} ${flightTypeLabel(f.flight_type) ?? ''}`.trim()).join(', ') || ''}</td>
                      <td className="records-notes">{d.notes.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Line chart of daily weights with the target range shaded. Tap or hover for values. */
function WeightChart({ bird, points, from, to }: { bird: Bird; points: { date: string; grams: number }[]; from: string; to: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const unit = bird.weight_unit ?? 'g';
  const height = 220;
  const pad = { l: unit === 'lb_oz' ? 92 : 56, r: 14, t: 12, b: 28 };
  const w = Math.max(200, width) - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const tMin = bird.target_weight_min;
  const tMax = bird.target_weight_max;
  const values = [...points.map((p) => p.grams), ...(tMin != null ? [tMin] : []), ...(tMax != null ? [tMax] : [])];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const span = Math.max(hi - lo, hi * 0.04, 10);
  lo -= span * 0.15;
  hi += span * 0.15;

  const t0 = Date.parse(`${from}T12:00:00Z`);
  const t1 = Date.parse(`${to}T12:00:00Z`);
  const x = (date: string) => pad.l + (t1 === t0 ? w / 2 : ((Date.parse(`${date}T12:00:00Z`) - t0) / (t1 - t0)) * w);
  const y = (g: number) => pad.t + h - ((g - lo) / (hi - lo)) * h;

  // Clean ticks, about 5 steps: round grams, or whole/half ounces for lb/oz birds
  const per = unit === 'lb_oz' ? GRAMS_PER_OZ : 1;
  const raw = (hi - lo) / per / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    unit === 'lb_oz'
      ? ([0.25, 0.5, 1, 2, 4, 8, 16, 32].find((s) => s >= raw) ?? 32)
      : ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / per / step) * step; v * per <= hi; v += step) ticks.push(Math.round(v * per * 10) / 10);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.grams).toFixed(1)}`).join(' ');

  function pick(clientX: number) {
    const rect = wrap.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    });
    setHover(best);
  }

  const hp = hover != null ? points[hover] : null;

  return (
    <div
      ref={wrap}
      className="weight-chart"
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
    >
      <svg width={Math.max(200, width)} height={height} role="img" aria-label={`${bird.name}'s weight from ${formatDay(from)} to ${formatDay(to)}`}>
        {tMin != null && tMax != null && (
          <rect x={pad.l} width={w} y={y(tMax)} height={Math.max(0, y(tMin) - y(tMax))} className="chart-band" />
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={pad.l - 6} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
              {formatWeight(t, unit)}
            </text>
          </g>
        ))}
        <text x={pad.l} y={height - 8} className="chart-tick">
          {formatDay(from)}
        </text>
        <text x={pad.l + w} y={height - 8} className="chart-tick" textAnchor="end">
          {formatDay(to)}
        </text>
        {tMin != null && tMax != null && (
          <text x={pad.l + w - 4} y={y(tMax) + 12} className="chart-band-label" textAnchor="end">
            target
          </text>
        )}
        <path d={path} className="chart-line" />
        {points.map((p, i) => (
          <circle key={p.date} cx={x(p.date)} cy={y(p.grams)} r={i === hover ? 6 : 4} className="chart-dot" />
        ))}
        {hp && <line x1={x(hp.date)} x2={x(hp.date)} y1={pad.t} y2={pad.t + h} className="chart-cross" />}
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hp.date), 70), Math.max(200, width) - 70) }}>
          <strong>{formatWeight(hp.grams, unit)}</strong>
          <span>{formatDay(hp.date)}</span>
        </div>
      )}
    </div>
  );
}
