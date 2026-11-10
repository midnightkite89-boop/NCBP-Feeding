import { useState } from 'react';
import { useStore } from '../store';
import { todaysFeed, targetRange, weightWarning, type BirdStatus } from '../status';
import { feedLabel, formatQty } from '../food';
import { FoodPicker, QtyStepper } from './FoodPicker';
import { flightTypeLabel, type Bird, type FlightType, type LogStatus } from '../types';
import { FLIGHT_ORDER, rememberFlightType } from '../flight';
import { Sheet } from './Sheet';
import { WeightInput } from './WeightInput';

// "Set food" decides today's food without feeding; it's saved as a weigh-in style log
type Mode = LogStatus | 'setfood';

const STATUS_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'setfood', label: 'Set food' },
  { value: 'fed', label: 'Fed' },
  { value: 'weighed', label: 'Weight only' },
  { value: 'fasting', label: 'Fasting today' },
];

export function LogSheet({ bird, status: birdState, onClose, initialMode = 'fed' }: { bird: Bird; status: BirdStatus; onClose: () => void; initialMode?: 'fed' | 'setfood' | 'weighed' | 'fasting' }) {
  const { fedCount } = birdState;
  const { logFeeds } = useStore();
  const usual = todaysFeed(bird, birdState);
  const [status, setStatus] = useState<Mode>(initialMode);
  const choosingFood = status === 'fed' || status === 'setfood';
  const [food, setFood] = useState(usual.food);
  const [qty, setQty] = useState(usual.qty);
  const [weightNum, setWeightNum] = useState<number | null>(null);
  const [weightInvalid, setWeightInvalid] = useState(false);
  const [notes, setNotes] = useState('');
  const [moreDue, setMoreDue] = useState(fedCount + 1 < bird.feeds_per_day);
  const [alsoFlown, setAlsoFlown] = useState<FlightType | null>(null);
  const [moreFood, setMoreFood] = useState(usual.food);
  const [moreQty, setMoreQty] = useState(1);

  const warning = weightInvalid ? null : weightWarning(bird, weightNum);
  const canSave =
    !weightInvalid &&
    (status !== 'weighed' || weightNum != null) &&
    (!choosingFood || !!food.trim()) &&
    (status !== 'fed' || !moreDue || !!moreFood.trim());

  function save() {
    if (!canSave) return;
    const at = new Date().toISOString();
    if (status === 'fed' && alsoFlown) rememberFlightType(alsoFlown);
    logFeeds(
      [
        ...(status === 'fed' && alsoFlown
          ? [{ bird_id: bird.id, status: 'flown' as const, food_type: null, amount: null, weight_g: null, notes: null, more_due: false, logged_at: at, flight_type: alsoFlown }]
          : []),
        {
          bird_id: bird.id,
          status: status === 'setfood' ? 'weighed' : status,
          food_type: choosingFood ? food.trim() : null,
          amount: choosingFood ? formatQty(qty) : null,
          weight_g: weightNum,
          notes: notes.trim() || null,
          more_due: status === 'fed' && moreDue,
          more_due_amount: status === 'fed' && moreDue ? feedLabel(formatQty(moreQty), moreFood.trim()) : null,
          logged_at: at,
        },
      ],
      status === 'setfood'
        ? `${bird.name}: today's food ${feedLabel(formatQty(qty), food.trim())}`
        : `${bird.name}: ${STATUS_OPTIONS.find((o) => o.value === status)!.label.toLowerCase()}${status === 'fed' && alsoFlown ? ` + flown (${flightTypeLabel(alsoFlown)})` : ''}`,
      { alsoCheck: status === 'fed' },
    );
    onClose();
  }

  return (
    <Sheet title={`Log – ${bird.name}`} onClose={onClose}>
      <div className="segmented segmented-4" role="radiogroup" aria-label="What happened">
        {STATUS_OPTIONS.map((o) => (
          <button key={o.value} role="radio" aria-checked={status === o.value} className={status === o.value ? 'on' : ''} onClick={() => setStatus(o.value)}>
            {o.label}
          </button>
        ))}
      </div>

      {choosingFood && (
        <>
          <FoodPicker value={food} onChange={setFood} />
          <QtyStepper value={qty} onChange={setQty} />
          {status === 'setfood' && <p className="muted">Sets today's food for {bird.name}. The green FED button will give this; nothing is logged as fed yet.</p>}
        </>
      )}

      <WeightInput
        label="Weight"
        hint={targetRange(bird) ? `target ${targetRange(bird)}` : undefined}
        unit={bird.weight_unit ?? 'g'}
        grams={null}
        placeholder={status === 'weighed' ? 'Required' : 'Optional'}
        onChange={(g, invalid) => {
          setWeightNum(g);
          setWeightInvalid(invalid);
        }}
      />
      {weightInvalid && <p className="warn">That doesn't look like a weight.</p>}
      {warning && <p className="warn">⚠ {warning}</p>}

      <label className="field">
        <span>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>

      {status === 'fed' && (
        <label className="check">
          <input type="checkbox" checked={moreDue} onChange={(e) => setMoreDue(e.target.checked)} />
          <span>More food due later today</span>
        </label>
      )}
      {status === 'fed' && moreDue && (
        <div className="panel more-panel">
          <FoodPicker label="Still to give – food" value={moreFood} onChange={setMoreFood} />
          <QtyStepper label="Still to give – how many" value={moreQty} onChange={setMoreQty} />
        </div>
      )}
      {status === 'fed' && (
        <div className="field also-flown">
          <span>✈ Also flown? (tap the type, tap again to clear)</span>
          <div className="flight-types">
            {FLIGHT_ORDER.filter((t) => t !== 'other').map((t) => (
              <button type="button" key={t} aria-pressed={alsoFlown === t} className={`btn btn-lg flight-type${alsoFlown === t ? ' on' : ''}`} onClick={() => setAlsoFlown(alsoFlown === t ? null : t)}>
                {flightTypeLabel(t)}
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="btn btn-primary btn-xl" disabled={!canSave} onClick={save}>
        Save
      </button>
    </Sheet>
  );
}
