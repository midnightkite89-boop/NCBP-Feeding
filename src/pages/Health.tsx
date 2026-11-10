import { I } from '../components/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { daysBetween } from '../care';
import { courseDays, dosesToday, medDueOn, photoStatus, scheduleText, shrinkPhoto } from '../health';
import { useStore } from '../store';
import { nudgeDriveSync } from '../drive';
import { supabase } from '../supabase';
import { addDays, formatDay, formatTime } from '../time';
import { MED_TYPES, type Bird, type HealthEntry, type HealthIssue, type MedDose, type Medication, type MedType } from '../types';

const BUCKET = 'health-photos';

// ---------------------------------------------------------------------------
// Photos: shrink on the phone, upload, show with signed links
// ---------------------------------------------------------------------------

async function uploadPhotos(files: File[], folder: string): Promise<string[]> {
  const paths: string[] = [];
  for (const f of files) {
    const blob = await shrinkPhoto(f);
    const path = `${folder}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
    if (error) throw new Error(`Photo upload failed: ${error.message}`);
    paths.push(path);
  }
  return paths;
}

function usePhotoUrls(paths: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join('|');
  useEffect(() => {
    const missing = paths.filter((p) => !urls[p]);
    if (missing.length === 0) return;
    supabase.storage
      .from(BUCKET)
      .createSignedUrls(missing, 60 * 60 * 24)
      .then(({ data }) => {
        if (!data) return;
        setUrls((prev) => {
          const next = { ...prev };
          for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
          return next;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

function PhotoGrid({ paths, urls }: { paths: string[]; urls: Record<string, string> }) {
  if (paths.length === 0) return null;
  return (
    <div className="photo-grid">
      {paths.map((p) =>
        urls[p] ? (
          <a key={p} href={urls[p]} target="_blank" rel="noreferrer">
            <img src={urls[p]} alt="Health photo" loading="lazy" />
          </a>
        ) : (
          <span key={p} className="photo-loading" />
        ),
      )}
    </div>
  );
}

/** Take or choose photos; shows small previews before saving */
function PhotoPicker({ files, onChange, label = 'Add photos' }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);
  return (
    <div className="field">
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => onChange([...files, ...Array.from(e.target.files ?? [])])} />
      <button type="button" className="btn btn-outline btn-lg" onClick={() => input.current?.click()}>
        {label}
      </button>
      {files.length > 0 && (
        <div className="photo-grid">
          {previews.map((u, i) => (
            <span key={u} className="photo-preview">
              <img src={u} alt={`New photo ${i + 1}`} />
              <button type="button" aria-label="Remove photo" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BirdPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { birds } = useStore();
  const active = birds.filter((b) => b.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <label className="field">
      <span>Bird</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a bird…</option>
        {active.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.species ? ` – ${b.species}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

const needSignal = 'This needs signal (photos have to upload). Try again when you have it.';

// ---------------------------------------------------------------------------
// Health home
// ---------------------------------------------------------------------------

export function Health() {
  const { healthIssues, healthEntries, medications, doses, today, birds, loading } = useStore();
  if (loading) return <p className="empty">Loading…</p>;
  const nameOf = (id: string) => birds.find((b) => b.id === id)?.name ?? '?';
  const current = medications.filter((m) => !m.stopped_at && (!m.end_date || m.end_date >= today));

  return (
    <div className="health-page">
      <h1 className="page-title">Health</h1>
      <div className="bird-actions">
        <Link to="/health/issue/new" className="btn btn-primary btn-lg">
          + Health issue
        </Link>
        <Link to="/health/med/new" className="btn btn-outline btn-lg">
          + Medication
        </Link>
      </div>

      <DosesDue />

      <section className="panel">
        <h2>Open issues ({healthIssues.length})</h2>
        {healthIssues.length === 0 ? (
          <p className="muted">No open health issues.</p>
        ) : (
          <ul className="flight-list">
            {healthIssues.map((i) => {
              const ps = photoStatus(i, healthEntries, today);
              const n = healthEntries.filter((e) => e.issue_id === i.id).length;
              return (
                <li key={i.id}>
                  <Link to={`/health/issue/${i.id}`} className="flight-item">
                    <span className="flight-main">
                      <span><strong>{nameOf(i.bird_id)}</strong> · {i.title}</span>
                      <span className="meta">
                        Day {daysBetween(i.started_on, today) + 1} · {n} update{n === 1 ? '' : 's'}
                        {ps.last ? ` · last photo ${ps.days === 0 ? 'today' : `${ps.days}d ago`}` : ''}
                      </span>
                      {ps.due && <span className="photo-due"><I n="photo" /> Photo due</span>}
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
      </section>

      <section className="panel">
        <h2>Current medication ({current.length})</h2>
        {current.length === 0 ? (
          <p className="muted">No birds on medication.</p>
        ) : (
          <ul className="flight-list">
            {current.map((m) => (
              <li key={m.id}>
                <Link to={`/health/med/${m.id}`} className="flight-item">
                  <span className="flight-main">
                    <span><strong>{nameOf(m.bird_id)}</strong> · {m.name_dose}</span>
                    <span className="meta">
                      {m.amount} · {scheduleText(m)} · {m.end_date ? `until ${formatDay(m.end_date)}` : 'until stopped'}
                      {medDueOn(m, today) ? ` · ${doses.filter((d) => d.medication_id === m.id && d.dose_date === today).length}/${m.times_per_day} given today` : ''}
                    </span>
                  </span>
                  <span className="more-chevron" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PastIssues />
    </div>
  );
}

/** Doses still to give today, each with a GIVEN button. Used on Health and Today. */
export function DosesDue({ birdId, compact }: { birdId?: string; compact?: boolean }) {
  const { medications, doses, today, birds, giveDose, logName } = useStore();
  const list = dosesToday(medications, doses, today).filter((x) => !birdId || x.med.bird_id === birdId);
  if (list.length === 0) return compact ? null : null;
  const nameOf = (id: string) => birds.find((b) => b.id === id)?.name ?? '?';
  return (
    <section className={compact ? 'doses-due compact' : 'panel doses-due'}>
      {!compact && <h2><I n="meds" /> Medication today</h2>}
      <ul className="dose-list">
        {list.map(({ med, given, left }) => (
          <li key={med.id} className={left === 0 ? 'done' : ''}>
            <div className="dose-info">
              <Link to={`/health/med/${med.id}`}>
                <strong>{birdId ? <I n="meds" /> : `${nameOf(med.bird_id)}: `}</strong>
                {med.name_dose} – {med.amount}
              </Link>
              <div className="meta">
                {given.length}/{med.times_per_day} given
                {given.length > 0 && ` (${given.map((d) => `${formatTime(d.logged_at)} ${logName(d)}${d.pending ? ' · not sent' : ''}`).join(', ')})`}
                {med.notes && ` · ${med.notes}`}
              </div>
            </div>
            {left > 0 ? (
              <button className="btn btn-primary dose-btn" onClick={() => giveDose(med, `${nameOf(med.bird_id)}: ${med.name_dose} given`)}>
                Given
              </button>
            ) : (
              <span className="chip clean-chip-ok">✓ Done</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PastIssues() {
  const { birds } = useStore();
  const [list, setList] = useState<HealthIssue[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || list) return;
    supabase
      .from('health_issues')
      .select('*')
      .not('closed_at', 'is', null)
      .is('voided_at', null)
      .order('closed_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setList((data ?? []) as HealthIssue[]));
  }, [open, list]);
  return (
    <section className="panel">
      <button className="btn btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} Closed issues
      </button>
      {open &&
        (list == null ? (
          <p className="muted">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="flight-list">
            {list.map((i) => (
              <li key={i.id}>
                <Link to={`/health/issue/${i.id}`} className="flight-item">
                  <span className="flight-main">
                    <span><strong>{birds.find((b) => b.id === i.bird_id)?.name ?? '?'}</strong> · {i.title}</span>
                    <span className="meta">
                      {formatDay(i.started_on)} – {i.closed_at ? formatDay(i.closed_at.slice(0, 10)) : ''}
                      {i.outcome && ` · ${i.outcome}`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// New issue
// ---------------------------------------------------------------------------

export function NewIssue() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { refreshHealth, today, actingFields } = useStore();
  const [birdId, setBirdId] = useState(params.get('bird') ?? '');
  const [title, setTitle] = useState('');
  const [started, setStarted] = useState(today);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [every, setEvery] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!birdId) return setError('Choose the bird.');
    if (!title.trim()) return setError('Say what the issue is, e.g. "Cut on right ear".');
    if (!navigator.onLine) return setError(needSignal);
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from('health_issues')
        .insert({ bird_id: birdId, title: title.trim(), started_on: started, photo_every_days: every || null })
        .select()
        .single();
      if (e) throw new Error(e.message);
      const issue = data as HealthIssue;
      if (files.length || notes.trim()) {
        const photo_paths = await uploadPhotos(files, `${birdId}/${issue.id}`);
        const { error: e2 } = await supabase.from('health_entries').insert({ issue_id: issue.id, bird_id: birdId, notes: notes.trim() || null, photo_paths, ...actingFields() });
        if (e2) throw new Error(e2.message);
      }
      nudgeDriveSync();
      await refreshHealth();
      navigate(`/health/issue/${issue.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="health-page">
      <h1 className="page-title">New health issue</h1>
      <BirdPicker value={birdId} onChange={setBirdId} />
      <label className="field">
        <span>What's the issue?</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dry, cracking front toes" />
      </label>
      <label className="field">
        <span>First noticed</span>
        <input type="date" value={started} max={today} onChange={(e) => setStarted(e.target.value)} />
      </label>
      <PhotoPicker files={files} onChange={setFiles} />
      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you see, what you did (e.g. cream applied)" />
      </label>
      <PhotoReminderPicker value={every} onChange={setEvery} />
      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save issue'}
      </button>
    </div>
  );
}

function PhotoReminderPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="field">
      <span>Photo reminder</span>
      <div className="segmented-chips">
        {[0, 1, 2, 3, 7].map((n) => (
          <button key={n} type="button" className={`pick-chip${value === n ? ' on' : ''}`} aria-pressed={value === n} onClick={() => onChange(n)}>
            {n === 0 ? 'Off' : n === 1 ? 'Daily' : `Every ${n} days`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One issue: timeline of photos and notes
// ---------------------------------------------------------------------------

export function IssuePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { birds, staffName, logName, today, refreshHealth, medications, actingFields } = useStore();
  const [issue, setIssue] = useState<HealthIssue | null>(null);
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  const [action, setAction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  async function load() {
    const [i, e, m] = await Promise.all([
      supabase.from('health_issues').select('*').eq('id', id).maybeSingle(),
      supabase.from('health_entries').select('*').eq('issue_id', id).is('voided_at', null).order('logged_at', { ascending: false }),
      supabase.from('medications').select('*').eq('issue_id', id).is('voided_at', null).order('created_at'),
    ]);
    setIssue((i.data as HealthIssue) ?? null);
    setEntries((e.data ?? []) as HealthEntry[]);
    setMeds((m.data ?? []) as Medication[]);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, medications]);

  const allPaths = entries.flatMap((e) => e.photo_paths);
  const urls = usePhotoUrls(allPaths);
  if (!issue) return <p className="empty">Loading…</p>;
  const bird = birds.find((b) => b.id === issue.bird_id);
  const withPhotos = entries.filter((e) => e.photo_paths.length > 0);
  const first = withPhotos.at(-1);
  const latest = withPhotos[0];
  const ps = photoStatus(issue, entries, today);

  async function addEntry() {
    if (!files.length && !notes.trim() && !action.trim()) return setError('Add a photo or a note.');
    if (!navigator.onLine) return setError(needSignal);
    setBusy(true);
    setError(null);
    try {
      const photo_paths = await uploadPhotos(files, `${issue!.bird_id}/${issue!.id}`);
      const { error: e } = await supabase.from('health_entries').insert({ issue_id: issue!.id, bird_id: issue!.bird_id, notes: notes.trim() || null, action: action.trim() || null, photo_paths, ...actingFields() });
      if (e) throw new Error(e.message);
      nudgeDriveSync();
      setFiles([]);
      setNotes('');
      setAction('');
      await Promise.all([load(), refreshHealth()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rpc(fn: string, args: Record<string, unknown>) {
    const { error: e } = await supabase.rpc(fn, args);
    if (e) setError(e.message);
    await Promise.all([load(), refreshHealth()]);
  }

  return (
    <div className="health-page">
      <button className="btn btn-outline back-btn" onClick={() => navigate(-1)}>
        ‹ Back
      </button>
      <h1 className="page-title">
        {bird?.name ?? '?'} · {issue.title}
      </h1>
      <p className="muted">
        Started {formatDay(issue.started_on)} (day {daysBetween(issue.started_on, issue.closed_at ? issue.closed_at.slice(0, 10) : today) + 1}) · opened by {staffName(issue.opened_by)}
        {issue.closed_at && ` · closed ${formatDay(issue.closed_at.slice(0, 10))} by ${staffName(issue.closed_by)}${issue.outcome ? `: ${issue.outcome}` : ''}`}
      </p>
      {bird?.drive_folder_url && (
        <p>
          <a href={bird.drive_folder_url} target="_blank" rel="noreferrer">
            <I n="folder" /> {bird.name}'s Drive folder
          </a>
        </p>
      )}
      {ps.due && <p className="photo-due big"><I n="photo" /> A photo is due (every {issue.photo_every_days} day{issue.photo_every_days === 1 ? '' : 's'})</p>}

      {!issue.closed_at && (
        <section className="panel">
          <h2>Add an update</h2>
          <PhotoPicker files={files} onChange={setFiles} />
          <label className="field">
            <span>What you see</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. healing well, less redness" />
          </label>
          <label className="field">
            <span>Action taken (optional)</span>
            <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. cream applied, vet called" />
          </label>
          {error && <p className="warn">{error}</p>}
          <button className="btn btn-primary btn-xl" disabled={busy} onClick={addEntry}>
            {busy ? 'Saving…' : 'Save update'}
          </button>
        </section>
      )}

      {first && latest && first !== latest && (
        <button className="btn btn-outline btn-lg compare-btn" onClick={() => setCompare(!compare)} aria-expanded={compare}>
          {compare ? 'Hide comparison' : 'Compare first and latest photo'}
        </button>
      )}
      {compare && first && latest && (
        <div className="compare">
          {[first, latest].map((e, k) => (
            <figure key={e.id}>
              {urls[e.photo_paths[0]] ? <img src={urls[e.photo_paths[0]]} alt={k ? 'Latest photo' : 'First photo'} /> : <span className="photo-loading" />}
              <figcaption>
                {k ? 'Latest' : 'First'} · {formatDay(e.log_date)} (day {daysBetween(issue.started_on, e.log_date) + 1})
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <section className="timeline">
        <h2>Timeline</h2>
        {entries.length === 0 && <p className="muted">No updates yet.</p>}
        {entries.map((e) => (
          <article key={e.id} className="timeline-entry">
            <header>
              <strong>
                {formatDay(e.log_date)} · day {daysBetween(issue.started_on, e.log_date) + 1}
              </strong>
              <span className="meta">
                {formatTime(e.logged_at)} · {logName(e)}
              </span>
            </header>
            {e.notes && <p>{e.notes}</p>}
            {e.action && (
              <p>
                <strong>Action:</strong> {e.action}
              </p>
            )}
            <PhotoGrid paths={e.photo_paths} urls={urls} />
            {removing === e.id ? (
              <span className="confirm-inline">
                <span>Remove this update? It stays on record as removed.</span>
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    setRemoving(null);
                    await rpc('void_health_row', { p_table: 'health_entries', p_id: e.id });
                  }}
                >
                  Remove
                </button>
                <button className="btn btn-outline" onClick={() => setRemoving(null)}>
                  Keep
                </button>
              </span>
            ) : (
              <button className="btn btn-ghost entry-remove" onClick={() => setRemoving(e.id)}>
                Remove
              </button>
            )}
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Medication for this</h2>
        {meds.length === 0 ? (
          <p className="muted">None linked.</p>
        ) : (
          <ul className="flight-list">
            {meds.map((m) => (
              <li key={m.id}>
                <Link to={`/health/med/${m.id}`} className="flight-item">
                  <span className="flight-main">
                    <strong>{m.name_dose}</strong>
                    <span className="meta">
                      {m.amount} · {scheduleText(m)} · {formatDay(m.start_date)}
                      {m.end_date ? ` – ${formatDay(m.end_date)}` : ''}
                      {m.stopped_at ? ' · stopped' : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!issue.closed_at && (
          <Link to={`/health/med/new?bird=${issue.bird_id}&issue=${issue.id}`} className="btn btn-outline">
            + Medication for this issue
          </Link>
        )}
      </section>

      <section className="panel">
        {issue.closed_at ? (
          <button className="btn btn-outline btn-lg" onClick={() => rpc('reopen_health_issue', { p_id: issue.id })}>
            Reopen issue
          </button>
        ) : (
          <>
            <PhotoReminderPicker value={issue.photo_every_days ?? 0} onChange={(n) => rpc('set_photo_reminder', { p_id: issue.id, p_days: n })} />
            {closing ? (
              <>
                <label className="field">
                  <span>How did it end?</span>
                  <input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="e.g. Healed fully" autoFocus />
                </label>
                <div className="bird-actions">
                  <button className="btn btn-outline btn-lg" onClick={() => setClosing(false)}>
                    Cancel
                  </button>
                  <button className="btn btn-primary btn-lg" onClick={() => rpc('close_health_issue', { p_id: issue.id, p_outcome: outcome })}>
                    Close issue
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-outline btn-lg" onClick={() => setClosing(true)}>
                ✓ Issue resolved – close it
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New medication: the top half of the paper chart
// ---------------------------------------------------------------------------

export function NewMedication() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { healthIssues, today, refreshHealth } = useStore();
  const [birdId, setBirdId] = useState(params.get('bird') ?? '');
  const [issueId, setIssueId] = useState(params.get('issue') ?? '');
  const [name, setName] = useState('');
  const [type, setType] = useState<MedType>('fluid');
  const [amount, setAmount] = useState('');
  const [times, setTimes] = useState(1);
  const [every, setEvery] = useState(1);
  const [start, setStart] = useState(today);
  const [days, setDays] = useState('7');
  const [notes, setNotes] = useState('');
  const [vet, setVet] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues = healthIssues.filter((i) => i.bird_id === birdId);
  const nDays = days.trim() ? Math.max(1, Math.round(Number(days))) : null;

  async function save() {
    if (!birdId) return setError('Choose the bird.');
    if (!name.trim()) return setError('Add the medication name and strength, e.g. "Meloxicam 1.5mg/ml".');
    if (!amount.trim()) return setError('Add the amount to give, e.g. 0.07ml.');
    if (days.trim() && !(Number(days) > 0)) return setError('Course length should be a number of days, or leave it blank for "until stopped".');
    if (files.length && !navigator.onLine) return setError(needSignal);
    setBusy(true);
    setError(null);
    try {
      const prescription_paths = await uploadPhotos(files, `${birdId}/prescriptions`);
      const { data, error: e } = await supabase
        .from('medications')
        .insert({
          bird_id: birdId,
          issue_id: issueId || null,
          name_dose: name.trim(),
          med_type: type,
          amount: amount.trim(),
          times_per_day: times,
          every_days: every,
          start_date: start,
          end_date: nDays ? addDays(start, nDays - 1) : null,
          notes: notes.trim() || null,
          prescribed_by: vet.trim() || null,
          prescription_paths,
        })
        .select()
        .single();
      if (e) throw new Error(e.message);
      nudgeDriveSync();
      await refreshHealth();
      navigate(`/health/med/${(data as Medication).id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="health-page">
      <h1 className="page-title">New medication</h1>
      <BirdPicker
        value={birdId}
        onChange={(v) => {
          setBirdId(v);
          setIssueId('');
        }}
      />
      {issues.length > 0 && (
        <label className="field">
          <span>For which issue? (optional)</span>
          <select value={issueId} onChange={(e) => setIssueId(e.target.value)}>
            <option value="">Not linked</option>
            {issues.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <PhotoPicker files={files} onChange={setFiles} label="Photo of the prescription" />
      <label className="field">
        <span>Name of medication and strength</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meloxicam 1.5mg/ml oral" />
      </label>
      <div className="field">
        <span>Type</span>
        <div className="segmented-chips">
          {MED_TYPES.map((t) => (
            <button key={t.value} type="button" className={`pick-chip${type === t.value ? ' on' : ''}`} aria-pressed={type === t.value} onClick={() => setType(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Amount to give each time</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 0.07ml" />
      </label>
      <div className="field-row">
        <div className="field">
          <span>Times a day</span>
          <div className="stepper">
            <button type="button" onClick={() => setTimes(Math.max(1, times - 1))} disabled={times <= 1} aria-label="Fewer times a day">
              −
            </button>
            <output>{times}</output>
            <button type="button" onClick={() => setTimes(Math.min(6, times + 1))} disabled={times >= 6} aria-label="More times a day">
              +
            </button>
          </div>
        </div>
      </div>
      <div className="field">
        <span>How often</span>
        <div className="segmented-chips">
          {[1, 2, 3, 7].map((n) => (
            <button key={n} type="button" className={`pick-chip${every === n ? ' on' : ''}`} aria-pressed={every === n} onClick={() => setEvery(n)}>
              {n === 1 ? 'Every day' : n === 2 ? 'Every other day' : n === 7 ? 'Weekly' : `Every ${n} days`}
            </button>
          ))}
        </div>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Start</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>For how many days</span>
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="until stopped" />
        </label>
      </div>
      <p className="muted">{nDays ? `Last day: ${formatDay(addDays(start, nDays - 1))}.` : 'No end date: it carries on until someone stops it.'}</p>
      <label className="field">
        <span>Additional information</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Give with food" />
      </label>
      <label className="field">
        <span>Prescribed by (vet, optional)</span>
        <input value={vet} onChange={(e) => setVet(e.target.value)} />
      </label>
      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save medication'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One medication: details and the dose chart (the bottom half of the paper)
// ---------------------------------------------------------------------------

export function MedicationPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { birds, staffName, logName, today, doses: liveDoses, refreshHealth, giveDose, voidDose } = useStore();
  const [med, setMed] = useState<Medication | null>(null);
  const [past, setPast] = useState<MedDose[]>([]);
  const [stopping, setStopping] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [m, d] = await Promise.all([
      supabase.from('medications').select('*').eq('id', id).maybeSingle(),
      supabase.from('med_doses').select('*').eq('medication_id', id).is('voided_at', null).order('logged_at'),
    ]);
    setMed((m.data as Medication) ?? null);
    setPast((d.data ?? []) as MedDose[]);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const urls = usePhotoUrls(med?.prescription_paths ?? []);
  if (!med) return <p className="empty">Loading…</p>;
  const bird: Bird | undefined = birds.find((b) => b.id === med.bird_id);

  // Server doses plus anything given on this phone since (including unsent)
  const byId = new Map<string, MedDose>();
  for (const d of past) byId.set(d.id, d);
  for (const d of liveDoses) if (d.medication_id === med.id) byId.set(d.id, d);
  const liveIds = new Set(liveDoses.map((d) => d.id));
  const all = [...byId.values()].filter((d) => d.dose_date < addDays(today, -1) || liveIds.has(d.id)).sort((a, b) => a.logged_at.localeCompare(b.logged_at));

  // The whole course, like the paper chart; open-ended courses run to today
  const lastDay = [med.end_date ?? today, med.stopped_at?.slice(0, 10)].filter((x): x is string => !!x).sort()[0];
  const chartDays: string[] = [];
  for (let d = med.start_date; d <= lastDay && chartDays.length < 120; d = addDays(d, 1)) if (medDueOn({ ...med, stopped_at: null }, d)) chartDays.push(d);
  const todayDoses = all.filter((d) => d.dose_date === today);
  const dueToday = !med.stopped_at && medDueOn(med, today) && todayDoses.length < med.times_per_day;
  const course = courseDays(med);

  return (
    <div className="health-page">
      <button className="btn btn-outline back-btn" onClick={() => navigate(-1)}>
        ‹ Back
      </button>
      <h1 className="page-title">
        <I n="meds" /> {bird?.name ?? '?'} · {med.name_dose}
      </h1>
      {med.stopped_at && (
        <p className="warn">
          Stopped {formatDay(med.stopped_at.slice(0, 10))} by {staffName(med.stopped_by)}
          {med.stop_reason ? `: ${med.stop_reason}` : ''}
        </p>
      )}
      <dl className="facts med-facts">
        <dt>Type</dt>
        <dd>{MED_TYPES.find((t) => t.value === med.med_type)?.label}</dd>
        <dt>Amount</dt>
        <dd>{med.amount}</dd>
        <dt>Frequency</dt>
        <dd>{scheduleText(med)}</dd>
        <dt>Course</dt>
        <dd>
          {formatDay(med.start_date)} – {med.end_date ? formatDay(med.end_date) : 'until stopped'}
          {course ? ` (${course} days)` : ''}
        </dd>
        {med.notes && (
          <>
            <dt>Info</dt>
            <dd>{med.notes}</dd>
          </>
        )}
        {med.prescribed_by && (
          <>
            <dt>Vet</dt>
            <dd>{med.prescribed_by}</dd>
          </>
        )}
        <dt>Set up by</dt>
        <dd>
          {staffName(med.created_by)}, {formatDay(med.created_at.slice(0, 10))}
        </dd>
      </dl>
      {med.issue_id && (
        <p>
          <Link to={`/health/issue/${med.issue_id}`}>Go to the health issue ›</Link>
        </p>
      )}
      <PhotoGrid paths={med.prescription_paths} urls={urls} />

      {dueToday && (
        <button className="btn btn-primary btn-xl" onClick={() => giveDose(med, `${bird?.name}: ${med.name_dose} given`)}>
          GIVEN – {med.amount} ({todayDoses.length + 1} of {med.times_per_day} today)
        </button>
      )}

      <h2>Dose chart</h2>
      <div className="med-chart-wrap">
        <table className="med-chart">
          <thead>
            <tr>
              <th>Date</th>
              {Array.from({ length: med.times_per_day }, (_, i) => (
                <th key={i}>{med.times_per_day > 1 ? `Dose ${i + 1}` : 'Given'}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chartDays.map((d) => {
              const given = all.filter((x) => x.dose_date === d);
              return (
                <tr key={d} className={d === today ? 'is-today' : ''}>
                  <th>{formatDay(d)}</th>
                  {Array.from({ length: med.times_per_day }, (_, i) => {
                    const g = given[i];
                    if (g)
                      return (
                        <td key={i} className="given">
                          ✓ {formatTime(g.logged_at)} {logName(g)}
                          {g.pending && ' · not sent'}
                          {d >= addDays(today, -1) && (
                            <button className="btn-ghost undo-dose" onClick={() => voidDose(g.id)} aria-label="Undo this dose">
                              ✕
                            </button>
                          )}
                        </td>
                      );
                    return (
                      <td key={i} className={d < today ? 'missed' : d === today ? 'due' : 'upcoming'}>
                        {d < today ? 'Not given' : d === today ? 'Due' : ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="warn">{error}</p>}

      {!med.stopped_at &&
        (stopping ? (
          <section className="panel">
            <label className="field">
              <span>Why is it stopping?</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Vet said stop, course finished early" autoFocus />
            </label>
            <div className="bird-actions">
              <button className="btn btn-outline btn-lg" onClick={() => setStopping(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger btn-lg"
                onClick={async () => {
                  const { error: e } = await supabase.rpc('stop_medication', { p_id: med.id, p_reason: reason });
                  if (e) setError(e.message);
                  setStopping(false);
                  await Promise.all([load(), refreshHealth()]);
                }}
              >
                Stop medication
              </button>
            </div>
          </section>
        ) : (
          <button className="btn btn-outline btn-lg" onClick={() => setStopping(true)}>
            Stop this medication
          </button>
        ))}
    </div>
  );
}
