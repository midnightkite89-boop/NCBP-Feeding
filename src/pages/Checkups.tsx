import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { aviaryLabel, routeSort } from '../aviary';
import {
  CHECK_ITEMS,
  CONDITION_SCORES,
  checkNotes,
  checkupEvery,
  checkupStatus,
  copedLabel,
  getsCheckups,
  scoreLabel,
  useCheckups,
  type CheckupState,
} from '../checkups';
import { Sheet } from '../components/Sheet';
import { has } from '../centre';
import { WeightInput } from '../components/WeightInput';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { formatDay } from '../time';
import type { Bird, BirdCheckup } from '../types';
import { formatWeight } from '../weight';

const GROUPS: { state: CheckupState; title: string }[] = [
  { state: 'overdue', title: 'Overdue' },
  { state: 'never', title: 'Not checked yet' },
  { state: 'soon', title: 'Due in the next month' },
  { state: 'ok', title: 'Done' },
];

/** Twice-yearly hands-on checks: who is due, and a quick way to record one */
export function Checkups() {
  const { birds, aviaries, today, careSettings } = useStore();
  const { checkups, error, reload } = useCheckups();
  const [recording, setRecording] = useState<Bird | null>(null);
  const every = checkupEvery(careSettings);

  const rows = useMemo(() => {
    const list = routeSort(birds.filter(getsCheckups), aviaries);
    return list.map((bird) => ({ bird, status: checkupStatus(bird.id, checkups ?? [], today, every) }));
  }, [birds, aviaries, checkups, today, every]);

  return (
    <div className="checkups-page">
      <h1 className="page-title">Health checks</h1>
      <p className="muted">
        Breeding, aviary and resting birds: caught up, weighed, condition scored and coped. Due every {Math.round(every / 30.4)} months.
      </p>
      {error && <p className="warn">{error}</p>}
      {checkups == null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
        <ToZims checkups={checkups} onChanged={() => void reload()} />
        {GROUPS.map(({ state, title }) => {
          const group = rows.filter((r) => r.status.state === state);
          if (group.length === 0) return null;
          return (
            <section key={state} className={`checkup-group checkup-${state}`}>
              <h2>
                {title} <span className="muted">({group.length})</span>
              </h2>
              <ul className="checkup-list">
                {group.map(({ bird, status }) => {
                  const a = aviaries.find((x) => x.id === bird.aviary_id);
                  return (
                    <li key={bird.id}>
                      <button className="checkup-row" onClick={() => setRecording(bird)}>
                        <span className="checkup-name">
                          <strong>{bird.name}</strong>
                          <span className="muted"> {a ? aviaryLabel(a) : ''}</span>
                        </span>
                        <span className="checkup-last muted">
                          {status.last ? `${formatDay(status.last.checked_on)} · ${checkupSummary(status.last, bird)}` : 'Never'}
                          {status.dueOn && state !== 'ok' && ` · due ${formatDay(status.dueOn)}`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        </>
      )}
      {recording && (
        <CheckupSheet
          bird={recording}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

export function checkupSummary(c: BirdCheckup, bird: Bird): string {
  return [
    c.weight_g != null ? formatWeight(c.weight_g, bird.weight_unit) : null,
    c.condition_score != null ? `condition ${scoreLabel(c.condition_score)}` : null,
    checkNotes(c) || copedLabel(c) || null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Record one check, laid out like NCBP's paper form: ring, condition score and weight, then a
 * tick and a note for each area. Saved straight away, so it needs a signal (the date can be set
 * if it's entered later).
 */
export function CheckupSheet({ bird, onClose, onSaved }: { bird: Bird; onClose: () => void; onSaved: () => void }) {
  const { today } = useStore();
  const [date, setDate] = useState(today);
  const [ring, setRing] = useState(bird.ring_microchip ?? '');
  const [withWho, setWithWho] = useState('');
  const [weight, setWeight] = useState<number | null>(null);
  const [weightInvalid, setWeightInvalid] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<string, { ok: boolean; note?: string }>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setItem = (key: string, patch: Partial<{ ok: boolean; note: string }>) => setChecks((c) => ({ ...c, [key]: { ...c[key], ok: c[key]?.ok ?? false, ...patch } }));
  const allTicked = CHECK_ITEMS.every((i) => checks[i.key]?.ok);

  async function save() {
    setBusy(true);
    setError(null);
    const clean = Object.fromEntries(
      Object.entries(checks)
        .map(([k, v]) => [k, { ok: v.ok, ...(v.note?.trim() ? { note: v.note.trim() } : {}) }] as const)
        .filter(([, v]) => v.ok || v.note),
    );
    const note = (k: string) => (clean[k]?.note ?? '').toLowerCase();
    const { error } = await supabase.from('bird_checkups').insert({
      bird_id: bird.id,
      checked_on: date,
      weight_g: weight,
      condition_score: score,
      checks: clean,
      ring_seen: ring.trim() || null,
      done_with: withWho.trim() || null,
      // Kept for older screens: a note saying the beak or talons were coped / trimmed
      coped_beak: /cop|trim/.test(note('beak_out')),
      coped_talons: /cop|trim/.test(note('talons')),
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) return setError("Couldn't save – no signal? Try again when you have one; you can set the date it was done.");
    onSaved();
  }

  const nothing = weight == null && score == null && Object.keys(checks).length === 0 && !notes.trim();

  return (
    <Sheet title={`${bird.name}: health check`} onClose={onClose}>
      <p className="muted checkup-who">
        {[bird.species, bird.sex === 'M' ? 'Male' : bird.sex === 'F' ? 'Female' : null].filter(Boolean).join(' · ')}
      </p>
      <div className="field-row">
        <label className="field">
          <span>Date done</span>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </label>
        <label className="field">
          <span>Done with</span>
          <input value={withWho} onChange={(e) => setWithWho(e.target.value)} placeholder="Second person" />
        </label>
      </div>
      <label className="field">
        <span>Ring / microchip</span>
        <input value={ring} onChange={(e) => setRing(e.target.value)} placeholder="As read today" />
      </label>
      <div className="field">
        <span>Condition score</span>
        <div className="score-grid" role="radiogroup" aria-label="Condition score">
          {CONDITION_SCORES.map((n) => (
            <button type="button" key={n} role="radio" aria-checked={score === n} className={score === n ? 'on' : ''} onClick={() => setScore(score === n ? null : n)}>
              {scoreLabel(n)}
            </button>
          ))}
        </div>
      </div>
      <WeightInput
        label="Weight"
        unit={bird.weight_unit ?? 'g'}
        grams={null}
        placeholder="Optional"
        onChange={(g, invalid) => {
          setWeight(g);
          setWeightInvalid(invalid);
        }}
      />
      {weightInvalid && <p className="warn">That doesn't look like a weight.</p>}

      <div className="check-items">
        <div className="check-items-head">
          <strong>Checked</strong>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setChecks((c) => Object.fromEntries(CHECK_ITEMS.map((i) => [i.key, { ...c[i.key], ok: !allTicked }])))}
          >
            {allTicked ? 'Untick all' : 'Tick all'}
          </button>
        </div>
        {CHECK_ITEMS.map((i) => {
          const c = checks[i.key];
          return (
            <div key={i.key} className={`check-item${c?.ok ? ' ok' : ''}`}>
              <button type="button" className="check-tick" aria-pressed={!!c?.ok} onClick={() => setItem(i.key, { ok: !c?.ok })}>
                <span className="check-box" aria-hidden="true">
                  {c?.ok ? '✓' : ''}
                </span>
                {i.label}
              </button>
              <input className="check-note" value={c?.note ?? ''} onChange={(e) => setItem(i.key, { note: e.target.value })} placeholder="Note" aria-label={`${i.label} note`} />
            </div>
          );
        })}
      </div>
      <label className="field">
        <span>Other notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything else. Photos can go on a health issue." />
      </label>
      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" disabled={busy || weightInvalid || nothing} onClick={save}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </Sheet>
  );
}

/** "Added to ZIMS" tick, done afterwards by whoever transcribes it */
export function ZimsTick({ checkup, onChanged }: { checkup: BirdCheckup; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const done = !!checkup.zims_at;
  return (
    <button
      type="button"
      className={`zims-tick${done ? ' done' : ''}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabase.rpc('mark_checkup_zims', { p_id: checkup.id, p_done: !done });
        setBusy(false);
        onChanged();
      }}
    >
      <span className="check-box" aria-hidden="true">
        {done ? '✓' : ''}
      </span>
      {done ? 'Added to ZIMS' : 'Add to ZIMS, then tick'}
    </button>
  );
}

/** On a bird's page: the last checks and a button to record one */
export function BirdCheckups({ bird }: { bird: Bird }) {
  const { today, careSettings } = useStore();
  const { checkups, reload } = useCheckups();
  const [recording, setRecording] = useState(false);
  if (!has('checkups') || (!getsCheckups(bird) && !(checkups ?? []).some((c) => c.bird_id === bird.id))) return null;
  const mine = (checkups ?? []).filter((c) => c.bird_id === bird.id).reverse();
  const status = checkupStatus(bird.id, checkups ?? [], today, checkupEvery(careSettings));
  return (
    <section className="bird-checkups">
      <h2>Health checks</h2>
      {checkups == null ? (
        <p className="muted">Loading…</p>
      ) : mine.length === 0 ? (
        <p className="muted">Not checked yet.</p>
      ) : (
        <ul>
          {mine.slice(0, 4).map((c) => (
            <li key={c.id}>
              <strong>{formatDay(c.checked_on)}</strong> · {checkupSummary(c, bird) || 'checked'}
              {c.done_with && <span className="muted"> · with {c.done_with}</span>}
              {c.notes && <div className="muted">{c.notes}</div>}
              <ZimsTick checkup={c} onChanged={() => void reload()} />
            </li>
          ))}
        </ul>
      )}
      {status.dueOn && <p className={status.state === 'overdue' ? 'warn' : 'muted'}>Next due {formatDay(status.dueOn)}</p>}
      <button className="btn btn-outline btn-lg" onClick={() => setRecording(true)}>
        + Record a health check
      </button>
      <Link to="/checkups" className="btn btn-ghost">
        All health checks
      </Link>
      {recording && (
        <CheckupSheet
          bird={bird}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            void reload();
          }}
        />
      )}
    </section>
  );
}

/** Checks not yet added to ZIMS, so whoever does the transcribing can work through them */
function ToZims({ checkups, onChanged }: { checkups: BirdCheckup[]; onChanged: () => void }) {
  const { birds } = useStore();
  const waiting = checkups.filter((c) => !c.zims_at).sort((a, b) => b.checked_on.localeCompare(a.checked_on));
  if (waiting.length === 0) return null;
  return (
    <section className="checkup-group checkup-zims">
      <h2>
        To add to ZIMS <span className="muted">({waiting.length})</span>
      </h2>
      <ul className="checkup-list">
        {waiting.map((c) => {
          const bird = birds.find((b) => b.id === c.bird_id);
          if (!bird) return null;
          return (
            <li key={c.id} className="zims-row">
              <div>
                <strong>{bird.name}</strong> <span className="muted">{formatDay(c.checked_on)}</span>
                <div className="checkup-last muted">
                  {[c.ring_seen && `ring ${c.ring_seen}`, checkupSummary(c, bird), c.notes].filter(Boolean).join(' · ') || 'checked'}
                </div>
              </div>
              <ZimsTick checkup={c} onChanged={onChanged} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
