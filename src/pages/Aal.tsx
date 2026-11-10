import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aviaryLabel } from '../aviary';
import type { Outing } from '../outings';
import { defaultFeedLabel } from '../status';
import { GUIDANCE, R5_ITEMS } from '../aalText';
import { BlankRows, Dot, DotLine, FormSheet, dmy } from './aalForm';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { WEEKDAYS, addDays, formatDay, formatTime, isoWeekday } from '../time';
import type { Bird, CareLog, HealthEntry, HealthIssue, Medication } from '../types';

// The Animal Activity Licence records, built from what's in the app. Field names
// and headings follow SMJ's R1–R4 forms. On screen admins can fill the blanks;
// printed, the boxes become plain text.

interface VetDetails {
  name?: string;
  address?: string;
  phone?: string;
  emergency?: string;
  email?: string;
  miles?: string;
  hours?: Record<string, { open?: string; times?: string; emergency?: string }>;
  notes?: string;
}
interface AalSettings {
  owner: string;
  local_authority: string | null;
  vet: VetDetails;
  r5?: { date?: string; answers?: Record<string, { yn?: string; action?: string }> };
}

const SETTINGS_KEY = 'smj-aal-settings';
const DEFAULT_SETTINGS: AalSettings = { owner: 'SMJ Falconry & Crafts', local_authority: null, vet: {} };

function cacheSettings(s: AalSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked */
  }
}

/** Remembered on the phone, so the vet's details still open with no signal */
function useAalSettings() {
  const [settings, setSettings] = useState<AalSettings | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as AalSettings | null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const giveUp = setTimeout(() => setSettings((s) => s ?? DEFAULT_SETTINGS), 4000);
    supabase
      .from('aal_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error: e }) => {
        clearTimeout(giveUp);
        if (e && !/fetch|network|load failed/i.test(e.message)) setError(e.message);
        if (data) {
          setSettings(data as AalSettings);
          cacheSettings(data as AalSettings);
        } else {
          setSettings((s) => s ?? DEFAULT_SETTINGS);
        }
      });
    return () => clearTimeout(giveUp);
  }, []);
  async function save(changes: Partial<AalSettings>) {
    setSettings((s) => {
      if (!s) return s;
      const next = { ...s, ...changes };
      cacheSettings(next);
      return next;
    });
    const { error: e } = await supabase.from('aal_settings').update(changes).eq('id', 1);
    setError(e?.message ?? null);
  }
  return { settings, save, error };
}

/** A box on screen, plain text on paper. Saves when you leave it. */
function Editable({ value, onSave, multiline, placeholder, canEdit = true, label }: { value: string | null | undefined; onSave: (v: string | null) => void; multiline?: boolean; placeholder?: string; canEdit?: boolean; label: string }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const commit = () => {
    const v = text.trim() || null;
    if (v !== (value ?? null)) onSave(v);
  };
  if (!canEdit) return <span>{value}</span>;
  return (
    <>
      {multiline ? (
        <textarea className="aal-box no-print" rows={2} value={text} placeholder={placeholder} aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      ) : (
        <input className="aal-box no-print" value={text} placeholder={placeholder} aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      )}
      <span className="aal-print">{text}</span>
    </>
  );
}

function YesNo({ value, onSave, label }: { value: string | null | undefined; onSave: (v: string | null) => void; label: string }) {
  return (
    <>
      <select className="aal-box no-print" value={value ?? ''} aria-label={label} onChange={(e) => onSave(e.target.value || null)}>
        <option value="" />
        <option>Yes</option>
        <option>No</option>
      </select>
      <span className="aal-print">{value}</span>
    </>
  );
}

export function PrintBar({ back = '/aal', children }: { back?: string; children?: React.ReactNode }) {
  return (
    <div className="no-print aal-bar">
      <Link to={back} className="btn btn-outline">
        ‹ Back
      </Link>
      {children}
      <button className="btn btn-primary" onClick={() => window.print()}>
        Print
      </button>
    </div>
  );
}

const typeOf = (b: Bird) => [b.species, b.scientific_name ? `(${b.scientific_name})` : ''].filter(Boolean).join(' ');

// ---------------------------------------------------------------------------

export function AalHome() {
  return (
    <div className="more-page">
      <h1 className="page-title">Records (AAL)</h1>
      <p className="muted">Built from what's logged in the app. Open one to check it, fill any blanks, and print.</p>
      <ul className="aal-links">
        <li>
          <Link to="/aal/r1">
            <strong>R1</strong> Licensable Raptors Register
          </Link>
        </li>
        <li>
          <Link to="/aal/r2">
            <strong>R2</strong> Individual Raptor Records
          </Link>
        </li>
        <li>
          <Link to="/aal/r3">
            <strong>R3</strong> Daily Inspection Record
          </Link>
        </li>
        <li>
          <Link to="/aal/r4">
            <strong>R4</strong> Veterinary Contact Details
          </Link>
        </li>
        <li>
          <Link to="/aal/r5">
            <strong>R5</strong> Accommodation Self-Assessment
          </Link>
        </li>
        <li>
          <Link to="/outings">
            <strong>R6, R7, R8</strong> Outings
          </Link>
        </li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// R1
// ---------------------------------------------------------------------------

async function saveBird(id: string, changes: Partial<Bird>, refresh: () => Promise<void>, onError: (m: string | null) => void) {
  const { error } = await supabase.from('birds').update(changes).eq('id', id);
  onError(error?.message ?? null);
  await refresh();
}

export function R1Page() {
  const { birds, today, refresh } = useStore();
  const { settings, save, error } = useAalSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [bulk, setBulk] = useState('');
  const active = useMemo(() => birds.filter((b) => b.status === 'active').sort((a, b) => a.name.localeCompare(b.name)), [birds]);
  const blanks = active.filter((b) => !b.used_for);
  const noRing = active.filter((b) => !b.ring_microchip);

  async function fillBlanks() {
    if (!bulk.trim() || blanks.length === 0) return;
    const { error: e } = await supabase.from('birds').update({ used_for: bulk.trim() }).in('id', blanks.map((b) => b.id));
    setSaveError(e?.message ?? null);
    setBulk('');
    await refresh();
  }

  return (
    <div className="aal-page">
      <PrintBar />
      {(error || saveError) && <p className="warn no-print">{error || saveError}</p>}
      {blanks.length > 0 && (
        <div className="panel no-print aal-bulk">
          <label className="field">
            <span>
              {blanks.length} bird{blanks.length === 1 ? ' has' : 's have'} no "Use" yet. Fill them all with:
            </span>
            <input value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="e.g. Experience days, displays & schools" />
          </label>
          <button className="btn btn-outline" disabled={!bulk.trim()} onClick={fillBlanks}>
            Fill blanks
          </button>
        </div>
      )}
      {noRing.length > 0 && <p className="warn no-print">No ring or microchip number: {noRing.map((b) => b.name).join(', ')}</p>}

      <FormSheet title="R1: LICENSABLE RAPTORS REGISTER" meta={[`Date created: ${dmy(today)}`, `Owner: ${settings?.owner ?? ''}`, 'Retention period: 3 years']} guidance={GUIDANCE.r1}>
      <h2 className="aal-h">Local authority contact details</h2>
      <p className="form-dotted">{settings && <Editable label="Local authority contact details" value={settings.local_authority} onSave={(v) => save({ local_authority: v })} placeholder="Council, contact, phone" />}</p>
      <p className="form-centre">
        Full details for each raptor can be found in its own <strong><em>Individual Raptor Record</em></strong>.
      </p>
      <table className="aal-table">
        <thead>
          <tr>
            <th className="aal-n" />
            <th>Type</th>
            <th>Given name</th>
            <th>Ring and/or microchip number</th>
            <th className="aal-use">Use</th>
          </tr>
        </thead>
        <tbody>
          {active.map((b, i) => (
            <tr key={b.id}>
              <td className="aal-n">{i + 1}</td>
              <td>{typeOf(b)}</td>
              <td>{b.name}</td>
              <td>{b.ring_microchip}</td>
              <td>
                <Editable label={`${b.name} use`} value={b.used_for} onSave={(v) => saveBird(b.id, { used_for: v }, refresh, setSaveError)} />
              </td>
            </tr>
          ))}
          <BlankRows have={active.length} upTo={10} cols={5} numbered />
        </tbody>
      </table>
      <DotLine><Dot label="Signed by Licence Holder" wide /></DotLine>
      <DotLine><Dot label="Date provided to Local Authority" wide /></DotLine>
      </FormSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// R2
// ---------------------------------------------------------------------------

export function R2List() {
  const { birds, aviaries } = useStore();
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const list = birds
    .filter((b) => !t || b.name.toLowerCase().includes(t) || (b.species ?? '').toLowerCase().includes(t))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1));
  return (
    <div className="more-page">
      <div className="no-print aal-bar">
        <Link to="/aal" className="btn btn-outline">
          ‹ Back
        </Link>
      </div>
      <h1 className="page-title">R2: Individual Raptor Records</h1>
      <div className="search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a bird" aria-label="Find a bird" />
      </div>
      <ul className="flight-list">
        {list.map((b) => {
          const av = aviaries.find((a) => a.id === b.aviary_id);
          return (
            <li key={b.id}>
              <Link to={`/aal/r2/${b.id}`} className="flight-item">
                <span className="flight-main">
                  <span>
                    <strong>{b.name}</strong> · {b.species}
                  </span>
                  <span className="meta">
                    {b.status === 'archived' ? (b.died_on ? `Died ${formatDay(b.died_on)}` : 'Archived') : av ? aviaryLabel(av) : ''}
                  </span>
                </span>
                <span className="more-chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const yn = (v: unknown) => (v ? 'Yes' : 'No');

const SOLD_QUESTIONS = [
  'Was the raptor undergoing medical treatment at the time of sale? (Note: Raptors must not be sold as a pet whilst undergoing medical treatment)',
  'Were medical records for this raptor made available to the purchaser before the sale?',
  'Was the raptor suffering any known abnormality?',
  'Was the animal advertised?',
  'Did the advertising comply with Condition 2.3 of Part B Specific Conditions – selling animals as pets?',
  'Was any equipment / accessories / food etc sold or supplied along with the raptor?',
  'If yes, was it suitable for the individual raptor?',
  'Was written advice given regarding accommodation size and design?',
  'Was written advice provided on: feeding, housing, handling, husbandry, life expectancy, the provision of suitable accessories, veterinary care, care during transport and initial care at home?',
  'Was written information provided on the country of origin of the raptor, its species, and on age, sex and veterinary record of the animal?',
  'Was the raptor capable of feeding itself on the date of sale?',
  'Was a suitable container provided?',
  "If no, was the purchaser's container examined for suitability before the sale?",
];

export function R2Page() {
  const { id = '' } = useParams();
  const { birds, refresh } = useStore();
  const bird = birds.find((b) => b.id === id);
  const [error, setError] = useState<string | null>(null);
  const [concerns, setConcerns] = useState<CareLog[]>([]);
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [flights, setFlights] = useState<number | null>(null);
  const [outingNotes, setOutingNotes] = useState<{ date: string; issue: string; action: string }[]>([]);
  const { today } = useStore();

  useEffect(() => {
    supabase.from('care_logs').select('*').eq('bird_id', id).eq('concern', true).is('voided_at', null).order('logged_at').then(({ data }) => setConcerns((data ?? []) as CareLog[]));
    supabase.from('health_issues').select('*').eq('bird_id', id).is('voided_at', null).order('started_on').then(({ data }) => setIssues((data ?? []) as HealthIssue[]));
    supabase.from('health_entries').select('*').eq('bird_id', id).is('voided_at', null).order('logged_at').then(({ data }) => setEntries((data ?? []) as HealthEntry[]));
    supabase.from('medications').select('*').eq('bird_id', id).is('voided_at', null).order('start_date').then(({ data }) => setMeds((data ?? []) as Medication[]));
    supabase
      .from('feed_logs')
      .select('id', { count: 'exact', head: true })
      .eq('bird_id', id)
      .eq('status', 'flown')
      .is('voided_at', null)
      .gte('log_date', addDays(today, -30))
      .then(({ count }) => setFlights(count ?? 0));
    // R6 says a behaviour or injury note on an outing is copied to this record
    supabase
      .from('outings')
      .select('venue, start_date, details')
      .is('voided_at', null)
      .then(({ data }) => {
        const rows = (data ?? []) as Pick<Outing, 'venue' | 'start_date' | 'details'>[];
        setOutingNotes(
          rows.flatMap((o) => {
            const note = o.details.birds?.find((b) => b.bird_id === id)?.note;
            return note ? [{ date: o.start_date, issue: note, action: `Noted on outing to ${o.venue}` }] : [];
          }),
        );
      });
  }, [id, today]);

  if (!bird) return <p className="empty">Loading…</p>;
  const set = (k: keyof Bird) => (v: string | null) => saveBird(bird.id, { [k]: v } as Partial<Bird>, refresh, setError);
  const housedAlone = bird.housed_alone ?? (bird.aviary_id ? (birds.filter((b) => b.status === 'active' && b.aviary_id === bird.aviary_id).length === 1 ? 'Yes' : 'No') : null);
  const usualFeed = [defaultFeedLabel(bird), `${bird.feeds_per_day} feed${bird.feeds_per_day === 1 ? '' : 's'} a day`, bird.fast_days.length ? `fast days: ${bird.fast_days.map((d) => WEEKDAYS[d - 1]).join(', ')}` : ''].filter(Boolean).join(' · ');
  const hatch = bird.hatch_date ?? (bird.hatch_year ? String(bird.hatch_year) : null);

  // Observation record: concerns from daily checks, then health issues
  const observations = [
    ...concerns.map((c) => ({ date: c.log_date, issue: c.notes ?? '', action: c.resolution ?? (c.resolved_at ? 'Resolved' : 'Open') })),
    ...issues.map((i) => {
      const own = entries.filter((e) => e.issue_id === i.id);
      const notes = own.map((e) => e.notes).filter(Boolean)[0];
      const actions = own.map((e) => (e.action ? `${formatDay(e.log_date)}: ${e.action}` : '')).filter(Boolean);
      return { date: i.started_on, issue: [i.title, notes].filter(Boolean).join(': '), action: [...actions, i.closed_at ? `Closed: ${i.outcome ?? 'resolved'}` : 'Ongoing'].join('; ') };
    }),
    ...outingNotes,
  ].sort((a, b) => a.date.localeCompare(b.date));

  const row = (label: string, answer: React.ReactNode, details: React.ReactNode) => (
    <tr>
      <th>{label}</th>
      <td className="aal-yn">{answer}</td>
      <td>{details}</td>
    </tr>
  );

  return (
    <div className="aal-page">
      <PrintBar back="/aal/r2" />
      {error && <p className="warn no-print">{error}</p>}
      <FormSheet title="R2: INDIVIDUAL RAPTOR RECORD" meta={[`Date created: ${dmy(today)}`, 'Owner: SMJ Falconry & Crafts', 'Retention period: 3 years']} guidance={GUIDANCE.r2}>
      <h2 className="aal-h">Details for this individual raptor</h2>
      <p className="form-hint">This should match that submitted to the Local Authority on the Licensable Raptors Register</p>
      <table className="aal-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Given name</th>
            <th>Ring and/or microchip number</th>
            <th>A10 certificate</th>
            <th>Used for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{typeOf(bird)}</td>
            <td>{bird.name}</td>
            <td>
              <Editable label="Ring or microchip" value={bird.ring_microchip} onSave={set('ring_microchip')} />
            </td>
            <td>
              <Editable label="Article 10 certificate" value={bird.a10_cert} onSave={set('a10_cert')} />
            </td>
            <td>
              <Editable label="Used for" value={bird.used_for} onSave={set('used_for')} />
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="aal-h">General information</h2>
      <table className="aal-table aal-rows">
        <thead>
          <tr>
            <th />
            <th className="aal-yn">Yes / No</th>
            <th>Note details here</th>
          </tr>
        </thead>
        <tbody>
          {row('Supplier of the raptor known', yn(bird.supplier), <Editable label="Supplier" value={bird.supplier} onSave={set('supplier')} />)}
          {row('Date of hatching known', yn(hatch), <Editable label="Hatching date" value={hatch} onSave={set('hatch_date')} />)}
          {row("Raptor's date of arrival with you", yn(bird.arrival_date), <Editable label="Arrival date" value={bird.arrival_date} onSave={set('arrival_date')} />)}
          {row("Raptor's age at arrival known", yn(bird.age_at_arrival), <Editable label="Age at arrival" value={bird.age_at_arrival} onSave={set('age_at_arrival')} />)}
          {row("Raptor's sex", yn(bird.sex && bird.sex !== 'U'), bird.sex === 'M' ? 'Male' : bird.sex === 'F' ? 'Female' : 'Unknown')}
          {row('Neutered', <YesNo label="Neutered" value={bird.neutered} onSave={set('neutered')} />, '')}
          {row('Insured', <YesNo label="Insured" value={bird.insured} onSave={set('insured')} />, '')}
          {row('Raptor is housed alone', <YesNo label="Housed alone" value={housedAlone} onSave={set('housed_alone')} />, '')}
        </tbody>
      </table>

      <h2 className="aal-h">Enrichment</h2>
      <table className="aal-table aal-rows">
        <tbody>
          <tr>
            <th>Enrichment provided</th>
            <td>
              <Editable label="Enrichment" multiline value={bird.enrichment} onSave={set('enrichment')} />
            </td>
          </tr>
          <tr>
            <th>Frequency of change</th>
            <td>
              <Editable label="Frequency of change" value={bird.enrichment_frequency} onSave={set('enrichment_frequency')} />
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="aal-h">Medical information</h2>
      <table className="aal-table aal-rows">
        <thead>
          <tr>
            <th />
            <th className="aal-yn">Yes / No</th>
            <th>Note details here</th>
          </tr>
        </thead>
        <tbody>
          {row('Vaccinations', yn(bird.vaccinations), <Editable label="Vaccinations" multiline value={bird.vaccinations} onSave={set('vaccinations')} placeholder="If none are needed, say so" />)}
          {row(
            'Treatments (e.g. against parasites)',
            yn(bird.treatments || meds.length),
            <>
              <Editable label="Treatments" multiline value={bird.treatments} onSave={set('treatments')} />
              {meds.length > 0 && (
                <ul className="aal-list">
                  {meds.map((m) => (
                    <li key={m.id}>
                      {formatDay(m.start_date)}: {m.name_dose}, {m.amount}
                      {m.end_date ? ` (to ${formatDay(m.end_date)})` : ''}
                      {m.prescribed_by ? `, ${m.prescribed_by}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </>,
          )}
          {row('Death – date and cause', yn(bird.died_on), bird.died_on ? `${dmy(bird.died_on)}. ${bird.death_cause ?? ''}` : '')}
          {row('Other', '', "Full vet history is held in this bird's Vet Treatment Log and Documents folder.")}
        </tbody>
      </table>

      <h2 className="aal-h">Death of raptor</h2>
      <table className="aal-table aal-rows">
        <tbody>
          {row('Cause of death known', bird.died_on ? yn(bird.death_cause) : '', bird.died_on ? bird.death_cause : '')}
          {row('Disposal of carcass', bird.died_on ? yn(bird.carcass_disposal) : '', bird.carcass_disposal)}
        </tbody>
      </table>

      <h2 className="aal-h">Additional notes</h2>
      <Editable label="Additional notes" multiline value={bird.record_notes} onSave={set('record_notes')} />

      <h2 className="aal-h">Feeding Regime</h2>
      <p className="form-hint">Describe this raptor's usual feeding regime including type of food and frequency. Describe access to water for bathing and for drinking. Detail proposed use of supplements.</p>
      <p>{usualFeed}. Daily feeds are recorded in the app.</p>
      <Editable label="Feeding regime" multiline value={bird.feeding_regime} onSave={set('feeding_regime')} placeholder="Anything else about food, water for bathing and drinking, supplements" />

      <h2 className="aal-h">Exercise</h2>
      <p className="form-hint">Describe this raptor's usual exercise regime.</p>
      {flights != null && <p>{flights} flight{flights === 1 ? '' : 's'} logged in the last 30 days.</p>}
      <Editable label="Exercise regime" multiline value={bird.exercise_regime} onSave={set('exercise_regime')} placeholder="e.g. Flown at least 4 times a week unless moulting" />

      <h2 className="aal-h">Observation record</h2>
      <p className="form-hint">Observations of this raptor where there are symptoms of illness, injury or behaviour indicative of stress, fear, pain and anxiety, or any other concern. These would usually be identified on the Daily Inspection Record Sheet.</p>
      <table className="aal-table">
        <thead>
          <tr>
            <th className="aal-date">Date</th>
            <th>Record issue identified</th>
            <th>Record action taken</th>
          </tr>
        </thead>
        <tbody>
          {observations.length === 0 && (
            <tr>
              <td colSpan={3}>None recorded in the app.</td>
            </tr>
          )}
          {observations.map((o, i) => (
            <tr key={i}>
              <td className="aal-date">{formatDay(o.date)}</td>
              <td>{o.issue}</td>
              <td>{o.action}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(bird.status === 'archived' || bird.died_on) && (
        <>
          <h2 className="aal-h form-newpage">Disposal of Raptor Record</h2>
          <table className="aal-table">
            <tbody>
              <tr>
                <th>Type</th>
                <td>{typeOf(bird)}</td>
                <th>Given name</th>
                <td>{bird.name}</td>
              </tr>
              <tr>
                <th>Ring / chip number</th>
                <td colSpan={3}>{bird.ring_microchip}</td>
              </tr>
            </tbody>
          </table>
          <table className="aal-table aal-rows form-gap">
            <tbody>
              <tr>
                <th>Reason for disposal</th>
                <td>
                  <Editable label="Reason for disposal" value={bird.disposal_reason} onSave={set('disposal_reason')} placeholder="Deceased, sold as pet, sold not as pet" />
                </td>
              </tr>
              <tr>
                <th>Date of disposal / death</th>
                <td>
                  <Editable label="Date of death, YYYY-MM-DD" value={bird.died_on} onSave={set('died_on')} placeholder="YYYY-MM-DD" />
                </td>
              </tr>
              <tr>
                <th>Cause of death</th>
                <td>
                  <Editable label="Cause of death" multiline value={bird.death_cause} onSave={set('death_cause')} />
                </td>
              </tr>
              <tr>
                <th>Disposal of carcass</th>
                <td>
                  <Editable label="Disposal of carcass" value={bird.carcass_disposal} onSave={set('carcass_disposal')} />
                </td>
              </tr>
            </tbody>
          </table>
          {/\bsold\b/i.test(bird.disposal_reason ?? '') && (
            <>
              <h2 className="aal-h">If sold as pet</h2>
              <table className="aal-table">
                <tbody>
                  {SOLD_QUESTIONS.map((q) => (
                    <tr key={q}>
                      <td>{q}</td>
                      <td className="aal-yn">Yes / No</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      </FormSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// R3
// ---------------------------------------------------------------------------

interface Seen {
  bird_id: string;
  logged_at: string;
  log_date: string;
  staff_id: string;
  logged_for?: string | null;
  logged_for_name?: string | null;
}

export function R3Page() {
  const { birds, today, logName, staffName } = useStore();
  const [monday, setMonday] = useState(() => addDays(today, 1 - isoWeekday(today)));
  const [seen, setSeen] = useState<Seen[] | null>(null);
  const [concerns, setConcerns] = useState<CareLog[]>([]);
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = days[6];

  useEffect(() => {
    setSeen(null);
    const cols = 'bird_id, logged_at, log_date, staff_id, logged_for, logged_for_name';
    Promise.all([
      supabase.from('care_logs').select(cols).eq('kind', 'bird_check').is('voided_at', null).gte('log_date', monday).lte('log_date', sunday),
      supabase.from('feed_logs').select(cols).in('status', ['fed', 'flown', 'weighed']).is('voided_at', null).gte('log_date', monday).lte('log_date', sunday),
      supabase.from('care_logs').select('*').eq('concern', true).is('voided_at', null).gte('log_date', monday).lte('log_date', sunday).order('logged_at'),
      supabase.from('health_issues').select('*').is('voided_at', null).gte('started_on', monday).lte('started_on', sunday),
    ]).then(([a, b, c, d]) => {
      setSeen([...((a.data ?? []) as unknown as Seen[]), ...((b.data ?? []) as unknown as Seen[])]);
      setConcerns((c.data ?? []) as CareLog[]);
      setIssues((d.data ?? []) as HealthIssue[]);
    });
  }, [monday, sunday]);

  const nameOf = (id: string | null) => birds.find((b) => b.id === id)?.name ?? '';

  function day(date: string) {
    if (date > today) return null;
    const rows = (seen ?? []).filter((s) => s.log_date === date);
    const ids = new Set(rows.map((r) => r.bird_id));
    // Birds on the books that day: active now, or who died after this date
    const expected = birds.filter((b) => (b.status === 'active' || (b.died_on && b.died_on >= date)) && !(b.died_on && b.died_on < date));
    const missing = expected.filter((b) => !ids.has(b.id));
    const times = rows.map((r) => r.logged_at).sort();
    const inspectors = [...new Set(rows.map((r) => logName(r)))];
    return {
      checked: expected.length === 0 ? '' : missing.length === 0 ? `ALL (${expected.length})` : `${expected.length - missing.length} of ${expected.length}. Not logged: ${missing.map((b) => b.name).join(', ')}`,
      inspectors: inspectors.join(', '),
      time: times.length ? `${formatTime(times[0])}–${formatTime(times[times.length - 1])}` : '',
      concerns: concerns.filter((c) => c.log_date === date),
      issues: issues.filter((i) => i.started_on === date),
    };
  }

  return (
    <div className="aal-page aal-wide">
      <PrintBar>
        <button className="btn btn-outline" onClick={() => setMonday(addDays(monday, -7))} aria-label="Previous week">
          ◀
        </button>
        <button className="btn btn-outline" disabled={addDays(monday, 7) > today} onClick={() => setMonday(addDays(monday, 7))} aria-label="Next week">
          ▶
        </button>
      </PrintBar>
      <FormSheet landscape title="R3: DAILY INSPECTION RECORD" meta={[`Week Commencing: ${dmy(monday)}`, 'Retain for 3 years']}>
      <p className="aal-small"><strong>Guidance:</strong> Use this document (or your own version) to record abnormalities and/or issues identified during your daily inspection.</p>
      <p className="aal-small"><strong>Procedure:</strong> ALL birds listed on the Animal Activities Licence will be inspected daily. Any abnormalities, issues or areas of concern will be transferred to the Individual Raptor Record for that particular raptor. Accommodation is also checked and any action taken/required recorded. A bird counts as inspected on a day when it was checked, fed, flown or weighed, as recorded in the app.</p>
      {seen == null ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="aal-table">
          <thead>
            <tr>
              <th className="aal-day" />
              <th>Raptors checked</th>
              <th>Abnormalities/issues/concerns</th>
              <th>Action taken</th>
              <th>Inspector</th>
              <th className="aal-date">Date / time</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => {
              const r = day(d);
              return (
                <tr key={d}>
                  <th className="aal-day">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}</th>
                  <td>{r?.checked}</td>
                  <td>
                    {r?.concerns.map((c) => (
                      <div key={c.id}>
                        <strong>{nameOf(c.bird_id)}:</strong> {c.notes}
                      </div>
                    ))}
                    {r?.issues.map((x) => (
                      <div key={x.id}>
                        <strong>{nameOf(x.bird_id)}:</strong> {x.title}
                      </div>
                    ))}
                  </td>
                  <td>
                    {r?.concerns.map((c) => (
                      <div key={c.id}>{c.resolution ? `${nameOf(c.bird_id)}: ${c.resolution}${c.resolved_by ? ` (${staffName(c.resolved_by)})` : ''}` : `${nameOf(c.bird_id)}: open`}</div>
                    ))}
                    {r?.issues.map((x) => (
                      <div key={x.id}>{nameOf(x.bird_id)}: see Individual Raptor Record</div>
                    ))}
                  </td>
                  <td>{r?.inspectors}</td>
                  <td className="aal-date">{r && (r.time ? `${formatDay(d).replace(/^\w+ /, '')} ${r.time}` : '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </FormSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// R4
// ---------------------------------------------------------------------------

export function R4Page() {
  const { isAdmin, today } = useStore();
  const { settings, save, error } = useAalSettings();
  if (!settings) return <p className="empty">Loading…</p>;
  const vet = settings.vet ?? {};
  const set = (k: keyof VetDetails) => (v: string | null) => save({ vet: { ...vet, [k]: v ?? undefined } });
  const hours = vet.hours ?? {};
  const setHour = (day: string, k: 'open' | 'times' | 'emergency') => (v: string | null) => save({ vet: { ...vet, hours: { ...hours, [day]: { ...hours[day], [k]: v ?? undefined } } } });
  const line = (label: string, k: keyof VetDetails, multiline = false) => (
    <DotLine>
      <Dot label={`${label}:`} wide>
        <Editable label={label} canEdit={isAdmin} multiline={multiline} value={vet[k] as string | undefined} onSave={set(k)} />
      </Dot>
    </DotLine>
  );
  return (
    <div className="aal-page">
      <PrintBar back={isAdmin ? '/aal' : '/more'} />
      {error && <p className="warn no-print">{error}</p>}
      <FormSheet title="R4: VETERINARY CONTACT DETAILS" subtitle="INFORMATION SHEET" meta={[`Date created: ${dmy(today)}`, `Owner: ${settings.owner}`, 'Retention period: 3 years']} guidance={GUIDANCE.r4}>
      <h2 className="aal-h">Contact details of vet competent to treat raptors</h2>
      {line('Name', 'name')}
      {line('Address', 'address', true)}
      {line('Telephone for appointments', 'phone')}
      {line('Emergency telephone', 'emergency')}
      {line('Email', 'email')}
      {line('Travel distance to vet in miles', 'miles')}
      <h2 className="aal-h">Veterinary opening days and times:</h2>
      <table className="aal-table">
        <thead>
          <tr>
            <th />
            <th>Open / Closed</th>
            <th>Open from-to</th>
            <th>Emergency hours</th>
          </tr>
        </thead>
        <tbody>
          {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => (
            <tr key={d}>
              <th>{d}</th>
              <td>
                <Editable label={`${d} open or closed`} canEdit={isAdmin} value={hours[d]?.open} onSave={setHour(d, 'open')} />
              </td>
              <td>
                <Editable label={`${d} hours`} canEdit={isAdmin} value={hours[d]?.times} onSave={setHour(d, 'times')} />
              </td>
              <td>
                <Editable label={`${d} emergency hours`} canEdit={isAdmin} value={hours[d]?.emergency} onSave={setHour(d, 'emergency')} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="aal-h">Additional information</h2>
      <p className="form-dotted"><Editable label="Additional information" canEdit={isAdmin} multiline value={vet.notes} onSave={set('notes')} /></p>
      </FormSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// R5
// ---------------------------------------------------------------------------

export function R5Page() {
  const { today } = useStore();
  const { settings, save, error } = useAalSettings();
  if (!settings) return <p className="empty">Loading…</p>;
  const r5 = settings.r5 ?? {};
  const answers = r5.answers ?? {};
  const setAnswer = (key: string, changes: { yn?: string; action?: string }) => save({ r5: { ...r5, answers: { ...answers, [key]: { ...answers[key], ...changes } } } });
  const questions = R5_ITEMS.filter((x) => 'key' in x);
  const done = questions.filter((x) => 'key' in x && answers[x.key]?.yn).length;
  const gaps = questions.filter((x) => 'key' in x && answers[x.key]?.yn === 'N' && !answers[x.key]?.action).length;
  return (
    <div className="aal-page">
      <PrintBar />
      {error && <p className="warn no-print">{error}</p>}
      <p className="muted no-print">
        {done} of {questions.length} answered.{gaps > 0 ? ` ${gaps} "No" answer${gaps === 1 ? ' needs' : 's need'} an action point.` : ''} Print a copy each time you redo this, as the app keeps only the latest answers.
      </p>
      <FormSheet title="R5: SELF-ASSESSMENT ACCOMMODATION" meta={[<>Date created: <Editable label="Date of this assessment" value={r5.date ?? dmy(today)} onSave={(v) => save({ r5: { ...r5, date: v ?? undefined } })} /></>, `Owner: ${settings.owner}`, 'Retention period: 3 years']} guidance={GUIDANCE.r5}>
        <table className="aal-table form-r5">
          <thead>
            <tr>
              <th>Requirement</th>
              <th className="aal-yn">Y / N</th>
              <th>
                Action point
                <small> Where you answer 'no' to any question state what action will be taken</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {R5_ITEMS.map((item) =>
              'heading' in item ? (
                <tr key={item.heading}>
                  <th colSpan={3}>{item.heading}</th>
                </tr>
              ) : (
                <tr key={item.key}>
                  <td>{item.text}</td>
                  <td className="aal-yn">
                    <select className="aal-box no-print" value={answers[item.key]?.yn ?? ''} aria-label="Yes or no" onChange={(e) => setAnswer(item.key, { yn: e.target.value })}>
                      <option value="" />
                      <option value="Y">Y</option>
                      <option value="N">N</option>
                    </select>
                    <span className="aal-print">{answers[item.key]?.yn}</span>
                  </td>
                  <td>
                    <Editable label="Action point" value={answers[item.key]?.action} onSave={(v) => setAnswer(item.key, { action: v ?? '' })} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </FormSheet>
    </div>
  );
}
