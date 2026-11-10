import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FlightMap, PlaybackBar, TrackChart, pointAt, usePlayback } from '../components/FlightView';
import { autoTrim, flightStats, miles, mmss, parseKml, readFlightFile, trimTrack, type MePoint, type ParsedFlight, type TrackPoint } from '../gps';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { addDays, formatDay, formatTime } from '../time';
import { TRACK_SUMMARY_COLUMNS, flightTypeLabel, type FeedLog, type FlightTrack, type FlightTrackSummary } from '../types';

/** Clock time for a second of the recording, e.g. "16:39" */
function clockFor(startClock: string | null, fallbackIso: string | null, t: number): string {
  let base: number | null = null;
  if (startClock) {
    const [h, m] = startClock.split(':').map(Number);
    base = h * 3600 + m * 60;
  } else if (fallbackIso) {
    const d = new Date(fallbackIso);
    const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).split(':').map(Number);
    base = h * 3600 + m * 60;
  }
  if (base == null) return mmss(t);
  const s = (base + Math.round(t)) % 86400;
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function trackLine(t: FlightTrackSummary): string {
  return [mmss(t.duration_s), `${miles(t.distance_m)} mi`, t.max_speed_mph != null ? `top ${t.max_speed_mph} mph` : null].filter(Boolean).join(' · ');
}

/** Today's flights (or another day's): tap one to see it or add its GPS log */
export function Flights() {
  const { todayLogs, today, birds, logName, loading } = useStore();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? today;
  const [pastLogs, setPastLogs] = useState<FeedLog[] | null>(null);
  const [tracks, setTracks] = useState<FlightTrackSummary[]>([]);

  useEffect(() => {
    if (date === today) return setPastLogs(null);
    setPastLogs(null);
    supabase
      .from('feed_logs')
      .select('*')
      .eq('log_date', date)
      .eq('status', 'flown')
      .is('voided_at', null)
      .order('logged_at')
      .then(({ data }) => setPastLogs((data ?? []) as FeedLog[]));
  }, [date, today]);

  const flights = useMemo(
    () => (date === today ? todayLogs.filter((l) => l.status === 'flown') : (pastLogs ?? [])).slice().sort((a, b) => b.logged_at.localeCompare(a.logged_at)),
    [date, today, todayLogs, pastLogs],
  );
  const ids = flights.map((f) => f.id).join(',');

  useEffect(() => {
    if (!ids) return setTracks([]);
    supabase
      .from('flight_tracks')
      .select(TRACK_SUMMARY_COLUMNS)
      .in('feed_log_id', ids.split(','))
      .is('voided_at', null)
      .then(({ data }) => setTracks((data ?? []) as unknown as FlightTrackSummary[]));
  }, [ids]);

  if (loading) return <p className="empty">Loading…</p>;
  const nameOf = (id: string) => birds.find((b) => b.id === id)?.name ?? '?';

  return (
    <div className="flights-page">
      <h1 className="page-title">✈ {date === today ? "Today's flights" : 'Flights'}</h1>
      <div className="day-nav">
        <button className="btn btn-outline" onClick={() => setParams({ date: addDays(date, -1) })} aria-label="Previous day">
          ◀
        </button>
        <strong>{formatDay(date)}</strong>
        <button className="btn btn-outline" disabled={date >= today} onClick={() => setParams(addDays(date, 1) === today ? {} : { date: addDays(date, 1) })} aria-label="Next day">
          ▶
        </button>
      </div>
      {date !== today && pastLogs == null ? (
        <p className="muted">Loading…</p>
      ) : flights.length === 0 ? (
        <p className="muted">
          No flights logged {date === today ? 'yet today' : 'that day'}. Log them with ✈ Flown on a bird or <Link to="/session">Log a session</Link>.
        </p>
      ) : (
        <ul className="flight-list">
          {flights.map((f) => {
            const t = tracks.find((x) => x.feed_log_id === f.id);
            return (
              <li key={f.id}>
                <Link to={`/flights/${f.id}`} className="flight-item">
                  <span className="flight-when">{formatTime(f.logged_at)}</span>
                  <span className="flight-main">
                    <span>
                      <strong>{nameOf(f.bird_id)}</strong> · {flightTypeLabel(f.flight_type) ?? 'Flight'}
                      {f.notes && <span className="muted"> · {f.notes}</span>}
                    </span>
                    <span className={`flight-gps${t ? ' has' : ''}`}>{t ? `📍 ${trackLine(t)}` : 'No GPS log yet'}</span>
                    <span className="meta">{logName(f)}{f.pending ? ' · not sent yet' : ''}</span>
                  </span>
                  <span className="more-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One flight: its GPS map and stats, or upload the log from the Marshall app */
export function FlightDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { todayLogs, birds, staffName, logName } = useStore();
  const [log, setLog] = useState<FeedLog | null>(() => todayLogs.find((l) => l.id === id) ?? null);
  const [track, setTrack] = useState<FlightTrack | null | undefined>(undefined);
  const [draft, setDraft] = useState<{ parsed: ParsedFlight; fileName: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!log) supabase.from('feed_logs').select('*').eq('id', id).maybeSingle().then(({ data }) => setLog((data as FeedLog) ?? null));
  }, [id, log]);

  async function loadTrack() {
    const { data, error: e } = await supabase.from('flight_tracks').select('*').eq('feed_log_id', id).is('voided_at', null).maybeSingle();
    if (e) setError(e.message);
    setTrack((data as FlightTrack) ?? null);
  }
  useEffect(() => {
    void loadTrack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy('Reading the GPS log…');
    try {
      const parsed = parseKml(await readFlightFile(file));
      setDraft({ parsed, fileName: file.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  if (!log) return <p className="empty">Loading…</p>;
  const bird = birds.find((b) => b.id === log.bird_id);

  return (
    <div className="flight-detail">
      <button className="btn btn-outline back-btn" onClick={() => navigate(-1)}>
        ‹ Back
      </button>
      <h1 className="page-title">
        {bird?.name ?? 'Flight'} · {flightTypeLabel(log.flight_type) ?? 'Flight'}
      </h1>
      <p className="muted">
        {formatDay(log.log_date)} {formatTime(log.logged_at)} · logged by {logName(log)}
        {log.notes && ` · ${log.notes}`}
      </p>

      <input ref={fileInput} type="file" accept=".kml,.zip,application/vnd.google-earth.kml+xml,application/zip" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
      {busy && <p className="muted">{busy}</p>}
      {error && <p className="warn">{error}</p>}

      {draft ? (
        <TrimEditor
          draft={draft}
          fallbackIso={log.logged_at}
          onCancel={() => setDraft(null)}
          onSave={async (row) => {
            if (!navigator.onLine) return setError('Saving a GPS log needs signal. Try again when you have it.');
            setBusy('Saving…');
            const { error: e } = await supabase.from('flight_tracks').insert({ ...row, feed_log_id: log.id, bird_id: log.bird_id });
            setBusy(null);
            if (e) return setError(e.message);
            setDraft(null);
            await loadTrack();
          }}
        />
      ) : track === undefined ? (
        <p className="muted">Loading…</p>
      ) : track ? (
        <>
          <TrackView track={track} fallbackIso={log.logged_at} />
          <p className="meta">
            GPS log added by {staffName(track.uploaded_by)} · {formatDay(track.uploaded_at.slice(0, 10))} {formatTime(track.uploaded_at)}
            {track.file_name && ` · ${track.file_name}`}
          </p>
          <div className="bird-actions">
            <button className="btn btn-outline btn-lg" onClick={() => fileInput.current?.click()}>
              Replace GPS log
            </button>
            {confirmRemove ? (
              <button
                className="btn btn-danger btn-lg"
                onClick={async () => {
                  const { error: e } = await supabase.rpc('void_flight_track', { track_id: track.id });
                  if (e) setError(e.message);
                  setConfirmRemove(false);
                  await loadTrack();
                }}
              >
                Yes, remove it
              </button>
            ) : (
              <button className="btn btn-outline btn-lg" onClick={() => setConfirmRemove(true)}>
                Remove GPS log
              </button>
            )}
          </div>
        </>
      ) : (
        <section className="panel gps-empty">
          <h2>Add the GPS log</h2>
          <ol className="gps-steps">
            <li>In the Marshall AeroVision app, open this flight and export it.</li>
            <li>
              Choose <strong>Save to Files</strong>.
            </li>
            <li>Come back here, tap the button below and pick the file (.kml or .zip).</li>
          </ol>
          <p className="muted">The app cuts off the still bits at the start and end. You can adjust that before saving.</p>
          <button className="btn btn-primary btn-xl" onClick={() => fileInput.current?.click()} disabled={!!busy}>
            📍 Upload GPS log
          </button>
        </section>
      )}
    </div>
  );
}

function StatTiles({ s }: { s: ReturnType<typeof flightStats> }) {
  const tiles: [string, string][] = [
    [mmss(s.duration_s), 'flight time'],
    [`${miles(s.distance_m)} mi`, 'distance flown'],
    [s.max_speed_mph != null ? `${s.max_speed_mph} mph` : '–', 'top speed'],
    [s.avg_speed_mph != null ? `${Math.round(s.avg_speed_mph)} mph` : '–', 'average speed'],
    [s.max_dist_m != null ? `${Math.round(s.max_dist_m)} m` : '–', 'furthest from you'],
    [s.gap_s ? mmss(s.gap_s) : 'none', 'no signal'],
  ];
  return (
    <div className="stat-tiles">
      {tiles.map(([v, l]) => (
        <div key={l}>
          <b>{v}</b>
          <span>{l}</span>
        </div>
      ))}
    </div>
  );
}

/** Saved flight: stats, map, replay and charts */
function TrackView({ track, fallbackIso }: { track: FlightTrack; fallbackIso: string }) {
  const bird = track.track as TrackPoint[];
  const me = track.me_track as MePoint[] | null;
  const from = bird[0]?.[0] ?? 0;
  const to = bird.at(-1)?.[0] ?? 0;
  const p = usePlayback(from, to);
  const clock = (t: number) => clockFor(track.start_clock, fallbackIso, t);
  const here = pointAt(bird, p.at);
  return (
    <>
      <StatTiles s={track} />
      <FlightMap bird={bird} me={me} at={p.at} />
      <PlaybackBar from={from} to={to} p={p} clock={clock} />
      {here && (
        <p className="readout">
          {here[3] != null ? `${here[3]} mph` : '– mph'} · {here[4] != null ? `${here[4]} m from you` : ''}
          {here[5] != null ? ` · ${here[5] > 0 ? '+' : ''}${Math.round(here[5])} m height` : ''}
        </p>
      )}
      <TrackChart bird={bird} index={3} title="Speed" unit="mph" from={from} to={to} at={p.at} onPick={(t) => p.setAt(t)} />
      <TrackChart bird={bird} index={4} title="Distance from you" unit="metres" from={from} to={to} at={p.at} onPick={(t) => p.setAt(t)} />
    </>
  );
}

/** Freshly read log: check the auto-trim, nudge it, save */
function TrimEditor({
  draft,
  fallbackIso,
  onCancel,
  onSave,
}: {
  draft: { parsed: ParsedFlight; fileName: string };
  fallbackIso: string;
  onCancel: () => void;
  onSave: (row: Record<string, unknown>) => Promise<void>;
}) {
  const { bird, me, startClock, fileMaxSpeed } = draft.parsed;
  const auto = useMemo(() => autoTrim(bird), [bird]);
  const [start, setStart] = useState(auto.start);
  const [end, setEnd] = useState(auto.end);
  const first = bird[0][0];
  const last = bird.at(-1)![0];
  const trimmed = useMemo(() => trimTrack(bird, start, end), [bird, start, end]);
  const stats = useMemo(() => flightStats(trimmed), [trimmed]);
  const clock = (t: number) => clockFor(startClock, fallbackIso, t);
  const cut = (start - first) + (last - end);

  function save() {
    const meTrim = trimTrack(me, start, end).filter((_, i) => i % 2 === 0);
    void onSave({
      file_name: draft.fileName,
      start_clock: startClock,
      trim_start: start,
      trim_end: end,
      ...stats,
      track: trimmed,
      me_track: meTrim.length ? meTrim : null,
    });
  }

  return (
    <section className="trim-editor">
      <h2>Check the start and end</h2>
      <p className="muted">
        The recording runs {clock(first)}–{clock(last)}. {cut > 30 ? `${mmss(cut)} where the bird wasn't flying has been cut off the start and end.` : 'Nothing needed cutting off.'} Drag the
        sliders if the flight started or finished at a different time.
      </p>
      <StatTiles s={stats} />
      {fileMaxSpeed != null && stats.max_speed_mph != null && stats.max_speed_mph < fileMaxSpeed && (
        <p className="warn">
          The Marshall app's top speed for this file is {fileMaxSpeed} mph, but the trimmed flight's is {stats.max_speed_mph} mph. Move the sliders out to include it, or tap Keep
          everything.
        </p>
      )}
      <FlightMap bird={bird} me={me} dimOutside={{ start, end }} at={start} />
      <TrackChart bird={bird} index={3} title="Speed" unit="mph" from={first} to={last} shade={{ start, end }} />
      <label className="field trim-slider">
        <span>
          Flight starts: <strong>{clock(start)}</strong>
        </span>
        <input type="range" min={first} max={last} step={1} value={start} onChange={(e) => setStart(Math.min(Number(e.target.value), end - 10))} />
      </label>
      <label className="field trim-slider">
        <span>
          Flight ends: <strong>{clock(end)}</strong>
        </span>
        <input type="range" min={first} max={last} step={1} value={end} onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 10))} />
      </label>
      <div className="bird-actions">
        <button
          className="btn btn-outline"
          onClick={() => {
            setStart(auto.start);
            setEnd(auto.end);
          }}
        >
          Back to automatic
        </button>
        <button
          className="btn btn-outline"
          onClick={() => {
            setStart(first);
            setEnd(last);
          }}
        >
          Keep everything
        </button>
      </div>
      <div className="bird-actions">
        <button className="btn btn-outline btn-lg" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary btn-lg" onClick={save}>
          Save GPS log
        </button>
      </div>
    </section>
  );
}
