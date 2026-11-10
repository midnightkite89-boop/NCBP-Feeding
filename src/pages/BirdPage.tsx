import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BirdCard } from '../components/BirdCard';
import { TargetHistory, TargetsSheet } from '../components/TargetsSheet';
import { EditLogSheet } from '../components/FlyFeed';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { defaultFeedLabel, targetRange } from '../status';
import { aviaryLabel } from '../aviary';
import { WEEKDAYS, formatDay, formatTime } from '../time';
import { formatWeight, type WeightUnit } from '../weight';
import { TRACK_SUMMARY_COLUMNS, flightTypeLabel, type FeedLog, type FlightTrackSummary } from '../types';
import { miles, mmss } from '../gps';
import { scheduleText } from '../health';

const STATUS_TEXT = { fed: 'Fed', fasting: 'Fasting', weighed: 'Weighed', flown: 'Flown', left: 'Food left' } as const;

export function BirdPage() {
  const { id } = useParams();
  const { birds, aviaries, todayLogs, logName, voidLog, isAdmin, healthIssues, medications, today } = useStore();
  const bird = birds.find((b) => b.id === id);
  const [history, setHistory] = useState<FeedLog[] | null>(null);
  const [editTargets, setEditTargets] = useState(false);
  const [editing, setEditing] = useState<FeedLog | null>(null);
  const [tracks, setTracks] = useState<(FlightTrackSummary & { feed_logs: { log_date: string; flight_type: FeedLog['flight_type'] } | null })[]>([]);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('flight_tracks')
      .select(`${TRACK_SUMMARY_COLUMNS}, feed_logs(log_date, flight_type)`)
      .eq('bird_id', id)
      .is('voided_at', null)
      .order('uploaded_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setTracks((data ?? []) as unknown as typeof tracks));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    supabase
      .from('feed_logs')
      .select('*')
      .eq('bird_id', id)
      .is('voided_at', null)
      .order('logged_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setHistory((data as FeedLog[]) ?? []));
    // Reload when today's logs change so history stays current
  }, [id, todayLogs]);

  if (!bird) return <p className="empty">Bird not found.</p>;
  const aviary = aviaries.find((a) => a.id === bird.aviary_id);
  const todays = todayLogs.filter((l) => l.bird_id === bird.id).reverse();

  function remove(log: FeedLog) {
    if (window.confirm(`Remove this entry (${STATUS_TEXT[log.status]} at ${formatTime(log.logged_at)})?\nIt will be kept on record as removed by you.`)) voidLog(log.id);
  }

  return (
    <div className="bird-page">
      <BirdCard bird={bird} detailed />

      <section className="panel">
        <dl className="facts">
          <dt>Aviary</dt>
          <dd>{aviary ? <Link to={`/a/${aviary.slug}`}>{aviaryLabel(aviary)}</Link> : '—'}</dd>
          <dt>Usual feed</dt>
          <dd>{defaultFeedLabel(bird)}</dd>
          <dt>Feeds per day</dt>
          <dd>{bird.feeds_per_day}</dd>
          <dt>Fast days</dt>
          <dd>{bird.fast_days.length ? bird.fast_days.map((d) => WEEKDAYS[d - 1]).join(', ') : 'None'}</dd>
          <dt>Target weight</dt>
          <dd>{targetRange(bird) ?? '—'}</dd>
          <dt>Weighed in</dt>
          <dd>{bird.weight_unit === 'lb_oz' ? 'lb / oz' : 'grams'}</dd>
        </dl>
        <div className="bird-actions">
          <button className="btn btn-outline" onClick={() => setEditTargets(true)}>
            ✎ Change target weight / amount
          </button>
          {bird.drive_folder_url && (
            <a href={bird.drive_folder_url} target="_blank" rel="noreferrer" className="btn btn-outline">
              📁 Open Drive folder
            </a>
          )}
          {isAdmin && (
            <Link to={`/admin/birds/${bird.id}`} className="btn btn-outline">
              Edit bird
            </Link>
          )}
        </div>
      </section>

      {editing && <EditLogSheet log={editing} bird={bird} onClose={() => setEditing(null)} />}
      {editTargets && <TargetsSheet bird={bird} onClose={() => setEditTargets(false)} />}
      <TargetHistory bird={bird} />

      <section className="panel">
        <h2>Health</h2>
        {healthIssues.filter((i) => i.bird_id === bird.id).map((i) => (
          <p key={i.id}>
            <Link to={`/health/issue/${i.id}`}>🩺 {i.title}</Link> <span className="muted">since {formatDay(i.started_on)}</span>
          </p>
        ))}
        {medications
          .filter((m) => m.bird_id === bird.id && !m.stopped_at && (!m.end_date || m.end_date >= today))
          .map((m) => (
            <p key={m.id}>
              <Link to={`/health/med/${m.id}`}>💊 {m.name_dose}</Link> <span className="muted">{m.amount} · {scheduleText(m)}</span>
            </p>
          ))}
        <div className="bird-actions">
          <Link to={`/health/issue/new?bird=${bird.id}`} className="btn btn-outline">
            + Health issue
          </Link>
          <Link to={`/health/med/new?bird=${bird.id}`} className="btn btn-outline">
            + Medication
          </Link>
        </div>
      </section>

      {tracks.length > 0 && (
        <section className="panel">
          <h2>GPS flights</h2>
          <ul className="flight-list">
            {tracks.map((t) => (
              <li key={t.id}>
                <Link to={`/flights/${t.feed_log_id}`} className="flight-item">
                  <span className="flight-when">{t.feed_logs ? formatDay(t.feed_logs.log_date).replace(/^\w+ /, '') : ''}</span>
                  <span className="flight-main">
                    <span className="flight-gps has">
                      {mmss(t.duration_s)} · {miles(t.distance_m)} mi{t.max_speed_mph != null ? ` · top ${t.max_speed_mph} mph` : ''}
                      {t.max_dist_m != null ? ` · ${Math.round(t.max_dist_m)} m out` : ''}
                    </span>
                    <span className="meta">{[flightTypeLabel(t.feed_logs?.flight_type), t.start_clock].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="more-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Today</h2>
        {todays.length === 0 ? (
          <p className="muted">Nothing logged yet.</p>
        ) : (
          <ul className="log-list">
            {todays.map((l) => (
              <li key={l.id}>
                <LogLine log={l} name={logName(l)} unit={bird.weight_unit} />
                <button className="btn btn-outline" onClick={() => setEditing(l)}>
                  Change
                </button>
                <button className="btn btn-outline" onClick={() => remove(l)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Recent history</h2>
        <Link to={`/weigh/records/${bird.id}`} className="btn btn-outline">
          Weight chart &amp; full records
        </Link>
        {history == null ? (
          <p className="muted">Loading…</p>
        ) : (
          <ul className="log-list">
            {history.map((l) => (
              <li key={l.id}>
                <span className="log-day">{formatDay(l.log_date)}</span>
                <LogLine log={l} name={logName(l)} unit={bird.weight_unit} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LogLine({ log, name, unit }: { log: FeedLog; name: string; unit: WeightUnit }) {
  return (
    <span className="log-line">
      <strong>{log.status === 'weighed' && log.weight_g == null ? 'Food set' : STATUS_TEXT[log.status]}</strong> {formatTime(log.logged_at)} · {name}
      {log.status === 'flown' && log.flight_type && ` · ${flightTypeLabel(log.flight_type)}`}
      {(log.status === 'fed' || log.status === 'weighed' || log.status === 'left') && (log.amount || log.food_type) && ` · ${[log.amount, log.food_type].filter(Boolean).join(' ')}`}
      {log.weight_g != null && ` · ${formatWeight(log.weight_g, unit)}`}
      {log.more_due && (log.more_due_amount ? ` · still to give: ${log.more_due_amount}` : ' · more due')}
      {log.notes && <em> – {log.notes}</em>}
      {log.pending && <span className="pending"> · not sent yet</span>}
    </span>
  );
}
