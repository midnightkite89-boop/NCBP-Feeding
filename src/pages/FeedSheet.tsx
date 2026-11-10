import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aviaryLabel, feedStops, routeSort } from '../aviary';
import { birdsLabel } from '../components/AviaryStop';
import { CENTRE } from '../centre';
import { sumFeeds } from '../food';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { addDays, formatDay, isoWeekday } from '../time';
import type { Bird, FeedLog } from '../types';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Cell {
  fed: string;
  left: string;
}

/** Birds on the barn sheets: aviary (breeding) birds and flying birds resting off the team */
const onSheet = (b: Bird) => b.status === 'active' && (b.team === 'aviary' || b.team === 'resting');

/**
 * Weekly feed sheet for one barn: aviaries down the left (a shared aviary is one row),
 * days across the top, what was fed and what was left each day. Filled in from the
 * taps on the round; prints on A4 landscape, one barn per page, and downloads as a spreadsheet.
 */
export function FeedSheet() {
  const { section: sectionParam } = useParams();
  const { birds, aviaries, today, isAdmin } = useStore();
  const thisMonday = addDays(today, -(isoWeekday(today) - 1));
  const [monday, setMonday] = useState(thisMonday);
  const [logs, setLogs] = useState<FeedLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);

  useEffect(() => {
    setLogs(null);
    setError(null);
    supabase
      .from('feed_logs')
      .select('bird_id, log_date, logged_at, status, food_type, amount')
      .in('status', ['fed', 'left', 'fasting'])
      .is('voided_at', null)
      .gte('log_date', monday)
      .lte('log_date', days[6])
      .order('logged_at')
      .then(({ data, error }) => {
        if (error) setError('The feed sheet needs a signal to load.');
        setLogs((data as FeedLog[]) ?? []);
      });
  }, [monday, days]);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 8mm; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // Barns with birds on the sheets, in round order; each barn's rows are its feeding stops
  const barns = useMemo(() => {
    const ordered = routeSort(birds.filter(onSheet), aviaries);
    const sectionOf = (b: Bird) => aviaries.find((a) => a.id === b.aviary_id)?.name ?? 'No aviary';
    const names: string[] = [];
    for (const b of ordered) if (!names.includes(sectionOf(b))) names.push(sectionOf(b));
    return names.map((name) => ({ name, stops: feedStops(ordered.filter((b) => sectionOf(b) === name)) }));
  }, [birds, aviaries]);

  const chosen = sectionParam ? barns.filter((b) => b.name.toLowerCase() === sectionParam.toLowerCase()) : barns;

  // first bird id of a stop -> date -> fed / left for the whole stop
  const cells = useMemo(() => {
    const map = new Map<string, Map<string, Cell>>();
    for (const barn of barns)
      for (const stop of barn.stops) {
        const ids = new Set(stop.map((b) => b.id));
        const byDay = new Map<string, Cell>();
        for (const d of days) {
          const dayLogs = (logs ?? []).filter((l) => l.log_date === d && ids.has(l.bird_id));
          const fed = sumFeeds(dayLogs.filter((l) => l.status === 'fed'));
          const fasting = dayLogs.some((l) => l.status === 'fasting') && !fed;
          byDay.set(d, { fed: fasting ? 'Fast' : fed, left: sumFeeds(dayLogs.filter((l) => l.status === 'left')) });
        }
        map.set(stop[0].id, byDay);
      }
    return map;
  }, [logs, barns, days]);

  const rowName = (stop: Bird[]) => {
    const a = aviaries.find((x) => x.id === stop[0].aviary_id);
    const who = stop.length > 1 ? birdsLabel(stop) : stop[0].name;
    return { aviary: a ? aviaryLabel(a) : '', who, resting: stop.length === 1 && stop[0].team === 'resting' };
  };

  function downloadCsv() {
    if (!isAdmin) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows: string[][] = [
      ['Aviary', 'Birds', ...days.flatMap((d) => [formatDay(d), ''])],
      ['', '', ...days.flatMap(() => ['Fed', 'Left'])],
    ];
    for (const barn of chosen) {
      rows.push([barn.name.toUpperCase()]);
      for (const stop of barn.stops) {
        const n = rowName(stop);
        rows.push([n.aviary, n.who, ...days.flatMap((d) => [cells.get(stop[0].id)?.get(d)?.fed ?? '', cells.get(stop[0].id)?.get(d)?.left ?? ''])]);
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `${CENTRE.shortName} feed sheet ${sectionParam ?? 'all barns'} w-c ${monday}.csv`;
    a.click();
  }

  return (
    <div className={`week-page${isAdmin ? '' : ' no-print-staff'}`}>
      <p className="print-staff-note">Printing the feed sheets is for the admin only.</p>
      <div className="no-print">
        <h1 className="page-title">Feed sheets</h1>
        <p className="muted">Fed and left each day, for breeding and aviary birds and flying birds that are resting. Filled in from the round.</p>
        <div className="chip-row">
          <Link to="/feed-sheet" className={`btn btn-outline${!sectionParam ? ' on' : ''}`}>
            All barns
          </Link>
          {barns.map((b) => (
            <Link key={b.name} to={`/feed-sheet/${encodeURIComponent(b.name.toLowerCase())}`} className={`btn btn-outline${sectionParam?.toLowerCase() === b.name.toLowerCase() ? ' on' : ''}`}>
              {b.name}
            </Link>
          ))}
        </div>
        <div className="week-nav">
          <button className="btn btn-outline btn-lg" onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">
            ◀
          </button>
          <div className="week-title">
            <strong>Week commencing {formatDay(monday)}</strong>
            {monday === thisMonday && <span className="muted"> · this week</span>}
          </div>
          <button className="btn btn-outline btn-lg" onClick={() => setMonday(addDays(monday, 7))} disabled={monday >= thisMonday} aria-label="Next week">
            ▶
          </button>
        </div>
        {isAdmin && (
          <div className="bird-actions">
            <button className="btn btn-primary btn-lg" onClick={() => window.print()} disabled={logs == null}>
              Print / save as PDF
            </button>
            <button className="btn btn-outline btn-lg" onClick={downloadCsv} disabled={logs == null}>
              Download spreadsheet
            </button>
          </div>
        )}
        {error && <p className="warn">{error}</p>}
      </div>

      {logs == null ? (
        <p className="muted">Loading…</p>
      ) : chosen.length === 0 ? (
        <p className="empty">No breeding, aviary or resting birds here.</p>
      ) : (
        chosen.map((barn) => (
          <section key={barn.name} className="feed-sheet">
            <h2 className="feed-sheet-title">
              {barn.name}
              <span className="print-only"> – {CENTRE.name} feed sheet, week commencing {formatDay(monday)}</span>
            </h2>
            <div className="table-wrap week-wrap">
              <table className="week-table">
                <thead>
                  <tr>
                    <th rowSpan={2} className="week-bird">
                      Aviary
                    </th>
                    {days.map((d, i) => (
                      <th key={d} colSpan={2} className={`week-day${d === today ? ' week-today' : ''}`}>
                        {DAY_NAMES[i]} {formatDay(d).split(' ').slice(1).join(' ')}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {days.map((d) => (
                      <FedLeftHead key={d} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {barn.stops.map((stop) => {
                    const n = rowName(stop);
                    return (
                      <tr key={stop[0].id}>
                        <th className="week-bird">
                          {n.aviary}
                          <div className="week-num">
                            {n.who}
                            {n.resting && ' (resting)'}
                          </div>
                        </th>
                        {days.map((d) => {
                          const c = cells.get(stop[0].id)?.get(d);
                          return (
                            <FedLeftCells key={d} cell={c} />
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function FedLeftHead() {
  return (
    <>
      <th className="week-sub week-food-col">Fed</th>
      <th className="week-sub">Left</th>
    </>
  );
}

function FedLeftCells({ cell }: { cell?: Cell }) {
  return (
    <>
      <td className="week-f">{cell?.fed}</td>
      <td className={`week-left${cell?.left ? ' has-left' : ''}`}>{cell?.left}</td>
    </>
  );
}
