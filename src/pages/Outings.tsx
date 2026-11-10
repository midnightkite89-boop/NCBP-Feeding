import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GUIDANCE } from '../aalText';
import { PrintBar } from './Aal';
import { BlankRows, Dot, DotLine, FormSheet, dmy } from './aalForm';
import {
  BASE_ADDRESS,
  BRIEFING_ROWS,
  FILM_BRIEFING,
  KINDS,
  RISK_ROWS,
  copyRiskFrom,
  fullForms,
  kindLabel,
  useOutings,
  workOutTrip,
  type Accident,
  type Check,
  type Hazard,
  type Journey,
  type Outing,
  type OutingBird,
  type OutingDetails,
  type OutingKind,
} from '../outings';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { formatDay, formatTime } from '../time';
import type { Bird } from '../types';

const OWNER = 'SMJ Falconry & Crafts';
const dateRange = (o: Outing) => (o.start_date === o.end_date ? formatDay(o.start_date) : `${formatDay(o.start_date)} to ${formatDay(o.end_date)}`);
const formsFor = (k: OutingKind) => (fullForms(k) ? 'R6, R7 and R8' : 'R8 only');

const birdEntry = (b: Bird): OutingBird => ({ bird_id: b.id, name: b.name, species: b.species, ring: b.ring_microchip ?? null });

function Banner({ pending, error }: { pending: number; error: string | null }) {
  if (error) return <p className="warn no-print">Couldn't save to the server: {error}</p>;
  if (pending > 0) return <p className="outing-saved no-print">Saved on this phone. It will send when there's signal.</p>;
  return null;
}

function Text({ label, value, onSave, type = 'text', multiline, placeholder, list, hint }: { label: string; value: string | undefined; onSave: (v: string) => void; type?: string; multiline?: boolean; placeholder?: string; list?: string; hint?: string }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const commit = () => {
    if (text.trim() !== (value ?? '')) onSave(text.trim());
  };
  return (
    <label className="field">
      <span>
        {label}
        {hint && <small> {hint}</small>}
      </span>
      {multiline ? (
        <textarea rows={2} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      ) : (
        <input type={type} value={text} placeholder={placeholder} list={list} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      )}
    </label>
  );
}

function BirdPicker({ chosen, onToggle }: { chosen: string[]; onToggle: (b: Bird) => void }) {
  const { birds } = useStore();
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const list = birds
    .filter((b) => b.status === 'active' && (!t || b.name.toLowerCase().includes(t) || (b.species ?? '').toLowerCase().includes(t)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a bird" aria-label="Find a bird" />
      </div>
      <div className="outing-picks">
        {list.map((b) => (
          <button key={b.id} type="button" className={`outing-pick${chosen.includes(b.id) ? ' on' : ''}`} aria-pressed={chosen.includes(b.id)} onClick={() => onToggle(b)}>
            <strong>{b.name}</strong>
            <span>{b.species}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function OutingsPage() {
  const { outings, loaded, pending, error } = useOutings();
  const { today } = useStore();
  const coming = outings.filter((o) => o.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = outings.filter((o) => o.end_date < today).sort((a, b) => b.start_date.localeCompare(a.start_date));

  const item = (o: Outing) => (
    <li key={o.id}>
      <Link to={`/outings/${o.id}`} className="flight-item">
        <span className="flight-main">
          <span>
            <strong>{o.venue}</strong> · {kindLabel(o.kind)}
          </span>
          <span className="meta">
            {dateRange(o)} · {o.details.birds?.length ?? 0} birds · {formsFor(o.kind)}
          </span>
        </span>
        <span className="more-chevron" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );

  return (
    <div className="more-page">
      <h1 className="page-title">Outings</h1>
      <p className="muted">One record for each trip out with birds. Fill it in as you go, then print the forms.</p>
      <Banner pending={pending} error={error} />
      <Link to="/outings/new" className="btn btn-primary btn-lg outing-new">
        + New outing
      </Link>
      {coming.length > 0 && <h2 className="outing-h">Today and coming up</h2>}
      <ul className="flight-list">{coming.map(item)}</ul>
      {past.length > 0 && <h2 className="outing-h">Past outings</h2>}
      <ul className="flight-list">{past.map(item)}</ul>
      {loaded && outings.length === 0 && <p className="empty">No outings yet.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New
// ---------------------------------------------------------------------------

export function NewOutingPage() {
  const { today, birds, me, acting, staffName } = useStore();
  const { outings, save } = useOutings();
  const navigate = useNavigate();
  const [kind, setKind] = useState<OutingKind | null>(null);
  const [venue, setVenue] = useState('');
  const [address, setAddress] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [chosen, setChosen] = useState<string[]>([]);
  const venues = useMemo(() => [...new Set(outings.map((o) => o.venue))], [outings]);
  const name = acting?.name ?? (acting?.id ? staffName(acting.id) : (me?.display_name ?? ''));
  const ready = kind && venue.trim() && start && chosen.length > 0;

  function pickVenue(v: string) {
    setVenue(v);
    const last = outings.find((o) => o.venue.toLowerCase() === v.trim().toLowerCase());
    if (last?.details.address && !address) setAddress(last.details.address);
  }

  function create() {
    if (!kind || !ready) return;
    const id = crypto.randomUUID();
    const place = [venue.trim(), address.trim()].filter(Boolean).join(', ');
    const purpose = `${kindLabel(kind)}: ${venue.trim()}`;
    const finish = end < start ? start : end;
    save({
      id,
      kind,
      venue: venue.trim(),
      start_date: start,
      end_date: finish,
      details: {
        address: address.trim(),
        driver: name,
        completed_by: name,
        outward: { purpose, from: BASE_ADDRESS, to: place, date: start },
        back: { purpose: `Return: ${purpose}`, from: place, to: BASE_ADDRESS, date: finish },
        birds: chosen.map((bid) => birds.find((b) => b.id === bid)).filter((b): b is Bird => !!b).map(birdEntry),
      },
    });
    navigate(`/outings/${id}`, { replace: true });
  }

  return (
    <div className="more-page">
      <div className="no-print aal-bar">
        <Link to="/outings" className="btn btn-outline">
          ‹ Back
        </Link>
      </div>
      <h1 className="page-title">New outing</h1>

      <h2 className="outing-h">1. What kind of outing?</h2>
      <div className="outing-kinds">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className={`outing-pick${kind === k.id ? ' on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
            <strong>{k.label}</strong>
          </button>
        ))}
      </div>
      {kind && <p className="muted">Forms for this one: {formsFor(kind)}.</p>}

      <h2 className="outing-h">2. Where and when?</h2>
      <label className="field">
        <span>Venue or client</span>
        <input value={venue} list="outing-venues" onChange={(e) => pickVenue(e.target.value)} />
        <datalist id="outing-venues">
          {venues.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>
          Address <small>include the postcode so the miles can be worked out</small>
        </span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <div className="outing-two">
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (end < e.target.value) setEnd(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Last day</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <h2 className="outing-h">3. Which birds are going?</h2>
      <BirdPicker chosen={chosen} onToggle={(b) => setChosen((c) => (c.includes(b.id) ? c.filter((x) => x !== b.id) : [...c, b.id]))} />

      <div className="outing-foot">
        <button className="btn btn-primary btn-lg" disabled={!ready} onClick={create}>
          Save outing{chosen.length ? ` (${chosen.length} bird${chosen.length === 1 ? '' : 's'})` : ''}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One outing
// ---------------------------------------------------------------------------

function Step({ title, status, open, children }: { title: string; status?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="panel outing-step" open={open}>
      <summary>
        <span>{title}</span>
        {status && <span className={status === 'Done' ? 'outing-done' : 'outing-todo'}>{status}</span>}
      </summary>
      {children}
    </details>
  );
}

function CheckButtons({ value, onChange, label }: { value: Check | null | undefined; onChange: (v: Check | null) => void; label: string }) {
  return (
    <span className="outing-check" role="group" aria-label={label}>
      <button type="button" className={value === 'ok' ? 'on-ok' : ''} aria-pressed={value === 'ok'} onClick={() => onChange(value === 'ok' ? null : 'ok')}>
        ✓ OK
      </button>
      <button type="button" className={value === 'problem' ? 'on-bad' : ''} aria-pressed={value === 'problem'} onClick={() => onChange(value === 'problem' ? null : 'problem')}>
        Problem
      </button>
    </span>
  );
}

function JourneyFields({ value, onChange, which }: { value: Journey | undefined; onChange: (j: Journey) => void; which: string }) {
  const j = value ?? {};
  const set = (k: keyof Journey) => (v: string) => onChange({ ...j, [k]: v });
  return (
    <>
      <Text label={`${which}: from`} value={j.from} onSave={set('from')} />
      <Text label={`${which}: to`} value={j.to} onSave={set('to')} />
      <div className="outing-two">
        <Text label="Date" type="date" value={j.date} onSave={set('date')} />
        <Text label="Approx miles" value={j.miles} onSave={set('miles')} />
        <Text label="Start time" type="time" value={j.start} onSave={set('start')} />
        <Text label="End time" type="time" value={j.end} onSave={set('end')} />
      </div>
    </>
  );
}

/** Flown and fed times already logged in the app for these birds on these dates */
function useLoggedTimes(o: Outing | undefined) {
  const [times, setTimes] = useState<Record<string, { flown?: string; fed?: string }>>({});
  const ids = o?.details.birds?.map((b) => b.bird_id).join(',') ?? '';
  const start = o?.start_date;
  const end = o?.end_date;
  useEffect(() => {
    if (!ids || !start || !end) return;
    supabase
      .from('feed_logs')
      .select('id, bird_id, logged_at, status, replaces')
      .in('bird_id', ids.split(','))
      .in('status', ['fed', 'flown'])
      .gte('log_date', start)
      .lte('log_date', end)
      .is('voided_at', null)
      .order('logged_at')
      .then(({ data }) => {
        const rows = (data ?? []) as { id: string; bird_id: string; logged_at: string; status: 'fed' | 'flown'; replaces: string | null }[];
        const replaced = new Set(rows.map((r) => r.replaces));
        const out: Record<string, { flown?: string; fed?: string }> = {};
        for (const r of rows) {
          if (replaced.has(r.id)) continue;
          const entry = (out[r.bird_id] ??= {});
          entry[r.status] = [entry[r.status], formatTime(r.logged_at)].filter(Boolean).join(', ');
        }
        setTimes(out);
      });
  }, [ids, start, end]);
  return times;
}

export function OutingPage() {
  const { id = '' } = useParams();
  const { outings, loaded, pending, error, save } = useOutings();
  const { birds } = useStore();
  const navigate = useNavigate();
  const outing = outings.find((o) => o.id === id);
  const logged = useLoggedTimes(outing);
  const [changingBirds, setChangingBirds] = useState(false);
  const [working, setWorking] = useState(false);
  const [tripError, setTripError] = useState<string | null>(null);
  const [firstOpen, setFirstOpen] = useState<string | null>(null);

  const d = outing?.details;
  const list = d?.birds ?? [];
  const full = outing ? fullForms(outing.kind) : false;
  const riskRows = d?.risk?.rows ?? {};
  const statuses = {
    trip: d?.miles && d?.driver ? 'Done' : 'To do',
    leaving: list.length && list.every((b) => b.pre) && d?.outward?.start ? 'Done' : 'To do',
    risk: RISK_ROWS.every((r) => riskRows[r.key]?.checked) ? 'Done' : 'To do',
    during: BRIEFING_ROWS.every((r) => d?.briefing?.[r.key]) ? 'Done' : 'To do',
    home: list.length && list.every((b) => b.during && b.post) && d?.back?.end ? 'Done' : 'To do',
  };
  const order = full ? (['trip', 'leaving', 'risk', 'during', 'home'] as const) : (['trip', 'leaving', 'home'] as const);
  const nextStep = order.find((s) => statuses[s] !== 'Done') ?? null;

  // Open the step to do next when the page loads, and leave the rest as they are after that
  useEffect(() => {
    if (d && firstOpen === null) setFirstOpen(nextStep ?? 'none');
  }, [d, firstOpen, nextStep]);

  if (!outing || !d) return <p className="empty">{loaded ? 'Outing not found.' : 'Loading…'}</p>;

  const patch = (changes: Partial<OutingDetails>) => save({ ...outing, details: { ...d, ...changes } });
  const setDetail = (k: keyof OutingDetails) => (v: string) => patch({ [k]: v } as Partial<OutingDetails>);
  const setBird = (bid: string, changes: Partial<OutingBird>) => patch({ birds: list.map((b) => (b.bird_id === bid ? { ...b, ...changes } : b)) });
  const allOk = (k: 'pre' | 'during' | 'post') => patch({ birds: list.map((b) => ({ ...b, [k]: b[k] ?? 'ok' })) });
  const setRisk = (changes: Partial<NonNullable<OutingDetails['risk']>>) => patch({ risk: { ...d.risk, ...changes } });
  const setRow = (key: string, changes: { measures?: string; checked?: boolean }) => setRisk({ rows: { ...riskRows, [key]: { ...riskRows[key], ...changes } } });
  const hazards = d.risk?.hazards ?? [];
  const setHazard = (i: number, k: keyof Hazard) => (v: string) => setRisk({ hazards: hazards.map((h, n) => (n === i ? { ...h, [k]: v } : h)) });
  const accident = d.accident ?? {};
  const setAccident = (changes: Partial<Accident>) => patch({ accident: { ...accident, ...changes } });
  const injuries = accident.injuries ?? [];

  const previous = outings
    .filter((o) => o.id !== outing.id && o.venue.toLowerCase() === outing.venue.toLowerCase() && (o.details.risk?.hazards?.length || Object.keys(o.details.risk?.rows ?? {}).length))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];

  async function workOut() {
    setWorking(true);
    setTripError(null);
    try {
      const trip = await workOutTrip(d?.address);
      if (!d) return;
      patch({
        miles: trip.miles,
        travel_time: trip.travelTime,
        local_vet: d.local_vet || trip.vet,
        outward: { ...d.outward, miles: d.outward?.miles || trip.miles },
        back: { ...d.back, miles: d.back?.miles || trip.miles },
      });
    } catch (e) {
      setTripError(e instanceof Error && !/fetch|load failed/i.test(e.message) ? e.message : "Couldn't work it out. Type the miles in instead.");
    }
    setWorking(false);
  }

  function toggleBird(b: Bird) {
    patch({ birds: list.some((x) => x.bird_id === b.id) ? list.filter((x) => x.bird_id !== b.id) : [...list, birdEntry(b)] });
  }

  function remove() {
    if (!outing) return;
    if (!window.confirm(`Remove the outing to ${outing.venue}? It stays on file but won't show here.`)) return;
    save({ ...outing, voided_at: new Date().toISOString() });
    navigate('/outings', { replace: true });
  }

  if (firstOpen === null) return <p className="empty">Loading…</p>;

  const checksTable = (keys: { key: 'pre' | 'during' | 'post'; label: string }[]) =>
    keys.map(({ key, label }) => (
      <div key={key} className="outing-checks">
        <div className="outing-checks-head">
          <h3>{label}</h3>
          <button type="button" className="btn btn-outline" onClick={() => allOk(key)}>
            Mark the rest OK
          </button>
        </div>
        {list.map((b) => (
          <div key={b.bird_id}>
            <div className="outing-check-row">
              <span>
                <strong>{b.name}</strong>
              </span>
              <CheckButtons label={`${b.name} ${label}`} value={b[key]} onChange={(v) => setBird(b.bird_id, { [key]: v })} />
            </div>
            {b[key] === 'problem' && <Text label={`What was wrong with ${b.name}?`} value={b.note} onSave={(v) => setBird(b.bird_id, { note: v })} />}
          </div>
        ))}
      </div>
    ));

  return (
    <div className="more-page">
      <div className="no-print aal-bar">
        <Link to="/outings" className="btn btn-outline">
          ‹ Outings
        </Link>
      </div>
      <h1 className="page-title">{outing.venue}</h1>
      <p className="muted">
        {kindLabel(outing.kind)} · {dateRange(outing)} · {formsFor(outing.kind)}
      </p>
      <Banner pending={pending} error={error} />

      <Step title="1. The trip" status={statuses.trip} open={firstOpen === 'trip'}>
        <label className="field">
          <span>Kind of outing</span>
          <select value={outing.kind} onChange={(e) => save({ ...outing, kind: e.target.value as OutingKind })}>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <Text label="Address" value={d.address} onSave={setDetail('address')} hint="include the postcode" />
        <button type="button" className="btn btn-outline" disabled={working} onClick={workOut}>
          {working ? 'Working it out…' : full ? 'Work out miles, travel time and nearest vet' : 'Work out miles and travel time'}
        </button>
        {tripError && <p className="warn">{tripError}</p>}
        <div className="outing-two">
          <Text label="Miles from base" value={d.miles} onSave={setDetail('miles')} />
          <Text label="Travel time" value={d.travel_time} onSave={setDetail('travel_time')} />
        </div>
        <Text label="Driver" value={d.driver} onSave={setDetail('driver')} />
        {full && (
          <>
            <Text label="Completed by" value={d.completed_by} onSave={setDetail('completed_by')} />
            <div className="outing-two">
              <Text label="Arrival time" type="time" value={d.arrive} onSave={setDetail('arrive')} />
              <Text label="Departure time" type="time" value={d.leave} onSave={setDetail('leave')} />
            </div>
            <Text label="Local vet" value={d.local_vet} onSave={setDetail('local_vet')} />
          </>
        )}
        <h3 className="outing-sub">Birds going ({list.length})</h3>
        {changingBirds ? (
          <>
            <BirdPicker chosen={list.map((b) => b.bird_id)} onToggle={toggleBird} />
            <button type="button" className="btn btn-primary" onClick={() => setChangingBirds(false)}>
              Done
            </button>
          </>
        ) : (
          <>
            <p>{list.map((b) => b.name).join(', ') || 'None yet.'}</p>
            <button type="button" className="btn btn-outline" disabled={birds.length === 0} onClick={() => setChangingBirds(true)}>
              Change birds
            </button>
          </>
        )}
      </Step>

      <Step title="2. Before you leave" status={statuses.leaving} open={firstOpen === 'leaving'}>
        {checksTable([{ key: 'pre', label: 'Pre-transport check' }])}
        <JourneyFields which="Outward" value={d.outward} onChange={(j) => patch({ outward: j })} />
        <h3 className="outing-sub">Breaks taken</h3>
        <div className="outing-two">
          <Text label="Time" type="time" value={d.break_time} onSave={setDetail('break_time')} />
          <Text label="Duration" value={d.break_duration} onSave={setDetail('break_duration')} />
        </div>
      </Step>

      {full && (
        <Step title="3. On arrival: risk assessment" status={statuses.risk} open={firstOpen === 'risk'}>
          {previous && !d.risk?.rows && !hazards.length && (
            <button type="button" className="btn btn-outline" onClick={() => patch({ risk: copyRiskFrom(previous) })}>
              Start from {formatDay(previous.start_date)} here (recheck everything)
            </button>
          )}
          <div className="outing-two">
            <Text label="Date" type="date" value={d.risk?.date} onSave={(v) => setRisk({ date: v })} />
            <Text label="Assessed by" value={d.risk?.assessed_by} onSave={(v) => setRisk({ assessed_by: v })} />
          </div>
          {RISK_ROWS.map((r) => (
            <div key={r.key} className="outing-risk">
              <label className="outing-tick">
                <input type="checkbox" checked={!!riskRows[r.key]?.checked} onChange={(e) => setRow(r.key, { checked: e.target.checked })} />
                <span>{r.label}</span>
              </label>
              <Text label="Measures taken (if required)" multiline value={riskRows[r.key]?.measures} onSave={(v) => setRow(r.key, { measures: v })} />
            </div>
          ))}
          <Text label="Any further comments" multiline value={d.risk?.comments} onSave={(v) => setRisk({ comments: v })} />

          <h3 className="outing-sub">R7 hazards at this venue</h3>
          <p className="muted">Harm to the birds: discomfort, hunger or thirst, fear or distress, pain, injury or disease.</p>
          {hazards.map((h, i) => (
            <div key={i} className="outing-card">
              <Text label="What is the hazard?" value={h.hazard} onSave={setHazard(i, 'hazard')} />
              <Text label="Type of harm" value={h.harm} onSave={setHazard(i, 'harm')} />
              <Text label="Mitigation steps" multiline value={h.mitigation} onSave={setHazard(i, 'mitigation')} />
              <Text label="Anything else needed to control this risk?" value={h.further} onSave={setHazard(i, 'further')} />
              <div className="outing-two">
                <Text label="Action by who?" value={h.who} onSave={setHazard(i, 'who')} />
                <Text label="Action by when?" value={h.when} onSave={setHazard(i, 'when')} />
              </div>
              <Text label="Confirmed by (initials)" value={h.confirmed} onSave={setHazard(i, 'confirmed')} />
            </div>
          ))}
          <button type="button" className="btn btn-outline" onClick={() => setRisk({ hazards: [...hazards, {}] })}>
            + Add a hazard
          </button>
        </Step>
      )}

      {full && (
        <Step title="4. During the display" status={statuses.during} open={firstOpen === 'during'}>
          <h3 className="outing-sub">Each bird</h3>
          <p className="muted">Times you log as normal on Fly / Feed show here automatically. Type one in only if it wasn't logged.</p>
          {list.map((b) => (
            <div key={b.bird_id} className="outing-card">
              <h4>{b.name}</h4>
              <Text label="Time handling" value={b.handling} onSave={(v) => setBird(b.bird_id, { handling: v })} placeholder="e.g. 30 mins" />
              <div className="outing-two">
                <Text label="Time flown" value={b.flown} onSave={(v) => setBird(b.bird_id, { flown: v })} placeholder={logged[b.bird_id]?.flown ?? ''} />
                <Text label="Time fed" value={b.fed} onSave={(v) => setBird(b.bird_id, { fed: v })} placeholder={logged[b.bird_id]?.fed ?? ''} />
              </div>
              <Text label="Behaviour, injury or other issue" hint="also goes on this bird's R2" multiline value={b.note} onSave={(v) => setBird(b.bird_id, { note: v })} />
            </div>
          ))}
          <h3 className="outing-sub">Briefing the public</h3>
          {BRIEFING_ROWS.map((r) => (
            <label key={r.key} className="outing-tick">
              <input type="checkbox" checked={!!d.briefing?.[r.key]} onChange={(e) => patch({ briefing: { ...d.briefing, [r.key]: e.target.checked } })} />
              <span>{r.label}</span>
            </label>
          ))}
          <Text label="Location of hand washing facilities" value={d.handwash} onSave={setDetail('handwash')} />
          <label className="outing-tick">
            <input type="checkbox" checked={!!d.briefing?.[FILM_BRIEFING.key]} onChange={(e) => patch({ briefing: { ...d.briefing, [FILM_BRIEFING.key]: e.target.checked } })} />
            <span>{FILM_BRIEFING.label}</span>
          </label>
        </Step>
      )}

      <Step title={`${full ? 5 : 3}. Going home`} status={statuses.home} open={firstOpen === 'home'}>
        {checksTable([
          { key: 'during', label: 'In transport check' },
          { key: 'post', label: 'Post transport check' },
        ])}
        <JourneyFields which="Return" value={d.back} onChange={(j) => patch({ back: j })} />
      </Step>

      <Step title="If there was an accident on the journey">
        <Text label="Date and approximate time" value={accident.when} onSave={(v) => setAccident({ when: v })} />
        <Text label="Location" value={accident.location} onSave={(v) => setAccident({ location: v })} />
        <Text label="Details of others involved" multiline value={accident.others} onSave={(v) => setAccident({ others: v })} />
        <p className="muted">If you don't exchange details at the scene, you must report the accident at a police station within 24 hours.</p>
        <Text label="What happened?" multiline value={accident.nature} onSave={(v) => setAccident({ nature: v })} />
        <Text label="Damage to vehicle" value={accident.damage} onSave={(v) => setAccident({ damage: v })} />
        <h3 className="outing-sub">Birds injured</h3>
        {injuries.map((inj, i) => {
          const setInjury = (k: 'raptor' | 'injury' | 'treatment') => (v: string) => setAccident({ injuries: injuries.map((x, n) => (n === i ? { ...x, [k]: v } : x)) });
          return (
            <div key={i} className="outing-card">
              <Text label="Raptor name and species" value={inj.raptor} onSave={setInjury('raptor')} />
              <Text label="Injury" value={inj.injury} onSave={setInjury('injury')} />
              <Text label="Treatment" multiline value={inj.treatment} onSave={setInjury('treatment')} />
            </div>
          );
        })}
        <button type="button" className="btn btn-outline" onClick={() => setAccident({ injuries: [...injuries, {}] })}>
          + Add an injured bird
        </button>
        <Text label="Date of claim to insurance company" type="date" value={accident.claim_date} onSave={(v) => setAccident({ claim_date: v })} />
      </Step>

      <div className="outing-print">
        <Link to={`/outings/${outing.id}/r8`} className="btn btn-primary">
          R8 Transport
        </Link>
        {full && (
          <>
            <Link to={`/outings/${outing.id}/r6`} className="btn btn-primary">
              R6 Exhibited Raptors
            </Link>
            <Link to={`/outings/${outing.id}/r7`} className="btn btn-primary">
              R7 Risk Assessment
            </Link>
          </>
        )}
      </div>
      <button type="button" className="btn btn-outline outing-remove" onClick={remove}>
        Remove this outing
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Printed forms
// ---------------------------------------------------------------------------

function usePrintOuting() {
  const { id = '' } = useParams();
  const { outings, loaded } = useOutings();
  return { id, outing: outings.find((o) => o.id === id), loaded };
}

const mark = (c: Check | null | undefined) => (c === 'ok' ? '✓' : c === 'problem' ? 'Problem' : '');

function NotFound({ loaded }: { loaded: boolean }) {
  return <p className="empty">{loaded ? 'Outing not found.' : 'Loading…'}</p>;
}

function JourneyLines({ j }: { j: Journey | undefined }) {
  return (
    <>
      <DotLine>
        <Dot label="Purpose:" wide>{j?.purpose}</Dot>
      </DotLine>
      <DotLine>
        <Dot label="From:">{j?.from}</Dot>
        <Dot label="To:">{j?.to}</Dot>
      </DotLine>
      <DotLine>
        <Dot label="Date:">{dmy(j?.date)}</Dot>
        <Dot label="Start time:">{j?.start}</Dot>
        <Dot label="End time:">{j?.end}</Dot>
        <Dot label="Approx miles:">{j?.miles}</Dot>
      </DotLine>
    </>
  );
}

export function OutingR8() {
  const { id, outing, loaded } = usePrintOuting();
  if (!outing) return <NotFound loaded={loaded} />;
  const d = outing.details;
  const a = d.accident ?? {};
  const list = d.birds ?? [];
  const injuries = a.injuries?.length ? a.injuries : [{}];
  const problems = list.filter((b) => b.note && (b.pre === 'problem' || b.during === 'problem' || b.post === 'problem'));
  return (
    <div className="aal-page">
      <PrintBar back={`/outings/${id}`} />
      <FormSheet title="R8: TRANSPORTATION RECORD SHEET" guidance={GUIDANCE.r8}>
        <h2 className="aal-h">Journey details</h2>
        <h3 className="form-h3">Outward journey</h3>
        <JourneyLines j={d.outward} />
        <h3 className="form-h3">
          Note any breaks taken <em className="form-note">Note: Live Transport Welfare Regulations</em>
        </h3>
        <DotLine>
          <Dot label="Time:">{d.break_time}</Dot>
          <Dot label="Duration:">{d.break_duration}</Dot>
        </DotLine>
        <h3 className="form-h3">Return journey (where relevant)</h3>
        <JourneyLines j={d.back} />
        <h2 className="aal-h">Raptors transported</h2>
        <table className="aal-table">
          <thead>
            <tr>
              <th>Raptor type (common name)</th>
              <th>Raptor given name or ring/ microchip</th>
              <th>Pre-transport check</th>
              <th>In transport check</th>
              <th>Post transport check</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.bird_id}>
                <td>{b.species}</td>
                <td>
                  {b.name}
                  {b.ring ? ` / ${b.ring}` : ''}
                </td>
                <td className="form-c">{mark(b.pre)}</td>
                <td className="form-c">{mark(b.during)}</td>
                <td className="form-c">{mark(b.post)}</td>
              </tr>
            ))}
            <BlankRows have={list.length} upTo={15} cols={5} />
          </tbody>
        </table>
        {problems.length > 0 && (
          <p>
            <strong>Problems noted:</strong> {problems.map((b) => `${b.name}: ${b.note}`).join('; ')}
          </p>
        )}
        <p className="form-related">Related documents: Staffing Policy; Individual Raptor Records; Vehicle Accident or Breakdown Policy;</p>

        <h2 className="form-section form-newpage">Accident Record Form</h2>
        <h2 className="aal-h">Driver details</h2>
        <DotLine>
          <Dot label="Name:" wide>{d.driver}</Dot>
        </DotLine>
        <h2 className="aal-h">Accident details</h2>
        <DotLine>
          <Dot label="Date / approximate time of accident:" wide>{a.when}</Dot>
        </DotLine>
        <DotLine>
          <Dot label="Location of accident:" wide>{a.location}</Dot>
        </DotLine>
        <DotLine>
          <Dot label="Details of other(s) involved:" wide>{a.others}</Dot>
        </DotLine>
        <p className="form-hint">Note: If you don't exchange details at the scene (e.g. other driver doesn't stop) you must report the accident at a police station within 24 hours</p>
        <DotLine>
          <Dot label="Nature of accident (describe what happened):" wide>{a.nature}</Dot>
        </DotLine>
        <DotLine>
          <Dot label="Damage to vehicle:" wide>{a.damage}</Dot>
        </DotLine>
        <h2 className="aal-h">Injuries</h2>
        <p className="form-hint">Where raptors were injured as a result of the accident complete this section – repeat for each raptor injured.</p>
        {injuries.map((inj, i) => (
          <div key={i}>
            <DotLine>
              <Dot label="Raptor name and species:" wide>{inj.raptor}</Dot>
            </DotLine>
            <DotLine>
              <Dot label="Injury:" wide>{inj.injury}</Dot>
            </DotLine>
            <DotLine>
              <Dot label="Treatment:" wide>{inj.treatment}</Dot>
            </DotLine>
          </div>
        ))}
        <h2 className="aal-h">Claim to insurance company</h2>
        <DotLine>
          <Dot label="Date:" wide>{dmy(a.claim_date)}</Dot>
        </DotLine>
      </FormSheet>
    </div>
  );
}

export function OutingR6() {
  const { id, outing, loaded } = usePrintOuting();
  const logged = useLoggedTimes(outing);
  if (!outing) return <NotFound loaded={loaded} />;
  const d = outing.details;
  const list = d.birds ?? [];
  return (
    <div className="aal-page">
      <PrintBar back={`/outings/${id}`} />
      <FormSheet landscape title="R6: EXHIBITED RAPTORS RECORD" meta={[`Date created: ${dmy(outing.created_at?.slice(0, 10) ?? outing.start_date)}`, `Owner: ${OWNER}`, 'Retention period: 3 years']} guidance={GUIDANCE.r6}>
        <h2 className="aal-h">Exhibition</h2>
        <DotLine>
          <Dot label="Completed by (name):">{d.completed_by}</Dot>
          <Dot label="Start date of exhibit:">{dmy(outing.start_date)}</Dot>
          <Dot label="End date of exhibit:">{dmy(outing.end_date)}</Dot>
        </DotLine>
        <DotLine>
          <Dot label="Type of exhibit:">{kindLabel(outing.kind)}</Dot>
          <Dot label="Location of exhibit:" wide>{[outing.venue, d.address].filter(Boolean).join(', ')}</Dot>
        </DotLine>
        <DotLine>
          <Dot label="Distance and travel time to exhibit from licensed premises:" wide>{[d.miles ? `${d.miles} miles` : '', d.travel_time].filter(Boolean).join(' / ')}</Dot>
          <Dot label="Duration of exhibit (arrival to departure time):">{[d.arrive, d.leave].filter(Boolean).join(' to ')}</Dot>
        </DotLine>
        <DotLine>
          <Dot label="Local vet:" wide>{d.local_vet}</Dot>
        </DotLine>
        <h2 className="aal-h">Display</h2>
        <p>Copy of AAL License; Copy of Public Liability Insurance; Any signs/ notices for public attention; Briefing Note below.</p>
        <table className="aal-table form-gap">
          <thead>
            <tr>
              <th className="aal-n" />
              <th>Raptor Name</th>
              <th>Time Handling</th>
              <th>Time flown</th>
              <th>Time fed</th>
              <th>Note any behaviour/ injury or other issue -copy to Individual Raptor Record</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b, i) => (
              <tr key={b.bird_id}>
                <td className="aal-n">{i + 1}</td>
                <td>
                  {b.name}, {b.species}
                </td>
                <td>{b.handling}</td>
                <td>{b.flown || logged[b.bird_id]?.flown}</td>
                <td>{b.fed || logged[b.bird_id]?.fed}</td>
                <td>{b.note}</td>
              </tr>
            ))}
            <BlankRows have={list.length} upTo={10} cols={6} numbered />
          </tbody>
        </table>

        <h2 className="form-section form-newpage">Briefing the public - Template</h2>
        <h2 className="aal-h">Guidance</h2>
        <ul className="form-guidance">
          <li>This document can be used as an aide memoire when briefing the public, clients and any audience at any exhibition involving raptors</li>
          <li>The purpose is to explain to clients/ audiences how to behave around raptors to ensure their safety and that of the raptor(s)</li>
        </ul>
        <table className="aal-table">
          <thead>
            <tr>
              <th>Briefing</th>
              <th className="aal-n">Tick</th>
            </tr>
          </thead>
          <tbody>
            {BRIEFING_ROWS.map((r) => (
              <tr key={r.key}>
                <td>
                  {r.label}
                  {r.key === 'handwash' && (
                    <>
                      <br />
                      Location of facilities: {d.handwash}
                    </>
                  )}
                </td>
                <td className="aal-n form-c">{d.briefing?.[r.key] ? '✓' : ''}</td>
              </tr>
            ))}
            <tr>
              <td>{FILM_BRIEFING.label}</td>
              <td className="aal-n form-c">{d.briefing?.[FILM_BRIEFING.key] ? '✓' : ''}</td>
            </tr>
          </tbody>
        </table>
      </FormSheet>
    </div>
  );
}

export function OutingR7() {
  const { id, outing, loaded } = usePrintOuting();
  if (!outing) return <NotFound loaded={loaded} />;
  const risk = outing.details.risk ?? {};
  const assessed = dmy(risk.date || outing.start_date);
  const place = [outing.venue, outing.details.address].filter(Boolean).join(', ');
  const hazards = risk.hazards ?? [];
  return (
    <div className="aal-page">
      <PrintBar back={`/outings/${id}`} />
      <FormSheet landscape title="Site Specific Risk Assessment" meta={[`Date: ${assessed}`, 'Owner: SMJ Falconry', 'Retention period: 3 years']}>
        <DotLine>
          <Dot label="Assessed by:">{risk.assessed_by}</Dot>
          <Dot label="Site of Exhibit:" wide>{place}</Dot>
        </DotLine>
        <p>To be completed upon arrival at site.</p>
        <table className="aal-table">
          <thead>
            <tr>
              <th className="form-risk">Risks</th>
              <th>Measures taken (if required)</th>
              <th className="aal-yn">Checked</th>
            </tr>
          </thead>
          <tbody>
            {RISK_ROWS.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>{risk.rows?.[r.key]?.measures}</td>
                <td className="aal-yn form-c">{risk.rows?.[r.key]?.checked ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="form-gap">
          <strong>Any Further comments:</strong> {risk.comments}
        </p>
      </FormSheet>

      <div className="form-newpage">
        <FormSheet landscape serif title="R7(a): Risk Assessment Pro-forma.">
          <p>
            All license holders must conduct a risk assessment at each venue at which raptors are trained / exhibited. You must protect your birds against hazards that may cause harm or distress to them. This includes, <strong>discomfort, hunger/thirst, fear/distress and pain/injury/disease</strong>. As far as practical you must allow your raptors to demonstrate natural behaviour (including flying).
          </p>
          <p>Risk assessments must be re-visited when any significant change in circumstances occurs.</p>
          <DotLine>
            <Dot label="Your name:">{risk.assessed_by}</Dot>
            <Dot label="Location:" wide>{place}</Dot>
          </DotLine>
          <DotLine>
            <Dot label="Date of assessment:">{assessed}</Dot>
            <strong className="form-retain">Retain for 3 years</strong>
          </DotLine>
          <div className="form-band" />
          <table className="aal-table form-hazards">
            <thead>
              <tr>
                <th>What are the hazards?</th>
                <th>Type of harm that may be caused: discomfort, hunger/thirst, fear/distress, pain/injury, disease.</th>
                <th>Mitigation steps to be taken</th>
                <th>Do you need to do anything else to control this risk?</th>
                <th>Action by who?</th>
                <th>Action by when?</th>
                <th>Action confirmed by (initials)</th>
              </tr>
            </thead>
            <tbody>
              {hazards.map((h, i) => (
                <tr key={i}>
                  <td>{h.hazard}</td>
                  <td>{h.harm}</td>
                  <td>{h.mitigation}</td>
                  <td>{h.further}</td>
                  <td>{h.who}</td>
                  <td>{h.when}</td>
                  <td>{h.confirmed}</td>
                </tr>
              ))}
              <BlankRows have={hazards.length} upTo={5} cols={7} />
            </tbody>
          </table>
        </FormSheet>
      </div>
    </div>
  );
}
