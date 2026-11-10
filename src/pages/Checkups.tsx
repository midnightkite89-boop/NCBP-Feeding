import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { aviaryLabel, routeSort } from '../aviary';
import {
  CONDITION_SCORES,
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
        GROUPS.map(({ state, title }) => {
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
        })
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
    copedLabel(c) || null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Record one check. Saved straight away, so it needs a signal (it can be entered later with the right date). */
export function CheckupSheet({ bird, onClose, onSaved }: { bird: Bird; onClose: () => void; onSaved: () => void }) {
  const { today } = useStore();
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState<number | null>(null);
  const [weightInvalid, setWeightInvalid] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [beak, setBeak] = useState(false);
  const [talons, setTalons] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('bird_checkups').insert({
      bird_id: bird.id,
      checked_on: date,
      weight_g: weight,
      condition_score: score,
      coped_beak: beak,
      coped_talons: talons,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) return setError("Couldn't save – no signal? Try again when you have one; you can set the date it was done.");
    onSaved();
  }

  const nothing = weight == null && score == null && !beak && !talons && !notes.trim();

  return (
    <Sheet title={`${bird.name}: health check`} onClose={onClose}>
      <label className="field">
        <span>Date done</span>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
      </label>
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
      <div className="field">
        <span>Condition score (1 thin – 5 heavy)</span>
        <div className="score-grid" role="radiogroup" aria-label="Condition score">
          {CONDITION_SCORES.map((n) => (
            <button type="button" key={n} role="radio" aria-checked={score === n} className={score === n ? 'on' : ''} onClick={() => setScore(score === n ? null : n)}>
              {scoreLabel(n).replace('/5', '')}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={beak} onChange={(e) => setBeak(e.target.checked)} />
        <span>Beak coped</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={talons} onChange={(e) => setTalons(e.target.checked)} />
        <span>Talons coped</span>
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Feet, feathers, eyes, anything else" />
      </label>
      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" disabled={busy || weightInvalid || nothing} onClick={save}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </Sheet>
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
              {c.notes && <div className="muted">{c.notes}</div>}
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
