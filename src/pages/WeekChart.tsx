import { CENTRE } from '../centre';
import { useEffect, useMemo, useState } from 'react';
import { aviaryLabel, routeSort } from '../aviary';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { addDays, formatDay, isoWeekday } from '../time';
import type { Bird, FeedLog } from '../types';
import { gramsToLbOz } from '../weight';
import { WeighModeTabs } from './Records';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Compact weight for a narrow cell: "1150g" or "5lb 6oz" */
function shortWeight(grams: number, bird: Bird): string {
  if (bird.weight_unit !== 'lb_oz') return `${Math.round(grams * 10) / 10}g`;
  const { lb, oz } = gramsToLbOz(grams);
  return lb > 0 ? `${lb}lb ${oz}oz` : `${oz}oz`;
}

interface Cell {
  weight: string;
  food: string;
}

/**
 * Weekly chart of every bird: days across the top (Mon–Sun), birds down the
 * left by section, a Weight and a Food box for each day. Prints on A4
 * landscape and downloads as a spreadsheet, to replace the paper weight charts.
 */
export function WeekChart() {
  const { birds, aviaries, today, isAdmin } = useStore();
  const thisMonday = addDays(today, -(isoWeekday(today) - 1));
  const [monday, setMonday] = useState(thisMonday);
  const [logs, setLogs] = useState<FeedLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const sunday = days[6];

  useEffect(() => {
    setLogs(null);
    setError(null);
    supabase
      .from('feed_logs')
      .select('bird_id, log_date, logged_at, status, food_type, amount, weight_g')
      .is('voided_at', null)
      .gte('log_date', monday)
      .lte('log_date', sunday)
      .order('logged_at')
      .then(({ data, error }) => {
        if (error) setError('The weekly chart needs a signal to load.');
        setLogs((data as FeedLog[]) ?? []);
      });
  }, [monday, sunday]);

  // Landscape paper while this page is open
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 8mm; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  // Every section once (in the order the round reaches it), its birds in walking order
  const sections = useMemo(() => {
    const ordered = routeSort(
      birds.filter((b) => b.status === 'active' && b.team !== 'aviary'),
      aviaries,
    );
    const sectionOf = (b: Bird) => aviaries.find((a) => a.id === b.aviary_id)?.name ?? 'No aviary';
    const names: string[] = [];
    for (const b of ordered) if (!names.some((n) => n.toLowerCase() === sectionOf(b).toLowerCase())) names.push(sectionOf(b));
    return names.map((title) => ({ key: title, title, birds: ordered.filter((b) => sectionOf(b).toLowerCase() === title.toLowerCase()) }));
  }, [birds, aviaries]);

  // bird id -> date -> what to show
  const cells = useMemo(() => {
    const map = new Map<string, Map<string, Cell>>();
    const byBird = new Map(birds.map((b) => [b.id, b]));
    const grouped = new Map<string, FeedLog[]>();
    for (const l of logs ?? []) {
      const k = `${l.bird_id}|${l.log_date}`;
      grouped.set(k, [...(grouped.get(k) ?? []), l]);
    }
    for (const [k, list] of grouped) {
      const [birdId, date] = k.split('|');
      const bird = byBird.get(birdId);
      if (!bird) continue;
      const weights = list.filter((l) => l.weight_g != null).map((l) => shortWeight(l.weight_g as number, bird));
      const fed = list.filter((l) => l.status === 'fed').map((l) => [l.amount, l.food_type].filter(Boolean).join(' ') || 'Fed');
      const fasting = list.some((l) => l.status === 'fasting');
      const food = [...(fasting ? ['Fast'] : []), ...fed].join(' + ');
      if (!map.has(birdId)) map.set(birdId, new Map());
      map.get(birdId)!.set(date, { weight: weights.join(' / '), food });
    }
    return map;
  }, [logs, birds]);

  function downloadCsv() {
    if (!isAdmin) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const head1 = ['Bird', 'Aviary', ...days.flatMap((d) => [formatDay(d), ''])];
    const head2 = ['', '', ...days.flatMap(() => ['Weight', 'Food'])];
    const rows: string[][] = [head1, head2];
    for (const s of sections) {
      rows.push([s.title.toUpperCase()]);
      for (const b of s.birds) {
        const a = aviaries.find((x) => x.id === b.aviary_id);
        rows.push([b.name, a ? aviaryLabel(a) : '', ...days.flatMap((d) => [cells.get(b.id)?.get(d)?.weight ?? '', cells.get(b.id)?.get(d)?.food ?? ''])]);
      }
    }
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `${CENTRE.shortName} weekly chart w-c ${monday}.csv`;
    a.click();
  }

  return (
    <div className={`week-page${isAdmin ? '' : ' no-print-staff'}`}>
      <p className="print-staff-note">Printing the weekly chart is for the admin only.</p>
      <div className="no-print">
        <WeighModeTabs mode="week" />
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
        {/* Printing and downloads are for the admin only */}
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

      <h1 className="print-only week-print-title">{CENTRE.name} – weights &amp; feeding, week commencing {formatDay(monday)}</h1>

      {logs == null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="table-wrap week-wrap">
          <table className="week-table">
            <thead>
              <tr>
                <th rowSpan={2} className="week-bird">
                  Bird
                </th>
                {days.map((d, i) => (
                  <th key={d} colSpan={2} className={`week-day${d === today ? ' week-today' : ''}`}>
                    {DAY_NAMES[i]} {formatDay(d).split(' ').slice(1).join(' ')}
                  </th>
                ))}
              </tr>
              <tr>
                {days.map((d) => (
                  <WeightFoodHead key={d} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => (
                <SectionRows key={s.key} title={s.title} birds={s.birds} days={days} cells={cells} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WeightFoodHead() {
  return (
    <>
      <th className="week-sub">Weight</th>
      <th className="week-sub week-food-col">Food</th>
    </>
  );
}

function SectionRows({ title, birds, days, cells }: { title: string; birds: Bird[]; days: string[]; cells: Map<string, Map<string, Cell>> }) {
  const { aviaries } = useStore();
  return (
    <>
      <tr className="week-section">
        <th colSpan={15}>{title}</th>
      </tr>
      {birds.map((b) => {
        const a = aviaries.find((x) => x.id === b.aviary_id);
        return (
          <tr key={b.id}>
            <th className="week-bird">
              {b.name}
              {a?.number != null && <span className="week-num"> {a.number}</span>}
            </th>
            {days.map((d) => {
              const c = cells.get(b.id)?.get(d);
              return (
                <WeekCells key={d} cell={c} />
              );
            })}
          </tr>
        );
      })}
    </>
  );
}

function WeekCells({ cell }: { cell?: Cell }) {
  return (
    <>
      <td className="week-w">{cell?.weight}</td>
      <td className="week-f">{cell?.food}</td>
    </>
  );
}
