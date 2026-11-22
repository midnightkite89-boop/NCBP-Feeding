import { useCallback, useEffect, useMemo, useState } from 'react';
import { CENTRE } from '../centre';
import { defaultHazard, sexed, stockList, stockWarnings, type SpeciesInfo, type StockRow } from '../stock';
import { useStore } from '../store';
import { supabase } from '../supabase';

/**
 * The annual stock list in the zoo standards' layout, worked out from when each bird came in and
 * left. IUCN status and hazard category are typed in once per species by an admin.
 */
export function StockList() {
  const { birds, isAdmin, today } = useStore();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [info, setInfo] = useState<SpeciesInfo[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('species_info').select('species, scientific_name, iucn, hazard');
    if (error) setMsg('The species details need a signal to load.');
    setInfo((data as SpeciesInfo[]) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 10mm; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const rows = useMemo(() => stockList(birds, year, info), [birds, year, info]);
  const warnings = useMemo(() => stockWarnings(birds), [birds]);
  const totals = useMemo(() => {
    const sum = (pick: (r: StockRow) => { m: number; f: number; u: number }) =>
      rows.reduce((t, r) => ({ m: t.m + pick(r).m, f: t.f + pick(r).f, u: t.u + pick(r).u }), { m: 0, f: 0, u: 0 });
    return { start: sum((r) => r.start), end: sum((r) => r.end) };
  }, [rows]);

  async function saveSpecies(row: StockRow, patch: Partial<SpeciesInfo>) {
    const next = { species: row.key, scientific_name: row.scientific || null, iucn: row.iucn || null, hazard: row.hazard || defaultHazard(row.common), ...patch };
    const { error } = await supabase.from('species_info').upsert({ ...next, updated_at: new Date().toISOString() });
    if (error) setMsg("Couldn't save – no signal?");
    await load();
  }

  function downloadCsv() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = ['Common name', 'Scientific name', 'IUCN Red List Status', 'Hazard Cat.', `Total on 1st Jan ${year}`, 'Arrived', 'Born', 'Died', 'Departed', `Group on 31 Dec ${year}`];
    const lines = [head, ...rows.map((r) => [r.common, r.scientific, r.iucn, r.hazard, sexed(r.start), sexed(r.arrived), sexed(r.born), sexed(r.died), sexed(r.departed), sexed(r.end)])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.map((l) => l.map(esc).join(',')).join('\r\n')], { type: 'text/csv' }));
    a.download = `${CENTRE.shortName} stock list ${year}.csv`;
    a.click();
  }

  return (
    <div className="stock-page">
      <div className="no-print">
        <h1 className="page-title">Stock list</h1>
        <p className="muted">
          For the zoo standards. Worked out from when each bird came in and left (set on each bird). Counts are males.females.unknown.
          {year === thisYear && ' This year so far: the 31 December column is the group today.'}
        </p>
        <div className="week-nav">
          <button className="btn btn-outline btn-lg" onClick={() => setYear(year - 1)} aria-label="Previous year">
            ◀
          </button>
          <div className="week-title">
            <strong>{year}</strong>
          </div>
          <button className="btn btn-outline btn-lg" onClick={() => setYear(year + 1)} disabled={year >= thisYear} aria-label="Next year">
            ▶
          </button>
        </div>
        {warnings.length > 0 && (
          <ul className="stock-warnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {msg && <p className="warn">{msg}</p>}
        {isAdmin && (
          <div className="bird-actions">
            <button className="btn btn-primary btn-lg" onClick={() => window.print()}>
              Print / save as PDF
            </button>
            <button className="btn btn-outline btn-lg" onClick={downloadCsv}>
              Download spreadsheet
            </button>
          </div>
        )}
      </div>

      <h1 className="print-only stock-print-title">
        {CENTRE.name}: stock list {year}
      </h1>
      <div className="table-wrap">
        <table className="stock-table">
          <thead>
            <tr>
              <th>Common name</th>
              <th>Scientific name</th>
              <th>IUCN Red List Status</th>
              <th>Hazard Cat.</th>
              <th>Total on 1st Jan {year}</th>
              <th>Arrived</th>
              <th>Born</th>
              <th>Died</th>
              <th>Departed</th>
              <th>Group on 31 Dec {year}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.common}</td>
                <td className="stock-sci">
                  {isAdmin ? <SpeciesField value={r.scientific} placeholder="Scientific name" onSave={(v) => saveSpecies(r, { scientific_name: v || null })} /> : r.scientific}
                </td>
                <td>{isAdmin ? <SpeciesField value={r.iucn} placeholder="LC" short onSave={(v) => saveSpecies(r, { iucn: v.toUpperCase() || null })} /> : r.iucn}</td>
                <td>{isAdmin ? <SpeciesField value={r.hazard} placeholder="2" short onSave={(v) => saveSpecies(r, { hazard: v || defaultHazard(r.common) })} /> : r.hazard}</td>
                <td>{sexed(r.start)}</td>
                <td>{sexed(r.arrived)}</td>
                <td>{sexed(r.born)}</td>
                <td>{sexed(r.died)}</td>
                <td>{sexed(r.departed)}</td>
                <td>{sexed(r.end)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4}>All birds</th>
              <th>{sexed(totals.start)}</th>
              <th colSpan={4} />
              <th>{sexed(totals.end)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** A small box that saves when you leave it (admins fill in species details on the list itself) */
function SpeciesField({ value, placeholder, short, onSave }: { value: string; placeholder: string; short?: boolean; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={`stock-input${short ? ' short' : ''}`}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onSave(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      aria-label={placeholder}
    />
  );
}

