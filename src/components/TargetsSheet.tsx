import { useEffect, useState } from 'react';
import { defaultFeed } from '../status';
import { formatQty, parseQty } from '../food';
import { useStore } from '../store';
import { supabase } from '../supabase';
import { formatDay, formatTime } from '../time';
import { formatWeight } from '../weight';
import type { Bird } from '../types';
import { QtyStepper } from './FoodPicker';
import { Sheet } from './Sheet';
import { WeightInput } from './WeightInput';

/** Staff can change only these: target weight range and the usual amount of food */
export function TargetsSheet({ bird, onClose }: { bird: Bird; onClose: () => void }) {
  const { refresh, acting } = useStore();
  const usual = defaultFeed(bird);
  const numeric = parseQty(bird.default_portion) != null || !bird.default_portion;
  const [min, setMin] = useState<number | null>(bird.target_weight_min);
  const [max, setMax] = useState<number | null>(bird.target_weight_max);
  const [bad, setBad] = useState({ min: false, max: false });
  const [qty, setQty] = useState(usual.qty);
  const [portionText, setPortionText] = useState(bird.default_portion ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (bad.min || bad.max) return setError('Check the target weights.');
    if (min != null && max != null && min > max) return setError('Target min is bigger than target max.');
    if (!navigator.onLine) return setError('Changing targets needs signal. Try again when you have it.');
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.rpc('set_bird_targets', {
      p_bird: bird.id,
      p_min: min,
      p_max: max,
      p_portion: numeric ? formatQty(qty) : portionText.trim(),
      p_note: note.trim() || null,
      p_for: acting?.id ?? null,
      p_for_name: acting?.name ?? null,
    });
    setBusy(false);
    if (e) return setError(e.message);
    onClose();
    void refresh();
  }

  return (
    <Sheet title={`Targets – ${bird.name}`} onClose={onClose}>
      <WeightInput label="Target min" unit={bird.weight_unit} grams={min} onChange={(g, invalid) => (setMin(g), setBad((b) => ({ ...b, min: invalid })))} />
      <WeightInput label="Target max" unit={bird.weight_unit} grams={max} onChange={(g, invalid) => (setMax(g), setBad((b) => ({ ...b, max: invalid })))} />
      {numeric ? (
        <QtyStepper label={`Usual amount a day (${usual.food})`} value={qty} onChange={setQty} />
      ) : (
        <label className="field">
          <span>Usual amount a day ({usual.food})</span>
          <input value={portionText} onChange={(e) => setPortionText(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Why? (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. going into moult, flying weight" />
      </label>
      <p className="muted">The change is recorded with your name and the time.</p>
      {error && <p className="warn">{error}</p>}
      <button className="btn btn-primary btn-xl" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </Sheet>
  );
}

interface Change {
  id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_for: string | null;
  changed_for_name: string | null;
  note: string | null;
  changed_at: string;
}

const FIELD: Record<string, string> = {
  target_weight_min: 'Target min',
  target_weight_max: 'Target max',
  default_portion: 'Usual amount',
  default_food: 'Usual food',
};

/** Admins only: who changed the targets and usual food, and when */
export function TargetHistory({ bird }: { bird: Bird }) {
  const { isAdmin, staffName, birds } = useStore();
  const [rows, setRows] = useState<Change[] | null>(null);
  const [open, setOpen] = useState(false);
  const current = birds.find((b) => b.id === bird.id);

  useEffect(() => {
    if (!isAdmin || !open) return;
    supabase
      .from('bird_changes')
      .select('*')
      .eq('bird_id', bird.id)
      .order('changed_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setRows((data ?? []) as Change[]));
  }, [isAdmin, open, bird.id, current?.target_weight_min, current?.target_weight_max, current?.default_portion, current?.default_food]);

  if (!isAdmin) return null;
  const show = (field: string, v: string | null) =>
    v == null || v === '' ? '–' : field.startsWith('target_weight') ? formatWeight(Number(v), bird.weight_unit) : v;
  const who = (c: Change) =>
    c.changed_for_name
      ? `${c.changed_for_name} (volunteer, on ${staffName(c.changed_by)})`
      : c.changed_for
        ? `${staffName(c.changed_for)} (on ${staffName(c.changed_by)})`
        : c.changed_by
          ? staffName(c.changed_by)
          : 'Supabase';

  return (
    <section className="panel">
      <button className="btn btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} Target changes <span className="muted">(admins only)</span>
      </button>
      {open &&
        (rows == null ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No changes recorded yet.</p>
        ) : (
          <ul className="log-list change-list">
            {rows.map((c) => (
              <li key={c.id}>
                <div>
                  <strong>{FIELD[c.field] ?? c.field}:</strong> {show(c.field, c.old_value)} → {show(c.field, c.new_value)}
                  <div className="meta">
                    {who(c)} · {formatDay(c.changed_at.slice(0, 10))} {formatTime(c.changed_at)}
                    {c.note && ` · “${c.note}”`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
