import { useState } from 'react';
import { formatQty } from '../food';
import { leftoverLabel, leftoverTrend } from '../leftovers';
import { defaultFeed } from '../status';
import { useStore } from '../store';
import { formatTime } from '../time';
import type { Bird } from '../types';
import { FoodPicker, QtyStepper } from './FoodPicker';
import { Sheet } from './Sheet';

/** Log food found uneaten. It doesn't change whether the bird counts as fed. */
export function LeftoverSheet({ bird, onClose }: { bird: Bird; onClose: () => void }) {
  const { logFeeds } = useStore();
  const usual = defaultFeed(bird);
  const [food, setFood] = useState(usual.food);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');

  function save() {
    const amount = formatQty(qty);
    logFeeds(
      [{ bird_id: bird.id, status: 'left', food_type: food.trim() || null, amount, weight_g: null, notes: notes.trim() || null, more_due: false }],
      `${bird.name}: food left – ${leftoverLabel({ amount, food_type: food.trim() || null })}`,
    );
    onClose();
  }

  return (
    <Sheet title={`${bird.name}: food left`} onClose={onClose}>
      <p className="muted">What was left uneaten? This doesn't change whether {bird.name} is fed today.</p>
      <FoodPicker label="Food left" value={food} onChange={setFood} />
      <QtyStepper label="How many left" value={qty} onChange={setQty} />
      <label className="field">
        <span>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional, e.g. cached under the perch" />
      </label>
      <button className="btn btn-primary btn-xl" disabled={!food.trim()} onClick={save}>
        Save
      </button>
    </Sheet>
  );
}

/** "Left food 3 of the last 7 days", or today's leftover; nothing when there's nothing to say. */
export function LeftoverLine({ bird }: { bird: Bird }) {
  const { leftovers, today } = useStore();
  const trend = leftoverTrend(bird.id, leftovers, today);
  const todays = leftovers.filter((l) => l.bird_id === bird.id && l.log_date === today);
  if (trend.flagged) return <p className="leftover-line flagged">🍗 {trend.text}</p>;
  if (todays.length === 0) return null;
  const l = todays.at(-1)!;
  return (
    <p className="leftover-line">
      🍗 Left {leftoverLabel(l)} ({formatTime(l.logged_at)})
    </p>
  );
}
