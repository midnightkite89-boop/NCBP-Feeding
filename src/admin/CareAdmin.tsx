import { useState } from 'react';
import { aviaryLabel, compareAviaries } from '../aviary';
import { isDailySection } from '../care';
import { WEEKDAYS } from '../time';
import { useStore } from '../store';
import { supabase } from '../supabase';
import type { Aviary, CareSettings } from '../types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** Cleaning timings, products, winter dates, frost level and cold spots */
export function CareAdmin() {
  const { careSettings, aviaries, refresh } = useStore();
  const [form, setForm] = useState<CareSettings>(careSettings);
  const [sections, setSections] = useState(careSettings.daily_sections.join(', '));
  const [products, setProducts] = useState(careSettings.products.join(', '));
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof CareSettings>(k: K, v: CareSettings[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Sections that have aviaries, in a stable order
  const sectionNames = [...new Set(aviaries.filter((a) => !a.archived).map((a) => a.name))].sort((a, b) => a.localeCompare(b));
  const weeklySections = sectionNames.filter((n) => !isDailySection(n, { ...form, daily_sections: list(sections) }));
  const [rules, setRules] = useState<Record<string, { due: string; overdue: string }>>(() =>
    Object.fromEntries(Object.entries(careSettings.section_rules ?? {}).map(([k, v]) => [k, { due: String(v.due), overdue: String(v.overdue) }])),
  );

  function toggleRota(day: number, section: string) {
    const cur = form.rota?.[String(day)] ?? [];
    const next = cur.includes(section) ? cur.filter((x) => x !== section) : [...cur, section];
    set('rota', { ...form.rota, [String(day)]: next });
  }

  async function save() {
    if (form.clean_overdue_days <= form.clean_due_days) return setMsg('"Overdue after" must be more days than "Due after".');
    const section_rules: CareSettings['section_rules'] = {};
    for (const [name, r] of Object.entries(rules)) {
      if (!r.due.trim() && !r.overdue.trim()) continue;
      const due = Number(r.due) || form.clean_due_days;
      const overdue = Number(r.overdue) || Math.max(due + 1, form.clean_overdue_days);
      if (overdue <= due) return setMsg(`${name}: "overdue" must be more days than "due".`);
      section_rules[name] = { due, overdue };
    }
    const rota = Object.fromEntries(Object.entries(form.rota ?? {}).filter(([, v]) => v.length > 0));
    const row = { ...form, daily_sections: list(sections), products: list(products), section_rules, rota };
    const { error } = await supabase.from('care_settings').update(row).eq('id', 1);
    setMsg(error ? error.message : 'Saved.');
    await refresh();
  }

  return (
    <div>
      <h1 className="page-title">Cleaning &amp; winter</h1>

      <fieldset className="panel">
        <legend>Aviary cleaning</legend>
        <div className="field-row">
          <label className="field">
            <span>Due after (days)</span>
            <input inputMode="numeric" value={form.clean_due_days} onChange={(e) => set('clean_due_days', Number(e.target.value) || 1)} />
          </label>
          <label className="field">
            <span>Overdue after (days)</span>
            <input inputMode="numeric" value={form.clean_overdue_days} onChange={(e) => set('clean_overdue_days', Number(e.target.value) || 2)} />
          </label>
        </div>
        <label className="field">
          <span>
            Cleaned daily as one area <small>sections, separated by commas</small>
          </span>
          <input value={sections} onChange={(e) => setSections(e.target.value)} placeholder="Mews" />
        </label>
        <label className="field">
          <span>
            Disinfectants <small>first one is the default</small>
          </span>
          <input value={products} onChange={(e) => setProducts(e.target.value)} placeholder="F10" />
        </label>
      </fieldset>

      <fieldset className="panel">
        <legend>Alerts</legend>
        <p className="muted">The red number on the Clean tab and the cleaning chip on Today.</p>
        <div className="segmented-chips">
          {(
            [
              ['off', 'Off'],
              ['quiet', 'Overdue aviaries only'],
              ['full', 'Everything (baths, Mews, today’s list)'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" className={`pick-chip${(form.alert_level ?? 'quiet') === value ? ' on' : ''}`} aria-pressed={(form.alert_level ?? 'quiet') === value} onClick={() => set('alert_level', value)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel">
        <legend>Timings per section</legend>
        <p className="muted">Leave blank to use the defaults above ({form.clean_due_days} and {form.clean_overdue_days} days). Single aviaries can have their own timings further down.</p>
        {weeklySections.map((name) => (
          <div className="field-row section-rule" key={name}>
            <strong>{name}</strong>
            <label className="field">
              <span>Due after</span>
              <input inputMode="numeric" value={rules[name]?.due ?? ''} placeholder={String(form.clean_due_days)} onChange={(e) => setRules((r) => ({ ...r, [name]: { due: e.target.value, overdue: r[name]?.overdue ?? '' } }))} />
            </label>
            <label className="field">
              <span>Overdue after</span>
              <input inputMode="numeric" value={rules[name]?.overdue ?? ''} placeholder={String(form.clean_overdue_days)} onChange={(e) => setRules((r) => ({ ...r, [name]: { due: r[name]?.due ?? '', overdue: e.target.value } }))} />
            </label>
          </div>
        ))}
      </fieldset>

      <fieldset className="panel">
        <legend>Baths</legend>
        <p className="muted">A bath shows amber on the day it's due and red the day after. Ticking "Bath" when cleaning an aviary counts as cleaned and checked.</p>
        <div className="field-row">
          <label className="field">
            <span>Check every (days)</span>
            <input inputMode="numeric" value={form.bath_check_days} onChange={(e) => set('bath_check_days', Number(e.target.value) || 1)} />
          </label>
          <label className="field">
            <span>Clean every (days)</span>
            <input inputMode="numeric" value={form.bath_clean_days} onChange={(e) => set('bath_clean_days', Number(e.target.value) || 1)} />
          </label>
        </div>
        <p className="muted">Aviaries without a bath can be unticked in the list at the bottom.</p>
      </fieldset>

      <fieldset className="panel">
        <legend>Today's cleaning list</legend>
        <label className="field">
          <span>"Suggest" adds this many aviaries</span>
          <input inputMode="numeric" value={form.suggest_count} onChange={(e) => set('suggest_count', Number(e.target.value) || 1)} />
        </label>
        <div className="field">
          <span>Rota: sections to clean each day (optional)</span>
          <p className="muted">Ticked sections go on that day's list automatically. Leave it empty until the rota is agreed.</p>
          {WEEKDAYS.map((day, i) => (
            <div className="rota-day" key={day}>
              <strong>{day}</strong>
              <div className="pick-grid">
                {weeklySections.map((name) => {
                  const on = (form.rota?.[String(i + 1)] ?? []).includes(name);
                  return (
                    <button key={name} type="button" className={`pick-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => toggleRota(i + 1, name)}>
                      {on ? '✓ ' : ''}
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel">
        <legend>Winter</legend>
        <p className="muted">During winter the Clean tab asks for baths to be taken in at night and put back out in the morning.</p>
        <MonthDay label="Winter starts" value={form.winter_start} onChange={(v) => set('winter_start', v)} />
        <MonthDay label="Winter ends" value={form.winter_end} onChange={(v) => set('winter_end', v)} />
        <label className="field">
          <span>Frost warning when tonight's low is at or below (°C)</span>
          <input inputMode="decimal" value={form.frost_below} onChange={(e) => set('frost_below', Number(e.target.value.replace(',', '.')) || 0)} />
        </label>
      </fieldset>

      {msg && <p className={msg === 'Saved.' ? 'muted' : 'warn'}>{msg}</p>}
      <button className="btn btn-primary btn-xl" onClick={save}>
        Save settings
      </button>

      <h2 className="qr-preview-title">Each aviary</h2>
      <p className="muted">
        <strong>Bath</strong>: untick if the aviary has no bath. <strong>Cold spot</strong>: listed in the frost warning so it gets checked on cold nights. <strong>Own timings</strong>: overrides the section.
      </p>
      <ul className="admin-list">
        {aviaries
          .filter((a) => !a.archived)
          .sort(compareAviaries)
          .map((a) => (
            <AviaryCareRow key={a.id} aviary={a} onSaved={refresh} />
          ))}
      </ul>
    </div>
  );
}

function MonthDay({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [m, d] = value.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="field">
      <span>{label}</span>
      <div className="field-row">
        <select value={d} onChange={(e) => onChange(`${pad(m)}-${pad(Number(e.target.value))}`)} aria-label={`${label} day`}>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
        <select value={m} onChange={(e) => onChange(`${pad(Number(e.target.value))}-${pad(d)}`)} aria-label={`${label} month`}>
          {MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AviaryCareRow({ aviary, onSaved }: { aviary: Aviary; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState(aviary.cold_note ?? '');
  const [due, setDue] = useState(aviary.clean_due_days?.toString() ?? '');
  const [overdue, setOverdue] = useState(aviary.clean_overdue_days?.toString() ?? '');
  const [err, setErr] = useState<string | null>(null);
  async function save(changes: Partial<Aviary>) {
    const { error } = await supabase.from('aviaries').update(changes).eq('id', aviary.id);
    setErr(error ? error.message : null);
    await onSaved();
  }
  function saveTimings() {
    const d = due.trim() ? Number(due) : null;
    const o = overdue.trim() ? Number(overdue) : null;
    if (d != null && o != null && o <= d) return setErr('Overdue must be more days than due.');
    if (d !== (aviary.clean_due_days ?? null) || o !== (aviary.clean_overdue_days ?? null)) void save({ clean_due_days: d || null, clean_overdue_days: o || null });
  }
  return (
    <li className="cold-row aviary-care-row">
      <strong>{aviaryLabel(aviary)}</strong>
      <label className="check">
        <input type="checkbox" checked={aviary.has_bath !== false} onChange={(e) => save({ has_bath: e.target.checked })} />
        <span>Bath</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={!!aviary.cold_spot} onChange={(e) => save({ cold_spot: e.target.checked })} />
        <span>Cold spot</span>
      </label>
      <span className="own-timings">
        <input inputMode="numeric" value={due} placeholder="due" aria-label={`${aviaryLabel(aviary)} due after days`} onChange={(e) => setDue(e.target.value)} onBlur={saveTimings} />
        <input inputMode="numeric" value={overdue} placeholder="overdue" aria-label={`${aviaryLabel(aviary)} overdue after days`} onChange={(e) => setOverdue(e.target.value)} onBlur={saveTimings} />
      </span>
      {err && <span className="warn">{err}</span>}
      {aviary.cold_spot && (
        <input
          className="cold-note-input"
          value={note}
          placeholder="Note, e.g. exposed corner"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== (aviary.cold_note ?? '') && save({ cold_note: note.trim() || null })}
        />
      )}
    </li>
  );
}
