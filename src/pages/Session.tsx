import { useEffect, useMemo, useState } from 'react';
import { aviaryLabel, routeSort, sectionRuns } from '../aviary';
import { FlightTime, GloveFeed, gloveAmount, useGloveFeed } from '../components/FlightParts';
import { FLIGHT_ORDER, hhmm, lastFlightType, rememberFlightType, todayAt } from '../flight';
import { feedLabel } from '../food';
import { useStore, type LogInput } from '../store';
import { supabase } from '../supabase';
import { addDays, formatTime } from '../time';
import { flightTypeLabel, type Bird, type FeedLog, type FlightType } from '../types';

/**
 * Log one experience / display / training session: pick the type, tick the
 * birds that flew, optionally "fed on the glove", save once. The flights are
 * grouped so you can see which birds took part in which session.
 */
export function Session() {
  const { birds, aviaries, today, todayLogs, logFeeds, logName, voidLog, loading } = useStore();
  const [type, setType] = useState<FlightType>(lastFlightType);
  const [time, setTime] = useState(() => hhmm(new Date()));
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [glove, setGlove] = useGloveFeed('Chick');
  const [flownCount, setFlownCount] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // Birds flown in the last 60 days, most often first: the usual experience birds
  useEffect(() => {
    supabase
      .from('feed_logs')
      .select('bird_id')
      .eq('status', 'flown')
      .is('voided_at', null)
      .gte('log_date', addDays(today, -60))
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const r of (data ?? []) as { bird_id: string }[]) counts[r.bird_id] = (counts[r.bird_id] ?? 0) + 1;
        setFlownCount(counts);
      });
  }, [today]);

  const active = useMemo(() => routeSort(birds.filter((b) => b.status === 'active'), aviaries), [birds, aviaries]);
  const usual = useMemo(
    () =>
      active
        .filter((b) => flownCount[b.id])
        .sort((a, b) => flownCount[b.id] - flownCount[a.id])
        .slice(0, 12),
    [active, flownCount],
  );
  const q = search.trim().toLowerCase();
  const matches = (b: Bird) => {
    if (!q) return true;
    const a = aviaries.find((x) => x.id === b.aviary_id);
    return [b.name, b.species ?? '', a ? aviaryLabel(a) : ''].some((t) => t.toLowerCase().includes(q));
  };
  const runs = sectionRuns(active.filter(matches), aviaries);
  const when = todayAt(time);
  const inFuture = when != null && when.getTime() > Date.now() + 60_000;

  function toggle(id: string) {
    setError(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function save() {
    if (picked.length === 0) return setError('Tick the birds that flew.');
    if (type === 'other' && !note.trim()) return setError('Add a note saying what "Other" was.');
    if (!when || inFuture) return setError("That time hasn't happened yet today.");
    const at = when.toISOString();
    const sessionId = crypto.randomUUID();
    const entries: LogInput[] = [];
    for (const id of picked) {
      entries.push({ bird_id: id, status: 'flown', food_type: null, amount: null, weight_g: null, notes: note.trim() || null, more_due: false, logged_at: at, flight_type: type, session_id: sessionId });
      if (glove.on && glove.food.trim())
        entries.push({ bird_id: id, status: 'fed', food_type: glove.food.trim(), amount: gloveAmount(glove), weight_g: null, notes: 'On the glove', more_due: glove.moreLater, logged_at: at, session_id: sessionId });
    }
    rememberFlightType(type);
    logFeeds(entries, `${flightTypeLabel(type)} ${time} · ${picked.length} bird${picked.length === 1 ? '' : 's'}${glove.on ? ` · fed ${feedLabel(gloveAmount(glove), glove.food.trim())}` : ''}`, {
      alsoCheck: true,
    });
    setPicked([]);
    setNote('');
    setSearch('');
    setTime(hhmm(new Date()));
  }

  // Today's sessions, newest first
  const sessions = useMemo(() => {
    const map = new Map<string, FeedLog[]>();
    for (const l of todayLogs) if (l.session_id) map.set(l.session_id, [...(map.get(l.session_id) ?? []), l]);
    return [...map.entries()]
      .map(([id, logs]) => ({ id, logs, flights: logs.filter((l) => l.status === 'flown') }))
      .filter((s) => s.flights.length > 0)
      .sort((a, b) => b.flights[0].logged_at.localeCompare(a.flights[0].logged_at));
  }, [todayLogs]);

  if (loading) return <p className="empty">Loading…</p>;
  const nameOf = (id: string) => birds.find((b) => b.id === id)?.name ?? '?';

  return (
    <div className="session-page">
      <h1 className="page-title">✈ Log a session</h1>

      <div className="flight-types session-types" role="radiogroup" aria-label="Type of session">
        {FLIGHT_ORDER.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={type === t} className={`btn btn-lg flight-type${type === t ? ' on' : ''}`} onClick={() => setType(t)}>
            {flightTypeLabel(t)}
          </button>
        ))}
      </div>
      <FlightTime time={time} onChange={setTime} />
      <label className="field">
        <span>Who / note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Smith family, 2 adults" />
      </label>

      <h2 className="session-h">
        Birds that flew <span className="muted">{picked.length ? `· ${picked.length} ticked` : ''}</span>
      </h2>
      {usual.length > 0 && !q && (
        <>
          <p className="session-sub">Usually fly</p>
          <div className="pick-grid">
            {usual.map((b) => (
              <PickChip key={b.id} bird={b} on={picked.includes(b.id)} onToggle={toggle} />
            ))}
          </div>
        </>
      )}
      <div className="search session-search">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a bird" aria-label="Find a bird" autoComplete="off" />
      </div>
      {runs.map((r) => (
        <div key={r.key}>
          <p className="session-sub">{r.title}</p>
          <div className="pick-grid">
            {r.birds.map((b) => (
              <PickChip key={b.id} bird={b} on={picked.includes(b.id)} onToggle={toggle} />
            ))}
          </div>
        </div>
      ))}

      <GloveFeed value={glove} onChange={setGlove} />
      {error && <p className="warn">{error}</p>}
      <div className="session-save">
        <button className="btn btn-primary btn-xl" onClick={save}>
          Log {flightTypeLabel(type)?.toLowerCase()}
          {picked.length > 0 && ` · ${picked.length} bird${picked.length === 1 ? '' : 's'}`}
        </button>
      </div>

      <h2 className="session-h">Today's sessions</h2>
      {sessions.length === 0 ? (
        <p className="muted">None logged yet today.</p>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => {
            const f = s.flights[0];
            const fed = s.logs.filter((l) => l.status === 'fed');
            return (
              <li key={s.id}>
                <div className="session-line">
                  <strong>
                    {flightTypeLabel(f.flight_type)} {formatTime(f.logged_at)}
                  </strong>
                  {f.notes && <span> · {f.notes}</span>}
                </div>
                <div className="session-birds">{s.flights.map((l) => nameOf(l.bird_id)).join(', ')}</div>
                <div className="meta">
                  {logName(f)}
                  {fed.length > 0 && ` · fed ${feedLabel(fed[0].amount, fed[0].food_type)} on the glove`}
                  {s.logs.some((l) => l.pending) && ' · not sent yet'}
                </div>
                <button
                  className="btn btn-outline session-remove"
                  onClick={() => {
                    if (window.confirm(`Remove this ${flightTypeLabel(f.flight_type)?.toLowerCase()} for ${s.flights.length} bird(s)? It's kept on record as removed by you.`))
                      s.logs.forEach((l) => voidLog(l.id));
                  }}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PickChip({ bird, on, onToggle }: { bird: Bird; on: boolean; onToggle: (id: string) => void }) {
  return (
    <button type="button" className={`pick-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onToggle(bird.id)}>
      {on ? '✓ ' : ''}
      {bird.name}
    </button>
  );
}
